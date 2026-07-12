---
name: analytics
description: Fetch Facebook page analytics via Graph API
---

## Fetch Insights

```
GET https://graph.facebook.com/v21.0/me/insights
  ?metric=page_impressions,page_engaged_users,page_fans
  &period=days_28
  &access_token={FACEBOOK_ACCESS_TOKEN}
```

## Report Format

When reporting, include:
- Followers count and change
- Reach (28-day)
- Engagement rate
- Top-performing content type
- Recommendation for next week

## Storage

Write snapshots to `memory/analytics/YYYY-MM-DD.json` for trend tracking.
