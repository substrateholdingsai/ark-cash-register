# 🗺️ MAPA DEL PROYECTO — ARK CASH REGISTER (v2.0)

**Producto:** Ark-cajaregistradora (`pey-worker`)  
**Ecosistema:** ARK Systems (Substrate Holdings LLC)  
**Integración Bancaria:** Pey CoDi API (OpenAPI v2026-10-20 / Banxico)  
**Infraestructura:** Cloudflare Workers + D1 Database + KV Cache + R2 + Workers AI + PWA  
**Última actualización:** Noviembre 2026  
**Estado:** Typecheck `tsc --noEmit`: 0 errores | Tests Vitest: 97/97 pasando (8 archivos)

---

## 1. Esquema de Arquitectura del Proyecto

```
ark-cash-register/
├── docs/
│   ├── ark-cash-register.md   # Documento maestro de diseño (22 secciones)
│   ├── map.md                 # Este documento: mapa integral del proyecto
│   ├── auth-plan.md           # Plan de auth soberano
│   ├── compliance-plan.md     # Plan de compliance / ARCO / LFPIORPI
│   ├── dr-plan.md             # Plan de recuperación ante desastres
│   ├── dpo.md                 # Delegado de Protección de Datos
│   ├── dpa-pey.md             # DPAs con Pey
│   └── dpa-facturapi.md       # DPAs con Facturapi
├── migrations/                # Migraciones D1 SQLite (9, aplicadas en orden)
│   ├── 0001_initial_schema.sql          # merchants, payments, ledger_entries, webhook_events
│   ├── 0002_operator_audit_and_closes.sql# operator_audit_log, daily_closes
│   ├── 0003_auth.sql                    # users, auth_sessions, email_verification_tokens, ...
│   ├── 0004_compliance.sql              # consent_records, arco_requests, versions, purge_log
│   ├── 0005_mfa.sql                     # user_mfa
│   ├── 0006_invoices.sql                # fiscal_profiles, invoices
│   ├── 0007_webhook_idempotency.sql     # idempotency_key, índice único en webhook_events
│   ├── 0008_spei_fallback.sql           # amount_mxn_equiv, payment_rail, currency, solana_* columns
│   └── 0009_digital_dollars_lfpiorpi.sql# lfpiorpi_evaluaciones
├── public/                    # Assets estáticos servidos desde el Edge (PWA Frontend)
│   ├── index.html             # Landing pública (copy multi-riel, FAQ)
│   ├── caja.html              # Pantalla del mostrador (A, B, C) + corte del día
│   ├── tienda.html            # Storefront del cliente: catálogo, carrito, checkout CoDi/SPEI/Solana/WhatsApp
│   ├── instructivo.html       # Guía de uso del mostrador
│   ├── landing.html           # Alias de landing / index
│   ├── verify-email.html      # Verificación de cuenta (Auth)
│   ├── reset-password.html    # Restablecimiento de contraseña (Auth)
│   ├── privacy.html           # Aviso de privacidad
│   ├── terms.html             # Términos de uso
│   ├── sw.js                  # Service Worker (caché offline de assets)
│   ├── manifest.json          # Manifiesto PWA
│   ├── favicon.svg | logo.svg | badge-pey.svg | *.svg | *.png
│   └── (logo-lockup.svg, divider.svg, mask-arc.svg, sprite-gremial.svg, og-image.svg,
│       pattern.svg, pey-codi-logo.png, phone-frame.png)
├── src/                       # Código fuente del Cloudflare Worker (TypeScript)
│   ├── index.ts               # Router Hono principal, CORS, logger, healthcheck, redirects, scheduled (purge + backup)
│   ├── types.ts               # Tipos TS: Env, CODI_MAX_MXN=8000, mints Solana, umbrales LFPIORPI, estados/rieles/divisas
│   ├── data/
│   │   └── catalogs.ts        # Catálogos aislados por merchant (Taquería El Güero, SkinLab Clothing)
│   ├── middleware/
│   │   ├── auth.ts            # requireAuth, requireRole, optionalAuth, requireMerchantAuth (JWT + cookies __Host-)
│   │   └── staypuftAuth.ts    # Fail-closed con X-StayPuft-Key para /api/internal/*
│   ├── routes/
│   │   ├── auth.ts            # /api/auth/* (register, login, refresh, logout, MFA TOTP, forgot/reset, me, sessions)
│   │   ├── codi.ts            # /api/codi/qr, /api/payment/codi/* (qr, simulate-payment, pn)
│   │   ├── compliance.ts      # /api/legal/versions, /api/privacy/*, /api/internal/privacy-requests, /api/internal/backup/run
│   │   ├── internal.ts        # /api/internal/* (status, merchants, payments, ledger, webhooks, close-days, metrics, lfpiorpi/evaluar)
│   │   ├── invoices.ts        # /api/fiscal/profile, /api/invoice/* (issue, cancel, list, pdf, xml) + Facturapi + R2
│   │   ├── merchant.ts        # /api/merchant/* (register, catalog CRUD, payments, close-day, spei-order, confirm-spei, solana-wallet, validate-clabe)
│   │   ├── paymentLink.ts     # /api/payment-link, /api/payment/link/*
│   │   ├── solana.ts          # /api/solana/*, /api/payment/solana/* (order, status, confirm-payment, offramp-info)
│   │   ├── webhooks.ts        # /webhooks/pey, /api/webhooks/pey (HMAC-SHA256, anti-replay, idempotencia)
│   │   └── ai.ts              # /api/ai/close-summary, /api/ai/suggest-sat-key (Workers AI)
│   ├── services/
│   │   ├── peyClient.ts       # Cliente HTTP tipado vs api.pey.mx (retry exponencial, mock local prohibido en prod)
│   │   ├── resendClient.ts    # Email transaccional (verificación, reset de contraseña)
│   │   ├── facturapiClient.ts # Cliente REST Facturapi (timbrado CFDI 4.0)
│   │   ├── backup.ts          # Snapshot D1 → R2 (JSON por tabla, semanal vía scheduled)
│   │   ├── aiClient.ts        # runChat vs Workers AI (@cf/meta/llama-3.1-8b-instruct)
│   │   └── lfpiorpi.ts        # evaluadorActividadesVulnerables (Acumulación 6 meses, umbrales UMA, dictamen SHA-256)
│   ├── utils/
│   │   ├── ulid.ts            # ULID criptográfico Crockford Base32
│   │   ├── crypto.ts          # PBKDF2 (100k iter), JWT HS256, tokens opacos, comparación constante, sha256
│   │   ├── rateLimit.ts       # Sliding window en KV (IP/email)
│   │   ├── totp.ts            # TOTP RFC 6238 soberano (MFA)
│   │   ├── clabe.ts           # Validación CLABE 18 dígitos (checksum Banxico) + catálogo de bancos
│   │   └── solana.ts          # Validación Base58 wallet Solana, referencia única, URL Solana Pay
├── tests/                     # Suite Vitest (8 archivos, 97 pruebas)
│   ├── ai.test.ts                       # 3 pruebas
│   ├── auth.test.ts                     # 15 pruebas
│   ├── internal.test.ts                 # 14 pruebas
│   ├── invoices.test.ts                 # 4 pruebas
│   ├── p0_auth_pagination_idempotency.test.ts  # 18 pruebas
│   ├── solana_lfpiorpi.test.ts          # 16 pruebas
│   ├── spei_fallback.test.ts            # 13 pruebas
│   └── storefront.test.ts               # 14 pruebas
├── forge_pey.py               # Generador Python de assets SVG institucionales (favicon, logo)
├── scripts/
│   └── forge_ark_cash_register.py
├── package.json               # Dependencias: hono ^4.13.17 | Dev: @cloudflare/workers-types, typescript, vitest
├── tsconfig.json              # TS estricto para Worker runtime (ES2022, ESNext modules, hono/jsx)
├── wrangler.toml              # Config Cloudflare Workers: bindings D1/KV/R2/AI, vars y secrets
└── .gitignore
```

