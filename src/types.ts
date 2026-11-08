export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  PEY_API_URL: string;
  PEY_API_KEY?: string;
  PEY_WEBHOOK_SECRET?: string;
  CAJA_STAYPUFT_API_KEY?: string;
  ENVIRONMENT?: string;
  APP_NAME?: string;
  APP_VERSION?: string;
}

export type CodiStatus = 'PENDING' | 'PROCESSING' | 'ACTIVE' | 'ERROR';
export type PaymentStatus = 'WAITING' | 'PAID' | 'EXPIRED' | 'CANCELLED';
export type PayableType = 'CODI_QR' | 'CODI_PN' | 'PAYMENT_LINK';

export interface PeyMetadata {
  merchantId?: string;
  deviceId?: string;
  sessionId?: string;
  source?: string;
  screen?: string;
  operator?: string;
  channel?: string;
  concept?: string;
  [key: string]: string | number | boolean | null | undefined;
}

// Request CoDi QR según OpenAPI 2026-10-20
export interface CreateCodiQrRequest {
  amount: number;
  concept?: string;
  expiration?: number; // min 360 s si se define, o 0 para sin expiración
  numRef?: string;     // hasta 7 dígitos
  generateImage?: boolean; // false recomendado
  bankAccountId?: string;
  metadata?: PeyMetadata;
}

export interface CreateCodiQrResponse {
  id: string; // IDC asignado por Banxico
  qrString: string;
  qrImage: string | null;
}

// Request CoDi Push Notification
export interface CreateCodiPnRequest {
  amount: number;
  phoneNumber: string; // 10 dígitos
  concept?: string;
  expiration?: number; // min 360
  numRef?: string;
  bankAccountId?: string;
  metadata?: PeyMetadata;
}

export interface CreateCodiPnResponse {
  transactionId: string;
  codiId: string;
}

// Bank Account Onboarding
export interface RegisterBankAccountRequest {
  alias: string;
  name: string;
  clabe: string;
  entity: 'BUSINESS' | 'PERSON';
}

export interface RegisterBankAccountResponse {
  id: string; // ULID
  codiStatus: CodiStatus;
}

export interface BankAccountDetails {
  id: string;
  alias: string;
  name: string;
  clabe: string;
  entity: 'BUSINESS' | 'PERSON';
  taxId?: string;
  codiStatus: CodiStatus;
  errorMessage?: string;
  dateCreated: number;
}

// Payment Link
export interface CreatePaymentLinkRequest {
  amount: number;
  successUrl: string;
  backUrl: string;
  hasTip?: boolean;
  clientReferenceId?: string;
  metadata?: PeyMetadata;
}

export interface CreatePaymentLinkResponse {
  id: string;
  url: string;
}

export interface PaymentLinkDetails {
  id: string;
  amount: number;
  status: 'pending' | 'processing' | 'paid' | 'partial';
  successUrl: string;
  backUrl: string;
  hasTip: boolean;
  paymentMethods?: string[];
  dateCreated: number;
  clientReferenceId?: string;
  metadata?: Record<string, string>;
  transactions?: PeyTransaction[];
}

// Transaction
export interface PeyTransaction {
  id?: string;
  transactionId?: string;
  status?: 'PENDING' | 'PAID' | string;
  amount: number;
  amountBreakdown?: {
    base?: number;
    tip?: number;
    fee?: number;
  };
  currency?: string;
  paymentMethod: 'CARD' | 'CODI' | string;
  payableType?: 'PAYMENT_LINK' | 'API_CODI_QR' | 'API_CODI_PN' | string;
  payableId?: string;
  description?: string;
  applicationFee?: number;
  dateCreated?: number;
  datePaid?: number;
  metadata?: {
    clabe?: string;
    bankCode?: number;
    accountType?: number;
    description?: string;
    trackingKey?: string;
    externalMetadata?: Record<string, string>;
    [key: string]: unknown;
  };
}

export interface PeyPaginatedResponse<T> {
  items: T[];
  nextToken: string | null;
}

export interface PeyErrorResponse {
  error: {
    message: string;
    type: string;
    requestId?: string;
  };
}
