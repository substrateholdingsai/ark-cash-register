import { Hono } from 'hono';
import { Env } from '../types';
import { generateUlid } from '../utils/ulid';
import { requireAuth } from '../middleware/auth';
import { runBackup } from '../services/backup';

export const complianceRouter = new Hono<{ Bindings: Env }>();

// ---------- Legal versions (público) ----------
complianceRouter.get('/legal/versions', async (c) => {
  const termsVersion = c.env.TERMS_VERSION || '1.0';
  const privacyVersion = c.env.PRIVACY_NOTICE_VERSION || '1.0';
  let termsDb: any = null;
  let privacyDb: any = null;
  if (c.env.DB) {
    termsDb = await c.env.DB.prepare('SELECT version FROM terms_versions WHERE is_current = 1 LIMIT 1').first();
    privacyDb = await c.env.DB.prepare('SELECT version FROM privacy_notice_versions WHERE is_current = 1 LIMIT 1').first();
  }
  return c.json({
    terms: termsDb?.version || termsVersion,
    privacy: privacyDb?.version || privacyVersion
  });
});

// ---------- ARCO: exportar datos ----------
complianceRouter.post('/privacy/export', requireAuth, async (c) => {
  const user = c.get('user')!;
  if (!c.env.DB) return c.json({ error: { message: 'D1 no configurado', type: 'D1_UNAVAILABLE' } }, 503);

  const u: any = await c.env.DB.prepare('SELECT * FROM users WHERE id = ? LIMIT 1').bind(user.id).first();
  const sessions = await c.env.DB.prepare('SELECT id, user_agent, ip_address, created_at, expires_at, revoked_at FROM auth_sessions WHERE user_id = ?').bind(user.id).all();
  const consents = await c.env.DB.prepare('SELECT document, version, accepted_at, ip_address FROM consent_records WHERE user_id = ?').bind(user.id).all();
  const arco = await c.env.DB.prepare('SELECT type, status, requested_at, resolved_at FROM arco_requests WHERE user_id = ?').bind(user.id).all();

  await c.env.DB.prepare('INSERT INTO arco_requests (id, user_id, type, status, details, requested_at) VALUES (?,?,?,?,?,?)')
    .bind(generateUlid(), user.id, 'access', 'resolved', 'self-service export', Math.floor(Date.now() / 1000)).run();

  return c.json({
    user: {
      id: u.id, email: u.email, displayName: u.display_name, role: u.role,
      emailVerified: Boolean(u.email_verified), status: u.status,
      createdAt: u.created_at, lastLoginAt: u.last_login_at
    },
    sessions: sessions.results || [],
    consents: consents.results || [],
    arcoRequests: arco.results || []
  });
});

// ---------- ARCO: rectificación ----------
complianceRouter.post('/privacy/rectify', requireAuth, async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json().catch(() => ({}));
  if (!c.env.DB) return c.json({ error: { message: 'D1 no configurado', type: 'D1_UNAVAILABLE' } }, 503);

  const now = Math.floor(Date.now() / 1000);
  if (typeof body.displayName === 'string') {
    await c.env.DB.prepare('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?').bind(body.displayName, now, user.id).run();
  }
  if (typeof body.email === 'string' && body.email !== user.email) {
    await c.env.DB.prepare('UPDATE users SET email = ?, email_verified = 0, status = ?, updated_at = ? WHERE id = ?')
      .bind(body.email.trim().toLowerCase(), 'pending', now, user.id).run();
  }

  await c.env.DB.prepare('INSERT INTO arco_requests (id, user_id, type, status, details, requested_at, resolved_at) VALUES (?,?,?,?,?,?,?)')
    .bind(generateUlid(), user.id, 'rectification', 'resolved', JSON.stringify(body), now, now).run();

  return c.json({ success: true, message: 'Datos actualizados.' });
});

