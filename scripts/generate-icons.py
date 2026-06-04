#!/usr/bin/env python3
"""
Generiert icon16.png, icon48.png und icon128.png aus icons/icon.svg.
Benötigt: cairosvg  (pip install cairosvg)
          ODER: Inkscape im PATH
          ODER: rsvg-convert (librsvg)

Aufruf:
    python3 scripts/generate-icons.py
"""

import subprocess
import sys
from pathlib import Path

ROOT   = Path(__file__).parent.parent
SVG    = ROOT / 'icons' / 'icon.svg'
SIZES  = [16, 48, 128]

def try_cairosvg():
    try:
        import cairosvg
        for size in SIZES:
            out = ROOT / 'icons' / f'icon{size}.png'
            cairosvg.svg2png(url=str(SVG), write_to=str(out),
                             output_width=size, output_height=size)
            print(f'  [cairosvg] {out.name}')
        return True
    except ImportError:
        return False

def try_inkscape():
    try:
        for size in SIZES:
            out = ROOT / 'icons' / f'icon{size}.png'
            subprocess.run(
                ['inkscape', str(SVG), f'--export-filename={out}',
                 f'--export-width={size}', f'--export-height={size}'],
                check=True, capture_output=True
            )
            print(f'  [inkscape] {out.name}')
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False

def try_rsvg():
    try:
        for size in SIZES:
            out = ROOT / 'icons' / f'icon{size}.png'
            subprocess.run(
                ['rsvg-convert', '-w', str(size), '-h', str(size), str(SVG), '-o', str(out)],
                check=True, capture_output=True
            )
            print(f'  [rsvg-convert] {out.name}')
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False

def main():
    print('InvoiceFlow — Icon-Generator')
    print(f'Quelle: {SVG}')

    if not SVG.exists():
        print(f'FEHLER: {SVG} nicht gefunden.', file=sys.stderr)
        sys.exit(1)

    if   try_cairosvg(): pass
    elif try_inkscape():  pass
    elif try_rsvg():      pass
    else:
        print('\nKein SVG-Converter gefunden. Optionen:', file=sys.stderr)
        print('  pip install cairosvg', file=sys.stderr)
        print('  sudo apt install inkscape', file=sys.stderr)
        print('  sudo apt install librsvg2-bin', file=sys.stderr)
        print('\nAlternativ: SVG in icons/icon.svg mit einem Online-Tool konvertieren', file=sys.stderr)
        print('(z.B. https://cloudconvert.com/svg-to-png) und als icon16.png, icon48.png,', file=sys.stderr)
        print('icon128.png in den icons/-Ordner legen.', file=sys.stderr)
        sys.exit(1)

    print('\nFertig! Icons erzeugt:')
    for size in SIZES:
        p = ROOT / 'icons' / f'icon{size}.png'
        print(f'  {p}  ({p.stat().st_size} Bytes)')

if __name__ == '__main__':
    main()
