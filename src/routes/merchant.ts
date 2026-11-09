import { Hono } from 'hono';
import { Env } from '../types';
import { PeyClient } from '../services/peyClient';
import { generateUlid } from '../utils/ulid';
import { validateClabe, getBankFromClabe } from '../utils/clabe';
import { validateSolanaAddress } from '../utils/solana';
import { getCatalogForMerchant, CatalogItem, MerchantCatalog } from '../data/catalogs';
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

// Actualizar catálogo completo del merchant (precios, productos, promociones)
merchantRouter.put('/:id/catalog', async (c) => {
  const merchantId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const baseCatalog = getCatalogForMerchant(merchantId);

  if (!body.items || !Array.isArray(body.items)) {
    return c.json({ error: { message: 'Se requiere una lista válida de items', type: 'INVALID_ITEMS' } }, 400);
  }

  // Validar items
  for (const item of body.items) {
    if (!item.name || typeof item.price !== 'number' || item.price < 0 || isNaN(item.price)) {
      return c.json({ error: { message: `El producto ${item.name || 'sin nombre'} debe tener precio numérico válido mayor o igual a 0`, type: 'INVALID_PRICE' } }, 400);
    }
  }

  const updatedCatalog: MerchantCatalog = {
    merchantId,
    brandName: body.brandName || baseCatalog.brandName,
    tagline: body.tagline || baseCatalog.tagline,
    emoji: body.emoji || baseCatalog.emoji,
    currency: body.currency || baseCatalog.currency || 'MXN',
    whatsappPhone: body.whatsappPhone || baseCatalog.whatsappPhone,
    items: body.items.map((it: any, idx: number) => ({
      id: it.id || `item_${idx}_${Date.now()}`,
      name: String(it.name).trim(),
      price: Number(it.price),
      icon: it.icon || '🛍️',
      category: it.category || 'General',
      description: it.description || '',
      variants: Array.isArray(it.variants) ? it.variants : undefined,
      available: it.available !== false
    })),
    promoRule: body.promoRule !== undefined ? body.promoRule : baseCatalog.promoRule
  };

  if (c.env.KV) {
    await c.env.KV.put(`catalog:${merchantId}`, JSON.stringify(updatedCatalog));
  }

  return c.json({ success: true, catalog: updatedCatalog });
});

// Modificar un producto individual del catálogo (cambio rápido de precio o disponibilidad)
merchantRouter.patch('/:id/catalog/item/:itemId', async (c) => {
  const merchantId = c.req.param('id');
  const itemId = c.req.param('itemId');
  const body = await c.req.json().catch(() => ({}));

  let currentCatalog: MerchantCatalog;
  if (c.env.KV) {
    const cached = await c.env.KV.get(`catalog:${merchantId}`, 'json') as MerchantCatalog | null;
    currentCatalog = cached || getCatalogForMerchant(merchantId);
  } else {
    currentCatalog = getCatalogForMerchant(merchantId);
  }

  const itemExists = currentCatalog.items.some(it => it.id === itemId);
  if (!itemExists) {
    return c.json({ error: { message: 'Producto no encontrado en el catálogo', type: 'ITEM_NOT_FOUND' } }, 404);
  }

  if (body.price !== undefined && (typeof body.price !== 'number' || isNaN(body.price) || body.price < 0)) {
    return c.json({ error: { message: 'El precio debe ser un número mayor o igual a 0', type: 'INVALID_PRICE' } }, 400);
  }

  const items = currentCatalog.items.map(it => {
    if (it.id === itemId) {
      return {
        ...it,
        price: body.price !== undefined ? Number(body.price) : it.price,
        available: body.available !== undefined ? Boolean(body.available) : (it.available !== false),
        name: body.name ? String(body.name).trim() : it.name,
        category: body.category ? String(body.category).trim() : it.category,
        description: body.description !== undefined ? String(body.description) : it.description,
        variants: Array.isArray(body.variants) ? body.variants : it.variants,
        icon: body.icon || it.icon
      };
    }
    return it;
  });

  const updatedCatalog: MerchantCatalog = {
    ...currentCatalog,
    items
  };

  if (c.env.KV) {
    await c.env.KV.put(`catalog:${merchantId}`, JSON.stringify(updatedCatalog));
  }

  const updatedItem = items.find(it => it.id === itemId);
  return c.json({ success: true, item: updatedItem, catalog: updatedCatalog });
});

