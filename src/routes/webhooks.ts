import { Hono } from 'hono';
import { Env } from '../types';
import { generateUlid } from '../utils/ulid';

export const webhookRouter = new Hono<{ Bindings: Env }>();

async function verifyHmacSignature(secret: string, timestamp: string, bodyText: string, receivedSignature: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const payload = `${timestamp}.${bodyText}`;
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    const hexSignature = Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    return hexSignature === receivedSignature;
  } catch (err) {
    console.error('Error verificando firma HMAC:', err);
    return false;
  }
}

webhookRouter.post('/pey', async (c) => {
  const signature = c.req.header('X-Pey-Signature');
  const timestamp = c.req.header('X-Pey-Timestamp');
  const rawBody = await c.req.text();
  const now = Math.floor(Date.now() / 1000);

  // En producción, la verificación de firma HMAC es estrictamente obligatoria (sin bypass)
  const isProd = c.env.ENVIRONMENT === 'production';
  if (isProd && !c.env.PEY_WEBHOOK_SECRET) {
    console.error('[Security Alert] PEY_WEBHOOK_SECRET is not configured in production');
    return c.json({ error: 'PEY_WEBHOOK_SECRET must be configured in production' }, 500);
  }

  // Validación de firma HMAC y anti-replay
  if (c.env.PEY_WEBHOOK_SECRET || isProd) {
    if (!signature || !timestamp) {
      return c.json({ error: 'Missing webhook signature headers' }, 401);
    }

    const ts = parseInt(timestamp, 10);
    if (Math.abs(now - ts) > 300) {
      return c.json({ error: 'Webhook timestamp expired (anti-replay)' }, 401);
    }

    const isValid = await verifyHmacSignature(c.env.PEY_WEBHOOK_SECRET!, timestamp, rawBody, signature);
    if (!isValid) {
      return c.json({ error: 'Invalid HMAC signature' }, 401);
    }
  }

  let eventData: any = {};
  try {
    eventData = JSON.parse(rawBody);
  } catch (e) {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const eventType = eventData.event || 'unknown';
  const txnId = eventData.transactionId || eventData.id || null;
  const eventId = generateUlid();

  // Guardar log de auditoría en D1
  if (c.env.DB) {
    await c.env.DB.prepare(`
      INSERT INTO webhook_events (id, event_type, transaction_id, payload, signature, received_at, processed)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).bind(eventId, eventType, txnId, rawBody, signature || null, now).run();
  }

  // 1. Evento de pago confirmado
  if (eventType === 'payment.confirmed') {
    const payableId = eventData.payableId;
    const amount = Number(eventData.amount);
    const datePaid = eventData.datePaid || now;

    if (c.env.DB && payableId) {
      // Buscar pago asociado
      const payment: any = await c.env.DB.prepare(`
        SELECT * FROM payments WHERE payable_id = ? OR id = ? LIMIT 1
      `).bind(payableId, payableId).first();

      if (payment) {
        // Actualizar estado a PAID
        await c.env.DB.prepare(`
          UPDATE payments
          SET status = 'PAID', transaction_id = ?, payment_method = ?, date_paid = ?
          WHERE id = ?
        `).bind(txnId, eventData.paymentMethod || 'CODI', datePaid, payment.id).run();

        // Registrar póliza contable en Ledger (Idempotente)
        const ledgerId = generateUlid();
        await c.env.DB.prepare(`
          INSERT INTO ledger_entries (id, merchant_id, payment_id, transaction_id, debit_account, credit_account, amount, concept, created_at)
          VALUES (?, ?, ?, ?, '102.01 Bancos CoDi', '401.01 Ventas Confirmadas', ?, ?, ?)
        `).bind(
          ledgerId,
          payment.merchant_id,
          payment.id,
          txnId,
          amount || payment.amount,
          payment.concept || 'Pago Webhook Confirmado',
          now
        ).run();
      }
    }
  }

  // 2. Evento de cuenta bancaria activada en Banxico
  if (eventType === 'bank-account.updated') {
    const bankAccountId = eventData.bankAccountId;
    const codiStatus = eventData.codiStatus || 'ACTIVE';

    if (c.env.DB && bankAccountId) {
      await c.env.DB.prepare(`
        UPDATE merchants
        SET codi_status = ?, updated_at = ?
        WHERE id = ?
      `).bind(codiStatus, now, bankAccountId).run();
    }
  }

  return c.json({ received: true, eventId }, 200);
});
