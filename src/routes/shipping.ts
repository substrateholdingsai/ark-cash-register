/**
 * Rutas de Logística y Envíos Nacionales con Envia.com
 * Exclusivo para suscriptores Ark Pro.
 * Cotización multicarrier (FedEx, Estafeta, Redpack), emisión de guías y rastreo.
 */

import { Hono } from 'hono';
import { Env, MerchantTier } from '../types';
import { EnviaService, EnviaAddress, EnviaPackage } from '../services/enviaService';
import { generateUlid } from '../utils/ulid';

export const shippingRouter = new Hono<{ Bindings: Env }>();

/**
 * Helper para verificar si un comercio tiene suscripción Pro activa.
 */
export async function isMerchantPro(env: Env, merchantId: string): Promise<boolean> {
  if (
    merchantId === '01JBAVSKINLAB0000000000000' || 
    merchantId === '01JBAVWE4NS5TGXHWGMX3KH23Q' ||
    merchantId === 'skinlab' || 
    merchantId === 'taqueria'
  ) {
    return true;
  }

  if (env.DB) {
    try {
      const row: any = await env.DB.prepare(
        'SELECT tier, pro_expires_at FROM merchants WHERE id = ? LIMIT 1'
      ).bind(merchantId).first();

      if (row && (row.tier === 'pro' || row.tier === 'enterprise')) {
        if (!row.pro_expires_at || row.pro_expires_at > Math.floor(Date.now() / 1000)) {
          return true;
        }
      }
    } catch {}
  }
  return false;
}

/**
 * 1. POST /api/merchant/:id/shipping/quote — Cotizar tarifas con paqueterías mexicanas
 */
shippingRouter.post('/:id/shipping/quote', async (c) => {
  const merchantId = c.req.param('id');
  const isPro = await isMerchantPro(c.env, merchantId);

  // Gated por Paywall Pro
  if (!isPro) {
    return c.json({
      code: 'PAYWALL_UPGRADE_REQUIRED',
      requiresUpgrade: true,
      priceMxnMonthly: 299,
      feature: 'SHIPPING_LOGISTICS',
      error: {
        message: 'Las cotizaciones y envíos nacionales automatizados con FedEx y Estafeta son exclusivos de Ark Pro.',
        type: 'PAYWALL_UPGRADE_REQUIRED',
        tier: 'free'
      }
    }, 402);
  }

  let body: any = {};
  try {
    body = await c.req.json();
  } catch {}

  const { postalCode, state = 'CMX', city = 'Ciudad de México', street = 'Calle Destino', number = '100', district = 'Centro', packageWeight = 1.0 } = body;

  if (!postalCode || postalCode.length < 5) {
    return c.json({
      error: { message: 'El código postal de 5 dígitos es requerido para cotizar', type: 'INVALID_POSTAL_CODE' }
    }, 400);
  }

  let merchantData: any = null;
  if (c.env.DB) {
    try {
      merchantData = await c.env.DB.prepare('SELECT * FROM merchants WHERE id = ? LIMIT 1').bind(merchantId).first();
    } catch {}
  }

  const envia = new EnviaService(c.env, merchantData?.envia_api_key);
  const origin = envia.getMerchantOrigin(merchantData);

  const destination: EnviaAddress = {
    name: 'Cliente Final',
    phone: merchantData?.phone || '525500000000',
    street,
    number,
    district,
    city,
    state,
    country: 'MX',
    postalCode: String(postalCode).slice(0, 5)
  };

  const packages: EnviaPackage[] = [
    {
      content: 'Productos de tienda ' + (merchantData?.alias || merchantData?.name || 'Ark Store'),
      amount: 1,
      type: 'box',
      weight: Number(packageWeight) || 1.0,
      dimensions: {
        length: 25,
        width: 20,
        height: 12
      }
    }
  ];

  try {
    const rates = await envia.quoteRates(origin, destination, packages);
    return c.json({
      success: true,
      merchantId,
      origin: { city: origin.city, state: origin.state, postalCode: origin.postalCode },
      destination: { city, state, postalCode },
      rates
    }, 200);
  } catch (err: any) {
    console.error('[Shipping Quote Error]', err);
    return c.json({
      error: { message: 'Error al cotizar tarifas de paquetería', type: 'SHIPPING_QUOTE_FAILED' }
    }, 500);
  }
});

/**
 * 2. POST /api/merchant/:id/shipping/label — Generar guía oficial (PDF + Tracking)
 */
