#!/bin/bash
# env-sync.sh — Push .env vars to all 4 Render services via API
#
# Usage:
#   1. Create .env from .env.example and fill in your values
#   2. bash env-sync.sh
#
# First run: creates services + sets env vars
# Subsequent runs: updates env vars + redeploys
#
# Requires: curl, python3, jq (optional)

set -e

ENV_FILE=".env"
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: No .env file found. Create one from .env.example"
  exit 1
fi

# Source the .env file
set -a
source "$ENV_FILE"
set +a

# ─── 4 Render API Keys ───
# You can set these as env vars or the script will prompt
RENDER_KEYS=(
  "${RENDER_KEY_1:-$1}"
  "${RENDER_KEY_2:-$2}"
  "${RENDER_KEY_3:-$3}"
  "${RENDER_KEY_4:-$4}"
)

SERVICE_NAMES=("agent-gateway" "agent-content" "agent-media" "agent-data")
SERVICE_ARGS=("gateway" "content" "media" "data")
GITHUB_REPO="https://github.com/djoudad292/social-media-agent"
BRANCH="main"

echo "=== Agent System — Environment Sync ==="
echo ""

# Prompt for any missing keys
for i in 0 1 2 3; do
  if [ -z "${RENDER_KEYS[$i]}" ]; then
    echo ""
    read -p "Render API Key for Account $((i+1)) (${SERVICE_NAMES[$i]}): " RENDER_KEYS[$i]
  fi
done

echo ""

# ─── Map service → required env vars ───
declare -A SERVICE_ENV
SERVICE_ENV["gateway"]="SUPABASE_URL SUPABASE_SECRET_KEY REDIS_URL TELEGRAM_BOT_TOKEN OPENCLAW_GATEWAY_TOKEN FACEBOOK_ACCESS_TOKEN AZURE_OPENAI_API_KEY AZURE_OPENAI_ENDPOINT"
SERVICE_ENV["content"]="SUPABASE_URL SUPABASE_SECRET_KEY REDIS_URL AZURE_OPENAI_API_KEY AZURE_OPENAI_ENDPOINT JINA_API_KEY FREENEWS_API_KEY GEMINI_API_KEY"
SERVICE_ENV["media"]="SUPABASE_URL SUPABASE_SECRET_KEY REDIS_URL AZURE_OPENAI_API_KEY AZURE_OPENAI_ENDPOINT AZURE_SPEECH_KEY AZURE_SPEECH_REGION PEXELS_API_KEY"
SERVICE_ENV["data"]="SUPABASE_URL SUPABASE_SECRET_KEY REDIS_URL AZURE_OPENAI_API_KEY AZURE_OPENAI_ENDPOINT FACEBOOK_ACCESS_TOKEN FACEBOOK_PAGE_ID JINA_API_KEY"

# ─── Helper: set env vars on a Render service ───
sync_service() {
  local KEY="$1" NAME="$2" ARG="$3"

  echo "--- $NAME ---"

  # Build env vars JSON from .env
  local ENV_JSON="{"
  local FIRST=true
  for VAR in ${SERVICE_ENV[$ARG]}; do
    local VAL="${!VAR}"
    if [ -n "$VAL" ]; then
      if [ "$FIRST" = true ]; then FIRST=false; else ENV_JSON+=","; fi
      ENV_JSON+="\"$VAR\":\"$VAL\""
    fi
  done
  ENV_JSON+="}"

  # Check if service exists
  local LIST=$(curl -s -H "Authorization: Bearer $KEY" "https://api.render.com/v1/services")
  local SVC=$(echo "$LIST" | python3 -c "
import json,sys
try:
  svcs=json.load(sys.stdin)
  for s in svcs:
    if s['service']['name']=='$NAME':
      print(s['service']['id'])
except: pass
" 2>/dev/null)

  if [ -n "$SVC" ]; then
    echo "  Service exists: $SVC"

    # Update env vars via Render API
    # First delete all existing env vars
    local EXISTING=$(curl -s -H "Authorization: Bearer $KEY" "https://api.render.com/v1/services/$SVC/env-vars")
    local DELETE_IDS=$(echo "$EXISTING" | python3 -c "
import json,sys
try:
  vars=json.load(sys.stdin)
  for v in vars:
    print(v['key'])
except: pass
" 2>/dev/null)

    for K in $DELETE_IDS; do
      curl -s -X DELETE -H "Authorization: Bearer $KEY" "https://api.render.com/v1/services/$SVC/env-vars/$K" > /dev/null
    done

    # Set new env vars
    for VAR in ${SERVICE_ENV[$ARG]}; do
      local VAL="${!VAR}"
      if [ -n "$VAL" ]; then
        curl -s -X PUT -H "Authorization: Bearer $KEY" \
          -H "Content-Type: application/json" \
          "https://api.render.com/v1/services/$SVC/env-vars" \
          -d "{\"key\":\"$VAR\",\"value\":\"$VAL\"}" > /dev/null
        echo "  Set: $VAR"
      fi
    done

    # Trigger deploy
    curl -s -X POST -H "Authorization: Bearer $KEY" \
      -H "Content-Type: application/json" \
      "https://api.render.com/v1/services/$SVC/deploys" \
      -d '{"clearCache":"do_not_clear"}' > /dev/null
    echo "  Redeploy triggered"

  else
    echo "  Service not found. Creating..."

    # Create service
    local CREATE=$(curl -s -X POST -H "Authorization: Bearer $KEY" \
      -H "Content-Type: application/json" \
      "https://api.render.com/v1/services" \
      -d "{
        \"type\": \"web_service\",
        \"name\": \"$NAME\",
        \"repo\": \"$GITHUB_REPO\",
        \"branch\": \"$BRANCH\",
        \"serviceDetails\": {
          \"env\": \"docker\",
          \"dockerfilePath\": \"Dockerfile.agent-system\",
          \"buildCommand\": \"docker build --build-arg SERVICE=$ARG -t $NAME -f Dockerfile.agent-system .\",
          \"startCommand\": \"\",
          \"healthCheckPath\": \"/health\",
          \"plan\": \"free\"
        }
      }")

    local NEW_ID=$(echo "$CREATE" | python3 -c "import json,sys;print(json.load(sys.stdin).get('service',{}).get('id',''))" 2>/dev/null)
    if [ -n "$NEW_ID" ]; then
      echo "  Created: $NEW_ID"

      # Set env vars
      for VAR in ${SERVICE_ENV[$ARG]}; do
        local VAL="${!VAR}"
        if [ -n "$VAL" ]; then
          curl -s -X PUT -H "Authorization: Bearer $KEY" \
            -H "Content-Type: application/json" \
            "https://api.render.com/v1/services/$NEW_ID/env-vars" \
            -d "{\"key\":\"$VAR\",\"value\":\"$VAL\"}" > /dev/null
        fi
      done
      echo "  Env vars set"
    else
      echo "  Create failed: $CREATE"
    fi
  fi
  echo ""
}

# ─── Sync all 4 ───
for i in 0 1 2 3; do
  sync_service "${RENDER_KEYS[$i]}" "${SERVICE_NAMES[$i]}" "${SERVICE_ARGS[$i]}"
done

echo "=== Done ==="
echo ""
echo "Monitor at https://dashboard.render.com"
echo "After deployment, check status:"
echo "  curl https://[gateway-url]:3999/api/status"
