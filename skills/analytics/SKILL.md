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

Output the report directly in your response. Include:
- Followers count and change
- Reach (28-day)
- Engagement rate
- Top-performing content type
- Recommendation for next week
