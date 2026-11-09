/**
 * Evaluador LFPIORPI — Actividades Vulnerables y Activos Virtuales
 * Implementa el Monitor LFPIORPI (Herramienta #17 de Ark Ledger)
 * Ley Federal para la Prevención e Identificación de Operaciones con Recursos de Procedencia Ilícita (LFPIORPI)
 * Artículo 17 Fracción XVI (Activos Virtuales) y criterios de acumulación semestral móvil.
 */

import { sha256Hex } from '../utils/crypto';
import { generateUlid } from '../utils/ulid';
import {
  UMA_DIARIA_2026_MXN,
  LFPIORPI_UMBRAL_AVISO_UMA,
  LFPIORPI_UMBRAL_IDENTIFICACION_RATIO,
  LFPIORPI_VENTANA_DIAS,
  LfpiorpiEvaluation,
  LfpiorpiLevel
} from '../types';

export interface EvaluacionInput {
  merchantId: string;
  customerId: string;
  customerRfc?: string;
  currentAmountMxn: number;
  db?: any;
}

export interface DictamenLFPIORPI {
  id: string;
  merchantId: string;
  customerId: string;
  customerRfc: string | null;
  timestamp: number;
  windowStart: number;
  windowEnd: number;
  totalTransactions: number;
  accumulatedMxn: number;
  accumulatedUma: number;
  level: LfpiorpiLevel;
  percentageOfThreshold: number;
  requiresKyc: boolean;
  requiresNotice: boolean;
  alertMessage: string;
  umaRate: number;
  dictamenHash: string;
}

/**
 * Servicio compartido evaluadorActividadesVulnerables:
 * Evalúa el acumulado móvil de 6 meses de un cliente contra los umbrales regulatorios de la LFPIORPI.
 */
export async function evaluadorActividadesVulnerables(input: EvaluacionInput): Promise<DictamenLFPIORPI> {
  const { merchantId, customerId, customerRfc, currentAmountMxn, db } = input;
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (LFPIORPI_VENTANA_DIAS * 86400);

  let pastMxnTotal = 0;
  let transactionCount = 1;

  // Consultar historial de los últimos 6 meses en D1
  if (db) {
    try {
      // Los pagos confirmados pueden ser MXN directo o amount_mxn_equiv para USDC/USDT
      const historyRes: any = await db.prepare(`
        SELECT COUNT(*) as count, 
               COALESCE(SUM(CASE 
                 WHEN currency = 'MXN' THEN amount 
                 ELSE COALESCE(amount_mxn_equiv, amount * 20.0) 
               END), 0) as total_mxn
        FROM payments
        WHERE merchant_id = ? 
          AND (json_extract(metadata, '$.customer') = ? OR json_extract(metadata, '$.customerId') = ? OR json_extract(metadata, '$.customerRfc') = ?)
          AND status = 'PAID'
          AND date_created >= ?
      `).bind(merchantId, customerId, customerId, customerRfc || customerId, windowStart).first();

      if (historyRes) {
        pastMxnTotal = Number(historyRes.total_mxn || 0);
        transactionCount = Number(historyRes.count || 0) + 1;
      }
    } catch (dbErr) {
      console.warn('[LFPIORPI Evaluator DB Warning]', dbErr);
    }
  }

  const accumulatedMxn = pastMxnTotal + currentAmountMxn;
  const accumulatedUma = Number((accumulatedMxn / UMA_DIARIA_2026_MXN).toFixed(2));
  const percentageOfThreshold = Number(((accumulatedUma / LFPIORPI_UMBRAL_AVISO_UMA) * 100).toFixed(2));

  // Clasificación de Nivel según LFPIORPI
  // Umbral Aviso: 210 UMA
  // Umbral Identificación: 70% de 210 UMA = 147 UMA
  let level: LfpiorpiLevel = 'VERDE';
  let requiresKyc = false;
  let requiresNotice = false;
  let alertMessage = 'Operación dentro de parámetros ordinarios (Nivel Verde).';

  if (accumulatedUma >= LFPIORPI_UMBRAL_AVISO_UMA) {
    level = 'AVISO';
    requiresKyc = true;
    requiresNotice = true;
    alertMessage = 'Esta operación requiere aviso ante la UIF (superó umbral de 210 UMA en ventana móvil semestral).';
  } else if (accumulatedUma >= (LFPIORPI_UMBRAL_AVISO_UMA * LFPIORPI_UMBRAL_IDENTIFICACION_RATIO)) {
    level = 'IDENTIFICACION';
    requiresKyc = true;
    requiresNotice = false;
    alertMessage = 'Este cliente requiere integrar expediente de identificación (superó el 70% del umbral de Aviso).';
  }

  // Generación de Dictamen Criptográfico Inmutable con SHA-256
  const evalId = generateUlid();
  const canonicalPayload = JSON.stringify({
    evalId,
    merchantId,
    customerId,
    customerRfc: customerRfc || null,
    windowStart,
    windowEnd: now,
    accumulatedMxn,
    accumulatedUma,
    level,
    requiresKyc,
    requiresNotice,
    umaRate: UMA_DIARIA_2026_MXN,
    timestamp: now
  });

  const dictamenHash = await sha256Hex(canonicalPayload);

  // Persistir en D1 lfpiorpi_evaluaciones si DB disponible
  if (db) {
    try {
      await db.prepare(`
        INSERT INTO lfpiorpi_evaluaciones (
          id, merchant_id, customer_id, customer_rfc, window_start, window_end,
          total_transactions, accumulated_mxn, accumulated_uma, level,
          requires_kyc, requires_notice, dictamen_hash, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        evalId,
        merchantId,
        customerId,
        customerRfc || null,
        windowStart,
        now,
        transactionCount,
        accumulatedMxn,
        accumulatedUma,
        level,
        requiresKyc ? 1 : 0,
        requiresNotice ? 1 : 0,
        dictamenHash,
        now
      ).run();
    } catch (saveErr) {
      console.warn('[LFPIORPI Persist Warning]', saveErr);
    }
  }

  return {
    id: evalId,
    merchantId,
    customerId,
    customerRfc: customerRfc || null,
    timestamp: now,
    windowStart,
    windowEnd: now,
    totalTransactions: transactionCount,
    accumulatedMxn,
    accumulatedUma,
    level,
    percentageOfThreshold,
    requiresKyc,
    requiresNotice,
    alertMessage,
    umaRate: UMA_DIARIA_2026_MXN,
    dictamenHash
  };
}
