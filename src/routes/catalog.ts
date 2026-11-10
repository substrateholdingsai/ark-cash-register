/**
 * Rutas para Catálogo Digital, Arquitectura Freemium (Plan Free vs Pro)
 * y Generación de Fotos de Producto con IA (Workers AI + R2)
 */

import { Hono } from 'hono';
import { Env, MerchantTier } from '../types';
import { generateProductImage } from '../services/catalogImageGenerator';
import { getCatalogForMerchant } from '../data/catalogs';

export const catalogRouter = new Hono<{ Bindings: Env }>();

/**
 * 1. GET /api/merchant/:id/tier — Consultar plan actual y créditos de fotos IA
 */
catalogRouter.get('/:id/tier', async (c) => {
  const merchantId = c.req.param('id');
  let tier: MerchantTier = 'free';
  let aiPhotoCredits = 2; // 2 pruebas gratis para comercios nuevos
  let proExpiresAt: number | null = null;

  // Comercios semilla demostrativos tienen Pro activo para testing
  if (
    merchantId === '01JBAVSKINLAB0000000000000' || 
    merchantId === '01JBAVWE4NS5TGXHWGMX3KH23Q' ||
    merchantId === 'skinlab' || 
    merchantId === 'taqueria'
  ) {
    tier = 'pro';
    aiPhotoCredits = 100;
  }

  if (c.env.DB) {
    try {
      const row: any = await c.env.DB.prepare(
        'SELECT tier, pro_expires_at, ai_photo_credits FROM merchants WHERE id = ? LIMIT 1'
      ).bind(merchantId).first();

      if (row) {
        tier = (row.tier as MerchantTier) || tier;
        aiPhotoCredits = row.ai_photo_credits !== undefined && row.ai_photo_credits !== null ? Number(row.ai_photo_credits) : aiPhotoCredits;
        proExpiresAt = row.pro_expires_at || null;
      }
    } catch {}
  }

  const isPro = tier === 'pro' || tier === 'enterprise';

  return c.json({
    merchantId,
    tier,
    isPro,
    isProActive: isPro,
    aiPhotoCredits,
    proExpiresAt,
    features: {
      codiUnlimited: true,
      speiFallback: true,
      satInvoices: true,
      digitalCatalog: isPro,
      aiPhotoStudio: isPro || aiPhotoCredits > 0,
      whatsAppShare: isPro,
      paypalMsi: isPro,
      storefront: isPro,
      aiPhotos: isPro || aiPhotoCredits > 0,
      whatsappCatalog: isPro,
      shippingRates: isPro,
      shippingLabels: isPro
    }
  });
});

/**
 * 2. POST /api/merchant/:id/upgrade-pro — Activar suscripción o prueba Ark Pro
 */
catalogRouter.post('/:id/upgrade-pro', async (c) => {
  const merchantId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const { plan = 'pro', durationMonths = 1 } = body;

  const now = Math.floor(Date.now() / 1000);
  const proExpiresAt = now + (durationMonths * 30 * 86400);
  let updatedCredits = 50;

  if (c.env.DB) {
    try {
      const row: any = await c.env.DB.prepare(
        'SELECT ai_photo_credits FROM merchants WHERE id = ? LIMIT 1'
      ).bind(merchantId).first();
      updatedCredits = ((row?.ai_photo_credits !== undefined && row?.ai_photo_credits !== null) ? Number(row.ai_photo_credits) : 0) + 50;

      await c.env.DB.prepare(`
        UPDATE merchants 
        SET tier = 'pro', pro_expires_at = ?, ai_photo_credits = ?, updated_at = ?
        WHERE id = ?
      `).bind(proExpiresAt, updatedCredits, now, merchantId).run();

      if (c.env.KV) {
        await c.env.KV.delete(`merchant:${merchantId}`);
      }
    } catch (err: any) {
      console.error('[Upgrade Pro Error]', err);
    }
  }

  return c.json({
    success: true,
    merchantId,
    tier: 'pro',
    isPro: true,
    isProActive: true,
    aiPhotoCredits: updatedCredits,
    proExpiresAt,
    message: '¡Felicidades! Tu mostrador ahora cuenta con Ark Pro: Catálogo Digital, Fotos con IA, Envíos por WhatsApp y Meses Sin Intereses activados.'
  });
});

/**
 * 3. POST /api/merchant/:id/catalog/generate-image — Generar foto de estudio con IA
 */
