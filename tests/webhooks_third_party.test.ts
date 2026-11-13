import { describe, it, expect } from 'vitest';
import worker from '../src/index';

async function signHmacHex(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('Webhooks de Terceros (/api/webhooks/paypal & /api/webhooks/shipping)', () => {
  const createMockEnv = (overrides: Record<string, any> = {}) => {
    const webhookEvents = new Map<string, any>();
    const ledgerEntries: any[] = [];
    const kvStore = new Map<string, string>();

    const payments = new Map<string, any>([
      ['PP_ORDER_100', {
        id: 'PAY_PP_100',
        merchant_id: '01JBAVSKINLAB0000000000000',
        payable_id: 'PP_ORDER_100',
        amount: 1299,
        concept: 'Kit SkinLab MSI',
        status: 'WAITING',
        transaction_id: null
      }]
    ]);

    const shippingLabels = new Map<string, any>([
      ['FEDEX99887766', {
        id: 'LBL_1',
        merchant_id: '01JBAVSKINLAB0000000000000',
        tracking_number: 'FEDEX99887766',
        carrier: 'fedex',
        status: 'LABEL_CREATED',
        last_event_at: null,
        last_checkpoint_json: null
      }]
    ]);

    return {
      _state: { webhookEvents, ledgerEntries, payments, shippingLabels, kvStore },
      ENVIRONMENT: 'test',
      PAYPAL_CLIENT_ID: 'test_paypal_client_id_mock',
      PAYPAL_CLIENT_SECRET: 'test_paypal_secret_mock',
      PAYPAL_ENVIRONMENT: 'sandbox',
      PAYPAL_WEBHOOK_ID: 'WH_TEST_PAYPAL_123',
      ENVIA_WEBHOOK_SECRET: 'test_envia_hmac_secret',
      DB: {
        prepare: (query: string) => ({
          bind: (...params: any[]) => ({
            first: async () => {
              if (query.includes('FROM webhook_events WHERE idempotency_key')) {
                const key = params[0];
                for (const ev of webhookEvents.values()) {
                  if (ev.idempotency_key === key) return ev;
                }
                return null;
              }
              if (query.includes('FROM payments WHERE payable_id')) {
                const needle = params[0];
                for (const p of payments.values()) {
                  if (p.payable_id === needle || p.id === needle) return p;
                }
                return null;
              }
              if (query.includes('FROM ledger_entries WHERE payment_id')) {
                const [pid, tid] = params;
                return ledgerEntries.find(l => l.payment_id === pid || (tid && l.transaction_id === tid)) || null;
              }
              return null;
            },
            run: async () => {
              if (query.includes('INSERT INTO webhook_events')) {
                const isRejected = query.includes('rejected.signature');
                if (isRejected) {
                  webhookEvents.set(params[0], { id: params[0], event_type: 'rejected.signature' });
                } else {
                  webhookEvents.set(params[0], {
                    id: params[0],
                    event_type: params[1],
                    transaction_id: params[2],
                    idempotency_key: params[6],
                    processed: 0
                  });
                }
                return { success: true, meta: { changes: 1 } };
              }
              if (query.includes('UPDATE webhook_events')) {
                const ev = webhookEvents.get(params[params.length - 1]);
                if (ev) ev.processed = query.includes('processed = 1') ? 1 : 0;
                return { success: true, meta: { changes: 1 } };
              }
              if (query.includes("SET status = 'PAID'")) {
                const [txnId, , datePaid, orderId] = params;
                let changes = 0;
                for (const p of payments.values()) {
                  if ((p.payable_id === orderId || p.id === orderId) && p.status !== 'PAID') {
                    p.status = 'PAID';
                    p.transaction_id = txnId;
                    p.date_paid = datePaid;
                    changes++;
                  }
                }
                return { success: true, meta: { changes } };
              }
              if (query.includes("SET status = 'CANCELLED'")) {
                const [orderId] = params;
                let changes = 0;
                for (const p of payments.values()) {
                  if ((p.payable_id === orderId || p.id === orderId) && p.status !== 'CANCELLED') {
                    p.status = 'CANCELLED';
                    changes++;
                  }
                }
                return { success: true, meta: { changes } };
              }
              if (query.includes("SET status = 'MANUAL_REVIEW'")) {
                const [orderId] = params;
                for (const p of payments.values()) {
                  if (p.payable_id === orderId || p.transaction_id === orderId || p.id === orderId) {
                    p.status = 'MANUAL_REVIEW';
                  }
                }
                return { success: true, meta: { changes: 1 } };
              }
              if (query.includes('INSERT INTO ledger_entries')) {
                ledgerEntries.push({
                  id: params[0],
                  merchant_id: params[1],
                  payment_id: params[2],
                  transaction_id: params[3],
                  amount: params[4],
                  concept: params[5]
                });
                return { success: true, meta: { changes: 1 } };
              }
              if (query.includes('UPDATE shipping_labels')) {
                const [status, lastEventAt, checkpointJson, tracking] = params;
                const lbl = shippingLabels.get(tracking);
                if (lbl) {
                  lbl.status = status;
                  lbl.last_event_at = lastEventAt;
                  lbl.last_checkpoint_json = checkpointJson;
                }
                return { success: true, meta: { changes: lbl ? 1 : 0 } };
              }
              return { success: true, meta: { changes: 0 } };
            }
          })
        })
      } as any,
      KV: {
        get: async (k: string) => kvStore.get(k) || null,
        put: async (k: string, v: string) => { kvStore.set(k, v); },
        delete: async (k: string) => { kvStore.delete(k); }
      } as any,
      ...overrides
    };
  };

  describe('1. PayPal REST v2 Webhook (/api/webhooks/paypal)', () => {
    it('falla cerrado con 500 en producción si falta PAYPAL_WEBHOOK_ID', async () => {
      const env = createMockEnv({ ENVIRONMENT: 'production', PAYPAL_WEBHOOK_ID: undefined });
      const res = await worker.request('/api/webhooks/paypal', {
        method: 'POST',
        body: JSON.stringify({ id: 'WH-1', event_type: 'PAYMENT.CAPTURE.COMPLETED' })
      }, env);
      expect(res.status).toBe(500);
    });

    it('rechaza con 401 si faltan headers de firma o la firma es inválida', async () => {
      const env = createMockEnv();
      const resMissing = await worker.request('/api/webhooks/paypal', {
        method: 'POST',
        body: JSON.stringify({ id: 'WH-1', event_type: 'PAYMENT.CAPTURE.COMPLETED' })
      }, env);
      expect(resMissing.status).toBe(401);

      const resBadSig = await worker.request('/api/webhooks/paypal', {
        method: 'POST',
        headers: {
          'PAYPAL-TRANSMISSION-SIG': 'tampered_sig',
          'PAYPAL-TRANSMISSION-ID': 'tx-123',
          'PAYPAL-TRANSMISSION-TIME': new Date().toISOString()
        },
        body: JSON.stringify({ id: 'WH-1', event_type: 'PAYMENT.CAPTURE.COMPLETED' })
      }, env);
      expect(resBadSig.status).toBe(401);
    });

    it('procesa PAYMENT.CAPTURE.COMPLETED con firma válida, marca PAID, crea asiento contable y es idempotente', async () => {
      const env = createMockEnv();
      const payload = JSON.stringify({
        id: 'WH_EV_PP_001',
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: {
          id: 'CAP_PP_999',
          amount: { value: '1299.00', currency_code: 'MXN' },
          supplementary_data: { related_ids: { order_id: 'PP_ORDER_100' } }
        }
      });

      const headers = {
        'Content-Type': 'application/json',
        'PAYPAL-TRANSMISSION-SIG': 'mock_sig_valid_rsa256',
        'PAYPAL-TRANSMISSION-ID': 'tr-001',
        'PAYPAL-TRANSMISSION-TIME': new Date().toISOString(),
        'PAYPAL-CERT-URL': 'https://api.sandbox.paypal.com/cert.pem',
        'PAYPAL-AUTH-ALGO': 'SHA256withRSA'
      };

      const res1 = await worker.request('/api/webhooks/paypal', { method: 'POST', headers, body: payload }, env);
      expect(res1.status).toBe(200);
      const data1: any = await res1.json();
      expect(data1.received).toBe(true);
      expect(data1.duplicate).toBe(false);

      expect(env._state.payments.get('PP_ORDER_100').status).toBe('PAID');
      expect(env._state.ledgerEntries.length).toBe(1);
      expect(env._state.ledgerEntries[0].amount).toBe(1299);

      // Reintento idempotente
      const res2 = await worker.request('/api/webhooks/paypal', { method: 'POST', headers, body: payload }, env);
      expect(res2.status).toBe(200);
      const data2: any = await res2.json();
      expect(data2.duplicate).toBe(true);
      expect(env._state.ledgerEntries.length).toBe(1);
    });

    it('marca MANUAL_REVIEW ante disputa (CUSTOMER.DISPUTE.CREATED)', async () => {
      const env = createMockEnv();
      const payload = JSON.stringify({
        id: 'WH_EV_PP_DISPUTE',
        event_type: 'CUSTOMER.DISPUTE.CREATED',
        resource: {
          id: 'PP-D-1',
          disputed_transactions: [{ seller_transaction_id: 'PP_ORDER_100' }]
        }
      });

      const res = await worker.request('/api/webhooks/paypal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'PAYPAL-TRANSMISSION-SIG': 'mock_sig_valid_rsa256',
          'PAYPAL-TRANSMISSION-ID': 'tr-002',
          'PAYPAL-TRANSMISSION-TIME': new Date().toISOString()
        },
        body: payload
      }, env);

      expect(res.status).toBe(200);
      expect(env._state.payments.get('PP_ORDER_100').status).toBe('MANUAL_REVIEW');
    });
  });

  describe('2. Envia.com Shipping Webhook (/api/webhooks/shipping)', () => {
    it('falla cerrado con 500 en producción si falta ENVIA_WEBHOOK_SECRET', async () => {
      const env = createMockEnv({ ENVIRONMENT: 'production', ENVIA_WEBHOOK_SECRET: undefined });
      const res = await worker.request('/api/webhooks/shipping', {
        method: 'POST',
        body: JSON.stringify({ trackingNumber: 'FEDEX99887766', event: 'in_transit' })
      }, env);
      expect(res.status).toBe(500);
    });

    it('rechaza con 401 si la firma HMAC X-Envia-Signature es inválida', async () => {
      const env = createMockEnv();
      const res = await worker.request('/api/webhooks/shipping', {
        method: 'POST',
        headers: { 'X-Envia-Signature': 'badhexsignature' },
        body: JSON.stringify({ trackingNumber: 'FEDEX99887766', event: 'in_transit' })
      }, env);
      expect(res.status).toBe(401);
    });

    it('actualiza shipping_labels y KV con firma HMAC válida y garantiza idempotencia', async () => {
      const env = createMockEnv();
      const body = JSON.stringify({
        id: 'ENVIA_EVT_101',
        trackingNumber: 'FEDEX99887766',
        carrier: 'fedex',
        event: 'delivered',
        location: 'Mérida, YUC',
        description: 'Entregado en recepción'
      });
      const sig = await signHmacHex(env.ENVIA_WEBHOOK_SECRET, body);

      const res1 = await worker.request('/api/webhooks/shipping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Envia-Signature': sig },
        body
      }, env);

      expect(res1.status).toBe(200);
      const data1: any = await res1.json();
      expect(data1.received).toBe(true);
      expect(data1.status).toBe('DELIVERED');
      expect(data1.duplicate).toBe(false);

      const label = env._state.shippingLabels.get('FEDEX99887766');
      expect(label.status).toBe('DELIVERED');
      expect(JSON.parse(label.last_checkpoint_json).location).toBe('Mérida, YUC');

      const cached = await env.KV.get('envia_track:FEDEX99887766');
      expect(cached).toBeTruthy();
      expect(JSON.parse(cached!).status).toBe('DELIVERED');

      // Reintento idempotente
      const res2 = await worker.request('/api/webhooks/shipping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Envia-Signature': sig },
        body
      }, env);
      expect(res2.status).toBe(200);
      const data2: any = await res2.json();
      expect(data2.duplicate).toBe(true);
    });
  });
});
