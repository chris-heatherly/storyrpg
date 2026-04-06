# QA Fixes Summary

**Last Updated:** April 2026

This document summarizes all fixes implemented during QA audits and bug-fixing sessions.

---

## Critical Fixes

### 1. Race Conditions in Image Generation Rate Limiting
**File:** `src/ai-agents/services/imageGenerationService.ts`

**Problem:** Multiple concurrent image generation requests could bypass rate limiting due to non-atomic timestamp checks.

**Solution:** Implemented `AsyncMutex` class for atomic rate limiting:
```typescript
class AsyncMutex {
  private locked = false;
  private queue: (() => void)[] = [];
  
  async acquire(): Promise<void> { ... }
  release(): void { ... }
  async withLock<T>(fn: () => Promise<T>): Promise<T> { ... }
}
```
All API calls (`generateWithNanoBanana`, `generateWithScenarioGG`, `generateWithMidapi`) now acquire the mutex before checking/updating rate limit timestamps.

---

### 2. Infinite Recursion in Scene Navigation
**File:** `src/engine/storyEngine.ts`

**Problem:** Circular `fallbackSceneId` references could cause stack overflow when navigating scenes.

**Solution:** Added `visited: Set<string>` tracking to prevent cycles:
```typescript
private getFallbackScene(sceneId: string, visited: Set<string> = new Set()): Scene | null {
  if (visited.has(sceneId)) return null; // Prevent infinite loop
  visited.add(sceneId);
  // ... rest of logic
}
```
Applied same pattern to `getNextScene` and `getSceneById`.

---

### 3. Game State Persistence
**File:** `src/stores/gameStore.ts`

**Problem:** Player progress, inventory, relationships, and encounter state were lost on app restart.

**Solution:** Added AsyncStorage persistence with proper serialization:
- `STORAGE_KEYS` constants for consistent key names
- `serializePlayerState` / `deserializePlayerState` - handles `Set` objects (tags)
- `serializeEncounterState` / `deserializeEncounterState` - handles `Set` objects (activeElements)
- `useEffect` hooks for load-on-mount and save-on-change
- `isLoaded` state to prevent writes during initial hydration
- `resetGame` now clears AsyncStorage

---

### 4. Atomic Store Updates
**Files:** `src/stores/seasonPlanStore.ts`, `src/stores/generationJobStore.ts`

**Problem:** Concurrent async operations could cause race conditions when reading/modifying/writing state.

**Solution:**

**seasonPlanStore:** Wrapped all state-modifying methods with mutex:
```typescript
const storeMutex = new AsyncMutex();

savePlan: async (plan) => {
  await storeMutex.withLock(async () => {
    // ... atomic read-modify-write
  });
}
```

**generationJobStore:** Fixed Zustand state capture to avoid stale reads:
```typescript
registerJob: (job) => {
  let updatedJobs: GenerationJob[] = [];
  set((state) => {
    updatedJobs = [...state.jobs, job];
    return { jobs: updatedJobs };
  });
  // Now use updatedJobs for persistence
}
```

---

## High Priority Fixes

### 5. Non-Null Assertion Safety
**Files:** `src/components/StoryReader.tsx`, `src/components/EncounterView.tsx`

**Problem:** Using `processedBeat.nextBeatId!` after async operations could fail if state changed.

**Solution:** Capture values in local variables before async callbacks:
```typescript
const nextBeatId = processedBeat.nextBeatId;
const nextSceneId = processedBeat.nextSceneId;
if (nextBeatId) {
  goToBeat(nextBeatId);
} else if (nextSceneId) {
  goToScene(nextSceneId);
}
```

---

### 6. Event Handler Debouncing
**File:** `src/utils/useDebounce.ts` (new)

**Problem:** Rapid clicks on choices could trigger multiple state transitions.

**Solution:** Created reusable debounce hooks:
```typescript
export function useClickDebounce<T extends (...args: any[]) => any>(
  callback: T, 
  delay: number = 300
): (...args: Parameters<T>) => void
```

