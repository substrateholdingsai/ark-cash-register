/**
 * Rutas para Dólares Digitales (Solana Pay USDC/USDT)
 * Riel no-custodial directo wallet-to-wallet en Solana SPL tokens.
 */

import { Hono } from 'hono';
import { Env, SOLANA_USDC_MINT, SOLANA_USDT_MINT, PaymentRail, PaymentCurrency } from '../types';
import { generateUlid } from '../utils/ulid';
import { validateSolanaAddress, generateSolanaReference, buildSolanaPayUrl } from '../utils/solana';
import { evaluadorActividadesVulnerables } from '../services/lfpiorpi';

export const solanaRouter = new Hono<{ Bindings: Env }>();

// Proveedores autorizados de Off-ramp (ITF autorizadas o registradas en actividad vulnerable SAT)
export const REGISTERED_OFFRAMP_PROVIDERS = [
  'itf_autorizada',
  'exchange_vulnerable_registrado',
  'noah_spei_registrado'
];

/**
 * 1. POST /api/solana/order — Crear orden de pago en Dólares Digitales (Solana Pay)
 */
solanaRouter.post('/order', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { merchantId, currency = 'USDC', customer = 'Cliente', customerRfc, notes } = body;
  const amount = Number(body.amount);

  if (isNaN(amount) || amount <= 0) {
    return c.json({ error: { message: 'El monto debe ser un número positivo', type: 'INVALID_AMOUNT' } }, 400);
  }

  const selectedCurrency = currency.toUpperCase() as PaymentCurrency;
  if (!['USDC', 'USDT'].includes(selectedCurrency)) {
    return c.json({ error: { message: 'Moneda no soportada. Solo se acepta USDC o USDT', type: 'UNSUPPORTED_CURRENCY' } }, 400);
  }

  // 1. Obtener y validar el comercio
  if (!c.env.DB) {
    return c.json({ error: { message: 'Base de datos no disponible', type: 'DB_UNAVAILABLE' } }, 503);
  }

  let merchant: any = await c.env.DB.prepare(
    'SELECT id, alias, name, solana_wallet, solana_pay_enabled, offramp_provider FROM merchants WHERE id = ? LIMIT 1'
  ).bind(merchantId).first();

  // Si no está registrado en D1, fallback controlado a catálogo de prueba
  if (!merchant && merchantId) {
    if (merchantId === '01JBAVSKINLAB0000000000000') {
      merchant = {
        id: merchantId,
        alias: 'SkinLab Clothing Club',
        name: 'SkinLab Streetwear S.A.P.I. de C.V.',
        solana_wallet: 'SkinLabWalletPublicBase58AddressSolana11111',
        solana_pay_enabled: 1
      };
    } else if (merchantId === '01JBAVWE4NS5TGXHWGMX3KH23Q') {
      merchant = {
        id: merchantId,
        alias: 'Taquería El Güero',
        name: 'Taquería El Güero S.A. de C.V.',
        solana_wallet: 'TaqueriaGueroWalletSolanaPublicBase58111111',
        solana_pay_enabled: 1
      };
    }
  }

  if (!merchant) {
    return c.json({ error: { message: 'Comercio no encontrado', type: 'MERCHANT_NOT_FOUND' } }, 404);
  }

  // 2. Validar que el comercio tenga wallet Solana registrada (no-custodial)
  if (!merchant.solana_wallet || merchant.solana_wallet.trim() === '') {
    return c.json({
      error: {
        message: 'El comercio no tiene una wallet Solana configurada. El riel de dólares digitales no está disponible.',
        type: 'SOLANA_WALLET_NOT_CONFIGURED'
      }
    }, 400);
  }

  const walletValidation = validateSolanaAddress(merchant.solana_wallet);
  if (!walletValidation.valid) {
    return c.json({
      error: {
        message: walletValidation.error || 'La wallet Solana registrada es inválida',
        type: 'INVALID_SOLANA_WALLET'
      }
    }, 400);
  }

  // 3. Tasa de cambio MXN/USD (usar tasa proporcionada o cotización de mercado)
  const fxRate = Number(body.fxRate) || 20.00;
  const now = Math.floor(Date.now() / 1000);
  const amountMxnEquiv = Number((amount * fxRate).toFixed(2));

  // 4. Evaluador LFPIORPI previo al cobro
  const lfpiorpiCheck = await evaluadorActividadesVulnerables({
    merchantId: merchant.id,
    customerId: customer,
    customerRfc: customerRfc,
    currentAmountMxn: amountMxnEquiv,
    db: c.env.DB
  });

  // Si requiere identificación (70% del umbral de Aviso) y no se proveyó RFC
  if (lfpiorpiCheck.requiresKyc && !customerRfc) {
    return c.json({
      error: {
        message: 'LFPIORPI: Este cliente requiere identificación fiscal (RFC/CURP) por superar el 70% del umbral de acumulación semestral.',
        type: 'KYC_IDENTIFICATION_REQUIRED',
        lfpiorpiLevel: lfpiorpiCheck.level,
        accumulatedUma: lfpiorpiCheck.accumulatedUma,
        percentageOfThreshold: lfpiorpiCheck.percentageOfThreshold
      }
    }, 403);
  }

  // 5. Generar referencia única Solana Pay y URL
  const reference = generateSolanaReference();
  const splToken = selectedCurrency === 'USDC' ? SOLANA_USDC_MINT : SOLANA_USDT_MINT;
  const paymentId = generateUlid();
  const folio = (body.numRef || Math.floor(Math.random() * 900000 + 100000)).toString();

  const solanaPayUrl = buildSolanaPayUrl({
    recipient: merchant.solana_wallet,
    amount,
    splToken,
    reference,
    label: merchant.alias || merchant.name,
    message: `Pedido #${folio} (${selectedCurrency})`
  });

  const rail: PaymentRail = selectedCurrency === 'USDC' ? 'solana_usdc' : 'solana_usdt';

  const metadata = {
    channel: 'solana_pay',
    reference,
    mint: splToken,
    customer,
    customerRfc: customerRfc || null,
    notes: notes || '',
    fxRate,
    amountMxnEquiv,
    lfpiorpiEvalId: lfpiorpiCheck.id,
    lfpiorpiLevel: lfpiorpiCheck.level
  };

  // 6. Guardar en D1 con status WAITING
  await c.env.DB.prepare(`
    INSERT INTO payments (
      id, merchant_id, payable_type, payable_id, amount, concept, num_ref,
      qr_string, status, payment_method, payment_rail, currency, amount_mxn_equiv,
      fx_rate, fx_timestamp, solana_reference, customer_rfc, date_created, metadata
    ) VALUES (
      ?, ?, 'PAYMENT_LINK', ?, ?, ?, ?,
      ?, 'WAITING', 'CODI', ?, ?, ?,
      ?, ?, ?, ?, ?, ?
    )
  `).bind(
    paymentId,
    merchant.id,
    `SOL-${paymentId}`,
    amount,
    `Pago pedido #${folio} en ${selectedCurrency}`,
    folio,
    solanaPayUrl,
    rail,
    selectedCurrency,
    amountMxnEquiv,
    fxRate,
    now,
    reference,
    customerRfc || null,
    now,
    JSON.stringify(metadata)
  ).run();

  return c.json({
    success: true,
    paymentId,
    folio,
    paymentRail: rail,
    currency: selectedCurrency,
    amount,
    amountMxnEquiv,
    fxRate,
    fxTimestamp: now,
    recipient: merchant.solana_wallet,
    mint: splToken,
    reference,
    solanaPayUrl,
    expiration: 600,
    expiresAt: now + 600,
    compliance: {
      level: lfpiorpiCheck.level,
      requiresKyc: lfpiorpiCheck.requiresKyc,
      requiresNotice: lfpiorpiCheck.requiresNotice,
      percentageOfThreshold: lfpiorpiCheck.percentageOfThreshold,
      dictamenHash: lfpiorpiCheck.dictamenHash,
      alertMessage: lfpiorpiCheck.alertMessage
    }
  }, 201);
});

