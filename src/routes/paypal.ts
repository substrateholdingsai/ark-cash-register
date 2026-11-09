/**
 * Rutas para Riel de Tarjetas de Crédito / Débito y Meses Sin Intereses (PayPal)
 * Ecosistema Ark Cash Register — Directo a cuenta del merchant, no-custodial.
 */

import { Hono } from 'hono';
import { Env, PaymentRail } from '../types';
import { generateUlid } from '../utils/ulid';
import { PayPalClient } from '../services/paypalClient';

export const paypalRouter = new Hono<{ Bindings: Env }>();

/**
 * 1. GET /api/paypal/config/:merchantId — Obtener credenciales públicas de PayPal para el checkout
 */
paypalRouter.get('/config/:merchantId', async (c) => {
  const merchantId = c.req.param('merchantId');
  let enabled = false;
  let clientId: string | null = null;
  let mode: 'sandbox' | 'live' = (c.env.PAYPAL_ENVIRONMENT as any) || 'sandbox';

  if (c.env.DB) {
    try {
      const merchant: any = await c.env.DB.prepare(
        'SELECT paypal_client_id, paypal_enabled FROM merchants WHERE id = ? LIMIT 1'
      ).bind(merchantId).first();

      if (merchant && merchant.paypal_client_id) {
        enabled = Boolean(merchant.paypal_enabled);
        clientId = merchant.paypal_client_id;
      }
    } catch {}
  }

  // Si no está configurado en DB, pero tenemos configuración global o comercios semilla
  if (!clientId) {
    if (c.env.PAYPAL_CLIENT_ID) {
      clientId = c.env.PAYPAL_CLIENT_ID;
      enabled = true;
    } else if (
      merchantId === '01JBAVSKINLAB0000000000000' || 
      merchantId === '01JBAVWE4NS5TGXHWGMX3KH23Q' || 
      merchantId === 'skinlab' || 
      merchantId === 'taqueria'
    ) {
      clientId = 'test_sandbox_paypal_client_id';
      enabled = true;
    }
  }

  return c.json({
    enabled,
    clientId,
    currency: 'MXN',
    mode
  });
});

/**
 * 2. POST /api/paypal/order — Crear orden de cobro en PayPal (MSI / Tarjetas)
 */
paypalRouter.post('/order', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { merchantId, concept, cartItems, customerRfc, currency = 'MXN' } = body;
  const amount = Number(body.amount);

  if (isNaN(amount) || amount <= 0) {
    return c.json({ error: { message: 'El monto debe ser mayor a 0', type: 'INVALID_AMOUNT' } }, 400);
  }

  // Obtener credenciales de PayPal para este merchant
  let clientId = c.env.PAYPAL_CLIENT_ID || 'test_sandbox_paypal_client_id';
  let clientSecret = c.env.PAYPAL_CLIENT_SECRET || 'test_sandbox_secret';
  let environment: 'sandbox' | 'live' = (c.env.PAYPAL_ENVIRONMENT as any) || 'sandbox';

  if (c.env.DB && merchantId) {
    try {
      const m: any = await c.env.DB.prepare(
        'SELECT paypal_client_id, paypal_client_secret, paypal_enabled FROM merchants WHERE id = ? LIMIT 1'
      ).bind(merchantId).first();

      if (m && m.paypal_client_id && m.paypal_client_secret) {
        clientId = m.paypal_client_id;
        clientSecret = m.paypal_client_secret;
      }
    } catch {}
  }

  const paypal = new PayPalClient(clientId, clientSecret, environment);
  const paymentId = generateUlid();
  const folio = `PAY-${Date.now().toString().slice(-6)}`;

  try {
    const order = await paypal.createOrder({
      amount,
      currency: 'MXN',
      referenceId: folio,
      description: concept || `Pedido #${folio} (Tarjetas/MSI)`,
      customId: paymentId
    });

    const now = Math.floor(Date.now() / 1000);
    const rail: PaymentRail = 'paypal';

    const metadata = {
      channel: 'paypal_msi',
      folio,
      items: cartItems || [],
      customerRfc: customerRfc || null,
      concept: concept || `Pedido #${folio}`
    };

    if (c.env.DB) {
      await c.env.DB.prepare(`
        INSERT INTO payments (
          id, merchant_id, payable_type, payable_id, amount, concept, num_ref,
          status, payment_method, payment_rail, currency, paypal_order_id,
          customer_rfc, date_created, metadata
        ) VALUES (
          ?, ?, 'PAYMENT_LINK', ?, ?, ?, ?,
          'WAITING', 'CARD', ?, 'MXN', ?,
          ?, ?, ?
        )
      `).bind(
        paymentId,
        merchantId || '01JBAVSKINLAB0000000000000',
        order.orderId,
        amount,
        concept || `Pedido #${folio}`,
        folio,
        rail,
        order.orderId,
        customerRfc || null,
        now,
        JSON.stringify(metadata)
      ).run();
    }

    return c.json({
      success: true,
      paymentId,
      orderId: order.orderId,
      folio,
      amount,
      currency: 'MXN',
      paymentRail: 'paypal'
    }, 201);
  } catch (err: any) {
    console.error('[PayPal Create Order Error]', err);
    return c.json({
      error: {
        message: err.message || 'Error al conectar con PayPal',
        type: 'PAYPAL_ORDER_ERROR'
      }
    }, 500);
  }
});

