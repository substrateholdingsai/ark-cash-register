import { Hono } from 'hono';
import { Env } from '../types';
import { generateUlid } from '../utils/ulid';
import { hashPassword, verifyPassword, signJwt, generateToken, sha256Hex, timingSafeEqualStr } from '../utils/crypto';
import { generateTotpSecret, verifyTotp, totpOtpauthUri } from '../utils/totp';
import { checkRateLimit, clientIp, rateLimitResponse } from '../utils/rateLimit';
import { ResendClient, verificationEmailHtml, verificationEmailText, resetPasswordEmailHtml, resetPasswordEmailText } from '../services/resendClient';

export const authRouter = new Hono<{ Bindings: Env }>();

// ---------- helpers ----------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function minPasswordLength(c: any): number {
  const v = parseInt(c.env.PASSWORD_MIN_LENGTH || '12', 10);
  return Number.isFinite(v) && v >= 8 ? v : 12;
}

function validatePassword(pw: unknown, minLen: number): string | null {
  if (typeof pw !== 'string') return 'password debe ser string';
  if (pw.length < minLen) return `password debe tener al menos ${minLen} caracteres`;
  if (!/[a-z]/.test(pw)) return 'password debe incluir minúscula';
  if (!/[A-Z]/.test(pw)) return 'password debe incluir mayúscula';
  if (!/[0-9]/.test(pw)) return 'password debe incluir número';
  return null;
}

