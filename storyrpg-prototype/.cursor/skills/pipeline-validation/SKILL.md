---
name: pipeline-validation
description: Add, modify, and orchestrate validators in the StoryRPG pipeline — both the IntegratedBestPracticesValidator orchestrator and the standalone structural / phase / E2E validators. Use when editing files in src/ai-agents/validators/, adding validation rules, changing quick or full validation modes, updating incremental validation, or working with StructuralValidator auto-fix.
---

# Pipeline Validation

## Validator Architecture

### Orchestrator

`IntegratedBestPracticesValidator` (`validators/IntegratedBestPracticesValidator.ts`) orchestrates all validators. Individual validators are instantiated in its constructor and accessed via `this.validators`.

### Validator Interface

Every validator follows this pattern:

```typescript
class MyValidator {
  constructor(config?: Partial<ValidationRuleConfig>)

  async validate(input: MyValidatorInput): Promise<MyValidationResult> {
    // Returns: { passed: boolean, metrics: {...}, issues: ValidationIssue[] }
  }
}
```

### Core Types (`types/validation.ts`)

```typescript
interface ValidationIssue {
  category: string;
  level: 'error' | 'warning' | 'suggestion';
  message: string;
  location: string;     // e.g., "scene-market > beat-3"
  suggestion: string;
}

interface ValidationRuleConfig {
  enabled: boolean;
  level: string;
  // ...rule-specific thresholds
}

interface ValidationConfig {
  enabled: boolean;
  mode: 'strict' | 'advisory' | 'disabled';
  rules: {
    choiceDensity: ValidationRuleConfig;
    npcDepth: ValidationRuleConfig;
    consequenceBudget: ValidationRuleConfig;
    stakesTriangle: ValidationRuleConfig;
    fiveFactor: ValidationRuleConfig;
    callbackOpportunities: ValidationRuleConfig;
  };
}
```

## Two Validation Modes

### Quick Validation (Generation-Time)

Called during Phase 4.5. Fast heuristic checks, no LLM calls.

```typescript
async runQuickValidation(input): Promise<QuickValidationResult>
// Returns: { canProceed: boolean, blockingIssues: [], warningCount: number }
```

Checks:
- NPC depth (structural)
- Stakes triangle (missing components only, no LLM scoring)
- Five-factor (heuristic, no LLM)
- Choice density (critical: are there ANY choices?)

Mode behavior:
- `advisory`: blocks on errors only
- `strict`: blocks on errors + warnings

### Full Validation (QA-Time)

Called during Phase 5. Comprehensive analysis including LLM-based scoring.

```typescript
async runFullValidation(input): Promise<ComprehensiveValidationReport>
```

```typescript
interface ComprehensiveValidationReport {
  overallPassed: boolean;
  overallScore: number;
  blockingIssues: ValidationIssue[];
  warnings: ValidationIssue[];
  suggestions: ValidationIssue[];
  metrics: ValidationMetrics;
  timestamp: Date;
  duration: number;
}
```

Runs all validators with full LLM-based analysis for stakes and five-factor scoring.

## Registered Validators (IntegratedBestPracticesValidator)

These six validators are orchestrated by `IntegratedBestPracticesValidator` and governed by `ValidationConfig.rules`:

| Validator | What It Checks | Key Thresholds |
|---|---|---|
| ChoiceDensityValidator | Reading time between choices | First choice within ~60s, avg gap <=90s |
| NPCDepthValidator | NPC relationship dimensions | Core NPCs: 4 dimensions |
| ConsequenceBudgetValidator | Consequence type distribution | Balanced mix of callbacks, tints, branchlets, branches |
| StakesTriangleValidator | Want/Cost/Identity stakes | Every choice point defines all three |
| FiveFactorValidator | Impact across 5 factors | Major choices impact >=3 of: outcome, process, info, relationship, identity |
| CallbackOpportunitiesValidator | Delayed consequence tracking | Scheduled callbacks are reachable |

## Validators Outside the Orchestrator

Also living in `src/ai-agents/validators/` but invoked independently by specific pipeline phases or tools:

| Validator | What It Checks | Invoked From |
|---|---|---|
| `PhaseValidator` | Output quality at each major phase (world, character, blueprint, scene content, choice, encounter) — enables early error detection and repair loops | Called by pipeline after each foundational phase; returns structured issues for targeted regeneration |
| `StructuralValidator` | Structural integrity of the final `Story` (starting beats, beat chains, dead-ends, encounter beat IDs, situation images) with `autoFix()` | Runs during assembly/QA; auto-repair fires before QA scoring |
| `PixarPrinciplesValidator` | Adherence to Pixar's 22 Rules (story spine, burning question, causality, polar-opposite challenges, anti-obvious choices) | Used for season/episode-level creative audit; not part of the default quick-validation path |
| `CliffhangerValidator` | Episode endings have a working cliffhanger (type, quality score, match against `EpisodePlan` intent) | Invoked during episode assembly when cliffhanger logic is enabled; extends `BaseAgent` (LLM-assisted scoring) |
| `ChoiceDistributionValidator` | Two concerns: choice TYPE mix (expression / relationship / strategic / dilemma) vs configured targets, AND branching frequency vs per-episode cap | Complements `ChoiceDensityValidator`; branching is a property of non-expression choices |
| `MicroEpisodeSeasonValidator` | Season bible structure + coherence for the micro-episode format (returns scores + issues + suggestions) | Called by season-level generation paths (`SeasonPlannerAgent`) |
| `SeasonPromiseValidator` | Season-level setup→payoff promises are planted and paid off across episodes | Called by season planning / final-story contract checks |
| `storyPathAnalyzer` | Builds scene-level DAG; computes minimum choice paths to cover every beat and choice | Feeds Playwright coverage plan |
| `playwrightQARunner` | Spawns Playwright E2E against a generated story, parses results, returns typed report | Invoked as an optional post-generation QA sweep |
| `qaRemediation` | Applies QA-driven repairs using saved prompts | Called from the `qa_repair` loop in `FullStoryPipeline` |
| `storyAssetWalker` | HTTP-verifies every image asset referenced by the final Story | Runs at `asset_verification` gate in `FullStoryPipeline.ts:2495-2517` |

