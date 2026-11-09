/**
 * Utilidades para Solana Pay, validación de wallets Base58 y generación de cobros no-custodiales.
 * Especificación oficial Solana Pay Spec v1.0
 */

export const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Valida si una cadena es una dirección pública de Solana válida:
 * - 32 a 44 caracteres de longitud.
 * - Compuesta exclusivamente por el alfabeto Base58 (sin 0, O, I, l).
 */
export function validateSolanaAddress(address: string | null | undefined): { valid: boolean; error?: string } {
  if (!address || typeof address !== 'string') {
    return { valid: false, error: 'La dirección de wallet Solana es requerida' };
  }

  const trimmed = address.trim();
  if (trimmed.length < 32 || trimmed.length > 44) {
    return {
      valid: false,
      error: `La dirección debe tener entre 32 y 44 caracteres (actual: ${trimmed.length})`
    };
  }

  // Verificar caracteres prohibidos explícitamente para dar mejor feedback
  if (/[0OIl]/.test(trimmed)) {
    return {
      valid: false,
      error: 'La dirección contiene caracteres no permitidos en Base58 (0, O, I, l)'
    };
  }

  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  if (!base58Regex.test(trimmed)) {
    return {
      valid: false,
      error: 'La dirección contiene caracteres inválidos para el estándar Base58'
    };
  }

  return { valid: true };
}

/**
 * Genera una referencia criptográfica única en Base58 (32 bytes de entropía).
 * Se utiliza como llave pública efímera para conciliar la transacción en cadena mediante RPC.
 */
export function generateSolanaReference(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  
  // Codificar bytes a Base58
  let digits: number[] = [0];
  for (let i = 0; i < bytes.length; i++) {
    for (let j = 0; j < digits.length; j++) digits[j] <<= 8;
    digits[0] += bytes[i];
    let carry = 0;
    for (let k = 0; k < digits.length; k++) {
      digits[k] += carry;
      carry = (digits[k] / 58) | 0;
      digits[k] %= 58;
    }
    while (carry) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  // Prefijar ceros iniciales
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
    digits.push(0);
  }

  return digits.reverse().map(d => BASE58_ALPHABET[d]).join('');
}

export interface SolanaPayUrlParams {
  recipient: string;
  amount: number;
  splToken: string;
  reference: string;
  label?: string;
  message?: string;
  memo?: string;
}

/**
 * Construye la URL estándar de Solana Pay para renderizar en código QR:
 * solana:<recipient>?amount=<amount>&spl-token=<splToken>&reference=<reference>&label=<label>&message=<message>
 */
export function buildSolanaPayUrl(params: SolanaPayUrlParams): string {
  const { recipient, amount, splToken, reference, label, message, memo } = params;

  // Formato decimal exacto (hasta 6 decimales para tokens SPL como USDC/USDT)
  // Sin redondeos arbitrarios que alteren el monto pactado
  const formattedAmount = Number(amount.toFixed(6)).toString();

  const url = new URL(`solana:${recipient}`);
  url.searchParams.set('amount', formattedAmount);
  url.searchParams.set('spl-token', splToken);
  url.searchParams.set('reference', reference);

  if (label) url.searchParams.set('label', label);
  if (message) url.searchParams.set('message', message);
  if (memo) url.searchParams.set('memo', memo);

  return url.toString();
}
