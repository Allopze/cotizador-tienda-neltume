#!/bin/sh
# Crea la llave con que se firma la app (una sola vez). Pide inventar una contraseña (dos veces, para confirmarla; al
# escribirla no se ve nada en pantalla). Anótala en un lugar seguro y RESPALDA el archivo: sin él, una versión nueva no se
# puede instalar sobre la anterior (habría que desinstalar la app).
#   sh android/scripts/crear-llave.sh
set -e
CARPETA="$HOME/.neltume"
ARCHIVO="$CARPETA/cotizador.jks"
if [ -f "$ARCHIVO" ]; then echo "Ya existe $ARCHIVO: no se reemplaza." >&2; exit 1; fi
mkdir -p "$CARPETA" && chmod 700 "$CARPETA"
JAVA="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
"$JAVA/bin/keytool" -genkeypair -v -keystore "$ARCHIVO" -alias neltume -keyalg RSA -keysize 4096 -validity 36500 \
  -dname "CN=Cotizador Neltume, O=Neltume, C=CL"
chmod 600 "$ARCHIVO"
cat <<TXT

Llave creada en $ARCHIVO. Agrega estas líneas a ~/.gradle/gradle.properties (con tus contraseñas):
  neltume.firma.archivo=$ARCHIVO
  neltume.firma.clave=<la contraseña que acabas de inventar>
  neltume.firma.alias=neltume
Y respalda $ARCHIVO junto con las contraseñas (por ejemplo, en el gestor de contraseñas de la empresa).
TXT
