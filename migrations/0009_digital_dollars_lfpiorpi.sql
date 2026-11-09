-- Migración 0009: Dólares Digitales (Solana Pay USDC/USDT) + Monitor LFPIORPI
-- Ecosistema ARK Systems — ark-cash-register

-- 1. Agregar configuración de wallet Solana y Off-ramp al comercio
ALTER TABLE merchants ADD COLUMN solana_wallet TEXT;
ALTER TABLE merchants ADD COLUMN solana_pay_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE merchants ADD COLUMN offramp_provider TEXT;

-- 2. Agregar campos multiriel y multidivisa a payments
ALTER TABLE payments ADD COLUMN payment_rail TEXT NOT NULL DEFAULT 'codi';
ALTER TABLE payments ADD COLUMN currency TEXT NOT NULL DEFAULT 'MXN';
ALTER TABLE payments ADD COLUMN amount_mxn_equiv REAL;
ALTER TABLE payments ADD COLUMN fx_rate REAL;
ALTER TABLE payments ADD COLUMN fx_timestamp INTEGER;
ALTER TABLE payments ADD COLUMN solana_reference TEXT;
ALTER TABLE payments ADD COLUMN solana_signature TEXT;
ALTER TABLE payments ADD COLUMN customer_rfc TEXT;

-- Índices de consulta rápida para reconciliación en cadena
CREATE INDEX IF NOT EXISTS idx_payments_solana_reference ON payments (solana_reference);
CREATE INDEX IF NOT EXISTS idx_payments_rail ON payments (merchant_id, payment_rail);

-- 3. Tabla Inmutable de Evaluaciones LFPIORPI (Ventana móvil 6 meses, UMA y Dictamen SHA-256)
CREATE TABLE IF NOT EXISTS lfpiorpi_evaluaciones (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    customer_rfc TEXT,
    window_start INTEGER NOT NULL,
    window_end INTEGER NOT NULL,
    total_transactions INTEGER NOT NULL DEFAULT 1,
    accumulated_mxn REAL NOT NULL,
    accumulated_uma REAL NOT NULL,
    level TEXT NOT NULL CHECK(level IN ('VERDE', 'IDENTIFICACION', 'AVISO')),
    requires_kyc INTEGER NOT NULL DEFAULT 0,
    requires_notice INTEGER NOT NULL DEFAULT 0,
    dictamen_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
);

CREATE INDEX IF NOT EXISTS idx_lfpiorpi_merchant_customer ON lfpiorpi_evaluaciones(merchant_id, customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lfpiorpi_level ON lfpiorpi_evaluaciones(level);
CREATE INDEX IF NOT EXISTS idx_lfpiorpi_created ON lfpiorpi_evaluaciones(created_at DESC);
