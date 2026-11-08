// Backup soberano de D1 a R2 (JSON por tabla). Sin dependencias externas.

const TABLES = [
  'merchants', 'payments', 'ledger_entries', 'webhook_events', 'daily_closes',
  'operator_audit_log', 'users', 'auth_sessions', 'email_verification_tokens',
  'password_reset_tokens', 'auth_audit_log', 'consent_records', 'arco_requests',
  'fiscal_profiles', 'invoices', 'user_mfa'
];

export async function runBackup(env: any): Promise<{ key: string; tables: number; records: number }> {
  if (!env.DB) throw new Error('D1 no configurado');
  if (!env.R2) throw new Error('R2 no configurado');
  const now = Math.floor(Date.now() / 1000);
  const date = new Date(now * 1000).toISOString().replace(/[:.]/g, '-');
  const snapshot: Record<string, any[]> = {};
  let total = 0;
  for (const t of TABLES) {
    try {
      const res = await env.DB.prepare(`SELECT * FROM ${t}`).all();
      const rows = res.results || [];
      snapshot[t] = rows;
      total += rows.length;
    } catch {
      snapshot[t] = [];
    }
  }
  const key = `backups/d1-snapshot-${date}.json`;
  await env.R2.put(key, JSON.stringify({ generatedAt: now, tables: snapshot }), {
    httpMetadata: { contentType: 'application/json' }
  });
  return { key, tables: TABLES.length, records: total };
}