function validateEmail(email: unknown): string | null {
  if (typeof email !== 'string') return 'email debe ser string';
  const e = email.trim().toLowerCase();
  if (e.length === 0 || e.length > 254) return 'email inválido';
  if (!EMAIL_RE.test(e)) return 'email inválido';
  return null;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function baseUrl(c: any): string {
  return (c.env.APP_BASE_URL || '').replace(/\/$/, '') || new URL(c.req.url).origin;
}

function getResend(c: any): ResendClient | null {
  const key = c.env.RESEND_API_KEY;
  const from = c.env.RESEND_FROM_EMAIL;
  if (!key || !from) return null;
  return new ResendClient(key, from);
}

async function audit(c: any, event: string, userId: string | null, metadata?: any) {
  try {
    if (!c.env.DB) return;
    await c.env.DB.prepare(
      'INSERT INTO auth_audit_log (id, user_id, event, ip_address, user_agent, metadata, created_at) VALUES (?,?,?,?,?,?,?)'
    ).bind(
      generateUlid(),
      userId,
      event,
      clientIp(c),
      c.req.header('User-Agent') || null,
      metadata ? JSON.stringify(metadata) : null,
      nowSec()
    ).run();
  } catch (err) {
    console.error('[Auth Audit Error]', err);
  }
}

function setRefreshCookie(c: any, token: string, expiresAt: number) {
  const domain = c.env.AUTH_COOKIE_DOMAIN;
  const maxAge = expiresAt - nowSec();
  let cookie = `__Host-ark_session=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
  if (domain) cookie += `; Domain=${domain}`;
  c.header('Set-Cookie', cookie);
}

function clearRefreshCookie(c: any) {
  c.header('Set-Cookie', `__Host-ark_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`);
}

function setAccessCookie(c: any, token: string, expiresAt: number) {
  const maxAge = expiresAt - nowSec();
  c.header('Set-Cookie', `__Host-ark_access=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; Secure; SameSite=Strict`, { append: true });
}

// ---------- rate limit helper ----------

async function rl(c: any, scope: string, key: string, limit: number, windowSec: number): Promise<Response | null> {
  const res = await checkRateLimit(c.env.KV, scope, key, { limit, windowSec });
  if (!res.allowed) return rateLimitResponse(res.retryAfter);
  return null;
}

// ---------- routes ----------

// POST /register
authRouter.post('/register', async (c) => {
  const ip = clientIp(c);
  const r = await rl(c, 'register', `ip:${ip}`, 10, 3600);
  if (r) return r;

  const body = await c.req.json().catch(() => ({}));
  const { email, password, displayName } = body || {};

  const emailErr = validateEmail(email);
  if (emailErr) return c.json({ error: { message: emailErr, type: 'VALIDATION_ERROR', fields: { email: emailErr } } }, 400);
  const minLen = minPasswordLength(c);
  const pwErr = validatePassword(password, minLen);
  if (pwErr) return c.json({ error: { message: pwErr, type: 'VALIDATION_ERROR', fields: { password: pwErr } } }, 400);

  const acceptTerms = body?.acceptTerms === true;
  const acceptPrivacy = body?.acceptPrivacy === true;
  if (!acceptTerms || !acceptPrivacy) {
    return c.json({ error: { message: 'Debes aceptar Términos de Uso y Aviso de Privacidad', type: 'CONSENT_REQUIRED' } }, 400);
  }
  const termsVersion = (body?.termsVersion || '').toString();
  const privacyVersion = (body?.privacyVersion || '').toString();
  const expectedTerms = c.env.TERMS_VERSION || '1.0';
  const expectedPrivacy = c.env.PRIVACY_NOTICE_VERSION || '1.0';
  if (termsVersion !== expectedTerms || privacyVersion !== expectedPrivacy) {
    return c.json({ error: { message: 'Versiones de documentos legales desactualizadas', type: 'LEGAL_VERSION_MISMATCH', expected: { terms: expectedTerms, privacy: expectedPrivacy } } }, 400);
  }

  const ne = normalizeEmail(email);

  // rate limit por email
  const r2 = await rl(c, 'register', `email:${ne}`, 5, 3600);
  if (r2) return r2;

  if (!c.env.DB) return c.json({ error: { message: 'D1 no configurado', type: 'D1_UNAVAILABLE' } }, 503);

  // Verificar existencia (anti-enumeración: respuesta genérica)
  const existing: any = await c.env.DB.prepare('SELECT id, email_verified FROM users WHERE email = ? LIMIT 1').bind(ne).first();

  if (existing) {
    await audit(c, 'register_duplicate', existing.id, { email: ne });
    return c.json({ success: true, message: 'Te enviamos un correo para confirmar tu cuenta.' }, 201);
  }

  const resend = getResend(c);
  if (!resend) return c.json({ error: { message: 'Email no configurado', type: 'RESEND_NOT_CONFIGURED' } }, 503);

  const userId = generateUlid();
  const hash = await hashPassword(password);
  const now = nowSec();
  await c.env.DB.prepare(
    `INSERT INTO users (id, email, email_verified, password_hash, password_updated_at, display_name, role, status, failed_login_count, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(userId, ne, 0, hash, now, displayName || null, 'cashier', 'pending', 0, now, now).run();
  // Registrar consentimiento versionado
  const ua = c.req.header('User-Agent') || null;
  await c.env.DB.prepare('INSERT INTO consent_records (id, user_id, document, version, accepted_at, ip_address, user_agent) VALUES (?,?,?,?,?,?,?)')
    .bind(generateUlid(), userId, 'terms', expectedTerms, now, ip, ua).run();
  await c.env.DB.prepare('INSERT INTO consent_records (id, user_id, document, version, accepted_at, ip_address, user_agent) VALUES (?,?,?,?,?,?,?)')
    .bind(generateUlid(), userId, 'privacy', expectedPrivacy, now, ip, ua).run();

  // token de verificación
  const rawToken = generateToken(32);
  const tokenHash = await sha256Hex(rawToken);
  const tokenId = generateUlid();
  const expiresAt = now + 24 * 3600;
  await c.env.DB.prepare(
    'INSERT INTO email_verification_tokens (id, user_id, token_hash, created_at, expires_at) VALUES (?,?,?,?,?)'
  ).bind(tokenId, userId, tokenHash, now, expiresAt).run();

  const link = `${baseUrl(c)}/verify-email?token=${rawToken}`;
  try {
    await resend.sendEmail({ to: ne, subject: 'Confirma tu cuenta', html: verificationEmailHtml(link), text: verificationEmailText(link) });
  } catch (err: any) {
    console.error('[Resend register]', err);
    // no fallar el registro, pero audit
    await audit(c, 'register_email_failed', userId, { error: err?.message });
  }

  await audit(c, 'register', userId, { email: ne });
  return c.json({ success: true, message: 'Te enviamos un correo para confirmar tu cuenta.', userId }, 201);
});

// GET /verify-email?token=
authRouter.get('/verify-email', async (c) => {
  const token = c.req.query('token');
  if (!token || typeof token !== 'string') {
    return c.json({ error: { message: 'Token requerido', type: 'VALIDATION_ERROR' } }, 400);
  }
  const ip = clientIp(c);
  const r = await rl(c, 'verify', `ip:${ip}`, 20, 3600);
  if (r) return r;

  if (!c.env.DB) return c.json({ error: { message: 'D1 no configurado', type: 'D1_UNAVAILABLE' } }, 503);

  const tokenHash = await sha256Hex(token);
  const row: any = await c.env.DB.prepare(
    'SELECT id, user_id, expires_at, consumed_at FROM email_verification_tokens WHERE token_hash = ? LIMIT 1'
  ).bind(tokenHash).first();

  const now = nowSec();
  if (!row || row.consumed_at || row.expires_at < now) {
    return c.json({ error: { message: 'Token inválido o expirado', type: 'INVALID_OR_EXPIRED_TOKEN' } }, 400);
  }

  await c.env.DB.prepare('UPDATE email_verification_tokens SET consumed_at = ? WHERE id = ?').bind(now, row.id).run();
  await c.env.DB.prepare('UPDATE users SET email_verified = 1, status = ?, updated_at = ? WHERE id = ?').bind('active', now, row.user_id).run();

  await audit(c, 'verify_email', row.user_id);
  return c.json({ success: true, message: 'Cuenta verificada. Ya puedes iniciar sesión.' });
});

// POST /resend-verification
authRouter.post('/resend-verification', async (c) => {
  const ip = clientIp(c);
  const r = await rl(c, 'resend-verify', `ip:${ip}`, 10, 3600);
  if (r) return r;

  const body = await c.req.json().catch(() => ({}));
  const { email } = body || {};
  const emailErr = validateEmail(email);
  if (emailErr) return c.json({ error: { message: emailErr, type: 'VALIDATION_ERROR' } }, 400);

  if (!c.env.DB) return c.json({ error: { message: 'D1 no configurado', type: 'D1_UNAVAILABLE' } }, 503);

  const ne = normalizeEmail(email);
  const user: any = await c.env.DB.prepare('SELECT id, email_verified, status FROM users WHERE email = ? LIMIT 1').bind(ne).first();

  // respuesta genérica
  if (!user || user.email_verified) {
    return c.json({ success: true, message: 'Si la cuenta existe y no está verificada, recibirás un correo.' });
  }

  const resend = getResend(c);
  if (!resend) return c.json({ error: { message: 'Email no configurado', type: 'RESEND_NOT_CONFIGURED' } }, 503);

  // invalidar tokens previos
  const now = nowSec();
  await c.env.DB.prepare('UPDATE email_verification_tokens SET consumed_at = ? WHERE user_id = ? AND consumed_at IS NULL').bind(now, user.id).run();

  const rawToken = generateToken(32);
  const tokenHash = await sha256Hex(rawToken);
  const tokenId = generateUlid();
  const expiresAt = now + 24 * 3600;
  await c.env.DB.prepare(
    'INSERT INTO email_verification_tokens (id, user_id, token_hash, created_at, expires_at) VALUES (?,?,?,?,?)'
  ).bind(tokenId, user.id, tokenHash, now, expiresAt).run();

  const link = `${baseUrl(c)}/verify-email?token=${rawToken}`;
  try {
    await resend.sendEmail({ to: ne, subject: 'Confirma tu cuenta', html: verificationEmailHtml(link), text: verificationEmailText(link) });
  } catch (err: any) {
    console.error('[Resend resend-verify]', err);
  }
  await audit(c, 'resend_verification', user.id);
  return c.json({ success: true, message: 'Si la cuenta existe y no está verificada, recibirás un correo.' });
});

// POST /login
authRouter.post('/login', async (c) => {
  const ip = clientIp(c);
  const r = await rl(c, 'login', `ip:${ip}`, 20, 900);
  if (r) return r;

  const body = await c.req.json().catch(() => ({}));
  const { email, password } = body || {};

  const emailErr = validateEmail(email);
  if (emailErr) return c.json({ error: { message: 'Credenciales inválidas', type: 'INVALID_CREDENTIALS' } }, 401);

  if (!c.env.DB) return c.json({ error: { message: 'D1 no configurado', type: 'D1_UNAVAILABLE' } }, 503);

  const ne = normalizeEmail(email);

  const r2 = await rl(c, 'login', `email:${ne}`, 10, 900);
  if (r2) return r2;

  const user: any = await c.env.DB.prepare(
    'SELECT id, email, password_hash, role, display_name, email_verified, status, failed_login_count, locked_until, password_updated_at FROM users WHERE email = ? LIMIT 1'
  ).bind(ne).first();

  const now = nowSec();

  // Usuario no existe: delay + respuesta genérica
  if (!user) {
    await new Promise((r) => setTimeout(r, 200));
    await audit(c, 'login_fail', null, { email: ne, reason: 'user_not_found' });
    return c.json({ error: { message: 'Credenciales inválidas', type: 'INVALID_CREDENTIALS' } }, 401);
  }

  if (user.locked_until && user.locked_until > now) {
    const retryAfter = user.locked_until - now;
    await audit(c, 'login_locked', user.id, { retryAfter });
    return c.json({ error: { message: 'Cuenta bloqueada temporalmente', type: 'ACCOUNT_LOCKED', retryAfter } }, 423);
  }

  if (user.status !== 'active') {
    await audit(c, 'login_fail', user.id, { reason: 'not_active', status: user.status });
    return c.json({ error: { message: 'Cuenta no activa', type: 'ACCOUNT_NOT_ACTIVE' } }, 403);
  }
  if (!user.email_verified) {
    await audit(c, 'login_fail', user.id, { reason: 'email_not_verified' });
    return c.json({ error: { message: 'Correo no verificado', type: 'EMAIL_NOT_VERIFIED' } }, 403);
  }

  const ok = await verifyPassword(password || '', user.password_hash);
  if (!ok) {
    const newCount = (user.failed_login_count || 0) + 1;
    let lockedUntil: number | null = null;
    if (newCount >= 15) lockedUntil = now + 24 * 3600;
    else if (newCount >= 10) lockedUntil = now + 3600;
    else if (newCount >= 5) lockedUntil = now + 900;
    await c.env.DB.prepare(
      'UPDATE users SET failed_login_count = ?, locked_until = ?, updated_at = ? WHERE id = ?'
    ).bind(newCount, lockedUntil, now, user.id).run();
    await audit(c, 'login_fail', user.id, { reason: 'bad_password', count: newCount });
    return c.json({ error: { message: 'Credenciales inválidas', type: 'INVALID_CREDENTIALS' } }, 401);
  }

  // MFA check
  const mfaRow: any = c.env.DB ? await c.env.DB.prepare('SELECT secret, enabled FROM user_mfa WHERE user_id = ? LIMIT 1').bind(user.id).first() : null;
  if (mfaRow && mfaRow.enabled) {
    const mfaCode = (body?.mfaCode || '').toString();
    if (!mfaCode) {
      return c.json({ error: { message: 'Se requiere código MFA', type: 'MFA_REQUIRED' } }, 401);
    }
    const okMfa = await verifyTotp(mfaRow.secret, mfaCode);
    if (!okMfa) {
      await audit(c, 'login_fail', user.id, { reason: 'bad_mfa' });
      return c.json({ error: { message: 'Código MFA inválido', type: 'INVALID_MFA' } }, 401);
    }
  }

  // éxito
  await c.env.DB.prepare(
    'UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?'
  ).bind(now, now, user.id).run();

  const secret = c.env.AUTH_JWT_SECRET;
  if (!secret) return c.json({ error: { message: 'Auth no configurado', type: 'AUTH_NOT_CONFIGURED' } }, 503);

  const accessExp = now + 15 * 60;
  const jti = generateUlid();
  const accessToken = await signJwt(
    { sub: user.id, role: user.role, iat: now, exp: accessExp, jti },
    secret
  );

  // refresh token opaco
  const refreshToken = generateToken(32);
  const refreshHash = await sha256Hex(refreshToken);
  const sessionId = generateUlid();
  const refreshExp = now + 30 * 24 * 3600;
  await c.env.DB.prepare(
    `INSERT INTO auth_sessions (id, user_id, refresh_token_hash, user_agent, ip_address, created_at, expires_at)
     VALUES (?,?,?,?,?,?,?)`
  ).bind(sessionId, user.id, refreshHash, c.req.header('User-Agent') || null, ip, now, refreshExp).run();

  setRefreshCookie(c, refreshToken, refreshExp);
  setAccessCookie(c, accessToken, accessExp);

  await audit(c, 'login_success', user.id);

  return c.json({
    accessToken,
    expiresIn: 900,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      displayName: user.display_name,
      emailVerified: Boolean(user.email_verified)
    }
  });
});

