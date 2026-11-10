/**
 * Servicio de Logística y Envíos Nacionales con Envia.com
 * Soporta agregador multicarrier (FedEx, Estafeta, Redpack, DHL)
 * con fallback resiliente automático (simulación realista) para no bloquear ventas.
 */

import { Env } from '../types';

export interface EnviaAddress {
  name: string;
  company?: string;
  email?: string;
  phone: string;
  street: string;
  number: string;
  district?: string;
  city: string;
  state: string; // ej: 'ROO', 'CMX', 'JAL', 'NL', 'YUC'
  country: string; // 'MX'
  postalCode: string;
}

export interface EnviaPackage {
  content: string;
  amount: number;
  type: string; // 'box', 'envelope'
  weight: number; // en KG
  dimensions: {
    length: number;
    width: number;
    height: number;
  };
}

export interface ShippingRateQuote {
  carrier: string;
  service: string;
  serviceDescription: string;
  deliveryEstimate: string;
  cost: number;
  currency: string;
  logoEmoji: string;
  isSimulated?: boolean;
}

export interface GeneratedLabelResult {
  trackingNumber: string;
  trackingUrl: string;
  labelUrl: string; // URL al PDF oficial
  carrier: string;
  service: string;
  totalCost: number;
  currency: string;
  isSimulated: boolean;
}

export class EnviaService {
  private apiKey: string | null;
  private baseUrl: string;

  constructor(env: Env, merchantApiKey?: string | null) {
    this.apiKey = merchantApiKey || env.ENVIA_API_KEY || null;
    const isSandbox = (env as any).ENVIA_SANDBOX === 'true';
    this.baseUrl = isSandbox ? 'https://api-test.envia.com' : 'https://api.envia.com';
  }

  public getMerchantOrigin(merchant: any): EnviaAddress {
    return {
      name: merchant?.clabe_holder || merchant?.name || 'Mostrador Ark',
      company: merchant?.alias || merchant?.name || 'Ark Cash Register',
      email: 'logistica@arksystems.site',
      phone: merchant?.phone || '529994918221',
      street: merchant?.origin_street || 'Av. Kukulcán',
      number: merchant?.origin_number || 'Km 12',
      district: merchant?.origin_district || 'Zona Hotelera',
      city: merchant?.origin_city || 'Tulum',
      state: merchant?.origin_state || 'ROO',
      country: merchant?.origin_country || 'MX',
      postalCode: merchant?.origin_postal_code || '77780'
    };
  }

  /**
   * Cotiza tarifas de envío con paqueterías en tiempo real.
   */
  async quoteRates(
    origin: EnviaAddress,
    destination: EnviaAddress,
    packages: EnviaPackage[]
  ): Promise<ShippingRateQuote[]> {
    if (!this.apiKey) {
      return this.getSimulatedQuotes(origin, destination, packages);
    }

    try {
      const payload = {
        origin,
        destination,
        packages,
        shipment: {
          carrier: '',
          service: '',
          type: 1
        },
        settings: {
          currency: 'MXN'
        }
      };

      const res = await fetch(`${this.baseUrl}/ship/rate/`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        console.warn(`[Envia] Rate error ${res.status}: ${await res.text()}`);
        return this.getSimulatedQuotes(origin, destination, packages);
      }

      const json: any = await res.json();
      const rawData = json.data || [];

      if (!Array.isArray(rawData) || rawData.length === 0) {
        return this.getSimulatedQuotes(origin, destination, packages);
      }

      const quotes: ShippingRateQuote[] = rawData.map((item: any) => ({
        carrier: item.carrier || 'courier',
        service: item.service || 'standard',
        serviceDescription: item.serviceDescription || item.service || 'Envío Terrestre',
        deliveryEstimate: item.deliveryEstimate || (item.deliveryDays ? `${item.deliveryDays} días hábiles` : '2-4 días hábiles'),
        cost: Math.round(Number(item.totalPrice || item.price || 0)),
        currency: 'MXN',
        logoEmoji: this.getCarrierEmoji(item.carrier),
        isSimulated: false
      }));

      return quotes.sort((a, b) => a.cost - b.cost);
    } catch (err) {
      console.error('[Envia] Error in quoteRates:', err);
      return this.getSimulatedQuotes(origin, destination, packages);
    }
  }

