import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { Env } from './types';
import { codiRouter } from './routes/codi';
import { paymentLinkRouter } from './routes/paymentLink';
import { merchantRouter } from './routes/merchant';
import { webhookRouter } from './routes/webhooks';
import { internalRouter } from './routes/internal';
import { authRouter } from './routes/auth';
import { complianceRouter } from './routes/compliance';
import { invoiceRouter } from './routes/invoices';
import { generateUlid } from './utils/ulid';
import { runBackup } from './services/backup';

const app = new Hono<{ Bindings: Env }>();

// Middlewares globales
app.use('*', logger());
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Pey-Signature', 'X-Pey-Timestamp', 'X-StayPuft-Key', 'X-CSRF-Token']
}));

// Headers de seguridad (CSP, etc.)
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (c.env.ENVIRONMENT === 'production') {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    c.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none';");
  }
});

// Endpoint de Health Check & Diagnóstico
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'ark-cash-register',
    version: c.env.APP_VERSION || '2.0.0',
    timestamp: new Date().toISOString(),
    cloudflareBindings: {
      d1: Boolean(c.env.DB),
      kv: Boolean(c.env.KV),
      peyApiConfigured: Boolean(c.env.PEY_API_KEY),
      authConfigured: Boolean(c.env.AUTH_JWT_SECRET),
      resendConfigured: Boolean(c.env.RESEND_API_KEY)
    }
  });
});

// Rutas amigables para la Caja, Instructivo y Landing
app.get('/caja', (c) => {
  const m = c.req.query('m');
  if (m) {
    return c.redirect(`/caja.html?m=${encodeURIComponent(m)}`, 302);
  }
  return c.redirect('/caja.html', 302);
});
app.get('/app', (c) => c.redirect('/caja', 301));
app.get('/instructivo', (c) => c.redirect('/index.html', 301));
app.get('/landing', (c) => c.redirect('/index.html', 301));
app.get('/como-funciona', (c) => c.redirect('/index.html', 301));

// Enrutadores API
app.route('/api/codi', codiRouter);
app.route('/api/payment/codi', codiRouter);
app.route('/api/payment-link', paymentLinkRouter);
app.route('/api/payment/link', paymentLinkRouter);
app.route('/api/merchant', merchantRouter);
app.route('/api/auth', authRouter);
app.route('/api', complianceRouter);
app.route('/api', invoiceRouter);
app.route('/webhooks', webhookRouter);

// Conector Interno StayPuft (/api/internal/*)
app.route('/api/internal', internalRouter);

// Manejador de Errores global
app.onError((err, c) => {
  console.error('[Worker Error]', err);
  return c.json({
    error: {
      message: err.message || 'Error interno en pey-worker',
      type: 'INTERNAL_SERVER_ERROR'
    }
  }, 500);
});

(app as any).scheduled = async (event: any, env: Env, ctx: any) => {
  if (!env.DB) return;
  const now = Math.floor(Date.now() / 1000);
  const day = 86400;
  try {
    const s = await env.DB.prepare('DELETE FROM auth_sessions WHERE (revoked_at IS NOT NULL OR expires_at < ?) AND created_at < ?')
      .bind(now, now - 30 * day).run();
    await env.DB.prepare('DELETE FROM email_verification_tokens WHERE (consumed_at IS NOT NULL OR expires_at < ?) AND created_at < ?')
      .bind(now, now - 7 * day).run();
    await env.DB.prepare('DELETE FROM password_reset_tokens WHERE (consumed_at IS NOT NULL OR expires_at < ?) AND created_at < ?')
      .bind(now, now - 7 * day).run();
    const disabled = await env.DB.prepare('SELECT id, email FROM users WHERE status = ? AND updated_at < ?')
      .bind('disabled', now - 30 * day).all();
    for (const u of (disabled.results || [])) {
      await env.DB.prepare('UPDATE users SET email = ?, display_name = NULL, password_hash = ?, status = ? WHERE id = ?')
        .bind(`deleted_${u.id}@anon`, 'disabled', 'deleted', u.id).run();
    }
    await env.DB.prepare('INSERT INTO purge_log (id, entity, records_purged, executed_at, notes) VALUES (?,?,?,?,?)')
      .bind(generateUlid(), 'scheduled_purge', (s as any)?.success ? 1 : 0, now, `disabled_anonymized=${disabled.results?.length || 0}`).run();
    // backup semanal (best-effort)
    try { await runBackup(env); } catch (e) { console.error('[Scheduled Backup Error]', e); }
  } catch (err) {
    console.error('[Scheduled Purge Error]', err);
  }
};

const worker = {
  fetch: app.fetch.bind(app),
  scheduled: (app as any).scheduled,
  request: (path: any, init?: any, env?: any) => app.request(path, init, env)
};

export default worker;
