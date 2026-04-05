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
    │       ├─ IncrementalSensitivityCheck → flag issues early
    │       └─ IncrementalContinuityCheck → catch state errors
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

```typescript
/**
 * Lightweight validators for incremental (per-scene/per-choice) validation.
 * These run during content generation, not at the end.
 */

import { AgentConfig } from '../config';
import { SceneContent, GeneratedBeat } from '../agents/SceneWriter';
import { ChoiceSet } from '../agents/ChoiceAuthor';
import { VoiceProfile } from '../agents/CharacterDesigner';
import { EncounterStructure } from '../agents/EncounterArchitect';

// ============================================
// INCREMENTAL VOICE VALIDATOR
// ============================================

export interface IncrementalVoiceResult {
  passed: boolean;
  score: number; // 0-100
  issues: Array<{
    beatId: string;
    characterId: string;
    issue: string;
    severity: 'error' | 'warning';
  }>;
  shouldRegenerate: boolean;
}

export class IncrementalVoiceValidator {
  private config: AgentConfig;
  private regenerationThreshold: number;
  
  constructor(config: AgentConfig, regenerationThreshold = 50) {
    this.config = config;
    this.regenerationThreshold = regenerationThreshold;
  }

  /**
   * Quick voice check for a single scene's content.
   * Uses heuristics + optional LLM for deeper check.
   */
  async validateScene(
    sceneContent: SceneContent,
    characterProfiles: Array<{ id: string; name: string; voiceProfile: VoiceProfile }>
  ): Promise<IncrementalVoiceResult> {
    const issues: IncrementalVoiceResult['issues'] = [];
    
    // Quick heuristic checks (no LLM call)
    for (const beat of sceneContent.beats) {
      if (!beat.speaker) continue;
      
      const profile = characterProfiles.find(p => p.id === beat.speaker || p.name === beat.speaker);
      if (!profile) continue;
      
      // Check for verbal tics
      const hasVerbalTics = profile.voiceProfile.verbalTics.some(
        tic => beat.text.toLowerCase().includes(tic.toLowerCase())
      );
      
      // Check vocabulary level (simple heuristic)
      const avgWordLength = beat.text.split(/\s+/).reduce((sum, w) => sum + w.length, 0) / 
                           beat.text.split(/\s+/).length;
      const vocabMismatch = 
        (profile.voiceProfile.vocabulary === 'simple' && avgWordLength > 7) ||
        (profile.voiceProfile.vocabulary === 'academic' && avgWordLength < 4);
      
      // Check formality (simple heuristic)
      const hasContractions = /\b(don't|won't|can't|didn't|isn't|aren't|wasn't|weren't)\b/i.test(beat.text);
      const formalityMismatch = 
        (profile.voiceProfile.formality === 'formal' && hasContractions) ||
        (profile.voiceProfile.formality === 'casual' && !hasContractions && beat.text.length > 100);
      
      if (vocabMismatch) {
        issues.push({
          beatId: beat.id,
          characterId: profile.id,
          issue: `Vocabulary level doesn't match ${profile.name}'s profile (${profile.voiceProfile.vocabulary})`,
          severity: 'warning',
        });
      }
      
      if (formalityMismatch) {
        issues.push({
          beatId: beat.id,
          characterId: profile.id,
          issue: `Formality level doesn't match ${profile.name}'s profile (${profile.voiceProfile.formality})`,
          severity: 'warning',
        });
      }
    }
    
    // Calculate score
    const dialogueBeats = sceneContent.beats.filter(b => b.speaker).length;
    const issueWeight = issues.filter(i => i.severity === 'error').length * 20 +
                       issues.filter(i => i.severity === 'warning').length * 10;
    const score = Math.max(0, 100 - (issueWeight / Math.max(1, dialogueBeats)) * 10);
    
    return {
      passed: score >= this.regenerationThreshold,
      score,
      issues,
      shouldRegenerate: score < this.regenerationThreshold && issues.some(i => i.severity === 'error'),
    };
  }
}

// ============================================
// INCREMENTAL STAKES VALIDATOR
// ============================================

export interface IncrementalStakesResult {
  passed: boolean;
  score: number;
  issues: Array<{
    choiceId: string;
    issue: string;
    severity: 'error' | 'warning';
  }>;
  shouldRegenerate: boolean;
  hasFalseChoices: boolean;
}

export class IncrementalStakesValidator {
  private regenerationThreshold: number;
  
  constructor(regenerationThreshold = 60) {
    this.regenerationThreshold = regenerationThreshold;
  }

  /**
   * Quick stakes check for a single choice set.
   * Detects false choices, obvious answers, and weak stakes.
   */
  async validateChoiceSet(choiceSet: ChoiceSet): Promise<IncrementalStakesResult> {
    const issues: IncrementalStakesResult['issues'] = [];
    let hasFalseChoices = false;
    
    // Check for false choices (same next scene for all)
    const nextScenes = new Set(choiceSet.choices.map(c => c.nextSceneId).filter(Boolean));
    if (nextScenes.size === 1 && choiceSet.choices.length > 1) {
      issues.push({
        choiceId: choiceSet.beatId,
        issue: 'All choices lead to the same scene - potential false choice',
        severity: 'warning',
      });
    }
    
    // Check for identical consequences
    const consequenceSigs = choiceSet.choices.map(c => 
      JSON.stringify(c.consequences?.sort() || [])
    );
    if (new Set(consequenceSigs).size === 1 && choiceSet.choices.length > 1) {
      issues.push({
        choiceId: choiceSet.beatId,
        issue: 'All choices have identical consequences - false choice detected',
        severity: 'error',
      });
      hasFalseChoices = true;
    }
    
    // Check stakes triangle
    const stakes = choiceSet.overallStakes;
    if (stakes) {
      const stakesPresent = [stakes.want, stakes.cost, stakes.identity].filter(Boolean).length;
      if (stakesPresent < 2) {
        issues.push({
          choiceId: choiceSet.beatId,
          issue: `Weak stakes triangle: only ${stakesPresent}/3 elements present`,
          severity: 'warning',
        });
      }
    }
    
    // Check for very short choice text (suggests low effort)
    for (const choice of choiceSet.choices) {
      if (choice.text.length < 15) {
        issues.push({
          choiceId: choice.id,
          issue: `Choice text too short: "${choice.text}" - may lack clarity`,
          severity: 'warning',
        });
      }
    }
    
    // Check minimum choice count
    if (choiceSet.choices.length < 2) {
      issues.push({
        choiceId: choiceSet.beatId,
        issue: 'Less than 2 choices - not a real choice',
        severity: 'error',
      });
    }
    
    // Calculate score
    const errorCount = issues.filter(i => i.severity === 'error').length;
    const warningCount = issues.filter(i => i.severity === 'warning').length;
    const score = Math.max(0, 100 - (errorCount * 30) - (warningCount * 10));
    
    return {
      passed: score >= this.regenerationThreshold,
      score,
      issues,
      shouldRegenerate: errorCount > 0,
      hasFalseChoices,
    };
  }
}

// ============================================
// INCREMENTAL SENSITIVITY CHECKER
// ============================================

export interface IncrementalSensitivityResult {
  passed: boolean;
  flags: Array<{
    category: 'violence' | 'language' | 'sexual' | 'substance' | 'discrimination' | 'trauma';
    severity: 'mild' | 'moderate' | 'strong';
    location: { beatId: string };
    excerpt: string;
  }>;
  ratingImplication?: 'E' | 'T' | 'M' | 'AO';
}

export class IncrementalSensitivityChecker {
  private targetRating: 'E' | 'T' | 'M';
  
  // Keyword patterns for quick detection
  private patterns = {
    violence: {
      mild: /\b(hit|punch|kick|fight|struggle|shove)\b/i,
      moderate: /\b(blood|wound|stab|slash|beat|batter)\b/i,
      strong: /\b(gore|mutilate|dismember|torture|execute|massacre)\b/i,
    },
    language: {
      mild: /\b(damn|hell|crap|ass)\b/i,
      moderate: /\b(bastard|bitch|shit)\b/i,
      strong: /\b(fuck|cock|cunt)\b/i,
    },
    substance: {
      mild: /\b(drink|drunk|beer|wine)\b/i,
      moderate: /\b(drugs|high|stoned|wasted|pills)\b/i,
      strong: /\b(heroin|cocaine|meth|overdose|needle)\b/i,
    },
  };
  
  constructor(targetRating: 'E' | 'T' | 'M' = 'T') {
    this.targetRating = targetRating;
  }

  /**
   * Quick content scan for a single scene.
   * Flags potential rating issues early.
   */
  async checkScene(sceneContent: SceneContent): Promise<IncrementalSensitivityResult> {
    const flags: IncrementalSensitivityResult['flags'] = [];
    let maxSeverity: 'mild' | 'moderate' | 'strong' = 'mild';
    
    for (const beat of sceneContent.beats) {
      const text = beat.text;
      
      // Check each category
      for (const [category, patterns] of Object.entries(this.patterns)) {
        for (const [severity, pattern] of Object.entries(patterns)) {
          if (pattern.test(text)) {
            const match = text.match(pattern);
            flags.push({
              category: category as any,
              severity: severity as any,
              location: { beatId: beat.id },
              excerpt: match ? match[0] : '',
            });
            
            if (severity === 'strong') maxSeverity = 'strong';
            else if (severity === 'moderate' && maxSeverity !== 'strong') maxSeverity = 'moderate';
          }
        }
      }
    }
    
    // Determine rating implication
    let ratingImplication: IncrementalSensitivityResult['ratingImplication'];
    if (maxSeverity === 'strong') ratingImplication = 'M';
    else if (maxSeverity === 'moderate') ratingImplication = 'T';
    else ratingImplication = 'E';
    
    // Check if it exceeds target
    const ratingOrder = { 'E': 0, 'T': 1, 'M': 2, 'AO': 3 };
    const passed = ratingOrder[ratingImplication] <= ratingOrder[this.targetRating];
    
    return {
      passed,
      flags,
      ratingImplication: passed ? undefined : ratingImplication,
    };
  }
}

// ============================================
// INCREMENTAL CONTINUITY CHECKER
// ============================================

export interface IncrementalContinuityResult {
  passed: boolean;
  issues: Array<{
    type: 'undefined_flag' | 'undefined_score' | 'impossible_state' | 'missing_prerequisite';
    detail: string;
    severity: 'error' | 'warning';
  }>;
}

export class IncrementalContinuityChecker {
  private knownFlags: Set<string>;
  private knownScores: Set<string>;
  private setFlags: Set<string>;
  
  constructor(
    knownFlags: string[] = [],
    knownScores: string[] = []
  ) {
    this.knownFlags = new Set(knownFlags);
    this.knownScores = new Set(knownScores);
    this.setFlags = new Set();
  }

  /**
   * Track that a flag has been set (call after processing consequences)
   */
  trackFlagSet(flagName: string): void {
    this.setFlags.add(flagName);
  }

  /**
   * Check a scene's content for continuity issues.
   * Focuses on state references that don't exist.
   */
  async checkScene(
    sceneContent: SceneContent,
    choiceSet?: ChoiceSet
  ): Promise<IncrementalContinuityResult> {
    const issues: IncrementalContinuityResult['issues'] = [];
    
    // Check choice consequences reference valid flags/scores
    if (choiceSet) {
      for (const choice of choiceSet.choices) {
        if (!choice.consequences) continue;
        
        for (const consequence of choice.consequences) {
          if (consequence.type === 'setFlag') {
            // Setting a flag is always okay, but track it
            this.setFlags.add(consequence.flag);
          }
          
          if (consequence.type === 'modifyScore') {
            if (!this.knownScores.has(consequence.score)) {
              issues.push({
                type: 'undefined_score',
                detail: `Choice "${choice.text}" modifies undefined score: ${consequence.score}`,
                severity: 'warning',
              });
            }
          }
        }
        
        // Check conditions reference valid flags
        if (choice.condition) {
          const flagMatch = choice.condition.match(/flags\.(\w+)/g);
          if (flagMatch) {
            for (const match of flagMatch) {
              const flagName = match.replace('flags.', '');
              if (!this.knownFlags.has(flagName) && !this.setFlags.has(flagName)) {
                issues.push({
                  type: 'undefined_flag',
                  detail: `Choice condition references undefined flag: ${flagName}`,
                  severity: 'error',
                });
              }
            }
          }
        }
      }
    }
    
    // Check beat conditions
    for (const beat of sceneContent.beats) {
      if (beat.condition) {
        const flagMatch = beat.condition.match(/flags\.(\w+)/g);
        if (flagMatch) {
          for (const match of flagMatch) {
            const flagName = match.replace('flags.', '');
            if (!this.knownFlags.has(flagName) && !this.setFlags.has(flagName)) {
              issues.push({
                type: 'undefined_flag',
                detail: `Beat "${beat.id}" condition references undefined flag: ${flagName}`,
                severity: 'error',
              });
            }
          }
        }
      }
    }
    
    return {
      passed: !issues.some(i => i.severity === 'error'),
      issues,
    };
  }
}

// ============================================
// COMBINED INCREMENTAL VALIDATOR
// ============================================

export interface IncrementalValidationConfig {
  voiceValidation: boolean;
  stakesValidation: boolean;
  sensitivityCheck: boolean;
  continuityCheck: boolean;
  voiceRegenerationThreshold: number;
  stakesRegenerationThreshold: number;
  maxRegenerationAttempts: number;
  targetRating: 'E' | 'T' | 'M';
}

export const DEFAULT_INCREMENTAL_CONFIG: IncrementalValidationConfig = {
  voiceValidation: true,
  stakesValidation: true,
  sensitivityCheck: true,
  continuityCheck: true,
  voiceRegenerationThreshold: 50,
  stakesRegenerationThreshold: 60,
  maxRegenerationAttempts: 2,
  targetRating: 'T',
};

export interface SceneValidationResult {
  sceneId: string;
  voice?: IncrementalVoiceResult;
  stakes?: IncrementalStakesResult;
  sensitivity?: IncrementalSensitivityResult;
  continuity?: IncrementalContinuityResult;
  overallPassed: boolean;
  regenerationRequested: 'scene' | 'choices' | 'none';
}

export class IncrementalValidationRunner {
  private voiceValidator: IncrementalVoiceValidator;
  private stakesValidator: IncrementalStakesValidator;
  private sensitivityChecker: IncrementalSensitivityChecker;
  private continuityChecker: IncrementalContinuityChecker;
  private config: IncrementalValidationConfig;
  
  constructor(
    agentConfig: AgentConfig,
    knownFlags: string[],
    knownScores: string[],
    config: Partial<IncrementalValidationConfig> = {}
  ) {
    this.config = { ...DEFAULT_INCREMENTAL_CONFIG, ...config };
    
    this.voiceValidator = new IncrementalVoiceValidator(
      agentConfig,
      this.config.voiceRegenerationThreshold
    );
    this.stakesValidator = new IncrementalStakesValidator(
      this.config.stakesRegenerationThreshold
    );
    this.sensitivityChecker = new IncrementalSensitivityChecker(
      this.config.targetRating
    );
    this.continuityChecker = new IncrementalContinuityChecker(
      knownFlags,
      knownScores
    );
  }

  /**
   * Run all enabled incremental validations for a scene.
   */
  async validateScene(
    sceneContent: SceneContent,
    choiceSet: ChoiceSet | undefined,
    characterProfiles: Array<{ id: string; name: string; voiceProfile: VoiceProfile }>
  ): Promise<SceneValidationResult> {
    const results: SceneValidationResult = {
      sceneId: sceneContent.sceneId,
      overallPassed: true,
      regenerationRequested: 'none',
    };
    
    // Voice validation
    if (this.config.voiceValidation) {
      results.voice = await this.voiceValidator.validateScene(sceneContent, characterProfiles);
      if (results.voice.shouldRegenerate) {
        results.regenerationRequested = 'scene';
        results.overallPassed = false;
      }
    }
    
    // Stakes validation
    if (this.config.stakesValidation && choiceSet) {
      results.stakes = await this.stakesValidator.validateChoiceSet(choiceSet);
      if (results.stakes.shouldRegenerate) {
        results.regenerationRequested = results.regenerationRequested === 'scene' ? 'scene' : 'choices';
        results.overallPassed = false;
      }
    }
    
    // Sensitivity check
    if (this.config.sensitivityCheck) {
      results.sensitivity = await this.sensitivityChecker.checkScene(sceneContent);
      if (!results.sensitivity.passed) {
        // Don't auto-regenerate for sensitivity, just flag
        results.overallPassed = false;
      }
    }
    
    // Continuity check
    if (this.config.continuityCheck) {
      results.continuity = await this.continuityChecker.checkScene(sceneContent, choiceSet);
      if (!results.continuity.passed) {
        results.overallPassed = false;
      }
    }
    
    return results;
  }

  /**
   * Track flag set for continuity checking
   */
  trackFlagSet(flagName: string): void {
    this.continuityChecker.trackFlagSet(flagName);
  }
}
```

