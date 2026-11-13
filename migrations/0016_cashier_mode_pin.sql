-- Migración 0016: Modo Cajero con PIN de 4 dígitos y control de turnos
ALTER TABLE merchants ADD COLUMN cashier_pin_hash TEXT;
ALTER TABLE merchants ADD COLUMN cashier_mode_enabled INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS cashier_shifts (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    operator_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN',
    opening_cash_mxn REAL NOT NULL DEFAULT 0,
    closing_cash_mxn REAL,
    opened_at INTEGER NOT NULL,
    closed_at INTEGER,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cashier_shifts_merchant_status ON cashier_shifts(merchant_id, status);
