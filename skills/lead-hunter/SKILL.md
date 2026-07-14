---
name: lead-hunter
description: Search for potential clients and report findings via chat, send cold emails via Resend
---

All API keys available: RESEND_API_KEY, JINA_API_KEY, DUB_API_KEY

## Discovery

Use `websearch` to find leads:
- "startups looking for software development agency"
- "companies hiring freelance developers [tech]"
- "businesses needing [tech stack] development"

For each lead, use `webfetch` or **Jina AI** for deeper research:
```bash
curl -s "https://r.jina.ai/<lead-website>" \
  -H "Authorization: Bearer $JINA_API_KEY"
```
- Website for outdated tech
- Careers page for developer hiring
- Recent news (funding, expansion)

## Scoring

Score 0-1: budget indicators, need fit, timeline, accessibility

## Email Outreach (Resend)

**⚠️ WARNING — Domain Safety**
- `cuvva.info.uk` is the **warm/safe domain** — use ONLY for newsletters, replies, and engaged leads
- Cold outreach to new leads must use a **separate burner domain** (e.g., `djaouad-tech.com`) to protect the primary domain from spam flags
- Always ask the user which domain to use before sending cold emails

If user approves outreach, send a cold email:
```bash
curl -s -X POST "https://api.resend.com/emails" \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "Djaouad Tech <hello@cuvva.info.uk>",
    "to": "<lead-email>",
    "subject": "<personalized subject>",
    "html": "<html body with tracking links>"
  }'
```

Use **Dub.co** to create tracked links in the email body:
```bash
curl -s -X POST "https://api.dub.co/links" \
  -H "Authorization: Bearer $DUB_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"<your-site-or-portfolio>","domain":"djaouad-tech.com"}'
```

Track opens: add a tracking pixel via Resend (automatic in paid tier).

## Output

Report the top 3-5 leads in your response with name, why they're a fit, score, and suggested approach. Never contact leads without asking the user first.

## Cron: Weekly Lead Scan
```bash
openclaw cron add --name weekly-lead-scan \
  --schedule "0 10 * * 1" \
  --task "Scan for new leads, score them, report top 3-5 to user" \
  --deliver whatsapp:+213780688125
```