---

### Task 2: Integrate into FullStoryPipeline

**File:** `src/ai-agents/pipeline/FullStoryPipeline.ts`

#### 2.1 Add imports and instance variable

```typescript
// Add to imports
import {
  IncrementalValidationRunner,
  IncrementalValidationConfig,
  SceneValidationResult,
  DEFAULT_INCREMENTAL_CONFIG,
} from '../validators/IncrementalValidators';

// Add to class properties
private incrementalValidator: IncrementalValidationRunner | null = null;
```

#### 2.2 Add configuration option

```typescript
// In PipelineConfig or FullCreativeBrief options
interface PipelineOptions {
  // ... existing options
  incrementalValidation?: Partial<IncrementalValidationConfig>;
}
```

#### 2.3 Initialize incremental validator before content generation

```typescript
// In runContentGeneration, before the scene loop:

// Initialize incremental validator with known flags/scores from blueprint
const knownFlags = blueprint.suggestedFlags.map(f => f.name);
const knownScores = blueprint.suggestedScores.map(s => s.name);

this.incrementalValidator = new IncrementalValidationRunner(
  this.config.agents.sceneWriter,
  knownFlags,
  knownScores,
  brief.options?.incrementalValidation
);
```

#### 2.4 Add validation after SceneWriter

```typescript
// After sceneContent is created (around line 1210):

// === INCREMENTAL VOICE VALIDATION ===
if (this.incrementalValidator) {
  const voiceProfiles = characterBible.characters
    .filter(c => sceneBlueprint.npcsPresent.includes(c.id))
    .map(c => ({
      id: c.id,
      name: c.name,
      voiceProfile: c.voiceProfile,
    }));

  let validationResult = await this.incrementalValidator.validateScene(
    sceneContent,
    undefined, // No choice set yet
    voiceProfiles
  );

  // Attempt regeneration if voice validation failed
  let regenerationAttempt = 0;
  while (
    validationResult.voice?.shouldRegenerate &&
    regenerationAttempt < (brief.options?.incrementalValidation?.maxRegenerationAttempts || 2)
  ) {
    regenerationAttempt++;
    this.emit({
      type: 'debug',
      phase: 'incremental_validation',
      message: `Voice validation failed for ${sceneBlueprint.id}, regenerating (attempt ${regenerationAttempt})`,
      data: validationResult.voice.issues,
    });

    // Regenerate with voice guidance in prompt
    const revisedResult = await this.sceneWriter.execute({
      ...sceneWriterInput,
      additionalGuidance: `VOICE CONSISTENCY: ${validationResult.voice.issues.map(i => i.issue).join('; ')}`,
    });

    if (revisedResult.success && revisedResult.data) {
      sceneContent = this.convertToSceneContent(revisedResult.data, sceneBlueprint);
      validationResult = await this.incrementalValidator.validateScene(
        sceneContent,
        undefined,
        voiceProfiles
      );
    }
  }

  // Log final validation result
  if (validationResult.voice && !validationResult.voice.passed) {
    this.emit({
      type: 'warning',
      phase: 'incremental_validation',
      message: `Voice validation issues remain for ${sceneBlueprint.id} (score: ${validationResult.voice.score})`,
      data: validationResult.voice.issues,
    });
  }
}
```

