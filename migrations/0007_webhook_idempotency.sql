-- Migración 0007: Idempotencia estricta en webhooks y tracking de reintentos
-- Ecosistema ARK Systems — ark-cash-register

-- 1. Agregar columnas para clave de idempotencia, validación HMAC y estado de procesamiento
ALTER TABLE webhook_events ADD COLUMN idempotency_key TEXT;
ALTER TABLE webhook_events ADD COLUMN hmac_valid INTEGER NOT NULL DEFAULT 1;
ALTER TABLE webhook_events ADD COLUMN is_duplicate INTEGER NOT NULL DEFAULT 0;
ALTER TABLE webhook_events ADD COLUMN processing_status TEXT NOT NULL DEFAULT 'COMPLETED';
ALTER TABLE webhook_events ADD COLUMN error_message TEXT;

-- 2. Índice único para garantizar idempotencia estricta a nivel base de datos
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_events_idempotency ON webhook_events(idempotency_key);
