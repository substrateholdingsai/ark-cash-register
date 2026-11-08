# AUTH System — Plan de Implementación

**Proyecto:** Ark Cash Register (`ark-cash-register`) — Cloudflare Workers + Hono + D1 + KV  
**Objetivo:** Autenticación robusta y soberana (sin proveedores de identidad de terceros), usando **Resend** únicamente como transportador de email para confirmación de creación de cuenta y recuperación de contraseña.  
**Última actualización:** Noviembre 2026

---

## 1. Principios de diseño

1. **Soberanía total del estado de identidad.** No Auth0, Clerk, Firebase Auth, Supabase Auth ni Cognito. Toda la lógica vive en el Worker y en D1/KV.
2. **Cero dependencias de terceros para crypto.** Solo `crypto.subtle` (Web Crypto API) disponible en el runtime de Workers: PBKDF2 para hashing de contraseñas, HMAC-SHA256 para firma de tokens JWT de acceso, SHA-256 para huellas de tokens opacos.
3. **Resend = solo email.** Se usa como API REST (`POST https://api.resend.com/emails`) con `RESEND_API_KEY`. Nunca almacena estado de identidad.
4. **Fail-closed.** Sin token/clave válida → 401. Sin DB → 503. Sin Resend key → registro/login fallan cerrados (no se crean usuarios a medias).
5. **Defensa en profundidad:** rate limiting por IP y por email, lockout progresivo, tokens de un solo uso con expiración corta, comparación en tiempo constante, mensajes genéricos anti-enumeración.
6. **Auditoría inmutable.** Cada evento de auth se asienta en `auth_audit_log` (análogo a `operator_audit_log`).

---

## 2. Arquitectura de alto nivel

```
┌──────────────────────────────────────────────────────────────┐
│ Frontend PWA (public/)                                       │
│  - register.html / login.html / verify-email.html            │
│  - forgot-password.html / reset-password.html                │
└──────────────┬───────────────────────────────────────────────┘
               │ HTTPS (cookies httpOnly + SameSite + CSRF token)
┌──────────────▼───────────────────────────────────────────────┐
│ Cloudflare Worker (Hono) — src/routes/auth.ts                │
│  - Validación de entrada (zod-free: validación manual)       │
│  - Rate limiter (KV sliding window)                          │
│  - Crypto (src/utils/crypto.ts)                              │
│  - Resend client (src/services/resendClient.ts)              │
└──────┬──────────────────────┬───────────────────────────────┘
       │                      │
┌──────▼──────┐        ┌──────▼──────┐
│ D1 SQLite   │        │ KV          │
│ users       │        │ sesiones    │
│ sessions    │        │ rate limits │
│ tokens      │        │ cache       │
│ audit_log   │        │             │
└─────────────┘        └─────────────┘
                              │
                       ┌──────▼──────┐
                       │ Resend API  │
                       │ (solo email)│
                       └─────────────┘
```

### 2.1. Estrategia de sesión (soberana, sin deps)

- **Access token:** JWT firmado HMAC-SHA256 (HS256) con secreto `AUTH_JWT_SECRET` (≥32 bytes). Expiración 15 min. Payload mínimo: `{ sub: userId, role, iat, exp, jti }`.
- **Refresh token:** opaco (32 bytes aleatorios, base64url). Se almacena en D1 `sessions` como hash SHA-256 (nunca en claro). Expiración 30 días, rotación en cada uso (refresh token rotation). Revocable por `jti`.
- **Transporte:** cookie `__Host-ark_session` (httpOnly, Secure, SameSite=Strict) con el refresh token; access token en memoria del cliente (no localStorage) y enviado como `Authorization: Bearer`. Para PWA offline, access token se renueva con refresh cookie al volver online.
- **CSRF:** doble submit cookie `__Host-ark_csrf` (no httpOnly) + header `X-CSRF-Token` para mutaciones con cookie. Endpoints Bearer-only exentos.

Alternativa simplificada (recomendada para hackathon): solo sesiones opacas en KV con TTL, sin JWT. Se documenta como "Modo Simple". Decisión final en §8.