#### 2.5 Add validation after ChoiceAuthor

```typescript
// After choiceSet is created (around line 1282):

// === INCREMENTAL STAKES VALIDATION ===
if (this.incrementalValidator && choiceResult.data) {
  let stakesResult = await this.incrementalValidator.stakesValidator.validateChoiceSet(choiceResult.data);
  
  let choiceRegenerationAttempt = 0;
  while (
    stakesResult.shouldRegenerate &&
    choiceRegenerationAttempt < (brief.options?.incrementalValidation?.maxRegenerationAttempts || 2)
  ) {
    choiceRegenerationAttempt++;
    this.emit({
      type: 'debug',
      phase: 'incremental_validation',
      message: `Stakes validation failed for ${sceneBlueprint.id} choices, regenerating (attempt ${choiceRegenerationAttempt})`,
      data: stakesResult.issues,
    });

    // Regenerate with stakes guidance
    const revisedChoiceResult = await this.choiceAuthor.execute({
      ...choiceAuthorInput,
      additionalGuidance: `STAKES ISSUES TO FIX: ${stakesResult.issues.map(i => i.issue).join('; ')}`,
    });

    if (revisedChoiceResult.success && revisedChoiceResult.data) {
      choiceResult.data = revisedChoiceResult.data;
      stakesResult = await this.incrementalValidator.stakesValidator.validateChoiceSet(choiceResult.data);
    }
  }

  if (stakesResult.hasFalseChoices) {
    this.emit({
      type: 'warning',
      phase: 'incremental_validation',
      message: `False choices detected in ${sceneBlueprint.id} after ${choiceRegenerationAttempt} attempts`,
    });
  }
}

choiceSets.push(choiceResult.data);
```

