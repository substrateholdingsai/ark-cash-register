import { describe, it, expect, beforeEach, vi } from 'vitest';
import app from '../src/index';
import { Env } from '../src/types';
import { PeyClient } from '../src/services/peyClient';

// Mock de D1 Database en memoria para pruebas unitarias rápidas
class MockD1PreparedStatement {
  private query: string;
  private params: any[];
  private db: MockD1Database;

  constructor(query: string, db: MockD1Database, params: any[] = []) {
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

    if (q.includes('FROM MERCHANTS')) {
      if (q.includes('WHERE ID = ?')) {
        const id = this.params[0];
        const m = this.db.merchants.find(item => item.id === id);
        return { results: m ? [m as any] : [] };
      }
      if (q.includes('COUNT(*)')) {
        return { results: [{ count: this.db.merchants.length, total: this.db.merchants.length } as any] };
      }
      return { results: this.db.merchants as any };
    }

    if (q.includes('FROM PAYMENTS')) {
      if (q.includes('WHERE ID = ?') || q.includes('PAYABLE_ID = ?')) {
        const id = this.params[0];
        const p = this.db.payments.find(item => item.id === id || item.payable_id === id);
        return { results: p ? [p as any] : [] };
      }
      if (q.includes('COUNT(*)')) {
        return { results: [{ count: this.db.payments.length, total: this.db.payments.length, totalAmountPaid: 150, paidCount: 1, waitingCount: 0, expiredCount: 0 } as any] };
      }
      return { results: this.db.payments as any };
    }

    if (q.includes('FROM LEDGER_ENTRIES')) {
      if (q.includes('COUNT(*)')) {
        return { results: [{ total: this.db.ledger.length } as any] };
      }
      return { results: this.db.ledger as any };
    }

    if (q.includes('FROM WEBHOOK_EVENTS')) {
      if (q.includes('COUNT(*)')) {
        return { results: [{ total: this.db.webhooks.length, failedCount: 0 } as any] };
      }
      return { results: this.db.webhooks as any };
    }

    if (q.includes('FROM DAILY_CLOSES')) {
      if (q.includes('COUNT(*)')) {
        return { results: [{ total: this.db.closes.length } as any] };
      }
      return { results: this.db.closes as any };
    }

    return { results: [] };
  }

  async run(): Promise<{ success: boolean }> {
    const q = this.query.trim().toUpperCase();
    if (q.includes('INSERT INTO OPERATOR_AUDIT_LOG')) {
      this.db.auditLogs.push(this.params);
    }
    return { success: true };
  }
}

class MockD1Database {
  merchants: any[] = [];
  payments: any[] = [];
  ledger: any[] = [];
  webhooks: any[] = [];
  closes: any[] = [];
  auditLogs: any[] = [];

  prepare(query: string) {
    return new MockD1PreparedStatement(query, this);
  }
}

