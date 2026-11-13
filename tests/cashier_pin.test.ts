import { describe, it, expect } from 'vitest';
import worker from '../src/index';
import { signJwt } from '../src/utils/crypto';

describe('Modo Cajero con PIN de 4 dígitos (/api/merchant/:id/cashier/*)', () => {
  const MERCHANT_ID = '01JBAVWE4NS5TGXHWGMX3KH23Q';
  const JWT_SECRET = 'test_jwt_secret_cashier_pin_0123456789';

  async function ownerAuthHeaders() {
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt({
      sub: 'user_owner_1',
      email: 'owner@taqueria.mx',
      role: 'merchant',
      merchantId: MERCHANT_ID,
      iat: now,
      exp: now + 3600
    }, JWT_SECRET);
    return { Authorization: `Bearer ${token}` };
  }

  function createMockEnv(overrides: Record<string, any> = {}) {
    const merchants = new Map<string, any>([
      [MERCHANT_ID, {
        id: MERCHANT_ID,
        alias: 'Taquería El Güero',
        cashier_pin_hash: null,
        cashier_mode_enabled: 0
      }]
    ]);
    const shifts: any[] = [];

    return {
      _state: { merchants, shifts },
      ENVIRONMENT: 'test',
      AUTH_JWT_SECRET: JWT_SECRET,
      DB: {
        prepare: (query: string) => ({
          bind: (...params: any[]) => ({
            first: async () => {
              if (query.includes('FROM merchants WHERE id')) {
                return merchants.get(params[0]) || null;
              }
              if (query.includes('FROM cashier_shifts')) {
                const mId = params[0];
                return shifts
                  .filter(s => s.merchant_id === mId && s.status === 'OPEN')
                  .sort((a, b) => b.opened_at - a.opened_at)[0] || null;
              }
              return null;
            },
            run: async () => {
              if (query.includes('SET cashier_pin_hash')) {
                const [hash, updatedAt, mId] = params;
                const m = merchants.get(mId);
                if (m) {
                  m.cashier_pin_hash = hash;
                  m.cashier_mode_enabled = 1;
                  m.updated_at = updatedAt;
                }
                return { success: true, meta: { changes: m ? 1 : 0 } };
              }
              if (query.includes("UPDATE cashier_shifts") && query.includes("WHERE merchant_id = ? AND status = 'OPEN'")) {
                const [closedAt, mId] = params;
                for (const s of shifts) {
                  if (s.merchant_id === mId && s.status === 'OPEN') {
                    s.status = 'CLOSED';
                    s.closed_at = s.closed_at || closedAt;
                  }
                }
                return { success: true, meta: { changes: 1 } };
              }
              if (query.includes('INSERT INTO cashier_shifts')) {
                const [id, mId, opName, openingCash, openedAt] = params;
                shifts.push({
                  id,
                  merchant_id: mId,
                  operator_name: opName,
                  status: 'OPEN',
                  opening_cash_mxn: openingCash,
                  closing_cash_mxn: null,
                  opened_at: openedAt,
                  closed_at: null
                });
                return { success: true, meta: { changes: 1 } };
              }
              if (query.includes('UPDATE cashier_shifts') && query.includes('WHERE id = ?')) {
                const [closingCash, closedAt, shiftId] = params;
                const s = shifts.find(x => x.id === shiftId);
                if (s) {
                  s.status = 'CLOSED';
                  s.closing_cash_mxn = closingCash;
                  s.closed_at = closedAt;
                }
                return { success: true, meta: { changes: s ? 1 : 0 } };
              }
              return { success: true, meta: { changes: 0 } };
            },
            all: async () => ({ results: [] })
          })
        })
      } as any,
      KV: {
        get: async () => null,
        put: async () => {},
        delete: async () => {}
      } as any,
      ...overrides
    };
  }

  it('rechaza PIN inválido al configurar (PUT /cashier-pin) y guarda hash SHA-256 cuando son 4 dígitos', async () => {
    const env = createMockEnv();
    const auth = await ownerAuthHeaders();

    // Sin token de dueño -> 401
    const unauthRes = await worker.request(`/api/merchant/${MERCHANT_ID}/cashier-pin`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '4829' })
    }, env);
    expect(unauthRes.status).toBe(401);

    const badRes = await worker.request(`/api/merchant/${MERCHANT_ID}/cashier-pin`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({ pin: '12ab' })
    }, env);
    expect(badRes.status).toBe(400);

    const okRes = await worker.request(`/api/merchant/${MERCHANT_ID}/cashier-pin`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({ pin: '4829' })
    }, env);
    expect(okRes.status).toBe(200);
    const data: any = await okRes.json();
    expect(data.cashierModeEnabled).toBe(true);
    expect(data.hasCustomPin).toBe(true);
    expect(env._state.merchants.get(MERCHANT_ID).cashier_pin_hash).toHaveLength(64);
  });

  it('abre turno con PIN válido, rechaza PIN incorrecto con 401, consulta estado y cierra turno', async () => {
    const env = createMockEnv();
    const auth = await ownerAuthHeaders();

    // Configurar PIN personalizado '4829'
    const setupRes = await worker.request(`/api/merchant/${MERCHANT_ID}/cashier-pin`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({ pin: '4829' })
    }, env);
    expect(setupRes.status).toBe(200);

    // PIN incorrecto -> 401
    const badOpen = await worker.request(`/api/merchant/${MERCHANT_ID}/cashier/shift/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '1234', operatorName: 'Ana López' })
    }, env);
    expect(badOpen.status).toBe(401);

    // PIN correcto -> 201
    const okOpen = await worker.request(`/api/merchant/${MERCHANT_ID}/cashier/shift/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '4829', operatorName: 'Ana López', openingCashMxn: 500 })
    }, env);
    expect(okOpen.status).toBe(201);
    const openData: any = await okOpen.json();
    expect(openData.status).toBe('OPEN');
    expect(openData.role).toBe('cashier');
    expect(openData.restrictedCapabilities).toContain('change_clabe');

    // Status refleja turno abierto y no expone hash
    const statusRes = await worker.request(`/api/merchant/${MERCHANT_ID}/cashier/status`, {
      method: 'GET'
    }, env);
    expect(statusRes.status).toBe(200);
    const statusData: any = await statusRes.json();
    expect(statusData.hasCustomPin).toBe(true);
    expect(statusData.activeShift.operatorName).toBe('Ana López');
    expect(statusData.cashier_pin_hash).toBeUndefined();

    // Cierre de turno
    const closeRes = await worker.request(`/api/merchant/${MERCHANT_ID}/cashier/shift/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '4829', closingCashMxn: 1850 })
    }, env);
    expect(closeRes.status).toBe(200);
    const closeData: any = await closeRes.json();
    expect(closeData.status).toBe('CLOSED');
    expect(closeData.closingCashMxn).toBe(1850);
  });
});
