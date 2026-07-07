/**
 * Encounter Architect Agent
 *
 * The encounter design specialist responsible for:
 * - Structuring complex encounters with escalation beats
 * - Designing skill challenges and their difficulty curves
 * - Creating storylets for tactical branching (victory/defeat/escape paths)
 * - Generating environmental elements (hazards & opportunities)
 * - NPC reaction systems with dispositions and tells
 * - Escalation triggers at threat thresholds
 * - Visual direction per phase and outcome
 * - Implementing Pixar's "Stack the Odds Against" principle
 */

import { AgentConfig } from '../config';
import { formatForbiddenRevealsSection } from '../utils/forbiddenReveals';
import { BaseAgent, AgentMessage, AgentResponse } from './BaseAgent';
import { withTimeoutAbort, TimeoutError } from '../utils/withTimeout';
import { shrinkClockToCoverage } from '../pipeline/encounterRemediation';
import { deepenStructureRootWins } from '../utils/encounterDepthContract';
import { PROSE_AND_DIALOGUE_CRAFT } from '../prompts/proseCraftRegister';
import { rebalanceEncounterSkills } from '../utils/encounterSkillRebalance';
import {
  buildEncounterPhase1CompactJsonSchema,
  buildEncounterPhase1JsonSchema,
  buildEncounterPhase2JsonSchema,
  buildEncounterPhase3JsonSchema,
  buildEncounterCoreJsonSchema,
  buildEncounterStoryletDraftJsonSchema,
  buildEncounterStructureJsonSchema,
} from '../schemas/encounterSchemas';

/**
 * Distinctive, non-interpolated fragments of the deterministic fallback prose
 * (`buildDeterministicFallback`) and default storylets (`createDefaultStorylet`).
 * When any of these appears in an encounter's PLAYER-FACING prose, the encounter
 * shipped templated boilerplate instead of authored content (the Endsong climax
 * bug).
 *
 * NO-BOILERPLATE MANDATE (2026-06-11): template prose must never ship. The
 * production fallback paths that returned `buildDeterministicFallback` output as
 * a "successful" encounter are REMOVED — a total generation failure now surfaces
 * as failure so the caller regenerates with feedback. `createDefaultStorylet`
 * remains only as mid-loop gap-fill (keeps a partially-built structure playable
 * between regen attempts); the generation-time template scan in
 * ContentGenerationPhase refuses to ACCEPT any encounter while these fragments
 * are present, and fails the episode rather than ship one. The final contract's
 * EncounterQualityValidator scan stays as defense-in-depth.
 *
 * SINGLE SOURCE OF TRUTH: these mirror the literal strings in the builders
 * below. `EncounterArchitect.templateSignatures.test.ts` asserts a
 * freshly-built deterministic fallback + default storylets actually contain
 * these fragments, so they can't silently drift. If you change the fallback
 * prose, update this list (the test will fail until you do).
 */
export const TEMPLATE_SIGNATURES: readonly string[] = Object.freeze([
  // buildDeterministicFallback (beat-2 setup + choices + outcomes)
  'This is the moment that decides everything',
  'face the final test',
  'Push for a decisive outcome',
  'Stand firm and endure',
  'Find a way out on your terms',
  'An unexpected solution presents itself',
  'It works, mostly',
  // createDefaultStorylet (victory / defeat / partialVictory / escape)
  'comes through the encounter with the pressure finally loosening',
  'feels the moment slip away before anyone has to name it',
  'But even in defeat, something has shifted',
  "Resolve hardens. This isn't the end. It's a turning point",
  'gets through the moment, but relief does not arrive alone',
  'has escaped, but barely',
  'The adrenaline is still coursing',
]);

/** Return the template signatures found in a blob of text (case-sensitive substring). */
export function findTemplateSignatures(text: string): string[] {
  if (!text) return [];
  return TEMPLATE_SIGNATURES.filter((sig) => text.includes(sig));
}

const REQUIRED_STORYLET_SLOTS = ['victory', 'partialVictory', 'defeat', 'escape'] as const;

import { 
  CinematicImageDescription, 
  EncounterCost,
  EncounterApproach, 
  EncounterNarrativeStyle,
  EncounterOutcome,
  EncounterPayoffContext,
  EncounterStoryboard,
  EncounterStoryboardFrameRole,
  EncounterVisualContract,
  EncounterType,
  NPCDisposition,
  Relationship,
  Consequence,
  ConsequenceDomain,
  ReminderPlan,
  ChoiceFeedbackCue,
} from '../../types';
import {
  StoryAnchors,
  EncounterStoryCircleTarget,
  EncounterStoryCircleTargetEvidence,
  StoryCircleRoleAssignment,
  StoryCircleStructure,
} from '../../types/sourceAnalysis';
import {
  CRAFT_PRESSURE_GUIDANCE,
  buildGenreAwareJeopardyGuidance,
  buildStructuralContextSection,
} from '../prompts/storytellingPrinciples';

import { GeneratedStoryletDraft as GeneratedStorylet, StoryletBeatDraft as StoryletBeat } from '../types/encounterDraft';
import { StateChange } from '../types/llm-output';
import {
  applyAuthoredCostFieldTexts,
  buildCostReauthorPrompt,
  collectFallbackCostFieldEntries,
  type CostReauthorContext,
} from '../utils/encounterFallbackCostFields';
import {
  analyzeRelationshipDynamics,
  RelationshipDynamicsBrief,
  RelationshipSnapshot,
  NPCInfo,
} from '../utils/relationshipDynamics';
import type { StoryVerb } from '../utils/storyVerbs';
import { isSustainedSetPiece } from '../utils/sustainedEncounter';
import type { SceneTimelineHandoff } from '../utils/sceneTimeline';

// Re-export for consumers that import from this file
export type { EncounterApproach, NPCDisposition } from '../../types';
export type { StateChange } from '../types/llm-output';
export type { GeneratedStoryletDraft as GeneratedStorylet, StoryletBeatDraft as StoryletBeat } from '../types/encounterDraft';

// ========================================
// ESCALATION & APPROACH TYPES
// ========================================

export type EscalationPhase = 'setup' | 'rising' | 'peak' | 'resolution';

// ========================================
// INPUT TYPES
// ========================================

export interface EncounterArchitectInput {
  // Scene context
  sceneId: string;
  sceneName: string;
  sceneDescription: string;
  sceneMood: string;
  plannedEncounterId?: string;

  /** Planned location of the encounter scene (from the scene blueprint). */
  sceneLocation?: string;
  /**
   * Diegetic timeline handoff: where/when the previous scene took place and
   * whether this encounter's planned time/location differ. When they do, the
   * encounter's setup prose must ground the new time/place — the audited hard
   * cuts (bookshop afternoon → 4am rooftop) happened exactly at this seam.
   */
  sceneTimeline?: SceneTimelineHandoff;

  // Story context
  storyContext: {
    title: string;
    genre: string;
    tone: string;
    userPrompt?: string;
  };

  // Encounter details
  encounterType: EncounterType;
  encounterStyle?: EncounterNarrativeStyle;
  encounterDescription: string;
  encounterStoryCircleTarget?: EncounterStoryCircleTarget;
  encounterStoryCircleTargetRationale?: string;
  encounterStoryCircleTargetEvidence?: EncounterStoryCircleTargetEvidence;
  encounterStakes?: string;
  encounterRequiredNpcIds?: string[];
  encounterRelevantSkills?: string[];
  encounterBeatPlan?: string[];
  difficulty: 'easy' | 'moderate' | 'hard' | 'extreme';
  partialVictoryCost?: Partial<EncounterCost>;

  /**
   * Set by the pipeline's failure-class-aware outer retry after a truncation
   * (output-budget) failure. A budget failure cannot be fixed by prompt
   * feedback or by repeating the same-size ask, so execute() skips the phased
   * and full-size lean flows and goes straight to the decomposed lean ladder
   * (core structure + per-slot storylet drafts — strictly smaller calls).
   */
  budgetRecovery?: boolean;

  // --- Authored-treatment anchor ("expand, do not rewrite") ---
  /**
   * Authored required beats this encounter MUST depict on-page, verbatim from
   * the treatment ({@link RequiredBeat.mustDepict}). EncounterAnchorContentValidator
   * blocks the run when one is missing from the encounter's reader-facing
   * prose — the architect must receive these texts or it cannot realize them
   * (G12 endsong: the siege's poison/evacuation beat was never passed in).
   */
  requiredBeats?: Array<{ id: string; mustDepict: string; tier: 'signature' | 'authored' | 'seed' | 'coldopen' | 'connective' }>;
  /** A single staged signature device/image the encounter must show. */
  signatureMoment?: string;
  /**
   * The authored pressure this encounter exists to stage (treatment
   * centralConflict). Must be depicted in the encounter's prose, not replaced
   * with a generic fight.
   */
  centralConflict?: string;

  // Protagonist info
  protagonistInfo: {
    name: string;
    pronouns: 'he/him' | 'she/her' | 'they/them';
    physicalDescription?: string;
    relevantSkills?: Array<{ name: string; level: number }>;
  };

  // NPCs involved
  npcsInvolved: Array<{
    id: string;
    name: string;
    pronouns: 'he/him' | 'she/her' | 'they/them';
    role: 'ally' | 'enemy' | 'neutral' | 'obstacle';
    description: string;
    physicalDescription?: string;
    /**
     * How they speak — same shape as SceneWriter's npcs[].voiceNotes
     * (character bible voiceProfile.writingGuidance). Injected into the
     * encounter prompts so encounter dialogue keeps the NPC's distinct voice
     * instead of sounding generic.
     */
    voiceNotes?: string;
  }>;

  // Available skills for challenges
  availableSkills: Array<{
    name: string;
    attribute: string;
    description: string;
  }>;

  // Target structure
  targetBeatCount: number; // Usually 3-5 beats per encounter

  // Scene connections for storylets
  victoryNextSceneId?: string;
  defeatNextSceneId?: string;

  /**
   * Blueprint branch discipline (from the season plan / scene blueprint):
   * `false` means this encounter's scene is NOT a planned branch point — all
   * outcome storylets must converge on the single planned next scene (same
   * destination, different texture/residue). `true` means branching outcomes
   * are planned. Undefined = unknown (no convergence enforcement).
   */
  isBranchPoint?: boolean;

  /**
   * Season-level narrative anchors (from SeasonPlan.anchors). Lets the
   * encounter's dramatic weight align with the season's core Stakes and
   * point toward the season Climax anchor when this IS the climactic
   * encounter.
   */
  seasonAnchors?: StoryAnchors;

  /** Primary season-level Story Circle beat map. */
  seasonStoryCircle?: StoryCircleStructure;

  /** Primary Story Circle beat(s) this episode carries. */
  episodeStoryCircleRole?: StoryCircleRoleAssignment[];
  /** Episode-level fractal Story Circle from StoryArchitect. */
  episodeCircle?: StoryCircleStructure;

  // Pre-encounter state context: flags and relationship thresholds from earlier scenes
  // that are designed to echo inside this encounter as narrative shading, unlocked choices,
  // or difficulty bonuses. Sourced from SceneBlueprint.encounterSetupContext.
  priorStateContext?: {
    // Flags that prior choices may have set, with a description of their intended echo
    relevantFlags: Array<{
      name: string;        // Flag name, e.g. "defended_heathcliff"
      description: string; // What it means and how it should echo
      alreadySet?: boolean; // True if a prior scene already sets this flag; false/undefined = set by a later scene
    }>;
    // Relationships with NPCs in this encounter, and the threshold that matters
    relevantRelationships: Array<{
      npcId: string;
      npcName: string;
      dimension: 'trust' | 'affection' | 'respect' | 'fear';
      operator: '==' | '!=' | '>' | '<' | '>=' | '<=';
      threshold: number;   // The threshold value (e.g. -20 or 30)
      description: string; // How crossing/missing this threshold should manifest
      authored?: boolean;
      currentMaxValue?: number; // Max achievable value given initial + prior scene changes
    }>;
    // Human-readable summary of notable choices the player may have made
    significantChoices: string[];
  };

  // Growth context from scene blueprint (when competenceArc is available)
  competenceArc?: {
    testsNow?: string;
    shortfall?: string;
    growthPath?: string;
  };

  // Pipeline memory / optimization hints from prior runs (optional)
  memoryContext?: string;

  // Genre/source-specific verbs that should shape tactical action design.
  storyVerbs?: StoryVerb[];

  /**
   * Compact summary of the episode's scenes BEFORE this encounter (G12: without it
   * the architect re-staged the season premise from scratch — rewound the timeline
   * to arrival night, met "strangers" the protagonist had known for three scenes,
   * and seated the protagonist at the table as an NPC).
   */
  episodeSoFarSummary?: string;

  /** G12: season ledger facts still withheld at this episode — must not be revealed/confirmed. */
  forbiddenReveals?: import('../utils/forbiddenReveals').ForbiddenReveal[];
}

// ========================================
// PHASED GENERATION TYPES
// ========================================

/** Phase 1 output: opening beat with choice-specific outcome narratives */
export interface Phase1Result {
  sceneId: string;
  encounterType: string;
  goalClock: { name: string; segments: number; description: string };
  threatClock: { name: string; segments: number; description: string };
  stakes: { victory: string; defeat: string };
  openingBeat: {
    setupText: string;
    choices: Array<{
      id: string;
      text: string;
      approach: string;
      primarySkill: string;
      impliedApproach?: string;
      consequenceDomain?: ConsequenceDomain;
      reminderPlan?: ReminderPlan;
      feedbackCue?: ChoiceFeedbackCue;
      outcomes: {
        success: { narrativeText: string; goalTicks: number; threatTicks: number };
        complicated: { narrativeText: string; goalTicks: number; threatTicks: number };
        failure: { narrativeText: string; goalTicks: number; threatTicks: number };
      };
    }>;
  };
}

/** Phase 2 output: branch situations for one choice */
export interface Phase2Result {
  choiceId: string;
  afterSuccess: Phase2Situation;
  afterComplicated: Phase2Situation;
  afterFailure: Phase2Situation;
}

export interface Phase2Situation {
  setupText: string;
  choices: Array<{
    id: string;
    text: string;
    approach: string;
    primarySkill: string;
    consequenceDomain?: ConsequenceDomain;
    reminderPlan?: ReminderPlan;
    feedbackCue?: ChoiceFeedbackCue;
    outcomes: {
      success: Phase2Outcome;
      complicated: Phase2Outcome;
      failure: Phase2Outcome;
    };
  }>;
}

export interface Phase2Outcome {
  narrativeText: string;
  goalTicks: number;
  threatTicks: number;
  isTerminal: boolean;
  encounterOutcome?: string;
  relationshipConsequences?: Array<{
    npcId: string;
    dimension: string;
    change: number;
    reason: string;
  }>;
}

/** Phase 3 output: enrichment patch */
export interface Phase3Result {
  setupTextVariants?: Array<{
    condition: Record<string, unknown>;
    text: string;
  }>;
  statBonuses?: Array<{
    choiceRef: string;
    condition: Record<string, unknown>;
    difficultyReduction: number;
    flavorText?: string;
  }>;
  conditionalChoices?: Array<{
    id: string;
    text: string;
    approach: string;
    primarySkill: string;
    conditions: Record<string, unknown>;
    showWhenLocked?: boolean;
    lockedText?: string;
    outcomes: {
      success: { narrativeText: string; goalTicks: number; threatTicks: number };
      complicated: { narrativeText: string; goalTicks: number; threatTicks: number };
      failure: { narrativeText: string; goalTicks: number; threatTicks: number };
    };
  }>;
}

/**
 * Structured per-encounter telemetry (I2 from the determinism / LLM
 * instrumentation plan). Emitted alongside each EncounterArchitect run
 * so we can measure per-phase success rates, LLM cost, and wall-clock
 * time across real runs before deciding on any phase-architecture
 * changes.
 */
export interface EncounterTelemetry {
  sceneId: string;
  /**
   * phased_success   — phased path, every phase returned data
   * phased_with_gaps — phased path, at least one phase null/failed
   * lean             — phased path threw; legacy lean prompt succeeded
   * lean_decomposed  — a lean full-structure ask truncated; the decomposed
   *                    ladder (core structure + per-slot storylet drafts)
   *                    recovered with strictly smaller calls
   * deterministic    — both lean attempts failed; deterministic fallback
   *                    used instead
   */
  mode: 'phased_success' | 'phased_with_gaps' | 'lean' | 'lean_decomposed' | 'deterministic';
  phase1Ok: boolean;
  /** success per opening-beat choice, in choice order */
  phase2: boolean[];
  phase3Ran: boolean;
  phase3Ok: boolean;
  phase4Ok: boolean;
  /**
   * Number of LLM calls issued during this encounter generation.
   * Phased path is 1 (Phase 1) + N (Phase 2, one per choice) + 0/1 (Phase 3)
   * + 1 (Phase 4). Lean path is 1 or 2. Deterministic path is 0.
   */
  llmCallCount: number;
  msElapsed: number;
  /**
   * Outcome slots whose emitted prose matched the `createDefaultStorylet`
   * fallback text hash-for-hash (I3 instrumentation). Populated for all
   * paths; empty array means all storylets were LLM-authored. Non-empty
   * for phased runs usually signals Phase 4 failed or returned partial
   * output; non-empty for lean runs signals the LLM omitted a slot and
   * `normalizeStructure` filled it with a default.
   */
  phase4DefaultCollisions: Array<'victory' | 'partialVictory' | 'defeat' | 'escape'>;
  /**
   * Per-attempt phase failures recorded during generation (timeouts, parse
   * failures, empty responses). Previously these were swallowed by
   * `.catch(() => null)`; recording them makes degraded encounters auditable
   * (and feeds the EncounterQualityValidator / remediation decision).
   */
  phaseErrors?: EncounterPhaseError[];
  /**
   * True when any phase ultimately failed (gap) — i.e. the encounter shipped
   * with fallback/templated content for at least one phase. Mirrors
   * `mode === 'phased_with_gaps' | 'deterministic'`; surfaced explicitly so
   * downstream gating doesn't have to string-match the mode.
   */
  degraded?: boolean;
}

/** A single recorded phase-generation failure (one attempt). */
export interface EncounterPhaseError {
  phase: string;
  attempt: number;
  reason: 'timeout' | 'parse' | 'empty' | 'max_tokens' | 'safety' | 'recitation' | 'other';
  ms: number;
}

/** Classify a phase failure for telemetry. */
export function classifyPhaseError(err: unknown): EncounterPhaseError['reason'] {
  if (err instanceof TimeoutError) return 'timeout';
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (
    msg.includes('finishreason=safety')
    || msg.includes('"finishreason": "safety"')
    || msg.includes('harm_category_sexually_explicit')
    || (msg.includes('gemini returned empty content') && msg.includes('safety'))
  ) return 'safety';
  if (
    msg.includes('finishreason=recitation')
    || msg.includes('"finishreason": "recitation"')
    || (msg.includes('gemini returned empty content') && msg.includes('recitation'))
  ) return 'recitation';
  if (msg.includes('max_tokens') || msg.includes('max tokens') || msg.includes('truncated llm response')) return 'max_tokens';
  if (msg.includes('timed out') || msg.includes('abort')) return 'timeout';
  if (msg.includes('json') || msg.includes('parse')) return 'parse';
  if (msg.includes('empty') || msg.includes('no response')) return 'empty';
  return 'other';
}

/**
 * Monotone truncation-recovery contract (P1, 2026-07-06): when a generation
 * unit hits max_tokens, the NEXT attempt must strictly reduce the requested
 * output (compact schema, compact prompt, decomposition, or degrade) — never
 * repeat the same-size ask, never escalate to a larger one. The bite-me
 * 2026-07-06 abort made the same impossible full-structure ask four times.
 *
 * This map documents the strategy each generation unit applies on truncation;
 * generationFailureLadder.test.ts pins it against the implementation.
 */
export const ENCOUNTER_TRUNCATION_RECOVERY = Object.freeze({
  /** Retries with buildEncounterPhase1CompactJsonSchema (4096 cap) + compact prompt. */
  phase1: 'compact_schema_retry',
  /** Retries with a compact-output prompt directive (same schema, smaller strings). */
  phase2: 'compact_prompt_retry',
  /** Optional enrichment — a truncation degrades to null (the ask is dropped). */
  phase3: 'degrade',
  /** Per-slot drafts (4096 cap) are already the compact floor — fail closed. */
  phase4: 'fail_closed_at_compact_floor',
  /** Decomposes into encounter_core + four per-slot storylet drafts. */
  lean: 'decompose',
} as const);

export class EncounterPhasedGenerationError extends Error {
  constructor(
    message: string,
    readonly phaseErrors: EncounterPhaseError[],
  ) {
    super(message);
    this.name = 'EncounterPhasedGenerationError';
  }
}

export class EncounterPhase4GenerationError extends EncounterPhasedGenerationError {
  constructor(message: string, phaseErrors: EncounterPhaseError[]) {
    super(message, phaseErrors);
    this.name = 'EncounterPhase4GenerationError';
  }
}

/**
 * Run `items` through `fn` with bounded concurrency. Used for Phase 2 branch
 * generation so the (up to 3) calls don't all contend at once — they reuse the
 * warm keep-alive connection and a transient stall doesn't time out every
 * branch simultaneously. Preserves input order in the result.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = new Array(Math.min(Math.max(1, limit), items.length)).fill(0).map(async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Shared prose-discipline block injected into every encounter prompt phase
 * (Phases 1-4 and the lean fallback prompt). Mirrors SceneWriter's prose
 * contract (Prose And Dialogue Craft + Beat Structure caps) so encounter prose
 * — situation setupText, choice narrativeText, outcome storylets — reads with
 * the same craft as scene beats instead of sprawling flat description (the
 * "hollow encounter middles" defect from the live audits). Keep this in step
 * with SceneWriter's rules: change them together, never one in isolation.
 */
export const ENCOUNTER_PROSE_DISCIPLINE = `## PROSE DISCIPLINE (SAME CONTRACT AS SCENE PROSE)
- SHORT PASSAGES ONLY — DO NOT WRITE PARAGRAPHS of description. Hard caps: setupText 30-50 words; outcome narrativeText 30-60 words; storylet beat text 2-3 sentences (under ~60 words). Use fewer words when the moment doesn't need more.
- Show, don't tell: do not state thoughts or feelings directly. Externalize inner life through action, bodily response, object handling, hesitation, proximity, distance, facial expression, or a brief spoken line.
- Dialogue carries subtext: under pressure characters rarely say what they mean. Keep lines spare, pointed, and selective — sharper and more interrupted as jeopardy rises. No speeches, no explaining.
- Sensory detail is selective and purposeful (place, mood, danger, intimacy, cost). Every detail must carry pressure, threat, desire, movement, or consequence — never static scenery.
- Vary sentence rhythm and openers: shorter, sharper lines under danger; never let two consecutive sentences begin with "You".
- When an NPC lists a Voice, every line of their dialogue must sound like that voice — distinct from other characters and consistent across the encounter.
- Fiction-first (ABSOLUTE): never expose stats, dice, DCs, percentages, thresholds, or system math in player-facing text. The player feels mechanics only as story pressure — risk, leverage, trust, exposure, cost.`;

/** One storylet route rewritten by `enforceStoryletConvergence`. */
export interface StoryletRouteCorrection {
  slot: string;
  from: string;
  to: string;
}

/**
 * Deterministic post-parse guard for blueprint branch discipline (C from the
 * G10 remediation): when the season plan marks this encounter's scene as NOT a
 * branch point (`input.isBranchPoint === false`), every outcome storylet must
 * converge on the single planned next scene. The LLM occasionally routes
 * storylet `nextSceneId` to an invented or unplanned scene id, silently
 * creating scene-graph branches the blueprint never planned (later tripping
 * GATE_BRANCH_FANOUT) — encounterConverter honors `storylets[*].nextSceneId`
 * verbatim. Rewrites mismatched routes in place and returns the corrections so
 * the caller can log them. Pure besides the in-place rewrite; no-ops when the
 * encounter IS a branch point (or branch-ness is unknown).
 */
export function enforceStoryletConvergence(
  storylets: Partial<Record<string, GeneratedStorylet | undefined>> | undefined,
  input: Pick<EncounterArchitectInput, 'isBranchPoint' | 'victoryNextSceneId' | 'defeatNextSceneId'>,
): StoryletRouteCorrection[] {
  if (input.isBranchPoint !== false) return [];
  const planned = input.victoryNextSceneId || input.defeatNextSceneId;
  if (!planned || !storylets) return [];
  const corrections: StoryletRouteCorrection[] = [];
  for (const [slot, storylet] of Object.entries(storylets)) {
    if (!storylet) continue;
    if (storylet.nextSceneId && storylet.nextSceneId !== planned) {
      corrections.push({ slot, from: storylet.nextSceneId, to: planned });
      storylet.nextSceneId = planned;
    }
  }
  return corrections;
}

/** Phase 4 output: storylets */
export interface Phase4Result {
  victory: GeneratedStorylet;
  defeat: GeneratedStorylet;
  escape?: GeneratedStorylet;
  partialVictory?: GeneratedStorylet;
}

type Phase4StoryletSlot = keyof Phase4Result;

const PHASE4_STORYLET_SLOTS: readonly Phase4StoryletSlot[] = Object.freeze([
  'victory',
  'partialVictory',
  'defeat',
  'escape',
]);

interface Phase4StoryletDraft {
  beats?: Array<{ text?: string }>;
  cost?: EncounterCost;
}

// ========================================
// CHOICE & OUTCOME TYPES
// ========================================

// Embedded choice for branching trees (avoids circular type reference)
export interface EmbeddedEncounterChoice {
  id: string;
  text: string;           // Short action-oriented choice text ("Swing at his head")
  approach: string;       // "careful", "bold", "clever", etc.
  primarySkill?: string;  // Skill that influences outcome
  consequenceDomain?: ConsequenceDomain;
  reminderPlan?: ReminderPlan;
  feedbackCue?: ChoiceFeedbackCue;
  outcomes: {
    success: EncounterChoiceOutcome;
    complicated: EncounterChoiceOutcome;
    failure: EncounterChoiceOutcome;
  };
}

export interface EncounterChoiceOutcome {
  tier: 'success' | 'complicated' | 'failure';
  narrativeText: string;  // THE ACTION RESULT - what happens when you swing the sword, make the plea, etc.
  goalTicks: number;
  threatTicks: number;
  outcomeImage?: string; // Generated image URL showing THE ACTION RESULT (filled by pipeline)
  consequences?: StateChange[]; // Converted to Consequence[] in FullStoryPipeline
  
  // === BRANCHING TREE: Embedded next situation ===
  // Each outcome contains its own next situation with new choices.
  // SUCCESS leads to a different future than FAILURE.
  nextSituation?: {
    setupText: string;          // The new situation arising from this outcome
    situationImage?: string;    // Visual of new situation (filled by pipeline)
    choices: EmbeddedEncounterChoice[];  // New choices in this branch
    cinematicSetup?: CinematicImageDescription;
    visualContract?: EncounterVisualContract;
  };
  
  // Terminal outcome - this branch ends the encounter
  isTerminal?: boolean;
  encounterOutcome?: EncounterOutcome;
  cost?: EncounterCost;
  
  // Legacy: nextBeatId for backward compatibility
  nextBeatId?: string;
  
  // Cinematic visual description for the OUTCOME image (THE ACTION RESULT)
  cinematicDescription?: CinematicImageDescription;
  visualContract?: EncounterVisualContract;
  
  // Visual state changes to carry forward
  visualStateChanges?: Array<{
    type: 'character_position' | 'character_condition' | 'environment' | 'prop' | 'lighting';
    target: string;
    before: string;
    after: string;
    description: string;
  }>;
  
  // Legacy visual direction
  visualDirection?: {
    cameraAngle: 'low_heroic' | 'high_diminished' | 'dutch_unstable' | 'eye_level';
    shotType: 'dramatic_closeup' | 'action_wide' | 'reaction_medium' | 'impact_freeze';
    mood: 'triumphant' | 'tense' | 'desperate' | 'bittersweet';
  };

  storyboardFrameId?: string;
  nextStoryboardFrameId?: string;
  tacticalEffect?: string;
}

export interface SkillAdvantage {
  skill: string;
  advantageLevel: 'slight' | 'significant' | 'mastery';
  flavorText: string;
}

export interface EncounterChoice {
  id: string;
  text: string;
  approach: string;
  primarySkill?: string;
  consequenceDomain?: ConsequenceDomain;
  reminderPlan?: ReminderPlan;
  feedbackCue?: ChoiceFeedbackCue;
  
  // Pre-generated outcomes for each tier
  outcomes: {
    success: EncounterChoiceOutcome;
    complicated: EncounterChoiceOutcome;
    failure: EncounterChoiceOutcome;
  };
  
  // Approach system - first beat choices set the encounter approach
  impliedApproach?: EncounterApproach;
  
  // Skill integration
  skillAdvantage?: SkillAdvantage;
  
  // Special choice types (unlocked by momentum/resources)
  specialChoiceType?: 'press_your_luck' | 'desperate_gambit' | 'environmental' | 'signature_move';
  
  // Legacy fields
  consequences?: StateChange[];
  nextBeatId?: string;

  // Pre-encounter state payoff: conditional availability
  conditions?: object;        // ConditionExpression — flag/relationship/attribute/score check
  showWhenLocked?: boolean;
  lockedText?: string;

  // Pre-encounter state payoff: difficulty reduction when condition is met
  statBonus?: {
    condition: object;          // ConditionExpression
    difficultyReduction: number;
    flavorText?: string;
  };
}

// ========================================
// BEAT TYPES
// ========================================

export interface EncounterBeat {
  id: string;
  phase: EscalationPhase;
  name: string;
  description: string;
  setupText: string;

  // Pre-encounter state payoff: conditional situation text variants.
  // First matching condition's text replaces setupText at runtime.
  setupTextVariants?: Array<{ condition: object; text: string }>;
  
  // Player choices (minimum 3 per beat)
  choices?: EncounterChoice[];
  
  // Skill challenge (legacy)
  challenge?: SkillChallenge;
  
  // Image sequence
  imageSequence?: ImageSequenceSpec;
  
  // Cinematic visual system - describes the beat's visual presentation (matches types/index.ts)
  cinematicSetup?: CinematicImageDescription;
  situationImage?: string; // Generated image URL (filled by pipeline)
  visualContract?: EncounterVisualContract;
  
  // Visual direction for this phase (legacy)
  visualDirection?: {
    cameraStyle: 'wide_establishing' | 'medium_action' | 'dramatic_closeups' | 'reaction_shots';
    lighting: 'neutral' | 'increasing_contrast' | 'high_contrast_colored' | 'appropriate_to_outcome';
    mood: 'anticipation' | 'tension_building' | 'maximum_intensity' | 'release';
  };
  
  // State implications
  stateChangesOnSuccess?: StateChange[];
  stateChangesOnFailure?: StateChange[];

  // Flow control
  nextBeatOnSuccess?: string;
  nextBeatOnFailure?: string;
  isTerminal?: boolean;
  
  // Escalation text when threat is high (>=50%)
  escalationText?: string;
  escalationImage?: string;

  storyboardFrameId?: string;
  storyboardRole?: EncounterStoryboardFrameRole;
}

export interface SkillChallenge {
  primarySkill: string;
  alternateSkills?: string[];
  baseDifficulty: number;
  difficultyModifiers?: Array<{
    condition: string;
    modifier: number;
    description: string;
  }>;
  narrativeFraming: string;
}

export interface ImageSequenceSpec {
  frameCount: number;
  keyframes: Array<{
    index: number;
    description: string;
    mood: string;
    focusElement: string;
    cameraAngle: 'wide' | 'medium' | 'close-up' | 'low-angle' | 'high-angle' | 'dutch-angle' | 'over-the-shoulder';
    composition: string;
  }>;
  transitionStyle: 'cut' | 'fade' | 'pan' | 'zoom';
  durationSeconds: number;
}

// StateChange is imported from ../types/llm-output
// See that file for documentation on the type mapping

// ========================================
// ENVIRONMENTAL ELEMENTS
// ========================================

export interface EnvironmentalElement {
  id: string;
  name: string;
  description: string;
  type: 'hazard' | 'opportunity' | 'neutral';
  activationCondition: {
    type: 'threat_threshold' | 'goal_threshold' | 'beat_number' | 'approach';
    value: number | string;
  };
  effect: {
    narrativeDescription: string;
    goalModifier?: number;
    threatModifier?: number;
    unlockChoiceId?: string;
  };
  visualDescription: string;
}

// ========================================
// NPC REACTION SYSTEM
// ========================================

export interface NPCEncounterState {
  npcId: string;
  name: string;
  initialDisposition: NPCDisposition;
  reactionToAggressive: string;
  reactionToCautious: string;
  reactionToClever: string;
  tells: Array<{
    revealCondition: 'encounter_50_percent' | 'high_threat' | 'player_success' | 'player_failure';
    tellDescription: string;
  }>;
  dispositionShifts: Array<{
    trigger: 'player_success' | 'player_failure' | 'threat_high' | 'goal_high';
    newDisposition: NPCDisposition;
    narrativeHint: string;
  }>;
}

// ========================================
// ESCALATION TRIGGERS
// ========================================

export interface EscalationTrigger {
  id: string;
  condition: {
    type: 'threat_threshold' | 'beat_number' | 'consecutive_failures';
    value: number;
  };
  effect: {
    narrativeText: string;
    newComplication?: string;
    threatBonus?: number;
    unlockEscapeOption?: boolean;
    pointOfNoReturn?: boolean;
  };
}

// ========================================
// INFORMATION VISIBILITY (Fog of War)
// ========================================

export interface InformationVisibility {
  threatClockVisible: boolean;
  threatClockApproximate?: 'manageable' | 'growing' | 'dangerous' | 'critical';
  npcTellsRevealAt: 'encounter_50_percent' | 'immediate' | 'never';
  environmentElementsHidden: string[];
  choiceOutcomesUnknown: boolean;
}

// ========================================
// PIXAR STAKES (Rule #16)
// ========================================

export interface PixarStakes {
  initialOddsAgainst: number; // Target: 60-70%
  whatPlayerLoses: string;
  oddsAgainstNarrative: string;
  stackedObstacles: string[];
}

// ========================================
// MAIN OUTPUT STRUCTURE
// ========================================

export interface EncounterStructure {
  id?: string; // Optional: auto-generated as `${sceneId}-encounter` if not provided
  sceneId: string;
  encounterType: EncounterType;
  encounterStyle?: EncounterNarrativeStyle;
  beats: EncounterBeat[];
  startingBeatId: string;
  
  // Clocks
  goalClock: {
    name: string;
    segments: number;
    description: string;
  };
  threatClock: {
    name: string;
    segments: number;
    description: string;
  };
  
  // Stakes
  stakes: {
    victory: string;
    defeat: string;
  };

  // Escalation curve
  tensionCurve: TensionPoint[];
  
  // NEW: Storylets for tactical branching
  storylets: {
    victory: GeneratedStorylet;
    partialVictory?: GeneratedStorylet;
    defeat: GeneratedStorylet;
    escape?: GeneratedStorylet;
  };
  partialVictoryCost?: EncounterCost;
  
