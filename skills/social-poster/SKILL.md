---
name: social-poster
description: Post content to Facebook, build reels with Pexels + FFmpeg, add TTS voiceover and music
---

All API keys available: FACEBOOK_ACCESS_TOKEN, PEXELS_API_KEY, GEMINI_API_KEY

## Facebook Post

```
POST https://graph.facebook.com/v21.0/me/feed
Params: access_token={FACEBOOK_ACCESS_TOKEN}, message=<content>
```

## Reel Generation (9:16)

### 1. Choose visuals (pick one)

**Option A — Stock clips from Pexels (default)**
```
GET https://api.pexels.com/videos/search?query=<keyword>&per_page=3&orientation=portrait
Headers: Authorization: {PEXELS_API_KEY}
```
Pick HD video files from results. Download with `curl -o /tmp/clip1.mp4 <url>`.

**Option B — AI-generated images from Gemini Imagen (custom visuals)**
```bash
# Generate unique AI image for reel background
curl -s -X POST "https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:generateContent?key=$GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "instances": [{"prompt": "Cinematic tech workspace with neon lights, cyberpunk style, 9:16 aspect ratio"}],
    "parameters": {"sampleCount": 1}
  }' | python3 -c "
import json,sys
d=json.load(sys.stdin)
img = d['predictions'][0]['bytesBase64Encoded']
open('/tmp/reel_bg.png','wb').write(__import__('base64').b64decode(img))
print('Saved to /tmp/reel_bg.png')
"
# Then animate it with FFmpeg ken burns effect
ffmpeg -loop 1 -i /tmp/reel_bg.png -t 10 -vf "scale=1080:1920,zoompan=z=zoom+0.002:x=iw/2-(iw/zoom/2):y=ih/2-(ih/zoom/2):d=250" \
  -c:v libx264 -pix_fmt yuv420p /tmp/animated_bg.mp4 -y
```

### 2. Generate voiceover (free, natural quality)

**Primary: edge-tts (Microsoft Neural TTS, free, no API key)**
```bash
# Install: pip install --break-system-packages edge-tts
echo "Your voiceover text here" > /tmp/script.txt
edge-tts --file /tmp/script.txt --voice en-US-JennyNeural --write-media /tmp/voiceover.mp3
# Other good voices: en-US-GuyNeural (male), en-GB-SoniaNeural (British female)
```

**Fallback: espeak (robotic, no dependencies)**
```bash
espeak -f /tmp/script.txt -w /tmp/voiceover.wav -s 150 -p 50
```

### 3. Add background music

**Option A — Free music from Pixabay API**
```bash
# Get free key at: https://pixabay.com/api/docs/ (free account)
curl -s "https://pixabay.com/api/v1/music/?key=$PIXABAY_API_KEY&genre=ambient&duration_min=15&duration_max=30" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['hits'][0]['url'] if d.get('hits') else 'none')" \
  | xargs -I{} curl -L -o /tmp/background_music.mp3 "{}"
```

**Option B — Free music from Freesound (no key for downloads)**
```bash
curl -s "https://freesound.org/apiv2/search/text/?query=ambient+background&duration=15&fields=id,previews" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); r=d['results'][0]; print(r['previews']['preview-lq-mp3'])"
```

**Option C — Simple tone (always works, no dependencies)**
```bash
sox -n /tmp/music.wav synth 15 sine 440 vol 0.1
```

### 4. Assemble with animated captions

```bash
# Generate SRT subtitle file from script for word-by-word captions
# Write script to a text file first, then create subtitle entries
echo "1
00:00:00,000 --> 00:00:05,000
Your voiceover text here appears as captions

2
00:00:05,000 --> 00:00:10,000
Second line of your caption text

3
00:00:10,000 --> 00:00:15,000
Final line with call to action" > /tmp/captions.srt

# Assemble: crop to 9:16, scale to 1080x1920, burn subtitles, mix audio
ffmpeg -i /tmp/clip1.mp4 -i /tmp/voiceover.mp3 -i /tmp/music.wav \
  -filter_complex "[0:v]crop=ih*9/16:ih,scale=1080:1920,subtitles=/tmp/captions.srt:force_style='FontName=Arial,FontSize=28,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=3,Outline=2,Shadow=0,MarginV=60'[v];[1:a][2:a]amix=inputs=2:duration=first[a]" \
  -map "[v]" -map "[a]" -t 15 /tmp/reel_final.mp4 -y
```

### 5. Post reel to Facebook
```
POST https://graph.facebook.com/v21.0/me/videos
Params: access_token={FACEBOOK_ACCESS_TOKEN}, file=<video file>, description=<text>
```

### 6. Post reel to TikTok (optional)
```
POST https://open.tiktokapis.com/v2/video/upload/
Headers: Authorization: Bearer {TIKTOK_ACCESS_TOKEN}
Body: multipart with source=video.mp4 and description=text
```

### 7. Post reel to Instagram (optional)

**Prerequisite:** An Instagram Business Account must be connected to your Facebook page.
Check with: `GET https://graph.facebook.com/v21.0/651243158078819?fields=instagram_business_account&access_token={FACEBOOK_ACCESS_TOKEN}`

If `instagram_business_account` is null, go to Instagram → Settings → Account → Linked Accounts → Facebook → select your page.

**Posting:** Instagram requires the video to be publicly accessible via URL first:
```bash
# Step 1: Upload video to a temporary public location (e.g., your server)
# Step 2: Create a media container
curl -X POST "https://graph.facebook.com/v21.0/{ig-user-id}/media" \
  -d "media_type=REELS" \
  -d "video_url=https://your-server.com/reel_final.mp4" \
  -d "caption=Your caption with #hashtags" \
  -d "access_token={FACEBOOK_ACCESS_TOKEN}"

# Step 3: Get the container ID from the response, then publish it
curl -X POST "https://graph.facebook.com/v21.0/{ig-user-id}/media_publish" \
  -d "creation_id={container-id}" \
  -d "access_token={FACEBOOK_ACCESS_TOKEN}"
```

## Cross-Posting

When the user asks to post to multiple platforms:
1. Adapt content for each platform (length, tone, format)
2. Post to each platform sequentially
3. Report results per platform

## Auto-Poster Cron (optional)

To run fully autonomous, create a cron job that:
1. Reads the weekly content plan from `memory/strategy/YYYY-WW.json`
2. Picks the next unscheduled post
3. Generates content with content-writer skill
4. Generates reel with this pipeline
5. Posts to Facebook (and optionally TikTok/IG)
6. Logs to `memory/posts/YYYY-MM-DD.json`

```
openclaw cron add --name auto-poster \
  --schedule "0 9,15 * * 1-5" \
  --task "Check weekly plan, generate next post, publish to Facebook" \
  --deliver whatsapp:+213780688125
```

## Optional: AI Video Generation (Higgsfield)

If `HIGGSFIELD_API_KEY` is set and has credits, you can use AI-generated videos instead of Pexels.

### Text-to-Video
```bash
curl -s -X POST "https://platform.higgsfield.ai/higgsfield-ai/dop/standard" \
  -H "Authorization: Key ${HIGGSFIELD_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"image_url": "<uploaded-image-url>", "prompt": "Cinematic camera movement", "duration": 5}'
```

### Use in Reel Pipeline
When generating a reel:
1. If user asks for **AI-generated visuals** → use Gemini Imagen + FFmpeg animation
2. If user wants **talking avatar** → use Higgsfield Speak workflow (if key has credits)
3. Always prefer edge-tts for voiceover (natural quality)
4. Add animated SRT captions + background music

## Profile Check

```
GET /me?fields=id,name,picture
```
