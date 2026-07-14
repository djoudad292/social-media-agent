---
name: social-poster
description: Post content to Facebook, build reels with Pexels + FFmpeg, add TTS voiceover and music
---

All API keys available: FACEBOOK_ACCESS_TOKEN, PEXELS_API_KEY, GEMINI_API_KEY, MAGIC_HOUR_API_KEY, UDIO_API_KEY, REAPI_API_KEY, DUB_API_KEY, JINA_API_KEY

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
# Then animate it with FFmpeg ken burns effect (low-resource preset for Render)
ffmpeg -loop 1 -i /tmp/reel_bg.png -t 10 -vf "scale=1080:1920,zoompan=z=zoom+0.002:x=iw/2-(iw/zoom/2):y=ih/2-(ih/zoom/2):d=250" \
  -c:v libx264 -preset ultrafast -threads 1 -pix_fmt yuv420p /tmp/animated_bg.mp4 -y
```

### 2. Generate voiceover (pick the best option for your needs)

**Option A — Azure AI Speech TTS (highest quality, Arabic support, uses $100 credits)**
```bash
# Azure Speech TTS — 45+ voices across 15 languages, including Arabic
# Uses AZURE_SPEECH_KEY and AZURE_SPEECH_REGION env vars
IFS= read -d '' SSML << 'SSML_END'
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
  <voice name="en-US-JennyNeural">
    Your voiceover text here — Azure Neural TTS produces the most natural output.
  </voice>
</speak>
SSML_END

curl -s -X POST "https://${AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1" \
  -H "Ocp-Apim-Subscription-Key: ${AZURE_SPEECH_KEY}" \
  -H "Content-Type: application/ssml+xml" \
  -H "X-Microsoft-OutputFormat: audio-16khz-128kbitrate-mono-mp3" \
  -d "$SSML" -o /tmp/voiceover.mp3

# Arabic voice example (change xml:lang to "ar-SA" and voice to "ar-SA-ZariyahNeural"):
# curl (same as above) with SSML using xml:lang="ar-SA", voice name="ar-SA-ZariyahNeural"
```

Available Azure Neural voices: en-US-JennyNeural (female), en-US-GuyNeural (male), en-GB-SoniaNeural (British), ar-SA-ZariyahNeural (Arabic female), ar-SA-HamedNeural (Arabic male), and 400+ more across 140+ locales.

**Option B — edge-tts (free, no API key, good quality)**
```bash
# Install: pip install --break-system-packages edge-tts
echo "Your voiceover text here" > /tmp/script.txt
edge-tts --file /tmp/script.txt --voice en-US-JennyNeural --write-media /tmp/voiceover.mp3
# Other good voices: en-US-GuyNeural (male), en-GB-SoniaNeural (British female)
```

**Option C — Magic Hour (celebrity voices, uses credits)**
```bash
curl -s -X POST "https://api.magichour.ai/v1/ai-voice-generator" \
  -H "Authorization: Bearer $MAGIC_HOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"voice_id":"default","style":{"prompt":"<your text>","voice_name":"Morgan Freeman"}}'
```
Voices: Joe Rogan, Morgan Freeman, David Attenborough, Taylor Swift, MrBeast, Snoop Dogg, etc.

**Fallback: espeak (robotic, no dependencies)**
```bash
espeak -f /tmp/script.txt -w /tmp/voiceover.wav -s 150 -p 50
```

### 3. Add background music

**Option A — Free music from Freesound (no key required)**
```bash
curl -s "https://freesound.org/apiv2/search/text/?query=ambient+background&duration=15&fields=id,previews" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); r=d['results'][0]; print(r['previews']['preview-lq-mp3'])"
```

**Option B — Simple tone (always works, no dependencies)**
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
# Use ultrafast preset + 1 thread to avoid OOM on Render free tier
ffmpeg -i /tmp/clip1.mp4 -i /tmp/voiceover.mp3 -i /tmp/music.wav \
  -filter_complex "[0:v]crop=ih*9/16:ih,scale=1080:1920,subtitles=/tmp/captions.srt:force_style='FontName=Arial,FontSize=28,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=3,Outline=2,Shadow=0,MarginV=60'[v];[1:a][2:a]amix=inputs=2:duration=first[a]" \
  -map "[v]" -map "[a]" -c:v libx264 -preset ultrafast -threads 1 -t 15 /tmp/reel_final.mp4 -y
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

## AI Video Generation — Magic Hour (Veo 3.1)

If `MAGIC_HOUR_API_KEY` is set, use Magic Hour for AI video generation.

### Text-to-Video
```bash
curl -s -X POST "https://api.magichour.ai/v1/text-to-video" \
  -H "Authorization: Bearer $MAGIC_HOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model_name":"veo-3.1","resolution":"720p","end_seconds":5,"aspect_ratio":"9:16","style":{"prompt":"<detailed scene description, cinematic>"}}'
