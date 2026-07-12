# Deploy to Render

## Prerequisites

1. A [Render](https://render.com) account
2. Your OpenRouter API key
3. Your Gemini API key (optional)
4. Your Facebook Page Access Token (optional)
5. A GitHub/GitLab account to host the repo

## Steps

### 1. Push to Git

```bash
cd ~/.openclaw/workspace
git init
git add .
git commit -m "Initial commit: social media agent"
gh repo create social-media-agent --private --push
```

### 2. Create the Service on Render

1. Go to [dashboard.render.com](https://dashboard.render.com)
2. Click **New +** → **Blueprint**
3. Connect your repo
4. Render will read `deploy/render.yaml` and create the service

### 3. Set Secrets

For each `sync: false` env var in `render.yaml`, Render prompts you to enter the value:

| Variable | Value |
|----------|-------|
| `OPENCLAW_GATEWAY_TOKEN` | Run `openssl rand -hex 24` locally |
| `OPENAI_API_KEY` | Your OpenRouter key: `sk-or-v1-...` |
| `GEMINI_API_KEY` | Your Gemini key: `AIzaSy...` |
| `FACEBOOK_ACCESS_TOKEN` | Your Facebook page token |

### 4. Deploy

Render will build and deploy automatically. The gateway listens on the assigned `$PORT` and is available at `https://social-media-agent.onrender.com`.

### 5. Authenticate WhatsApp

After first deploy, WhatsApp needs authentication:

```bash
# Watch the logs for the QR code
openclaw channel login whatsapp

# Or via Render dashboard → Logs → look for QR code
# Scan the QR code with WhatsApp on your phone
```

### 6. Create Cron Jobs

Once the gateway is running, create cron jobs:

```bash
# Test job (weekdays 8AM)
openclaw cron add "0 8 * * 1-5" "Say exactly this and nothing else: 'Test cron: your AI social media agent is live. OpenRouter + WhatsApp working successfully.'" --name test-job --announce --channel last --to "+213780688125"

# Weekly analytics (Monday 10AM)
openclaw cron add "0 10 * * 1" "Review last week's social media analytics. Read files from memory/analytics/, calculate week-over-week changes, identify top-performing content types, and suggest strategy adjustments for the coming week." --name weekly-analytics-review --announce --channel last --to "+213780688125"

# Weekly lead scan (Monday 2PM)
openclaw cron add "0 14 * * 1" "Run a lead scan: search the web for potential clients needing software development services. Use the lead-hunter skill to find and score prospects. Store any high-value leads in memory/leads/ and draft outreach messages." --name weekly-lead-scan --announce --channel last --to "+213780688125"
```

## Files

| File | Purpose |
|------|---------|
| `deploy/Dockerfile` | Container build |
| `deploy/openclaw.json` | Production config (no secrets) |
| `deploy/entrypoint.sh` | First-run state init + startup |
| `deploy/render.yaml` | Render Blueprint service definition |
| `deploy/.env.example` | Required env vars documentation |
| `skills/` | Agent skill definitions |
| `memory/` | Persistent agent memory |
| `AGENTS.md` | Agent behavior rules |

## Notes

- **Persistent disk** (`/data`) stores SQLite databases, credentials, and logs
- On first deploy, the disk is empty; the entrypoint seeds it from bundled defaults
- WhatsApp credentials are **not** included in the Docker image for security; authenticate after deploy
- Gateway token comes from `OPENCLAW_GATEWAY_TOKEN` env var