---

## 2. Mapa de Integración y Flujo de Datos

```mermaid
flowchart TD
    subgraph FRONTEND["Frontend PWA (Edge Assets, public/)"]
        UI_A["Pantalla A: Mostrador\n(Lista de hoy, Cobrar aquí, Cobrar a distancia)"]
        UI_B["Pantalla B: Cobrar aquí\n(Teclado 72px + QR client-side qrcode.js)"]
        UI_C["Pantalla C: Cobro a distancia\n(Link remoto + Copiar + WhatsApp)"]
        STORE["/tienda: Storefront\n(Catálogo aislado, carrito localStorage, checkout multi-riel)"]
    end

    subgraph WORKER["Cloudflare Worker (pey-worker, src/index.ts)"]
        ROUTER["Router Hono + CORS + Security headers"]
        CODI["CoDi QR /api/codi/qr + PN /api/codi/pn"]
        LINK["Payment Links /api/payment-link, /api/payment/link/:id"]
        MERCH["Merchants /api/merchant/* (catalog, payments, close-day, spei)"]
        WEB["Webhooks /webhooks/pey + /api/webhooks/pey"]
        INTERNAL["StayPuft /api/internal/* (solo lectura, fail-closed)"]
        AUTH["Auth /api/auth/* (JWT, MFA TOTP, cookies __Host-)"]
        COMP["Compliance /api/privacy/*, /api/legal/versions, backup"]
        INV["Facturación /api/invoice/*, /api/fiscal/profile (Facturapi + R2)"]
        AI["Workers AI /api/ai/* (corte resumen, clave SAT)"]
        SOL["Solana Pay /api/solana/* (order, status, confirm, offramp)"]
    end

    subgraph STORAGE["Cloudflare Storage"]
        D1_DB[("D1 SQLite (ark_caja_db)\n- merchants, payments, ledger_entries,\n  webhook_events, daily_closes,\n  operator_audit_log, users, auth_sessions,\n  consent_records, arco_requests, fiscal_profiles,\n  invoices, user_mfa, lfpiorpi_evaluaciones")]
        KV_CACHE[("KV Namespace\n- Sesiones, catálogos, rate limiting,\n  merchant cache")]
        R2_BKT[("R2 Bucket (ark-cash-invoices)\n- XML CFDI, backups D1 snapshot")]
    end

    subgraph PEY["Pey API & Banxico (CoDi)"]
        PEY_CODI["api.pey.mx/codi/qr, /codi/pn"]
        PEY_LINK["api.pey.mx/payment-link/create, /payment-link/:id"]
        PEY_BA["api.pey.mx/bank-account (onboarding CLABE)"]
        PEY_WH["Disparador webhooks: payment.confirmed, bank-account.updated"]
    end

    subgraph EXTERNAL["Servicios Externos"]
        RES["Resend (email transaccional)"]
        FAC["Facturapi (PAC CFDI 4.0 SAT)"]
        WAI["Cloudflare Workers AI (@cf/meta/llama-3.1-8b-instruct)"]
        SOLANA["Red Solana (SPL USDC/USDT, no-custodial)"]
    end

    UI_B -->|1. POST /api/codi/qr| CODI
    CODI -->|2. POST /codi/qr| PEY_CODI
    PEY_CODI -->|3. IDC + qrString| CODI
    CODI -->|4. Almacena WAITING| D1_DB
    CODI -->|5. Retorna qrString| UI_B
    UI_B -->|6. Polling 5s| MERCH
    MERCH -->|7. Consulta Pey / D1| PEY_CODI

    UI_C -->|POST /api/payment-link| LINK
    LINK -->|POST /payment-link/create| PEY_LINK
    PEY_LINK -->|8. url de pago| LINK

    PEY_WH -->|9. POST /webhooks/pey| WEB
    WEB -->|HMAC + Anti-replay + Idempotencia| WEB
    WEB -->|Actualiza PAID + Asiento contable| D1_DB
    WEB -->|bank-account.updated| PEY_BA

    STORE -->|Checkout CoDi ≤ $8,000| CODI
    STORE -->|Checkout SPEI > $8,000| MERCH
    MERCH -->|POST /:id/spei-order| D1_DB
    STORE -->|Checkout Solana USDC/USDT| SOL
    SOL -->|LFPIORPI evaluación| INTERNAL
    SOL -->|Confirmación en cadena| SOLANA

    INTERNAL -->|Lecturas paginadas (máx 100)| D1_DB
    AUTH -->|Sesiones, usuarios, MFA| D1_DB
    INV -->|Timbrado + XML| FAC
    INV -->|XML en R2| R2_BKT
    AI -->|Resumen corte + clave SAT| WAI
    ROUTER -. scheduled -.|Purge + backup semanal| D1_DB
    ROUTER -. scheduled -.|Backup snapshot| R2_BKT
```