Applied to `handleChoicePress` and `handleContinue` in StoryReader and EncounterView with 500ms delay.

---

### 7. Centralized Configuration
**Files:** `src/ai-agents/services/imageGenerationService.ts`, `src/ai-agents/services/voiceCastingService.ts`

**Problem:** Hardcoded proxy URLs scattered across services.

**Solution:** All services now use `PROXY_CONFIG` from `src/config/endpoints.ts`:
```typescript
import { PROXY_CONFIG } from '../../config/endpoints';

private getProxyUrl(): string {
  return `${PROXY_CONFIG.PROTOCOL}://${PROXY_CONFIG.HOST}:${PROXY_CONFIG.PORT}`;
}
```

---

### 8. Retry Logic with Exponential Backoff
**File:** `src/ai-agents/services/imageGenerationService.ts`

**Status:** Already implemented with configurable `maxRetries` and exponential delay.

---

## Medium Priority Fixes

### 9. Unused Import Cleanup
**File:** `src/ai-agents/pipeline/FullStoryPipeline.ts`

**Removed:**
- `audioGenerationService` singleton import (unused)
- `PROGRESS_CALCULATION` constant (unused)
- `AssetAuditorAgent` import (unused)
- `CinematicEncounterImageInput` type (unused)
- `ImageGenerationConfig` type (unused)

---

### 10. Input Validation
**File:** `src/ai-agents/pipeline/FullStoryPipeline.ts`

**Added validation to:**

`generate()`:
```typescript
private validateBrief(brief: FullCreativeBrief): void {
  if (!brief.story?.title) throw new Error('Brief must include story.title');
  if (!brief.protagonist?.id) throw new Error('Brief must include protagonist.id');
  // ... more checks
}
```

`analyzeSourceMaterial()`:
```typescript
if (!sourceText?.trim()) {
  throw new Error('Source text cannot be empty');
}
if (sourceText.length > 500000) {
  throw new Error('Source text too large (max 500KB)');
}
```

`generateMultipleEpisodes()`:
```typescript
if (episodeRange) {
  if (episodeRange.start < 1) throw new Error('Episode range start must be >= 1');
  if (episodeRange.end < episodeRange.start) throw new Error('Invalid episode range');
}
```

---

### 11. Type Safety Improvements

**`src/types/index.ts` - AddItem type:**
```typescript
export type AddItem = {
  type: 'addItem';
  quantity?: number;
} & (
  | { item: Omit<InventoryItem, 'quantity'>; itemId?: never; name?: never; description?: never; }
  | { item?: never; itemId: string; name: string; description: string; }
);
```

**`src/types/index.ts` - NPC pronouns:**
```typescript
npcs: Array<{
  id: string;
  name: string;
  pronouns?: string;  // Added
  // ...
}>;
```

**`src/stores/imageJobStore.ts` - ImageJobMetadata:**
```typescript
export interface ImageJobMetadata {
  sceneId?: string;
  beatId?: string;
  shotId?: string;
  characterId?: string;
  viewType?: string;
  type?: 'scene' | 'beat' | 'cover' | 'master' | 'reference' | 'expression';
  characters?: string[];
  regeneration?: number;
  [key: string]: unknown;
}
```

**`src/engine/templateProcessor.ts`:** Removed `as any` cast for NPC pronouns.

---

### 12. Enhanced Error Context
**File:** `src/ai-agents/pipeline/FullStoryPipeline.ts`

**Added `PipelineError` class:**
```typescript
export class PipelineError extends Error {
  public readonly phase: string;
  public readonly agent?: string;
  public readonly context?: Record<string, unknown>;
  public readonly originalError?: Error;
  
