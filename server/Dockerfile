# Build context is the repo root (docker-compose.yml sets `context: .`), because this is an npm
# workspaces monorepo -- npm ci needs every workspace's package.json present to match the root
# lockfile, even though this image only ships the server.

FROM node:20-alpine AS deps
# argon2 has no prebuilt binary for musl libc, so it compiles from source via node-gyp.
# openssl is needed so Prisma detects the right query-engine binary target at generate time.
RUN apk add --no-cache python3 make g++ openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci

FROM deps AS build
COPY server/tsconfig.json server/tsconfig.build.json server/
COPY server/prisma server/prisma
COPY server/src server/src
RUN npm run --workspace=server prisma:generate
RUN npm run --workspace=server build

FROM node:20-alpine AS runtime
# Prisma's query engine binary needs libssl to load correctly.
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/node_modules ./server/node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/prisma ./server/prisma
COPY --from=build /app/server/dist ./server/dist
# The seed script runs directly via tsx (not the compiled dist/), so its imports need the
# TS sources it pulls in (src/db/client.ts, the domain/service modules, etc).
COPY --from=build /app/server/src ./server/src
COPY --from=build /app/server/tsconfig.json ./server/tsconfig.json
# `npm run seed` shells out via tsx --env-file=.env, which errors if the file doesn't exist.
# Real values come from compose's `environment:` block, which --env-file never overwrites --
# this is just so the flag has a file to point at inside the container.
COPY server/.env.example ./server/.env

WORKDIR /app/server
EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
