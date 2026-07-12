FROM node:20-alpine
RUN apk add --no-cache curl ca-certificates

RUN npm install -g @openclaw/cli@2026.6.11
RUN openclaw plugins install @openclaw/whatsapp 2>/dev/null || true
RUN ln -sf /usr/local/lib/node_modules/@openclaw/cli/bin/openclaw.js /usr/local/bin/openclaw

ENV OPENCLAW_STATE_DIR=/data/openclaw \
    OPENCLAW_CONFIG_PATH=/data/openclaw/openclaw.json \
    NODE_ENV=production

COPY deploy/openclaw.json /opt/openclaw-base/openclaw.json
COPY AGENTS.md /opt/openclaw-base/workspace/AGENTS.md
COPY memory/ /opt/openclaw-base/workspace/memory/
COPY skills/ /opt/openclaw-base/workspace/skills/
COPY deploy/entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh

WORKDIR /data
EXPOSE 10000
CMD ["/entrypoint.sh"]
