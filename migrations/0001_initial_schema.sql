-- ARK CASH REGISTER — Migración Inicial D1 (SQLite)
-- Cumple con arquitectura Ark Systems v2.0 + Pey CoDi API v2026-10-20

-- 1. Comercios / Merchants
CREATE TABLE IF NOT EXISTS merchants (
    id TEXT PRIMARY KEY,
    alias TEXT NOT NULL,
    name TEXT NOT NULL,
    clabe TEXT NOT NULL UNIQUE,
    entity TEXT NOT NULL CHECK(entity IN ('BUSINESS', 'PERSON')),
    tax_id TEXT,
    codi_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(codi_status IN ('PENDING', 'PROCESSING', 'ACTIVE', 'ERROR')),
    error_message TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- 2. Pagos y Cobros (Mostrador QR, Push Notification, Link Remoto, Fallback SPEI)
CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    payable_type TEXT NOT NULL CHECK(payable_type IN ('CODI_QR', 'CODI_PN', 'PAYMENT_LINK', 'SPEI_TRANSFER')),
    payable_id TEXT NOT NULL,
    amount REAL NOT NULL,
    concept TEXT,
    num_ref TEXT,
    qr_string TEXT,
    payment_link_url TEXT,
    status TEXT NOT NULL DEFAULT 'WAITING' CHECK(status IN ('WAITING', 'PAID', 'EXPIRED', 'CANCELLED', 'PENDING_SPEI')),
    transaction_id TEXT,
    payment_method TEXT CHECK(payment_method IN ('CODI', 'CARD', 'SPEI')),
    date_created INTEGER NOT NULL,
    date_paid INTEGER,
    metadata TEXT,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id)
);

CREATE INDEX IF NOT EXISTS idx_payments_merchant_status ON payments (merchant_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_payable_id ON payments (payable_id);
CREATE INDEX IF NOT EXISTS idx_payments_transaction_id ON payments (transaction_id);

-- 3. Entradas Contables para Ledger (Integración ARK Compliance)
CREATE TABLE IF NOT EXISTS ledger_entries (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    payment_id TEXT,
    transaction_id TEXT,
    debit_account TEXT NOT NULL,
    credit_account TEXT NOT NULL,
    amount REAL NOT NULL,
    concept TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id),
    FOREIGN KEY (payment_id) REFERENCES payments(id)
);

CREATE INDEX IF NOT EXISTS idx_ledger_merchant_date ON ledger_entries (merchant_id, created_at);

-- 4. Registro y Auditoría de Webhooks Pey
CREATE TABLE IF NOT EXISTS webhook_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    transaction_id TEXT,
    payload TEXT NOT NULL,
    signature TEXT,
    received_at INTEGER NOT NULL,
    processed INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_webhooks_txn ON webhook_events (transaction_id);

-- Merchant Seed por Defecto (Taquería El Güero)
INSERT OR IGNORE INTO merchants (id, alias, name, clabe, entity, tax_id, codi_status, created_at, updated_at)
VALUES (
    '01JBAVWE4NS5TGXHWGMX3KH23Q',
    'Taquería El Güero',
    'Taquería El Güero S.A. de C.V.',
    '012180001234567899',
    'BUSINESS',
    'XAXX010101000',
    'ACTIVE',
    1731000000,
    1731000000
);

