"""Guion de Host Grotesk para los PDF.

El guion (U+002D) de Host Grotesk es el signo menos corrido: mide medio cuadratín y en códigos («HUIL-O-3-B») y RUT
se lee como una raya. Este script lo reemplaza por una barra propia del ancho habitual (330 de 1000, barra de 250,
centrada), con el mismo grosor y las mismas variaciones por peso que el menos; el resto de la fuente no cambia. Se
corre una vez sobre el archivo de Google Fonts (variable, subconjunto latino):

  python3 scripts/fuentes-pdf.py original.woff2 src/servidor/pdf-recursos/fuentes/host-grotesk.woff2

La fuente modificada sigue bajo la SIL Open Font License 1.1 (OFL-host-grotesk.txt, sin nombres reservados).
"""
import sys
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables.TupleVariation import TupleVariation

origen, destino = sys.argv[1], sys.argv[2]
fuente = TTFont(origen)
glyf, gvar = fuente['glyf'], fuente['gvar']
menos = glyf['minus']
puntos = list(menos.getCoordinates(glyf)[0])  # rectángulo de 4 puntos
izquierda, derecha = min(x for x, _ in puntos), max(x for x, _ in puntos)
ANCHO, BARRA = 330, 250
inicio = (ANCHO - BARRA) // 2
escala = BARRA / (derecha - izquierda)
pluma = TTGlyphPen(None)
nuevos = [(round(inicio + (x - izquierda) * escala), y) for x, y in puntos]
pluma.moveTo(nuevos[0])
for p in nuevos[1:]:
    pluma.lineTo(p)
pluma.closePath()
glyf['hyphen'] = pluma.glyph()
glyf['hyphen'].recalcBounds(glyf)
fuente['hmtx']['hyphen'] = (ANCHO, inicio)
# Las variaciones del menos (más grueso con más peso), con el desplazamiento horizontal a la escala de la barra. Los
# cuatro puntos «fantasma» del final llevan el avance: se dejan como en el menos, escalados igual.
gvar.variations['hyphen'] = [
    TupleVariation(v.axes, [None if d is None else (round(d[0] * escala), d[1]) for d in v.coordinates])
    for v in gvar.variations.get('minus', [])
]
fuente.flavor = 'woff2'
fuente.save(destino)
print('guion', fuente['hmtx']['hyphen'], nuevos)