// Registrar cuenta bancaria para CoDi y opcionalmente Wallet Solana (Onboarding)
merchantRouter.post('/register', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { alias, name, clabe, entity, taxId, solanaWallet, offrampProvider } = body;

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

  // Validación opcional de wallet Solana en onboarding
  if (solanaWallet) {
    const solCheck = validateSolanaAddress(solanaWallet);
    if (!solCheck.valid) {
      return c.json({
        error: { message: solCheck.error || 'La dirección Solana es inválida', type: 'INVALID_SOLANA_WALLET' }
      }, 400);
    }
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
    const solanaEnabled = Boolean(solanaWallet) ? 1 : 0;

    if (c.env.DB) {
      await c.env.DB.prepare(`
        INSERT INTO merchants (id, alias, name, clabe, entity, tax_id, codi_status, solana_wallet, solana_pay_enabled, offramp_provider, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(clabe) DO UPDATE SET
          alias = excluded.alias,
          name = excluded.name,
          solana_wallet = excluded.solana_wallet,
          solana_pay_enabled = excluded.solana_pay_enabled,
          offramp_provider = excluded.offramp_provider,
          updated_at = excluded.updated_at
      `).bind(
        merchantId,
        alias,
        name,
        clabe,
        entity,
        taxId || null,
        peyRes.codiStatus,
        solanaWallet || null,
        solanaEnabled,
        offrampProvider || null,
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
      solanaWallet: merchant?.solana_wallet || null,
      solanaPayEnabled: Boolean(merchant?.solana_pay_enabled),
      paypalClientId: merchant?.paypal_client_id || null,
      paypalEnabled: Boolean(merchant?.paypal_enabled),
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
        solanaWallet: merchant.solana_wallet || null,
        solanaPayEnabled: Boolean(merchant.solana_pay_enabled),
        paypalClientId: merchant.paypal_client_id || null,
        paypalEnabled: Boolean(merchant.paypal_enabled),
        offrampProvider: merchant.offramp_provider || null,
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

    // Desglose fiscal por riel y divisa (CFF / LFPIORPI)
    const breakdownRes: any = await c.env.DB.prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN currency = 'MXN' AND payment_rail != 'paypal' THEN amount ELSE 0 END), 0) as total_mxn,
        COALESCE(SUM(CASE WHEN payment_rail = 'paypal' THEN amount ELSE 0 END), 0) as total_paypal,
        COALESCE(SUM(CASE WHEN currency = 'USDC' THEN amount ELSE 0 END), 0) as total_usdc,
        COALESCE(SUM(CASE WHEN currency = 'USDT' THEN amount ELSE 0 END), 0) as total_usdt,
        COALESCE(SUM(CASE WHEN currency = 'MXN' THEN amount ELSE COALESCE(amount_mxn_equiv, amount * 20.0) END), 0) as total_mxn_consolidated
      FROM payments
      WHERE merchant_id = ? AND status = 'PAID' AND date_created >= ?
    `).bind(merchantId, startOfDay).first();

    const fiscalBreakdown = {
      mxn: Number(breakdownRes?.total_mxn || 0),
      paypal: Number(breakdownRes?.total_paypal || 0),
      usdc: Number(breakdownRes?.total_usdc || 0),
      usdt: Number(breakdownRes?.total_usdt || 0),
      totalMxnConsolidated: Number(breakdownRes?.total_mxn_consolidated || totalSales)
    };

    // Registrar en tabla inmutable daily_closes
    await c.env.DB.prepare(`
      INSERT INTO daily_closes (id, merchant_id, cut_date, total_sales, total_paid, total_transactions, ceremonial_title, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'Corte de Caja Oficial', ?)
    `).bind(closeId, merchantId, cutDate, totalSales, totalSales, count, now).run();

    return c.json({
      success: true,
      closeId,
      merchantId,
      timestamp: now,
      cutDate,
      totalAmount: totalSales,
      totalTransactions: count,
      fiscalBreakdown,
      legalNotice: 'La Caja te ayuda a cumplir, pero la responsabilidad fiscal y antilavado es tuya y de tu contador. Este reporte es informativo, no asesoría legal.',
      status: 'CLOSED',
      ceremonialTitle: 'Corte de Caja Oficial'
    });
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

// Configurar o actualizar Wallet Solana no-custodial del comercio
merchantRouter.post('/:id/solana-wallet', requireMerchantAuth, async (c) => {
  const merchantId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const { solanaWallet, enabled = true, offrampProvider } = body;

  const authUser = c.get('user');
  if (authUser && authUser.role !== 'admin' && authUser.merchantId && authUser.merchantId !== merchantId) {
    return c.json({ error: { message: 'No autorizado para configurar este comercio', type: 'FORBIDDEN' } }, 403);
  }

  if (!solanaWallet || typeof solanaWallet !== 'string') {
    return c.json({ error: { message: 'solanaWallet es requerido', type: 'MISSING_WALLET' } }, 400);
  }

  const check = validateSolanaAddress(solanaWallet);
  if (!check.valid) {
    return c.json({ error: { message: check.error || 'Dirección Solana inválida', type: 'INVALID_SOLANA_WALLET' } }, 400);
  }

  if (c.env.DB) {
    const now = Math.floor(Date.now() / 1000);
    await c.env.DB.prepare(`
      UPDATE merchants 
      SET solana_wallet = ?, solana_pay_enabled = ?, offramp_provider = ?, updated_at = ?
      WHERE id = ?
    `).bind(solanaWallet, enabled ? 1 : 0, offrampProvider || null, now, merchantId).run();

    // Invalidar caché KV
    if (c.env.KV) {
      await c.env.KV.delete(`merchant:${merchantId}`);
    }
  }

  return c.json({
    success: true,
    merchantId,
    solanaWallet,
    solanaPayEnabled: Boolean(enabled),
    offrampProvider: offrampProvider || null,
    message: 'Wallet Solana configurada exitosamente. Arquitectura 100% no-custodial.'
  });
});

// Configurar credenciales de PayPal para cobros con Tarjeta / Meses Sin Intereses
merchantRouter.put('/:id/paypal', requireMerchantAuth, async (c) => {
  const merchantId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const { paypalClientId, paypalClientSecret, enabled = true } = body;

  const authUser = c.get('user');
  if (authUser && authUser.role !== 'admin' && authUser.merchantId && authUser.merchantId !== merchantId) {
    return c.json({ error: { message: 'No autorizado para configurar este comercio', type: 'FORBIDDEN' } }, 403);
  }

  if (!paypalClientId || typeof paypalClientId !== 'string') {
    return c.json({ error: { message: 'paypalClientId es requerido', type: 'MISSING_CLIENT_ID' } }, 400);
  }

  if (c.env.DB) {
    const now = Math.floor(Date.now() / 1000);
    await c.env.DB.prepare(`
      UPDATE merchants 
      SET paypal_client_id = ?, paypal_client_secret = ?, paypal_enabled = ?, updated_at = ?
      WHERE id = ?
    `).bind(paypalClientId.trim(), (paypalClientSecret || '').trim(), enabled ? 1 : 0, now, merchantId).run();

    if (c.env.KV) {
      await c.env.KV.delete(`merchant:${merchantId}`);
    }
  }

  return c.json({
    success: true,
    merchantId,
    paypalClientId,
    paypalEnabled: Boolean(enabled),
    message: 'Credenciales de PayPal configuradas exitosamente para cobro con Tarjeta / MSI.'
  });
});

// Iniciar orden SPEI para montos altos (> $8,000 MXN o por transferencia)
merchantRouter.post('/:id/spei-order', async (c) => {
  const merchantId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const amount = Number(body.amount);

  if (isNaN(amount) || amount <= 0) {
    return c.json({ error: { message: 'El monto debe ser un número positivo', type: 'INVALID_AMOUNT' } }, 400);
  }

  // 1. Obtener comercio de D1 o catálogo predeterminado
  let merchant: any = null;
  if (c.env.DB) {
    merchant = await c.env.DB.prepare(
      'SELECT id, alias, name, clabe FROM merchants WHERE id = ? LIMIT 1'
    ).bind(merchantId).first();
  }

  // Si no está en BD, verificar si es uno de los comercios de catálogo estándar
  if (!merchant) {
    const catalog = getCatalogForMerchant(merchantId);
    if (catalog && catalog.merchantId === merchantId) {
      merchant = {
        id: catalog.merchantId,
        alias: catalog.brandName,
        name: `${catalog.brandName} S.A. de C.V.`,
        clabe: catalog.merchantId === '01JBAVWE4NS5TGXHWGMX3KH23Q' 
          ? '012180001234567899' 
          : '072180001234567890'
      };
      // Persistir si DB está disponible
      if (c.env.DB) {
        const nowSec = Math.floor(Date.now() / 1000);
        await c.env.DB.prepare(`
          INSERT OR IGNORE INTO merchants (id, alias, name, clabe, entity, codi_status, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'BUSINESS', 'ACTIVE', ?, ?)
        `).bind(merchant.id, merchant.alias, merchant.name, merchant.clabe, nowSec, nowSec).run();
      }
    }
  }

  if (!merchant || !merchant.clabe) {
    return c.json({
      error: { message: 'Comercio no encontrado o no tiene cuenta CLABE configurada', type: 'MERCHANT_NOT_FOUND' }
    }, 404);
  }

  const bankInfo = getBankFromClabe(merchant.clabe);
  const bankName = bankInfo?.name || 'Sistema Bancario Mexicano';
  const paymentId = generateUlid();
  const folio = (body.numRef || Math.floor(Math.random() * 900000 + 100000)).toString();
  const concept = (body.concept || `Pago pedido ${folio} ${merchant.alias}`).slice(0, 40);
  const now = Math.floor(Date.now() / 1000);

  const metadata = {
    channel: 'storefront_spei',
    customer: body.customer || 'Cliente',
    notes: body.notes || '',
    items: body.items || [],
    bank: bankName
  };

  if (c.env.DB) {
    await c.env.DB.prepare(`
      INSERT INTO payments (id, merchant_id, payable_type, payable_id, amount, concept, num_ref, status, payment_method, date_created, metadata)
      VALUES (?, ?, 'SPEI_TRANSFER', ?, ?, ?, ?, 'PENDING_SPEI', 'SPEI', ?, ?)
    `).bind(
      paymentId,
      merchant.id,
      `SPEI-${paymentId}`,
      amount,
      concept,
      folio,
      now,
      JSON.stringify(metadata)
    ).run();
  }

  return c.json({
    success: true,
    paymentId,
    folio,
    amount,
    clabe: merchant.clabe, // 18 dígitos completos para el checkout legítimo de este comercio
    bank: bankName,
    beneficiary: merchant.name || merchant.alias,
    concept,
    status: 'PENDING_SPEI',
    instructions: 'Abre la app de tu banco, elige transferencia SPEI, pega la CLABE y el monto exacto. Este pago no se confirma solo: manda tu comprobante por WhatsApp al merchant.',
    dateCreated: now
  }, 201);
});

// Confirmación manual por el merchant de un pago SPEI recibido
merchantRouter.post('/:id/payments/:paymentId/confirm-spei', requireMerchantAuth, async (c) => {
  const merchantId = c.req.param('id');
  const paymentId = c.req.param('paymentId');

  const authUser = c.get('user');
  if (authUser && authUser.role !== 'admin' && authUser.merchantId && authUser.merchantId !== merchantId) {
    return c.json({
      error: { message: 'No autorizado para confirmar pagos de este comercio', type: 'FORBIDDEN' }
    }, 403);
  }

  if (!c.env.DB) {
    return c.json({ error: { message: 'Base de datos no disponible', type: 'DB_UNAVAILABLE' } }, 500);
  }

  // 1. Obtener el pago
  const payment: any = await c.env.DB.prepare(
    'SELECT * FROM payments WHERE id = ? AND merchant_id = ? LIMIT 1'
  ).bind(paymentId, merchantId).first();

  if (!payment) {
    return c.json({
      error: { message: 'Pago no encontrado para este comercio', type: 'PAYMENT_NOT_FOUND' }
    }, 404);
  }

  if (payment.status === 'PAID') {
    return c.json({
      error: { message: 'Este pago ya ha sido confirmado previamente', type: 'PAYMENT_ALREADY_PAID' }
    }, 400);
  }

  if (payment.status !== 'PENDING_SPEI') {
    return c.json({
      error: { message: 'Solo los pagos SPEI pendientes pueden confirmarse manualmente', type: 'INVALID_PAYMENT_STATUS' }
    }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const transactionId = `TX_SPEI_${generateUlid()}`;
  const operatorName = authUser?.email || authUser?.id || 'merchant_pos';

  // 2. Actualizar pago a PAID
  await c.env.DB.prepare(`
    UPDATE payments 
    SET status = 'PAID', date_paid = ?, transaction_id = ? 
    WHERE id = ?
  `).bind(now, transactionId, paymentId).run();

  // 3. Registrar entrada contable en ledger_entries
  const ledgerId = generateUlid();
  await c.env.DB.prepare(`
    INSERT INTO ledger_entries (id, merchant_id, payment_id, transaction_id, debit_account, credit_account, amount, concept, created_at)
    VALUES (?, ?, ?, ?, 'BANCO_SPEI', 'VENTAS_MOSTRADOR', ?, ?, ?)
  `).bind(
    ledgerId,
    merchantId,
    paymentId,
    transactionId,
    payment.amount,
    payment.concept || 'Pago SPEI manual confirmado',
    now
  ).run();

  // 4. Registrar en operator_audit_log (inmutable)
  const auditId = generateUlid();
  try {
    await c.env.DB.prepare(`
      INSERT INTO operator_audit_log (id, operator, endpoint, method, merchant_id, payment_id, status_code, duration_ms, error, created_at)
      VALUES (?, ?, ?, 'POST', ?, ?, 200, 0, NULL, ?)
    `).bind(
      auditId,
      operatorName,
      `/api/merchant/${merchantId}/payments/${paymentId}/confirm-spei`,
      merchantId,
      paymentId,
      now
    ).run();
  } catch (auditErr) {
    console.warn('[Audit Log Warning]', auditErr);
  }

  return c.json({
    success: true,
    paymentId,
    status: 'PAID',
    transactionId,
    amount: payment.amount,
    datePaid: now,
    confirmedBy: operatorName
  }, 200);
});
