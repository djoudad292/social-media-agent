---
name: comment-bot
description: Auto-reply to Facebook page comments using AI
---

All API keys available: FACEBOOK_ACCESS_TOKEN

## How It Works

1. Poll Facebook page for new comments on recent posts
2. For each unread comment, generate an appropriate reply using the LLM
3. Post the reply as the page
4. Track replied comments in `memory/comments/replied.json` to avoid duplicates

## Check for New Comments

```
GET https://graph.facebook.com/v21.0/651243158078819/feed?fields=id,message,comments{id,message,from{name},created_time}&limit=5&access_token={FACEBOOK_ACCESS_TOKEN}
```

## Reply to a Comment

```
POST https://graph.facebook.com/v21.0/{comment_id}/replies
Params: access_token={FACEBOOK_ACCESS_TOKEN}, message=<reply text>
```

## Cron Setup (check every 30 min during work hours)

```
openclaw cron add --name comment-bot \
  --schedule "*/30 9-18 * * 1-5" \
  --task "Check Facebook page for new unread comments and reply to them" \
  --deliver whatsapp:+213780688125
```

## Anti-Detection (Meta Ban Prevention)

**Must follow ALL rules to avoid Facebook flagging the page as spam.**

### 1. Humanized Reply Speed
Never reply instantly. Add a random delay of 2–7 minutes before each reply:
```bash
# Generate random delay between 120000–420000ms (2-7 min)
DELAY=$(( (RANDOM % 300 + 2) * 60000 ))
sleep $((DELAY / 1000))
```

### 2. Varied Phrasing
Instruct the LLM with this system rule:
"Do not use standard, repetitive greeting formulas. Rotate between casual, professional, and friendly tones. Avoid using the exact same emojis in consecutive replies. Each reply must sound like a different human wrote it."

### 3. Hourly Rate Limit
Cap replies to a maximum of **15 per hour**. If more comments are pending, queue them with 5+ min spacing.

## Reply Style Guidelines

- Be helpful, friendly, and professional
- Answer questions directly with useful info
- If you don't know something, say "Great question! Let me check and get back to you"
- Never argue or be defensive
- Keep replies under 150 characters when possible
- Include a CTA when relevant (e.g., "DM us for details", "Check our website")
- Respond in the same language as the comment (Arabic/French/English)

## Memory

Store replied comment IDs in `memory/comments/replied.json`:
```json
{
  "replied": ["comment_id_1", "comment_id_2"]
}
```
