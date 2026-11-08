import { describe, it, expect, beforeEach } from 'vitest';
import app from '../src/index';
import { Env } from '../src/types';
import { signJwt } from '../src/utils/crypto';

// High-fidelity D1 Mock para pruebas locales completas de P0
class MockD1PreparedStatement {
  private query: string;
  private params: any[];
  private db: MockP0Database;

  constructor(query: string, db: MockP0Database, params: any[] = []) {
    this.query = query;
    this.db = db;
    this.params = params;
  }

  bind(...params: any[]) {
    return new MockD1PreparedStatement(this.query, this.db, params);
  }

  async first<T = any>(): Promise<T | null> {
    const res = await this.all<T>();
    return res.results[0] || null;
  }

  async all<T = any>(): Promise<{ results: T[] }> {
    const q = this.query.trim().toUpperCase();

    // MERCHANTS
    if (q.includes('FROM MERCHANTS')) {
      if (q.includes('WHERE ID = ?')) {
        const id = this.params[0];
        const m = this.db.merchants.find(item => item.id === id);
        return { results: m ? [m as any] : [] };
      }
      return { results: this.db.merchants as any };
    }

    // PAYMENTS
    if (q.includes('FROM PAYMENTS')) {
      let filtered = [...this.db.payments];
      if (q.includes('WHERE MERCHANT_ID = ?')) {
        const mId = this.params[0];
        filtered = filtered.filter(p => p.merchant_id === mId);
      } else if (q.includes('WHERE (PAYABLE_ID = ? OR ID = ?)') || q.includes('WHERE PAYABLE_ID = ? OR ID = ?')) {
        const id = this.params[0];
        filtered = filtered.filter(p => p.payable_id === id || p.id === id);
      }

      if (q.includes('COUNT(*)')) {
        return { results: [{ total: filtered.length, count: filtered.length } as any] };
      }

      // Handle LIMIT and OFFSET
      if (q.includes('LIMIT ? OFFSET ?')) {
        const limit = this.params[1];
        const offset = this.params[2];
        const sliced = filtered.slice(offset, offset + limit);
        return { results: sliced as any };
      }

      return { results: filtered as any };
    }

    // WEBHOOK_EVENTS
    if (q.includes('FROM WEBHOOK_EVENTS')) {
      if (q.includes('WHERE IDEMPOTENCY_KEY = ?')) {
        const key = this.params[0];
        const evt = this.db.webhooks.find(w => w.idempotency_key === key);
        return { results: evt ? [evt as any] : [] };
      }
      return { results: this.db.webhooks as any };
    }

    // LEDGER_ENTRIES
    if (q.includes('FROM LEDGER_ENTRIES')) {
      let entries = [...this.db.ledger];
      if (q.includes('WHERE PAYMENT_ID = ?')) {
        const pId = this.params[0];
        const txnId = this.params[1];
        entries = entries.filter(l => l.payment_id === pId || (txnId && l.transaction_id === txnId));
      }
      return { results: entries as any };
    }

    // OPERATOR_AUDIT_LOG
    if (q.includes('FROM OPERATOR_AUDIT_LOG')) {
      return { results: this.db.auditLogs as any };
    }

    return { results: [] };
  }