---

## 3. Matriz de Endpoints y Mapeo Pey

### 3.1 Endpoints públicos de cobro

| Endpoint Worker | Método | Destino Pey | Propósito | Estado |
|---|---|---|---|---|
| `GET /api/health` | `GET` | Local / Worker | Diagnóstico de bindings D1, KV, R2, AI, auth, resend | Listo |
| `POST /api/codi/qr` | `POST` | `/codi/qr` | Genera QR CoDi con `generateImage: false` (límite $8,000 MXN) | Listo |
| `POST /api/codi/pn` | `POST` | `/codi/pn` | Push Notification CoDi a celular (10 dígitos) | Listo |
| `POST /api/codi/simulate-payment` | `POST` | Local | Simulación de pago para demos/hackathon | Listo |
| `GET /api/payment/codi/qr/:id` (y variantes `/qr/:id/status`, `/:id`, `/:id/status`, `/status/:id`) | `GET` | `/transaction/codi/qr/:id` | Polling dual de estado de QR CoDi | Listo |
| `POST /api/payment-link` | `POST` | `/payment-link/create` | Crea enlace para cobro remoto | Listo |
| `GET /api/payment/link/:id` | `GET` | `/payment-link/:id` | Polling de estado de enlace remoto | Listo |
| `POST /api/merchant/register` | `POST` | `/bank-account` | Onboarding de cuenta CLABE (18 dígitos) + wallet Solana opcional | Listo |
| `GET /api/merchant/:id` | `GET` | `/bank-account/:id` | Estado CoDi (PENDING / ACTIVE) + datos enmascarados | Listo |
| `GET /api/merchant/:id/payments` | `GET` | D1 Local | Historial paginado del mostrador (máx 100, sin qrString) | Listo |
| `POST /api/merchant/:id/close-day` | `POST` | D1 Local | Corte de caja con desglose fiscal por riel/divisa | Listo |
| `POST /api/merchant/:id/spei-order` | `POST` | Local | Orden SPEI para montos > $8,000 MXN (PENDING_SPEI) | Listo |
| `POST /api/merchant/:id/payments/:paymentId/confirm-spei` | `POST` | Local | Confirmación manual SPEI con asiento contable + auditoría | Listo |
| `POST /api/merchant/:id/solana-wallet` | `POST` | Local | Configura wallet Solana no-custodial del comercio | Listo |
| `GET /api/merchant/:id/catalog` | `GET` | D1/KV Local | Catálogo aislado por merchant | Listo |
| `PUT|PATCH /api/merchant/:id/catalog/...` | `PUT|PATCH` | KV Local | Actualización de catálogo y items | Listo |
| `GET /api/merchant/validate-clabe/:clabe` | `GET` | Local | Validación de CLABE y detección de banco | Listo |
| `POST /webhooks/pey` + `POST /api/webhooks/pey` | `POST` | Webhook Receptor | Ingesta `payment.confirmed` / `bank-account.updated` con HMAC-SHA256, anti-replay 300s, idempotencia | Listo |

