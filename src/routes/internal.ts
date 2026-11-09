import { Hono } from 'hono';
import { Env } from '../types';
import { staypuftAuth } from '../middleware/staypuftAuth';
import { evaluadorActividadesVulnerables } from '../services/lfpiorpi';

export const internalRouter = new Hono<{ Bindings: Env }>();

// Aplicar autenticación StayPuft a todos los endpoints del namespace
internalRouter.use('*', staypuftAuth);

// Helper para paginación segura (Protección de cuotas D1)
function parsePagination(c: any): { limit: number; offset: number; error?: string } {
  const limitParam = c.req.query('limit');
  const offsetParam = c.req.query('offset');

  let limit = 20;
  if (limitParam !== undefined) {
    const parsed = parseInt(limitParam, 10);
    if (isNaN(parsed) || parsed < 1) {
      return { limit: 20, offset: 0, error: 'El parámetro limit debe ser un número entero mayor a 0' };
    }
    if (parsed > 100) {
      return { limit: 100, offset: 0, error: 'El límite máximo por consulta es de 100 registros' };
    }
    limit = parsed;
  }

  let offset = 0;
  if (offsetParam !== undefined) {
    const parsed = parseInt(offsetParam, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      offset = parsed;
    }
  }

  return { limit, offset };
}

// Helper para enmascarar CLABE (solo últimos 4 dígitos)
function maskClabe(clabe?: string | null): string | null {
  if (!clabe) return null;
  const clean = String(clabe).trim();
  if (clean.length < 4) return '****';
  return `**************${clean.slice(-4)}`;
}

// Helper para enmascarar RFC
function maskTaxId(taxId?: string | null): string | null {
  if (!taxId) return null;
  const clean = String(taxId).trim();
  if (clean.length < 6) return '****';
  return `${clean.slice(0, 3)}****${clean.slice(-3)}`;
}

// 1. GET /api/internal/status — Salud operativa, bindings, conteo y alcanzabilidad
internalRouter.get('/status', async (c) => {
  const dbBound = Boolean(c.env.DB);
  const kvBound = Boolean(c.env.KV);

  let merchantCount = 0;
  let lastWebhookReceived: any = null;
  let lastPaymentConfirmed: any = null;

  if (c.env.DB) {
    const countRes: any = await c.env.DB.prepare('SELECT COUNT(*) as count FROM merchants').first();
    merchantCount = countRes?.count || 0;

    lastWebhookReceived = await c.env.DB.prepare(`
      SELECT event_type, received_at FROM webhook_events ORDER BY received_at DESC LIMIT 1
    `).first();

    lastPaymentConfirmed = await c.env.DB.prepare(`
      SELECT id, amount, date_paid FROM payments WHERE status = 'PAID' ORDER BY date_paid DESC LIMIT 1
    `).first();
  }

  // Comprobar alcanzabilidad real de api.pey.mx (sin exponer secrets)
  let peyReachable = false;
  let peyStatusMsg = 'Desconocido';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    const peyRes = await fetch(c.env.PEY_API_URL || 'https://api.pey.mx', {
      method: 'GET',
      signal: controller.signal
    });
    clearTimeout(timeout);
    peyReachable = peyRes.status < 500;
    peyStatusMsg = `HTTP ${peyRes.status}`;
  } catch (err: any) {
    peyReachable = false;
    peyStatusMsg = err.name === 'AbortError' ? 'Timeout (>2.5s)' : (err.message || 'Error de red');
  }

  return c.json({
    service: 'ark-cash-register',
    workerVersion: c.env.APP_VERSION || '2.0.0',
    environment: c.env.ENVIRONMENT || 'development',
    timestamp: new Date().toISOString(),
    bindings: {
      d1Database: dbBound,
      kvCache: kvBound
    },
    metricsSummary: {
      registeredMerchants: merchantCount,
      lastWebhook: lastWebhookReceived ? {
        eventType: lastWebhookReceived.event_type,
        receivedAt: lastWebhookReceived.received_at
      } : null,
      lastPaymentConfirmed: lastPaymentConfirmed ? {
        paymentId: lastPaymentConfirmed.id,
        amount: lastPaymentConfirmed.amount,
        datePaid: lastPaymentConfirmed.date_paid
      } : null
    },
    peyApiReachability: {
      url: c.env.PEY_API_URL || 'https://api.pey.mx',
      reachable: peyReachable,
      status: peyStatusMsg
    }
  });
});

