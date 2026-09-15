# Build context is the repo root (see docker-compose.yml) -- same monorepo reasoning as
# server/Dockerfile: npm ci needs every workspace's package.json to match the root lockfile.

FROM node:20-alpine AS deps
# npm ci installs every workspace's deps, including the server's -- argon2 has no prebuilt
# binary for musl libc, so it compiles from source via node-gyp even in this image.
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci

FROM deps AS build
ARG VITE_API_BASE_URL=http://localhost:4000/api/v1
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
COPY web/ web/
RUN npm run --workspace=web build

FROM node:20-alpine AS runtime
WORKDIR /app
RUN npm install -g serve@14
COPY --from=build /app/web/dist ./dist
# no-cache on index.html so a reload always picks up a freshly rebuilt bundle instead of an old
# cached HTML pointing at JS/CSS chunk hashes that no longer exist after a rebuild; the hashed
# assets themselves are safe to cache long-term since their filename changes when content does.
# serve looks for serve.json inside the served folder itself, not the invoking cwd.
COPY web/serve.json ./dist/serve.json
EXPOSE 5173
CMD ["serve", "-s", "dist", "-l", "5173"]
