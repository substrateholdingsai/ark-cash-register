// SEED DEMO — reemplazar con catálogo real cuando Pablo confirme precios y productos oficiales
// Ecosistema Ark Cash Register — Catálogo multi-tenant para Storefront y Mostrador

export interface CatalogItem {
  id: string;
  name: string;
  price: number;
  icon: string;
  category: string;
  description?: string;
  variants?: string[]; // Ej: ['S', 'M', 'L', 'XL'] o ['Con todo', 'Sin cebolla']
  available?: boolean; // true por defecto; false si está agotado o desactivado
}

export interface CatalogRule {
  minQty?: number;
  discountAmount?: number;
  description?: string;
}

export interface MerchantCatalog {
  merchantId: string;
  brandName: string;
  tagline: string;
  emoji: string;
  currency: string;
  whatsappPhone: string; // Formato internacional sin + ni espacios
  items: CatalogItem[];
  promoRule?: {
    minQty: number;
    discountAmount: number;
    description: string;
  };
}

// SEED DEMO — Taquería El Güero (reemplazar con menú y precios finales de Pablo)
export const TAQUERIA_CATALOG: MerchantCatalog = {
  merchantId: '01JBAVWE4NS5TGXHWGMX3KH23Q',
  brandName: 'Taquería El Güero',
  tagline: 'Tacos al Pastor al Carbón y Especialidades de Mostrador',
  emoji: '🌮',
  currency: 'MXN',
  whatsappPhone: '5219992968446',
  items: [
    { id: 'tq-pastor', name: 'Tacos al Pastor (Orden 5)', price: 95, icon: '🌮', category: 'Tacos', description: 'Carne al trompo, piña, cebolla y cilantro', variants: ['Con todo', 'Sin cebolla', 'Sin verdura'] },
    { id: 'tq-bistec', name: 'Tacos de Bistec (Orden 4)', price: 110, icon: '🥩', category: 'Tacos', description: 'Bistec fino a la plancha con cebollita asada', variants: ['Con todo', 'Sin cebolla', 'Con queso (+$15)'] },
    { id: 'tq-suadero', name: 'Tacos de Suadero (Orden 4)', price: 105, icon: '🍖', category: 'Tacos', description: 'Suadero confitado suave estilo CDMX', variants: ['Con todo', 'Dorado', 'Suave'] },
    { id: 'tq-gringa', name: 'Gringa de Pastor con Queso', price: 55, icon: '🧀', category: 'Especialidades', description: 'Tortilla de harina con queso gouda fundido', variants: ['Normal', 'Doble queso (+$15)'] },
    { id: 'tq-cebollitas', name: 'Orden de Cebollitas Cambray', price: 30, icon: '🧅', category: 'Especialidades', description: 'Asadas al carbón con salsa inglesa y maggi' },
    { id: 'tq-refresco', name: 'Refresco Vidrio 355ml', price: 35, icon: '🥤', category: 'Bebidas', variants: ['Coca-Cola', 'Boing Mango', 'Manzanita'] },
    { id: 'tq-aguafresca', name: 'Agua Fresca Artesanal 1L', price: 45, icon: '🍹', category: 'Bebidas', variants: ['Horchata', 'Jamaica'] }
  ],
  promoRule: {
    minQty: 3,
    discountAmount: 20,
    description: 'Promo Antojo (3+ órdenes $20 OFF)'
  }
};

// SEED DEMO — SkinLab Clothing Club (reemplazar con catálogo y precios finales de Pablo)
export const SKINLAB_CATALOG: MerchantCatalog = {
  merchantId: '01JBAVSKINLAB0000000000000',
  brandName: 'SkinLab Clothing Club',
  tagline: 'Streetwear & Beachwear Caribe · Marea Collection',
  emoji: '🌊',
  currency: 'MXN',
  whatsappPhone: '5219992968446',
  items: [
    { id: 'sl-nocturna', name: 'Playera Ola Nocturna (DTF)', price: 299, icon: '👕', category: 'Playeras', description: 'Algodón peinado 240 GSM, tacto suave', variants: ['S', 'M', 'L', 'XL'] },
    { id: 'sl-tulum', name: 'Playera Sol de Tulum (DTF)', price: 349, icon: '☀️', category: 'Playeras', description: 'Estampa dorsal inspirada en la costa maya', variants: ['S', 'M', 'L', 'XL'] },
    { id: 'sl-selva', name: 'Playera Espíritu Selva', price: 299, icon: '🌴', category: 'Playeras', description: 'Algodón premium con serigrafía discharge', variants: ['S', 'M', 'L', 'XL'] },
    { id: 'sl-hoodie', name: 'Hoodie Oversize Caribe', price: 699, icon: '🧥', category: 'Hoodies', description: 'Felpa perchada 380 GSM con gorro doble', variants: ['M', 'L', 'XL'] },
    { id: 'sl-gorra', name: 'Gorra Trucker SkinLab Club', price: 199, icon: '🧢', category: 'Accesorios', description: 'Gorra estructurada con bordado 3D' },
    { id: 'sl-tote', name: 'Tote Bag Algodón Marino', price: 149, icon: '👜', category: 'Accesorios', description: 'Lona gruesa 100% algodón ecológico' }
  ],
  promoRule: {
    minQty: 2,
    discountAmount: 49,
    description: 'Promo 2+ Playeras ($49 OFF)'
  }
};

export function getCatalogForMerchant(merchantId: string): MerchantCatalog {
  const norm = (merchantId || '').toLowerCase().trim();
  if (
    norm === '01jbavskinlab0000000000000' || 
    norm.includes('skinlab') || 
    norm.includes('marea') ||
    norm.includes('clothing') ||
    norm.includes('ropa')
  ) {
    return SKINLAB_CATALOG;
  }
  return TAQUERIA_CATALOG;
}
