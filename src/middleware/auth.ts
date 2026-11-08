import { Context, Next } from 'hono';
import { Env } from '../types';
import { verifyJwtWithRotation } from '../utils/crypto';

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  displayName: string | null;
  emailVerified: boolean;
}

declare module 'hono' {
  interface ContextVariableMap {
    user?: AuthUser;
  }
}

export async function requireAuth(c: Context<{ Bindings: Env }>, next: Next) {
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
    return c.json({ error: { message: 'No autenticado', type: 'UNAUTHORIZED' } }, 401);
  }

  const secret = c.env.AUTH_JWT_SECRET;
  if (!secret) {
    return c.json({ error: { message: 'Auth no configurado', type: 'AUTH_NOT_CONFIGURED' } }, 503);
  }

  const payload = await verifyJwtWithRotation(token, secret, c.env.AUTH_JWT_SECRET_PREV);
  if (!payload) {
    return c.json({ error: { message: 'Token inválido o expirado', type: 'INVALID_TOKEN' } }, 401);
  }

  // Cargar usuario
  if (!c.env.DB) {
    return c.json({ error: { message: 'D1 no configurado', type: 'D1_UNAVAILABLE' } }, 503);
  }
  const user: any = await c.env.DB.prepare(
    'SELECT id, email, role, display_name, email_verified, status, password_updated_at FROM users WHERE id = ? LIMIT 1'
  ).bind(payload.sub).first();

  if (!user) {
    return c.json({ error: { message: 'Usuario no encontrado', type: 'USER_NOT_FOUND' } }, 401);
  }
  if (user.status !== 'active') {
    return c.json({ error: { message: 'Cuenta no activa', type: 'ACCOUNT_NOT_ACTIVE' } }, 403);
  }

  // Invalidar tokens emitidos antes del último cambio de password
  const tokenIat = payload.iat;
  if (user.password_updated_at && tokenIat < user.password_updated_at) {
    return c.json({ error: { message: 'Token inválido', type: 'INVALID_TOKEN' } }, 401);
  }

  c.set('user', {
    id: user.id,
    email: user.email,
    role: user.role,
    displayName: user.display_name,
    emailVerified: Boolean(user.email_verified)
  });

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
        'SELECT id, email, role, display_name, email_verified, status, password_updated_at FROM users WHERE id = ? LIMIT 1'
      ).bind(payload.sub).first();
      if (user && user.status === 'active' && (!user.password_updated_at || payload.iat >= user.password_updated_at)) {
        c.set('user', {
          id: user.id,
          email: user.email,
          role: user.role,
          displayName: user.display_name,
          emailVerified: Boolean(user.email_verified)
        });
      }
    }
  }
  await next();
}
