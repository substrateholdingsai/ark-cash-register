# ðŸ—ºï¸ MAPA DEL PROYECTO â€” ARK CASH REGISTER (v2.0)

**Producto:** Ark-cajaregistradora (`pey-worker`)  
**Ecosistema:** ARK Systems (Substrate Holdings LLC)  
**IntegraciÃ³n Bancaria:** Pey CoDi API (OpenAPI v2026-10-20 / Banxico)  
**Infraestructura:** Cloudflare Workers + D1 Database + KV Cache + PWA  
**Ãšltima actualizaciÃ³n:** Noviembre 2026  

---

## 1. Esquema de Arquitectura del Proyecto

```
ark-cash-register/
â”œâ”€â”€ docs/
â”‚   â”œâ”€â”€ ark-cash-register.md     # Documento maestro (22 secciones de diseÃ±o y tÃ©cnica)
â”‚   â””â”€â”€ map.md                   # Este documento: mapa integral y checklist de pendientes
â”œâ”€â”€ migrations/
â”‚   â”œâ”€â”€ 0001_initial_schema.sql  # Esquema D1 SQLite: merchants, payments, ledger_entries, webhook_events
â”‚   â””â”€â”€ 0002_operator_audit_and_closes.sql # AuditorÃ­a operador (StayPuft) y tabla daily_closes
â”œâ”€â”€ public/                      # Assets servidos desde el Edge (PWA Frontend)
â”‚   â”œâ”€â”€ index.html               # UI autocontenida: Mostrador (A), QR CoDi (B), Link Remoto (C), Corte de DÃ­a
â”‚   â”œâ”€â”€ sw.js                    # Service Worker para cachÃ© offline
â”‚   â”œâ”€â”€ favicon.svg              # Ãcono oficial de la caja registradora
â”‚   â””â”€â”€ logo.svg                 # Branding institucional ARK Caja Registradora
â”œâ”€â”€ src/                         # CÃ³digo fuente del Cloudflare Worker (TypeScript)
â”‚   â”œâ”€â”€ index.ts                 # Router principal Hono, CORS, logger, healthcheck y dispatch
â”‚   â”œâ”€â”€ types.ts                 # Tipos TypeScript sincronizados con OpenAPI Pey v2026-10-20
â”‚   â”œâ”€â”€ middleware/
â”‚   â”‚   â””â”€â”€ staypuftAuth.ts      # Auth fail-closed con X-StayPuft-Key y log inmutable en operator_audit_log
â”‚   â”œâ”€â”€ routes/
â”‚   â”‚   â”œâ”€â”€ codi.ts              # Endpoints CoDi QR (/api/codi/qr) y Push Notification (/api/codi/pn)
â”‚   â”‚   â”œâ”€â”€ paymentLink.ts       # Endpoints Cobro Remoto (/api/payment-link)
â”‚   â”‚   â”œâ”€â”€ merchant.ts          # Registro de CLABE, status Banxico, lista de pagos y corte de caja
â”‚   â”‚   â”œâ”€â”€ webhooks.ts          # Receptor /webhooks/pey con validaciÃ³n HMAC-SHA256 y anti-replay
â”‚   â”‚   â””â”€â”€ internal.ts          # Conector Interno StayPuft (/api/internal/*) solo lectura y diagnÃ³stico
â”‚   â”œâ”€â”€ services/
â”‚   â”‚   â””â”€â”€ peyClient.ts         # Cliente HTTP tipado contra api.pey.mx con retry exponencial y mock local
â”‚   â””â”€â”€ utils/
â”‚       â””â”€â”€ ulid.ts              # Generador ULID criptogrÃ¡fico Crockford Base32
â”œâ”€â”€ tests/
â”‚   â””â”€â”€ internal.test.ts         # Suite de pruebas unitarias Vitest (Auth, Cuotas, Enmascaramiento, HMAC)
â”œâ”€â”€ forge_pey.py                 # Generador Python de assets SVG institucionales
â”œâ”€â”€ package.json                 # ConfiguraciÃ³n de dependencias (Hono, Wrangler, TypeScript)
â”œâ”€â”€ tsconfig.json                # ConfiguraciÃ³n de compilaciÃ³n TS para Worker runtime
â””â”€â”€ wrangler.toml                # ConfiguraciÃ³n de Cloudflare Workers, bindings D1, KV y variables
```

---

## 2. Mapa de IntegraciÃ³n y Flujo de Datos

```mermaid
flowchart TD
    subgraph FRONTEND["Frontend PWA (Edge Assets)"]
        UI_A["Pantalla A: El Mostrador\n(Lista de hoy, Cobrar aquÃ­, Cobrar a distancia)"]
        UI_B["Pantalla B: Cobrar aquÃ­\n(Teclado Orbitron 72px + QR client-side qrcode.js)"]
        UI_C["Pantalla C: Cobro a distancia\n(Link remoto + Copiar + WhatsApp)"]
        UI_CUT["Modal: Corte del DÃ­a\n(Playfair 900 ceremonial)"]
    end

    subgraph WORKER["Cloudflare Worker (pey-worker)"]
        ROUTER["Router Hono (src/index.ts)"]
        CODI_API["Ruta CoDi (/api/codi/qr)"]
        LINK_API["Ruta Link (/api/payment-link)"]
        POLL_API["Polling (/api/payment/:id)"]
        WH_API["Webhooks (/webhooks/pey)"]
        CLIENT["PeyClient (Retry + SanitizaciÃ³n)"]
    end

    subgraph STORAGE["Cloudflare Storage"]
        D1_DB[("D1 SQLite (ark_caja_db)\n- merchants\n- payments\n- ledger_entries\n- webhook_events")]
        KV_CACHE[("KV Namespace\n- Sesiones\n- Rate limiting")]
    end

    subgraph PEY["Pey API & Banxico"]
        PEY_CODI["api.pey.mx/codi/qr (IDC Banxico)"]
        PEY_LINK["api.pey.mx/payment-link/create"]
        PEY_WH["Disparador de Webhooks (payment.confirmed)"]
    end

    subgraph ARK_ECOSYSTEM["Ecosistema ARK (Compliance)"]
        ARK_LEDGER["ARK Ledger\n(PÃ³lizas contables en ledger_entries)"]
        ARK_CONTAGRAM["Contagram\n(CFDI Global al corte del dÃ­a)"]
        ARK_ARKANGEL["Arkangel\n(GestiÃ³n de cobranza)"]
    end

    UI_B -->|1. POST /api/codi/qr| CODI_API
    CODI_API -->|2. POST /codi/qr| PEY_CODI
    PEY_CODI -->|3. IDC + qrString| CLIENT
    CODI_API -->|4. Almacena WAITING| D1_DB
    CODI_API -->|5. Retorna qrString| UI_B
    UI_B -->|6. Polling 5s| POLL_API

    UI_C -->|POST /api/payment-link| LINK_API
    LINK_API -->|POST /payment-link/create| PEY_LINK

    PEY_WH -->|POST /webhooks/pey| WH_API
    WH_API -->|Valida HMAC + Anti-replay| WH_API
    WH_API -->|Actualiza PAID| D1_DB
    WH_API -->|Genera Asiento Contable| ARK_LEDGER

    POLL_API -->|Detecta PAID| UI_B
    POLL_API -->|Detecta PAID| UI_C
    UI_B -->|Chime Web Audio + Haptic| UI_B
    UI_CUT -->|Resumen de ventas| ARK_CONTAGRAM
```

