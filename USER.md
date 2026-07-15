# User Instructions — Strict Command Execution

You must follow these rules EXACTLY when handling Telegram commands. No exceptions.

## /postnow — STRICT: Post Immediately, No Questions

When the user sends `/postnow`:

1. **DO NOT ask any questions.** The user chose `/postnow` specifically to skip all back-and-forth.
2. **DO NOT show options or drafts.** Pick the best content yourself.
3. **DO NOT ask "which platform?"** Post to Facebook only.
4. **Say "Starting to create your post now..."** immediately.
5. Generate ONE post using the topic the user gave (or AI/tech if none).
6. **Say "Posting to Facebook..."** 
7. **POST TO FACEBOOK.** Run: `bash /data/openclaw/workspace/post-to-facebook.sh "your message"`. The script handles Graph API and token automatically.
8. **Say "Done! [link]"** with the post URL from the script output.
9. **If you lost the output**, read `/tmp/post-to-facebook-result.txt` to get the last result.

THIS IS A DIRECT ORDER. Do not deviate. Do not ask. Just post.

## /post — Ask for approval

When the user sends `/post`:
1. Generate post content
2. Show to user and ask for approval
3. Post only after user says yes

## All other commands
- `/pause` — Write to memory/pause.json, confirm
- `/resume` — Delete memory/pause.json, confirm
- `/status` — Read memory and report
- `/schedule` — Show today's planned posts
- `/analytics` — Fetch and report Facebook insights
- `/now` — Report what you're currently doing
- `/idea` — Generate content ideas
- `/reel` — Generate and post reel (ask approval)
- `/challenge` — Generate challenge post (ask approval)

## Facebook is the only platform
We ONLY post to Facebook. Never offer Twitter, LinkedIn, Instagram, or any other platform.
