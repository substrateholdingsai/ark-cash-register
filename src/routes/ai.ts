import { Hono } from 'hono';
import { Env } from '../types';
import { generateUlid } from '../utils/ulid';
import { runChat } from '../services/aiClient';

export const aiRouter = new Hono<{ Bindings: Env }>();

aiRouter.post('/close-summary', async (c) => {
  if (!c.env.DB) return c.json({ error: { message: 'D1 no configurado', type: 'D1_UNAVAILABLE' } }, 503);
  if (!c.env.AI) return c.json({ error: { message: 'Workers AI no configurado', type: 'AI_UNAVAILABLE' } }, 503);

  const body = await c.req.json().catch(() => ({}));
  const merchantId = body?.merchantId;
  if (!merchantId) return c.json({ error: { message: 'merchantId requerido', type: 'VALIDATION_ERROR' } }, 400);

  const merchant: any = await c.env.DB.prepare('SELECT id, alias, name FROM merchants WHERE id = ? LIMIT 1').bind(merchantId).first();
  if (!merchant) return c.json({ error: { message: 'Comercio no encontrado', type: 'MERCHANT_NOT_FOUND' } }, 404);

  const now = Math.floor(Date.now() / 1000);
  const startOfDay = now - (now % 86400);
  const dateKey = new Date().toISOString().split('T')[0];

  const cacheKey = `ai:close-summary:${merchantId}:${dateKey}`;
  if (c.env.KV) {
    const cached = await c.env.KV.get(cacheKey);
    if (cached) return c.json({ summary: cached, model: '@cf/meta/llama-3.1-8b-instruct', cached: true });
  }

  const rows: any = await c.env.DB.prepare(`
    SELECT amount, concept, status, payment_method, date_created, date_paid
    FROM payments WHERE merchant_id = ? AND date_created >= ? ORDER BY date_created DESC LIMIT 100
  `).bind(merchantId, startOfDay).all();

  const payments = rows.results || [];
  const paid = payments.filter((p: any) => p.status === 'PAID');
  const total = paid.reduce((a: number, p: any) => a + (p.amount || 0), 0);

  const promptData = payments.map((p: any) => ({
    amount: p.amount, concept: p.concept, status: p.status, method: p.payment_method,
    created: new Date(p.date_created * 1000).toISOString(), paid: p.date_paid ? new Date(p.date_paid * 1000).toISOString() : null
  }));

  const messages = [
    { role: 'system', content: 'Eres un asistente financiero para cajas registradoras mexicanas. Responde en español, conciso, con viñetas. Detecta anomalías (montos duplicados, horarios inusuales, pagos expirados) y da recomendaciones.' },
    { role: 'user', content: `Comercio: ${merchant.alias || merchant.name}. Fecha: ${dateKey}. Total cobrado: ${total} MXN en ${paid.length} pagos. Movimientos del día (JSON): ${JSON.stringify(promptData)}. Genera: 1) Resumen ejecutivo, 2) Anomalías detectadas, 3) Recomendaciones operativas.` }
  ];

  try {
    const summary = await runChat(c.env, messages as any);
    if (c.env.KV) await c.env.KV.put(cacheKey, summary, { expirationTtl: 3600 });
    return c.json({ summary, model: '@cf/meta/llama-3.1-8b-instruct', cached: false, payments: payments.length, total });
  } catch (err: any) {
    return c.json({ error: { message: err?.message || 'Error IA', type: 'AI_ERROR' } }, 500);
  }
});

aiRouter.post('/suggest-sat-key', async (c) => {
  if (!c.env.AI) return c.json({ error: { message: 'Workers AI no configurado', type: 'AI_UNAVAILABLE' } }, 503);
  const body = await c.req.json().catch(() => ({}));
  const description = body?.description;
  if (!description) return c.json({ error: { message: 'description requerido', type: 'VALIDATION_ERROR' } }, 400);

  const messages = [
    { role: 'system', content: 'Eres experto en CFDI mexicano. Dado un concepto de venta, devuelve SOLO un JSON con {product_key, description, uso_cfdi} sin texto extra.' },
    { role: 'user', content: `Concepto: ${description}` }
  ];
  try {
    const raw = await runChat(c.env, messages as any);
    return c.json({ suggestion: raw });
  } catch (err: any) {
    return c.json({ error: { message: err?.message || 'Error IA', type: 'AI_ERROR' } }, 500);
  }
});