// 2. GET /api/internal/merchants — Lista de comercios paginada con CLABE enmascarada
internalRouter.get('/merchants', async (c) => {
  const { limit, offset, error } = parsePagination(c);
  if (error) {
    return c.json({ error: { message: error, type: 'INVALID_PARAMETER' } }, 400);
  }

  if (!c.env.DB) {
    return c.json({ error: { message: 'D1 no configurado', type: 'D1_UNAVAILABLE' } }, 503);
  }

  const countRes: any = await c.env.DB.prepare('SELECT COUNT(*) as total FROM merchants').first();
  const total = countRes?.total || 0;

  const rows = await c.env.DB.prepare(`
    SELECT id, alias, name, clabe, entity, tax_id, codi_status, created_at, updated_at
    FROM merchants
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).bind(limit, offset).all();

  const merchants = (rows.results || []).map((m: any) => ({
    id: m.id,
    alias: m.alias,
    name: m.name,
    maskedClabe: maskClabe(m.clabe),
    entity: m.entity,
    maskedTaxId: maskTaxId(m.tax_id),
    codiStatus: m.codi_status,
    createdAt: m.created_at,
    updatedAt: m.updated_at
  }));

  return c.json({
    total,
    limit,
    offset,
    merchants
  });
});

// 3. GET /api/internal/merchants/:id — Detalle de comercio con resumen de pagos
internalRouter.get('/merchants/:id', async (c) => {
  const merchantId = c.req.param('id');
  if (!c.env.DB) {
    return c.json({ error: { message: 'D1 no configurado', type: 'D1_UNAVAILABLE' } }, 503);
  }

  const merchant: any = await c.env.DB.prepare(
    'SELECT * FROM merchants WHERE id = ? LIMIT 1'
  ).bind(merchantId).first();

  if (!merchant) {
    return c.json({ error: { message: 'Comercio no encontrado', type: 'NOT_FOUND' } }, 404);
  }

  // Resumen de pagos de hoy
  const now = Math.floor(Date.now() / 1000);
  const startOfDay = now - (now % 86400);

  const paymentsSummary: any = await c.env.DB.prepare(`
    SELECT 
      COUNT(*) as totalCount,
      SUM(CASE WHEN status = 'PAID' THEN amount ELSE 0 END) as totalAmountPaid,
      SUM(CASE WHEN status = 'PAID' THEN 1 ELSE 0 END) as paidCount,
      SUM(CASE WHEN status = 'WAITING' THEN 1 ELSE 0 END) as waitingCount,
      SUM(CASE WHEN status = 'EXPIRED' THEN 1 ELSE 0 END) as expiredCount
    FROM payments
    WHERE merchant_id = ? AND date_created >= ?
  `).bind(merchantId, startOfDay).first();

  // Último corte del día
  const lastClose: any = await c.env.DB.prepare(`
    SELECT * FROM daily_closes WHERE merchant_id = ? ORDER BY created_at DESC LIMIT 1
  `).bind(merchantId).first();

  return c.json({
    id: merchant.id,
    alias: merchant.alias,
    name: merchant.name,
    maskedClabe: maskClabe(merchant.clabe),
    entity: merchant.entity,
    maskedTaxId: maskTaxId(merchant.tax_id),
    codiStatus: merchant.codi_status,
    errorMessage: merchant.error_message || null,
    createdAt: merchant.created_at,
    todaySummary: {
      totalSalesAmount: paymentsSummary?.totalAmountPaid || 0,
      paidCount: paymentsSummary?.paidCount || 0,
      waitingCount: paymentsSummary?.waitingCount || 0,
      expiredCount: paymentsSummary?.expiredCount || 0
    },
    lastCloseDay: lastClose ? {
      closeId: lastClose.id,
      cutDate: lastClose.cut_date,
      totalSales: lastClose.total_sales,
      totalTransactions: lastClose.total_transactions,
      createdAt: lastClose.created_at
    } : null
  });
});

// 4. GET /api/internal/payments — Lista de pagos paginada (SIN qrString completo)
internalRouter.get('/payments', async (c) => {
  const { limit, offset, error } = parsePagination(c);
  if (error) {
    return c.json({ error: { message: error, type: 'INVALID_PARAMETER' } }, 400);
  }

  if (!c.env.DB) {
    return c.json({ error: { message: 'D1 no configurado', type: 'D1_UNAVAILABLE' } }, 503);
  }

  const merchantId = c.req.query('merchant_id');
  const statusFilter = c.req.query('status');

  // Si se pasa merchant_id, verificar que exista (fail-closed)
  if (merchantId) {
    const merchant = await c.env.DB.prepare('SELECT id FROM merchants WHERE id = ? LIMIT 1').bind(merchantId).first();
    if (!merchant) {
      return c.json({ error: { message: 'Comercio especificado no existe', type: 'NOT_FOUND' } }, 404);
    }
  }

  let whereClauses: string[] = [];
  let params: any[] = [];

  if (merchantId) {
    whereClauses.push('merchant_id = ?');
    params.push(merchantId);
  }

  if (statusFilter) {
    whereClauses.push('status = ?');
    params.push(statusFilter.toUpperCase());
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const countRes: any = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM payments ${whereSql}`
  ).bind(...params).first();
  const total = countRes?.total || 0;

  const rows = await c.env.DB.prepare(`
    SELECT id, merchant_id, payable_type, payable_id, amount, concept, num_ref, status, transaction_id, payment_method, date_created, date_paid
    FROM payments
    ${whereSql}
    ORDER BY date_created DESC
    LIMIT ? OFFSET ?
  `).bind(...params, limit, offset).all();

  const payments = (rows.results || []).map((p: any) => ({
    id: p.id,
    merchantId: p.merchant_id,
    payableType: p.payable_type,
    payableId: p.payable_id,
    amount: p.amount,
    concept: p.concept,
    numRef: p.num_ref,
    status: p.status,
    transactionId: p.transaction_id,
    paymentMethod: p.payment_method,
    dateCreated: p.date_created,
    datePaid: p.date_paid
  }));

  return c.json({
    total,
    limit,
    offset,
    payments
  });
});

