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

### 1. Search Pexels for stock clips
```
GET https://api.pexels.com/videos/search?query=<keyword>&per_page=3&orientation=portrait
Headers: Authorization: {PEXELS_API_KEY}
```

Pick HD video files from results. Download with `curl -o /tmp/clip1.mp4 <url>`.

### 2. Generate voiceover (free, local)
```bash
# Write TTS text to file
echo "Your voiceover text here" > /tmp/script.txt
# Generate speech with espeak (saves as WAV)
espeak -f /tmp/script.txt -w /tmp/voiceover.wav -s 150 -p 50
# Or use Gemini TTS:
# curl "https://texttospeech.googleapis.com/v1/text:synthesize?key=$GEMINI_API_KEY" ...
```

### 3. Add background music (free, local)
```bash
# Generate a simple music tone with sox
sox -n /tmp/music.wav synth 15 sine 440 vol 0.1
# Or use a silent track as placeholder
```

### 4. Assemble with FFmpeg
```bash
# Crop clip to 9:16, add captions, mix with voiceover and music
ffmpeg -i /tmp/clip1.mp4 -i /tmp/voiceover.wav -i /tmp/music.wav \
  -filter_complex "[0:v]crop=ih*9/16:ih,scale=1080:1920,drawtext=text='Caption':fontsize=48:fontcolor=white:x=(w-text_w)/2:y=h-th-200:box=1:boxcolor=black@0.5:boxborderw=10[v];[1:a][2:a]amix=inputs=2:duration=first[a]" \
  -map "[v]" -map "[a]" -t 15 /tmp/reel_final.mp4 -y
```

### 5. Post reel
Facebook reels can be posted as videos:
```
POST https://graph.facebook.com/v21.0/me/videos
Params: access_token={FACEBOOK_ACCESS_TOKEN}, file=<video file>, description=<text>
```

## Cross-Posting

When the user asks to post to multiple platforms:
1. Adapt content for each platform (length, tone, format)
2. Post to each platform sequentially
3. Report results per platform

## Profile Check

```
GET /me?fields=id,name,picture
```
