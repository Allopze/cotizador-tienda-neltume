#!/bin/sh
# Tarea diaria del servidor (cron del host): respalda, limpia y copia el respaldo a otro disco.
#
# Uso: sh /opt/neltume-cotizador/scripts/respaldo-diario.sh <carpeta-en-otro-disco> [cantidad-a-conservar]
# Ejemplo de crontab (crontab -e, con un usuario que pueda usar docker), todos los días a las 21:30:
#   30 21 * * * sh /opt/neltume-cotizador/scripts/respaldo-diario.sh /mnt/respaldos/neltume >> "$HOME/neltume-respaldo.log" 2>&1
#
# 1. npm run respaldar dentro del contenedor (base, PDF, referencias y configuración; conserva los 30 últimos).
# 2. npm run limpiar-borradores -- --confirmar (borradores vacíos abandonados, papelera vieja, referencias huérfanas).
# 3. Copia la carpeta del respaldo recién hecho a <carpeta-en-otro-disco> y deja ahí las N más recientes (30).
# La carpeta de destino debe quedar FUERA de la instalación: lo que esté dentro se reemplaza al actualizar.
set -eu

fallar() {
  printf '%s ERROR: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >&2
  exit 1
}
informar() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1"
}

destino="${1:-}"
conservar="${2:-30}"
[ -n "$destino" ] || fallar 'indica la carpeta de destino en otro disco (ver el encabezado de este script).'
case "$conservar" in
  '' | *[!0-9]*) fallar 'la cantidad a conservar debe ser un número entero.' ;;
esac
[ "$conservar" -ge 1 ] || fallar 'la cantidad a conservar debe ser al menos 1.'

instalacion="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$instalacion/compose.yaml" ] || fallar "no encuentro compose.yaml en $instalacion."
mkdir -p "$destino"
destino="$(cd "$destino" && pwd)"
case "$destino/" in
  "$instalacion"/*) fallar "el destino $destino está dentro de la instalación; usa una carpeta en otro disco." ;;
esac

cd "$instalacion"
salida="$(docker compose exec -T cotizador npm run --silent respaldar)" || fallar 'no se pudo respaldar.'
printf '%s\n' "$salida"
carpeta="$(printf '%s\n' "$salida" | sed -n 's/^Respaldo en \([^:]*\):.*/\1/p' | tail -n 1)"
[ -n "$carpeta" ] || fallar 'no se encontró la carpeta del respaldo en la salida de npm run respaldar.'

# Un fallo de la limpieza no invalida el respaldo: se informa y se sigue con la copia.
docker compose exec -T cotizador npm run --silent limpiar-borradores -- --confirmar ||
  informar 'AVISO: la limpieza de borradores falló; el respaldo sí se hizo.'

docker compose cp "cotizador:$carpeta" "$destino/" || fallar "no se pudo copiar $carpeta a $destino."
informar "Respaldo copiado a $destino/$(basename "$carpeta")."

# Conserva en el otro disco solo los N respaldos más recientes (los nombres llevan la fecha y se ordenan solos).
ls -1d "$destino"/cotizador-* 2>/dev/null | sort -r | tail -n +"$((conservar + 1))" | while IFS= read -r viejo; do
  rm -rf "$viejo"
  informar "Borrado el respaldo antiguo $viejo."
done
