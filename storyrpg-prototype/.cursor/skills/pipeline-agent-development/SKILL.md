---
name: pipeline-agent-development
description: Build and modify AI agents in the StoryRPG generation pipeline — BaseAgent, LLM prompting, JSON parsing, normalization, and converters. Use when creating a new agent, editing files in src/ai-agents/agents/, extending BaseAgent, writing LLM prompts, parsing LLM JSON responses, or working with LLM output converters.
---

# Pipeline Agent Development

## Agent Architecture

All agents extend `BaseAgent` (`src/ai-agents/agents/BaseAgent.ts`).

### Required Methods

```typescript
class MyAgent extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Agent Display Name', config);
    this.includeSystemPrompt = true; // Enable for narrative/creative agents
  }

  protected getAgentSpecificPrompt(): string {
    return `## Your Role: Agent Name\n...instructions...`;
  }

  async execute(input: MyInput): Promise<AgentResponse<MyOutput>> {
    const prompt = this.buildPrompt(input);
    const response = await this.callLLM([{ role: 'user', content: prompt }]);
    const parsed = this.parseJSON<MyOutput>(response);
    // normalize, validate, return
    return { success: true, data: parsed, rawResponse: response };
  }
}
```

### AgentResponse Contract

Always return `AgentResponse<T>`:
```typescript
{ success: boolean; data: T; rawResponse: string; error?: string }
```
Never throw from `execute()`. Catch errors and return `{ success: false, error: msg }`.

### AgentConfig

```typescript
interface AgentConfig {
  provider: 'anthropic' | 'openai' | 'gemini';
  model: string;
  apiKey: string;
  maxTokens: number;     // Default: 4096
  temperature: number;   // Varies: 0.7 (architect), 0.85 (writer), 0.75 (choice)
}
```

## LLM Call Patterns

### callLLM

```typescript
protected async callLLM(
  messages: AgentMessage[],
  retries: number = 4,
  options?: { useMemory?: boolean; signal?: AbortSignal }
): Promise<string>
```

- Auto-injects system prompt when `this.includeSystemPrompt === true`
- Handles retries with exponential backoff + jitter (`backoffJitterRatio: 0.15`)
- Circuit breaker trips after 5 consecutive failures, 60s cooldown
- `useMemory: true` enables Anthropic multi-turn tool loop
- `signal` is propagated to Anthropic / Gemini / OpenAI providers for cooperative cancellation
- Captures per-call token usage into an internal `usageCapture` and forwards to the pipeline observer (per-agent / per-phase LLM ledger)

Source: `agents/BaseAgent.ts:200-250`.

### Concurrency Guardrails

Static semaphores control concurrent LLM calls:
- `maxGlobalInFlight`: 4 (all providers combined)
- `maxPerProviderInFlight`: 2 (per provider)

Configured via `BaseAgent.configureGuardrails()`. Acquire/release is automatic inside `callLLM`.

## JSON Parsing

Always use `this.parseJSON<T>(response)`. It handles:
1. Strips markdown code fences (` ```json ... ``` `)
2. Repairs common errors (trailing commas, unbalanced brackets)
3. Recovers from truncation (finds last complete object)
4. Handles orphan values and missing opening braces

Never use `JSON.parse()` directly on LLM output.

## Type Flow: LLM Output to Canonical Types

```
LLM Response (string)
  → parseJSON<LLMType>()          types/llm-output.ts
  → converter function             converters/*.ts
  → Canonical Type                  types/index.ts
```

### Key LLM Output Types (`types/llm-output.ts`)

- `StateChange`: `{ type: 'flag'|'score'|'tag'|'relationship', name, change }`
- `LLMStoryletBeat`: Beat with choices and `StateChange[]` consequences
- `LLMGeneratedBeat`: Scene beat content from SceneWriter

### Converter Pattern (`converters/stateChangeConverter.ts`)

```typescript
function convertStateChangeToConsequence(sc: StateChange): Consequence | null
```

Mapping:
- `flag` → `{ type: 'setFlag', flag: name, value: Boolean(change) }`
- `score` → `{ type: 'changeScore', score: name, change: number }`
- `tag` → `{ type: 'addTag', tag: name }` or `removeTag`
- `relationship` → parses `"npcId:dimension"` format

The converter also normalizes LLM deviations:
- `{ type: 'attribute', attribute: 'X' }` → `{ type: 'score', name: 'X' }`
- `{ type: 'skill', skill: 'X' }` → `{ type: 'score', name: 'X' }`

## Prompt Engineering Conventions

### Structure

1. Role declaration: `## Your Role: [Name]`
2. Context injection: World bible, character bible, blueprint excerpts
3. Output schema: Exact JSON structure with field descriptions
4. Constraints: Hard rules the LLM must follow
5. Examples: 1-2 concrete output samples

### JSON Schema in Prompts

Always include the exact JSON shape you expect:
```
Return JSON matching this schema exactly:
{
  "scenes": [
    {
      "id": "string (kebab-case, e.g. 'scene-market')",
      "name": "string",
      ...
    }
  ]
}
```

### Normalization After Parsing

LLMs return inconsistent structures. Always normalize:
- Arrays that might be single objects or strings
- Optional fields that might be undefined
- Key name variants (check `sceneGraph`, `sceneList`, `episode.scenes`)

```typescript
private normalizeOutput(raw: any): MyOutput {
  if (!Array.isArray(raw.items)) {
    raw.items = raw.items ? [raw.items] : [];
  }
  return raw;
}
```

### Validation After Normalization

Separate structural validation (throws) from quality checks (warnings):
```typescript
private validate(output: MyOutput): void {
  if (!output.id) throw new Error('Missing required field: id');
  if (output.items.length < 3) console.warn('[MyAgent] Low item count');
}
```

### Retry for Missing Items

If output is structurally valid but incomplete, make a follow-up LLM call:
```typescript
if (worldBible.locations.length < 3) {
  const moreLocations = await this.callLLM([
    { role: 'user', content: `Generate 3 more locations for: ${context}` }
  ]);
  worldBible.locations.push(...this.parseJSON<Location[]>(moreLocations));
}
```

## Logging Convention

Use `[AgentName]` prefix for all console output:
```typescript
console.log(`[${this.name}] Starting execution...`);
console.warn(`[${this.name}] Low choice density`);
```

## Agent Catalog

The agent tree evolves frequently. Browse `src/ai-agents/agents/` for the canonical list. Agents group roughly as:

| Group | Examples | Role |
|---|---|---|
| Foundation | `WorldBuilder`, `CharacterDesigner`, `StyleArchitect` | Build the world / character / style bibles consumed by later phases |
| Architecture | `StoryArchitect`, `BranchManager`, `EncounterArchitect`, `SeasonPlannerAgent`, `SequenceDirector`, `TwistArchitect`, `ThreadPlanner` | Produce blueprints, branch analysis, encounter skeletons, season plans, sequence direction, twist plants, and setup/payoff thread plans |
| Content | `SceneWriter`, `ChoiceAuthor` | Generate scene prose and player choices |
| Continuity / Arc | `CharacterArcTracker` | Track character arc deltas across scenes/episodes |
| Analysis / Source | `SourceMaterialAnalyzer` | Ingest source docs and convert them into structured story metadata |
| QA / Critics | `QAAgents` (`QARunner` + `ContinuityChecker`, `VoiceValidator`, `StakesAnalyzer`), `SceneCritic` | Score output and flag issues for repair |
| Image / Video | `image-team/*` (see image-generation-team skill) | Storyboarding, illustration, validators, video & LoRA training |
| Simple wrappers | `ImageGenerator` | Thin service-layer wrappers |

Canonical agent list is the directory itself — **run `ls src/ai-agents/agents/`** rather than
trusting a copied list (it grows often). As of this writing the top-level agents are: `BaseAgent`,
`BranchManager`, `CharacterArcTracker`, `CharacterDesigner`, `ChoiceAuthor`, `EncounterArchitect`,
`ImageGenerator`, `QAAgents`, `SceneCritic`, `SceneWriter`, `SeasonPlannerAgent`, `SequenceDirector`,
`SourceMaterialAnalyzer`, `StoryArchitect`, `StyleArchitect`, `ThreadPlanner`, `TwistArchitect`,
`WorldBuilder`, plus `image-team/*`.

Typical temperatures: architect / foundation agents ~0.7, scene writing ~0.85, choice / encounter authoring ~0.75, QA / critic agents ~0.3. Check the agent's `AgentConfig` in pipeline setup for the current value.

## Checklist for New Agents

1. Extend `BaseAgent`, implement `getAgentSpecificPrompt()` and `execute()`
2. Define input/output types in `types/`
3. Use `this.callLLM()` and `this.parseJSON<T>()`
4. Normalize arrays and optional fields from LLM output
5. Validate structural requirements (throw) vs quality (warn)
6. Return `AgentResponse<T>` with success/error
7. Add converter if introducing new LLM output types
8. Log with `[AgentName]` prefix
9. Register in the appropriate pipeline phase (see `pipeline-orchestration` skill)
