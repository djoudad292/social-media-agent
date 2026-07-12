# Client Hunter Heartbeat

Run these checks every heartbeat cycle (every 30 minutes):

## Due Outreach Check

Read `~/.openclaw/workspace/client-hunter/state/pipeline.json` and check:
- Any leads with `touch_count` > 0 but `last_contact` older than the next touch interval
- Touch schedule: Touch 1 (day 0), Touch 2 (day 3), Touch 3 (day 6), Touch 4 (day 10), Touch 5 (day 14)
- If any are due, notify: "Outreach due for [company] — touch #[N]"

## New High-Priority Lead Alert

- If new leads were added since last heartbeat with priority "high", notify immediately
- Include company name, score, and source

## Pipeline Staleness

- Flag any leads stuck in same status for > 7 days
- Suggest action: follow up, move to nurture, or drop

## Skip Conditions

- Skip if no leads exist in pipeline
- Skip if last pipeline run was < 4 hours ago
- Skip if all leads are in terminal state (won/lost/nurture)
