---
name: social-poster
description: Post content to Facebook and generate reels using Pexels stock footage + FFmpeg
---

## Facebook Post

```
POST https://graph.facebook.com/v21.0/me/feed
Params: access_token={FACEBOOK_ACCESS_TOKEN}, message=<content>
```

## Reel Generation (9:16, no paid AI video API needed)

### 1. Search Pexels for stock clips

```
GET https://api.pexels.com/videos/search?query=<keyword>&per_page=5&orientation=portrait
Headers: Authorization: {PEXELS_API_KEY}
```

Returns video files with `video_files` array. Pick the one with max `width` (highest quality).

### 2. Download clips

Use `curl -o /tmp/clip1.mp4 <video_link>` to download the HD or SD video file URL.

### 3. Assemble reel with FFmpeg

Create a 9:16 reel with text captions:

```bash
# Resize/crop clip to 9:16 (1080x1920)
ffmpeg -i /tmp/clip1.mp4 -vf "crop=ih*9/16:ih,scale=1080:1920" -t 15 /tmp/reel_raw.mp4 -y

# Add text overlay (caption)
ffmpeg -i /tmp/reel_raw.mp4 -vf "drawtext=text='Your caption here':fontsize=48:fontcolor=white:x=(w-text_w)/2:y=h-th-200:box=1:boxcolor=black@0.5:boxborderw=10" -c:a copy /tmp/reel_final.mp4 -y
```

For multi-clip reels with transitions:
```bash
# Create concat file
echo "file '/tmp/clip1_ready.mp4'" > /tmp/concat.txt
echo "file '/tmp/clip2_ready.mp4'" >> /tmp/concat.txt
# Concatenate
ffmpeg -f concat -safe 0 -i /tmp/concat.txt -c copy /tmp/reel.mp4 -y
```

### 4. Output

Store the final MP4 as `/tmp/reel_final.mp4`. The file is ready to post or share.

## Profile Check

```
GET /me?fields=id,name,picture
```

## Notes

- Pexels API is free — 200 requests/hour, 20k requests/day
- FFmpeg runs locally on the server (no external API cost)
- Always use portrait orientation (`orientation=portrait`) for reels
- Default duration: 15 seconds per clip, max 60 seconds total
