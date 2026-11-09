-- Migración 0011: Reparar Foreign Keys de ledger_entries e invoices hacia payments
-- Resuelve la referencia residual a payments_old tras el alter table

PRAGMA defer_foreign_keys = ON;
PRAGMA legacy_alter_table = ON;

-- 1. Rebuild ledger_entries apuntando a payments(id)
ALTER TABLE ledger_entries RENAME TO ledger_entries_old;

CREATE TABLE ledger_entries (
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

INSERT INTO ledger_entries SELECT * FROM ledger_entries_old;
DROP TABLE ledger_entries_old;

CREATE INDEX IF NOT EXISTS idx_ledger_merchant_date ON ledger_entries (merchant_id, created_at);

-- 2. Rebuild invoices apuntando a payments(id)
ALTER TABLE invoices RENAME TO invoices_old;

CREATE TABLE invoices (
    id TEXT PRIMARY KEY,
    merchant_id TEXT,
    payment_id TEXT,
    facturapi_id TEXT,
    uuid TEXT,
    serie TEXT,
    folio TEXT,
    rfc_receptor TEXT,
    razon_social_receptor TEXT,
    subtotal REAL NOT NULL DEFAULT 0,
    tax REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'MXN',
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','stamped','cancelled','error')),
    xml_r2_key TEXT,
    pdf_url TEXT,
    cancellation_motive TEXT,
    cancelled_at INTEGER,
    issued_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    error_message TEXT,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id),
    FOREIGN KEY (payment_id) REFERENCES payments(id)
);

INSERT INTO invoices SELECT * FROM invoices_old;
DROP TABLE invoices_old;

CREATE INDEX IF NOT EXISTS idx_invoices_merchant ON invoices(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_payment ON invoices(payment_id);
CREATE INDEX IF NOT EXISTS idx_invoices_uuid ON invoices(uuid);

PRAGMA legacy_alter_table = OFF;
PRAGMA defer_foreign_keys = OFF;
