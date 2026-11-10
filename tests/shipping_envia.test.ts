import { describe, it, expect } from 'vitest';
import worker from '../src/index';

describe('Logística y Envíos Nacionales con Envia.com (Exclusivo Ark Pro)', () => {

  const createMockEnv = (overrides: Record<string, any> = {}) => {
    const merchantsTable = new Map<string, any>();
    const shippingLabels: any[] = [];
    const paymentsTable = new Map<string, any>();

    merchantsTable.set('01JBAVSKINLAB0000000000000', {
      id: '01JBAVSKINLAB0000000000000',
      name: 'SkinLab Clothing Club',
      alias: 'SkinLab Clothing',
      tier: 'pro',
      origin_street: 'Av. Kukulcán',
      origin_number: 'Km 12',
      origin_city: 'Tulum',
      origin_state: 'ROO',
      origin_postal_code: '77780',
      origin_country: 'MX'
    });

    merchantsTable.set('01JFREECOMMERCE00000000000', {
      id: '01JFREECOMMERCE00000000000',
      name: 'Abarrotes Don Pepe',
      tier: 'free',
      pro_expires_at: null
    });

    return {
      ENVIRONMENT: 'test',
      APP_BASE_URL: 'https://caja.arksystems.site',
      DB: {
        prepare: (query: string) => ({
          bind: (...params: any[]) => ({
            first: async () => {
              if (query.includes('FROM merchants')) {
                const m = merchantsTable.get(params[0]);
                if (m) {
                  return {
                    id: m.id,
                    name: m.name,
                    alias: m.alias,
                    tier: m.tier,
                    pro_expires_at: m.pro_expires_at,
                    origin_street: m.origin_street,
                    origin_number: m.origin_number,
                    origin_city: m.origin_city,
                    origin_state: m.origin_state,
                    origin_postal_code: m.origin_postal_code,
                    origin_country: m.origin_country
                  };
                }
                return null;
              }
              if (query.includes('FROM shipping_labels')) {
                return shippingLabels.find(l => l.tracking_number === params[0]);
              }
              return null;
            },
            run: async () => {
              if (query.includes('INSERT INTO shipping_labels')) {
                shippingLabels.push({
                  id: params[0],
                  merchant_id: params[1],
                  payment_id: params[2],
                  order_reference: params[3],
                  carrier: params[4],
                  service: params[5],
                  tracking_number: params[6],
                  tracking_url: params[7],
                  label_url: params[8],
                  cost_mxn: params[9],
                  is_simulated: params[10],
                  destination_json: params[11],
                  created_at: params[12]
                });
              } else if (query.includes('UPDATE payments SET shipping_carrier')) {
                const p = paymentsTable.get(params[6]);
                if (p) {
                  p.shipping_carrier = params[0];
                  p.shipping_tracking_number = params[2];
                }
              }
              return { success: true, meta: { changes: 1 } };
            },
            all: async () => {
              if (query.includes('FROM shipping_labels')) {
                return { results: shippingLabels.filter(l => l.merchant_id === params[0]) };
              }
              return { results: [] };
            }
          })
        })
      } as any,
      KV: {
        get: async () => null,
        put: async () => {}
      } as any,
      ...overrides
    };
  };

  describe('1. Paywall: Envíos Gated por Ark Pro', () => {
    it('bloquea con HTTP 402 Paywall a comercios Free que intenten cotizar envíos', async () => {
      const env = createMockEnv();
      const res = await worker.request('/api/merchant/01JFREECOMMERCE00000000000/shipping/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postalCode: '06700' })
      }, env);

      expect(res.status).toBe(402);
      const data: any = await res.json();
      expect(data.code).toBe('PAYWALL_UPGRADE_REQUIRED');
      expect(data.requiresUpgrade).toBe(true);
      expect(data.feature).toBe('SHIPPING_LOGISTICS');
      expect(data.priceMxnMonthly).toBe(299);
    });

    it('bloquea con HTTP 402 Paywall a comercios Free que intenten generar guías', async () => {
      const env = createMockEnv();
      const res = await worker.request('/api/merchant/01JFREECOMMERCE00000000000/shipping/label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carrier: 'fedex', service: 'express_saver' })
      }, env);

      expect(res.status).toBe(402);
      const data: any = await res.json();
      expect(data.code).toBe('PAYWALL_UPGRADE_REQUIRED');
    });
  });

  describe('2. Cotización Multicarrier en Tiempo Real (/api/merchant/:id/shipping/quote)', () => {
    it('rechaza solicitudes con código postal inválido o menor a 5 dígitos con HTTP 400', async () => {
      const env = createMockEnv();
      const res = await worker.request('/api/merchant/01JBAVSKINLAB0000000000000/shipping/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postalCode: '123' })
      }, env);

      expect(res.status).toBe(400);
      const data: any = await res.json();
      expect(data.error.type).toBe('INVALID_POSTAL_CODE');
    });

    it('un comercio Pro cotiza tarifas con Redpack, Estafeta y FedEx', async () => {
      const env = createMockEnv();
      const res = await worker.request('/api/merchant/01JBAVSKINLAB0000000000000/shipping/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postalCode: '06700',
          state: 'CMX',
          city: 'Ciudad de México',
          packageWeight: 1.0
        })
      }, env);

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.success).toBe(true);
      expect(data.merchantId).toBe('01JBAVSKINLAB0000000000000');
      expect(data.destination.postalCode).toBe('06700');
      expect(Array.isArray(data.rates)).toBe(true);
      expect(data.rates.length).toBeGreaterThanOrEqual(3);

      // Verificar paqueterías soportadas
      const carriers = data.rates.map((r: any) => r.carrier);
      expect(carriers).toContain('redpack');
      expect(carriers).toContain('estafeta');
      expect(carriers).toContain('fedex');

      // Verificar orden ascendente por precio
      for (let i = 0; i < data.rates.length - 1; i++) {
        expect(data.rates[i].cost).toBeLessThanOrEqual(data.rates[i + 1].cost);
      }
    });
  });

  describe('3. Generación Oficial de Guías de Envío (/api/merchant/:id/shipping/label)', () => {
    it('emite guía con PDF descargable y número de rastreo oficial', async () => {
      const env = createMockEnv();
      const res = await worker.request('/api/merchant/01JBAVSKINLAB0000000000000/shipping/label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          carrier: 'estafeta',
          service: 'ground',
          orderReference: 'ORD-SKINLAB-7749',
          destination: {
            name: 'Valeria Gómez',
            street: 'Av. Paseo de la Reforma',
            number: '222',
            district: 'Juárez',
            city: 'Ciudad de México',
            state: 'CMX',
            postalCode: '06600',
            phone: '525512345678'
          }
        })
      }, env);

      expect(res.status).toBe(201);
      const data: any = await res.json();
      expect(data.success).toBe(true);
      expect(data.carrier).toBe('estafeta');
      expect(data.trackingNumber).toBeDefined();
      expect(data.trackingUrl).toContain('https://envia.com/rastreo?tracking=');
      expect(data.labelUrl).toContain('.pdf');
      expect(data.totalCost).toBeGreaterThan(0);
    });
  });

  describe('4. Rastreo de Envíos y Consulta de Historial', () => {
    it('consulta estado y checkpoints del paquete en camino', async () => {
      const env = createMockEnv();
      const res = await worker.request('/api/merchant/01JBAVSKINLAB0000000000000/shipping/track/estafeta/EST1234567890', {
        method: 'GET'
      }, env);

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.success).toBe(true);
      expect(data.carrier).toBe('estafeta');
      expect(data.trackingNumber).toBe('EST1234567890');
      expect(data.tracking.status).toBe('in_transit');
      expect(Array.isArray(data.tracking.checkpoints)).toBe(true);
    });

    it('lista el historial de guías emitidas por el comercio', async () => {
      const env = createMockEnv();
      // Generar una guía primero
      await worker.request('/api/merchant/01JBAVSKINLAB0000000000000/shipping/label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          carrier: 'fedex',
          service: 'express_saver',
          orderReference: 'ORD-TEST-HISTORIAL'
        })
      }, env);

      const res = await worker.request('/api/merchant/01JBAVSKINLAB0000000000000/shipping/labels', {
        method: 'GET'
      }, env);

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.success).toBe(true);
      expect(Array.isArray(data.labels)).toBe(true);
      expect(data.labels.length).toBe(1);
      expect(data.labels[0].carrier).toBe('fedex');
    });
  });
});
