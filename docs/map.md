# 🗺️ MAPA DEL PROYECTO — ARK CASH REGISTER (v2.0)

**Producto:** Ark-cajaregistradora (`pey-worker`)  
**Ecosistema:** ARK Systems (Substrate Holdings LLC)  
**Integración Bancaria:** Pey CoDi API (OpenAPI v2026-10-20 / Banxico)  
**Infraestructura:** Cloudflare Workers + D1 Database + KV Cache + PWA  
**Última actualización:** Noviembre 2026  

---

## 1. Esquema de Arquitectura del Proyecto

```
ark-cash-register/
├── docs/
│   ├── ark-cash-register.md     # Documento maestro (22 secciones de diseño y técnica)
│   └── map.md                   # Este documento: mapa integral y checklist de pendientes
├── migrations/
│   ├── 0001_initial_schema.sql  # Esquema D1 SQLite: merchants, payments, ledger_entries, webhook_events
│   └── 0002_operator_audit_and_closes.sql # Auditoría operador (StayPuft) y tabla daily_closes
├── public/                      # Assets servidos desde el Edge (PWA Frontend)
│   ├── index.html               # UI autocontenida: Mostrador (A), QR CoDi (B), Link Remoto (C), Corte de Día
│   ├── sw.js                    # Service Worker para caché offline
│   ├── favicon.svg              # Ícono oficial de la caja registradora
│   └── logo.svg                 # Branding institucional ARK Caja Registradora
├── src/                         # Código fuente del Cloudflare Worker (TypeScript)
│   ├── index.ts                 # Router principal Hono, CORS, logger, healthcheck y dispatch
│   ├── types.ts                 # Tipos TypeScript sincronizados con OpenAPI Pey v2026-10-20
│   ├── middleware/
│   │   └── staypuftAuth.ts      # Auth fail-closed con X-StayPuft-Key y log inmutable en operator_audit_log
│   ├── routes/
│   │   ├── codi.ts              # Endpoints CoDi QR (/api/codi/qr) y Push Notification (/api/codi/pn)
│   │   ├── paymentLink.ts       # Endpoints Cobro Remoto (/api/payment-link)
│   │   ├── merchant.ts          # Registro de CLABE, status Banxico, lista de pagos y corte de caja
│   │   ├── webhooks.ts          # Receptor /webhooks/pey con validación HMAC-SHA256 y anti-replay
│   │   └── internal.ts          # Conector Interno StayPuft (/api/internal/*) solo lectura y diagnóstico
│   ├── services/
│   │   └── peyClient.ts         # Cliente HTTP tipado contra api.pey.mx con retry exponencial y mock local
│   └── utils/
│       └── ulid.ts              # Generador ULID criptográfico Crockford Base32
├── tests/
│   └── internal.test.ts         # Suite de pruebas unitarias Vitest (Auth, Cuotas, Enmascaramiento, HMAC)
├── forge_pey.py                 # Generador Python de assets SVG institucionales
├── package.json                 # Configuración de dependencias (Hono, Wrangler, TypeScript)
├── tsconfig.json                # Configuración de compilación TS para Worker runtime
└── wrangler.toml                # Configuración de Cloudflare Workers, bindings D1, KV y variables
```

---

## 2. Mapa de Integración y Flujo de Datos