  async run(): Promise<{ success: boolean; meta?: { changes: number }; changes?: number }> {
    const q = this.query.trim().toUpperCase();
    const p = this.params;

    if (q.startsWith('INSERT INTO OPERATOR_AUDIT_LOG')) {
      this.db.auditLogs.push({
        id: p[0],
        endpoint: p[1],
        method: p[2],
        merchant_id: p[3],
        status_code: p[4],
        error: p[5],
        created_at: p[6]
      });
      return { success: true, meta: { changes: 1 }, changes: 1 };
    }

    if (q.startsWith('INSERT INTO WEBHOOK_EVENTS')) {
      // Simular restricción única en idempotency_key
      // VALUES (?, ?, ?, ?, ?, ?, 0, ?, 1, 0, 'PROCESSING') -> p[6] es idempotency_key
      const idKey = p[6];
      if (idKey && this.db.webhooks.some(w => w.idempotency_key === idKey)) {
        throw new Error('UNIQUE constraint failed: webhook_events.idempotency_key');
      }
      this.db.webhooks.push({
        id: p[0],
        event_type: p[1],
        transaction_id: p[2],
        payload: p[3],
        signature: p[4],
        received_at: p[5],
        processed: 0,
        idempotency_key: idKey,
        hmac_valid: 1,
        is_duplicate: 0,
        processing_status: 'PROCESSING'
      });
      return { success: true, meta: { changes: 1 }, changes: 1 };
    }

    if (q.startsWith('UPDATE WEBHOOK_EVENTS')) {
      if (q.includes('SET PROCESSED = 1')) {
        const id = p[0];
        const evt = this.db.webhooks.find(w => w.id === id);
        if (evt) {
          evt.processed = 1;
          evt.processing_status = 'COMPLETED';
        }
      }
      return { success: true, meta: { changes: 1 }, changes: 1 };
    }

    if (q.startsWith('UPDATE PAYMENTS')) {
      // SET status = 'PAID', transaction_id = ?, payment_method = ?, date_paid = ? WHERE (payable_id = ? OR id = ?) AND status != 'PAID'
      const txnId = p[0];
      const method = p[1];
      const datePaid = p[2];
      const pId1 = p[3];
      const pId2 = p[4];

      let changes = 0;
      this.db.payments.forEach(payment => {
        if ((payment.payable_id === pId1 || payment.id === pId2) && payment.status !== 'PAID') {
          payment.status = 'PAID';
          payment.transaction_id = txnId;
          payment.payment_method = method;
          payment.date_paid = datePaid;
          changes++;
        }
      });

      return { success: true, meta: { changes }, changes };
    }

    if (q.startsWith('INSERT INTO LEDGER_ENTRIES')) {
      this.db.ledger.push({
        id: p[0],
        merchant_id: p[1],
        payment_id: p[2],
        transaction_id: p[3],
        debit_account: '102.01 Bancos CoDi',
        credit_account: '401.01 Ventas Confirmadas',
        amount: p[4],
        concept: p[5],
        created_at: p[6]
      });
      return { success: true, meta: { changes: 1 }, changes: 1 };
    }

    return { success: true, meta: { changes: 1 }, changes: 1 };
  }
}

class MockP0Database {
  merchants: any[] = [];
  payments: any[] = [];
  ledger: any[] = [];
  webhooks: any[] = [];
  auditLogs: any[] = [];

  prepare(query: string) {
    return new MockD1PreparedStatement(query, this);
  }
}

