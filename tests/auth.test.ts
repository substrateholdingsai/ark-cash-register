import { describe, it, expect, beforeEach, vi } from 'vitest';
import app from '../src/index';
import { Env } from '../src/types';

class Stmt {
  query: string;
  db: MockDB;
  params: any[] = [];
  constructor(query: string, db: MockDB, params: any[] = []) {
    this.query = query; this.db = db; this.params = params;
  }
  bind(...params: any[]) { return new Stmt(this.query, this.db, params); }
  async first<T = any>(): Promise<T | null> {
    const res = await this.all<T>();
    return res.results[0] || null;
  }
  async all<T = any>(): Promise<{ results: T[] }> {
    const q = this.query.trim().toUpperCase();
    const db = this.db;
    if (q.includes('FROM USERS')) {
      let rows = [...db.users];
      if (q.includes('WHERE EMAIL = ?')) rows = rows.filter((u) => u.email === this.params[0]);
      if (q.includes('WHERE ID = ?')) rows = rows.filter((u) => u.id === this.params[0]);
      return { results: rows as any };
    }
    if (q.includes('FROM EMAIL_VERIFICATION_TOKENS')) {
      let rows = [...db.evt];
      if (q.includes('WHERE TOKEN_HASH = ?')) rows = rows.filter((t) => t.token_hash === this.params[0]);
      if (q.includes('WHERE USER_ID = ?')) rows = rows.filter((t) => t.user_id === this.params[0]);
      return { results: rows as any };
    }
    if (q.includes('FROM PASSWORD_RESET_TOKENS')) {
      let rows = [...db.prt];
      if (q.includes('WHERE TOKEN_HASH = ?')) rows = rows.filter((t) => t.token_hash === this.params[0]);
      if (q.includes('WHERE USER_ID = ?')) rows = rows.filter((t) => t.user_id === this.params[0]);
      return { results: rows as any };
    }
    if (q.includes('FROM AUTH_SESSIONS')) {
      let rows = [...db.sessions];
      if (q.includes('WHERE REFRESH_TOKEN_HASH = ?')) rows = rows.filter((s) => s.refresh_token_hash === this.params[0]);
      if (q.includes('WHERE ID = ?')) rows = rows.filter((s) => s.id === this.params[0]);
      if (q.includes('WHERE USER_ID = ?')) rows = rows.filter((s) => s.user_id === this.params[0]);
      return { results: rows as any };
    }
    if (q.includes('FROM CONSENT_RECORDS')) {
      let rows = [...db.consents];
      if (q.includes('WHERE USER_ID = ?')) rows = rows.filter((c) => c.user_id === this.params[0]);
      return { results: rows as any };
    }
    if (q.includes('FROM ARCO_REQUESTS')) {
      let rows = [...db.arco];
      if (q.includes('WHERE USER_ID = ?')) rows = rows.filter((r) => r.user_id === this.params[0]);
      return { results: rows as any };
    }
    if (q.includes('FROM TERMS_VERSIONS') || q.includes('FROM PRIVACY_NOTICE_VERSIONS')) {
      return { results: [{ version: '1.0' }] as any };
    }
    if (q.includes('FROM USER_MFA')) {
      let rows = [...db.mfa];
      if (q.includes('WHERE USER_ID = ?')) rows = rows.filter((m) => m.user_id === this.params[0]);
      return { results: rows as any };
    }
    return { results: [] };
  }
  async run(): Promise<{ success: boolean }> {
    const q = this.query.trim().toUpperCase();
    const db = this.db;
    const p = this.params;
    if (q.startsWith('INSERT INTO USERS')) {
      db.users.push({
        id: p[0], email: p[1], email_verified: p[2], password_hash: p[3],
        password_updated_at: p[4], display_name: p[5], role: p[6], status: p[7],
        failed_login_count: p[8], locked_until: null, created_at: p[9], updated_at: p[10],
        last_login_at: null, merchant_id: null
      });
    } else if (q.startsWith('INSERT INTO EMAIL_VERIFICATION_TOKENS')) {
      db.evt.push({ id: p[0], user_id: p[1], token_hash: p[2], created_at: p[3], expires_at: p[4], consumed_at: null });
    } else if (q.startsWith('INSERT INTO PASSWORD_RESET_TOKENS')) {
      db.prt.push({ id: p[0], user_id: p[1], token_hash: p[2], created_at: p[3], expires_at: p[4], consumed_at: null, request_ip: p[5] });
    } else if (q.startsWith('INSERT INTO AUTH_SESSIONS')) {
      db.sessions.push({ id: p[0], user_id: p[1], refresh_token_hash: p[2], user_agent: p[3], ip_address: p[4], created_at: p[5], expires_at: p[6], revoked_at: null, replaced_by: null });
    } else if (q.startsWith('INSERT INTO AUTH_AUDIT_LOG') || q.startsWith('INSERT INTO CONSENT_RECORDS') || q.startsWith('INSERT INTO ARCO_REQUESTS')) {
      if (!db.consents) db.consents = [];
      if (!db.arco) db.arco = [];
      if (q.startsWith('INSERT INTO CONSENT_RECORDS')) db.consents.push({ id: p[0], user_id: p[1], document: p[2], version: p[3], accepted_at: p[4], ip_address: p[5], user_agent: p[6] });
      if (q.startsWith('INSERT INTO ARCO_REQUESTS')) db.arco.push({ id: p[0], user_id: p[1], type: p[2], status: p[3], details: p[4], requested_at: p[5] });
    } else if (q.startsWith('INSERT INTO USER_MFA')) {
      db.mfa = db.mfa || [];
      const existing = db.mfa.find((m: any) => m.user_id === p[0]);
      if (existing) { existing.secret = p[1]; existing.enabled = 0; existing.updated_at = p[4]; }
      else db.mfa.push({ user_id: p[0], secret: p[1], enabled: p[2], backup_codes: null, created_at: p[3], updated_at: p[4] });
    } else if (q.startsWith('UPDATE USERS SET EMAIL_VERIFIED')) {
      const u = db.users.find((x: any) => x.id === p[2]);
      if (u) { u.email_verified = 1; u.status = p[0]; u.updated_at = p[1]; }
    } else if (q.startsWith('UPDATE USERS SET FAILED_LOGIN_COUNT = ?, LOCKED_UNTIL')) {
      const u = db.users.find((x: any) => x.id === p[3]);
      if (u) { u.failed_login_count = p[0]; u.locked_until = p[1]; u.updated_at = p[2]; }
    } else if (q.includes('SET FAILED_LOGIN_COUNT = 0, LOCKED_UNTIL = NULL, LAST_LOGIN_AT')) {
      const u = db.users.find((x: any) => x.id === p[2]);
      if (u) { u.failed_login_count = 0; u.locked_until = null; u.last_login_at = p[0]; u.updated_at = p[1]; }
    } else if (q.startsWith('UPDATE USERS SET DISPLAY_NAME')) {
      const u = db.users.find((x: any) => x.id === p[2]);
      if (u) { u.display_name = p[0]; u.updated_at = p[1]; }
    } else if (q.includes('SET PASSWORD_HASH = ?, PASSWORD_UPDATED_AT = ?, FAILED_LOGIN_COUNT = 0')) {
      const u = db.users.find((x: any) => x.id === p[3]);
      if (u) { u.password_hash = p[0]; u.password_updated_at = p[1]; u.failed_login_count = 0; u.locked_until = null; u.updated_at = p[2]; }
    } else if (q.includes('SET PASSWORD_HASH = ?, PASSWORD_UPDATED_AT = ?, UPDATED_AT')) {
      const u = db.users.find((x: any) => x.id === p[3]);
      if (u) { u.password_hash = p[0]; u.password_updated_at = p[1]; u.updated_at = p[2]; }
    } else if (q.includes('SET EMAIL = ?, EMAIL_VERIFIED = 0')) {
      const u = db.users.find((x: any) => x.id === p[3]);
      if (u) { u.email = p[0]; u.email_verified = 0; u.status = p[1]; u.updated_at = p[2]; }
    } else if (q.startsWith('UPDATE USERS SET STATUS = ?, UPDATED_AT')) {
      const u = db.users.find((x: any) => x.id === p[2]);
      if (u) { u.status = p[0]; u.updated_at = p[1]; }
    } else if (q.startsWith('UPDATE EMAIL_VERIFICATION_TOKENS SET CONSUMED_AT')) {
      if (q.includes('WHERE USER_ID = ?')) {
        db.evt.filter((t: any) => t.user_id === p[1] && t.consumed_at === null).forEach((t: any) => (t.consumed_at = p[0]));
      } else {
        const t = db.evt.find((x: any) => x.id === p[1]);
        if (t) t.consumed_at = p[0];
      }
    } else if (q.startsWith('UPDATE PASSWORD_RESET_TOKENS SET CONSUMED_AT')) {
      if (q.includes('WHERE USER_ID = ?')) {
        db.prt.filter((t: any) => t.user_id === p[1] && t.consumed_at === null).forEach((t: any) => (t.consumed_at = p[0]));
      } else {
        const t = db.prt.find((x: any) => x.id === p[1]);
        if (t) t.consumed_at = p[0];
      }
    } else if (q.startsWith('UPDATE AUTH_SESSIONS SET REVOKED_AT = ?, REPLACED_BY')) {
      const s = db.sessions.find((x: any) => x.id === p[2]);
      if (s) { s.revoked_at = p[0]; s.replaced_by = p[1]; }
    } else if (q.startsWith('UPDATE AUTH_SESSIONS SET REVOKED_AT = ? WHERE ID')) {
      const s = db.sessions.find((x: any) => x.id === p[1]);
      if (s) s.revoked_at = p[0];
    } else if (q.startsWith('UPDATE AUTH_SESSIONS SET REVOKED_AT = ? WHERE USER_ID')) {
      db.sessions.filter((s: any) => s.user_id === p[1] && s.revoked_at === null).forEach((s: any) => (s.revoked_at = p[0]));
    } else if (q.startsWith('UPDATE USER_MFA SET ENABLED = 1')) {
      const m = (db.mfa || []).find((x: any) => x.user_id === p[1]);
      if (m) { m.enabled = 1; m.updated_at = p[0]; }
    } else if (q.startsWith('DELETE FROM USER_MFA')) {
      db.mfa = (db.mfa || []).filter((m: any) => m.user_id !== p[0]);
    } else if (q.startsWith('DELETE FROM AUTH_SESSIONS')) {
      // noop
    }
    return { success: true };
  }
}