// 5. GET /api/internal/payments/:id — Detalle de un pago con eventos de webhooks
internalRouter.get('/payments/:id', async (c) => {
  const paymentId = c.req.param('id');
  if (!c.env.DB) {
    return c.json({ error: { message: 'D1 no configurado', type: 'D1_UNAVAILABLE' } }, 503);
  }

  const payment: any = await c.env.DB.prepare(
    'SELECT * FROM payments WHERE id = ? OR payable_id = ? LIMIT 1'
  ).bind(paymentId, paymentId).first();

  if (!payment) {
    return c.json({ error: { message: 'Pago no encontrado', type: 'NOT_FOUND' } }, 404);
  }

  // Eventos de webhook asociados
  const webhooks = await c.env.DB.prepare(`
    SELECT id, event_type, transaction_id, received_at, processed
    FROM webhook_events
    WHERE transaction_id = ? OR payload LIKE ?
    ORDER BY received_at DESC
    LIMIT 20
  `).bind(payment.transaction_id || payment.payable_id, `%${payment.payable_id}%`).all();

  return c.json({
    id: payment.id,
    merchantId: payment.merchant_id,
    payableType: payment.payable_type,
    payableId: payment.payable_id,
    amount: payment.amount,
    concept: payment.concept,
    numRef: payment.num_ref,
    status: payment.status,
    transactionId: payment.transaction_id,
    paymentMethod: payment.payment_method,
    dateCreated: payment.date_created,
    datePaid: payment.date_paid,
    hasQrString: Boolean(payment.qr_string),
    webhookEvents: webhooks.results || []
  });
});