---

## 3. Modelo de datos (D1)

Nueva migración `migrations/0003_auth.sql`.

```sql
-- 1. Usuarios
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,                      -- ULID
    email TEXT NOT NULL UNIQUE,
    email_verified INTEGER NOT NULL DEFAULT 0,
    password_hash TEXT NOT NULL,               -- pbkdf2$iterations$salt$hash (base64url)
    password_updated_at INTEGER NOT NULL,
    display_name TEXT,
    role TEXT NOT NULL DEFAULT 'cashier' CHECK(role IN ('admin','cashier','viewer')),
    merchant_id TEXT,                          -- FK opcional a merchants
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','locked','disabled')),
    failed_login_count INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_login_at INTEGER,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- 2. Sesiones (refresh tokens hasheados)
CREATE TABLE IF NOT EXISTS auth_sessions (
    id TEXT PRIMARY KEY,                      -- ULID (jti)
    user_id TEXT NOT NULL,
    refresh_token_hash TEXT NOT NULL UNIQUE,   -- SHA-256 del refresh token
    user_agent TEXT,
    ip_address TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER,
    replaced_by TEXT,                          -- rotación
    FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_hash ON auth_sessions(refresh_token_hash);

-- 3. Tokens de verificación de email
CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,               -- 24h
    consumed_at INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_evt_user ON email_verification_tokens(user_id);

-- 4. Tokens de reset de password
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,               -- 1h
    consumed_at INTEGER,
    request_ip TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_prt_user ON password_reset_tokens(user_id);

-- 5. Rate limiting persistente (complementa KV)
CREATE TABLE IF NOT EXISTS auth_rate_limits (
    key TEXT PRIMARY KEY,                      -- e.g. "login:ip:1.2.3.4" o "login:email:x@y.com"
    count INTEGER NOT NULL DEFAULT 0,
    window_start INTEGER NOT NULL,
    blocked_until INTEGER
);

-- 6. Auditoría de auth
CREATE TABLE IF NOT EXISTS auth_audit_log (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    event TEXT NOT NULL,                       -- register, verify_email, login_success, login_fail, logout, password_reset_request, password_reset_success, lockout, token_reuse
    ip_address TEXT,
    user_agent TEXT,
    metadata TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_audit_user ON auth_audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_audit_event ON auth_audit_log(event, created_at DESC);
```

---

## 4. Criptografía soberana (`src/utils/crypto.ts`)

- `hashPassword(password)` → PBKDF2 (SHA-256, 100 000 iteraciones, salt 16 bytes aleatorios). Formato serializado: `pbkdf2$100000$<salt_b64url>$<hash_b64url>`.
- `verifyPassword(password, stored)` → extrae parámetros, recomputa, compara con `timingSafeEqual`.
- `timingSafeEqual(a, b)` → comparación en tiempo constante sobre `Uint8Array`.
- `generateToken(bytes=32)` → `crypto.getRandomValues` + base64url.
- `sha256Hex(input)` → digest SHA-256 hex (para hashes de tokens).
- `signJwt(payload, secret)` / `verifyJwt(token, secret)` → HS256 manual con Web Crypto (sin librería).
- `generateUlid()` ya existe en `src/utils/ulid.ts`.

**Nota de seguridad:** PBKDF2 con 100k iteraciones en Workers es viable (<50ms por login). Ajustar iteraciones por entorno. Nunca Argon2 (no disponible sin wasm; se puede añadir `argon2-wasm` si se desea, pero rompe "sin deps"; dejar como mejora futura).

---

## 5. Cliente Resend (`src/services/resendClient.ts`)

```ts
export class ResendClient {
  constructor(private apiKey: string, private from: string) {}
  async sendEmail(to: string, subject: string, html: string, text: string): Promise<{ id: string }>;
  // POST https://api.resend.com/emails
  // Headers: Authorization: Bearer <apiKey>, Content-Type: application/json
  // Body: { from, to, subject, html, text }
}
```

