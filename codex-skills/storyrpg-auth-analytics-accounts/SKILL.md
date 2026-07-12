---
name: storyrpg-auth-analytics-accounts
description: Use this skill when working on StoryRPG login, Passport local/Google/Discord OAuth, session cookies, Postgres account persistence, DATABASE_URL, SESSION_SECRET, PostHog analytics, attribution, or account-related environment variables.
---

# StoryRPG Auth Analytics Accounts

## Workflow

1. Trace login through `LoginScreen`, `authSession`, `proxy/authRoutes.js`, Passport strategies, the local user store, and `proxy/db/`.
2. Keep provider credentials, `DATABASE_URL`, and `SESSION_SECRET` server-side. Use secure cookie settings appropriate to the deployment boundary.
3. Preserve local-store fallback and Postgres migration behavior; verify both explicitly when changing persistence.
4. Route analytics through `analyticsService`/PostHog and native config. Send identifiers, counts, and attribution—not story prose, prompts, character names, or sensitive account data.
5. Treat `phc_` PostHog project tokens as publishable; do not generalize that exception to provider or session secrets.

## Guardrails

- Do not log tokens, cookies, OAuth payloads, password material, or raw database URLs.
- Keep Reader-safe auth/session APIs separate from generator-only provider configuration.
- Require explicit user confirmation before destructive account or analytics-data operations.

## Verification

```bash
npm run db:migrate
npm run db:verify
npm run check:reader-boundary
npm test -- auth
```
