---
name: storyrpg-pipeline-agent-development
description: Use this skill when creating or modifying AI agents in the StoryRPG generation pipeline — extending BaseAgent, writing LLM prompts, parsing/normalizing LLM JSON, converters from LLM output to canonical types, and registering an agent in a pipeline phase.
---

# StoryRPG Pipeline Agent Development

## Workflow

1. Read `src/ai-agents/agents/BaseAgent.ts` for the base contract before adding an agent.
2. Browse the current roster with `ls src/ai-agents/agents/` (it grows — do not trust a copied list).
3. Define input/output types in `src/types/` and converters in `src/ai-agents/converters/`.
4. Register the new agent in the owning phase (see the `storyrpg-pipeline-debugging` skill for phase flow).

## Guardrails

- Extend `BaseAgent`; implement `getAgentSpecificPrompt()` and `execute()`. Never throw from `execute()` — return `AgentResponse<T>` `{ success, data, rawResponse, error? }`.
- Use `this.callLLM()` (handles retries, backoff, circuit breaker, cancellation `signal`, token-usage capture) and `this.parseJSON<T>()` (strips fences, repairs, recovers truncation). Never `JSON.parse()` raw LLM output.
- Respect concurrency guardrails (`maxGlobalInFlight`, `maxPerProviderInFlight` via `BaseAgent.configureGuardrails()`).
- Normalize LLM output (array-vs-object, key-name variants, optional fields) and separate structural validation (throw/repair) from quality checks (warn).
- Log with a `[AgentName]` prefix.

## Common Checks

- Agent roster: top-level agents include foundation (`WorldBuilder`, `CharacterDesigner`, `StyleArchitect`), architecture (`StoryArchitect`, `BranchManager`, `EncounterArchitect`, `SeasonPlannerAgent`, `SequenceDirector`, `TwistArchitect`, `ThreadPlanner`), content (`SceneWriter`, `ChoiceAuthor`), continuity (`CharacterArcTracker`), QA/critics (`QAAgents`, `SceneCritic`), plus `image-team/*`.
- Type flow: LLM string → `parseJSON<LLMType>` → converter → canonical type in `src/types/`.
- Temperatures: foundation/architecture ~0.7, scene writing ~0.85, choice/encounter ~0.75, QA ~0.3 (confirm in the agent's `AgentConfig`).

## Verification

From `storyrpg-prototype/`:

```bash
npm test -- BaseAgent
npm test -- <YourAgent>
npm run typecheck
```