#### 2.6 Add sensitivity and continuity check at scene end

```typescript
// After both SceneWriter and ChoiceAuthor complete for a scene:

// === SCENE VALIDATION GATE ===
if (this.incrementalValidator) {
  const voiceProfiles = characterBible.characters
    .filter(c => sceneBlueprint.npcsPresent.includes(c.id))
    .map(c => ({ id: c.id, name: c.name, voiceProfile: c.voiceProfile }));

  const sceneValidation = await this.incrementalValidator.validateScene(
    sceneContent,
    choiceResult?.data,
    voiceProfiles
  );

  // Track any flags that were set for continuity
  if (choiceResult?.data) {
    for (const choice of choiceResult.data.choices) {
      for (const consequence of choice.consequences || []) {
        if (consequence.type === 'setFlag') {
          this.incrementalValidator.trackFlagSet(consequence.flag);
        }
      }
    }
  }

  // Emit sensitivity warnings
  if (sceneValidation.sensitivity && !sceneValidation.sensitivity.passed) {
    this.emit({
      type: 'warning',
      phase: 'sensitivity',
      message: `Content rating concern in ${sceneBlueprint.id}: may push to ${sceneValidation.sensitivity.ratingImplication}`,
      data: sceneValidation.sensitivity.flags,
    });
  }

  // Emit continuity errors
  if (sceneValidation.continuity && !sceneValidation.continuity.passed) {
    for (const issue of sceneValidation.continuity.issues.filter(i => i.severity === 'error')) {
      this.emit({
        type: 'error',
        phase: 'continuity',
        message: `Continuity error in ${sceneBlueprint.id}: ${issue.detail}`,
      });
    }
  }
}
```

