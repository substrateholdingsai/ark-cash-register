import { describe, it, expect } from 'vitest';
import worker from '../src/index';
import { runProQuotaMaintenance } from '../src/services/proQuotaCron';

describe('Cron de Renovación Automática de Cuotas Ark Pro (scheduled)', () => {
  const NOW = 1_795_000_000;
  const DAY = 86400;

  function createMockDbEnv(initialMerchants: any[]) {
    const merchants = initialMerchants.map(m => ({ ...m }));
    const purgeLogs: any[] = [];

    return {
      _merchants: merchants,
      _purgeLogs: purgeLogs,
      DB: {
        prepare: (query: string) => ({
          bind: (...params: any[]) => ({
            run: async () => {
              if (query.includes("SET tier = 'free'")) {
                const [freeMax1, freeMax2, updatedAt, nowTs] = params;
                let changes = 0;
                for (const m of merchants) {
                  if (m.tier === 'pro' && m.pro_expires_at !== null && m.pro_expires_at !== undefined && m.pro_expires_at < nowTs) {
                    m.tier = 'free';
                    m.ai_photo_credits = m.ai_photo_credits > freeMax1 ? freeMax2 : m.ai_photo_credits;
                    m.updated_at = updatedAt;
                    changes++;
                  }
                }
                return { success: true, meta: { changes } };
              }

              if (query.includes('SET ai_photo_credits = CASE WHEN ai_photo_credits <')) {
                const [minCredits1, minCredits2, resetAt, updatedAt, nowTs, cutoff] = params;
                let changes = 0;
                for (const m of merchants) {
                  const notExpired = m.pro_expires_at === null || m.pro_expires_at === undefined || m.pro_expires_at >= nowTs;
                  const lastCycle = m.last_quota_reset_at ?? m.updated_at ?? m.created_at ?? 0;
                  if (m.tier === 'pro' && notExpired && lastCycle <= cutoff) {
                    m.ai_photo_credits = m.ai_photo_credits < minCredits1 ? minCredits2 : m.ai_photo_credits;
                    m.last_quota_reset_at = resetAt;
                    m.updated_at = updatedAt;
                    changes++;
                  }
                }
                return { success: true, meta: { changes } };
              }

              if (query.includes('INSERT INTO purge_log')) {
                purgeLogs.push({
                  id: params[0],
                  entity: query.includes("'pro_quota_maintenance'") ? 'pro_quota_maintenance' : params[1],
                  records_purged: query.includes("'pro_quota_maintenance'") ? params[1] : params[2],
                  notes: params[params.length - 1]
                });
                return { success: true, meta: { changes: 1 } };
              }

              return { success: true, meta: { changes: 0 } };
            },
            all: async () => ({ results: [] }),
            first: async () => null
          })
        })
      } as any
    };
  }

  it('renueva a 50 créditos a comercios Ark Pro activos cuyo ciclo >= 30 días venció y deja intactos los recientes', async () => {
    const env = createMockDbEnv([
      {
        id: 'M_PRO_DUE',
        tier: 'pro',
        pro_expires_at: NOW + 15 * DAY,
        ai_photo_credits: 4,
        last_quota_reset_at: NOW - 31 * DAY,
        updated_at: NOW - 31 * DAY,
        created_at: NOW - 60 * DAY
      },
      {
        id: 'M_PRO_RECENT',
        tier: 'pro',
        pro_expires_at: NOW + 25 * DAY,
        ai_photo_credits: 42,
        last_quota_reset_at: NOW - 5 * DAY,
        updated_at: NOW - 5 * DAY,
        created_at: NOW - 5 * DAY
      },
      {
        id: 'M_FREE',
        tier: 'free',
        pro_expires_at: null,
        ai_photo_credits: 1,
        last_quota_reset_at: null,
        updated_at: NOW - 45 * DAY,
        created_at: NOW - 45 * DAY
      }
    ]);

    const res = await runProQuotaMaintenance(env as any, NOW);
    expect(res.expiredCount).toBe(0);
    expect(res.renewedCount).toBe(1);

    const due = env._merchants.find(m => m.id === 'M_PRO_DUE')!;
    expect(due.ai_photo_credits).toBe(50);
    expect(due.last_quota_reset_at).toBe(NOW);

    const recent = env._merchants.find(m => m.id === 'M_PRO_RECENT')!;
    expect(recent.ai_photo_credits).toBe(42);

    const free = env._merchants.find(m => m.id === 'M_FREE')!;
    expect(free.ai_photo_credits).toBe(1);
    expect(free.tier).toBe('free');

    // Re-ejecución inmediata no vuelve a renovar (idempotente)
    const res2 = await runProQuotaMaintenance(env as any, NOW + 60);
    expect(res2.renewedCount).toBe(0);
  });

  it('degrada a tier free y topa créditos en 2 cuando pro_expires_at ya venció', async () => {
    const env = createMockDbEnv([
      {
        id: 'M_PRO_EXPIRED',
        tier: 'pro',
        pro_expires_at: NOW - 10,
        ai_photo_credits: 37,
        last_quota_reset_at: NOW - 30 * DAY,
        updated_at: NOW - 30 * DAY,
        created_at: NOW - 60 * DAY
      }
    ]);

    const res = await runProQuotaMaintenance(env as any, NOW);
    expect(res.expiredCount).toBe(1);
    expect(res.renewedCount).toBe(0);

    const expired = env._merchants[0];
    expect(expired.tier).toBe('free');
    expect(expired.ai_photo_credits).toBe(2);
    expect(env._purgeLogs[0].notes).toBe('renewed=0;expired=1');
  });

  it('worker.scheduled ejecuta runProQuotaMaintenance junto con el mantenimiento diario', async () => {
    const env = createMockDbEnv([
      {
        id: 'M_PRO_CRON',
        tier: 'pro',
        pro_expires_at: null,
        ai_photo_credits: 0,
        last_quota_reset_at: 1000,
        updated_at: 1000,
        created_at: 1000
      }
    ]);

    await worker.scheduled({}, env as any, {});
    expect(env._merchants[0].ai_photo_credits).toBe(50);
    expect(env._purgeLogs.some(l => l.entity === 'pro_quota_maintenance')).toBe(true);
  });
});