```mermaid
flowchart TD
    subgraph FRONTEND["Frontend PWA (Edge Assets)"]
        UI_A["Pantalla A: El Mostrador\n(Lista de hoy, Cobrar aquí, Cobrar a distancia)"]
        UI_B["Pantalla B: Cobrar aquí\n(Teclado Orbitron 72px + QR client-side qrcode.js)"]
        UI_C["Pantalla C: Cobro a distancia\n(Link remoto + Copiar + WhatsApp)"]
        UI_CUT["Modal: Corte del Día\n(Playfair 900 ceremonial)"]
    end

    subgraph WORKER["Cloudflare Worker (pey-worker)"]
        ROUTER["Router Hono (src/index.ts)"]
        CODI_API["Ruta CoDi (/api/codi/qr)"]
        LINK_API["Ruta Link (/api/payment-link)"]
        POLL_API["Polling (/api/payment/:id)"]
        WH_API["Webhooks (/webhooks/pey)"]
        CLIENT["PeyClient (Retry + Sanitización)"]
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
        ARK_LEDGER["ARK Ledger\n(Pólizas contables en ledger_entries)"]
        ARK_CONTAGRAM["Contagram\n(CFDI Global al corte del día)"]
        ARK_ARKANGEL["Arkangel\n(Gestión de cobranza)"]
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

| Endpoint Worker | Método | Destino Pey | Propósito | Estado |
|---|---|---|---|:---:|
| `/api/health` | `GET` | Local / Worker | Diagnóstico de bindings D1 y KV | ✅ Listo |
| `/api/codi/qr` | `POST` | `/codi/qr` | Genera QR CoDi con `generateImage: false` | ✅ Listo |
| `/api/codi/pn` | `POST` | `/codi/pn` | Envía Push Notification a celular (10 dígitos) | ✅ Listo |
| `/api/payment/codi/:id` | `GET` | `/transaction/codi/qr/:id` | Polling dual de estado de QR | ✅ Listo |
| `/api/payment-link` | `POST` | `/payment-link/create` | Crea enlace para cobro remoto | ✅ Listo |
| `/api/payment/link/:id` | `GET` | `/payment-link/:id` | Polling de estado de enlace remoto | ✅ Listo |
| `/api/merchant/register` | `POST` | `/bank-account` | Onboarding de cuenta CLABE (Banxico) | ✅ Listo |
| `/api/merchant/:id` | `GET` | `/bank-account/:id` | Consulta estado CoDi (`PENDING` / `ACTIVE`) | ✅ Listo |
| `/api/merchant/:id/payments` | `GET` | D1 Local | Historial de pagos para el mostrador | ✅ Listo |
| `/api/merchant/:id/close-day` | `POST` | D1 Local | Corte de caja ceremonial del turno | ✅ Listo |
| `/webhooks/pey` | `POST` | Webhook Receptor | Ingesta de `payment.confirmed` con HMAC | ✅ Listo |

---

## 4. Checklist de lo Construido (Estado Actual)

- [x] **Documento enriquecido oficial:** `docs/ark-cash-register.md` con las 22 secciones.
- [x] **Proyecto Wrangler inicializado:** `wrangler.toml`, `package.json`, `tsconfig.json`.
- [x] **Esquema de base de datos D1:** Migración `0001_initial_schema.sql` ejecutada localmente con tablas `merchants`, `payments`, `ledger_entries` y `webhook_events`.
- [x] **Cliente Pey HTTP tipado:** `PeyClient` con soporte completo OpenAPI v2026-10-20, retry con backoff exponencial, sanitización de metadata y simulador de desarrollo local.
- [x] **Controladores del Worker:**
  - [x] Endpoints CoDi QR con almacenamiento local de IDCs y folios.
  - [x] Endpoints de Payment Links remotos.
  - [x] Receptor de webhooks con verificación de firma HMAC-SHA256 (`crypto.subtle`) y anti-replay.
  - [x] Integración con Ledger contable automático al confirmar pago.
- [x] **Frontend PWA de Mostrador:**
  - [x] Cumplimiento estricto de paleta (`--navy`, `--gold`, `--paid`, `--waiting`, `--expired`).
  - [x] Tipografía `Orbitron 700` para montos, `Inter` para texto, `Playfair Display 900` para corte del día.
  - [x] Teclado numérico táctil de 72px de altura mínima.
  - [x] Renderizado de QR client-side con `qrcode.js` desde `qrString`.
  - [x] Countdown timer de 600 segundos con spinner ámbar.
  - [x] Feedback sonoro (Web Audio API synth) y háptico (`navigator.vibrate`).
  - [x] Botones de "Copiar link" y "Compartir por WhatsApp" en cobro a distancia.
  - [x] Modal de corte del día.
  - [x] Service worker `public/sw.js` para caching estático.
- [x] **Assets visuales:** `public/favicon.svg` y `public/logo.svg` creados con `forge_pey.py`.

---

## 5. Checklist de Faltantes y Siguientes Pasos (Roadmap)

### Fase A — Despliegue y Conexión Cloudflare (Inmediato)
- [ ] **Crear base de datos D1 en Cloudflare Producción:**
  - Comando: `npx wrangler d1 create ark_caja_db`
  - Vincular el `database_id` real generado en `wrangler.toml`.
- [ ] **Crear KV Namespace en Cloudflare Producción:**
  - Comando: `npx wrangler kv namespace create ark-caja-kv-cache`
  - Vincular el `id` en `wrangler.toml`.
- [ ] **Aplicar migraciones D1 en producción:**
  - Comando: `npm run d1:remote`
- [ ] **Configurar Secretos de Producción en Cloudflare:**
  - `npx wrangler secret put PEY_API_KEY` (Key real proporcionada por Pey)
  - `npx wrangler secret put PEY_WEBHOOK_SECRET` (Secreto HMAC configurado en el dashboard de Pey)
- [ ] **Despliegue inicial a Cloudflare:**
  - Comando: `npm run deploy`
  - Configurar dominio personalizado (ej. `caja.arksystems.site` o `caja.arkangel.mx`).

---

### Fase B — Certificación y Pruebas Reales con Pey (24 - 48h)
- [ ] **Configurar URL de Webhook en Dashboard de Pey:**
  - Apuntar a `https://<tu-worker>.workers.dev/webhooks/pey`
  - Seleccionar eventos: `payment.confirmed` y `bank-account.updated`.
