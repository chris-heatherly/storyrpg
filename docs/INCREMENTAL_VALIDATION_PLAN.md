# Incremental Validation System

**Last Updated:** April 2026

**Status:** ✅ Implemented

## Overview

Incremental validation moves appropriate QA checks from end-of-pipeline to per-scene validation during content generation. This catches issues early, reduces rework, and improves content quality through immediate feedback loops.

---

## Current State (Implemented)

```
Phase 1: World Building    → WorldBuilder (has internal quality checks)
Phase 2: Character Design  → CharacterDesigner (has internal quality checks)  
Phase 3: Episode Structure → StoryArchitect (has validateBlueprint)
Phase 4: Content Generation
    ├─ For each scene:
    │   ├─ SceneWriter
    │   │   └─ NEW: IncrementalVoiceValidator → regenerate if fails
    │   ├─ ChoiceAuthor
    │   │   └─ NEW: IncrementalStakesValidator → regenerate if fails
    │   ├─ EncounterArchitect
    │   │   └─ NEW: IncrementalEncounterValidator → warn on issues
    │   └─ NEW: SceneValidationGate
    │       ├─ IncrementalSensitivityChecker → flag issues early
    │       └─ IncrementalContinuityChecker → catch state errors
    └─ [All scenes complete]
Phase 4.5: Quick Validation → IntegratedBestPracticesValidator.runQuickValidation()
Phase 5: QA (Reduced scope)
    ├─ CrossSceneContinuityCheck (full)
    ├─ PlotHoleDetector (full)
    ├─ ToneAnalyzer (full - needs all scenes)
    ├─ PacingAuditor (full - needs all scenes)
    └─ SensitivityReviewer (final rating assessment)
Phase 6: Assembly
Phase 7: Save
```

---

## Implementation Tasks

### Task 1: Create Incremental Validator Module

**File:** `src/ai-agents/validators/IncrementalValidators.ts`

The implementation includes the following components:

#### Key Validators

- **IncrementalVoiceValidator**: Checks character voice consistency per scene using heuristics for vocabulary level, formality, and verbal tics
- **IncrementalStakesValidator**: Validates choice sets for false choices, stakes quality, and choice clarity
- **IncrementalSensitivityChecker**: Flags content rating concerns using keyword patterns for violence, language, sexual content, substance use, discrimination, and trauma
- **IncrementalContinuityChecker**: Tracks and validates flag/score references to prevent undefined state errors
- **IncrementalEncounterValidator**: Validates encounter structure for completeness and proper victory/defeat/partial victory paths

#### Configuration

The system uses `IncrementalValidationConfig` with these defaults:
- Voice regeneration threshold: 50
- Stakes regeneration threshold: 60  
- Maximum regeneration attempts: 2
- Target rating: T (Teen)
- All validators enabled by default

#### Usage Pattern

```typescript
const runner = new IncrementalValidationRunner(
  knownFlags,
  knownScores, 
  config
);

const result = await runner.validateScene(
  sceneContent,
  choiceSet,
  characterProfiles,
  encounter
);

if (result.regenerationRequested === 'scene') {
  // Regenerate scene content
} else if (result.regenerationRequested === 'choices') {
  // Regenerate just the choices
}
```

#### Return Types

- **IncrementalVoiceResult**: Contains pass/fail status, score (0-100), issues array, regeneration recommendation, and dialogue count
- **IncrementalStakesResult**: Contains pass/fail status, score, issues array, regeneration recommendation, and false choice detection
- **IncrementalSensitivityResult**: Contains flags by category (violence, language, sexual, substance, discrimination, trauma), rating implications, and severity levels
- **IncrementalContinuityResult**: Contains issues array for undefined references and state tracking
- **IncrementalEncounterResult**: Contains structure validation, beat counts, and victory/defeat path verification

---

## Integration Points

### With Content Generation Pipeline

The incremental validators integrate at these points:

1. **SceneWriter** → Uses `IncrementalVoiceValidator` to check dialogue consistency
2. **ChoiceAuthor** → Uses `IncrementalStakesValidator` to verify choice quality
3. **EncounterArchitect** → Uses `IncrementalEncounterValidator` for structure validation
4. **Per-scene gate** → Runs all validators via `IncrementalValidationRunner`

### With QA Pipeline

Incremental validation reduces the scope of full QA by:
- Catching voice inconsistencies early (reduces ToneAnalyzer load)
- Preventing false choices (reduces manual QA time)  
- Flagging sensitivity issues before full content review
- Tracking continuity state (prevents undefined reference errors)

### Regeneration Strategy

The system supports smart regeneration:
- **Scene-level**: Voice or major structural issues trigger full scene regeneration
- **Choice-level**: Stakes or choice quality issues trigger choice-only regeneration  
- **Warning-only**: Sensitivity and some continuity issues flag but don't auto-regenerate

---

## Benefits Achieved

1. **Early Issue Detection**: Problems caught during generation, not at end of pipeline
2. **Reduced Rework**: Smart regeneration prevents cascading issues
3. **Improved Content Quality**: Immediate feedback loops improve consistency
4. **Faster QA**: Full QA focuses on high-level issues instead of basic problems
5. **Better User Experience**: More consistent character voices and meaningful choices

---

## Future Enhancements

- **LLM-powered deep voice analysis**: Optional deeper voice consistency checking
- **Adaptive thresholds**: Adjust regeneration thresholds based on story type
- **Cross-scene pattern detection**: Track patterns across scenes for better validation
- **Performance optimization**: Cache validation results for repeated content