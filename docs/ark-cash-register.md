# ARK CASH REGISTER — Sistema de Diseño de la Caja Registradora

**Versión:** 2.0
**Producto:** Ark-cajaregistradora
**Última actualización:** Noviembre 2026
**Mantenedor:** Substrate Holdings LLC
**Aplicable a:** `pey-worker` (caja registradora del comerciante)
**Depende de:** `docs/design-system.md` (ARK SYSTEMS v1.0)
**Integra:** Pey CoDi API v2026-10-20 · Cloudflare Workers · D1 · KV · R2

---

## Índice

1. [Filosofía](#1-filosofía)
2. [Herencia y Sobrescritura](#2-herencia-y-sobrescritura)
3. [Paleta Operativa](#3-paleta-operativa)
4. [Tipografía Operativa](#4-tipografía-operativa)
5. [Componentes Nuevos](#5-componentes-nuevos)
6. [Estados de la Caja](#6-estados-de-la-caja)
7. [Las 3 Pantallas](#7-las-3-pantallas)
8. [Reglas de Oro de la Caja](#8-reglas-de-oro-de-la-caja)
9. [CSS Variables](#9-css-variables)
10. [Checklist de Entrega](#10-checklist-de-entrega)
11. **[Arquitectura con Cloudflare Workers](#11-arquitectura-con-cloudflare-workers)** 🆕
12. **[Mapeo de Pantallas a Endpoints Pey](#12-mapeo-de-pantallas-a-endpoints-pey)** 🆕
13. **[Contrato de Webhooks](#13-contrato-de-webhooks)** 🆕
14. **[Estrategia de Metadata](#14-estrategia-de-metadata)** 🆕
15. **[Onboarding de Merchant](#15-onboarding-de-merchant)** 🆕
16. **[Estrategia Offline](#16-estrategia-offline)** 🆕
17. **[Plan de Fallback y Errores](#17-plan-de-fallback-y-errores)** 🆕

---

## 1. Filosofía

### 1.1. El Problema

El comerciante de barrio no necesita un dashboard. Necesita una caja registradora. Cobra 50 veces al día, de pie, con prisa, con el cliente enfrente. Si el botón falla o el monto no se lee bajo el sol, pierde la venta.

### 1.2. La Diferencia con Ledger

| Ledger | Caja Registradora |
|---|---|
| **Presenta** dinero (papel de trabajo, corte, CFDI) | **Opera** dinero (cobro, confirmación, historial) |
| Cúpula de cristal, Playfair, oro ceremonial | Monto plano, Orbitron, Navy operativo |
| El total es un objeto de exhibición | El monto es un número de trabajo |
| Se lee sentado, con calma | Se lee de pie, con prisa, bajo el sol |
| 1 oro por pantalla en totales | 1 oro por pantalla solo en "Pagado" |

### 1.3. Principios Rectores

| Principio | Descripción |
|---|---|
| **Cero fricción** | Un botón por pantalla. Una decisión por pantalla. |
| **Legibilidad bajo el sol** | Blanco puro, Navy sólido, contraste AAA. |
| **Feedback inmediato** | El botón responde al instante. Sin animaciones lentas. |
| **Lenguaje de mostrador** | "Cobrar aquí", "Cobrar a distancia", "Pagado". Nunca "CoDi", "QR", "API". |
| **Confianza institucional** | Navy Trust, no colores festivos. El comerciante siente que es serio. |

---

## 2. Herencia y Sobrescritura

### 2.1. Lo que se Hereda Tal Cual

- **Colores:** `--navy`, `--navy-2`, `--surface`, `--ink`, `--muted`, `--line`, `--gold`, `--gold-light`, `--gold-dark`.
- **Tipografía:** `Orbitron 700` (montos), `Inter 400-700` (todo lo demás).
- **Espaciado:** escala Tailwind (`p-4`, `p-6`, `p-8`).
- **Radios:** `rounded-[16px]` para cards, `rounded-full` para badges y botones CTA.
- **Regla del oro:** máximo 1 acento dorado por pantalla.

### 2.2. Lo que se Sobrescribe

| Elemento | Ledger | Caja Registradora |
|---|---|---|
| **Monto principal** | Playfair 900 + cúpula | Orbitron 700, plano, sin sombra |
| **Botón primario** | `glass-btn-primary` (oro) | Navy sólido, sin gradiente |
| **Fondo** | Blanco + cúpula | Blanco puro, sin cúpula |
| **Acento oro** | Totales, divisores, badges | Solo en badge "Pagado" y corte del día |
| **Feedback de press** | `translateY(4px)` 140ms | Cambio de color inmediato, sin animación |
| **Historial** | `lcd-display` | Lista blanca con `line` sutil |
| **Playfair** | Totales y títulos | Solo en el corte del día |

### 2.3. Lo que NO se Usa en la Caja

- `liquid-glass-dome` (cúpula de cristal).
- `text-magnified` (text-shadow de 3 capas + drop-shadow dorado).
- `lcd-display` (LCD vintage).
- `receipt-gold` (borde doble de recibo).
- Playfair 900 (excepto en el corte del día).
- `glass-btn` con animación de hundimiento.

---

## 3. Paleta Operativa

### 3.1. Colores de la Caja

| Nombre | Hex | Variable | Uso |
|---|---|---|---|
| **Navy Operativo** | `#002B7F` | `--navy` | Botón "Cobrar", header, texto principal. |
| **Navy Dark** | `#001A4D` | `--navy-2` | Estado activo del botón, press feedback. |
| **Blanco Puro** | `#FFFFFF` | `--surface` | Fondo de todas las pantallas. |
| **Ink** | `#121A2E` | `--ink` | Texto sobre blanco. |
| **Muted** | `#6B7A99` | `--muted` | Labels, metadata, hora del pago. |
| **Line** | `#E8E0CC` | `--line` | Bordes sutiles de la lista de pagos. |
| **Gold Value** | `#D4AF37` | `--gold` | Solo badge "Pagado" y corte del día. |
| **Verde Pagado** | `#16A34A` | `--paid` | Check de "Pagado", estado de éxito. |
| **Ámbar Espera** | `#D97706` | `--waiting` | Spinner de "Esperando pago". |
| **Rojo Expirado** | `#DC2626` | `--expired` | QR expirado, error. |
| **Gris Offline** | `#6B7280` | `--offline` | Sin conexión. |

### 3.2. Reglas de Uso

- **Navy sobre blanco:** contraste 12.1:1 (AAA). ✅
- **Verde Pagado sobre blanco:** solo para el check, nunca para texto largo. ⚠️
- **Oro solo en "Pagado" y corte del día.** Si aparece en el botón "Cobrar", rompe la regla.
- **Nunca fondo completo de color.** Solo acentos y badges.

---

## 4. Tipografía Operativa

### 4.1. Fuentes de la Caja

| Fuente | Peso | Uso | Fallback |
|---|---|---|---|
| **Orbitron** | 700 | Montos, contadores, números de pago | `ui-monospace, monospace` |
| **Inter** | 400–700 | Todo lo demás (labels, body, botones, historial) | `-apple-system, sans-serif` |

> **Playfair Display** solo aparece en el corte del día (pantalla de cierre), no en la caja.

### 4.2. Jerarquía Tipográfica

| Elemento | Fuente | Tamaño | Peso | Tracking |
|---|---|---|---|---|
| **Monto en cobro** | Orbitron | 56–72px | 700 | -0.02em, tabular-nums |
| **Monto en historial** | Orbitron | 18–20px | 700 | -0.02em, tabular-nums |
| **Título de pantalla** | Inter | 20–24px | 700 | -0.01em |
| **Label de campo** | Inter | 11px | 700 | 0.16em uppercase |
| **Body / botón** | Inter | 15–16px | 600 | 0 |
| **Metadata / hora** | Inter | 12px | 500 | 0 |
| **Total en corte del día** | Playfair | 48px | 900 | -0.04em |

### 4.3. Reglas

- **Montos siempre en Orbitron 700 con `tabular-nums`.** Los dígitos no bailan.
- **Nunca Playfair en la pantalla de cobro.** Solo en el corte del día.
- **Labels en uppercase con tracking 0.16em.** Para inputs y campos.
- **Body en Inter 600 para botones.** Legible y con peso.

---

## 5. Componentes Nuevos

### 5.1. `cash-amount`

**Uso:** El monto operativo en la pantalla de cobro. Es el corazón de la caja.

```css
.cash-amount {
  font-family: 'Orbitron', ui-monospace, monospace;
  font-weight: 700;
  font-size: 56px;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  color: var(--ink);
  text-align: center;
  line-height: 1;
}
```

**Reglas:**
- Sin sombra, sin gradiente, sin cúpula.
- Siempre centrado.
- Si el monto tiene más de 4 dígitos, baja a 48px.
- El símbolo `$` va en Inter 400, 24px, color `--muted`, alineado a la izquierda del monto.

### 5.2. `cash-keypad`

**Uso:** Teclado numérico de la pantalla de cobro.

```css
.cash-keypad {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  max-width: 360px;
  margin: 0 auto;
}

.cash-keypad button {
  height: 72px;
  border-radius: 16px;
  background: var(--surface);
  border: 1px solid var(--line);
  font-family: 'Orbitron', monospace;
  font-weight: 700;
  font-size: 24px;
  color: var(--ink);
  transition: background 0.1s ease;
}

.cash-keypad button:active {
  background: var(--navy);
  color: #fff;
}

.cash-keypad .key-action {
  background: var(--navy);
  color: #fff;
  font-family: 'Inter', sans-serif;
  font-size: 15px;
  font-weight: 700;
}
```

**Reglas:**
- Botones de mínimo 72×72px (accesible con dedo gordo).
- Grid 3×4: 1-9, 0, borrar, confirmar.
- Feedback inmediato: cambio de color, sin animación de hundimiento.
- El botón "Confirmar" va en Navy sólido, no en oro.

### 5.3. `cash-status`

**Uso:** Componente de estado de la caja. 4 variantes.

```css
.cash-status {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 32px;
  text-align: center;
}

/* Variante: waiting */
.cash-status--waiting .cash-status-icon {
  color: var(--waiting);
  animation: spin 1.5s linear infinite;
}

/* Variante: paid */
.cash-status--paid .cash-status-icon {
  color: var(--paid);
}

/* Variante: expired */
.cash-status--expired .cash-status-icon {
  color: var(--expired);
}

/* Variante: offline */
.cash-status--offline .cash-status-icon {
  color: var(--offline);
}

.cash-status-title {
  font-family: 'Inter', sans-serif;
  font-weight: 700;
  font-size: 20px;
  color: var(--ink);
}

.cash-status-desc {
  font-family: 'Inter', sans-serif;
  font-weight: 400;
  font-size: 14px;
  color: var(--muted);
  max-width: 280px;
}
```

**Las 4 variantes:**

| Variante | Ícono | Título | Descripción | Acción |
|---|---|---|---|---|
| `waiting` | Spinner | "Esperando pago…" | "El cliente está pagando. No cierres esta pantalla." | Contador de expiración |
| `paid` | Check ✓ | "¡Pagado!" | "$150.00 recibidos" | Botón "Siguiente venta" |
| `expired` | Reloj ✕ | "El QR expiró" | "El cliente no pagó a tiempo." | Botón "Regenerar QR" |
| `offline` | Nube ✕ | "Sin conexión" | "Los pagos se confirmarán cuando vuelva la señal." | Botón "Reintentar" |

### 5.4. `cash-payment-list`

**Uso:** Lista de pagos del día en la pantalla principal.

```css
.cash-payment-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: var(--line);
  border-radius: 16px;
  overflow: hidden;
}

.cash-payment-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  background: var(--surface);
}

.cash-payment-amount {
  font-family: 'Orbitron', monospace;
  font-weight: 700;
  font-size: 18px;
  font-variant-numeric: tabular-nums;
  color: var(--ink);
}

.cash-payment-time {
  font-family: 'Inter', sans-serif;
  font-weight: 500;
  font-size: 12px;
  color: var(--muted);
}

.cash-payment-badge {
  font-family: 'Inter', sans-serif;
  font-weight: 700;
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 9999px;
  background: var(--gold);
  color: var(--navy-2);
}
```

**Reglas:**
- Cada pago es una fila blanca con `line` de separación.
- Monto en Orbitron, hora en Inter, badge "Pagado" en oro.
- No más de 10 pagos visibles; el resto en "Ver todos".
- Si no hay pagos: estado vacío con texto "Aún no hay pagos hoy".

### 5.5. `cash-header`

**Uso:** Header persistente de la caja con identidad del comercio.

```css
.cash-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
}

.cash-header-name {
  font-family: 'Inter', sans-serif;
  font-weight: 700;
  font-size: 16px;
  color: var(--ink);
}

.cash-header-location {
  font-family: 'Inter', sans-serif;
  font-weight: 500;
  font-size: 12px;
  color: var(--muted);
}

.cash-header-status {
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 9999px;
}

.cash-header-status--active {
  background: #DCFCE7;
  color: #166534;
}

.cash-header-status--pending {
  background: #FEF3C7;
  color: #92400E;
}
```

**Reglas:**
- Nombre del negocio y colonia siempre visibles.
- Badge de estado: `🟢 CoDi activo` o `🟡 Cuenta en verificación`.
- Sin menú hamburguesa, sin configuración. Solo identidad y estado.

---

## 6. Estados de la Caja

### 6.1. Matriz de Estados

| Estado | Pantalla | Header | Contenido | Acción |
|---|---|---|---|---|
| **Mostrador** | A | Nombre + estado | Botón "Cobrar" + lista de pagos | Iniciar cobro |
| **Cobrando** | B | Nombre + estado | Teclado + monto | Confirmar |
| **Esperando** | B | Nombre + estado | QR + contador + `cash-status--waiting` | Esperar webhook |
| **Pagado** | B | Nombre + estado | `cash-status--paid` + check | Siguiente venta |
| **Expirado** | B | Nombre + estado | `cash-status--expired` | Regenerar QR |
| **Remoto** | C | Nombre + estado | Teclado + monto | Generar link |
| **Link listo** | C | Nombre + estado | Link + botón copiar/compartir | Esperar pago |
| **Offline** | A/B/C | Nombre + estado offline | `cash-status--offline` | Reintentar |

### 6.2. Transiciones

```
Mostrador → Cobrando (presionar "Cobrar aquí")
Cobrando → Esperando (presionar "Generar QR")
Esperando → Pagado (webhook de Pey)
Esperando → Expirado (timeout 10 min)
Expirado → Cobrando (presionar "Regenerar QR")
Pagado → Mostrador (presionar "Siguiente venta")

Mostrador → Remoto (presionar "Cobrar a distancia")
Remoto → Link listo (presionar "Generar link")
Link listo → Pagado (webhook de Pey)
Pagado → Mostrador (presionar "Siguiente venta")
```

---

## 7. Las 3 Pantallas

### 7.1. Pantalla A — El Mostrador

**Objetivo:** El comerciante ve su negocio y puede iniciar un cobro en 1 toque.

```
┌─────────────────────────────────────┐
│ Taquería El Güero        🟢 CoDi    │
│ Col. Doctores, Saltillo             │
├─────────────────────────────────────┤
│                                     │
│         [Botón "Cobrar aquí"]       │
│         (Navy sólido, 64px alto)    │
│                                     │
│         [Botón "Cobrar a distancia"]│
│         (Blanco, borde line)        │
│                                     │
├─────────────────────────────────────┤
│ Pagos de hoy                        │
│ ┌─────────────────────────────────┐ │
│ │ $150.00   2:30 PM    [Pagado]   │ │
│ │ $80.00    1:15 PM    [Pagado]   │ │
│ │ $200.00   12:45 PM   [Pagado]   │ │
│ └─────────────────────────────────┘ │
│                                     │
│         [Cerrar caja del día]       │
└─────────────────────────────────────┘
```

**Reglas:**
- Botón "Cobrar aquí" en Navy sólido, 64px alto, `rounded-[16px]`.
- Botón "Cobrar a distancia" en blanco con borde `line`, 56px alto.
- Lista de pagos: máximo 5 visibles, "Ver todos" si hay más.
- "Cerrar caja" en texto pequeño, al final, sin protagonismo.

### 7.2. Pantalla B — Cobrar Aquí (QR Presencial)

**Objetivo:** El comerciante escribe el monto y genera el QR.

**Estado 1 — Teclado:**

```
┌─────────────────────────────────────┐
│ ← Cobrar aquí                       │
├─────────────────────────────────────┤
│                                     │
│              $ 150.00               │
│         (Orbitron 56px, plano)      │
│                                     │
│    ┌───┬───┬───┐                    │
│    │ 1 │ 2 │ 3 │                    │
│    ├───┼───┼───┤                    │
│    │ 4 │ 5 │ 6 │                    │
│    ├───┼───┼───┤                    │
│    │ 7 │ 8 │ 9 │                    │
│    ├───┼───┼───┤                    │
│    │ ⌫ │ 0 │ ✓ │                    │
│    └───┴───┴───┘                    │
│                                     │
│         [Generar QR]                │
│         (Navy sólido)               │
└─────────────────────────────────────┘
```

**Estado 2 — Esperando pago:**

```
┌─────────────────────────────────────┐
│ ← Cobrar aquí                       │
├─────────────────────────────────────┤
│                                     │
│         [QR Code 280×280]           │
│         (Generado client-side)      │
│                                     │
│         $150.00 🔒                  │
│         (Monto bloqueado)           │
│                                     │
│         ⏱ Expira en 9:45            │
│                                     │
│         ⟳ Esperando pago…           │
│                                     │
│         [Cancelar]                  │
└─────────────────────────────────────┘
```

**Estado 3 — Pagado:**

```
┌─────────────────────────────────────┐
│                                     │
│              ✓                      │
│         (Verde, 80px)               │
│                                     │
│         ¡Pagado!                    │
│         (Inter 24px bold)           │
│                                     │
│         $150.00                     │
│         (Orbitron 48px)             │
│                                     │
│         [Siguiente venta]           │
│         (Navy sólido)               │
└─────────────────────────────────────┘
```

### 7.3. Pantalla C — Cobrar a Distancia (Link Remoto)

**Objetivo:** El comerciante escribe el monto y genera un link para compartir.

**Estado 1 — Teclado:**

```
┌─────────────────────────────────────┐
│ ← Cobrar a distancia                │
├─────────────────────────────────────┤
│                                     │
│              $ 150.00               │
│         (Orbitron 56px, plano)      │
│                                     │
│    [Teclado numérico igual que B]   │
│                                     │
│         [Generar link]              │
│         (Navy sólido)               │
└─────────────────────────────────────┘
```

**Estado 2 — Link listo:**

```
┌─────────────────────────────────────┐
│ ← Cobrar a distancia                │
├─────────────────────────────────────┤
│                                     │
│         ✓ Link generado             │
│                                     │
│   https://pey.mx/p/abc123           │
│   (Inter 14px, line, padding 16px)  │
│                                     │
│         [Copiar link]               │
│         (Navy sólido)               │
│                                     │
│         [Compartir por WhatsApp]    │
│         (Blanco, borde line)        │
│                                     │
│         ⟳ Esperando pago…           │
│                                     │
│         [Cancelar]                  │
└─────────────────────────────────────┘
```

**Estado 3 — Pagado:**

Igual que Pantalla B, Estado 3.

---

## 8. Reglas de Oro de la Caja

### 8.1. DO

✅ **Un botón primario por pantalla.** Navy sólido, sin gradiente.
✅ **Monto en Orbitron 700, plano, centrado.** Sin sombra, sin cúpula.
✅ **Un solo oro por pantalla.** Solo en badge "Pagado" o corte del día.
✅ **Feedback inmediato.** Cambio de color, sin animación de hundimiento.
✅ **Lenguaje de mostrador.** "Cobrar aquí", "Cobrar a distancia", "Pagado".
✅ **Identidad visible.** Nombre del negocio y colonia siempre en el header.

### 8.2. DON'T

❌ **No uses cúpula de cristal** en la caja. Es para Ledger.
❌ **No uses Playfair** en la pantalla de cobro. Solo en el corte del día.
❌ **No uses oro en el botón "Cobrar".** Solo en "Pagado".
❌ **No uses `lcd-display`** para el historial. Lista blanca con `line`.
❌ **No uses animaciones lentas.** El comerciante tiene prisa.
❌ **No uses jerga técnica.** Nunca "CoDi", "QR", "API", "webhook".

---

## 9. CSS Variables

```css
:root {
  /* Heredados de design-system.md */
  --navy: #002b7f;
  --navy-2: #001a4d;
  --surface: #ffffff;
  --ink: #121a2e;
  --muted: #6b7a99;
  --line: #e8e0cc;
  --gold: #d4af37;
  --gold-light: #f5d97a;
  --gold-dark: #a8883f;

  /* Nuevos de la caja registradora */
  --paid: #16a34a;
  --waiting: #d97706;
  --expired: #dc2626;
  --offline: #6b7280;

  /* Safe Area (iOS) */
  --safe-area-inset-top: env(safe-area-inset-top, 0px);
  --safe-area-inset-bottom: env(safe-area-inset-bottom, 0px);
}
```

---

## 10. Checklist de Entrega

- [ ] Fuentes importadas: `Orbitron 700`, `Inter 400–700`.
- [ ] Variables CSS declaradas en `:root` (heredadas + nuevas).
- [ ] Componente `cash-amount` implementado.
- [ ] Componente `cash-keypad` implementado (3×4, 72px mínimo).
- [ ] Componente `cash-status` con 4 variantes (`waiting`, `paid`, `expired`, `offline`).
- [ ] Componente `cash-payment-list` implementado.
- [ ] Componente `cash-header` implementado.
- [ ] Pantalla A (Mostrador) implementada.
- [ ] Pantalla B (Cobrar aquí) con 3 estados implementada.
- [ ] Pantalla C (Cobrar a distancia) con 3 estados implementada.
- [ ] Regla del oro verificada: máximo 1 acento dorado por pantalla.
- [ ] Lenguaje de mostrador verificado: cero jerga técnica en la UI.
- [ ] Feedback inmediato verificado: sin animaciones de hundimiento.
- [ ] Legibilidad bajo el sol verificada: contraste AAA en montos y botones.
- [ ] **QR generado client-side** desde `qrString` (no `generateImage: true`).
- [ ] **Polling + webhook** funcionando (fallback dual).
- [ ] **Metadata rica** en cada request a Pey.
- [ ] **Offline-first** con IndexedDB + Service Worker.
- [ ] **Onboarding de merchant** con `/bank-account` documentado.

---

## 11. Arquitectura con Cloudflare Workers 🆕

### 11.1. Diagrama de Capas

```
┌─────────────────────────────────────────────────────────┐
│                    UI (R2 + HTML)                        │
│  - HTML autocontenido (Tailwind CDN + Vanilla JS)       │
│  - QR generado client-side (qrcode.js desde qrString)   │
│  - Polling cada 5s a /api/payment/:id                   │
│  - Service Worker para offline + caché                  │
│  - IndexedDB para cola de pagos offline                 │
└────────────────────┬────────────────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────────────┐
│              pey-worker (Cloudflare Worker)              │
│                                                          │
│  Routes:                                                 │
│  ├─ POST /api/codi/qr      → proxy a Pey /codi/qr       │
│  ├─ POST /api/codi/pn      → proxy a Pey /codi/pn       │
│  ├─ POST /api/payment-link → proxy a Pey /payment-link  │
│  ├─ GET  /api/payment/:id  → polling a Pey              │
│  ├─ POST /webhooks/pey     → recibir payment.confirmed  │
│  └─ GET  /api/merchant/:id → leer config desde D1       │
│                                                          │
│  Storage:                                                │
│  ├─ D1: merchants, payments, sessions                   │
│  ├─ KV: caché de merchant config, rate limiting         │
│  ├─ Queues: cola de webhooks (retry si falla)           │
│  └─ R2: logos de merchants, assets estáticos            │
└────────────────────┬────────────────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────────────┐
│                 Pey API (api.pey.mx)                     │
│  - Bearer token en Authorization                        │
│  - Rate limiting respetar                               │
│  - Webhooks → POST /webhooks/pey                        │
└─────────────────────────────────────────────────────────┘
```

### 11.2. Stack Técnico

| Capa | Tecnología | Justificación |
|---|---|---|
| **UI** | HTML + Tailwind CDN + Vanilla JS | 0 build, 0 deps, deploy en 3 min |
| **QR client-side** | `qrcode.js` | Pey recomienda no usar `generateImage` (lento) |
| **Edge compute** | Cloudflare Workers | Latencia <50ms desde México |
| **Base de datos** | D1 (SQLite) | Relacional, SQL, gratis hasta 5GB |
| **Caché** | KV | Config de merchant, rate limiting |
| **Cola** | Queues | Webhooks con retry automático |
| **Assets** | R2 | Logos, recibos, sin egress fees |
| **Estado en tiempo real** | Durable Objects (opcional) | Para cobros concurrentes en misma sesión |

### 11.3. Flujo de Datos — Cobro Presencial

```
1. Comerciante escribe $150.00 → UI
2. UI → POST /api/codi/qr { amount: 150, concept: "Venta", expiration: 600, metadata: {...} }
3. Worker → POST https://api.pey.mx/codi/qr (con Bearer token)
4. Pey → 201 { id: "AB12CD34EF", qrString: "{...}" }
5. Worker → 200 { qrString, qrId }
6. UI → genera QR client-side con qrcode.js(qrString)
7. UI → muestra QR + countdown timer (600s)
8. UI → polling cada 5s a GET /api/payment/codi/:qrId
9. Worker → GET https://api.pey.mx/transaction/codi/qr/:qrId
10. Pey → 200 { items: [{ status: "PAID", amount: 150, datePaid: 1704067260 }] }
11. Worker → actualiza D1: payments.status = "PAID"
12. Worker → 200 { status: "PAID", amount: 150 }
13. UI → muestra "¡Pagado!" + sonido + vibración
14. UI → botón "Siguiente venta" → vuelve a Pantalla A
```

### 11.4. Flujo de Datos — Cobro Remoto

```
1. Comerciante escribe $150.00 → UI
2. UI → POST /api/payment-link { amount: 150, successUrl, backUrl, metadata: {...} }
3. Worker → POST https://api.pey.mx/payment-link/create
4. Pey → 200 { id: "01HXYZ...", url: "https://app.mipey.mx/payment-link/..." }
5. Worker → guarda en D1: payment_links { id, url, status: "pending" }
6. Worker → 200 { url, paymentLinkId }
7. UI → muestra link + botones "Copiar" / "Compartir por WhatsApp"
8. UI → polling cada 5s a GET /api/payment/:paymentLinkId
9. Worker → GET https://api.pey.mx/payment-link/:id
10. Pey → 200 { status: "paid", transactions: [{...}] }
11. Worker → actualiza D1: payment_links.status = "paid"
12. Worker → 200 { status: "PAID", amount: 150 }
13. UI → muestra "¡Pagado!" + sonido + vibración
14. UI → botón "Siguiente venta" → vuelve a Pantalla A
```

---

## 12. Mapeo de Pantallas a Endpoints Pey 🆕

### 12.1. Tabla de Mapeo Directo

| Pantalla | Estado | Endpoint Pey | Método | Payload Clave |
|---|---|---|---|---|
| **B — Cobrar aquí** | Teclado | — | — | — |
| **B — Cobrar aquí** | Generar QR | `/codi/qr` | POST | `{ amount, concept, expiration: 600, numRef, metadata }` |
| **B — Cobrar aquí** | Esperando pago | `/transaction/codi/qr/{id}` | GET | Polling cada 5s |
| **B — Cobrar aquí** | Pagado | `/transaction/codi/qr/{id}` | GET | Confirmación final |
| **B — Cobrar aquí** | Expirado | `/codi/qr` | POST | Regenerar con nuevo `numRef` |
| **C — Cobrar a distancia** | Teclado | — | — | — |
| **C — Cobrar a distancia** | Generar link | `/payment-link/create` | POST | `{ amount, successUrl, backUrl, clientReferenceId, metadata }` |
| **C — Cobrar a distancia** | Link listo | `/payment-link/{id}` | GET | Polling cada 5s |
| **C — Cobrar a distancia** | Pagado | `/payment-link/{id}` | GET | Confirmación final |
| **A — Mostrador** | Lista de pagos | `/transaction/bank-account/{id}` | GET | Últimos 80 pagos |
| **Setup** | Onboarding | `/bank-account` | POST | `{ alias, name, clabe, entity }` |
| **Setup** | Verificar status | `/bank-account/{id}` | GET | Polling hasta `ACTIVE` |

### 12.2. Ejemplo de Payload — Generar QR

```json
// POST /api/codi/qr (nuestro worker)
// → POST https://api.pey.mx/codi/qr (Pey)
{
  "amount": 150.00,
  "concept": "Venta en mostrador",
  "expiration": 600,
  "numRef": "1234567",
  "bankAccountId": "01JBAVWE4NS5TGXHWGMX3KH23Q",
  "metadata": {
    "merchantId": "01JBAVWE4NS5TGXHWGMX3KH23Q",
    "deviceId": "taqueria-guero-pos-01",
    "sessionId": "sess_abc123",
    "source": "cash-register",
    "screen": "cobrar-aqui",
    "operator": "doña-maria"
  }
}
```

### 12.3. Ejemplo de Payload — Generar Link

```json
// POST /api/payment-link (nuestro worker)
// → POST https://api.pey.mx/payment-link/create (Pey)
{
  "amount": 150.00,
  "successUrl": "https://caja.arksystems.site/success?ref=abc123",
  "backUrl": "https://caja.arksystems.site/cancel?ref=abc123",
  "hasTip": false,
  "clientReferenceId": "venta-2026-11-08-001",
  "metadata": {
    "merchantId": "01JBAVWE4NS5TGXHWGMX3KH23Q",
    "deviceId": "taqueria-guero-pos-01",
    "sessionId": "sess_abc123",
    "source": "cash-register",
    "screen": "cobrar-distancia",
    "channel": "whatsapp"
  }
}
```

### 12.4. Ejemplo de Respuesta — QR Creado

```json
// 201 Created
{
  "id": "AB12CD34EF",
  "qrString": "{\"TYP\":1,\"v\":\"01\",\"ic\":0,\"IDC\":\"AB12CD34EF\"}",
  "qrImage": null
}
```

**Nota:** `qrImage` es `null` porque enviamos `generateImage: false`. Generamos el QR client-side con `qrcode.js` desde `qrString`. Más rápido, menos carga en Pey.

### 12.5. Ejemplo de Respuesta — Link Creado

```json
// 200 OK
{
  "id": "01HXYZ1234567890ABCDEFGH",
  "url": "https://app.mipey.mx/payment-link/01HXYZ1234567890ABCDEFGH"
}
```

---

## 13. Contrato de Webhooks 🆕

### 13.1. Webhooks que Escuchamos

| Evento | Origen | Acción en Worker |
|---|---|---|
| `payment.confirmed` | Pey | Actualizar `payments.status = "PAID"` en D1 |
| `bank-account.updated` | Pey | Actualizar `merchants.codiStatus = "ACTIVE"` en D1 |

### 13.2. Endpoint de Webhook

```
POST /webhooks/pey
Headers:
  X-Pey-Signature: <hmac-sha256>
  X-Pey-Timestamp: <unix-timestamp>
Body:
  { "event": "payment.confirmed", ... }
```

### 13.3. Payload — payment.confirmed

```json
{
  "event": "payment.confirmed",
  "transactionId": "01HXYZTXN1234567890ABCDE00",
  "amount": 150.00,
  "currency": "MXN",
  "paymentMethod": "CODI",
  "payableType": "API_CODI_QR",
  "payableId": "AB12CD34EF",
  "datePaid": 1704067260,
  "metadata": {
    "merchantId": "01JBAVWE4NS5TGXHWGMX3KH23Q",
    "sessionId": "sess_abc123",
    "source": "cash-register"
  }
}
```

### 13.4. Payload — bank-account.updated

```json
{
  "event": "bank-account.updated",
  "bankAccountId": "01JBAVWE4NS5TGXHWGMX3KH23Q",
  "codiStatus": "ACTIVE",
  "dateUpdated": 1704067260
}
```

### 13.5. Flujo de Procesamiento

```
1. Pey → POST /webhooks/pey (con firma HMAC)
2. Worker → valida firma + timestamp (anti-replay)
3. Worker → encola en Queues (retry automático si falla)
4. Queue consumer → actualiza D1: payments.status = "PAID"
5. Queue consumer → notifica a UI vía polling (próximo check ve "PAID")
6. Worker → 200 OK (ack a Pey)
```

### 13.6. Estrategia Híbrida: Webhook + Polling

| Escenario | Estrategia |
|---|---|
| Webhook llega rápido | UI ve "PAID" en <2s |
| Webhook tarda | Polling cada 5s detecta "PAID" |
| Webhook no llega | Polling cada 5s detecta "PAID" de todas formas |
| Webhook duplicado | D1 usa `transactionId` como PK, idempotente |

**Regla:** Nunca dependemos solo de webhooks. Polling es el fallback garantizado.

---

## 14. Estrategia de Metadata 🆕

### 14.1. Por Qué Metadata

Pey permite hasta 50 pares clave-valor por request. Lo usamos para:
- **Tracking:** saber qué dispositivo, operador, sesión generó el cobro
- **Analytics:** reportes por comercio, por hora, por operador
- **Reconciliación:** cruzar con Ledger, Contagram, Arkangel
- **Debug:** reproducir bugs con contexto completo

### 14.2. Keys Estándar

| Key | Tipo | Ejemplo | Descripción |
|---|---|---|---|
| `merchantId` | string | `01JBAVWE4NS5TGXHWGMX3KH23Q` | ULID del comercio |
| `deviceId` | string | `taqueria-guero-pos-01` | Identificador del dispositivo |
| `sessionId` | string | `sess_abc123` | Sesión de UI (para correlacionar) |
| `source` | string | `cash-register` | Origen del cobro |
| `screen` | string | `cobrar-aqui` / `cobrar-distancia` | Pantalla donde se generó |
| `operator` | string | `doña-maria` | Operador que cobró |
| `channel` | string | `whatsapp` / `sms` / `link` | Canal de envío (remoto) |
| `concept` | string | `Tacos al pastor` | Concepto libre del comercio |

### 14.3. Reglas de Metadata

✅ **Siempre incluir** `merchantId`, `deviceId`, `sessionId`, `source`.
✅ **Keys en camelCase**, máximo 40 caracteres.
✅ **Values escalares** (string, number, boolean, null), máximo 500 caracteres.
✅ **Máximo 50 pares** por request (límite de Pey).
❌ **No anidar objetos** ni arrays (Pey no lo permite).
❌ **No incluir datos sensibles** (CLABE, RFC, teléfono del cliente).

### 14.4. Ejemplo Completo

```json
{
  "amount": 150.00,
  "concept": "Tacos al pastor",
  "expiration": 600,
  "metadata": {
    "merchantId": "01JBAVWE4NS5TGXHWGMX3KH23Q",
    "deviceId": "taqueria-guero-pos-01",
    "sessionId": "sess_abc123",
    "source": "cash-register",
    "screen": "cobrar-aqui",
    "operator": "doña-maria",
    "concept": "Tacos al pastor"
  }
}
```

---

## 15. Onboarding de Merchant 🆕

### 15.1. Flujo de Alta

```
1. Comerciante ingresa datos en UI de onboarding
   - Nombre legal (RFC)
   - CLABE (18 dígitos)
   - Alias (ej: "BBVA")
   - Tipo de entidad (BUSINESS / PERSON)

2. UI → POST /api/merchant/register
3. Worker → POST https://api.pey.mx/bank-account
   {
     "alias": "BBVA",
     "name": "Taquería El Güero S.A. de C.V.",
     "clabe": "012180001234567899",
     "entity": "BUSINESS"
   }

4. Pey → 200 { id: "01JBAVWE4NS5TGXHWGMX3KH23Q", codiStatus: "PENDING" }

5. Worker → guarda en D1: merchants { id, alias, name, clabe, codiStatus: "PENDING" }

6. Pey registra con Banxico (5 días hábiles)

7. Pey → webhook bank-account.updated { codiStatus: "ACTIVE" }

8. Worker → actualiza D1: merchants.codiStatus = "ACTIVE"

9. UI → muestra "✅ Cuenta activada. Ya puedes recibir pagos."
```

### 15.2. Estados de codiStatus

| Status | Significado | Acción |
|---|---|---|
| `PENDING` | Recibido, no enviado a Banxico | Mostrar "En verificación" |
| `PROCESSING` | Registro con Banxico en progreso | Mostrar "Activando cuenta..." |
| `ACTIVE` | Registrado, puede recibir pagos | Mostrar "✅ CoDi activo" |
| `ERROR` | Registro falló | Mostrar error + botón "Reintentar" |

### 15.3. Verificación de Status

```
// UI → polling cada 30s durante onboarding
GET /api/merchant/:id
→ Worker → GET https://api.pey.mx/bank-account/:id
→ Pey → 200 { codiStatus: "ACTIVE" }
→ Worker → 200 { codiStatus: "ACTIVE" }
→ UI → muestra "✅ CoDi activo"
```

---

## 16. Estrategia Offline 🆕

### 16.1. El Problema

En México, muchos comercios tienen internet intermitente. La caja debe seguir funcionando aunque se caa la conexión.

### 16.2. Solución: Offline-First

```
┌─────────────────────────────────────────┐
│              UI (Browser)                │
│                                          │
│  ┌──────────────────────────────────┐   │
│  │  IndexedDB                        │   │
│  │  ├─ payments_queue (cola offline) │   │
│  │  ├─ merchant_config (caché)       │   │
│  │  └─ sync_log (log de sincronizac.)│   │
│  └──────────────────────────────────┘   │
│                                          │
│  ┌──────────────────────────────────┐   │
│  │  Service Worker                   │   │
│  │  ├─ Cache API (assets estáticos)  │   │
│  │  └─ Background Sync (retry)       │   │
│  └──────────────────────────────────┘   │
└────────────────────┬─────────────────────┘
                     │
                     ↓ (si hay conexión)
              pey-worker
```

### 16.3. Flujo Offline

```
1. Comerciante escribe $150.00 → UI
2. UI → detecta offline (navigator.onLine = false)
3. UI → guarda en IndexedDB: payments_queue { amount: 150, timestamp: 1704067200, status: "queued" }
4. UI → muestra "⏸ Sin conexión. Pago en cola."
5. UI → permite seguir cobrando (agrega más pagos a la cola)

6. (Vuelve la conexión)
7. Service Worker → evento "sync"
8. SW → lee payments_queue de IndexedDB
9. SW → POST /api/codi/qr por cada pago en cola
10. Worker → Pey → 201 { qrString }
11. SW → actualiza IndexedDB: status = "synced"
12. UI → muestra "✅ Pagos sincronizados"
```

### 16.4. Resolución de Conflictos

| Conflicto | Estrategia |
|---|---|
| Mismo folio generado offline y online | ULID como PK, idempotente |
| Pago duplicado | `transactionId` de Pey como PK en D1 |
| Merchant config desactualizada | Caché con TTL 5 min, refetch al volver online |

### 16.5. Service Worker — Caché de Assets

```javascript
// sw.js
const CACHE_NAME = 'ark-caja-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/fonts/orbitron.woff2',
  '/fonts/inter.woff2'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
```

---

## 17. Plan de Fallback y Errores 🆕

### 17.1. Matriz de Errores

| Error Pey | Código | Acción en Worker | Mensaje en UI |
|---|---|---|---|
| `INVALID_AMOUNT` | 400 | Rechazar request | "Monto inválido" |
| `INVALID_PARAMETER` | 400 | Rechazar request | "Parámetro inválido" |
| `INVALID_STATE` | 400 | Mostrar error | "CoDi no habilitado. Contacta soporte." |
| `PEY_CONSISTENCY_ERROR` | 400 | Mostrar error | "Error de configuración. Contacta soporte." |
| `SERVICE_UNAVAILABLE` | 503 | Retry 3x con backoff | "Servicio temporalmente no disponible" |
| `INTERNAL_SERVER_ERROR` | 500 | Retry 3x con backoff | "Error interno. Intenta de nuevo." |
| `NOT_FOUND` | 404 | Mostrar error | "Recurso no encontrado" |
| `FORBIDDEN` | 403 | Mostrar error | "No tienes permiso para esta operación" |

### 17.2. Estrategia de Retry

```javascript
// Worker: retry con backoff exponencial
async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.status === 503 || response.status === 500) {
        if (i < maxRetries - 1) {
          await sleep(Math.pow(2, i) * 1000); // 1s, 2s, 4s
          continue;
        }
      }
      return response;
    } catch (error) {
      if (i < maxRetries - 1) {
        await sleep(Math.pow(2, i) * 1000);
        continue;
      }
      throw error;
    }
  }
}
```

### 17.3. Plan de Fallback por Escenario

| Escenario | Fallback |
|---|---|
| Pey API truena | Mostrar "Servicio no disponible" + botón "Reintentar" |
| Webhook no llega | Polling cada 5s detecta pago de todas formas |
| QR expira | Auto-regenerar con nuevo `/codi/qr` + nuevo `numRef` |
| Internet del merchant cae | IndexedDB offline + sync al reconectar |
| Merchant no tiene CoDi activo | Mostrar "Cuenta en verificación" + link a onboarding |
| Monto inválido | Validar client-side antes de enviar a Pey |
| Duplicado de pago | `transactionId` de Pey como PK, idempotente |

### 17.4. Logs y Debug

```javascript
// Worker: log estructurado
console.log(JSON.stringify({
  timestamp: new Date().toISOString(),
  level: 'info',
  event: 'codi.qr.created',
  merchantId: '01JBAVWE4NS5TGXHWGMX3KH23Q',
  qrId: 'AB12CD34EF',
  amount: 150.00,
  requestId: 'abc123-def456-ghi789'
}));
```

### 17.5. Monitoreo

| Métrica | Target | Alerta |
|---|---|---|
| Tiempo de respuesta Pey | <2s | >5s |
| Tasa de error | <1% | >5% |
| Tasa de expiración QR | <5% | >10% |
| Tasa de offline | <10% | >20% |
| Webhooks recibidos | 100% | <95% |

---

## 18. Métricas de Éxito 🆕

### 18.1. KPIs del Producto

| Métrica | Target | Por qué importa |
|---|---|---|
| **Tiempo por cobro** | <15 segundos | El comerciante tiene prisa |
| **Tasa de expiración** | <5% | Si expira mucho, el QR no sirve |
| **Tasa de offline** | <10% | Si hay mucho offline, la infra falla |
| **Tasa de error** | <1% | Si truena mucho, el comerciante abandona |
| **Adopción** | 100 comercios en 30 días | Validación de producto |
| **Retención** | 80% a 30 días | Producto útil |

### 18.2. Métricas Técnicas

| Métrica | Target | Herramienta |
|---|---|---|
| Latencia Pey API | <2s | Cloudflare Analytics |
| Uptime Worker | 99.9% | Cloudflare Status |
| Uptime D1 | 99.9% | Cloudflare Status |
| Tasa de webhook | 100% | Logs de Worker |
| Tasa de polling | <5s | Logs de UI |

---

## 19. Integraciones con Ecosistema ARK 🆕

### 19.1. Ledger (Contabilidad)

```
Evento: payment.confirmed
→ Worker → POST /api/ledger/entry
→ Ledger → registra en libro diario
→ D1: ledger_entries { debit: "Banco", credit: "Ventas", amount: 150 }
```

### 19.2. Contagram (CFDI)

```
Evento: daily.close
→ Worker → POST /api/contagram/export
→ Contagram → genera CFDI global del día
→ D1: cfdi_records { date: "2026-11-08", total: 15000, uuid: "..." }
```

### 19.3. Arkangel (Cobranza)

```
Evento: payment.confirmed (con metadata.deudorId)
→ Worker → POST /api/arkangel/payment
→ Arkangel → actualiza saldo de deudor
→ D1: deudores { id: "...", saldo: 0 }
```

---

## 20. Roadmap Post-Hackathon 🆕

### 20.1. Fase 1 — MVP (Hackathon)

- [x] Pantalla A (Mostrador)
- [x] Pantalla B (Cobrar aquí)
- [x] Pantalla C (Cobrar a distancia)
- [x] Integración Pey API
- [x] QR client-side
- [x] Polling + webhook
- [x] Offline básico (IndexedDB)

### 20.2. Fase 2 — Producción (30 días)

- [ ] Onboarding de merchant completo
- [ ] Reportes básicos (ventas del día, semana, mes)
- [ ] Multi-operador (varios cajeros por comercio)
- [ ] Recibos digitales (email, WhatsApp)
- [ ] Integración con Ledger

### 20.3. Fase 3 — Escala (90 días)

- [ ] Integración con Contagram (CFDI)
- [ ] Integración con Arkangel (cobranza)
- [ ] Modo oscuro
- [ ] Modo tablet (pantallas más grandes)
- [ ] API pública para terceros

---

## 21. Glosario 🆕

| Término | Significado |
|---|---|
| **CoDi** | Cobro Digital. Sistema de pagos por QR de Banxico. |
| **QR** | Quick Response. Código bidimensional que contiene datos de pago. |
| **ULID** | Universally Unique Lexicographically Sortable Identifier. ID único ordenable. |
| **CLABE** | Clave Bancaria Estandarizada. 18 dígitos que identifican una cuenta en México. |
| **IDC** | Identificador de CoDi. Asignado por Banxico a cada QR. |
| **Metadata** | Pares clave-valor para adjuntar datos custom a un pago. |
| **Webhook** | Notificación HTTP que Pey envía cuando ocurre un evento. |
| **Polling** | Consultar periódicamente el estado de un recurso. |
| **Offline-first** | Estrategia donde la app funciona sin internet y sincroniza después. |
| **Service Worker** | Script que corre en background, permite caché y offline. |
| **IndexedDB** | Base de datos en el navegador para almacenamiento offline. |

---

## 22. Recursos 🆕

### 22.1. Documentación Pey

- [API Reference](https://docs.pey.mx/docs/api)
- [CoDi QR](https://docs.pey.mx/docs/api/codi-qr)
- [Payment Link](https://docs.pey.mx/docs/api/payment-link)
- [Webhooks](https://docs.pey.mx/docs/webhooks)
- [Test in Production](https://docs.pey.mx/docs/tutorials/getting-started/create-an-api-key#test-in-production)

### 22.2. Documentación Cloudflare

- [Workers](https://developers.cloudflare.com/workers/)
- [D1](https://developers.cloudflare.com/d1/)
- [KV](https://developers.cloudflare.com/kv/)
- [Queues](https://developers.cloudflare.com/queues/)
- [R2](https://developers.cloudflare.com/r2/)

### 22.3. Contacto Pey

- **Email:** ramon@pey.mx
- **Soporte:** support@pey.mx

---

**Fin del documento.**
