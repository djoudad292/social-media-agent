FROM node:22-alpine
RUN apk add --no-cache curl ca-certificates ffmpeg espeak sox

RUN npm install -g openclaw@2026.6.11
RUN ln -sf /usr/local/lib/node_modules/openclaw/openclaw.mjs /usr/local/bin/openclaw

ENV OPENCLAW_STATE_DIR=/data/openclaw \
    OPENCLAW_CONFIG_PATH=/data/openclaw/openclaw.json \
    NODE_ENV=production

COPY deploy/openclaw.json /opt/openclaw-base/openclaw.json
COPY AGENTS.md /opt/openclaw-base/workspace/AGENTS.md
COPY memory/ /opt/openclaw-base/workspace/memory/
COPY skills/ /opt/openclaw-base/workspace/skills/
COPY deploy/entrypoint.sh /entrypoint.sh
COPY deploy/azure-proxy.js /opt/openclaw-base/azure-proxy.js

RUN chmod +x /entrypoint.sh

WORKDIR /data
EXPOSE 10000
CMD ["/entrypoint.sh"]