  // NEW: Environmental elements
  environmentalElements: EnvironmentalElement[];
  
  // NEW: NPC states
  npcStates: NPCEncounterState[];
  
  // NEW: Escalation triggers
  escalationTriggers: EscalationTrigger[];
  
  // NEW: Information visibility settings
  informationVisibility: InformationVisibility;
  
  // NEW: Pixar stakes
  pixarStakes?: PixarStakes;

  // Pixar principles integration
  pixarSurprise?: {
    setup: string;      // What audience expects
    twist: string;      // What actually happens
    satisfaction: string; // Why it works (inevitable in hindsight)
  };
  pixarCausality?: {
    because: string[];  // Each beat happens BECAUSE of the previous
    therefore: string[];// Each beat leads THEREFORE to the next
  };

  // Metadata
  estimatedDuration: string;
  replayability: string;
  designNotes: string;

  storyboard?: EncounterStoryboard;
  payoffContext?: EncounterPayoffContext;
}

export interface TensionPoint {
  beatId: string;
  tensionLevel: number;
  description: string;
}

// ========================================
// ENCOUNTER SKILL NORMALIZATION (F1)
// ========================================
// The LLM frequently invents non-canonical skill names for encounter choices
// (e.g. fantasy stories use "arcana"/"tactics", or attribute names like
// "empathy"). Those fail the playable-encounter contract (and wouldn't resolve
// at runtime, since only the canonical skills are defined). Snap each choice's
// primarySkill back to a valid skill. See docs/PROJECT_AUDIT_2026-05-28.md.

export const CANONICAL_ENCOUNTER_SKILLS = [
  'athletics', 'stealth', 'perception', 'persuasion',
  'intimidation', 'deception', 'investigation', 'survival',
];

const ENCOUNTER_SKILL_SYNONYMS: Record<string, string> = {
  // social / emotional
  empathy: 'persuasion', compassion: 'persuasion', charm: 'persuasion',
  diplomacy: 'persuasion', negotiation: 'persuasion', rhetoric: 'persuasion', leadership: 'persuasion',
  // observation / reasoning
  insight: 'perception', intuition: 'perception', awareness: 'perception', observation: 'perception',
  tactics: 'investigation', strategy: 'investigation', logic: 'investigation', reason: 'investigation',
  // knowledge / arcane
  arcana: 'investigation', lore: 'investigation', knowledge: 'investigation', history: 'investigation',
  academics: 'investigation', magic: 'investigation', spellcraft: 'investigation', research: 'investigation',
  // physical / survival
  medicine: 'survival', healing: 'survival', nature: 'survival', endurance: 'survival',
  acrobatics: 'athletics', climbing: 'athletics', strength: 'athletics', combat: 'athletics',
  fighting: 'athletics', melee: 'athletics', agility: 'athletics',
  // stealth / guile
  sleight: 'stealth', thievery: 'stealth', pickpocket: 'stealth', sneak: 'stealth',
  intimidate: 'intimidation', menace: 'intimidation', coercion: 'intimidation',
  lying: 'deception', bluff: 'deception', disguise: 'deception',
};

/**
 * Snap a raw (possibly LLM-invented) skill name to a valid one. Prefers an
 * exact match against `validSkills` (the story's defined skills), then a
 * synonym mapping, then a sensible fallback. Pure + exported for testing (F1).
 */
export function snapEncounterSkill(raw: string | undefined, validSkills: string[]): string {
  const canonical = validSkills && validSkills.length
    ? validSkills.map((s) => String(s).toLowerCase())
    : [...CANONICAL_ENCOUNTER_SKILLS];
  const set = new Set(canonical);
  const fallback = set.has('perception') ? 'perception' : canonical[0];
  if (!raw || typeof raw !== 'string') return fallback;
  const key = raw.trim().toLowerCase();
  if (set.has(key)) return key;
  const mapped = ENCOUNTER_SKILL_SYNONYMS[key];
  if (mapped && set.has(mapped)) return mapped;
  return fallback;
}

// ========================================
// ENCOUNTER ARCHITECT CLASS
// ========================================

export class EncounterArchitect extends BaseAgent {
  /**
   * True when the encounter's intent text — including the authored anchor
   * fields (centralConflict, signatureMoment, required beats) — stages a
   * sustained set piece. Shares one regex with EncounterSetPieceDepthValidator
   * so the generator and the gate agree on what "sustained" means.
   */
  private isSustainedSetPieceInput(input: EncounterArchitectInput): boolean {
    return isSustainedSetPiece(
      input.sceneName,
      input.sceneDescription,
      input.encounterDescription,
      input.encounterStakes,
      input.centralConflict,
      input.signatureMoment,
      ...(input.encounterBeatPlan ?? []),
      ...(input.requiredBeats?.map((beat) => beat.mustDepict) ?? []),
    );
  }

  /**
   * Render the authored-treatment anchor (central conflict, signature moment,
   * required beats) as a prompt section. EncounterAnchorContentValidator blocks
   * the run when an anchor isn't depicted in the encounter's reader-facing
   * prose — so the architect must see the authored texts verbatim and be told
   * to realize them on-page. Returns '' for unanchored encounters.
   */
  private buildAuthoredAnchorSection(input: EncounterArchitectInput): string {
    const beats = (input.requiredBeats ?? []).filter(
      (beat) => beat.tier !== 'connective' && beat.mustDepict?.trim(),
    );
    if (!input.centralConflict?.trim() && !input.signatureMoment?.trim() && beats.length === 0) {
      return '';
    }
    const lines: string[] = [
      '',
      '## AUTHORED ANCHOR (FIXED — expand, do not rewrite)',
      'This encounter realizes authored treatment content. Every item below MUST be depicted on-page',
      "in the encounter's prose (setupText / narrativeText / outcome text) using its own concrete",
      'people, objects, and actions — shown as it happens, never summarized, dropped, inverted, or',
      'replaced with a generic confrontation.',
    ];
    if (input.centralConflict?.trim()) {
      lines.push(`- CENTRAL CONFLICT (the pressure this encounter exists to stage): ${input.centralConflict.trim()}`);
    }
    if (input.signatureMoment?.trim()) {
      lines.push(`- SIGNATURE MOMENT (must be SHOWN, not referenced): ${input.signatureMoment.trim()}`);
    }
    beats.forEach((beat, index) => {
      lines.push(`- REQUIRED BEAT ${index + 1} (${beat.tier}): ${beat.mustDepict.trim()}`);
    });
    if (this.isSustainedSetPieceInput(input)) {
      lines.push(
        'This is a SUSTAINED SET PIECE: dramatize it as at least 3 escalating top-level beats',
        '(e.g. breach → repulse → decisive choice), spreading the required beats across them —',
        'never one decision plus a summary outcome.',
      );
    }
    return lines.join('\n');
  }

  private formatEncounterStoryCircleTarget(input: EncounterArchitectInput): string {
    if (!input.encounterStoryCircleTarget) {
      return '- Story Circle Target: Infer from the supplied episode role, but keep the encounter to one of go/search/find/take.';
    }
    const targetMeanings: Record<EncounterStoryCircleTarget, string> = {
      go: 'force threshold commitment into unfamiliar rules; old rules stop working and retreat gets harder',
      search: 'test adaptation under pressure; plans fail, rules are learned, allies/tools/skills are tested, and choices expose identity',
      find: 'grant the wanted thing, answer, access, proof, rescue, power, status, or apparent victory while exposing the next problem',
      take: 'demand payment: cost, loss, wound, rupture, exposure, depletion, compromise, apparent failure, or painful truth',
    };
    return [
      `- Story Circle Target: ${input.encounterStoryCircleTarget} — ${targetMeanings[input.encounterStoryCircleTarget]}`,
      input.encounterStoryCircleTargetRationale ? `- Target Rationale: ${input.encounterStoryCircleTargetRationale}` : '',
      input.encounterStoryCircleTargetEvidence?.protagonistChange
        ? `- Targeted Protagonist Change: ${input.encounterStoryCircleTargetEvidence.protagonistChange}`
        : '',
    ].filter(Boolean).join('\n');
  }

  private getMinimumRequiredBeatCount(input: EncounterArchitectInput): number {
    // Honor the authored anchor: a treatment-sourced encounter carries an
    // `encounterBeatPlan` (one entry per authored required beat). The minimum
    // must scale to that plan so the architect renders the FULL anchor on the
    // first pass (e.g. a two-location "rooftop + the 1am attack/rescue"
    // sequence), rather than collapsing it to a single beat and only being
    // caught reactively by EncounterAnchorContentValidator's repair loop.
    // Clamped to the scene's target beat count and a sane ceiling so we never
    // demand more beats than the structure targets. Falls back to 2 when there
    // is no authored plan.
    const authored = input.encounterBeatPlan?.length ?? 0;
    // G10: a SUSTAINED set piece (siege / "wall breach + repulse" / wave-after-wave) must
    // play out as an escalating SEQUENCE, not a single decision + a summary outcome. Force a
    // floor of 3 beats so normalizeStructure synthesizes a ≥3-point tension curve and the
    // encounter has room to escalate — this is the generative half that keeps
    // EncounterSetPieceDepthValidator (now a blocking gate) from aborting the run on a
    // collapsed siege. Detection shares one regex with the validator (sustainedEncounter util).
    const sustainedFloor = this.isSustainedSetPieceInput(input) ? 3 : 0;
    if (authored <= 0) return Math.max(2, sustainedFloor);
    const ceiling = Math.min(input.targetBeatCount || authored, 8);
    return Math.max(2, sustainedFloor, Math.min(Math.max(authored, sustainedFloor), ceiling));
  }

  private readonly defaultStoryboardRoles: EncounterStoryboardFrameRole[] = [
    'establish',
    'pressureReveal',
    'commit',
    'exchange',
    'reversal',
    'opening',
    'decisiveMove',
    'fallout',
    'aftermath',
  ];

  private describeEncounterStyleFocus(style?: EncounterNarrativeStyle, type?: EncounterType): string {
    const resolved = style || (type === 'combat' || type === 'chase' ? 'action' : type === 'stealth' || type === 'heist' ? 'stealth' : type === 'investigation' || type === 'puzzle' ? 'mystery' : type === 'romantic' ? 'romantic' : type === 'social' || type === 'negotiation' ? 'social' : type === 'survival' || type === 'exploration' ? 'adventure' : 'dramatic');
    switch (resolved) {
      case 'action':
        return 'movement, impact, wounds, footing, weapons, terrain, and threat scale';
      case 'social':
        return 'posture, public pressure, tells, proximity, exposed truths, leverage, and rupture';
      case 'romantic':
        return 'gaze, hesitation, consent, vulnerability, interruption, distance, and emotional risk';
      case 'stealth':
        return 'sightlines, cover, timing windows, tools, evidence left behind, patrol pressure, and near-discovery';
      case 'mystery':
        return 'clue discovery, false leads, suspect tells, environmental detail, missing context, and realization';
      case 'adventure':
        return 'terrain, exhaustion, narrowing exits, sacrifice, resource pressure, and escape windows';
      case 'dramatic':
        return 'emotional pressure, identity tests, relationship distance, irreversible words, and visible cost';
      default:
        return 'clear pressure, tactical position, emotional stakes, visible consequences, and decisive choices';
    }
  }

  /**
   * Distinct fallback `visualMoment` for a storyboard frame whose role has no
   * dedicated authored beat. Without this, every spine frame beyond the authored
   * beat count fell back to the SAME (last) beat's setupText, producing a 9-node
   * spine that repeated one image verbatim (the "hollow middle" the gen-5 audit
   * flagged). Each role gets a dramatically distinct line so the spine reads as a
   * progression even in the deterministic fallback path. `establish` is the only
   * role that leans on the concrete scene description; the rest describe the beat's
   * dramatic function so they never collapse into one another.
   */
  private defaultVisualMomentForRole(
    role: EncounterStoryboardFrameRole,
    input: EncounterArchitectInput,
    styleFocus: string,
  ): string {
    const subject = input.encounterDescription || input.sceneDescription || 'the encounter';
    switch (role) {
      case 'establish':
        return `Establish the scene — ${subject}: the player and the opposition are placed and the pressure (${styleFocus}) is named.`;
      case 'pressureReveal':
        return `The true pressure surfaces: the stakes sharpen, the easy option closes, and ${styleFocus} comes to the fore.`;
      case 'commit':
        return 'The player commits to an approach and the first decisive action lands, changing position or leverage.';
      case 'exchange':
        return 'Back-and-forth: the opposition answers in kind and the balance of leverage shifts under the choice just made.';
      case 'reversal':
        return 'A turn — leverage flips or a revelation reframes the moment, and the previous plan no longer fits.';
      case 'opening':
        return 'An opening appears: the player can press the advantage or protect what matters, but not both.';
      case 'decisiveMove':
        return 'The decisive move — the single choice that determines which outcome the encounter resolves into.';
      case 'fallout':
        return 'The immediate fallout: the cost or relief of the encounter is visible on the bodies and the space.';
      case 'aftermath':
        return 'Aftermath — what remains changed: position, relationship pressure, resource state, or resolve.';
      default:
        return `The encounter advances through a readable change in ${styleFocus}.`;
    }
  }

  /**
   * Style-aware fallback escalation narrative. A romance/social encounter that
   * escalates with the combat string "The situation becomes critical!" reads as a
   * genre break (gen-5 audit). Resolve the encounter's narrative style the same way
   * {@link describeEncounterStyleFocus} does and return text that escalates in that
   * register (emotional irreversibility for romance, rupture for social, …).
   */
  private defaultEscalationNarrative(style?: EncounterNarrativeStyle, type?: EncounterType): string {
    const resolved = style || (type === 'combat' || type === 'chase' ? 'action' : type === 'stealth' || type === 'heist' ? 'stealth' : type === 'investigation' || type === 'puzzle' ? 'mystery' : type === 'romantic' ? 'romantic' : type === 'social' || type === 'negotiation' ? 'social' : type === 'survival' || type === 'exploration' ? 'adventure' : 'dramatic');
    switch (resolved) {
      case 'action':
        return 'The situation turns critical — one wrong move now and it all goes the wrong way.';
      case 'romantic':
        return 'The moment tips toward the irreversible — one more step and there is no taking it back.';
      case 'social':
        return 'The room tightens — the conversation is one wrong word away from rupture.';
      case 'stealth':
        return 'Exposure is seconds away — the margin for a clean exit is almost gone.';
      case 'mystery':
        return 'The thread pulls taut — the truth is close, and so is the cost of reaching it.';
      case 'adventure':
        return 'Conditions turn against you — the way through is narrowing fast.';
      case 'dramatic':
        return 'The pressure peaks — what is said or done now cannot be undone.';
      default:
        return 'The pressure peaks and the easy way out closes.';
    }
  }

  /**
   * Phase-appropriate fallback for an encounter beat that the LLM left without
   * `setupText`. Keeps the staged middle from rendering blank while staying generic
   * enough that it can never satisfy an authored required/signature beat (the
   * fidelity validators still demand the authored content episode-wide).
   */
  private defaultBeatSetupText(phase: EscalationPhase, structure: EncounterStructure): string {
    const styleFocus = this.describeEncounterStyleFocus(structure.encounterStyle, structure.encounterType);
    switch (phase) {
      case 'setup':
        return `The encounter opens: the pressure is established (${styleFocus}) and the player must read the moment before acting.`;
      case 'rising':
        return `The pressure builds — ${styleFocus} sharpen and the stakes climb with each exchange.`;
      case 'peak':
        return 'The encounter reaches its peak: the decisive pressure lands and a choice can no longer be deferred.';
      case 'resolution':
        return `The encounter resolves — the cost or relief is visible in ${styleFocus}.`;
      default:
        return `The encounter continues through a readable change in ${styleFocus}.`;
    }
  }

  private buildDefaultStoryboard(input: EncounterArchitectInput, structure: EncounterStructure): EncounterStoryboard {
    const styleFocus = this.describeEncounterStyleFocus(input.encounterStyle, input.encounterType);
    const frames = this.defaultStoryboardRoles.map((role, index) => {
      // Only use an authored beat for THIS frame when one exists at this index — do
      // NOT fall back to the last beat for higher indices (that produced the
      // duplicated-spine "hollow middle"). Frames without a dedicated authored beat
      // get a role-distinct synthetic moment instead.
      const authoredBeat = index < structure.beats.length ? structure.beats[index] : undefined;
      const hasDecision = role === 'commit' || role === 'exchange' || role === 'opening' || role === 'decisiveMove';
      return {
        id: `${input.sceneId}-storyboard-${role}`,
        role,
        title: role.replace(/([A-Z])/g, ' $1').replace(/^./, ch => ch.toUpperCase()),
        purpose: hasDecision
          ? 'Create a tactical decision window that pays off prior story state while preserving cinematic continuity.'
          : 'Advance the encounter spine through a readable visual/emotional state change.',
        visualMoment:
          authoredBeat?.setupText ||
          authoredBeat?.description ||
          this.defaultVisualMomentForRole(role, input, styleFocus),
        tacticalFunction: hasDecision
          ? 'Player choice can change position, leverage, information, exposure, relationship pressure, resource state, clocks, cost, or storylet outcome.'
          : 'No new mechanical UI; show pressure and consequence through the fiction and current clock feedback only.',
        emotionalState: role === 'aftermath' || role === 'fallout'
          ? 'The cost or relief of the encounter is visible.'
          : input.sceneMood || 'tense',
        continuityState: {
          relationshipDistance: styleFocus,
          propsInPlay: input.encounterRelevantSkills?.slice(0, 3) || [],
          environmentChanges: role === 'fallout' || role === 'aftermath' ? ['visible consequences of the encounter'] : [],
          lighting: role === 'pressureReveal' || role === 'reversal' ? 'heightened contrast' : 'consistent with scene mood',
        },
        decisionWindow: hasDecision,
        allowedApproaches: hasDecision
          ? (['aggressive', 'cautious', 'clever'] as EncounterApproach[])
          : undefined,
        payoffRefs: input.priorStateContext
          ? [
              ...input.priorStateContext.relevantFlags.map(f => f.name),
              ...input.priorStateContext.relevantRelationships.map(r => `${r.npcId}:${r.dimension}`),
            ].slice(0, 5)
          : undefined,
      };
    });

    return {
      spine: frames,
      styleNotes: `Storyboard frames should emphasize ${styleFocus}.`,
      convergencePlan: 'Outcome variants can differ sharply in posture, leverage, cost, and clock movement, but should converge back to the cinematic spine when dramatically appropriate.',
      mechanicsVisibility: 'current_clocks_only',
      sequenceIntent: {
        objective: input.encounterDescription || input.sceneDescription || 'Resolve the encounter pressure through visible choices and consequences.',
        activity: `${input.encounterType || 'mixed'} encounter sequence with back-and-forth pressure, decisions, and fallout`,
        obstacle: input.encounterStakes || 'The opposition makes the objective costly.',
        startState: frames[0]?.visualMoment || 'Pressure is established.',
        turningPoint: frames.find((frame) => frame.role === 'reversal' || frame.role === 'decisiveMove')?.visualMoment || 'A decisive choice shifts leverage.',
        endState: frames[frames.length - 1]?.visualMoment || 'The outcome changes position, cost, or relationship pressure.',
        visualThread: styleFocus,
        mechanicThread: 'encounter clock / leverage / cost',
      },
    };
  }

  private buildDefaultPayoffContext(input: EncounterArchitectInput): EncounterPayoffContext {
    const ctx = input.priorStateContext;
    return {
      consumedFlags: ctx?.relevantFlags.map(flag => ({
        flag: flag.name,
        effect: flag.alreadySet
          ? `Use as a potential unlock, lock, setup variant, hidden advantage, or aftermath echo: ${flag.description}`
          : `Do not use as a current choice condition; reserve for replay shading/statBonus only: ${flag.description}`,
      })),
      relationshipPayoffs: ctx?.relevantRelationships.map(rel => ({
        npcId: rel.npcId,
        dimension: rel.dimension,
        effect: `Can alter setup text, disposition, availability, advantage, visible cost, or storylet echo when ${rel.npcName} ${rel.dimension} ${rel.operator} ${rel.threshold}. ${rel.description}`,
      })),
      skillPayoffs: input.encounterRelevantSkills?.map(skill => ({
        skill,
        effect: 'Use as a fiction-first tactical lever for choice outcomes, hidden advantage, growth, or aftermath learning.',
      })),
      aftermathEchoes: ctx?.significantChoices,
    };
  }

  private requireAuthoredStorylets(
    storylets: Partial<Record<typeof REQUIRED_STORYLET_SLOTS[number], GeneratedStorylet | undefined>> | undefined,
    input: EncounterArchitectInput,
    context: string,
  ): void {
    const missing = REQUIRED_STORYLET_SLOTS.filter((slot) => {
      const storylet = storylets?.[slot];
      return !storylet || !Array.isArray(storylet.beats) || storylet.beats.length === 0 || storylet.beats.some((beat) => !beat?.text?.trim());
    });
    if (missing.length > 0) {
      throw new Error(
        `Encounter ${input.sceneId} missing authored outcome storylet(s) in ${context}: ${missing.join(', ')}. ` +
        'Required storylets must be generated by the LLM; refusing default storylet fallback.'
      );
    }

    const hits = findTemplateSignatures(JSON.stringify(storylets));
    if (hits.length > 0) {
      throw new Error(
        `Encounter ${input.sceneId} storylets in ${context} contain template prose: "${hits[0]}". ` +
        'Template prose must be regenerated, not normalized into the encounter.'
      );
    }
  }

  constructor(config: AgentConfig) {
    super('Encounter Architect', config);
    this.includeSystemPrompt = true;
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Encounter Architect

You design STORYBOARD-DRIVEN encounters where choices and hidden mechanics play out as a cinematic sequence of visual beats. Encounters are not just combat: they include heated arguments, seduction, stealth infiltration, chases, heists, investigations, survival scenes, and emotional confrontations.

The player should feel a storyboard rhythm: establish → pressure reveal → commit → exchange → reversal → opening → decisive move → fallout → aftermath. Decisions from the whole journey culminate here through unlocked choices, altered setup text, hidden advantages, NPC disposition shifts, visible costs, and aftermath echoes.

Preserve gameplay. Goal/threat clocks, current clock visualization, success/complicated/failure tiers, costs, consequences, environmental elements, NPC tells, escalation triggers, stat bonuses, locked choices, and storylets must remain meaningful. Do not add new visible mechanics, progress indicators, dice, raw stats, or extra meters.

## CRITICAL: ACTION → REACTION FLOW

**The player experiences encounters as:**
1. **SEE THE SITUATION** - "The guard swings at your head"
2. **MAKE A CHOICE** - "Duck and sweep his legs" / "Block with your blade" / "Leap backward"
3. **SEE THE RESULT** - The image shows your leg sweep connecting (or missing)
4. **NEW SITUATION + NEW CHOICES** - "He crashes to the ground, but shouts for help. You hear boots in the corridor."

**CRITICAL**: The outcome of each choice creates a tactically and emotionally different panel:
- SUCCESS → stronger position, leverage, information, closeness, cover, opening, or momentum
- FAILURE → exposure, setback, distance, danger, public pressure, misread clue, or lost timing
- COMPLICATED → objective progress plus visible cost, mixed signal, new pressure, or hard tradeoff

Outcome branches should not explode into unrelated scenes. They should preserve character/location continuity and converge back to the storyboard spine when dramatically appropriate.

**This is NOT**: choice → result → same next beat for everyone

## STORYBOARD SPINE + CONTROLLED TACTICAL BRANCHING

Every encounter should include a \`storyboard\` object with 7-9 frames:
\`establish\`, \`pressureReveal\`, \`commit\`, \`exchange\`, \`reversal\`, \`opening\`, \`decisiveMove\`, \`fallout\`, \`aftermath\`.

The storyboard should also include \`sequenceIntent\`: objective, activity, obstacle, startState, turningPoint, endState, visualThread, and optional mechanicThread. This is optional for legacy data compatibility but required-by-process for new encounter output so storyboard panels read as one cinematic sequence.

Each frame needs: visual moment, tactical function, emotional state, continuity state, and whether it is a decision window. Place 2-4 meaningful tactical decision windows across the spine.

Each choice must change at least one: position, leverage, information, exposure, relationship pressure, resource state, threat clock, goal clock, cost domain, or later storylet.

## CONTROLLED TREE STRUCTURE

Instead of beats pointing to the same next beat, EACH OUTCOME contains its own embedded \`nextSituation\`:

\`\`\`
BEAT 1 (Setup)
├── Choice: "Swing at his head"
│   ├── SUCCESS → nextSituation: "He reels back, sword clattering away" → new choices
│   ├── COMPLICATED → nextSituation: "Blades lock, you're face to face" → new choices  
│   └── FAILURE → nextSituation: "He parries and counter-attacks" → new choices
└── Choice: "Feint low, strike high"
    ├── SUCCESS → nextSituation: "Your blade finds his shoulder" → new choices
    ├── COMPLICATED → nextSituation: "He saw through it partially" → new choices
    └── FAILURE → nextSituation: "He reads you completely" → new choices
\`\`\`

## Core Design Philosophy

### Fiction-First Challenges
- Skills expressed through narrative, not numbers
- "The gap looks dangerously wide" not "DC 15 Athletics check"
- Outcomes described narratively with mechanical effects hidden

### Three-Tier Resolution - GENUINELY DIFFERENT OUTCOMES
Every choice has three possible outcomes that lead to DIFFERENT situations:
1. **SUCCESS**: Achieve your intent - leads to advantageous new situation
2. **COMPLICATED**: Partial success with cost - leads to challenging new situation
3. **FAILURE**: Setback - leads to disadvantageous new situation

**Each outcome's nextSituation has DIFFERENT choices reflecting the new reality, but it should still feel like the next panel of the same storyboard.**

### Style-Specific Visual Priorities
- Combat/action: movement, impact, wounds, footing, weapons, terrain, threat scale.
- Social/heated fights: posture, public pressure, tells, proximity, exposed truths, leverage, rupture.
- Romance/seduction: gaze, hesitation, consent, vulnerability, interruption, distance, emotional risk.
- Stealth/heist: sightlines, cover, timing windows, tools, evidence left behind, patrol pressure, near-discovery.
- Investigation/mystery: clue discovery, false leads, suspect tells, environmental detail, missing context, realization.
- Chase/survival/adventure: terrain, exhaustion, narrowing exits, sacrifice, resource pressure, escape windows.

### Dual Clock System (Blades in the Dark inspired)
- **Goal Clock**: Player's objective progress (typically 6 segments)
- **Threat Clock**: Escalating danger (typically 4-6 segments)
- Victory when goal fills first; defeat when threat fills first

## OUTCOME IMAGES: Show THE ACTION RESULT

**CRITICAL**: The outcome image shows the RESULT of the player's action:
- Player chose "Swing at his head" → SUCCESS image shows the sword CONNECTING
- Player chose "Swing at his head" → FAILURE image shows the opponent BLOCKING/DODGING
- Player chose "Plead for mercy" → SUCCESS shows the NPC's expression SOFTENING
- Player chose "Plead for mercy" → FAILURE shows the NPC's expression HARDENING

**This is NOT** a generic "setup for next beat" image. It's the PAYOFF of their choice.

## CINEMATIC VISUAL SYSTEM

Every setup beat, outcome, embedded nextSituation, and storylet beat should also include a \`visualContract\` object that locks:
- \`visualMoment\`
- \`primaryAction\`
- \`emotionalRead\`
- \`relationshipDynamic\`
- \`mustShowDetail\`
- \`keyExpression\`
- \`keyGesture\`
- \`keyBodyLanguage\`
- \`shotDescription\`
- \`emotionalCore\`
- \`visualNarrative\`

### Outcome cinematicDescription - THE ACTION RESULT
The \`cinematicDescription\` in each outcome shows the MOMENT OF IMPACT:

**SUCCESS Image**: The action SUCCEEDS
\`\`\`json
{
  "cinematicDescription": {
    "sceneDescription": "The protagonist's blade connects with the guard's shoulder, blood spraying",
    "focusSubject": "impact moment - blade meeting flesh",
    "cameraAngle": "low_heroic",
    "shotType": "impact",
    "mood": "triumphant",
    "characterStates": [
      { "characterId": "protagonist", "pose": "follow-through of strike", "expression": "fierce triumph" },
      { "characterId": "guard", "pose": "recoiling from wound", "expression": "shock and pain" }
    ]
  },
  "visualContract": {
    "visualMoment": "The strike lands and the balance of power visibly flips.",
    "primaryAction": "protagonist drives the blade through the guard's defense",
    "emotionalRead": "triumph mixed with lethal commitment",
    "relationshipDynamic": "the guard finally loses physical control of the confrontation",
    "mustShowDetail": "the point of contact where the blade connects",
    "keyExpression": "fierce triumph on the protagonist, shock on the guard",
    "keyGesture": "follow-through of the strike with the guard clutching the wound",
    "keyBodyLanguage": "momentum forward from the protagonist, recoil backward from the guard",
    "shotDescription": "tight impact frame with readable faces and weapon contact",
    "emotionalCore": "decisive reversal",
    "visualNarrative": "The image must prove that the protagonist's action succeeded."
  }
}
\`\`\`

**FAILURE Image**: The action FAILS
\`\`\`json
{
  "cinematicDescription": {
    "sceneDescription": "The guard deflects the blow, protagonist's blade sliding harmlessly past",
    "focusSubject": "the parry - guard's blade redirecting the strike",
    "cameraAngle": "high_vulnerability",
    "shotType": "impact",
    "mood": "desperate",
    "characterStates": [
      { "characterId": "protagonist", "pose": "overextended, off-balance", "expression": "alarm" },
      { "characterId": "guard", "pose": "controlled parry, setting up counter", "expression": "confident menace" }
    ]
  }
}
\`\`\`

### nextSituation.cinematicSetup - The NEW Situation
The embedded nextSituation has its own visual setup for the new moment:

\`\`\`json
{
  "nextSituation": {
    "setupText": "The guard staggers back clutching his shoulder. Behind him, you see the cell door - and the keys on his belt.",
    "choices": [...],
    "visualContract": {
      "visualMoment": "A brief opening appears as the wounded guard leaves the keys exposed.",
      "primaryAction": "protagonist spots the keys while the guard struggles to recover",
      "emotionalRead": "pain, urgency, and sudden possibility share the frame",
      "relationshipDynamic": "the guard is still dangerous but no longer fully in control",
      "mustShowDetail": "the keys glinting on the guard's belt",
      "shotDescription": "medium tension frame that keeps the obstacle and opportunity readable",
      "visualNarrative": "The new situation should be understandable at a glance."
    },
    "cinematicSetup": {
      "sceneDescription": "Wounded guard between protagonist and cell door, keys glinting",
      "focusSubject": "protagonist, eyes on the keys",
      "cameraAngle": "medium_action",
      "shotType": "tension_hold",
      "mood": "anticipation"
    }
  }
}
\`\`\`

## TERMINAL OUTCOMES

Some outcomes END the encounter:
- Success that fills the goal clock → \`isTerminal: true, encounterOutcome: "victory"\`
- Failure that fills threat clock → \`isTerminal: true, encounterOutcome: "defeat"\`
- Finding an escape route → \`isTerminal: true, encounterOutcome: "escape"\`

Terminal outcomes don't have nextSituation - they end the encounter.

HARD RULES (violations fail validation):
- SKILL VARIETY: no single skill may be the primarySkill of more than ~40% of the
  choices in this encounter. Rotate approaches (social, observation, deception,
  physical) so there is no one obviously-best skill.
- NO ONE-CLICK WIN: a ROOT-level choice must NEVER have a terminal "victory" or
  "partialVictory" outcome. Winning requires at least TWO choice layers (root →
  nextSituation → terminal). "escape"/"defeat" may terminate earlier.
  This applies to EVERY root choice, including an extra branch-gated one (e.g. a
  4th choice carrying a \`conditions\` flag). Do NOT emit this shape — it is the
  exact violation that fails the gate:
  \`\`\`json
  // ❌ FORBIDDEN — a gated 4th root choice that wins the set-piece in one click
  {
    "id": "c4",
    "conditions": { "type": "flag", "flag": "treatment_branch_alpha", "value": true },
    "outcomes": {
      "success":     { "isTerminal": true, "encounterOutcome": "victory",        "consequences": [] },
      "complicated": { "isTerminal": true, "encounterOutcome": "partialVictory",  "consequences": [] },
      "failure":     { "isTerminal": true, "encounterOutcome": "defeat",          "consequences": [] }
    }
  }
  \`\`\`
  A gated root choice must route its success/partialVictory through a \`nextSituation\`
  whose choices hold the terminal win (which then carries a consequence). Only the
  "defeat" outcome may terminate at the root.
- EVERY terminal outcome carries at least one consequence (setFlag / score /
  relationship) — a costless, stateless exit is a defect.
- EVERY terminal "partialVictory" outcome MUST include a \`cost\` object with
  authored \`immediateEffect\` (the concrete price paid right now) and
  \`visibleComplication\` (the visible complication that follows the protagonist
  out). Omitting it forces a template placeholder, which fails validation.
- THE GOAL CLOCK MUST BE FILLABLE: the sum of goalTicks along the best path must
  be ≥ the goal clock's segments. If your tree can tick at most 5, the clock has
  at most 5 segments — an objective the player can never visibly complete is a
  defect.

## DEPTH LIMITS

To prevent infinite trees:
- Maximum 3-4 "layers" of choices
- After 2-3 layers, outcomes should become terminal
- OR outcomes can share nextSituations (some convergence is OK)

## STORYLETS (Encounter Aftermath — Growth Arcs)

Each encounter outcome (victory/defeat/escape) leads to a storylet that serves as an emotional and mechanical bridge. Storylets are where the player SEES their character grow. Every storylet must include consequence objects that produce visible character development.

### Victory Storylets (1 beat)
- **Beat 1 — Aftermath**: Show the achievement landing in-scene and what it changes going forward. Keep the confidence/growth in the same fiction-first beat; do not add a second generic reflection beat. (2-3 sentences, terminal)
- **Consequences**: Include attribute or skill increases reflecting the skill that drove success (e.g. +3 to the primary skill used, +2 courage if it was a brave act). Also include the confidence score bump and victory flag.

### Defeat Storylets (3 beats — Learning Arc)
- **Beat 1 — Impact**: The immediate aftermath. Show the cost of failure viscerally — what was lost, what went wrong. Somber but NOT hopeless. (2-3 sentences)
- **Beat 2 — Reflection/Learning**: The character processes what happened. A mentor, ally, or inner monologue reveals what could be done differently. Reference the primary skill that was tested and frame growth narratively ("You realize brute force won't work — you need to think smarter."). (2-3 sentences)
- **Beat 3 — Resolve**: The character commits to moving forward, changed by the experience. A moment of determination that sets up future encounters. (1-2 sentences, terminal)
- **Consequences**: Include a positive attribute/skill increase reflecting growth from adversity (e.g. +3 resolve, +2 to a skill the character is developing). Also include the setback score and defeat flag. If an NPC witnessed the failure, include a relationship shift.

### Escape Storylets (2 beats)
- **Beat 1 — Close Call**: The tension of barely getting away. What was left behind. (2-3 sentences)
- **Beat 2 — Assessment**: Taking stock. What was gained and lost. The character is wiser but the challenge remains. (1-2 sentences, terminal)
- **Consequences**: Include +2 resourcefulness or a relevant survival skill. Set the escape flag.

### Storylet Design Rules
- Include \`sequenceIntent\` so aftermath panels have a narrative objective, visual thread, turning point, and end state.
- Unique tone per outcome (triumphant/somber/relieved/bittersweet)
- Sets flags for later narrative callbacks
- Reconverges to main story path
- ALWAYS include at least one attribute or skill consequence that represents growth
- Defeat storylets MUST feel like the beginning of a recovery arc, not a dead end

## PRIOR STATE PAYOFF

Encounters are more powerful when they remember what the player did before them. If the input includes a \`priorStateContext\`, use it to author conditional content that makes earlier choices echo inside the encounter.

**Three payoff mechanisms — use all three where appropriate:**

### 1. setupTextVariants (Narrative shading)
On any encounter beat, add \`setupTextVariants\` alongside \`setupText\`. Each variant has a \`condition\` and a \`text\` that replaces the base text when the condition is true at runtime. Use this for NPC dialogue that changes tone, environmental details referencing a prior choice, or a character noticing something the player did.

Condition format (runtime-evaluated against player state):
\`{ "type": "flag", "flag": "defended_protagonist", "value": true }\`
\`{ "type": "relationship", "npcId": "hindley", "dimension": "trust", "operator": "<", "value": -20 }\`
\`{ "type": "score", "score": "heathcliff_bond", "operator": ">=", "value": 10 }\`

### 2. Conditional Choices (Unlocked options)
Add \`conditions\` to a choice to make it only available to players who built the right state. Use \`showWhenLocked: true\` and \`lockedText\` to hint at what would unlock it. This creates "my choices mattered" moments.

\`\`\`
"conditions": { "type": "flag", "flag": "defended_heathcliff", "value": true },
"showWhenLocked": true,
"lockedText": "You'd need to have stood up for Heathcliff earlier"
\`\`\`

### 3. statBonus (Difficulty reduction)
Add \`statBonus\` when a prior state should make a check easier. The choice is still available without it — just harder.

\`\`\`
"statBonus": {
  "condition": { "type": "relationship", "npcId": "hindley", "dimension": "trust", "operator": ">=", "value": 10 },
  "difficultyReduction": 20,
  "flavorText": "Your earlier honesty with him softens his stance"
}
\`\`\`

**Guidelines:**
- Add at least 1 \`setupTextVariants\` entry per beat when \`priorStateContext\` is provided
- Add 1–2 conditional choices across the whole encounter (not per beat) where a prior flag/relationship genuinely opens a new path
- Add a \`statBonus\` to 1–2 choices that have clear emotional logic (trust = easier persuasion)
- Keep shading subtle — a textVariant should feel like the world remembering, not a pop-up reward
- Conditional choices are one path among others, not a bypass to victory

---

## SKILL-DRIVEN BRANCHING AND GROWTH

Encounters should drive character growth through meaningful skill checks. Follow these principles:

### Every Situation Must Exercise a Skill
Each situation in the encounter tree should have at least one choice whose \`primarySkill\` matches a core attribute or skill the story is developing. Players should feel that the encounter is testing and building specific competencies.

### Failure Branches Create Recovery and Growth Opportunities
When a choice leads to failure, the resulting \`nextSituation\` should NOT simply repeat the same check. Instead, reframe the challenge AND create a growth opportunity:
- Offer a different angle on the same problem (failed persuasion → try empathy; failed force → try cunning)
- Introduce a new element that changes the situation (an ally appears, an opportunity emerges)
- Scale the stakes — the player can still recover, but the path is narrower
- Include a skill consequence in the failure recovery path: the character LEARNS from failure (+3 to +5 to a relevant skill)
- If the scene blueprint has a competenceArc, reference the tested skills and offer growth in the recovery choices
- Failure is a detour through growth, not a dead end

### Complicated Outcomes Create the Richest Branching
The "complicated" tier should produce the most interesting narrative branching. These outcomes should:
- Grant partial progress (1 goal tick) but also add danger (1 threat tick)
- Present genuinely different choices than the success/failure branches
- Create "the price of partial success" moments that force identity-defining decisions
- Include a structured \`cost\` with \`immediateEffect\`, \`visibleComplication\`, and at least one \`cost.consequences\` item

### Consequences Should Be Skill-Relevant
Outcomes should include consequences that match the skill being tested:
- A successful athletics check: \`{ "type": "changeScore", "score": "athletic_confidence", "change": 2 }\` or similar
- A failed social check: show the relationship shifting, not just a generic setback
- Every success/complicated/failure outcome needs at least one durable hook in \`consequences\` or \`cost.consequences\`
- Use a mix of flags, scores, tags, inventory, and relationships; do not make encounter fallout relationship-only
- Costs are not just prose. If the story says the player paid a price, encode what future scenes can test or echo

---

## PIXAR'S RULE #16: Stack the Odds Against

- Initial odds should favor failure (60-70%)
- Consequences must be PERSONAL, not abstract
- Success must feel EARNED
`;
  }