### 3.2 Endpoints de Auth (soberano)

| Endpoint | Método | Propósito |
|---|---|---|
| `/api/auth/register` | POST | Registro con consentimiento versionado (terms/privacy) + email verificación |
| `/api/auth/verify-email` | GET | Verifica cuenta vía token |
| `/api/auth/resend-verification` | POST | Reenvío de verificación |
| `/api/auth/login` | POST | Access JWT (15 min) + refresh cookie `__Host-ark_session` (30 días, rotación) |
| `/api/auth/refresh` | POST | Rotación de refresh token con detección de reutilización y binding User-Agent |
| `/api/auth/logout` | POST | Revoca sesión actual |
| `/api/auth/logout-all` | POST | Revoca todas las sesiones del usuario |
| `/api/auth/forgot-password` | POST | Solicitud de reset (respuesta genérica, anti-enumeración) |
| `/api/auth/reset-password` | POST | Aplica nueva contraseña |
| `/api/auth/me` | GET/PUT | Perfil autenticado / actualiza perfil o contraseña |
| `/api/auth/sessions` | GET | Lista sesiones activas |
| `/api/auth/sessions/:id` | DELETE | Revoca sesión |
| `/api/auth/mfa/setup|verify|disable` | POST | MFA TOTP (RFC 6238) |

