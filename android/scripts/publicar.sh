#!/bin/sh
# Publica una versión de la app de Android en el servidor del cotizador: compila el release firmado, calcula su
# sha256 y deja el APK y version.json en la carpeta de datos (/app/data/app en el contenedor). La app lo ofrece al
# abrirse. Lo corre quien despliega, como `npm run deploy`:
#
#   sh android/scripts/publicar.sh <versión> <código> "<notas>" [mínimo]
#   sh android/scripts/publicar.sh 1.1.0 2 "Fotos de referencia desde la cámara"
#
# <código> es un entero que sube en cada publicación. [mínimo] (opcional) obliga a actualizar a quien tenga una
# versión con un código menor: úsalo solo cuando la app anterior ya no funcione con el servidor.
# Requiere la llave de firma configurada (docs/manual-operativo.md, «App de Android») y acceso ssh al servidor.
set -e
NOMBRE="$1"; CODIGO="$2"; NOTAS="${3:-}"; MINIMO="${4:-}"
if [ -z "$NOMBRE" ] || [ -z "$CODIGO" ]; then
  echo "Uso: sh android/scripts/publicar.sh <versión> <código> \"<notas>\" [mínimo]" >&2
  exit 1
fi
SSH="${NELTUME_SSH:-chome}"
DIR="${NELTUME_DIR:-/srv/cotizador-neltume}"
cd "$(dirname "$0")/.."
if [ -z "$JAVA_HOME" ] && [ -d "/Applications/Android Studio.app/Contents/jbr/Contents/Home" ]; then
  export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
fi
./gradlew :app:assembleRelease "-Pneltume.version.codigo=$CODIGO" "-Pneltume.version.nombre=$NOMBRE" --console=plain
APK=app/build/outputs/apk/release/app-release.apk
[ -f "$APK" ] || { echo "No se generó el APK firmado: revisa la llave de firma (neltume.firma.* en ~/.gradle/gradle.properties)." >&2; exit 1; }
SHA=$(shasum -a 256 "$APK" | cut -d' ' -f1)
TMP=$(mktemp -d)
cp "$APK" "$TMP/neltume-cotizador.apk"
node -e '
const [nombre, codigo, sha, notas, minimo] = process.argv.slice(1);
const v = { versionCode: Number(codigo), versionName: nombre, sha256: sha, publicada: new Date().toISOString() };
if (notas) v.notas = notas;
if (minimo) v.minimo = Number(minimo);
process.stdout.write(JSON.stringify(v, null, 2));
' "$NOMBRE" "$CODIGO" "$SHA" "$NOTAS" "$MINIMO" > "$TMP/version.json"
echo "APK $NOMBRE ($CODIGO) · sha256 $SHA"
ssh "$SSH" "rm -rf /tmp/neltume-app && mkdir -p /tmp/neltume-app"
scp "$TMP/neltume-cotizador.apk" "$TMP/version.json" "$SSH:/tmp/neltume-app/"
# Primero el APK y después version.json: la app nunca ve una versión sin su archivo.
ssh "$SSH" "cd '$DIR' && docker compose exec -T cotizador mkdir -p /app/data/app \
  && docker compose cp /tmp/neltume-app/neltume-cotizador.apk cotizador:/app/data/app/neltume-cotizador.apk \
  && docker compose cp /tmp/neltume-app/version.json cotizador:/app/data/app/version.json \
  && rm -rf /tmp/neltume-app"
rm -rf "$TMP"
echo "Publicada la versión $NOMBRE. La app la ofrecerá al abrirse."
