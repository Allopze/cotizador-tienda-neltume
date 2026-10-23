#!/usr/bin/env bash
# Dibujos de línea de los modelos de puerta para los PDF (vista frontal, verde Neltume, fondo transparente).
# Se generan desde los modelos 3D de modelos-3d/puertas con Blender (Freestyle):
#   BLENDER=/Applications/Blender.app/Contents/MacOS/Blender scripts/dibujos/generar.sh
# Escribe src/servidor/pdf-recursos/dibujos/<modelo>.png y dibujos.json (tamaño y posición de la hoja, para las cotas
# de la nota de pedido). Requiere Python con Pillow para dejar el trazo en el verde exacto.
set -euo pipefail
cd "$(dirname "$0")/../.."
BLENDER=${BLENDER:-blender}
SALIDA=src/servidor/pdf-recursos/dibujos
TMP=$(mktemp -d)
mkdir -p "$SALIDA"
# modelo del catálogo : archivo .blend : qué se dibuja (la puerta con su marco, o solo el marco)
PARES=(
  "ANCACOMOE:01_Ancacomoe:puerta"
  "CHAUQUEN:02a_Chauquen_ventanas_horizontales:puerta"
  "CHAN CHAN:03_Chan-Chan:puerta"
  "COZ COZ:04_Coz-Coz:puerta"
  "FUTRONO:05_Futrono:puerta"
  "HUELLAHUE:06_Huellahue:puerta"
  "HUERQUEHUE:07_Huerquehue:puerta"
  "LANCO:08_Lanco:puerta"
  "LICAN:09_Lican:puerta"
  "LIPINZA:10_Lipinza:puerta"
  "MALALHUE:11_Malalhue:puerta"
  "MOLCO:MOL-O-3-A_Molco:puerta"
  "NELTUME:14_Neltume:puerta"
  "PANGUIPULLI:16_Panguipulli:puerta"
  "PIRIHUEICO:17_Pirihueico:puerta"
  "PUÑIR:18_Punir:puerta"
  "RIÑIHUE:19_Rinihue:puerta"
  "TOLEDO:20_Toledo:puerta"
  "TOLTEN:21_Tolten:puerta"
  "BAKER:23_Mampara_Baker:puerta"
  "MARCO:14_Neltume:marco"
)
: > "$TMP/dibujos.txt"
for par in "${PARES[@]}"; do
  IFS=: read -r modelo blend modo <<< "$par"
  nombre=$(echo "$modelo" | sed 's/Ñ/N/g' | tr '[:upper:] ' '[:lower:]-')
  "$BLENDER" -b "modelos-3d/puertas/$blend.blend" --python scripts/dibujos/dibujo.py -- "$TMP/$nombre.png" "$modo" 900 3 150 2>&1 \
    | grep '^DIBUJO ' | sed "s/^DIBUJO /$modelo\t$nombre\t/" >> "$TMP/dibujos.txt"
done
python3 - "$TMP" "$SALIDA" <<'PY'
import json, sys
from PIL import Image
tmp, salida = sys.argv[1], sys.argv[2]
manifiesto = {}
for linea in open(f'{tmp}/dibujos.txt', encoding='utf-8'):
    modelo, nombre, datos = linea.rstrip('\n').split('\t', 2)
    d = json.loads(datos)
    im = Image.open(f'{tmp}/{nombre}.png').convert('RGBA')
    # El trazo queda en el verde Neltume exacto; la transparencia, tal cual.
    verde = Image.new('RGBA', im.size, (45, 73, 56, 255)); verde.putalpha(im.getchannel('A'))
    verde.save(f'{salida}/{nombre}.png', optimize=True)
    manifiesto[modelo] = {'archivo': f'{nombre}.png', 'px': d['px'], 'hoja': d['hoja']}
json.dump(manifiesto, open(f'{salida}/dibujos.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print(len(manifiesto), 'dibujos')
PY
rm -rf "$TMP"