### 3.3 Endpoints de Compliance y Facturación

| Endpoint | Método | Propósito |
|---|---|---|
| `/api/legal/versions` | GET | Versiones actuales de términos y privacidad |
| `/api/privacy/export\|rectify\|cancel\|oppose` | POST | Derechos ARCO (acceso, rectificación, cancelación, oposición) |
| `/api/privacy/requests` | GET | Listar solicitudes ARCO del usuario |
| `/api/internal/privacy-requests` | GET | Admin StayPuft: listar solicitudes ARCO |
| `/api/internal/backup/run` | POST | Admin StayPuft: backup D1 → R2 |
| `/api/fiscal/profile` | GET/POST | Perfil fiscal del cliente (RFC, régimen, CP) |
| `/api/invoice/issue` | POST | Emisión CFDI 4.0 (Facturapi en vivo o fallback certificado) + XML en R2 |
| `/api/invoice/cancel` | POST | Cancelación de factura |
| `/api/invoice/:id` | GET | Consultar factura |
| `/api/invoice` | GET | Listar facturas |
| `/api/invoice/:id/pdf` | GET | Vista de comprobante PDF |
| `/api/invoice/:id/xml` | GET | Descarga XML del comprobante |

### 3.4 Endpoints de IA, Solana e Internos

| Endpoint | Método | Propósito |
|---|---|---|
| `/api/ai/close-summary` | POST | Resumen ejecutivo de corte con Workers AI (caché KV 1h) |
| `/api/ai/suggest-sat-key` | POST | Sugerencia de clave de producto SAT vía IA |
| `/api/solana/order` | POST | Orden Solana Pay USDC/USDT con evaluación LFPIORPI previa |
| `/api/solana/status/:id` | GET | Consulta estado de pago Solana |
| `/api/solana/confirm-payment` | POST | Confirmación en cadena (firma + monto exacto, MANUAL_REVIEW si difiere) |
| `/api/solana/offramp-info/:merchantId` | GET | Disponibilidad de off-ramp a MXN solo si proveedor registrado |
| `/api/internal/*` | GET/POST | Conector StayPuft: status, merchants, payments, ledger, webhooks, close-days, metrics, lfpiorpi/evaluar |

### 3.5 Rutas amigables (redirects)

`/caja` → `/caja.html`, `/tienda` → `/tienda.html`, `/menu\|/catalogo\|/store` → `/tienda.html`, `/app` → `/caja`, `/instructivo\|/landing\|/como-funciona` → `/index.html`. Todos aceptan `?m=MERCHANT_ID`.

---

## 4. Componentes, Dependencias y Binding de Infraestructura

### 4.1 Stack técnico

