#!/bin/sh
# Actualiza el cotizador en el servidor con un ZIP de entrega (npm run deploy:zip), sin el equipo del desarrollador.
#
# Uso (desde cualquier carpeta):
#   sh /srv/cotizador-neltume/scripts/actualizar.sh /ruta/neltume-cotizador-<fecha>.zip
#   sh /srv/cotizador-neltume/scripts/actualizar.sh https://servidor/neltume-cotizador-<fecha>.zip
#   sh /srv/cotizador-neltume/scripts/actualizar.sh --volver       vuelve a la versión anterior
# La instalación es la carpeta que contiene este script (scripts/..); otra se indica con --dir <carpeta>.
#
# 1. Revisa la entrega en una carpeta temporal (con una URL https://, primero la descarga con curl).
# 2. Respalda los datos con `npm run respaldar` dentro del contenedor (si falla, no se actualiza).
# 3. Guarda en .version-anterior/ el código actual y una copia de ese respaldo, para poder volver aunque los
#    respaldos del volumen roten (se conservan 30).
# 4. Sincroniza el código nuevo sin tocar .env, respaldos*, compose.override.yaml, cron/ ni .version-anterior/.
# 5. Construye la imagen con --pull: la imagen base (Node, Chromium) trae sus parches de seguridad. Si falla, deja
#    los archivos como estaban: sigue corriendo la versión anterior.
# 6. Inicia la versión nueva y espera el chequeo de salud (/api/salud). Si no pasa, explica cómo volver.
set -eu

fallar() {
  printf '\nERROR: %s\n' "$1" >&2
  exit 1
}

uso() {
  sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
}

zip=''
instalacion=''
volver=0
confirmado=0
while [ $# -gt 0 ]; do
  case "$1" in
    --volver) volver=1 ;;
    --si) confirmado=1 ;;
    --dir)
      [ $# -ge 2 ] || fallar '--dir necesita la carpeta de instalación.'
      instalacion="$2"
      shift
      ;;
    -h | --help)
      uso
      exit 0
      ;;
    -*) fallar "opción desconocida: $1" ;;
    *)
      [ -z "$zip" ] || fallar 'indica un solo ZIP (archivo o URL).'
      zip="$1"
      ;;
  esac
  shift
done

if [ -z "$instalacion" ]; then
  instalacion="$(cd "$(dirname "$0")/.." && pwd)"
fi
[ -d "$instalacion" ] || fallar "no existe la carpeta de instalación $instalacion."
instalacion="$(cd "$instalacion" && pwd)"
if [ ! -f "$instalacion/compose.yaml" ] || [ ! -f "$instalacion/.env" ]; then
  fallar "no encuentro una instalación del cotizador en $instalacion (faltan compose.yaml o .env). Indícala con --dir /srv/cotizador-neltume."
fi
anterior="$instalacion/.version-anterior"

for comando in docker rsync; do
  command -v "$comando" >/dev/null 2>&1 || fallar "falta el comando $comando en el servidor."
done
docker compose version >/dev/null 2>&1 || fallar 'falta Docker Compose v2 (docker compose).'

# Un solo cambio a la vez: comparte el lock del despliegue por SSH (npm run deploy).
if command -v flock >/dev/null 2>&1; then
  exec 9>/tmp/neltume-cotizador-deploy.lock
  flock -n 9 || fallar 'ya hay otra actualización o despliegue del cotizador en curso.'
fi

# Carpeta del respaldo según la salida de `npm run respaldar -- --json` (una línea JSON con "carpeta").
carpetaRespaldo() {
  c="$(printf '%s\n' "$1" | sed -n 's/^{.*"carpeta":"\([^"]*\)".*}$/\1/p' | tail -n 1)"
  # Un contenedor con la versión anterior a --json lo ignora y escribe el texto «Respaldo en <carpeta>: …».
  [ -n "$c" ] || c="$(printf '%s\n' "$1" | sed -n 's/^Respaldo en \([^:]*\):.*/\1/p' | tail -n 1)"
  printf '%s' "$c"
}

# Código de la aplicación: todo menos la configuración y los datos propios del servidor. Compara por contenido
# (--checksum): un archivo distinto con el mismo tamaño y la misma hora no se saltaría.
sincronizar() {
  rsync -a --checksum --delete \
    --exclude=/.env \
    '--exclude=/respaldos*' \
    --exclude=/compose.override.yaml \
    --exclude=/cron/ \
    --exclude=/.version-anterior/ \
    "$1/" "$2/"
}

cd "$instalacion"

if [ "$volver" = 1 ]; then
  [ -z "$zip" ] || fallar '--volver no lleva ZIP.'
  [ -d "$anterior/codigo" ] && [ -s "$anterior/respaldo" ] ||
    fallar "no hay una versión anterior guardada en $anterior."
  respaldo="$(cat "$anterior/respaldo")"
  copia="$anterior/datos/$(basename "$respaldo")"
  printf 'Se volverá a la versión anterior:\n'
  printf '  - se detiene el cotizador;\n'
  printf '  - se restauran los datos del respaldo tomado antes de actualizar (%s):\n' "$respaldo"
  printf '    los cambios hechos después de ese momento se pierden (quedan apartados, no se borran);\n'
  printf '  - se reinstala el código anterior y se inicia.\n'
  if [ "$confirmado" != 1 ]; then
    [ -t 0 ] || fallar 'agrega --si para confirmar.'
    printf 'Escribe VOLVER para continuar: '
    read -r respuesta
    [ "$respuesta" = VOLVER ] || fallar 'cancelado; no se cambió nada.'
  fi
  docker compose stop
  # Si el respaldo ya rotó del volumen, se repone desde la copia guardada en .version-anterior/datos/. Se copia como
  # root (la carpeta del host puede tener otro dueño y permisos 0700) y queda del usuario node, como los demás.
  if [ -d "$copia" ]; then
    docker compose run --rm -T --user root -v "$anterior/datos:/version-anterior:ro" cotizador sh -c \
      'set -e; [ -d "$1" ] && exit 0; cp -R "/version-anterior/$(basename "$1")" "$1"; chown -R node:node "$1"' \
      reponer "$respaldo" ||
      fallar "no se pudo reponer el respaldo $respaldo desde $copia; no se cambió nada. Para seguir con la versión nueva: docker compose up -d"
  fi
  docker compose run --rm -T cotizador npm run --silent restaurar -- "$respaldo" ||
    fallar 'no se pudieron restaurar los datos; el código no se tocó. Para seguir con la versión nueva: docker compose up -d'
  sincronizar "$anterior/codigo" "$instalacion"
  if ! docker compose up -d --build --remove-orphans --wait --wait-timeout 300; then
    docker compose ps || true
    fallar 'la versión anterior tampoco pasó el chequeo de salud. Revisa: docker compose logs --tail=100 cotizador'
  fi
  docker compose ps
  printf '\nListo: volvió la versión anterior con los datos de %s.\n' "$respaldo"
  exit 0
fi

[ -n "$zip" ] || {
  uso
  exit 2
}
command -v unzip >/dev/null 2>&1 || fallar 'falta el comando unzip en el servidor.'

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
case "$zip" in
  https://*)
    command -v curl >/dev/null 2>&1 || fallar 'falta el comando curl en el servidor para descargar la entrega.'
    printf '▶ Descargando %s…\n' "$zip"
    curl -fsSL --proto '=https' --max-time 900 -o "$tmp/entrega.zip" "$zip" ||
      fallar "no se pudo descargar $zip; no se cambió nada."
    zip="$tmp/entrega.zip"
    ;;
  http://* | ftp://*) fallar 'la URL debe empezar con https:// (la entrega es código que se instala en el servidor).' ;;
  *) [ -f "$zip" ] || fallar "no existe el ZIP $zip." ;;
