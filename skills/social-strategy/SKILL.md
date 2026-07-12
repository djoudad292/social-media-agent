---
name: social-strategy
description: Orchestrate daily/weekly content strategy, repurposing, auto-poster, and cross-platform planning
---

Coordinate all social media workflow. Skills available: content-writer, social-poster, analytics, lead-hunter, comment-bot.

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

## Auto-Poster (Daily)

The `auto-poster` cron runs Mon-Fri at 9AM and 3PM UTC:
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

## Weekly Review (Friday)

The `weekly-analytics-review` cron (Monday 10AM UTC):
1. Fetch Facebook Page Insights
2. Save to `memory/analytics/YYYY-MM-DD.json`
3. Send formatted WhatsApp report to user
4. Include recommendations for next week
