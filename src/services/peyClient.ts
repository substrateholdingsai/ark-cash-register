import {
  CreateCodiQrRequest,
  CreateCodiQrResponse,
  CreateCodiPnRequest,
  CreateCodiPnResponse,
  RegisterBankAccountRequest,
  RegisterBankAccountResponse,
  BankAccountDetails,
  CreatePaymentLinkRequest,
  CreatePaymentLinkResponse,
  PaymentLinkDetails,
  PeyTransaction,
  PeyPaginatedResponse,
  PeyErrorResponse,
  PeyMetadata
} from '../types';
import { generateUlid } from '../utils/ulid';

export class PeyClient {
  private baseUrl: string;
  private apiKey?: string;
  private isProduction: boolean;

  constructor(baseUrl: string = 'https://api.pey.mx', apiKey?: string, isProduction: boolean = false) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.isProduction = isProduction;
  }

  // Sanitiza la metadata de acuerdo a la especificación estricta de Pey
  private sanitizeMetadata(metadata?: PeyMetadata): Record<string, string> | undefined {
    if (!metadata) return undefined;
    const sanitized: Record<string, string> = {};
    const entries = Object.entries(metadata).slice(0, 50);

    for (const [key, value] of entries) {
      if (value === undefined) continue;
      const cleanKey = key.slice(0, 40);
      const cleanVal = String(value).slice(0, 500);
      sanitized[cleanKey] = cleanVal;
    }
    return sanitized;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}, maxRetries: number = 3): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(options.headers as Record<string, string> || {})
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    // Modo Mock/Simulador estricto: PROHIBIDO en producción
    if (!this.apiKey) {
      if (this.isProduction) {
        throw new Error('Pey API Key is required in production. Mocks are forbidden.');
      }
      return this.mockResponse<T>(endpoint, options);
    }

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          ...options,
          headers
        });

        if (response.status === 503 || response.status === 500) {
          if (attempt < maxRetries - 1) {
            await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
            continue;
          }
        }

        const data = await response.json().catch(() => null);

        if (!response.ok) {
          const errorData = data as PeyErrorResponse;
          const msg = errorData?.error?.message || `Pey API Error (${response.status})`;
          const err = new Error(msg);
          (err as any).status = response.status;
          (err as any).details = errorData;
          throw err;
        }

        return data as T;
      } catch (err: any) {
        lastError = err;
        if (err.status && err.status < 500) {
          // No reintentar errores 4xx
          throw err;
        }
        if (attempt < maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }

    throw lastError || new Error('Network error calling Pey API');
  }

  // 1. Crear CoDi QR
  async createCodiQr(req: CreateCodiQrRequest): Promise<CreateCodiQrResponse> {
    const payload = {
      amount: Number(req.amount),
      concept: req.concept || 'Venta mostrador',
      expiration: req.expiration !== undefined ? req.expiration : 600,
      numRef: req.numRef ? String(req.numRef).slice(0, 7) : '0',
      generateImage: false, // Siempre false: renderizado client-side
      bankAccountId: req.bankAccountId,
      metadata: this.sanitizeMetadata(req.metadata)
    };

    return this.request<CreateCodiQrResponse>('/codi/qr', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  // 2. Crear CoDi Push Notification
  async createCodiPn(req: CreateCodiPnRequest): Promise<CreateCodiPnResponse> {
    const payload = {
      amount: Number(req.amount),
      phoneNumber: req.phoneNumber,
      concept: req.concept || 'Cobro Ark',
      expiration: Math.max(360, req.expiration || 360),
      numRef: req.numRef ? String(req.numRef).slice(0, 7) : '0',
      bankAccountId: req.bankAccountId,
      metadata: this.sanitizeMetadata(req.metadata)
    };

    return this.request<CreateCodiPnResponse>('/codi/pn', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  // 3. Registrar Bank Account (Onboarding)
  async registerBankAccount(req: RegisterBankAccountRequest): Promise<RegisterBankAccountResponse> {
    return this.request<RegisterBankAccountResponse>('/bank-account', {
      method: 'POST',
      body: JSON.stringify(req)
    });
  }

  // 4. Obtener Bank Account
  async getBankAccount(id: string): Promise<BankAccountDetails> {
    return this.request<BankAccountDetails>(`/bank-account/${encodeURIComponent(id)}`, {
      method: 'GET'
    });
  }

  // 5. Crear Payment Link
  async createPaymentLink(req: CreatePaymentLinkRequest): Promise<CreatePaymentLinkResponse> {
    const payload = {
      amount: Number(req.amount),
      successUrl: req.successUrl,
      backUrl: req.backUrl,
      hasTip: Boolean(req.hasTip),
      clientReferenceId: req.clientReferenceId,
      metadata: this.sanitizeMetadata(req.metadata)
    };

    return this.request<CreatePaymentLinkResponse>('/payment-link/create', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  // 6. Obtener Payment Link
  async getPaymentLink(id: string): Promise<PaymentLinkDetails> {
    return this.request<PaymentLinkDetails>(`/payment-link/${encodeURIComponent(id)}`, {
      method: 'GET'
    });
  }

  // 7. Obtener Transacción por ID
  async getTransaction(id: string): Promise<PeyTransaction> {
    return this.request<PeyTransaction>(`/transaction/${encodeURIComponent(id)}`, {
      method: 'GET'
    });
  }

  // 8. Obtener transacciones de un QR CoDi
  async getCodiQrTransactions(idc: string, nextToken?: string): Promise<PeyPaginatedResponse<PeyTransaction>> {
    const query = nextToken ? `?nextToken=${encodeURIComponent(nextToken)}` : '';
    return this.request<PeyPaginatedResponse<PeyTransaction>>(`/transaction/codi/qr/${encodeURIComponent(idc)}${query}`, {
      method: 'GET'
    });
  }

  // 9. Obtener transacciones de una cuenta bancaria
  async getBankAccountTransactions(bankAccountId: string, nextToken?: string): Promise<PeyPaginatedResponse<PeyTransaction>> {
    const query = nextToken ? `?nextToken=${encodeURIComponent(nextToken)}` : '';
    return this.request<PeyPaginatedResponse<PeyTransaction>>(`/transaction/bank-account/${encodeURIComponent(bankAccountId)}${query}`, {
      method: 'GET'
    });
  }

  // Mock seguro para pruebas locales o sandbox sin API key configurada
  private mockResponse<T>(endpoint: string, options: RequestInit): T {
    console.warn(`[PeyClient Mock] Running simulated response for ${options.method || 'GET'} ${endpoint}`);
    const now = Math.floor(Date.now() / 1000);

    if (endpoint === '/codi/qr') {
      const body = options.body ? JSON.parse(options.body as string) : {};
      const idc = 'IDC' + generateUlid().slice(0, 10);
      const codiPayload = JSON.stringify({
        TYP: 1,
        v: "01",
        ic: 0,
        IDC: idc,
        m: body.amount || 0,
        c: body.concept || "Venta mostrador"
      });
      return {
        id: idc,
        qrString: codiPayload,
        qrImage: null
      } as unknown as T;
    }

    if (endpoint.startsWith('/transaction/codi/qr/')) {
      const parts = endpoint.split('/');
      const idc = parts[4] || 'TEST_IDC';
      // Simula pago pendiente o confirmado
      return {
        items: [
          {
            id: generateUlid(),
            status: 'WAITING',
            amount: 150,
            amountBreakdown: { base: 150 },
            currency: 'MXN',
            paymentMethod: 'CODI',
            description: 'Venta mostrador',
            dateCreated: now
          }
        ],
        nextToken: null
      } as unknown as T;
    }

    if (endpoint === '/payment-link/create') {
      const linkId = generateUlid();
      return {
        id: linkId,
        url: `https://app.mipey.mx/payment-link/${linkId}`
      } as unknown as T;
    }

    if (endpoint.startsWith('/payment-link/')) {
      const id = endpoint.split('/')[2];
      return {
        id,
        amount: 150,
        status: 'pending',
        successUrl: 'https://caja.arksystems.site/success',
        backUrl: 'https://caja.arksystems.site/cancel',
        hasTip: false,
        paymentMethods: ['CODI', 'CARD'],
        dateCreated: now
      } as unknown as T;
    }

    if (endpoint === '/bank-account') {
      return {
        id: '01JBAVWE4NS5TGXHWGMX3KH23Q',
        codiStatus: 'ACTIVE'
      } as unknown as T;
    }

    return {} as T;
  }
}