class MockDB {
  users: any[] = [];
  evt: any[] = [];
  prt: any[] = [];
  sessions: any[] = [];
  consents: any[] = [];
  arco: any[] = [];
  mfa: any[] = [];
  audit: any[] = [];
  prepare(q: string) { return new Stmt(q, this); }
}

class MockKV {
  store = new Map<string, string>();
  async get(key: string, type?: string) {
    const v = this.store.get(key);
    if (v === undefined) return null;
    if (type === 'json') { try { return JSON.parse(v); } catch { return null; } }
    return v;
  }
  async put(key: string, value: string, opts?: any) { this.store.set(key, value); }
  async delete(key: string) { this.store.delete(key); }
}

let mockDb: MockDB;
let mockKv: MockKV;
let env: Env;

beforeEach(() => {
  mockDb = new MockDB();
  mockKv = new MockKV();
  env = {
    DB: mockDb as any,
    KV: mockKv as any,
    PEY_API_URL: 'https://api.pey.mx',
    ENVIRONMENT: 'development',
    APP_VERSION: '2.0.0',
    AUTH_JWT_SECRET: 'test_secret_at_least_32_chars_long!!',
    RESEND_API_KEY: 're_test_key',
    RESEND_FROM_EMAIL: 'Ark <noreply@test.com>',
    APP_BASE_URL: 'http://localhost:8787',
    PASSWORD_MIN_LENGTH: '12',
    PRIVACY_NOTICE_VERSION: '1.0',
    TERMS_VERSION: '1.0'
  };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'email_1' }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
});