  toJSON() { ... }
}
```

**Applied to:** WorldBuilder and CharacterDesigner failure cases with context about what was requested.

---

## February 2026 Fixes (Technical Debt Resolution)

The following technical debt items from January 2026 have been resolved:

### 13. PipelineEvent Type - FIXED
**Files:** `src/ai-agents/pipeline/EpisodePipeline.ts`, `src/screens/GeneratorScreen.tsx`, `src/components/PipelineProgress.tsx`, `src/stores/generationJobStore.ts`

**Problem:** PipelineEvent type was missing `"debug"` and `"warning"` event types, and was duplicated in 4 files.

**Solution:**
- Added `'debug' | 'warning'` to the type union in `EpisodePipeline.ts`
- Consolidated duplicates: `GeneratorScreen.tsx` and `PipelineProgress.tsx` now import from canonical source
- Updated `generationJobStore.ts` PipelineEventData type to include new event types

```typescript
export interface PipelineEvent {
  type: 'phase_start' | 'phase_complete' | 'agent_start' | 'agent_complete' | 'error' | 'checkpoint' | 'debug' | 'warning';
  // ...
}
```

---

### 14. StateChange vs Consequence Type Mismatch - DOCUMENTED
**File:** `src/ai-agents/agents/EncounterArchitect.ts`

**Problem:** `EncounterArchitect` outputs `StateChange[]` but the game engine expects `Consequence[]`.

**Solution:** Added comprehensive JSDoc documentation to `StateChange` interface explaining the mapping to `Consequence` types and how conversion happens in `FullStoryPipeline.convertStateChangeToConsequence()`.

---

### 15. Missing Properties on Encounter Types - FIXED
**File:** `src/ai-agents/agents/EncounterArchitect.ts`

**Problem:** 
- `EncounterBeat` missing `cinematicSetup`, `situationImage`
- `EncounterStructure` missing `id`

**Solution:**
- Added `cinematicSetup?: CinematicImageDescription` to `EncounterBeat` interface
- Added `situationImage?: string` to `EncounterBeat` interface
- Added `id?: string` to `EncounterStructure` interface
- Added import for `CinematicImageDescription` from types

---

### 16. CharacterProfile Missing Skills - FIXED
**File:** `src/ai-agents/agents/CharacterDesigner.ts`

**Problem:** `CharacterProfile` interface missing `skills` property that pipeline code references.

**Solution:** Added optional `skills` property:
```typescript
skills?: Array<{
  name: string;
  level: number; // 1-100
  description?: string;
}>;
```

---

## Additional Fixes - February 4, 2026 (Phase 2)

### 17. EncounterType Mismatch - FIXED
**File:** `src/types/index.ts`

**Problem:** `EncounterArchitect` input accepts `'exploration' | 'stealth' | 'mixed'` but these weren't in the main `EncounterType` union.

**Solution:** Added missing types to `EncounterType`:
```typescript
export type EncounterType =
  | 'combat' | 'chase' | 'heist' | 'negotiation'
  | 'investigation' | 'survival' | 'social' | 'puzzle'
  | 'exploration' | 'stealth' | 'mixed'; // Added