- **Runtime:** Cloudflare Workers (Hono v4)
- **Lenguaje:** TypeScript (estricto, ES2022, módulos ESNext, `hono/jsx`)
- **Base de datos:** D1 (SQLite) — 17 tablas tras las 9 migraciones
- **Caché/KV:** Cloudflare KV (sesiones, catálogos, rate limiting, caché de merchants)
- **Object Storage:** R2 (`ark-cash-invoices`) — XML CFDI y backups D1
- **IA:** Workers AI (`@cf/meta/llama-3.1-8b-instruct`)
- **Pagos:** Pey CoDi API (OpenAPI v2026-10-20), Banxico CoDi/SPEI, Solana Pay (USDC/USDT SPL)
- **Email:** Resend (verificación, restablecimiento de contraseña)
- **Facturación:** Facturapi (PAC CFDI 4.0 SAT)
- **Frontend:** PWA (service worker `sw.js`, manifiesto), HTML/CSS/JS puro, Orbitron/Inter/Playfair, qrcode.js client-side, Web Audio API

### 4.2 Bindings de wrangler.toml

| Binding | Tipo | Nombre/ID | Uso |
|---|---|---|---|
| `DB` | D1 Database | `ark_caja_db` (`0d7fdfd5-...`) | Todas las tablas transaccionales |
| `KV` | KV Namespace | `2d95ac6f-...` | Sesiones, catálogos, rate limit, caché merchants |
| `R2` | R2 Bucket | `ark-cash-invoices` | XML de facturas, backups D1 |
| `AI` | Workers AI | — | Resúmenes de corte, claves SAT |
| `PEY_API_URL` | Var | `https://api.pey.mx` | Base URL Pey |
| `PEY_API_KEY` | Secreto | — | Autenticación Pey (requerido en prod) |
| `PEY_WEBHOOK_SECRET` | Secreto | — | HMAC de webhooks (requerido en prod) |
| `CAJA_STAYPUFT_API_KEY` | Secreto | — | Acceso al conector interno StayPuft |
| `AUTH_JWT_SECRET` (+ `_PREV`) | Secreto | — | Firma HS256 de JWT (rotación de secretos) |
| `RESEND_API_KEY` | Secreto | — | Envío de emails transaccionales |
| `FACTURAPI_API_KEY` | Secreto | — | Timbrado CFDI con Facturapi |

### 4.3 Scripts de package.json

| Script | Comando | Propósito |
|---|---|---|
| `dev` | `wrangler dev` | Servidor de desarrollo local (`http://localhost:8787`) |
| `typecheck` / `build` | `tsc --noEmit` | Verificación de tipos TypeScript |
| `test` | `vitest run` | Suite de pruebas (97 pruebas, 8 archivos) |
| `deploy` | `wrangler deploy` | Despliegue a Cloudflare Workers |
| `d1:local` | `wrangler d1 execute ... --local` | Ejecuta migraciones 0001–0006 en D1 local |
| `d1:remote` | `wrangler d1 execute ... --remote` | Ejecuta migraciones 0001–0006 en D1 remoto |

> Nota: las migraciones 0007 (webhook idempotencia), 0008 (SPEI fallback) y 0009 (dólares digitales / LFPIORPI) se aplican con el mismo patrón de `wrangler d1 execute` añadiendo el archivo correspondiente.

---

## 5. Flujo de Pagos Multi-Riel

La Caja opera con **rieles desacoplados**. Un pedido se procesa íntegramente por un único riel; nunca se dividen transacciones entre rieles.