---

## 3. Matriz de Endpoints y Mapeo Pey

| Endpoint Worker | MÃ©todo | Destino Pey | PropÃ³sito | Estado |
|---|---|---|---|:---:|
| `/api/health` | `GET` | Local / Worker | DiagnÃ³stico de bindings D1 y KV | âœ… Listo |
| `/api/codi/qr` | `POST` | `/codi/qr` | Genera QR CoDi con `generateImage: false` | âœ… Listo |
| `/api/codi/pn` | `POST` | `/codi/pn` | EnvÃ­a Push Notification a celular (10 dÃ­gitos) | âœ… Listo |
| `/api/payment/codi/:id` | `GET` | `/transaction/codi/qr/:id` | Polling dual de estado de QR | âœ… Listo |
| `/api/payment-link` | `POST` | `/payment-link/create` | Crea enlace para cobro remoto | âœ… Listo |
| `/api/payment/link/:id` | `GET` | `/payment-link/:id` | Polling de estado de enlace remoto | âœ… Listo |
| `/api/merchant/register` | `POST` | `/bank-account` | Onboarding de cuenta CLABE (Banxico) | âœ… Listo |
| `/api/merchant/:id` | `GET` | `/bank-account/:id` | Consulta estado CoDi (`PENDING` / `ACTIVE`) | âœ… Listo |
| `/api/merchant/:id/payments` | `GET` | D1 Local | Historial de pagos para el mostrador | âœ… Listo |
| `/api/merchant/:id/close-day` | `POST` | D1 Local | Corte de caja ceremonial del turno | âœ… Listo |
| `/webhooks/pey` | `POST` | Webhook Receptor | Ingesta de `payment.confirmed` con HMAC | âœ… Listo |

---

## 4. Checklist de lo Construido (Estado Actual)

- [x] **Documento enriquecido oficial:** `docs/ark-cash-register.md` con las 22 secciones.
- [x] **Proyecto Wrangler inicializado:** `wrangler.toml`, `package.json`, `tsconfig.json`.
- [x] **Esquema de base de datos D1:** MigraciÃ³n `0001_initial_schema.sql` ejecutada localmente con tablas `merchants`, `payments`, `ledger_entries` y `webhook_events`.
- [x] **Cliente Pey HTTP tipado:** `PeyClient` con soporte completo OpenAPI v2026-10-20, retry con backoff exponencial, sanitizaciÃ³n de metadata y simulador de desarrollo local.
- [x] **Controladores del Worker:**
  - [x] Endpoints CoDi QR con almacenamiento local de IDCs y folios.
  - [x] Endpoints de Payment Links remotos.
  - [x] Receptor de webhooks con verificaciÃ³n de firma HMAC-SHA256 (`crypto.subtle`) y anti-replay.
  - [x] IntegraciÃ³n con Ledger contable automÃ¡tico al confirmar pago.
- [x] **Frontend PWA de Mostrador:**
  - [x] Cumplimiento estricto de paleta (`--navy`, `--gold`, `--paid`, `--waiting`, `--expired`).
  - [x] TipografÃ­a `Orbitron 700` para montos, `Inter` para texto, `Playfair Display 900` para corte del dÃ­a.
  - [x] Teclado numÃ©rico tÃ¡ctil de 72px de altura mÃ­nima.
  - [x] Renderizado de QR client-side con `qrcode.js` desde `qrString`.
  - [x] Countdown timer de 600 segundos con spinner Ã¡mbar.
  - [x] Feedback sonoro (Web Audio API synth) y hÃ¡ptico (`navigator.vibrate`).
  - [x] Botones de "Copiar link" y "Compartir por WhatsApp" en cobro a distancia.
  - [x] Modal de corte del dÃ­a.
  - [x] Service worker `public/sw.js` para caching estÃ¡tico.
- [x] **Assets visuales:** `public/favicon.svg` y `public/logo.svg` creados con `forge_pey.py`.

---

## 5. Checklist de Faltantes y Siguientes Pasos (Roadmap)

### Fase A â€” Despliegue y ConexiÃ³n Cloudflare (Inmediato)
- [ ] **Crear base de datos D1 en Cloudflare ProducciÃ³n:**
  - Comando: `npx wrangler d1 create ark_caja_db`
  - Vincular el `database_id` real generado en `wrangler.toml`.
- [ ] **Crear KV Namespace en Cloudflare ProducciÃ³n:**
  - Comando: `npx wrangler kv namespace create ark-caja-kv-cache`
  - Vincular el `id` en `wrangler.toml`.
- [ ] **Aplicar migraciones D1 en producciÃ³n:**
  - Comando: `npm run d1:remote`
- [ ] **Configurar Secretos de ProducciÃ³n en Cloudflare:**
  - `npx wrangler secret put PEY_API_KEY` (Key real proporcionada por Pey)
  - `npx wrangler secret put PEY_WEBHOOK_SECRET` (Secreto HMAC configurado en el dashboard de Pey)
- [ ] **Despliegue inicial a Cloudflare:**
  - Comando: `npm run deploy`
  - Configurar dominio personalizado (ej. `caja.arksystems.site` o `caja.arkangel.mx`).

---

### Fase B â€” CertificaciÃ³n y Pruebas Reales con Pey (24 - 48h)
- [ ] **Configurar URL de Webhook en Dashboard de Pey:**
  - Apuntar a `https://<tu-worker>.workers.dev/webhooks/pey`
  - Seleccionar eventos: `payment.confirmed` y `bank-account.updated`.
- [ ] **Prueba de cobro real de micro-monto en producciÃ³n ($0.01 o $1.00 MXN):**
  - Abrir la caja desde un telÃ©fono mÃ³vil.
  - Generar QR por $1.00 MXN.
  - Escanear con una app bancaria mexicana real (BBVA, Banorte, Santander, Hey Banco, Mercado Pago, etc.) vÃ­a secciÃ³n CoDi.
  - Validar recepciÃ³n del webhook y disparo inmediato de pantalla "Â¡Pagado!" + chime sonoro.
- [ ] **Prueba de cobro a distancia por WhatsApp:**
  - Generar link remoto por $1.00 MXN.
  - Pagar mediante tarjeta o CoDi en el checkout oficial de Pey.
  - Validar que el polling detecte la acreditaciÃ³n.

---

