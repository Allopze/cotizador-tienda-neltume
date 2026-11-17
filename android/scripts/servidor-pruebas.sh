#!/bin/sh
# Servidor de pruebas para la app: la misma configuración que las E2E de la web (playwright.config.ts), con datos
# sembrados en data/test-movil, la IA simulada (NELTUME_LLM=fijo, sin costo) y Starken simulado. La integración con
# la fábrica queda apagada. Cada arranque vuelve a sembrar: lo hecho en la sesión anterior se borra. Uso, desde la raíz del repo:
#   sh android/scripts/servidor-pruebas.sh          # siembra y arranca en el puerto 3102
#   adb reverse tcp:3102 tcp:3102                   # el teléfono o emulador lo ve como 127.0.0.1:3102
set -e
cd "$(dirname "$0")/../.."
PUERTO="${NELTUME_MOVIL_PUERTO:-3102}"
DIR="data/test-movil"
NELTUME_E2E_DIR="$DIR" npx tsx scripts/preparar-e2e.ts
export NELTUME_TEST_MODE=1 NELTUME_LLM=fijo NELTUME_STARKEN=fijo NELTUME_FERIADOS_SYNC=0
export NELTUME_FABRICA_PANGUIPULLI_URL= NELTUME_FABRICA_PANGUIPULLI_SECRETO=
# Sin la clave real de IA (viene de .env.local): el chat usa el adaptador fijo, y el alta con IA del catálogo o
# «Probar modelo» fallan en vez de gastar.
export CMD_API_KEY=
export NELTUME_DATA_DIR="$PWD/$DIR" NELTUME_DB_PATH="$PWD/$DIR/cotizador.sqlite" NELTUME_DIST_DIR=.next-e2e
export BETTER_AUTH_SECRET=playwright-secret-neltume-0123456789abcdef BETTER_AUTH_URL="http://127.0.0.1:$PUERTO"
exec npx next dev --hostname 127.0.0.1 --port "$PUERTO"
