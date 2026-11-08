export interface CatalogItem {
  id: string;
  name: string;
  price: number;
  icon: string;
  category: string;
  description?: string;
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
  items: CatalogItem[];
  promoRule?: {
    minQty: number;
    discountAmount: number;
    description: string;
  };
}

export const TAQUERIA_CATALOG: MerchantCatalog = {
  merchantId: '01JBAVWE4NS5TGXHWGMX3KH23Q',
  brandName: 'Taquería El Güero',
  tagline: 'Tacos al Pastor y Especialidades de Mostrador',
  emoji: '🌮',
  currency: 'MXN',
  items: [
    { id: 'tq-pastor', name: 'Orden Pastor (5 tacos)', price: 95, icon: '🌮', category: 'Tacos' },
    { id: 'tq-gringa', name: 'Gringa de Pastor con Queso', price: 55, icon: '🧀', category: 'Especialidades' },
    { id: 'tq-asada', name: 'Orden Asada o Suadero', price: 110, icon: '🥩', category: 'Tacos' },
    { id: 'tq-volcan', name: 'Volcán de Queso y Pastor', price: 40, icon: '🌋', category: 'Especialidades' },
    { id: 'tq-refresco', name: 'Refresco Vidrio 355ml', price: 35, icon: '🥤', category: 'Bebidas' },
    { id: 'tq-aguafresca', name: 'Agua de Horchata / Jamaica 1L', price: 45, icon: '🍹', category: 'Bebidas' },
    { id: 'tq-combo', name: 'Combo Taquero (Pastor + Gringa + Refresco)', price: 165, icon: '🔥', category: 'Combos' }
  ],
  promoRule: {
    minQty: 3,
    discountAmount: 20,
    description: 'Promo Antojo (3+ órdenes $20 OFF)'
  }
};

export const SKINLAB_CATALOG: MerchantCatalog = {
  merchantId: '01JBAVSKINLAB0000000000000',
  brandName: 'SkinLab Clothing Club',
  tagline: 'Streetwear & Beachwear Caribe · Marea Collection',
  emoji: '🌊',
  currency: 'MXN',
  items: [
    { id: 'sl-nocturna', name: 'Playera Ola Nocturna (DTF)', price: 299, icon: '👕', category: 'Playeras' },
    { id: 'sl-tulum', name: 'Playera Sol de Tulum (DTF)', price: 349, icon: '☀️', category: 'Playeras' },
    { id: 'sl-selva', name: 'Playera Espíritu Selva', price: 299, icon: '🌴', category: 'Playeras' },
    { id: 'sl-gorra', name: 'Gorra Trucker SkinLab Club', price: 199, icon: '🧢', category: 'Accesorios' },
    { id: 'sl-hoodie', name: 'Hoodie Oversize Caribe', price: 699, icon: '🧥', category: 'Abrigo' },
    { id: 'sl-tote', name: 'Tote Bag Algodón Marino', price: 149, icon: '👜', category: 'Accesorios' }
  ],
  promoRule: {
    minQty: 2,
    discountAmount: 49,
    description: 'Promo 2+ Playeras ($49 OFF)'
  }
};

export function getCatalogForMerchant(merchantId: string): MerchantCatalog {
  if (
    merchantId === '01JBAVSKINLAB0000000000000' || 
    merchantId.toLowerCase().includes('skinlab') || 
    merchantId.toLowerCase().includes('marea')
  ) {
    return SKINLAB_CATALOG;
  }
  return TAQUERIA_CATALOG;
}