// ---------- ARCO: cancelación (soft delete) ----------
complianceRouter.post('/privacy/cancel', requireAuth, async (c) => {
  const user = c.get('user')!;
  if (!c.env.DB) return c.json({ error: { message: 'D1 no configurado', type: 'D1_UNAVAILABLE' } }, 503);

  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?').bind('disabled', now, user.id).run();
  await c.env.DB.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(now, user.id).run();
  await c.env.DB.prepare('INSERT INTO arco_requests (id, user_id, type, status, details, requested_at) VALUES (?,?,?,?,?,?)')
    .bind(generateUlid(), user.id, 'cancellation', 'pending', 'soft-delete solicitado; purga en 30 días', now).run();

  return c.json({ success: true, message: 'Cuenta desactivada. Será eliminada en 30 días.' });
});

// ---------- ARCO: oposición ----------
complianceRouter.post('/privacy/oppose', requireAuth, async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json().catch(() => ({}));
  if (!c.env.DB) return c.json({ error: { message: 'D1 no configurado', type: 'D1_UNAVAILABLE' } }, 503);

  const now = Math.floor(Date.now() / 1000);
  const optOut = body?.marketing === false;
  await c.env.DB.prepare('INSERT INTO consent_records (id, user_id, document, version, accepted_at, ip_address, user_agent) VALUES (?,?,?,?,?,?,?)')
    .bind(generateUlid(), user.id, 'marketing', optOut ? 'opt-out' : 'opt-in', now, c.req.header('CF-Connecting-IP') || null, c.req.header('User-Agent') || null).run();

  await c.env.DB.prepare('INSERT INTO arco_requests (id, user_id, type, status, details, requested_at, resolved_at) VALUES (?,?,?,?,?,?,?)')
    .bind(generateUlid(), user.id, 'opposition', 'resolved', JSON.stringify(body), now, now).run();

  return c.json({ success: true, message: 'Preferencias actualizadas.' });
});

// ---------- Listar solicitudes ARCO del usuario ----------
complianceRouter.get('/privacy/requests', requireAuth, async (c) => {
  const user = c.get('user')!;
  if (!c.env.DB) return c.json({ error: { message: 'D1 no configurado', type: 'D1_UNAVAILABLE' } }, 503);
  const rows = await c.env.DB.prepare('SELECT id, type, status, requested_at, resolved_at FROM arco_requests WHERE user_id = ? ORDER BY requested_at DESC').bind(user.id).all();
  return c.json({ requests: rows.results || [] });
});

// ---------- Admin: listar solicitudes ARCO (StayPuft) ----------
complianceRouter.get('/internal/privacy-requests', async (c) => {
  const key = c.req.header('X-StayPuft-Key');
  if (!c.env.CAJA_STAYPUFT_API_KEY || key !== c.env.CAJA_STAYPUFT_API_KEY) {
    return c.json({ error: { message: 'No autorizado', type: 'UNAUTHORIZED' } }, 401);
  }
  if (!c.env.DB) return c.json({ error: { message: 'D1 no configurado', type: 'D1_UNAVAILABLE' } }, 503);
  const rows = await c.env.DB.prepare('SELECT id, user_id, type, status, requested_at FROM arco_requests ORDER BY requested_at DESC LIMIT 100').all();
  return c.json({ requests: rows.results || [] });
});

// ---------- Admin: backup manual (StayPuft) ----------
complianceRouter.post('/internal/backup/run', async (c) => {
  const key = c.req.header('X-StayPuft-Key');
  if (!c.env.CAJA_STAYPUFT_API_KEY || key !== c.env.CAJA_STAYPUFT_API_KEY) {
    return c.json({ error: { message: 'No autorizado', type: 'UNAUTHORIZED' } }, 401);
  }
  try {
    const res = await runBackup(c.env);
    return c.json({ success: true, ...res });
  } catch (err: any) {
    return c.json({ error: { message: err?.message || 'Error en backup', type: 'BACKUP_ERROR' } }, 500);
  }
});
