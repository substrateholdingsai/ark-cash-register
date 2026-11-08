#!/usr/bin/env python3
"""
forge_pey.py — Generador de assets visuales para Ark-cajaregistradora
Diseñado bajo el sistema de diseño ARK SYSTEMS v1.0 / v2.0 (Navy Operativo + Gold Value)
"""

import os

SVG_FAVICON = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <defs>
    <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#F5D97A" />
      <stop offset="100%" stop-color="#D4AF37" />
    </linearGradient>
  </defs>
  <!-- Background Navy -->
  <rect width="64" height="64" rx="16" fill="#002B7F" />
  
  <!-- Cash Register Body -->
  <path d="M14 24 H50 V46 H14 Z" fill="#001A4D" stroke="#E8E0CC" stroke-width="2" rx="4"/>
  
  <!-- Register Display Slot -->
  <rect x="20" y="16" width="24" height="8" rx="2" fill="#FFFFFF" stroke="#001A4D" stroke-width="1.5"/>
  <rect x="23" y="19" width="18" height="2" fill="#16A34A" />

  <!-- CoDi / Check Badge in Gold -->
  <circle cx="32" cy="35" r="7" fill="url(#goldGrad)" />
  <path d="M29 35 L31.5 37.5 L35.5 32.5" fill="none" stroke="#001A4D" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>

  <!-- Cash Drawer Base -->
  <rect x="12" y="46" width="40" height="6" rx="2" fill="#002B7F" stroke="#E8E0CC" stroke-width="1.5"/>
  <circle cx="32" cy="49" r="1.5" fill="#D4AF37"/>
</svg>
"""

SVG_LOGO = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 80" width="320" height="80">
  <defs>
    <linearGradient id="goldLogoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#F5D97A" />
      <stop offset="100%" stop-color="#D4AF37" />
    </linearGradient>
  </defs>
  <!-- Icon -->
  <g transform="translate(10, 8)">
    <rect width="64" height="64" rx="16" fill="#002B7F" />
    <path d="M14 24 H50 V46 H14 Z" fill="#001A4D" stroke="#E8E0CC" stroke-width="2" rx="4"/>
    <rect x="20" y="16" width="24" height="8" rx="2" fill="#FFFFFF" stroke="#001A4D" stroke-width="1.5"/>
    <rect x="23" y="19" width="18" height="2" fill="#16A34A" />
    <circle cx="32" cy="35" r="7" fill="url(#goldLogoGrad)" />
    <path d="M29 35 L31.5 37.5 L35.5 32.5" fill="none" stroke="#001A4D" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="12" y="46" width="40" height="6" rx="2" fill="#002B7F" stroke="#E8E0CC" stroke-width="1.5"/>
    <circle cx="32" cy="49" r="1.5" fill="#D4AF37"/>
  </g>

  <!-- Typography -->
  <text x="86" y="38" font-family="'Inter', sans-serif" font-weight="800" font-size="22" fill="#121A2E" letter-spacing="-0.02em">
    ARK <tspan fill="#002B7F">CAJA</tspan>
  </text>
  <text x="86" y="58" font-family="'Inter', sans-serif" font-weight="600" font-size="12" fill="#6B7A99" letter-spacing="0.08em">
    REGISTRADORA CODI BANXICO
  </text>
</svg>
"""

def generate_assets():
    os.makedirs('public', exist_ok=True)
    
    with open('public/favicon.svg', 'w', encoding='utf-8') as f:
        f.write(SVG_FAVICON)
    print("[OK] Created public/favicon.svg")

    with open('public/logo.svg', 'w', encoding='utf-8') as f:
        f.write(SVG_LOGO)
    print("[OK] Created public/logo.svg")

if __name__ == '__main__':
    generate_assets()
