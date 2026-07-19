#!/bin/bash
# env-sync.sh — Push .env vars to all 4 Render services
# Run AFTER deploying the Blueprint (render.yaml) on each account.
#
# Usage: bash env-sync.sh <key1> <key2> <key3> <key4>

set -e

ENV_FILE=".env"
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: No .env found. Create from .env.example"
  exit 1
fi
set -a; source "$ENV_FILE"; set +a

SERVICE_NAMES=("agent-gateway" "agent-content" "agent-media" "agent-data")
SERVICE_ENV=(
  "SUPABASE_URL SUPABASE_SECRET_KEY REDIS_URL TELEGRAM_BOT_TOKEN GATEWAY_TOKEN FACEBOOK_ACCESS_TOKEN AZURE_OPENAI_API_KEY AZURE_OPENAI_ENDPOINT"
  "SUPABASE_URL SUPABASE_SECRET_KEY REDIS_URL AZURE_OPENAI_API_KEY AZURE_OPENAI_ENDPOINT JINA_API_KEY FREENEWS_API_KEY GEMINI_API_KEY"
  "SUPABASE_URL SUPABASE_SECRET_KEY REDIS_URL AZURE_OPENAI_API_KEY AZURE_OPENAI_ENDPOINT AZURE_SPEECH_KEY AZURE_SPEECH_REGION PEXELS_API_KEY"
   "SUPABASE_URL SUPABASE_SECRET_KEY REDIS_URL AZURE_OPENAI_API_KEY AZURE_OPENAI_ENDPOINT AZURE_SPEECH_KEY AZURE_SPEECH_REGION FACEBOOK_ACCESS_TOKEN FACEBOOK_PAGE_ID JINA_API_KEY PIXABAY_API_KEY FREENEWS_API_KEY"
)

echo "=== Syncing .env to Render services ==="

for i in 0 1 2 3; do
  KEY="${@:$((i+1)):1}"
  NAME="${SERVICE_NAMES[$i]}"

  echo ""
  echo "--- $NAME ---"

  if [ -z "$KEY" ]; then
    echo "  SKIP: No API key provided"
    continue
  fi

  # Find service by name
  OWNERS=$(curl -s -H "Authorization: Bearer $KEY" "https://api.render.com/v1/owners")
  OWNER_ID=$(echo "$OWNERS" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d[0]['owner']['id'])" 2>/dev/null || echo "")
  if [ -z "$OWNER_ID" ]; then echo "  SKIP: No owner found"; continue; fi

  SVC_ID=$(curl -s -H "Authorization: Bearer $KEY" "https://api.render.com/v1/services?ownerId=$OWNER_ID" | \
    python3 -c "import json,sys;d=json.load(sys.stdin);[print(s['service']['id']) for s in d if s['service']['name']=='$NAME']" 2>/dev/null | head -1)

  if [ -z "$SVC_ID" ]; then
    echo "  SKIP: Service '$NAME' not found — deploy render.yaml first"
    continue
  fi

  echo "  Found: $SVC_ID"

  # Delete existing env vars
  for V in $(curl -s -H "Authorization: Bearer $KEY" "https://api.render.com/v1/services/$SVC_ID/env-vars" | \
    python3 -c "import json,sys;[print(v['key']) for v in json.load(sys.stdin)]" 2>/dev/null); do
    curl -s -X DELETE -H "Authorization: Bearer $KEY" "https://api.render.com/v1/services/$SVC_ID/env-vars/$V" > /dev/null
  done

  # Set new env vars
  for VAR in ${SERVICE_ENV[$i]}; do
    VAL="${!VAR}"
    if [ -n "$VAL" ]; then
      curl -s -X PUT -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
        "https://api.render.com/v1/services/$SVC_ID/env-vars" \
        -d "{\"key\":\"$VAR\",\"value\":\"$VAL\"}" > /dev/null
      echo "  Set: $VAR"
    fi
  done

  # Trigger redeploy
  curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
    "https://api.render.com/v1/services/$SVC_ID/deploys" \
    -d '{"clearCache":"do_not_clear"}' > /dev/null
  echo "  Redeploy triggered"

  # Save URL
  SVC_URL=$(curl -s -H "Authorization: Bearer $KEY" "https://api.render.com/v1/services/$SVC_ID" | \
    python3 -c "import json,sys;print(json.load(sys.stdin).get('service',{}).get('serviceDetails',{}).get('url',''))" 2>/dev/null)
  if [ -n "$SVC_URL" ]; then
    echo "  URL: $SVC_URL"
    # Update the service URLs in the gateway's env
    case "$NAME" in
      agent-content) echo "  → Update GATEWAY's CONTENT_URL to $SVC_URL";;
      agent-media)   echo "  → Update GATEWAY's MEDIA_URL to $SVC_URL";;
      agent-data)    echo "  → Update GATEWAY's DATA_URL to $SVC_URL";;
    esac
  fi
done

echo ""
echo "=== Done ==="
echo "Check status: curl https://[gateway-url]/api/status"
echo "If you need to update the service URLs in the gateway, re-run with all keys after all services are live."