- [ ] **Prueba de cobro real de micro-monto en producción ($0.01 o $1.00 MXN):**
  - Abrir la caja desde un teléfono móvil.
  - Generar QR por $1.00 MXN.
  - Escanear con una app bancaria mexicana real (BBVA, Banorte, Santander, Hey Banco, Mercado Pago, etc.) vía sección CoDi.
  - Validar recepción del webhook y disparo inmediato de pantalla "¡Pagado!" + chime sonoro.
- [ ] **Prueba de cobro a distancia por WhatsApp:**
  - Generar link remoto por $1.00 MXN.
  - Pagar mediante tarjeta o CoDi en el checkout oficial de Pey.
  - Validar que el polling detecte la acreditación.

---

### Fase C — Resiliencia Offline Completa (Frontend)
- [ ] **Implementación de IndexedDB en cliente (`public/index.html`):**
  - Crear almacén `offline_sales_queue` en IndexedDB para registrar ventas cuando `navigator.onLine === false`.
  - Mecanismo de sincronización automática en evento `window.addEventListener('online', syncQueue)`.
  - Badge visual dinámico en el header: alternar entre `🟢 CoDi activo` y `🟡 Modo Offline (Ventas en cola)`.

---

### Fase D — Onboarding y Operación de Comercios
- [ ] **Pantalla o Modal de Onboarding de Comercio:**
  - Formulario en UI para que un nuevo comerciante ingrese:
    - Razón Social / Nombre legal
    - RFC con homoclave
    - CLABE interbancaria (18 dígitos)
    - Tipo de persona (Física / Moral)
  - Envío a `POST /api/merchant/register` y visualización de estatus (`PENDING` ➔ `ACTIVE`).
- [ ] **Exportación o Ticket del Corte de Caja:**
  - Botón para compartir resumen del corte del día por WhatsApp al dueño del negocio.
  - Opción de impresión térmica (formato ESC/POS o PDF de recibo de 58mm/80mm).

---

### Fase E — Integración Profunda con Ecosistema ARK
- [ ] **Sincronización con ARK Ledger:**
  - Enviar asiento contable mediante webhook/API interna a la contabilidad general de Ledger.
- [ ] **Sincronización con Contagram (CFDI):**
  - Generar factura global del día ante el SAT a partir del endpoint `/api/merchant/:id/close-day`.
- [ ] **Sincronización con Arkangel:**
  - Si el pago incluye metadata `deudorId`, liquidar automáticamente la deuda en Arkangel Cobranza.

---

## 6. Comandos Operativos de Referencia

| Acción | Comando |
|---|---|
| **Iniciar servidor de desarrollo local** | `npm run dev` |
| **Ejecutar migraciones en BD local D1** | `npm run d1:local` |
| **Verificar tipos TypeScript** | `npm run build` |
| **Ejecutar migraciones en Cloudflare remoto** | `npm run d1:remote` |
| **Desplegar Worker a producción** | `npm run deploy` |
| **Ver logs en tiempo real de producción** | `npx wrangler tail` |
| **Consultar registros de Ledger en D1 local** | `npx wrangler d1 execute ark_caja_db --local --command="SELECT * FROM ledger_entries"` |
| **Consultar pagos registrados en D1 local** | `npx wrangler d1 execute ark_caja_db --local --command="SELECT id, amount, status FROM payments"` |
| **Correr suite de tests Vitest** | `npm test` |

---

## 7. Operador StayPuft (Conector Interno de Diagnóstico y Lectura)

### 7.1. Propósito y Límites Operativos
El conector `/api/internal/*` permite a StayPuft inspeccionar y diagnosticar la salud operativa de **Ark Cash Register** en vivo.
- **Solo lectura (`GET` exclusivamente):** No crea cobros, no registra CLABEs, no mueve dinero y no altera estados de pagos.
- **Fail-Closed:** Protegido por el header `X-StayPuft-Key`. Si la clave es errónea o está ausente, responde `401 Unauthorized`.
- **Enmascaramiento de Datos Sensibles:** La CLABE interbancaria nunca se expone completa (solo los últimos 4 dígitos: `**************5678`). El RFC se enmascara parcialmente.
- **Secretos Protegidos:** `PEY_API_KEY`, `PEY_WEBHOOK_SECRET` y `CAJA_STAYPUFT_API_KEY` jamás se devuelven en respuestas ni se escriben en logs.
- **Protección de Cuotas D1:** Paginación obligatoria (máximo 100 registros por llamada, default 20). Si se solicita `limit > 100`, se rechaza con `400 Bad Request`.
- **Auditoría Inmutable:** Cada llamada al conector queda asentada en la tabla `operator_audit_log` con endpoint, método, duración y código HTTP.