1. **CoDi (MXN, Pey / Banxico):** mostrador ≤ $8,000 MXN. QR dinámico con monto bloqueado, timer 600s, polling cada 5s + webhook de confirmación. Liquidación en ~2s a CLABE.
2. **SPEI (MXN, transferencia tradicional):** montos > $8,000 MXN. Se exhibe CLABE 18 dígitos, banco, beneficiario, folio y referencia. Confirmación **100% manual** por el merchant (`confirm-spei`). Estado `PENDING_SPEI`; nunca se auto-confirma. Prohibición de "split payments".
3. **Solana Pay (USDC / USDT, red Solana):** wallet-to-wallet no-custodial. QR Solana Pay con referencia única de 32 bytes Base58, timer 600s, confirmación on-chain con monto exacto (de lo contrario `MANUAL_REVIEW`). Solo se activa si el merchant tiene `solana_wallet` configurada (`solana_pay_enabled = 1`). Off-ramp a MXN condicional a proveedor registrado (ITF / actividad vulnerable SAT).

**Monedas admitidas:** `MXN`, `USDC`, `USDT`.  
**Límite operativo CoDi:** `CODI_MAX_MXN = 8000` (definido en `src/types.ts:36`, aplicado en backend y frontend).

---

## 6. Compliance y Seguridad

- **Auth fail-closed:** si falta `AUTH_JWT_SECRET`, el worker responde 503. Scoping estricto por `merchant_id` en el JWT; cross-tenant → 403 y auditoría.
- **Cookies `__Host-`** (HttpOnly, Secure, SameSite=Strict), refresh tokens opacos hasheados (SHA-256) con rotación y detección de reutilización, lockout progresivo (5/10/15 fallos), rate limiting por IP/email (sliding window en KV), anti-enumeración.
- **MFA TOTP** (RFC 6238) opcional por usuario.
- **Webhooks:** HMAC-SHA256, ventana anti-replay de 300s, idempotencia con índice único en `webhook_events(idempotency_key)`, transición atómica `WHERE status != 'PAID'`, asiento contable condicionado a cambio real de estado.
- **CLABE/RFC enmascarados** en el conector StayPuft (solo últimos 4 dígitos CLABE, RFC parcial).
- **Paginación protegida:** default 20, tope 100; `limit > 100` → 400.
- **CSP / HSTS / X-Frame-Options / X-Content-Type-Options / Permissions-Policy** en producción.
- **LFPIORPI (Art. 17 Fracción XVI):** evaluador de actividades vulnerables con ventana móvil de 180 días, umbrales 210 UMA (aviso UIF) y 147 UMA (70%, identificación KYC), dictamen firmado con SHA-256 persistido inmutablemente.
- **Consentimiento versionado** obligatorio en registro (terms/privacy).
- **Derechos ARCO** (exportar, rectificar, cancelar, oponerse) con registro en `arco_requests`.
- **Purga programada** (handler `scheduled`): sesiones/tokens expirados, anonimización de cuentas desactivadas > 30 días, log en `purge_log`.
- **Backup semanal** D1 → R2 (JSON por tabla) vía handler scheduled y endpoint `/api/internal/backup/run`.
- **AML/PLD:** fuera de alcance v1; Pey es la puerta de CoDi ACTIVE. Rastro inmutable de pagos, webhooks y altas listo para futuro.

---

## 7. Estado de Implementación y Despliegue

| Área | Estado | Despliegue |
|---|---|---|
| Core CoDi (QR, PN, polling, webhooks, ledger) | Implementado y probado | Live en `https://caja.arksystems.site` (Fase B de Pey verificada) |
| Auth soberano + MFA + paginación + idempotencia (P0) | Implementado, 60/60 pruebas | Versión de producción `debaad77-8549-4ed5-9c1f-a948b8027806` (2026-11-08) |
| Storefront multi-riel (CoDi/SPEI/WhatsApp) | Implementado | Listo localmente |
| SPEI fallback (> $8,000 MXN) | Implementado, 13 pruebas | LOCAL LISTO — NO DESPLEGADO (espera autorización de Pablo) |
| Dólares digitales Solana + LFPIORPI | Implementado, 16 pruebas | LOCAL LISTO — NO DESPLEGADO (espera autorización de Pablo) |
| Facturación CFDI 4.0 (Facturapi + R2) | Implementado, 4 pruebas | Listo localmente |
| Workers AI (corte, clave SAT) | Implementado, 3 pruebas | Listo localmente (requiere binding AI) |
| Frontend PWA (caja, tienda, instructivo, landing) | Implementado | Sirve desde `/public` vía binding ASSETS |
| Tests Vitest | 97/97 pasando, 8 archivos | Verde |
| TypeScript typecheck | 0 errores | Verde |

