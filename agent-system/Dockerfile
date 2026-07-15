# Build with: docker build --build-arg SERVICE=gateway -t agent-gateway .
# SERVICES: gateway, content, media, data
ARG SERVICE=gateway

# ========================
# STAGE 1: Install deps
# ========================
FROM node:22-alpine AS base
RUN apk add --no-cache curl ca-certificates

FROM base AS deps
WORKDIR /app
COPY package.json /app/
COPY services/gateway/package.json /app/services/gateway/
COPY services/content/package.json /app/services/content/
COPY services/media/package.json /app/services/media/
COPY services/data/package.json /app/services/data/
RUN npm install --production 2>/dev/null || true

# ========================
# Gateway (Account 1)
# ========================
FROM base AS gateway
RUN apk add --no-cache ffmpeg espeak sox
RUN npm install -g openclaw@2026.6.11
RUN ln -sf /usr/local/lib/node_modules/openclaw/openclaw.mjs /usr/local/bin/openclaw

WORKDIR /app
COPY --from=deps /app/node_modules /app/node_modules
COPY package.json /app/
COPY shared/ /app/shared/
COPY services/gateway/ /app/services/gateway/

# OpenClaw workspace files
COPY AGENTS.md /workspace/AGENTS.md
COPY USER.md /workspace/USER.md
COPY post-to-facebook.sh /workspace/
COPY memory/ /workspace/memory/
COPY skills/ /workspace/skills/
COPY deploy/openclaw.json /app/openclaw.json
COPY deploy/azure-proxy.js /app/azure-proxy.js

RUN chmod +x /workspace/post-to-facebook.sh
EXPOSE 10000 3999
CMD ["/bin/sh","-c","node services/gateway/sidecar.js & openclaw gateway --config /app/openclaw.json"]

# ========================
# Content (Account 2)
# ========================
FROM base AS content
WORKDIR /app
COPY --from=deps /app/node_modules /app/node_modules
COPY package.json /app/
COPY shared/ /app/shared/
COPY services/content/ /app/services/content/
EXPOSE 3001
CMD ["node","services/content/index.js"]

# ========================
# Media (Account 3)
# ========================
FROM base AS media
RUN apk add --no-cache ffmpeg espeak sox
WORKDIR /app
COPY --from=deps /app/node_modules /app/node_modules
COPY package.json /app/
COPY shared/ /app/shared/
COPY services/media/ /app/services/media/
EXPOSE 3002
CMD ["node","services/media/index.js"]

# ========================
# Data (Account 4)
# ========================
FROM base AS data
WORKDIR /app
COPY --from=deps /app/node_modules /app/node_modules
COPY package.json /app/
COPY shared/ /app/shared/
COPY services/data/ /app/services/data/
EXPOSE 3003
CMD ["node","services/data/index.js"]
