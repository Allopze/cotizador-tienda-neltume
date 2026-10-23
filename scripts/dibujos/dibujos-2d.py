"""Dibujos de línea de los modelos que no tienen modelo 3D, hechos a mano a partir de las fotos de la planilla de
enchapadas (VALORES PUERTAS ENCHAPADAS_NELTUME.CO.xlsx: una hoja por modelo) y de las de la tienda
(puertasneltume.cl, una foto de frente por modelo). Mismo marco, mismo trazo y mismo verde que los dibujos de Blender
(scripts/dibujos/generar.sh): el marco sale de Ancacomoe con el interior vaciado y solo se dibuja la hoja.

  python3 scripts/dibujos/dibujos-2d.py

Escribe src/servidor/pdf-recursos/dibujos/<modelo>.png y agrega cada modelo a dibujos.json (misma hoja que Ancacomoe:
800 × 2000 mm). Para un modelo nuevo, agrega su función a MODELOS.
"""
import json
import math
from pathlib import Path
from PIL import Image, ImageDraw

DIR = Path(__file__).resolve().parents[2] / 'src/servidor/pdf-recursos/dibujos'
VERDE = (45, 73, 56, 255)
ESCALA = 4
# Interior de la hoja en el lienzo de 455 × 900 (entre los largueros y entre el marco superior e inferior).
X0, X1, Y0, Y1 = 111, 343, 69, 880
# Líneas interiores de los largueros de Ancacomoe y líneas de las jambas: dónde terminan los trazos de borde a borde.
XI, XD = 105.5, 348.5
J0, J1 = 61, 393
# Caja de tableros y vidrios: 14 px dentro de los largueros.
I0, I1 = X0 + 14, X1 - 14
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


def punto(d, x, y, grosor):
    r = grosor * ESCALA / 2
    d.ellipse([x * ESCALA - r, y * ESCALA - r, x * ESCALA + r, y * ESCALA + r], fill=VERDE)


def poligono(d, puntos, relleno):
    d.polygon([(x * ESCALA, y * ESCALA) for x, y in puntos], fill=relleno)


def caja(d, x0, y0, x1, y1, grosor):
    for a, b in (((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))):
        linea(d, *a, *b, grosor)
    # Esquinas cerradas.
    for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1)):
        punto(d, x, y, grosor)


def vidriada(d, x0, y0, x1, y1, columnas, cortes):
    """Hoja o cuerpo vidriado: marco, montantes parejos y travesaños a las fracciones de alto `cortes`."""
    caja(d, x0, y0, x1, y1, ESTRUCTURA)
    for k in range(1, columnas):
        x = x0 + (x1 - x0) * k / columnas
        linea(d, x, y0, x, y1, SURCO)
    for f in cortes:
        y = y0 + (y1 - y0) * f
        linea(d, x0, y, x1, y, SURCO)


def filas(n):
    """Cortes que reparten el alto en n filas iguales."""
    return [k / n for k in range(1, n)]


def tirador(d, y0, y1):
    """Tirador de barra vertical sobre el larguero izquierdo, de extremos redondos."""
    linea(d, 84, y0, 84, y1, 12)
    punto(d, 84, y0, 12)
    punto(d, 84, y1, 12)


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


def calafquen(d):
    # Puerta holandesa: arriba una hoja vidriada de 2 × 3 y abajo otra con un tablero; el corte va de jamba a jamba.
    vidriada(d, I0, 99, I1, 470, 2, filas(3))
    linea(d, J0, 540, J1, 540, SURCO)
    caja(d, I0, 585, I1, 835, ESTRUCTURA)
    manilla(d)


def cochamo(d):
    # Arriba vidriada de 2 × 3; abajo dos tableros altos con un montante ancho entre ellos.
    vidriada(d, I0, 99, I1, 470, 2, filas(3))
    caja(d, I0, 550, 215, 835, ESTRUCTURA)
    caja(d, 239, 550, I1, 835, ESTRUCTURA)
    manilla(d)


def enco(d):
    # Corredera de dos cuerpos con un montante central ancho: cada cuerpo, vidriado en 2 columnas (dos filas bajas,
    # una alta y una baja) sobre un tablero. Sin manilla de palanca: lleva tirador de barra.
    y0, y1 = 131, 640
    cortes = [(y - y0) / (y1 - y0) for y in (187, 255, 585)]
    for x0, x1 in ((I0, 213), (241, I1)):
        vidriada(d, x0, y0, x1, y1, 2, cortes)
        caja(d, x0, 697, x1, 779, ESTRUCTURA)
    tirador(d, 450, 545)