// POST /refresh
authRouter.post('/refresh', async (c) => {
  const ip = clientIp(c);
  const r = await rl(c, 'refresh', `ip:${ip}`, 30, 900);
  if (r) return r;

  const cookie = c.req.header('Cookie') || '';
  const m = cookie.match(/(?:^|;\s*)__Host-ark_session=([^;]+)/);
  if (!m) return c.json({ error: { message: 'Sin sesión', type: 'NO_SESSION' } }, 401);
  const refreshToken = decodeURIComponent(m[1]);

  if (!c.env.DB) return c.json({ error: { message: 'D1 no configurado', type: 'D1_UNAVAILABLE' } }, 503);

  const refreshHash = await sha256Hex(refreshToken);
  const session: any = await c.env.DB.prepare(
    'SELECT id, user_id, expires_at, revoked_at, replaced_by, user_agent FROM auth_sessions WHERE refresh_token_hash = ? LIMIT 1'
  ).bind(refreshHash).first();

  const now = nowSec();

  // Detección de reutilización: sesión revocada con replaced_by
  if (session && session.revoked_at && session.replaced_by) {
    // revocar toda la familia
    await c.env.DB.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(now, session.user_id).run();
    await audit(c, 'token_reuse', session.user_id, { sessionId: session.id });
    clearRefreshCookie(c);
    return c.json({ error: { message: 'Sesión inválida', type: 'INVALID_SESSION' } }, 401);
  }

  // Binding de sesión: user-agent debe coincidir si se registró
  const incomingUa = c.req.header('User-Agent') || null;
  if (session && session.user_agent && incomingUa && session.user_agent !== incomingUa) {
    await c.env.DB.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(now, session.user_id).run();
    await audit(c, 'session_binding_mismatch', session.user_id);
    clearRefreshCookie(c);
    return c.json({ error: { message: 'Sesión inválida', type: 'INVALID_SESSION' } }, 401);
  }

  if (!session || session.revoked_at || session.expires_at < now) {
    clearRefreshCookie(c);
    return c.json({ error: { message: 'Sesión inválida o expirada', type: 'INVALID_SESSION' } }, 401);
  }

  const user: any = await c.env.DB.prepare(
    'SELECT id, email, role, display_name, email_verified, status, password_updated_at FROM users WHERE id = ? LIMIT 1'
  ).bind(session.user_id).first();
  if (!user || user.status !== 'active') {
    clearRefreshCookie(c);
    return c.json({ error: { message: 'Cuenta no activa', type: 'ACCOUNT_NOT_ACTIVE' } }, 403);
  }

  const secret = c.env.AUTH_JWT_SECRET;
  if (!secret) return c.json({ error: { message: 'Auth no configurado', type: 'AUTH_NOT_CONFIGURED' } }, 503);

  // rotar
  const newRefresh = generateToken(32);
  const newHash = await sha256Hex(newRefresh);
  const newSessionId = generateUlid();
  const newExp = now + 30 * 24 * 3600;
  await c.env.DB.prepare(
    `INSERT INTO auth_sessions (id, user_id, refresh_token_hash, user_agent, ip_address, created_at, expires_at)
     VALUES (?,?,?,?,?,?,?)`
  ).bind(newSessionId, user.id, newHash, c.req.header('User-Agent') || null, ip, now, newExp).run();

  await c.env.DB.prepare('UPDATE auth_sessions SET revoked_at = ?, replaced_by = ? WHERE id = ?').bind(now, newSessionId, session.id).run();

  const accessExp = now + 15 * 60;
  const accessToken = await signJwt({ sub: user.id, role: user.role, iat: now, exp: accessExp, jti: generateUlid() }, secret);

  setRefreshCookie(c, newRefresh, newExp);
  setAccessCookie(c, accessToken, accessExp);

  return c.json({ accessToken, expiresIn: 900, user: { id: user.id, email: user.email, role: user.role, displayName: user.display_name, emailVerified: Boolean(user.email_verified) } });
});

