import { Env } from '../types';
import { generateUlid } from '../utils/ulid';

const THIRTY_DAYS_SECONDS = 30 * 86400;
const PRO_MONTHLY_AI_CREDITS = 50;
const FREE_MAX_AI_CREDITS = 2;

export interface ProQuotaMaintenanceResult {
  expiredCount: number;
  renewedCount: number;
}

/**
 * Ejecuta el mantenimiento periódico de suscripciones Ark Pro:
 * 1. Degrada a 'free' los comercios cuya fecha pro_expires_at ya venció.
 * 2. Renueva a 50 créditos de fotos IA a los comercios 'pro' activos cuyo último reset fue hace >= 30 días.
 */
export async function runProQuotaMaintenance(
  env: Env,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<ProQuotaMaintenanceResult> {
  if (!env.DB) {
    return { expiredCount: 0, renewedCount: 0 };
  }

  // 1. Expirar suscripciones Ark Pro vencidas
  const expireRes: any = await env.DB.prepare(`
    UPDATE merchants
    SET tier = 'free',
        ai_photo_credits = CASE WHEN ai_photo_credits > ? THEN ? ELSE ai_photo_credits END,
        updated_at = ?
    WHERE tier = 'pro'
      AND pro_expires_at IS NOT NULL
      AND pro_expires_at < ?
  `).bind(FREE_MAX_AI_CREDITS, FREE_MAX_AI_CREDITS, nowSeconds, nowSeconds).run();

  const expiredCount = Number(expireRes?.meta?.changes ?? expireRes?.changes ?? 0);

  // 2. Renovar cuota mensual (50 créditos) a comercios Ark Pro activos con >= 30 días desde el último ciclo
  const cycleCutoff = nowSeconds - THIRTY_DAYS_SECONDS;
  const renewRes: any = await env.DB.prepare(`
    UPDATE merchants
    SET ai_photo_credits = CASE WHEN ai_photo_credits < ? THEN ? ELSE ai_photo_credits END,
        last_quota_reset_at = ?,
        updated_at = ?
    WHERE tier = 'pro'
      AND (pro_expires_at IS NULL OR pro_expires_at >= ?)
      AND COALESCE(last_quota_reset_at, updated_at, created_at, 0) <= ?
  `).bind(
    PRO_MONTHLY_AI_CREDITS,
    PRO_MONTHLY_AI_CREDITS,
    nowSeconds,
    nowSeconds,
    nowSeconds,
    cycleCutoff
  ).run();

  const renewedCount = Number(renewRes?.meta?.changes ?? renewRes?.changes ?? 0);

  // 3. Registrar auditoría en purge_log (best-effort)
  try {
    await env.DB.prepare(`
      INSERT INTO purge_log (id, entity, records_purged, executed_at, notes)
      VALUES (?, 'pro_quota_maintenance', ?, ?, ?)
    `).bind(
      generateUlid(),
      expiredCount + renewedCount,
      nowSeconds,
      `renewed=${renewedCount};expired=${expiredCount}`
    ).run();
  } catch (err) {
    console.warn('[ProQuotaCron] No se pudo escribir en purge_log:', err);
  }

  return { expiredCount, renewedCount };
}
