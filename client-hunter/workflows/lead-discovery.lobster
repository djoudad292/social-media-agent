name: lead-discovery
description: Discovers potential clients for full-stack web development + AI integration via web search
args:
  query:
    default: "hire full stack developer Next.js NestJS"
  num_results:
    default: "10"
  niche:
    default: "any"
steps:
  - id: search_jobs
    run: |
      echo '{"query": "$LOBSTER_ARG_QUERY", "niche": "$LOBSTER_ARG_NICHE", "search_time": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}' > /tmp/lead-discovery-query.json
      cat /tmp/lead-discovery-query.json

  - id: discover_leads
    pipeline: >
      llm_task.invoke --prompt "
      You are a lead discovery agent for a full-stack web developer specializing in Next.js, NestJS, TypeScript, and AI integration.

      Search the web for current opportunities where businesses need:
      1. Full-stack web applications (Next.js frontend, NestJS backend)
      2. AI/LLM integration features (chatbots, automation, content generation)
      3. Payment gateway or e-commerce development
      4. Real-time web applications (WebSockets, live features)
      5. SaaS platform development
      6. Website modernization (old sites needing rebuild)

      Use web_search tool to find current opportunities. Search for:
      - 'hire full stack developer' 'Next.js' 'NestJS'
      - 'looking for developer' 'web application' 'AI integration'
      - 'need developer' 'SaaS' 'platform'
      - Startup job boards and 'who is hiring' posts

      Return ONLY valid JSON array with this exact schema:
      [
        {
          'company': 'Company name',
          'source': 'Where found (LinkedIn, Upwork, HN, etc)',
          'source_url': 'URL to the posting',
          'need': 'Brief description of what they need',
          'tech_hints': 'Any mentioned technologies',
          'urgency': 'high|medium|low',
          'contact_name': 'Name if available, null otherwise',
          'contact_email': 'Email if available, null otherwise',
          'raw_excerpt': 'Key excerpt from the posting (max 300 chars)'
        }
      ]

      Return 5-10 leads. If no valid leads found, return empty array [].
      Ensure ALL fields are present in each object. Use null for missing values.
      "
    stdin: $search_jobs.stdout

  - id: parse_leads
    run: |
      echo "$LOBSTER_STDIN" | python3 -c "
import sys, json, os
from datetime import datetime

leads_raw = sys.stdin.read()
# Extract JSON array from LLM response
start = leads_raw.find('[')
end = leads_raw.rfind(']') + 1
if start == -1:
    print(json.dumps({'new_leads': [], 'count': 0}))
    sys.exit(0)

leads = json.loads(leads_raw[start:end])
output_dir = os.environ.get('LEADS_DIR', '$HOME/.openclaw/workspace/client-hunter/leads')
os.makedirs(output_dir, exist_ok=True)

new_leads = []
for lead in leads:
    company = lead.get('company', 'unknown').replace(' ', '_').lower()
    lead_id = f'{company}_{datetime.utcnow().strftime(\"%Y%m%d\")}'
    lead['id'] = lead_id
    lead['status'] = 'discovery'
    lead['score'] = 0
    lead['date_added'] = datetime.utcnow().strftime('%Y-%m-%d')
    lead['last_contact'] = None
    lead['touch_count'] = 0
    lead['proposal_sent'] = False
    lead['notes'] = ''
    filepath = os.path.join(output_dir, f'{lead_id}.json')
    if not os.path.exists(filepath):
        with open(filepath, 'w') as f:
            json.dump(lead, f, indent=2)
        new_leads.append(lead)

result = {'new_leads': new_leads, 'count': len(new_leads), 'timestamp': datetime.utcnow().isoformat()}
print(json.dumps(result, indent=2))
"

  - id: score_leads
    pipeline: >
      llm_task.invoke --prompt "
      Score each discovered lead for a full-stack developer who specializes in Next.js, NestJS, TypeScript, and AI integration.

      For each lead, assign scores 1-5 for:
      - budget_potential: Does the lead show ability/willingness to pay well?
      - stack_match: How well does it align with Next.js/NestJS/TypeScript/AI?
      - timeline_urgency: How soon do they need it done?
      - relationship_potential: Could this lead to ongoing/long-term work?

      Total score = sum of all four (max 20).

      Priority: score>=14 is 'high', 10-13 is 'medium', <10 is 'low'.

      Return ONLY JSON:
      {
        'scored_leads': [
          {
            'id': 'lead_id',
            'company': 'company',
            'scores': {
              'budget_potential': 1-5,
              'stack_match': 1-5,
              'timeline_urgency': 1-5,
              'relationship_potential': 1-5
            },
            'total_score': 1-20,
            'priority': 'high|medium|low',
            'reasoning': 'Brief explanation'
          }
        ]
      }
      "
    stdin: $parse_leads.stdout

  - id: update_scores
    run: |
      echo "$LOBSTER_STDIN" | python3 -c "
import sys, json, os

output_dir = os.environ.get('LEADS_DIR', '$HOME/.openclaw/workspace/client-hunter/leads')
data = json.loads(sys.stdin.read())

for scored in data.get('scored_leads', []):
    lead_id = scored['id']
    filepath = os.path.join(output_dir, f'{lead_id}.json')
    if os.path.exists(filepath):
        with open(filepath, 'r') as f:
            lead = json.load(f)
        lead['score'] = scored['total_score']
        lead['priority'] = scored['priority']
        lead['scores'] = scored['scores']
        lead['score_reasoning'] = scored['reasoning']
        with open(filepath, 'w') as f:
            json.dump(lead, f, indent=2)

print(json.dumps({'updated': len(data.get('scored_leads', [])), 'status': 'complete'}))
"

  - id: update_pipeline
    run: |
      python3 -c "
import json, os, glob
from datetime import datetime

leads_dir = os.environ.get('LEADS_DIR', '$HOME/.openclaw/workspace/client-hunter/leads')
pipeline = {'leads': [], 'summary': {}, 'last_updated': datetime.utcnow().isoformat()}

high = medium = low = 0
for f in glob.glob(os.path.join(leads_dir, '*.json')):
    with open(f) as fh:
        lead = json.load(fh)
        pipeline['leads'].append({
            'id': lead['id'],
            'company': lead.get('company', ''),
            'status': lead.get('status', 'discovery'),
            'score': lead.get('score', 0),
            'priority': lead.get('priority', 'low'),
            'source': lead.get('source', ''),
            'date_added': lead.get('date_added', ''),
            'last_contact': lead.get('last_contact'),
            'touch_count': lead.get('touch_count', 0),
            'proposal_sent': lead.get('proposal_sent', False)
        })
        p = lead.get('priority', 'low')
        if p == 'high': high += 1
        elif p == 'medium': medium += 1
        else: low += 1

pipeline['summary'] = {
    'total': len(pipeline['leads']),
    'high_priority': high,
    'medium_priority': medium,
    'low_priority': low
}

state_dir = '$HOME/.openclaw/workspace/client-hunter/state'
os.makedirs(state_dir, exist_ok=True)
with open(os.path.join(state_dir, 'pipeline.json'), 'w') as fh:
    json.dump(pipeline, fh, indent=2)
print(json.dumps(pipeline['summary']))
"

  - id: summary
    pipeline: >
      llm_task.invoke --prompt "
      Generate a concise summary of today's lead discovery results.

      Include:
      - Total new leads found
      - High priority leads (with company names and why they're high priority)
      - Recommended next actions
      - Any notable patterns or opportunities

      Format as a clean markdown report.
      "
    stdin: $update_pipeline.stdout
