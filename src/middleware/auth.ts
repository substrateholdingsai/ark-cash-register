import { Context, Next } from 'hono';
import { Env } from '../types';
import { verifyJwtWithRotation } from '../utils/crypto';
import { generateUlid } from '../utils/ulid';

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  displayName: string | null;
  emailVerified: boolean;
  merchantId?: string | null;
}

declare module 'hono' {
  interface ContextVariableMap {
    user?: AuthUser;
    merchantId?: string;
  }
}

/**
 * Registra fallos de autenticación y autorización en operator_audit_log
 * de forma inmutable, sin exponer tokens ni secretos.
 */
export async function logAuthFailure(
  c: Context<{ Bindings: Env }>,
  reason: string,
  statusCode: number,
  merchantId?: string | null
) {
  try {
    if (!c.env.DB) return;
    const auditId = generateUlid();
    const now = Math.floor(Date.now() / 1000);
    const url = new URL(c.req.url);
    await c.env.DB.prepare(`
      INSERT INTO operator_audit_log (id, operator, endpoint, method, merchant_id, payment_id, status_code, duration_ms, error, created_at)
      VALUES (?, 'auth_subsystem', ?, ?, ?, NULL, ?, 0, ?, ?)
    `).bind(
      auditId,
      url.pathname,
      c.req.method,
      merchantId || null,
      statusCode,
      reason,
      now
    ).run();
  } catch (err) {
    console.error('[Auth Audit Failure Logging Error]', err);
  }
}

export async function requireAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const secret = c.env.AUTH_JWT_SECRET;
  if (!secret || secret.trim() === '') {
    await logAuthFailure(c, 'AUTH_NOT_CONFIGURED', 503);
    return c.json({ error: { message: 'Auth no configurado. Fail-closed activado.', type: 'AUTH_NOT_CONFIGURED' } }, 503);
  }

  const authHeader = c.req.header('Authorization');
  let token: string | undefined;
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    token = authHeader.slice(7).trim();
  } else {
    // cookie fallback
    const cookie = c.req.header('Cookie') || '';
    const m = cookie.match(/(?:^|;\s*)__Host-ark_access=([^;]+)/);
    if (m) token = decodeURIComponent(m[1]);
  }

  if (!token) {
    await logAuthFailure(c, 'MISSING_BEARER_TOKEN', 401);
    return c.json({ error: { message: 'No autenticado', type: 'UNAUTHORIZED' } }, 401);
  }

  const payload = await verifyJwtWithRotation(token, secret, c.env.AUTH_JWT_SECRET_PREV);
  if (!payload) {
    await logAuthFailure(c, 'INVALID_OR_EXPIRED_TOKEN', 401);
    return c.json({ error: { message: 'Token inválido o expirado', type: 'INVALID_TOKEN' } }, 401);
  }

  // Cargar usuario
  if (!c.env.DB) {
    return c.json({ error: { message: 'D1 no configurado', type: 'D1_UNAVAILABLE' } }, 503);
  }
  const user: any = await c.env.DB.prepare(
    'SELECT id, email, role, display_name, email_verified, status, merchant_id, password_updated_at FROM users WHERE id = ? LIMIT 1'
  ).bind(payload.sub).first();

  if (!user) {
    await logAuthFailure(c, 'USER_NOT_FOUND', 401);
    return c.json({ error: { message: 'Usuario no encontrado', type: 'USER_NOT_FOUND' } }, 401);
  }
  if (user.status !== 'active') {
    await logAuthFailure(c, 'ACCOUNT_NOT_ACTIVE', 403);
    return c.json({ error: { message: 'Cuenta no activa', type: 'ACCOUNT_NOT_ACTIVE' } }, 403);
  }

  // Invalidar tokens emitidos antes del último cambio de password
  const tokenIat = payload.iat;
  if (user.password_updated_at && tokenIat < user.password_updated_at) {
    await logAuthFailure(c, 'TOKEN_REVOKED_BY_PASSWORD_UPDATE', 401);
    return c.json({ error: { message: 'Token inválido', type: 'INVALID_TOKEN' } }, 401);
  }

  c.set('user', {
    id: user.id,
    email: user.email,
    role: user.role,
    displayName: user.display_name,
    emailVerified: Boolean(user.email_verified),
    merchantId: user.merchant_id || (payload.merchant_id as string) || null
  });

  await next();
}

/**
 * Middleware estricto para operaciones de comercio (P0 Multi-Tenant Aislamiento):
 * 1. Falla cerrado (503) si AUTH_JWT_SECRET no existe.
 * 2. Exige Bearer Token válido (401 si no hay token o es inválido/expirado).
 * 3. Valida que el comercio solicitado exista (404 si no existe).
 * 4. Valida que el token corresponda al comercio solicitado (403 si hay cruce entre comercios).
 * 5. Registra fallos en operator_audit_log sin exponer tokens ni secretos.
 */
