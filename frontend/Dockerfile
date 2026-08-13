# Production image: builds the static SPA, then serves it from nginx,
# which also terminates TLS and reverse-proxies only /api/v1/* to the `api`
# service (see docker/nginx/nginx.conf). The API base URL is left empty
# on purpose — the SPA calls `/api/...` on its own origin in production,
# exactly like the Vite dev proxy does locally (see vite.config.ts).

FROM node:22.22.0-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27.5-alpine AS runtime

COPY --from=build /app/dist /usr/share/nginx/html
# nginx.conf is NOT baked in: docker/compose.prod.yml bind-mounts
# docker/nginx/nginx.conf here, same treatment as the TLS certs, so
# either can be changed on the server without rebuilding this image.

EXPOSE 80 443 8080
