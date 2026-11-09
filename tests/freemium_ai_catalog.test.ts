import { describe, it, expect, vi } from 'vitest';
import worker from '../src/index';

describe('Arquitectura Freemium & Estudio Fotográfico de Catálogo con IA', () => {

  const createMockEnv = (overrides: Record<string, any> = {}) => {
    const memoryKv = new Map<string, string>();
    const merchantsTable = new Map<string, any>();
    const catalogImages: any[] = [];
    const r2Storage = new Map<string, any>();

    // Merchants iniciales
    merchantsTable.set('01JBAVSKINLAB0000000000000', {
      id: '01JBAVSKINLAB0000000000000',
      name: 'SkinLab Clothing',
      tier: 'pro',
      ai_photo_credits: 50,
      pro_expires_at: Math.floor(Date.now() / 1000) + 86400 * 30
    });

    merchantsTable.set('01JBAVWE4NS5TGXHWGMX3KH23Q', {
      id: '01JBAVWE4NS5TGXHWGMX3KH23Q',
      name: 'Taquería El Güero',
      tier: 'pro',
      ai_photo_credits: 50,
      pro_expires_at: Math.floor(Date.now() / 1000) + 86400 * 30
    });

    merchantsTable.set('01JFREECOMMERCE00000000000', {
      id: '01JFREECOMMERCE00000000000',
      name: 'Abarrotes Don Pepe',
      tier: 'free',
      ai_photo_credits: 2,
      pro_expires_at: null
    });

    merchantsTable.set('01JNOCREDITSFREE0000000000', {
      id: '01JNOCREDITSFREE0000000000',
      name: 'Tacos Sin Crédito',
      tier: 'free',
      ai_photo_credits: 0,
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
                    tier: m.tier,
                    pro_expires_at: m.pro_expires_at,
                    ai_photo_credits: m.ai_photo_credits
                  };
                }
                return null;
              }
              if (query.includes('SELECT * FROM catalog_images')) {
                return catalogImages.find(img => img.merchant_id === params[0] && img.product_id === params[1]);
              }
              return null;
            },
            run: async () => {
              if (query.includes("tier = 'pro'")) {
                const targetId = params[params.length - 1];
                const m = merchantsTable.get(targetId);
                if (m) {
                  m.tier = 'pro';
                  m.pro_expires_at = params[0];
                  m.ai_photo_credits = params[1];
                }
              } else if (query.includes('UPDATE merchants SET ai_photo_credits = ?') || query.includes('ai_photo_credits = ?')) {
                const targetId = params[params.length - 1];
                const m = merchantsTable.get(targetId);
                if (m) {
                  m.ai_photo_credits = params[0];
                }
              } else if (query.includes('INSERT INTO catalog_images')) {
                catalogImages.push({
                  id: params[0],
                  merchant_id: params[1],
                  product_id: params[2],
                  r2_key: params[3],
                  model_used: params[4],
                  status: 'READY'
                });
              }
              return { success: true, meta: { changes: 1 } };
            },
            all: async () => ({ results: [] })
          })
        })
      } as any,
      KV: {
        get: async (key: string) => memoryKv.get(key) || null,
        put: async (key: string, val: string) => {
          memoryKv.set(key, val);
        },
        delete: async (key: string) => {
          memoryKv.delete(key);
        }
      } as any,
      AI: null as any,
      R2: {
        get: async (key: string) => {
          const stored = r2Storage.get(key);
          if (!stored) return null;
          return {
            body: stored.body,
            httpEtag: 'test_etag_123',
            httpMetadata: { contentType: stored.contentType },
            writeHttpMetadata: (h: Headers) => {
              h.set('content-type', stored.contentType);
            }
          };
        },
        put: async (key: string, body: any, opts: any) => {
          r2Storage.set(key, {
            body,
            contentType: opts?.httpMetadata?.contentType || 'image/jpeg'
          });
        }
      } as any,
      ...overrides
    };
  };

  describe('1. Consulta de Nivel de Comercio (GET /api/merchant/:id/tier)', () => {
    it('reconoce a los comercios demo como Pro con todas las capacidades activadas', async () => {
      const env = createMockEnv();
      const res = await worker.request('/api/merchant/01JBAVSKINLAB0000000000000/tier', {
        method: 'GET'
      }, env);

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.tier).toBe('pro');
      expect(data.isProActive).toBe(true);
      expect(data.features.storefront).toBe(true);
      expect(data.features.aiPhotos).toBe(true);
      expect(data.features.whatsappCatalog).toBe(true);
      expect(data.features.paypalMsi).toBe(true);
      expect(data.aiPhotoCredits).toBe(50);
    });

    it('identifica a un comercio básico como Free con 2 créditos de prueba para fotos', async () => {
      const env = createMockEnv();
      const res = await worker.request('/api/merchant/01JFREECOMMERCE00000000000/tier', {
        method: 'GET'
      }, env);

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.tier).toBe('free');
      expect(data.isProActive).toBe(false);
      expect(data.features.storefront).toBe(false);
      expect(data.features.paypalMsi).toBe(false);
      expect(data.aiPhotoCredits).toBe(2);
    });
  });

  describe('2. Activación de Suscripción Pro (POST /api/merchant/:id/upgrade-pro)', () => {
    it('asciende un comercio de Free a Pro y le abona 50 fotos de IA', async () => {
      const env = createMockEnv();
      const res = await worker.request('/api/merchant/01JFREECOMMERCE00000000000/upgrade-pro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planMonths: 1 })
      }, env);

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.success).toBe(true);
      expect(data.tier).toBe('pro');
      expect(data.aiPhotoCredits).toBe(52); // 2 de prueba + 50 del paquete
      expect(data.proExpiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));

      // Verificar que el endpoint de tier ahora refleja Pro
      const tierRes = await worker.request('/api/merchant/01JFREECOMMERCE00000000000/tier', {
        method: 'GET'
      }, env);
      const tierData: any = await tierRes.json();
      expect(tierData.tier).toBe('pro');
      expect(tierData.isProActive).toBe(true);
      expect(tierData.features.storefront).toBe(true);
    });
  });

  describe('3. Generación de Fotografía con IA (POST /api/merchant/:id/catalog/generate-image)', () => {
    it('permite a un comercio Free usar sus créditos de prueba de IA', async () => {
      const env = createMockEnv();
      const res = await worker.request('/api/merchant/01JFREECOMMERCE00000000000/catalog/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: 'prod-aguacate',
          productName: 'Aguacate Hass Michoacán',
          description: 'Aguacate fresco primera calidad, cremoso y listo para comer',
          category: 'Frutas y Verduras'
        })
      }, env);

      expect(res.status).toBe(201);
      const data: any = await res.json();
      expect(data.success).toBe(true);
      expect(data.imageUrl).toContain('/api/catalog/images/01JFREECOMMERCE00000000000/prod-aguacate');
      expect(data.remainingCredits).toBe(1); // 2 - 1 = 1
    });

    it('bloquea con HTTP 402 Paywall a comercios Free sin créditos restantes', async () => {
      const env = createMockEnv();
      const res = await worker.request('/api/merchant/01JNOCREDITSFREE0000000000/catalog/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: 'prod-taco-extra',
          productName: 'Taco Especial',
          description: 'Taco con doble porción de carne'
        })
      }, env);

      expect(res.status).toBe(402);
      const data: any = await res.json();
      expect(data.code).toBe('PAYWALL_UPGRADE_REQUIRED');
      expect(data.requiresUpgrade).toBe(true);
      expect(data.priceMxnMonthly).toBe(299);
    });

    it('un comercio Pro puede generar fotografías sin restricción de créditos Free', async () => {
      const env = createMockEnv();
      const res = await worker.request('/api/merchant/01JBAVSKINLAB0000000000000/catalog/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: 'sl-hoodie-black',
          productName: 'Hoodie Oversize Negro Caribe',
          description: 'Hoodie 100% algodón 400 GSM con logo bordado oro',
          category: 'Hoodies'
        })
      }, env);

      expect(res.status).toBe(201);
      const data: any = await res.json();
      expect(data.success).toBe(true);
      expect(data.imageUrl).toContain('/api/catalog/images/01JBAVSKINLAB0000000000000/sl-hoodie-black');
    });
  });

  describe('4. Entrega de Imágenes con Cache Inmutable (GET /api/catalog/images/:merchantId/:productId)', () => {
    it('sirve la imagen generada almacenada en R2 con encabezados de caché de 1 año', async () => {
      const env = createMockEnv();
      // Primero generar imagen para que quede en R2
      await worker.request('/api/merchant/01JBAVSKINLAB0000000000000/catalog/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: 'sl-hoodie-black',
          productName: 'Hoodie Oversize Negro Caribe'
        })
      }, env);

      const res = await worker.request('/api/catalog/images/01JBAVSKINLAB0000000000000/sl-hoodie-black', {
        method: 'GET'
      }, env);

      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
      expect(res.headers.get('Content-Type')).toBeDefined();
    });

    it('devuelve SVG de fallback con caché si no existe en R2', async () => {
      const env = createMockEnv();
      const res = await worker.request('/api/catalog/images/01JBAVSKINLAB0000000000000/inexistente', {
        method: 'GET'
      }, env);

      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toContain('public, max-age=');
      expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
    });
  });
});
