import { Hono } from 'hono';
import { Env } from '../types';
import { generateUlid } from '../utils/ulid';
import { PayPalClient } from '../services/paypalClient';

export const webhookRouter = new Hono<{ Bindings: Env }>();

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function computeHmacHex(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function verifyHmacSignature(secret: string, timestamp: string, bodyText: string, receivedSignature: string): Promise<boolean> {
  try {
    const hexSignature = await computeHmacHex(secret, `${timestamp}.${bodyText}`);
    return timingSafeEqualStr(hexSignature, receivedSignature.toLowerCase());
  } catch (err) {
    console.error('Error verificando firma HMAC:', err);
    return false;
  }
}

async function recordRejectedWebhook(db: D1Database | undefined, rawBody: string, signature: string | undefined, now: number, reason: string) {
  if (!db) return;
  try {
    await db.prepare(`
      INSERT INTO webhook_events (id, event_type, transaction_id, payload, signature, received_at, processed, hmac_valid, is_duplicate, processing_status, error_message)
      VALUES (?, 'rejected.signature', NULL, ?, ?, ?, 0, 0, 0, 'REJECTED_HMAC', ?)
    `).bind(generateUlid(), rawBody, signature || null, now, reason).run();
  } catch {
    // ignore audit write failures
  }
}

type ReserveResult =
  | { status: 'reserved'; eventId: string }
  | { status: 'duplicate'; existingId?: string }
  | { status: 'error' };

async function reserveWebhookEvent(
  db: D1Database | undefined,
  params: { eventType: string; txnId: string | null; rawBody: string; signature?: string; now: number; idempotencyKey: string }
): Promise<ReserveResult> {
  const eventId = generateUlid();
  if (!db) return { status: 'reserved', eventId };

  const existing: any = await db.prepare(
    'SELECT id FROM webhook_events WHERE idempotency_key = ? LIMIT 1'
  ).bind(params.idempotencyKey).first();

  if (existing) {
    return { status: 'duplicate', existingId: existing.id };
  }

  try {
    await db.prepare(`
      INSERT INTO webhook_events (id, event_type, transaction_id, payload, signature, received_at, processed, idempotency_key, hmac_valid, is_duplicate, processing_status)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, 1, 0, 'PROCESSING')
    `).bind(eventId, params.eventType, params.txnId, params.rawBody, params.signature || null, params.now, params.idempotencyKey).run();
    return { status: 'reserved', eventId };
  } catch (insertErr: any) {
    if (insertErr?.message?.includes('UNIQUE') || insertErr?.message?.includes('constraint')) {
      return { status: 'duplicate' };
    }
    console.error('[Webhook DB Save Error]', insertErr);
    return { status: 'error' };
  }
}

async function markWebhookCompleted(db: D1Database | undefined, eventId: string) {
  if (!db) return;
  await db.prepare(`
    UPDATE webhook_events
    SET processed = 1, processing_status = 'COMPLETED'
    WHERE id = ?
  `).bind(eventId).run();
}

async function markWebhookFailed(db: D1Database | undefined, eventId: string, errorMessage: string) {
  if (!db) return;
  await db.prepare(`
    UPDATE webhook_events
    SET processed = 0, processing_status = 'FAILED', error_message = ?
    WHERE id = ?
  `).bind(errorMessage, eventId).run();
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

// ==========================================
// WEBHOOK LISTENER DE PAYPAL REST v2
// POST /api/webhooks/paypal (y /webhooks/paypal)
// ==========================================
webhookRouter.post('/paypal', async (c) => {
  const rawBody = await c.req.text();
  const now = Math.floor(Date.now() / 1000);
  const isProd = c.env.ENVIRONMENT === 'production';

  if (isProd && !c.env.PAYPAL_WEBHOOK_ID) {
    console.error('[Security Alert] PAYPAL_WEBHOOK_ID is not configured in production');
    return c.json({ error: 'PAYPAL_WEBHOOK_ID must be configured in production' }, 500);
  }

  let eventData: any = {};
  try {
    eventData = JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const transmissionSig = c.req.header('PAYPAL-TRANSMISSION-SIG');
  const transmissionId = c.req.header('PAYPAL-TRANSMISSION-ID');
  const transmissionTime = c.req.header('PAYPAL-TRANSMISSION-TIME');
  const certUrl = c.req.header('PAYPAL-CERT-URL') || '';
  const authAlgo = c.req.header('PAYPAL-AUTH-ALGO') || 'SHA256withRSA';

  if (c.env.PAYPAL_WEBHOOK_ID || isProd) {
    if (!transmissionSig || !transmissionId || !transmissionTime) {
      return c.json({ error: 'Missing PayPal webhook signature headers' }, 401);
    }

    const parsedTimeMs = Date.parse(transmissionTime);
    if (!Number.isFinite(parsedTimeMs) || Math.abs(now - Math.floor(parsedTimeMs / 1000)) > 300) {
      return c.json({ error: 'PayPal webhook timestamp expired (anti-replay)' }, 401);
    }

    const clientId = c.env.PAYPAL_CLIENT_ID || 'sandbox_demo_client_id';
    const clientSecret = c.env.PAYPAL_CLIENT_SECRET || 'sandbox_demo_secret';
    const paypalEnv = c.env.PAYPAL_ENVIRONMENT === 'live' ? 'live' : 'sandbox';
    const client = new PayPalClient(clientId, clientSecret, paypalEnv);

    const isValid = await client.verifyWebhookSignature({
      webhookId: c.env.PAYPAL_WEBHOOK_ID!,
      transmissionId,
      transmissionTime,
      certUrl,
      authAlgo,
      transmissionSig,
      webhookEvent: eventData
    });

    if (!isValid) {
      await recordRejectedWebhook(c.env.DB, rawBody, transmissionSig, now, 'Firma PAYPAL-TRANSMISSION-SIG inválida');
      return c.json({ error: 'Invalid PayPal webhook signature' }, 401);
    }
  }

  const eventType = String(eventData.event_type || eventData.event || 'unknown');
  const resource = eventData.resource || {};
  const captureId = resource.id || null;
  const orderId = resource.supplementary_data?.related_ids?.order_id || resource.custom_id || resource.id || null;
  const idempotencyKey = eventData.id
    ? `paypal:${String(eventData.id)}`
    : `paypal:${eventType}:${orderId || captureId || generateUlid()}`;

  const reservation = await reserveWebhookEvent(c.env.DB, {
    eventType: `paypal.${eventType}`,
    txnId: captureId || orderId,
    rawBody,
    signature: transmissionSig,
    now,
    idempotencyKey
  });

  if (reservation.status === 'duplicate') {
    return c.json({
      received: true,
      duplicate: true,
      eventId: reservation.existingId,
      idempotencyKey,
      message: 'Evento PayPal duplicado ya procesado (idempotente)'
    }, 200);
  }
  if (reservation.status === 'error') {
    return c.json({ error: 'Error transitorio al guardar evento PayPal', retryable: true }, 500);
  }

  const { eventId } = reservation;

  try {
    if (c.env.DB && orderId) {
      if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
        const updateRes: any = await c.env.DB.prepare(`
          UPDATE payments
          SET status = 'PAID', transaction_id = ?, payment_method = 'PAYPAL', date_paid = ?
          WHERE (payable_id = ? OR id = ?) AND status != 'PAID'
        `).bind(captureId, now, orderId, orderId).run();

        const rowsAffected = updateRes?.meta?.changes ?? updateRes?.changes ?? 0;
        const payment: any = await c.env.DB.prepare(`
          SELECT id, merchant_id, amount, concept FROM payments WHERE payable_id = ? OR id = ? LIMIT 1
        `).bind(orderId, orderId).first();

        if (payment && rowsAffected > 0) {
          const existingLedger: any = await c.env.DB.prepare(`
            SELECT id FROM ledger_entries WHERE payment_id = ? OR (transaction_id = ? AND transaction_id IS NOT NULL) LIMIT 1
          `).bind(payment.id, captureId).first();

          if (!existingLedger) {
            const parsedAmount = parseFloat(resource.amount?.value || '');
            await c.env.DB.prepare(`
              INSERT INTO ledger_entries (id, merchant_id, payment_id, transaction_id, debit_account, credit_account, amount, concept, created_at)
              VALUES (?, ?, ?, ?, 'PAYPAL_MSI', 'VENTAS_MOSTRADOR', ?, ?, ?)
            `).bind(
              generateUlid(),
              payment.merchant_id,
              payment.id,
              captureId,
              Number.isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount : payment.amount,
              payment.concept || 'Pago PayPal Webhook Confirmado',
              now
            ).run();
          }
        }
      } else if (eventType === 'PAYMENT.CAPTURE.DENIED' || eventType === 'PAYMENT.CAPTURE.REFUNDED') {
        await c.env.DB.prepare(`
          UPDATE payments SET status = 'CANCELLED' WHERE (payable_id = ? OR id = ?) AND status != 'CANCELLED'
        `).bind(orderId, orderId).run();
      } else if (eventType === 'CUSTOMER.DISPUTE.CREATED') {
        const disputedOrderId = resource.disputed_transactions?.[0]?.seller_transaction_id || orderId;
        await c.env.DB.prepare(`
          UPDATE payments SET status = 'MANUAL_REVIEW' WHERE payable_id = ? OR transaction_id = ? OR id = ?
        `).bind(disputedOrderId, disputedOrderId, disputedOrderId).run();
      }
    }

    await markWebhookCompleted(c.env.DB, eventId);
    return c.json({ received: true, eventId, eventType, duplicate: false }, 200);
  } catch (processErr: any) {
    console.error('[PayPal Webhook Processing Error]', processErr);
    await markWebhookFailed(c.env.DB, eventId, processErr?.message || 'Error al procesar webhook PayPal');
    return c.json({ error: 'Error transitorio al procesar evento PayPal', retryable: true }, 500);
  }
});

// ==========================================
// WEBHOOK LISTENER DE ENVIA.COM (LOGÍSTICA)
// POST /api/webhooks/shipping (y /webhooks/shipping)
// ==========================================
const SHIPPING_STATUS_MAP: Record<string, string> = {
  created: 'LABEL_CREATED',
  in_transit: 'IN_TRANSIT',
  out_for_delivery: 'OUT_FOR_DELIVERY',
  delivered: 'DELIVERED',
  exception: 'EXCEPTION',
  cancelled: 'CANCELLED',
  returned: 'RETURNED'
};

webhookRouter.post('/shipping', async (c) => {
  const rawBody = await c.req.text();
  const now = Math.floor(Date.now() / 1000);
  const isProd = c.env.ENVIRONMENT === 'production';

  if (isProd && !c.env.ENVIA_WEBHOOK_SECRET) {
    console.error('[Security Alert] ENVIA_WEBHOOK_SECRET is not configured in production');
    return c.json({ error: 'ENVIA_WEBHOOK_SECRET must be configured in production' }, 500);
  }

  const signature = c.req.header('X-Envia-Signature');
  const authHeader = c.req.header('Authorization');

  if (c.env.ENVIA_WEBHOOK_SECRET || isProd) {
    const secret = c.env.ENVIA_WEBHOOK_SECRET!;
    let authorized = false;

    if (signature) {
      const expected = await computeHmacHex(secret, rawBody);
      authorized = timingSafeEqualStr(expected, signature.toLowerCase());
    } else if (authHeader?.startsWith('Bearer ')) {
      authorized = timingSafeEqualStr(secret, authHeader.slice(7).trim());
    } else {
      return c.json({ error: 'Missing Envia webhook authentication headers' }, 401);
    }

    if (!authorized) {
      await recordRejectedWebhook(c.env.DB, rawBody, signature || 'Bearer ***', now, 'Firma/token de Envia.com inválido');
      return c.json({ error: 'Invalid Envia webhook signature' }, 401);
    }
  }

  let eventData: any = {};
  try {
    eventData = JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const trackingNumber = String(eventData.trackingNumber || eventData.tracking_number || eventData.data?.trackingNumber || '').trim();
  const rawEvent = String(eventData.event || eventData.status || eventData.data?.status || '').trim().toLowerCase();

  if (!trackingNumber || !rawEvent) {
    return c.json({ error: 'trackingNumber y event/status son requeridos' }, 400);
  }

  const normalizedStatus = SHIPPING_STATUS_MAP[rawEvent] || rawEvent.toUpperCase();
  const carrier = String(eventData.carrier || eventData.data?.carrier || '').trim().toLowerCase();
  const idempotencyKey = eventData.id
    ? `envia:${String(eventData.id)}`
    : `envia:${trackingNumber}:${normalizedStatus}:${String(eventData.timestamp || '')}`;

  const reservation = await reserveWebhookEvent(c.env.DB, {
    eventType: `shipping.${rawEvent}`,
    txnId: trackingNumber,
    rawBody,
    signature: signature || undefined,
    now,
    idempotencyKey
  });

  if (reservation.status === 'duplicate') {
    return c.json({
      received: true,
      duplicate: true,
      eventId: reservation.existingId,
      idempotencyKey,
      message: 'Evento de envío duplicado ya procesado (idempotente)'
    }, 200);
  }
  if (reservation.status === 'error') {
    return c.json({ error: 'Error transitorio al guardar evento de envío', retryable: true }, 500);
  }

  const { eventId } = reservation;

  try {
    const checkpoint = {
      status: normalizedStatus,
      rawEvent,
      carrier: carrier || undefined,
      description: eventData.description || eventData.message || `Estado actualizado: ${normalizedStatus}`,
      location: eventData.location || eventData.city || 'México',
      timestamp: eventData.timestamp || new Date(now * 1000).toISOString()
    };

    if (c.env.DB) {
      await c.env.DB.prepare(`
        UPDATE shipping_labels
        SET status = ?, last_event_at = ?, last_checkpoint_json = ?
        WHERE tracking_number = ?
      `).bind(normalizedStatus, now, JSON.stringify(checkpoint), trackingNumber).run();
    }

    if (c.env.KV) {
      await c.env.KV.put(`envia_track:${trackingNumber}`, JSON.stringify(checkpoint), { expirationTtl: 86400 * 7 });
    }

    await markWebhookCompleted(c.env.DB, eventId);
    return c.json({
      received: true,
      eventId,
      trackingNumber,
      status: normalizedStatus,
      duplicate: false
    }, 200);
  } catch (processErr: any) {
    console.error('[Shipping Webhook Processing Error]', processErr);
    await markWebhookFailed(c.env.DB, eventId, processErr?.message || 'Error al procesar webhook Envia.com');
    return c.json({ error: 'Error transitorio al procesar evento de envío', retryable: true }, 500);
  }
});
