---
name: content-writer
description: Generate text, images, captions, hashtags, and repurpose content
---

Generate content using your built-in LLM. Do not call external APIs for text generation.

All API keys available: GEMINI_API_KEY, FREENEWS_API_KEY, JINA_API_KEY

## Content Types

- **Post**: 2-3 sentence caption + 3-5 hashtags + CTA
- **Thread**: 3-5 connected posts
- **Reel script**: Scene descriptions + audio/visual cues
- **Carousel**: Slide titles + key points

## AI Images (via Gemini API)

Generate custom post visuals:
```
POST https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:generateContent?key={GEMINI_API_KEY}
Body: { "instances": [{ "prompt": "..." }], "parameters": { "sampleCount": 1 } }
```

Save the returned image as `/tmp/post_image.png`.

## Image Captions

When given an image, describe it in 1-2 sentences for accessibility. Include key visual details.

## Content Inspiration from News (FreeNewsApi)

If `FREENEWS_API_KEY` is set, fetch trending news for content ideas:
```bash
curl -s "https://api.freenewsapi.io/v1/news?limit=10" \
  -H "X-API-Key: $FREENEWS_API_KEY"
```
Use the returned articles to find timely topics to write about. Can filter by `topic`, `language`, `country`.

## Web Research (Jina AI)

If `JINA_API_KEY` is set, read any URL as clean Markdown for research:
```bash
curl -s "https://r.jina.ai/<URL>" \
  -H "Authorization: Bearer $JINA_API_KEY"
```
Use this to research topics, read competitor content, or extract information from web pages.

## Hashtag Research

Use `websearch` to find trending hashtags for the topic. Suggest 5-10 relevant ones mixing broad and niche tags.

## Content Repurposing

Convert content between formats:
- **Blog post → Thread**: Extract 3-5 key points, turn each into a post
- **Thread → Reel script**: Pick the best point, write a 30-60s script
- **Video → Post**: Summarize key takeaway in 2 sentences
- **Post → Carousel**: Expand each point into a slide

## Style

Brand: Technical but accessible software developer.
- Posts under 200 words
- 3-5 relevant hashtags
- Include a call to action
- Natural emoji use (not excessive)
