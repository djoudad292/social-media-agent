name: outreach-execution
description: Executes the multi-touch outreach sequence for qualified leads
args:
  lead_id:
    default: ""
  touch_number:
    default: "1"
steps:
  - id: load_lead_and_proposal
    run: |
      lead_id="$LOBSTER_ARG_LEAD_ID"
      leads_dir="$HOME/.openclaw/workspace/client-hunter/leads"
      output_dir="$HOME/.openclaw/workspace/client-hunter/output"

      lead_data=$(cat "$leads_dir/${lead_id}.json" 2>/dev/null || echo '{}')
      proposal_data=$(cat "$output_dir/proposal_${lead_id}.json" 2>/dev/null || echo '{}')

      echo "{\"lead\": $lead_data, \"proposal\": $proposal_data, \"touch\": $LOBSTER_ARG_TOUCH_NUMBER}" | python3 -c "
import sys, json, os
from datetime import datetime, timedelta

data = json.load(sys.stdin)
lead = data['lead']
proposal = data['proposal']
touch = int(data['touch'])

# Check if this touch is due
last_contact = lead.get('last_contact')
touch_count = lead.get('touch_count', 0)

schedule = {1: 0, 2: 3, 3: 6, 4: 10, 5: 14}
if touch in schedule and last_contact:
    days_since = (datetime.utcnow() - datetime.fromisoformat(last_contact)).days
    if days_since < schedule[touch] - schedule.get(touch-1, 0) and touch > 1:
        print(json.dumps({'status': 'not_due', 'reason': 'Too soon for this touch', 'touch': touch}))
        sys.exit(0)

# Determine channel
channels = {1: 'email', 2: 'linkedin', 3: 'email', 4: 'whatsapp', 5: 'email'}
channel = channels.get(touch, 'email')

# Get message content
messages = {
    1: proposal.get('email_body', ''),
    3: proposal.get('follow_up_message', ''),
    5: proposal.get('final_follow_up', '')
}
message = messages.get(touch, '')

# If touch 2 or 4, generate a short message
if touch in [2, 4] and not message:
    message = None  # Will be generated in next step

print(json.dumps({
    'status': 'ready',
    'touch': touch,
    'channel': channel,
    'company': lead.get('company', ''),
    'contact_name': lead.get('contact_name', ''),
    'contact_email': lead.get('contact_email', ''),
    'message': message,
    'need_generate': message is None or message == '',
    'subject_line': proposal.get('subject_line', ''),
    'lead_id': lead_id,
    'linkedin_url': lead.get('linkedin', ''),
    'whatsapp': '+213780688125'
}, indent=2))
"

  - id: generate_touch_message
    pipeline: >
      llm_task.invoke --prompt "
      Generate a short outreach message for touch #{touch_number}.

      Context:
      - Company: {company}
      - Contact: {contact_name}
      - Channel: {channel}
      - This is touch {touch_number} of 5 in our outreach sequence

      Rules for this touch:
      Touch 2 (Day 3, LinkedIn): Connection request with brief note (max 300 chars). Friendly, non-salesy. Mention something specific about their company.
      Touch 4 (Day 10, WhatsApp/Twitter): Casual check-in (max 200 chars). Brief, conversational. Reference previous email.

      Make it personal. No generic openers.

      Return ONLY JSON:
      {
        'message': 'The message text',
        'channel': '{channel}'
      }
      "
    stdin: $load_lead_and_proposal.stdout
    when: $load_lead_and_proposal.json.need_generate == true

  - id: prepare_outreach
    run: |
      python3 -c "
import json, sys

result = json.loads(sys.stdin.read())

# Determine which message to use
if result.get('message') and result.get('message') != '':
    final_message = result['message']
else:
    final_message = result.get('proposal', {}).get('email_body', '')

output = {
    'channel': result.get('channel', ''),
    'to': result.get('contact_email', '') or result.get('contact_name', ''),
    'subject': result.get('subject_line', ''),
    'message': final_message,
    'touch': result.get('touch', 1),
    'company': result.get('company', '')
}
print(json.dumps(output, indent=2))
"

  - id: approval_gate
    approval: "Review and approve this outreach message before sending?"
    stdin: $prepare_outreach.stdout

  - id: log_outreach
    run: |
      python3 -c "
import json, sys, os
from datetime import datetime

leads_dir = os.environ.get('LEADS_DIR', '$HOME/.openclaw/workspace/client-hunter/leads')
state_dir = '$HOME/.openclaw/workspace/client-hunter/state'
os.makedirs(state_dir, exist_ok=True)

lead_id = '$LOBSTER_ARG_LEAD_ID'
lead_file = os.path.join(leads_dir, f'{lead_id}.json')

with open(lead_file, 'r') as f:
    lead = json.load(f)

lead['last_contact'] = datetime.utcnow().isoformat()
lead['touch_count'] = lead.get('touch_count', 0) + 1
lead['last_touch_number'] = int('$LOBSTER_ARG_TOUCH_NUMBER')

# Add to outreach log
if 'outreach_log' not in lead:
    lead['outreach_log'] = []
lead['outreach_log'].append({
    'touch': int('$LOBSTER_ARG_TOUCH_NUMBER'),
    'date': datetime.utcnow().isoformat(),
    'channel': 'pending_send',
    'approved': True
})

# Update status
if int('$LOBSTER_ARG_TOUCH_NUMBER') == 1:
    lead['status'] = 'proposal_sent'
    lead['proposal_sent'] = True

with open(lead_file, 'w') as f:
    json.dump(lead, f, indent=2)

# Update pipeline
import glob
pipeline = {'leads': [], 'summary': {}, 'last_updated': datetime.utcnow().isoformat()}
high = medium = low = 0
for f_path in glob.glob(os.path.join(leads_dir, '*.json')):
    with open(f_path) as fh:
        l = json.load(fh)
        pipeline['leads'].append({'id': l['id'], 'company': l.get('company',''), 'status': l.get('status',''), 'score': l.get('score',0), 'priority': l.get('priority',''), 'last_contact': l.get('last_contact'), 'touch_count': l.get('touch_count',0)})
        p = l.get('priority', 'low')
        if p == 'high': high += 1
        elif p == 'medium': medium += 1
        else: low += 1
pipeline['summary'] = {'total': len(pipeline['leads']), 'high': high, 'medium': medium, 'low': low}
with open(os.path.join(state_dir, 'pipeline.json'), 'w') as f:
    json.dump(pipeline, f, indent=2)

print(json.dumps({'status': 'logged', 'touch': lead['last_touch_number'], 'company': lead.get('company', '')}))
"
    condition: $approval_gate.approved