// POST /logout
authRouter.post('/logout', async (c) => {
  const cookie = c.req.header('Cookie') || '';
  const m = cookie.match(/(?:^|;\s*)__Host-ark_session=([^;]+)/);
  if (m) {
    const refreshToken = decodeURIComponent(m[1]);
    if (c.env.DB) {
      const refreshHash = await sha256Hex(refreshToken);
      const session: any = await c.env.DB.prepare('SELECT id, user_id FROM auth_sessions WHERE refresh_token_hash = ? LIMIT 1').bind(refreshHash).first();
      if (session) {
        await c.env.DB.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE id = ?').bind(nowSec(), session.id).run();
        await audit(c, 'logout', session.user_id);
      }
    }
  }
  clearRefreshCookie(c);
  return c.json({ success: true });
});

// POST /logout-all
authRouter.post('/logout-all', requireAuth, async (c) => {
  // require auth manual
  const user = c.get('user');
  if (!user) return c.json({ error: { message: 'No autenticado', type: 'UNAUTHORIZED' } }, 401);
  if (!c.env.DB) return c.json({ error: { message: 'D1 no configurado', type: 'D1_UNAVAILABLE' } }, 503);
  const now = nowSec();
  await c.env.DB.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(now, user.id).run();
  await audit(c, 'logout_all', user.id);
  clearRefreshCookie(c);
  return c.json({ success: true });
});

