# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# SQLite puede necesitar compilar su módulo nativo para la arquitectura del servidor.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Acota el heap de Node durante el build para no agotar la RAM del servidor.
ENV NODE_OPTIONS=--max-old-space-size=2048
# La base temporal de construcción solo contiene esquemas y no se copia a runtime.
RUN npm run auth:migrar && npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 \
    CHROMIUM_PATH=/usr/bin/chromium NELTUME_DATA_DIR=/app/data \
    NELTUME_DB_PATH=/app/data/cotizador.sqlite NELTUME_RESPALDO_DIR=/app/respaldos \
    NPM_CONFIG_UPDATE_NOTIFIER=false
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium fonts-liberation fonts-dejavu-core ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/config ./config
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json /app/next.config.ts /app/tsconfig.json ./
COPY --chmod=755 docker/iniciar.sh /usr/local/bin/neltume-iniciar
# 0700, como los crea la app: un volumen nuevo copia estos permisos de la imagen (iniciar.sh corrige los existentes).
RUN install -d -m 700 -o node -g node /app/data /app/respaldos
USER node
EXPOSE 3000
ENTRYPOINT ["neltume-iniciar"]
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
