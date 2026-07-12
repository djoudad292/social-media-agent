---
name: analytics
description: Fetch Facebook page analytics and report via chat
---

## Fetch Insights

```
GET https://graph.facebook.com/v21.0/me/insights
  ?metric=page_impressions,page_engaged_users,page_fans
  &period=days_28
  &access_token={FACEBOOK_ACCESS_TOKEN}
```

## Report Format

### In Chat (brief)
```
📊 Weekly Analytics
👥 Followers: 1,234 (+5)
📈 Reach: 12,500 (28d)
💬 Engagement: 3.2%
👍 Top: Educational posts
📌 Focus on reels next week
```

### WhatsApp Card (weekly dashboard)
Send a formatted message to the user:
```
📊 *Weekly Analytics Report*

👥 Followers: 1,234 (+5 this week)
📈 Reach: 12,500 (28 days)
💬 Engagement: 3.2%
👍 Top post: "How to build an API" (450 engagements)

📌 *Recommendation:*
Focus on short-form video content this week. Reels are outperforming static posts 3:1.
```

## Store Analytics History

Save each report to `memory/analytics/YYYY-MM-DD.json`:
```json
{
  "date": "2026-07-12",
  "followers": 1234,
  "follower_change": 5,
  "impressions_28d": 12500,
  "engaged_users_28d": 400,
  "engagement_rate": 3.2,
  "top_post_type": "educational",
  "recommendation": "Focus on reels"
}
```