Rule of thumb: validators inside the orchestrator enforce narrative *best practices*. Validators outside the orchestrator enforce *structural integrity*, *phase correctness*, or *operational* checks (coverage, HTTP, E2E).

> **The tables above are a curated sample, not the full list.** `src/ai-agents/validators/`
> holds ~50 validators and the set churns. The two canonical sources of truth are
> `validators/index.ts` (every exported validator + its types) and `validatorRegistry.ts`
> (the stage → validator → tier dispatch map — which validator runs in which phase and whether
> it's HARD/advisory). Read those before assuming a validator's name, wiring, or severity.
> Recent additions beyond the orchestrator's six include `DramaticStructureValidator`,
> `TreatmentFidelityValidator`, `SceneTurnContractValidator`, `MechanicsLeakageValidator`,
> `PovClarityValidator`, `SkillCoverageValidator`, and the `*PressureArchitectureValidator`
> family. The dead `SeasonValidator` was removed — don't reference it.

## Incremental Validation

`IncrementalValidationRunner` (`validators/IncrementalValidators.ts`) runs per-scene during Phase 4 content generation.

### Incremental Validators

| Validator | Method | Speed |
|---|---|---|
| IncrementalVoiceValidator | Heuristic keyword matching | Fast |
| IncrementalStakesValidator | False choice / obvious answer detection | Fast |
| IncrementalSensitivityChecker | Content rating keyword scan | Fast |
| IncrementalContinuityChecker | Undefined flags/scores tracking | Fast |
| IncrementalEncounterValidator | Encounter structure validation | Fast |

> **gen-5:** `validateScene` also scans ENCOUNTER prose (`collectEncounterProseTexts` over storylet/phase
> beats + goal/threat clock labels) through the mechanics-leak validator — encounter scenes carry empty
> `sceneContent.beats`, so without this they validated as a ~1ms no-op. `PovClarityValidator` checks
> POV consistency on EVERY beat (not just the opener; wire the protagonist via `setProtagonistName`) so a
> mid-scene flip into third person is surfaced as an advisory warning.

### Regeneration Signal

Incremental validation returns:
```typescript
interface SceneValidationResult {
  regenerationRequested: 'scene' | 'choices' | 'encounter' | 'none';
  issues: ValidationIssue[];
}
```

When `regenerationRequested !== 'none'`, the pipeline regenerates the flagged content.

## StructuralValidator Auto-Fix

`StructuralValidator` (`validators/StructuralValidator.ts`) validates and auto-repairs structural issues.

### Auto-Fix Method

```typescript
autoFix(story: Story): { story: Story; fixedCount: number; fixes: string[] }
```

### What It Fixes

| Issue | Fix |
|---|---|
| Missing `startingBeatId` | Set to first beat in scene |
| Self-referencing `nextBeatId` | Set to next sequential beat |
| Empty beat text | Recover from `content`/`narrative` fields or add placeholder |
| Dead-end beats (no next, no choices) | Add "Continue..." choice |
| Missing encounter `situationImage` | Copy from first beat success image |
| Encounter beat IDs | Renumber sequentially (`beat-1`, `beat-2`, ...) |

### Issue Structure

```typescript
interface StructuralIssue {
  severity: 'error' | 'warning';
  type: string;
  location: string;
  description: string;
  autoFixable: boolean;
  suggestedFix: string;
}
```

## Creating a New Validator

### Step 1: Define Types

In `types/validation.ts`:
```typescript
interface MyValidatorInput {
  // Data needed for validation
}

interface MyValidationResult {
  passed: boolean;
  metrics: MyMetrics;
  issues: ValidationIssue[];
}
```

### Step 2: Implement Validator

```typescript
class MyValidator {
  constructor(config?: Partial<ValidationRuleConfig>) {
    // Apply defaults, merge with config
  }

  async validate(input: MyValidatorInput): Promise<MyValidationResult> {
    const issues: ValidationIssue[] = [];

    // Check rules, push issues
    if (someCondition) {
      issues.push({
        category: 'my-check',
        level: 'warning',
        message: 'Description of the problem',
        location: 'scene-id > beat-id',
        suggestion: 'How to fix it'
      });
    }

    return {
      passed: issues.filter(i => i.level === 'error').length === 0,
      metrics: { /* computed metrics */ },
      issues
    };
  }
}
```

### Step 3: Register in Orchestrator

In `IntegratedBestPracticesValidator` constructor:
```typescript
this.myValidator = new MyValidator(config?.rules?.myRule);
```

Add to quick validation (if fast) and/or full validation (if comprehensive).

### Step 4: Add Config

In `ValidationConfig.rules`:
```typescript
myRule: { enabled: true, level: 'warning', /* thresholds */ }
```

## Checklist for New Validators

1. Define input/output types in `types/validation.ts`
2. Implement with `validate()` returning `{ passed, metrics, issues }`
3. Use `ValidationIssue` with category, level, message, location, suggestion
4. Register in `IntegratedBestPracticesValidator` constructor
5. Decide: quick mode (heuristic, no LLM) or full mode (comprehensive, may use LLM) or both
6. If incremental: add to `IncrementalValidationRunner`, return `regenerationRequested`
7. If auto-fixable: add fix logic to `StructuralValidator.autoFix()`
8. Add rule config to `ValidationConfig`
