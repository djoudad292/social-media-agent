# AI Agent System — 4-Account Architecture

## Services

| Account | Service | Port | Role |
|---------|---------|------|------|
| 1 (existing) | **gateway** | 10000 (OpenClaw) + 3999 (sidecar) | Telegram bot, routing, OpenClaw gateway, Azure proxy |
| 2 (new) | **content** | 3001 | LLM calls, content generation, web research, AI images |
| 3 (new) | **media** | 3002 | Reel generation (FFmpeg + Pexels + TTS), voiceovers, stock images |
| 4 (new) | **data** | 3003 | Reddit/HN scraper, Facebook analytics, lead hunting, strategy, Facebook posting |

## Shared Infrastructure

- **Supabase:** Persistent PostgreSQL (memory, posts, analytics, trends, leads, strategy)
- **Redis Cloud:** Heartbeat monitoring, task queue, shared cache

## Communication

Account 1 receives Telegram commands. It routes heavy work to Accounts 2-4 via HTTP.
Each service pings Redis every 60s (heartbeat). All tracked via `/api/status`.

## Deployment

On Render, each service uses `agent-system/Dockerfile` with `--build-arg SERVICE=X`.
Set "Dockerfile Path" → `agent-system/Dockerfile` and "Build Command" → `docker build --build-arg SERVICE=gateway -t agent-gateway .`
