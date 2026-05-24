# SPA build (nuxt.config.ts has ssr: false) — Nuxt drops static assets
# under .output/public/. We serve them through nginx instead of node so
# the runtime image stays small and there's no server-side rendering
# loop to keep alive.

# ── Build stage ───────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# pnpm via corepack — version pulled at build-time, no lockfile lock-in
# to a global pnpm version that might drift between local and CI.
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install deps first for cache-friendly rebuilds.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Build the SPA.
COPY . .
RUN pnpm run build

# ── Runtime stage ─────────────────────────────────────────────────────
FROM nginx:1.27-alpine

# Custom config provides the SPA history-mode fallback (every unknown
# path falls through to index.html so vue-router can resolve it
# client-side).
COPY nginx.conf /etc/nginx/conf.d/default.conf

COPY --from=builder /app/.output/public /usr/share/nginx/html

EXPOSE 80

# Default nginx CMD is fine — keeps the foreground process for docker.