- Reintentos con backoff exponencial (máx 3) solo para 5xx/timeout.
- Fail-closed: si `RESEND_API_KEY` ausente → throw `RESEND_NOT_CONFIGURED`.
- Plantillas HTML inline (sin motor de templates externo). Variables interpoladas con escape HTML.

### Plantillas de email

1. **Verificación de cuenta** — asunto `Confirma tu cuenta — Ark Cash Register`. Link: `https://<host>/verify-email?token=<rawToken>`. Expira 24h. Texto alternativo con token.
2. **Reset de contraseña** — asunto `Restablece tu contraseña`. Link: `https://<host>/reset-password?token=<rawToken>`. Expira 1h.

Ambas con pie de página: "Si no solicitaste esto, ignora este correo." (anti-phishing).

---

## 6. Endpoints (`src/routes/auth.ts`)

Base: `/api/auth/*`. Montar en `index.ts` como `app.route('/api/auth', authRouter)`.

| Método | Ruta | Descripción | Auth |
|---|---|---|---|
| POST | `/register` | Crea usuario `pending`, envía email de verificación | Público (rate-limited) |
| GET | `/verify-email?token=` | Verifica token, activa cuenta | Público |
| POST | `/resend-verification` | Reenvía email de verificación (si no verificado) | Público (rate-limited) |
| POST | `/login` | Valida credenciales, emite access + refresh | Público (rate-limited) |
| POST | `/refresh` | Rota refresh token, emite nuevo access | Cookie refresh |
| POST | `/logout` | Revoca sesión actual | Bearer o cookie |
| POST | `/logout-all` | Revoca todas las sesiones del usuario | Bearer |
| POST | `/forgot-password` | Genera reset token y envía email (respuesta genérica) | Público (rate-limited) |
| POST | `/reset-password` | Valida token, actualiza password, revoca sesiones | Público (rate-limited) |
| GET | `/me` | Datos del usuario autenticado | Bearer |
| PUT | `/me` | Actualiza display_name (y password con currentPassword) | Bearer |
| GET | `/sessions` | Lista sesiones activas del usuario | Bearer |
| DELETE | `/sessions/:id` | Revoca una sesión específica | Bearer |

### Contratos (request/response)

**POST /register**
```json
// req
{ "email": "user@example.com", "password": "••••••••", "displayName": "Juan" }
// res 201
{ "success": true, "message": "Te enviamos un correo para confirmar tu cuenta.", "userId": "01..." }
// res 400 (validación)
{ "error": { "message": "...", "type": "VALIDATION_ERROR", "fields": {...} } }
// res 409 (email ya existe) -> respuesta GENÉRICA igual a 201 para anti-enumeración
```

**POST /login**
```json
// req
{ "email": "...", "password": "..." }
// res 200
{ "accessToken": "eyJ...", "expiresIn": 900, "user": { "id", "email", "role", "displayName", "emailVerified" } }
// + Set-Cookie refresh
```

**POST /forgot-password** → siempre 200 con mensaje genérico, incluso si email no existe.

**POST /reset-password**
```json
{ "token": "raw", "newPassword": "..." }
```

---

## 7. Flujos detallados

### 7.1. Registro

1. Validar email (regex + longitud ≤254) y password (≥12 chars, al menos 1 mayúscula, 1 minúscula, 1 número; opcional símbolo).
2. Rate limit por IP (10/hora) y por email (5/hora).
3. Si email ya existe → responder 201 genérico (no revelar existencia) y registrar evento `register_duplicate`. No enviar email.
4. Hashear password (PBKDF2).
5. Insertar user `status='pending'`, `email_verified=0`.
6. Generar token raw (32 bytes), guardar hash SHA-256 en `email_verification_tokens` con expiración 24h.
7. Enviar email vía Resend con link `https://<host>/verify-email?token=<raw>`.
8. Audit log `register`.

### 7.2. Verificación de email

1. Recibir `token` (query o body). Validar presencia.
2. Hash SHA-256 del token. Buscar en `email_verification_tokens` donde `consumed_at IS NULL AND expires_at > now`.
3. Si no existe → 400 `INVALID_OR_EXPIRED_TOKEN`.
4. Marcar token consumido. Actualizar user `email_verified=1`, `status='active'`.
5. Audit log `verify_email`. (Opcional: auto-login emitiendo sesión.)

