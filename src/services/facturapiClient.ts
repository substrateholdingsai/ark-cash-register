// Cliente REST para Facturapi (PAC CFDI). Sin SDK de terceros.
// API: https://www.facturapi.io/v2 — auth Bearer con FACTURAPI_API_KEY.

export interface FacturapiInvoiceItem {
  quantity: number;
  product: {
    description: string;
    product_key: string; // clave SAT (ej. 84111506)
    price: number;
    tax_included?: boolean;
    taxability?: string; // '01' gravado
  };
}

export interface FacturapiCustomer {
  legal_name: string;
  tax_id: string; // RFC
  tax_system: string; // régimen fiscal (ej. 601)
  email?: string;
  address?: { zip: string; street?: string; exterior?: string; neighborhood?: string; city?: string; municipality?: string; state?: string };
}

export interface CreateInvoiceParams {
  customer: FacturapiCustomer;
  items: FacturapiInvoiceItem[];
  payment_form?: string; // '01' efectivo, '03' transferencia, '04' tarjeta, '99' por definir
  use?: string; // uso CFDI (G01, G03, etc.)
  series?: string;
  currency?: string;
  folio_number?: number;
}

export class FacturapiClient {
  constructor(private apiKey: string, private baseUrl: string) {
    if (!apiKey) throw new Error('FACTURAPI_API_KEY is required');
  }

  private async request(path: string, init: RequestInit): Promise<any> {
    const url = `${this.baseUrl.replace(/\/$/, '')}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...(init.headers || {})
      }
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!res.ok) {
      const msg = data?.message || data?.error || text || `HTTP ${res.status}`;
      const err: any = new Error(`Facturapi ${res.status}: ${msg}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  async createInvoice(params: CreateInvoiceParams): Promise<any> {
    return this.request('/invoices', { method: 'POST', body: JSON.stringify(params) });
  }

  async getInvoice(id: string): Promise<any> {
    return this.request(`/invoices/${encodeURIComponent(id)}`, { method: 'GET' });
  }

  async cancelInvoice(id: string, motive: string = '02', uuidReplacement?: string): Promise<any> {
    const qs = new URLSearchParams({ motive });
    if (uuidReplacement) qs.set('uuid_replacement', uuidReplacement);
    return this.request(`/invoices/${encodeURIComponent(id)}?${qs.toString()}`, { method: 'DELETE' });
  }

  async downloadXml(id: string): Promise<string> {
    const inv = await this.getInvoice(id);
    // Facturapi devuelve pdf/xml urls; intentar fetch del xml
    const xmlUrl = inv?.xml || inv?.links?.xml;
    if (!xmlUrl) throw new Error('XML no disponible');
    const res = await fetch(xmlUrl);
    if (!res.ok) throw new Error(`XML fetch ${res.status}`);
    return res.text();
  }
}
