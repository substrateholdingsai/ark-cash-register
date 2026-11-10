-- Migración 0013: Logística y Envíos Nacionales con Envia.com (Exclusivo Ark Pro)

-- Dirección de origen del comercio para recolecciones
ALTER TABLE merchants ADD COLUMN origin_street TEXT DEFAULT 'Av. Kukulcán';
ALTER TABLE merchants ADD COLUMN origin_number TEXT DEFAULT 'Km 12';
ALTER TABLE merchants ADD COLUMN origin_district TEXT DEFAULT 'Zona Hotelera';
ALTER TABLE merchants ADD COLUMN origin_city TEXT DEFAULT 'Tulum';
ALTER TABLE merchants ADD COLUMN origin_state TEXT DEFAULT 'ROO';
ALTER TABLE merchants ADD COLUMN origin_postal_code TEXT DEFAULT '77780';
ALTER TABLE merchants ADD COLUMN origin_country TEXT DEFAULT 'MX';
ALTER TABLE merchants ADD COLUMN envia_api_key TEXT;

-- Datos de envío en pagos/órdenes
ALTER TABLE payments ADD COLUMN shipping_carrier TEXT;
ALTER TABLE payments ADD COLUMN shipping_service TEXT;
ALTER TABLE payments ADD COLUMN shipping_tracking_number TEXT;
ALTER TABLE payments ADD COLUMN shipping_tracking_url TEXT;
ALTER TABLE payments ADD COLUMN shipping_label_url TEXT;
ALTER TABLE payments ADD COLUMN shipping_cost REAL DEFAULT 0;
ALTER TABLE payments ADD COLUMN shipping_address_json TEXT;

-- Tabla de guías de envío generadas
CREATE TABLE IF NOT EXISTS shipping_labels (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  payment_id TEXT,
  order_reference TEXT,
  carrier TEXT NOT NULL,
  service TEXT NOT NULL,
  tracking_number TEXT NOT NULL,
  tracking_url TEXT NOT NULL,
  label_url TEXT NOT NULL,
  cost_mxn REAL NOT NULL,
  is_simulated INTEGER NOT NULL DEFAULT 1,
  destination_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shipping_labels_merchant ON shipping_labels(merchant_id);
CREATE INDEX IF NOT EXISTS idx_shipping_labels_tracking ON shipping_labels(tracking_number);