### 7.3. Login

1. Rate limit por IP (20/15min) y por email (10/15min).
2. Buscar user por email (lowercase normalizado).
3. Si no existe → delay constante (simular verificación) → 401 genérico `INVALID_CREDENTIALS`. Audit `login_fail` (user_id null).
4. Si `locked_until > now` → 423 `ACCOUNT_LOCKED` con `retryAfter`.
5. Si `status != 'active'` → 403 `ACCOUNT_NOT_ACTIVE` (mensaje genérico).
6. Verificar password (timing-safe). Si falla: incrementar `failed_login_count`; si ≥5 → set `locked_until = now + 15min` (lockout progresivo: 5→15min, 10→1h, 15→24h). Audit `login_fail`.
7. Si éxito: reset `failed_login_count=0`, `locked_until=null`, `last_login_at=now`. Crear sesión (refresh token opaco hasheado), emitir access JWT. Audit `login_success`.
8. Setear cookies.

### 7.4. Refresh (rotación)

1. Leer refresh token de cookie `__Host-ark_session`.
2. Hash SHA-256. Buscar sesión no revocada y no expirada.
3. Si token reutilizado (sesión ya revocada con `replaced_by` set) → **revocar toda la familia de sesiones del usuario** (detección de robo) + audit `token_reuse`. Retornar 401.
4. Crear nueva sesión, marcar antigua `revoked_at=now, replaced_by=newId`.
5. Emitir nuevo access JWT + nueva cookie refresh.

### 7.5. Forgot password

1. Rate limit por IP (5/hora) y por email (3/hora).
2. Normalizar email. Buscar user. **Siempre responder 200 genérico** ("Si el correo existe, recibirás instrucciones.").
3. Si user existe y activo: invalidar tokens previos no consumidos; generar token raw (32 bytes), guardar hash, expiración 1h; enviar email Resend.
4. Audit `password_reset_request` (user_id si existe, else null).

### 7.6. Reset password

1. Rate limit por IP.
2. Hash token. Buscar `password_reset_tokens` no consumido y no expirado.
3. Si inválido → 400 genérico.
4. Validar nueva password (política).
5. Actualizar `password_hash`, `password_updated_at=now`. Incrementar `password_version` (opcional) para invalidar JWTs viejos.
6. Marcar token consumido. Revocar **todas** las sesiones del usuario.
7. Audit `password_reset_success`.
8. Responder 200. (Opcional: auto-login.)

---

## 8. Decisión de modo de sesión

- **Modo A (recomendado producción):** JWT access (15min) + refresh opaco rotativo en cookie. Requiere manejo de cookies y CSRF.
- **Modo B (hackathon/simple):** sesión opaca única en KV con TTL 7 días, sin refresh ni rotación. Más simple, menos seguro (sin detección de robo). Aceptable para demo.

**Recomendación:** Implementar Modo A completo; si el tiempo aprieta, Modo B como fallback detrás de flag `AUTH_MODE=simple`.

---

## 9. Middleware (`src/middleware/auth.ts`)

```ts
export async function requireAuth(c, next) {
  // 1. Extraer Bearer token o cookie
  // 2. Verificar JWT (firma + exp)
  // 3. Cargar user de D1 (cache KV 60s por userId)
  // 4. Verificar status === 'active' y password_updated_at coherente (token version)
  // 5. Setear c.set('user', { id, email, role, ... })
  // 6. Audit en caso de fallo (sin PII en logs)
}
export function requireRole(...roles) { ... }
```

Exportar `authMiddleware`, `optionalAuth`.

---

## 10. Rate limiting (`src/utils/rateLimit.ts`)

- Sliding window en KV: clave `rl:<scope>:<key>`, valor JSON `{ count, windowStart }`.
- Configurable por endpoint. Límites sugeridos:
  - register: 10/IP/hora, 5/email/hora
  - login: 20/IP/15min, 10/email/15min
  - forgot-password: 5/IP/hora, 3/email/hora
  - reset-password: 10/IP/hora
  - verify-email: 20/IP/hora