// POST /forgot-password
authRouter.post('/forgot-password', async (c) => {
  const ip = clientIp(c);
  const r = await rl(c, 'forgot', `ip:${ip}`, 5, 3600);
  if (r) return r;

  const body = await c.req.json().catch(() => ({}));
  const { email } = body || {};
  const emailErr = validateEmail(email);
  if (emailErr) return c.json({ error: { message: emailErr, type: 'VALIDATION_ERROR' } }, 400);

  const ne = normalizeEmail(email);
  const r2 = await rl(c, 'forgot', `email:${ne}`, 3, 3600);
  if (r2) return r2;

  const generic = { success: true, message: 'Si el correo existe, recibirás instrucciones para restablecer tu contraseña.' };

  if (!c.env.DB) return c.json({ error: { message: 'D1 no configurado', type: 'D1_UNAVAILABLE' } }, 503);

  const user: any = await c.env.DB.prepare('SELECT id, status FROM users WHERE email = ? LIMIT 1').bind(ne).first();
  if (!user || user.status !== 'active') {
    await audit(c, 'password_reset_request', user?.id || null, { email: ne, found: Boolean(user) });
    return c.json(generic);
  }

  const resend = getResend(c);
  if (!resend) return c.json({ error: { message: 'Email no configurado', type: 'RESEND_NOT_CONFIGURED' } }, 503);

  const now = nowSec();
  // invalidar previos
  await c.env.DB.prepare('UPDATE password_reset_tokens SET consumed_at = ? WHERE user_id = ? AND consumed_at IS NULL').bind(now, user.id).run();

  const rawToken = generateToken(32);
  const tokenHash = await sha256Hex(rawToken);
  const tokenId = generateUlid();
  const expiresAt = now + 3600;
  await c.env.DB.prepare(
    'INSERT INTO password_reset_tokens (id, user_id, token_hash, created_at, expires_at, request_ip) VALUES (?,?,?,?,?,?)'
  ).bind(tokenId, user.id, tokenHash, now, expiresAt, ip).run();

  const link = `${baseUrl(c)}/reset-password?token=${rawToken}`;
  try {
    await resend.sendEmail({ to: ne, subject: 'Restablece tu contrasena', html: resetPasswordEmailHtml(link), text: resetPasswordEmailText(link) });
  } catch (err: any) {
    console.error('[Resend forgot]', err);
  }
  await audit(c, 'password_reset_request', user.id, { email: ne });
  return c.json(generic);
});

