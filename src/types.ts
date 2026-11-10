export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  R2?: R2Bucket;
  // Workers AI
  AI?: { run: (model: string, input: any) => Promise<any> };
  PEY_API_URL: string;
  PEY_API_KEY?: string;
  PEY_WEBHOOK_SECRET?: string;
  CAJA_STAYPUFT_API_KEY?: string;
  ENVIRONMENT?: string;
  APP_NAME?: string;
  APP_VERSION?: string;
    // Auth soberano
    AUTH_JWT_SECRET?: string;
    AUTH_JWT_SECRET_PREV?: string;
    AUTH_COOKIE_DOMAIN?: string;
    RESEND_API_KEY?: string;
    RESEND_FROM_EMAIL?: string;
    APP_BASE_URL?: string;
    AUTH_MODE?: string;
    PASSWORD_MIN_LENGTH?: string;
    // Compliance
    PRIVACY_NOTICE_VERSION?: string;
    TERMS_VERSION?: string;
    DATA_RETENTION_DAYS?: string;
    // Facturación (Facturapi)
    FACTURAPI_API_KEY?: string;
    FACTURAPI_BASE_URL?: string;
    // Riel Dólares Digitales (Solana Pay)
    SOLANA_RPC_URL?: string;
    HELIUS_API_KEY?: string;
    SOLANA_PAY_GLOBAL_ENABLED?: string; // Bandera global desactivada en v1 ("true" | "false")
    // Riel Tarjetas y Crédito (PayPal / Meses Sin Intereses)
    PAYPAL_CLIENT_ID?: string;
    PAYPAL_CLIENT_SECRET?: string;
    PAYPAL_ENVIRONMENT?: 'sandbox' | 'live';
    // Logística y Envíos (Envia.com multicarrier)
    ENVIA_API_KEY?: string;
    ENVIA_SANDBOX?: string;
  }

export const CODI_MAX_MXN = 8000;

// Constantes oficiales SPL Tokens Solana (Mints en Mainnet-beta)
export const SOLANA_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // 6 decimales
export const SOLANA_USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'; // 6 decimales
export const SOLANA_TOKEN_DECIMALS = 6;

// Compliance LFPIORPI (Art. 17 Fracción XVI / UMA oficial)
export const UMA_DIARIA_2026_MXN = 113.14;
export const LFPIORPI_UMBRAL_AVISO_UMA = 210; // 210 UMA -> Aviso obligatorio a la UIF
export const LFPIORPI_UMBRAL_IDENTIFICACION_RATIO = 0.70; // 70% del umbral de Aviso (147 UMA) para requerir RFC/ID
export const LFPIORPI_VENTANA_DIAS = 180; // Ventana móvil de 6 meses (180 días)

export type CodiStatus = 'PENDING' | 'PROCESSING' | 'ACTIVE' | 'ERROR';
export type PaymentStatus = 'WAITING' | 'PAID' | 'EXPIRED' | 'CANCELLED' | 'PENDING_SPEI' | 'MANUAL_REVIEW';
export type PayableType = 'CODI_QR' | 'CODI_PN' | 'PAYMENT_LINK' | 'SPEI_TRANSFER' | 'SOLANA_PAY' | 'PAYPAL_ORDER';
export type PaymentRail = 'codi' | 'spei' | 'solana_usdc' | 'solana_usdt' | 'paypal';
export type PaymentCurrency = 'MXN' | 'USDC' | 'USDT';
export type MerchantTier = 'free' | 'pro' | 'enterprise';

export type LfpiorpiLevel = 'VERDE' | 'IDENTIFICACION' | 'AVISO';

export interface LfpiorpiEvaluation {
  id: string;
  merchantId: string;
  customerId: string;
  customerRfc?: string;
  windowStart: number;
  windowEnd: number;
  totalTransactions: number;
  accumulatedMxn: number;
  accumulatedUma: number;
  level: LfpiorpiLevel;
  percentageOfThreshold: number;
  requiresKyc: boolean;
  requiresNotice: boolean;
  dictamenHash: string;
  createdAt: number;
}

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
