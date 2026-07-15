#!/bin/bash
# post-to-facebook.sh — Post message to Facebook immediately
# Usage: post-to-facebook.sh "Your message text here"
# Uses FACEBOOK_ACCESS_TOKEN from environment
# Logs result to /tmp/post-to-facebook-result.txt

if [ -z "$FACEBOOK_ACCESS_TOKEN" ]; then
  echo "ERROR: FACEBOOK_ACCESS_TOKEN not set in environment"
  echo "FAILED: FACEBOOK_ACCESS_TOKEN not set" > /tmp/post-to-facebook-result.txt
  exit 1
fi

MESSAGE="$1"
if [ -z "$MESSAGE" ]; then
  echo "ERROR: No message provided. Usage: $0 \"message text\""
  echo "FAILED: No message provided" > /tmp/post-to-facebook-result.txt
  exit 1
fi

RESPONSE=$(curl -s -X POST "https://graph.facebook.com/v21.0/me/feed" \
  --data-urlencode "access_token=$FACEBOOK_ACCESS_TOKEN" \
  --data-urlencode "message=$MESSAGE")

echo "$RESPONSE" > /tmp/post-to-facebook-result.txt

POST_ID=$(echo "$RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null)
if [ -n "$POST_ID" ]; then
  echo "SUCCESS! Posted: https://facebook.com/$POST_ID"
  echo "SUCCESS: https://facebook.com/$POST_ID" >> /tmp/post-to-facebook-result.txt
else
  ERROR_MSG=$(echo "$RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('error',{}).get('message','Unknown error'))" 2>/dev/null || echo "$RESPONSE")
  echo "FAILED: $ERROR_MSG"
  echo "FAILED: $ERROR_MSG" >> /tmp/post-to-facebook-result.txt
  exit 1
fi