describe('P0 — Auth Soberano, Paginación e Idempotencia de Webhooks', () => {
  let mockDb: MockP0Database;
  let env: Env;
  const TEST_SECRET = 'super-secret-jwt-key-for-local-testing-purposes-12345';
  const PEY_SECRET = 'pey-webhook-secret-test-321';

  beforeEach(() => {
    mockDb = new MockP0Database();

    // 2 Merchants reales para probar aislamiento
    mockDb.merchants = [
      {
        id: '01JBAVWE4NS5TGXHWGMX3KH23Q',
        alias: 'Taquería El Güero',
        name: 'Taquería El Güero S.A. de C.V.',
        clabe: '012180001234567899',
        entity: 'BUSINESS',
        codi_status: 'ACTIVE',
        created_at: 1731000000,
        updated_at: 1731000000
      },
      {
        id: '01JBAVSKINLAB0000000000000',
        alias: 'SkinLab Clothing Club',
        name: 'SkinLab Clothing Club S.A.P.I. de C.V.',
        clabe: '012910015574608483',
        entity: 'BUSINESS',
        codi_status: 'ACTIVE',
        created_at: 1731000000,
        updated_at: 1731000000
      }
    ];

    // Cargar 25 pagos para Taquería El Güero (para probar paginación de 20 en 20)
    for (let i = 1; i <= 25; i++) {
      mockDb.payments.push({
        id: `pay-tq-${String(i).padStart(3, '0')}`,
        merchant_id: '01JBAVWE4NS5TGXHWGMX3KH23Q',
        payable_type: 'CODI_QR',
        payable_id: `qr-tq-${i}`,
        amount: 100 + i,
        concept: `Tacos orden #${i}`,
        num_ref: `10000${i}`,
        status: i % 2 === 0 ? 'PAID' : 'WAITING',
        transaction_id: i % 2 === 0 ? `txn-tq-${i}` : null,
        payment_method: 'CODI',
        date_created: 1731000000 + i * 60,
        date_paid: i % 2 === 0 ? 1731000000 + i * 60 + 30 : null
      });
    }

    // 5 pagos para SkinLab
    for (let i = 1; i <= 5; i++) {
      mockDb.payments.push({
        id: `pay-sl-${String(i).padStart(3, '0')}`,
        merchant_id: '01JBAVSKINLAB0000000000000',
        payable_type: 'CODI_QR',
        payable_id: `qr-sl-${i}`,
        amount: 299 + i,
        concept: `Playera Tulum #${i}`,
        num_ref: `20000${i}`,
        status: 'WAITING',
        transaction_id: null,
        payment_method: 'CODI',
        date_created: 1731000000 + i * 60,
        date_paid: null
      });
    }

    env = {
      DB: mockDb as any,
      KV: {} as any,
      PEY_API_URL: 'https://api.pey.mx',
      PEY_API_KEY: 'test_pey_key',
      PEY_WEBHOOK_SECRET: PEY_SECRET,
      AUTH_JWT_SECRET: TEST_SECRET,
      ENVIRONMENT: 'production',
      APP_NAME: 'Ark-cajaregistradora',
      APP_VERSION: '2.0.0'
    };
  });

  // ==========================================
  // 1. AUTH_JWT_SECRET & AISLAMIENTO MULTI-TENANT
  // ==========================================
  describe('1. AUTH_JWT_SECRET — Fail-closed y Aislamiento Soberano', () => {
    it('en producción, si AUTH_JWT_SECRET falta o está vacío, el worker falla cerrado con 503', async () => {
      const prodNoSecretEnv = { ...env, AUTH_JWT_SECRET: '' };
      const res = await app.request('/api/merchant/01JBAVWE4NS5TGXHWGMX3KH23Q/payments', {
        method: 'GET'
      }, prodNoSecretEnv);

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error.type).toBe('AUTH_NOT_CONFIGURED');

      // Verifica registro en auditoría de operador
      expect(mockDb.auditLogs.length).toBeGreaterThan(0);
      const lastAudit = mockDb.auditLogs[mockDb.auditLogs.length - 1];
      expect(lastAudit.status_code).toBe(503);
      expect(lastAudit.error).toBe('AUTH_NOT_CONFIGURED');
    });

    it('petición sin token devuelve 401 Unauthorized y registra fallo en auditoría', async () => {
      const res = await app.request('/api/merchant/01JBAVWE4NS5TGXHWGMX3KH23Q/payments', {
        method: 'GET'
      }, env);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.type).toBe('UNAUTHORIZED');

      const lastAudit = mockDb.auditLogs[mockDb.auditLogs.length - 1];
      expect(lastAudit.status_code).toBe(401);
      expect(lastAudit.error).toBe('MISSING_BEARER_TOKEN');
    });

    it('token con firma inválida o adulterada devuelve 401 Invalid Token', async () => {
      const token = await signJwt({ sub: 'user-1', merchant_id: '01JBAVWE4NS5TGXHWGMX3KH23Q', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 }, 'wrong-secret');

      const res = await app.request('/api/merchant/01JBAVWE4NS5TGXHWGMX3KH23Q/payments', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
      }, env);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.type).toBe('INVALID_TOKEN');
    });

    it('token expirado devuelve 401 Invalid Token', async () => {
      const expiredToken = await signJwt({
        sub: 'user-1',
        merchant_id: '01JBAVWE4NS5TGXHWGMX3KH23Q',
        iat: Math.floor(Date.now() / 1000) - 3600,
        exp: Math.floor(Date.now() / 1000) - 60 // Expiró hace 1 minuto
      }, TEST_SECRET);

      const res = await app.request('/api/merchant/01JBAVWE4NS5TGXHWGMX3KH23Q/payments', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${expiredToken}` }
      }, env);

      expect(res.status).toBe(401);
    });

    it('token sin firmar o con alg "none" es estrictamente rechazado con 401', async () => {
      // JWT falso sin firmar: {"alg":"none"}.{"sub":"user-1","merchant_id":"01JBAVWE4NS5TGXHWGMX3KH23Q"}
      const unsignedToken = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJ1c2VyLTEiLCJtZXJjaGFudF9pZCI6IjAxSkJBVldFNE5TNVRHWEhXR01YM0tIMjNRIn0.';

      const res = await app.request('/api/merchant/01JBAVWE4NS5TGXHWGMX3KH23Q/payments', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${unsignedToken}` }
      }, env);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.type).toBe('INVALID_TOKEN');
    });

    it('token de Taquería El Güero intentando leer pagos de SkinLab Clothing es rechazado con 403 Forbidden', async () => {
      // Token emitido legítimamente para Taquería El Güero
      const taqueriaToken = await signJwt({
        sub: 'user-taquero-01',
        role: 'cashier',
        merchant_id: '01JBAVWE4NS5TGXHWGMX3KH23Q',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 900
      }, TEST_SECRET);

      // Intenta acceder a los pagos de SkinLab Clothing
      const res = await app.request('/api/merchant/01JBAVSKINLAB0000000000000/payments', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${taqueriaToken}` }
      }, env);

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.type).toBe('FORBIDDEN');
      expect(body.error.message).toContain('No tienes autorización');

      // Verifica auditoría de intento de cruce entre tenants
      const lastAudit = mockDb.auditLogs[mockDb.auditLogs.length - 1];
      expect(lastAudit.status_code).toBe(403);
      expect(lastAudit.error).toBe('FORBIDDEN_MERCHANT_MISMATCH');
      expect(lastAudit.merchant_id).toBe('01JBAVSKINLAB0000000000000');
    });

    it('token solicitando un comercio inexistente devuelve 404 Not Found', async () => {
      const token = await signJwt({
        sub: 'user-01',
        role: 'cashier',
        merchant_id: '01JBAVWE4NS5TGXHWGMX3KH23Q',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 900
      }, TEST_SECRET);

      const res = await app.request('/api/merchant/COMERCIO_NO_EXISTE_999/payments', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
      }, env);

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.type).toBe('MERCHANT_NOT_FOUND');
    });

    it('token legítimo del comercio accede con 200 OK y solo ve sus datos', async () => {
      const taqueriaToken = await signJwt({
        sub: 'user-taquero-01',
        role: 'cashier',
        merchant_id: '01JBAVWE4NS5TGXHWGMX3KH23Q',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 900
      }, TEST_SECRET);

      const res = await app.request('/api/merchant/01JBAVWE4NS5TGXHWGMX3KH23Q/payments', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${taqueriaToken}` }
      }, env);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.payments).toBeDefined();
      expect(body.payments.every((p: any) => p.merchant_id === '01JBAVWE4NS5TGXHWGMX3KH23Q')).toBe(true);
    });
  });

  // ==========================================
  // 2. PAGINACIÓN EN /merchant/:id/payments
  // ==========================================
  describe('2. Paginación en /merchant/:id/payments', () => {
    let authToken: string;

    beforeEach(async () => {
      authToken = await signJwt({
        sub: 'user-taquero-01',
        role: 'cashier',
        merchant_id: '01JBAVWE4NS5TGXHWGMX3KH23Q',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 900
      }, TEST_SECRET);
    });

    it('por defecto aplica limit 20 y offset 0, reportando hasMore=true para 25 pagos', async () => {
      const res = await app.request('/api/merchant/01JBAVWE4NS5TGXHWGMX3KH23Q/payments', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${authToken}` }
      }, env);

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.payments).toHaveLength(20);
      expect(body.pagination).toEqual({
        total: 25,
        limit: 20,
        offset: 0,
        hasMore: true,
        nextOffset: 20
      });
    });

    it('offset 20 devuelve los 5 pagos restantes con hasMore=false y nextOffset=null', async () => {
      const res = await app.request('/api/merchant/01JBAVWE4NS5TGXHWGMX3KH23Q/payments?limit=20&offset=20', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${authToken}` }
      }, env);

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.payments).toHaveLength(5);
      expect(body.pagination).toEqual({
        total: 25,
        limit: 20,
        offset: 20,
        hasMore: false,
        nextOffset: null
      });
    });

    it('rechaza consultas con limit > 100 con 400 Bad Request', async () => {
      const res = await app.request('/api/merchant/01JBAVWE4NS5TGXHWGMX3KH23Q/payments?limit=150', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${authToken}` }
      }, env);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain('100');
    });

    it('rechaza limit inválido o negativo con 400 Bad Request', async () => {
      const res = await app.request('/api/merchant/01JBAVWE4NS5TGXHWGMX3KH23Q/payments?limit=-5', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${authToken}` }
      }, env);

      expect(res.status).toBe(400);
    });

    it('las respuestas de pagos no incluyen el qrString para ahorrar ancho de banda y cuota D1', async () => {
      const res = await app.request('/api/merchant/01JBAVWE4NS5TGXHWGMX3KH23Q/payments', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${authToken}` }
      }, env);

      const body = await res.json();
      expect(body.payments[0].qr_string).toBeUndefined();
      expect(body.payments[0].amount).toBeDefined();
    });
  });

  // ==========================================
  // 3. IDEMPOTENCIA Y REINTENTOS DE WEBHOOKS
  // ==========================================
  describe('3. Idempotencia y Reintentos de Webhooks (un pago, un asiento)', () => {
    async function makeSignature(body: string, timestamp: string, secret: string): Promise<string> {
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${body}`));
      return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    it('webhook con firma HMAC inválida es rechazado con 401 y no modifica estados ni asientos', async () => {
      const now = String(Math.floor(Date.now() / 1000));
      const payload = JSON.stringify({
        event: 'payment.confirmed',
        transactionId: 'txn-fake-01',
        payableId: 'qr-tq-1',
        amount: 101
      });

      const res = await app.request('/webhooks/pey', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Pey-Signature': 'firma-completamente-falsa',
          'X-Pey-Timestamp': now
        },
        body: payload
      }, env);

      expect(res.status).toBe(401);
      const targetPayment = mockDb.payments.find(p => p.id === 'pay-tq-001');
      expect(targetPayment.status).toBe('WAITING'); // Sin cambio
      expect(mockDb.ledger).toHaveLength(0); // Sin asiento
    });

    it('webhook con timestamp expirado (>300s) es rechazado con 401 por anti-replay', async () => {
      const expiredTs = String(Math.floor(Date.now() / 1000) - 350); // 350s atrás
      const payload = JSON.stringify({ event: 'payment.confirmed', payableId: 'qr-tq-1' });
      const sig = await makeSignature(payload, expiredTs, PEY_SECRET);

      const res = await app.request('/webhooks/pey', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Pey-Signature': sig,
          'X-Pey-Timestamp': expiredTs
        },
        body: payload
      }, env);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toContain('anti-replay');
    });

    it('primer envío de payment.confirmed marca PAID y crea EXACTAMENTE 1 asiento contable en ledger_entries', async () => {
      const now = String(Math.floor(Date.now() / 1000));
      const payload = JSON.stringify({
        event: 'payment.confirmed',
        transactionId: 'txn-banxico-998877',
        payableId: 'qr-tq-1',
        amount: 101,
        paymentMethod: 'CODI'
      });
      const sig = await makeSignature(payload, now, PEY_SECRET);

      const res = await app.request('/webhooks/pey', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Pey-Signature': sig,
          'X-Pey-Timestamp': now
        },
        body: payload
      }, env);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.received).toBe(true);
      expect(body.duplicate).toBe(false);

      // Pago actualizado
      const payment = mockDb.payments.find(p => p.id === 'pay-tq-001');
      expect(payment.status).toBe('PAID');
      expect(payment.transaction_id).toBe('txn-banxico-998877');

      // Exactamente 1 asiento contable
      expect(mockDb.ledger).toHaveLength(1);
      expect(mockDb.ledger[0].payment_id).toBe('pay-tq-001');
      expect(mockDb.ledger[0].amount).toBe(101);
    });

    it('segundo envío del MISMO webhook (duplicado) devuelve 200 con duplicate:true sin crear segundo asiento contable', async () => {
      const now = String(Math.floor(Date.now() / 1000));
      const payload = JSON.stringify({
        event: 'payment.confirmed',
        transactionId: 'txn-banxico-998877',
        payableId: 'qr-tq-1',
        amount: 101,
        paymentMethod: 'CODI'
      });
      const sig = await makeSignature(payload, now, PEY_SECRET);

      // Primer envío (procesado)
      const res1 = await app.request('/webhooks/pey', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Pey-Signature': sig,
          'X-Pey-Timestamp': now
        },
        body: payload
      }, env);
      expect(res1.status).toBe(200);
      expect(mockDb.ledger).toHaveLength(1);

      // Segundo envío idéntico (simulación de reintento de Pey)
      const res2 = await app.request('/webhooks/pey', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Pey-Signature': sig,
          'X-Pey-Timestamp': now
        },
        body: payload
      }, env);

      expect(res2.status).toBe(200);
      const body2 = await res2.json();
      expect(body2.received).toBe(true);
      expect(body2.duplicate).toBe(true);
      expect(body2.message).toContain('idempotente');

      // Garantía absoluta: sigue habiendo exactamente 1 asiento contable
      expect(mockDb.ledger).toHaveLength(1);
    });

    it('webhook para un pago que ya estaba PAID no genera segundo asiento en ledger_entries', async () => {
      // pay-tq-002 ya está PAID desde el seed
      const alreadyPaid = mockDb.payments.find(p => p.id === 'pay-tq-002');
      expect(alreadyPaid.status).toBe('PAID');

      const now = String(Math.floor(Date.now() / 1000));
      const payload = JSON.stringify({
        event: 'payment.confirmed',
        transactionId: 'txn-new-attempt',
        payableId: 'qr-tq-2',
        amount: 102,
        paymentMethod: 'CODI'
      });
      const sig = await makeSignature(payload, now, PEY_SECRET);

      const res = await app.request('/webhooks/pey', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Pey-Signature': sig,
          'X-Pey-Timestamp': now
        },
        body: payload
      }, env);

      expect(res.status).toBe(200);
      // No debe agregar entrada en ledger
      expect(mockDb.ledger).toHaveLength(0);
    });
  });
});
