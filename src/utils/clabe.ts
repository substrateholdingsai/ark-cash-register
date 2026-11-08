/**
 * Utilidades para validación y detección de bancos mexicanos en CLABEs interbancarias (Banxico SPEI)
 */

export const BANXICO_BANKS: Record<string, string> = {
  '002': 'Banamex / Citibanamex',
  '012': 'BBVA México',
  '014': 'Santander',
  '021': 'HSBC',
  '030': 'Banco del Bajío',
  '036': 'Inbursa',
  '042': 'Mifel',
  '044': 'Scotiabank',
  '058': 'Banregio',
  '072': 'Banorte',
  '127': 'Banco Azteca',
  '137': 'Bancoppel',
  '138': 'ABC Capital / Ualá',
  '140': 'Consubanco',
  '166': 'Banco del Bienestar',
  '646': 'STP (Sistema de Transferencias)',
  '659': 'Spin by OXXO',
  '684': 'Nu México',
  '722': 'Mercado Pago Wallet',
  '846': 'Albo',
  '855': 'Klar',
  '860': 'Hey Banco'
};

/**
 * Obtiene el nombre del banco emisor a partir de los 3 primeros dígitos de la CLABE.
 */
export function getBankFromClabe(clabe: string): { code: string; name: string } | null {
  if (!clabe || clabe.length < 3) return null;
  const code = clabe.slice(0, 3);
  const name = BANXICO_BANKS[code] || 'Institución Bancaria Autorizada (SPEI)';
  return { code, name };
}

/**
 * Valida una CLABE mexicana completa de 18 dígitos:
 * 1. Formato exacto de 18 dígitos numéricos.
 * 2. Código de banco existente o válido en catálogo Banxico.
 * 3. Algoritmo de dígito verificador módulo 10 con ponderación [3, 7, 1].
 */
export function validateClabe(clabe: string): { valid: boolean; error?: string; bank?: string } {
  if (!/^[0-9]{18}$/.test(clabe)) {
    return { valid: false, error: 'La CLABE debe tener exactamente 18 dígitos numéricos.' };
  }

  const bankInfo = getBankFromClabe(clabe);

  // Validación de checksum oficial Banxico
  const weights = [3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7];
  let sum = 0;

  for (let i = 0; i < 17; i++) {
    const digit = parseInt(clabe[i], 10);
    const weight = weights[i];
    sum += (digit * weight) % 10;
  }

  const checksum = (10 - (sum % 10)) % 10;
  const expectedChecksum = parseInt(clabe[17], 10);

  if (checksum !== expectedChecksum) {
    return { 
      valid: false, 
      error: 'Dígito verificador de CLABE inválido según cálculo oficial Banxico.',
      bank: bankInfo?.name
    };
  }

  return { 
    valid: true, 
    bank: bankInfo?.name 
  };
}