  // Per-phase LLM timeouts. The old flat 120s was too tight: a measured
  // ~8000-token generation takes ~187s, and phase 2 (3 branch situations ×
  // 3 choices × 3 outcomes) is the largest payload — these routinely blew 120s
  // and aborted as "fetch failed", producing the silent phase2:[false,false,false]
  // collapse. Sized generously above the heaviest legit generation but kept
  // below PIPELINE_TIMEOUTS.encounterAgent (25min) so a genuine hang still dies.
  // Each phase additionally gets ONE retry with a fresh timeout window
  // (runPhaseWithRetry).
  private static readonly PHASE1_TIMEOUT_MS = 180_000;
  private static readonly PHASE2_TIMEOUT_MS = 240_000; // largest payload
  private static readonly PHASE3_TIMEOUT_MS = 180_000;
  private static readonly PHASE4_TIMEOUT_MS = 180_000;
  private static readonly PHASE_RETRY_ATTEMPTS = 2;
  private static readonly PHASE2_CONCURRENCY = 2;
  // Phase-1 schema caps openingBeat.choices at 4 (encounterSchemas maxItems).
  private static readonly MAX_PHASE2_CHOICES = 4;
  // Legacy lean/retry single-call path timeout (raised from 120s for the same
  // reason — large structured generations exceed 120s).
  private static readonly PER_CALL_TIMEOUT_MS = 180_000;

  /**
   * Worst-case wall-clock of the phased pipeline when EVERY attempt of every
   * phase times out: sequential phase 1, then the parallel block bounded by its
   * slowest lane (phase 2's ceil(choices/concurrency) sequential waves, each
   * with PHASE_RETRY_ATTEMPTS fresh timeout windows). Retry backoff (~1.2s per
   * retry) is folded in as a small constant. A unit test asserts this stays
   * under PIPELINE_TIMEOUTS.encounterAgent so the outer budget can never sit
   * below the internal sum again (the "600s timeout" bug class, twice fixed).
   */
  static worstCasePhaseBudgetMs(): number {
    const attempts = EncounterArchitect.PHASE_RETRY_ATTEMPTS;
    const backoffPerRetryMs = 1_300;
    const phase1 = attempts * EncounterArchitect.PHASE1_TIMEOUT_MS + (attempts - 1) * backoffPerRetryMs;
    const phase2Waves = Math.ceil(EncounterArchitect.MAX_PHASE2_CHOICES / EncounterArchitect.PHASE2_CONCURRENCY);
    const phase2 = phase2Waves * (attempts * EncounterArchitect.PHASE2_TIMEOUT_MS + (attempts - 1) * backoffPerRetryMs);
    const phase3 = attempts * EncounterArchitect.PHASE3_TIMEOUT_MS + (attempts - 1) * backoffPerRetryMs;
    const phase4 = attempts * EncounterArchitect.PHASE4_TIMEOUT_MS + (attempts - 1) * backoffPerRetryMs;
    return phase1 + Math.max(phase2, phase3, phase4);
  }

  async execute(
    input: EncounterArchitectInput,
    playerRelationships?: Record<string, Relationship>,
    allNpcs?: NPCInfo[],
  ): Promise<AgentResponse<EncounterStructure>> {
    console.log(`[EncounterArchitect] Designing encounter for scene: ${input.sceneId}`);
    const execStart = Date.now();

    // G12: a SUSTAINED set piece must ship ≥3 top-level beats — the runtime
    // converter emits exactly one phase and synthesizes one tension-curve point
    // per top-level beat, so the set-piece depth gate (phases>=2 || curve>=3)
    // is only satisfiable that way. The phased flow structurally produces ONE
    // top-level beat (an opening beat + nested choice trees), so a siege
    // through it ALWAYS collapses (endsong ep3). Route sustained set pieces
    // straight to the flat multi-beat flow, which enforces the 3-beat floor.
    const isSustained = this.isSustainedSetPieceInput(input);
    // Failure-class-aware outer retry (P1): after a truncation failure the
    // pipeline sets budgetRecovery — repeating or growing the ask cannot
    // succeed, so skip the phased and full-size lean flows entirely and go
    // straight to the decomposed ladder (strictly smaller calls).
    const budgetRecovery = input.budgetRecovery === true;
    if (budgetRecovery) {
      console.info(`[EncounterArchitect] ${input.sceneId} entering budget-recovery mode — decomposed lean ladder only (prior attempt hit an output-token ceiling).`);
    } else if (isSustained) {
      console.info(`[EncounterArchitect] ${input.sceneId} is staged as a sustained set piece — using the flat multi-beat flow (the phased tree ships one top-level beat, which the set-piece depth gate rejects).`);
    } else {
      try {
        return await this.executePhased(input, playerRelationships, allNpcs);
      } catch (phasedError) {
        const msg = phasedError instanceof Error ? phasedError.message : String(phasedError);
        if (phasedError instanceof EncounterPhasedGenerationError && this.hasUnsafePhasedFallbackFailure(phasedError.phaseErrors)) {
          console.error(`[EncounterArchitect] Phased generation failed for ${input.sceneId} because a structural phase hit a non-fallback Gemini failure; refusing larger legacy fallback: ${msg}`);
          // P3: phase errors must survive the failure — they are the diagnosis.
          return { success: false, error: msg, metadata: { phaseErrors: phasedError.phaseErrors } };
        }
        console.warn(`[EncounterArchitect] Phased generation failed for ${input.sceneId}, falling back to legacy flow: ${msg}`);
      }
    }

    // Lean flow: lean prompt → retry with feedback. NO deterministic fallback —
    // a total failure returns success:false so the caller's regen loop retries
    // the whole build (no-boilerplate mandate; template prose must never ship).
    const minimumBeatCount = this.getMinimumRequiredBeatCount(input);
    const attemptSummaries: Array<{
      attempt: number;
      mode: string;
      promptChars: number;
      elapsedMs: number;
      responseChars?: number;
      status: 'success' | 'retrying' | 'failed' | 'fallback';
      error?: string;
    }> = [];

    const buildLeanTelemetry = (
      llmCalls: number,
      structure: EncounterStructure,
      mode: 'lean' | 'lean_decomposed' = 'lean',
    ): EncounterTelemetry => ({
      sceneId: input.sceneId,
      mode,
      phase1Ok: false,
      phase2: [],
      phase3Ran: false,
      phase3Ok: false,
      phase4Ok: mode === 'lean_decomposed',
      llmCallCount: llmCalls,
      msElapsed: Date.now() - execStart,
      phase4DefaultCollisions: this.detectDefaultStoryletCollisions(structure, input),
      // Lean path authored a full structure in one call; treat it as degraded
      // only if outcome slots fell back to default storylet prose.
      degraded: this.detectDefaultStoryletCollisions(structure, input).length > 0,
    });

    // Decomposed recovery (P1 monotone ladder): replaces one oversized
    // full-structure ask with five bounded calls — encounter_core (no
    // storylets) plus the four per-slot compact storylet drafts.
    const decomposedPhaseErrors: EncounterPhaseError[] = [];
    let decomposedError: string | undefined;
    const runDecomposed = async (attempt: number): Promise<AgentResponse<EncounterStructure> | null> => {
      try {
        const structure = await this.tryDecomposedLeanAttempt(
          input, attempt, minimumBeatCount, attemptSummaries, decomposedPhaseErrors, playerRelationships, allNpcs,
        );
        const llmCalls = 1 + PHASE4_STORYLET_SLOTS.length + decomposedPhaseErrors.length;
        return { success: true, data: structure, metadata: { encounterTelemetry: buildLeanTelemetry(llmCalls, structure, 'lean_decomposed') } };
      } catch (err) {
        decomposedError = err instanceof Error ? err.message : String(err);
        console.error(`[EncounterArchitect] Decomposed lean recovery failed for ${input.sceneId}: ${decomposedError}`);
        return null;
      }
    };

    if (budgetRecovery) {
      const decomposed = await runDecomposed(1);
      if (decomposed) return decomposed;
      return {
        success: false,
        error: `All LLM attempts failed: budget-recovery decomposed ladder failed — ${decomposedError || 'unknown error'}`,
        metadata: { attemptSummaries, phaseErrors: decomposedPhaseErrors },
      };
    }

    const leanResult = await this.tryLLMAttempt(input, 1, 'lean', minimumBeatCount, attemptSummaries, undefined, undefined);
    if (leanResult.success && leanResult.data) {
      return { ...leanResult, metadata: { ...(leanResult.metadata ?? {}), encounterTelemetry: buildLeanTelemetry(1, leanResult.data) } };
    }

    // MONOTONE LADDER: a truncation means the full-structure ask does not fit
    // the output budget — re-sending the same-size ask (lean_retry) cannot
    // succeed and appending feedback only grows the input. Decompose instead.
    const leanTruncated = classifyPhaseError(new Error(leanResult.error || '')) === 'max_tokens';
    let retryResult: (AgentResponse<EncounterStructure> & { rawResponse?: string }) | null = null;
    if (!leanTruncated) {
      retryResult = await this.tryLLMAttempt(input, 2, 'lean_retry', minimumBeatCount, attemptSummaries, leanResult.error, leanResult.rawResponse);
      if (retryResult.success && retryResult.data) {
        return { ...retryResult, metadata: { ...(retryResult.metadata ?? {}), encounterTelemetry: buildLeanTelemetry(2, retryResult.data) } };
      }
    }
    const retryTruncated = retryResult ? classifyPhaseError(new Error(retryResult.error || '')) === 'max_tokens' : false;
    if (leanTruncated || retryTruncated) {
      const decomposed = await runDecomposed(leanTruncated ? 2 : 3);
      if (decomposed) return decomposed;
    }

    // NO deterministic fallback (no-boilerplate mandate): template prose must
    // never ship. Report failure so the caller's regen loop retries the whole
    // build with this error fed back as guidance, and fails the episode at
    // generation time if regeneration exhausts — instead of shipping boilerplate
    // the final contract's template-collapse gate would abort the run for later.
    const finalError = decomposedError || retryResult?.error || leanResult.error || 'unknown error';
    console.error(`[EncounterArchitect] All LLM attempts failed for ${input.sceneId}; refusing template fallback. Last error: ${finalError}`);
    // P3: the attempt ladder (modes, sizes, per-attempt errors) must survive
    // the failure — it is the difference between "encounter failed" and the
    // 2026-07-06 diagnosis "the same oversized ask was repeated four times".
    return {
      success: false,
      error: `All LLM attempts failed: ${finalError}`,
      metadata: { attemptSummaries, phaseErrors: decomposedPhaseErrors },
    };
  }