// POST /reset-password
authRouter.post('/reset-password', async (c) => {
  const ip = clientIp(c);
  const r = await rl(c, 'reset', `ip:${ip}`, 10, 3600);
  if (r) return r;

  const body = await c.req.json().catch(() => ({}));
  const { token, newPassword } = body || {};
  if (!token || typeof token !== 'string') {
    return c.json({ error: { message: 'Token requerido', type: 'VALIDATION_ERROR' } }, 400);
  }
  const minLen = minPasswordLength(c);
  const pwErr = validatePassword(newPassword, minLen);
  if (pwErr) return c.json({ error: { message: pwErr, type: 'VALIDATION_ERROR' } }, 400);

  if (!c.env.DB) return c.json({ error: { message: 'D1 no configurado', type: 'D1_UNAVAILABLE' } }, 503);

  const tokenHash = await sha256Hex(token);
  const row: any = await c.env.DB.prepare(
    'SELECT id, user_id, expires_at, consumed_at FROM password_reset_tokens WHERE token_hash = ? LIMIT 1'
  ).bind(tokenHash).first();

  const now = nowSec();
  if (!row || row.consumed_at || row.expires_at < now) {
    return c.json({ error: { message: 'Token inválido o expirado', type: 'INVALID_OR_EXPIRED_TOKEN' } }, 400);
  }

  const newHash = await hashPassword(newPassword);
  await c.env.DB.prepare('UPDATE users SET password_hash = ?, password_updated_at = ?, failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?')
    .bind(newHash, now, now, row.user_id).run();
  await c.env.DB.prepare('UPDATE password_reset_tokens SET consumed_at = ? WHERE id = ?').bind(now, row.id).run();
  // revocar todas las sesiones
  await c.env.DB.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(now, row.user_id).run();

  await audit(c, 'password_reset_success', row.user_id);
  return c.json({ success: true, message: 'Contraseña actualizada. Inicia sesión con tu nueva contraseña.' });
});