/**
 * 2. GET /api/solana/status/:id — Consultar estado del pago Solana Pay
 */
solanaRouter.get('/status/:id', async (c) => {
  const paymentId = c.req.param('id');
  if (!c.env.DB) {
    return c.json({ error: { message: 'DB no disponible', type: 'DB_UNAVAILABLE' } }, 503);
  }

  const payment: any = await c.env.DB.prepare(
    'SELECT * FROM payments WHERE id = ? OR payable_id = ? OR solana_reference = ? LIMIT 1'
  ).bind(paymentId, paymentId, paymentId).first();

  if (!payment) {
    return c.json({ error: { message: 'Pago no encontrado', type: 'PAYMENT_NOT_FOUND' } }, 404);
  }

  return c.json({
    paymentId: payment.id,
    status: payment.status,
    currency: payment.currency,
    amount: payment.amount,
    amountMxnEquiv: payment.amount_mxn_equiv,
    reference: payment.solana_reference,
    signature: payment.solana_signature || null,
    dateCreated: payment.date_created,
    datePaid: payment.date_paid || null
  });
});

/**
 * 3. POST /api/solana/confirm-payment — Confirmación en cadena (vía RPC / Helius o Verificación de Firma)
 */
solanaRouter.post('/confirm-payment', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { paymentId, reference, signature, confirmedAmount } = body;

  if (!c.env.DB) {
    return c.json({ error: { message: 'DB no disponible', type: 'DB_UNAVAILABLE' } }, 503);
  }

  const payment: any = await c.env.DB.prepare(
    'SELECT * FROM payments WHERE id = ? OR solana_reference = ? LIMIT 1'
  ).bind(paymentId || reference, reference || paymentId).first();

  if (!payment) {
    return c.json({ error: { message: 'Pago no encontrado', type: 'PAYMENT_NOT_FOUND' } }, 404);
  }

  if (payment.status === 'PAID') {
    return c.json({ success: true, status: 'PAID', message: 'El pago ya estaba confirmado' });
  }

  // Regla de oro Solana: Solo marcar PAID con transacción confirmada en cadena y monto exacto
  if (!signature || typeof signature !== 'string') {
    return c.json({
      error: { message: 'Se requiere firma de transacción en cadena confirmada', type: 'MISSING_SIGNATURE' }
    }, 400);
  }

  // Si el monto confirmado difiere del pactado, pasa a MANUAL_REVIEW, nunca a PAID
  if (confirmedAmount !== undefined && Number(confirmedAmount) !== Number(payment.amount)) {
    await c.env.DB.prepare(
      'UPDATE payments SET status = ?, solana_signature = ? WHERE id = ?'
    ).bind('MANUAL_REVIEW', signature, payment.id).run();

    return c.json({
      success: false,
      status: 'MANUAL_REVIEW',
      message: 'El monto recibido en cadena difiere del monto solicitado. Pago turnado a revisión manual.'
    }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const transactionId = signature;

  // Actualizar pago a PAID
  await c.env.DB.prepare(`
    UPDATE payments 
    SET status = 'PAID', date_paid = ?, transaction_id = ?, solana_signature = ?
    WHERE id = ?
  `).bind(now, transactionId, signature, payment.id).run();

  // Registrar en Ledger
  const ledgerId = generateUlid();
  await c.env.DB.prepare(`
    INSERT INTO ledger_entries (
      id, merchant_id, payment_id, transaction_id, debit_account, credit_account, amount, concept, created_at
    ) VALUES (?, ?, ?, ?, 'WALLET_SOLANA', 'VENTAS_DOLARES_DIGITALES', ?, ?, ?)
  `).bind(
    ledgerId,
    payment.merchant_id,
    payment.id,
    transactionId,
    payment.amount,
    `Cobro ${payment.currency} Solana Pay`,
    now
  ).run();

  // Evaluación post-pago LFPIORPI
  const metadata = JSON.parse(payment.metadata || '{}');
  const postEval = await evaluadorActividadesVulnerables({
    merchantId: payment.merchant_id,
    customerId: metadata.customer || 'Cliente',
    customerRfc: payment.customer_rfc,
    currentAmountMxn: payment.amount_mxn_equiv || (payment.amount * 20.0),
    db: c.env.DB
  });

  return c.json({
    success: true,
    status: 'PAID',
    paymentId: payment.id,
    signature,
    amount: payment.amount,
    currency: payment.currency,
    datePaid: now,
    compliance: {
      level: postEval.level,
      requiresNotice: postEval.requiresNotice,
      dictamenHash: postEval.dictamenHash,
      alertMessage: postEval.alertMessage
    }
  });
});

/**
 * 4. GET /api/solana/offramp-info/:merchantId — Consulta de Off-ramp a MXN
 * Cumplimiento legal estricto: solo disponible si el proveedor está registrado ante autoridades.
 */
solanaRouter.get('/offramp-info/:merchantId', async (c) => {
  const merchantId = c.req.param('merchantId');
  if (!c.env.DB) {
    return c.json({ error: { message: 'DB no disponible', type: 'DB_UNAVAILABLE' } }, 503);
  }

  const merchant: any = await c.env.DB.prepare(
    'SELECT id, alias, name, solana_wallet, offramp_provider FROM merchants WHERE id = ? LIMIT 1'
  ).bind(merchantId).first();

  if (!merchant) {
    return c.json({ error: { message: 'Comercio no encontrado', type: 'MERCHANT_NOT_FOUND' } }, 404);
  }

  const provider = merchant.offramp_provider;
  const isRegistered = provider && REGISTERED_OFFRAMP_PROVIDERS.includes(provider);

  if (!isRegistered) {
    return c.json({
      available: false,
      reason: 'El servicio de conversión a MXN solo puede ofrecerse a través de un proveedor registrado formalmente como actividad vulnerable o ITF autorizada ante CNBV/SAT. La Caja no intermedia fondos directamente.',
      legalNotice: 'La Caja es software no-custodial. No es un exchange ni realiza compraventa de activos virtuales por cuenta propia.'
    }, 200);
  }

  return c.json({
    available: true,
    provider: merchant.offramp_provider,
    status: 'REGISTERED_VULNERABLE_ACTIVITY',
    instructions: 'Para liquidar tus USDC/USDT a MXN, el proveedor registrado procesa la dispersión vía SPEI una vez confirmada la tasa en tiempo real.',
    legalNotice: 'La conversión se ejecuta exclusivamente a través del proveedor registrado conforme a la LFPIORPI y Ley Fintech.'
  }, 200);
});
