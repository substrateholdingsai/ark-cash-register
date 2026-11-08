import { Hono } from 'hono';
import { Env } from '../types';
import { PeyClient } from '../services/peyClient';
import { generateUlid } from '../utils/ulid';
import { validateClabe, getBankFromClabe } from '../utils/clabe';
import { getCatalogForMerchant } from '../data/catalogs';
import { requireMerchantAuth } from '../middleware/auth';

export const merchantRouter = new Hono<{ Bindings: Env }>();

// Endpoint de diagnóstico rápido de CLABE para el Onboarding interactivo
merchantRouter.get('/validate-clabe/:clabe', (c) => {
  const clabe = c.req.param('clabe');
  const result = validateClabe(clabe);
  return c.json(result);
});

// Catálogo de productos rápidos y reglas de negocio para el carrito de mostrador
merchantRouter.get('/:id/catalog', async (c) => {
  const merchantId = c.req.param('id');
  if (c.env.KV) {
    const cached = await c.env.KV.get(`catalog:${merchantId}`, 'json');
    if (cached) return c.json(cached);
  }
  const catalog = getCatalogForMerchant(merchantId);
  return c.json(catalog);
});

// Registrar cuenta bancaria para CoDi (Onboarding)
merchantRouter.post('/register', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { alias, name, clabe, entity, taxId } = body;

  if (!alias || !name || !clabe || !entity) {
    return c.json({
      error: { message: 'alias, name, clabe y entity son requeridos', type: 'INCOMPLETE_PARAMETERS' }
    }, 400);
  }

  const clabeCheck = validateClabe(clabe);
  if (!clabeCheck.valid) {
    return c.json({
      error: { message: clabeCheck.error || 'La CLABE debe contener 18 dígitos válidos', type: 'INVALID_CLABE' }
    }, 400);
  }

  const client = new PeyClient(c.env.PEY_API_URL, c.env.PEY_API_KEY);
  try {
    const peyRes = await client.registerBankAccount({
      alias,
      name,
      clabe,
      entity
    });

    const now = Math.floor(Date.now() / 1000);
    const merchantId = peyRes.id;

    if (c.env.DB) {
      await c.env.DB.prepare(`
        INSERT INTO merchants (id, alias, name, clabe, entity, tax_id, codi_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(clabe) DO UPDATE SET
          alias = excluded.alias,
          name = excluded.name,
          updated_at = excluded.updated_at
      `).bind(
        merchantId,
        alias,
        name,
        clabe,
        entity,
        taxId || null,
        peyRes.codiStatus,
        now,
        now
      ).run();
    }

    // Cachear en KV para resolución edge inmediata
    if (c.env.KV) {
      await c.env.KV.put(`merchant:${merchantId}`, JSON.stringify({
        id: merchantId,
        alias,
        name,
        clabe: `**************${clabe.slice(-4)}`,
        entity,
        taxId: taxId || null,
        bank: clabeCheck.bank,
        codiStatus: peyRes.codiStatus,
        dateCreated: now
      }), { expirationTtl: 86400 });
    }

    return c.json({
      success: true,
      merchantId,
      alias,
      name,
      bank: clabeCheck.bank,
      codiStatus: peyRes.codiStatus,
      message: peyRes.codiStatus === 'ACTIVE' 
        ? 'Cuenta CoDi activada inmediatamente' 
        : 'Cuenta enviada a registro con Banxico (en verificación)'
    }, 201);
  } catch (err: any) {
    return c.json({
      error: {
        message: err.message,
        type: err.details?.error?.type || 'REGISTRATION_ERROR'
      }
    }, err.status || 500);
  }
});

// Obtener estado del comercio
merchantRouter.get('/:id', async (c) => {
  const merchantId = c.req.param('id');

  // 1. Revisar caché KV en el Edge
  if (c.env.KV) {
    const cached = await c.env.KV.get(`merchant:${merchantId}`, 'json');
    if (cached) {
      return c.json(cached);
    }
  }

  let merchant: any = null;
  if (c.env.DB) {
    merchant = await c.env.DB.prepare(
      'SELECT * FROM merchants WHERE id = ? LIMIT 1'
    ).bind(merchantId).first();
  }

  // Si no está en BD local, intentar sincronizar con Pey:
  const isProd = c.env.ENVIRONMENT === 'production';
  const client = new PeyClient(c.env.PEY_API_URL, c.env.PEY_API_KEY, isProd);
  try {
    const peyData = await client.getBankAccount(merchantId);
    if (c.env.DB && merchant && peyData.codiStatus !== merchant.codi_status) {
      await c.env.DB.prepare(
        'UPDATE merchants SET codi_status = ?, updated_at = ? WHERE id = ?'
      ).bind(peyData.codiStatus, Math.floor(Date.now() / 1000), merchantId).run();
    }

    const payload = {
      id: peyData.id,
      alias: peyData.alias,
      name: peyData.name,
      clabe: peyData.clabe ? `**************${peyData.clabe.slice(-4)}` : undefined,
      entity: peyData.entity,
      taxId: peyData.taxId,
      bank: getBankFromClabe(peyData.clabe || '')?.name,
      codiStatus: peyData.codiStatus,
      dateCreated: peyData.dateCreated
    };

    if (c.env.KV) {
      await c.env.KV.put(`merchant:${merchantId}`, JSON.stringify(payload), { expirationTtl: 3600 });
    }

    return c.json(payload);
  } catch (err) {
    if (merchant) {
      const payload = {
        id: merchant.id,
        alias: merchant.alias,
        name: merchant.name,
        clabe: merchant.clabe ? `**************${merchant.clabe.slice(-4)}` : undefined,
        entity: merchant.entity,
        taxId: merchant.tax_id,
        bank: getBankFromClabe(merchant.clabe || '')?.name,
        codiStatus: merchant.codi_status
      };

      if (c.env.KV) {
        await c.env.KV.put(`merchant:${merchantId}`, JSON.stringify(payload), { expirationTtl: 3600 });
      }

      return c.json(payload);
    }

    return c.json({
      error: { message: 'Comercio no encontrado', type: 'MERCHANT_NOT_FOUND' }
    }, 404);
  }
});