---

### Task 3: Update QAAgents for Reduced End-of-Pipeline Scope

**File:** `src/ai-agents/agents/QAAgents.ts`

Add a "light" mode to QARunner that skips checks already done incrementally:

```typescript
export interface QARunnerOptions {
  skipVoiceValidation?: boolean;  // Already done incrementally
  skipStakesAnalysis?: boolean;   // Already done incrementally
  skipLocalContinuity?: boolean;  // Already done incrementally
}

export class QARunner {
  // ... existing code

  async runFullQA(input: QAInput, options: QARunnerOptions = {}): Promise<QAReport> {
    const checks: Promise<AgentResponse<unknown>>[] = [];

    // Always run full continuity (cross-scene)
    checks.push(this.continuityChecker.execute({
      ...input,
      // Focus on cross-scene issues since per-scene was done incrementally
      focusMode: options.skipLocalContinuity ? 'cross_scene_only' : 'full',
    }));

    // Skip voice if done incrementally
    if (!options.skipVoiceValidation) {
      checks.push(this.voiceValidator.execute({
        sceneContents: input.sceneContents,
        characterProfiles: input.characterProfiles,
      }));
    }

    // Skip stakes if done incrementally
    if (!options.skipStakesAnalysis) {
      checks.push(this.stakesAnalyzer.execute({
        choiceSets: input.choiceSets,
        sceneContexts: input.sceneContexts,
        storyThemes: input.storyThemes,
        targetTone: input.targetTone,
      }));
    }

    // ... rest of implementation
  }
}
```

