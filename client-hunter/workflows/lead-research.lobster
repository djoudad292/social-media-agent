name: lead-research
description: Deep research on a specific lead company before outreach
args:
  lead_id:
    default: ""
  company_name:
    default: ""
steps:
  - id: load_lead
    run: |
      lead_id="$LOBSTER_ARG_LEAD_ID"
      leads_dir="$HOME/.openclaw/workspace/client-hunter/leads"
      if [ -n "$lead_id" ] && [ -f "$leads_dir/${lead_id}.json" ]; then
        cat "$leads_dir/${lead_id}.json"
      else
        echo '{"error": "Lead not found", "lead_id": "'"$lead_id"'"}'
      fi

  - id: company_search
    pipeline: >
      llm_task.invoke --prompt "
      Research this company thoroughly for a sales outreach campaign.

      Use web_search to find:
      1. Company overview — what they do, size, industry, location
      2. Recent news — funding, product launches, partnerships, growth
      3. Tech stack clues — technologies they use, infrastructure
      4. Key people — founders, CTO, engineering managers (names + LinkedIn)
      5. Pain points — what problems they might have that a web developer could solve
      6. Competition — who their competitors are

      Return ONLY JSON:
      {
        'company_overview': 'Description of what company does',
        'size_estimate': 'Small/Medium/Enterprise + employee range',
        'industry': 'Industry sector',
        'location': 'HQ location',
        'recent_news': ['news item 1', 'news item 2'],
        'tech_stack': ['tech1', 'tech2'],
        'key_people': [{'name': '', 'role': '', 'linkedin': ''}],
        'potential_pain_points': ['pain point 1', 'pain point 2'],
        'competitors': ['competitor 1', 'competitor 2'],
        'website_quality': 'Good/Fair/Poor — brief assessment of their web presence',
        'opportunity_score': 1-10,
        'opportunity_reasoning': 'Why this score'
      }
      "
    stdin: $load_lead.stdout

  - id: website_analysis
    pipeline: >
      llm_task.invoke --prompt "
      Analyze this company's website and digital presence for improvement opportunities.

      Use web_fetch to load their website and assess:
      1. Design quality — modern vs outdated
      2. Performance indicators — load speed, mobile responsiveness
      3. SEO signals — meta tags, structure, content quality
      4. Conversion optimization — CTAs, forms, user journey
      5. Missing features — chat, blog, demo, pricing page, etc.
      6. AI opportunities — where could AI/LLM features add value?

      Return ONLY JSON:
      {
        'design_rating': 1-10,
        'mobile_responsive': true/false,
        'seo_score': 1-10,
        'conversion_score': 1-10,
        'has_live_chat': true/false,
        'has_blog': true/false,
        'has_pricing_page': true/false,
        'missing_features': ['feature 1', 'feature 2'],
        'ai_opportunities': ['opportunity 1', 'opportunity 2'],
        'specific_improvements': ['improvement 1 with detail', 'improvement 2 with detail'],
        'website_url': 'url analyzed'
      }
      "
    stdin: $company_search.stdout

  - id: outreach_angles
    pipeline: >
      llm_task.invoke --prompt "
      Based on the research, identify the best angles for outreach.

      The developer's strengths:
      - Next.js + NestJS full-stack applications
      - AI/LLM integration (Gemini API, chatbots, automation)
      - Payment gateway development
      - Real-time systems (WebSockets)
      - PWA and offline-first apps
      - Docker/DevOps deployment

      Match their pain points and opportunities to the developer's strengths.
      Generate 3 specific outreach angles that would resonate.

      Return ONLY JSON:
      {
        'angles': [
          {
            'title': 'Short title for the angle',
            'pain_point': 'The specific problem it addresses',
            'solution': 'How the developer can solve it',
            'portfolio_proof': 'Which portfolio project proves capability',
            'hook': 'Opening line for outreach (personalized, specific)'
          }
        ],
        'recommended_angle': 1,
        'best_contact': {
          'name': 'Best person to contact',
          'role': 'Their role',
          'reason': 'Why this person'
        },
        'timing_advice': 'Best time/context to reach out'
      }
      "
    stdin: $website_analysis.stdout

  - id: save_research
    run: |
      python3 -c "
import json, sys, os

leads_dir = os.environ.get('LEADS_DIR', '$HOME/.openclaw/workspace/client-hunter/leads')
state_dir = '$HOME/.openclaw/workspace/client-hunter/state'
os.makedirs(state_dir, exist_ok=True)

lead_data = json.loads('$LOBSTER_ARG_LEAD_ID' and open(os.path.join(leads_dir, '$LOBSTER_ARG_LEAD_ID.json')).read() or '{}')
research = {
    'company': json.loads(sys.stdin.read()),
    'research_date': '$(date -u +%Y-%m-%dT%H:%M:%SZ)'
}

# Save research output
research_file = os.path.join(state_dir, f'research_{$LOBSTER_ARG_LEAD_ID}.json')
with open(research_file, 'w') as f:
    json.dump(research, f, indent=2)

# Update lead file
if lead_data:
    lead_data['research_completed'] = True
    lead_data['research_date'] = research['research_date']
    with open(os.path.join(leads_dir, '$LOBSTER_ARG_LEAD_ID.json'), 'w') as f:
        json.dump(lead_data, f, indent=2)

print(json.dumps({'status': 'saved', 'file': research_file}))
"
