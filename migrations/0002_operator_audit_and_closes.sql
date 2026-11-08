-- Migración 0002: Tablas para auditoría de operador y registro histórico de cortes de caja
-- Ecosistema ARK Systems — Conector StayPuft

-- 1. Historial de Cortes de Caja (Cierre de Día)
CREATE TABLE IF NOT EXISTS daily_closes (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    cut_date TEXT NOT NULL,
    total_sales REAL NOT NULL DEFAULT 0,
    total_paid REAL NOT NULL DEFAULT 0,
    total_transactions INTEGER NOT NULL DEFAULT 0,
    ceremonial_title TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
);

CREATE INDEX IF NOT EXISTS idx_daily_closes_merchant ON daily_closes (merchant_id, created_at);

-- 2. Log de Auditoría Inmutable del Operador (StayPuft)
CREATE TABLE IF NOT EXISTS operator_audit_log (
    id TEXT PRIMARY KEY,
    operator TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    method TEXT NOT NULL,
    merchant_id TEXT,
    payment_id TEXT,
    status_code INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    error TEXT,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_operator_audit_created ON operator_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operator_audit_endpoint ON operator_audit_log (endpoint);
