#!/bin/bash
# post-to-facebook.sh — Post message to Facebook immediately
# Usage: post-to-facebook.sh "Your message text here"
# Uses FACEBOOK_ACCESS_TOKEN from environment

set -e

if [ -z "$FACEBOOK_ACCESS_TOKEN" ]; then
  echo "ERROR: FACEBOOK_ACCESS_TOKEN not set in environment"
  exit 1
fi

MESSAGE="$1"
if [ -z "$MESSAGE" ]; then
  echo "ERROR: No message provided. Usage: $0 \"message text\""
  exit 1
fi

RESPONSE=$(curl -s -X POST "https://graph.facebook.com/v21.0/me/feed" \
  -d "access_token=$FACEBOOK_ACCESS_TOKEN" \
  -d "message=$MESSAGE")

if echo "$RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null | grep -q .; then
  POST_ID=$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
  echo "Posted! https://facebook.com/$POST_ID"
else
  echo "FAILED: $RESPONSE"
  exit 1
fi
