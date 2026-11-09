-- Migración 0008: Soporte para pagos SPEI manuales y fallback de montos altos (> $8,000 MXN)
-- Ecosistema ARK Systems — ark-cash-register
-- Permite payable_type = 'SPEI_TRANSFER', status = 'PENDING_SPEI' y payment_method = 'SPEI'

PRAGMA defer_foreign_keys = ON;
PRAGMA legacy_alter_table = ON;

ALTER TABLE payments RENAME TO payments_old;

CREATE TABLE payments (
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

INSERT INTO payments SELECT * FROM payments_old;

DROP TABLE payments_old;

PRAGMA legacy_alter_table = OFF;
PRAGMA defer_foreign_keys = OFF;

CREATE INDEX IF NOT EXISTS idx_payments_merchant_status ON payments (merchant_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_payable_id ON payments (payable_id);
CREATE INDEX IF NOT EXISTS idx_payments_transaction_id ON payments (transaction_id);
