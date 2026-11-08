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
      // Registrar evento rechazado en auditoría si D1 está disponible
      if (c.env.DB) {
        try {
          await c.env.DB.prepare(`
            INSERT INTO webhook_events (id, event_type, transaction_id, payload, signature, received_at, processed, hmac_valid, is_duplicate, processing_status, error_message)
            VALUES (?, 'rejected.signature', NULL, ?, ?, ?, 0, 0, 0, 'REJECTED_HMAC', 'Firma HMAC inválida')
          `).bind(generateUlid(), rawBody, signature, now).run();
        } catch {
          // ignore
        }
      }
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

  // Determinación de clave única de idempotencia
  // Se compone de eventType + transactionId/payableId para payment.confirmed, o eventType + bankAccountId + status para bank-account.updated.
  let idempotencyKey: string;
  if (eventData.idempotencyKey) {
    idempotencyKey = String(eventData.idempotencyKey);
  } else if (eventType === 'payment.confirmed') {
    const pId = eventData.payableId || eventData.id || '';
    idempotencyKey = txnId ? `${eventType}:${txnId}` : `${eventType}:${pId}`;
  } else if (eventType === 'bank-account.updated') {
    const bId = eventData.bankAccountId || eventData.id || '';
    const st = eventData.codiStatus || 'ACTIVE';
    idempotencyKey = `${eventType}:${bId}:${st}`;
  } else {
    idempotencyKey = `${eventType}:${txnId || eventId}`;
  }

  // 1. Detección de idempotencia en D1
  if (c.env.DB) {
    const existing: any = await c.env.DB.prepare(
      'SELECT id, processed, processing_status, is_duplicate FROM webhook_events WHERE idempotency_key = ? LIMIT 1'
    ).bind(idempotencyKey).first();

    if (existing) {
      // El evento ya fue recibido y procesado previamente.
      // Devolver 200 OK inmediatamente sin volver a cambiar estado, sin segundo asiento y sin doble conteo.
      return c.json({
        received: true,
        duplicate: true,
        eventId: existing.id,
        idempotencyKey,
        message: 'Evento duplicado ya procesado previamente (idempotente)'
      }, 200);
    }

    // 2. Guardar evento antes de procesarlo
    try {
      await c.env.DB.prepare(`
        INSERT INTO webhook_events (id, event_type, transaction_id, payload, signature, received_at, processed, idempotency_key, hmac_valid, is_duplicate, processing_status)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, 1, 0, 'PROCESSING')
      `).bind(eventId, eventType, txnId, rawBody, signature || null, now, idempotencyKey).run();
    } catch (insertErr: any) {
      if (insertErr?.message?.includes('UNIQUE') || insertErr?.message?.includes('constraint')) {
        return c.json({
          received: true,
          duplicate: true,
          idempotencyKey,
          message: 'Evento duplicado detectado por restricción única en base de datos'
        }, 200);
      }
      console.error('[Webhook DB Save Error]', insertErr);
      return c.json({ error: 'Error transitorio al guardar evento en base de datos', retryable: true }, 500);
    }
  }

  // 3. Procesamiento seguro y atómico del evento
  try {
    if (eventType === 'payment.confirmed') {
      const payableId = eventData.payableId || eventData.id;
      const amount = Number(eventData.amount);
      const datePaid = eventData.datePaid || now;

      if (c.env.DB && payableId) {
        // Transición de estado atómica: WAITING a PAID solo una vez
        const updateRes: any = await c.env.DB.prepare(`
          UPDATE payments
          SET status = 'PAID', transaction_id = ?, payment_method = ?, date_paid = ?
          WHERE (payable_id = ? OR id = ?) AND status != 'PAID'
        `).bind(txnId, eventData.paymentMethod || 'CODI', datePaid, payableId, payableId).run();

        const rowsAffected = updateRes?.meta?.changes ?? updateRes?.changes ?? 1;

        // Buscar el pago para el asiento contable
        const payment: any = await c.env.DB.prepare(`
          SELECT id, merchant_id, amount, concept, status FROM payments WHERE payable_id = ? OR id = ? LIMIT 1
        `).bind(payableId, payableId).first();

        // Solo si cambió de estado (rowsAffected > 0) y no estaba PAID previamente
        if (payment && rowsAffected > 0) {
          const existingLedger: any = await c.env.DB.prepare(`
            SELECT id FROM ledger_entries WHERE payment_id = ? OR (transaction_id = ? AND transaction_id IS NOT NULL) LIMIT 1
          `).bind(payment.id, txnId).first();

          if (!existingLedger) {
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
    } else if (eventType === 'bank-account.updated') {
      const bankAccountId = eventData.bankAccountId || eventData.id;
      const codiStatus = eventData.codiStatus || 'ACTIVE';

      if (c.env.DB && bankAccountId) {
        await c.env.DB.prepare(`
          UPDATE merchants
          SET codi_status = ?, updated_at = ?
          WHERE id = ?
        `).bind(codiStatus, now, bankAccountId).run();
      }
    }

    // Marcar como procesado exitosamente
    if (c.env.DB) {
      await c.env.DB.prepare(`
        UPDATE webhook_events
        SET processed = 1, processing_status = 'COMPLETED'
        WHERE id = ?
      `).bind(eventId).run();
    }

    return c.json({ received: true, eventId, duplicate: false }, 200);
  } catch (processErr: any) {
    console.error('[Webhook Processing Error]', processErr);
    if (c.env.DB) {
      await c.env.DB.prepare(`
        UPDATE webhook_events
        SET processed = 0, processing_status = 'FAILED', error_message = ?
        WHERE id = ?
      `).bind(processErr?.message || 'Error al procesar webhook', eventId).run();
    }
    // Devolver 500 para que Pey reintente
    return c.json({ error: 'Error transitorio al procesar evento', retryable: true }, 500);
  }
});