  /**
   * Genera la guía oficial en PDF y número de rastreo.
   */
  async generateLabel(
    origin: EnviaAddress,
    destination: EnviaAddress,
    packages: EnviaPackage[],
    carrier: string,
    service: string
  ): Promise<GeneratedLabelResult> {
    if (!this.apiKey) {
      return this.getSimulatedLabel(carrier, service);
    }

    try {
      const payload = {
        origin,
        destination,
        packages,
        shipment: {
          carrier: carrier.toLowerCase(),
          service: service.toLowerCase(),
          type: 1
        },
        settings: {
          currency: 'MXN',
          printFormat: 'PDF',
          printSize: 'STOCK_4X6'
        }
      };

      const res = await fetch(`${this.baseUrl}/ship/generate/`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        console.warn(`[Envia] Generate label error ${res.status}: ${await res.text()}`);
        return this.getSimulatedLabel(carrier, service);
      }

      const json: any = await res.json();
      const data = Array.isArray(json.data) ? json.data[0] : json.data;

      if (!data || !data.trackingNumber) {
        return this.getSimulatedLabel(carrier, service);
      }

      return {
        trackingNumber: data.trackingNumber,
        trackingUrl: data.trackUrl || `https://envia.com/rastreo?tracking=${data.trackingNumber}`,
        labelUrl: data.label || data.labelUrl || '',
        carrier: (data.carrier || carrier).toLowerCase(),
        service: (data.service || service).toLowerCase(),
        totalCost: Number(data.totalPrice || 0),
        currency: 'MXN',
        isSimulated: false
      };
    } catch (err) {
      console.error('[Envia] Error in generateLabel:', err);
      return this.getSimulatedLabel(carrier, service);
    }
  }

  /**
   * Consulta el rastreo de un envío.
   */
  async trackShipment(carrier: string, trackingNumber: string): Promise<any> {
    if (!this.apiKey) {
      return {
        carrier,
        trackingNumber,
        status: 'in_transit',
        statusDescription: 'En tránsito a domicilio (Modo Simulación)',
        checkpoints: [
          { date: new Date().toISOString(), location: 'Centro de Clasificación CDMX', description: 'Paquete en ruta de entrega' },
          { date: new Date(Date.now() - 86400000).toISOString(), location: 'Mérida / Cancún Hub', description: 'Recolección documentada en mostrador' }
        ]
      };
    }

    try {
      const res = await fetch(`${this.baseUrl}/ship/generaltrack/${encodeURIComponent(carrier)}/${encodeURIComponent(trackingNumber)}`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`
        }
      });

      if (!res.ok) {
        return {
          carrier,
          trackingNumber,
          status: 'pending',
          statusDescription: 'Guía generada. Pendiente de recolección por paquetería.'
        };
      }

      return await res.json();
    } catch (err) {
      return { carrier, trackingNumber, error: 'No se pudo consultar el rastreo en este momento' };
    }
  }

  private getSimulatedQuotes(
    origin: EnviaAddress,
    destination: EnviaAddress,
    packages: EnviaPackage[]
  ): ShippingRateQuote[] {
    const totalWeight = packages.reduce((acc, p) => acc + (p.weight * (p.amount || 1)), 0);
    const isSameZone = (origin.state || '').toUpperCase() === (destination.state || '').toUpperCase();
    const basePrice = isSameZone ? 115 : 160;
    const weightFee = Math.max(0, totalWeight - 1) * 25;

    return [
      {
        carrier: 'redpack',
        service: 'standard',
        serviceDescription: 'Redpack EcoExpress Terrestre',
        deliveryEstimate: isSameZone ? '1 a 2 días hábiles' : '3 a 5 días hábiles',
        cost: Math.round(basePrice + weightFee),
        currency: 'MXN',
        logoEmoji: '📦',
        isSimulated: true
      },
      {
        carrier: 'estafeta',
        service: 'ground',
        serviceDescription: 'Estafeta Terrestre Nacional',
        deliveryEstimate: isSameZone ? '24 horas' : '2 a 3 días hábiles',
        cost: Math.round(basePrice + 25 + weightFee),
        currency: 'MXN',
        logoEmoji: '🚚',
        isSimulated: true
      },
      {
        carrier: 'fedex',
        service: 'express_saver',
        serviceDescription: 'FedEx Express Saver Prioritario',
        deliveryEstimate: '1 a 2 días hábiles',
        cost: Math.round(basePrice + 65 + weightFee),
        currency: 'MXN',
        logoEmoji: '⚡',
        isSimulated: true
      }
    ];
  }

  private getSimulatedLabel(carrier: string, service: string): GeneratedLabelResult {
    const prefix = carrier.toUpperCase().slice(0, 3);
    const num = Math.floor(1000000000 + Math.random() * 9000000000);
    const tracking = `${prefix}${num}`;
    return {
      trackingNumber: tracking,
      trackingUrl: `https://envia.com/rastreo?tracking=${tracking}`,
      labelUrl: `https://api.envia.com/labels/demo/${tracking}.pdf`,
      carrier: carrier.toLowerCase(),
      service: service.toLowerCase(),
      totalCost: 165.0,
      currency: 'MXN',
      isSimulated: true
    };
  }

  private getCarrierEmoji(carrier: string): string {
    const c = (carrier || '').toLowerCase();
    if (c.includes('fedex')) return '⚡';
    if (c.includes('estafeta')) return '🚚';
    if (c.includes('dhl')) return '🟡';
    return '📦';
  }
}
