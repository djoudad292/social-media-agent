#!/bin/bash
# deploy.sh — Deploy all 4 services to separate Render accounts
# Uses Render API keys from environment variables

set -e

# ─── CONFIG ───
REPO_URL="https://github.com/djoudad292/social-media-agent"
BRANCH="main"
REGION="oregon"

# Account 1 (existing): Gateway — OpenClaw + Sidecar
RENDER_KEY_1="${RENDER_API_KEY_1}"
SERVICE_NAME_1="agent-gateway"
DOCKERFILE_1="agent-system/Dockerfile"

# Account 2: Content + LLM
RENDER_KEY_2="${RENDER_API_KEY_2}"
SERVICE_NAME_2="agent-content"
DOCKERFILE_2="agent-system/Dockerfile"

# Account 3: Media + Reels
RENDER_KEY_3="${RENDER_API_KEY_3}"
SERVICE_NAME_3="agent-media"
DOCKERFILE_3="agent-system/Dockerfile"

# Account 4: Data + Scraper
RENDER_KEY_4="${RENDER_API_KEY_4}"
SERVICE_NAME_4="agent-data"
DOCKERFILE_4="agent-system/Dockerfile"

# ─── HELPER ───
deploy_service() {
  local KEY="$1" NAME="$2" DOCKERFILE="$3" SERVICE_ARG="$4"

  echo "=== Deploying $NAME ($SERVICE_ARG) ==="

  # Create or update Render service
  # Check if service exists
  EXISTING=$(curl -s -H "Authorization: Bearer $KEY" \
    "https://api.render.com/v1/services?name=$NAME")

  if echo "$EXISTING" | grep -q '"id"'; then
    # Update existing service
    SERVICE_ID=$(echo "$EXISTING" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0]['id'])")
    echo "Service exists ($SERVICE_ID), triggering deploy..."
    curl -s -X POST -H "Authorization: Bearer $KEY" \
      "https://api.render.com/v1/services/$SERVICE_ID/deploys" \
      -H "Content-Type: application/json" \
      -d '{"clearCache":"do_not_clear"}' > /dev/null
  else
    # Create new service
    echo "Creating new service..."
    curl -s -X POST -H "Authorization: Bearer $KEY" \
      "https://api.render.com/v1/services" \
      -H "Content-Type: application/json" \
      -d "{
        \"type\": \"web_service\",
        \"name\": \"$NAME\",
        \"repo\": \"$REPO_URL\",
        \"branch\": \"$BRANCH\",
        \"serviceDetails\": {
          \"env\": \"docker\",
          \"dockerfilePath\": \"$DOCKERFILE\",
          \"buildCommand\": \"docker build --build-arg SERVICE=$SERVICE_ARG -t $NAME .\",
          \"startCommand\": \"\",
          \"healthCheckPath\": \"/health\",
          \"plan\": \"free\"
        }
      }" > /dev/null
  fi

  echo "=== $NAME done ==="
}

# ─── DEPLOY ALL ───
echo "Starting deployment of all 4 services..."
echo ""

deploy_service "$RENDER_KEY_1" "$SERVICE_NAME_1" "$DOCKERFILE_1" "gateway"
deploy_service "$RENDER_KEY_2" "$SERVICE_NAME_2" "$DOCKERFILE_2" "content"
deploy_service "$RENDER_KEY_3" "$SERVICE_NAME_3" "$DOCKERFILE_3" "media"
deploy_service "$RENDER_KEY_4" "$SERVICE_NAME_4" "$DOCKERFILE_4" "data"

echo ""
echo "=== All deployments initiated ==="
echo "Monitor at:"
echo "  Account 1: https://dashboard.render.com (existing)"
echo "  Account 2: https://dashboard.render.com (new account)"
echo "  Account 3: https://dashboard.render.com (new account)"
echo "  Account 4: https://dashboard.render.com (new account)"