const C = { acceptTerms: true, acceptPrivacy: true, termsVersion: '1.0', privacyVersion: '1.0' };

describe('Auth sovereign system', () => {
  it('register creates pending user and sends verification email', async () => {
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@test.com', password: 'Password1234', displayName: 'Juan', ...C })
    }, env);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockDb.users).toHaveLength(1);
    expect(mockDb.users[0].status).toBe('pending');
    expect(mockDb.evt).toHaveLength(1);
    expect((fetch as any).mock.calls.length).toBe(1);
  });

  it('register duplicate email returns generic 201 without email', async () => {
    await app.request('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'dup@test.com', password: 'Password1234', ...C }) }, env);
    const callsBefore = (fetch as any).mock.calls.length;
    const res = await app.request('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'dup@test.com', password: 'Password1234', ...C }) }, env);
    expect(res.status).toBe(201);
    expect((fetch as any).mock.calls.length).toBe(callsBefore);
  });

  it('register weak password returns 400', async () => {
    const res = await app.request('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'weak@test.com', password: 'abc', ...C }) }, env);
    expect(res.status).toBe(400);
  });

  it('register without consent returns 400', async () => {
    const res = await app.request('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'noconsent@test.com', password: 'Password1234' }) }, env);
    expect(res.status).toBe(400);
  });

  it('verify-email invalid token returns 400', async () => {
    const res = await app.request('/api/auth/verify-email?token=invalidtoken', {}, env);
    expect(res.status).toBe(400);
  });

  it('login unverified returns 403', async () => {
    await app.request('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'unv@test.com', password: 'Password1234', ...C }) }, env);
    const res = await app.request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'unv@test.com', password: 'Password1234' }) }, env);
    expect(res.status).toBe(403);
  });

  it('full flow: register -> verify -> login -> me', async () => {
    await app.request('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'flow@test.com', password: 'Password1234', ...C }) }, env);
    mockDb.users[0].email_verified = 1;
    mockDb.users[0].status = 'active';
    const loginRes = await app.request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'flow@test.com', password: 'Password1234' }) }, env);
    expect(loginRes.status).toBe(200);
    const loginBody = await loginRes.json();
    expect(loginBody.accessToken).toBeTruthy();
    const meRes = await app.request('/api/auth/me', { method: 'GET', headers: { Authorization: `Bearer ${loginBody.accessToken}` } }, env);
    expect(meRes.status).toBe(200);
    const meBody = await meRes.json();
    expect(meBody.email).toBe('flow@test.com');
  });

  it('login wrong password returns 401 and increments counter', async () => {
    await app.request('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'wp@test.com', password: 'Password1234', ...C }) }, env);
    mockDb.users[0].email_verified = 1;
    mockDb.users[0].status = 'active';
    const res = await app.request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'wp@test.com', password: 'WrongPass1234' }) }, env);
    expect(res.status).toBe(401);
    expect(mockDb.users[0].failed_login_count).toBe(1);
  });

  it('forgot-password always 200', async () => {
    const res = await app.request('/api/auth/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'nope@test.com' }) }, env);
    expect(res.status).toBe(200);
  });

  it('reset-password with invalid token 400', async () => {
    const res = await app.request('/api/auth/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'bad', newPassword: 'NewPassword1234' }) }, env);
    expect(res.status).toBe(400);
  });

  it('me without token 401', async () => {
    const res = await app.request('/api/auth/me', { method: 'GET' }, env);
    expect(res.status).toBe(401);
  });

  it('health includes authConfigured', async () => {
    const res = await app.request('/api/health', { method: 'GET' }, env);
    const body = await res.json();
    expect(body.cloudflareBindings.authConfigured).toBe(true);
    expect(body.cloudflareBindings.resendConfigured).toBe(true);
  });

  it('legal versions endpoint returns versions', async () => {
    const res = await app.request('/api/legal/versions', { method: 'GET' }, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.terms).toBe('1.0');
    expect(body.privacy).toBe('1.0');
  });

  it('privacy export requires auth', async () => {
    const res = await app.request('/api/privacy/export', { method: 'POST' }, env);
    expect(res.status).toBe(401);
  });

  it('consent recorded on register', async () => {
    await app.request('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'consent@test.com', password: 'Password1234', ...C }) }, env);
    const u = mockDb.users.find((x: any) => x.email === 'consent@test.com');
    expect(u).toBeTruthy();
    expect(mockDb.consents.length).toBeGreaterThanOrEqual(2);
  });
});
