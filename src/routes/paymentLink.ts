import { Hono } from 'hono';
import { Env, PeyMetadata } from '../types';
import { PeyClient } from '../services/peyClient';
import { generateUlid } from '../utils/ulid';

export const paymentLinkRouter = new Hono<{ Bindings: Env }>();

// Crear link para cobrar a distancia (Pantalla C)
paymentLinkRouter.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const amount = Number(body.amount);

  if (isNaN(amount) || amount <= 0) {
    return c.json({ error: { message: 'El monto debe ser mayor a 0', type: 'INVALID_AMOUNT' } }, 400);
  }

  const merchantId = body.merchantId || '01JBAVWE4NS5TGXHWGMX3KH23Q';
  const deviceId = body.deviceId || 'pos-caja-01';
  const sessionId = body.sessionId || generateUlid();
  const operator = body.operator || 'cajero-principal';
  const concept = body.concept || 'Cobro a distancia';
  const channel = body.channel || 'whatsapp';

  const metadata: PeyMetadata = {
    merchantId,
    deviceId,
    sessionId,
    source: 'cash-register',
    screen: 'cobrar-distancia',
    operator,
    channel,
    concept
  };

  const client = new PeyClient(c.env.PEY_API_URL, c.env.PEY_API_KEY);
  const origin = new URL(c.req.url).origin;
  const paymentId = generateUlid();

  try {
    const res = await client.createPaymentLink({
      amount,
      successUrl: body.successUrl || `${origin}/success?paymentId=${paymentId}`,
      backUrl: body.backUrl || `${origin}/cancel?paymentId=${paymentId}`,
      hasTip: Boolean(body.hasTip),
      clientReferenceId: paymentId,
      metadata
    });

    const now = Math.floor(Date.now() / 1000);

    // Guardar en D1
    if (c.env.DB) {
      await c.env.DB.prepare(`
        INSERT OR IGNORE INTO merchants (id, alias, name, clabe, entity, codi_status, created_at, updated_at)
        VALUES (?, 'Taquería El Güero', 'Taquería El Güero S.A. de C.V.', '012180001234567899', 'BUSINESS', 'ACTIVE', ?, ?)
      `).bind(merchantId, now, now).run();

      await c.env.DB.prepare(`
        INSERT INTO payments (id, merchant_id, payable_type, payable_id, amount, concept, payment_link_url, status, date_created, metadata)
        VALUES (?, ?, 'PAYMENT_LINK', ?, ?, ?, ?, 'WAITING', ?, ?)
      `).bind(
        paymentId,
        merchantId,
        res.id,
        amount,
        concept,
        res.url,
        now,
        JSON.stringify(metadata)
      ).run();
    }

    return c.json({
      success: true,
      paymentId,
      paymentLinkId: res.id,
      url: res.url,
      amount,
      concept
    }, 201);
  } catch (err: any) {
    console.error('Error al generar Payment Link:', err);
    return c.json({
      error: {
        message: err.message || 'Error al comunicarse con Pey Payment Link API',
        type: err.details?.error?.type || 'PAYMENT_LINK_ERROR',
        requestId: err.details?.error?.requestId
      }
    }, err.status || 500);
  }
});

// Polling de link remoto
paymentLinkRouter.get('/:id', async (c) => {
  const linkId = c.req.param('id');
  const now = Math.floor(Date.now() / 1000);

  // 1. Revisar estado en D1
  let localPayment: any = null;
  if (c.env.DB) {
    localPayment = await c.env.DB.prepare(
      'SELECT * FROM payments WHERE payable_id = ? OR id = ? LIMIT 1'
    ).bind(linkId, linkId).first();
  }

  if (localPayment && localPayment.status === 'PAID') {
    return c.json({
      status: 'PAID',
      amount: localPayment.amount,
      datePaid: localPayment.date_paid,
      transactionId: localPayment.transaction_id,
      paymentId: localPayment.id
    });
  }

  // 2. Consultar a Pey
  const client = new PeyClient(c.env.PEY_API_URL, c.env.PEY_API_KEY);
  try {
    const details = await client.getPaymentLink(localPayment?.payable_id || linkId);

    if (details.status === 'paid') {
      const txn = details.transactions?.[0];
      const datePaid = txn?.datePaid || now;
      const txnId = txn?.transactionId || generateUlid();

      if (c.env.DB && localPayment) {
        await c.env.DB.prepare(`
          UPDATE payments 
          SET status = 'PAID', transaction_id = ?, payment_method = ?, date_paid = ?
          WHERE id = ?
        `).bind(txnId, txn?.paymentMethod || 'CODI', datePaid, localPayment.id).run();

        // Asiento contable para ARK Ledger
        const ledgerId = generateUlid();
        await c.env.DB.prepare(`
          INSERT INTO ledger_entries (id, merchant_id, payment_id, transaction_id, debit_account, credit_account, amount, concept, created_at)
          VALUES (?, ?, ?, ?, '102.01 Bancos CoDi / Enlace', '401.01 Ventas a Distancia', ?, ?, ?)
        `).bind(
          ledgerId,
          localPayment.merchant_id,
          localPayment.id,
          txnId,
          localPayment.amount,
          localPayment.concept || 'Cobro Link Remoto',
          now
        ).run();
      }

      return c.json({
        status: 'PAID',
        amount: details.amount,
        datePaid,
        transactionId: txnId,
        paymentId: localPayment?.id
      });
    }

    return c.json({
      status: details.status === 'pending' ? 'WAITING' : details.status.toUpperCase(),
      paymentLinkId: linkId
    });
  } catch (err: any) {
    return c.json({
      status: localPayment?.status || 'WAITING',
      paymentLinkId: linkId
    });
  }
});