- Respuesta 429 con `Retry-After`.

---

## 11. Seguridad adicional (checklist)

- [ ] Contraseñas: mínimo 12 chars, política configurable. Nunca loguear.
- [ ] Normalización de email: `trim().toLowerCase()`, validar con regex razonable (no RFC completo).
- [ ] Comparación en tiempo constante para tokens y passwords.
- [ ] Tokens hasheados en DB (nunca raw). Raw solo viaja por email/link.
- [ ] Expiración corta: verificación 24h, reset 1h, access 15min.
- [ ] Un solo uso (consumed_at).
- [ ] Invalidación de tokens al cambiar password / verificar email.
- [ ] Lockout progresivo con backoff.
- [ ] Detección de reutilización de refresh token → revocar familia.
- [ ] Cookies: `__Host-` prefix, httpOnly (refresh), Secure, SameSite=Strict, Path=/.
- [ ] CSRF doble-submit para mutaciones cookie-based.
- [ ] Headers de seguridad: `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`.
- [ ] Anti-enumeración: respuestas idénticas para email existente/inexistente en register y forgot-password.
- [ ] Audit log de todos los eventos.
- [ ] No exponer `password_hash`, tokens, ni secrets en responses.
- [ ] Validación de origen (Origin/Referer) en endpoints sensibles.
- [ ] Protección contra fuerza bruta con rate limit + lockout.
- [ ] Rotación de `AUTH_JWT_SECRET` con soporte de múltiples secretos (kid) — fase 2.

---

## 12. Variables de entorno y secretos

Agregar a `Env` en `src/types.ts`:

```ts
AUTH_JWT_SECRET?: string;          // secret (≥32 bytes, base64)
AUTH_JWT_SECRET_PREV?: string;     // para rotación
AUTH_COOKIE_DOMAIN?: string;       // opcional
RESEND_API_KEY?: string;           // secret
RESEND_FROM_EMAIL?: string;        // var, ej. "Ark Cash <noreply@arksystems.site>"
APP_BASE_URL?: string;             // var, ej. "https://caja.arksystems.site"
AUTH_MODE?: string;                // "full" | "simple"
PASSWORD_MIN_LENGTH?: string;      // var
```

Secrets a registrar:
```
npx wrangler secret put AUTH_JWT_SECRET
npx wrangler secret put RESEND_API_KEY
```

Vars en `wrangler.toml`:
```
APP_BASE_URL = "https://caja.arksystems.site"
RESEND_FROM_EMAIL = "Ark Cash Register <noreply@arksystems.site>"
AUTH_MODE = "full"
PASSWORD_MIN_LENGTH = "12"
```

---

## 13. Estructura de archivos a crear

```
src/
├── routes/
│   └── auth.ts                    # router Hono /api/auth/*
├── middleware/
│   └── auth.ts                    # requireAuth, requireRole, optionalAuth
├── services/
│   └── resendClient.ts            # cliente REST Resend + plantillas email
├── utils/
│   ├── crypto.ts                  # PBKDF2, JWT HS256, tokens, timingSafeEqual
│   └── rateLimit.ts               # sliding window KV
migrations/
└── 0003_auth.sql                  # tablas de identidad
tests/
└── auth.test.ts                   # suite Vitest
public/
├── login.html
├── register.html
├── verify-email.html
├── forgot-password.html
└── reset-password.html
```

---

## 14. Integración en `src/index.ts`

```ts
import { authRouter } from './routes/auth';
// ...
app.route('/api/auth', authRouter);
```

Registrar middleware global de headers de seguridad (HSTS en prod).

---

## 15. Testing (`tests/auth.test.ts`)

