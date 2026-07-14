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
subst TELEGRAM_BOT_TOKEN "$TELEGRAM_BOT_TOKEN"

# Memory optimization
export NODE_COMPILE_CACHE=/tmp/openclaw-compile-cache
export OPENCLAW_NO_RESPAWN=1
export NODE_OPTIONS="--max-old-space-size=256 --max-semi-space-size=2"
mkdir -p /tmp/openclaw-compile-cache

# Start Azure proxy (bridges OpenAI Chat format → Azure Chat Completions)
echo "Starting Azure proxy..."
node /opt/openclaw-base/azure-proxy.js &
PROXY_PID=$!

# Start gateway in background so we can add Telegram channel while it runs
echo "Starting OpenClaw gateway..."
openclaw gateway &
GATEWAY_PID=$!

# Wait for gateway to be ready
if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
    echo "Waiting for gateway..."
    for i in $(seq 1 15); do
        if curl -sf "http://localhost:${PORT:-10000}/" >/dev/null 2>&1; then
            echo "Gateway ready. Configuring Telegram channel..."
            openclaw channels add --channel telegram --bot-token "$TELEGRAM_BOT_TOKEN" 2>/dev/null || true

            # ── Schedule daily content jobs ──
            echo "Setting up scheduled content cron jobs..."

            openclaw cron add --name morning-post \
              --schedule "0 9 * * 1-6" \
              --task "First tell me 'Starting morning post...' in this chat. Then check memory/pause.json — if it exists, tell me auto-posting is paused and stop. Otherwise: generate an educational or inspirational Facebook post about AI/tech. Use content-writer skill to write it. Post to Facebook. Finally tell me 'Done! [summary]' with a link." \
              --deliver "telegram:5011701218" 2>/dev/null || true

            openclaw cron add --name midday-reel \
              --schedule "0 12 * * 1-6" \
              --task "First tell me 'Starting midday reel...' in this chat. Then check memory/pause.json — if it exists, tell me paused and stop. Otherwise: create a short engaging reel (9:16) about AI/tech using Pexels clips or AI images. Add TTS voiceover and background music. Post to Facebook. Finally tell me 'Reel done! [link]'." \
              --deliver "telegram:5011701218" 2>/dev/null || true

            openclaw cron add --name afternoon-post \
              --schedule "0 15 * * 1-6" \
              --task "First tell me 'Starting afternoon post...' in this chat. Then check memory/pause.json — if it exists, tell me paused and stop. Otherwise: create a trending/engagement Facebook post. Use web research. Include a question or poll to drive comments. Post. Finally tell me 'Posted! [summary]'." \
              --deliver "telegram:5011701218" 2>/dev/null || true

            openclaw cron add --name evening-challenge \
              --schedule "0 18 * * 1-6" \
              --task "First tell me 'Starting evening challenge...' in this chat. Then check memory/pause.json — if it exists, tell me paused and stop. Otherwise: create an interactive challenge or poll for Facebook followers. Post. Finally tell me 'Challenge posted! [summary]'." \
              --deliver "telegram:5011701218" 2>/dev/null || true

            openclaw cron add --name comment-reply \
              --schedule "*/30 9-20 * * 1-6" \
              --task "Check Facebook page for new unread comments. If none, tell me 'No new comments'. If found, tell me 'Replying to X comments...' first, then reply using comment-bot skill, then tell me 'Replied to all X comments'." \
              --deliver "telegram:5011701218" 2>/dev/null || true

            openclaw cron add --name night-reflection \
              --schedule "0 21 * * 1-6" \
              --task "First tell me 'Starting night reflection...' in this chat. Then check memory/pause.json — if it exists, tell me paused and stop. Otherwise: create a personal/behind-the-scenes style Facebook post. Post. Finally tell me 'Posted! [summary]'." \
              --deliver "telegram:5011701218" 2>/dev/null || true

            break
        fi
        sleep 1
    done
fi

wait $GATEWAY_PID
kill $PROXY_PID 2>/dev/null || true