### Fase C â€” Resiliencia Offline Completa (Frontend)
- [ ] **ImplementaciÃ³n de IndexedDB en cliente (`public/index.html`):**
  - Crear almacÃ©n `offline_sales_queue` en IndexedDB para registrar ventas cuando `navigator.onLine === false`.
  - Mecanismo de sincronizaciÃ³n automÃ¡tica en evento `window.addEventListener('online', syncQueue)`.
  - Badge visual dinÃ¡mico en el header: alternar entre `ðŸŸ¢ CoDi activo` y `ðŸŸ¡ Modo Offline (Ventas en cola)`.

---

### Fase D â€” Onboarding y OperaciÃ³n de Comercios
- [ ] **Pantalla o Modal de Onboarding de Comercio:**
  - Formulario en UI para que un nuevo comerciante ingrese:
    - RazÃ³n Social / Nombre legal
    - RFC con homoclave
    - CLABE interbancaria (18 dÃ­gitos)
    - Tipo de persona (FÃ­sica / Moral)
  - EnvÃ­o a `POST /api/merchant/register` y visualizaciÃ³n de estatus (`PENDING` âž” `ACTIVE`).
- [ ] **ExportaciÃ³n o Ticket del Corte de Caja:**
  - BotÃ³n para compartir resumen del corte del dÃ­a por WhatsApp al dueÃ±o del negocio.
  - OpciÃ³n de impresiÃ³n tÃ©rmica (formato ESC/POS o PDF de recibo de 58mm/80mm).

---

### Fase E â€” IntegraciÃ³n Profunda con Ecosistema ARK
- [ ] **SincronizaciÃ³n con ARK Ledger:**
  - Enviar asiento contable mediante webhook/API interna a la contabilidad general de Ledger.
- [ ] **SincronizaciÃ³n con Contagram (CFDI):**
  - Generar factura global del dÃ­a ante el SAT a partir del endpoint `/api/merchant/:id/close-day`.
- [ ] **SincronizaciÃ³n con Arkangel:**
  - Si el pago incluye metadata `deudorId`, liquidar automÃ¡ticamente la deuda en Arkangel Cobranza.

---

## 6. Comandos Operativos de Referencia

| AcciÃ³n | Comando |
|---|---|
| **Iniciar servidor de desarrollo local** | `npm run dev` |
| **Ejecutar migraciones en BD local D1** | `npm run d1:local` |
| **Verificar tipos TypeScript** | `npm run build` |
| **Ejecutar migraciones en Cloudflare remoto** | `npm run d1:remote` |
| **Desplegar Worker a producciÃ³n** | `npm run deploy` |
| **Ver logs en tiempo real de producciÃ³n** | `npx wrangler tail` |
| **Consultar registros de Ledger en D1 local** | `npx wrangler d1 execute ark_caja_db --local --command="SELECT * FROM ledger_entries"` |
| **Consultar pagos registrados en D1 local** | `npx wrangler d1 execute ark_caja_db --local --command="SELECT id, amount, status FROM payments"` |
| **Correr suite de tests Vitest** | `npm test` |

---

## 7. Operador StayPuft (Conector Interno de DiagnÃ³stico y Lectura)

### 7.1. PropÃ³sito y LÃ­mites Operativos
El conector `/api/internal/*` permite a StayPuft inspeccionar y diagnosticar la salud operativa de **Ark Cash Register** en vivo.
- **Solo lectura (`GET` exclusivamente):** No crea cobros, no registra CLABEs, no mueve dinero y no altera estados de pagos.
- **Fail-Closed:** Protegido por el header `X-StayPuft-Key`. Si la clave es errÃ³nea o estÃ¡ ausente, responde `401 Unauthorized`.
- **Enmascaramiento de Datos Sensibles:** La CLABE interbancaria nunca se expone completa (solo los Ãºltimos 4 dÃ­gitos: `**************5678`). El RFC se enmascara parcialmente.
- **Secretos Protegidos:** `PEY_API_KEY`, `PEY_WEBHOOK_SECRET` y `CAJA_STAYPUFT_API_KEY` jamÃ¡s se devuelven en respuestas ni se escriben en logs.
- **ProtecciÃ³n de Cuotas D1:** PaginaciÃ³n obligatoria (mÃ¡ximo 100 registros por llamada, default 20). Si se solicita `limit > 100`, se rechaza con `400 Bad Request`.
- **AuditorÃ­a Inmutable:** Cada llamada al conector queda asentada en la tabla `operator_audit_log` con endpoint, mÃ©todo, duraciÃ³n y cÃ³digo HTTP.

---

### 7.2. Endpoints Internos y Ejemplos curl

Para todas las llamadas, define la variable de entorno:
```bash
export CAJA_STAYPUFT_API_KEY="tu_llave_interna_registrada_en_wrangler"
export CAJA_HOST="http://127.0.0.1:8787" # O host de producciÃ³n una vez desplegado
```

#### 1. Salud del Worker y alcanzabilidad Pey
```bash
curl -X GET "$CAJA_HOST/api/internal/status" \
  -H "X-StayPuft-Key: $CAJA_STAYPUFT_API_KEY"
```
**Respuesta esperada:**
```json
{
  "service": "ark-cash-register",
  "workerVersion": "2.0.0",
  "environment": "development",
  "timestamp": "2026-11-07T21:20:00.000Z",
  "bindings": {
    "d1Database": true,
    "kvCache": true
  },
  "metricsSummary": {
    "registeredMerchants": 1,
    "lastWebhook": { "eventType": "payment.confirmed", "receivedAt": 1731000200 },
    "lastPaymentConfirmed": { "paymentId": "PAY_001", "amount": 150, "datePaid": 1731000200 }
  },
  "peyApiReachability": {
    "url": "https://api.pey.mx",
    "reachable": true,
    "status": "HTTP 200"
  }
}
```

#### 2. Lista de Comercios (Paginada)
```bash
curl -X GET "$CAJA_HOST/api/internal/merchants?limit=20&offset=0" \
  -H "X-StayPuft-Key: $CAJA_STAYPUFT_API_KEY"
```
**Respuesta:**
```json
{
  "total": 1,
  "limit": 20,
  "offset": 0,
  "merchants": [
    {
      "id": "01JBAVWE4NS5TGXHWGMX3KH23Q",
      "alias": "TaquerÃ­a El GÃ¼ero",
      "name": "TaquerÃ­a El GÃ¼ero S.A. de C.V.",
      "maskedClabe": "**************7899",
      "entity": "BUSINESS",
      "maskedTaxId": "XAX****000",
      "codiStatus": "ACTIVE",
      "createdAt": 1731000000,
      "updatedAt": 1731000000
    }
  ]
}
```

#### 3. Detalle de Comercio Individual
```bash
curl -X GET "$CAJA_HOST/api/internal/merchants/01JBAVWE4NS5TGXHWGMX3KH23Q" \
  -H "X-StayPuft-Key: $CAJA_STAYPUFT_API_KEY"
```
*(Si no existe, devuelve 404)*

