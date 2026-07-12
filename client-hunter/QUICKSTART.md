# Client Hunter — Quick Start

## File Structure

```
~/.openclaw/workspace/client-hunter/
├── AGENTS.md                          # Standing orders (auto-injected)
├── HEARTBEAT.md                       # Periodic checks
├── setup-cron.sh                      # Cron job setup script
├── workflows/
│   ├── lead-discovery.lobster         # Find + score new leads
│   ├── lead-research.lobster          # Deep research on a lead
│   ├── proposal-gen.lobster           # Generate personalized proposal
│   ├── outreach-execution.lobster     # Multi-touch outreach with approval
│   └── client-hunter-pipeline.lobster # Master orchestrator
├── leads/                             # Individual lead JSON files
├── state/
│   ├── pipeline.json                  # Full pipeline state
│   ├── last_run.json                  # Last run metadata
│   └── research_<id>.json            # Research per lead
└── output/
    ├── proposal_<id>.json            # Generated proposals
    └── weekly-review-<date>.md       # Weekly reports
```

## Setup

### 1. Enable Lobster plugin

In `~/.openclaw/openclaw.json`:
```json
{
  "plugins": {
    "entries": {
      "lobster": { "enabled": true }
    }
  },
  "agents": {
    "list": [{
      "id": "main",
      "tools": { "allow": ["lobster"] }
    }]
  }
}
```

### 2. Run cron setup

```bash
bash ~/.openclaw/workspace/client-hunter/setup-cron.sh
```

### 3. Verify

```bash
openclaw cron list
```

## Manual Runs

### Run full pipeline
```
Run the client hunter pipeline: lobster run ~/.openclaw/workspace/client-hunter/workflows/client-hunter-pipeline.lobster
```

### Run discovery only
```
Run lead discovery: lobster run ~/.openclaw/workspace/client-hunter/workflows/lead-discovery.lobster --args-json '{"query": "hire full stack developer Next.js", "num_results": "10"}'
```

### Research a specific lead
```
Run research: lobster run ~/.openclaw/workspace/client-hunter/workflows/lead-research.lobster --args-json '{"lead_id": "companyname_20260506"}'
```

### Generate proposal for a lead
```
Run proposal: lobster run ~/.openclaw/workspace/client-hunter/workflows/proposal-gen.lobster --args-json '{"lead_id": "companyname_20260506"}'
```

### Send outreach touch
```
Run outreach: lobster run ~/.openclaw/workspace/client-hunter/workflows/outreach-execution.lobster --args-json '{"lead_id": "companyname_20260506", "touch_number": "1"}'
```

## Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CRON SCHEDULE                            │
│  09:00  │  10:00   │  11:00   │  14:00   │  16:00 Fri          │
│  Discover│ Research │ Proposals│ Outreach │ Weekly Review       │
└────┬──────────┬──────────┬──────────┬──────────┬─────────────────┘
     │          │          │          │          │
     ▼          ▼          ▼          ▼          ▼
┌─────────┐┌──────────┐┌───────────┐┌──────────┐┌──────────────┐
│ lead-   ││ lead-    ││ proposal- ││ outreach ││ Weekly       │
│discovery││ research ││ gen       ││ execution││ summary      │
│.lobster ││.lobster  ││.lobster   ││.lobster ││ report       │
└────┬────┘└────┬─────┘└─────┬─────┘└────┬─────┘└──────────────┘
     │          │            │           │
     ▼          ▼            ▼           ▼
┌─────────────────────────────────────────────────────┐
│              leads/<id>.json (state)                │
│  id, company, score, status, touch_count, log...    │
└─────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────┐
│              state/pipeline.json                    │
│  Full pipeline view + summary stats                 │
└─────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────┐
│              output/proposal_<id>.json              │
│  Email, LinkedIn message, follow-ups, tech approach │
└─────────────────────────────────────────────────────┘

Heartbeat (every 30 min):
  └─ Checks for due outreach, new high-priority leads, stale leads
```

## Lobster Workflow Chaining

Workflows call each other via the `lobster:` directive:

```yaml
# client-hunter-pipeline.lobster
steps:
  - id: discover
    lobster: workflows/lead-discovery.lobster

  - id: research
    lobster: workflows/lead-research.lobster
    args-json: '{"lead_id": "from_previous_step"}'
    when: $discover.json.new_leads.length > 0
```

## Cron Management

```bash
# List all cron jobs
openclaw cron list

# Pause a job
openclaw cron pause client-hunter-discovery

# Resume a job
openclaw cron resume client-hunter-discovery

# Delete a job
openclaw cron delete client-hunter-discovery

# Run a job manually
openclaw cron run client-hunter-discovery
```

## Task Flow Monitoring

```bash
# List active flows
openclaw tasks flow list

# Show a specific flow
openclaw tasks flow show <flow-id>

# Cancel a flow
openclaw tasks flow cancel <flow-id>
```
