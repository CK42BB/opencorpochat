# SPDX-License-Identifier: AGPL-3.0-only
# OpenCorpoChat container image.
# Build from the repository root:  docker build -f deploy/Dockerfile -t opencorpochat .

# ---- Build stage ---------------------------------------------------------
FROM node:25-bookworm-slim AS build
# Toolchain for native modules (better-sqlite3) when no prebuilt binary matches.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /src

# Install dependencies first for better layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# Produce a self-contained server bundle with production dependencies only.
RUN pnpm --filter @ocpc/server deploy --prod --legacy /out \
 && mkdir -p /out/web \
 && cp -r apps/web/dist /out/web/dist

# ---- Runtime stage -------------------------------------------------------
FROM node:25-bookworm-slim AS runtime
LABEL org.opencontainers.image.title="OpenCorpoChat" \
      org.opencontainers.image.description="Self-hosted, open-source team chat for small organizations" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.source="https://github.com/CK42BB/opencorpochat"

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    OCPC_DATA_DIR=/data \
    OCPC_WEB_DIST=/app/web/dist

WORKDIR /app
COPY --from=build --chown=node:node /out /app

# Server code is deployed under /app; keep the monorepo-style paths the docs use.
RUN mkdir -p /app/apps/server \
 && ln -s /app/dist /app/apps/server/dist \
 && printf '#!/bin/sh\nexec node /app/dist/cli.js "$@"\n' > /usr/local/bin/ocpc \
 && chmod +x /usr/local/bin/ocpc \
 && mkdir -p /data && chown node:node /data

USER node
VOLUME ["/data"]
# 8080: HTTP/WebSocket. 3478/udp: built-in STUN for calls (OCPC_STUN_PORT=0 disables).
EXPOSE 8080 3478/udp

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "/app/dist/index.js"]