// 6. GET /api/internal/ledger — Asientos de ledger_entries
internalRouter.get('/ledger', async (c) => {
  const { limit, offset, error } = parsePagination(c);
  if (error) {
    return c.json({ error: { message: error, type: 'INVALID_PARAMETER' } }, 400);
  }

  if (!c.env.DB) {
    return c.json({ error: { message: 'D1 no configurado', type: 'D1_UNAVAILABLE' } }, 503);
  }

  const merchantId = c.req.query('merchant_id');
  if (merchantId) {
    const merchant = await c.env.DB.prepare('SELECT id FROM merchants WHERE id = ? LIMIT 1').bind(merchantId).first();
    if (!merchant) {
      return c.json({ error: { message: 'Comercio especificado no existe', type: 'NOT_FOUND' } }, 404);
    }
  }

  const whereSql = merchantId ? 'WHERE merchant_id = ?' : '';
  const params = merchantId ? [merchantId] : [];

  const countRes: any = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM ledger_entries ${whereSql}`
  ).bind(...params).first();
  const total = countRes?.total || 0;

  const rows = await c.env.DB.prepare(`
    SELECT id, payment_id, merchant_id, transaction_id, debit_account, credit_account, amount, concept, created_at
    FROM ledger_entries
    ${whereSql}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).bind(...params, limit, offset).all();

  return c.json({
    total,
    limit,
    offset,
    entries: rows.results || []
  });
});

