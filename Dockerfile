# Single application image: API + internal Memory module + native UI.
FROM node:24-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/client/package.json packages/client/
COPY packages/memory-contract/package.json packages/memory-contract/
COPY packages/memory/package.json packages/memory/
COPY packages/memory/tsconfig.json packages/memory/
COPY apps/ui/package.json apps/ui/
COPY apps/api/package.json apps/api/
COPY packages/memory/prisma packages/memory/prisma
RUN npm ci
COPY packages packages
COPY apps apps
RUN npm run build

FROM node:24-alpine AS runtime-base
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/client/package.json packages/client/
COPY packages/memory-contract/package.json packages/memory-contract/
COPY packages/memory/package.json packages/memory/
COPY packages/memory/tsconfig.json packages/memory/
COPY apps/ui/package.json apps/ui/
COPY apps/api/package.json apps/api/
COPY packages/memory/prisma packages/memory/prisma
RUN npm ci --omit=dev -w apps/api && npm cache clean --force
COPY --from=build /app/packages/memory-contract/dist packages/memory-contract/dist
COPY --from=build /app/packages/memory/dist packages/memory/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/ui/dist apps/ui/dist

# One-shot deployment task; it does not run a Memory server.
FROM runtime-base AS migrate
CMD ["npm", "run", "prisma:deploy", "-w", "packages/memory"]

FROM runtime-base AS api
WORKDIR /app/apps/api
EXPOSE 3010
CMD ["node", "dist/index.js"]