// Lista de pagos del día para Pantalla A (Mostrador) con paginación y aislamiento estricto
merchantRouter.get('/:id/payments', requireMerchantAuth, async (c) => {
  const merchantId = c.req.param('id');
  const limitParam = c.req.query('limit');
  const offsetParam = c.req.query('offset');

  let limit = 20;
  let offset = 0;

  if (limitParam !== undefined) {
    const parsedLimit = parseInt(limitParam, 10);
    if (isNaN(parsedLimit) || parsedLimit <= 0) {
      return c.json({ error: { message: 'limit debe ser un entero positivo', type: 'INVALID_PARAMETER' } }, 400);
    }
    if (parsedLimit > 100) {
      return c.json({ error: { message: 'El límite máximo por página es 100 registros', type: 'INVALID_PARAMETER' } }, 400);
    }
    limit = parsedLimit;
  }

  if (offsetParam !== undefined) {
    const parsedOffset = parseInt(offsetParam, 10);
    if (isNaN(parsedOffset) || parsedOffset < 0) {
      return c.json({ error: { message: 'offset debe ser un entero mayor o igual a 0', type: 'INVALID_PARAMETER' } }, 400);
    }
    offset = parsedOffset;
  }

  if (c.env.DB) {
    // Validar que el comercio exista para evitar enumeración o estados inconsistentes
    const merchant = await c.env.DB.prepare(
      'SELECT id FROM merchants WHERE id = ? LIMIT 1'
    ).bind(merchantId).first();

    if (!merchant) {
      return c.json({
        error: { message: 'Comercio no encontrado', type: 'MERCHANT_NOT_FOUND' }
      }, 404);
    }

    const countRes: any = await c.env.DB.prepare(
      'SELECT COUNT(*) as total FROM payments WHERE merchant_id = ?'
    ).bind(merchantId).first();
    const total = countRes?.total || 0;

    const results = await c.env.DB.prepare(`
      SELECT id, payable_type, payable_id, amount, concept, status, payment_method, date_created, date_paid
      FROM payments
      WHERE merchant_id = ?
      ORDER BY date_created DESC
      LIMIT ? OFFSET ?
    `).bind(merchantId, limit, offset).all();

    const rows = results.results || [];
    const hasMore = (offset + rows.length) < total;
    const nextOffset = hasMore ? offset + limit : null;

    return c.json({
      payments: rows,
      pagination: {
        total,
        limit,
        offset,
        hasMore,
        nextOffset
      }
    });
  }

  return c.json({
    error: { message: 'Base de datos no disponible', type: 'DATABASE_UNAVAILABLE' }
  }, 503);
});

// Corte de caja del día (Cierre y reconciliación contable)
merchantRouter.post('/:id/close-day', requireMerchantAuth, async (c) => {
  const merchantId = c.req.param('id');

  if (c.env.DB) {
    const merchant = await c.env.DB.prepare(
      'SELECT id FROM merchants WHERE id = ? LIMIT 1'
    ).bind(merchantId).first();

    if (!merchant) {
      return c.json({
        error: { message: 'Comercio no encontrado', type: 'MERCHANT_NOT_FOUND' }
      }, 404);
    }
  }
  const now = Math.floor(Date.now() / 1000);
  const startOfDay = now - (now % 86400);

  let totalSales = 0;
  let count = 0;

  const cutDate = new Date().toISOString().split('T')[0];
  const closeId = generateUlid();

  if (c.env.DB) {
    const summary: any = await c.env.DB.prepare(`
      SELECT COUNT(*) as count, SUM(amount) as total
      FROM payments
      WHERE merchant_id = ? AND status = 'PAID' AND date_created >= ?
    `).bind(merchantId, startOfDay).first();

    if (summary) {
      totalSales = summary.total || 0;
      count = summary.count || 0;
    }

    // Registrar en tabla inmutable daily_closes
    await c.env.DB.prepare(`
      INSERT INTO daily_closes (id, merchant_id, cut_date, total_sales, total_paid, total_transactions, ceremonial_title, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'Corte de Caja Oficial', ?)
    `).bind(closeId, merchantId, cutDate, totalSales, totalSales, count, now).run();
  }

  return c.json({
    success: true,
    closeId,
    merchantId,
    timestamp: now,
    cutDate,
    totalAmount: totalSales,
    totalTransactions: count,
    status: 'CLOSED',
    ceremonialTitle: 'Corte de Caja Oficial'
  });
});