catalogRouter.post('/:id/catalog/generate-image', async (c) => {
  const merchantId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const { productId, productName, description, category, style } = body;

  if (!productId || !productName) {
    return c.json({
      error: { message: 'productId y productName son requeridos', type: 'INVALID_PARAMETERS' }
    }, 400);
  }

  // Verificar suscripción o créditos disponibles
  let tier: MerchantTier = 'free';
  let aiPhotoCredits = 2;

  if (
    merchantId === '01JBAVSKINLAB0000000000000' || 
    merchantId === '01JBAVWE4NS5TGXHWGMX3KH23Q' ||
    merchantId === 'skinlab' || 
    merchantId === 'taqueria'
  ) {
    tier = 'pro';
    aiPhotoCredits = 100;
  }

  if (c.env.DB) {
    try {
      const row: any = await c.env.DB.prepare(
        'SELECT tier, ai_photo_credits FROM merchants WHERE id = ? LIMIT 1'
      ).bind(merchantId).first();

      if (row) {
        tier = (row.tier as MerchantTier) || tier;
        aiPhotoCredits = row.ai_photo_credits !== undefined && row.ai_photo_credits !== null ? Number(row.ai_photo_credits) : aiPhotoCredits;
      }
    } catch {}
  }

  const isPro = tier === 'pro' || tier === 'enterprise';

  // Si no es Pro y ya no tiene créditos gratis -> Paywall
  if (!isPro && aiPhotoCredits <= 0) {
    return c.json({
      code: 'PAYWALL_UPGRADE_REQUIRED',
      requiresUpgrade: true,
      priceMxnMonthly: 299,
      error: {
        message: 'Has agotado tus fotos gratis de prueba. Pásate a Ark Pro para generar fotos de catálogo ilimitadas con IA.',
        type: 'PAYWALL_UPGRADE_REQUIRED',
        tier: 'free',
        remainingCredits: 0
      }
    }, 402);
  }

  try {
    const result = await generateProductImage(c.env, merchantId, productId, productName, {
      description,
      category,
      style
    });

    // Descontar crédito si está en modo Free Trial
    let remainingCredits = aiPhotoCredits;
    if (!isPro && aiPhotoCredits > 0 && c.env.DB) {
      remainingCredits = Math.max(0, aiPhotoCredits - 1);
      try {
        await c.env.DB.prepare(
          'UPDATE merchants SET ai_photo_credits = ? WHERE id = ?'
        ).bind(remainingCredits, merchantId).run();
      } catch {}
    }

    return c.json({
      success: true,
      productId,
      imageUrl: result.imageUrl,
      prompt: result.prompt,
      isMock: result.isMock,
      tier,
      remainingCredits
    }, 201);
  } catch (err: any) {
    console.error('[Generate Image Error]', err);
    return c.json({
      error: {
        message: err.message || 'Error al generar imagen de producto con IA',
        type: 'AI_IMAGE_GENERATION_FAILED'
      }
    }, 500);
  }
});

/**
 * 4. GET /api/catalog/images/:merchantId/:productId — Servir imagen de producto desde R2
 */
export async function handleServeCatalogImage(c: any) {
  const merchantId = c.req.param('merchantId');
  const productId = c.req.param('productId');

  const r2Key = `catalog-images/${merchantId}/${productId}.jpg`;

  if (c.env.R2) {
    try {
      const object = await c.env.R2.get(r2Key);
      if (object) {
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('etag', object.httpEtag);
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');
        headers.set('Content-Type', object.httpMetadata?.contentType || 'image/jpeg');
        return new Response(object.body, { headers });
      }
    } catch (err) {
      console.error('[R2 Get Image Error]', err);
    }
  }

  // Fallback: Generar SVG dinámico limpio con el ID
  const svgPlaceholder = `
    <svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#1e293b;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#0f172a;stop-opacity:1" />
        </linearGradient>
      </defs>
      <rect width="600" height="600" fill="url(#bg)" />
      <circle cx="300" cy="250" r="90" fill="#334155" />
      <text x="300" y="270" font-size="64" text-anchor="middle" fill="#cbd5e1">✨</text>
      <text x="300" y="380" font-size="22" font-family="system-ui, sans-serif" font-weight="bold" text-anchor="middle" fill="#f8fafc">Fotografía de Estudio IA</text>
      <text x="300" y="415" font-size="14" font-family="system-ui, sans-serif" text-anchor="middle" fill="#94a3b8">Ark Pro • E-commerce Ready</text>
    </svg>
  `;

  return new Response(svgPlaceholder, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=86400'
    }
  });
}
