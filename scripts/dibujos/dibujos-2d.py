"""Dibujos de línea de los modelos que no tienen modelo 3D, hechos a mano a partir de las fotos de la planilla de
enchapadas (VALORES PUERTAS ENCHAPADAS_NELTUME.CO.xlsx: una hoja por modelo). Mismo marco, mismo trazo y mismo verde
que los dibujos de Blender (scripts/dibujos/generar.sh): el marco sale de Ancacomoe con el interior vaciado y solo se
dibuja la hoja.

  python3 scripts/dibujos/dibujos-2d.py

Escribe src/servidor/pdf-recursos/dibujos/<modelo>.png y agrega cada modelo a dibujos.json (misma hoja que Ancacomoe:
800 × 2000 mm). Para un modelo nuevo, agrega su función a MODELOS.
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw

DIR = Path(__file__).resolve().parents[2] / 'src/servidor/pdf-recursos/dibujos'
VERDE = (45, 73, 56, 255)
ESCALA = 4
# Interior de la hoja en el lienzo de 455 × 900 (entre los largueros y entre el marco superior e inferior).
X0, X1, Y0, Y1 = 111, 343, 69, 880
ESTRUCTURA, SURCO = 10, 6


def base():
    marco = Image.open(DIR / 'ancacomoe.png').convert('RGBA')
    vacio = Image.new('RGBA', (X1 - X0 + 1, Y1 - Y0 + 1), (0, 0, 0, 0))
    marco.paste(vacio, (X0, Y0))
    # La manilla de Ancacomoe: se borra, cada modelo pone la suya.
    marco.paste(Image.new('RGBA', (31, 56), (0, 0, 0, 0)), (70, 450))
    return marco


def lienzo():
    return Image.new('RGBA', (455 * ESCALA, 900 * ESCALA), (0, 0, 0, 0))


def linea(d, x0, y0, x1, y1, grosor):
    d.line([(x0 * ESCALA, y0 * ESCALA), (x1 * ESCALA, y1 * ESCALA)], fill=VERDE, width=grosor * ESCALA)


def caja(d, x0, y0, x1, y1, grosor):
    for a, b in (((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))):
        linea(d, *a, *b, grosor)
    # Esquinas cerradas.
    r = grosor * ESCALA / 2
    for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1)):
        d.ellipse([x * ESCALA - r, y * ESCALA - r, x * ESCALA + r, y * ESCALA + r], fill=VERDE)


def manilla(d):
    """Manilla de palanca, como la del dibujo de Molco: roseta de 30 px y palanca hacia el centro."""
    cx, cy, r = 87, 498, 15
    d.ellipse([(cx - r) * ESCALA, (cy - r) * ESCALA, (cx + r) * ESCALA, (cy + r) * ESCALA], fill=VERDE)
    d.rounded_rectangle([(cx + 8) * ESCALA, (cy - 6) * ESCALA, (cx + 58) * ESCALA, (cy + 6) * ESCALA], radius=6 * ESCALA, fill=VERDE)


def huilo_huilo(d):
    # Marco interior con travesaño: tablero alto y bajo de tablas verticales.
    caja(d, X0 + 14, Y0 + 20, X1 - 14, Y1 - 60, ESTRUCTURA)
    riel = (555, 625)
    linea(d, X0 + 14, riel[0], X1 - 14, riel[0], ESTRUCTURA)
    linea(d, X0 + 14, riel[1], X1 - 14, riel[1], ESTRUCTURA)
    surcos = [X0 + 14 + (X1 - X0 - 28) * k / 7 for k in range(1, 7)]
    for x in surcos:
        linea(d, x, Y0 + 20, x, riel[0], SURCO)
        linea(d, x, riel[1], x, Y1 - 60, SURCO)
    manilla(d)


def los_rios(d):
    # Cuatro tablas verticales de lado a lado, con tres surcos.
    for k in range(1, 4):
        x = X0 + (X1 - X0) * k / 4
        linea(d, x, Y0 + 10, x, Y1 - 10, SURCO)
    manilla(d)


def los_lagos(d):
    # Marco interior con tres surcos verticales y tirador de barra larga a la izquierda.
    caja(d, X0 + 16, Y0 + 40, X1 - 16, Y1 - 70, ESTRUCTURA)
    for k in range(1, 4):
        x = X0 + 16 + (X1 - X0 - 32) * k / 4
        linea(d, x, Y0 + 40, x, Y1 - 70, SURCO)
    # Tirador: barra vertical con dos soportes.
    linea(d, 150, 300, 150, 640, 12)
    linea(d, 132, 340, 150, 340, 8)
    linea(d, 132, 600, 150, 600, 8)


MODELOS = {
    'Huilo Huilo': ('huilo-huilo', huilo_huilo),
    'LOS RIOS': ('los-rios', los_rios),
    'LOS LAGOS': ('los-lagos', los_lagos),
}

if __name__ == '__main__':
    manifiesto = json.loads((DIR / 'dibujos.json').read_text(encoding='utf-8'))
    hoja = manifiesto['ANCACOMOE']['hoja']
    for modelo, (archivo, dibujar) in MODELOS.items():
        capa = lienzo()
        dibujar(ImageDraw.Draw(capa))
        # Solo el trazo, con el borde suavizado, sobre el marco.
        capa = capa.resize((455, 900), Image.LANCZOS)
        imagen = base()
        imagen.alpha_composite(capa)
        trazo = Image.new('RGBA', imagen.size, VERDE)
        trazo.putalpha(imagen.getchannel('A'))
        trazo.save(DIR / f'{archivo}.png', optimize=True)
        manifiesto[modelo] = {'archivo': f'{archivo}.png', 'px': [455, 900], 'hoja': hoja}
        print(modelo, archivo)
    (DIR / 'dibujos.json').write_text(json.dumps(manifiesto, ensure_ascii=False, indent=2), encoding='utf-8')