  /**
   * Decomposed lean recovery (P1): author the encounter core (beats, clocks,
   * stakes — everything but storylets) in one bounded call, then author the
   * four aftermath storylets with the existing per-slot compact drafts, and
   * assemble deterministically. Every call in this ladder requests strictly
   * LESS output than the full-structure lean ask that truncated.
   */
  private async tryDecomposedLeanAttempt(
    input: EncounterArchitectInput,
    attempt: number,
    minimumBeatCount: number,
    attemptSummaries: Array<any>,
    errorSink: EncounterPhaseError[],
    playerRelationships?: Record<string, Relationship>,
    allNpcs?: NPCInfo[],
  ): Promise<EncounterStructure> {
    const attemptStartedAt = Date.now();
    console.log(`[EncounterArchitect] Decomposed lean recovery for ${input.sceneId}: encounter_core + ${PHASE4_STORYLET_SLOTS.length} storylet drafts (monotone truncation ladder)`);

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), EncounterArchitect.PER_CALL_TIMEOUT_MS);
    let core: EncounterStructure;
    let corePromptChars = 0;
    try {
      const corePrompt = this.buildReliablePrompt(input, { omitStorylets: true });
      corePromptChars = corePrompt.length;
      const response = await this.callLLM(
        [{ role: 'user', content: corePrompt }],
        1,
        { signal: ac.signal, jsonSchema: buildEncounterCoreJsonSchema() },
      );
      core = this.parseJSON<EncounterStructure>(response);
    } catch (err) {
      attemptSummaries.push({ attempt, mode: 'lean_decomposed', promptChars: corePromptChars, elapsedMs: Date.now() - attemptStartedAt, status: 'failed', error: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      clearTimeout(timer);
    }

    const beatCount = Array.isArray(core.beats) ? core.beats.length : 0;
    if (beatCount < minimumBeatCount) {
      const err = `Decomposed core returned only ${beatCount} beat(s); need at least ${minimumBeatCount}`;
      attemptSummaries.push({ attempt, mode: 'lean_decomposed', promptChars: corePromptChars, elapsedMs: Date.now() - attemptStartedAt, status: 'failed', error: err });
      throw new Error(err);
    }

    // Storylets via the per-slot compact drafts — already the compact floor.
    const npcInfos: NPCInfo[] = input.npcsInvolved.map(n => ({ id: n.id, name: n.name, role: n.role }));
    const brief = analyzeRelationshipDynamics(npcInfos, { current: playerRelationships || {} }, allNpcs);
    const phase4 = await this.runPhase4(input, brief, errorSink);
    (core as any).storylets = phase4;

    this.requireAuthoredStorylets(core.storylets, input, 'lean_decomposed');
    let structure = this.normalizeStructure(core, input);
    this.validateStructure(structure, input);
    attemptSummaries.push({ attempt, mode: 'lean_decomposed', promptChars: corePromptChars, elapsedMs: Date.now() - attemptStartedAt, status: 'success' });
    console.log(`[EncounterArchitect] Decomposed lean recovery succeeded for ${input.sceneId}: ${structure.beats.length} beats + 4 authored storylets`);
    return structure;
  }

  private async tryLLMAttempt(
    input: EncounterArchitectInput,
    attempt: number,
    mode: string,
    minimumBeatCount: number,
    attemptSummaries: Array<any>,
    lastError?: string,
    lastRawResponse?: string,
  ): Promise<AgentResponse<EncounterStructure> & { rawResponse?: string }> {
    const attemptStartedAt = Date.now();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), EncounterArchitect.PER_CALL_TIMEOUT_MS);

    try {
      const messages = mode === 'lean_retry' && lastError
        ? this.buildLeanRetryMessages(input, lastError, lastRawResponse)
        : this.buildLeanMessages(input);

      const promptChars = messages.reduce((total, m) => {
        if (typeof m.content === 'string') return total + m.content.length;
        if (Array.isArray(m.content)) return total + m.content.reduce((pt, p) => pt + ((p as any).text?.length || 0), 0);
        return total;
      }, 0);

      console.log(
        `[EncounterArchitect] Attempt ${attempt} starting for ${input.sceneId} `
        + `mode=${mode} promptChars=${promptChars} timeout=${EncounterArchitect.PER_CALL_TIMEOUT_MS}ms`
      );

      const response = await this.callLLM(messages, 1, { signal: ac.signal, jsonSchema: buildEncounterStructureJsonSchema() });
      const elapsedMs = Date.now() - attemptStartedAt;

      console.log(
        `[EncounterArchitect] Attempt ${attempt}: received response (${response.length} chars) after ${elapsedMs}ms`
      );

        let structure: EncounterStructure;
        try {
          structure = this.parseJSON<EncounterStructure>(response);
        } catch (parseError) {
          const parseMsg = parseError instanceof Error ? parseError.message : String(parseError);
        console.error(`[EncounterArchitect] Attempt ${attempt}: JSON parse failed (first 500 chars):`, response.substring(0, 500));
        attemptSummaries.push({ attempt, mode, promptChars, elapsedMs, responseChars: response.length, status: 'retrying', error: `JSON parse error: ${parseMsg}` });
        return { success: false, error: `JSON parse error: ${parseMsg}`, rawResponse: response };
      }

        const beatCount = Array.isArray(structure.beats) ? structure.beats.length : 0;
      console.log(`[EncounterArchitect] Attempt ${attempt}: Parsed ${beatCount} beats, keys: ${Object.keys(structure).join(', ')}`);

      if (beatCount < minimumBeatCount) {
        const err = `Only ${beatCount} beat(s), need at least ${minimumBeatCount}`;
        console.warn(`[EncounterArchitect] Attempt ${attempt}: ${err}`);
        attemptSummaries.push({ attempt, mode, promptChars, elapsedMs, responseChars: response.length, status: 'retrying', error: err });
        return { success: false, error: err, rawResponse: response };
      }

        this.requireAuthoredStorylets(structure.storylets, input, mode);
        structure = this.normalizeStructure(structure, input);
        this.validateStructure(structure, input);

      attemptSummaries.push({ attempt, mode, promptChars, elapsedMs, responseChars: response.length, status: 'success' });
      console.log(`[EncounterArchitect] Attempt ${attempt} succeeded: ${structure.beats.length} beats, ${Object.keys(structure.storylets || {}).length} storylets`);

      return { success: true, data: structure, rawResponse: response };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
      const isAbort = error instanceof Error && error.name === 'AbortError';
      const elapsedMs = Date.now() - attemptStartedAt;
      console.error(`[EncounterArchitect] Attempt ${attempt} ${isAbort ? 'timed out' : 'failed'} after ${elapsedMs}ms: ${errorMsg}`);
      attemptSummaries.push({ attempt, mode, promptChars: 0, elapsedMs, status: 'retrying', error: isAbort ? `Timed out after ${EncounterArchitect.PER_CALL_TIMEOUT_MS}ms` : errorMsg });
      return { success: false, error: errorMsg };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Build lean prompt messages — focused on creative content only.
   * normalizeStructure fills everything else (visual contracts, tension curves, NPC states, etc).
   */
  private buildLeanMessages(input: EncounterArchitectInput): AgentMessage[] {
    return [{ role: 'user', content: this.buildReliablePrompt(input) }];
  }

  /**
   * Build lean prompt with error feedback from a prior failed attempt.
   */
  private buildLeanRetryMessages(input: EncounterArchitectInput, lastError: string, lastRawResponse?: string): AgentMessage[] {
    const minimumBeatCount = this.getMinimumRequiredBeatCount(input);
    const feedback = `Your previous response had a problem: ${lastError}

Please try again. Key rules:
- "beats" array MUST have at least ${minimumBeatCount} beat objects
- Each beat MUST have at least 3 choices (aggressive, cautious, clever)
- Each choice MUST have success/complicated/failure outcomes
- "storylets" MUST include authored victory, partialVictory, defeat, and escape storylets
- Return ONLY valid JSON — no markdown, no prose
- Beat 2 choices must have isTerminal: true and encounterOutcome on their outcomes`;

      return [
      { role: 'user', content: this.buildReliablePrompt(input) },
        { role: 'assistant', content: lastRawResponse?.substring(0, 200) || '(previous attempt failed)' },
      { role: 'user', content: feedback },
    ];
  }

  /**
   * Lean, reliable prompt that asks the LLM only for creative content.
   * Everything structural (visual contracts, tension curves, NPC states, env elements,
   * escalation triggers, information visibility, pixar fields, metadata) is filled by
   * normalizeStructure, so we don't burden the prompt with it.
   *
   * Uses flat nextBeatId linking (converted to tree by normalizeStructure).
   * Expected output: ~2-3K tokens vs ~10-15K for the full prompt.
   */
  private buildReliablePrompt(input: EncounterArchitectInput, options: { omitStorylets?: boolean } = {}): string {
    const protagonist = input.protagonistInfo.name || 'the protagonist';
    const omitStorylets = options.omitStorylets === true;
    const npcsList = input.npcsInvolved
      .map(npc => `- ${npc.name} (${npc.id}, ${npc.pronouns}): ${npc.role} — ${npc.description}${npc.voiceNotes ? `\n  Voice: ${npc.voiceNotes}` : ''}`)
      .join('\n');

    const skill1 = input.availableSkills[0]?.name || 'athletics';
    const skill2 = input.availableSkills[1]?.name || 'perception';
    const skill3 = input.availableSkills[2]?.name || 'persuasion';
    const skillsList = input.availableSkills.slice(0, 6)
      .map(s => `${s.name} (${s.attribute})`)
      .join(', ');

    const beatPlan = (input.encounterBeatPlan && input.encounterBeatPlan.length > 0)
      ? input.encounterBeatPlan.map((b, i) => `  ${i + 1}. ${b}`).join('\n')
      : '  1. Opening pressure\n  2. Crisis and resolution';
    const styleFocus = this.describeEncounterStyleFocus(input.encounterStyle, input.encounterType);

    const priorCtx = input.priorStateContext ? `
## Prior Story Context (reference these in your narrative)
${(() => {
  const already = input.priorStateContext!.relevantFlags.filter(f => f.alreadySet);
  const future = input.priorStateContext!.relevantFlags.filter(f => !f.alreadySet);
  let out = '';
  if (already.length > 0) out += `Flags already set (ok for conditions): ${already.map(f => f.name).join(', ')}`;
  if (future.length > 0) out += `${out ? '\n' : ''}Flags set later (DO NOT use in conditions): ${future.map(f => f.name).join(', ')}`;
  return out;
})()}
${input.priorStateContext.relevantRelationships.length > 0 ? `Relationships (max achievable shown — do NOT condition on values above max): ${input.priorStateContext.relevantRelationships.map(r => `${r.npcName} ${r.dimension} ${r.operator} ${r.threshold} [max:${r.currentMaxValue ?? '?'}]`).join(', ')}` : ''}
${input.priorStateContext.significantChoices.length > 0 ? `Prior choices: ${input.priorStateContext.significantChoices.join('; ')}` : ''}` : '';

    return `Generate a ${input.encounterType} encounter for this scene. Return ONLY valid JSON — no markdown, no prose.

## Scene
- ID: ${input.sceneId}
- Name: ${input.sceneName}
- Description: ${input.sceneDescription}
- Mood: ${input.sceneMood}
- Type: ${input.encounterType} | Style: ${input.encounterStyle || 'auto'}
- Difficulty: ${input.difficulty}
- Stakes: ${input.encounterStakes || 'Keep stakes personal to the protagonist'}
${this.formatEncounterStoryCircleTarget(input)}
- Skills: ${skillsList}
- Beat Plan:
${beatPlan}
${this.buildAuthoredAnchorSection(input)}

## Story: ${input.storyContext.title} (${input.storyContext.genre}, ${input.storyContext.tone})
${input.storyContext.userPrompt ? `User instructions: ${input.storyContext.userPrompt}` : ''}

## Genre-Aware Jeopardy
${buildGenreAwareJeopardyGuidance(input.storyContext.genre)}

## Protagonist: ${protagonist} (${input.protagonistInfo.pronouns})

## CRITICAL: Protagonist pronouns & POV (ABSOLUTE)
- The protagonist ${protagonist} uses **${input.protagonistInfo.pronouns}** pronouns. NEVER use the opposite gender's pronouns for ${protagonist}.
  ${input.protagonistInfo.pronouns === 'she/her'
    ? `Correct: she/her/hers/herself. WRONG: he/him/his/himself.`
    : input.protagonistInfo.pronouns === 'he/him'
      ? `Correct: he/him/his/himself. WRONG: she/her/hers/herself.`
      : `Use they/them/their/themselves (singular).`}
- WRITE THE PROTAGONIST IN SECOND PERSON ("you", "your") throughout — this is the house POV and removes pronoun ambiguity entirely. Do NOT narrate the protagonist in the third person by name + pronoun (write "you hold his gaze", never "${protagonist} holds his gaze"). Reserve third-person + a concrete pronoun for NPCs only.
- Use each NPC's exact name and their listed pronouns; never swap a character's gender.
- When the protagonist and an NPC share the scene, use NAMES (not bare pronouns) to keep references unambiguous.

## NPCs
${npcsList || 'None'}

## Connections
- Victory → ${input.victoryNextSceneId || 'next scene'}
- Defeat → ${input.defeatNextSceneId || 'next scene'}
${priorCtx}
${ENCOUNTER_PROSE_DISCIPLINE}

## TEXT RULES
- Use the protagonist's actual name, concrete pronouns, or you/your; never emit template variables.
- The opening setupText MUST anchor the encounter POV to the protagonist before focusing on NPCs, setting, or threat.
- Prefer the protagonist's actual name as the subject for concrete protagonist actions; use you/your only for direct reader-facing immediacy.
- NPCs use their actual names
- setupText: 30-50 words setting the situation
- narrativeText: 30-60 words showing THE RESULT of the action (not the action itself)
- Each beat's choices must cover aggressive, cautious, and clever approaches
- This is storyboard-driven, not combat-only. For this encounter emphasize: ${styleFocus}
- Every encounter must put something serious at risk in genre-appropriate form: body, safety, reputation, trust, evidence, resources, love, moral standing, identity, or future leverage
- Choices must change at least one tactical state: position, leverage, information, exposure, relationship pressure, resource state, threat clock, goal clock, cost domain, or later storylet
- Include sequenceIntent on the storyboard and storylets. It is optional for legacy data compatibility but required-by-process for new output so storyboard panels read as one cinematic sequence with a narrative objective, visual thread, turning point, and aftermath state.
- Keep mechanics fiction-first. Preserve existing clock feedback, but do not add visible stats, dice, numbers, panel markers, or extra meters

## JSON STRUCTURE (flat with nextBeatId — the canonical routing shape)

{
  "sceneId": "${input.sceneId}",
  "encounterType": "${input.encounterType}",
  "encounterStyle": "${input.encounterStyle || 'auto'}",
  "storyboard": {
    "spine": [
      {
        "id": "${input.sceneId}-storyboard-establish",
        "role": "establish",
        "title": "Establish",
        "purpose": "Set the visual situation and stakes",
        "visualMoment": "single-panel image description",
        "tacticalFunction": "what state this frame creates or clarifies",
        "emotionalState": "what the player should read emotionally",
        "continuityState": {
          "characterPositions": { "protagonist": "where they are", "npc-id": "where they are" },
          "relationshipDistance": "physical/emotional distance",
          "propsInPlay": ["important prop/tool/clue"],
          "environmentChanges": [],
          "lighting": "scene lighting"
        },
        "decisionWindow": false
      },
      {
        "id": "${input.sceneId}-storyboard-commit",
        "role": "commit",
        "title": "Commit",
        "purpose": "First meaningful player decision",
        "visualMoment": "single-panel image description",
        "tacticalFunction": "choice can alter position/leverage/information/exposure/relationship pressure/clocks/cost",
        "emotionalState": "tense",
        "continuityState": { "relationshipDistance": "current distance or leverage" },
        "decisionWindow": true,
        "allowedApproaches": ["aggressive", "cautious", "clever"]
      }
    ],
    "sequenceIntent": {
      "objective": "What this encounter sequence is trying to accomplish",
      "activity": "The concrete visible encounter activity",
      "obstacle": "What resists or complicates the objective",
      "startState": "How the encounter begins visually",
      "turningPoint": "The reversal, decisive move, or pressure shift",
      "endState": "What has changed by the aftermath",
      "visualThread": "Recurring prop, distance, blocking, cost, clue, wound, or motif",
      "mechanicThread": "Optional fiction-first hook such as encounter clock, leverage, cost, trust, clue, danger, or resource"
    },
    "styleNotes": "Use 7-9 frames total across establish, pressureReveal, commit, exchange, reversal, opening, decisiveMove, fallout, aftermath. Emphasize ${styleFocus}.",
    "convergencePlan": "Outcome variants alter the next panel and mechanics, then converge back to the cinematic spine when appropriate.",
    "mechanicsVisibility": "current_clocks_only"
  },
  "payoffContext": {
    "consumedFlags": [],
    "relationshipPayoffs": [],
    "skillPayoffs": [],
    "aftermathEchoes": []
  },
  "goalClock": { "name": "string", "segments": 6, "description": "string" },
  "threatClock": { "name": "string", "segments": 4, "description": "string" },
  "stakes": { "victory": "string", "defeat": "string" },
  "beats": [
    {
      "id": "beat-1",
      "phase": "setup",
      "storyboardFrameId": "${input.sceneId}-storyboard-commit",
      "storyboardRole": "commit",
      "name": "string",
      "description": "string",
      "setupText": "30-50 words: the situation the player faces",
      "choices": [
        {
          "id": "b1-c1",
          "text": "Bold action (5-10 words)",
          "approach": "aggressive",
          "impliedApproach": "aggressive",
          "primarySkill": "${skill1}",
          "outcomes": {
            "success": { "tier": "success", "narrativeText": "string", "goalTicks": 2, "threatTicks": 0, "nextBeatId": "beat-2", "tacticalEffect": "stronger position/leverage/info/etc." },
            "complicated": { "tier": "complicated", "narrativeText": "string", "goalTicks": 1, "threatTicks": 1, "nextBeatId": "beat-2", "tacticalEffect": "progress plus visible cost/tradeoff" },
            "failure": { "tier": "failure", "narrativeText": "string", "goalTicks": 0, "threatTicks": 2, "nextBeatId": "beat-2", "tacticalEffect": "worse position/exposure/distance/etc." }
          }
        },
        {
          "id": "b1-c2",
          "text": "Careful approach (5-10 words)",
          "approach": "cautious",
          "impliedApproach": "cautious",
          "primarySkill": "${skill2}",
          "outcomes": {
            "success": { "tier": "success", "narrativeText": "string", "goalTicks": 2, "threatTicks": 0, "nextBeatId": "beat-2" },
            "complicated": { "tier": "complicated", "narrativeText": "string", "goalTicks": 1, "threatTicks": 1, "nextBeatId": "beat-2" },
            "failure": { "tier": "failure", "narrativeText": "string", "goalTicks": 0, "threatTicks": 2, "nextBeatId": "beat-2" }
          }
        },
        {
          "id": "b1-c3",
          "text": "Clever trick (5-10 words)",
          "approach": "clever",
          "impliedApproach": "clever",
          "primarySkill": "${skill3}",
          "outcomes": {
            "success": { "tier": "success", "narrativeText": "string", "goalTicks": 2, "threatTicks": 0, "nextBeatId": "beat-2" },
            "complicated": { "tier": "complicated", "narrativeText": "string", "goalTicks": 1, "threatTicks": 1, "nextBeatId": "beat-2" },
            "failure": { "tier": "failure", "narrativeText": "string", "goalTicks": 0, "threatTicks": 2, "nextBeatId": "beat-2" }
          }
        }
      ]
    },
    {
      "id": "beat-2",
      "phase": "resolution",
      "name": "string",
      "description": "string",
      "setupText": "30-50 words: the climactic moment",
      "isTerminal": true,
      "choices": [
        {
          "id": "b2-c1",
          "text": "Go for victory (5-10 words)",
          "approach": "bold",
          "primarySkill": "${skill1}",
          "outcomes": {
            "success": { "tier": "success", "narrativeText": "string", "goalTicks": 3, "threatTicks": 0, "isTerminal": true, "encounterOutcome": "victory" },
            "complicated": { "tier": "complicated", "narrativeText": "string", "goalTicks": 2, "threatTicks": 1, "isTerminal": true, "encounterOutcome": "partialVictory", "cost": { "immediateEffect": "1 sentence: the concrete price paid right now", "visibleComplication": "1 sentence: the visible complication that follows the protagonist out" } },
            "failure": { "tier": "failure", "narrativeText": "string", "goalTicks": 0, "threatTicks": 3, "isTerminal": true, "encounterOutcome": "defeat" }
          }
        },
        {
          "id": "b2-c2",
          "text": "Hold your ground (5-10 words)",
          "approach": "cautious",
          "primarySkill": "${skill2}",
          "outcomes": {
            "success": { "tier": "success", "narrativeText": "string", "goalTicks": 2, "threatTicks": 0, "isTerminal": true, "encounterOutcome": "victory" },
            "complicated": { "tier": "complicated", "narrativeText": "string", "goalTicks": 1, "threatTicks": 1, "isTerminal": true, "encounterOutcome": "escape" },
            "failure": { "tier": "failure", "narrativeText": "string", "goalTicks": 0, "threatTicks": 2, "isTerminal": true, "encounterOutcome": "defeat" }
          }
        },
        {
          "id": "b2-c3",
          "text": "Find another way (5-10 words)",
          "approach": "clever",
          "primarySkill": "${skill3}",
          "outcomes": {
            "success": { "tier": "success", "narrativeText": "string", "goalTicks": 2, "threatTicks": 0, "isTerminal": true, "encounterOutcome": "victory" },
            "complicated": { "tier": "complicated", "narrativeText": "string", "goalTicks": 1, "threatTicks": 1, "isTerminal": true, "encounterOutcome": "escape" },
            "failure": { "tier": "failure", "narrativeText": "string", "goalTicks": 0, "threatTicks": 2, "isTerminal": true, "encounterOutcome": "defeat" }
          }
        }
      ]
    }
  ],
  "startingBeatId": "beat-1"${omitStorylets ? '' : `,
  "storylets": {
    "victory": {
      "id": "${input.sceneId}-sv",
      "name": "Victory",
      "triggerOutcome": "victory",
      "tone": "triumphant",
      "narrativeFunction": "string",
      "sequenceIntent": { "objective": "Aftermath objective", "activity": "victory aftermath sequence", "obstacle": "What still complicates the win", "startState": "Outcome lands", "turningPoint": "Growth or cost becomes visible", "endState": "Changed state going forward", "visualThread": "Visible consequence carried across panels" },
      "beats": [{ "id": "${input.sceneId}-sv-1", "text": "1-2 sentences of victory aftermath", "isTerminal": true }],
      "startingBeatId": "${input.sceneId}-sv-1",
      "consequences": [],
      "nextSceneId": "${input.victoryNextSceneId || 'next-scene'}"
    },
    "defeat": {
      "id": "${input.sceneId}-sd",
      "name": "Defeat",
      "triggerOutcome": "defeat",
      "tone": "somber",
      "narrativeFunction": "string",
      "beats": [{ "id": "${input.sceneId}-sd-1", "text": "1-2 sentences of defeat aftermath", "isTerminal": true }],
      "startingBeatId": "${input.sceneId}-sd-1",
      "consequences": [],
      "nextSceneId": "${input.defeatNextSceneId || 'next-scene'}"
    },
    "partialVictory": {
      "id": "${input.sceneId}-sp",
      "name": "Costly Victory",
      "triggerOutcome": "partialVictory",
      "tone": "bittersweet",
      "narrativeFunction": "string",
      "beats": [
        { "id": "${input.sceneId}-sp-1", "text": "1-2 sentences showing relief with one concrete visible complication" },
        { "id": "${input.sceneId}-sp-2", "text": "1 sentence showing how that cost follows forward", "isTerminal": true }
      ],
      "startingBeatId": "${input.sceneId}-sp-1",
      "consequences": [],
      "nextSceneId": "${input.victoryNextSceneId || 'next-scene'}"
    },
    "escape": {
      "id": "${input.sceneId}-se",
      "name": "Escape",
      "triggerOutcome": "escape",
      "tone": "relieved",
      "narrativeFunction": "string",
      "beats": [{ "id": "${input.sceneId}-se-1", "text": "1-2 sentences of escape aftermath", "isTerminal": true }],
      "startingBeatId": "${input.sceneId}-se-1",
      "consequences": [],
      "nextSceneId": "${input.victoryNextSceneId || 'next-scene'}"
    }
  }`}
}

RULES:
1. Replace ALL "string" placeholders with actual narrative content specific to this scene and these characters
2. narrativeText = THE RESULT of the action ("Your blade finds his shoulder" not "You attack")
3. setupText = the situation BEFORE the choice (vivid, 30-50 words)
4. Return ONLY the JSON object — no markdown, no backticks, no explanation
5. "beats" array MUST have at least ${this.getMinimumRequiredBeatCount(input)} beats
6. Each outcome on beat-2 MUST have "isTerminal": true and an "encounterOutcome"
7. Storyboard spine should have 7-9 frames; if you only provide 2 sample frames above, still output the full spine
8. Prior story context must be spent as payoffContext plus at least one setupTextVariant, condition, statBonus, disposition shift, cost, or storylet echo when available${omitStorylets ? `
9. Do NOT include a "storylets" field — the aftermath storylets are authored in separate calls. Keep every string tight; this call must stay within a strict output budget` : ''}`;
  }

  /**
   * Deterministic fallback: builds a minimal but playable encounter from the
   * input data alone, with no LLM call. normalizeStructure fills all
   * structural fields (visual contracts, storylets, NPC states, etc).
   *
   * NOT CALLED IN PRODUCTION (no-boilerplate mandate, 2026-06-11): every path
   * that shipped this template prose as a "successful" encounter was removed —
   * generation now fails so the caller regenerates with feedback. Retained as
   * the reference corpus for TEMPLATE_SIGNATURES (the sync test builds it to
   * prove the detector matches the fallback prose verbatim).
   */
  private buildDeterministicFallback(input: EncounterArchitectInput): EncounterStructure {
    const protagonist = input.protagonistInfo.name || 'the protagonist';
    const objectPronoun = input.protagonistInfo.pronouns === 'he/him'
      ? 'him'
      : input.protagonistInfo.pronouns === 'she/her'
        ? 'her'
        : 'them';
    const npc = input.npcsInvolved[0];
    const npcName = npc?.name || 'the opponent';
    const skill1 = input.availableSkills[0]?.name || 'athletics';
    const skill2 = input.availableSkills[1]?.name || 'perception';
    const skill3 = input.availableSkills[2]?.name || 'persuasion';
    const stakeText = input.encounterStakes || input.sceneDescription || 'The situation demands a response.';

    const beats: EncounterBeat[] = [
      {
        id: 'beat-1',
        phase: 'setup' as EscalationPhase,
        name: 'The Confrontation',
        description: `${npcName} forces a decision.`,
        setupText: `The moment arrives. ${npcName} stands before ${protagonist}, and there is no avoiding what comes next. ${stakeText.substring(0, 80)}`,
        choices: [
          {
            id: 'b1-c1',
            text: `Confront ${npcName} directly`,
            approach: 'aggressive' as EncounterApproach,
            impliedApproach: 'aggressive' as EncounterApproach,
            primarySkill: skill1,
            outcomes: {
              success: { tier: 'success' as const, narrativeText: `${protagonist} presses forward with conviction. ${npcName} gives ground.`, goalTicks: 2, threatTicks: 0, nextBeatId: 'beat-2' },
              complicated: { tier: 'complicated' as const, narrativeText: `The confrontation is messy — ${protagonist} holds firm but ${npcName} doesn't back down easily.`, goalTicks: 1, threatTicks: 1, nextBeatId: 'beat-2' },
              failure: { tier: 'failure' as const, narrativeText: `${npcName} turns ${protagonist}'s aggression against ${objectPronoun}. The situation worsens.`, goalTicks: 0, threatTicks: 2, nextBeatId: 'beat-2' },
            },
          },
          {
            id: 'b1-c2',
            text: `Assess the situation carefully`,
            approach: 'cautious' as EncounterApproach,
            impliedApproach: 'cautious' as EncounterApproach,
            primarySkill: skill2,
            outcomes: {
              success: { tier: 'success' as const, narrativeText: `${protagonist}'s patience pays off — a weakness reveals itself.`, goalTicks: 2, threatTicks: 0, nextBeatId: 'beat-2' },
              complicated: { tier: 'complicated' as const, narrativeText: `${protagonist} learns something useful, but the delay has a cost.`, goalTicks: 1, threatTicks: 1, nextBeatId: 'beat-2' },
              failure: { tier: 'failure' as const, narrativeText: `Hesitation proves costly. ${npcName} seizes the initiative.`, goalTicks: 0, threatTicks: 2, nextBeatId: 'beat-2' },
            },
          },
          {
            id: 'b1-c3',
            text: `Try an unexpected approach`,
            approach: 'clever' as EncounterApproach,
            impliedApproach: 'clever' as EncounterApproach,
            primarySkill: skill3,
            outcomes: {
              success: { tier: 'success' as const, narrativeText: `The gambit works — ${npcName} is caught completely off guard.`, goalTicks: 2, threatTicks: 0, nextBeatId: 'beat-2' },
              complicated: { tier: 'complicated' as const, narrativeText: `It half-works. ${npcName} is thrown off balance, but recovers quickly.`, goalTicks: 1, threatTicks: 1, nextBeatId: 'beat-2' },
              failure: { tier: 'failure' as const, narrativeText: `${npcName} sees through it immediately. ${protagonist} is exposed.`, goalTicks: 0, threatTicks: 2, nextBeatId: 'beat-2' },
            },
          },
        ],
      } as EncounterBeat,
      {
        id: 'beat-2',
        phase: 'resolution' as EscalationPhase,
        name: 'The Decisive Moment',
        description: 'Everything comes to a head.',
        setupText: `This is the moment that decides everything. ${npcName} and ${protagonist} face the final test.`,
        isTerminal: true,
        choices: [
          {
            id: 'b2-c1',
            text: `Push for a decisive outcome`,
            approach: 'bold' as EncounterApproach,
            primarySkill: skill1,
            outcomes: {
              success: { tier: 'success' as const, narrativeText: `${protagonist} seizes the moment. The outcome is decisive and clear.`, goalTicks: 3, threatTicks: 0, isTerminal: true, encounterOutcome: 'victory' as EncounterOutcome },
              complicated: { tier: 'complicated' as const, narrativeText: `Victory, but not clean. The cost will linger.`, goalTicks: 2, threatTicks: 1, isTerminal: true, encounterOutcome: 'partialVictory' as EncounterOutcome },
              failure: { tier: 'failure' as const, narrativeText: `The gamble doesn't pay off. ${protagonist} comes up short.`, goalTicks: 0, threatTicks: 3, isTerminal: true, encounterOutcome: 'defeat' as EncounterOutcome },
            },
          },
          {
            id: 'b2-c2',
            text: `Stand firm and endure`,
            approach: 'cautious' as EncounterApproach,
            primarySkill: skill2,
            outcomes: {
              success: { tier: 'success' as const, narrativeText: `${protagonist}'s resolve outlasts the challenge.`, goalTicks: 2, threatTicks: 0, isTerminal: true, encounterOutcome: 'victory' as EncounterOutcome },
              complicated: { tier: 'complicated' as const, narrativeText: `${protagonist} survives, barely. Retreat is the wise option.`, goalTicks: 1, threatTicks: 1, isTerminal: true, encounterOutcome: 'escape' as EncounterOutcome },
              failure: { tier: 'failure' as const, narrativeText: `The pressure is too much. ${protagonist} is overwhelmed.`, goalTicks: 0, threatTicks: 2, isTerminal: true, encounterOutcome: 'defeat' as EncounterOutcome },
            },
          },
          {
            id: 'b2-c3',
            text: `Find a way out on your terms`,
            approach: 'clever' as EncounterApproach,
            primarySkill: skill3,
            outcomes: {
              success: { tier: 'success' as const, narrativeText: `An unexpected solution presents itself. ${protagonist} takes it.`, goalTicks: 2, threatTicks: 0, isTerminal: true, encounterOutcome: 'victory' as EncounterOutcome },
              complicated: { tier: 'complicated' as const, narrativeText: `It works, mostly. ${protagonist} escapes, but not cleanly.`, goalTicks: 1, threatTicks: 1, isTerminal: true, encounterOutcome: 'escape' as EncounterOutcome },
              failure: { tier: 'failure' as const, narrativeText: `There is no clever way out. ${protagonist} faces the consequences.`, goalTicks: 0, threatTicks: 2, isTerminal: true, encounterOutcome: 'defeat' as EncounterOutcome },
            },
          },
        ],
      } as EncounterBeat,
    ];

    // A sustained set piece must ship ≥3 top-level beats (validateStructure
    // enforces the floor), so the fallback splices an escalation beat between
    // the confrontation and the decisive moment — otherwise the fallback
    // itself fails validation and the whole episode aborts (endsong-g13 ep3).
    if (this.isSustainedSetPieceInput(input)) {
      const escalationBeat: EncounterBeat = {
        id: 'beat-escalation',
        phase: 'rising' as EscalationPhase,
        name: 'The Escalation',
        description: 'The pressure mounts — the first exchange settled nothing.',
        setupText: `The first exchange settles nothing. ${npcName} comes again, harder, and ${protagonist} must hold the line as the situation escalates around ${objectPronoun}.`,
        choices: [
          {
            id: 'be-c1',
            text: `Meet the renewed assault head-on`,
            approach: 'aggressive' as EncounterApproach,
            impliedApproach: 'aggressive' as EncounterApproach,
            primarySkill: skill1,
            outcomes: {
              success: { tier: 'success' as const, narrativeText: `${protagonist} breaks the momentum of the assault. ${npcName} falters.`, goalTicks: 2, threatTicks: 0, nextBeatId: 'beat-2' },
              complicated: { tier: 'complicated' as const, narrativeText: `${protagonist} holds, but the effort costs ${objectPronoun} dearly.`, goalTicks: 1, threatTicks: 1, nextBeatId: 'beat-2' },
              failure: { tier: 'failure' as const, narrativeText: `The line buckles. ${npcName} presses the advantage.`, goalTicks: 0, threatTicks: 2, nextBeatId: 'beat-2' },
            },
          },
          {
            id: 'be-c2',
            text: `Fall back and regroup`,
            approach: 'cautious' as EncounterApproach,
            impliedApproach: 'cautious' as EncounterApproach,
            primarySkill: skill2,
            outcomes: {
              success: { tier: 'success' as const, narrativeText: `${protagonist} trades ground for time and finds a stronger position.`, goalTicks: 2, threatTicks: 0, nextBeatId: 'beat-2' },
              complicated: { tier: 'complicated' as const, narrativeText: `The retreat works, but something is left behind that ${protagonist} will miss.`, goalTicks: 1, threatTicks: 1, nextBeatId: 'beat-2' },
              failure: { tier: 'failure' as const, narrativeText: `The withdrawal turns ragged. ${npcName} cuts off the path back.`, goalTicks: 0, threatTicks: 2, nextBeatId: 'beat-2' },
            },
          },
          {
            id: 'be-c3',
            text: `Turn the chaos to your advantage`,
            approach: 'clever' as EncounterApproach,
            impliedApproach: 'clever' as EncounterApproach,
            primarySkill: skill3,
            outcomes: {
              success: { tier: 'success' as const, narrativeText: `${protagonist} uses the confusion to shift the fight onto new terms.`, goalTicks: 2, threatTicks: 0, nextBeatId: 'beat-2' },
              complicated: { tier: 'complicated' as const, narrativeText: `The improvisation buys room to breathe — and draws unwanted attention.`, goalTicks: 1, threatTicks: 1, nextBeatId: 'beat-2' },
              failure: { tier: 'failure' as const, narrativeText: `The gambit collapses. ${npcName} was ready for it.`, goalTicks: 0, threatTicks: 2, nextBeatId: 'beat-2' },
            },
          },
        ],
      } as EncounterBeat;

      // Route the opening beat into the escalation instead of straight to the
      // resolution, then splice the escalation in between.
      for (const choice of beats[0].choices || []) {
        for (const tier of ['success', 'complicated', 'failure'] as const) {
          const outcome = choice.outcomes?.[tier];
          if (outcome?.nextBeatId === 'beat-2') {
            outcome.nextBeatId = 'beat-escalation';
          }
        }
      }
      beats.splice(1, 0, escalationBeat);
    }

    return {
      sceneId: input.sceneId,
      encounterType: input.encounterType,
      encounterStyle: input.encounterStyle,
      goalClock: {
        name: 'Objective',
        segments: 6,
        description: input.encounterStakes || 'Achieve the encounter objective',
      },
      threatClock: {
        name: 'Danger',
        segments: 4,
        description: 'Escalating threat',
      },
      stakes: {
        victory: input.encounterStakes || 'Overcome the challenge',
        defeat: 'Suffer the consequences',
      },
      beats,
      startingBeatId: 'beat-1',
    } as EncounterStructure;
  }

  private normalizeStructure(structure: EncounterStructure, input: EncounterArchitectInput): EncounterStructure {
    // Ensure sceneId
    if (!structure.sceneId) {
      structure.sceneId = input.sceneId;
    }

    // Ensure encounterType
    if (!structure.encounterType) {
      structure.encounterType = input.encounterType;
    }
    if (!structure.encounterStyle) {
      structure.encounterStyle = input.encounterStyle;
    }

    // Ensure clocks exist
    if (!structure.goalClock) {
      structure.goalClock = {
        name: 'Objective',
        segments: 6,
        description: 'Progress toward completing the encounter'
      };
    }
    if (!structure.threatClock) {
      structure.threatClock = {
        name: 'Danger',
        segments: 4,
        description: 'Escalating threat level'
      };
    }

    // Ensure stakes
    if (!structure.stakes) {
      structure.stakes = {
        victory: 'Complete the objective',
        defeat: 'Face the consequences'
      };
    }

    // Ensure beats is an array (normalize type, don't fabricate content)
    if (!structure.beats) {
      structure.beats = [];
    } else if (!Array.isArray(structure.beats)) {
      structure.beats = [structure.beats as unknown as EncounterBeat];
    }

    // F2: a FLAT encounter with fewer than 2 beats is unplayable and fails the
    // final story contract. Rather than only logging and hoping the retry loop
    // fixes it (it doesn't always), synthesize the missing beat(s) from the
    // known-good deterministic fallback so the encounter is always playable.
    // See docs/PROJECT_AUDIT_2026-05-28.md.
    //
    // TREE-FORMAT GUARD: a phased encounter is a single top-level beat whose
    // outcomes carry embedded `nextSituation` branches — that is fully playable
    // with one beat, so the <2 check must NOT fire for it. It previously did,
    // synthesizing a deterministic-fallback (template) resolution beat and
    // routing every branch-less non-terminal outcome (e.g. a phase-3 conditional
    // choice) into that template — shipping generic boilerplate as a branch.
    const isTreeFormatEncounter = (structure.beats || []).some(b =>
      (b.choices || []).some(c =>
        c.outcomes && (['success', 'complicated', 'failure'] as const).some(t => (c.outcomes as any)?.[t]?.nextSituation)
      )
    );
    if (structure.beats.length < 2 && !isTreeFormatEncounter) {
      // No-boilerplate mandate: do NOT synthesize beats from the deterministic
      // fallback (the old F2 backstop spliced TEMPLATE_SIGNATURES prose straight
      // into the player path). A beat-starved flat encounter fails this ATTEMPT —
      // the throw is caught by the attempt/phase retry ladder, which re-authors
      // the encounter with this error fed back as guidance.
      throw new Error(
        `Flat encounter has only ${structure.beats.length} beat(s) after normalization (minimum 2); refusing template-beat synthesis — re-author with at least 2 beats.`
      );
    }

    // Normalize each beat
    for (let i = 0; i < structure.beats.length; i++) {
      const beat = structure.beats[i];
      if (!beat.id) {
        beat.id = `beat-${i + 1}`;
      }
      if (!beat.phase) {
        if (i === 0) beat.phase = 'setup';
        else if (i === structure.beats.length - 1) beat.phase = 'resolution';
        else if (i === Math.floor(structure.beats.length / 2)) beat.phase = 'peak';
        else beat.phase = 'rising';
      }
      if (!beat.name) {
        beat.name = `Beat ${i + 1}`;
      }
      if (!beat.description) {
        beat.description = '';
      }
      if (!beat.setupText || beat.setupText.trim().length === 0) {
        // Never ship an empty phase beat — that rendered as a blank "staged middle"
        // at runtime (gen-5 hollow-encounter defect). Prefer the authored beat
        // description; fall back to a phase-appropriate line so the spine reads as a
        // progression. This does NOT mask fidelity checks: EncounterAnchorContent
        // still requires the AUTHORED required-beat content to appear episode-wide,
        // so a generic fill cannot satisfy a missing signature/required beat.
        beat.setupText =
          (beat.description && beat.description.trim().length > 0
            ? beat.description.trim()
            : this.defaultBeatSetupText(beat.phase, structure));
      }
      
      // Add visual direction if missing
      if (!beat.visualDirection) {
        beat.visualDirection = this.getDefaultVisualDirection(beat.phase);
      }
      if (!beat.visualContract) {
        beat.visualContract = this.buildDefaultVisualContract(beat.setupText || beat.description, beat.phase);
      }
      const setupTextVariants = this.sanitizeSetupTextVariants((beat as any).setupTextVariants);
      if (setupTextVariants?.length) {
        (beat as any).setupTextVariants = setupTextVariants;
      } else {
        delete (beat as any).setupTextVariants;
      }

      const ensureChoiceOutcomes = (choices?: EmbeddedEncounterChoice[] | EncounterChoice[], phase: EscalationPhase = beat.phase) => {
        for (const choice of choices || []) {
          this.sanitizeChoiceConditions(choice);
          if (!choice.outcomes) {
            (choice as EmbeddedEncounterChoice).outcomes = {} as EmbeddedEncounterChoice['outcomes'];
          }

          for (const tier of ['success', 'complicated', 'failure'] as const) {
            const existing = choice.outcomes[tier];
            if (existing) continue;

            const defaults = this.buildDefaultOutcome(choice.text, tier, phase);
            choice.outcomes[tier] = defaults as typeof choice.outcomes[typeof tier];
            console.warn(
              `[EncounterArchitect] Synthesized missing ${tier} outcome for choice "${choice.id}" in ${structure.sceneId}/${beat.id}`
            );
          }

          this.ensureEncounterChoiceFeedback(choice, choice.outcomes.complicated?.narrativeText || choice.outcomes.success?.narrativeText);

          for (const tier of ['success', 'complicated', 'failure'] as const) {
            const outcome = choice.outcomes[tier];
            if (outcome?.nextSituation) {
              ensureChoiceOutcomes(outcome.nextSituation.choices, 'rising');
            }
          }
        }
      };

      ensureChoiceOutcomes(beat.choices, beat.phase);

      // F1: snap any invented choice skills to the story's valid skills so they
      // satisfy the playable-encounter contract and resolve at runtime.
      const validSkillNames = (input.availableSkills || []).map((s) => s?.name).filter(Boolean) as string[];
      const normalizeChoiceSkills = (choices?: EmbeddedEncounterChoice[] | EncounterChoice[]) => {
        for (const choice of choices || []) {
          if (choice.primarySkill !== undefined && choice.primarySkill !== null) {
            choice.primarySkill = snapEncounterSkill(choice.primarySkill, validSkillNames);
          }
          for (const tier of ['success', 'complicated', 'failure'] as const) {
            const outcome = choice.outcomes?.[tier];
            if (outcome?.nextSituation) normalizeChoiceSkills(outcome.nextSituation.choices);
          }
        }
      };
      normalizeChoiceSkills(beat.choices);

      const ensureChoiceVisualContracts = (choices?: EmbeddedEncounterChoice[] | EncounterChoice[], phase: EscalationPhase = beat.phase) => {
        for (const choice of choices || []) {
          if (!choice.outcomes) continue;
          for (const tier of ['success', 'complicated', 'failure'] as const) {
            const outcome = choice.outcomes[tier];
            if (!outcome) continue;
            outcome.consequences = this.sanitizeStateChanges(
              outcome.consequences,
              this.buildEncounterOutcomeFlagName(structure.sceneId, outcome.encounterOutcome || tier),
            ) || [];
            if (outcome.cost?.consequences) {
              outcome.cost.consequences = this.sanitizeRuntimeConsequences(outcome.cost.consequences);
            }
            if (outcome.isTerminal && outcome.encounterOutcome === 'partialVictory' && !outcome.cost) {
              outcome.cost = this.buildDefaultEncounterCost(
                outcome.narrativeText,
                outcome.consequences,
                input.partialVictoryCost
              );
            }
            if (!outcome.visualContract) {
              outcome.visualContract = this.buildDefaultVisualContract(
                outcome.narrativeText,
                tier === 'success' ? 'peak' : tier === 'failure' ? 'resolution' : phase
              );
            }
            if (outcome.encounterOutcome === 'partialVictory' && outcome.cost && !outcome.visualContract.visibleCost) {
              outcome.visualContract.visibleCost = outcome.cost.visibleComplication;
            }
            if (outcome.nextSituation) {
              if (!outcome.nextSituation.visualContract) {
                outcome.nextSituation.visualContract = this.buildDefaultVisualContract(outcome.nextSituation.setupText, 'setup');
              }
              ensureChoiceVisualContracts(outcome.nextSituation.choices, 'rising');
            }
          }
        }
      };

      ensureChoiceVisualContracts(beat.choices, beat.phase);
    }

    const skillRebalance = rebalanceEncounterSkills(structure);
    if (skillRebalance.changed > 0) {
      console.log(
        `[EncounterArchitect] Rebalanced ${skillRebalance.changed} encounter skill slot(s) ` +
        `(top share ${(skillRebalance.topShareBefore * 100).toFixed(0)}% -> ${(skillRebalance.topShareAfter * 100).toFixed(0)}%)`
      );
    }

    // Ensure startingBeatId
    if (!structure.startingBeatId && structure.beats.length > 0) {
      structure.startingBeatId = structure.beats[0].id;
    }

    // Ensure tensionCurve is an array
    if (!structure.tensionCurve) {
      structure.tensionCurve = structure.beats.map((beat, i) => ({
        beatId: beat.id,
        tensionLevel: Math.min(i * 2 + 3, 10),
        description: `${beat.phase} tension`
      }));
    }

    this.requireAuthoredStorylets(structure.storylets, input, 'normalizeStructure');
    for (const storylet of Object.values(structure.storylets || {})) {
      if (!storylet) continue;
      storylet.consequences = this.sanitizeStateChanges(
        storylet.consequences,
        this.buildEncounterOutcomeFlagName(structure.sceneId, storylet.triggerOutcome || storylet.id || storylet.name),
      ) || [];
    }

    if (!structure.partialVictoryCost) {
      structure.partialVictoryCost = structure.storylets.partialVictory?.cost
        || this.buildDefaultEncounterCost(
          structure.storylets.partialVictory?.narrativeFunction
            || 'The objective is achieved, but the price is visible in the aftermath.',
          structure.storylets.partialVictory?.consequences,
          input.partialVictoryCost
        );
    }

    // Ensure environmental elements
    if (!structure.environmentalElements) {
      structure.environmentalElements = [];
    }

    // Ensure NPC states
    if (!structure.npcStates) {
      structure.npcStates = input.npcsInvolved.map(npc => ({
        npcId: npc.id,
        name: npc.name,
        initialDisposition: npc.role === 'enemy' ? 'confident' : 'wary',
        reactionToAggressive: `${npc.name} responds to aggression`,
        reactionToCautious: `${npc.name} observes carefully`,
        reactionToClever: `${npc.name} is caught off guard`,
        tells: [],
        dispositionShifts: []
      }));
    } else {
      // Validate each NPC state entry — LLM may omit fields
      structure.npcStates = structure.npcStates.map(npc => ({
        ...npc,
        npcId: npc.npcId ?? `npc-${Math.random().toString(36).slice(2, 8)}`,
        name: npc.name ?? 'Unknown',
        initialDisposition: npc.initialDisposition ?? 'wary',
        reactionToAggressive: npc.reactionToAggressive ?? `${npc.name ?? 'NPC'} responds to aggression`,
        reactionToCautious: npc.reactionToCautious ?? `${npc.name ?? 'NPC'} observes carefully`,
        reactionToClever: npc.reactionToClever ?? `${npc.name ?? 'NPC'} is caught off guard`,
        tells: npc.tells ?? [],
        dispositionShifts: npc.dispositionShifts ?? [],
      }));
    }

    // Ensure escalation triggers. The narrative text is STYLE-AWARE: a flat
    // "The situation becomes critical!" is a combat-template string that leaked into
    // romance/social encounters (gen-5 audit). Romance escalates by emotional
    // irreversibility, social by rupture, etc. — so the fallback now matches the
    // encounter's style instead of always sounding like a fight.
    if (!structure.escalationTriggers) {
      structure.escalationTriggers = [
        {
          id: 'threat-75',
          condition: { type: 'threat_threshold', value: 75 },
          effect: {
            narrativeText: this.defaultEscalationNarrative(structure.encounterStyle, structure.encounterType),
            threatBonus: 1
          }
        }
      ];
    }

    // Ensure information visibility
    if (!structure.informationVisibility) {
      structure.informationVisibility = {
        threatClockVisible: true,
        npcTellsRevealAt: 'encounter_50_percent',
        environmentElementsHidden: [],
        choiceOutcomesUnknown: false
      };
    }

    // Ensure metadata
    if (!structure.estimatedDuration) {
      structure.estimatedDuration = 'medium';
    }
    if (!structure.replayability) {
      structure.replayability = 'medium';
    }
    if (!structure.designNotes) {
      structure.designNotes = '';
    }

    // ONE routing shape (encounter unification W2, flipped after live
    // validation on bite-me_2026-07-03T14-10-21): the flat nextBeatId spine is
    // canonical. The rich prompt may still author nextSituation trees natively;
    // flatten them into the beat spine deterministically instead of changing
    // the prompt. No-op for already-flat (lean/sustained) output. The engine
    // plays flat natively and the depth guard repairs it natively; only the
    // reader's EncounterView keeps a tree traversal, as the legacy-load path
    // for previously published stories.
    this.flattenTreeToBeats(structure);

    const danglingRoutesRepaired = this.routeDanglingOutcomesToAuthoredStorylets(structure, input);
    if (danglingRoutesRepaired > 0) {
      console.warn(
        `[EncounterArchitect] Routed ${danglingRoutesRepaired} dangling encounter outcome(s) in ${structure.sceneId} ` +
        'to authored storylet aftermath.'
      );
    }

    if (!structure.payoffContext) {
      structure.payoffContext = this.buildDefaultPayoffContext(input);
    }
    if (!structure.storyboard?.spine?.length) {
      structure.storyboard = this.buildDefaultStoryboard(input, structure);
    } else if (!structure.storyboard.mechanicsVisibility) {
      structure.storyboard.mechanicsVisibility = 'current_clocks_only';
    }

    const spine = structure.storyboard?.spine || [];
    const decisionFrames = spine.filter(frame => frame.decisionWindow);
    const fallbackFrame = (index: number) => spine[index] || spine[Math.min(index, Math.max(0, spine.length - 1))];
    structure.beats.forEach((beat, index) => {
      const frame = decisionFrames[index] || fallbackFrame(index);
      if (frame) {
        beat.storyboardFrameId = beat.storyboardFrameId || frame.id;
        beat.storyboardRole = beat.storyboardRole || frame.role;
        beat.visualContract = {
          ...beat.visualContract,
          visualMoment: beat.visualContract?.visualMoment || frame.visualMoment,
          primaryAction: beat.visualContract?.primaryAction || frame.tacticalFunction,
          emotionalRead: beat.visualContract?.emotionalRead || frame.emotionalState,
          relationshipDynamic: beat.visualContract?.relationshipDynamic || frame.continuityState.relationshipDistance,
          visualNarrative: beat.visualContract?.visualNarrative || frame.purpose,
        };
      }
    });

    const assignOutcomeStoryboard = (
      choices?: Array<EncounterChoice | EmbeddedEncounterChoice>,
      depth = 0,
    ): void => {
      for (const choice of choices || []) {
        if (!choice.outcomes) continue;
        for (const tier of ['success', 'complicated', 'failure'] as const) {
          const outcome = choice.outcomes[tier];
          if (!outcome) continue;
          const frame = spine.find(f => f.role === (
            outcome.isTerminal
              ? 'fallout'
              : tier === 'success'
                ? 'opening'
                : tier === 'failure'
                  ? 'reversal'
                  : 'exchange'
          )) || fallbackFrame(Math.min(depth + 3, spine.length - 1));
          if (frame) {
            outcome.storyboardFrameId = outcome.storyboardFrameId || frame.id;
            outcome.tacticalEffect = outcome.tacticalEffect
              || `This ${tier} changes tactical/emotional position while preserving the encounter spine.`;
            if (outcome.nextSituation) {
              outcome.nextStoryboardFrameId = outcome.nextStoryboardFrameId || frame.id;
            }
          }
          if (outcome.nextSituation?.choices?.length) {
            assignOutcomeStoryboard(outcome.nextSituation.choices, depth + 1);
          }
        }
      }
    };

    for (const beat of structure.beats) {
      assignOutcomeStoryboard(beat.choices);
    }

    for (const storylet of Object.values(structure.storylets || {})) {
      if (!storylet) continue;
      if (storylet.triggerOutcome === 'partialVictory' && !storylet.cost) {
        storylet.cost = structure.partialVictoryCost
          || this.buildDefaultEncounterCost(storylet.narrativeFunction, storylet.consequences, input.partialVictoryCost);
      }
      if (!storylet?.beats) continue;
      for (const beat of storylet.beats) {
        if (storylet.triggerOutcome === 'partialVictory' && !beat.cost) {
          beat.cost = storylet.cost;
        }
        if (!beat.visualContract) {
          beat.visualContract = this.buildDefaultVisualContract(beat.text, 'resolution');
        }
        if (storylet.triggerOutcome === 'partialVictory' && beat.cost && !beat.visualContract.visibleCost) {
          beat.visualContract.visibleCost = beat.cost.visibleComplication;
          beat.visualContract.emotionalCore = beat.visualContract.emotionalCore || 'costly success';
        }
      }
    }

    // Blueprint branch discipline: when the scene is NOT a planned branch
    // point, converge every storylet route to the single planned next scene.
    // The LLM's nextSceneId ships verbatim through encounterConverter, so an
    // unplanned id here silently creates a scene-graph branch the blueprint
    // never planned (GATE_BRANCH_FANOUT).
    const routeCorrections = enforceStoryletConvergence(
      structure.storylets as Partial<Record<string, GeneratedStorylet | undefined>>,
      input,
    );
    for (const fix of routeCorrections) {
      console.warn(
        `[EncounterArchitect] Storylet "${fix.slot}" in ${structure.sceneId} routed to unplanned scene "${fix.from}" ` +
        `but the blueprint marks this scene as non-branching; converging to planned next scene "${fix.to}".`
      );
    }

    // NO ONE-CLICK WIN — source-side structural guard (G13). The prompt forbids a
    // ROOT-level terminal victory/partialVictory, yet the model keeps emitting a
    // 4th root choice (a treatment_branch-gated "c4") whose success/complicated
    // outcomes win the set-piece at depth 1 with zero consequences. Demote it into
    // a two-step finish HERE — on the flat beat spine, after flattenTreeToBeats —
    // before the draft is ever persisted, so the identical final-contract autofix
    // (applyEncounterQualityGate → deepenRootTerminalWins) stays a redundant net
    // rather than the only repair. Idempotent.
    const rootWinFix = deepenStructureRootWins(
      structure as unknown as Parameters<typeof deepenStructureRootWins>[0],
    );
    for (const flat of rootWinFix.flatRouted) {
      console.info(
        `[EncounterArchitect] ${structure.sceneId}: root terminal ${flat.outcome} on choice ${flat.choiceId} ` +
        `routed to finish beat ${flat.finishBeatId} (source-side flat one-click-win guard).`
      );
    }
    for (const skip of rootWinFix.skipped) {
      console.warn(
        `[EncounterArchitect] ${structure.sceneId}: root terminal ${skip.outcome} on choice ${skip.choiceId} ` +
        `left in place (no playable deterministic repair was available) — will be caught downstream.`
      );
    }
    if (rootWinFix.skipped.length > 0) {
      throw new Error(
        `[EncounterArchitect] ${structure.sceneId} contains ${rootWinFix.skipped.length} root-terminal win outcome(s) ` +
        `that could not be demoted into playable two-step branches. Refusing flat-routed draft before downstream validation.`
      );
    }

    return structure;
  }

  /**
   * The LLM sometimes authors strong outcome prose and all four storylets, but
   * omits the tiny route marker that tells playback whether an outcome proceeds
   * to another situation or terminates into a storylet. Repair only that pointer:
   * never create storylet prose here, and only route to storylets already
   * authored by the encounter.
   */
  private routeDanglingOutcomesToAuthoredStorylets(
    structure: EncounterStructure,
    input: EncounterArchitectInput,
  ): number {
    const storylets = structure.storylets || {};
    const hasStorylet = (outcome: EncounterOutcome): boolean =>
      Boolean((storylets as Record<string, GeneratedStorylet | undefined>)[outcome]?.beats?.length);
    const defaultByTier: Record<'success' | 'complicated' | 'failure', EncounterOutcome> = {
      success: 'victory',
      complicated: hasStorylet('partialVictory') ? 'partialVictory' : 'escape',
      failure: 'defeat',
    };
    const chooseRoute = (
      outcome: EncounterChoiceOutcome,
      tier: 'success' | 'complicated' | 'failure',
    ): EncounterOutcome | null => {
      const explicit = outcome.encounterOutcome as EncounterOutcome | undefined;
      if (explicit && hasStorylet(explicit)) return explicit;
      const fallback = defaultByTier[tier];
      return hasStorylet(fallback) ? fallback : null;
    };

    let repaired = 0;
    const visitChoices = (choices?: Array<EncounterChoice | EmbeddedEncounterChoice>): void => {
      for (const choice of choices || []) {
        if (!choice.outcomes) continue;
        for (const tier of ['success', 'complicated', 'failure'] as const) {
          const outcome = choice.outcomes[tier] as EncounterChoiceOutcome | undefined;
          if (!outcome) continue;
          if (outcome.nextSituation) {
            visitChoices(outcome.nextSituation.choices);
            continue;
          }
          if (outcome.nextBeatId) continue;
          if (outcome.isTerminal && outcome.encounterOutcome && hasStorylet(outcome.encounterOutcome)) continue;

          const route = chooseRoute(outcome, tier);
          if (!route) continue;
          outcome.isTerminal = true;
          outcome.encounterOutcome = route;
          delete outcome.nextSituation;
          delete outcome.nextBeatId;
          if (route === 'partialVictory' && !outcome.cost) {
            outcome.cost = this.buildDefaultEncounterCost(outcome.narrativeText, outcome.consequences, input.partialVictoryCost);
          }
          if (!outcome.visualContract) {
            outcome.visualContract = this.buildDefaultVisualContract(
              outcome.narrativeText,
              tier === 'success' ? 'peak' : tier === 'failure' ? 'resolution' : 'rising',
            );
          }
          if (route === 'partialVictory' && outcome.cost && !outcome.visualContract.visibleCost) {
            outcome.visualContract.visibleCost = outcome.cost.visibleComplication;
          }
          repaired++;
        }
      }
    };

    for (const beat of structure.beats || []) {
      visitChoices(beat.choices);
    }
    return repaired;
  }

  /**
   * Encounter unification W2b (flipped to always-on after live validation on
   * bite-me_2026-07-03T14-10-21): the flat nextBeatId spine is the ONE routing
   * shape, but the rich structure prompt authors nextSituation trees
   * natively. Rather than change the prompt (golden churn + LLM compliance
   * risk), materialize every embedded situation as a real beat and re-point
   * the outcome via nextBeatId — deterministic, lossless (setupText, image,
   * visual contract, choices carry over), recursive, and idempotent (a flat
   * structure has no nextSituation to flatten). The engine plays the flat
   * spine natively and deepenStructureRootWins repairs it natively.
   */
  private flattenTreeToBeats(structure: EncounterStructure): void {
    const usedIds = new Set(structure.beats.map((beat) => beat.id));
    const uniqueId = (base: string): string => {
      let id = base;
      let n = 2;
      while (usedIds.has(id)) id = `${base}-${n++}`;
      usedIds.add(id);
      return id;
    };
    let flattened = 0;
    const processBeat = (beat: EncounterBeat): void => {
      for (const choice of beat.choices || []) {
        if (!choice.outcomes) continue;
        for (const tier of ['success', 'complicated', 'failure'] as const) {
          const outcome = choice.outcomes[tier];
          if (!outcome?.nextSituation) continue;
          const situation = outcome.nextSituation;
          const beatId = uniqueId(`${beat.id}-${choice.id || 'choice'}-${tier}`);
          const newBeat: EncounterBeat = {
            id: beatId,
            phase: beat.phase ?? 'rising',
            name: `${beat.name || beat.id} · ${tier}`,
            description: (situation.setupText || '').slice(0, 160),
            setupText: situation.setupText || '',
            situationImage: situation.situationImage,
            visualContract: situation.visualContract,
            choices: (situation.choices || []) as EncounterChoice[],
          };
          structure.beats.push(newBeat);
          outcome.nextBeatId = beatId;
          delete outcome.nextSituation;
          flattened += 1;
          processBeat(newBeat);
        }
      }
    };
    for (const beat of [...structure.beats]) processBeat(beat);
    if (flattened > 0) {
      console.log(`[EncounterArchitect] Flattened ${flattened} embedded situation(s) into the flat beat spine.`);
    }
  }

  private buildEncounterOutcomeFlagName(sceneId: string, outcome: string): string {
    const safeSceneId = sceneId.replace(/[^a-zA-Z0-9_:-]+/g, '_').replace(/^_+|_+$/g, '') || 'encounter';
    const safeOutcome = outcome.replace(/[^a-zA-Z0-9_:-]+/g, '_').replace(/^_+|_+$/g, '') || 'outcome';
    return `encounter_${safeSceneId}_${safeOutcome}`;
  }

  private sanitizeStateChanges(changes?: StateChange[], fallbackFlagName?: string): StateChange[] | undefined {
    if (!Array.isArray(changes)) return changes;
    const slugFromDescription = (description: string, fallback: string): string => {
      const words = description
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter((word) => word.length >= 3 && !['your', 'you', 'the', 'and', 'for', 'with', 'into', 'from'].includes(word))
        .slice(0, 4);
      return words.length > 0 ? words.join('_') : fallback;
    };

    return changes.map((change) => {
      const raw = change as unknown as Record<string, unknown>;
      if (
        raw
        && typeof raw === 'object'
        && raw.type === 'score'
        && typeof raw.name !== 'string'
        && typeof raw.description === 'string'
        && (raw.change !== undefined || raw.value !== undefined)
      ) {
        const alias =
          (typeof raw.score === 'string' && raw.score.trim()) ||
          (typeof raw.flag === 'string' && raw.flag.trim()) ||
          '';
        return {
          type: 'score',
          name: alias || slugFromDescription(raw.description, 'encounter_score'),
          change: raw.change ?? raw.value,
        } as StateChange;
      }
      if (
        raw
        && typeof raw === 'object'
        && raw.type === 'score'
        && typeof raw.name !== 'string'
        && (typeof raw.score === 'string' || typeof raw.flag === 'string')
      ) {
        const name =
          (typeof raw.score === 'string' && raw.score.trim()) ||
          (typeof raw.flag === 'string' && raw.flag.trim());
        if (name) {
          return {
            type: 'score',
            name,
            change: raw.change ?? raw.value ?? 0,
          } as StateChange;
        }
      }
      if (
        raw
        && typeof raw === 'object'
        && raw.type === 'flag'
        && typeof raw.name !== 'string'
        && typeof raw.flag !== 'string'
        && (raw.change !== undefined || raw.value !== undefined)
      ) {
        const description = typeof raw.description === 'string' ? raw.description : '';
        const name = description
          ? slugFromDescription(description, fallbackFlagName || 'encounter_flag')
          : fallbackFlagName;
        if (name) {
          const value = raw.change ?? raw.value;
          const loweredValue = typeof value === 'string' ? value.toLowerCase().trim() : value;
          return {
            type: 'flag',
            name,
            change: loweredValue === false || loweredValue === 'false' || loweredValue === 0 ? false : true,
          } as StateChange;
        }
      }
      return change;
    }).filter((change) => {
      const raw = change as unknown as Record<string, unknown>;
      if (!raw || typeof raw !== 'object') return false;
      if (
        raw.type === 'flag'
        && typeof raw.name !== 'string'
        && typeof raw.flag !== 'string'
        && raw.change === undefined
        && raw.value === undefined
      ) {
        return false;
      }
      if (
        raw.type === 'score'
        && typeof raw.name !== 'string'
        && typeof raw.score !== 'string'
        && typeof raw.description !== 'string'
        && raw.change === undefined
      ) {
        return false;
      }
      return true;
    });
  }

  private sanitizeRuntimeConsequences(consequences?: Consequence[]): Consequence[] | undefined {
    if (!Array.isArray(consequences)) return consequences;

    const slugFromDescription = (description: string, fallback: string): string => {
      const words = description
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter((word) => word.length >= 3 && !['your', 'you', 'the', 'and', 'for', 'with', 'into', 'from'].includes(word))
        .slice(0, 4);
      return words.length > 0 ? words.join('_') : fallback;
    };

    return consequences.map((consequence) => {
      const raw = consequence as unknown as Record<string, unknown>;
      if (
        raw
        && typeof raw === 'object'
        && raw.type === 'score'
        && (raw.change !== undefined || raw.value !== undefined)
      ) {
        const alias =
          (typeof raw.score === 'string' && raw.score.trim()) ||
          (typeof raw.name === 'string' && raw.name.trim()) ||
          (typeof raw.flag === 'string' && raw.flag.trim()) ||
          '';
        const description = typeof raw.description === 'string' ? raw.description : '';
        return {
          type: 'changeScore',
          score: alias || slugFromDescription(description, 'encounter_score'),
          change: Number(raw.change ?? raw.value) || 0,
        } as Consequence;
      }
      return consequence;
    }).filter((consequence) => {
      const raw = consequence as unknown as Record<string, unknown>;
      return !(
        raw
        && typeof raw === 'object'
        && raw.type === 'score'
        && (raw.change !== undefined || raw.value !== undefined)
      );
    });
  }

  private sanitizeSetupTextVariants(
    variants?: Array<{ condition: Record<string, unknown>; text: string }>
  ): Array<{ condition: Record<string, unknown>; text: string }> | undefined {
    if (!Array.isArray(variants)) return undefined;

    const sanitized = variants
      .map((variant) => ({
        condition: this.sanitizeConditionExpression(variant?.condition),
        text: typeof variant?.text === 'string' ? variant.text.trim() : '',
      }))
      .filter((variant): variant is { condition: Record<string, unknown>; text: string } =>
        Boolean(variant.condition && variant.text)
      );

    return sanitized.length > 0 ? sanitized : undefined;
  }

  private sanitizeChoiceConditions(choice: EmbeddedEncounterChoice | EncounterChoice): void {
    const rawChoice = choice as unknown as Record<string, unknown>;
    const conditions = this.sanitizeConditionExpression(rawChoice.conditions);
    if (rawChoice.conditions !== undefined) {
      if (conditions) {
        rawChoice.conditions = conditions;
      } else {
        delete rawChoice.conditions;
        delete rawChoice.showWhenLocked;
        delete rawChoice.lockedText;
      }
    }

    const statBonus = rawChoice.statBonus as Record<string, unknown> | undefined;
    if (statBonus && typeof statBonus === 'object') {
      const statBonusCondition = this.sanitizeConditionExpression(statBonus.condition);
      if (statBonusCondition) {
        statBonus.condition = statBonusCondition;
      } else {
        delete rawChoice.statBonus;
      }
    }
  }

  private sanitizeConditionExpression(condition: unknown): Record<string, unknown> | null {
    if (!condition || typeof condition !== 'object' || Array.isArray(condition)) return null;

    const raw = { ...(condition as Record<string, unknown>) };
    const type = typeof raw.type === 'string' ? raw.type : undefined;

    if (type === 'flag') {
      const flag = typeof raw.flag === 'string' ? raw.flag.trim() : '';
      if (!flag || flag === 'value') return null;
      return { ...raw, flag, value: raw.value ?? true };
    }

    if (type === 'score') {
      const score =
        (typeof raw.score === 'string' && raw.score.trim()) ||
        (typeof raw.name === 'string' && raw.name.trim()) ||
        (typeof raw.stat === 'string' && raw.stat.trim());
      if (!score) return null;
      return { ...raw, score, operator: raw.operator ?? '>=', value: raw.value ?? raw.threshold ?? 1 };
    }

    if (type === 'relationship') {
      const npcId =
        (typeof raw.npcId === 'string' && raw.npcId.trim()) ||
        (typeof raw.characterId === 'string' && raw.characterId.trim()) ||
        (typeof raw.name === 'string' && raw.name.trim());
      if (!npcId) return null;
      return { ...raw, npcId, dimension: raw.dimension ?? 'trust', operator: raw.operator ?? '>=', value: raw.value ?? raw.threshold ?? 1 };
    }

    if ((type === 'and' || type === 'or') && Array.isArray(raw.conditions)) {
      const conditions = raw.conditions
        .map((nested) => this.sanitizeConditionExpression(nested))
        .filter((nested): nested is Record<string, unknown> => Boolean(nested));
      if (conditions.length === 0) return null;
      return { ...raw, conditions };
    }

    return raw;
  }

  private getEncounterProgressionDepth(structure: EncounterStructure): number {
    const startingBeat =
      structure.beats.find((beat) => beat.id === structure.startingBeatId)
      || structure.beats[0];

    if (!startingBeat) return 0;

    const getDepthFromChoices = (
      choices: Array<EncounterChoice | EmbeddedEncounterChoice> | undefined,
      seen: Set<string>
    ): number => {
      let maxDepth = 0;

      for (const choice of choices || []) {
        if (!choice?.outcomes) continue;
        for (const tier of ['success', 'complicated', 'failure'] as const) {
          const outcome = choice.outcomes[tier];
          if (!outcome) continue;

          if (outcome.nextSituation?.choices?.length) {
            const situationKey = `${choice.id}:${tier}:${outcome.nextSituation.setupText || ''}`;
            if (seen.has(situationKey)) {
              maxDepth = Math.max(maxDepth, 1);
              continue;
            }
            const nextSeen = new Set(seen);
            nextSeen.add(situationKey);
            maxDepth = Math.max(maxDepth, 1 + getDepthFromChoices(outcome.nextSituation.choices, nextSeen));
          } else if (outcome.isTerminal || outcome.encounterOutcome || outcome.nextBeatId) {
            maxDepth = Math.max(maxDepth, 1);
          }
        }
      }

      return maxDepth;
    };

    return 1 + getDepthFromChoices(startingBeat.choices, new Set());
  }

  private lowercaseFirst(value: string): string {
    return value ? `${value.charAt(0).toLowerCase()}${value.slice(1)}` : value;
  }

  private sentenceFromEncounterChoice(choiceText?: string): string {
    const text = choiceText?.replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '');
    if (!text) return 'You chose how to meet the moment.';

    const withoutYou = text.match(/^you\s+(.+)$/i)?.[1];
    const action = withoutYou || text;
    const dont = action.match(/^don['’]?t\s+(.+)$/i)?.[1];
    if (dont) {
      return `You chose not to ${this.lowercaseFirst(dont)}.`;
    }

    return `You chose to ${this.lowercaseFirst(action)}.`;
  }

  private summarizeEncounterNarrative(narrativeText?: string): string {
    const normalized = narrativeText?.replace(/\s+/g, ' ').trim();
    if (!normalized) return 'The choice changes the shape of the scene.';

    const firstSentence = normalized.match(/^(.+?[.!?])(?:\s|$)/)?.[1] || normalized;
    if (firstSentence.length <= 150) return firstSentence;

    const trimmed = firstSentence.slice(0, 147);
    const lastBreak = Math.max(trimmed.lastIndexOf(','), trimmed.lastIndexOf(';'), trimmed.lastIndexOf(' '));
    return `${trimmed.slice(0, lastBreak > 80 ? lastBreak : 147).trim()}...`;
  }

  private ensureEncounterChoiceFeedback<T extends {
    text?: string;
    reminderPlan?: ReminderPlan;
    feedbackCue?: ChoiceFeedbackCue;
  }>(choice: T, narrativeText?: string): T {
    const echoSummary = choice.feedbackCue?.echoSummary || this.sentenceFromEncounterChoice(choice.text);
    const progressSummary =
      choice.feedbackCue?.progressSummary
      || choice.reminderPlan?.shortTerm
      || this.summarizeEncounterNarrative(narrativeText);

    choice.reminderPlan = {
      immediate: choice.reminderPlan?.immediate || echoSummary,
      shortTerm: choice.reminderPlan?.shortTerm || progressSummary,
      ...(choice.reminderPlan?.later ? { later: choice.reminderPlan.later } : {}),
    };

    choice.feedbackCue = {
      ...choice.feedbackCue,
      echoSummary,
      progressSummary,
      checkClass: choice.feedbackCue?.checkClass || 'dramatic',
    };

    return choice;
  }

  private buildDefaultOutcome(
    choiceText: string | undefined,
    tier: 'success' | 'complicated' | 'failure',
    phase: EscalationPhase,
  ) {
    const normalizedChoiceText = (choiceText || 'the attempt').trim();
    const encounterOutcomeByTier: Record<typeof tier, EncounterOutcome> = {
      success: 'victory',
      complicated: 'partialVictory',
      failure: 'defeat',
    };
    const clockDefaults = {
      success: { goalTicks: 2, threatTicks: 0 },
      complicated: { goalTicks: 1, threatTicks: 1 },
      failure: { goalTicks: 0, threatTicks: 2 },
    };
    const narrativeByTier: Record<typeof tier, string> = {
      success: `${normalizedChoiceText} succeeds and decisively shifts the situation.`,
      complicated: `${normalizedChoiceText} partly works, but the cost is immediately visible.`,
      failure: `${normalizedChoiceText} fails and the situation worsens.`,
    };

    const visualContract = this.buildDefaultVisualContract(
      narrativeByTier[tier],
      tier === 'success' ? 'peak' : tier === 'failure' ? 'resolution' : phase,
    );

    const outcome: {
      tier: 'success' | 'complicated' | 'failure';
      goalTicks: number;
      threatTicks: number;
      narrativeText: string;
      isTerminal: boolean;
      encounterOutcome: EncounterOutcome;
      visualContract: EncounterVisualContract;
      cost?: EncounterCost;
    } = {
      tier,
      goalTicks: clockDefaults[tier].goalTicks,
      threatTicks: clockDefaults[tier].threatTicks,
      narrativeText: narrativeByTier[tier],
      isTerminal: true,
      encounterOutcome: encounterOutcomeByTier[tier],
      visualContract,
    };

    if (tier === 'complicated') {
      outcome.cost = this.buildDefaultEncounterCost(narrativeByTier[tier], undefined, undefined);
      outcome.visualContract.visibleCost = outcome.cost.visibleComplication;
    }

    return outcome;
  }

  private getDefaultVisualDirection(phase: EscalationPhase): EncounterBeat['visualDirection'] {
    switch (phase) {
      case 'setup':
        return { cameraStyle: 'wide_establishing', lighting: 'neutral', mood: 'anticipation' };
      case 'rising':
        return { cameraStyle: 'medium_action', lighting: 'increasing_contrast', mood: 'tension_building' };
      case 'peak':
        return { cameraStyle: 'dramatic_closeups', lighting: 'high_contrast_colored', mood: 'maximum_intensity' };
      case 'resolution':
        return { cameraStyle: 'reaction_shots', lighting: 'appropriate_to_outcome', mood: 'release' };
    }
  }

  private buildDefaultVisualContract(
    text: string,
    phase: EscalationPhase | 'resolution'
  ): EncounterVisualContract {
    const cleaned = (text || '').trim();
    const action = cleaned.match(/\b(grabs?|reaches?|recoils?|steps?|stumbles?|lunges?|turns?|pushes?|pulls?|raises?|lowers?|clenches?|releases?|strikes?|dodges?|embraces?|confronts?|retreats?|advances?|pleads?|reveals?|hides?)\b/i)?.[0];
    const detail = cleaned.match(/\b(key|blade|blood|door|map|weapon|wound|fist|hands?|letter|ring|gun|knife|tear|glance)\b/i)?.[0];
    const fallbackAction = action
      ? `the protagonist ${action}`
      : this.deriveEncounterPhysicalBusiness(cleaned, phase);
    const visibleTurn = this.deriveEncounterVisibleTurn(cleaned, phase, fallbackAction);
    const visualSubtextCue = detail
      ? `the ${detail} becomes the concrete clue that changes the beat`
      : this.deriveEncounterSubtextCue(cleaned, phase);
    return {
      visualMoment: cleaned || 'A decisive encounter moment.',
      primaryAction: fallbackAction,
      emotionalRead: phase === 'resolution'
        ? 'the emotional aftermath is readable in the face and shoulders'
        : 'emotion should read clearly in the eyes, jaw, and posture',
      relationshipDynamic: phase === 'setup'
        ? 'the power balance is visible in how characters claim space'
        : 'the relationship pressure is visible in body language and distance',
      mustShowDetail: detail ? `the ${detail} as the concrete clue that sells the moment` : visualSubtextCue,
      keyExpression: phase === 'resolution' ? 'aftermath and cost visible at a glance' : 'immediate emotional intent visible at a glance',
      keyGesture: action ? `a readable gesture built around ${action}` : visualSubtextCue,
      keyBodyLanguage: phase === 'setup' ? 'stance and spacing define the tension' : `body language shows the visible turn: ${visibleTurn}`,
      shotDescription: phase === 'setup' ? 'establishing frame with readable relational spacing' : 'dramatic story frame with readable faces, hands, and posture',
      emotionalCore: phase === 'resolution' ? 'aftermath' : 'decision under pressure',
      visualNarrative: cleaned || visibleTurn,
      includeExpressionRefs: phase !== 'setup',
    };
  }

  private deriveEncounterPhysicalBusiness(text: string, phase: EscalationPhase | 'resolution'): string {
    const lowered = text.toLowerCase();
    if (/(key|blade|blood|door|map|weapon|wound|fist|hands?|letter|ring|gun|knife)/.test(lowered)) {
      return 'the protagonist brings the decisive object into the contested space';
    }
    if (/(plead|bargain|persuad|convince|accuse|challenge)/.test(lowered)) {
      return 'the protagonist closes distance and presses the point with an unmistakable gesture';
    }
    if (/(hide|sneak|escape|avoid|cover)/.test(lowered)) {
      return 'the protagonist uses cover and changing distance to regain leverage';
    }
    if (/(hurt|wound|fear|panic|guilt|shame)/.test(lowered)) {
      return 'the protagonist steadies themselves as the cost becomes visible in their posture';
    }
    switch (phase) {
      case 'setup':
        return 'the protagonist claims a position in the space while measuring the opposition';
      case 'rising':
        return 'the protagonist shifts stance and forces the confrontation into a new shape';
      case 'peak':
        return 'the protagonist commits to the decisive move with hands and body fully engaged';
      case 'resolution':
        return 'the protagonist lowers their guard as the outcome settles into their body';
    }
  }

  private deriveEncounterVisibleTurn(text: string, phase: EscalationPhase | 'resolution', action: string): string {
    if (text.trim()) return `${action}, making the encounter's leverage visibly change.`;
    switch (phase) {
      case 'setup':
        return 'The first positioning move reveals who controls the space.';
      case 'rising':
        return 'The pressure shifts as one side gains ground and the other yields.';
      case 'peak':
        return 'The decisive move lands and the balance of power flips.';
      case 'resolution':
        return 'The aftermath shows what the encounter cost and who is left standing with leverage.';
    }
  }

  private deriveEncounterSubtextCue(text: string, phase: EscalationPhase | 'resolution'): string {
    const lowered = text.toLowerCase();
    if (/(door|threshold|exit)/.test(lowered)) return 'the distance to the exit shows whether escape or confrontation is winning';
    if (/(hands?|fist|grip)/.test(lowered)) return 'hands tighten, release, or reach to show intent without captions';
    if (/(glance|eyes?|stare)/.test(lowered)) return 'a delayed glance reveals what the character cannot say directly';
    if (phase === 'resolution') return 'lowered shoulders, changed distance, and one released object show the cost';
    return 'a clear shift in stance, distance, or object control makes the subtext legible';
  }

  private buildDefaultEncounterCost(
    text: string,
    consequences: StateChange[] | undefined,
    seed?: Partial<EncounterCost>
  ): EncounterCost {
    const lowered = `${text} ${(seed?.visibleComplication || '')}`.toLowerCase();
    const derivedDomain = seed?.domain
      || (consequences?.some(c => c.type === 'relationship') ? 'relationship' : undefined)
      || (consequences?.some(c => c.type === 'score' && /reputation|trust|respect|fame/i.test(c.name)) ? 'reputation' : undefined)
      || (consequences?.some(c => c.type === 'score' && /time|delay|clock/i.test(c.name)) ? 'time' : undefined)
      || (/(wound|injur|bleed|hurt|scar|pain)/.test(lowered) ? 'injury' : undefined)
      || (/(exposed|seen|noticed|discover|reveal)/.test(lowered) ? 'exposure' : undefined)
      || (/(reputation|shame|humiliat|public)/.test(lowered) ? 'reputation' : undefined)
      || (/(lose|spent|broken|consumed|depleted|resource)/.test(lowered) ? 'resource' : undefined)
      || 'mixed';
    const severity = seed?.severity
      || (consequences && consequences.length >= 3 ? 'major' : consequences && consequences.length >= 2 ? 'moderate' : 'minor');
    const whoPays = seed?.whoPays
      || (derivedDomain === 'relationship' ? 'relationship' : derivedDomain === 'world' ? 'world' : 'protagonist');

    return {
      domain: derivedDomain,
      severity,
      whoPays,
      immediateEffect: seed?.immediateEffect || text || 'The win leaves something unsettled that follows the protagonist forward.',
      visibleComplication: seed?.visibleComplication || text || 'Relief arrives with a complication still attached.',
      lingeringEffect: seed?.lingeringEffect,
      consequences: seed?.consequences,
    };
  }

  /**
   * Targeted field re-author (mirror of ChoiceAuthor.reauthorOutcomeTexts):
   * when the only boilerplate in an encounter is deterministic cost/stakes
   * fallback (buildDefaultEncounterCost / deriveEncounterCost placeholders,
   * injected because the LLM omitted the field), regenerating the WHOLE
   * encounter cannot converge — the injection recurs on every omission. This
   * makes one small focused call that authors exactly the offending strings
   * and writes them back in place. Works on both the generation-time
   * structure and the converted runtime encounter (key-based walk). Returns
   * the number of fields repaired; never throws into the calling flow.
   */
  async reauthorFallbackCostFields(
    encounterTree: unknown,
    ctx: CostReauthorContext = {},
  ): Promise<number> {
    const entries = collectFallbackCostFieldEntries(encounterTree);
    if (entries.length === 0) return 0;
    try {
      const raw = await this.callLLM([{ role: 'user', content: buildCostReauthorPrompt(entries, ctx) }], 2);
      const parsed = this.parseJSON<Record<string, unknown>>(raw);
      const replaced = applyAuthoredCostFieldTexts(entries, parsed ?? {});
      if (replaced < entries.length) {
        console.warn(
          `[EncounterArchitect] Cost-field re-author replaced ${replaced}/${entries.length} fallback field(s) — the contract gate remains the net for the rest.`,
        );
      }
      return replaced;
    } catch (err) {
      console.warn(`[EncounterArchitect] reauthorFallbackCostFields failed (placeholders kept): ${err instanceof Error ? err.message : String(err)}`);
      return 0;
    }
  }

  private createDefaultStorylet(
    outcome: 'victory' | 'partialVictory' | 'defeat' | 'escape',
    input: EncounterArchitectInput
  ): GeneratedStorylet {
    const protagonist = input.protagonistInfo.name || 'the protagonist';
    const tones: Record<string, GeneratedStorylet['tone']> = {
      victory: 'triumphant',
      partialVictory: 'bittersweet',
      defeat: 'somber',
      escape: 'relieved'
    };

    if (outcome === 'defeat') {
      return {
        id: `${input.sceneId}-storylet-defeat`,
        name: 'Defeat Aftermath',
        triggerOutcome: 'defeat',
        tone: 'somber',
        narrativeFunction: 'The failure lands in the fiction and points toward recovery.',
        sequenceIntent: {
          objective: 'Make the cost of defeat visible while beginning a recovery arc.',
          activity: 'aftermath recovery sequence after failure',
          obstacle: 'Failure has immediate emotional and practical consequences.',
          startState: 'The failed objective lands as visible cost.',
          turningPoint: 'The protagonist sees what went wrong and what must change.',
          endState: 'Resolve hardens into a recovery direction.',
          visualThread: 'the visible cost of failure and the posture shift toward resolve',
          mechanicThread: 'setback / resolve',
        },
        beats: [
          {
            id: `${input.sceneId}-storylet-defeat-beat-1`,
            text: `${protagonist} feels the moment slip away before anyone has to name it. The encounter leaves a mark, and the next breath already tastes like recovery will have to be earned.`,
            nextBeatId: `${input.sceneId}-storylet-defeat-beat-2`,
          },
          {
            id: `${input.sceneId}-storylet-defeat-beat-2`,
            text: `But even in defeat, something has shifted. ${protagonist} sees more clearly now — what went wrong, and what must be done differently next time.`,
            nextBeatId: `${input.sceneId}-storylet-defeat-beat-3`,
          },
          {
            id: `${input.sceneId}-storylet-defeat-beat-3`,
            text: `Resolve hardens. This isn't the end. It's a turning point.`,
            isTerminal: true,
          },
        ],
        startingBeatId: `${input.sceneId}-storylet-defeat-beat-1`,
        consequences: [
          { type: 'score', name: 'setbacks', change: 1 },
          { type: 'score', name: 'resolve', change: 3 },
        ],
        setsFlags: [{ flag: `encounter_${input.sceneId}_defeat`, value: true }],
        nextSceneId: input.defeatNextSceneId,
      };
    }

    if (outcome === 'victory') {
      return {
        id: `${input.sceneId}-storylet-victory`,
        name: 'Victory Aftermath',
        triggerOutcome: 'victory',
        tone: 'triumphant',
        narrativeFunction: 'The victory lands in the fiction and leaves the protagonist steadier.',
        sequenceIntent: {
          objective: 'Show victory changing confidence and the world response.',
          activity: 'victory aftermath sequence',
          obstacle: 'Success still has to settle into visible consequence.',
          startState: 'The pressure eases and the scene changes around the protagonist.',
          turningPoint: 'The protagonist recognizes they rose to the challenge.',
          endState: 'Earned confidence becomes visible.',
          visualThread: 'the changed space after success and the protagonist’s steadier posture',
          mechanicThread: 'confidence / courage',
        },
        beats: [
          {
            id: `${input.sceneId}-storylet-victory-beat-1`,
            text: `${protagonist} comes through the encounter with the pressure finally loosening. The space around them feels changed now, as if the night has had to make room for what they just proved, and the steadiness that follows feels earned rather than easy.`,
            isTerminal: true,
          },
        ],
        startingBeatId: `${input.sceneId}-storylet-victory-beat-1`,
        consequences: [
          { type: 'score', name: 'confidence', change: 5 },
          { type: 'score', name: 'courage', change: 2 },
        ],
        setsFlags: [{ flag: `encounter_${input.sceneId}_victory`, value: true }],
        nextSceneId: input.victoryNextSceneId,
      };
    }

    if (outcome === 'partialVictory') {
      const cost = this.buildDefaultEncounterCost(
        'The win is real, but it leaves a complication that follows the protagonist forward.',
        [
          { type: 'score', name: 'confidence', change: 2 },
          { type: 'score', name: 'setbacks', change: 1 },
        ],
        input.partialVictoryCost
      );
      return {
        id: `${input.sceneId}-storylet-partial-victory`,
        name: 'Costly Victory',
        triggerOutcome: 'partialVictory',
        tone: tones.partialVictory,
        narrativeFunction: 'The protagonist gets through, but the aftermath keeps the cost alive in the fiction.',
        sequenceIntent: {
          objective: 'Show that the goal was won while the cost remains active.',
          activity: 'costly-victory aftermath sequence',
          obstacle: 'Relief and damage arrive together.',
          startState: 'The protagonist gets through with a visible complication still attached.',
          turningPoint: 'The cost becomes impossible to ignore.',
          endState: 'The next scene is shaped by both success and complication.',
          visualThread: cost.visibleComplication || 'the visible complication left by the victory',
          mechanicThread: 'confidence / setback / cost',
        },
        cost,
        beats: [
          {
            id: `${input.sceneId}-storylet-partial-victory-beat-1`,
            text: `${protagonist} gets through the moment, but relief does not arrive alone. Something in the scene stays unsettled, already shaping what comes next.`,
            nextBeatId: `${input.sceneId}-storylet-partial-victory-beat-2`,
            cost,
          },
          {
            id: `${input.sceneId}-storylet-partial-victory-beat-2`,
            text: `The victory is real, but so is the complication it leaves behind. What comes next will be shaped by both.`,
            isTerminal: true,
            cost,
          },
        ],
        startingBeatId: `${input.sceneId}-storylet-partial-victory-beat-1`,
        consequences: [
          { type: 'score', name: 'confidence', change: 2 },
          { type: 'score', name: 'setbacks', change: 1 },
        ],
        setsFlags: [{ flag: `encounter_${input.sceneId}_partialVictory`, value: true }],
        nextSceneId: input.victoryNextSceneId,
      };
    }

    // Escape
    return {
      id: `${input.sceneId}-storylet-escape`,
      name: 'Narrow Escape',
      triggerOutcome: 'escape',
      tone: 'relieved',
      narrativeFunction: 'Tension release, assess what was gained and lost',
      sequenceIntent: {
        objective: 'Release immediate danger while keeping the unresolved problem alive.',
        activity: 'narrow escape aftermath sequence',
        obstacle: 'Safety is temporary and the threat remains unresolved.',
        startState: 'The protagonist has escaped but adrenaline still drives the body.',
        turningPoint: 'Taking stock reveals what is still unresolved.',
        endState: 'There is time to prepare, but not closure.',
        visualThread: 'breath, distance from danger, and the route back toward preparation',
        mechanicThread: 'resourcefulness / escape flag',
      },
      beats: [
        {
          id: `${input.sceneId}-storylet-escape-beat-1`,
          text: `${protagonist} has escaped, but barely. The adrenaline is still coursing.`,
          nextBeatId: `${input.sceneId}-storylet-escape-beat-2`,
        },
        {
          id: `${input.sceneId}-storylet-escape-beat-2`,
          text: `Taking stock, ${protagonist} realizes the situation remains unresolved — but at least there's time to prepare.`,
          isTerminal: true,
        },
      ],
      startingBeatId: `${input.sceneId}-storylet-escape-beat-1`,
      consequences: [
        { type: 'score', name: 'resourcefulness', change: 2 },
      ],
      setsFlags: [{ flag: `encounter_${input.sceneId}_escape`, value: true }],
      nextSceneId: input.victoryNextSceneId,
    };
  }

  private buildPrompt(input: EncounterArchitectInput): string {
    const npcsList = input.npcsInvolved
      .map(npc => {
        let line = `- ${npc.name} (${npc.id}, ${npc.pronouns}): ${npc.role} - ${npc.description}`;
        if (npc.physicalDescription) line += `\n  Physical Appearance (CANONICAL): ${npc.physicalDescription}`;
        return line;
      })
      .join('\n');

    const skillsList = input.availableSkills
      .map(s => `- ${s.name} (${s.attribute}): ${s.description}`)
      .join('\n');

    const protagonistSkills = input.protagonistInfo.relevantSkills
      ?.map(s => `- ${s.name}: level ${s.level}`)
      .join('\n') || 'Not specified';

    const storyVerbList = (input.storyVerbs || [])
      .map(storyVerb => `- ${storyVerb.verb}: ${storyVerb.description}`)
      .join('\n');

    const difficultyOdds: Record<string, number> = {
      easy: 55,
      moderate: 65,
      hard: 75,
      extreme: 85
    };

    const structuralContext = buildStructuralContextSection({
      anchors: input.seasonAnchors,
      storyCircle: input.seasonStoryCircle,
      episodeStoryCircleRole: input.episodeStoryCircleRole,
      episodeCircle: input.episodeCircle,
    });

    return `
Design a COMPLETE encounter structure for the following scene:
${structuralContext}
${CRAFT_PRESSURE_GUIDANCE}

## Genre-Aware Jeopardy
${buildGenreAwareJeopardyGuidance(input.storyContext.genre)}

${storyVerbList ? `## Story Verbs
Use these genre/source-specific verbs to make encounter choices feel native to the story world. Do not expose them as system labels; turn them into concrete actions, complications, and storylet consequences.
${storyVerbList}
` : ''}

## Story Context
- **Title**: ${input.storyContext.title}
- **Genre**: ${input.storyContext.genre}
- **Tone**: ${input.storyContext.tone}
${input.storyContext.userPrompt ? `- **User Instructions**: ${input.storyContext.userPrompt}\n` : ''}${input.memoryContext ? `\n## Pipeline Memory (Insights from Prior Generations)\n${input.memoryContext}\n` : ''}
${input.episodeSoFarSummary ? `## Episode So Far (scenes BEFORE this encounter — continuity is MANDATORY)
${input.episodeSoFarSummary}

The encounter CONTINUES from the last scene above. Do NOT reset the timeline, re-introduce the protagonist's arrival, or treat characters the protagonist has already met as strangers. The protagonist is the player ("you") — never an NPC in this encounter.
` : ''}${formatForbiddenRevealsSection(input.forbiddenReveals ?? [])}

## Scene Context
- **Scene ID**: ${input.sceneId}
- **Scene Name**: ${input.sceneName}
- **Description**: ${input.sceneDescription}
- **Mood**: ${input.sceneMood}
${input.sceneLocation ? `- **Location**: ${input.sceneLocation}` : ''}
${input.sceneTimeline?.timeOfDay ? `- **Time of day**: ${input.sceneTimeline.timeOfDay}` : ''}
- **Planned Encounter ID**: ${input.plannedEncounterId || 'none'}
${input.sceneTimeline && (input.sceneTimeline.locationChanged || input.sceneTimeline.timeChanged) ? `
### TRANSITION HANDOFF (CRITICAL — time/place moved since the previous scene)
The previous scene ("${input.sceneTimeline.previous?.sceneName ?? 'previous scene'}") took place at ${input.sceneTimeline.previous?.location ?? 'its location'}${input.sceneTimeline.previous?.timeOfDay ? ` (${input.sceneTimeline.previous.timeOfDay})` : ''}${input.sceneTimeline.timeJumpFromPrevious ? ` — planned gap: ${input.sceneTimeline.timeJumpFromPrevious}` : ''}.
The encounter's OPENING/setup prose must ground the new time and place and how the protagonist got here before the pressure starts — an unacknowledged cut reads as a continuity error.` : ''}

## Encounter Details
- **Type**: ${input.encounterType}
- **Style**: ${input.encounterStyle || 'auto'}
- **Description**: ${input.encounterDescription}
${this.formatEncounterStoryCircleTarget(input)}
- **Personal Stakes**: ${input.encounterStakes || 'Use the scene description and prior buildup to infer the stakes'}
- **Required NPC IDs**: ${(input.encounterRequiredNpcIds || []).join(', ') || 'Use the NPC list below'}
- **Relevant Skills**: ${(input.encounterRelevantSkills || []).join(', ') || 'Use available skills below'}
- **Difficulty**: ${input.difficulty} (target ${difficultyOdds[input.difficulty]}% initial odds against player)
- **Target Beat Count**: ${input.targetBeatCount}
- **Minimum Required Beats**: ${this.getMinimumRequiredBeatCount(input)}
- **Jeopardy Requirement**: Put something serious at risk in this encounter. Match the risk to the genre and encounter style; do not force combat unless the genre/style calls for it.
- **Skill Surface Requirement**: Each encounter must use 2-3 relevant skills, at least one fiction-first prepared advantage source, and at least one environmental or relationship affordance.
- Prepared advantage may use existing \`statBonus\`: condition + hidden difficultyReduction + flavorText. flavorText must read like story leverage, never a bonus/modifier/percentage.
- Every success, complicated, and failure outcome must leave playable fiction: changed posture, cost, suspicion, injury, lost leverage, relationship movement, route pressure, recovery hook, or future callback.
- **Encounter Beat Plan**:
${(input.encounterBeatPlan && input.encounterBeatPlan.length > 0)
  ? input.encounterBeatPlan.map((beat, index) => `  ${index + 1}. ${beat}`).join('\n')
  : '  1. Opening pressure\n  2. Escalation\n  3. Crisis / resolution'}

## Protagonist
- **Name**: ${input.protagonistInfo.name}
- **Pronouns**: ${input.protagonistInfo.pronouns}${input.protagonistInfo.physicalDescription ? `\n- **Physical Appearance** (CANONICAL — use these exact details in any descriptive text): ${input.protagonistInfo.physicalDescription}` : ''}
- **Relevant Skills**:
${protagonistSkills}

## NPCs Involved
${npcsList || 'None'}

## Available Skills
${skillsList}

## Scene Connections
- **Victory leads to**: ${input.victoryNextSceneId || 'next scene'}
- **Defeat leads to**: ${input.defeatNextSceneId || 'next scene'}

${input.priorStateContext ? (() => {
  const ctx = input.priorStateContext!;
  const alreadySetFlags = ctx.relevantFlags.filter(f => f.alreadySet);
  const futureFlags = ctx.relevantFlags.filter(f => !f.alreadySet);

  let flagSection = '';
  if (alreadySetFlags.length > 0) {
    flagSection += `### Flags ALREADY SET by Prior Scenes (safe for \`conditions\`, \`setupTextVariants\`, \`statBonus\`)
${alreadySetFlags.map(f => `- \`${f.name}\`: ${f.description}`).join('\n')}`;
  }
  if (futureFlags.length > 0) {
    if (flagSection) flagSection += '\n\n';
    flagSection += `### Flags Set by LATER Scenes (use ONLY in \`setupTextVariants\` or \`statBonus\` — do NOT use in choice \`conditions\`)
${futureFlags.map(f => `- \`${f.name}\`: ${f.description}`).join('\n')}
**IMPORTANT**: These flags are set by scenes the player has not reached yet. Using them in choice \`conditions\` would create a permanently-locked choice. Only reference them in \`setupTextVariants\` (narrative shading for future replays) or \`statBonus\`.`;
  }
  if (!flagSection) flagSection = '(No flags provided.)';

  const relSection = ctx.relevantRelationships.length > 0
    ? `### Relevant Relationships
${ctx.relevantRelationships.map(r => {
  const maxNote = r.currentMaxValue !== undefined ? ` [current max achievable: ${r.currentMaxValue}]` : '';
  const authoredNote = r.authored === false ? ' [default heuristic]' : '';
  return `- ${r.npcName} (${r.npcId}) — ${r.dimension} ${r.operator} ${r.threshold}${authoredNote}${maxNote}: ${r.description}`;
}).join('\n')}
**IMPORTANT**: Do NOT use a relationship condition on a choice if the "current max achievable" value is below the threshold — that would create a permanently-locked choice. Only use relationship conditions when the max achievable value can meet or exceed the threshold.`
    : '';

  const choiceSection = ctx.significantChoices.length > 0
    ? `### Notable Choices the Player May Have Made
${ctx.significantChoices.map(c => `- ${c}`).join('\n')}`
    : '';

  return `## Prior State Context (PAYOFF THESE IN THE ENCOUNTER)

The following flags and relationship thresholds are DESIGNED to echo inside this encounter. For each one, author at least one of: a \`setupTextVariants\` entry on a beat, a conditional choice (\`conditions\`), or a \`statBonus\`. See the PRIOR STATE PAYOFF section in your instructions.

${flagSection}

${relSection}

${choiceSection}
`;
})() : ''}
## REQUIRED JSON STRUCTURE - STORYBOARD SPINE + CONTROLLED TACTICAL TREE