```

---

### 18. Type Duplication in EncounterArchitect - FIXED
**File:** `src/ai-agents/agents/EncounterArchitect.ts`

**Problem:** `EncounterApproach` and `NPCDisposition` were redefined locally instead of imported.

**Solution:** Import from canonical source and re-export for consumers:
```typescript
import { EncounterApproach, NPCDisposition } from '../../types';
export type { EncounterApproach, NPCDisposition } from '../../types';
```

---

### 19. StoryEngine EncounterBeat Support - FIXED
**File:** `src/engine/storyEngine.ts`

**Problem:** `processBeat()` only handled `Beat` type, but encounters use `EncounterBeat` with different structure.

**Solution:**
- Added `isEncounterBeat()` type guard
- Updated `processBeat()` to handle both `Beat` and `EncounterBeat`
- Added `processEncounterChoices()` for `EncounterChoice[]` processing
- EncounterBeat uses `setupText` instead of `text`, `situationImage` instead of `image`

---

### 20. EncounterChoiceOutcome Missing Fields - FIXED  
**File:** `src/ai-agents/agents/EncounterArchitect.ts`

**Problem:** `EncounterChoiceOutcome` missing `cinematicDescription`, `outcomeImage`, `visualStateChanges`.

**Solution:** Added all missing fields to align with `types/index.ts`:
```typescript
outcomeImage?: string;
cinematicDescription?: CinematicImageDescription;
visualStateChanges?: Array<{ type, target, before, after, description }>;
```

---

### 21. ImageJobMetadata Type Update - FIXED
**File:** `src/stores/imageJobStore.ts`

**Problem:** `ImageJobMetadata.type` didn't include `'encounter-setup'` or `'encounter-outcome'`.

**Solution:** Extended the type union.

---

### 22. BranchAnalysis Properties - FIXED
**File:** `src/ai-agents/pipeline/FullStoryPipeline.ts`

**Problem:** Code referenced non-existent `path.pathId`, `rec.priority`, `rec.type`, `reconv.requiredFlags`.

**Solution:** Updated to use correct property names (`path.id`, `reconv.stateReconciliation`).

---

### 23. StoryArchitectInput Missing Pacing - FIXED
**File:** `src/ai-agents/agents/StoryArchitect.ts`

**Problem:** `StoryArchitectInput` missing optional `pacing` property.

**Solution:** Added `pacing?: 'tight' | 'moderate' | 'expansive'`

---

### 24. Null Safety Improvements - FIXED
**Files:** `src/ai-agents/pipeline/FullStoryPipeline.ts`, `src/engine/storyEngine.ts`

**Problems:**
- Unsafe `sceneBlueprint.leadsTo[0]` access without null check
- Unsafe `profile?.voiceProfile.writingGuidance` access

**Solutions:**
- Added null checks for `leadsTo` array before access
- Added optional chaining: `profile?.voiceProfile?.writingGuidance`
- Added `findSceneOrThrow`, `findBeatOrThrow`, `findChoiceOrThrow` helper functions

---

## Remaining Technical Debt

### StateChange vs Consequence Type System - RESOLVED (Feb 2026 Session 3)
**Status:** ✅ Resolved via type boundary pattern
- Created `src/ai-agents/types/llm-output.ts` with canonical LLM output types
- Created `src/ai-agents/converters/stateChangeConverter.ts` with typed conversion functions
- TypeScript now properly understands the type flow from LLM output to runtime types

### GeneratedStorylet Type Duplication - PARTIALLY RESOLVED
**Status:** ⚠️ Improved but still has local definitions
- `EncounterArchitect` still has local `GeneratedStorylet`/`StoryletBeat` types
- Additional draft types exist in `src/ai-agents/types/encounterDraft.ts` (`StoryletBeatDraft`, `GeneratedStoryletDraft`)
- These are converted via `convertLLMStoryletToRuntime()` in encounterConverter
- Could be further unified in future refactoring

### FullStoryPipeline.ts Size - PARTIALLY RESOLVED
**Status:** ⚠️ Started refactoring, more work needed
- Created `src/ai-agents/pipeline/phases/` directory structure
- Extracted `encounterConverter.ts` (~220 lines removed from pipeline)
- Extracted `WorldBuildingPhase.ts` (template for future extractions)
- Created image infrastructure modules in `src/ai-agents/images/` (prompt building, asset registry, slot manifests, coverage validation)
- Created encounter infrastructure in `src/ai-agents/encounters/` (slot manifests, provider policy)
- Full modularization deferred — requires careful testing of phase dependencies

### Debug Console Logging
**Status:** ⚠️ Partially addressed
- `storyEngine.ts` uses a `STORY_ENGINE_DEBUG` flag for conditional logging
- Multiple other files still have `console.log` statements that should be behind a debug flag for production

---

## Files Modified

### January 2026

| File | Changes |
|------|---------|
| `src/ai-agents/pipeline/FullStoryPipeline.ts` | Input validation, PipelineError, unused imports |
| `src/ai-agents/services/imageGenerationService.ts` | AsyncMutex, centralized config, error logging |
| `src/ai-agents/services/voiceCastingService.ts` | Centralized proxy config |
| `src/engine/storyEngine.ts` | Visited set for recursion prevention |
| `src/stores/gameStore.ts` | AsyncStorage persistence |
| `src/stores/seasonPlanStore.ts` | AsyncMutex for atomic updates |
| `src/stores/generationJobStore.ts` | Fixed Zustand state capture |
| `src/stores/imageJobStore.ts` | Typed ImageJobMetadata |
| `src/components/StoryReader.tsx` | Null checks, debouncing |
| `src/components/EncounterView.tsx` | Null checks, debouncing |
| `src/types/index.ts` | AddItem union type, NPC pronouns |
| `src/engine/templateProcessor.ts` | Removed any cast |
| `src/utils/useDebounce.ts` | New file - debounce utilities |

### February 2026 (Session 1)

| File | Changes |
|------|---------|
| `src/ai-agents/pipeline/EpisodePipeline.ts` | Added 'debug' and 'warning' to PipelineEvent type |
| `src/screens/GeneratorScreen.tsx` | Import PipelineEvent from canonical source |
| `src/components/PipelineProgress.tsx` | Import PipelineEvent from canonical source |
| `src/stores/generationJobStore.ts` | Added 'debug' and 'warning' to PipelineEventData |
| `src/ai-agents/agents/EncounterArchitect.ts` | Added id to EncounterStructure, cinematicSetup/situationImage to EncounterBeat, StateChange docs |
| `src/ai-agents/agents/CharacterDesigner.ts` | Added skills property to CharacterProfile |

### February 2026 (Session 2)

| File | Changes |
|------|---------|
| `src/types/index.ts` | Added 'exploration', 'stealth', 'mixed' to EncounterType |
| `src/ai-agents/agents/EncounterArchitect.ts` | Import types from canonical source, add cinematicDescription/outcomeImage/visualStateChanges to EncounterChoiceOutcome |
| `src/ai-agents/agents/StoryArchitect.ts` | Added pacing property to StoryArchitectInput |
| `src/engine/storyEngine.ts` | Added EncounterBeat support, type guards, processEncounterChoices, findOrThrow helpers |
| `src/ai-agents/pipeline/FullStoryPipeline.ts` | Fixed BranchAnalysis property references, null safety for leadsTo and voiceProfile |
| `src/stores/imageJobStore.ts` | Added encounter-setup, encounter-outcome to ImageJobMetadata.type |

### February 2026 (Session 3 - Architectural Refactoring)

| File | Changes |
|------|---------|
| `src/ai-agents/types/llm-output.ts` | **NEW** - Canonical LLM output types (StateChange, LLMGeneratedStorylet, etc.) |
| `src/ai-agents/types/index.ts` | **NEW** - Re-exports for agent types |
| `src/ai-agents/converters/stateChangeConverter.ts` | **NEW** - StateChange -> Consequence conversion |
| `src/ai-agents/converters/encounterConverter.ts` | **NEW** - EncounterStructure -> Encounter conversion |
| `src/ai-agents/converters/index.ts` | **NEW** - Converter exports |
| `src/ai-agents/pipeline/phases/index.ts` | **NEW** - Phase interfaces and types |
| `src/ai-agents/pipeline/phases/WorldBuildingPhase.ts` | **NEW** - Extracted world building phase |
| `src/ai-agents/agents/EncounterArchitect.ts` | Import StateChange from canonical source |
| `src/ai-agents/pipeline/FullStoryPipeline.ts` | Use extracted converters, remove ~220 lines of duplicate code, add type guards for Beat/EncounterBeat unions |
| `src/ai-agents/services/imageGenerationService.ts` | Extended metadata type for encounter images |

---

## Key Patterns Introduced

### AsyncMutex for Concurrent State Access
```typescript
class AsyncMutex {
  private locked = false;
  private queue: (() => void)[] = [];
  
  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
```

### Visited Set for Recursion Prevention
```typescript
function traverse(id: string, visited: Set<string> = new Set()): Result | null {
  if (visited.has(id)) return null;
  visited.add(id);
  // ... continue traversal
}
```

### Click Debouncing for UI
```typescript
const debouncedHandler = useClickDebounce(originalHandler, 500);
```

### Type Boundary Pattern for LLM Output
```typescript
// 1. Define simplified LLM output types (llm-output.ts)
interface StateChange {
  type: 'flag' | 'score' | 'tag' | 'relationship';
  name: string;
  change: string | number | boolean;
}

// 2. Create typed converter (stateChangeConverter.ts)
function convertStateChangeToConsequence(sc: StateChange): Consequence | null {
  switch (sc.type) {
    case 'flag':
      return { type: 'setFlag', flag: sc.name, value: Boolean(sc.change) };
    // ... other cases
  }
}

// 3. Use converter at boundary (pipeline)
const consequences = convertStateChangesToConsequences(llmOutput.consequences);
```

### Pipeline Phase Extraction Pattern
```typescript
// Phase interface (phases/index.ts)
interface PipelinePhase<TInput, TResult> {
  name: string;
  run(input: TInput, context: PipelineContext): Promise<TResult>;
}

// Extracted phase (WorldBuildingPhase.ts)
class WorldBuildingPhase {
  async run(input: WorldBuildingInput, context: PipelineContext): Promise<WorldBuildingResult> {
    context.emit({ type: 'agent_start', agent: 'WorldBuilder', message: '...' });
    // ... phase logic
    context.addCheckpoint('World Bible', result.data, true);
    return { worldBible: result.data };
  }
}
```

---

## February 2026 (Session 4 - Incremental Validation)

### 25. Incremental Validation System - NEW
**Files:** 
- `src/ai-agents/validators/IncrementalValidators.ts` (NEW)
- `src/ai-agents/pipeline/FullStoryPipeline.ts`
- `src/ai-agents/agents/QAAgents.ts`
- `src/ai-agents/pipeline/EpisodePipeline.ts`
- `src/ai-agents/validators/index.ts`
- `src/constants/validation.ts`

**Problem:** Story QA only ran at the end of the pipeline (Phase 5), meaning issues like voice consistency drift, false choices, or content rating concerns weren't caught until all content was generated - requiring expensive rework.

**Solution:** Implemented per-scene incremental validation during content generation (Phase 4):

| Validator | Trigger Point | Action on Failure |
|-----------|--------------|-------------------|
| `IncrementalVoiceValidator` | After SceneWriter | Regenerate scene (up to 2 attempts) |
| `IncrementalStakesValidator` | After ChoiceAuthor | Regenerate choices (up to 2 attempts) |
| `IncrementalSensitivityChecker` | After scene complete | Emit warning (no regeneration) |
| `IncrementalContinuityChecker` | After scene complete | Emit error for undefined flags/scores |
| `IncrementalEncounterValidator` | After EncounterArchitect | Emit warning for missing beats/outcomes |

**Key Features:**
- Heuristic-based validation (no LLM calls) for fast checking
- Automatic regeneration with guidance on failure
- Tracks flags/scores for continuity checking across scenes
- Aggregates results and emits `validation_aggregated` event at end
- End-of-pipeline QA now skips redundant checks already done incrementally

**Configuration:**
```typescript
// In FullCreativeBrief.options
incrementalValidation?: {
  voiceValidation: boolean;        // Default: true
  stakesValidation: boolean;       // Default: true
  sensitivityCheck: boolean;       // Default: true
  continuityCheck: boolean;        // Default: true
  encounterValidation: boolean;    // Default: true
  voiceRegenerationThreshold: number;   // Default: 50
  stakesRegenerationThreshold: number;  // Default: 60
  maxRegenerationAttempts: number;      // Default: 2
  targetRating: 'E' | 'T' | 'M';        // Default: 'T'
};
skipRedundantQA?: boolean;         // Default: true (skip QA checks done incrementally)
```

**New Pipeline Events:**
- `incremental_validation`: Per-scene validation result
- `regeneration_triggered`: Content regeneration due to validation failure
- `validation_aggregated`: Summary of all incremental validations

---

### Incremental Validation Pattern
```typescript
// Initialize at start of content generation
const incrementalValidator = new IncrementalValidationRunner(
  knownFlags,
  knownScores,
  validSkills,
  incrementalConfig
);

// After SceneWriter
const voiceResult = incrementalValidator.validateVoice(sceneContent, voiceProfiles);
if (voiceResult.shouldRegenerate) {
  // Regenerate with guidance
  const revised = await sceneWriter.execute({
    ...input,
    additionalGuidance: `Fix voice issues: ${voiceResult.issues.map(i => i.issue).join('; ')}`
  });
}

// After ChoiceAuthor
const stakesResult = incrementalValidator.validateStakes(choiceSet);
if (stakesResult.hasFalseChoices) {
  // Regenerate choices
}

// Track state for continuity
incrementalValidator.trackFlagSet(flagName);

// At end of content generation
const aggregated = aggregateValidationResults(sceneValidationResults);
emit({ type: 'validation_aggregated', data: aggregated });

// End-of-pipeline QA with skip options
const qaReport = await qaRunner.runFullQA(input, {
  skipVoiceValidation: true,
  skipStakesAnalysis: true,
  continuityFocusCrossScene: true,
  incrementalResults: { voiceIssueCount, stakesIssueCount, continuityIssueCount }
});
```

---

### Files Modified (Session 4)

| File | Changes |
|------|---------|
| `src/ai-agents/validators/IncrementalValidators.ts` | **NEW** - Incremental validation classes |
| `src/ai-agents/validators/index.ts` | Export incremental validators |
| `src/constants/validation.ts` | Added `INCREMENTAL_VALIDATION_DEFAULTS` |
| `src/ai-agents/pipeline/EpisodePipeline.ts` | Added new event types for incremental validation |
| `src/ai-agents/agents/QAAgents.ts` | Added `QARunnerOptions` to skip redundant checks |
| `src/ai-agents/pipeline/FullStoryPipeline.ts` | Integrated incremental validation into content generation |

---

## Post-February 2026 Additions

The following systems were added after the initial QA fix sessions. They are documented here for completeness as they address technical debt items or extend infrastructure:

### Image Pipeline Infrastructure (New)
- `src/ai-agents/images/` — Modular image prompt building, asset registry, slot manifests, coverage validation, provider policy
- `src/ai-agents/encounters/` — Encounter-specific slot manifests and provider policy
- Multiple new image QA validators in `src/ai-agents/agents/image-team/` (composition, transition, expression, body language, lighting/color, visual narrative, visual storytelling)

### Pipeline Utility Additions (New)
- `src/ai-agents/utils/memoryStore.ts` — `MemoryStore` abstraction (`NodeMemoryStore`, `ProxyMemoryStore`)
- `src/ai-agents/utils/withTimeout.ts` — `withTimeout` wrapper with configurable timeouts
- `src/ai-agents/utils/retryLogic.ts` — Enhanced retry patterns with exponential backoff and jitter

### Additional Validation Infrastructure (New)
- Comprehensive validator suite in `src/ai-agents/validators/` covering choice density, consequence budget, cliffhanger placement, tone consistency, and more
- Type-safe validation configuration system
- Parallel validation execution with proper error aggregation

---

## Testing Infrastructure Improvements

### Unit Test Coverage Added
- `src/engine/storyEngine.test.ts` - Core engine functionality
- `src/engine/templateProcessor.test.ts` - Template processing edge cases  
- `src/ai-agents/agents/EncounterArchitect.test.ts` - Encounter generation validation
- `src/ai-agents/agents/SceneWriter.test.ts` - Scene writing validation

### TypeScript Configuration Improvements
- Split TypeScript configurations: `tsconfig.app.json`, `tsconfig.test.json`, `tsconfig.contracts.json`
- Strict type checking with `--noEmit` for validation
- Proper test isolation with Vitest configuration

---

## Summary

This QA fixes summary documents the evolution of the StoryRPG codebase from critical race condition fixes in January 2026 through comprehensive architectural refactoring and validation system implementation by April 2026. The fixes demonstrate a progression from reactive bug fixes to proactive infrastructure improvements, establishing patterns for concurrent state management, type safety, validation, and modular architecture that support the project's scaling requirements.