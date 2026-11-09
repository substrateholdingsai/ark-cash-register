import { describe, it, expect, beforeEach } from 'vitest';
import app from '../src/index';
import { Env, SOLANA_USDC_MINT, SOLANA_USDT_MINT, UMA_DIARIA_2026_MXN, LFPIORPI_UMBRAL_AVISO_UMA } from '../src/types';
import { validateSolanaAddress, generateSolanaReference, buildSolanaPayUrl } from '../src/utils/solana';
import { evaluadorActividadesVulnerables } from '../src/services/lfpiorpi';
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

    if (q.includes('FROM MERCHANTS')) {
      if (q.includes('WHERE ID = ?')) {
        const id = this.params[0];
        const m = this.db.merchants.find(item => item.id === id);
        return { results: m ? [m as any] : [] };
      }
      return { results: this.db.merchants as any };
    }

    if (q.includes('FROM PAYMENTS')) {
      if (q.includes('SUM(') && q.includes('DATE_CREATED >=')) {
        // Query de acumulación LFPIORPI semestral móvil
        const [mId, cust1, cust2, cust3, since] = this.params;
        const matching = this.db.payments.filter(p => 
          p.merchant_id === mId &&
          p.status === 'PAID' &&
          p.date_created >= since &&
          (p.customer === cust1 || p.customer === cust2 || p.customer_rfc === cust3)
        );
        const totalMxn = matching.reduce((sum, p) => sum + (p.currency === 'MXN' ? p.amount : (p.amount_mxn_equiv || p.amount * 20)), 0);
        return { results: [{ count: matching.length, total_mxn: totalMxn } as any] };
      }

      if (q.includes('WHERE ID = ? OR SOLANA_REFERENCE = ?') || q.includes('WHERE ID = ? OR PAYABLE_ID = ? OR SOLANA_REFERENCE = ?')) {
        const target = this.params[0];
        const p = this.db.payments.find(item => item.id === target || item.solana_reference === target || item.payable_id === target);
        return { results: p ? [p as any] : [] };
      }

      if (q.includes('WHERE ID = ?')) {
        const id = this.params[0];
        const p = this.db.payments.find(item => item.id === id);
        return { results: p ? [p as any] : [] };
      }

      return { results: this.db.payments as any };
    }

    if (q.includes('FROM LFPIORPI_EVALUACIONES')) {
      return { results: this.db.evaluaciones as any };
    }

    if (q.includes('FROM LEDGER_ENTRIES')) {
      return { results: this.db.ledger as any };
    }

    return { results: [] };
  }

  async run(): Promise<{ success: boolean; meta?: any }> {
    const q = this.query.trim().toUpperCase().replace(/\s+/g, ' ');

    if (q.includes('INSERT INTO PAYMENTS')) {
      const [id, merchant_id, payable_id, amount, concept, num_ref, qr_string, rail, currency, amount_mxn_equiv, fx_rate, now, reference, customer_rfc, date_created, metadata] = this.params;
      this.db.payments.push({
        id,
        merchant_id,
        payable_id,
        amount,
        concept,
        num_ref,
        qr_string,
        payment_rail: rail,
        currency,
        amount_mxn_equiv,
        fx_rate,
        solana_reference: reference,
        customer_rfc,
        status: 'WAITING',
        date_created,
        metadata,
        customer: JSON.parse(metadata || '{}').customer
      });
      return { success: true };
    }

    if (q.includes('UPDATE PAYMENTS SET STATUS =')) {
      const p = this.db.payments[this.db.payments.length - 1];
      if (p) {
        if (this.params[0] === 'MANUAL_REVIEW') {
          p.status = 'MANUAL_REVIEW';
          p.solana_signature = this.params[1];
        } else {
          p.status = 'PAID';
          p.date_paid = this.params[0];
          p.transaction_id = this.params[1];
          p.solana_signature = this.params[2];
        }
      }
      return { success: true };
    }

    if (q.includes('INSERT INTO LEDGER_ENTRIES')) {
      const [id, merchant_id, payment_id, transaction_id, amount, concept, created_at] = this.params;
      this.db.ledger.push({
        id,
        merchant_id,
        payment_id,
        transaction_id,
        amount,
        concept,
        created_at
      });
      return { success: true };
    }

    if (q.includes('INSERT INTO LFPIORPI_EVALUACIONES')) {
      const [id, merchant_id, customer_id, customer_rfc, window_start, window_end, total_transactions, accumulated_mxn, accumulated_uma, level, requires_kyc, requires_notice, dictamen_hash, created_at] = this.params;
      this.db.evaluaciones.push({
        id,
        merchant_id,
        customer_id,
        customer_rfc,
        window_start,
        window_end,
        total_transactions,
        accumulated_mxn,
        accumulated_uma,
        level,
        requires_kyc,
        requires_notice,
        dictamen_hash,
        created_at
      });
      return { success: true };
    }

    if (q.includes('UPDATE MERCHANTS SET SOLANA_WALLET =')) {
      const [wallet, enabled, offramp, updated_at, id] = this.params;
      const m = this.db.merchants.find(item => item.id === id);
      if (m) {
        m.solana_wallet = wallet;
        m.solana_pay_enabled = enabled;
        m.offramp_provider = offramp;
      }
      return { success: true };
    }

    return { success: true };
  }
}