{
  "sceneId": "${input.sceneId}",
  "encounterType": "${input.encounterType}",
  "encounterStyle": "${input.encounterStyle || 'auto'}",
  "storyboard": {
    "spine": [
      {
        "id": "${input.sceneId}-storyboard-establish",
        "role": "establish",
        "title": "Establish",
        "purpose": "What this visual frame accomplishes",
        "visualMoment": "Single-panel visual moment",
        "tacticalFunction": "How this frame changes or clarifies position, leverage, information, exposure, relationship pressure, resource state, clocks, cost, or storylet trajectory",
        "emotionalState": "Readable emotional pressure",
        "continuityState": {
          "characterPositions": { "protagonist": "where they are" },
          "relationshipDistance": "physical/emotional distance or leverage",
          "propsInPlay": ["important prop/tool/clue"],
          "environmentChanges": [],
          "lighting": "consistent scene lighting"
        },
        "decisionWindow": false,
        "allowedApproaches": []
      }
    ],
    "sequenceIntent": {
      "objective": "What this encounter sequence is trying to accomplish",
      "activity": "The concrete visible encounter activity",
      "obstacle": "What resists or complicates the objective",
      "startState": "How the encounter begins visually",
      "turningPoint": "The reversal, decisive move, or pressure shift",
      "endState": "What has changed by the aftermath",
      "visualThread": "Recurring prop, distance, blocking, cost, clue, wound, or motif",
      "mechanicThread": "Optional fiction-first hook such as encounter clock, leverage, cost, trust, clue, danger, or resource"
    },
    "styleNotes": "7-9 frames across establish, pressureReveal, commit, exchange, reversal, opening, decisiveMove, fallout, aftermath. For this encounter emphasize ${this.describeEncounterStyleFocus(input.encounterStyle, input.encounterType)}.",
    "convergencePlan": "Outcome variants alter the next panel, hidden mechanics, and available choices, then converge back to the cinematic spine when appropriate.",
    "mechanicsVisibility": "current_clocks_only"
  },
  "payoffContext": {
    "consumedFlags": [],
    "relationshipPayoffs": [],
    "identityPayoffs": [],
    "skillPayoffs": [],
    "inventoryPayoffs": [],
    "priorFailurePayoffs": [],
    "promisePayoffs": [],
    "aftermathEchoes": []
  },
  
  "goalClock": {
    "name": "Objective name (e.g., 'Escape the Manor'). These labels surface in the player UI — write in SECOND PERSON ('you/your') or use the protagonist's name; NEVER use a third-person pronoun for the protagonist.",
    "segments": 6,
    "description": "What filling this clock represents. SECOND PERSON only for the protagonist ('how fully you allow yourself…'), never 'he/she/him/her' — clock text is player-facing and a wrong-gender pronoun here is a visible defect."
  },
  "threatClock": {
    "name": "Threat name (e.g., 'Guards Close In'). Player-facing label — second person or names only; no protagonist third-person pronouns.",
    "segments": 4,
    "description": "What filling this clock represents. SECOND PERSON only for the protagonist ('the city closes in on you…'), never 'he/she/him/her'."
  },
  
  "stakes": {
    "victory": "What player gains/achieves on victory",
    "defeat": "What player loses/suffers on defeat"
  },
  
  "pixarStakes": {
    "initialOddsAgainst": ${difficultyOdds[input.difficulty]},
    "whatPlayerLoses": "PERSONAL stakes - what ${input.protagonistInfo.name} specifically loses",
    "oddsAgainstNarrative": "Narrative text describing why odds are against them",
    "stackedObstacles": ["obstacle 1", "obstacle 2", "obstacle 3"],
    "physical": "What body / environment is on the line (e.g. 'The corridor is collapsing, one wrong step and the path is gone')",
    "emotional": "What heart is on the line (e.g. 'Marcus finally trusts you — betray him and that trust is dead')",
    "philosophical": "What belief / identity is on the line (e.g. 'If I hurt this stranger to save myself, who am I then?')"
  },

  "pixarSurprise": {
    "setup": "What the player currently EXPECTS to happen — the obvious read of the situation (1-2 sentences)",
    "twist": "What ACTUALLY happens that subverts the setup — a reversal, revelation, betrayal, or reframe (1-2 sentences)",
    "satisfaction": "Why the twist feels INEVITABLE in hindsight — the earlier detail / behavior that made it earn-able (1-2 sentences)"
  },
  
  "initialVisualState": {
    "characterPositions": {
      "protagonist": "center frame, defensive posture",
      "npc-id": "foreground right, aggressive stance"
    },
    "characterConditions": {},
    "environmentChanges": [],
    "propsInPlay": ["relevant props for the scene"],
    "currentLighting": "torch-lit corridor, warm tones",
    "tensionLevel": 3
  },

  "beats": [
    {
      "id": "beat-1",
      "phase": "setup",
      "storyboardFrameId": "${input.sceneId}-storyboard-commit",
      "storyboardRole": "commit",
      "name": "Opening Moment",
      "description": "The initial situation",
      "setupText": "2-3 sentences (~30-50 words). Establish the situation the player must react to.",
      "setupTextVariants": [
        {
          "condition": { "type": "relationship", "npcId": "npc-id", "dimension": "trust", "operator": "<", "value": -20 },
          "text": "Alternate setupText shown when NPC trust is very low — tone is colder, more hostile"
        },
        {
          "condition": { "type": "flag", "flag": "defended_protagonist", "value": true },
          "text": "Alternate setupText shown when player defended the protagonist earlier — NPC acknowledges it"
        }
      ],
      "cinematicSetup": {
        "sceneDescription": "The visual moment BEFORE the player chooses",
        "focusSubject": "protagonist",
        "cameraAngle": "wide_establishing",
        "shotType": "tension_hold",
        "mood": "anticipation",
        "characterStates": [
          { "characterId": "protagonist", "pose": "ready stance", "expression": "determined", "position": "center frame" },
          { "characterId": "opponent", "pose": "threatening", "expression": "menacing", "position": "foreground right" }
        ]
      },
      "choices": [
        {
          "id": "b1-c1",
          "text": "Bold action (5-10 words, imperative)",
          "approach": "aggressive",
          "impliedApproach": "aggressive",
          "primarySkill": "athletics",
          "statBonus": {
            "condition": { "type": "score", "score": "courage_shown", "operator": ">=", "value": 5 },
            "difficultyReduction": 15,
            "flavorText": "Your earlier show of courage steadies you now"
          },
          "outcomes": {
            "success": {
              "tier": "success",
              "narrativeText": "THE ACTION RESULT: 2-3 sentences showing the strike landing, the opponent reeling",
              "goalTicks": 2,
              "threatTicks": 0,
              "tacticalEffect": "Describe the changed position/leverage/information/exposure/relationship pressure/resource state/clocks/cost/storylet trajectory",
              "cinematicDescription": {
                "sceneDescription": "The IMPACT - protagonist's attack SUCCEEDS",
                "focusSubject": "the moment of impact",
                "cameraAngle": "low_heroic",
                "shotType": "impact",
                "mood": "triumphant",
                "characterStates": [
                  { "characterId": "protagonist", "pose": "follow-through", "expression": "fierce triumph" },
                  { "characterId": "opponent", "pose": "recoiling", "expression": "shock" }
                ]
              },
              "nextSituation": {
                "setupText": "The opponent staggers back. The path to the door is clear, but you hear shouts from the corridor.",
                "cinematicSetup": {
                  "sceneDescription": "New situation after success - protagonist has advantage",
                  "focusSubject": "protagonist surveying options",
                  "cameraAngle": "medium_action",
                  "shotType": "tension_hold",
                  "mood": "anticipation"
                },
                "choices": [
                  {
                    "id": "b1-c1-s-c1",
                    "text": "Rush for the door",
                    "approach": "aggressive",
                    "primarySkill": "athletics",
                    "outcomes": {
                      "success": {
                        "tier": "success",
                        "narrativeText": "You burst through the door just as guards round the corner",
                        "goalTicks": 2,
                        "threatTicks": 0,
                        "isTerminal": true,
                        "encounterOutcome": "victory"
                      },
                      "complicated": {
                        "tier": "complicated",
                        "narrativeText": "You reach the door but a guard blocks your path",
                        "goalTicks": 1,
                        "threatTicks": 1,
                        "nextSituation": {
                          "setupText": "A fresh guard stands between you and freedom.",
                          "choices": [/* 3+ choices continuing the tree */]
                        }
                      },
                      "failure": {
                        "tier": "failure",
                        "narrativeText": "The door is locked! You waste precious seconds.",
                        "goalTicks": 0,
                        "threatTicks": 2,
                        "nextSituation": {
                          "setupText": "Trapped. The first guard is recovering, and you hear more coming.",
                          "choices": [/* 3+ choices continuing the tree */]
                        }
                      }
                    }
                  },
                  {
                    "id": "b1-c1-s-c2",
                    "text": "Barricade the corridor",
                    "approach": "cautious",
                    "primarySkill": "perception",
                    "outcomes": { /* ... similar structure with 3 tiers */ }
                  },
                  {
                    "id": "b1-c1-s-c3",
                    "text": "Search him for keys",
                    "approach": "clever",
                    "primarySkill": "investigation",
                    "outcomes": { /* ... similar structure with 3 tiers */ }
                  }
                ]
              }
            },
            "complicated": {
              "tier": "complicated",
              "narrativeText": "THE ACTION RESULT: Your strike is deflected but you hold your ground",
              "goalTicks": 1,
              "threatTicks": 1,
              "cinematicDescription": {
                "sceneDescription": "The clash - blades locked, neither has advantage",
                "focusSubject": "locked weapons, faces close",
                "cameraAngle": "dutch_chaos",
                "shotType": "action_moment",
                "mood": "tense_uncertainty"
              },
              "nextSituation": {
                "setupText": "You're locked blade-to-blade, straining against each other. His breath is hot on your face.",
                "choices": [
                  {
                    "id": "b1-c1-p-c1",
                    "text": "Headbutt him",
                    "approach": "aggressive",
                    "outcomes": { /* ... DIFFERENT from success branch */ }
                  },
                  {
                    "id": "b1-c1-p-c2",
                    "text": "Push and disengage",
                    "approach": "cautious",
                    "outcomes": { /* ... DIFFERENT from success branch */ }
                  },
                  {
                    "id": "b1-c1-p-c3",
                    "text": "Twist his blade aside",
                    "approach": "clever",
                    "outcomes": { /* ... DIFFERENT from both above */ }
                  }
                ]
              }
            },
            "failure": {
              "tier": "failure",
              "narrativeText": "THE ACTION RESULT: He parries easily and drives you back against the wall",
              "goalTicks": 0,
              "threatTicks": 2,
              "cinematicDescription": {
                "sceneDescription": "The MISS - opponent deflects and protagonist is vulnerable",
                "focusSubject": "protagonist pressed against wall",
                "cameraAngle": "high_vulnerability",
                "shotType": "impact",
                "mood": "desperate"
              },
              "nextSituation": {
                "setupText": "Your back hits the cold stone. He advances, sword raised for the killing blow.",
                "choices": [
                  {
                    "id": "b1-c1-f-c1",
                    "text": "Grab a torch from the wall",
                    "approach": "desperate",
                    "outcomes": { /* ... DIFFERENT from success/complicated branches */ }
                  },
                  {
                    "id": "b1-c1-f-c2",
                    "text": "Shield yourself and brace",
                    "approach": "cautious",
                    "outcomes": { /* ... DIFFERENT */ }
                  },
                  {
                    "id": "b1-c1-f-c3",
                    "text": "Beg for mercy",
                    "approach": "social",
                    "outcomes": { /* ... DIFFERENT from both above */ }
                  }
                ]
              }
            }
          }
        },
        {
          "id": "b1-c2",
          "text": "Careful approach choice",
          "approach": "cautious",
          "impliedApproach": "cautious",
          "primarySkill": "perception",
          "outcomes": { /* ... similar branching structure */ }
        },
        {
          "id": "b1-c3",
          "text": "Choice unlocked by prior state (e.g., call on an ally, use leverage, invoke prior promise)",
          "approach": "clever",
          "primarySkill": "persuasion",
          "conditions": { "type": "flag", "flag": "prior_flag_name", "value": true },
          "showWhenLocked": true,
          "lockedText": "You'd need to have [done the prior action] to use this",
          "outcomes": { /* ... outcomes reflecting the earned advantage */ }
        }
      ]
    }
  ],
  
  "startingBeatId": "beat-1",
  
  "storylets": {
    "victory": {
      "id": "${input.sceneId}-storylet-victory",
      "name": "Victory Aftermath",
      "triggerOutcome": "victory",
      "tone": "triumphant",
      "narrativeFunction": "Show the win landing in-scene and what it changes going forward",
      "sequenceIntent": { "objective": "Aftermath objective", "activity": "victory aftermath sequence", "obstacle": "What still complicates the win", "startState": "Outcome lands", "turningPoint": "Growth or cost becomes visible", "endState": "Changed state going forward", "visualThread": "Visible consequence carried across panels" },
      "beats": [
        {
          "id": "${input.sceneId}-storylet-victory-beat-1",
          "text": "2-3 sentences: the world reacts to the success, and the character's steadier posture or changed circumstances are visible in the same beat.",
          "isTerminal": true
        }
      ],
      "startingBeatId": "${input.sceneId}-storylet-victory-beat-1",
      "consequences": [
        { "type": "score", "name": "confidence", "change": 5 },
        { "type": "score", "name": "USE_PRIMARY_SKILL_NAME_HERE", "change": 3 }
      ],
      "setsFlags": [{ "flag": "encounter_${input.sceneId}_victory", "value": true }],
      "nextSceneId": "${input.victoryNextSceneId || 'next-scene'}"
    },
    "defeat": {
      "id": "${input.sceneId}-storylet-defeat",
      "name": "Defeat Aftermath",
      "triggerOutcome": "defeat",
      "tone": "somber",
      "narrativeFunction": "Show cost of failure, create learning arc, build resolve for recovery",
      "beats": [
        {
          "id": "${input.sceneId}-storylet-defeat-beat-1",
          "text": "2-3 sentences: the immediate aftermath. Show what was lost. Somber but NOT hopeless."
        },
        {
          "id": "${input.sceneId}-storylet-defeat-beat-2",
          "text": "2-3 sentences: reflection and learning. A mentor, ally, or inner voice reveals insight. Reference the skill that was tested. Frame growth narratively."
        },
        {
          "id": "${input.sceneId}-storylet-defeat-beat-3",
          "text": "1-2 sentences: resolve. The character commits to moving forward, changed. A moment of determination.",
          "isTerminal": true
        }
      ],
      "startingBeatId": "${input.sceneId}-storylet-defeat-beat-1",
      "consequences": [
        { "type": "score", "name": "setbacks", "change": 1 },
        { "type": "score", "name": "resolve", "change": 3 },
        { "type": "score", "name": "USE_RELEVANT_SKILL_HERE", "change": 2 }
      ],
      "setsFlags": [{ "flag": "encounter_${input.sceneId}_defeat", "value": true }],
      "nextSceneId": "${input.defeatNextSceneId || 'next-scene'}"
    },
    "escape": {
      "id": "${input.sceneId}-storylet-escape",
      "name": "Narrow Escape",
      "triggerOutcome": "escape",
      "tone": "relieved",
      "narrativeFunction": "Tension release, assess what was gained and lost, build resourcefulness",
      "beats": [
        {
          "id": "${input.sceneId}-storylet-escape-beat-1",
          "text": "2-3 sentences: the tension of barely getting away. What was left behind."
        },
        {
          "id": "${input.sceneId}-storylet-escape-beat-2",
          "text": "1-2 sentences: taking stock. The character is wiser but the challenge remains.",
          "isTerminal": true
        }
      ],
      "startingBeatId": "${input.sceneId}-storylet-escape-beat-1",
      "consequences": [
        { "type": "score", "name": "resourcefulness", "change": 2 }
      ],
      "setsFlags": [{ "flag": "encounter_${input.sceneId}_escape", "value": true }],
      "nextSceneId": "${input.victoryNextSceneId || 'next-scene'}"
    }
  },
  
  "environmentalElements": [],
  "npcStates": [],
  "escalationTriggers": [],
  
  "informationVisibility": {
    "threatClockVisible": true,
    "npcTellsRevealAt": "encounter_50_percent",
    "environmentElementsHidden": [],
    "choiceOutcomesUnknown": true
  },
  
  "estimatedDuration": "medium",
  "replayability": "high",
  "designNotes": "Explain your branching design"
}

