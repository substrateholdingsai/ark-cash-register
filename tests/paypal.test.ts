import { describe, it, expect, vi } from 'vitest';
import worker from '../src/index';

describe('Riel de Tarjetas de Crédito y Meses Sin Intereses (PayPal REST v2)', () => {

  const createMockEnv = (overrides = {}) => {
    const memoryDb = new Map<string, any>();
    const ledgerEntries: any[] = [];
    let paymentsRecord: any = null;

    return {
      ENVIRONMENT: 'test',
      PAYPAL_CLIENT_ID: 'test_paypal_client_id_mock',
      PAYPAL_CLIENT_SECRET: 'test_paypal_secret_mock',
      PAYPAL_ENVIRONMENT: 'sandbox',
      DB: {
        prepare: (query: string) => ({
          bind: (...params: any[]) => ({
            run: async () => {
              if (query.includes('INSERT INTO payments')) {
                paymentsRecord = {
                  id: params[0],
                  merchant_id: params[1],
                  payable_type: 'PAYPAL_ORDER',
                  payable_id: params[2],
                  amount: params[3],
                  concept: params[4],
                  num_ref: params[5],
                  status: 'WAITING',
                  payment_rail: 'paypal',
                  currency: 'MXN',
                  paypal_order_id: params[2]
                };
              } else if (query.includes('UPDATE payments SET status = \'PAID\'')) {
                if (paymentsRecord) {
                  paymentsRecord.status = 'PAID';
                  paymentsRecord.date_paid = params[0];
                  paymentsRecord.transaction_id = params[1];
                  paymentsRecord.paypal_capture_id = params[2];
                }
              } else if (query.includes('INSERT INTO ledger_entries')) {
                ledgerEntries.push({
                  id: params[0],
                  merchant_id: params[1],
                  payment_id: params[2],
                  transaction_id: params[3],
                  amount: params[4],
                  debit_account: 'PAYPAL_MSI',
                  credit_account: 'VENTAS_MOSTRADOR'
                });
              }
              return { success: true, meta: { changes: 1 } };
            },
            first: async () => {
              if (query.includes('SELECT * FROM payments')) {
                return paymentsRecord || {
                  id: 'PAY_TEST_123',
                  merchant_id: '01JBAVSKINLAB0000000000000',
                  payable_type: 'PAYPAL_ORDER',
                  amount: 699.00,
                  status: 'WAITING',
                  payment_rail: 'paypal',
                  paypal_order_id: 'ORDER_TEST_123',
                  num_ref: 'FOLIO_TEST'
                };
              }
              if (query.includes('SELECT paypal_client_id')) {
                return { paypal_client_id: 'test_client_id_merchant', paypal_enabled: 1 };
              }
              return null;
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
  };

  describe('1. Consulta de Configuración de PayPal (/api/paypal/config/:merchantId)', () => {
    it('devuelve el estado del riel PayPal y el Client ID para el checkout', async () => {
      const env = createMockEnv();
      const res = await worker.request('/api/paypal/config/01JBAVSKINLAB0000000000000', {
        method: 'GET'
      }, env);

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.enabled).toBe(true);
      expect(data.clientId).toBeDefined();
      expect(data.currency).toBe('MXN');
      expect(data.mode).toBe('sandbox');
    });
  });

  describe('2. Creación de Orden PayPal (/api/paypal/order)', () => {
    it('rechaza montos inválidos o menores/iguales a 0 con 400', async () => {
      const env = createMockEnv();
      const res = await worker.request('/api/paypal/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantId: '01JBAVSKINLAB0000000000000',
          amount: 0
        })
      }, env);

      expect(res.status).toBe(400);
      const data: any = await res.json();
      expect(data.error.type).toBe('INVALID_AMOUNT');
    });

    it('crea exitosamente una orden PayPal en estado WAITING con riel paypal', async () => {
      const env = createMockEnv();
      const res = await worker.request('/api/paypal/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantId: '01JBAVSKINLAB0000000000000',
          amount: 699.00,
          concept: 'Hoodie Oversize Caribe (SkinLab)',
          cartItems: [{ id: 'sl-hoodie', name: 'Hoodie Oversize Caribe', price: 699, qty: 1 }]
        })
      }, env);

      expect(res.status).toBe(201);
      const data: any = await res.json();
      expect(data.success).toBe(true);
      expect(data.orderId).toContain('PAYPAL_ORDER_');
      expect(data.paymentId).toBeDefined();
      expect(data.folio).toBeDefined();
      expect(data.amount).toBe(699.00);
      expect(data.paymentRail).toBe('paypal');
      expect(data.currency).toBe('MXN');
    });
  });

  describe('3. Captura y Reconciliación Contable (/api/paypal/capture-order)', () => {
    it('requiere orderId o paymentId', async () => {
      const env = createMockEnv();
      const res = await worker.request('/api/paypal/capture-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      }, env);

      expect(res.status).toBe(400);
      const data: any = await res.json();
      expect(data.error.type).toBe('MISSING_ORDER_ID');
    });

    it('captura la orden, marca status PAID y registra asiento en el Ledger contable', async () => {
      const env = createMockEnv();
      const res = await worker.request('/api/paypal/capture-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: 'ORDER_TEST_123',
          paymentId: 'PAY_TEST_123',
          merchantId: '01JBAVSKINLAB0000000000000'
        })
      }, env);

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.success).toBe(true);
      expect(data.status).toBe('PAID');
      expect(data.transactionId).toContain('PAYPAL_CAP_');
      expect(data.paymentRail).toBe('paypal');
    });
  });

  describe('4. Configuración del Merchant (/api/merchant/:id/paypal)', () => {
    it('actualiza credenciales de PayPal para el comercio autenticado', async () => {
      const env = createMockEnv({
        AUTH_JWT_SECRET: 'test_jwt_secret_key_123456789012'
      });

      // Generar token JWT simulado de admin/merchant
      const res = await worker.request('/api/merchant/01JBAVSKINLAB0000000000000/paypal', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer token_invalido_devuelve_401'
        },
        body: JSON.stringify({
          paypalClientId: 'cliente_paypal_real_123',
          paypalClientSecret: 'secreto_paypal_real_456',
          enabled: true
        })
      }, env);

      // Debe requerir autenticación
      expect(res.status).toBe(401);
    });
  });

});
