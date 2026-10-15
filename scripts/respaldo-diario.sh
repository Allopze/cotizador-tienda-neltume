#!/bin/sh
# Tarea diaria del servidor (cron del host): respalda, limpia y copia el respaldo a otro disco.
#
# Uso: sh /srv/cotizador-neltume/scripts/respaldo-diario.sh <carpeta-en-otro-disco> [cantidad-a-conservar]
# Ejemplo de crontab (crontab -e, con un usuario que pueda usar docker), todos los días a las 21:30:
#   30 21 * * * sh /srv/cotizador-neltume/scripts/respaldo-diario.sh /mnt/respaldos/neltume >> "$HOME/neltume-respaldo.log" 2>&1
#
# 1. npm run respaldar dentro del contenedor (base, PDF, referencias y configuración; conserva los 30 últimos).
# 2. npm run limpiar-borradores -- --confirmar (borradores vacíos abandonados, papelera vieja, referencias huérfanas).
# 3. Copia la carpeta del respaldo recién hecho a <carpeta-en-otro-disco> y deja ahí las N más recientes (30).
#    La copia usa rsync --link-dest contra la copia anterior: un PDF que no cambió (los emitidos no cambian nunca) se
#    enlaza en vez de duplicarse, así que 30 copias ocupan poco más que una. Cada carpeta sigue siendo un respaldo
#    completo: borrar una no afecta a las demás.
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

# Carpeta del respaldo según la salida de `npm run respaldar -- --json` (una línea JSON con "carpeta").
carpetaRespaldo() {
  c="$(printf '%s\n' "$1" | sed -n 's/^{.*"carpeta":"\([^"]*\)".*}$/\1/p' | tail -n 1)"
  # Un contenedor con la versión anterior a --json lo ignora y escribe el texto «Respaldo en <carpeta>: …».
  [ -n "$c" ] || c="$(printf '%s\n' "$1" | sed -n 's/^Respaldo en \([^:]*\):.*/\1/p' | tail -n 1)"
  printf '%s' "$c"
}

instalacion="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$instalacion/compose.yaml" ] || fallar "no encuentro compose.yaml en $instalacion."
command -v rsync >/dev/null 2>&1 || fallar 'falta el comando rsync en el servidor.'
mkdir -p "$destino"
destino="$(cd "$destino" && pwd)"
case "$destino/" in
  "$instalacion"/*) fallar "el destino $destino está dentro de la instalación; usa una carpeta en otro disco." ;;
esac

cd "$instalacion"
salida="$(docker compose exec -T cotizador npm run --silent respaldar -- --json)" || fallar 'no se pudo respaldar.'
printf '%s\n' "$salida"
carpeta="$(carpetaRespaldo "$salida")"
[ -n "$carpeta" ] || fallar 'no se encontró la carpeta del respaldo en la salida de npm run respaldar.'

# Un fallo de la limpieza no invalida el respaldo: se informa y se sigue con la copia.
docker compose exec -T cotizador npm run --silent limpiar-borradores -- --confirmar ||
  informar 'AVISO: la limpieza de borradores falló; el respaldo sí se hizo.'

nombre="$(basename "$carpeta")"
# La copia anterior (la más reciente que ya está en el destino) sirve de base para enlazar lo que no cambió.
anterior="$(ls -1d "$destino"/cotizador-* 2>/dev/null | grep -v "/$nombre\$" | sort | tail -n 1 || true)"
# Se baja primero a una carpeta temporal del mismo disco: docker compose cp no sabe enlazar.
entrante="$destino/.entrante-$nombre"
rm -rf "$entrante"
trap 'rm -rf "$entrante"' EXIT
mkdir -p "$entrante"
docker compose cp "cotizador:$carpeta" "$entrante/" || fallar "no se pudo copiar $carpeta a $destino."
if [ -n "$anterior" ]; then
  rsync -a --delete --link-dest="$anterior" "$entrante/$nombre/" "$destino/$nombre/" ||
    fallar "no se pudo copiar $carpeta a $destino."
else
  rsync -a --delete "$entrante/$nombre/" "$destino/$nombre/" || fallar "no se pudo copiar $carpeta a $destino."
fi
rm -rf "$entrante"
informar "Respaldo copiado a $destino/$nombre${anterior:+ (lo que no cambió, enlazado con $(basename "$anterior"))}."

# Conserva en el otro disco solo los N respaldos más recientes (los nombres llevan la fecha y se ordenan solos).
ls -1d "$destino"/cotizador-* 2>/dev/null | sort -r | tail -n +"$((conservar + 1))" | while IFS= read -r viejo; do
  rm -rf "$viejo"
  informar "Borrado el respaldo antiguo $viejo."
done