#### 4. Lista de Pagos (Filtros por merchant y status)
```bash
curl -X GET "$CAJA_HOST/api/internal/payments?merchant_id=01JBAVWE4NS5TGXHWGMX3KH23Q&status=PAID&limit=20" \
  -H "X-StayPuft-Key: $CAJA_STAYPUFT_API_KEY"
```
*Nota: No devuelve `qrString` para evitar congestiÃ³n de payload.*

#### 5. Detalle de Pago y Webhooks Relacionados
```bash
curl -X GET "$CAJA_HOST/api/internal/payments/PAY_001" \
  -H "X-StayPuft-Key: $CAJA_STAYPUFT_API_KEY"
```

#### 6. Asientos Contables de ARK Ledger
```bash
curl -X GET "$CAJA_HOST/api/internal/ledger?merchant_id=01JBAVWE4NS5TGXHWGMX3KH23Q&limit=20" \
  -H "X-StayPuft-Key: $CAJA_STAYPUFT_API_KEY"
```

#### 7. Registro de Webhooks de Pey (AuditorÃ­a)
```bash
curl -X GET "$CAJA_HOST/api/internal/webhooks?status=ok&limit=20" \
  -H "X-StayPuft-Key: $CAJA_STAYPUFT_API_KEY"
```

#### 8. Historial de Cortes de Caja
```bash
curl -X GET "$CAJA_HOST/api/internal/close-days?merchant_id=01JBAVWE4NS5TGXHWGMX3KH23Q&limit=20" \
  -H "X-StayPuft-Key: $CAJA_STAYPUFT_API_KEY"
```

#### 9. MÃ©tricas Globales del Operador
```bash
curl -X GET "$CAJA_HOST/api/internal/metrics" \
  -H "X-StayPuft-Key: $CAJA_STAYPUFT_API_KEY"
```

---

### 7.3. CÃ³mo Probar el Flujo Completo con un Pago de Prueba en Local

1. **Asegurar la base de datos D1 local migrada:**
   ```bash
   npm run d1:local
   ```
2. **Arrancar el worker localmente con la clave interna configurada:**
   ```bash
   npx wrangler dev --port 8787 --var CAJA_STAYPUFT_API_KEY:test_staypuft_key_caja_12345
   ```
3. **Generar un cobro QR desde el endpoint pÃºblico:**
   ```bash
   curl -X POST http://127.0.0.1:8787/api/codi/qr \
     -H "Content-Type: application/json" \
     -d '{"amount": 150.00, "concept": "Prueba StayPuft", "merchantId": "01JBAVWE4NS5TGXHWGMX3KH23Q"}'
   ```
   *Guarda el `qrId` devuelto (ej. `IDC01M6VX2Y6B`).*

4. **Verificar que StayPuft ve el pago en espera:**
   ```bash
   curl -X GET "http://127.0.0.1:8787/api/internal/payments?status=WAITING" \
     -H "X-StayPuft-Key: test_staypuft_key_caja_12345"
   ```

5. **Simular confirmaciÃ³n vÃ­a Webhook:**
   ```bash
   curl -X POST http://127.0.0.1:8787/webhooks/pey \
     -H "Content-Type: application/json" \
     -d '{"event":"payment.confirmed","transactionId":"TXN_STAYPUFT_001","amount":150.00,"payableId":"IDC01M6VX2Y6B"}'
   ```

6. **Verificar que StayPuft ve el pago acreditado y el asiento contable:**
   ```bash
   # Ver estado pagado
   curl -X GET "http://127.0.0.1:8787/api/internal/payments?status=PAID" \
     -H "X-StayPuft-Key: test_staypuft_key_caja_12345"

   # Ver pÃ³liza en ARK Ledger
   curl -X GET "http://127.0.0.1:8787/api/internal/ledger" \
     -H "X-StayPuft-Key: test_staypuft_key_caja_12345"
   ```

7. **Â¿QuÃ© hacer si falla?**
   - **Error 401:** Verifica que el header `X-StayPuft-Key` coincida exactamente con la variable `CAJA_STAYPUFT_API_KEY`.
   - **Error 404 al consultar un merchant:** El ID solicitado no existe en la tabla `merchants`.
   - **Error 400 en paginaciÃ³n:** El parÃ¡metro `limit` excede el tope de 100.
   - **Consulta la tabla de auditorÃ­a:**
     `npx wrangler d1 execute ark_caja_db --local --command="SELECT * FROM operator_audit_log ORDER BY created_at DESC LIMIT 5"`

---

### 7.4. Estado de Bloqueos para VerificaciÃ³n en Vivo

| Fase | Tarea | Estado Actual | Â¿Bloquea al Conector en Vivo? |
|---|---|:---:|:---:|
| **Fase A** | Crear D1 `ark_caja_db` en Cloudflare ProducciÃ³n | âœ… Completada (`0d7fdfd5-8544-401b-9f28-2df47c91dd06`) | No |
| **Fase A** | Crear KV `ark-caja-kv-cache` en Cloudflare ProducciÃ³n | âœ… Completada (`2d95ac6f8ad94667a59d32dcbd5cae41`) | No |
| **Fase A** | Aplicar migraciones en remoto D1 (`0001` y `0002`) | âœ… Completada (6 tablas creadas) | No |
| **Fase A** | Desplegar Worker y vincular `caja.arksystems.site` | âœ… Completada (En vivo y verificado) | No |
| **Fase A** | Registrar secret `CAJA_STAYPUFT_API_KEY` en Cloudflare | â³ Pendiente (registro interactivo por Pablo) | Requiere valor seguro |
| **Fase A** | Registrar secrets `PEY_API_KEY` y `PEY_WEBHOOK_SECRET` | â³ Pendiente (registro interactivo por Pablo) | Para cobros reales |
| **Fase B** | Pruebas reales de $1.00 MXN con app bancaria | â³ Pendiente (operado solo por Pablo) | No para diagnÃ³stico de lectura |
| **Fase C** | IndexedDB Offline en frontend | â³ Pendiente | No para el conector |
| **Fase D** | UI Onboarding y recibos tÃ©rmicos | â³ Pendiente | No para el conector |
| **Fase E** | Enlace webhook a Contagram / Arkangel | â³ Pendiente | No para el conector |



---

## 8. Auth Soberano (Implementado)