// 7. GET /api/internal/webhooks — Eventos de webhook_events (SIN secretos ni firmas expuestas)
internalRouter.get('/webhooks', async (c) => {
  const { limit, offset, error } = parsePagination(c);
  if (error) {
    return c.json({ error: { message: error, type: 'INVALID_PARAMETER' } }, 400);
  }

  if (!c.env.DB) {
    return c.json({ error: { message: 'D1 no configurado', type: 'D1_UNAVAILABLE' } }, 503);
  }

  const statusFilter = c.req.query('status'); // 'ok' | 'failed'
  let whereSql = '';
  let params: any[] = [];

  if (statusFilter === 'ok') {
    whereSql = 'WHERE processed = 1';
  } else if (statusFilter === 'failed') {
    whereSql = 'WHERE processed = 0';
  }

  const countRes: any = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM webhook_events ${whereSql}`
  ).bind(...params).first();
  const total = countRes?.total || 0;

  const rows = await c.env.DB.prepare(`
    SELECT id, event_type, transaction_id, received_at, processed,
           CASE WHEN signature IS NOT NULL THEN 1 ELSE 0 END as hasSignature
    FROM webhook_events
    ${whereSql}
    ORDER BY received_at DESC
    LIMIT ? OFFSET ?
  `).bind(...params, limit, offset).all();

  return c.json({
    total,
    limit,
    offset,
    events: rows.results || []
  });
});

// 8. GET /api/internal/close-days — Historial de cortes del día
internalRouter.get('/close-days', async (c) => {
  const { limit, offset, error } = parsePagination(c);
  if (error) {
    return c.json({ error: { message: error, type: 'INVALID_PARAMETER' } }, 400);
  }

  if (!c.env.DB) {
    return c.json({ error: { message: 'D1 no configurado', type: 'D1_UNAVAILABLE' } }, 503);
  }

  const merchantId = c.req.query('merchant_id');
  if (merchantId) {
    const merchant = await c.env.DB.prepare('SELECT id FROM merchants WHERE id = ? LIMIT 1').bind(merchantId).first();
    if (!merchant) {
      return c.json({ error: { message: 'Comercio especificado no existe', type: 'NOT_FOUND' } }, 404);
    }
  }

  const whereSql = merchantId ? 'WHERE merchant_id = ?' : '';
  const params = merchantId ? [merchantId] : [];

  const countRes: any = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM daily_closes ${whereSql}`
  ).bind(...params).first();
  const total = countRes?.total || 0;

  const rows = await c.env.DB.prepare(`
    SELECT id, merchant_id, cut_date, total_sales, total_paid, total_transactions, ceremonial_title, created_at
    FROM daily_closes
    ${whereSql}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).bind(...params, limit, offset).all();

  return c.json({
    total,
    limit,
    offset,
    closes: rows.results || []
  });
});

// 9. GET /api/internal/metrics — Métricas de operador (Sin estimaciones ficticias)
internalRouter.get('/metrics', async (c) => {
  if (!c.env.DB) {
    return c.json({ error: { message: 'D1 no configurado', type: 'D1_UNAVAILABLE' } }, 503);
  }

  const now = Math.floor(Date.now() / 1000);
  const startOfDay = now - (now % 86400);

  // Totales de hoy
  const todayRes: any = await c.env.DB.prepare(`
    SELECT 
      COUNT(*) as totalCount,
      SUM(CASE WHEN status = 'PAID' THEN amount ELSE 0 END) as totalAmountPaid,
      SUM(CASE WHEN status = 'PAID' THEN 1 ELSE 0 END) as paidCount,
      SUM(CASE WHEN status = 'WAITING' THEN 1 ELSE 0 END) as waitingCount,
      SUM(CASE WHEN status = 'EXPIRED' THEN 1 ELSE 0 END) as expiredCount
    FROM payments
    WHERE date_created >= ?
  `).bind(startOfDay).first();

  // Comercios activos
  const merchantsRes: any = await c.env.DB.prepare(`
    SELECT 
      COUNT(*) as totalMerchants,
      SUM(CASE WHEN codi_status = 'ACTIVE' THEN 1 ELSE 0 END) as activeMerchants
    FROM merchants
  `).first();

  // Webhooks fallidos recientes (últimas 24 horas)
  const failedWhRes: any = await c.env.DB.prepare(`
    SELECT COUNT(*) as failedCount 
    FROM webhook_events 
    WHERE processed = 0 AND received_at >= ?
  `).bind(now - 86400).first();

  // Último corte de caja registrado
  const lastClose: any = await c.env.DB.prepare(`
    SELECT * FROM daily_closes ORDER BY created_at DESC LIMIT 1
  `).first();

  return c.json({
    timestamp: now,
    today: {
      totalSalesAmount: todayRes?.totalAmountPaid || 0,
      totalPaymentsCount: todayRes?.totalCount || 0,
      paidCount: todayRes?.paidCount || 0,
      waitingCount: todayRes?.waitingCount || 0,
      expiredCount: todayRes?.expiredCount || 0
    },
    merchants: {
      total: merchantsRes?.totalMerchants || 0,
      active: merchantsRes?.activeMerchants || 0
    },
    systemHealth: {
      failedWebhooksLast24h: failedWhRes?.failedCount || 0,
      lastGlobalClose: lastClose ? {
        cutDate: lastClose.cut_date,
        totalSales: lastClose.total_sales,
        createdAt: lastClose.created_at
      } : null
    }
  });
});

// 10. POST /api/internal/lfpiorpi/evaluar — Servicio compartido de Compliance LFPIORPI
internalRouter.post('/lfpiorpi/evaluar', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { merchantId, customerId = 'Cliente', customerRfc, currentAmountMxn = 0 } = body;

  if (!merchantId) {
    return c.json({ error: { message: 'merchantId es requerido', type: 'MISSING_MERCHANT_ID' } }, 400);
  }

  const dictamen = await evaluadorActividadesVulnerables({
    merchantId,
    customerId,
    customerRfc,
    currentAmountMxn: Number(currentAmountMxn),
    db: c.env.DB
  });

  return c.json({
    success: true,
    dictamen
  });
});