---

### Task 4: Add Pipeline Events for Incremental Validation

**File:** `src/ai-agents/pipeline/EpisodePipeline.ts`

Add new event types:

```typescript
export interface PipelineEvent {
  type: 
    | 'phase_start' | 'phase_complete' 
    | 'agent_start' | 'agent_complete'
    | 'error' | 'checkpoint' | 'debug' | 'warning'
    | 'incremental_validation_start'    // NEW
    | 'incremental_validation_complete' // NEW
    | 'regeneration_triggered';         // NEW
  // ... rest of interface
}
```

---

### Task 5: Update Configuration Constants

**File:** `src/constants/validation.ts`

```typescript
export const INCREMENTAL_VALIDATION_DEFAULTS = {
  voiceValidation: true,
  stakesValidation: true,
  sensitivityCheck: true,
  continuityCheck: true,
  voiceRegenerationThreshold: 50,
  stakesRegenerationThreshold: 60,
  maxRegenerationAttempts: 2,
  targetRating: 'T' as const,
};
```

---

## Testing Plan

### Unit Tests

1. **IncrementalVoiceValidator**
   - Test vocabulary mismatch detection
   - Test formality mismatch detection
   - Test regeneration threshold

2. **IncrementalStakesValidator**
   - Test false choice detection (same scene)
   - Test false choice detection (same consequences)
   - Test weak stakes triangle detection