def ensenada(d):
    # Vidriada de 2 × 2, alta, sobre un tablero bajo.
    vidriada(d, I0, 116, I1, 682, 2, filas(2))
    caja(d, I0, 728, I1, 827, ESTRUCTURA)
    manilla(d)


def futaleufu(d):
    # Un tablero muy alto y uno bajo.
    caja(d, I0, 131, I1, 680, ESTRUCTURA)
    caja(d, I0, 740, I1, 819, ESTRUCTURA)
    manilla(d)


def fuy(d):
    # Tres tableros: uno alto y dos bajos, con la manilla entre el alto y el del medio.
    caja(d, I0, 128, I1, 462, ESTRUCTURA)
    caja(d, I0, 522, I1, 612, ESTRUCTURA)
    caja(d, I0, 657, I1, 805, ESTRUCTURA)
    manilla(d)


def palena(d):
    # Vidriada de 2 columnas y 4 filas (las dos de arriba y la de abajo, bajas; la del centro, alta) sobre un tablero.
    y0, y1 = 118, 674
    vidriada(d, I0, y0, I1, y1, 2, [(y - y0) / (y1 - y0) for y in (212, 319, 594)])
    caja(d, I0, 721, I1, 820, ESTRUCTURA)
    manilla(d)


def petrohue(d):
    # Vidriada pareja de 2 × 4 casi hasta el suelo.
    vidriada(d, I0, 112, I1, 805, 2, filas(4))
    manilla(d)


def ranco(d):
    # Tablones verticales entre dos travesaños, con la riostra en diagonal de arriba a la izquierda a abajo a la
    # derecha. Corredera sin manilla en la foto.
    arriba, abajo, ancho = 114, 826, 52
    for k in range(1, 5):
        x = XI + (XD - XI) * k / 5
        linea(d, x, arriba, x, abajo, SURCO)
    # La riostra tapa los surcos que cruza.
    poligono(d, [(XI, arriba), (XI + ancho, arriba), (XD, abajo), (XD - ancho, abajo)], (0, 0, 0, 0))
    linea(d, XI, arriba, XD - ancho, abajo, ESTRUCTURA)
    linea(d, XI + ancho, arriba, XD, abajo, ESTRUCTURA)
    linea(d, XI, arriba, XD, arriba, ESTRUCTURA)
    linea(d, XI, abajo, XD, abajo, ESTRUCTURA)


def rupanco(d):
    # Tablas horizontales de larguero a larguero y una cerradura de placa alta sobre el larguero izquierdo.
    tablas = 17
    for k in range(1, tablas):
        y = Y0 + (Y1 - Y0) * k / tablas
        linea(d, XI, y, XD, y, SURCO)
    d.rounded_rectangle([73 * ESCALA, 420 * ESCALA, 95 * ESCALA, 570 * ESCALA], radius=8 * ESCALA, fill=VERDE)


def yelcho(d):
    # Dos vidrios separados por un travesaño ancho, a la altura de la manilla: el de arriba con el borde superior en
    # arco rebajado, el de abajo recto.
    cx, flecha, arriba, abajo = (I0 + I1) / 2, 30, 109, 478
    radio = ((I1 - I0) ** 2 / 4 + flecha**2) / (2 * flecha)
    mitad = math.asin((I1 - I0) / 2 / radio)
    arco = [
        (cx + radio * math.sin(a), arriba + radio - radio * math.cos(a))
        for a in (-mitad + 2 * mitad * k / 48 for k in range(49))
    ]
    contorno = [(I0, abajo), *arco, (I1, abajo), (I0, abajo)]
    d.line([(x * ESCALA, y * ESCALA) for x, y in contorno], fill=VERDE, width=ESTRUCTURA * ESCALA, joint='curve')
    for x, y in ((I0, abajo), (I1, abajo)):
        punto(d, x, y, ESTRUCTURA)
    caja(d, I0, 544, I1, 814, ESTRUCTURA)
    manilla(d)


MODELOS = {
    'Huilo Huilo': ('huilo-huilo', huilo_huilo),
    'LOS RIOS': ('los-rios', los_rios),
    'LOS LAGOS': ('los-lagos', los_lagos),
    'CALAFQUEN': ('calafquen', calafquen),
    'COCHAMO': ('cochamo', cochamo),
    'ENCO': ('enco', enco),
    'ENSENADA': ('ensenada', ensenada),
    'FUTALEUFU': ('futaleufu', futaleufu),
    'FUY': ('fuy', fuy),
    'PALENA': ('palena', palena),
    'PETROHUE': ('petrohue', petrohue),
    'RANCO': ('ranco', ranco),
    'RUPANCO': ('rupanco', rupanco),
    'YELCHO': ('yelcho', yelcho),
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