**Secretos pendientes de registrar en Cloudflare (interactivo, por Pablo):** `CAJA_STAYPUFT_API_KEY`, `PEY_API_KEY`, `PEY_WEBHOOK_SECRET`, `AUTH_JWT_SECRET`, `RESEND_API_KEY`, `FACTURAPI_API_KEY`.

**Dominio de producción:** `caja.arksystems.site` (ruta canónica de webhook: `https://caja.arksystems.site/webhooks/pey`, soporte dual también en `/api/webhooks/pey`).

---

## 8. Comandos Operativos de Referencia

| Acción | Comando |
|---|---|
| Instalar dependencias | `npm install` |
| Iniciar servidor de desarrollo local | `npm run dev` |
| Inicializar D1 local (migraciones 0001–0006) | `npm run d1:local` |
| Aplicar migración adicional local | `wrangler d1 execute ark_caja_db --local --file=./migrations/NNNN_x.sql` |
| Verificar tipos TypeScript | `npm run typecheck` |
| Ejecutar suite de pruebas | `npm test` |
| Aplicar migraciones en Cloudflare remoto | `npm run d1:remote` |
| Desplegar Worker a producción | `npm run deploy` |
| Ver logs en tiempo real | `npx wrangler tail` |
| Crear D1 en producción | `npx wrangler d1 create ark_caja_db` |
| Crear KV en producción | `npx wrangler kv namespace create ark-caja-kv-cache` |
| Registrar secreto en producción | `npx wrangler secret put <NOMBRE>` |
| Consultar ledger en D1 local | `npx wrangler d1 execute ark_caja_db --local --command="SELECT * FROM ledger_entries"` |
| Consultar pagos en D1 local | `npx wrangler d1 execute ark_caja_db --local --command="SELECT id, amount, status FROM payments"` |
| Dry-run de despliegue | `npx wrangler deploy --dry-run` |
| Generar assets SVG (favicon, logo) | `python forge_pey.py` |

---

## 9. Archivos por categoría

**Fuente del Worker (`src/`):** `index.ts`, `types.ts`, `data/catalogs.ts`, `middleware/{auth,staypuftAuth}.ts`, `routes/{ai,auth,codi,compliance,internal,invoices,merchant,paymentLink,solana,webhooks}.ts`, `services/{aiClient,backup,facturapiClient,lfpiorpi,peyClient,resendClient}.ts`, `utils/{clabe,crypto,rateLimit,solana,totp,ulid}.ts`.

**Pruebas (`tests/`):** `ai.test.ts` (3), `auth.test.ts` (15), `internal.test.ts` (14), `invoices.test.ts` (4), `p0_auth_pagination_idempotency.test.ts` (18), `solana_lfpiorpi.test.ts` (16), `spei_fallback.test.ts` (13), `storefront.test.ts` (14) → **97 pruebas totales**.

**Configuración:** `package.json`, `tsconfig.json`, `wrangler.toml`, `.gitignore`.

**Base de datos:** `migrations/0001.sql`–`0009.sql`.

**Frontend/PWA (`public/`):** `index.html`, `caja.html`, `tienda.html`, `instructivo.html`, `landing.html`, `verify-email.html`, `reset-password.html`, `privacy.html`, `terms.html`, `sw.js`, `manifest.json` + assets SVG/PNG.

**Utilidades/scripts:** `forge_pey.py` (genera `public/favicon.svg` y `public/logo.svg`), `scripts/forge_ark_cash_register.py`.

**Documentación (`docs/`):** `ark-cash-register.md` (22 secciones), `map.md` (este documento), `auth-plan.md`, `compliance-plan.md`, `dr-plan.md`, `dpo.md`, `dpa-pey.md`, `dpa-facturapi.md`.
