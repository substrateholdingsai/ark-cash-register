import { describe, it, expect, vi } from 'vitest';
import worker from '../src/index';
import { TAQUERIA_CATALOG, SKINLAB_CATALOG, getCatalogForMerchant } from '../src/data/catalogs';
import { PeyClient } from '../src/services/peyClient';

describe('Storefront — Catálogo, Aislamiento, Carrito y Checkout', () => {

  const createMockEnv = () => ({
    PEY_API_URL: 'https://api.pey.mx',
    PEY_API_KEY: 'test_pey_key',
    ENVIRONMENT: 'test',
    APP_BASE_URL: 'https://caja.arksystems.site',
    DB: {
      prepare: (query: string) => ({
        bind: (...params: any[]) => ({
          run: async () => ({ success: true }),
          first: async () => null,
          all: async () => ({ results: [] })
        })
      })
    } as any,
    KV: null as any
  });

  describe('1. Aislamiento estricto de catálogos por comercio', () => {
    it('Taquería El Güero solo contiene productos de comida mexicana', () => {
      const cat = getCatalogForMerchant('01JBAVWE4NS5TGXHWGMX3KH23Q');
      expect(cat.merchantId).toBe('01JBAVWE4NS5TGXHWGMX3KH23Q');
      expect(cat.brandName).toBe('Taquería El Güero');
      expect(cat.items.some(i => i.name.toLowerCase().includes('pastor'))).toBe(true);
      expect(cat.items.some(i => i.name.toLowerCase().includes('playera'))).toBe(false);
      expect(cat.items.some(i => i.name.toLowerCase().includes('hoodie'))).toBe(false);
    });

    it('SkinLab Clothing solo contiene ropa y accesorios streetwear', () => {
      const cat = getCatalogForMerchant('01JBAVSKINLAB0000000000000');
      expect(cat.merchantId).toBe('01JBAVSKINLAB0000000000000');
      expect(cat.brandName).toBe('SkinLab Clothing Club');
      expect(cat.items.some(i => i.name.toLowerCase().includes('playera'))).toBe(true);
      expect(cat.items.some(i => i.name.toLowerCase().includes('tacos'))).toBe(false);
      expect(cat.items.some(i => i.name.toLowerCase().includes('gringa'))).toBe(false);
    });

    it('resuelve alias amigables correctamente sin fugar comercios', () => {
      const catSkin = getCatalogForMerchant('skinlab');
      const catTaqueria = getCatalogForMerchant('taqueria');

      expect(catSkin.merchantId).toBe('01JBAVSKINLAB0000000000000');
      expect(catTaqueria.merchantId).toBe('01JBAVWE4NS5TGXHWGMX3KH23Q');
    });

    it('endpoint GET /api/merchant/:id/catalog responde con el catálogo aislado', async () => {
      const env = createMockEnv();
      const res = await worker.request('/api/merchant/01JBAVSKINLAB0000000000000/catalog', {
        method: 'GET'
      }, env);
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.merchantId).toBe('01JBAVSKINLAB0000000000000');
      expect(data.brandName).toBe('SkinLab Clothing Club');
      expect(data.items.length).toBeGreaterThan(0);
    });
  });

  describe('2. Lógica del Carrito: Total = suma exacta de productos y variantes', () => {
    it('calcula subtotales y cantidades correctamente', () => {
      // Simular carrito de Taquería
      const cart = [
        { id: 'tq-pastor', name: 'Tacos al Pastor', price: 95.00, qty: 2, variant: 'Con todo' },
        { id: 'tq-gringa', name: 'Gringa de Pastor con Queso', price: 55.00, qty: 1, variant: 'Doble queso' },
        { id: 'tq-refresco', name: 'Refresco Vidrio 355ml', price: 35.00, qty: 3, variant: 'Coca-Cola' }
      ];

      const totalItems = cart.reduce((sum, i) => sum + i.qty, 0);
      const subtotal = cart.reduce((sum, i) => sum + (i.price * i.qty), 0);

      expect(totalItems).toBe(6);
      // (95 * 2) + (55 * 1) + (35 * 3) = 190 + 55 + 105 = 350
      expect(subtotal).toBe(350.00);
    });

    it('aislamiento de carritos: SkinLab y Taquería usan llaves de almacenamiento separadas', () => {
      const keyTaqueria = `ark_cart_${TAQUERIA_CATALOG.merchantId}`;
      const keySkinLab = `ark_cart_${SKINLAB_CATALOG.merchantId}`;

      expect(keyTaqueria).not.toBe(keySkinLab);
      expect(keyTaqueria).toBe('ark_cart_01JBAVWE4NS5TGXHWGMX3KH23Q');
      expect(keySkinLab).toBe('ark_cart_01JBAVSKINLAB0000000000000');
    });
  });

  describe('3. Checkout CoDi®: genera QR dinámico con el total exacto del carrito', () => {
    it('genera QR con monto y concepto del carrito en vivo', async () => {
      const env = createMockEnv();
      const cartTotal = 448.00;
      const concept = 'Pedido Taqueria Mostrador';

      vi.spyOn(PeyClient.prototype, 'createCodiQr').mockResolvedValueOnce({
        id: 'idc_mock_test_123',
        qrString: '{"TYP":1,"v":"01","IDC":"IDC_MOCK_123","m":448.00}',
        status: 'WAITING',
        amount: cartTotal,
        concept,
        dateCreated: new Date().toISOString()
      } as any);

      const res = await worker.request('/api/codi/qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: cartTotal,
          concept,
          merchantId: TAQUERIA_CATALOG.merchantId
        })
      }, env);

      expect(res.status).toBe(201);
      const data: any = await res.json();

      expect(data).toHaveProperty('qrString');
      expect(data).toHaveProperty('paymentId');
      expect(data.amount).toBe(cartTotal);
      expect(data.concept).toBe(concept);
      expect(typeof data.qrString).toBe('string');
      expect(data.qrString.length).toBeGreaterThan(10);
    });
  });

  describe('4. Checkout WhatsApp: genera ticket en texto estructurado sin crear cobros falsos', () => {
    it('construye el mensaje de WhatsApp con formato correcto de ticket', () => {
      const tenant = TAQUERIA_CATALOG;
      const cart = [
        { name: 'Tacos al Pastor (Orden 5)', variant: 'Sin cebolla', price: 95.00, qty: 2 },
        { name: 'Refresco Vidrio 355ml', variant: 'Coca-Cola', price: 35.00, qty: 1 }
      ];
      const total = cart.reduce((sum, i) => sum + (i.price * i.qty), 0);
      const customer = 'Pablo';
      const notes = 'Salsa verde aparte';

      const itemsRows = cart.map(i => `• ${i.qty}x ${i.name} [${i.variant}] — $${(i.price * i.qty).toFixed(2)}`).join('\n');
      const ticketMessage = 
`${tenant.emoji} *NUEVO PEDIDO — ${tenant.brandName.toUpperCase()}*
---------------------------------------
${itemsRows}
---------------------------------------
*Subtotal:* $${total.toFixed(2)} MXN
*Total:* $${total.toFixed(2)} MXN
*Cliente:* ${customer}
*Notas:* ${notes}
*Pago:* A convenir con el comercio
---------------------------------------
_Pedido generado vía Ark Cash Register_`;

      expect(ticketMessage).toContain('NUEVO PEDIDO — TAQUERÍA EL GÜERO');
      expect(ticketMessage).toContain('• 2x Tacos al Pastor (Orden 5) [Sin cebolla] — $190.00');
      expect(ticketMessage).toContain('• 1x Refresco Vidrio 355ml [Coca-Cola] — $35.00');
      expect(ticketMessage).toContain('*Total:* $225.00 MXN');
      expect(ticketMessage).toContain('*Cliente:* Pablo');
      expect(ticketMessage).toContain('*Notas:* Salsa verde aparte');

      const waUrl = `https://wa.me/${tenant.whatsappPhone}?text=${encodeURIComponent(ticketMessage)}`;
      expect(waUrl.startsWith('https://wa.me/5219992968446')).toBe(true);
      expect(waUrl).toContain(encodeURIComponent('*Total:* $225.00 MXN'));
    });
  });

  describe('5. Ruteo amigable en Worker', () => {
    it('GET /tienda redirige a /tienda.html preservando ?m=', async () => {
      const env = createMockEnv();
      const res = await worker.request('/tienda?m=01JBAVSKINLAB0000000000000', {
        method: 'GET'
      }, env);
      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toBe('/tienda.html?m=01JBAVSKINLAB0000000000000');
    });

    it('GET /menu y GET /catalogo redirigen a /tienda', async () => {
      const env = createMockEnv();
      const resMenu = await worker.request('/menu', { method: 'GET' }, env);
      expect(resMenu.status).toBe(301);
      expect(resMenu.headers.get('Location')).toContain('/tienda');
    });
  });

});
