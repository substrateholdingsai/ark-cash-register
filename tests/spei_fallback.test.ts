import { describe, it, expect, beforeEach, vi } from 'vitest';
import app from '../src/index';
import { Env, CODI_MAX_MXN } from '../src/types';
import { PeyClient } from '../src/services/peyClient';
import { signJwt } from '../src/utils/crypto';

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
    const q = this.query.trim().toUpperCase().replace(/\s+/g, ' ');

    if (q.includes('FROM USERS')) {
      if (q.includes('WHERE ID = ?')) {
        const id = this.params[0];
        const u = this.db.users.find(item => item.id === id);
        return { results: u ? [u as any] : [] };
      }
      return { results: this.db.users as any };
    }

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
      if (q.includes('WHERE ID = ? AND MERCHANT_ID = ?')) {
        const [pId, mId] = this.params;
        const p = this.db.payments.find(item => item.id === pId && item.merchant_id === mId);
        return { results: p ? [p as any] : [] };
      }
      if (q.includes('WHERE PAYABLE_ID = ? OR ID = ?')) {
        const id = this.params[0];
        const p = this.db.payments.find(item => item.id === id || item.payable_id === id);
        return { results: p ? [p as any] : [] };
      }
      if (q.includes('WHERE ID = ?')) {
        const id = this.params[0];
        const p = this.db.payments.find(item => item.id === id);
        return { results: p ? [p as any] : [] };
      }
      if (q.includes('WHERE MERCHANT_ID = ?')) {
        const mId = this.params[0];
        const rows = this.db.payments.filter(item => item.merchant_id === mId);
        return { results: rows as any };
      }
      return { results: this.db.payments as any };
    }

    if (q.includes('FROM LEDGER_ENTRIES')) {
      return { results: this.db.ledger as any };
    }

    if (q.includes('FROM OPERATOR_AUDIT_LOG')) {
      return { results: this.db.auditLogs as any };
    }

    return { results: [] };
  }

  async run(): Promise<{ success: boolean; meta?: any }> {
    const q = this.query.trim().toUpperCase().replace(/\s+/g, ' ');

    if (q.includes('INSERT INTO PAYMENTS')) {
      if (this.params.length === 8) {
        const [id, merchant_id, payable_id, amount, concept, num_ref, date_created, metadata] = this.params;
        this.db.payments.push({
          id,
          merchant_id,
          payable_type: 'SPEI_TRANSFER',
          payable_id,
          amount,
          concept,
          num_ref,
          status: 'PENDING_SPEI',
          payment_method: 'SPEI',
          date_created,
          metadata
        });
      } else {
        const [id, merchant_id, payable_id, amount, concept, num_ref, qr_string, date_created, metadata] = this.params;
        this.db.payments.push({
          id,
          merchant_id,
          payable_type: 'CODI_QR',
          payable_id,
          amount,
          concept,
          num_ref,
          qr_string,
          status: 'WAITING',
          payment_method: 'CODI',
          date_created,
          metadata
        });
      }
      return { success: true };
    }

    if (q.includes('UPDATE PAYMENTS SET STATUS =')) {
      const [now, transactionId, paymentId] = this.params;
      const p = this.db.payments.find(item => item.id === paymentId);
      if (p) {
        p.status = 'PAID';
        p.date_paid = now;
        p.transaction_id = transactionId;
      }
      return { success: true, meta: { changes: 1 } };
    }

    if (q.includes('INSERT INTO LEDGER_ENTRIES')) {
      const [id, merchant_id, payment_id, transaction_id, amount, concept, created_at] = this.params;
      this.db.ledger.push({
        id,
        merchant_id,
        payment_id,
        transaction_id,
        debit_account: 'BANCO_SPEI',
        credit_account: 'VENTAS_MOSTRADOR',
        amount,
        concept,
        created_at
      });
      return { success: true };
    }

    if (q.includes('INSERT INTO OPERATOR_AUDIT_LOG')) {
      const [id, operator, endpoint, merchant_id, payment_id, created_at] = this.params;
      this.db.auditLogs.push({
        id,
        operator,
        endpoint,
        merchant_id,
        payment_id,
        created_at
      });
      return { success: true };
    }

    return { success: true };
  }
}

class MockD1Database {
  users: any[] = [];
  merchants: any[] = [];
  payments: any[] = [];
  ledger: any[] = [];
  auditLogs: any[] = [];

