#!/bin/sh
set -e

STATE_DIR="${OPENCLAW_STATE_DIR:-/data/openclaw}"
CONFIG_FILE="${OPENCLAW_CONFIG_PATH:-$STATE_DIR/openclaw.json}"

# First run — seed state from bundled defaults
if [ ! -f "$CONFIG_FILE" ]; then
    echo "First run: initializing state directory from bundled defaults..."
    mkdir -p "$STATE_DIR/workspace"
    [ -f /opt/openclaw-base/openclaw.json ] && cp /opt/openclaw-base/openclaw.json "$CONFIG_FILE"
    [ -d /opt/openclaw-base/workspace ] && cp -r /opt/openclaw-base/workspace/* "$STATE_DIR/workspace/"
fi

# Ensure workspace exists (persistent across deploys)
mkdir -p "$STATE_DIR/workspace/memory" "$STATE_DIR/workspace/skills"

# ── Env var substitution (runs EVERY startup, not just first-run) ──
# Use | as sed delimiter to avoid breaking on / in API keys
subst() { [ -n "$2" ] && sed -i "s|\${$1}|$2|g" "$CONFIG_FILE"; }

[ -n "$PORT" ] && sed -i "s|\"port\": [0-9]*|\"port\": $PORT|" "$CONFIG_FILE"

subst OPENCLAW_GATEWAY_TOKEN "$OPENCLAW_GATEWAY_TOKEN"
subst OPENAI_API_KEY "$OPENAI_API_KEY"
subst PEXELS_API_KEY "$PEXELS_API_KEY"
subst GEMINI_API_KEY "$GEMINI_API_KEY"
subst FACEBOOK_ACCESS_TOKEN "$FACEBOOK_ACCESS_TOKEN"
subst MAGIC_HOUR_API_KEY "$MAGIC_HOUR_API_KEY"
subst UDIO_API_KEY "$UDIO_API_KEY"
subst REAPI_API_KEY "$REAPI_API_KEY"
subst DUB_API_KEY "$DUB_API_KEY"
subst JINA_API_KEY "$JINA_API_KEY"
subst FREENEWS_API_KEY "$FREENEWS_API_KEY"
subst RESEND_API_KEY "$RESEND_API_KEY"
subst AZURE_OPENAI_API_KEY "$AZURE_OPENAI_API_KEY"
subst AZURE_OPENAI_ENDPOINT "$AZURE_OPENAI_ENDPOINT"

# Memory optimization
export NODE_COMPILE_CACHE=/tmp/openclaw-compile-cache
export OPENCLAW_NO_RESPAWN=1
export NODE_OPTIONS="--max-old-space-size=256 --max-semi-space-size=2"
mkdir -p /tmp/openclaw-compile-cache

# Start gateway in background so we can add Telegram channel while it runs
echo "Starting OpenClaw gateway..."
openclaw gateway &
GATEWAY_PID=$!

# Wait for gateway to be ready before configuring channels
if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
    echo "Waiting for gateway before adding Telegram channel..."
    for i in $(seq 1 15); do
        if curl -sf "http://localhost:${PORT:-10000}/" >/dev/null 2>&1; then
            echo "Gateway ready, adding Telegram channel..."
            openclaw channels add --channel telegram --bot-token "$TELEGRAM_BOT_TOKEN" 2>/dev/null || true
            break
        fi
        sleep 1
    done
fi

wait $GATEWAY_PID
# Force rebuild Tue Jul 14 06:24:22 PM CET 2026
# Nothing to see here