class MockD1Database {
  merchants: any[] = [];
  payments: any[] = [];
  evaluaciones: any[] = [];
  ledger: any[] = [];

  prepare(query: string) {
    return new MockD1PreparedStatement(query, this);
  }
}

describe('Dólares Digitales (Solana Pay USDC/USDT) + Compliance LFPIORPI', () => {
  let mockDb: MockD1Database;
  let env: Env;
  const STAYPUFT_KEY = 'valid_staypuft_key_for_internal';
  const VALID_SOLANA_WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'; // 44 chars Base58

  const MERCHANT_WITH_SOLANA = {
    id: '01JBAVSKINLAB0000000000000',
    alias: 'SkinLab Clothing Club',
    name: 'SkinLab Streetwear S.A.P.I. de C.V.',
    clabe: '072180001234567890',
    entity: 'BUSINESS',
    solana_wallet: VALID_SOLANA_WALLET,
    solana_pay_enabled: 1,
    offramp_provider: 'itf_autorizada' // Proveedor regulado
  };

  const MERCHANT_WITHOUT_SOLANA = {
    id: '01JBAVWE4NS5TGXHWGMX3KH23Q',
    alias: 'Taquería El Güero',
    name: 'Taquería El Güero S.A. de C.V.',
    clabe: '012180001234567899',
    entity: 'BUSINESS',
    solana_wallet: null,
    solana_pay_enabled: 0,
    offramp_provider: null
  };

  beforeEach(() => {
    mockDb = new MockD1Database();
    mockDb.merchants = [MERCHANT_WITH_SOLANA, MERCHANT_WITHOUT_SOLANA];

    env = {
      DB: mockDb as any,
      KV: null as any,
      PEY_API_URL: 'https://api.pey.mx',
      CAJA_STAYPUFT_API_KEY: STAYPUFT_KEY,
      AUTH_JWT_SECRET: 'supersecretjwtkeythatislongenoughfor32bytes!!',
      ENVIRONMENT: 'test'
    };
  });

  describe('1. Validación de Wallet Solana (Base58 estricto)', () => {
    it('acepta direcciones Solana válidas de 32 a 44 caracteres en Base58', () => {
      const res = validateSolanaAddress('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');
      expect(res.valid).toBe(true);
      expect(res.error).toBeUndefined();
    });

    it('rechaza direcciones que contienen caracteres prohibidos de Base58 (0, O, I, l)', () => {
      expect(validateSolanaAddress('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAW0M').valid).toBe(false); // contiene 0
      expect(validateSolanaAddress('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWOM').valid).toBe(false); // contiene O
      expect(validateSolanaAddress('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWIM').valid).toBe(false); // contiene I
      expect(validateSolanaAddress('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWlM').valid).toBe(false); // contiene l
    });

    it('rechaza direcciones con longitud fuera de rango (<32 o >44)', () => {
      expect(validateSolanaAddress('DemasiadoCorta').valid).toBe(false);
      expect(validateSolanaAddress('DemasiadoLarga1111111111111111111111111111111111111111111111111111111111').valid).toBe(false);
    });
  });

  describe('2. Generación de Cobros Solana Pay (USDC y USDT)', () => {
    it('genera QR Solana Pay con USDC, mint oficial, monto y referencia única', async () => {
      const res = await app.request('/api/solana/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantId: MERCHANT_WITH_SOLANA.id,
          amount: 25.50,
          currency: 'USDC',
          customer: 'Cliente Solana'
        })
      }, env);

      expect(res.status).toBe(201);
      const data: any = await res.json();
      expect(data.success).toBe(true);
      expect(data.currency).toBe('USDC');
      expect(data.mint).toBe(SOLANA_USDC_MINT);
      expect(data.amount).toBe(25.50);
      expect(data.recipient).toBe(VALID_SOLANA_WALLET);
      expect(data.reference).toBeDefined();
      expect(data.solanaPayUrl).toContain(`solana:${VALID_SOLANA_WALLET}`);
      expect(data.solanaPayUrl).toContain(`spl-token=${SOLANA_USDC_MINT}`);
      expect(data.solanaPayUrl).toContain('amount=25.5');
      expect(data.solanaPayUrl).toContain(`reference=${data.reference}`);
    });

    it('genera QR Solana Pay con USDT y mint oficial de USDT en Solana', async () => {
      const res = await app.request('/api/solana/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantId: MERCHANT_WITH_SOLANA.id,
          amount: 100.00,
          currency: 'USDT',
          customer: 'Cliente USDT'
        })
      }, env);

      expect(res.status).toBe(201);
      const data: any = await res.json();
      expect(data.success).toBe(true);
      expect(data.currency).toBe('USDT');
      expect(data.mint).toBe(SOLANA_USDT_MINT);
      expect(data.solanaPayUrl).toContain(`spl-token=${SOLANA_USDT_MINT}`);
    });

    it('rechaza la orden si el merchant no tiene wallet Solana configurada (400)', async () => {
      const res = await app.request('/api/solana/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantId: MERCHANT_WITHOUT_SOLANA.id,
          amount: 20.00,
          currency: 'USDC'
        })
      }, env);

      expect(res.status).toBe(400);
      const data: any = await res.json();
      expect(data.error.type).toBe('SOLANA_WALLET_NOT_CONFIGURED');
    });

    it('genera referencias únicas por orden (nunca reutilizadas)', () => {
      const ref1 = generateSolanaReference();
      const ref2 = generateSolanaReference();
      expect(ref1).not.toBe(ref2);
      expect(ref1.length).toBeGreaterThanOrEqual(32);
    });
  });

  describe('3. Confirmación en Cadena y Manejo de Inconsistencias', () => {
    it('marca PAID cuando la firma de transacción en cadena es válida y el monto coincide', async () => {
      // 1. Crear orden
      const orderRes = await app.request('/api/solana/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantId: MERCHANT_WITH_SOLANA.id,
          amount: 50.00,
          currency: 'USDC'
        })
      }, env);
      const orderData: any = await orderRes.json();

      // 2. Confirmar transacción
      const confirmRes = await app.request('/api/solana/confirm-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentId: orderData.paymentId,
          signature: '5VERiFiED_SoLANa_SiGNAtuRE_In_BLoCKCHAiN_111111111111111111111111111111111111111111111111',
          confirmedAmount: 50.00
        })
      }, env);

      expect(confirmRes.status).toBe(200);
      const confirmData: any = await confirmRes.json();
      expect(confirmData.success).toBe(true);
      expect(confirmData.status).toBe('PAID');

      // Asiento en Ledger
      expect(mockDb.ledger.length).toBeGreaterThan(0);
      const lastEntry = mockDb.ledger[mockDb.ledger.length - 1];
      expect(lastEntry.amount).toBe(50.00);
    });

    it('si el monto recibido en cadena difiere del pactado pasa a MANUAL_REVIEW, nunca a PAID', async () => {
      const orderRes = await app.request('/api/solana/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantId: MERCHANT_WITH_SOLANA.id,
          amount: 100.00,
          currency: 'USDC'
        })
      }, env);
      const orderData: any = await orderRes.json();

      const confirmRes = await app.request('/api/solana/confirm-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentId: orderData.paymentId,
          signature: '5SoLANa_Tx_With_Wrong_Amount_111111111111111111111111111111111111111111111111111111111',
          confirmedAmount: 80.00 // Pagó de menos
        })
      }, env);

      expect(confirmRes.status).toBe(400);
      const confirmData: any = await confirmRes.json();
      expect(confirmData.status).toBe('MANUAL_REVIEW');
    });
  });

  describe('4. Evaluador LFPIORPI — Acumulado Semestral Móvil y Dictamen SHA-256', () => {
    it('clasifica Verde para montos menores al 70% del umbral de Aviso', async () => {
      const dictamen = await evaluadorActividadesVulnerables({
        merchantId: MERCHANT_WITH_SOLANA.id,
        customerId: 'Cliente_Pequeno',
        currentAmountMxn: 2000.00, // ~17.6 UMA (muy por debajo de 147 UMA)
        db: mockDb
      });

      expect(dictamen.level).toBe('VERDE');
      expect(dictamen.requiresKyc).toBe(false);
      expect(dictamen.requiresNotice).toBe(false);
      expect(dictamen.dictamenHash).toMatch(/^[0-9a-f]{64}$/); // SHA-256 válido
    });

    it('requiere identificación KYC (RFC/CURP) al superar el 70% del umbral (147 UMA)', async () => {
      // 147 UMA * 113.14 MXN = $16,631.58 MXN
      const dictamen = await evaluadorActividadesVulnerables({
        merchantId: MERCHANT_WITH_SOLANA.id,
        customerId: 'Cliente_Medio',
        currentAmountMxn: 17000.00, // Supera 147 UMA
        db: mockDb
      });

      expect(dictamen.level).toBe('IDENTIFICACION');
      expect(dictamen.requiresKyc).toBe(true);
      expect(dictamen.requiresNotice).toBe(false);
      expect(dictamen.alertMessage).toContain('requiere integrar expediente de identificación');
    });

    it('dispara Aviso ante la UIF al alcanzar o superar 210 UMA y genera dictamen sellado con SHA-256', async () => {
      // 210 UMA * 113.14 MXN = $23,759.40 MXN
      const dictamen = await evaluadorActividadesVulnerables({
        merchantId: MERCHANT_WITH_SOLANA.id,
        customerId: 'Cliente_Alto',
        customerRfc: 'XAXX010101000',
        currentAmountMxn: 25000.00, // Supera 210 UMA
        db: mockDb
      });

      expect(dictamen.level).toBe('AVISO');
      expect(dictamen.requiresKyc).toBe(true);
      expect(dictamen.requiresNotice).toBe(true);
      expect(dictamen.alertMessage).toContain('requiere aviso ante la UIF');
      expect(dictamen.dictamenHash).toBeDefined();
      expect(dictamen.dictamenHash.length).toBe(64);
    });

    it('acumulado semestral móvil: múltiples compras chicas que sumadas superan 210 UMA detonan Aviso', async () => {
      const customer = 'Cliente_Frecuente_Acumulador';
      const now = Math.floor(Date.now() / 1000);

      // Simular 5 compras previas de $5,000 MXN en los últimos 3 meses = $25,000 MXN acumulados
      for (let i = 0; i < 5; i++) {
        mockDb.payments.push({
          id: `PAY_PREV_${i}`,
          merchant_id: MERCHANT_WITH_SOLANA.id,
          customer,
          amount: 5000.00,
          currency: 'MXN',
          status: 'PAID',
          date_created: now - (i * 10 * 86400) // días atrás
        });
      }

      // Nueva compra de $1,000 MXN -> Acumulado = $26,000 MXN (~229 UMA > 210 UMA)
      const dictamen = await evaluadorActividadesVulnerables({
        merchantId: MERCHANT_WITH_SOLANA.id,
        customerId: customer,
        currentAmountMxn: 1000.00,
        db: mockDb
      });

      expect(dictamen.accumulatedMxn).toBe(26000.00);
      expect(dictamen.accumulatedUma).toBeGreaterThanOrEqual(210);
      expect(dictamen.level).toBe('AVISO');
      expect(dictamen.requiresNotice).toBe(true);
    });
  });

  describe('5. Off-ramp Condicional y Servicio Compartido', () => {
    it('proveedor de off-ramp registrado es informado formalmente', async () => {
      const res = await app.request(`/api/solana/offramp-info/${MERCHANT_WITH_SOLANA.id}`, { method: 'GET' }, env);
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.available).toBe(true);
      expect(data.provider).toBe('itf_autorizada');
      expect(data.legalNotice).toBeDefined();
    });

    it('no se ofrece off-ramp si el proveedor no está formalmente registrado', async () => {
      const res = await app.request(`/api/solana/offramp-info/${MERCHANT_WITHOUT_SOLANA.id}`, { method: 'GET' }, env);
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.available).toBe(false);
      expect(data.reason).toContain('proveedor registrado');
    });

    it('servicio compartido: POST /api/internal/lfpiorpi/evaluar ejecuta dictamen vía StayPuft', async () => {
      const res = await app.request('/api/internal/lfpiorpi/evaluar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-StayPuft-Key': STAYPUFT_KEY
        },
        body: JSON.stringify({
          merchantId: MERCHANT_WITH_SOLANA.id,
          customerId: 'Cliente_Ark_Angel',
          currentAmountMxn: 26000.00
        })
      }, env);

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.success).toBe(true);
      expect(data.dictamen.level).toBe('AVISO');
      expect(data.dictamen.dictamenHash).toBeDefined();
    });
  });
});