// ---------- rutas protegidas (requieren auth) ----------
// Se montan con middleware en index.ts o aquí via Hono sub-app? Hono middleware por ruta.

import { requireAuth } from '../middleware/auth';

authRouter.get('/me', requireAuth, async (c) => {
  const user = c.get('user')!;
  if (!c.env.DB) return c.json({ error: { message: 'D1 no configurado', type: 'D1_UNAVAILABLE' } }, 503);
  const row: any = await c.env.DB.prepare(
    'SELECT id, email, role, display_name, email_verified, status, created_at, last_login_at FROM users WHERE id = ? LIMIT 1'
  ).bind(user.id).first();
  if (!row) return c.json({ error: { message: 'Usuario no encontrado', type: 'USER_NOT_FOUND' } }, 404);
  return c.json({
    id: row.id,
    email: row.email,
    role: row.role,
    displayName: row.display_name,
    emailVerified: Boolean(row.email_verified),
    status: row.status,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at
  });
});

authRouter.put('/me', requireAuth, async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json().catch(() => ({}));
  const { displayName, currentPassword, newPassword } = body || {};
  if (!c.env.DB) return c.json({ error: { message: 'D1 no configurado', type: 'D1_UNAVAILABLE' } }, 503);

  const now = nowSec();
  if (typeof displayName === 'string') {
    await c.env.DB.prepare('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?').bind(displayName, now, user.id).run();
  }

  if (newPassword) {
    const minLen = minPasswordLength(c);
    const pwErr = validatePassword(newPassword, minLen);
    if (pwErr) return c.json({ error: { message: pwErr, type: 'VALIDATION_ERROR' } }, 400);
    const row: any = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ? LIMIT 1').bind(user.id).first();
    if (!row) return c.json({ error: { message: 'Usuario no encontrado', type: 'USER_NOT_FOUND' } }, 404);
    const ok = await verifyPassword(currentPassword || '', row.password_hash);
    if (!ok) return c.json({ error: { message: 'Contraseña actual incorrecta', type: 'INVALID_PASSWORD' } }, 401);
    const newHash = await hashPassword(newPassword);
    await c.env.DB.prepare('UPDATE users SET password_hash = ?, password_updated_at = ?, updated_at = ? WHERE id = ?').bind(newHash, now, now, user.id).run();
    await c.env.DB.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(now, user.id).run();
    await audit(c, 'password_change', user.id);
  }

  await audit(c, 'profile_update', user.id);
  return c.json({ success: true });
});