esac
# Un ZIP íntegro: una descarga cortada, una página de error HTML o un archivo cualquiera se rechazan aquí.
unzip -tq "$zip" >/dev/null 2>&1 || fallar "$zip no es un ZIP válido (¿descarga incompleta?); no se cambió nada."
unzip -q "$zip" -d "$tmp/codigo" || fallar "no se pudo descomprimir $zip."
for archivo in compose.yaml Dockerfile package.json docker/iniciar.sh; do
  [ -f "$tmp/codigo/$archivo" ] || fallar "el ZIP no parece una entrega del cotizador (falta $archivo)."
done

printf '▶ Respaldando los datos antes de actualizar…\n'
if [ -n "$(docker compose ps --status running -q cotizador 2>/dev/null)" ]; then
  salida="$(docker compose exec -T cotizador npm run --silent respaldar -- --json)" || fallar 'no se pudo respaldar; no se actualizó nada.'
else
  salida="$(docker compose run --rm -T cotizador npm run --silent respaldar -- --json)" || fallar 'no se pudo respaldar; no se actualizó nada.'
fi
printf '%s\n' "$salida"
respaldo="$(carpetaRespaldo "$salida")"
[ -n "$respaldo" ] || fallar 'no se encontró la carpeta del respaldo en la salida de npm run respaldar; no se actualizó nada.'

printf '▶ Guardando el código actual en %s…\n' "$anterior"
rm -rf "$anterior"
mkdir -p "$anterior/codigo"
sincronizar "$instalacion" "$anterior/codigo"
printf '%s\n' "$respaldo" >"$anterior/respaldo"
# Copia del respaldo fuera del volumen: --volver no depende de que siga entre los 30 que se conservan.
mkdir -p "$anterior/datos"
if ! docker compose cp "cotizador:$respaldo" "$anterior/datos/"; then
  rm -rf "$anterior/datos"
  printf 'Aviso: no se pudo copiar el respaldo a %s; --volver lo usará mientras siga en el volumen.\n' "$anterior" >&2
fi

printf '▶ Copiando la versión nueva (se conservan .env, respaldos, compose.override.yaml y cron/)…\n'
sincronizar "$tmp/codigo" "$instalacion"

printf '▶ Construyendo la imagen (con --pull: imagen base al día)…\n'
if ! docker compose build --pull; then
  sincronizar "$anterior/codigo" "$instalacion"
  fallar 'no se pudo construir la versión nueva. Se dejaron los archivos como estaban y el cotizador sigue con la versión anterior, sin cambios.'
fi

printf '▶ Iniciando y esperando el chequeo de salud…\n'
if ! docker compose up -d --remove-orphans --wait --wait-timeout 300; then
  docker compose ps || true
  docker compose logs --tail=60 cotizador || true
  cat >&2 <<EOF

ERROR: la versión nueva no pasó el chequeo de salud.
Para volver a la versión anterior, con los datos del respaldo que se tomó recién ($respaldo):

  sh $instalacion/scripts/actualizar.sh --volver

Si prefieres revisar primero: docker compose logs --tail=200 cotizador
EOF
  exit 1
fi

docker compose ps
# Cada build deja sin etiqueta la imagen anterior; se borran solo las de este proyecto.
docker image prune -f --filter label=cl.neltume.cotizador >/dev/null || true
printf '\nActualización lista. Respaldo previo: %s\n' "$respaldo"
printf 'Si algo no funciona como antes: sh %s/scripts/actualizar.sh --volver\n' "$instalacion"
