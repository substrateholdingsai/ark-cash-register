-- Migración 0014: Estado de rastreo en vivo para webhooks de Envia.com
ALTER TABLE shipping_labels ADD COLUMN status TEXT NOT NULL DEFAULT 'LABEL_CREATED';
ALTER TABLE shipping_labels ADD COLUMN last_event_at INTEGER;
ALTER TABLE shipping_labels ADD COLUMN last_checkpoint_json TEXT;