## CRITICAL REQUIREMENTS FOR BRANCHING TREES

1. **STORYBOARD IS MANDATORY**: Include 7-9 storyboard frames; place 2-4 decision windows inside the cinematic spine.
2. **CONTROLLED BRANCHING**: Each outcome should change tactical/emotional state and usually the next panel, but converge back to the spine when dramatically appropriate.
3. **ACTION/DRAMA RESULT VISUALS**: The narrativeText and cinematicDescription show THE RESULT of the player's action (hit/miss, confession received/rejected, patrol almost spotting them, clue recontextualized).
4. **DEPTH LIMIT**: Generate 1-2 layers of choices unless the scene truly needs more. Every situation with choices should have at least 3 choices.
4. **Prefer nextSituation for meaningful panel changes**. Use convergence to avoid runaway deep trees.
5. **TERMINAL OUTCOMES**: When goal/threat clocks would fill, mark outcome as terminal with appropriate encounterOutcome
6. **CONSEQUENCES DIFFER**: Success branches should trend toward victory, failure branches toward defeat - but not linearly
7. **THREE-APPROACH MANDATE**: Each set of 3+ choices should cover distinct approaches — one aggressive/direct, one cautious/methodical, one clever/unconventional. This ensures the player always has meaningfully different paths, not just variations on the same tactic.
7. First beat choices MUST include \`impliedApproach\` field
8. ALL THREE STORYLETS (victory, defeat, escape) MUST be defined
8a. Include sequenceIntent on the storyboard and storylets. It is optional for legacy data compatibility but required-by-process for new output so storyboard panels read as one cinematic sequence with a narrative objective, visual thread, turning point, and aftermath state; aftermath panels have a narrative objective rather than loose epilogue stillness.
9. Text length: setupText ~30-50 words, narrativeText ~30-60 words
10. Return ONLY valid JSON, no markdown
11. Do not add any new visible mechanics beyond the current encounter clock visualization.

${PROSE_AND_DIALOGUE_CRAFT}
## PROTAGONIST LANGUAGE (CRITICAL)

All encounter text (setupText, narrativeText, storylet beat text) MUST use concrete player-facing prose.
Use the protagonist's actual name, concrete pronouns, or direct second person ("you", "your"). Never emit template variables or unresolved placeholders.

Opening POV anchor: the first setupText / opening storylet text MUST establish the protagonist as the viewpoint/focal character before focusing on NPCs, setting, or threat.
NPCs should be referred to by their actual names.

## TEXT QUALITY - ACTION/REACTION

- **narrativeText** = THE ACTION RESULT: "Your blade bites into his shoulder" not "You attack him"
- **nextSituation.setupText** = THE NEW SITUATION: "He drops his sword, clutching the wound. Behind him, the door stands open."
- The IMAGE shows the ACTION RESULT, the TEXT describes the ACTION RESULT
- The nextSituation shows what comes NEXT

## BRANCHING PHILOSOPHY

Think of this like a "choose your own adventure" TREE, not a linear path:
- If I succeed at intimidation → the guard backs down, new options
- If I fail at intimidation → the guard attacks, completely different options
- If it's complicated → standoff, third set of options

The DRAMA comes from seeing genuinely different outcomes based on skill checks, not just different flavor text leading to the same place.

## OUTCOME TRAJECTORY — How Branches Feel

The player should FEEL whether they're winning or losing as they progress through the encounter tree:

- **After SUCCESS**: The next situation should feel more hopeful. Choices open up — you're on the front foot. The narrative signals momentum ("The path clears", "You press the advantage"). Goal clock ticks should accumulate visibly.
- **After COMPLICATED**: The next situation should feel tense and precarious. You gained something but the threat is real. Choices should force hard tradeoffs ("Save the hostage or chase the villain"). Both clocks tick.
- **After FAILURE**: The next situation should feel desperate but not hopeless. Choices shift to survival and creative improvisation, the environment closes in, but there's always a path back. Threat clock pressure mounts.

The player should be able to intuit "I'm on a path toward victory" or "I'm struggling and need to turn this around." This is not about telling them — it's about the TONE and STAKES of each successive situation escalating in the right direction.

## TENSION THROUGH CHOICE DESIGN

- At EVERY depth level, present at least 3 choices that feel distinct in risk/reward
- As depth increases, the STAKES of each choice should rise — not the number decrease
- Deeper choices should feel more consequential: early choices are probing, late choices are all-in
- Terminal outcomes (isTerminal: true) should feel like natural climaxes, not arbitrary cutoffs
- When a branch trends toward defeat, choices should shift from "how do I win?" to "how do I survive?" — this IS the tension
`;
  }

  /**
   * Simplified prompt for final retry attempt.
   * Requests a flat 2-beat encounter with simpler structure — still LLM-generated
   * with story-specific content, but without deep branching trees.
   * This avoids token exhaustion and produces valid encounters reliably.
   */
  private buildSimplifiedPrompt(input: EncounterArchitectInput): string {
    const protagonist = input.protagonistInfo.name || 'the protagonist';
    const antagonist = input.npcsInvolved.find(n => n.role === 'enemy')?.name ||
                       input.npcsInvolved[0]?.name || 'the opponent';
    const skill1 = input.availableSkills[0]?.name || 'athletics';
    const skill2 = input.availableSkills[1]?.name || 'perception';
    const skill3 = input.availableSkills[2]?.name || 'persuasion';

    return `
Generate a SIMPLE 2-beat encounter for the following scene. This is a simplified request — focus on producing valid, complete JSON.

## Scene
- Scene ID: ${input.sceneId}
- Scene Name: ${input.sceneName}
- Description: ${input.sceneDescription}
- Planned Encounter ID: ${input.plannedEncounterId || 'none'}
- Type: ${input.encounterType}
- Difficulty: ${input.difficulty}
- Stakes: ${input.encounterStakes || 'Keep the stakes personal and specific to the protagonist'}
${this.formatEncounterStoryCircleTarget(input)}
- Relevant Skills: ${(input.encounterRelevantSkills || []).join(', ') || `${skill1}, ${skill2}, ${skill3}`}
- Beat Plan:
${(input.encounterBeatPlan && input.encounterBeatPlan.length > 0)
  ? input.encounterBeatPlan.map((beat, index) => `  ${index + 1}. ${beat}`).join('\n')
  : '  1. Opening pressure\n  2. Crisis and resolution'}
- Story: ${input.storyContext.title} (${input.storyContext.genre}, ${input.storyContext.tone})
- Protagonist: ${protagonist} (${input.protagonistInfo.pronouns})
- Key NPC: ${antagonist}

## Genre-Aware Jeopardy
${buildGenreAwareJeopardyGuidance(input.storyContext.genre)}

## CHARACTER NAME TEMPLATES (CRITICAL)
All text fields (setupText, narrativeText, storylet text) MUST use the protagonist's actual name, concrete pronouns, or you/your. Never emit template variables.
NPCs use their actual names.
The opening setupText MUST anchor POV to the protagonist before describing NPC action or the environment.

## REQUIRED: Return ONLY this JSON structure (no markdown, no prose)

The "beats" array MUST have exactly 2 beats. Each beat MUST have 3 choices (aggressive, cautious, clever). Each choice MUST have success/complicated/failure outcomes. Even in this simplified retry, the encounter must still honor the supplied stakes and beat plan.

Beat 1 = "setup" phase (the opening confrontation)
Beat 2 = "resolution" phase (the climax, all outcomes are terminal)

{
  "sceneId": "${input.sceneId}",
  "encounterType": "${input.encounterType}",
  "goalClock": { "name": "string", "segments": 6, "description": "string" },
  "threatClock": { "name": "string", "segments": 4, "description": "string" },
  "stakes": { "victory": "string", "defeat": "string" },
  "beats": [
    {
      "id": "beat-1",
      "phase": "setup",
      "name": "Opening Moment",
      "description": "string",
      "setupText": "2-3 sentences about the initial situation (30-50 words)",
      "choices": [
        {
          "id": "b1-c1",
          "text": "Bold action (5-10 words)",
          "approach": "aggressive",
          "impliedApproach": "aggressive",
          "primarySkill": "${skill1}",
          "outcomes": {
            "success": { "tier": "success", "narrativeText": "2-3 sentences of result", "goalTicks": 2, "threatTicks": 0, "nextBeatId": "beat-2" },
            "complicated": { "tier": "complicated", "narrativeText": "2-3 sentences", "goalTicks": 1, "threatTicks": 1, "nextBeatId": "beat-2" },
            "failure": { "tier": "failure", "narrativeText": "2-3 sentences", "goalTicks": 0, "threatTicks": 2, "nextBeatId": "beat-2" }
          }
        },
        {
          "id": "b1-c2",
          "text": "Careful approach (5-10 words)",
          "approach": "cautious",
          "impliedApproach": "cautious",
          "primarySkill": "${skill2}",
          "outcomes": {
            "success": { "tier": "success", "narrativeText": "string", "goalTicks": 2, "threatTicks": 0, "nextBeatId": "beat-2" },
            "complicated": { "tier": "complicated", "narrativeText": "string", "goalTicks": 1, "threatTicks": 1, "nextBeatId": "beat-2" },
            "failure": { "tier": "failure", "narrativeText": "string", "goalTicks": 0, "threatTicks": 2, "nextBeatId": "beat-2" }
          }
        },
        {
          "id": "b1-c3",
          "text": "Clever trick (5-10 words)",
          "approach": "clever",
          "impliedApproach": "clever",
          "primarySkill": "${skill3}",
          "outcomes": {
            "success": { "tier": "success", "narrativeText": "string", "goalTicks": 2, "threatTicks": 0, "nextBeatId": "beat-2" },
            "complicated": { "tier": "complicated", "narrativeText": "string", "goalTicks": 1, "threatTicks": 1, "nextBeatId": "beat-2" },
            "failure": { "tier": "failure", "narrativeText": "string", "goalTicks": 0, "threatTicks": 2, "nextBeatId": "beat-2" }
          }
        }
      ]
    },
    {
      "id": "beat-2",
      "phase": "resolution",
      "name": "Critical Moment",
      "description": "string",
      "setupText": "2-3 sentences about the climactic moment (30-50 words)",
      "isTerminal": true,
      "choices": [
        {
          "id": "b2-c1",
          "text": "Go for victory (5-10 words)",
          "approach": "bold",
          "primarySkill": "${skill1}",
          "outcomes": {
            "success": { "tier": "success", "narrativeText": "string", "goalTicks": 3, "threatTicks": 0, "isTerminal": true, "encounterOutcome": "victory" },
            "complicated": { "tier": "complicated", "narrativeText": "string", "goalTicks": 2, "threatTicks": 1, "isTerminal": true, "encounterOutcome": "partialVictory", "cost": { "immediateEffect": "1 sentence: the concrete price paid right now", "visibleComplication": "1 sentence: the visible complication that follows the protagonist out" } },
            "failure": { "tier": "failure", "narrativeText": "string", "goalTicks": 0, "threatTicks": 3, "isTerminal": true, "encounterOutcome": "defeat" }
          }
        },
        {
          "id": "b2-c2",
          "text": "Hold your ground (5-10 words)",
          "approach": "cautious",
          "primarySkill": "${skill2}",
          "outcomes": {
            "success": { "tier": "success", "narrativeText": "string", "goalTicks": 2, "threatTicks": 0, "isTerminal": true, "encounterOutcome": "victory" },
            "complicated": { "tier": "complicated", "narrativeText": "string", "goalTicks": 1, "threatTicks": 1, "isTerminal": true, "encounterOutcome": "escape" },
            "failure": { "tier": "failure", "narrativeText": "string", "goalTicks": 0, "threatTicks": 2, "isTerminal": true, "encounterOutcome": "defeat" }
          }
        },
        {
          "id": "b2-c3",
          "text": "Find another way (5-10 words)",
          "approach": "clever",
          "primarySkill": "${skill3}",
          "outcomes": {
            "success": { "tier": "success", "narrativeText": "string", "goalTicks": 2, "threatTicks": 0, "isTerminal": true, "encounterOutcome": "victory" },
            "complicated": { "tier": "complicated", "narrativeText": "string", "goalTicks": 1, "threatTicks": 1, "isTerminal": true, "encounterOutcome": "escape" },
            "failure": { "tier": "failure", "narrativeText": "string", "goalTicks": 0, "threatTicks": 2, "isTerminal": true, "encounterOutcome": "defeat" }
          }
        }
      ]
    }
  ],
  "startingBeatId": "beat-1",
  "tensionCurve": [
    { "beatId": "beat-1", "tensionLevel": 5, "description": "Setup tension" },
    { "beatId": "beat-2", "tensionLevel": 9, "description": "Climax tension" }
  ],
  "storylets": {
    "victory": {
      "id": "${input.sceneId}-storylet-victory",
      "name": "Victory Aftermath",
      "triggerOutcome": "victory",
      "tone": "triumphant",
      "narrativeFunction": "Show the win landing in-scene and what it changes going forward",
      "beats": [{ "id": "${input.sceneId}-sv-1", "text": "1-2 sentences of victory aftermath", "isTerminal": true }],
      "startingBeatId": "${input.sceneId}-sv-1",
      "consequences": [],
      "nextSceneId": "${input.victoryNextSceneId || 'next-scene'}"
    },
    "defeat": {
      "id": "${input.sceneId}-storylet-defeat",
      "name": "Defeat Aftermath",
      "triggerOutcome": "defeat",
      "tone": "somber",
      "narrativeFunction": "Show consequences",
      "beats": [{ "id": "${input.sceneId}-sd-1", "text": "1-2 sentences of defeat aftermath", "isTerminal": true }],
      "startingBeatId": "${input.sceneId}-sd-1",
      "consequences": [],
      "nextSceneId": "${input.defeatNextSceneId || 'next-scene'}"
    },
    "escape": {
      "id": "${input.sceneId}-storylet-escape",
      "name": "Narrow Escape",
      "triggerOutcome": "escape",
      "tone": "relieved",
      "narrativeFunction": "Tension release",
      "beats": [{ "id": "${input.sceneId}-se-1", "text": "1-2 sentences of escape aftermath", "isTerminal": true }],
      "startingBeatId": "${input.sceneId}-se-1",
      "consequences": [],
      "nextSceneId": "${input.victoryNextSceneId || 'next-scene'}"
    }
  },
  "environmentalElements": [],
  "npcStates": [],
  "escalationTriggers": [],
  "informationVisibility": { "threatClockVisible": true, "npcTellsRevealAt": "encounter_50_percent", "environmentElementsHidden": [], "choiceOutcomesUnknown": true },
  "estimatedDuration": "medium",
  "replayability": "medium",
  "designNotes": "Simplified encounter structure"
}

CRITICAL RULES:
1. Replace ALL "string" placeholders with actual narrative content specific to this scene
2. narrativeText should describe THE RESULT of the action (sword hitting/missing, plea accepted/rejected)
3. setupText should set the scene vividly in 30-50 words
4. Return ONLY the JSON object — no markdown, no backticks, no explanation text
5. The "beats" array MUST contain at least ${this.getMinimumRequiredBeatCount(input)} objects and must honor the encounterBeatPlan
`;
  }

  private validateStructure(structure: EncounterStructure, input: EncounterArchitectInput): void {
    const progressionDepth = this.getEncounterProgressionDepth(structure);
    // Accept either 2+ top-level beats or a tree with 2+ reachable stages.
    if (structure.beats.length < 2 && progressionDepth < 2) {
      throw new Error(
        `Encounter must have at least 2 stages of progression but got ${structure.beats.length} top-level beat(s) and progression depth ${progressionDepth}. The LLM did not generate sufficient encounter content.`
      );
    }

    // G12 backstop: a sustained set piece needs ≥3 TOP-LEVEL beats — nested
    // choice trees don't count, because the runtime converter emits one phase
    // and one tension-curve point per top-level beat, and the set-piece depth
    // gate requires phases>=2 || curve>=3. Rejecting here sends the attempt to
    // the retry/fallback ladder instead of shipping a collapsed siege.
    if (this.isSustainedSetPieceInput(input) && structure.beats.length < 3) {
      throw new Error(
        `Encounter is staged as a sustained set piece but has only ${structure.beats.length} top-level beat(s); ` +
        `it needs at least 3 escalating beats (e.g. breach → repulse → decisive choice) to dramatize the sequence.`
      );
    }

    // Enforce minimum 3 choices per top-level beat
    for (const beat of structure.beats) {
      const choiceCount = beat.choices?.length || 0;
      if (choiceCount < 3) {
        throw new Error(
          `Beat "${beat.id}" has ${choiceCount} choice(s) but needs at least 3. ` +
          `The LLM must provide aggressive, cautious, and clever approaches.`
        );
      }
    }

    // Nested situations are reader-facing choice points too; enforce the same
    // 3-4 option contract used by regular choices.
    const warnNestedChoices = (choices: any[], path: string) => {
      for (const choice of choices) {
        if (!choice.outcomes) continue;
        for (const tier of ['success', 'complicated', 'failure'] as const) {
          const outcome = choice.outcomes[tier];
          if (outcome?.nextSituation?.choices) {
            const nested = outcome.nextSituation.choices;
            if (nested.length < 3 || nested.length > 4) {
              throw new Error(
                `[EncounterArchitect] ${path} → ${choice.id} → ${tier} has ${nested.length} nested choice(s); ` +
                `reader-facing encounter situations need 3-4 choices.`
              );
            }
            warnNestedChoices(nested, `${path} → ${choice.id} → ${tier}`);
          }
        }
      }
    };
    for (const beat of structure.beats) {
      if (beat.choices) warnNestedChoices(beat.choices, beat.id);
    }

    this.validatePlayableOutcomeRouting(structure);

    // Check starting beat exists
    const startingBeat = structure.beats.find(b => b.id === structure.startingBeatId);
    if (!startingBeat) {
      console.warn(`[EncounterArchitect] Starting beat ${structure.startingBeatId} not found - using first beat`);
      structure.startingBeatId = structure.beats[0].id;
    }

    this.requireAuthoredStorylets(structure.storylets, input, 'validateStructure');

    const storyboardFrames = structure.storyboard?.spine || [];
    if (storyboardFrames.length > 0) {
      const decisionWindows = storyboardFrames.filter(frame => frame.decisionWindow).length;
      if (storyboardFrames.length < 7) {
        console.warn(`[EncounterArchitect] Storyboard has ${storyboardFrames.length} frame(s); target is 7-9 for cinematic encounter flow.`);
      }
      if (decisionWindows < 2) {
        console.warn(`[EncounterArchitect] Storyboard has ${decisionWindows} decision window(s); target is 2-4 meaningful tactical windows.`);
      }
      if (structure.storyboard?.mechanicsVisibility !== 'current_clocks_only') {
        console.warn('[EncounterArchitect] Storyboard mechanicsVisibility must remain current_clocks_only; normalizing.');
        structure.storyboard!.mechanicsVisibility = 'current_clocks_only';
      }
    }

    // Check beat flow
    const beatIds = new Set(structure.beats.map(b => b.id));
    for (const beat of structure.beats) {
      if (!beat.isTerminal) {
        if (beat.nextBeatOnSuccess && !beatIds.has(beat.nextBeatOnSuccess)) {
          console.warn(`Beat ${beat.id} references non-existent success beat: ${beat.nextBeatOnSuccess}`);
        }
        if (beat.nextBeatOnFailure && !beatIds.has(beat.nextBeatOnFailure)) {
          console.warn(`Beat ${beat.id} references non-existent failure beat: ${beat.nextBeatOnFailure}`);
        }
      }
    }

    // Mark last beat as terminal if needed
    const terminalBeats = structure.beats.filter(b => b.isTerminal);
    if (terminalBeats.length === 0) {
      const lastBeat = structure.beats[structure.beats.length - 1];
      lastBeat.isTerminal = true;
    }

    // Validate text lengths
    const MAX_SETUP_WORDS = 60;
    for (const beat of structure.beats) {
      if (beat.setupText) {
        const wordCount = beat.setupText.split(/\s+/).length;
        if (wordCount > MAX_SETUP_WORDS) {
          console.warn(`[EncounterArchitect] Beat ${beat.id} has ${wordCount} words (max ${MAX_SETUP_WORDS}). Auto-trimming...`);
          const sentences = beat.setupText.match(/[^.!?]+[.!?]+/g) || [beat.setupText];
          if (sentences.length >= 2) {
            beat.setupText = sentences.slice(0, 2).join(' ').trim();
          } else {
            const words = beat.setupText.split(/\s+/).slice(0, 50);
            beat.setupText = words.join(' ') + '...';
          }
        }
      }
    }

    // Log validation summary
    console.log(`[EncounterArchitect] Validation passed:
  - ${structure.beats.length} top-level beats
  - progression depth ${progressionDepth}
  - ${structure.storylets.victory ? 'Victory' : 'NO'} / ${structure.storylets.defeat ? 'Defeat' : 'NO'} / ${structure.storylets.escape ? 'Escape' : 'NO'} storylets
  - ${structure.environmentalElements?.length || 0} environmental elements
  - ${structure.npcStates?.length || 0} NPC states
  - ${structure.escalationTriggers?.length || 0} escalation triggers`);
  }

  // ========================================================================
  // PHASED ENCOUNTER GENERATION
  // ========================================================================

  /**
   * Multi-phase encounter generation. Breaks the monolithic LLM call into
   * smaller, focused calls that each produce 1-2K tokens of flat JSON.
   *
   * Flow:
   *  0. Relationship Dynamics Analysis (deterministic, instant)
   *  1. Phase 1: Opening beat (1 call, ~1.5K tokens)
   *  2. Phase 2a/2b/2c: Branch situations (3 parallel calls, ~2K each)
   *     Phase 3: Enrichment (1 call, ~1K) — parallel with Phase 2
   *     Phase 4: Storylets (1 call, ~1.5K) — parallel with Phase 2
   *  3. Deterministic assembly → EncounterStructure
   */
  async executePhased(
    input: EncounterArchitectInput,
    playerRelationships?: Record<string, Relationship>,
    allNpcs?: NPCInfo[],
  ): Promise<AgentResponse<EncounterStructure>> {
    console.log(`[EncounterArchitect] Starting phased generation for scene: ${input.sceneId}`);
    const phasedStart = Date.now();

    // ---- Pre-phase: Relationship dynamics analysis (deterministic) ----
    const npcInfos: NPCInfo[] = input.npcsInvolved.map(n => ({
      id: n.id, name: n.name, role: n.role,
    }));
    const relSnapshot: RelationshipSnapshot = {
      current: playerRelationships || {},
    };
    const dynamicsBrief = analyzeRelationshipDynamics(npcInfos, relSnapshot, allNpcs);
    console.log(`[EncounterArchitect] Relationship analysis: ${dynamicsBrief.npcDynamics.length} NPCs, ${dynamicsBrief.knockOnEffects.length} knock-on effects`);

    // Collector for per-attempt phase failures (no longer swallowed silently).
    const phaseErrors: EncounterPhaseError[] = [];

    // ---- Phase 1: Opening beat ----
    // NO deterministic fallback here (no-boilerplate mandate): a phase-1
    // budget/safety failure is structurally unsafe to "rescue" with the larger
    // legacy prompt. Wrap it with phase telemetry so execute() can fail closed
    // and let the caller's regen loop re-author the encounter.
    let phase1: Phase1Result;
    try {
      phase1 = await this.runPhase1(input, dynamicsBrief, phaseErrors);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new EncounterPhasedGenerationError(
        `Encounter ${input.sceneId} Phase 1 failed to generate an authored opening beat; refusing legacy fallback. ${reason}`,
        phaseErrors,
      );
    }
    console.log(`[EncounterArchitect] Phase 1 complete: ${phase1.openingBeat.choices.length} choices`);

    // ---- Phases 2, 3, 4 ----
    // Phase 2 runs at bounded concurrency (2) rather than full fan-out so the
    // branch calls reuse the warm keep-alive connection and a transient stall
    // doesn't time out every branch at once (the root of phase2:[F,F,F]).
    const phase2Promise = mapWithConcurrency(
      phase1.openingBeat.choices,
      EncounterArchitect.PHASE2_CONCURRENCY,
      (choice) =>
        this.runPhase2(input, dynamicsBrief, choice, phaseErrors).catch(() => null),
    );

    const phase3Ran = !!input.priorStateContext;
    const phase3Promise = phase3Ran
      ? this.runPhase3(input, phase1, phaseErrors).catch(() => null)
      : Promise.resolve(null);

    const phase4Promise = this.runPhase4(input, dynamicsBrief, phaseErrors).catch(() => null);

    const [phase2Results, phase3Result, phase4Result] = await Promise.all([
      phase2Promise,
      phase3Promise,
      phase4Promise,
    ]);

    console.log(`[EncounterArchitect] Parallel phases complete: Phase2=[${phase2Results.map(r => r ? 'OK' : 'FAIL').join(',')}] Phase3=${phase3Result ? 'OK' : 'SKIP/FAIL'} Phase4=${phase4Result ? 'OK' : 'FAIL'}`);

    // ---- Deterministic Assembly ----
    if (!phase4Result) {
      throw new EncounterPhase4GenerationError(
        `Encounter ${input.sceneId} Phase 4 failed to generate authored storylets; refusing default storylet fallback.`,
        phaseErrors,
      );
    }

    let structure = this.assemblePhasedEncounter(input, phase1, phase2Results, phase3Result, phase4Result, dynamicsBrief);
    this.requireAuthoredStorylets(structure.storylets, input, 'phased assembly');
    structure = this.normalizeStructure(structure, input);
    this.validateStructure(structure, input);

    const totalMs = Date.now() - phasedStart;
    console.log(`[EncounterArchitect] Phased generation complete in ${totalMs}ms for ${input.sceneId}`);

    const phase2Ok = phase2Results.map(r => r !== null);
    const phase3Ok = phase3Result !== null;
    const phase4Ok = phase4Result !== null;
    const anyGap = phase2Ok.some(ok => !ok) || (phase3Ran && !phase3Ok) || !phase4Ok;

    // If the build degraded (lost branching rounds), shrink the goal/threat
    // clocks DOWN to the authored coverage so the encounter ships an honest
    // clock instead of leaving segments the player can never fill. Only fires
    // on a degraded + genuinely under-covered encounter; never raises a clock.
    if (anyGap) {
      const shrank = shrinkClockToCoverage(structure as any);
      if (shrank) {
        console.warn(`[EncounterArchitect] Encounter ${input.sceneId} degraded — shrank clocks to authored coverage (goal=${(structure as any).goalClock?.segments}, threat=${(structure as any).threatClock?.segments}).`);
      }
    }
    const telemetry: EncounterTelemetry = {
      sceneId: input.sceneId,
      mode: anyGap ? 'phased_with_gaps' : 'phased_success',
      phase1Ok: true,
      phase2: phase2Ok,
      phase3Ran,
      phase3Ok,
      phase4Ok,
      llmCallCount:
        1 /* phase 1 (min) */ +
        phase1.openingBeat.choices.length /* one call per opening-beat choice */ +
        (phase3Ran ? 1 : 0) /* phase 3 only runs when priorStateContext */ +
        1 /* phase 4 */ +
        phaseErrors.length /* extra retry attempts that failed */,
      msElapsed: totalMs,
      phase4DefaultCollisions: this.detectDefaultStoryletCollisions(structure, input),
      phaseErrors,
      degraded: anyGap,
    };

    return { success: true, data: structure, metadata: { encounterTelemetry: telemetry } };
  }

  private hasUnsafePhasedFallbackFailure(phaseErrors: EncounterPhaseError[] | undefined): boolean {
    return (phaseErrors ?? []).some((error) => {
      const unsafeReason = error.reason === 'max_tokens' || error.reason === 'safety' || error.reason === 'recitation';
      if (!unsafeReason) return false;
      // Phase 1/4: fail closed — no lean escalation (already compact or at floor).
      if (error.phase === 'phase1' || error.phase.startsWith('phase4')) return true;
      // Phase 2/3 max_tokens: compact retry exhausted — the lean flow asks for
      // MORE output in one call; refuse that escalation hole (P1).
      if (error.reason === 'max_tokens' && (error.phase.startsWith('phase2') || error.phase === 'phase3')) return true;
      return false;
    });
  }

  private validatePlayableOutcomeRouting(structure: EncounterStructure): void {
    let hasVictoryPath = false;
    let hasPartialVictoryPath = false;
    let hasDefeatPath = false;

    const storyletSlots: Partial<EncounterStructure['storylets']> = structure.storylets || {};
    const isValidTerminalOutcome = (outcome: EncounterChoiceOutcome): boolean => {
      if (!outcome.isTerminal || !outcome.encounterOutcome) return false;
      if (outcome.encounterOutcome === 'partialVictory') return Boolean(storyletSlots.partialVictory?.beats?.length);
      if (outcome.encounterOutcome === 'victory') return Boolean(storyletSlots.victory?.beats?.length);
      if (outcome.encounterOutcome === 'defeat') return Boolean(storyletSlots.defeat?.beats?.length);
      if (outcome.encounterOutcome === 'escape') return Boolean(storyletSlots.escape?.beats?.length);
      return false;
    };

    const visitChoices = (choices: Array<EncounterChoice | EmbeddedEncounterChoice> | undefined, path: string): void => {
      for (const choice of choices || []) {
        for (const tier of ['success', 'complicated', 'failure'] as const) {
          const outcome = choice.outcomes?.[tier];
          if (!outcome) {
            throw new Error(`[EncounterArchitect] Choice "${choice.text}" at ${path} is missing the ${tier} outcome.`);
          }

          if (outcome.encounterOutcome === 'victory' || outcome.nextBeatId?.includes('victory')) hasVictoryPath = true;
          if (outcome.encounterOutcome === 'partialVictory') hasPartialVictoryPath = true;
          if (outcome.encounterOutcome === 'defeat' || outcome.nextBeatId?.includes('defeat')) hasDefeatPath = true;

          if (outcome.nextSituation) {
            visitChoices(outcome.nextSituation.choices, `${path} -> ${choice.id}:${tier}`);
            continue;
          }
          if (outcome.nextBeatId) continue;
          if (isValidTerminalOutcome(outcome)) continue;

          throw new Error(
            `[EncounterArchitect] Outcome ${tier} for "${choice.text}" at ${path} has neither nextSituation, ` +
            `nextBeatId, nor a valid terminal encounterOutcome with authored storylet aftermath.`
          );
        }
      }
    };

    for (const beat of structure.beats) {
      visitChoices(beat.choices, beat.id);
    }

    if (!hasVictoryPath && !hasPartialVictoryPath) {
      throw new Error('[EncounterArchitect] Encounter has no authored victory or partialVictory path.');
    }
    if (!hasDefeatPath) {
      throw new Error('[EncounterArchitect] Encounter has no authored defeat path.');
    }
  }

  // ---- Phase 1: Opening Beat ----

  /**
   * Run one encounter phase with a real timeout (withTimeoutAbort cancels the
   * in-flight fetch and halts retries on timeout) plus a retry with a FRESH
   * timeout window. Each attempt is recorded in `errorSink` on failure so
   * degraded encounters are auditable instead of silently swallowed.
   *
   * Note: `callLLM` keeps its own internal retry (maxRetries 1) for fast,
   * transient connection errors WITHIN one timeout window; this outer loop adds
   * recovery from a whole-attempt timeout/parse failure. We deliberately do NOT
   * also raise callLLM's retries — stacking more attempts under 180–240s windows
   * grows worstCasePhaseBudgetMs() toward the 25-min encounter budget.
   */
  private async runPhaseWithRetry<T>(
    label: string,
    timeoutMs: number,
    errorSink: EncounterPhaseError[],
    fn: (signal: AbortSignal, attempt: number, previousReason?: EncounterPhaseError['reason']) => Promise<T>,
  ): Promise<T> {
    let lastErr: unknown;
    let previousReason: EncounterPhaseError['reason'] | undefined;
    for (let attempt = 1; attempt <= EncounterArchitect.PHASE_RETRY_ATTEMPTS; attempt++) {
      const started = Date.now();
      try {
        return await withTimeoutAbort((signal) => fn(signal, attempt, previousReason), timeoutMs, `EncounterArchitect.${label}`);
      } catch (err) {
        lastErr = err;
        previousReason = classifyPhaseError(err);
        errorSink.push({ phase: label, attempt, reason: previousReason, ms: Date.now() - started });
        console.warn(`[EncounterArchitect] ${label} attempt ${attempt}/${EncounterArchitect.PHASE_RETRY_ATTEMPTS} failed: ${err instanceof Error ? err.message : err}`);
        if (attempt < EncounterArchitect.PHASE_RETRY_ATTEMPTS) {
          const backoff = 800 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 400);
          await new Promise((r) => setTimeout(r, backoff));
        }
      }
    }
    throw lastErr;
  }

  private async runPhase1(
    input: EncounterArchitectInput,
    brief: RelationshipDynamicsBrief,
    errorSink: EncounterPhaseError[],
  ): Promise<Phase1Result> {
    return this.runPhaseWithRetry('phase1', EncounterArchitect.PHASE1_TIMEOUT_MS, errorSink, async (signal, _attempt, previousReason) => {
      const compactRetry = previousReason === 'max_tokens' || previousReason === 'recitation' || previousReason === 'safety';
      const messages: AgentMessage[] = [{ role: 'user', content: this.buildPhase1Prompt(input, brief, { compactRetry }) }];
      const response = await this.callLLM(messages, 1, {
        signal,
        jsonSchema: compactRetry ? buildEncounterPhase1CompactJsonSchema() : buildEncounterPhase1JsonSchema(),
      });
      return this.parseJSON<Phase1Result>(response);
    });
  }

  private buildPhase1Prompt(
    input: EncounterArchitectInput,
    brief: RelationshipDynamicsBrief,
    options: { compactRetry?: boolean } = {},
  ): string {
    const protagonist = input.protagonistInfo.name || 'the protagonist';
    const npcsList = input.npcsInvolved
      .map(npc => `- ${npc.name} (${npc.id}, ${npc.pronouns}): ${npc.role} — ${npc.description}${npc.voiceNotes ? `\n  Voice: ${npc.voiceNotes}` : ''}`)
      .join('\n');
    const skillsList = input.availableSkills.slice(0, 6)
      .map(s => `${s.name} (${s.attribute})`)
      .join(', ');

    const relationshipSection = brief.briefText
      ? `\n## Relationship Dynamics\n${brief.briefText}\n`
      : '';

    if (options.compactRetry) {
      const npcNames = input.npcsInvolved
        .slice(0, 5)
        .map((npc) => `${npc.name} (${npc.id}, ${npc.pronouns})`)
        .join(', ');
      const authoredBeats = (input.encounterBeatPlan ?? [])
        .slice(0, 4)
        .map((beat, index) => `${index + 1}. ${beat}`)
        .join('\n');
      const continuity = input.episodeSoFarSummary?.trim()
        ? `\nContinuity: ${input.episodeSoFarSummary.slice(0, 320)}`
        : '';
      return `Generate the OPENING BEAT of a ${input.encounterType} encounter. Return ONLY valid JSON.

## COMPACT PHASE 1 RETRY
The prior Gemini attempt exhausted its structured output budget. Keep this answer tiny and complete.
- No markdown, commentary, alternate drafts, analysis, or extra schema fields.
- setupText: 2 sentences, 45 words maximum.
- exactly 3 choices only: aggressive, cautious, clever.
- choice text: 8 words maximum.
- every outcome narrativeText: 1 sentence, 35 words maximum.
- Omit reminderPlan and feedbackCue.
- Use second person for ${protagonist}; never expose stats, dice, DCs, or system math.

## Scene
- ID: ${input.sceneId}
- Name: ${input.sceneName}
- Situation: ${input.sceneDescription.slice(0, 360)}
- Stakes: ${(input.encounterStakes || 'Keep stakes personal').slice(0, 260)}
${this.formatEncounterStoryCircleTarget(input)}
- Skills: ${skillsList}
- NPCs: ${npcNames || 'None'}${continuity}
${authoredBeats ? `\n## Must Touch These Beats\n${authoredBeats}\n` : ''}${formatForbiddenRevealsSection(input.forbiddenReveals ?? [])}
## Required JSON Shape (no extra fields)
{
  "sceneId": "${input.sceneId}",
  "encounterType": "${input.encounterType}",
  "goalClock": { "name": "short string", "segments": 6, "description": "short string" },
  "threatClock": { "name": "short string", "segments": 4, "description": "short string" },
  "stakes": { "victory": "short string", "defeat": "short string" },
  "openingBeat": {
    "setupText": "45 words max",
    "choices": [
      {
        "id": "c1",
        "text": "8 words max",
        "approach": "aggressive",
        "primarySkill": "one listed skill",
        "impliedApproach": "aggressive",
        "consequenceDomain": "relationship",
        "outcomes": {
          "success": { "narrativeText": "35 words max", "goalTicks": 2, "threatTicks": 0 },
          "complicated": { "narrativeText": "35 words max", "goalTicks": 1, "threatTicks": 1 },
          "failure": { "narrativeText": "35 words max", "goalTicks": 0, "threatTicks": 2 }
        }
      },
      {
        "id": "c2",
        "text": "8 words max",
        "approach": "cautious",
        "primarySkill": "one listed skill",
        "impliedApproach": "cautious",
        "consequenceDomain": "relationship",
        "outcomes": {
          "success": { "narrativeText": "35 words max", "goalTicks": 2, "threatTicks": 0 },
          "complicated": { "narrativeText": "35 words max", "goalTicks": 1, "threatTicks": 1 },
          "failure": { "narrativeText": "35 words max", "goalTicks": 0, "threatTicks": 2 }
        }
      },
      {
        "id": "c3",
        "text": "8 words max",
        "approach": "clever",
        "primarySkill": "one listed skill",
        "impliedApproach": "clever",
        "consequenceDomain": "information",
        "outcomes": {
          "success": { "narrativeText": "35 words max", "goalTicks": 2, "threatTicks": 0 },
          "complicated": { "narrativeText": "35 words max", "goalTicks": 1, "threatTicks": 1 },
          "failure": { "narrativeText": "35 words max", "goalTicks": 0, "threatTicks": 2 }
        }
      }
    ]
  }
}

Replace placeholders with scene-specific prose. Return ONLY the JSON object.`;
    }

    return `Generate the OPENING BEAT of a ${input.encounterType} encounter. Return ONLY valid JSON.
${input.episodeSoFarSummary ? `\n## Episode So Far (continuity is MANDATORY — the encounter CONTINUES from the last scene; never reset time, re-stage arrivals, or treat known characters as strangers; the protagonist is "you", never an NPC)\n${input.episodeSoFarSummary}\n` : ''}${formatForbiddenRevealsSection(input.forbiddenReveals ?? [])}
## Scene
- ID: ${input.sceneId}
- Name: ${input.sceneName}
- Description: ${input.sceneDescription}
- Mood: ${input.sceneMood}
- Type: ${input.encounterType} | Style: ${input.encounterStyle || 'auto'}
- Difficulty: ${input.difficulty}
- Stakes: ${input.encounterStakes || 'Keep stakes personal'}
${this.formatEncounterStoryCircleTarget(input)}
- Skills: ${skillsList}
${this.buildAuthoredAnchorSection(input)}

## Story: ${input.storyContext.title} (${input.storyContext.genre}, ${input.storyContext.tone})

## Genre-Aware Jeopardy
${buildGenreAwareJeopardyGuidance(input.storyContext.genre)}

## Protagonist: ${protagonist} (${input.protagonistInfo.pronouns})

## CRITICAL: Protagonist pronouns & POV (ABSOLUTE)
- The protagonist ${protagonist} uses **${input.protagonistInfo.pronouns}** pronouns. NEVER use the opposite gender's pronouns for ${protagonist}.
  ${input.protagonistInfo.pronouns === 'she/her'
    ? `Correct: she/her/hers/herself. WRONG: he/him/his/himself.`
    : input.protagonistInfo.pronouns === 'he/him'
      ? `Correct: he/him/his/himself. WRONG: she/her/hers/herself.`
      : `Use they/them/their/themselves (singular).`}
- WRITE THE PROTAGONIST IN SECOND PERSON ("you", "your") throughout — this is the house POV and removes pronoun ambiguity entirely. Do NOT narrate the protagonist in the third person by name + pronoun (write "you hold his gaze", never "${protagonist} holds his gaze"). Reserve third-person + a concrete pronoun for NPCs only.
- Use each NPC's exact name and their listed pronouns; never swap a character's gender.
- When the protagonist and an NPC share the scene, use NAMES (not bare pronouns) to keep references unambiguous.

## NPCs
${npcsList || 'None'}
${relationshipSection}
${ENCOUNTER_PROSE_DISCIPLINE}

## TEXT RULES
- Use the protagonist's actual name, concrete pronouns, or you/your; never emit template variables.
- The opening setupText MUST establish the protagonist as the focal character before NPC action or environmental exposition.
- Prefer the protagonist's actual name as the subject for concrete protagonist actions; use you/your only for direct reader-facing immediacy.
- setupText: 30-50 words setting the opening situation
- narrativeText: 30-60 words showing THE RESULT of the action (not the action itself)
- Each outcome narrative must be SPECIFIC to the choice taken
- Each choice must include fiction-first reader echo copy:
  - feedbackCue.echoSummary: one sentence acknowledging the player's choice, like "You chose honesty over comfort."
  - feedbackCue.progressSummary: one short sentence showing how the scene now feels different
  - reminderPlan.immediate and reminderPlan.shortTerm should mirror those visible story turns
- Do NOT use dice/result labels like "at a price," "seizing the moment," "objective achieved," or "cost lands" in feedbackCue/reminderPlan.

## TASK
Generate 3 distinct choices (bold/cautious/clever approaches, each using a different skill).
For EACH choice, write 3 outcome narratives (success/complicated/failure) that are SPECIFIC to that exact action.
"Your blade finds his shoulder" and "Your words give him pause" are both successes but from DIFFERENT choices.

## JSON FORMAT
{
  "sceneId": "${input.sceneId}",
  "encounterType": "${input.encounterType}",
  "goalClock": { "name": "string", "segments": 6, "description": "string" },
  "threatClock": { "name": "string", "segments": 4, "description": "string" },
  "stakes": { "victory": "string", "defeat": "string" },
  "openingBeat": {
    "setupText": "30-50 words: the opening situation",
    "choices": [
      {
        "id": "c1", "text": "Bold action (5-10 words)", "approach": "aggressive",
        "primarySkill": "skill_name", "impliedApproach": "aggressive",
        "consequenceDomain": "relationship",
        "reminderPlan": {
          "immediate": "One sentence acknowledging what the player chose.",
          "shortTerm": "One sentence showing the visible story turn."
        },
        "feedbackCue": {
          "echoSummary": "You chose directness over caution.",
          "progressSummary": "The room reacts to the confidence before anyone speaks.",
          "checkClass": "dramatic"
        },
        "outcomes": {
          "success": { "narrativeText": "30-60 words", "goalTicks": 2, "threatTicks": 0 },
          "complicated": { "narrativeText": "30-60 words", "goalTicks": 1, "threatTicks": 1 },
          "failure": { "narrativeText": "30-60 words", "goalTicks": 0, "threatTicks": 2 }
        }
      },
      { "id": "c2", "text": "Cautious approach", "approach": "cautious", "primarySkill": "...", "outcomes": { ... } },
      { "id": "c3", "text": "Clever trick", "approach": "clever", "primarySkill": "...", "outcomes": { ... } }
    ]
  }
}

Replace ALL placeholders with actual narrative. Return ONLY the JSON object.`;
  }

  // ---- Phase 2: Choice-Specific Branch Situations ----

  private async runPhase2(
    input: EncounterArchitectInput,
    brief: RelationshipDynamicsBrief,
    choice: Phase1Result['openingBeat']['choices'][0],
    errorSink: EncounterPhaseError[],
  ): Promise<Phase2Result> {
    return this.runPhaseWithRetry(`phase2:${choice.id}`, EncounterArchitect.PHASE2_TIMEOUT_MS, errorSink, async (signal, _attempt, previousReason) => {
      // Monotone truncation recovery: a max_tokens retry must shrink the ask —
      // same schema, but with compact-output directives that cut every string
      // budget (ENCOUNTER_TRUNCATION_RECOVERY.phase2 = 'compact_prompt_retry').
      const compactRetry = previousReason === 'max_tokens';
      const messages: AgentMessage[] = [{ role: 'user', content: this.buildPhase2Prompt(input, brief, choice, { compactRetry }) }];
      const response = await this.callLLM(messages, 1, { signal, jsonSchema: buildEncounterPhase2JsonSchema() });
      return this.normalizePhase2Result(this.parseJSON<Phase2Result>(response), choice.id);
    });
  }

  private normalizePhase2Result(result: Phase2Result, choiceId: string): Phase2Result {
    result.choiceId = result.choiceId || choiceId;
    for (const [key, situation] of Object.entries({
      afterSuccess: result.afterSuccess,
      afterComplicated: result.afterComplicated,
      afterFailure: result.afterFailure,
    })) {
      const choices = Array.isArray(situation?.choices) ? situation.choices : [];
      if (choices.length < 3) {
        throw new Error(`Encounter Phase 2 ${choiceId}.${key} returned only ${choices.length} follow-up choice(s); refusing template synthesis.`);
      }
      if (choices.length > 4) {
        situation.choices = choices.slice(0, 4);
      }
    }
    return result;
  }

  private buildPhase2Prompt(
    input: EncounterArchitectInput,
    brief: RelationshipDynamicsBrief,
    choice: Phase1Result['openingBeat']['choices'][0],
    options: { compactRetry?: boolean } = {},
  ): string {
    const npcsList = input.npcsInvolved
      .map(npc => `- ${npc.name} (${npc.id}): ${npc.role}${npc.voiceNotes ? ` — Voice: ${npc.voiceNotes}` : ''}`)
      .join('\n');

    const relationshipSection = brief.briefText
      ? `\n## Relationship Dynamics\n${brief.briefText}\n`
      : '';

    const compactDirective = options.compactRetry
      ? `

## COMPACT RETRY (output budget)
Your previous response exceeded the output-token budget. Shrink the output, not the structure:
- setupText: 25-35 words. narrativeText: 15-25 words.
- Exactly 3 choices per situation — never 4.
- Omit relationshipConsequences unless a choice directly changes a relationship.
- Keep feedbackCue and reminderPlan strings to one short sentence each.`
      : '';

    return `Generate the NEXT MOMENT after the player chose: "${choice.text}" (${choice.approach}).
Return ONLY valid JSON.${compactDirective}

## Context
- Scene: ${input.sceneName} — ${input.sceneDescription}
- Story: ${input.storyContext.title} (${input.storyContext.genre}, ${input.storyContext.tone})
${this.formatEncounterStoryCircleTarget(input)}
- NPCs: ${npcsList}
## Genre-Aware Jeopardy
${buildGenreAwareJeopardyGuidance(input.storyContext.genre)}
${relationshipSection}
## What the player tried
Choice: "${choice.text}" (skill: ${choice.primarySkill})
- SUCCESS result: ${choice.outcomes.success.narrativeText}
- COMPLICATED result: ${choice.outcomes.complicated.narrativeText}
- FAILURE result: ${choice.outcomes.failure.narrativeText}

## TASK
For EACH outcome tier (afterSuccess, afterComplicated, afterFailure), generate:
1. A setupText (30-50 words) describing the NEW situation after that outcome
2. Exactly three new choices (bold, cautious, clever) specific to that new situation
3. Each choice has success/complicated/failure outcomes, ALL terminal (isTerminal: true)
4. Terminal outcomes must include encounterOutcome: "victory"|"partialVictory"|"defeat"|"escape"
5. Include relationshipConsequences on outcomes where choices affect NPC relationships
6. Every terminal "partialVictory" outcome MUST include a "cost" object with authored "immediateEffect" and "visibleComplication" (1 concrete sentence each — omitting it forces a template placeholder that fails validation)

${ENCOUNTER_PROSE_DISCIPLINE}

## TEXT RULES
- Use the protagonist's actual name, concrete pronouns, or you/your; never emit template variables.
- narrativeText must be SPECIFIC to the choice and situation, 25-45 words
- Each of the 3 situations (afterSuccess/afterComplicated/afterFailure) must feel DIFFERENT
- Every generated choice must include feedbackCue and reminderPlan with the same fiction-first two-line style as regular story choices:
  - feedbackCue.echoSummary acknowledges what the player chose, not the dice result
  - feedbackCue.progressSummary names the visible story/emotional turn
  - never use tier slogans such as "at a price," "seizing the moment," or "a turn for the worse"

## JSON FORMAT
{
  "choiceId": "${choice.id}",
  "afterSuccess": {
    "setupText": "30-50 words: situation after success",
    "choices": [
      {
        "id": "${choice.id}-s-c1", "text": "5-10 words", "approach": "bold", "primarySkill": "skill",
        "consequenceDomain": "relationship",
        "reminderPlan": {
          "immediate": "One sentence acknowledging the chosen action.",
          "shortTerm": "One sentence showing what changes in the scene."
        },
        "feedbackCue": {
          "echoSummary": "You chose candor over pretending nothing changed.",
          "progressSummary": "The tension has to answer you directly now.",
          "checkClass": "dramatic"
        },
        "outcomes": {
          "success": { "narrativeText": "...", "goalTicks": 3, "threatTicks": 0, "isTerminal": true, "encounterOutcome": "victory" },
          "complicated": { "narrativeText": "...", "goalTicks": 2, "threatTicks": 1, "isTerminal": true, "encounterOutcome": "partialVictory", "cost": { "immediateEffect": "...", "visibleComplication": "..." } },
          "failure": { "narrativeText": "...", "goalTicks": 0, "threatTicks": 2, "isTerminal": true, "encounterOutcome": "defeat" }
        }
      },
      { "id": "${choice.id}-s-c2", ... },
    ]
  },
  "afterComplicated": {
    "setupText": "30-50 words: situation after complication",
    "choices": [ { "id": "${choice.id}-p-c1", ... }, { "id": "${choice.id}-p-c2", ... } ]
  },
  "afterFailure": {
    "setupText": "30-50 words: situation after failure",
    "choices": [ { "id": "${choice.id}-f-c1", ... }, { "id": "${choice.id}-f-c2", ... } ]
  }
}

Replace ALL placeholders. Return ONLY the JSON object.`;
  }

  // ---- Phase 3: Prior State Enrichment ----

  private async runPhase3(
    input: EncounterArchitectInput,
    phase1: Phase1Result,
    errorSink: EncounterPhaseError[],
  ): Promise<Phase3Result> {
    return this.runPhaseWithRetry('phase3', EncounterArchitect.PHASE3_TIMEOUT_MS, errorSink, async (signal) => {
      const messages: AgentMessage[] = [{ role: 'user', content: this.buildPhase3Prompt(input, phase1) }];
      const response = await this.callLLM(messages, 1, { signal, jsonSchema: buildEncounterPhase3JsonSchema() });
      return this.parseJSON<Phase3Result>(response);
    });
  }

  private buildPhase3Prompt(input: EncounterArchitectInput, phase1: Phase1Result): string {
    const ctx = input.priorStateContext!;
    const flagNames = ctx.relevantFlags.map(f => `"${f.name}" — ${f.description}`).join('\n  ');
    const relDescs = ctx.relevantRelationships.map(r =>
      `${r.npcName}.${r.dimension} ${r.operator} ${r.threshold} — ${r.description}`
    ).join('\n  ');
    const choiceDescs = ctx.significantChoices.join('; ');

    const choiceIds = phase1.openingBeat.choices.map(c => `"${c.id}" (${c.text})`).join(', ');

    return `Generate ENRICHMENT for an encounter's opening beat based on prior player state.
Return ONLY valid JSON.

## Scene: ${input.sceneName}
${this.formatEncounterStoryCircleTarget(input)}
## Opening choices: ${choiceIds}
## Opening setupText: "${phase1.openingBeat.setupText}"

## Prior State
Flags:
  ${flagNames || 'None'}
Relationships:
  ${relDescs || 'None'}
Significant prior choices: ${choiceDescs || 'None'}

## TASK
Generate a JSON patch with up to 3 types of enrichment:

1. **setupTextVariants** (1-3): Alternative opening text when a condition is true.
   Use conditions like: { "type": "flag", "flag": "name", "value": true }
   or: { "type": "relationship", "npcId": "id", "dimension": "trust", "operator": "<", "value": -20 }

2. **statBonuses** (1-2): Difficulty reduction on a choice when a condition is true.
   Reference choices by id (${choiceIds}).

3. **conditionalChoices** (0-1): A bonus choice unlocked by prior state. Include lockedText hint.

${ENCOUNTER_PROSE_DISCIPLINE}

## JSON FORMAT
{
  "setupTextVariants": [
    { "condition": { "type": "flag", "flag": "...", "value": true }, "text": "Alternative opening text 30-50 words" }
  ],
  "statBonuses": [
    { "choiceRef": "c1", "condition": { ... }, "difficultyReduction": 15, "flavorText": "Why this bonus exists" }
  ],
  "conditionalChoices": [
    {
      "id": "c4", "text": "5-10 words", "approach": "social", "primarySkill": "persuasion",
      "conditions": { "type": "flag", "flag": "...", "value": true },
      "showWhenLocked": true, "lockedText": "Hint about what unlocks this",
      "outcomes": {
        "success": { "narrativeText": "...", "goalTicks": 2, "threatTicks": 0 },
        "complicated": { "narrativeText": "...", "goalTicks": 1, "threatTicks": 1 },
        "failure": { "narrativeText": "...", "goalTicks": 0, "threatTicks": 2 }
      }
    }
  ]
}

Keep enrichment subtle — the world remembering, not a pop-up reward.
Return ONLY the JSON object.`;
  }

  // ---- Phase 4: Storylets ----

  private async runPhase4(
    input: EncounterArchitectInput,
    brief: RelationshipDynamicsBrief,
    errorSink: EncounterPhaseError[],
  ): Promise<Phase4Result> {
    const results = await mapWithConcurrency(
      [...PHASE4_STORYLET_SLOTS],
      2,
      (slot) => this.runPhase4StoryletSlot(input, brief, slot, errorSink),
    );

    const phase4 = {} as Phase4Result;
    for (let index = 0; index < PHASE4_STORYLET_SLOTS.length; index++) {
      phase4[PHASE4_STORYLET_SLOTS[index]] = results[index] as any;
    }
    console.log(
      `[EncounterArchitect] Phase 4 storylet slots complete: ${PHASE4_STORYLET_SLOTS.map((slot) => `${slot}=OK`).join(' ')}`
    );
    return phase4;
  }

  private async runPhase4StoryletSlot(
    input: EncounterArchitectInput,
    brief: RelationshipDynamicsBrief,
    slot: Phase4StoryletSlot,
    errorSink: EncounterPhaseError[],
  ): Promise<GeneratedStorylet> {
    return this.runPhaseWithRetry(`phase4:${slot}`, EncounterArchitect.PHASE4_TIMEOUT_MS, errorSink, async (signal, attempt, previousReason) => {
      const useSafetyRetry = attempt > 1 && (previousReason === 'safety' || previousReason === 'recitation');
      const messages: AgentMessage[] = [{ role: 'user', content: this.buildPhase4StoryletPrompt(input, brief, slot, { safetyRetry: useSafetyRetry }) }];
      const response = await this.callLLM(messages, 1, { signal, jsonSchema: buildEncounterStoryletDraftJsonSchema(slot) });
      const draft = this.parseJSON<Phase4StoryletDraft>(response);
      const storylet = this.hydratePhase4StoryletDraft(input, slot, draft);
      this.validatePhase4StoryletSlot(storylet, slot, input);
      return storylet;
    });
  }

  private validatePhase4StoryletSlot(
    storylet: GeneratedStorylet,
    slot: Phase4StoryletSlot,
    input: EncounterArchitectInput,
  ): void {
    if (!storylet || typeof storylet !== 'object') {
      throw new Error(`Phase 4 ${slot} storylet returned no object`);
    }
    if (!Array.isArray(storylet.beats) || storylet.beats.length === 0) {
      throw new Error(`Phase 4 ${slot} storylet returned no beats`);
    }
    const expectedOutcome = slot;
    if (storylet.triggerOutcome && storylet.triggerOutcome !== expectedOutcome) {
      storylet.triggerOutcome = expectedOutcome as any;
    }
    if (!storylet.id) storylet.id = `${input.sceneId}-storylet-${slot.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;
    if (!storylet.startingBeatId) storylet.startingBeatId = storylet.beats[0]?.id;
    if (!Array.isArray(storylet.consequences)) storylet.consequences = [];
    const lastBeat = storylet.beats[storylet.beats.length - 1];
    if (lastBeat) lastBeat.isTerminal = true;
  }

  private expectedPhase4BeatCount(slot: Phase4StoryletSlot): number {
    switch (slot) {
      case 'victory': return 1;
      case 'partialVictory': return 2;
      case 'defeat': return 3;
      case 'escape': return 2;
    }
  }

  private phase4SlotSpec(slot: Phase4StoryletSlot): { name: string; tone: GeneratedStorylet['tone']; beatCount: string; functionText: string; costText?: string } {
    switch (slot) {
      case 'victory':
        return {
          name: 'Victory',
          tone: 'triumphant',
          beatCount: 'exactly 1 beat',
          functionText: 'Show the win landing in-scene and what it changes going forward.',
        };
      case 'partialVictory':
        return {
          name: 'Costly Aftermath',
          tone: 'bittersweet',
          beatCount: 'exactly 2 beats',
          functionText: 'Show relief followed by a concrete visible complication that follows forward.',
          costText: 'Include a cost object with domain, severity, whoPays, immediateEffect, and visibleComplication.',
        };
      case 'defeat':
        return {
          name: 'Defeat',
          tone: 'somber',
          beatCount: 'exactly 3 beats',
          functionText: 'Show impact, then learning, then resolve; this must feel like the beginning of recovery, not a dead end.',
        };
      case 'escape':
        return {
          name: 'Escape',
          tone: 'relieved',
          beatCount: 'exactly 2 beats',
          functionText: 'Show a close call followed by assessment while keeping future danger alive.',
        };
    }
  }

  private phase4StoryletId(input: EncounterArchitectInput, slot: Phase4StoryletSlot): string {
    return `${input.sceneId}-s${slot.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`).replace(/[^a-z-]/g, '')}`;
  }

  private hydratePhase4StoryletDraft(
    input: EncounterArchitectInput,
    slot: Phase4StoryletSlot,
    draft: Phase4StoryletDraft,
  ): GeneratedStorylet {
    if (!draft || typeof draft !== 'object') {
      throw new Error(`Phase 4 ${slot} storylet draft returned no object`);
    }
    const expectedBeatCount = this.expectedPhase4BeatCount(slot);
    const rawBeats = Array.isArray(draft.beats) ? draft.beats : [];
    if (rawBeats.length !== expectedBeatCount) {
      throw new Error(`Phase 4 ${slot} storylet draft returned ${rawBeats.length} beat(s); expected ${expectedBeatCount}`);
    }

    const spec = this.phase4SlotSpec(slot);
    const storyletId = this.phase4StoryletId(input, slot);
    const beats: StoryletBeat[] = rawBeats.map((beat, index) => {
      const text = String(beat?.text || '').trim();
      if (!text) {
        throw new Error(`Phase 4 ${slot} storylet draft beat ${index + 1} has no text`);
      }
      if (text.length > 420) {
        throw new Error(`Phase 4 ${slot} storylet draft beat ${index + 1} exceeds 420 characters`);
      }
      if (/\b(?:replace with|placeholder|objective achieved|cost lands|has succeeded|has failed)\b/i.test(text)) {
        throw new Error(`Phase 4 ${slot} storylet draft beat ${index + 1} contains placeholder or result-label prose`);
      }
      return {
        id: `${storyletId}-beat-${index + 1}`,
        text,
        ...(index === rawBeats.length - 1 ? { isTerminal: true } : { nextBeatId: `${storyletId}-beat-${index + 2}` }),
      };
    });

    if (slot === 'partialVictory' && !draft.cost) {
      throw new Error('Phase 4 partialVictory storylet draft returned no cost object');
    }

    return {
      id: storyletId,
      name: spec.name,
      triggerOutcome: slot,
      tone: spec.tone,
      narrativeFunction: spec.functionText,
      beats,
      startingBeatId: beats[0].id,
      consequences: [],
      nextSceneId: this.nextSceneForPhase4Slot(input, slot),
      ...(slot === 'partialVictory' && draft.cost ? { cost: draft.cost } : {}),
    };
  }

  private nextSceneForPhase4Slot(input: EncounterArchitectInput, slot: Phase4StoryletSlot): string {
    if (slot === 'defeat') return input.defeatNextSceneId || input.victoryNextSceneId || 'next-scene';
    return input.victoryNextSceneId || input.defeatNextSceneId || 'next-scene';
  }

  private buildPhase4StoryletPrompt(
    input: EncounterArchitectInput,
    brief: RelationshipDynamicsBrief,
    slot: Phase4StoryletSlot,
    options: { safetyRetry?: boolean } = {},
  ): string {
    const isSafetyRetry = options.safetyRetry === true;
    const npcsList = input.npcsInvolved
      .map(n => isSafetyRetry ? n.name : `${n.name}${n.voiceNotes ? ` (Voice: ${n.voiceNotes})` : ''}`)
      .join(', ');
    const relationshipSection = brief.briefText
      && !isSafetyRetry
      ? `\n## Relationship Dynamics\n${brief.briefText}\n`
      : '';
    const spec = this.phase4SlotSpec(slot);
    const sceneLine = isSafetyRetry
      ? `${input.sceneName} — compact social aftermath inside the same scene.`
      : `${input.sceneName} — ${input.sceneDescription}`;
    const typeLine = isSafetyRetry
      ? `social-suspense aftermath | Difficulty: ${input.difficulty}`
      : `${input.encounterType} | Difficulty: ${input.difficulty}`;
    const stakesLine = isSafetyRetry
      ? 'trust, status, access, secrets, reputation, logistics, and future leverage'
      : input.encounterStakes || 'personal to the protagonist';
    const storyLine = isSafetyRetry
      ? `${input.storyContext.title} (gothic social drama)`
      : `${input.storyContext.title} (${input.storyContext.genre}, ${input.storyContext.tone})`;
    const jeopardyLine = isSafetyRetry
      ? 'Keep jeopardy social and practical: public posture, private information, trust, access, logistics, and cost.'
      : buildGenreAwareJeopardyGuidance(input.storyContext.genre);
    const safetyBoundary = isSafetyRetry
      ? `## Gemini Safety Retry Boundary
The previous attempt was blocked or recitation-filtered. Write social suspense only.
Keep the aftermath about status, trust, access, distance, secrets, reputation, logistics, and emotional consequence.
Do not write sensual attraction, physical intimacy, erotic implication, predatory romance, coercive threat, body-focused description, or explicit violence.
If danger or attraction matters, translate it into dialogue, changed permission, public posture, private information, or a clear social cost.`
      : `## Gemini Safety Boundary
Write PG-13 gothic-romance tension only. Keep desire, danger, glamour, jealousy, and vampire atmosphere emotional and social.
Do not describe explicit sexual contact, nudity, erotic body detail, coercive sexual threat, or sexualized aftermath.
If intimacy matters, stage it as distance, restraint, eye contact, invitation, refusal, rumor, changed access, or emotional consequence.`;

    return `Generate ONE compact encounter aftermath DRAFT. Return ONLY valid JSON for this draft object.

## Scene: ${sceneLine}
## Type: ${typeLine}
## Stakes: ${stakesLine}
${this.formatEncounterStoryCircleTarget(input)}
## NPCs: ${npcsList || 'None'}
## Story: ${storyLine}
## Genre-Aware Jeopardy: ${jeopardyLine}
${relationshipSection}
${safetyBoundary}

## TASK
Generate ONLY the authored prose draft for the "${slot}" aftermath.
- Required length: ${spec.beatCount}
- Narrative function: ${spec.functionText}
${spec.costText ? `- Cost requirement: ${spec.costText}` : ''}

${ENCOUNTER_PROSE_DISCIPLINE}

## TEXT RULES
- Use the protagonist's actual name, concrete pronouns, or you/your; never emit template variables.
- Keep the JSON compact: no markdown, no commentary, no extra fields, no alternate drafts.
- Beat text: 1-2 short sentences, under 45 words per beat. Reference specific NPCs and the encounter's stakes.
- Never use result-label prose like "victory," "defeat," "objective achieved," "cost lands," "has succeeded," or "has failed" as reader-facing text.
- If a partialVictory has a cost, describe the concrete visible complication in the scene, not cost metadata.
- Do NOT include id, name, triggerOutcome, tone, narrativeFunction, startingBeatId, consequences, nextSceneId, isTerminal, visualContract, or sequenceIntent. Runtime metadata is added by code.

## JSON FORMAT
{
  ${slot === 'partialVictory' ? `"cost": {
    "domain": "mixed",
    "severity": "moderate",
    "whoPays": "protagonist",
    "immediateEffect": "One sentence naming the concrete visible complication.",
    "visibleComplication": "One sentence showing what changed in the scene."
  },` : ''}
  "beats": [
    { "text": "Specific aftermath prose beat 1." }
  ]
}

Replace ALL sample text with specific, scene-appropriate narrative.
Do not expand beyond the required beat count. Keep every string concise enough for structured JSON parsing.
Return ONLY the compact draft object, not an object keyed by outcome.`;
  }

  private buildPhase4Prompt(input: EncounterArchitectInput, brief: RelationshipDynamicsBrief): string {
    return `${this.buildPhase4StoryletPrompt(input, brief, 'victory')}

## Phase 4 Slot Note
Phase 4 now generates bounded storylet slots separately: victory, partialVictory, defeat, escape.`;
  }

  // ========================================================================
  // DETERMINISTIC ASSEMBLY
  // ========================================================================

  /**
   * Assembles the final EncounterStructure from the outputs of all phases.
   * Pure deterministic code — cannot fail.
   */
  assemblePhasedEncounter(
    input: EncounterArchitectInput,
    phase1: Phase1Result,
    phase2Results: (Phase2Result | null)[],
    phase3Result: Phase3Result | null,
    phase4Result: Phase4Result | null,
    brief: RelationshipDynamicsBrief,
  ): EncounterStructure {
    // Build beat-1 from Phase 1
    const beat1Choices: EncounterChoice[] = phase1.openingBeat.choices.map(c => {
      const phase2 = phase2Results.find(r => r?.choiceId === c.id);
      return this.ensureEncounterChoiceFeedback({
        id: c.id,
        text: c.text,
        approach: c.approach as EncounterApproach,
        impliedApproach: (c.impliedApproach || c.approach) as EncounterApproach,
        primarySkill: c.primarySkill,
        consequenceDomain: c.consequenceDomain,
        reminderPlan: c.reminderPlan,
        feedbackCue: c.feedbackCue,
        outcomes: {
          success: this.buildOutcomeWithBranch(c.outcomes.success, 'success', phase2?.afterSuccess, brief),
          complicated: this.buildOutcomeWithBranch(c.outcomes.complicated, 'complicated', phase2?.afterComplicated, brief),
          failure: this.buildOutcomeWithBranch(c.outcomes.failure, 'failure', phase2?.afterFailure, brief),
        },
      } as EncounterChoice, c.outcomes.complicated.narrativeText || c.outcomes.success.narrativeText);
    });

    // Apply Phase 3 enrichment
    if (phase3Result) {
      this.applyEnrichment(beat1Choices, phase1.openingBeat, phase3Result);
    }

    const beat1: EncounterBeat = {
      id: 'beat-1',
      phase: 'setup' as EscalationPhase,
      name: input.sceneName,
      description: input.sceneDescription,
      setupText: phase1.openingBeat.setupText,
      choices: beat1Choices,
      ...(this.sanitizeSetupTextVariants(phase3Result?.setupTextVariants)?.length
        ? { setupTextVariants: this.sanitizeSetupTextVariants(phase3Result?.setupTextVariants) as any }
        : {}),
    } as EncounterBeat;

    if (!phase4Result) {
      throw new Error(`Encounter ${input.sceneId} Phase 4 failed to generate authored storylets; refusing default storylet fallback.`);
    }
    this.requireAuthoredStorylets(phase4Result, input, 'phase4');

    return {
      sceneId: phase1.sceneId || input.sceneId,
      encounterType: (phase1.encounterType || input.encounterType) as EncounterType,
      encounterStyle: input.encounterStyle,
      goalClock: phase1.goalClock || { name: 'Objective', segments: 6, description: 'Achieve the goal' },
      threatClock: phase1.threatClock || { name: 'Danger', segments: 4, description: 'Escalating threat' },
      stakes: phase1.stakes || { victory: 'Overcome the challenge', defeat: 'Suffer the consequences' },
      beats: [beat1],
      startingBeatId: 'beat-1',
      storylets: phase4Result as any,
    } as EncounterStructure;
  }

  /**
   * Builds an EncounterChoiceOutcome, wiring in a Phase 2 branch situation
   * as nextSituation and attaching relationship consequences.
   */
  private buildOutcomeWithBranch(
    phase1Outcome: { narrativeText: string; goalTicks: number; threatTicks: number },
    tier: 'success' | 'complicated' | 'failure',
    phase2Situation: Phase2Situation | undefined,
    brief: RelationshipDynamicsBrief,
  ): EncounterChoiceOutcome {
    const outcome: EncounterChoiceOutcome = {
      tier,
      narrativeText: phase1Outcome.narrativeText,
      goalTicks: phase1Outcome.goalTicks,
      threatTicks: phase1Outcome.threatTicks,
    };

    if (phase2Situation) {
      outcome.nextSituation = {
        setupText: phase2Situation.setupText,
        choices: phase2Situation.choices.map(c => this.convertPhase2Choice(c, brief)),
      };
    }

    return outcome;
  }

  /**
   * Converts a Phase 2 choice into an EmbeddedEncounterChoice with typed
   * outcomes and relationship consequences.
   */
  private convertPhase2Choice(
    choice: Phase2Situation['choices'][0],
    brief: RelationshipDynamicsBrief,
  ): EmbeddedEncounterChoice {
    return this.ensureEncounterChoiceFeedback({
      id: choice.id,
      text: choice.text,
      approach: choice.approach,
      primarySkill: choice.primarySkill,
      consequenceDomain: choice.consequenceDomain,
      reminderPlan: choice.reminderPlan,
      feedbackCue: choice.feedbackCue,
      outcomes: {
        success: this.convertPhase2Outcome(choice.outcomes.success, 'success', brief),
        complicated: this.convertPhase2Outcome(choice.outcomes.complicated, 'complicated', brief),
        failure: this.convertPhase2Outcome(choice.outcomes.failure, 'failure', brief),
      },
    }, choice.outcomes.complicated.narrativeText || choice.outcomes.success.narrativeText);
  }

  private convertPhase2Outcome(
    raw: Phase2Outcome,
    tier: 'success' | 'complicated' | 'failure',
    brief: RelationshipDynamicsBrief,
  ): EncounterChoiceOutcome {
    const consequences: any[] = [];

    if (raw.relationshipConsequences) {
      for (const rc of raw.relationshipConsequences) {
        const dim = rc.dimension as 'trust' | 'affection' | 'respect' | 'fear';
        if (['trust', 'affection', 'respect', 'fear'].includes(dim)) {
          consequences.push({ type: 'relationship', npcId: rc.npcId, dimension: dim, change: rc.change });
        }
      }
    }

    return {
      tier,
      narrativeText: raw.narrativeText,
      goalTicks: raw.goalTicks,
      threatTicks: raw.threatTicks,
      isTerminal: raw.isTerminal || false,
      encounterOutcome: raw.encounterOutcome as EncounterOutcome | undefined,
      ...(consequences.length > 0 ? { consequences } : {}),
    };
  }

  /**
   * Applies Phase 3 enrichment patches to the opening beat choices.
   */
  private applyEnrichment(
    choices: EncounterChoice[],
    openingBeat: Phase1Result['openingBeat'],
    enrichment: Phase3Result,
  ): void {
    if (enrichment.statBonuses) {
      for (const bonus of enrichment.statBonuses) {
        const choice = choices.find(c => c.id === bonus.choiceRef);
        if (choice) {
          const condition = this.sanitizeConditionExpression(bonus.condition);
          if (!condition) continue;
          choice.statBonus = {
            condition: condition as any,
            difficultyReduction: bonus.difficultyReduction,
            flavorText: bonus.flavorText,
          };
        }
      }
    }

    if (enrichment.conditionalChoices) {
      for (const cc of enrichment.conditionalChoices) {
        const conditions = this.sanitizeConditionExpression(cc.conditions);
        if (!conditions) continue;
        // Phase 3 conditional choices arrive WITHOUT a `nextSituation` branch
        // (Phase 2 already fanned out for the Phase 1 choices only). Mark their
        // outcomes TERMINAL so they resolve the encounter directly instead of
        // becoming branch-less non-terminal outcomes — which the min-2-beats
        // synthesis would otherwise route into the generic deterministic-
        // fallback template (shipping "This is the moment that decides
        // everything…" as the branch). A state-unlocked bonus choice resolving
        // the encounter is the intended payoff, and it costs no extra LLM call.
        choices.push(this.ensureEncounterChoiceFeedback({
          id: cc.id,
          text: cc.text,
          approach: cc.approach as EncounterApproach,
          primarySkill: cc.primarySkill,
          conditions: conditions as any,
          showWhenLocked: cc.showWhenLocked,
          lockedText: cc.lockedText,
          outcomes: {
            success: { tier: 'success', narrativeText: cc.outcomes.success.narrativeText, goalTicks: cc.outcomes.success.goalTicks, threatTicks: cc.outcomes.success.threatTicks, isTerminal: true, encounterOutcome: 'victory' },
            complicated: { tier: 'complicated', narrativeText: cc.outcomes.complicated.narrativeText, goalTicks: cc.outcomes.complicated.goalTicks, threatTicks: cc.outcomes.complicated.threatTicks, isTerminal: true, encounterOutcome: 'partialVictory' },
            failure: { tier: 'failure', narrativeText: cc.outcomes.failure.narrativeText, goalTicks: cc.outcomes.failure.goalTicks, threatTicks: cc.outcomes.failure.threatTicks, isTerminal: true, encounterOutcome: 'defeat' },
          },
        } as EncounterChoice, cc.outcomes.complicated.narrativeText || cc.outcomes.success.narrativeText));
      }
    }
  }

  /**
   * Compares each emitted storylet's beat prose against the text that
   * `createDefaultStorylet` would produce for that outcome, and returns
   * the list of outcome slots whose content is a byte-for-byte collision
   * with the fallback (I3 instrumentation).
   *
   * A storylet is considered a default collision when the concatenated
   * beat text (joined by '\n') exactly matches what the default builder
   * would emit for the same `(outcome, input)` pair. This signal lets
   * later analysis distinguish "LLM authored everything" from "we
   * silently shipped fallback prose".
   */
  private detectDefaultStoryletCollisions(
    structure: EncounterStructure,
    input: EncounterArchitectInput,
  ): Array<'victory' | 'partialVictory' | 'defeat' | 'escape'> {
    const collisions: Array<'victory' | 'partialVictory' | 'defeat' | 'escape'> = [];
    const slots: Array<'victory' | 'partialVictory' | 'defeat' | 'escape'> = [
      'victory', 'partialVictory', 'defeat', 'escape',
    ];
    const storylets = structure.storylets ?? {};
    const joinBeats = (beats: Array<{ text?: string }> | undefined): string =>
      (beats ?? []).map(b => b?.text ?? '').join('\n');

    for (const slot of slots) {
      const emitted = (storylets as Record<string, GeneratedStorylet | undefined>)[slot];
      if (!emitted) continue;
      const defaultStorylet = this.createDefaultStorylet(slot, input);
      if (joinBeats(emitted.beats) === joinBeats(defaultStorylet.beats)) {
        collisions.push(slot);
      }
    }
    return collisions;
  }

  /**
   * Fallback storylets used by `assemblePhasedEncounter` when Phase 4's
   * LLM call fails (timeout, parse error, empty response, etc.).
   *
   * Historically this produced single-beat, placeholder-style prose that
   * subsequently shipped verbatim in player-facing stories because
   * `normalizeStructure` / `validateStructure` only *add* missing storylets
   * and do not *replace* existing ones.
   *
   * We now delegate to `createDefaultStorylet` so both the phased
   * fallback and the lean / deterministic fallbacks emit the same
   * richer default content (multi-beat, with consequences and flags).
   */
  private buildDefaultStorylets(input: EncounterArchitectInput): Phase4Result {
    // Emit all four canonical outcome slots. Omitting partialVictory left the
    // costly-victory path unauthored on the Phase-4 fallback, so a defaulted
    // encounter shipped with no "win at a cost" branch (and the partialVictory
    // collision check below could never fire). createDefaultStorylet builds a
    // structured cost (visibleComplication + immediateEffect) so this satisfies
    // IncrementalEncounterValidator's partial-victory cost check.
    return {
      victory: this.createDefaultStorylet('victory', input),
      partialVictory: this.createDefaultStorylet('partialVictory', input),
      defeat: this.createDefaultStorylet('defeat', input),
      escape: this.createDefaultStorylet('escape', input),
    };
  }
}