authRouter.get('/sessions', requireAuth, async (c) => {
  const user = c.get('user')!;
  if (!c.env.DB) return c.json({ error: { message: 'D1 no configurado', type: 'D1_UNAVAILABLE' } }, 503);
  const rows = await c.env.DB.prepare(
    'SELECT id, user_agent, ip_address, created_at, expires_at, revoked_at FROM auth_sessions WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(user.id).all();
  return c.json({ sessions: rows.results || [] });
});

authRouter.delete('/sessions/:id', requireAuth, async (c) => {
  const user = c.get('user')!;
  const id = c.req.param('id');
  if (!c.env.DB) return c.json({ error: { message: 'D1 no configurado', type: 'D1_UNAVAILABLE' } }, 503);
  const session: any = await c.env.DB.prepare('SELECT id, user_id FROM auth_sessions WHERE id = ? LIMIT 1').bind(id).first();
  if (!session || session.user_id !== user.id) {
    return c.json({ error: { message: 'Sesión no encontrada', type: 'NOT_FOUND' } }, 404);
  }
  await c.env.DB.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE id = ?').bind(nowSec(), id).run();
  await audit(c, 'session_revoked', user.id, { sessionId: id });
  return c.json({ success: true });
});


// ---------- MFA (TOTP) ----------
authRouter.post('/mfa/setup', requireAuth, async (c) => {
  const user = c.get('user')!;
  if (!c.env.DB) return c.json({ error: { message: 'D1 no configurado', type: 'D1_UNAVAILABLE' } }, 503);
  const now = Math.floor(Date.now() / 1000);
  const secret = generateTotpSecret();
  await c.env.DB.prepare(
    'INSERT INTO user_mfa (user_id, secret, enabled, created_at, updated_at) VALUES (?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET secret=excluded.secret, enabled=0, updated_at=excluded.updated_at'
  ).bind(user.id, secret, 0, now, now).run();
  const uri = totpOtpauthUri(secret, user.email);
  return c.json({ secret, otpauthUri: uri });
});

authRouter.post('/mfa/verify', requireAuth, async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json().catch(() => ({}));
  if (!c.env.DB) return c.json({ error: { message: 'D1 no configurado', type: 'D1_UNAVAILABLE' } }, 503);
  const row: any = await c.env.DB.prepare('SELECT secret, enabled FROM user_mfa WHERE user_id = ? LIMIT 1').bind(user.id).first();
  if (!row) return c.json({ error: { message: 'MFA no configurado', type: 'MFA_NOT_SETUP' } }, 400);
  const code = (body?.code || '').toString();
  const ok = await verifyTotp(row.secret, code);
  if (!ok) return c.json({ error: { message: 'Código inválido', type: 'INVALID_MFA' } }, 400);
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare('UPDATE user_mfa SET enabled = 1, updated_at = ? WHERE user_id = ?').bind(now, user.id).run();
  await audit(c, 'mfa_enabled', user.id);
  return c.json({ success: true, message: 'MFA habilitado.' });
});

authRouter.post('/mfa/disable', requireAuth, async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json().catch(() => ({}));
  if (!c.env.DB) return c.json({ error: { message: 'D1 no configurado', type: 'D1_UNAVAILABLE' } }, 503);
  const row: any = await c.env.DB.prepare('SELECT secret, enabled FROM user_mfa WHERE user_id = ? LIMIT 1').bind(user.id).first();
  if (!row || !row.enabled) return c.json({ success: true });
  const code = (body?.code || '').toString();
  const ok = code ? await verifyTotp(row.secret, code) : false;
  if (!ok) return c.json({ error: { message: 'Código MFA requerido', type: 'INVALID_MFA' } }, 401);
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare('DELETE FROM user_mfa WHERE user_id = ?').bind(user.id).run();
  await audit(c, 'mfa_disabled', user.id);
  return c.json({ success: true });
});
