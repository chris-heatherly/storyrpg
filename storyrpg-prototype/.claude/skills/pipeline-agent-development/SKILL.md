---
name: pipeline-agent-development
description: Use this skill when creating or modifying AI agents in the StoryRPG generation pipeline — extending BaseAgent, writing LLM prompts, parsing/normalizing LLM JSON, converters to canonical types, or registering an agent in a pipeline phase.
---

# Pipeline Agent Development

All generation agents extend `BaseAgent` (`src/ai-agents/agents/BaseAgent.ts`). Browse the current
roster with `ls src/ai-agents/agents/` — it grows often, so don't trust a copied list. Groups:
foundation (`WorldBuilder`, `CharacterDesigner`, `StyleArchitect`), architecture (`StoryArchitect`,
`BranchManager`, `EncounterArchitect`, `SeasonPlannerAgent`, `SequenceDirector`, `TwistArchitect`,
`ThreadPlanner`), content (`SceneWriter`, `ChoiceAuthor`), continuity (`CharacterArcTracker`),
QA/critics (`QAAgents`, `SceneCritic`), plus `image-team/*`.

## The contract

When an agent realizes a canonical `NarrativeRealizationTask`, preserve its `ownerStage`,
discriminated evidence target, route scope, severity, and repair handler. SceneWriter,
ChoiceAuthor, and EncounterArchitect must only author tasks they own; owner-stage gates run before
checkpointing and `NarrativeContractValidator` repeats the contract after late mutations.

- Implement `getAgentSpecificPrompt()` and `execute()`. **Never throw from `execute()`** — return
  `AgentResponse<T>` `{ success, data, rawResponse, error? }`.
- Use `this.callLLM()` (retries, backoff + jitter, circuit breaker after 5 fails, cancellation
  `signal`, token-usage capture) — not a raw provider call.
- Use `this.parseJSON<T>()` (strips fences, repairs trailing commas/brackets, recovers truncation)
  — never `JSON.parse()` raw LLM output.
- Respect static concurrency caps (`maxGlobalInFlight`, `maxPerProviderInFlight` via
  `BaseAgent.configureGuardrails()`).

## After parsing

LLM output is inconsistent — normalize (array-vs-object, key-name variants, optional fields), then
**separate structural validation (throw/repair) from quality checks (warn)**. New LLM output shapes
get a converter in `src/ai-agents/converters/` mapping to canonical types in `src/types/`. Log with
a `[AgentName]` prefix. Register the agent in its owning phase (see `pipeline-debugging`).

## Guardrails

- Don't grow `FullStoryPipeline.ts` (CI monolith ratchet) — wire new phases into `pipeline/phases/`.
- Typecheck + a focused agent test before done: `npm test -- <Agent>` and `npm run typecheck`.

See also: the Cursor `pipeline-agent-development` skill (deep), `pipeline-orchestration`,
`docs/STORY_AGENT_SYSTEM_DETAIL.md`, `docs/STORY_PIPELINE_PROMPTING.md`.
