import { Context, Next } from 'hono';
import { Env } from '../types';
import { generateUlid } from '../utils/ulid';

export async function staypuftAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const startTime = Date.now();
  const providedKey = c.req.header('X-StayPuft-Key');
  const expectedKey = c.env.CAJA_STAYPUFT_API_KEY;

  // Fail-closed estricto: sin llave válida -> 401
  if (!expectedKey || !providedKey || providedKey !== expectedKey) {
    const durationMs = Date.now() - startTime;
    await logOperatorAudit(c, 401, durationMs, 'Unauthorized: Invalid or missing X-StayPuft-Key');
    return c.json({
      error: {
        message: 'Acceso no autorizado: X-StayPuft-Key inválida o ausente',
        type: 'UNAUTHORIZED'
      }
    }, 401);
  }

  // Ejecutar el handler
  let errorMsg: string | undefined;
  try {
    await next();
  } catch (err: any) {
    errorMsg = err.message || 'Error en endpoint interno';
    throw err;
  } finally {
    const durationMs = Date.now() - startTime;
    const statusCode = c.res.status || 200;
    await logOperatorAudit(c, statusCode, durationMs, errorMsg);
  }
}

async function logOperatorAudit(
  c: Context<{ Bindings: Env }>,
  statusCode: number,
  durationMs: number,
  error?: string
) {
  try {
    if (!c.env.DB) return;

    const auditId = generateUlid();
    const endpoint = new URL(c.req.url).pathname;
    const method = c.req.method;
    const merchantId = c.req.param('id') || c.req.query('merchant_id') || null;
    const paymentId = c.req.param('id') || c.req.query('payment_id') || null;
    const now = Math.floor(Date.now() / 1000);

    await c.env.DB.prepare(`
      INSERT INTO operator_audit_log (id, operator, endpoint, method, merchant_id, payment_id, status_code, duration_ms, error, created_at)
      VALUES (?, 'staypuft', ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      auditId,
      endpoint,
      method,
      merchantId,
      paymentId,
      statusCode,
      durationMs,
      error || null,
      now
    ).run();
  } catch (auditErr) {
    // Si la auditoría falla, lo registramos en consola pero no rompemos el response
    console.error('[Operator Audit Error]', auditErr);
  }
}
