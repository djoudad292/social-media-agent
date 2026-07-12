---
name: lead-hunter
description: Search for potential clients needing software development services
---

## Discovery

Use `websearch` to find leads:
- "startups looking for software development agency"
- "companies hiring freelance developers [tech]"
- "businesses needing [tech stack] development"

For each lead, use `webfetch` to check:
- Website for outdated tech
- Careers page for developer hiring
- Recent news (funding, expansion)

## Scoring

Score 0-1: budget indicators, need fit, timeline, accessibility

## Storage

Store in `memory/leads/{company}.json` with: name, source, score, notes, status (DISCOVERED).

Never contact leads without asking the user first.
