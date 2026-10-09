# Stage 1: build the React UI
# Built on the runner's own platform; only the runtime stage is per-architecture.
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS web
WORKDIR /app/web
RUN npm i -g pnpm@10.20.0
COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY web .
RUN pnpm build

# Terminal dependencies are pure JavaScript; the backend still uses Node alone.
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS terminal-deps
WORKDIR /app
RUN npm i -g pnpm@10.20.0
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

# Runtime = node + python3 + venv + gh + pocketbase in one image
FROM node:22-bookworm-slim
ARG PB_VERSION=0.40.4
ARG GH_VERSION=2.92.0
ARG TARGETARCH=amd64

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    libgomp1 \
    libvulkan1 \
    procps \
    git \
    ca-certificates \
    curl \
    unzip \
 && curl -fsSL "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${TARGETARCH}.zip" -o /tmp/pb.zip \
 && unzip -o /tmp/pb.zip pocketbase -d /usr/local/bin && rm /tmp/pb.zip \
 && curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${TARGETARCH}.tar.gz" \
    | tar -xz -C /usr/local/bin --strip-components=2 "gh_${GH_VERSION}_linux_${TARGETARCH}/bin/gh" \
 && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server.mjs start.sh showcase.json models.json package.json ./
COPY pb_migrations ./pb_migrations
COPY runtimes ./runtimes
COPY bin ./bin
COPY --from=terminal-deps /app/node_modules ./node_modules
RUN chmod +x /app/bin/codeotter.mjs /app/start.sh \
 && ln -s /app/bin/codeotter.mjs /usr/local/bin/codeotter
COPY --from=web /app/web/dist ./web/dist

ENV PB_URL=http://127.0.0.1:8090 PORT=4747 PR_SCORER_DATA=/app/pb_data/local S1_DEVICE=cpu PR_SCORER_PYTHON=python3
EXPOSE 4747 8090
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD curl -sf http://127.0.0.1:4747/healthz >/dev/null || exit 1
VOLUME ["/app/pb_data"]
CMD ["sh", "/app/start.sh"]
