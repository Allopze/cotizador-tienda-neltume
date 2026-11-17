#!/bin/sh
# Pruebas de punta a punta de la app en un emulador o teléfono conectado, contra el servidor de pruebas (datos
# sembrados, IA y Starken simulados: sin costo). Desde la raíz del repo:  sh android/scripts/e2e.sh
set -e
cd "$(dirname "$0")/../.."
PUERTO=3102
ADB="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"
export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
LOG=$(mktemp)
# next dev a veces se detiene para mostrar un aviso de actualización: se reintenta.
for i in 1 2 3 4 5; do
  sh android/scripts/servidor-pruebas.sh > "$LOG" 2>&1 &
  SERVIDOR=$!
  for s in $(seq 1 120); do
    curl -s -o /dev/null "http://127.0.0.1:$PUERTO/api/salud" && break
    kill -0 $SERVIDOR 2>/dev/null || break
    sleep 1
  done
  curl -s -o /dev/null "http://127.0.0.1:$PUERTO/api/salud" && break
done
trap 'kill $SERVIDOR 2>/dev/null || true' EXIT
"$ADB" reverse tcp:$PUERTO tcp:$PUERTO
"$ADB" shell pm clear cl.puertasneltume.cotizador.debug >/dev/null 2>&1 || true
cd android && ./gradlew :app:connectedDebugAndroidTest "-Pneltume.servidor=http://127.0.0.1:$PUERTO" --console=plain
