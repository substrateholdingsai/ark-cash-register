import { describe, it, expect } from 'vitest';
import worker from '../src/index';

describe('Facturación Fiscal CFDI 4.0 (Facturapi + SAT)', () => {
  const createMockDb = () => {
    const invoicesTable: any[] = [];
    return {
      prepare: (query: string) => ({
        bind: (...params: any[]) => ({
          run: async () => {
            if (query.includes('INSERT INTO invoices')) {
              invoicesTable.push({
                id: params[0],
                merchant_id: params[1],
                payment_id: params[2],
                facturapi_id: params[3],
                uuid: params[4],
                serie: params[5],
                folio: params[6],
                rfc_receptor: params[7],
                razon_social_receptor: params[8],
                subtotal: params[9],
                tax: params[10],
                total: params[11],
                status: params[13],
                xml_r2_key: params[14],
                pdf_url: params[15]
              });
            }
            return { success: true, meta: { changes: 1 } };
          },
          first: async () => {
            if (query.includes('FROM invoices')) {
              return invoicesTable[0] || {
                id: params[0],
                uuid: '4A2E8B90-1234-4567-89AB-CDEF01234567',
                serie: 'F',
                folio: '1001',
                rfc_receptor: 'XAXX010101000',
                razon_social_receptor: 'PUBLICO EN GENERAL',
                subtotal: 257.76,
                tax: 41.24,
                total: 299.00,
                status: 'stamped',
                xml_r2_key: 'invoices/test.xml'
              };
            }
            return null;
          },
          all: async () => ({ results: invoicesTable })
        })
      })
    };
  };

  const createMockEnv = () => ({
    FACTURAPI_BASE_URL: 'https://www.facturapi.io/v2',
    DB: createMockDb() as any,
    R2: {
      put: async () => ({}),
      get: async () => ({ text: async () => '<?xml version="1.0"?><cfdi:Comprobante Version="4.0"/>' })
    } as any
  });

  it('1. Emite factura CFDI 4.0 para Público en General en mostrador', async () => {
    const env = createMockEnv();
    const res = await worker.request('/api/invoice/issue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchantId: '01JBAVSKINLAB0000000000000',
        paymentId: 'PAY_MOCK_123',
        customerRfc: 'XAXX010101000',
        customerName: 'PUBLICO EN GENERAL',
        customerCp: '00000',
        customerRegimen: '616',
        items: [
          { quantity: 1, product: { description: 'Playera Ola Nocturna', product_key: '84111506', price: 299.00, tax_included: true } }
        ]
      })
    }, env);

    expect(res.status).toBe(201);
    const data: any = await res.json();
    expect(data.success).toBe(true);
    expect(data).toHaveProperty('uuid');
    expect(data.total).toBe(299.00);
    expect(data.subtotal).toBeCloseTo(257.76, 1);
    expect(data.tax).toBeCloseTo(41.24, 1);
  });

  it('2. Emite factura con RFC personalizado de cliente empresarial', async () => {
    const env = createMockEnv();
    const res = await worker.request('/api/invoice/issue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchantId: '01JBAVSKINLAB0000000000000',
        customerRfc: 'SUB120304XYZ',
        customerName: 'SUBSTRATE HOLDINGS MEXICO S.A. DE C.V.',
        customerCp: '06600',
        customerRegimen: '601',
        use: 'G03',
        items: [
          { quantity: 2, product: { description: 'Hoodie Oversize Caribe', product_key: '84111506', price: 699.00, tax_included: true } }
        ]
      })
    }, env);

    expect(res.status).toBe(201);
    const data: any = await res.json();
    expect(data.success).toBe(true);
    expect(data.total).toBe(1398.00);
  });

  it('3. Genera vista de comprobante PDF oficial (/api/invoice/:id/pdf)', async () => {
    const env = createMockEnv();
    const res = await worker.request('/api/invoice/INV_TEST_123/pdf', {
      method: 'GET'
    }, env);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('CFDI 4.0');
    expect(html).toContain('ARK CASH REGISTER');
    expect(html).toContain('TIMBRADO SAT');
  });

  it('4. Descarga XML oficial timbrado (/api/invoice/:id/xml)', async () => {
    const env = createMockEnv();
    const res = await worker.request('/api/invoice/INV_TEST_123/xml', {
      method: 'GET'
    }, env);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/xml');
    const xml = await res.text();
    expect(xml).toContain('cfdi:Comprobante');
    expect(xml).toContain('Version="4.0"');
  });
});
