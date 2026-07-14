---
name: social-strategy
description: Orchestrate daily/weekly content strategy, repurposing, auto-poster, and cross-platform planning
---

Coordinate all social media workflow. Skills available: content-writer, social-poster, analytics, lead-hunter, comment-bot.

All API keys available: FREENEWS_API_KEY, DUB_API_KEY, RESEND_API_KEY, JINA_API_KEY

## Weekly Content Calendar

Every Monday, read past analytics from `memory/analytics/` and propose a weekly plan.
Store in `memory/strategy/YYYY-WW.json`:

```json
{
  "week": "2026-W28",
  "theme": "Building with APIs",
  "days": {
    "2026-07-13": {"type": "educational", "topic": "What is an API?", "status": "posted", "post_id": "fb_123"},
    "2026-07-14": {"type": "technical_tip", "topic": "REST vs GraphQL", "status": "scheduled"},
    "2026-07-15": {"type": "industry_opinion", "topic": "Why microservices matter", "status": "draft"},
    "2026-07-16": {"type": "tutorial", "topic": "Build your first API in 5 min", "status": "pending"},
    "2026-07-17": {"type": "personal", "topic": "My developer setup", "status": "pending"},
    "2026-07-18": {"type": "reel", "topic": "API explained in 15 seconds", "status": "pending"},
    "2026-07-19": {"type": "reel", "topic": "Code snippet animation", "status": "pending"}
  }
}
```

## Telegram Command Routing

You are the orchestrator. Route Telegram commands to the right skill:

| Command | Route to skill | Action |
|---------|---------------|--------|
| /post | social-poster | Create post (ask approval before publishing) |
| /postnow | social-poster | Create and publish post directly without asking |
| /reel | social-poster | Create and publish reel |
| /challenge | social-poster | Create challenge post |
| /schedule | (yourself) | Read cron jobs and memory for today's plan |
| /pause | (yourself) | Write pause flag to memory |
| /resume | (yourself) | Clear pause flag from memory |
| /status | (yourself) | Read memory and cron status, report to user |
| /analytics | analytics | Fetch and report page insights |
| /idea | content-writer | Generate weekly content ideas |

## Auto-Poster (Daily, 5x/day)

Scheduled cron jobs run daily at 9AM, 12PM, 3PM, 6PM, 9PM UTC (Mon-Sat):
1. Read the weekly plan from `memory/strategy/YYYY-WW.json`
2. Find the next day with status `pending` or `draft`
3. Use `content-writer` to generate the post content
4. If type is `reel`, use `social-poster` to generate a reel
5. If type is a regular post, use `social-poster` to post to Facebook
6. Also post to Instagram if IG account is connected
7. Update the plan status to `scheduled` or `posted`
8. Save the post ID to `memory/posts/YYYY-MM-DD.json`:

```json
{
  "date": "2026-07-13",
  "type": "educational",
  "topic": "What is an API?",
  "platforms": {
    "facebook": {"status": "posted", "post_id": "fb_123"},
    "instagram": {"status": "skipped", "reason": "no IG account connected"}
  },
  "content": "Full post text...",
  "engagement": null
}
```

## Content Mix

- 40% Educational
- 20% Engaging
- 20% Social proof
- 10% Promotional
- 10% Personal

## Content Inspiration from News (FreeNewsApi)

Before planning the weekly calendar, check trending news for timely topics:
```bash
curl -s "https://api.freenewsapi.io/v1/news?limit=10&topic=technology" \
  -H "X-API-Key: $FREENEWS_API_KEY"
```
Pick 2-3 trending stories relevant to "building with APIs / software dev" and weave them into the weekly plan.

## Link Tracking (Dub.co)

When planning posts that include links, generate shortened tracked links:
```bash
curl -s -X POST "https://api.dub.co/links" \
  -H "Authorization: Bearer $DUB_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"<long URL>","domain":"djaouad-tech.com"}'
```
The `shortLink` goes into the post. Analytics later tracks clicks.

## Weekly Newsletter (Resend)

Every Sunday, compile the week's best posts into a newsletter:
```bash
curl -s -X POST "https://api.resend.com/emails" \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "Djaouad Tech Newsletter <hello@cuvva.info.uk>",
    "to": "<subscriber-list>",
    "subject": "This Week in Building with APIs",
    "html": "<formatted recap of the week>"
  }'
```

## Cron: Weekly Newsletter
```bash
openclaw cron add --name weekly-newsletter \
  --schedule "0 11 * * 0" \
  --task "Compile best posts from memory/posts/, create newsletter, shorten links with Dub.co, send via Resend" \
  --deliver whatsapp:+213780688125
```

## Content Repurposing

| Original | Repurposed To |
|----------|--------------|
| Blog post | Thread (3-5 posts), Reel script, Carousel |
| Video/Reel | Post summary, Quote graphic |
| Thread | Blog post, Reel, Single post |
| Image | Post with caption, Carousel slide |

Repurposing workflow:
1. Take existing content from `memory/` or user input
2. Use `content-writer` to adapt to each format
3. Use `social-poster` to publish each version
4. Space out posts across days

## Platform Priority

1. Facebook (broad reach, connected)
2. Instagram/Reels (visual content, once IG account is connected)
3. TikTok (future)

## Cron: News-Driven Content Ideas

Run daily to inject trending topics into the strategy:
```bash
openclaw cron add --name news-to-content \
  --schedule "0 8 * * 1-5" \
  --task "Fetch trending tech news via FreeNewsApi, generate 2-3 post ideas, update memory/strategy/" \
  --deliver whatsapp:+213780688125
```

## Weekly Review (Friday)

The `weekly-analytics-review` cron (Monday 10AM UTC):
1. Fetch Facebook Page Insights
2. Save to `memory/analytics/YYYY-MM-DD.json`
3. Send formatted WhatsApp report to user
4. Include recommendations for next week

## Keep-Alive (Prevent Render Sleep)

The Render free tier spins down after 15 min of inactivity. This causes Telegram/WhatsApp to feel dead. Run a free UptimeRobot monitor (https://uptimerobot.com) pinging the health endpoint every 10 min:

```
Monitor type: HTTP(s)
URL: https://social-media-agent-ia4m.onrender.com/health
Interval: 10 minutes
```

Alternatively, add a cron on Render itself:
```bash
openclaw cron add --name keep-alive \
  --schedule "*/10 * * * *" \
  --task "Ping https://social-media-agent-ia4m.onrender.com/health to keep Render awake"
```