3. **IncrementalSensitivityChecker**
   - Test violence keyword detection at each severity
   - Test language keyword detection
   - Test rating implication calculation

4. **IncrementalContinuityChecker**
   - Test undefined flag detection
   - Test undefined score detection
   - Test flag tracking across scenes

### Integration Tests

1. **Pipeline with Incremental Validation Enabled**
   - Generate a short episode with incremental validation
   - Verify regeneration is triggered when appropriate
   - Verify final QA score improves

2. **Regeneration Loop**
   - Mock a SceneWriter that produces bad voice consistency
   - Verify regeneration attempts are limited
   - Verify warning is emitted when max attempts reached

---

## Rollout Status

### Phase 1: Foundation — ✅ Complete
- [x] Created `IncrementalValidators.ts`
- [x] Added configuration types
- [x] Added `INCREMENTAL_VALIDATION_DEFAULTS` to `src/constants/validation.ts`

### Phase 2: Integration — ✅ Complete
- [x] Integrated into `FullStoryPipeline.ts`
- [x] Added pipeline events (`incremental_validation`, `regeneration_triggered`, `validation_aggregated`)
- [x] Updated `QAAgents.ts` with `QARunnerOptions` for skip-redundant mode

### Phase 3: Optimization — 🔴 Future
- [ ] Tune thresholds based on real generation data
- [ ] Add metrics/logging for regeneration rates
- [ ] Consider LLM-assisted incremental checks for edge cases

### Phase 4: Documentation — ✅ Complete
- [x] Updated `QA_FIXES_SUMMARY.md`
- [x] Configuration documented in this file and `STORY_AGENT_SYSTEM_DETAIL.md`

---

## Metrics to Track

After implementation, monitor:

1. **Regeneration Rate**: % of scenes/choices that trigger regeneration
2. **Regeneration Success**: % of regenerations that pass validation
3. **Final QA Score Delta**: Compare QA scores with/without incremental validation
4. **Generation Time Impact**: Time added by incremental validation
5. **Cost Impact**: Additional LLM calls from regeneration

Target: <15% regeneration rate, >80% regeneration success, +5-10 points on final QA score.

---

## Implementation Files

| File | Role |
|---|---|
| `src/ai-agents/validators/IncrementalValidators.ts` | All incremental validator classes |
| `src/ai-agents/validators/index.ts` | Re-exports incremental validators |
| `src/constants/validation.ts` | `INCREMENTAL_VALIDATION_DEFAULTS` |
| `src/ai-agents/pipeline/EpisodePipeline.ts` | Pipeline event types |
| `src/ai-agents/agents/QAAgents.ts` | `QARunnerOptions` for skip-redundant mode |
| `src/ai-agents/pipeline/FullStoryPipeline.ts` | Incremental validation integration |

---

*Created: February 5, 2026*
*Updated: April 4, 2026*
