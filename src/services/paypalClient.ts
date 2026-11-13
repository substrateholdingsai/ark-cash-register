/**
 * Cliente REST API v2 Oficial de PayPal
 * Soporta Checkout Orders, Capture, y Meses Sin Intereses (MSI) en México.
 */

export interface PayPalOrderParams {
  amount: number;
  currency?: string;
  referenceId?: string;
  description?: string;
  customId?: string;
}

export interface PayPalCaptureResult {
  id: string;
  status: string;
  captureId: string;
  amount: number;
  currency: string;
  paypalFee?: number;
  netAmount?: number;
}

export class PayPalClient {
  private clientId: string;
  private clientSecret: string;
  private baseUrl: string;
  private isMock: boolean;

  constructor(clientId: string, clientSecret: string, environment: 'sandbox' | 'live' = 'sandbox') {
    this.clientId = (clientId || '').trim();
    this.clientSecret = (clientSecret || '').trim();
    this.baseUrl = environment === 'live' 
      ? 'https://api-m.paypal.com' 
      : 'https://api-m.sandbox.paypal.com';
    
    // Si las llaves son de pruebas/mocks en desarrollo/testing local
    this.isMock = this.clientId.startsWith('test_') || 
                  this.clientId.startsWith('mock_') || 
                  this.clientId === 'sandbox_demo_client_id';
  }

  async getAccessToken(): Promise<string> {
    if (this.isMock) {
      return 'mock_access_token_' + Date.now();
    }

    const auth = btoa(`${this.clientId}:${this.clientSecret}`);
    const res = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Error de autenticación con PayPal (${res.status}): ${errText}`);
    }

    const data: any = await res.json();
    return data.access_token;
  }

  async createOrder(params: PayPalOrderParams): Promise<{ orderId: string; status: string }> {
    if (this.isMock) {
      return {
        orderId: `PAYPAL_ORDER_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
        status: 'CREATED'
      };
    }

    const token = await this.getAccessToken();
    const currency = (params.currency || 'MXN').toUpperCase();

    const body = {
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: params.referenceId || `REF-${Date.now()}`,
          description: params.description || 'Compra en Ark Cash Register',
          custom_id: params.customId,
          amount: {
            currency_code: currency,
            value: params.amount.toFixed(2)
          }
        }
      ],
      application_context: {
        shipping_preference: 'NO_SHIPPING',
        user_action: 'PAY_NOW'
      }
    };

    const res = await fetch(`${this.baseUrl}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Error al crear orden en PayPal (${res.status}): ${errText}`);
    }

    const data: any = await res.json();
    return {
      orderId: data.id,
      status: data.status
    };
  }

  async captureOrder(orderId: string): Promise<PayPalCaptureResult> {
    if (this.isMock) {
      return {
        id: orderId,
        status: 'COMPLETED',
        captureId: `PAYPAL_CAP_${Date.now()}`,
        amount: 299.00,
        currency: 'MXN',
        paypalFee: 15.75,
        netAmount: 283.25
      };
    }

    const token = await this.getAccessToken();

    const res = await fetch(`${this.baseUrl}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Error al capturar orden en PayPal (${res.status}): ${errText}`);
    }

    const data: any = await res.json();
    const purchaseUnit = data.purchase_units?.[0];
    const capture = purchaseUnit?.payments?.captures?.[0];

    const captureId = capture?.id || data.id;
    const amountVal = parseFloat(capture?.amount?.value || '0');
    const currency = capture?.amount?.currency_code || 'MXN';

    const breakdown = capture?.seller_receivable_breakdown;
    const feeVal = breakdown?.paypal_fee ? parseFloat(breakdown.paypal_fee.value) : undefined;
    const netVal = breakdown?.net_amount ? parseFloat(breakdown.net_amount.value) : undefined;

    return {
      id: data.id,
      status: data.status, // ej. 'COMPLETED'
      captureId,
      amount: amountVal,
      currency,
      paypalFee: feeVal,
      netAmount: netVal
    };
  }

  /**
   * Verifica la firma criptográfica de un webhook PayPal REST v2
   * usando el endpoint oficial /v1/notifications/verify-webhook-signature.
   */
  async verifyWebhookSignature(params: {
    webhookId: string;
    transmissionId: string;
    transmissionTime: string;
    certUrl: string;
    authAlgo: string;
    transmissionSig: string;
    webhookEvent: unknown;
  }): Promise<boolean> {
    if (!params.webhookId || !params.transmissionSig || !params.transmissionId || !params.transmissionTime) {
      return false;
    }

    if (this.isMock) {
      return params.transmissionSig.startsWith('mock_sig_');
    }

    const token = await this.getAccessToken();
    const res = await fetch(`${this.baseUrl}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        auth_algo: params.authAlgo,
        cert_url: params.certUrl,
        transmission_id: params.transmissionId,
        transmission_sig: params.transmissionSig,
        transmission_time: params.transmissionTime,
        webhook_id: params.webhookId,
        webhook_event: params.webhookEvent
      })
    });

    if (!res.ok) {
      return false;
    }

    const data: any = await res.json().catch(() => ({}));
    return data?.verification_status === 'SUCCESS';
  }
}
