-- Migración 0010: Riel de Pagos con Tarjeta y Meses Sin Intereses (PayPal)
-- Ecosistema ARK Systems — ark-cash-register

ALTER TABLE merchants ADD COLUMN paypal_client_id TEXT;
ALTER TABLE merchants ADD COLUMN paypal_client_secret TEXT;
ALTER TABLE merchants ADD COLUMN paypal_enabled INTEGER NOT NULL DEFAULT 0;

ALTER TABLE payments ADD COLUMN paypal_order_id TEXT;
ALTER TABLE payments ADD COLUMN paypal_capture_id TEXT;

CREATE INDEX IF NOT EXISTS idx_payments_paypal_order ON payments (paypal_order_id);
