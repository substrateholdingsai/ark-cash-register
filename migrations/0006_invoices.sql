-- Migración 0006: Facturación CFDI (Facturapi)
CREATE TABLE IF NOT EXISTS fiscal_profiles (
    id TEXT PRIMARY KEY,
    merchant_id TEXT,
    user_id TEXT,
    rfc TEXT NOT NULL,
    razon_social TEXT NOT NULL,
    regimen_fiscal TEXT NOT NULL,
    codigo_postal TEXT NOT NULL,
    uso_cfdi_default TEXT NOT NULL DEFAULT 'G03',
    email TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_fiscal_merchant ON fiscal_profiles(merchant_id);
CREATE INDEX IF NOT EXISTS idx_fiscal_user ON fiscal_profiles(user_id);

CREATE TABLE IF NOT EXISTS invoices (
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
CREATE INDEX IF NOT EXISTS idx_invoices_merchant ON invoices(merchant_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_payment ON invoices(payment_id);
CREATE INDEX IF NOT EXISTS idx_invoices_uuid ON invoices(uuid);
