-- Migración 0004: Compliance (consentimiento, ARCO, retención, versiones legales)
-- Ecosistema ARK Systems — ark-cash-register

CREATE TABLE IF NOT EXISTS consent_records (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    document TEXT NOT NULL CHECK(document IN ('terms','privacy')),
    version TEXT NOT NULL,
    accepted_at INTEGER NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_consent_user ON consent_records(user_id, document);

CREATE TABLE IF NOT EXISTS arco_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('access','rectification','cancellation','opposition')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','resolved','rejected')),
    details TEXT,
    requested_at INTEGER NOT NULL,
    resolved_at INTEGER,
    resolution_notes TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_arco_user ON arco_requests(user_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS privacy_notice_versions (
    version TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,
    published_at INTEGER NOT NULL,
    is_current INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS terms_versions (
    version TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,
    published_at INTEGER NOT NULL,
    is_current INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS data_retention_policies (
    entity TEXT PRIMARY KEY,
    retention_days INTEGER NOT NULL,
    description TEXT
);

CREATE TABLE IF NOT EXISTS purge_log (
    id TEXT PRIMARY KEY,
    entity TEXT NOT NULL,
    records_purged INTEGER NOT NULL,
    executed_at INTEGER NOT NULL,
    notes TEXT
);

-- Seed versiones iniciales
INSERT OR IGNORE INTO privacy_notice_versions (version, content_hash, published_at, is_current)
VALUES ('1.0', 'initial', 1731000000, 1);

INSERT OR IGNORE INTO terms_versions (version, content_hash, published_at, is_current)
VALUES ('1.0', 'initial', 1731000000, 1);

-- Políticas de retención por defecto
INSERT OR IGNORE INTO data_retention_policies (entity, retention_days, description) VALUES
  ('auth_sessions', 30, 'Sesiones revocadas/expiradas'),
  ('email_tokens', 7, 'Tokens de verificación/reset consumidos'),
  ('audit_log_operational', 365, 'Logs operativos'),
  ('audit_log_fiscal', 1825, 'Logs fiscales (5 años)'),
  ('audit_log_pld', 3650, 'Logs PLD (10 años)'),
  ('deleted_accounts', 30, 'Cuentas soft-deleted antes de anonimizar');
