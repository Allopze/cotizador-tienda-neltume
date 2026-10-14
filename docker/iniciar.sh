#!/bin/sh
set -eu

# Punto de entrada del contenedor. Al iniciar el servidor valida la configuración, migra las cuentas y, si la base no
# tiene ninguna, escribe en el registro el código para crear la primera. Otros comandos (docker compose run …
# npm run restaurar, usuarios, respaldar) se ejecutan directo: restaurar no debe tocar la base antes de reemplazarla.

fallar() {
  printf '\nNo se inicia el cotizador: %s\nCorrige el archivo .env de la instalación y vuelve a ejecutar: docker compose up -d\n\n' "$1" >&2
  exit 1
}

if [ "${1:-}" = node ] && [ "${2:-}" = node_modules/next/dist/bin/next ]; then
  # Con un secreto corto o un origen sin HTTPS cada página respondería 500 y el contenedor se reiniciaría en bucle
  # con el error escondido en el registro: se valida aquí con un mensaje claro.
  secreto="${BETTER_AUTH_SECRET:-}"
  [ -n "$secreto" ] || fallar 'falta BETTER_AUTH_SECRET. Genera uno con: openssl rand -base64 32'
  [ "${#secreto}" -ge 32 ] ||
    fallar "BETTER_AUTH_SECRET tiene ${#secreto} caracteres y necesita al menos 32. Genera uno con: openssl rand -base64 32"
  case "${BETTER_AUTH_URL:-}" in
    https://?*) ;;
    *) fallar "BETTER_AUTH_URL debe ser el origen HTTPS público, por ejemplo https://cotizador.tudominio.cl (ahora: '${BETTER_AUTH_URL:-vacío}')." ;;
  esac
  # Como la app (cabeceraIpCliente): sin espacios alrededor y sin distinguir mayúsculas; vacía es cf-connecting-ip.
  cabecera="$(printf '%s' "${NELTUME_IP_HEADER:-}" | tr '[:upper:]' '[:lower:]' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
  case "${cabecera:-cf-connecting-ip}" in
    cf-connecting-ip | x-real-ip | x-forwarded-for | ninguna) ;;
    *) fallar "NELTUME_IP_HEADER debe ser cf-connecting-ip, x-real-ip, x-forwarded-for o ninguna (ahora: '${NELTUME_IP_HEADER}')." ;;
  esac

  # Crea el esquema en instalaciones nuevas y migra las cuentas al actualizar.
  npm run auth:migrar
  # Un fallo aquí no impide atender: la página de inicio de sesión vuelve a generar el código si falta.
  npm run --silent primer-arranque || echo 'Aviso: no se pudo preparar el código de primer arranque.' >&2
fi
exec "$@"
