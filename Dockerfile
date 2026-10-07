# Imágenes de agent-runtime desde el monorepo (npm workspaces, un solo lockfile).
#   --target api         API (apps/api) + UI nativa (apps/ui) en el mismo origen. Sin database.
#   --target memory-mcp  Memory MCP default (apps/memory-mcp), dueño de la database `memory`.

FROM node:24-alpine AS build

RUN apk add --no-cache openssl

WORKDIR /app

# npm ci valida el lockfile contra todos los workspaces: necesita cada package.json.
COPY package.json package-lock.json ./
COPY packages/client/package.json packages/client/
COPY packages/memory-contract/package.json packages/memory-contract/
COPY apps/ui/package.json apps/ui/
COPY apps/api/package.json apps/api/
COPY apps/memory-mcp/package.json apps/memory-mcp/
COPY apps/memory-mcp/prisma apps/memory-mcp/prisma
RUN npm ci

COPY packages packages
COPY apps apps
RUN npm run build

# Base de producción: mismos manifests para que npm ci resuelva los links de workspaces.
FROM node:24-alpine AS runtime-base

RUN apk add --no-cache openssl

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/client/package.json packages/client/
COPY packages/memory-contract/package.json packages/memory-contract/
COPY apps/ui/package.json apps/ui/
COPY apps/api/package.json apps/api/
COPY apps/memory-mcp/package.json apps/memory-mcp/

FROM runtime-base AS memory-mcp

COPY apps/memory-mcp/prisma apps/memory-mcp/prisma
# Incluye el CLI de prisma: migrate deploy corre al boot.
RUN npm ci --omit=dev -w apps/memory-mcp && npm cache clean --force

COPY --from=build /app/packages/memory-contract/dist packages/memory-contract/dist
COPY --from=build /app/apps/memory-mcp/dist apps/memory-mcp/dist

WORKDIR /app/apps/memory-mcp

# Sin auth propia: en Compose queda en la red interna (el puerto no se publica).
ENV MEMORY_MCP_HOST=0.0.0.0
EXPOSE 3012

CMD ["sh", "-c", "node dist/setup-db.js && exec node dist/index.js"]

FROM runtime-base AS api

RUN npm ci --omit=dev -w apps/api && npm cache clean --force

COPY --from=build /app/packages/memory-contract/dist packages/memory-contract/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/ui/dist apps/ui/dist

WORKDIR /app/apps/api

EXPOSE 3010

CMD ["node", "dist/index.js"]