export async function requireMerchantAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const secret = c.env.AUTH_JWT_SECRET;
  if (!secret || secret.trim() === '') {
    await logAuthFailure(c, 'AUTH_NOT_CONFIGURED', 503);
    return c.json({ error: { message: 'Auth no configurado. Fail-closed de seguridad.', type: 'AUTH_NOT_CONFIGURED' } }, 503);
  }

  const authHeader = c.req.header('Authorization');
  let token: string | undefined;
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    token = authHeader.slice(7).trim();
  } else {
    const cookie = c.req.header('Cookie') || '';
    const m = cookie.match(/(?:^|;\s*)__Host-ark_access=([^;]+)/);
    if (m) token = decodeURIComponent(m[1]);
  }

  if (!token) {
    await logAuthFailure(c, 'MISSING_BEARER_TOKEN', 401);
    return c.json({ error: { message: 'Token de autorización requerido', type: 'UNAUTHORIZED' } }, 401);
  }

  const payload = await verifyJwtWithRotation(token, secret, c.env.AUTH_JWT_SECRET_PREV);
  if (!payload) {
    await logAuthFailure(c, 'INVALID_OR_EXPIRED_TOKEN', 401);
    return c.json({ error: { message: 'Token inválido o expirado', type: 'INVALID_TOKEN' } }, 401);
  }

  // Identificar el comercio objetivo
  let targetMerchantId = c.req.param('id') || c.req.param('merchantId') || c.req.query('merchant_id') || c.req.query('m');
  if (!targetMerchantId && ['POST', 'PUT', 'PATCH'].includes(c.req.method)) {
    try {
      const cloned = c.req.raw.clone();
      const body = await cloned.json() as any;
      if (body && body.merchantId) {
        targetMerchantId = body.merchantId;
      }
    } catch {
      // ignore
    }
  }

  if (targetMerchantId && c.env.DB) {
    // 1. Validar existencia del comercio
    const merchant = await c.env.DB.prepare('SELECT id FROM merchants WHERE id = ? LIMIT 1').bind(targetMerchantId).first();
    if (!merchant) {
      await logAuthFailure(c, 'MERCHANT_NOT_FOUND', 404, targetMerchantId);
      return c.json({ error: { message: 'Comercio no encontrado', type: 'MERCHANT_NOT_FOUND' } }, 404);
    }

    // 2. Validar coincidencia de merchant_id
    const tokenMerchantId = (payload.merchant_id || payload.merchantId) as string | undefined;
    const userRole = payload.role as string | undefined;

    if (userRole !== 'admin' && tokenMerchantId !== targetMerchantId) {
      await logAuthFailure(c, 'FORBIDDEN_MERCHANT_MISMATCH', 403, targetMerchantId);
      return c.json({ error: { message: 'No tienes autorización para acceder a los datos de este comercio', type: 'FORBIDDEN' } }, 403);
    }
  }

  c.set('user', {
    id: payload.sub as string,
    email: (payload.email as string) || '',
    role: (payload.role as string) || 'cashier',
    displayName: (payload.displayName as string) || null,
    emailVerified: true,
    merchantId: (payload.merchant_id || payload.merchantId || null) as string | null
  });

  if (targetMerchantId) {
    c.set('merchantId', targetMerchantId);
  }

  await next();
}

export function requireRole(...roles: string[]) {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const user = c.get('user');
    if (!user) {
      return c.json({ error: { message: 'No autenticado', type: 'UNAUTHORIZED' } }, 401);
    }
    if (!roles.includes(user.role)) {
      return c.json({ error: { message: 'Permisos insuficientes', type: 'FORBIDDEN' } }, 403);
    }
    await next();
  };
}

export async function optionalAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const authHeader = c.req.header('Authorization');
  let token: string | undefined;
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    token = authHeader.slice(7).trim();
  }
  if (token && c.env.AUTH_JWT_SECRET && c.env.DB) {
    const payload = await verifyJwtWithRotation(token, c.env.AUTH_JWT_SECRET, c.env.AUTH_JWT_SECRET_PREV);
    if (payload) {
      const user: any = await c.env.DB.prepare(
        'SELECT id, email, role, display_name, email_verified, status, merchant_id, password_updated_at FROM users WHERE id = ? LIMIT 1'
      ).bind(payload.sub).first();
      if (user && user.status === 'active' && (!user.password_updated_at || payload.iat >= user.password_updated_at)) {
        c.set('user', {
          id: user.id,
          email: user.email,
          role: user.role,
          displayName: user.display_name,
          emailVerified: Boolean(user.email_verified),
          merchantId: user.merchant_id || (payload.merchant_id as string) || null
        });
      }
    }
  }
  await next();
}
