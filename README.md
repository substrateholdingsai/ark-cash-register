# 🎯 ARK CASH REGISTER — Sistema Operativo de Caja Registradora CoDi (Pey API v2026-10-20)

Componente oficial de caja registradora para el ecosistema **ARK Systems** desplegado en **Cloudflare Workers** con **D1 (SQLite)**, **KV Cache**, **PWA Offline-First** e integración bancaria **CoDi (Banxico)** a través de **Pey API**.

---

## ⚡ Características Principales

1. **Diseño de Mostrador Operativo:**
   - Cero fricción: Botón primario Navy sólido (`#002B7F`), montos en `Orbitron 700` con `tabular-nums`.
   - Teclado táctil de mínimo 72px optimizado para cajeros.
   - Feedback sonoro y háptico con Web Audio API.
2. **Generación Client-Side de QR CoDi:**
   - Se obtiene el `qrString` desde Pey (`generateImage: false`) y se renderiza instantáneamente en el cliente con `qrcode.js`.
3. **Estrategia Híbrida Webhook + Polling:**
   - Polling cada 5s garantizado para resiliencia ante pérdida de conexión.
   - Endpoint `/webhooks/pey` con firma HMAC-SHA256 y protección anti-replay (timestamp).
4. **Compliance Contable Automático (ARK Ledger):**
   - Cada pago confirmado genera automáticamente una póliza en `ledger_entries` (Debe: `102.01 Bancos CoDi`, Haber: `401.01 Ventas`).
5. **Offline-First:**
   - Service Worker (`sw.js`) con almacenamiento de caché de assets.

---

## 🏗️ Arquitectura de Endpoints

| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/` | UI completa de la caja registradora (Pantallas A, B y C) |
| `GET` | `/api/health` | Diagnóstico del Worker y estado de bindings D1 / KV |
| `POST` | `/api/codi/qr` | Genera QR CoDi presencial en Banxico |
| `GET` | `/api/payment/codi/:id` | Consulta y confirmación de estado de un QR CoDi |
| `POST` | `/api/payment-link` | Crea link para cobro a distancia (WhatsApp / SMS) |
| `GET` | `/api/payment/link/:id` | Polling del link de pago remoto |
| `POST` | `/api/merchant/register` | Onboarding de cuenta bancaria con CLABE de 18 dígitos |
| `GET` | `/api/merchant/:id/payments` | Lista de pagos del día para el mostrador |
| `POST` | `/api/merchant/:id/close-day` | Corte de caja del turno |
| `POST` | `/webhooks/pey` | Receptor de eventos de Pey (`payment.confirmed`, `bank-account.updated`) |

---

## 🚀 Inicio Rápido Local

```bash
# 1. Instalar dependencias
npm install

# 2. Inicializar base de datos D1 local
npm run d1:local

# 3. Arrancar servidor de desarrollo
npm run dev
```

Abre tu navegador en `http://localhost:8787`.

---

## ☁️ Despliegue a Producción (Cloudflare)

```bash
# 1. Crear la base de datos D1 en Cloudflare (si aún no existe)
npx wrangler d1 create ark_caja_db

# 2. Ejecutar las migraciones en producción
npm run d1:remote

# 3. Configurar tus secretos de Pey en Cloudflare
npx wrangler secret put PEY_API_KEY
npx wrangler secret put PEY_WEBHOOK_SECRET

# 4. Desplegar
npm run deploy
```
