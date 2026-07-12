#!/bin/bash
# Client Hunter — Cron Setup
# Run these commands to schedule the automated pipeline
# Prerequisites: Lobster plugin enabled in openclaw config

echo "Setting up Client Hunter cron jobs..."

# Daily lead discovery at 9:00 AM UTC
openclaw cron add \
  --name "client-hunter-discovery" \
  --schedule "0 9 * * *" \
  --agent main \
  --task "Run the client hunter lead discovery workflow. Execute: lobster run ~/.openclaw/workspace/client-hunter/workflows/lead-discovery.lobster. Save all results. Report any high-priority leads found."

# Daily lead research at 10:00 AM UTC
openclaw cron add \
  --name "client-hunter-research" \
  --schedule "0 10 * * *" \
  --agent main \
  --task "Check for high-priority leads that need research. For each un-researched high-priority lead, run: lobster run ~/.openclaw/workspace/client-hunter/workflows/lead-research.lobster --args-json '{\"lead_id\": \"LEAD_ID\"}'. Save research findings."

# Daily proposal generation at 11:00 AM UTC
openclaw cron add \
  --name "client-hunter-proposals" \
  --schedule "0 11 * * *" \
  --agent main \
  --task "For each qualified lead with completed research and no proposal, run: lobster run ~/.openclaw/workspace/client-hunter/workflows/proposal-gen.lobster --args-json '{\"lead_id\": \"LEAD_ID\"}'. Save generated proposals."

# Daily outreach check at 2:00 PM UTC
openclaw cron add \
  --name "client-hunter-outreach" \
  --schedule "0 14 * * *" \
  --agent main \
  --task "Check which leads are due for outreach (based on touch schedule: day 0, 3, 6, 10, 14). For each due lead, prepare the outreach message using the saved proposal. Present messages for approval before sending."

# Weekly pipeline review — Friday at 4:00 PM UTC
openclaw cron add \
  --name "client-hunter-weekly-review" \
  --schedule "0 16 * * 5" \
  --agent main \
  --task "Run weekly client hunter review. Read pipeline.json from ~/.openclaw/workspace/client-hunter/state/. Generate a summary: total leads, conversion rate, revenue pipeline, stale leads to move to nurture. Save report to ~/.openclaw/workspace/client-hunter/output/weekly-review-$(date +%Y-%m-%d).md"

echo ""
echo "Cron jobs created:"
echo "  09:00 UTC — Lead discovery"
echo "  10:00 UTC — Lead research (high priority)"
echo "  11:00 UTC — Proposal generation"
echo "  14:00 UTC — Outreach execution"
echo "  16:00 UTC Fri — Weekly pipeline review"
echo ""
echo "Verify with: openclaw cron list"
echo "Manage with: openclaw cron <list|pause|resume|delete> <name>"
