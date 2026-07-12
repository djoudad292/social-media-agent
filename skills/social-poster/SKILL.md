---
name: social-poster
description: Post content to Facebook using the configured access token
---

Only Facebook posting is configured (token in environment). Ignore other platforms.

## Facebook Post

```
POST https://graph.facebook.com/v21.0/me/feed
Params: access_token={FACEBOOK_ACCESS_TOKEN}, message=<content>
```

## Profile Check

```
GET /me?fields=id,name,picture
```
