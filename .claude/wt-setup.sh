#!/usr/bin/env bash
set -euo pipefail

# Reutilizar las librerías ya instaladas en el proyecto principal (rápido):
ln -s "$WT_MAIN/node_modules" node_modules
ex=$(git rev-parse --git-path info/exclude); grep -qx node_modules "$ex" 2>/dev/null || echo node_modules >>"$ex"

exit 0