shippingRouter.post('/:id/shipping/label', async (c) => {
  const merchantId = c.req.param('id');
  const isPro = await isMerchantPro(c.env, merchantId);

  if (!isPro) {
    return c.json({
      code: 'PAYWALL_UPGRADE_REQUIRED',
      requiresUpgrade: true,
      priceMxnMonthly: 299,
      feature: 'SHIPPING_LOGISTICS',
      error: {
        message: 'La generación de guías oficiales de paquetería requiere suscripción Ark Pro.',
        type: 'PAYWALL_UPGRADE_REQUIRED'
      }
    }, 402);
  }

  let body: any = {};
  try {
    body = await c.req.json();
  } catch {}

  const { carrier = 'estafeta', service = 'ground', orderReference, paymentId, destination = {} } = body;

  let merchantData: any = null;
  if (c.env.DB) {
    try {
      merchantData = await c.env.DB.prepare('SELECT * FROM merchants WHERE id = ? LIMIT 1').bind(merchantId).first();
    } catch {}
  }

  const envia = new EnviaService(c.env, merchantData?.envia_api_key);
  const origin = envia.getMerchantOrigin(merchantData);

  const destAddress: EnviaAddress = {
    name: destination.name || 'Cliente Mostrador',
    company: destination.company || '',
    phone: destination.phone || '525500000000',
    street: destination.street || 'Av. Insurgentes Sur',
    number: destination.number || '123',
    district: destination.district || 'Roma Norte',
    city: destination.city || 'Ciudad de México',
    state: destination.state || 'CMX',
    country: 'MX',
    postalCode: destination.postalCode || '06700'
  };

  const packages: EnviaPackage[] = [
    {
      content: 'Orden ' + (orderReference || paymentId || 'Ark Store'),
      amount: 1,
      type: 'box',
      weight: 1.2,
      dimensions: {
        length: 25,
        width: 20,
        height: 12
      }
    }
  ];

  try {
    const labelResult = await envia.generateLabel(origin, destAddress, packages, carrier, service);
    const labelId = generateUlid();
    const now = Math.floor(Date.now() / 1000);

    if (c.env.DB) {
      try {
        await c.env.DB.prepare(`
          INSERT INTO shipping_labels (
            id, merchant_id, payment_id, order_reference, carrier, service,
            tracking_number, tracking_url, label_url, cost_mxn, is_simulated,
            destination_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          labelId,
          merchantId,
          paymentId || null,
          orderReference || null,
          labelResult.carrier,
          labelResult.service,
          labelResult.trackingNumber,
          labelResult.trackingUrl,
          labelResult.labelUrl,
          labelResult.totalCost,
          labelResult.isSimulated ? 1 : 0,
          JSON.stringify(destAddress),
          now
        ).run();

        // Si se ligó a un pago existente, actualizar los datos de envío del pago
        if (paymentId) {
          await c.env.DB.prepare(`
            UPDATE payments 
            SET shipping_carrier = ?, shipping_service = ?, shipping_tracking_number = ?,
                shipping_tracking_url = ?, shipping_label_url = ?, shipping_cost = ?
            WHERE id = ? AND merchant_id = ?
          `).bind(
            labelResult.carrier,
            labelResult.service,
            labelResult.trackingNumber,
            labelResult.trackingUrl,
            labelResult.labelUrl,
            labelResult.totalCost,
            paymentId,
            merchantId
          ).run();
        }
      } catch (dbErr) {
        console.error('[Shipping Label DB Insert Error]', dbErr);
      }
    }

    return c.json({
      success: true,
      labelId,
      merchantId,
      carrier: labelResult.carrier,
      service: labelResult.service,
      trackingNumber: labelResult.trackingNumber,
      trackingUrl: labelResult.trackingUrl,
      labelUrl: labelResult.labelUrl,
      totalCost: labelResult.totalCost,
      currency: labelResult.currency,
      isSimulated: labelResult.isSimulated
    }, 201);
  } catch (err: any) {
    console.error('[Generate Shipping Label Error]', err);
    return c.json({
      error: { message: 'Error al emitir guía con paquetería', type: 'LABEL_GENERATION_FAILED' }
    }, 500);
  }
});

/**
 * 3. GET /api/merchant/:id/shipping/track/:carrier/:trackingNumber — Rastrear paquete
 */
shippingRouter.get('/:id/shipping/track/:carrier/:trackingNumber', async (c) => {
  const merchantId = c.req.param('id');
  const carrier = c.req.param('carrier');
  const trackingNumber = c.req.param('trackingNumber');

  let merchantData: any = null;
  if (c.env.DB) {
    try {
      merchantData = await c.env.DB.prepare('SELECT * FROM merchants WHERE id = ? LIMIT 1').bind(merchantId).first();
    } catch {}
  }

  const envia = new EnviaService(c.env, merchantData?.envia_api_key);
  const result = await envia.trackShipment(carrier, trackingNumber);

  return c.json({
    success: true,
    carrier,
    trackingNumber,
    tracking: result
  });
});

/**
 * 4. GET /api/merchant/:id/shipping/labels — Consultar historial de guías emitidas
 */
shippingRouter.get('/:id/shipping/labels', async (c) => {
  const merchantId = c.req.param('id');

  let labels: any[] = [];
  if (c.env.DB) {
    try {
      const res = await c.env.DB.prepare(
        'SELECT * FROM shipping_labels WHERE merchant_id = ? ORDER BY created_at DESC LIMIT 50'
      ).bind(merchantId).all();
      labels = res.results || [];
    } catch {}
  }

  return c.json({
    success: true,
    merchantId,
    labels
  });
});
