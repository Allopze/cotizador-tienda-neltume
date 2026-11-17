"""Fuentes de la app: las mismas de la web y los PDF, convertidas de WOFF2 a TTF variable para Android.

Usa el Host Grotesk con el guion corregido (scripts/fuentes-pdf.py), no el de Google Fonts. Se corre a mano si cambian
las fuentes, con fontTools y brotli instalados:

  python3 android/scripts/fuentes.py
"""
from pathlib import Path
from fontTools.ttLib import TTFont

raiz = Path(__file__).resolve().parents[2]
origen = raiz / 'src/servidor/pdf-recursos/fuentes'
destino = raiz / 'android/app/src/main/res/font'
destino.mkdir(parents=True, exist_ok=True)
for nombre, archivo in [('host_grotesk', 'host-grotesk.woff2'), ('newsreader', 'newsreader.woff2')]:
    fuente = TTFont(origen / archivo)
    fuente.flavor = None
    ejes = [eje.axisTag for eje in fuente['fvar'].axes] if 'fvar' in fuente else []
    fuente.save(destino / f'{nombre}.ttf')
    print(f'{nombre}.ttf · ejes {ejes}')
