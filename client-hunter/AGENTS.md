# Client Hunter — Standing Orders

These instructions are injected into every session. The agent has permanent authority to execute the client hunter workflow.

## Authority

- You are authorized to run lead discovery, research, and proposal generation without approval
- You MUST get approval before sending any outreach message
- You MUST NOT fabricate contact information — only use found/verified data
- You MUST respect rate limits on web search and web fetch

## Client Hunter Program

When triggered (manually or via cron), execute the following:

### Discovery Phase (runs daily at 9 AM UTC)
1. Run `lobster run ~/.openclaw/workspace/client-hunter/workflows/lead-discovery.lobster`
2. Parse new leads and save to `~/.openclaw/workspace/client-hunter/leads/`
3. Score and prioritize leads
4. Update `~/.openclaw/workspace/client-hunter/state/pipeline.json`

### Research Phase (runs daily at 10 AM UTC)
1. For each high-priority lead without research:
   - Run `lobster run ~/.openclaw/workspace/client-hunter/workflows/lead-research.lobster --args-json '{"lead_id": "..."}'`
   - Save research to `~/.openclaw/workspace/client-hunter/state/research_<lead_id>.json`
   - Update lead status to `qualified`

### Proposal Phase (runs daily at 11 AM UTC)
1. For each qualified lead with completed research:
   - Run `lobster run ~/.openclaw/workspace/client-hunter/workflows/proposal-gen.lobster --args-json '{"lead_id": "..."}'`
   - Save proposal to `~/.openclaw/workspace/client-hunter/output/proposal_<lead_id>.json`
   - Update lead status to `proposal_ready`

### Outreach Phase (runs daily at 2 PM UTC)
1. For each lead with `proposal_ready` status:
   - Run `lobster run ~/.openclaw/workspace/client-hunter/workflows/outreach-execution.lobster --args-json '{"lead_id": "...", "touch_number": "1"}'`
   - Requires approval before sending
2. Check for follow-ups due (touch 2-5) and queue them

### Weekly Review (runs Friday at 4 PM UTC)
1. Read pipeline state
2. Generate weekly summary report
3. Identify stale leads (no response after 5 touches)
4. Move stale leads to `nurture` status
5. Calculate pipeline metrics

## Lead File Format

Each lead is stored as JSON in `~/.openclaw/workspace/client-hunter/leads/<id>.json`:
```json
{
  "id": "companyname_20260506",
  "company": "Company Name",
  "source": "HN Who's Hiring",
  "source_url": "https://...",
  "need": "What they need",
  "contact_name": "John Doe",
  "contact_email": "john@company.com",
  "status": "discovery|qualified|proposal_sent|demo_built|negotiation|won|lost|nurture",
  "score": 15,
  "priority": "high|medium|low",
  "scores": {"budget_potential": 4, "stack_match": 5, "timeline_urgency": 3, "relationship_potential": 3},
  "date_added": "2026-05-06",
  "last_contact": null,
  "touch_count": 0,
  "proposal_sent": false,
  "research_completed": false,
  "outreach_log": []
}
```

## Profile Reference

- Portfolio: https://djaouad.netlify.app
- Email: oufr29@gmail.com
- WhatsApp: +213780688125
- LinkedIn: https://www.linkedin.com/in/djaouad-frih-16ab7323a
- GitHub: https://github.com/djoudad292
- Stack: Next.js, NestJS, TypeScript, TailwindCSS, PostgreSQL, MySQL, Redis, Docker, WebSockets, Gemini API

## Portfolio Projects

| Project | Key Points | Match For |
|---------|-----------|-----------|
| LordHavale | Payment gateway, AES-256, Docker, webhooks, rate limiting | Fintech, payment processing, API integration |
| Cuvva Copy | Policy platform, PDF generation, email workflows, PWA | Insurance, document automation, PWA |
| AI Chatbot | Real-time WebSocket chat, LLM integration, conversation history | AI features, chatbots, real-time systems |
| Restaurant Page | SSR, SEO, booking system, TailwindCSS, mobile-first | Landing pages, SEO, small business sites |