```
Poll `GET https://api.magichour.ai/v1/video-projects/{id}` until status="complete", then read `downloads[0].url`.

### Image-to-Video
```bash
curl -s -X POST "https://api.magichour.ai/v1/image-to-video" \
  -H "Authorization: Bearer $MAGIC_HOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model_name":"veo-3.1","resolution":"720p","end_seconds":5,"aspect_ratio":"9:16","style":{"prompt":"<motion description>"},"image_url":"<public image URL>"}'
```

### AI Image Generation
```bash
curl -s -X POST "https://api.magichour.ai/v1/ai-image-generator" \
  -H "Authorization: Bearer $MAGIC_HOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model_name":"nano-banana-2","style":{"prompt":"<image description>"},"image_count":1}'
```

### AI Voiceover (celebrity voices)
```bash
curl -s -X POST "https://api.magichour.ai/v1/ai-voice-generator" \
  -H "Authorization: Bearer $MAGIC_HOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"voice_id":"default","style":{"prompt":"<your text>","voice_name":"<name from list>"}}'
```
Voice options: "Joe Rogan", "Morgan Freeman", "David Attenborough", "Taylor Swift", "MrBeast", "Snoop Dogg", "Eminem", and 200+ more.

## AI Video Generation — reAPI (HappyHorse 1.0, Kling 3.0)

If `REAPI_API_KEY` is set, use reAPI for top-ranked AI video.

### HappyHorse 1.0 (currently #1 on leaderboard)
```bash
curl -s -X POST "https://reapi.ai/api/v1/videos/generations" \
  -H "Authorization: Bearer $REAPI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"happyhorse-1.0","prompt":"<detailed scene>","size":"9:16","duration":5}'
```
Poll `GET https://reapi.ai/api/v1/tasks/{task_id}` until status="completed".

### Kling 3.0
```bash
curl -s -X POST "https://reapi.ai/api/v1/videos/generations" \
  -H "Authorization: Bearer $REAPI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"kling-3-0","prompt":"<detailed scene>","size":"9:16","duration":5}'
```

### Midjourney V7 Images
```bash
curl -s -X POST "https://reapi.ai/api/v1/images/generations" \
  -H "Authorization: Bearer $REAPI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"mj-v7","prompt":"<image description> --ar 9:16"}'
```

## AI Music Generation — UdioAPI.pro

If `UDIO_API_KEY` is set, generate custom background music for reels.

```bash
curl -s -X POST "https://udioapi.pro/api/v2/generate" \
  -H "Authorization: Bearer $UDIO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"suno-v4","prompt":"<style description>","duration":15}'
```
Poll `GET https://udioapi.pro/api/v2/tasks/{task_id}` until done.

## URL Shortener — Dub.co

If `DUB_API_KEY` is set, shorten URLs with click tracking (domain: djaouad-tech.com).

```bash
curl -s -X POST "https://api.dub.co/links" \
  -H "Authorization: Bearer $DUB_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"<long URL>","domain":"djaouad-tech.com"}'
```
Response includes `shortLink` field.

## Web Research — Jina AI Reader

If `JINA_API_KEY` is set, read any URL as clean Markdown.

```bash
curl -s "https://r.jina.ai/<URL>" \
  -H "Authorization: Bearer $JINA_API_KEY"
```

## Media Hosting — Azure Blob Storage

If `AZURE_STORAGE_CONNECTION_STRING` is set, upload media files for public access (required for Instagram Reels posting).

```bash
# Upload a file to Azure Blob Storage in the "media" container
az storage blob upload \
  --connection-string "$AZURE_STORAGE_CONNECTION_STRING" \
  --container-name "$AZURE_STORAGE_CONTAINER" \
  --file /tmp/reel_final.mp4 \
  --name reels/$(date +%Y%m%d-%H%M%S).mp4

# Get the public URL
# The blob URL follows this pattern:
echo "https://${AZURE_STORAGE_CONTAINER}.blob.core.windows.net/media/reels/$(date +%Y%m%d-%H%M%S).mp4"
```

Use Azure Blob Storage URLs as the `video_url` when posting Reels to Instagram (requires public blob URL).

## Profile Check

```
GET /me?fields=id,name,picture
```
