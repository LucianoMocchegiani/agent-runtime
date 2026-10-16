# Single application image: API + native UI.
FROM node:24-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/client/package.json packages/client/
COPY apps/ui/package.json apps/ui/
COPY apps/api/package.json apps/api/
COPY apps/api/prisma apps/api/prisma
RUN npm ci
COPY packages packages
COPY apps apps
RUN npm run build

FROM node:24-alpine AS runtime-base
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/client/package.json packages/client/
COPY apps/ui/package.json apps/ui/
COPY apps/api/package.json apps/api/
COPY apps/api/prisma apps/api/prisma
RUN npm ci --omit=dev -w apps/api && npm cache clean --force
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/ui/dist apps/ui/dist
USER node

# One-shot deployment task; Prisma schema and migrations belong to the API.
FROM runtime-base AS migrate
CMD ["npm", "run", "prisma:deploy", "-w", "apps/api"]

FROM runtime-base AS api
WORKDIR /app/apps/api
EXPOSE 3010
CMD ["node", "dist/index.js"]
