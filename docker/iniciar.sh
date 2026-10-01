#!/bin/sh
set -eu

# Crea el esquema en instalaciones nuevas y migra las cuentas al actualizar.
npm run auth:migrar
exec "$@"
