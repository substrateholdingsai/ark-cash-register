import { Hono } from 'hono';
import { Env } from '../types';
import { generateUlid } from '../utils/ulid';
import { requireAuth } from '../middleware/auth';
import { FacturapiClient } from '../services/facturapiClient';

export const invoiceRouter = new Hono<{ Bindings: Env }>();

function getFacturapi(c: any): FacturapiClient | null {
  const key = c.env.FACTURAPI_API_KEY;
  const base = c.env.FACTURAPI_BASE_URL || 'https://www.facturapi.io/v2';
  if (!key) return null;
  return new FacturapiClient(key, base);
}

function nowSec(): number { return Math.floor(Date.now() / 1000); }

// ---------- Perfil fiscal ----------
invoiceRouter.post('/fiscal/profile', requireAuth, async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json().catch(() => ({}));
  const { rfc, razonSocial, regimenFiscal, codigoPostal, usoCfdiDefault, email, merchantId } = body || {};
  if (!rfc || !razonSocial || !regimenFiscal || !codigoPostal) {
    return c.json({ error: { message: 'rfc, razonSocial, regimenFiscal y codigoPostal son requeridos', type: 'VALIDATION_ERROR' } }, 400);
  }
  if (!c.env.DB) return c.json({ error: { message: 'D1 no configurado', type: 'D1_UNAVAILABLE' } }, 503);

  const now = nowSec();
  const id = generateUlid();
  // upsert por user/merchant
  const existing: any = await c.env.DB.prepare(
    'SELECT id FROM fiscal_profiles WHERE user_id = ? AND (merchant_id IS ? OR merchant_id = ?) LIMIT 1'
  ).bind(user.id, merchantId || null, merchantId || null).first();

  if (existing) {
    await c.env.DB.prepare(
      'UPDATE fiscal_profiles SET rfc=?, razon_social=?, regimen_fiscal=?, codigo_postal=?, uso_cfdi_default=?, email=?, updated_at=? WHERE id=?'
    ).bind(rfc, razonSocial, regimenFiscal, codigoPostal, usoCfdiDefault || 'G03', email || null, now, existing.id).run();
    return c.json({ success: true, profileId: existing.id });
  }

  await c.env.DB.prepare(
    `INSERT INTO fiscal_profiles (id, merchant_id, user_id, rfc, razon_social, regimen_fiscal, codigo_postal, uso_cfdi_default, email, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(id, merchantId || null, user.id, rfc, razonSocial, regimenFiscal, codigoPostal, usoCfdiDefault || 'G03', email || null, now, now).run();
  return c.json({ success: true, profileId: id }, 201);
});

invoiceRouter.get('/fiscal/profile', requireAuth, async (c) => {
  const user = c.get('user')!;
  if (!c.env.DB) return c.json({ error: { message: 'D1 no configurado', type: 'D1_UNAVAILABLE' } }, 503);
  const row = await c.env.DB.prepare('SELECT * FROM fiscal_profiles WHERE user_id = ? LIMIT 1').bind(user.id).first();
  return c.json({ profile: row || null });
});

// ---------- Emitir factura ----------
invoiceRouter.post('/invoice/issue', requireAuth, async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json().catch(() => ({}));
  const { merchantId, paymentId, items, customerRfc, customerName, customerRegimen, customerCp, customerEmail, use, paymentForm, series } = body || {};

  const client = getFacturapi(c);
  if (!client) return c.json({ error: { message: 'Facturapi no configurado', type: 'FACTURAPI_NOT_CONFIGURED' } }, 503);
  if (!c.env.DB) return c.json({ error: { message: 'D1 no configurado', type: 'D1_UNAVAILABLE' } }, 503);

  // Resolver perfil fiscal del receptor (cliente) o emisor? Facturapi emisor es la cuenta Facturapi; receptor es el cliente.
  let receptorRfc = customerRfc;
  let receptorName = customerName;
  let receptorRegimen = customerRegimen || '601';
  let receptorCp = customerCp;
  let receptorEmail = customerEmail;

  // Si hay paymentId, intentar obtener datos del pago/merchant para concepto
  let payment: any = null;
  if (paymentId) {
    payment = await c.env.DB.prepare('SELECT * FROM payments WHERE id = ? OR payable_id = ? LIMIT 1').bind(paymentId, paymentId).first();
  }

  if (!receptorRfc || !receptorName || !receptorCp) {
    return c.json({ error: { message: 'Datos del receptor (RFC, nombre, CP) son requeridos', type: 'VALIDATION_ERROR' } }, 400);
  }

  const invItems = Array.isArray(items) && items.length > 0 ? items : [
    { quantity: 1, product: { description: payment?.concept || 'Venta', product_key: '84111506', price: payment?.amount || 0, tax_included: true } }
  ];

  const now = nowSec();
  const invoiceId = generateUlid();

  try {
    const result = await client.createInvoice({
      customer: {
        legal_name: receptorName,
        tax_id: receptorRfc,
        tax_system: receptorRegimen,
        email: receptorEmail,
        address: { zip: receptorCp }
      },
      items: invItems,
      payment_form: paymentForm || '01',
      use: use || 'G03',
      series: series,
      currency: 'MXN'
    });

    const uuid = result?.uuid || result?.id;
    const facturapiId = result?.id;
    const total = result?.total ?? invItems.reduce((a: number, i: any) => a + (i.product?.price || 0) * (i.quantity || 1), 0);
    const subtotal = result?.subtotal ?? total;
    const tax = result?.tax ?? 0;

    // Guardar XML en R2 si está disponible
    let xmlKey: string | null = null;
    if (c.env.R2) {
      try {
        const xml = await client.downloadXml(facturapiId);
        xmlKey = `invoices/${invoiceId}.xml`;
        await c.env.R2.put(xmlKey, xml, { httpMetadata: { contentType: 'application/xml' } });
      } catch (e) {
        console.error('[Facturapi XML download]', e);
      }
    }

    await c.env.DB.prepare(
      `INSERT INTO invoices (id, merchant_id, payment_id, facturapi_id, uuid, serie, folio, rfc_receptor, razon_social_receptor, subtotal, tax, total, currency, status, xml_r2_key, pdf_url, issued_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      invoiceId, merchantId || null, paymentId || (payment?.id || null), facturapiId, uuid || null,
      result?.series || null, result?.folio_number ? String(result.folio_number) : null,
      receptorRfc, receptorName, subtotal, tax, total, 'MXN', 'stamped', xmlKey,
      result?.pdf || null, now, now, now
    ).run();

    return c.json({ success: true, invoiceId, uuid, facturapiId, total, pdfUrl: result?.pdf || null, xmlKey });
  } catch (err: any) {
    await c.env.DB.prepare(
      `INSERT INTO invoices (id, merchant_id, payment_id, rfc_receptor, razon_social_receptor, total, status, error_message, issued_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(invoiceId, merchantId || null, paymentId || null, receptorRfc, receptorName, 0, 'error', err?.message || 'Error', now, now, now).run();
    return c.json({ error: { message: err?.message || 'Error al timbrar', type: 'INVOICE_ERROR' } }, err?.status || 500);
  }
});

// ---------- Cancelar factura ----------
invoiceRouter.post('/invoice/cancel', requireAuth, async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json().catch(() => ({}));
  const { invoiceId, motive } = body || {};
  if (!invoiceId) return c.json({ error: { message: 'invoiceId requerido', type: 'VALIDATION_ERROR' } }, 400);

  const client = getFacturapi(c);
  if (!client) return c.json({ error: { message: 'Facturapi no configurado', type: 'FACTURAPI_NOT_CONFIGURED' } }, 503);
  if (!c.env.DB) return c.json({ error: { message: 'D1 no configurado', type: 'D1_UNAVAILABLE' } }, 503);

  const inv: any = await c.env.DB.prepare('SELECT * FROM invoices WHERE id = ? LIMIT 1').bind(invoiceId).first();
  if (!inv) return c.json({ error: { message: 'Factura no encontrada', type: 'NOT_FOUND' } }, 404);
  if (inv.status === 'cancelled') return c.json({ success: true, message: 'Ya cancelada.' });

  const now = nowSec();
  try {
    await client.cancelInvoice(inv.facturapi_id, motive || '02');
    await c.env.DB.prepare('UPDATE invoices SET status = ?, cancellation_motive = ?, cancelled_at = ?, updated_at = ? WHERE id = ?')
      .bind('cancelled', motive || '02', now, now, invoiceId).run();
    return c.json({ success: true, message: 'Factura cancelada.' });
  } catch (err: any) {
    return c.json({ error: { message: err?.message || 'Error al cancelar', type: 'CANCEL_ERROR' } }, err?.status || 500);
  }
});

// ---------- Consultar / listar ----------
invoiceRouter.get('/invoice/:id', requireAuth, async (c) => {
  const id = c.req.param('id');
  if (!c.env.DB) return c.json({ error: { message: 'D1 no configurado', type: 'D1_UNAVAILABLE' } }, 503);
  const inv: any = await c.env.DB.prepare('SELECT * FROM invoices WHERE id = ? OR uuid = ? LIMIT 1').bind(id, id).first();
  if (!inv) return c.json({ error: { message: 'Factura no encontrada', type: 'NOT_FOUND' } }, 404);
  return c.json({ invoice: inv });
});

invoiceRouter.get('/invoice', requireAuth, async (c) => {
  const user = c.get('user')!;
  if (!c.env.DB) return c.json({ error: { message: 'D1 no configurado', type: 'D1_UNAVAILABLE' } }, 503);
  const rows = await c.env.DB.prepare('SELECT id, uuid, total, status, issued_at, rfc_receptor FROM invoices ORDER BY issued_at DESC LIMIT 50').all();
  return c.json({ invoices: rows.results || [] });
});

// ---------- Descargar XML ----------
invoiceRouter.get('/invoice/:id/xml', requireAuth, async (c) => {
  const id = c.req.param('id');
  if (!c.env.DB) return c.json({ error: { message: 'D1 no configurado', type: 'D1_UNAVAILABLE' } }, 503);
  const inv: any = await c.env.DB.prepare('SELECT xml_r2_key FROM invoices WHERE id = ? LIMIT 1').bind(id).first();
  if (!inv || !inv.xml_r2_key || !c.env.R2) return c.json({ error: { message: 'XML no disponible', type: 'NOT_FOUND' } }, 404);
  const obj = await c.env.R2.get(inv.xml_r2_key);
  if (!obj) return c.json({ error: { message: 'XML no encontrado', type: 'NOT_FOUND' } }, 404);
  const xml = await obj.text();
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
});