Casos mínimos:
- Registro exitoso crea user `pending` y envía email (mock Resend).
- Registro con email duplicado responde 201 genérico sin email.
- Validación de password débil → 400.
- Verificación con token válido activa cuenta; token inválido/expirado → 400.
- Token de un solo uso (segundo uso falla).
- Login con credenciales correctas → 200 + cookies.
- Login con password incorrecta → 401, incrementa contador, lockout tras 5.
- Login con cuenta no verificada → 403.
- Refresh rota token; reutilización del viejo → revoca familia.
- Forgot password siempre 200; envía email solo si existe.
- Reset password actualiza hash y revoca sesiones.
- Rate limit → 429.
- `/me` sin token → 401; con token → 200.
- No se filtran secrets/password_hash en responses.

Mockear D1 (reutilizar patrón de `tests/internal.test.ts`) y Resend (fetch mock).

---

## 16. Fases de implementación (orden sugerido)

### Fase 0 — Preparación (½ día)
- [ ] Añadir secrets/vars.
- [ ] Crear migración `0003_auth.sql`.
- [ ] Aplicar migración local (`npm run d1:local` extendido o script).

### Fase 1 — Crypto y utils (½ día)
- [ ] `src/utils/crypto.ts` (PBKDF2, JWT HS256, tokens, timingSafeEqual).
- [ ] `src/utils/rateLimit.ts`.
- [ ] Tests unitarios de crypto.

### Fase 2 — Resend client (¼ día)
- [ ] `src/services/resendClient.ts` + plantillas.

### Fase 3 — Endpoints core (1.5 días)
- [ ] register, verify-email, resend-verification.
- [ ] login, refresh, logout, logout-all.
- [ ] forgot-password, reset-password.

### Fase 4 — Middleware y rutas protegidas (½ día)
- [ ] `src/middleware/auth.ts`.
- [ ] `/me`, `/sessions`.
- [ ] Integrar en `index.ts`.

### Fase 5 — Frontend (1 día)
- [ ] Páginas HTML en `public/` con estética ARK (Navy/Gold/Orbitron).
- [ ] Formularios con validación cliente y manejo de tokens.

### Fase 6 — Tests y hardening (1 día)
- [ ] `tests/auth.test.ts`.
- [ ] Revisión de seguridad (checklist §11).
- [ ] `npm run typecheck && npm test`.

### Fase 7 — Despliegue (¼ día)
- [ ] Migración remota, secrets, deploy, smoke test.

**Estimación total:** ~5 días de desarrollo.

---

## 17. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| PBKDF2 lento en Workers bajo carga | Ajustar iteraciones (60k-100k); cachear verificación no es opción; considerar Web Crypto con iteraciones adaptativas. |
| Resend caído → registro falla | Cola de reintento en KV (deferred email); marcar user `pending_email` y reintentar vía cron. |
| Robo de refresh token | Rotación + detección de reutilización revoca familia. |
| Enumeración de usuarios | Respuestas genéricas + timing constante. |
| JWT secret leak | Rotación con `kid`; secreto solo en Cloudflare Secrets. |
| Cookies en PWA standalone | `SameSite=Strict` puede romper flujos cross-site; usar `Lax` si se requiere OAuth externo (no aplica aquí). |

---

## 18. Fuera de alcance (v1)

- MFA / TOTP (fase 2).
- OAuth social (Google/Apple) — contradice soberanía; no.
- WebAuthn / passkeys — fase 3.
- Multi-tenant organizaciones complejas (solo `merchant_id` FK).
- SCIM / SSO.

---

## 19. Criterios de aceptación

1. Un usuario puede registrarse, recibir email, verificar cuenta y loguearse.
2. Un usuario puede solicitar reset de password y establecer uno nuevo; sesiones previas revocadas.
3. Tokens inválidos/expirados son rechazados.
4. Rate limiting y lockout funcionan.
5. `npm run typecheck` y `npm test` pasan.
6. No se exponen secrets ni hashes en responses ni logs.
7. Resend es la única dependencia externa (email), y solo para transporte.

---

## 20. Referencias internas

- `src/utils/ulid.ts` — generación de IDs.
- `src/middleware/staypuftAuth.ts` — patrón de auth fail-closed y audit log.
- `src/routes/webhooks.ts` — patrón HMAC + anti-replay (reutilizar para firma de JWT).
- `tests/internal.test.ts` — patrón de mock D1 para tests.
- `docs/map.md` — mapa del proyecto.
