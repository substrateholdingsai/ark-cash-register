#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
forge_ark_cash_register.py — Fábrica Vectorial para Ark Cash Register
=====================================================================
Producto: Ark Cash Register (TPV digital de Ark Systems)
Infraestructura: Pey CoDi® (Banxico)
Stack: stdlib pura (math, random, pathlib, json, argparse)
Salida: SVG + manifest.json en --out

Assets generados:
  1. favicon.svg          64×64   Monograma caja+QR
  2. logo-lockup.svg      640×160 Lockup horizontal
  3. pattern.svg          80×80   Patrón seamless (grid + QR dots)
  4. og-image.svg         1200×630 Landing page hero
  5. divider.svg          1200×8  Divisor temático
  6. mask-arc.svg         400×200 Máscara decorativa
  7. sprite-gremial.svg   240×60  8 símbolos 24×24
  8. badge-pey.svg        180×40  "Powered by Pey" (uso Pey-blue)
  9. manifest.json        Auditoría de pesos
"""

from __future__ import annotations
import math
import random
import sys
import json
import argparse
from pathlib import Path
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# UTF-8 Windows (trampa clásica)
# ---------------------------------------------------------------------------
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

# ---------------------------------------------------------------------------
# Tokens de color (ARK + Pey)
# ---------------------------------------------------------------------------
COLORS = {
    "navy":        "#002B7F",
    "navy-dark":   "#001A4D",
    "navy-soft":   "#E8EEF9",
    "gold":        "#D4AF37",
    "gold-light":  "#F5D97A",
    "ink":         "#121A2E",
    "muted":       "#6B7A99",
    "line":        "#E8E0CC",
    "surface":     "#FFFFFF",
    "pey-blue":    "#0067F1",   # Solo badge Pey
    "pey-soft":    "#E6F0FF",
}

# ---------------------------------------------------------------------------
# Helpers SVG
# ---------------------------------------------------------------------------
def svg_open(w: int, h: int, vb: str | None = None, extra: str = "") -> str:
    vb = vb or f"0 0 {w} {h}"
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="{vb}" {extra}>'

def svg_close() -> str:
    return "</svg>"

def write(path: Path, content: str) -> int:
    path.write_text(content, encoding="utf-8")
    return len(content.encode("utf-8"))

# ---------------------------------------------------------------------------
# 1. FAVICON — Monograma caja + QR
# ---------------------------------------------------------------------------
def build_favicon() -> str:
    # Caja isométrica con QR dots en la cara frontal
    # 64×64, rx=14 en el contenedor
    return f"""{svg_open(64, 64)}
  <defs>
    <clipPath id="c"><rect width="64" height="64" rx="14"/></clipPath>
  </defs>
  <g clip-path="url(#c)">
    <!-- Fondo navy -->
    <rect width="64" height="64" fill="{COLORS['navy']}"/>
    <!-- Cara frontal de la caja (rectángulo con QR dots) -->
    <rect x="14" y="18" width="36" height="32" rx="3" fill="{COLORS['surface']}"/>
    <!-- QR dots 5×5 en la cara -->
    <g fill="{COLORS['ink']}">
      <rect x="18" y="22" width="4" height="4"/>
      <rect x="24" y="22" width="4" height="4"/>
      <rect x="30" y="22" width="4" height="4"/>
      <rect x="36" y="22" width="4" height="4"/>
      <rect x="42" y="22" width="4" height="4"/>
      <rect x="18" y="28" width="4" height="4"/>
      <rect x="30" y="28" width="4" height="4"/>
      <rect x="42" y="28" width="4" height="4"/>
      <rect x="18" y="34" width="4" height="4"/>
      <rect x="24" y="34" width="4" height="4"/>
      <rect x="36" y="34" width="4" height="4"/>
      <rect x="42" y="34" width="4" height="4"/>
      <rect x="18" y="40" width="4" height="4"/>
      <rect x="30" y="40" width="4" height="4"/>
      <rect x="42" y="40" width="4" height="4"/>
    </g>
    <!-- Tapa de la caja (oro, regla del 1 acento) -->
    <rect x="14" y="14" width="36" height="4" rx="1" fill="{COLORS['gold']}"/>
    <!-- Moneda ARK flotante (círculo con A) -->
    <circle cx="48" cy="46" r="10" fill="{COLORS['gold']}"/>
    <text x="48" y="50" font-family="Orbitron,monospace" font-size="11" font-weight="700" fill="{COLORS['navy-dark']}" text-anchor="middle">A</text>
  </g>
{svg_close()}"""

# ---------------------------------------------------------------------------
# 2. LOGO LOCKUP — Horizontal 640×160
# ---------------------------------------------------------------------------
def build_logo_lockup() -> str:
    # Monograma a la izquierda (64×64) + texto "ARK Cash Register" a la derecha
    # "ARK" en Orbitron 700 navy, "Cash Register" en Inter 500 muted
    return f"""{svg_open(640, 160)}
  <!-- Monograma -->
  <g transform="translate(20, 48)">
    <rect width="64" height="64" rx="14" fill="{COLORS['navy']}"/>
    <rect x="12" y="16" width="40" height="36" rx="3" fill="{COLORS['surface']}"/>
    <!-- QR dots -->
    <g fill="{COLORS['ink']}">
      <rect x="16" y="20" width="4" height="4"/>
      <rect x="22" y="20" width="4" height="4"/>
      <rect x="28" y="20" width="4" height="4"/>
      <rect x="34" y="20" width="4" height="4"/>
      <rect x="40" y="20" width="4" height="4"/>
      <rect x="16" y="26" width="4" height="4"/>
      <rect x="28" y="26" width="4" height="4"/>
      <rect x="40" y="26" width="4" height="4"/>
      <rect x="16" y="32" width="4" height="4"/>
      <rect x="22" y="32" width="4" height="4"/>
      <rect x="34" y="32" width="4" height="4"/>
      <rect x="40" y="32" width="4" height="4"/>
      <rect x="16" y="38" width="4" height="4"/>
      <rect x="28" y="38" width="4" height="4"/>
      <rect x="40" y="38" width="4" height="4"/>
    </g>
    <rect x="12" y="12" width="40" height="4" rx="1" fill="{COLORS['gold']}"/>
  </g>
  <!-- Texto -->
  <g transform="translate(110, 70)">
    <text x="0" y="0" font-family="Orbitron, 'Inter', sans-serif" font-size="44" font-weight="700" fill="{COLORS['navy']}" letter-spacing="-0.02em">ARK</text>
    <text x="175" y="0" font-family="'Inter', sans-serif" font-size="44" font-weight="500" fill="{COLORS['ink']}" letter-spacing="-0.01em">Cash Register</text>
    <text x="0" y="24" font-family="'Inter', sans-serif" font-size="11" font-weight="600" fill="{COLORS['muted']}" letter-spacing="0.16em">TPV DIGITAL · POWERED BY PEY</text>
  </g>
  <!-- Línea dorada inferior (regla del 1 acento) -->
  <rect x="110" y="130" width="80" height="2" fill="{COLORS['gold']}"/>
{svg_close()}"""

# ---------------------------------------------------------------------------
# 3. PATTERN — Seamless 80×80 (grid + QR dots, opacidad ≤8%)
# ---------------------------------------------------------------------------
def build_pattern() -> str:
    # Grid de puntos 40×40 + 4 QR dots por celda, opacidad 6%
    return f"""{svg_open(80, 80)}
  <g fill="{COLORS['navy']}" opacity="0.06">
    <!-- Grid de puntos -->
    <circle cx="10" cy="10" r="1"/>
    <circle cx="50" cy="10" r="1"/>
    <circle cx="10" cy="50" r="1"/>
    <circle cx="50" cy="50" r="1"/>
    <!-- QR dots en esquinas de celda -->
    <rect x="20" y="20" width="3" height="3"/>
    <rect x="60" y="20" width="3" height="3"/>
    <rect x="20" y="60" width="3" height="3"/>
    <rect x="60" y="60" width="3" height="3"/>
  </g>
{svg_close()}"""

# ---------------------------------------------------------------------------
# 4. OG IMAGE — 1200×630 (safe zone 100px)
# ---------------------------------------------------------------------------
def build_og_image() -> str:
    # Hero de landing: monograma grande + título + subtítulo + badge Pey
    # Fondo navy con patrón sutil, texto blanco, acento oro
    return f"""{svg_open(1200, 630)}
  <defs>
    <pattern id="p" width="80" height="80" patternUnits="userSpaceOnUse">
      <g fill="{COLORS['surface']}" opacity="0.04">
        <circle cx="10" cy="10" r="1"/>
        <circle cx="50" cy="10" r="1"/>
        <circle cx="10" cy="50" r="1"/>
        <circle cx="50" cy="50" r="1"/>
        <rect x="20" y="20" width="3" height="3"/>
        <rect x="60" y="20" width="3" height="3"/>
        <rect x="20" y="60" width="3" height="3"/>
        <rect x="60" y="60" width="3" height="3"/>
      </g>
    </pattern>
  </defs>
  <!-- Fondo -->
  <rect width="1200" height="630" fill="{COLORS['navy']}"/>
  <rect width="1200" height="630" fill="url(#p)"/>
  <!-- Arco decorativo derecho -->
  <circle cx="1100" cy="315" r="280" fill="none" stroke="{COLORS['gold']}" stroke-width="1" opacity="0.15"/>
  <circle cx="1100" cy="315" r="220" fill="none" stroke="{COLORS['gold']}" stroke-width="1" opacity="0.10"/>
  <!-- Monograma grande izquierdo -->
  <g transform="translate(140, 215)">
    <rect width="200" height="200" rx="40" fill="{COLORS['surface']}"/>
    <rect x="30" y="50" width="140" height="120" rx="8" fill="{COLORS['navy']}"/>
    <!-- QR dots grandes -->
    <g fill="{COLORS['surface']}">
      <rect x="45" y="65" width="15" height="15"/>
      <rect x="70" y="65" width="15" height="15"/>
      <rect x="95" y="65" width="15" height="15"/>
      <rect x="120" y="65" width="15" height="15"/>
      <rect x="145" y="65" width="15" height="15"/>
      <rect x="45" y="90" width="15" height="15"/>
      <rect x="95" y="90" width="15" height="15"/>
      <rect x="145" y="90" width="15" height="15"/>
      <rect x="45" y="115" width="15" height="15"/>
      <rect x="70" y="115" width="15" height="15"/>
      <rect x="120" y="115" width="15" height="15"/>
      <rect x="145" y="115" width="15" height="15"/>
      <rect x="45" y="140" width="15" height="15"/>
      <rect x="95" y="140" width="15" height="15"/>
      <rect x="145" y="140" width="15" height="15"/>
    </g>
    <rect x="30" y="40" width="140" height="10" rx="2" fill="{COLORS['gold']}"/>
  </g>
  <!-- Texto principal (safe zone 100px) -->
  <g transform="translate(400, 280)">
    <text x="0" y="0" font-family="Orbitron, 'Inter', sans-serif" font-size="72" font-weight="700" fill="{COLORS['surface']}" letter-spacing="-0.02em">ARK Cash Register</text>
    <text x="0" y="60" font-family="'Inter', sans-serif" font-size="28" font-weight="400" fill="{COLORS['surface']}" opacity="0.85">La caja registradora digital para el comerciante mexicano</text>
    <text x="0" y="110" font-family="'Inter', sans-serif" font-size="18" font-weight="600" fill="{COLORS['gold']}" letter-spacing="0.12em">COBRA CON CODI® · QR · LINK DE PAGO</text>
  </g>
  <!-- Badge Pey (esquina inferior derecha, safe zone) -->
  <g transform="translate(920, 540)">
    <rect width="180" height="40" rx="20" fill="{COLORS['surface']}" opacity="0.10"/>
    <text x="90" y="25" font-family="'Inter', sans-serif" font-size="12" font-weight="600" fill="{COLORS['surface']}" text-anchor="middle" letter-spacing="0.08em">POWERED BY</text>
    <text x="90" y="38" font-family="Orbitron, sans-serif" font-size="14" font-weight="700" fill="{COLORS['pey-blue']}" text-anchor="middle">PEY · CoDi®</text>
  </g>
  <!-- Línea dorada inferior -->
  <rect x="100" y="580" width="120" height="3" fill="{COLORS['gold']}"/>
{svg_close()}"""

# ---------------------------------------------------------------------------
# 5. DIVIDER — 1200×8
# ---------------------------------------------------------------------------
def build_divider() -> str:
    # Línea navy con punto dorado central (regla del 1 acento)
    return f"""{svg_open(1200, 8)}
  <rect x="0" y="3" width="580" height="2" fill="{COLORS['navy']}" opacity="0.20"/>
  <rect x="620" y="3" width="580" height="2" fill="{COLORS['navy']}" opacity="0.20"/>
  <circle cx="600" cy="4" r="4" fill="{COLORS['gold']}"/>
{svg_close()}"""

# ---------------------------------------------------------------------------
# 6. MASK ARC — 400×200
# ---------------------------------------------------------------------------
def build_mask_arc() -> str:
    # Arco ogival sutil para headers de sección
    return f"""{svg_open(400, 200)}
  <path d="M 0 200 Q 200 0 400 200" fill="none" stroke="{COLORS['navy']}" stroke-width="1" opacity="0.08"/>
  <path d="M 40 200 Q 200 40 360 200" fill="none" stroke="{COLORS['gold']}" stroke-width="1" opacity="0.12"/>
  <path d="M 80 200 Q 200 80 320 200" fill="none" stroke="{COLORS['navy']}" stroke-width="1" opacity="0.05"/>
{svg_close()}"""

# ---------------------------------------------------------------------------
# 7. SPRITE GREMIAL — 8 símbolos 24×24 (stroke 1.5, currentColor)
# ---------------------------------------------------------------------------
def build_sprite() -> str:
    # 8 íconos en fila: caja, qr, ticket, coins, link, check, keypad, clock
    # Todos en currentColor para tema-adaptables
    icons = [
        # 1. Caja registradora
        ('<g stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round">'
         '<rect x="3" y="7" width="18" height="14" rx="2"/>'
         '<line x1="3" y1="12" x2="21" y2="12"/>'
         '<circle cx="8" cy="17" r="1" fill="currentColor" stroke="none"/>'
         '<circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/>'
         '<circle cx="16" cy="17" r="1" fill="currentColor" stroke="none"/>'
         '</g>'),
        # 2. QR
        ('<g stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round">'
         '<rect x="3" y="3" width="7" height="7" rx="1"/>'
         '<rect x="14" y="3" width="7" height="7" rx="1"/>'
         '<rect x="3" y="14" width="7" height="7" rx="1"/>'
         '<rect x="14" y="14" width="3" height="3"/>'
         '<rect x="18" y="14" width="3" height="3"/>'
         '<rect x="14" y="18" width="3" height="3"/>'
         '<rect x="18" y="18" width="3" height="3"/>'
         '</g>'),
        # 3. Ticket / Recibo
        ('<g stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round">'
         '<path d="M 5 3 L 19 3 L 19 21 L 5 21 Z"/>'
         '<line x1="8" y1="8" x2="16" y2="8"/>'
         '<line x1="8" y1="12" x2="16" y2="12"/>'
         '<line x1="8" y1="16" x2="13" y2="16"/>'
         '</g>'),
        # 4. Monedas
        ('<g stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round">'
         '<circle cx="9" cy="14" r="6"/>'
         '<circle cx="15" cy="10" r="6"/>'
         '<text x="15" y="13" font-size="7" font-weight="700" fill="currentColor" stroke="none" text-anchor="middle" font-family="Orbitron,monospace">$</text>'
         '</g>'),
        # 5. Link / Cadena
        ('<g stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round">'
         '<path d="M 10 14 A 4 4 0 0 1 10 6 L 13 6"/>'
         '<path d="M 14 10 A 4 4 0 0 1 14 18 L 11 18"/>'
         '<line x1="9" y1="10" x2="15" y2="10"/>'
         '</g>'),
        # 6. Check / Pagado
        ('<g stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round">'
         '<circle cx="12" cy="12" r="9"/>'
         '<polyline points="8,12 11,15 16,9"/>'
         '</g>'),
        # 7. Keypad / Teclado
        ('<g stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round">'
         '<rect x="3" y="3" width="18" height="18" rx="2"/>'
         '<circle cx="7" cy="8" r="1" fill="currentColor" stroke="none"/>'
         '<circle cx="12" cy="8" r="1" fill="currentColor" stroke="none"/>'
         '<circle cx="17" cy="8" r="1" fill="currentColor" stroke="none"/>'
         '<circle cx="7" cy="13" r="1" fill="currentColor" stroke="none"/>'
         '<circle cx="12" cy="13" r="1" fill="currentColor" stroke="none"/>'
         '<circle cx="17" cy="13" r="1" fill="currentColor" stroke="none"/>'
         '<circle cx="7" cy="18" r="1" fill="currentColor" stroke="none"/>'
         '<circle cx="12" cy="18" r="1" fill="currentColor" stroke="none"/>'
         '<circle cx="17" cy="18" r="1" fill="currentColor" stroke="none"/>'
         '</g>'),
        # 8. Clock / Expiración
        ('<g stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round">'
         '<circle cx="12" cy="12" r="9"/>'
         '<polyline points="12,7 12,12 15,14"/>'
         '</g>'),
    ]
    parts = [svg_open(240, 30, vb="0 0 240 30")]
    for i, icon in enumerate(icons):
        parts.append(f'<g transform="translate({i*30}, 3)">{icon}</g>')
    parts.append(svg_close())
    return "\n".join(parts)

# ---------------------------------------------------------------------------
# 8. BADGE PEY — "Powered by Pey" 180×40
# ---------------------------------------------------------------------------
def build_badge_pey() -> str:
    # Badge oficial de infraestructura — usa azul Pey #0067F1
    # Solo para footer / sección "Infraestructura"
    return f"""{svg_open(180, 40)}
  <rect width="180" height="40" rx="20" fill="{COLORS['pey-soft']}"/>
  <text x="90" y="18" font-family="'Inter', sans-serif" font-size="9" font-weight="600" fill="{COLORS['muted']}" text-anchor="middle" letter-spacing="0.12em">POWERED BY</text>
  <text x="90" y="32" font-family="Orbitron, sans-serif" font-size="13" font-weight="700" fill="{COLORS['pey-blue']}" text-anchor="middle" letter-spacing="0.02em">PEY · CoDi®</text>
{svg_close()}"""

# ---------------------------------------------------------------------------
# MANIFEST
# ---------------------------------------------------------------------------
def build_manifest(assets: list[dict]) -> str:
    return json.dumps({
        "product": "Ark Cash Register",
        "vendor": "Ark Systems · Substrate Holdings LLC",
        "infrastructure": "Pey CoDi® (Banxico)",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "palette": COLORS,
        "assets": assets,
    }, indent=2, ensure_ascii=False)

# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main():
    p = argparse.ArgumentParser(description="Forge vectorial — Ark Cash Register")
    p.add_argument("--out", required=True, help="Directorio de salida")
    args = p.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    builders = [
        ("favicon.svg",         build_favicon),
        ("logo-lockup.svg",     build_logo_lockup),
        ("pattern.svg",         build_pattern),
        ("og-image.svg",        build_og_image),
        ("divider.svg",         build_divider),
        ("mask-arc.svg",        build_mask_arc),
        ("sprite-gremial.svg",  build_sprite),
        ("badge-pey.svg",       build_badge_pey),
    ]

    manifest_assets = []
    total_kb = 0.0
    print(f"\n🔨 Forge Ark Cash Register → {out}")
    print("─" * 60)
    for name, fn in builders:
        content = fn()
        path = out / name
        size = write(path, content)
        kb = size / 1024
        total_kb += kb
        manifest_assets.append({"file": name, "bytes": size, "kb": round(kb, 2)})
        print(f"  ✓ {name:<24s} {kb:>6.2f} KB")

    # manifest.json
    manifest_path = out / "manifest.json"
    write(manifest_path, build_manifest(manifest_assets))
    print(f"  ✓ manifest.json")
    print("─" * 60)
    print(f"  Total: {total_kb:.2f} KB · {len(builders)} assets\n")

if __name__ == "__main__":
    main()
