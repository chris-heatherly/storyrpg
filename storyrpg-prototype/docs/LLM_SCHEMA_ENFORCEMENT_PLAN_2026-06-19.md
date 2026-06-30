# LLM Schema Enforcement Plan

## Problem

The pipeline has many LLM calls that ask for JSON in prose but do not pass a
provider-enforced schema through `BaseAgent.callLLM`. That leaves each provider
free to return partial JSON, wrong-shaped JSON, markdown-wrapped JSON, or a tiny
object that only superficially satisfies "application/json".

Schemas must come from deterministic project code: checked-in schema builders,
canonical TypeScript/data-model contracts, or hand-authored registry entries.
They must not be invented, summarized, or transformed by an LLM at request time.

The current Bite Me truncation symptoms exposed this on Gemini: several
SceneWriter failures were far below the configured output-token budget, so they
were not true max-token exhaustion. They were malformed or incomplete JSON
responses that the parser classified as truncation.

## Immediate Fix Already Applied

- `BaseAgent.callGemini` now accepts `jsonSchema`.
- Gemini structured calls now send `generationConfig.responseMimeType =
  "application/json"` plus `generationConfig.responseSchema`.
- Gemini receives a provider-compatible copy of the deterministic schema; fields
  rejected by its `responseSchema` endpoint, such as `additionalProperties`, are
  stripped at the transport adapter layer without mutating the source schema.
- Gemini structured calls use an 8192-token output floor unless the configured
  cap is higher.
- Gemini structured calls use the buffered endpoint so finish reasons and usage
  are available for diagnostics.
- SceneWriter first-pass, repair-pass, and revision-pass calls now pass a
  compact `SceneContent` schema from `src/ai-agents/schemas/sceneContentSchema.ts`.
- Truncated or lossy JSON repair remains rejected by default.

## Why Full Enforcement Is A Major Refactor

There are dozens of direct `callLLM` sites across narrative agents, validators,
encounter generation, source analysis, character design, and image-team agents.
Many of them currently define their expected shapes only in prompt text. Turning
on a global "schema required" exception immediately would break generation until
each call site has a tested schema.

This should be migrated incrementally and verified per phase rather than as a
single broad rewrite.

## Proposed Standard

Every LLM call that expects machine-readable JSON must use:

```ts
this.callLLM(messages, retries, {
  jsonSchema: {
    name: 'stable_schema_name',
    description: 'What this object represents.',
    schema: { ...provider-compatible JSON Schema... },
  },
});
```

The schema object must be imported from a deterministic source such as
`src/ai-agents/schemas/*`. A prompt may describe the output in human terms, but
the provider-enforced schema is the source of truth.

Provider behavior:

- Anthropic: forced tool use with `input_schema`.
- OpenAI/OpenRouter: `response_format: { type: "json_schema" }`.
- Gemini: `responseMimeType: "application/json"` plus `responseSchema`.

Free-form prose calls must opt out explicitly with `openaiForceJsonResponse:
false` or an equivalent documented caller contract.

## Migration Plan

1. Add a schema registry module with small provider-compatible schemas for
   recurring payloads: scene content, choices, season plan, episode blueprint,
   encounter beats, QA reports, source-analysis chunks, image prompts, and judge
   scores.
2. Add a non-blocking telemetry warning for schema-less JSON calls so remaining
   gaps show up in worker logs and the LLM ledger.
3. Convert the high-volume generation path first:
   SourceMaterialAnalyzer, SeasonPlannerAgent, StoryArchitect, SceneWriter,
   ChoiceAuthor, EncounterArchitect, CharacterDesigner.
4. Convert validators and image-team agents second.
5. Add a CI ratchet test that fails when new schema-less JSON `callLLM` calls are
   introduced outside an allowlist.
6. After the allowlist reaches zero, enable strict enforcement in `BaseAgent` for
   JSON mode.

## Validation

- Unit tests for every provider request body.
- Focused agent tests for each migrated schema.
- `npm run typecheck:worker`.
- Bite Me episode 1 generation and final quality audit.

## Non-Goals

- No prompt rewrites beyond replacing prose-only schema instructions with the
  provider schema contract.
- No changes to reader/generator boundaries.
- No generated story artifact rewrites except regeneration outputs needed for
  Bite Me episode 1 validation.
