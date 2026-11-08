import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { Env } from './types';
import { codiRouter } from './routes/codi';
import { paymentLinkRouter } from './routes/paymentLink';
import { merchantRouter } from './routes/merchant';
import { webhookRouter } from './routes/webhooks';
import { internalRouter } from './routes/internal';

const app = new Hono<{ Bindings: Env }>();

// Middlewares globales
app.use('*', logger());
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Pey-Signature', 'X-Pey-Timestamp', 'X-StayPuft-Key']
}));

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
      peyApiConfigured: Boolean(c.env.PEY_API_KEY)
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

export default app;