describe('StayPuft Internal Connector (/api/internal/*)', () => {
  let mockDb: MockD1Database;
  let env: Env;
  const VALID_STAYPUFT_KEY = 'test_staypuft_key_caja_12345';

  beforeEach(() => {
    mockDb = new MockD1Database();

    // Merchant seed
    mockDb.merchants = [
      {
        id: '01JBAVWE4NS5TGXHWGMX3KH23Q',
        alias: 'Taquería El Güero',
        name: 'Taquería El Güero S.A. de C.V.',
        clabe: '012180001234567899',
        entity: 'BUSINESS',
        tax_id: 'XAXX010101000',
        codi_status: 'ACTIVE',
        created_at: 1731000000,
        updated_at: 1731000000
      }
    ];

    mockDb.payments = [
      {
        id: 'PAY_001',
        merchant_id: '01JBAVWE4NS5TGXHWGMX3KH23Q',
        payable_type: 'CODI_QR',
        payable_id: 'IDC_001',
        amount: 150.00,
        concept: 'Tacos al pastor',
        num_ref: '123456',
        qr_string: '{"TYP":1,"v":"01","IDC":"IDC_001"}',
        status: 'PAID',
        transaction_id: 'TXN_001',
        payment_method: 'CODI',
        date_created: 1731000100,
        date_paid: 1731000200
      }
    ];

    env = {
      DB: mockDb as any,
      KV: {} as any,
      PEY_API_URL: 'https://api.pey.mx',
      PEY_API_KEY: 'test_pey_secret_key',
      PEY_WEBHOOK_SECRET: 'test_webhook_secret_hmac',
      CAJA_STAYPUFT_API_KEY: VALID_STAYPUFT_KEY,
      ENVIRONMENT: 'development',
      APP_VERSION: '2.0.0'
    };
  });

  // 1. Auth Fail-Closed
  it('debe rechazar llamadas sin X-StayPuft-Key con 401', async () => {
    const res = await app.request('/api/internal/status', {
      method: 'GET'
    }, env);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.type).toBe('UNAUTHORIZED');
  });

  it('debe rechazar llamadas con X-StayPuft-Key inválida con 401', async () => {
    const res = await app.request('/api/internal/status', {
      method: 'GET',
      headers: { 'X-StayPuft-Key': 'llave_totalmente_falsa' }
    }, env);

    expect(res.status).toBe(401);
  });

  it('debe permitir acceso con X-StayPuft-Key válida', async () => {
    const res = await app.request('/api/internal/status', {
      method: 'GET',
      headers: { 'X-StayPuft-Key': VALID_STAYPUFT_KEY }
    }, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.service).toBe('ark-cash-register');
    expect(body.bindings.d1Database).toBe(true);
  });

  // 2. Nunca exponer secretos de Pey
  it('nunca debe exponer secretos de Pey (PEY_API_KEY o PEY_WEBHOOK_SECRET) en responses', async () => {
    const res = await app.request('/api/internal/status', {
      method: 'GET',
      headers: { 'X-StayPuft-Key': VALID_STAYPUFT_KEY }
    }, env);

    const text = await res.text();
    expect(text).not.toContain('test_pey_secret_key');
    expect(text).not.toContain('test_webhook_secret_hmac');
    expect(text).not.toContain(VALID_STAYPUFT_KEY);
  });

  // 3. Enmascaramiento de CLABE (solo últimos 4 dígitos)
  it('debe enmascarar la CLABE en la lista de merchants (nunca los 18 dígitos)', async () => {
    const res = await app.request('/api/internal/merchants', {
      method: 'GET',
      headers: { 'X-StayPuft-Key': VALID_STAYPUFT_KEY }
    }, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.merchants).toHaveLength(1);
    expect(body.merchants[0].maskedClabe).toBe('**************7899');
    expect(JSON.stringify(body)).not.toContain('012180001234567899');
  });

  it('debe enmascarar la CLABE en el detalle del merchant', async () => {
    const res = await app.request('/api/internal/merchants/01JBAVWE4NS5TGXHWGMX3KH23Q', {
      method: 'GET',
      headers: { 'X-StayPuft-Key': VALID_STAYPUFT_KEY }
    }, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.maskedClabe).toBe('**************7899');
    expect(JSON.stringify(body)).not.toContain('012180001234567899');
  });

  // 4. Aislamiento y 404 en merchants inexistentes
  it('debe devolver 404 al consultar un merchant que no existe', async () => {
    const res = await app.request('/api/internal/merchants/MERCHANT_INEXISTENTE', {
      method: 'GET',
      headers: { 'X-StayPuft-Key': VALID_STAYPUFT_KEY }
    }, env);

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.type).toBe('NOT_FOUND');
  });

  it('debe devolver 404 al filtrar pagos por merchant inexistente', async () => {
    const res = await app.request('/api/internal/payments?merchant_id=NO_EXISTE', {
      method: 'GET',
      headers: { 'X-StayPuft-Key': VALID_STAYPUFT_KEY }
    }, env);

    expect(res.status).toBe(404);
  });

  // 5. Protección de cuotas D1 y paginación
  it('debe rechazar consultas con limit > 100 con 400 Bad Request', async () => {
    const res = await app.request('/api/internal/merchants?limit=150', {
      method: 'GET',
      headers: { 'X-StayPuft-Key': VALID_STAYPUFT_KEY }
    }, env);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain('100');
  });

  // 6. Lista de pagos NO incluye qrString completo
  it('la lista de pagos NO debe incluir el qrString completo para proteger ancho de banda y datos', async () => {
    const res = await app.request('/api/internal/payments', {
      method: 'GET',
      headers: { 'X-StayPuft-Key': VALID_STAYPUFT_KEY }
    }, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.payments[0].qrString).toBeUndefined();
    expect(body.payments[0].amount).toBe(150);
  });

  // 7. Auditoría
  it('debe registrar la llamada en operator_audit_log', async () => {
    await app.request('/api/internal/status', {
      method: 'GET',
      headers: { 'X-StayPuft-Key': VALID_STAYPUFT_KEY }
    }, env);

    expect(mockDb.auditLogs.length).toBeGreaterThan(0);
    const lastLog = mockDb.auditLogs[mockDb.auditLogs.length - 1];
    expect(lastLog[0]).toBeDefined(); // auditId (ULID)
    expect(lastLog[1]).toBe('/api/internal/status'); // endpoint
    expect(lastLog[2]).toBe('GET'); // method
  });

  // 8. Regla de Dinero Real: en producción, mock está prohibido
  it('PeyClient en producción prohíbe mocks y exige API Key real', async () => {
    const prodClient = new PeyClient('https://api.pey.mx', undefined, true);
    await expect(prodClient.createCodiQr({ amount: 100 })).rejects.toThrow(/Pey API Key is required in production/);
  });

  // 9. Webhook HMAC & Anti-Replay
  it('webhook debe rechazar peticiones con timestamp expirado (>300s) por anti-replay', async () => {
    const expiredTimestamp = String(Math.floor(Date.now() / 1000) - 600); // 10 minutos atrás
    const res = await app.request('/webhooks/pey', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Pey-Signature': 'fake_signature',
        'X-Pey-Timestamp': expiredTimestamp
      },
      body: JSON.stringify({ event: 'payment.confirmed' })
    }, env);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain('anti-replay');
  });

  it('webhook debe rechazar peticiones sin headers de firma cuando hay secreto configurado', async () => {
    const res = await app.request('/webhooks/pey', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ event: 'payment.confirmed' })
    }, env);

    expect(res.status).toBe(401);
  });
});
