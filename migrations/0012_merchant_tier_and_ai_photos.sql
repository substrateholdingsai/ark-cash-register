-- Migración 0012: Arquitectura Freemium (Plan Free vs Pro) y Generación de Fotos de Producto con IA
-- Ecosistema ARK Systems — ark-cash-register

ALTER TABLE merchants ADD COLUMN tier TEXT NOT NULL DEFAULT 'free';
ALTER TABLE merchants ADD COLUMN pro_expires_at INTEGER;
ALTER TABLE merchants ADD COLUMN ai_photo_credits INTEGER NOT NULL DEFAULT 2;

CREATE TABLE IF NOT EXISTS catalog_images (
    id TEXT PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    prompt TEXT NOT NULL,
    prompt_hash TEXT NOT NULL,
    image_url TEXT NOT NULL,
    r2_key TEXT,
    model_used TEXT NOT NULL DEFAULT '@cf/black-forest-labs/flux-1-schnell',
    created_at INTEGER NOT NULL,
    FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_catalog_images_merchant ON catalog_images(merchant_id);
CREATE INDEX IF NOT EXISTS idx_catalog_images_product ON catalog_images(product_id);