/**
 * 3. POST /api/paypal/capture-order — Capturar orden y marcar pago como PAID
 */
paypalRouter.post('/capture-order', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { paymentId, orderId, merchantId } = body;

  if (!paymentId && !orderId) {
    return c.json({ error: { message: 'Se requiere paymentId u orderId', type: 'MISSING_ORDER_ID' } }, 400);
  }

  let payment: any = null;
  if (c.env.DB) {
    payment = await c.env.DB.prepare(
      'SELECT * FROM payments WHERE id = ? OR paypal_order_id = ? LIMIT 1'
    ).bind(paymentId || orderId, orderId || paymentId).first();
  }

  // Fallback para testing sin DB
  if (!payment) {
    payment = {
      id: paymentId || 'PAY_MOCK_123',
      merchant_id: merchantId || '01JBAVSKINLAB0000000000000',
      amount: 299.00,
      status: 'WAITING',
      num_ref: 'FOLIO_MOCK',
      concept: 'Pedido Prueba'
    };
  }

  if (payment.status === 'PAID') {
    return c.json({
      success: true,
      status: 'PAID',
      transactionId: payment.transaction_id || payment.paypal_capture_id,
      message: 'Esta orden ya fue capturada y pagada previamente'
    });
  }

  let clientId = c.env.PAYPAL_CLIENT_ID || 'test_sandbox_paypal_client_id';
  let clientSecret = c.env.PAYPAL_CLIENT_SECRET || 'test_sandbox_secret';
  let environment: 'sandbox' | 'live' = (c.env.PAYPAL_ENVIRONMENT as any) || 'sandbox';

  if (c.env.DB && payment.merchant_id) {
    try {
      const m: any = await c.env.DB.prepare(
        'SELECT paypal_client_id, paypal_client_secret FROM merchants WHERE id = ? LIMIT 1'
      ).bind(payment.merchant_id).first();

      if (m && m.paypal_client_id && m.paypal_client_secret) {
        clientId = m.paypal_client_id;
        clientSecret = m.paypal_client_secret;
      }
    } catch {}
  }

  const paypal = new PayPalClient(clientId, clientSecret, environment);
  const targetOrderId = orderId || payment.paypal_order_id;

  try {
    const captureResult = await paypal.captureOrder(targetOrderId);
    const now = Math.floor(Date.now() / 1000);

    if (c.env.DB) {
      // 1. Marcar pago como PAID
      await c.env.DB.prepare(`
        UPDATE payments
        SET status = 'PAID', date_paid = ?, transaction_id = ?, paypal_capture_id = ?
        WHERE id = ?
      `).bind(now, captureResult.captureId, captureResult.captureId, payment.id).run();

      // 2. Registrar en Ledger
      const ledgerId = generateUlid();
      await c.env.DB.prepare(`
        INSERT INTO ledger_entries (
          id, merchant_id, payment_id, transaction_id, debit_account, credit_account, amount, concept, created_at
        ) VALUES (
          ?, ?, ?, ?, 'PAYPAL_MSI', 'VENTAS_MOSTRADOR', ?, ?, ?
        )
      `).bind(
        ledgerId,
        payment.merchant_id,
        payment.id,
        captureResult.captureId,
        payment.amount,
        `Cobro Tarjeta / PayPal (MSI) #${payment.num_ref || payment.id.slice(-6)}`,
        now
      ).run();

      // 3. Auditoría
      try {
        await c.env.DB.prepare(`
          INSERT INTO operator_audit_log (id, operator, endpoint, method, merchant_id, payment_id, status_code, duration_ms, error, created_at)
          VALUES (?, 'PAYPAL_SDK', '/api/paypal/capture-order', 'POST', ?, ?, 200, 0, NULL, ?)
        `).bind(generateUlid(), payment.merchant_id, payment.id, now).run();
      } catch {}
    }

    return c.json({
      success: true,
      status: 'PAID',
      paymentId: payment.id,
      transactionId: captureResult.captureId,
      captureId: captureResult.captureId,
      amount: payment.amount,
      currency: 'MXN',
      paymentRail: 'paypal',
      fee: captureResult.paypalFee,
      net: captureResult.netAmount
    });
  } catch (err: any) {
    console.error('[PayPal Capture Error]', err);
    return c.json({
      error: {
        message: err.message || 'Error al capturar pago con PayPal',
        type: 'PAYPAL_CAPTURE_ERROR'
      }
    }, 500);
  }
});
