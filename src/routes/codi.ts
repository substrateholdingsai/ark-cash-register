import { Hono } from 'hono';
import { Env, PeyMetadata } from '../types';
import { PeyClient } from '../services/peyClient';
import { generateUlid } from '../utils/ulid';

export const codiRouter = new Hono<{ Bindings: Env }>();

// Generar QR CoDi en mostrador (Pantalla B)
codiRouter.post('/qr', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const amount = Number(body.amount);

  if (isNaN(amount) || amount < 0) {
    return c.json({ error: { message: 'El monto debe ser un número mayor o igual a 0', type: 'INVALID_AMOUNT' } }, 400);
  }

  const merchantId = body.merchantId || '01JBAVWE4NS5TGXHWGMX3KH23Q';
  const deviceId = body.deviceId || 'pos-caja-01';
  const sessionId = body.sessionId || generateUlid();
  const operator = body.operator || 'cajero-principal';
  const concept = body.concept || 'Venta en mostrador';
  const expiration = body.expiration !== undefined ? Math.max(360, Number(body.expiration)) : 600; // default 10 min
  const numRef = (body.numRef || Math.floor(Math.random() * 900000 + 100000)).toString();

  const metadata: PeyMetadata = {
    merchantId,
    deviceId,
    sessionId,
    source: 'cash-register',
    screen: 'cobrar-aqui',
    operator,
    concept
  };

  const client = new PeyClient(c.env.PEY_API_URL, c.env.PEY_API_KEY);
  // Si el comercio fue registrado en Pey, su merchantId es el bankAccountId en Pey.
  // Si no se especifica o es el comercio seed de prueba, se omite para usar la cuenta default de la API Key.
  const targetBankAccountId = body.bankAccountId || (merchantId !== '01JBAVWE4NS5TGXHWGMX3KH23Q' ? merchantId : undefined);

  try {
    const peyRes = await client.createCodiQr({
      amount,
      concept,
      expiration,
      numRef,
      bankAccountId: targetBankAccountId,
      metadata
    });

    const paymentId = generateUlid();
    const now = Math.floor(Date.now() / 1000);

    // Guardar en D1
    if (c.env.DB) {
      // Asegurar que el merchant exista para cumplir con la FK
      await c.env.DB.prepare(`
        INSERT OR IGNORE INTO merchants (id, alias, name, clabe, entity, codi_status, created_at, updated_at)
        VALUES (?, 'Taquería El Güero', 'Taquería El Güero S.A. de C.V.', '012180001234567899', 'BUSINESS', 'ACTIVE', ?, ?)
      `).bind(merchantId, now, now).run();

      await c.env.DB.prepare(`
        INSERT INTO payments (id, merchant_id, payable_type, payable_id, amount, concept, num_ref, qr_string, status, date_created, metadata)
        VALUES (?, ?, 'CODI_QR', ?, ?, ?, ?, ?, 'WAITING', ?, ?)
      `).bind(
        paymentId,
        merchantId,
        peyRes.id,
        amount,
        concept,
        numRef,
        peyRes.qrString,
        now,
        JSON.stringify(metadata)
      ).run();
    }

    return c.json({
      success: true,
      paymentId,
      qrId: peyRes.id,
      qrString: peyRes.qrString,
      amount,
      concept,
      numRef,
      expiration,
      expiresAt: now + expiration
    }, 201);
  } catch (err: any) {
    console.error('Error al generar CoDi QR:', err);
    return c.json({
      error: {
        message: err.message || 'Error al comunicarse con Pey CoDi API',
        type: err.details?.error?.type || 'CODI_QR_ERROR',
        requestId: err.details?.error?.requestId
      }
    }, err.status || 500);
  }
});

// Polling de verificación de estado CoDi QR (soporta /qr/:id/status, /qr/:id y /:id)
const checkStatusHandler = async (c: any) => {
  const qrId = c.req.param('id');
  const now = Math.floor(Date.now() / 1000);

  // 1. Revisar estado local en D1
  let localPayment: any = null;
  if (c.env.DB) {
    localPayment = await c.env.DB.prepare(
      'SELECT * FROM payments WHERE payable_id = ? OR id = ? LIMIT 1'
    ).bind(qrId, qrId).first();
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

  // 2. Fallback dual: Consultar directamente a Pey
  const client = new PeyClient(c.env.PEY_API_URL, c.env.PEY_API_KEY);
  try {
    const txResponse = await client.getCodiQrTransactions(qrId);
    const paidItem = txResponse.items?.find((item) => item.status === 'PAID');

    if (paidItem) {
      const datePaid = paidItem.datePaid || now;
      const txnId = paidItem.id;

      // Actualizar D1
      if (c.env.DB && localPayment) {
        await c.env.DB.prepare(`
          UPDATE payments 
          SET status = 'PAID', transaction_id = ?, payment_method = 'CODI', date_paid = ?
          WHERE id = ?
        `).bind(txnId, datePaid, localPayment.id).run();

        // Generar Asiento Contable Compliance para ARK Ledger
        const ledgerId = generateUlid();
        await c.env.DB.prepare(`
          INSERT INTO ledger_entries (id, merchant_id, payment_id, transaction_id, debit_account, credit_account, amount, concept, created_at)
          VALUES (?, ?, ?, ?, '102.01 Bancos CoDi Banxico', '401.01 Ventas de Mostrador', ?, ?, ?)
        `).bind(
          ledgerId,
          localPayment.merchant_id,
          localPayment.id,
          txnId,
          localPayment.amount,
          localPayment.concept || 'Cobro CoDi Mostrador',
          now
        ).run();
      }

      return c.json({
        status: 'PAID',
        amount: paidItem.amount,
        datePaid,
        transactionId: txnId,
        paymentId: localPayment?.id
      });
    }

    return c.json({
      status: 'WAITING',
      qrId,
      checkedAt: now
    });
  } catch (err: any) {
    return c.json({
      status: localPayment?.status || 'WAITING',
      qrId,
      checkedAt: now
    });
  }
};

codiRouter.get('/qr/:id/status', checkStatusHandler);
codiRouter.get('/qr/:id', checkStatusHandler);
codiRouter.get('/:id/status', checkStatusHandler);
codiRouter.get('/:id', checkStatusHandler);

// Cobro CoDi Push Notification (Envío directo a celular)
codiRouter.post('/pn', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const amount = Number(body.amount);
  const phoneNumber = String(body.phoneNumber || '').replace(/\D/g, '');

  if (phoneNumber.length !== 10) {
    return c.json({ error: { message: 'El número telefónico debe tener exactamente 10 dígitos', type: 'INVALID_PARAMETER' } }, 400);
  }

  const client = new PeyClient(c.env.PEY_API_URL, c.env.PEY_API_KEY);
  const merchantId = body.merchantId || c.req.query('merchantId');
  const targetBankAccountId = body.bankAccountId || (merchantId && merchantId !== '01JBAVWE4NS5TGXHWGMX3KH23Q' ? merchantId : undefined);

  try {
    const res = await client.createCodiPn({
      amount,
      phoneNumber,
      concept: body.concept || 'Cobro CoDi Móvil',
      numRef: body.numRef,
      bankAccountId: targetBankAccountId
    });

    return c.json({
      success: true,
      transactionId: res.transactionId,
      codiId: res.codiId
    });
  } catch (err: any) {
    return c.json({
      error: {
        message: err.message,
        type: err.details?.error?.type || 'CODI_PN_ERROR'
      }
    }, err.status || 500);
  }
});
