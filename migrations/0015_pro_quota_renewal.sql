-- Migración 0015: Control de ciclo mensual (30 días) para renovación de cuotas Ark Pro
ALTER TABLE merchants ADD COLUMN last_quota_reset_at INTEGER;
