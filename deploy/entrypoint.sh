#!/bin/sh
set -e

STATE_DIR="${OPENCLAW_STATE_DIR:-/data/openclaw}"
CONFIG_FILE="${OPENCLAW_CONFIG_PATH:-$STATE_DIR/openclaw.json}"

# First run — seed state from bundled defaults
if [ ! -f "$CONFIG_FILE" ]; then
    echo "First run: initializing state directory from bundled defaults..."
    mkdir -p "$STATE_DIR/workspace"

    if [ -f /opt/openclaw-base/openclaw.json ]; then
        cp /opt/openclaw-base/openclaw.json "$CONFIG_FILE"
    fi
    if [ -d /opt/openclaw-base/workspace ]; then
        cp -r /opt/openclaw-base/workspace/* "$STATE_DIR/workspace/"
    fi

    # Inject Render's $PORT into the config
    if [ -n "$PORT" ]; then
        echo "Setting gateway port to $PORT"
        sed -i "s/\"port\": [0-9]*/\"port\": $PORT/" "$CONFIG_FILE"
    fi

    # Inject gateway token from env (for auth)
    if [ -n "$OPENCLAW_GATEWAY_TOKEN" ]; then
        echo "Setting gateway auth token"
        sed -i "s/\${OPENCLAW_GATEWAY_TOKEN}/$OPENCLAW_GATEWAY_TOKEN/g" "$CONFIG_FILE"
    fi

    # Substitute env vars in config
    if [ -n "$PEXELS_API_KEY" ]; then
        sed -i "s/\${PEXELS_API_KEY}/$PEXELS_API_KEY/g" "$CONFIG_FILE"
    fi
    if [ -n "$GEMINI_API_KEY" ]; then
        sed -i "s/\${GEMINI_API_KEY}/$GEMINI_API_KEY/g" "$CONFIG_FILE"
    fi
    if [ -n "$FACEBOOK_ACCESS_TOKEN" ]; then
        sed -i "s/\${FACEBOOK_ACCESS_TOKEN}/$FACEBOOK_ACCESS_TOKEN/g" "$CONFIG_FILE"
    fi
    if [ -n "$HIGGSFIELD_API_KEY" ]; then
        sed -i "s/\${HIGGSFIELD_API_KEY}/$HIGGSFIELD_API_KEY/g" "$CONFIG_FILE"
    fi
    if [ -n "$PIXABAY_API_KEY" ]; then
        sed -i "s/\${PIXABAY_API_KEY}/$PIXABAY_API_KEY/g" "$CONFIG_FILE"
    fi
fi

# Ensure workspace exists (persistent across deploys)
mkdir -p "$STATE_DIR/workspace/memory" "$STATE_DIR/workspace/skills"

# Memory optimization for Render free tier
export NODE_COMPILE_CACHE=/tmp/openclaw-compile-cache
export OPENCLAW_NO_RESPAWN=1
export NODE_OPTIONS="--max-old-space-size=384"
mkdir -p /tmp/openclaw-compile-cache

echo "Starting OpenClaw gateway..."
openclaw gateway &

# Wait for gateway to be ready
GATEWAY_PID=$!
for i in $(seq 1 30); do
    if curl -sf http://localhost:${PORT:-10000}/health > /dev/null 2>&1; then
        break
    fi
    sleep 2
done

# Inject Telegram bot token if provided
if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
    echo "Adding Telegram channel..."
    openclaw channels add --channel telegram --bot-token "$TELEGRAM_BOT_TOKEN" 2>/dev/null || true
fi

wait $GATEWAY_PID
