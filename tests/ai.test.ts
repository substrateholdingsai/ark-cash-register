import { describe, it, expect, beforeEach, vi } from 'vitest';
import app from '../src/index';
import { Env } from '../src/types';

class MockD1PreparedStatement {
  private query: string;
  private params: any[];
  private db: MockD1Database;

  constructor(query: string, db: MockD1Database, params: any[] = []) {
    this.query = query;
    this.db = db;
    this.params = params;
  }
  bind(...params: any[]) { return new MockD1PreparedStatement(this.query, this.db, params); }
  async first<T = any>(): Promise<T | null> {
    const res = await this.all<T>();
    return res.results[0] || null;
  }
  async all<T = any>(): Promise<{ results: T[] }> {
    const q = this.query.trim().toUpperCase();
    if (q.includes('FROM MERCHANTS')) {
      const id = this.params[0];
      const m = this.db.merchants.find((x: any) => x.id === id);
      return { results: m ? [m as any] : [] };
    }
    if (q.includes('FROM PAYMENTS')) {
      return { results: this.db.payments as any };
    }
    return { results: [] };
  }
  async run() { return { success: true }; }
}

class MockD1Database {
  merchants: any[] = [];
  payments: any[] = [];
  prepare(query: string) { return new MockD1PreparedStatement(query, this); }
}

describe('Workers AI (/api/ai/*)', () => {
  let mockDb: MockD1Database;
  let env: Env;

  beforeEach(() => {
    mockDb = new MockD1Database();
    mockDb.merchants = [{ id: 'M1', alias: 'Tienda', name: 'Tienda SA', codi_status: 'ACTIVE', created_at: 1, updated_at: 1 }];
    mockDb.payments = [{ id: 'P1', merchant_id: 'M1', amount: 100, concept: 'Venta', status: 'PAID', payment_method: 'CODI', date_created: Math.floor(Date.now()/1000), date_paid: Math.floor(Date.now()/1000) }];
    env = {
      DB: mockDb as any,
      KV: undefined,
      AI: { run: vi.fn().mockResolvedValue({ response: 'Resumen OK' }) } as any,
      PEY_API_URL: 'https://api.pey.mx',
      ENVIRONMENT: 'development'
    };
  });

  it('genera resumen de corte con IA', async () => {
    const res = await app.request('/api/ai/close-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ merchantId: 'M1' })
    }, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary).toBe('Resumen OK');
  });

  it('sugiere clave SAT', async () => {
    const res = await app.request('/api/ai/suggest-sat-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Tacos' })
    }, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.suggestion).toBe('Resumen OK');
  });

  it('falla si AI no configurado', async () => {
    env.AI = undefined;
    const res = await app.request('/api/ai/suggest-sat-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Tacos' })
    }, env);
    expect(res.status).toBe(503);
  });
});