---

### 7.2. Endpoints Internos y Ejemplos curl

Para todas las llamadas, define la variable de entorno:
```bash
export CAJA_STAYPUFT_API_KEY="tu_llave_interna_registrada_en_wrangler"
export CAJA_HOST="http://127.0.0.1:8787" # O host de producción una vez desplegado
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
      "alias": "Taquería El Güero",
      "name": "Taquería El Güero S.A. de C.V.",
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
*Nota: No devuelve `qrString` para evitar congestión de payload.*

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

#### 7. Registro de Webhooks de Pey (Auditoría)
```bash
curl -X GET "$CAJA_HOST/api/internal/webhooks?status=ok&limit=20" \
  -H "X-StayPuft-Key: $CAJA_STAYPUFT_API_KEY"
```

#### 8. Historial de Cortes de Caja
```bash
curl -X GET "$CAJA_HOST/api/internal/close-days?merchant_id=01JBAVWE4NS5TGXHWGMX3KH23Q&limit=20" \
  -H "X-StayPuft-Key: $CAJA_STAYPUFT_API_KEY"
```

#### 9. Métricas Globales del Operador
```bash
curl -X GET "$CAJA_HOST/api/internal/metrics" \
  -H "X-StayPuft-Key: $CAJA_STAYPUFT_API_KEY"
```

---

### 7.3. Cómo Probar el Flujo Completo con un Pago de Prueba en Local

1. **Asegurar la base de datos D1 local migrada:**
   ```bash
   npm run d1:local
   ```
2. **Arrancar el worker localmente con la clave interna configurada:**
   ```bash
   npx wrangler dev --port 8787 --var CAJA_STAYPUFT_API_KEY:test_staypuft_key_caja_12345
   ```
3. **Generar un cobro QR desde el endpoint público:**
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

5. **Simular confirmación vía Webhook:**
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

   # Ver póliza en ARK Ledger
   curl -X GET "http://127.0.0.1:8787/api/internal/ledger" \
     -H "X-StayPuft-Key: test_staypuft_key_caja_12345"
   ```

7. **¿Qué hacer si falla?**
   - **Error 401:** Verifica que el header `X-StayPuft-Key` coincida exactamente con la variable `CAJA_STAYPUFT_API_KEY`.
   - **Error 404 al consultar un merchant:** El ID solicitado no existe en la tabla `merchants`.
   - **Error 400 en paginación:** El parámetro `limit` excede el tope de 100.
   - **Consulta la tabla de auditoría:**
     `npx wrangler d1 execute ark_caja_db --local --command="SELECT * FROM operator_audit_log ORDER BY created_at DESC LIMIT 5"`

---

### 7.4. Estado de Bloqueos para Verificación en Vivo

| Fase | Tarea | Estado Actual | ¿Bloquea al Conector en Vivo? |
|---|---|:---:|:---:|
| **Fase A** | Crear D1 `ark_caja_db` en Cloudflare Producción | ✅ Completada (`0d7fdfd5-8544-401b-9f28-2df47c91dd06`) | No |
| **Fase A** | Crear KV `ark-caja-kv-cache` en Cloudflare Producción | ✅ Completada (`2d95ac6f8ad94667a59d32dcbd5cae41`) | No |
| **Fase A** | Aplicar migraciones en remoto D1 (`0001` y `0002`) | ✅ Completada (6 tablas creadas) | No |
| **Fase A** | Desplegar Worker y vincular `caja.arksystems.site` | ✅ Completada (En vivo y verificado) | No |
| **Fase A** | Registrar secret `CAJA_STAYPUFT_API_KEY` en Cloudflare | ⏳ Pendiente (registro interactivo por Pablo) | Requiere valor seguro |
| **Fase A** | Registrar secrets `PEY_API_KEY` y `PEY_WEBHOOK_SECRET` | ⏳ Pendiente (registro interactivo por Pablo) | Para cobros reales |
| **Fase B** | Pruebas reales de $1.00 MXN con app bancaria | ⏳ Pendiente (operado solo por Pablo) | No para diagnóstico de lectura |
| **Fase C** | IndexedDB Offline en frontend | ⏳ Pendiente | No para el conector |
| **Fase D** | UI Onboarding y recibos térmicos | ⏳ Pendiente | No para el conector |
| **Fase E** | Enlace webhook a Contagram / Arkangel | ⏳ Pendiente | No para el conector |