### 8.1. Archivos nuevos
- migrations/0003_auth.sql — tablas users, uth_sessions, email_verification_tokens, password_reset_tokens, uth_rate_limits, uth_audit_log.
- src/utils/crypto.ts — PBKDF2 (100k iter), JWT HS256, tokens opacos, comparación constante, rotación de secretos.
- src/utils/rateLimit.ts — sliding window en KV.
- src/services/resendClient.ts — cliente REST Resend + plantillas de email (verificación y reset).
- src/middleware/auth.ts — 
equireAuth, 
equireRole, optionalAuth.
- src/routes/auth.ts — router /api/auth/*.
- 	ests/auth.test.ts — suite Vitest (25 tests).
- public/verify-email.html, public/reset-password.html.

### 8.2. Endpoints
| Método | Ruta | Descripción |
|---|---|---|
| POST | /api/auth/register | Registro (pending + email verificación) |
| GET | /api/auth/verify-email?token= | Verifica cuenta |
| POST | /api/auth/resend-verification | Reenvío de verificación |
| POST | /api/auth/login | Login (access JWT + refresh cookie) |
| POST | /api/auth/refresh | Rotación de refresh token |
| POST | /api/auth/logout | Revoca sesión actual |
| POST | /api/auth/logout-all | Revoca todas las sesiones |
| POST | /api/auth/forgot-password | Solicitud de reset (respuesta genérica) |
| POST | /api/auth/reset-password | Aplica nuevo password |
| GET | /api/auth/me | Perfil autenticado |
| PUT | /api/auth/me | Actualiza perfil / password |
| GET | /api/auth/sessions | Sesiones activas |
| DELETE | /api/auth/sessions/:id | Revoca sesión |

### 8.3. Variables y secretos
- Vars: APP_BASE_URL, RESEND_FROM_EMAIL, AUTH_MODE, PASSWORD_MIN_LENGTH.
- Secrets: AUTH_JWT_SECRET, RESEND_API_KEY.

### 8.4. Seguridad
PBKDF2, JWT HS256 firmado con Web Crypto, refresh tokens opacos hasheados (SHA-256) con rotación y detección de reutilización, lockout progresivo, rate limiting por IP/email, anti-enumeración, cookies __Host- (HttpOnly/Secure/SameSite=Strict), auditoría en uth_audit_log.

### 8.5. Tests

pm run typecheck y 
pm test (25 tests) pasan.
---

## 9. Compliance P0 (Implementado)

### Archivos nuevos
- migrations/0004_compliance.sql — consent_records, arco_requests, privacy/terms versions, retention policies, purge_log.
- migrations/0005_mfa.sql — user_mfa.
- src/routes/compliance.ts — /api/legal/versions, /api/privacy/*, /api/internal/privacy-requests.
- src/utils/totp.ts — TOTP RFC 6238 soberano.

### Endpoints compliance
- GET /api/legal/versions
- POST /api/privacy/export|rectify|cancel|oppose
- GET /api/privacy/requests
- POST /api/auth/mfa/setup|verify|disable (MFA TOTP)
- Login acepta mfaCode.

### Seguridad
- CSP, X-Frame-Options, Permissions-Policy, HSTS (prod).
- Binding de sesión por User-Agent.
- Purga programada (scheduled) de sesiones/tokens/cuentas desactivadas.
- Consentimiento versionado obligatorio en registro.

### Tests
50 tests pasando al 100%, typecheck OK.

---

## 10. P1 Facturación CFDI (Facturapi) — Implementado

### Archivos
- migrations/0006_invoices.sql — fiscal_profiles, invoices.
- src/services/facturapiClient.ts — cliente REST Facturapi (create/get/cancel/download XML).
- src/routes/invoices.ts — /api/fiscal/profile, /api/invoice/issue|cancel|:id|:id/xml.

### Almacenamiento
- XML en R2 (binding R2, bucket rk-cash-invoices), metadata en D1.

### Env
- Vars: FACTURAPI_BASE_URL.
- Secret: FACTURAPI_API_KEY.

### Tests
Typecheck OK, 29 tests pasan.


---

## 11. AML/PLD — Fuera de alcance v1 (decision)

- La verificacion de identidad y de cuenta la realiza **Pey** (CoDi ACTIVE como puerta de cobro).
- Solo comercios con CoDi ACTIVE pueden cobrar (gate operativo).
- Rastro listo para futuro: log inmutable de pagos, webhooks y altas, retencion de datos.
- Anomalias se marcan para revision humana; no se bloquea automaticamente.
- AML/PLD (KYC, monitoreo, ROS) queda fuera de alcance v1; se retomara cuando aplique.

## 12. Operativo — Cerrado

- Backups D1 a R2 (snapshot JSON) + endpoint /api/internal/backup/run.
- Plan de DR: docs/dr-plan.md.
- DPO designado: docs/dpo.md.
- DPAs: docs/dpa-pey.md, docs/dpa-facturapi.md.
- R2 binding para facturas y backups.

## 13. Documentos legales/compliance

- docs/compliance-plan.md
- docs/dr-plan.md
- docs/dpo.md
- docs/dpa-pey.md
- docs/dpa-facturapi.md


---

## 14. Implementacion actual — resumen completo

### Archivos fuente nuevos
- src/utils/crypto.ts (PBKDF2, JWT HS256, tokens, timing-safe)
- src/utils/rateLimit.ts (sliding window KV)
- src/utils/totp.ts (TOTP RFC 6238)
- src/services/resendClient.ts (email transaccional)
- src/services/facturapiClient.ts (CFDI)
- src/services/backup.ts (snapshot D1 -> R2)
- src/middleware/auth.ts (requireAuth, requireRole, optionalAuth)
- src/routes/auth.ts (/api/auth/*)
- src/routes/compliance.ts (/api/legal/*, /api/privacy/*, backups)
- src/routes/invoices.ts (/api/fiscal/*, /api/invoice/*)

### Migraciones
- 0003_auth.sql
- 0004_compliance.sql
- 0005_mfa.sql
- 0006_invoices.sql

### Endpoints totales agregados
Auth: register, verify-email, resend-verification, login, refresh, logout, logout-all, forgot-password, reset-password, me (GET/PUT), sessions (GET/DELETE), mfa (setup/verify/disable).
Compliance: legal/versions, privacy/export, rectify, cancel, oppose, requests, internal/privacy-requests, internal/backup/run.
Invoices: fiscal/profile (GET/POST), invoice/issue, cancel, :id, list, :id/xml.

### Variables/secrets
Vars: APP_BASE_URL, RESEND_FROM_EMAIL, AUTH_MODE, PASSWORD_MIN_LENGTH, PRIVACY_NOTICE_VERSION, TERMS_VERSION, FACTURAPI_BASE_URL.
Secrets: AUTH_JWT_SECRET, RESEND_API_KEY, FACTURAPI_API_KEY (+ existentes Pey/StayPuft).

### Bindings
D1 (DB), KV, R2 (facturas/backups).

### Frontend
public/verify-email.html, reset-password.html, terms.html, privacy.html; enlaces discretos en footer de index.html y landing.html.

### Tests
50 tests (Vitest) + typecheck (tsc --noEmit) OK (100% pasando: 14 internal, 15 auth, 3 ai, 18 P0 comercial).

### Docs
docs/auth-plan.md, docs/compliance-plan.md, docs/dr-plan.md, docs/dpo.md, docs/dpa-pey.md, docs/dpa-facturapi.md.


---

## 15. P0 Comercial — Auth Fail-Closed, Scoping Multi-Tenant, Paginación e Idempotencia (Producción)

**Fecha de Despliegue:** 2026-11-08  
**Aprobación:** Pablo y StayPuft  
**Version ID en Producción:** `debaad77-8549-4ed5-9c1f-a948b8027806`  
**Endpoint Principal:** `https://caja.arksystems.site`  
**Ruta Canónica de Webhook:** `https://caja.arksystems.site/webhooks/pey` (soporte dual también en `/api/webhooks/pey`)  

### 15.1. Componentes P0 Implementados
1. **AUTH_JWT_SECRET Soberano & Fail-Closed:**
   - Inyectado en Cloudflare Workers Secrets (`wrangler secret put AUTH_JWT_SECRET`).
   - Sin defaults ni fallbacks: si falta el secreto, el worker responde `503 Service Unavailable`.
   - Firma criptográfica HS256 verificada con Web Crypto; rechazo de `alg: none` o tokens sin firma.
   - Scoping estricto: el token JWT transporta `merchant_id`. Intentos cross-tenant devuelven `403 Forbidden` y se auditan en `operator_audit_log` sin exponer tokens ni secretos.

2. **Paginación Segura en `/api/merchant/:id/payments`:**
   - Protegida con `requireMerchantAuth`.
   - Default: 20 registros; tope máximo: 100 registros.
   - Peticiones con `limit > 100` devuelven `400 Bad Request`.
   - Metadata: `{ items, total, limit, offset, hasMore, nextOffset }`.
   - Ahorro de ancho de banda: `qr_string` omitido de las listas.

3. **Idempotencia y Resiliencia en Webhooks (`POST /webhooks/pey`):**
   - Validación HMAC-SHA256 y ventana anti-replay de 300 segundos.
   - Migración `migrations/0007_webhook_idempotency.sql` aplicada en D1 remoto (`ark_caja_db`).
   - Índice único `idx_webhook_events_idempotency` en `webhook_events(idempotency_key)`.
   - Clave canónica: `payment.confirmed:<transactionId || payableId>` y `bank-account.updated:<bankAccountId>:<status>`.
   - Transición atómica `UPDATE payments ... WHERE status != 'PAID'`.
   - Asiento contable único en `ledger_entries` condicionado a cambio real de estado.
   - Tolerancia a duplicados (HTTP 200 `{ received: true, duplicate: true }`) y reintentos automáticos con HTTP 500 ante fallas transitorias de base de datos.

### 15.2. Verificación y Auditoría en Vivo
- **Suite de Pruebas:** 60/60 tests pasando al 100% (`internal.test.ts` 14, `auth.test.ts` 15, `ai.test.ts` 3, `p0_auth_pagination_idempotency.test.ts` 18).
- **TypeScript:** `tsc --noEmit` con 0 errores.
- **Diagnóstico en Vivo (`https://caja.arksystems.site/api/health`):**
  - `status: "ok"`
  - `d1: true`
  - `kv: true`
  - `peyApiConfigured: true`
  - `authConfigured: true`
  - `aiConfigured: true`


---

## 16. Storefront del Cliente — Catálogo Dinámico, Carrito y Checkout CoDi/WhatsApp

**Fecha:** 2026-11-08  
**Aprobación:** Pablo y StayPuft  
**Ruta:** `/tienda` (acepta `?m=MERCHANT_ID` y alias `?m=taqueria` / `?m=skinlab`)  
**Archivos:** `public/tienda.html`, `src/data/catalogs.ts`, `tests/storefront.test.ts`  

### 16.1. Funcionalidades Entregadas
1. **Catálogo Aislado y Dinámico:**
   - Consumo vía API en `/api/merchant/:id/catalog` (sin hardcodear en HTML).
   - Aislamiento estricto por `merchant_id`: Taquería El Güero (`01JBAVWE4NS5TGXHWGMX3KH23Q`) y SkinLab Clothing (`01JBAVSKINLAB0000000000000`).
   - Carrito aislado en `localStorage` (`ark_cart_${merchantId}`).
2. **Checkout CoDi® Banxico Dinámico:**
   - QR negro puro sobre blanco (`#000000` sobre `#ffffff`), nivel de corrección H (`QRCode.CorrectLevel.H`) y zona tranquila de 18px.
   - Temporizador de 10 minutos (600s) sincronizado con el parámetro `expiration: 600` de Banxico.
   - Polling de estado contra `/api/payment/codi/status/:id` protegido por identificador ULID de alta entropía.
   - Estados visuales: Cargando QR, Esperando Pago, Pago Confirmado, Pago Expirado y Error.
3. **Checkout WhatsApp:**
   - Mensaje prellenado con desglose del pedido (productos, cantidades, variantes/tallas, subtotal y total).
   - Incluye nombre del cliente y notas opcionales. Sin crear cobros ni pagos en D1.
4. **Pruebas Automatizadas:**
   - 10 tests unitarios en `tests/storefront.test.ts` (60 tests en total en la suite completa, 100% verde).


---

## 17. Fallback SPEI para Montos Altos (> $8,000 MXN) y Confirmación Manual

**Fecha:** 2026-11-09  
**Aprobación requerida:** Pablo  
**Archivos involucrados:** `src/types.ts`, `src/routes/codi.ts`, `src/routes/merchant.ts`, `migrations/0001_initial_schema.sql`, `migrations/0008_spei_fallback.sql`, `public/tienda.html`, `public/caja.html`, `tests/spei_fallback.test.ts`

### 17.1. Justificación Técnica y Regulatoria
1. **Límite Operativo CoDi ($8,000 MXN):**
   - Aunque la regulación Banxico 2026 contempla hasta 1,500 UDIs (~$12,500–$13,200 MXN), las aplicaciones bancarias tradicionales (BBVA, Banamex, Santander, etc.) aplican por defecto un tope de $8,000 MXN para operaciones CoDi clásicas.
   - Definición de constante unificada `CODI_MAX_MXN = 8000` en backend y frontend como número seguro universal.
   - Prohibición estricta de "split payments": nunca fraccionar un cobro en múltiples QRs CoDi para evadir el límite; montos mayores a $8,000 MXN transitan por una sola transferencia SPEI.

2. **Naturaleza del SPEI tradicional fuera de CoDi:**
   - Una transferencia SPEI tradicional emitida desde la app del banco del cliente no pasa por la infraestructura CoDi de Pey y por ende **no dispara webhook automático de confirmación**.
   - Por diseño, la confirmación es **100% manual** por el merchant previa validación de su estado de cuenta o comprobante.
   - El pedido queda en estado `PENDING_SPEI` (diferente de `WAITING` de CoDi y de `PAID`).
   - Nunca se auto-confirma por temporizador, polling ni simulación.

### 17.2. Arquitectura de Flujo y Endpoints
1. **Umbral en Checkout (`/tienda`):**
   - Si `total <= 8000`: Flujo CoDi clásico (QR nivel H, timer 600s, polling automático).
   - Si `total > 8000`: Se bloquea la generación de QR CoDi y se invoca `POST /api/merchant/:id/spei-order`.
   - Backend CoDi (`POST /api/codi/qr`): Defensa en profundidad con rechazo fail-closed HTTP 400 (`AMOUNT_EXCEEDS_CODI_LIMIT`).

2. **Pantalla SPEI para el Cliente (`tienda.html`):**
   - Presenta con botón de copiado individual:
     - CLABE completa (18 dígitos) del merchant destinatario.
     - Banco receptor (detectado automáticamente con `getBankFromClabe`).
     - Beneficiario (razón social o nombre comercial del merchant).
     - Monto exacto en MXN.
     - Folio / Referencia de conciliación.
     - Concepto sugerido formateado.
   - Instrucción en español:
     > *"Abre la app de tu banco, elige transferencia SPEI, pega la CLABE y el monto exacto. Este pago no se confirma solo: manda tu comprobante por WhatsApp al merchant."*
   - Botón *"Ya transferí, mandar comprobante por WhatsApp"* que abre `wa.me` con mensaje estructurado prellenado (folio, monto exacto, fecha/hora, concepto).

3. **Confirmación Manual en Mostrador (`caja.html`):**
   - Pedidos `PENDING_SPEI` se muestran en la lista de cobros con etiqueta distintiva y botón interactivo `[Confirmar SPEI]`.
   - Endpoint autenticado: `POST /api/merchant/:id/payments/:paymentId/confirm-spei`:
     - Protegido con `requireMerchantAuth` y validación estricta de pertenencia de tenant.
     - Transición atómica a `PAID` con asignación de `transaction_id = TX_SPEI_<ULID>`.
     - Registro contable en `ledger_entries` (`debit_account = BANCO_SPEI`, `credit_account = VENTAS_MOSTRADOR`).
     - Registro inmutable en `operator_audit_log` con el usuario/operador autenticado y timestamp.
     - Rechazo con HTTP 400 si el pago ya fue confirmado previamente.

4. **Seguridad y Privacidad de la CLABE:**
   - La CLABE de 18 dígitos únicamente se expone en el checkout legítimo del comercio dueño para efectuar el pago.
   - En el conector interno StayPuft (`/api/internal/merchants`) la CLABE permanece enmascarada (`maskedClabe: **************1234`).
   - Aislamiento multi-tenant: el checkout de un comercio jamás expone la CLABE de otro.

### 17.3. Verificación Automatizada
- **Suite Vitest:** 7 archivos de prueba, 79/79 tests en verde (100% pass).
- **Cobertura en `tests/spei_fallback.test.ts`:**
  - $8,000 exactos → CoDi permitido.
  - $8,001 y $150,000 → CoDi rechazado con 400.
  - Generación de orden SPEI con CLABE 18 dígitos, banco, beneficiario, monto y folio.
  - Inmutabilidad: `PENDING_SPEI` no pasa a `PAID` de forma automática.
  - Confirmación manual autenticada con asiento contable y log de auditoría.
  - Protección cross-tenant (rechazo 403 Forbidden).
  - Enmascaramiento persistente en StayPuft connector.
- **Typecheck & Build:** `tsc --noEmit` 0 errores; `wrangler deploy --dry-run` exitoso sin advertencias.
- **Estado de Despliegue:** Cambios listos localmente; no desplegados a producción a la espera de la autorización explícita de Pablo (sin interferir con la vinculación Pey de Fase B).


---

## 18. Dólares Digitales (Solana Pay USDC/USDT) + Compliance en Código (Mapa Activos Virtuales y Monitor LFPIORPI)

**Fecha:** 2026-11-09  
**Aprobación arquitectónica:** Pablo  
**Archivos involucrados:**
- Backend & Modelos: `src/types.ts`, `src/utils/solana.ts`, `src/services/lfpiorpi.ts`, `src/routes/solana.ts`, `src/routes/internal.ts`, `src/routes/merchant.ts`, `src/index.ts`, `migrations/0009_digital_dollars_lfpiorpi.sql`.
- Frontend: `public/tienda.html`, `public/caja.html`.
- Pruebas automatizadas: `tests/solana_lfpiorpi.test.ts`.

### 18.1. Arquitectura de Rieles de Pago (Multi-rail Sovereign)
1. **Abstracción de Rieles y Monedas:**
   - La Caja opera con rieles desacoplados:
     - `codi`: Riel oficial en MXN vía Pey / Banxico (límite universal $8,000 MXN).
     - `spei`: Transferencias tradicionales directas para montos altos (> $8,000 MXN) con confirmación manual.
     - `solana_usdc`: Dólares digitales USDC en red Solana (SPL Token).
     - `solana_usdt`: Dólares digitales USDT en red Solana (SPL Token).
   - Monedas admitidas: `MXN`, `USDC`, `USDT`.
   - Regla de pureza de transacción: un pedido se procesa íntegramente por un único riel; nunca se dividen transacciones entre rieles para un mismo ticket.
2. **Arquitectura Estrictamente No-Custodial:**
   - La Caja jamás custodia, solicita ni transmite claves privadas o seed phrases. El merchant resguarda la soberanía de sus fondos en su propia wallet de autocustodia (Phantom, Solflare, etc.).
   - En base de datos D1 únicamente se almacena la dirección pública (`solana_wallet`) del merchant.
   - Validación estricta en Base58 (32 a 44 caracteres alfanuméricos, alfabeto Base58 excluyendo terminantemente caracteres ambiguos `0`, `O`, `I`, `l`).
   - El riel Solana solo se activa en la tienda si el merchant tiene configurada su dirección pública (`solana_pay_enabled = 1`).

### 18.2. Integración Solana Pay (USDC & USDT)
1. **Especificación del Enlace y QR:**
   - Formato estándar Solana Pay:
     `solana:<recipient>?amount=<amount>&spl-token=<splToken>&reference=<reference>&label=<label>&message=<message>`
   - Mints oficiales de SPL Tokens en Mainnet:
     - **USDC:** `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
     - **USDT:** `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`
   - Código QR renderizado en contraste absoluto (negro `#000000` sobre blanco `#ffffff`), nivel de corrección H y sin saturación gráfica central.
   - Referencia única de 32 bytes en Base58 (`generateSolanaReference`) generada por cada orden para correlación determinista en cadena (nunca reutilizada).
   - Temporizador de expiración de 10 minutos (600s); una vez expirada la sesión, se requiere generar un cobro nuevo con una nueva referencia criptográfica.
2. **Confirmación y Registro en Ledger:**
   - Verificación on-chain: el estado pasa a `PAID` únicamente cuando se constata la confirmación de la transacción en la cadena Solana con la referencia única correspondiente y el monto exacto pactado.
   - Manejo de inconsistencias: si se detecta un depósito con monto inferior o superior al convenido, el sistema bloquea la acreditación automática y cataloga la transacción como `MANUAL_REVIEW`.
   - Asiento contable de partida doble en `ledger_entries` con cuentas dedicadas (`SOLANA_USDC` / `SOLANA_USDT` vs `VENTAS_MOSTRADOR_CRYPTO`).

### 18.3. La Ley en el Código: Evaluador LFPIORPI y Dictamen UIF
1. **Marco Normativo (Art. 17 Fracción XVI LFPIORPI):**
   - El intercambio o intermediación con Activos Virtuales constituye Actividad Vulnerable sujeta a identificación y aviso conforme a la legislación mexicana.
   - Parámetros de cálculo para 2026:
     - `UMA_DIARIA_2026_MXN = 113.14`
     - `LFPIORPI_UMBRAL_AVISO_UMA = 210` (~$23,759.40 MXN)
     - `LFPIORPI_UMBRAL_KYC_UMA = 147` (70% del umbral de aviso, ~$16,631.58 MXN)
2. **Módulo Centralizado (`evaluadorActividadesVulnerables`):**
   - Acumulación móvil estricta de 6 meses (180 días) por cliente (o por el identificador del merchant si la operación es de mostrador sin RFC).
   - Niveles y reglas de acción legal:
     - `NORMAL`: Total acumulado < 147 UMA. Operación regular sin exigencias adicionales.
     - `KYC_ALERTA`: Total acumulado ≥ 147 UMA y < 210 UMA. El sistema exige y valida la captura de RFC / Identificación oficial del pagador antes de liquidar.
     - `AVISO`: Total acumulado ≥ 210 UMA. Se genera y sella de manera automática el expediente para presentación del Aviso ante la UIF a más tardar el día 17 del mes inmediato posterior.
3. **Sellado Criptográfico Inmutable:**
   - Cada evaluación genera un dictamen firmado con SHA-256 (`dictamenHash`) que condensa: `merchantId`, `customerId`, periodo acumulado, monto en UMA y nivel de alerta.
   - Persistencia inmutable en la tabla `lfpiorpi_evaluaciones`.
4. **Servicio Compartido Microservicios:**
   - Expuesto para StayPuft y microservicios satélite en `POST /api/internal/lfpiorpi/evaluar`, autenticado por header `X-StayPuft-Key`.

### 18.4. Off-ramp Condicional y Corte de Caja Fiscal
1. **Protección en Off-ramp a Pesos (MXN):**
   - El endpoint `GET /api/solana/offramp-info/:merchantId` valida el estatus del proveedor de liquidación configurado (`offramp_provider`).
   - La opción de convertir dólares digitales a moneda nacional solo se habilita y expone si el proveedor está formalmente dado de alta como Entidad Financiera autorizada (ITF) o con registro vigente de Actividad Vulnerable ante el SAT/UIF.
   - Si no cumple, el sistema rechaza preventivamente la gestión de rampa para salvaguardar la responsabilidad jurídica del comerciante.
2. **Corte Diario Fiscalmente Trazable (`POST /api/merchant/:id/close-day`):**
   - Genera desglose fiscal diferenciado entre cobros CoDi (efectivo bancario MXN) y activos virtuales (USDC/USDT).
   - Registra monto neto en tokens y su equivalencia en MXN calculada a la cotización oficial de cada cobro.
   - Emite dictamen con fundamento legal expreso para la contabilidad del negocio (Art. 17 Fracc. XVI LFPIORPI e impacto IVA/ISR).

### 18.5. Cobertura de Pruebas y Estado del Despliegue
- **Pruebas Automatizadas:** 8 suites de pruebas ejecutadas con Vitest: **95/95 pruebas exitosas (100% verde)**.
- **Suite Dedicada (`tests/solana_lfpiorpi.test.ts`):** 16 pruebas cubriendo validación Base58, URLs Solana Pay con tokens oficiales, confirmación en cadena, contabilidad ledger, acumulación a 6 meses, umbrales KYC/UIF, hashes SHA-256 y rampa condicional.
- **Typecheck:** `tsc --noEmit` con 0 errores de compilación.
- **Empaquetado:** `npx wrangler deploy --dry-run` completado sin errores.
- **Política de Despliegue:** **LOCAL LISTO — NO DESPLEGADO**. Se mantiene congelado en el entorno local a la espera de la autorización expresa de Pablo y para no interferir con la ventana de vinculación de 5 días hábiles de la Fase B de Pey.


---

## 19. Landing Page Pública — Renovación de Copy & Catálogo Integral de Servicios

**Fecha:** 2026-11-09  
**Archivos:** `public/index.html`, `public/landing.html`  

### 19.1. Diagnóstico Previo y Necesidad
El copy original de la landing page pública estaba limitado a la narrativa de CoDi básico en mostrador, omitiendo los servicios clave implementados en la plataforma. Se reescribió y reestructuró para presentar la propuesta de valor integral:

1. **Posicionamiento:** *"La caja registradora moderna, multi-riel y fiscal para el mostrador mexicano"*.
2. **Presentación de los 3 Rieles de Cobro Soberano:**
   - **CoDi® Banco de México:** Cobro rápido en mostrador (hasta $8,000 MXN), QR dinámico con monto bloqueado y liquidación en 2 segundos a CLABE.
   - **Fallback SPEI Inteligente:** Transición automática en ventas grandes (> $8,000 MXN), exhibiendo CLABE 18 dígitos, banco, folio y confirmación manual en caja sin dividir pagos.
   - **Dólares Digitales (USDC/USDT en Solana Pay):** Cobro directo wallet-a-wallet, sin comisiones bancarias abusivas y 100% no-custodial para turismo y nómadas digitales.
3. **Control Fiscal e Inteligencia Artificial:**
   - **Facturación SAT CFDI 4.0:** Timbrado instantáneo con Facturapi para Público en General o clientes con RFC, descarga de XML y PDF.
   - **Corte Inteligente con Workers AI:** Resumen ejecutivo de la jornada, horas pico, ticket promedio y sugerencia automática de claves de producto SAT.
   - **Compliance en Código (LFPIORPI):** Vigilancia de umbrales en UMA (Art. 17 Fracc. XVI), alertas preventivas KYC y dictamen inmutable sellado con SHA-256.
4. **Tienda en Línea y Menú Digital (`/tienda`):** Catálogo web responsive para comensales y clientes de retail con carrito de compra y checkout CoDi o pedido a WhatsApp.
5. **App Instalable (PWA) & Modo Offline:** Funcionamiento en pantalla completa en cualquier dispositivo móvil/PC y resiliencia ante cortes o parpadeos de red local.
6. **FAQ Ampliada:** Respuestas técnicas y comerciales sobre límites de monto, dólares digitales, facturación SAT y compatibilidad bancaria.
