name: proposal-gen
description: Generates personalized client proposals matched to portfolio projects
args:
  lead_id:
    default: ""
  posting_text:
    default: ""
  outreach_format:
    default: "email"
steps:
  - id: load_context
    run: |
      lead_id="$LOBSTER_ARG_LEAD_ID"
      leads_dir="$HOME/.openclaw/workspace/client-hunter/leads"
      state_dir="$HOME/.openclaw/workspace/client-hunter/state"

      lead_file="$leads_dir/${lead_id}.json"
      research_file="$state_dir/research_${lead_id}.json"

      lead_data="{}"
      research_data="{}"

      [ -f "$lead_file" ] && lead_data=$(cat "$lead_file")
      [ -f "$research_file" ] && research_data=$(cat "$research_file")

      echo "{\"lead\": $lead_data, \"research\": $research_data, \"posting_text\": \"$LOBSTER_ARG_POSTING_TEXT\", \"format\": \"$LOBSTER_ARG_OUTREACH_FORMAT\"}" | python3 -c "
import sys, json
data = json.load(sys.stdin)
lead = data['lead']
research = data.get('research', {})
print(json.dumps({
    'company': lead.get('company', ''),
    'contact_name': lead.get('contact_name', ''),
    'contact_email': lead.get('contact_email', ''),
    'need': lead.get('need', ''),
    'source': lead.get('source', ''),
    'source_url': lead.get('source_url', ''),
    'score': lead.get('score', 0),
    'priority': lead.get('priority', ''),
    'company_overview': research.get('company', {}).get('company_overview', ''),
    'pain_points': research.get('company', {}).get('potential_pain_points', []),
    'ai_opportunities': research.get('website', {}).get('ai_opportunities', []),
    'missing_features': research.get('website', {}).get('missing_features', []),
    'recommended_angle': research.get('angles', {}).get('recommended_angle', 1),
    'angles': research.get('angles', {}).get('angles', []),
    'best_contact': research.get('angles', {}).get('best_contact', {}),
    'website_quality': research.get('website', {}).get('website_quality', ''),
    'posting_text': data.get('posting_text', ''),
    'format': data.get('format', 'email')
}, indent=2))
"

  - id: generate_proposal
    pipeline: >
      llm_task.invoke --prompt "
      You are writing a personalized outreach proposal for a freelance full-stack developer.

      DEVELOPER PROFILE:
      - Name: Djaouad Frih
      - Portfolio: https://djaouad.netlify.app
      - Email: oufr29@gmail.com
      - WhatsApp: +213780688125
      - LinkedIn: https://www.linkedin.com/in/djaouad-frih-16ab7323a
      - GitHub: https://github.com/djoudad292

      CORE STACK: Next.js, NestJS, TypeScript, TailwindCSS, PostgreSQL, MySQL, Redis, Docker, WebSockets, Gemini API

      PORTFOLIO PROJECTS:
      1. LordHavale (Payment Gateway) — Next.js, Nest.js, PostgreSQL, Docker — AES-256 encryption, webhook integration, rate limiting, fraud detection, VPS deployment
      2. Cuvva Copy (Policy Platform) — Next.js, Express.js, MySQL, PWA — PDF generation, email workflows, digital certificates, offline PWA, policy creation wizard
      3. AI Client Support Chatbot — Next.js, Express.js, AI/LLM, WebSocket — Real-time bidirectional chat, AI-powered responses, conversation history, multi-user sessions
      4. Restaurant Landing Page — Next.js, Tailwind CSS, TypeScript — SSR for SEO, menu management, reservation system, mobile-first responsive

      Write a personalized proposal for THIS specific company and their specific needs.

      RULES:
      - Reference 2-3 specific portfolio projects that match their needs (with technical details)
      - Address their specific pain points (from research)
      - Propose a concrete technical approach using the right stack
      - Include realistic timeline and price range
      - Keep it concise (200-350 words for email, 500-800 for proposal doc)
      - NO generic phrases like 'I am a passionate developer' — be specific and technical
      - Personalize the opening — mention something specific about their company
      - Include a clear call-to-action

      Return ONLY JSON:
      {
        'subject_line': 'Email subject line (catchy, specific)',
        'email_body': 'The full email proposal text',
        'linkedin_message': 'Shorter version for LinkedIn (max 300 chars)',
        'follow_up_message': 'Follow-up message for day 6 (insight-focused)',
        'technical_approach': {
          'frontend': 'Recommended frontend approach',
          'backend': 'Recommended backend approach',
          'database': 'Recommended database',
          'ai_features': 'Which AI features make sense',
          'deployment': 'Recommended deployment strategy'
        },
        'estimated_timeline': 'Timeline estimate',
        'estimated_price_range': 'Price range',
        'portfolio_matches': [
          {'project': 'project name', 'relevance': 'why it matches', 'key_points': ['point1', 'point2']}
        ]
      }
      "
    stdin: $load_context.stdout

  - id: save_proposal
    run: |
      python3 -c "
import json, sys, os
from datetime import datetime

leads_dir = os.environ.get('LEADS_DIR', '$HOME/.openclaw/workspace/client-hunter/leads')
output_dir = '$HOME/.openclaw/workspace/client-hunter/output'
os.makedirs(output_dir, exist_ok=True)

proposal = json.loads(sys.stdin.read())
lead_id = '$LOBSTER_ARG_LEAD_ID'

# Save proposal
proposal['generated_at'] = datetime.utcnow().isoformat()
proposal['lead_id'] = lead_id
proposal_file = os.path.join(output_dir, f'proposal_{lead_id}.json')
with open(proposal_file, 'w') as f:
    json.dump(proposal, f, indent=2)

# Update lead status
lead_file = os.path.join(leads_dir, f'{lead_id}.json')
if os.path.exists(lead_file):
    with open(lead_file, 'r') as f:
        lead = json.load(f)
    lead['proposal_generated'] = True
    lead['proposal_generated_at'] = proposal['generated_at']
    lead['subject_line'] = proposal.get('subject_line', '')
    with open(lead_file, 'w') as f:
        json.dump(lead, f, indent=2)

print(json.dumps({'status': 'saved', 'file': proposal_file}))
"
