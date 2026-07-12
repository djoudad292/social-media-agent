name: client-hunter-pipeline
description: Master pipeline orchestrating full client hunter workflow from discovery to outreach
args:
  mode:
    default: "full"
  target_leads:
    default: "high_priority"
  max_leads:
    default: "5"
steps:
  - id: preflight_check
    run: |
      python3 -c "
import json, os
from datetime import datetime

state_dir = '$HOME/.openclaw/workspace/client-hunter/state'
os.makedirs(state_dir, exist_ok=True)

checks = {
    'workspace_exists': os.path.exists('$HOME/.openclaw/workspace/client-hunter'),
    'workflows_exist': os.path.exists('$HOME/.openclaw/workspace/client-hunter/workflows'),
    'leads_dir_exists': os.path.exists('$HOME/.openclaw/workspace/client-hunter/leads'),
    'timestamp': datetime.utcnow().isoformat()
}

# Check last run
last_run_file = os.path.join(state_dir, 'last_run.json')
if os.path.exists(last_run_file):
    with open(last_run_file) as f:
        last_run = json.load(f)
    checks['last_run'] = last_run.get('timestamp', 'never')
    checks['last_run_type'] = last_run.get('type', 'unknown')
else:
    checks['last_run'] = 'never'

print(json.dumps(checks, indent=2))

# Save run metadata
checks['type'] = 'pipeline_${LOBSTER_ARG_MODE}'
with open(last_run_file, 'w') as f:
    json.dump(checks, f, indent=2)
"

  - id: run_discovery
    lobster: workflows/lead-discovery.lobster
    when: "'$LOBSTER_ARG_MODE' in ['full', 'discover']"

  - id: load_pipeline_state
    run: |
      python3 -c "
import json, os, glob

state_dir = '$HOME/.openclaw/workspace/client-hunter/state'
leads_dir = '$HOME/.openclaw/workspace/client-hunter/leads'
pipeline_file = os.path.join(state_dir, 'pipeline.json')

if os.path.exists(pipeline_file):
    with open(pipeline_file) as f:
        pipeline = json.load(f)
else:
    pipeline = {'leads': []}

mode = '$LOBSTER_ARG_MODE'
target = '$LOBSTER_ARG_TARGET_LEADS'
max_leads = int('$LOBSTER_ARG_MAX_LEADS')

# Select leads to process
if mode == 'full':
    leads = pipeline.get('leads', [])
elif mode == 'outreach':
    leads = [l for l in pipeline.get('leads', []) if l.get('status') in ['discovery', 'qualified']]
elif mode == 'research':
    leads = [l for l in pipeline.get('leads', []) if l.get('status') == 'qualified' and not l.get('research_completed')]
else:
    leads = pipeline.get('leads', [])

# Filter by target
if target == 'high_priority':
    leads = [l for l in leads if l.get('priority') == 'high']
elif target == 'medium_plus':
    leads = [l for l in leads if l.get('priority') in ['high', 'medium']]

leads = leads[:max_leads]

print(json.dumps({'leads_to_process': leads, 'count': len(leads)}))
"

  - id: process_leads
    pipeline: >
      llm_task.invoke --prompt "
      Process the leads from the pipeline. For each lead, determine what action to take next:

      - If status is 'discovery' and score >= 14: Move to 'qualified', run research
      - If status is 'qualified' and no research: Run deep research
      - If research done and no proposal: Generate proposal
      - If proposal done and touch_count < 5: Schedule next outreach touch
      - If touch_count >= 5 and no response: Move to 'nurture'

      Return a JSON action plan:
      {
        'action_plan': [
          {
            'lead_id': 'id',
            'company': 'name',
            'current_status': 'status',
            'next_action': 'research|proposal|outreach|nurture',
            'next_touch': 1-5 (if outreach),
            'priority': 'high|medium|low'
          }
        ],
        'summary': {
          'research_needed': count,
          'proposals_needed': count,
          'outreach_needed': count,
          'nurture_count': count
        }
      }
      "
    stdin: $load_pipeline_state.stdout

  - id: daily_report
    pipeline: >
      llm_task.invoke --prompt "
      Generate a daily client hunter report summarizing today's activities.

      Include:
      - New leads discovered (with names and scores)
      - Leads researched (with key findings)
      - Proposals generated
      - Outreach sent
      - Pipeline summary (total leads by stage)
      - Recommended actions for tomorrow
      - Revenue potential of current pipeline

      Format as clean markdown. Be specific with numbers and company names.
      "
    stdin: $process_leads.stdout