  prepare(query: string) {
    return new MockD1PreparedStatement(query, this);
  }
}

describe('Fallback SPEI para Montos Altos (> $8,000 MXN)', () => {
  let mockDb: MockD1Database;
  let env: Env;
  const JWT_SECRET = 'supersecretjwtkeythatislongenoughfor32bytes!!';

  const MERCHANT_TAQUERIA = {
    id: '01JBAVWE4NS5TGXHWGMX3KH23Q',
    alias: 'Taquería El Güero',
    name: 'Taquería El Güero S.A. de C.V.',
    clabe: '012180001234567899', // BBVA México (012)
    entity: 'BUSINESS',
    tax_id: 'XAXX010101000',
    codi_status: 'ACTIVE',
    created_at: 1731000000,
    updated_at: 1731000000
  };

  const MERCHANT_SKINLAB = {
    id: '01JBAVSKINLAB0000000000000',
    alias: 'SkinLab Clothing Club',
    name: 'SkinLab Streetwear S.A.P.I. de C.V.',
    clabe: '072180001234567890', // Banorte (072)
    entity: 'BUSINESS',
    tax_id: 'XAXX010101001',
    codi_status: 'ACTIVE',
    created_at: 1731000000,
    updated_at: 1731000000
  };

  beforeEach(() => {
    mockDb = new MockD1Database();
    mockDb.merchants = [MERCHANT_TAQUERIA, MERCHANT_SKINLAB];
    mockDb.users = [
      {
        id: 'user_taqueria_1',
        email: 'cajero@taqueriaelguero.mx',
        role: 'merchant',
        display_name: 'Cajero Güero',
        email_verified: 1,
        status: 'active',
        merchant_id: MERCHANT_TAQUERIA.id,
        password_updated_at: 0
      },
      {
        id: 'user_skinlab_1',
        email: 'admin@skinlab.mx',
        role: 'merchant',
        display_name: 'Admin SkinLab',
        email_verified: 1,
        status: 'active',
        merchant_id: MERCHANT_SKINLAB.id,
        password_updated_at: 0
      }
    ];

    env = {
      DB: mockDb as any,
      KV: null as any,
      PEY_API_URL: 'https://api.pey.mx',
      PEY_API_KEY: 'test_pey_key',
      AUTH_JWT_SECRET: JWT_SECRET,
      ENVIRONMENT: 'test',
      CAJA_STAYPUFT_API_KEY: 'test_staypuft_key'
    };

    vi.spyOn(PeyClient.prototype, 'createCodiQr').mockResolvedValue({
      id: 'IDC_MOCK_VALID',
      qrString: '{"TYP":1,"v":"01","IDC":"IDC_MOCK_VALID","m":8000}'
    } as any);
  });

  describe('1. Umbral CoDi vs SPEI en Backend (CODI_MAX_MXN = 8000)', () => {
    it('total exacto $8,000.00 MXN genera QR CoDi sin error', async () => {
      const res = await app.request('/api/codi/qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: 8000.00,
          merchantId: MERCHANT_TAQUERIA.id
        })
      }, env);

      expect(res.status).toBe(201);
      const data: any = await res.json();
      expect(data.success).toBe(true);
      expect(data.amount).toBe(8000.00);
      expect(data).toHaveProperty('qrString');
    });

    it('total $8,001.00 MXN es RECHAZADO para CoDi QR con HTTP 400', async () => {
      const res = await app.request('/api/codi/qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: 8001.00,
          merchantId: MERCHANT_TAQUERIA.id
        })
      }, env);

      expect(res.status).toBe(400);
      const data: any = await res.json();
      expect(data.error.type).toBe('AMOUNT_EXCEEDS_CODI_LIMIT');
      expect(data.error.maxAllowed).toBe(CODI_MAX_MXN);
      expect(data.error.message).toContain('excede el límite');
    });

    it('total alto de un coche ($150,000.00 MXN) es rechazado en CoDi', async () => {
      const res = await app.request('/api/codi/qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: 150000.00,
          merchantId: MERCHANT_TAQUERIA.id
        })
      }, env);

      expect(res.status).toBe(400);
      const data: any = await res.json();
      expect(data.error.type).toBe('AMOUNT_EXCEEDS_CODI_LIMIT');
    });
  });

  describe('2. Creación de Orden SPEI en Checkout (/api/merchant/:id/spei-order)', () => {
    it('total $8,001.00 genera orden SPEI con estado PENDING_SPEI y datos completos', async () => {
      const res = await app.request(`/api/merchant/${MERCHANT_TAQUERIA.id}/spei-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: 8001.00,
          customer: 'Carlos Slim',
          notes: 'Facturar al RFC'
        })
      }, env);

      expect(res.status).toBe(201);
      const data: any = await res.json();
      expect(data.success).toBe(true);
      expect(data.status).toBe('PENDING_SPEI');
      expect(data.amount).toBe(8001.00);
      expect(data.clabe).toBe(MERCHANT_TAQUERIA.clabe);
      expect(data.clabe.length).toBe(18);
      expect(data.bank).toBe('BBVA México');
      expect(data.beneficiary).toBe(MERCHANT_TAQUERIA.name);
      expect(data.instructions).toContain('Abre la app de tu banco, elige transferencia SPEI');

      // Verificar persistencia en MockDB
      const saved = mockDb.payments.find(p => p.id === data.paymentId);
      expect(saved).toBeDefined();
      expect(saved.status).toBe('PENDING_SPEI');
      expect(saved.payable_type).toBe('SPEI_TRANSFER');
      expect(saved.payment_method).toBe('SPEI');
      expect(saved.amount).toBe(8001.00);
    });

    it('total de un coche ($150,000.00 MXN) genera orden SPEI con folio y beneficiario exacto', async () => {
      const res = await app.request(`/api/merchant/${MERCHANT_SKINLAB.id}/spei-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: 150000.00,
          customer: 'Comprador Mayorista'
        })
      }, env);

      expect(res.status).toBe(201);
      const data: any = await res.json();
      expect(data.success).toBe(true);
      expect(data.amount).toBe(150000.00);
      expect(data.clabe).toBe(MERCHANT_SKINLAB.clabe);
      expect(data.bank).toBe('Banorte');
      expect(data.beneficiary).toBe(MERCHANT_SKINLAB.name);
      expect(data.folio).toBeDefined();
      expect(data.status).toBe('PENDING_SPEI');
    });

    it('falla con 404 si el merchant no existe', async () => {
      const res = await app.request('/api/merchant/INEXISTENTE99999999999999/spei-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 9000.00 })
      }, env);

      expect(res.status).toBe(404);
      const data: any = await res.json();
      expect(data.error.type).toBe('MERCHANT_NOT_FOUND');
    });

    it('aislamiento estricto: el checkout de SkinLab jamás devuelve la CLABE de Taquería', async () => {
      const resSkin = await app.request(`/api/merchant/${MERCHANT_SKINLAB.id}/spei-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 12000.00 })
      }, env);

      const dataSkin: any = await resSkin.json();
      expect(dataSkin.clabe).toBe(MERCHANT_SKINLAB.clabe);
      expect(dataSkin.clabe).not.toBe(MERCHANT_TAQUERIA.clabe);
      expect(dataSkin.beneficiary).toBe(MERCHANT_SKINLAB.name);
    });
  });

  describe('3. Inmutabilidad y Confirmación Manual Estricta (No automática)', () => {
    let speiPaymentId: string;

    beforeEach(async () => {
      const res = await app.request(`/api/merchant/${MERCHANT_TAQUERIA.id}/spei-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 9500.00 })
      }, env);
      const data: any = await res.json();
      speiPaymentId = data.paymentId;
    });

    it('el pedido SPEI permanece en PENDING_SPEI y nunca pasa a PAID solo', async () => {
      const checkRes = await app.request(`/api/payment/codi/status/${speiPaymentId}`, {
        method: 'GET'
      }, env);

      // Si se consulta en endpoints CoDi, no debe aparecer como PAID
      const data: any = await checkRes.json();
      expect(data.status).not.toBe('PAID');

      // En la base de datos sigue PENDING_SPEI
      const p = mockDb.payments.find(item => item.id === speiPaymentId);
      expect(p.status).toBe('PENDING_SPEI');
    });

    it('confirmar pago SPEI sin autenticación de merchant es RECHAZADO con 401', async () => {
      const res = await app.request(`/api/merchant/${MERCHANT_TAQUERIA.id}/payments/${speiPaymentId}/confirm-spei`, {
        method: 'POST'
      }, env);

      expect(res.status).toBe(401);
    });

    it('merchant no puede confirmar pagos de otro merchant (403 Forbidden)', async () => {
      const now = Math.floor(Date.now() / 1000);
      const tokenSkinLab = await signJwt({
        sub: 'user_skinlab_1',
        role: 'merchant',
        merchantId: MERCHANT_SKINLAB.id,
        iat: now,
        exp: now + 3600
      }, JWT_SECRET);

      const res = await app.request(`/api/merchant/${MERCHANT_TAQUERIA.id}/payments/${speiPaymentId}/confirm-spei`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tokenSkinLab}` }
      }, env);

      expect(res.status).toBe(403);
      const data: any = await res.json();
      expect(data.error.type).toBe('FORBIDDEN');
    });

    it('merchant legítimo autenticado confirma el SPEI: pasa a PAID, crea asiento en ledger y audit log', async () => {
      const now = Math.floor(Date.now() / 1000);
      const tokenTaqueria = await signJwt({
        sub: 'user_taqueria_1',
        email: 'cajero@taqueriaelguero.mx',
        role: 'merchant',
        merchantId: MERCHANT_TAQUERIA.id,
        iat: now,
        exp: now + 3600
      }, JWT_SECRET);

      const res = await app.request(`/api/merchant/${MERCHANT_TAQUERIA.id}/payments/${speiPaymentId}/confirm-spei`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tokenTaqueria}` }
      }, env);

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.success).toBe(true);
      expect(data.status).toBe('PAID');
      expect(data.transactionId).toContain('TX_SPEI_');
      expect(data.confirmedBy).toBe('cajero@taqueriaelguero.mx');

      // 1. Estado en BD pasó a PAID
      const p = mockDb.payments.find(item => item.id === speiPaymentId);
      expect(p.status).toBe('PAID');
      expect(p.transaction_id).toBe(data.transactionId);

      // 2. Asiento contable registrado en ledger_entries
      const entry = mockDb.ledger.find(l => l.payment_id === speiPaymentId);
      expect(entry).toBeDefined();
      expect(entry.merchant_id).toBe(MERCHANT_TAQUERIA.id);
      expect(entry.amount).toBe(9500.00);
      expect(entry.debit_account).toBe('BANCO_SPEI');
      expect(entry.credit_account).toBe('VENTAS_MOSTRADOR');

      // 3. Registro inmutable en operator_audit_log
      const audit = mockDb.auditLogs.find(a => a.payment_id === speiPaymentId);
      expect(audit).toBeDefined();
      expect(audit.operator).toBe('cajero@taqueriaelguero.mx');
    });

    it('intentar reconfirmar un pago SPEI ya pagado rechaza con 400 PAYMENT_ALREADY_PAID', async () => {
      const now = Math.floor(Date.now() / 1000);
      const tokenTaqueria = await signJwt({
        sub: 'user_taqueria_1',
        email: 'cajero@taqueriaelguero.mx',
        role: 'merchant',
        merchantId: MERCHANT_TAQUERIA.id,
        iat: now,
        exp: now + 3600
      }, JWT_SECRET);

      // Primera confirmación
      await app.request(`/api/merchant/${MERCHANT_TAQUERIA.id}/payments/${speiPaymentId}/confirm-spei`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tokenTaqueria}` }
      }, env);

      // Segunda confirmación
      const res2 = await app.request(`/api/merchant/${MERCHANT_TAQUERIA.id}/payments/${speiPaymentId}/confirm-spei`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tokenTaqueria}` }
      }, env);

      expect(res2.status).toBe(400);
      const data2: any = await res2.json();
      expect(data2.error.type).toBe('PAYMENT_ALREADY_PAID');
    });
  });

  describe('4. Seguridad y Aislamiento en Conector StayPuft', () => {
    it('en StayPuft connector (/api/internal/merchants) la CLABE permanece estrictamente enmascarada', async () => {
      const res = await app.request('/api/internal/merchants', {
        method: 'GET',
        headers: { 'X-StayPuft-Key': env.CAJA_STAYPUFT_API_KEY! }
      }, env);

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.merchants.length).toBeGreaterThan(0);
      for (const m of data.merchants) {
        expect(m.maskedClabe).toMatch(/^\*{14}\d{4}$/);
        expect(m.clabe).toBeUndefined();
      }
    });
  });
});
