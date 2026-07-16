// @ts-nocheck — TODO(tech-debt): type drift with GeneratedBeat / sourceAnalysis
// fragments; address in Phase 3 pipeline refactor and Phase 7 type consolidation.
/**
 * Scene Writer Agent
 *
 * The prose and description specialist responsible for:
 * - Writing immersive scene descriptions
 * - Creating atmospheric narrative text
 * - Generating dialogue with distinct character voices
 * - Crafting the actual content beats for each scene
 */

import { AgentConfig, GenerationSettingsConfig } from '../config';
import { formatForbiddenRevealsSection } from '../utils/forbiddenReveals';
import { BaseAgent, AgentResponse, TruncatedLLMResponseError } from './BaseAgent';
import { SceneBlueprint } from './StoryArchitect';
import { buildResidueRequirementPromptSection } from '../pipeline/reconvergenceResidue';
import { Beat, TextVariant, Consequence, TimingMetadata, SceneVisualSequencePlan } from '../../types';
import {
  SourceMaterialAnalysis,
  StoryAnchors,
  StoryCircleRoleAssignment,
  StoryCircleStructure,
} from '../../types/sourceAnalysis';
import { ChoiceDensityValidator } from '../validators/ChoiceDensityValidator';
import { PovClarityValidator } from '../validators/PovClarityValidator';
import { auditFictionFirstTurns, FICTION_FIRST_TURN_DOMAINS } from '../validators/turnAudit';
import type { CliffhangerPlan } from '../../types/seasonPlan';
import {
  CHOICE_DENSITY_REQUIREMENTS,
  CRAFT_PRESSURE_GUIDANCE,
  NARRATIVE_INTENSITY_RULES,
  buildGenreAwareJeopardyGuidance,
  buildStructuralContextSection,
} from '../prompts/storytellingPrinciples';
import { buildSceneWriterCallbackSection } from '../prompts/callbackPromptSection';
import { canonicalizeHookId, isStructuralFlag } from '../pipeline/callbackLedger';
import { canonicalizeConditionOutcomeFlags } from '../utils/encounterOutcomeFlags';
import { buildColdOpenProfileSection, buildRequiredBeatsSection } from '../prompts/requiredBeatsPromptSection';
import { scrubNextEpisodePressureProperNouns } from '../utils/episodeTurnFirewall';
import type {
  ArcPressureTreatmentContract,
  MechanicPressureContract,
  RelationshipPacingContract,
  SceneTurnContract,
  StoryCircleBeatRealizationContract,
} from '../../types/scenePlan';
import { enumeratedItems } from '../utils/enumeratedObjective';
import {
  authorFacingMechanicPressureText,
  authorFacingTreatmentFieldText,
} from '../utils/treatmentFieldContracts';
import {
  buildSceneConstructionProfileSection,
  buildSceneConstructionPromptView,
} from '../utils/sceneConstructionProfile';
import { buildSceneEventOwnershipPromptSection } from '../utils/sceneEventOwnership';
import type { SceneTimelineHandoff } from '../utils/sceneTimeline';
import { SCENE_WRITER_BEAT_EXAMPLE } from '../prompts/examples/storyCraftExamples';
import { PROSE_AND_DIALOGUE_CRAFT } from '../prompts/proseCraftRegister';
import { DEFAULT_LIMITS } from '../utils/textEnforcer';
import { TEXT_LIMITS } from '../../constants/validation';
import type { SceneSettingContext } from '../utils/styleAdaptation';
import type { NarrativeEvidenceAtom } from '../../types/narrativeContract';
import { applySequenceDirectorPlan } from './SequenceDirector';
import { buildSceneContentJsonSchema } from '../schemas/sceneContentSchema';
import { isPlanningRegisterText } from '../constants/planningRegisterText';
import { describeNarrativeEvidenceTarget } from '../pipeline/narrativeContractMigration';

const SCENE_WRITER_MAX_PROCESSING_TEXT_CHARS = 3500;
const SCENE_WRITER_REVISION_TEXT_CHARS = 1200;
// Guard against pathological response bloat (runaway textVariants
// boilerplate), not against rich scenes: a live 5-scene episode opener with
// the scene-event-ownership obligations legitimately needed ~15.6k chars and
// aborted at the old 14k line. Pathological cases run 2x+, so 20k keeps the
// protection while clearing the calibration cliff.
const SCENE_WRITER_MAX_RAW_RESPONSE_CHARS = 20000;
const SCENE_WRITER_MAX_REVISION_RESPONSE_CHARS = 20000;

function normalizeSourceFragments(sourceAnalysis?: SourceMaterialAnalysis): {
  dialogue: string[];
  prose: string[];
  terminology: string[];
} {
  const fragments = sourceAnalysis?.directLanguageFragments;
  if (!fragments) return { dialogue: [], prose: [], terminology: [] };

  if (Array.isArray(fragments)) {
    return {
      dialogue: fragments.map((fragment) => fragment.text).filter(Boolean),
      prose: fragments
        .filter((fragment) => fragment.context && !fragment.speaker)
        .map((fragment) => fragment.text)
        .filter(Boolean),
      terminology: [],
    };
  }

  return {
    dialogue: Array.isArray(fragments.dialogue) ? fragments.dialogue.filter(Boolean) : [],
    prose: Array.isArray(fragments.prose) ? fragments.prose.filter(Boolean) : [],
    terminology: Array.isArray(fragments.terminology) ? fragments.terminology.filter(Boolean) : [],
  };
}

export function buildSourceMaterialFidelitySection(sourceAnalysis?: SourceMaterialAnalysis): string {
  if (!sourceAnalysis) return '';

  const fragments = normalizeSourceFragments(sourceAnalysis);
  const guide = sourceAnalysis.writingStyleGuide;
  const guidance = sourceAnalysis.adaptationGuidance;
  const elementsToPreserve = Array.isArray(guidance?.elementsToPreserve) ? guidance.elementsToPreserve : [];
  const elementsToAdapt = Array.isArray(guidance?.elementsToAdapt) ? guidance.elementsToAdapt : [];
  const themes = Array.isArray(guidance?.keyThemesToPreserve)
    ? guidance.keyThemesToPreserve
    : elementsToPreserve;
  const moments = Array.isArray(guidance?.iconicMoments) ? guidance.iconicMoments : [];

  return `
## Source Material Fidelity (IP Research)
The following language, terminology, and prose-style rules have been identified from the source material.
**Prioritize this writing contract when drafting player-facing prose.**

${guide ? `### Writing Style Guide (${guide.source})
- **Summary**: ${guide.summary}
- **Narrative Voice**: ${guide.narrativeVoice}
- **Sentence Rhythm**: ${guide.sentenceRhythm}
- **Diction**: ${guide.diction}
- **Dialogue Style**: ${guide.dialogueStyle}
- **POV / Distance**: ${guide.povAndDistance}
- **Imagery / Sensory Focus**: ${guide.imageryAndSensoryFocus}
- **Pacing**: ${guide.pacing}
- **Do**: ${guide.doList.join('; ')}
- **Avoid**: ${guide.avoidList.join('; ')}
${guide.evidence?.length ? `- **Evidence**: ${guide.evidence.join('; ')}` : ''}
` : ''}

${fragments.dialogue.length ? `### Iconic Dialogue
${fragments.dialogue.map(d => `- "${d}"`).join('\n')}
` : ''}

${fragments.prose.length ? `### Notable Prose & Style
${fragments.prose.map(p => `- ${p}`).join('\n')}
` : ''}

${fragments.terminology.length ? `### Key Terminology (LOCKED — use verbatim)
${fragments.terminology.join(', ')}

Use these EXACT terms whenever the concept appears. Do NOT rename them, coin
synonyms, or swap in a generic equivalent (e.g. never turn "All-Song" into
"Codex"). They are the story's signature vocabulary and must read identically in
every scene.
` : ''}

${guidance ? `### Adaptation Guidance
- **Narrative Voice**: ${guidance.narrativeVoice}
- **Tone Notes**: ${guidance.toneNotes}
- **Dialogue Style**: ${guidance.dialogueStyle}
- **Elements to Preserve**: ${elementsToPreserve.join(', ')}
${elementsToAdapt.length ? `- **Elements to Adapt**: ${elementsToAdapt.join(', ')}` : ''}
${themes.length ? `- **Themes to Preserve**: ${themes.join(', ')}` : ''}
${moments.length ? `- **Iconic Moments**: ${moments.join(', ')}` : ''}
` : ''}
`;
}

// Input types
export interface SceneWriterInput {
  // Scene blueprint from Story Architect
  sceneBlueprint: SceneBlueprint;

  // Story context
  storyContext: {
    title: string;
    genre: string;
    tone: string;
    worldContext: string;
    userPrompt?: string;
  };

  // Character information
  protagonistInfo: {
    name: string;
    pronouns: 'he/him' | 'she/her' | 'they/them';
    description: string;
    physicalDescription?: string;
  };

  npcs: Array<{
    id: string;
    name: string;
    pronouns: 'he/him' | 'she/her' | 'they/them';
    description: string;
    physicalDescription?: string;
    voiceNotes: string; // How they speak
    currentMood?: string;
    /**
     * True when the reader has NOT met this character on any earlier scene of
     * the active path — this scene is their first on-page appearance and must
     * INTRODUCE them (who they are, how the protagonist knows them) before
     * they drive the action.
     */
    isFirstOnPageAppearance?: boolean;
  }>;

  /**
   * Roster character names the reader has not met and who are NOT in this
   * scene's cast. The prose must not name them — a casual mention would be a
   * "who is this?" continuity defect (the bite-me-g10 Victor class).
   */
  notYetIntroducedNames?: string[];

  /**
   * Diegetic timeline handoff: where/when the previous scene took place and
   * whether this scene's planned time/location differ. When time or place
   * changed, `transitionIn` and an opening acknowledgment are REQUIRED.
   */
  sceneTimeline?: SceneTimelineHandoff;

  // State context (for conditional content)
  relevantFlags?: Array<{ name: string; description: string }>;
  relevantScores?: Array<{ name: string; description: string }>;
  /** Canonical opening premise facts assigned by the season contract compiler. */
  premiseContracts?: Array<{
    id: string;
    fieldName: string;
    sourceText: string;
    evidencePatterns: string[];
    blocking: boolean;
  }>;

  // Step 2 (info ledger): authored facts this scene must plant/reveal/pay off on-page (assigned by
  // StoryArchitect from the season INFO ledger). When present, the prompt instructs the
  // writer to dramatize each phase here. Empty/absent for scenes with no scheduled phase.
  setupDirectives?: Array<{ infoId: string; fact: string }>;
  revealDirectives?: Array<{ infoId: string; fact: string }>;
  payoffDirectives?: Array<{ infoId: string; fact: string }>;

  // G12 (forbidden reveals): ledger facts still WITHHELD at this episode. The writer
  // must not state/confirm them; setup-touch episodes may hint. Empty/absent ⇒ prompt unchanged.
  forbiddenReveals?: import('../utils/forbiddenReveals').ForbiddenReveal[];

  // Scene specific guidance
  targetBeatCount: number; // Max beats per scene (cap)—engine may use fewer
  dialogueHeavy: boolean; // Is this a conversation-focused scene?

  // Previous scene summary (for continuity)
  previousSceneSummary?: string;

  // Next-scene context for continuity handoffs, especially when a prose scene
  // flows directly into an encounter scaffold.
  nextSceneContext?: {
    id: string;
    name: string;
    location: string;
    description: string;
    isEncounter?: boolean;
    encounterType?: string;
    encounterDescription?: string;
    encounterBeatPlan?: string[];
  };

  // Choice payoff context: describes what player choice led to this scene.
  // When present, the FIRST beat must visually and textually pay off this choice.
  incomingChoiceContext?: string;

  // B1 prevention: when the immediately-preceding scene on this path is in the
  // SAME location, the writer must continue the visit rather than re-stage a fresh
  // arrival (the Endsong dual-first-entry: two scenes both "entering" the hall).
  continueInLocation?: string;

  // W4 prevention: when an encounter routes into THIS scene, the encounter's
  // possible outcomes + their pre-seeded state flags. The scene must author
  // textVariants gated on these flags so its prose reflects what happened (e.g. an
  // ally wounded on partialVictory) rather than reading identically on every path.
  priorEncounterOutcomes?: Array<{
    encounterId: string;
    encounterName: string;
    victoryStakes?: string;
    defeatStakes?: string;
    outcomeFlags: Array<{ outcome: string; flag: string }>;
    // The encounter's generated goal/threat clock pressure (description or name),
    // so the aftermath carries the mechanical pressure the encounter ran under
    // (time spent, danger escalated) instead of floating free of it.
    goalPressure?: string;
    threatPressure?: string;
  }>;

  // Source material analysis for IP fidelity (optional)
  sourceAnalysis?: SourceMaterialAnalysis;

  /**
   * Season-level narrative anchors (from SeasonPlan.anchors).
   * When present, SceneWriter keeps every prose beat grounded in the
   * shared Stakes / Goal / Inciting Incident / Climax anchors.
   */
  seasonAnchors?: StoryAnchors;

  /** Primary season-level Story Circle beat map. */
  seasonStoryCircle?: StoryCircleStructure;

  /** Primary Story Circle beat(s) this episode carries. */
  episodeStoryCircleRole?: StoryCircleRoleAssignment[];
  /** Episode-level fractal Story Circle from StoryArchitect. */
  episodeCircle?: StoryCircleStructure;

  /**
   * Role-mapped ending contract for the final scene of the episode.
   * Only supplied to scenes that may need to land the episode ending.
   */
  cliffhangerPlan?: CliffhangerPlan;
  /** F1.2: forbidden meanings for season secrets not yet revealed — the final
   * beat may escalate mystery but never confirm one of these. */
  revealProhibitions?: string[];

  // Context about the episode's climactic encounter that this scene is building toward.
  // Provided for all non-encounter scenes so the writer can plant seeds, establish stakes,
  // and frame choices in ways that make the encounter feel earned when players reach it.
  episodeEncounterContext?: {
    encounterType: string;
    encounterDescription: string;
    encounterDifficulty: string;
    encounterBuildup: string; // What THIS scene specifically should establish
  };

  // Pipeline memory / optimization hints from prior runs (optional)
  memoryContext?: string;

  // B1 (Season Canon): sealed, read-only facts to honor verbatim ("ESTABLISHED
  // CANON — do not contradict"). Pre-formatted by SeasonCanon.canonForPrompt.
  establishedCanon?: string;

  // Branch topology context from BranchManager (Phase 1.1).
  // When provided, SceneWriter knows whether this scene is a bottleneck,
  // a branch-only scene, or a reconvergence point, and what state differences
  // must be acknowledged.
  branchContext?: {
    role: 'bottleneck' | 'branch' | 'reconvergence' | 'linear';
    branchPathIds?: string[];
    incomingBranchIds?: string[];
    stateReconciliationNotes?: string[];
    reconvergenceNarrativeAcknowledgment?: string;
  };

  // Narrative threads active for this scene (Phase 5.3).
  // SceneWriter must plant or pay off these threads in the beat text
  // and set `plantsThreadId` / `paysOffThreadId` on the corresponding beat.
  activeThreads?: Array<{
    id: string;
    kind: 'seed' | 'clue' | 'promise' | 'secret' | 'foreshadow';
    label: string;
    action: 'plant' | 'payoff' | 'reference';
    hint?: string;
  }>;

  // Twist scheduling from TwistArchitect (Phase 6).
  // When provided, SceneWriter marks the designated beat as a twist or revelation
  // and drops subtle setup cues in the named setup beats.
  twistDirectives?: Array<{
    twistKind: 'reversal' | 'revelation' | 'betrayal' | 'reframe';
    beatRole: 'setup' | 'twist' | 'satisfaction';
    hint: string;
  }>;

  // Character arc milestone targets (Phase 7.1).
  // When provided, SceneWriter frames beats so protagonist choices can move
  // identity and relationship dimensions in the direction of these targets.
  arcTargets?: {
    identityDeltaHints?: Array<{ dimension: string; direction: 'positive' | 'negative'; magnitude: 'minor' | 'moderate' | 'major' }>;
    relationshipTrajectory?: Array<{ npcId: string; dimension: string; direction: 'positive' | 'negative'; hint: string }>;
  };

  // Unresolved callback hooks from prior episodes (Plan 1: Delayed Consequences).
  // When present, SceneWriter SHOULD author TextVariants that reference one of
  // these hooks via `callbackHookId`, gated on the hook's flags.
  unresolvedCallbacks?: Array<{
    id: string;
    sourceEpisode: number;
    summary: string;
    flags: string[];
    conditionKeys?: string[];
    impactFactors?: string[];
    consequenceTier?: string;
  }>;
}

// Output types
export interface GeneratedBeat {
  id: string;
  text: string;
  content?: string; // Fallback field sometimes used by LLMs
  textVariants?: TextVariant[];
  callbackHookIds?: string[];
  skillInsights?: Beat['skillInsights'];
  speaker?: string;
  speakerMood?: string;
  nextBeatId?: string;
  nextSceneId?: string;
  onShow?: Consequence[];
  // Note: choices are added by Choice Author agent
  isChoicePoint?: boolean; // Mark where Choice Author should add choices
  isChoiceBridge?: boolean;
  routeContext?: Beat['routeContext'];
  // Timing metadata for choice density validation
  timing?: TimingMetadata;
  // Visual contract authored alongside prose to prevent downstream drift
  visualMoment?: string; // One concrete, observable instant for this beat
  primaryAction?: string; // Verb-led physical action
  emotionalRead?: string; // Visible face/body emotional cues
  relationshipDynamic?: string; // Spatial/power dynamic between characters
  mustShowDetail?: string; // Non-negotiable visual clue for this beat
  dramaticIntent?: Beat['dramaticIntent']; // Objective/status/subtext metadata for image planning
  sequenceIntent?: Beat['sequenceIntent']; // Multi-beat visual sequence objective/thread metadata
  allowDiegeticText?: boolean; // When true, text in the image is permitted (letter, sign, book)
  shotType?: 'establishing' | 'character' | 'action'; // Camera intent: environment-only, character-focused, or physical action
  intensityTier?: 'dominant' | 'supporting' | 'rest'; // Narrative intensity for scene-level pacing
  isClimaxBeat?: boolean;
  isKeyStoryBeat?: boolean;
  visualContinuity?: Beat['visualContinuity']; // Optional beat-to-beat flow metadata
  visualCast?: Beat['visualCast'];
  coveragePlan?: Beat['coveragePlan'];

  // Setup-payoff + plot-point metadata (Phases 5, 6)
  plantsThreadId?: string;
  paysOffThreadId?: string;
  plotPointType?: 'setup' | 'payoff' | 'twist' | 'revelation';
  twistKind?: 'reversal' | 'revelation' | 'betrayal' | 'reframe';
}

export interface SceneContent {
  sceneId: string;
  sceneName: string;
  locationId?: string;
  beats: GeneratedBeat[];
  startingBeatId: string;

  // Metadata for other agents
  moodProgression: string[];
  charactersInvolved: string[];
  keyMoments: string[];
  sceneTakeaways?: string[];
  transitionIn?: string;
  sequenceIntent?: Beat['sequenceIntent'];
  sceneVisualSequencePlan?: SceneVisualSequencePlan;

  // Continuity notes
  continuityNotes: string[];

  /** Generator-only acknowledgement of the canonical events realized in this scene. */
  realizedEventIds?: string[];
  /** Immutable assignment copied from the episode event plan. */
  assignedEventIds?: string[];
  /** Agent claims, kept separate from deterministic verification. */
  claimedEventIds?: string[];
  /** Prose-gate verified event IDs. SceneWriter does not set these. */
  verifiedEventIds?: string[];
  /** Beat-local evidence claims used for diagnostics; prose gates remain authoritative. */
  eventEvidence?: Array<{ eventId: string; taskId?: string; atomId?: string; beatIds?: string[]; evidence: string }>;

  // Branch metadata for visual differentiation
  branchType?: 'dark' | 'hopeful' | 'neutral' | 'tragic' | 'redemption';
  isBottleneck?: boolean;
  isConvergencePoint?: boolean;

  // Authored realization contract, copied from the SceneBlueprint when the
  // scene is accepted (GATE_SCENE_REQUIRED_BEAT_CHECK). Travels WITH the
  // content so every downstream rewrite pass (SceneCritic polish, POV/voice
  // regen swap, continuity repair) can verify it isn't paraphrasing an
  // authored moment away — the season-final realization validators block on it.
  requiredBeats?: Array<{ tier?: string; mustDepict?: string }>;
  signatureMoment?: string;
  turnContract?: SceneTurnContract;
  relationshipPacing?: RelationshipPacingContract[];
  mechanicPressure?: MechanicPressureContract[];
  storyCircleBeatContracts?: StoryCircleBeatRealizationContract[];
  arcPressureContracts?: ArcPressureTreatmentContract[];

  // Threads planted/paid off in this scene (Phase 5.3).
  plantedThreadIds?: string[];
  paidOffThreadIds?: string[];

  // Choice payoff context — the player choice that led to this scene.
  // Threaded to the image pipeline so the first beat's image reflects the choice.
  incomingChoiceContext?: string;

  // Timing analysis (added post-generation)
  timingAnalysis?: {
    totalReadingTimeSeconds: number;
    hasChoicePoint: boolean;
    estimatedTimeToFirstChoice?: number;
  };

  // Canonical scene-setting profile for downstream image generation.
  settingContext?: SceneSettingContext;
}

export interface SceneSemanticPatchOperation {
  op: 'replace_beat_text' | 'replace_transition_in' | 'insert_beat_after';
  beatId?: string;
  text: string;
}

export interface SceneSemanticPatch {
  baseSceneHash: string;
  targetTaskId: string;
  targetAtomIds: string[];
  operations: SceneSemanticPatchOperation[];
  claimedEvidence: Array<{ atomId: string; beatIds: string[] }>;
}

export interface SceneSemanticPatchInput {
  baseSceneHash: string;
  scene: SceneContent;
  targetTaskId: string;
  targetAtomIds: string[];
  targetAtoms: NarrativeEvidenceAtom[];
  preserveAtoms: NarrativeEvidenceAtom[];
  forbiddenAtoms: NarrativeEvidenceAtom[];
  concurrentFindings: string[];
  repairFeedback: string;
  capacityTier?: 'standard' | 'expanded';
  maxOperations?: number;
}

function semanticPatchWindow(scene: SceneContent, atoms: NarrativeEvidenceAtom[]): GeneratedBeat[] {
  if (scene.beats.length <= 3) return scene.beats;
  const terms = new Set<string>();
  for (const atom of atoms) {
    for (const value of [
      atom.description,
      ...(atom.semanticCriteria ?? []),
      ...(atom.participantIds ?? []),
      ...(atom.subjectIds ?? []),
      atom.stagedLocation,
      ...(atom.referencedLocations ?? []),
    ]) {
      for (const term of String(value ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((part) => part.length >= 4)) {
        terms.add(term);
      }
    }
  }
  let bestIndex = scene.beats.length - 1;
  let bestScore = -1;
  for (const [index, beat] of scene.beats.entries()) {
    const text = String(beat.text ?? '').toLowerCase();
    const score = [...terms].reduce((total, term) => total + (text.includes(term) ? 1 : 0), 0);
    if (score >= bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  }
  const start = Math.max(0, Math.min(bestIndex - 1, scene.beats.length - 3));
  return scene.beats.slice(start, start + 3);
}

function compactPatchAtom(atom: NarrativeEvidenceAtom): Record<string, unknown> {
  return {
    id: atom.id,
    requirement: atom.description,
    polarity: atom.polarity ?? 'required',
    criteria: atom.semanticCriteria,
    role: atom.semanticRole,
    subjects: atom.subjectIds,
    participants: atom.participantIds,
    prerequisites: atom.prerequisiteAtomIds,
    temporalSlot: atom.temporalSlot,
    stagedLocation: atom.stagedLocation,
    referencedLocations: atom.referencedLocations,
    acceptedLanguage: atom.polarity !== 'forbidden' ? atom.acceptedPatterns : undefined,
    forbiddenLanguage: atom.polarity === 'forbidden' ? atom.acceptedPatterns : undefined,
  };
}

function stripAgentFacingPressureLabel(value: string): string {
  return String(value || '')
    .replace(/^(?:pressure|choice pressure|forward pressure):\s*/i, '')
    .trim();
}

function isAgentFacingPressureNote(value: string): boolean {
  return /^(?:choice pressure|forward pressure):/i.test(String(value || '').trim());
}

function joinPromptList(value: unknown, separator = ', ', fallback = ''): string {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean).join(separator)
    : fallback;
}

function buildTreatmentEventPromptSections(scene: SceneBlueprint): string {
  const contextById = new Map((scene.nonCopyableContext || []).map((atom) => [atom.id, atom]));
  const atomText = (id: string): string => {
    const atom = contextById.get(id);
    return atom?.eventText || atom?.sourceText || id;
  };
  const ownedAtoms = (scene.treatmentAtomIds || []).map((id) => `${id}: ${atomText(id)}`);
  const mustDramatize = [
    ...(scene.requiredBeats || []).map((beat) => beat.mustDepict).filter(Boolean),
    ...ownedAtoms,
  ];
  const continuity = [
    ...(scene.ownedChronologyKeys || []).map((key) => `Chronology key already owned here: ${key}`),
    ...(scene.sourceContextIds || []).map((id) => `Context atom available for continuity only: ${id}: ${atomText(id)}`),
  ];
  // Owned atoms are stored in nonCopyableContext too (so atomText() can resolve
  // their prose above), but they must NOT appear in the Non-Copyable list — a scene
  // must stage its own owned facts, and listing them as "must not paraphrase" gives
  // every owned atom contradictory instructions.
  const ownedIds = new Set(scene.treatmentAtomIds || []);
  const nonCopyable = (scene.nonCopyableContext || []).filter((atom) => !ownedIds.has(atom.id));
  if (mustDramatize.length === 0 && continuity.length === 0 && nonCopyable.length === 0) return '';
  return `
### Treatment Event Boundary
#### Primary Owned Facts
${mustDramatize.length ? mustDramatize.map((item) => `- ${item}`).join('\n') : '- No primary treatment facts assigned to this scene.'}

#### Continuity Context
${continuity.length ? continuity.map((item) => `- ${item}`).join('\n') : '- None.'}

#### Non-Copyable Source Context
${nonCopyable.length ? nonCopyable.map((item) => `- ${item.id}: ${item.sourceText || item.eventText}`).join('\n') : '- None.'}

Invariant: primary owned facts are the only treatment facts this scene may newly stage. Continuity and non-copyable context may shape implication, tone, and subtext, but must not be quoted, paraphrased, summarized, or turned into beat prose, choice text, visual metadata, or scene takeaways.
`;
}

export class SceneWriter extends BaseAgent {
  private choiceDensityValidator: ChoiceDensityValidator;
  private textLimits: {
    maxSentences: number;
    maxWords: number;
    maxDialogueWords: number;
    maxDialogueLines: number;
  };

  /** Sampling temperature from construction, restored when contract-load tuning ends. */
  private baseTemperature?: number;

  constructor(config: AgentConfig, generationConfig?: GenerationSettingsConfig) {
    super('Scene Writer', config);
    this.includeSystemPrompt = true;
    this.choiceDensityValidator = new ChoiceDensityValidator();
    this.baseTemperature = config?.temperature;
    // Use generation config text limits or fall back to defaults
    this.textLimits = {
      maxSentences: generationConfig?.maxSentencesPerBeat ?? DEFAULT_LIMITS.maxSentences,
      maxWords: generationConfig?.maxWordsPerBeat ?? DEFAULT_LIMITS.maxWords,
      maxDialogueWords: generationConfig?.maxDialogueWords ?? DEFAULT_LIMITS.maxDialogueWords,
      maxDialogueLines: generationConfig?.maxDialogueLines ?? DEFAULT_LIMITS.maxDialogueLines,
    };
  }

  /**
   * Contract-load temperature tuning (SAR wave 2, R8): heavy-contract scenes
   * author at a lower temperature — precision over flourish when the prompt is
   * mostly enforced obligations. `undefined` restores the construction-time
   * temperature. Clone-on-write: the AgentConfig object passed to the
   * constructor may be shared with other agents, so it is never mutated.
   * Scene generation is serial within an episode, so a per-scene switch here
   * cannot race concurrent execute() calls.
   */
  setContractLoadTemperature(heavyTemperature: number | undefined): void {
    const target = heavyTemperature ?? this.baseTemperature;
    if (this.config.temperature === target) return;
    this.config = { ...this.config, temperature: target };
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Scene Writer

You are a master prose writer who brings scene blueprints to life with concrete, style-safe story intent and concise player-facing prose. You write the actual words players will read.

## Writing Principles: The Two-Pass Method
1. **Pass 1: Cinematic Quality**: Focus on drama, subtext, and reversals first. Every scene must advance Plot, Relationship, or Thematic Pressure.
2. **Pass 2: Interactive Conversion**: Ground interactivity in the scene's truth. Use player state to acknowledging past choices.

### Show, Don't Tell
- Reveal character through action, not description.
- Let the reader infer emotions from behavior.
- Use sensory details to create atmosphere.

### Immersive Description
- Use sensory detail selectively and purposefully; do not force all five senses into every beat.
- Ground scenes in specific, concrete details.
- Vary sentence length for rhythm.
- **Atmospheric Fidelity**: Use the specific prose style and terminology of the source material if identified.

### Character Voice
- Each character must sound distinct.
- Dialogue should reveal personality.
- Use subtext - what's NOT said matters.
- Prefer the gap between what characters say and what they mean; allow direct speech for vows, confessions, tactics, comedy, ritual, or catharsis when pressure earns it.
- **Direct Source Language**: If source material fragments are provided, PRIORITIZE using that exact language for key moments and dialogue.

### Pacing
- Match prose length to moment importance.
- Quick beats for tension, longer for reflection.
- Vary the rhythm within scenes.

### Scene Craft
- Every scene needs a purpose players can feel: plot pressure, relationship movement, theme pressure, information gain, or meaningful aftermath.
- Every scene has one dramatic center. Build the beat sequence around the supplied Scene Turn Contract when present: setup/pre-turn pressure -> turn event -> aftermath or handoff. Do not merely mention the turn and leave.
- If the blueprint supplies themePressure, express it through action, cost, choice, subtext, relationship pressure, information, or identity movement. Never have dialogue state the theme question directly.
- Every scene must have a purpose in emotional, action, or character-related content that advances the story.
- Start as late as possible and leave as soon as the turn, decision, consequence, or handoff lands.
- In multi-character scenes, make leverage, trust, vulnerability, intimacy, distance, information, status, threat, debt, or public/private advantage shift at least once.
- Descriptions, action, dialogue, visual metadata, choices, and final beat should reinforce that purpose and help deliver the sceneTakeaways and keyMoment.
- Identify the scene's key moment and build the beat sequence toward it.
- Scene beats should build toward the scene keyMoment. Intensity does not need to rise mechanically every beat, but tension, gravitas, danger, intimacy, consequence, or dramatic clarity should accumulate across the scene.
- Build a stakes ladder across the beats: each beat should raise risk, reveal cost, narrow options, shift leverage, or deepen consequence until the dominant/peak beat carries the maximum stakes. Rest beats can raise dread, clarity, regret, tenderness, or emotional cost instead of volume.
- Use rest beats only when they create contrast, aftermath, dread, tenderness, or sharper payoff.
- Prefer turns over topics. A beat should visibly change leverage, trust, evidence, proximity, identity, risk, resources, or knowledge; do not let scenes become chains of explanation.
- Include scene takeaways: what the player should learn, feel, or understand by the end.
- Scene takeaways are load-bearing: they name what the player learns, feels, or understands about story, character, relationship, theme, information, or player-state pressure.
- The scene keyMoment should be the beat where those takeaways become felt, proven, revealed, or changed.
- Each non-rest beat should show a concrete shift in action, intent, leverage, mood, relationship dynamic, tactical position, information, or consequence.
- Use natural transition phrasing in continuityNotes or transitionIn ("Later that night", "Back at the observatory") when time or place shifts.
- If the blueprint leaves small connective gaps, fill them naturally with local detail: transition, concrete action, emotional pressure, physical business, clue, consequence, or relationship texture.
- Do not contradict season anchors, source-material fidelity, established character state, player choices, flags, callbacks, or encounter setup context.
- The final beat of each scene should land a pointed resolution or consequence, then create forward pressure into the next beat, choice, scene, encounter, or episode.
- Forward pressure may be a cliffhanger, reveal, unresolved cost, emotional rupture, new danger, changed relationship, choice consequence, or handoff.
- For non-finale episode endings, heighten next-episode pressure. For finale/resolution endings, resolve the central conflict and show aftermath.
- When a cliffhanger plan is supplied, the final beat must satisfy that plan: close the immediate scene/episode tension enough to feel authored, then open the specified next pressure.
- REVEAL SAFETY: a cliffhanger or reveal may DEEPEN a question, never answer a season-scheduled secret early. Never invent canon to sharpen a hook: no new relatives, factions, allegiances, staged-event confirmations, or prior interactions/messages/history the reader never saw on-page.
- When characters are in jeopardy or believe they are in jeopardy, dialogue should become more pointed, urgent, interrupted, selective, or stripped down. As fear, danger, exposure, or time pressure increases, reduce explanation and sharpen what characters say.
- Never write a static meeting where characters only discuss information. If characters talk, ground the conversation in fitting physical activity, spatial pressure, object handling, preparation, travel, hiding, training, repair, cooking, cleaning, fighting, searching, ritual, medical care, escape, or another action appropriate to the circumstances.
- The physical activity should make the power shift or emotional pressure visible.
- Do not directly describe characters' thoughts and feelings. Instead, externalize inner life through brief dialogue, muttered one-line self-speech, silence, interruption, bodily action, object handling, hesitation, distance or closeness, facial expression, choice behavior, callback objects, or what the character does next.
- If a character is alone, use a brief one-line spoken or muttered line when needed.
- If a moment carries deep emotional weight, memory, regret, longing, fear, or reminiscence, express it through action or brief understated dialogue. Use less explanation, not more.
- Keep dialogue spare, quick, and to the point. Dialogue should advance story, reveal character, sharpen pressure, or change the relationship dynamic. Avoid speeches unless the source style, genre, ritual, confession, comedy, or climax truly calls for one.
- When physical action matters, include specific bodily movement: concrete movement, posture, proximity, hand placement, footwork, balance, collision, recoil, grip, breath, facial expression, or object interaction.
- Do not use film/camera direction terms in player-facing prose. Visual metadata may still use the required shotType and visualContinuity fields.
- Vivid means vivid story intent, not ornate prose or generic cinematic styling.
- For player-facing prose: use concrete, concise action and dialogue that makes the story turn legible.
- Write live player-facing story action in present tense. Use past tense only for explicit memories, backstory, recaps, or earlier events. Do not let current action drift into "you felt / you took / was watching / didn't blink" narration.
- For visual metadata and image-facing fields: provide specific story intent, visible action, relationship dynamics, required details, and subtext cues. Do not add art-direction language that fights the active ArtStyleProfile, negative prompt, provider settings, or style-bible anchors.
- Visual metadata should describe what must be understood, not impose a conflicting style. Avoid generic style words like cinematic, hyperreal, vivid colors, dramatic lighting, painterly, anime, flat, gritty, glossy, symmetrical, or high contrast unless they come from the active style contract.

${PROSE_AND_DIALOGUE_CRAFT}
## Fight, Weapon, And Physical Action Scenes
- If a scene includes fighting, weapons, pursuit, survival danger, or major physical action, make the danger concrete and serious.
- Fight/action beats should include specific strikes, maneuvers, evasions, blocks, grapples, throws, falls, impacts, wounds, or damage.
- Weapons or powers should produce destructive effects. Use loud or forceful consequences when appropriate: clashes, cracks, explosions, splintering, shattering, tearing, or ringing impact.
- Use surprising tactical choices or environmental maneuvers; do not let fights become abstract summaries.
- Show visible harm, depletion, fear, pain, exhaustion, loss of advantage, facial expressions, and bodily reactions when characters are wounded or damaged.
- Show through action how the winning side succeeds and what the losing side physically loses, suffers, or fails to protect.
- In action scenes, the hero or allies should be wounded, damaged, depleted, exposed, or narrowly escape a specific harm.

## Conflict Damage
- Every meaningful conflict should damage someone or something.
- Damage may be physical injury, emotional hurt, social humiliation, relational rupture, resource loss, reputation damage, information exposure, identity pressure, moral compromise, lost leverage, increased danger, or narrowing options.
- In fight/action scenes, damage should usually be physical, tactical, environmental, or resource-based, with emotional fallout where appropriate.
- In non-action scenes, damage can be social, relational, emotional, informational, reputational, or identity-based.

${CRAFT_PRESSURE_GUIDANCE}

${NARRATIVE_INTENSITY_RULES}

## Beat Structure (Caps—Engine Has Latitude)

**Caps**: Stay under these limits; use fewer words when the moment doesn't need more.

### Standard Beats
- **Cap**: ${this.textLimits?.maxSentences ?? DEFAULT_LIMITS.maxSentences} sentences, ${this.textLimits?.maxWords ?? DEFAULT_LIMITS.maxWords} words per beat
- Target 2-3 sentences when appropriate
- Focused on ONE moment, ONE action, or ONE short dialogue exchange
- Connected to the next beat naturally

### Climax Beats (SPARING—true narrative peaks only)
- Set \`isClimaxBeat: true\` for the single most intense moment in a scene
- **Cap**: Up to ${TEXT_LIMITS.maxClimaxBeatWordCount} words
- **Max 1-2 per scene**—only for genuine climaxes, not every dramatic moment

### Key Story Beats (turning points)
- Set \`isKeyStoryBeat: true\` for crucial narrative turning points
- **Cap**: Up to ${TEXT_LIMITS.maxKeyStoryBeatWordCount} words
- **Max ${TEXT_LIMITS.maxKeyStoryBeatsPerScene} per scene**

**Why short beats?**
- Mobile screens have limited space
- Players tap to advance - frequent taps feel interactive
- Long text walls cause readers to disengage. DO NOT WRITE PARAGRAPHS.

Example of TOO LONG (DON'T DO THIS):
"The tavern was dim and smoky, filled with the murmur of conversations and the clink of glasses. You pushed through the crowd, scanning faces until you spotted your contact in a shadowy corner booth. She was a tall woman with sharp features and cold eyes that seemed to assess you in an instant. As you approached, she gestured for you to sit, her expression giving nothing away."

Example of CORRECT (multiple short beats):
Beat 1: "The tavern was dim and smoky. You pushed through the crowd, scanning for your contact."
Beat 2: "There—a shadowy corner booth. A tall woman with sharp features watched you approach."
Beat 3: "Her cold eyes assessed you instantly. She gestured for you to sit, expression unreadable."

## Text Variants (STRICT FORMAT)

Use textVariants when player state should change the scene.
**CRITICAL: You MUST use the explicit condition object format.**

Correct Example:
"textVariants": [
  {
    "condition": { "type": "flag", "flag": "is_damaged", "value": true },
    "text": "Your metallic arm sparks with blue electricity."
  }
]

**FORBIDDEN Example (DO NOT DO THIS):**
"textVariants": [
  { "is_damaged": "Your arm sparks." }
]

**Rules:**
- ALWAYS include both "condition" and "text" fields.
- "condition" must have a "type" (flag, score, relationship, attribute).
- "text" must be a non-empty string.
- If a condition is met, this text REPLACES the base text for that beat.

## Consequences

Use onShow consequences when entering a beat should:
- Set a flag (first time entering a location)
- Modify a relationship
- Update a score

## Player-Facing Prose

Do not emit template variables or unresolved placeholders in story text, textVariants, visual contracts, choice text, or callbacks.
Use the protagonist's actual name from the Characters section, concrete pronouns, or direct second-person prose ("you", "your").
NPCs should use exact names and concrete pronouns.

## CRITICAL: Character Names and Pronouns

**ABSOLUTE REQUIREMENTS:**
0. **Opening POV anchor:** The first non-empty player-facing beat MUST establish the player character as the viewpoint/focal character using second-person language ("you", "your"), the protagonist's actual name, or a concrete pronoun. Do not open with pure NPC action, world exposition, or an unnamed camera-like view.
1. **Use EXACT character names** as provided in the Characters section. Do NOT invent names, alter spellings, or use nicknames unless established.
2. **Use CORRECT pronouns** for each character as specified:
   - "he/him" characters: he, him, his, himself
   - "she/her" characters: she, her, hers, herself
   - "they/them" characters: they, them, their, theirs, themselves (singular) — only for characters explicitly marked as they/them
3. **Use he/him or she/her by default.** Only use they/them pronouns for characters explicitly designated as non-binary or transgender. Never default to they/them for a character whose gender is simply unspecified.
4. **Be consistent** - do not switch between pronouns for the same character.
5. **Use names frequently** to avoid ambiguous pronoun references when multiple characters are present.
6. For the protagonist, use the exact protagonist name, concrete pronouns, or "you/your"; never use template syntax.
7. For NPCs, use their exact names and correct pronouns as listed; never use NPC template syntax.

**COMMON ERRORS TO AVOID:**
- Using "he" for a she/her character (or vice versa)
- Inventing names not in the character list
- Using generic terms like "the stranger" when you have the character's name
- Ambiguous pronoun references when multiple same-pronoun characters are present
- Emitting unresolved template syntax or schema placeholders in prose

## Choice Points (STRICT ENFORCEMENT)

When the scene blueprint indicates a choice point:
1. **Identify the Choice Beat**: The very last beat of the scene MUST be the choice point.
2. **Mark the Beat**: Set "isChoicePoint": true on that last beat.
3. **Set Up the Choice**: The text of this beat should end on a cliffhanger, a question, or a moment of high tension where a decision is required.
4. **NO PROSE CHOICES**: Do NOT write the actual choice options in the text. The Choice Author agent will do that.
5. **No nextBeatId**: The choice beat should NOT have a nextBeatId, as the choices will handle navigation.

## Beat Visual Contract (REQUIRED for EVERY beat)

For each beat object, include these fields so image agents do not have to guess:
- "shotType": REQUIRED. The camera intent for this beat. Use "establishing" for beats that are purely atmospheric — describing place, time of day, weather, or environment — with NO character performing a specific action. Use "action" for beats with physical movement or confrontation. Use "character" for all other beats (dialogue, reaction, emotion). When shotType is "establishing", the image should be a wide environment shot with no characters foregrounded.
- "visualMoment": One concrete, observable instant using CHARACTER NAMES. For "establishing" shots, describe the environment/atmosphere: "Neon reflections smear across rain-slicked streets below." For character beats, YES: "Catherine races ahead of Heathcliff across the moor." NO: "Two young people running." NEVER use generic terms like "a woman", "a man", "two people".
- "primaryAction": Verb-led physical action naming the character(s). Leave empty ("") for "establishing" shots. YES: "Catherine sprints barefoot" NO: "running across the moor".
- "emotionalRead": What is visibly readable in face/body language, naming each character. Leave empty ("") for "establishing" shots.
- "relationshipDynamic": Power/proximity/tension between named characters. Leave empty ("") for "establishing" shots.
- "mustShowDetail": One specific visual clue that must appear.
- "dramaticIntent": REQUIRED for non-establishing beats. Include: characterObjectives (object keyed by character name/id), obstacle, statusBefore, statusAfter, subtext, visibleTurn, visualSubtextCue.
- "sequenceIntent": REQUIRED-BY-PROCESS for every non-establishing beat in newly generated multi-beat scenes. The field is optional for old/cached content compatibility, but new output should include objective, activity, obstacle, startState, turningPoint, endState, visualThread, optional mechanicThread, and beatRole.
- "coveragePlan": REQUIRED-BY-PROCESS for every non-establishing beat. Include stagingPattern, shotDistance, cameraAngle, cameraSide, focalCharacterIds, requiredVisibleCharacterIds, optionalVisibleCharacterIds, offscreenCharacterIds, relationshipBlocking, coverageReason, and visualContinuity. The SequenceDirector will repair weak/missing plans, but the writer should author the intended visual coverage.
- "intensityTier": REQUIRED. One of "dominant", "supporting", or "rest". Assign based on the Narrative Intensity Tiering rules above. A scene needs 1-2 dominant beats, 1-2 rest beats, and the remainder as supporting. Vary the intensity across the scene.
- "visualContinuity": OPTIONAL but encouraged. Use it to make this beat flow from the previous beat as the next full-screen image: shotType, cameraAngle, focalCharacterId, blocking, proximity, motifOrProp, previousBeatId, transitionIntent, panelMode. Default panelMode is "single". Do NOT request panels, collages, split screens, contact sheets, or multiple moments inside the same image.

Avoid abstract-only phrases like "tension rises" or "emotion deepens." Describe what is physically visible. ALWAYS use character names — never generic references.

## Dramatic Intent (for ALL character-visible beats)

A character-visible beat is never just information transfer. It is someone pursuing something under resistance. For every non-establishing beat:
- Define what each visible character wants RIGHT NOW, not a season-level desire.
- Name the obstacle that blocks the objective.
- Track status/leverage before and after the beat, even if the shift is subtle.
- Name the subtext beneath the surface action/topic.
- Make "visibleTurn" the thing a viewer could understand with no captions.
- Make "visualSubtextCue" a concrete prop, gesture, distance change, posture shift, reaction, or environmental detail.

Quiet/rest beats are allowed, but still need a visible turn: a hand stops mid-task, an object changes possession, someone creates distance, a routine slips, or a face/body reaction betrays the inner change.

## Sequence Intent (for storyboard continuity)

A scene storyboard is a sequence, not a bag of shots. For newly generated multi-beat scenes, include a scene-level "sequenceIntent" and copy/refine it onto each non-establishing beat:
- objective: what this sequence is trying to accomplish.
- activity: the concrete visible activity carrying it, such as walking to the store, having an argument, searching a room, negotiating, escaping, sword fighting, recovering after a failure.
- obstacle: what resists the objective.
- startState / turningPoint / endState: how the sequence visibly begins, bends, and hands off.
- visualThread: the prop, distance, blocking, clue, wound, gesture, or motif that ties panels together.
- mechanicThread: optional fiction-first hook such as trust, leverage, clue, danger, resource, identity, reputation, callback, or encounter clock.
- beatRole: setup, pressure, escalation, turn, consequence, handoff, or aftermath.

Use sequenceIntent to make consecutive panels read as "setup -> pressure -> turn -> consequence" rather than unrelated illustrations.

**CHARACTER APPEARANCE CONSISTENCY (CRITICAL)**: When describing characters in beat text, visual contract fields, or any visual/descriptive context, you MUST use their canonical Physical Appearance as listed in the Characters section. NEVER invent or change hair color, eye color, body type, or other physical attributes. If a character has "blonde hair" in their physical description, ALWAYS write "blonde hair", NEVER "dark hair" or any other variant. The Physical Appearance entries are the source of truth.

${SCENE_WRITER_BEAT_EXAMPLE}

## Quality Standards

Before finalizing:
- Is the prose engaging and varied?
- Are character voices consistent and distinct?
- Does the scene flow naturally?
- Are sensory details present?
- Does it match the intended mood?
- **Are ALL character names spelled correctly?**
- **Are ALL pronouns correct for each character?**
- **Are pronoun references clear and unambiguous?**

${CHOICE_DENSITY_REQUIREMENTS}
`;
  }

  async execute(input: SceneWriterInput, retryCount: number = 0): Promise<AgentResponse<SceneContent>> {
    const maxRetries = 1; // Allow one revision pass
    const prompt = this.buildPrompt(input);

    console.log(`[SceneWriter] Writing scene: ${input.sceneBlueprint.id} - "${input.sceneBlueprint.name}"${retryCount > 0 ? ` (revision ${retryCount})` : ''}`);

    try {
      const response = await this.callLLM(
        [{ role: 'user', content: prompt }],
        4,
        { jsonSchema: buildSceneContentJsonSchema(input.targetBeatCount) },
      );

      console.log(`[SceneWriter] Received response (${response.length} chars)`);

      if (response.length > SCENE_WRITER_MAX_RAW_RESPONSE_CHARS * 2) {
        return {
          success: false,
          error: `SceneWriter response exceeded raw processing budget (${response.length} > ${SCENE_WRITER_MAX_RAW_RESPONSE_CHARS * 2} chars). Retry with concise beat prose and no boilerplate fields.`,
          rawResponse: response.slice(0, 1000),
        };
      }
      if (response.length > SCENE_WRITER_MAX_RAW_RESPONSE_CHARS) {
        // Soft budget: a parseable response a few percent over is not worth an
        // episode abort — beat-level caps police prose bloat downstream.
        console.warn(`[SceneWriter] Response over soft budget (${response.length} > ${SCENE_WRITER_MAX_RAW_RESPONSE_CHARS} chars); accepting if parseable.`);
      }

      let content: SceneContent;
      try {
        content = this.parseJSON<SceneContent>(response);
        if (this.shouldRepairParsedSceneResponse(response, content)) {
          content = await this.repairMalformedSceneJson(
            input,
            response,
            new Error('SceneWriter response appears truncated or structurally incomplete after JSON repair'),
          );
        }
      } catch (parseError) {
        console.error(`[SceneWriter] JSON parse failed. Raw response (first 500 chars):`, response.substring(0, 500));
        content = await this.repairMalformedSceneJson(input, response, parseError);
      }

      // Normalize arrays that the LLM might return as strings or undefined
      content = this.normalizeContent(content, input);

      content = this.boundOverlongContentForProcessing(content);

      // Check for issues that need revision
      const issues = this.collectIssues(content, input);

      if (issues.length > 0 && retryCount < maxRetries) {
        console.log(`[SceneWriter] Found ${issues.length} issues, requesting revision...`);
        return this.executeRevision(input, content, issues);
      }

      // Out of revision budget: structural defects are a scene failure, never a
      // soft accept — filler/underfilled scenes must fail the pipeline.
      const hardIssues = issues.filter((issue) => this.isHardPostRevisionIssue(issue));
      if (hardIssues.length > 0) {
        return {
          success: false,
          error: `SceneWriter out of revision budget with ${hardIssues.length} hard issue(s): ${hardIssues.slice(0, 5).join(' | ')}`,
        };
      }

      console.log(`[SceneWriter] Scene has ${content.beats?.length || 0} beats`);

      // DEBUG: Log choice point status
      const choicePointBeats = content.beats?.filter(b => b.isChoicePoint) || [];
      console.log(`[SceneWriter] Choice point beats: ${choicePointBeats.length}`);
      if (choicePointBeats.length > 0) {
        choicePointBeats.forEach(beat => {
          console.log(`[SceneWriter]   - Beat "${beat.id}" is marked as choicePoint`);
        });
      } else if (input.sceneBlueprint.choicePoint) {
        console.warn(`[SceneWriter] WARNING: Blueprint has choicePoint but no beat is marked as isChoicePoint!`);
        console.log(`[SceneWriter]   Blueprint choicePoint: ${JSON.stringify(input.sceneBlueprint.choicePoint)}`);
      }

      // Validate the content (with error handling to prevent crashes)
      try {
        this.validateContent(content, input);
      } catch (validationError) {
        // If validation throws, log it but try to continue with auto-fixed content
        const errorMsg = validationError instanceof Error ? validationError.message : String(validationError);
        console.error(`[SceneWriter] Validation error (attempting to continue): ${errorMsg}`);
        
        // If it's a beat reference error, we've already fixed it in normalization, so this shouldn't happen
        // But if it does, log and continue
        if (errorMsg.includes('references non-existent beat')) {
          console.warn(`[SceneWriter] Beat reference error caught - content should have been auto-fixed`);
          // Content should be fine, continue
        } else {
          // For other validation errors, re-throw
          throw validationError;
        }
      }

      return {
        success: true,
        data: this.stripInternalProcessingMarkers(content),
        rawResponse: response,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[SceneWriter] Error:`, errorMsg);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  async executeSemanticPatch(input: SceneSemanticPatchInput): Promise<AgentResponse<SceneSemanticPatch>> {
    const capacityTier = input.capacityTier ?? 'standard';
    const maxOperations = Math.max(1, Math.min(5, input.maxOperations ?? 2));
    const patchableBeats = semanticPatchWindow(input.scene, input.targetAtoms);
    const patchableBeatIds = new Set(patchableBeats.map((beat) => beat.id));
    const schema = {
      name: 'scene_semantic_patch',
      description: 'A bounded reader-facing prose patch for one semantic realization target.',
      outputBudget: capacityTier === 'expanded'
        ? { visibleTokens: 2560, reasoningProfile: 'minimal' as const, safetyTokens: 384, totalCeiling: 6144 }
        : { visibleTokens: 1536, reasoningProfile: 'minimal' as const, safetyTokens: 256, totalCeiling: 4096 },
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['baseSceneHash', 'targetTaskId', 'targetAtomIds', 'operations', 'claimedEvidence'],
        properties: {
          baseSceneHash: { type: 'string', enum: [input.baseSceneHash] },
          targetTaskId: { type: 'string', enum: [input.targetTaskId] },
          targetAtomIds: {
            type: 'array', minItems: input.targetAtomIds.length, maxItems: input.targetAtomIds.length,
            items: { type: 'string', enum: input.targetAtomIds },
          },
          operations: {
            type: 'array', minItems: 1, maxItems: maxOperations,
            items: {
              type: 'object', additionalProperties: false, required: ['op', 'text'],
              properties: {
                op: { type: 'string', enum: ['replace_beat_text', 'replace_transition_in', 'insert_beat_after'] },
                beatId: { type: 'string' },
                text: { type: 'string', minLength: 12, maxLength: 1400 },
              },
            },
          },
          claimedEvidence: {
            type: 'array', minItems: 1, maxItems: 8,
            items: {
              type: 'object', additionalProperties: false, required: ['atomId', 'beatIds'],
              properties: {
                atomId: { type: 'string', enum: input.targetAtomIds },
                beatIds: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string' } },
              },
            },
          },
        },
      },
    };
    const prompt = [
      'You are repairing one semantic realization defect in an otherwise accepted interactive-fiction scene.',
      'Write reader-facing prose. Return a patch only, never a replacement scene.',
      `Use the minimum edits needed, with at most ${maxOperations} operations across the same two adjacent beats. Preserve every unchanged word, canonical name, location, action, relationship stage, and consequence.`,
      'Use replace_beat_text when possible. Use insert_beat_after only when the meaning cannot fit naturally in an existing beat.',
      'For required target atoms, make the missing meaning explicit through natural action or dialogue without copying contract language.',
      'For forbidden target atoms, remove the prohibited label or meaning while preserving the earned behavior and every unrelated fact.',
      '',
      `BASE SCENE HASH: ${input.baseSceneHash}`,
      `TARGET TASK: ${input.targetTaskId}`,
      `TARGET ATOMS: ${input.targetAtomIds.join(', ')}`,
      `REPAIR REQUIREMENT: ${input.repairFeedback}`,
      `TARGET CONTRACTS: ${JSON.stringify(input.targetAtoms.map(compactPatchAtom))}`,
      `MEANING ALREADY PRESENT AND TO PRESERVE: ${JSON.stringify(input.preserveAtoms.map(compactPatchAtom))}`,
      `FORBIDDEN CONSTRAINTS: ${JSON.stringify(input.forbiddenAtoms.map(compactPatchAtom))}`,
      `OTHER CURRENT BLOCKERS: ${JSON.stringify(input.concurrentFindings)}`,
      'PATCHABLE SCENE WINDOW:',
      JSON.stringify({
        sceneId: input.scene.sceneId,
        beats: patchableBeats.map((beat) => ({ id: beat.id, text: beat.text, speaker: beat.speaker })),
      }),
    ].join('\n');
    try {
      const response = await this.callLLM([{ role: 'user', content: prompt }], 2, { jsonSchema: schema });
      const patch = this.parseJSON<SceneSemanticPatch>(response);
      if (patch.baseSceneHash !== input.baseSceneHash || patch.targetTaskId !== input.targetTaskId) {
        return {
          success: false,
          error: 'Scene semantic patch did not preserve its immutable base hash and task target.',
          rawResponse: response,
          failure: { code: 'structured_output_invalid', retryClass: 'correct_structured_output', provider: this.config.provider },
        };
      }
      const returnedAtomIds = new Set(patch.targetAtomIds);
      if (returnedAtomIds.size !== input.targetAtomIds.length || input.targetAtomIds.some((atomId) => !returnedAtomIds.has(atomId))) {
        return {
          success: false,
          error: 'Scene semantic patch did not preserve the exact target atom set.',
          rawResponse: response,
          failure: { code: 'structured_output_invalid', retryClass: 'correct_structured_output', provider: this.config.provider },
        };
      }
      if (patch.operations.some((operation) => operation.beatId && !patchableBeatIds.has(operation.beatId))) {
        return {
          success: false,
          error: 'Scene semantic patch targeted a beat outside its bounded patch window.',
          rawResponse: response,
          failure: { code: 'structured_output_invalid', retryClass: 'correct_structured_output', provider: this.config.provider },
        };
      }
      const claimedAtomIds = new Set(patch.claimedEvidence.map((claim) => claim.atomId));
      if (input.targetAtomIds.some((atomId) => !claimedAtomIds.has(atomId))) {
        return {
          success: false,
          error: 'Scene semantic patch omitted claimed evidence for a target atom.',
          rawResponse: response,
          failure: { code: 'structured_output_invalid', retryClass: 'correct_structured_output', provider: this.config.provider },
        };
      }
      return { success: true, data: patch, rawResponse: response };
    } catch (error) {
      if (error instanceof TruncatedLLMResponseError) {
        const visibleOutputStarved = typeof error.thoughtsTokens === 'number'
          && typeof error.requestedMaxTokens === 'number'
          && error.thoughtsTokens >= error.requestedMaxTokens * 0.75;
        return {
          success: false,
          error: error.message,
          failure: {
            code: visibleOutputStarved ? 'visible_output_starved' : 'structured_output_truncated',
            retryClass: 'adjust_call_budget',
            provider: error.provider,
            requestedMaxTokens: error.requestedMaxTokens,
            outputTokens: error.outputTokens,
            thoughtsTokens: error.thoughtsTokens,
          },
        };
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        failure: {
          code: 'structured_output_invalid',
          retryClass: 'correct_structured_output',
          provider: this.config.provider,
        },
      };
    }
  }

  private shouldRepairParsedSceneResponse(response: string, content: SceneContent): boolean {
    const trimmed = response.trim();
    const openedFence = /^```(?:json|JSON)?/.test(trimmed);
    const closedFence = /```\s*$/.test(trimmed);
    if (openedFence && !closedFence) return true;
    if (!trimmed.endsWith('}') && !trimmed.endsWith(']') && !closedFence) return true;
    if (!content?.sceneId || !Array.isArray(content.beats) || content.beats.length === 0) return true;
    const firstBadBeat = content.beats.find((beat: any) => typeof beat?.text !== 'string' || beat.text.trim().length < 12);
    return Boolean(firstBadBeat);
  }

  private stripAgentFacingPressureParagraphs(text: string, fallback: string): string {
    const cleaned = String(text || '')
      .split(/\n{2,}|\r?\n/)
      .map((part) => part.trim())
      .filter((part) => part && !/^(?:pressure|choice pressure|forward pressure):/i.test(part))
      .join('\n\n')
      .trim();
    return cleaned || this.ensureTerminalPunctuation(fallback);
  }

  private async repairMalformedSceneJson(
    input: SceneWriterInput,
    malformedResponse: string,
    parseError: unknown,
  ): Promise<SceneContent> {
    const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
    const wasTruncated = parseError instanceof TruncatedLLMResponseError;
    const compactBlueprint = {
      id: input.sceneBlueprint.id,
      name: input.sceneBlueprint.name,
      description: input.sceneBlueprint.description,
      location: input.sceneBlueprint.location,
      mood: input.sceneBlueprint.mood,
      purpose: input.sceneBlueprint.purpose,
      narrativeFunction: this.stripAgentFacingPressureParagraphs(
        input.sceneBlueprint.narrativeFunction,
        input.sceneBlueprint.description || input.sceneBlueprint.name
      ),
      dramaticQuestion: input.sceneBlueprint.dramaticQuestion,
      wantVsNeed: input.sceneBlueprint.wantVsNeed,
      conflictEngine: input.sceneBlueprint.conflictEngine,
      themePressure: input.sceneBlueprint.themePressure,
      keyBeats: (input.sceneBlueprint.keyBeats || [])
        .filter((beat) => !isAgentFacingPressureNote(beat))
        .map(stripAgentFacingPressureLabel),
      choicePoint: input.sceneBlueprint.choicePoint,
      leadsTo: input.sceneBlueprint.leadsTo,
    };
    const visibleCharacters = [
      {
        role: 'protagonist',
        name: input.protagonistInfo.name,
        pronouns: input.protagonistInfo.pronouns,
        description: input.protagonistInfo.description,
      },
      ...input.npcs
        .filter((npc) => input.sceneBlueprint.npcsPresent.includes(npc.id))
        .map((npc) => ({
          id: npc.id,
          name: npc.name,
          pronouns: npc.pronouns,
          description: npc.description,
          voiceNotes: npc.voiceNotes,
        })),
    ];
    const repairPrompt = `
The previous SceneWriter response for scene "${input.sceneBlueprint.id}" was ${wasTruncated ? 'truncated' : 'malformed JSON'} and could not be used.

Parse error:
${errorMessage}

Your job is to ${wasTruncated ? 'REGENERATE' : 'RE-EMIT'} the complete scene as valid JSON only. Do not explain. Do not use markdown fences. Do not return a partial object.

Scene blueprint:
${JSON.stringify(compactBlueprint)}

Story context:
${JSON.stringify({
  title: input.storyContext.title,
  genre: input.storyContext.genre,
  tone: input.storyContext.tone,
  targetBeatCount: input.targetBeatCount,
  dialogueHeavy: input.dialogueHeavy,
})}

Characters:
${JSON.stringify(visibleCharacters)}

${wasTruncated
  ? `Do not continue the truncated response. Use the blueprint and story context above to regenerate the whole scene cleanly.`
  : `Malformed response to repair or regenerate from:\n${malformedResponse.slice(0, 24000)}`}

Return exactly one complete SceneContent JSON object with:
- sceneId, sceneName, startingBeatId, beats, charactersInvolved
- include moodProgression, keyMoments, sceneTakeaways, transitionIn, or continuityNotes only when they carry specific scene craft, continuity, or validation value
- up to ${input.targetBeatCount} beats
- concise strings so the response cannot truncate
- no markdown code block
- no prose outside JSON
`;

    console.warn(`[SceneWriter] Attempting JSON repair pass for ${input.sceneBlueprint.id}`);
    const repairedResponse = await this.callLLM(
      [{ role: 'user', content: repairPrompt }],
      2,
      { jsonSchema: buildSceneContentJsonSchema(input.targetBeatCount) },
    );
    try {
      const repaired = this.parseJSON<SceneContent>(repairedResponse);
      console.log(`[SceneWriter] JSON repair pass succeeded for ${input.sceneBlueprint.id}`);
      return repaired;
    } catch (repairError) {
      const repairMessage = repairError instanceof Error ? repairError.message : String(repairError);
      console.error(`[SceneWriter] JSON repair pass failed for ${input.sceneBlueprint.id}: ${repairMessage}`);
      throw new Error(`SceneWriter JSON repair failed after malformed response: ${repairMessage}`);
    }
  }

  private normalizeContent(content: SceneContent, input?: SceneWriterInput): SceneContent {
    // Canonical hook ids the prompt advertised (already `flag:`/`score:`-prefixed).
    // Used to normalize any bare callbackHookId the LLM emits on textVariants.
    const knownHookIds = new Set((input?.unresolvedCallbacks || []).map(h => h.id));

    // Ensure scalar fields have defaults - use scene blueprint values if available
    if (!content.sceneId) {
      content.sceneId = input?.sceneBlueprint?.id || 'scene-1';
    }
    if (!content.sceneName) {
      content.sceneName = input?.sceneBlueprint?.name || 'Untitled Scene';
    }

    // Ensure top-level arrays are arrays
    if (!content.moodProgression) {
      content.moodProgression = [];
    } else if (!Array.isArray(content.moodProgression)) {
      content.moodProgression = [content.moodProgression as unknown as string];
    }

    if (!content.charactersInvolved) {
      content.charactersInvolved = [];
    } else if (!Array.isArray(content.charactersInvolved)) {
      content.charactersInvolved = [content.charactersInvolved as unknown as string];
    }

    if (!content.keyMoments) {
      content.keyMoments = [];
    } else if (!Array.isArray(content.keyMoments)) {
      content.keyMoments = [content.keyMoments as unknown as string];
    }

    if (!content.continuityNotes) {
      content.continuityNotes = [];
    } else if (!Array.isArray(content.continuityNotes)) {
      content.continuityNotes = [content.continuityNotes as unknown as string];
    }

    if (!content.sceneTakeaways) {
      content.sceneTakeaways = [];
    } else if (!Array.isArray(content.sceneTakeaways)) {
      content.sceneTakeaways = [content.sceneTakeaways as unknown as string];
    }

    if (content.realizedEventIds && !Array.isArray(content.realizedEventIds)) {
      content.realizedEventIds = [String(content.realizedEventIds)];
    }
    if (content.assignedEventIds && !Array.isArray(content.assignedEventIds)) {
      content.assignedEventIds = [String(content.assignedEventIds)];
    }
    if (content.claimedEventIds && !Array.isArray(content.claimedEventIds)) {
      content.claimedEventIds = [String(content.claimedEventIds)];
    }
    if (content.verifiedEventIds && !Array.isArray(content.verifiedEventIds)) {
      content.verifiedEventIds = [String(content.verifiedEventIds)];
    }
    if (content.eventEvidence && !Array.isArray(content.eventEvidence)) {
      content.eventEvidence = [content.eventEvidence as unknown as { eventId: string; evidence: string }];
    }
    const assignedEventIds = input?.sceneBlueprint.assignedEventIds
      ?? input?.sceneBlueprint.narrativeEventIds
      ?? [];
    const assignedEventIdSet = new Set(assignedEventIds);
    const ownedTasks = (input?.sceneBlueprint.realizationTasks ?? []).filter((task) => task.ownerStage === 'scene_writer');
    const allowedTaskIds = new Set(ownedTasks.map((task) => task.id));
    const allowedAtomIds = new Set(ownedTasks.flatMap((task) => task.evidenceAtoms.map((atom) => atom.id)));
    for (const claim of content.eventEvidence ?? []) {
      // Evidence labels are model-authored diagnostics, never verification
      // authority. Preserve foreign event IDs so validateContent rejects an
      // ownership breach, but discard stale task/atom labels on an assigned
      // event and let the canonical gates judge the prose itself.
      if (!claim || !assignedEventIdSet.has(claim.eventId)) continue;
      if (claim.taskId && !allowedTaskIds.has(claim.taskId)) {
        console.warn(`[SceneWriter] Dropping unassigned realization task label ${claim.taskId} from evidence for ${claim.eventId}`);
        delete claim.taskId;
      }
      if (claim.atomId && !allowedAtomIds.has(claim.atomId)) {
        console.warn(`[SceneWriter] Dropping unassigned realization atom label ${claim.atomId} from evidence for ${claim.eventId}`);
        delete claim.atomId;
      }
    }
    content.assignedEventIds = [...assignedEventIds];
    content.verifiedEventIds = [];

    if (content.transitionIn && typeof content.transitionIn !== 'string') {
      content.transitionIn = String(content.transitionIn);
    }

    if (!content.sequenceIntent || this.isWeakSequenceIntent(content.sequenceIntent)) {
      content.sequenceIntent = this.deriveSceneSequenceIntent(content, input);
    }

    if (!content.beats) {
      content.beats = [];
    } else if (!Array.isArray(content.beats)) {
      content.beats = [content.beats as unknown as GeneratedBeat];
    }

    // Normalize each beat
    for (let i = 0; i < content.beats.length; i++) {
      const beat = content.beats[i];

      // Ensure beat has an id
      if (!beat.id) {
        beat.id = `beat-${i + 1}`;
      }

      // Ensure beat has text as a string
      // LLM sometimes uses 'content' instead of 'text' or nests it in an object
      const anyBeat = beat as any;
      if (!beat.text) {
        if (anyBeat.content) {
          if (typeof anyBeat.content === 'string') {
            beat.text = anyBeat.content;
          } else if (typeof anyBeat.content === 'object') {
            beat.text = anyBeat.content.narrative || anyBeat.content.text || anyBeat.content.dialogue?.[0]?.text || '';
          }
        } else if (anyBeat.narrative) {
          beat.text = anyBeat.narrative;
        }
      }

      if (!beat.text) {
        beat.text = '';
      } else if (typeof beat.text !== 'string') {
        // LLM sometimes returns text as an object or array - handle it gracefully
        if (Array.isArray(beat.text)) {
          beat.text = beat.text.map(item => {
            if (typeof item === 'string') return item;
            if (typeof item === 'object' && item !== null) {
              return (item as any).text || (item as any).content || JSON.stringify(item);
            }
            return String(item);
          }).join(' ');
        } else if (typeof beat.text === 'object' && beat.text !== null) {
          beat.text = (beat.text as any).text || (beat.text as any).content || JSON.stringify(beat.text);
        } else {
          beat.text = String(beat.text);
        }
        console.warn(`[SceneWriter] Beat ${beat.id || i} had non-string text, converted to string: ${beat.text.substring(0, 50)}...`);
      }
      beat.text = this.stripAgentFacingPressureParagraphs(
        beat.text,
        input?.sceneBlueprint?.description || input?.sceneBlueprint?.dramaticQuestion || input?.sceneBlueprint?.name || 'The story pressure changes.'
      );
      beat.text = this.compactShortOverFragmentedText(
        beat.text,
        beat.isClimaxBeat
          ? TEXT_LIMITS.maxClimaxBeatWordCount
          : beat.isKeyStoryBeat
            ? TEXT_LIMITS.maxKeyStoryBeatWordCount
            : TEXT_LIMITS.maxBeatWordCount,
        4,
        `beat ${beat.id || i}`,
      );

      if (beat.textVariants && !Array.isArray(beat.textVariants)) {
        beat.textVariants = [beat.textVariants as unknown as TextVariant];
      }
      
      // AUTO-FIX: Legacy single-key residue variants from older runs.
      // Do not turn `{ text: "" }` or other schema-shaped boilerplate into a
      // fake flag; collectIssues will send malformed variants back for revision.
      if (beat.textVariants) {
        beat.textVariants = beat.textVariants.map(variant => {
          const v = variant as any;
          // Check for "lazy" variant: { "flag_name": "text" }
          if (typeof variant === 'object' && !variant.text && !variant.condition) {
            const keys = Object.keys(variant);
            if (keys.length === 1 && keys[0] !== 'text' && typeof v[keys[0]] === 'string' && v[keys[0]].trim().length > 0) {
              console.warn(`[SceneWriter] Auto-fixing lazy text variant: ${keys[0]}`);
              return {
                condition: { type: 'flag' as const, flag: keys[0], value: true },
                text: v[keys[0]]
              } as TextVariant;
            }
          }
          // AUTO-FIX (parse-time consumer canonicalization): encounter-outcome
          // flag spellings in variant conditions are fixed where they are
          // authored (G12/G13: partial_victory vs partialVictory dead residue).
          // The final-contract walker stays as a regression net.
          if (variant?.condition) {
            canonicalizeConditionOutcomeFlags(variant.condition);
          }
          // AUTO-FIX: a callbackHookId pointing at a STRUCTURAL flag
          // (`treatment_branch_`/`route_`/`tint:`) is always a mislabel — the ledger
          // never registers these (they're paid off by the branch + reconvergence
          // residue, i.e. the variant's own `condition.flag`, not a callback line).
          // Drop the bogus callbackHookId (keeping condition.flag) so it can't trip
          // the dangling-payoff gate (Season Canon abort, bite-me-g14 2026-06-11).
          if (variant && variant.callbackHookId && isStructuralFlag(variant.callbackHookId)) {
            delete variant.callbackHookId;
          }
          // AUTO-FIX: canonicalize a bare callbackHookId to its planted `flag:`/
          // `score:` ledger id. Agents copy the condition flag name into
          // callbackHookId instead of the prefixed hook id, which trips the
          // dangling-payoff gate (Season Canon abort, bite-me-g14 2026-06-11).
          // Normalize here, at parse time, against the hook ids the prompt showed.
          if (variant && variant.callbackHookId && knownHookIds.size > 0) {
            variant.callbackHookId = canonicalizeHookId(
              variant.callbackHookId,
              (id) => knownHookIds.has(id),
            );
          }
          if (variant?.callbackHookId && !knownHookIds.has(variant.callbackHookId)) {
            console.warn(`[SceneWriter] Dropping unknown callbackHookId "${variant.callbackHookId}" from beat ${beat.id}; callbackHookId must match a prompt-provided ledger hook.`);
            delete variant.callbackHookId;
          }
          if (variant?.callbackHookId && !this.isMeaningfulVariantCondition(variant.condition)) {
            const callbackCondition = this.buildCallbackVariantCondition(input, variant.callbackHookId);
            if (callbackCondition) {
              variant.condition = callbackCondition as any;
            }
          }
          if (typeof variant?.text === 'string') {
            variant.text = this.compactShortOverFragmentedText(
              variant.text,
              TEXT_LIMITS.maxBeatWordCount,
              4,
              `beat ${beat.id || i} textVariant`,
            );
          }
          return variant;
        }).filter((variant) => {
          const v = variant as any;
          if (!v || typeof v.text !== 'string' || v.text.trim().length === 0) return false;
          if (this.isMeaningfulVariantCondition(v.condition)) return true;
          const conditionWasAttempted = Boolean(
            v.condition
            && typeof v.condition === 'object'
            && Object.keys(v.condition as Record<string, unknown>).length > 0
          );
          if (conditionWasAttempted || v.callbackHookId) return true;
          console.warn(`[SceneWriter] Dropping boilerplate textVariant from beat ${beat.id}; no meaningful condition was provided.`);
          return false;
        });
      }

      if (beat.onShow && !Array.isArray(beat.onShow)) {
        beat.onShow = [beat.onShow as unknown as Consequence];
      }

      // Ensure visual contract fields exist and are concrete enough for downstream image agents.
      this.ensureBeatVisualContract(beat);
      this.ensureBeatSequenceIntent(beat, content, i);
    }

    // Collapse duplicate narrative beats. The LLM sometimes emits the same
    // paragraph several times in one scene (bite-me 2026-07-02T20-30-27 s1-5:
    // four beats with identical text — QA read it as zero narrative
    // progression). Only long, non-interactive beats collapse; choice points,
    // beats with choices, and variant-carrying beats are never touched.
    const seenBeatText = new Map<string, string>();
    const removedRedirect = new Map<string, string | undefined>();
    content.beats = content.beats.filter((beat) => {
      const normalizedText = (beat.text || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const interactive = beat.isChoicePoint
        || ((beat.choices?.length ?? 0) > 0)
        || Boolean((beat as { textVariants?: unknown }).textVariants);
      if (normalizedText.length < 40 || interactive) return true;
      const survivor = seenBeatText.get(normalizedText);
      if (!survivor) {
        seenBeatText.set(normalizedText, beat.id);
        return true;
      }
      removedRedirect.set(beat.id, beat.nextBeatId);
      console.warn(`[SceneWriter] Collapsed duplicate beat "${beat.id}" (same text as "${survivor}") in scene ${content.sceneId}`);
      return false;
    });
    if (removedRedirect.size > 0) {
      const resolveBeatId = (id: string | undefined): string | undefined => {
        let current = id;
        const visited = new Set<string>();
        while (current && removedRedirect.has(current) && !visited.has(current)) {
          visited.add(current);
          current = removedRedirect.get(current);
        }
        return current;
      };
      for (const beat of content.beats) {
        beat.nextBeatId = resolveBeatId(beat.nextBeatId);
      }
    }


    // Degenerate scenes (single beat, underfilled choice scenes) are NOT padded
    // with synthetic beats here — padding before collectIssues() used to mask
    // SINGLE BEAT / SCENE-LENGTH UNDERFILL from the revision loop, shipping
    // filler prose as story content. Underfill now surfaces as a hard issue:
    // revision gets a real chance to fix it, and if it can't, the scene fails
    // the pipeline instead of shipping filler.

    // Every scene needs an emotional peak. The LLM occasionally returns no
    // dominant-tier beat (the intensity_distribution diagnostic flags these as
    // "no clear emotional peak"). Deterministically promote the scene's turn beat
    // to dominant so the scene always has a high point.
    this.ensureDominantBeat(content);

    // Re-run visual contract normalization in case we synthesized structural beats.
    for (const beat of content.beats) {
      this.ensureBeatVisualContract(beat);
      this.ensureBeatSequenceIntent(beat, content, content.beats.indexOf(beat));
    }

    applySequenceDirectorPlan(content, {
      sceneDescription: input?.sceneBlueprint?.description,
      locationName: input?.sceneBlueprint?.location,
      genre: input?.storyContext?.genre,
      tone: input?.storyContext?.tone,
    });

    // Normalize beat IDs and fix nextBeatId references
    const beatIds = new Set(content.beats.map(b => b.id));
    const beatIndexMap = new Map<string, number>();
    content.beats.forEach((b, idx) => {
      beatIndexMap.set(b.id, idx);
    });

    // Fix invalid nextBeatId references
    for (let i = 0; i < content.beats.length; i++) {
      const beat = content.beats[i];
      
      if (beat.nextBeatId && !beatIds.has(beat.nextBeatId)) {
        let fixed = false;
        
        // Try multiple strategies to fix the reference
        // Strategy 1: Extract all numbers and try each (e.g., "beat-3-2" -> try "beat-3", "beat-2")
        const allNumbers = beat.nextBeatId.match(/\d+/g);
        if (allNumbers) {
          for (const num of allNumbers) {
            const candidateId = `beat-${num}`;
            if (beatIds.has(candidateId)) {
              console.log(`[SceneWriter] Auto-fixing nextBeatId: "${beat.nextBeatId}" -> "${candidateId}"`);
              beat.nextBeatId = candidateId;
              fixed = true;
              break;
            }
          }
        }
        
        // Strategy 2: Try the last number (often the correct one in patterns like "beat-3-2")
        if (!fixed && allNumbers && allNumbers.length > 1) {
          const lastNumber = allNumbers[allNumbers.length - 1];
          const candidateId = `beat-${lastNumber}`;
          if (beatIds.has(candidateId)) {
            console.log(`[SceneWriter] Auto-fixing nextBeatId: "${beat.nextBeatId}" -> "${candidateId}" (using last number)`);
            beat.nextBeatId = candidateId;
            fixed = true;
          }
        }
        
        // Strategy 3: Use next beat in sequence
        if (!fixed && i < content.beats.length - 1) {
          const nextBeat = content.beats[i + 1];
          console.log(`[SceneWriter] Auto-fixing nextBeatId: "${beat.nextBeatId}" -> "${nextBeat.id}" (next in sequence)`);
          beat.nextBeatId = nextBeat.id;
          fixed = true;
        }
        
        // Strategy 4: Last beat - clear the reference (choices will handle navigation)
        if (!fixed) {
          console.log(`[SceneWriter] Clearing invalid nextBeatId "${beat.nextBeatId}" from beat ${beat.id} (last beat or no match found)`);
          beat.nextBeatId = undefined;
        }
      } else if (!beat.nextBeatId && i < content.beats.length - 1) {
        // No nextBeatId specified - auto-add it to maintain chain
        const nextBeat = content.beats[i + 1];
        beat.nextBeatId = nextBeat.id;
      }
    }

    // NEW: Detect and fix "all beats pointing to same target" issue (LLM hallucination)
    const nextBeatIdCounts = new Map<string, number>();
    for (const beat of content.beats) {
      if (beat.nextBeatId) {
        nextBeatIdCounts.set(beat.nextBeatId, (nextBeatIdCounts.get(beat.nextBeatId) || 0) + 1);
      }
    }
    
    // If more than 3 beats point to the same target, it's likely an LLM error - fix to sequential
    for (const [targetId, count] of nextBeatIdCounts) {
      if (count >= 3) {
        console.warn(`[SceneWriter] DETECTED LLM ERROR: ${count} beats all point to "${targetId}" - fixing to sequential navigation`);
        for (let i = 0; i < content.beats.length; i++) {
          const beat = content.beats[i];
          const nextBeat = content.beats[i + 1];
          
          // Skip beats with choices (they handle their own navigation)
          if (beat.isChoicePoint) continue;
          
          if (nextBeat) {
            if (beat.nextBeatId !== nextBeat.id) {
              console.log(`[SceneWriter]   Fixed: ${beat.id} now -> ${nextBeat.id}`);
              beat.nextBeatId = nextBeat.id;
            }
          } else {
            // Last beat - clear nextBeatId
            beat.nextBeatId = undefined;
          }
        }
        break; // Only need to fix once
      }
    }

    // Ensure startingBeatId is set - default to first beat if not provided
    if (!content.startingBeatId && content.beats.length > 0) {
      content.startingBeatId = content.beats[0].id;
      console.log(`[SceneWriter] Set default startingBeatId to: ${content.startingBeatId}`);
    }

    // Add timing annotations to beats
    this.annotateBeatsWithTiming(content);

    return content;
  }

  private boundOverlongContentForProcessing(content: SceneContent): SceneContent {
    for (const beat of content.beats || []) {
      if (typeof beat.text === 'string' && beat.text.length > SCENE_WRITER_MAX_PROCESSING_TEXT_CHARS) {
        (beat as any).__sceneWriterOriginalTextCharCount = beat.text.length;
        beat.text = this.clipForSceneProcessing(beat.text, SCENE_WRITER_MAX_PROCESSING_TEXT_CHARS);
      }

      for (const variant of beat.textVariants || []) {
        const candidate = variant as any;
        if (typeof candidate.text === 'string' && candidate.text.length > SCENE_WRITER_MAX_PROCESSING_TEXT_CHARS) {
          candidate.__sceneWriterOriginalTextCharCount = candidate.text.length;
          candidate.text = this.clipForSceneProcessing(candidate.text, SCENE_WRITER_MAX_PROCESSING_TEXT_CHARS);
        }
      }
    }
    return content;
  }

  private clipForSceneProcessing(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    const head = text.slice(0, Math.max(0, maxChars - 180)).trimEnd();
    return `${head}\n\n[Generation note: this field was ${text.length} characters and exceeded the SceneWriter processing budget. Rewrite it concisely instead of preserving this note.]`;
  }

  private stripInternalProcessingMarkers(content: SceneContent): SceneContent {
    for (const beat of content.beats || []) {
      delete (beat as any).__sceneWriterOriginalTextCharCount;
      for (const variant of beat.textVariants || []) {
        delete (variant as any).__sceneWriterOriginalTextCharCount;
      }
    }
    return content;
  }

  private hasOverlongProcessingMarker(content: SceneContent): boolean {
    return Boolean((content.beats || []).some((beat: any) =>
      beat.__sceneWriterOriginalTextCharCount
      || (beat.textVariants || []).some((variant: any) => variant.__sceneWriterOriginalTextCharCount)
    ));
  }

  private compactForRevisionPrompt<T>(value: T): T {
    return JSON.parse(JSON.stringify(value, (_key, raw) => {
      if (typeof raw !== 'string' || raw.length <= SCENE_WRITER_REVISION_TEXT_CHARS) return raw;
      return this.clipForSceneProcessing(raw, SCENE_WRITER_REVISION_TEXT_CHARS);
    }));
  }

  private countSentencesBounded(text: string): number {
    return (text.match(/[.!?]+/g) || []).length;
  }

  private wordCount(text: string): number {
    const trimmed = text.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  }

  private compactShortOverFragmentedText(
    text: string,
    maxWords: number,
    maxSentences: number,
    label: string,
  ): string {
    if (!text || this.countSentencesBounded(text) <= maxSentences) return text;
    if (this.wordCount(text) > maxWords) return text;
    if (text.length > 700) return text;

    const fragments = text
      .match(/[^.!?]+[.!?]+|[^.!?]+$/g)
      ?.map((fragment) => fragment.trim())
      .filter(Boolean);
    if (!fragments || fragments.length <= maxSentences || fragments.length > 9) return text;

    const groups: string[][] = Array.from({ length: maxSentences }, () => []);
    fragments.forEach((fragment, index) => {
      groups[Math.min(maxSentences - 1, Math.floor(index * maxSentences / fragments.length))].push(fragment);
    });

    const compacted = groups
      .filter((group) => group.length > 0)
      .map((group) => group.map((fragment, index) => {
        const cleaned = fragment.replace(/[.!?]+$/g, '').trim();
        if (index < group.length - 1) return `${cleaned},`;
        const terminal = fragment.match(/[.!?]+$/)?.[0]?.slice(-1) || '.';
        return `${cleaned}${terminal}`;
      }).join(' '))
      .join(' ');

    if (this.countSentencesBounded(compacted) <= maxSentences) {
      console.warn(`[SceneWriter] Compacted over-fragmented ${label}: ${fragments.length} sentence fragments -> ${this.countSentencesBounded(compacted)} sentences`);
      return compacted;
    }
    return text;
  }

  private isMeaningfulVariantCondition(condition: unknown): boolean {
    if (!condition || typeof condition !== 'object') return false;
    const candidate = condition as Record<string, unknown>;
    if (Object.keys(candidate).length === 0) return false;
    if (typeof candidate.flag === 'string' && candidate.flag.trim().length > 0) return true;
    if (typeof candidate.score === 'string' && candidate.score.trim().length > 0) return true;
    switch (candidate.type) {
      case 'flag':
        return typeof candidate.flag === 'string' && candidate.flag.trim().length > 0;
      case 'score':
        return typeof candidate.score === 'string' && candidate.score.trim().length > 0;
      case 'relationship':
        return typeof candidate.npcId === 'string' && candidate.npcId.trim().length > 0;
      case 'attribute':
        return typeof candidate.attribute === 'string' && candidate.attribute.trim().length > 0;
      case 'skill':
        return typeof candidate.skill === 'string' && candidate.skill.trim().length > 0;
      case 'tag':
        return typeof candidate.tag === 'string' && candidate.tag.trim().length > 0;
      case 'item':
        return typeof candidate.itemId === 'string' && candidate.itemId.trim().length > 0;
      case 'identity':
        return typeof candidate.dimension === 'string' && candidate.dimension.trim().length > 0;
      case 'and':
      case 'or':
        return Array.isArray(candidate.conditions) && candidate.conditions.length > 0;
      case 'not':
        return Boolean(candidate.condition && typeof candidate.condition === 'object');
      default:
        return false;
    }
  }

  private buildCallbackVariantCondition(input: SceneWriterInput | undefined, callbackHookId: unknown): unknown | null {
    if (!input || typeof callbackHookId !== 'string') return null;
    const hook = (input.unresolvedCallbacks || []).find((candidate) => candidate.id === callbackHookId);
    const flags = (hook?.conditionKeys?.length ? hook.conditionKeys : hook?.flags || [])
      .filter((flag): flag is string => typeof flag === 'string' && flag.trim().length > 0);
    if (flags.length === 0) return null;
    if (flags.length === 1) {
      return { type: 'flag', flag: flags[0], value: true };
    }
    return {
      type: 'and',
      conditions: flags.map((flag) => ({ type: 'flag', flag, value: true })),
    };
  }

  private isHardPostRevisionIssue(issue: string): boolean {
    return (
      issue.startsWith('OVERLONG ') ||
      issue.startsWith('MALFORMED TEXT VARIANT') ||
      issue.startsWith('SCHEMA PLACEHOLDER LEAK') ||
      issue.startsWith('BEATS EXCEED CAP') ||
      issue.startsWith('TOO MANY CLIMAX BEATS') ||
      issue.startsWith('TOO MANY KEY STORY BEATS') ||
      issue.startsWith('MISSING CHOICE POINT') ||
      issue.startsWith('NO BEATS') ||
      issue.startsWith('SINGLE BEAT') ||
      issue.startsWith('SCENE-LENGTH UNDERFILL')
    );
  }

  /**
   * Guarantee at least one `dominant`-tier beat per scene. The LLM is asked for
   * 1-2 dominant beats but sometimes returns none, leaving the scene without an
   * emotional peak. When that happens we promote the scene's turn beat — the
   * climax/key-story beat, else the choice point, else the middle beat — to
   * `dominant`. No-op when a dominant beat already exists. Mirrors the turn-beat
   * selection used for shotType/coverage so the promoted beat is the same one the
   * rest of the pipeline already treats as the peak.
   */
  private ensureDominantBeat(content: SceneContent): void {
    const beats = content.beats;
    if (!Array.isArray(beats) || beats.length === 0) return;
    if (beats.some((b) => b.intensityTier === 'dominant')) return;

    const turnBeat =
      beats.find((b) => b.isClimaxBeat || b.isKeyStoryBeat) ||
      beats.find((b) => b.isChoicePoint) ||
      beats[Math.floor(beats.length / 2)] ||
      beats[0];
    if (turnBeat) turnBeat.intensityTier = 'dominant';
  }

  private ensureTerminalPunctuation(text: string): string {
    if (!text) return text;
    return /[.!?]$/.test(text) ? text : `${text}.`;
  }

  /**
   * Annotate beats with timing metadata and analyze choice density
   */
  private annotateBeatsWithTiming(content: SceneContent): void {
    if (content.beats.length === 0) return;

    let cumulativeSeconds = 0;
    let firstChoiceSeconds: number | undefined;
    let hasChoicePoint = false;

    for (const beat of content.beats) {
      const timing = this.choiceDensityValidator.getTimingForBeat(
        beat.text,
        cumulativeSeconds
      );

      // Update timing with choice point info
      timing.isChoicePoint = beat.isChoicePoint || false;
      cumulativeSeconds = timing.cumulativeSeconds;

      beat.timing = timing;

      // Track first choice point
      if (beat.isChoicePoint && firstChoiceSeconds === undefined) {
        firstChoiceSeconds = cumulativeSeconds;
        hasChoicePoint = true;
      }
    }

    // Add timing analysis summary
    content.timingAnalysis = {
      totalReadingTimeSeconds: cumulativeSeconds,
      hasChoicePoint,
      estimatedTimeToFirstChoice: firstChoiceSeconds,
    };

    // Warn about choice density issues (logging only, not blocking)
    if (content.timingAnalysis.totalReadingTimeSeconds > 60 && !hasChoicePoint) {
      console.warn(
        `[SceneWriter] Scene "${content.sceneName}" has ${Math.round(cumulativeSeconds)}s of content but no choice point`
      );
    }
  }

  /**
   * Get timing metadata for beats (public method for external use)
   */
  getBeatsWithTiming(beats: Array<{ id: string; text: string; isChoicePoint?: boolean }>) {
    return this.choiceDensityValidator.annotateBeatsWithTiming(beats);
  }

  /**
   * Step 2 (info-reveal): when StoryArchitect assigned authored INFO reveals to this
   * scene, instruct the writer to dramatize each on-page. Returns '' when none, leaving
   * the prompt byte-identical for scenes with no scheduled information phase.
   */
  private buildRevealDirectivesSection(input: SceneWriterInput): string {
    const setup = (input.setupDirectives ?? []).filter((d) => d?.fact?.trim());
    const reveal = (input.revealDirectives ?? []).filter((d) => d?.fact?.trim());
    const payoff = (input.payoffDirectives ?? []).filter((d) => d?.fact?.trim());
    if (setup.length === 0 && reveal.length === 0 && payoff.length === 0) return '';
    const setupLines = setup.length
      ? `\nSetup / hint without confirming:\n${setup.map((d) => `- ${d.fact.trim()}`).join('\n')}`
      : '';
    const revealLines = reveal.length
      ? `\nReveal clearly on-page:\n${reveal.map((d) => `- ${d.fact.trim()}`).join('\n')}`
      : '';
    const payoffLines = payoff.length
      ? `\nPay off with changed behavior, access, relationship, route pressure, or question closure:\n${payoff.map((d) => `- ${d.fact.trim()}`).join('\n')}`
      : '';
    return (
      '\n### Information Movement On-Page (required)\n' +
      'This scene has authored information-ledger work. Keep it fiction-first: never mention information ledgers, flags, or phase labels. ' +
      'A setup touch may show a tell, misread, object, absence, or suspicious behavior without confirming the truth. ' +
      'A reveal must clearly disclose the fact in prose. A payoff must visibly change what characters can do, believe, choose, forgive, access, or fear.\n' +
      setupLines +
      revealLines +
      payoffLines
    );
  }

  /**
   * G10: when this scene's `sequenceIntent.objective` ENUMERATES concrete clues (e.g.
   * "collects four splinters — Ileana's tears, the photograph, the maiden name, Mika's
   * absence"), instruct the writer to dramatize EACH item on-page. Without this the writer
   * tends to show only the first and summarize the rest, so a later scene pays off a clue the
   * reader never saw (the canonical Bite Me ep3 "Splinters" miss). Uses the SAME parser as
   * ReferencedEventPresenceValidator (shared util), so the directive covers exactly what the
   * gate enforces. Returns '' when the objective is not an enumeration (prompt unchanged).
   */
  private buildEnumeratedObjectiveSection(input: SceneWriterInput): string {
    const objective = input.sceneBlueprint.sequenceIntent?.objective;
    const items = objective ? enumeratedItems(objective) : [];
    if (items.length === 0) return '';
    const lines = items.map((item) => `- ${item}`).join('\n');
    return (
      '\n### Promised Details (each MUST appear on-page)\n' +
      "This scene's objective enumerates concrete things the reader is promised to SEE. " +
      'Dramatize EACH one explicitly in the prose — a beat shows it, a character names or ' +
      'reacts to it — not merely the first with the rest implied. A later scene will reference ' +
      'these as if the reader witnessed them. Keep it fiction-first (no meta/objective talk).\n' +
      lines
    );
  }

  private scrubNextEpisodePressureForSceneWriter(input: SceneWriterInput): string {
    const pressure = input.cliffhangerPlan?.nextEpisodePressure;
    if (!pressure) return '';
    const isFinalScene = !input.nextSceneContext;
    return scrubNextEpisodePressureProperNouns(pressure, { isFinalScene }) || pressure;
  }

  private buildPrompt(input: SceneWriterInput): string {
    input = {
      ...input,
      sceneBlueprint: buildSceneConstructionPromptView(input.sceneBlueprint),
    };
    const npcDetails = input.npcs
      .filter(npc => input.sceneBlueprint.npcsPresent.includes(npc.id))
      .map(npc => `
- **${npc.name}** (${npc.id})
  - Pronouns: ${npc.pronouns}
  - Description: ${npc.description}${npc.physicalDescription ? `\n  - Physical Appearance (CANONICAL — use these exact details): ${npc.physicalDescription}` : ''}
  - Voice: ${npc.voiceNotes}
      ${npc.currentMood ? `- Current Mood: ${npc.currentMood}` : ''}${npc.isFirstOnPageAppearance ? `\n  - **FIRST APPEARANCE (CRITICAL)**: the reader has NEVER met ${npc.name}. Before they drive the action, INTRODUCE them on-page: show who they are and what the protagonist notices about them — through action and dialogue, not a bio dump. Do NOT write them as already-familiar, and NEVER invent an off-page prior meeting the reader did not see (no "the woman from the bookstore", "the man from the train" appositives unless that meeting happened in an earlier scene or is authored backstory). If they are a stranger, meet them as a stranger.` : ''}`)
      .join('\n');

    const presenceContracts = (input.sceneBlueprint.characterPresenceContracts ?? [])
      .map((contract) => contract.mode === 'anonymous_plant'
        ? `- ${contract.characterName}: ANONYMOUS PLANT. Stage distinctive first-contact visual or behavioral evidence. Do not use the roster name or first name: ${contract.forbiddenEvidence.join(', ')}.`
        : contract.mode === 'offscreen_reference'
          ? `- ${contract.characterName}: OFFSCREEN ONLY. Do not place this character in scene prose or cast metadata.`
          : `- ${contract.characterName}: NAMED INTRODUCTION. Name them naturally on-page and show how the protagonist learns who they are.`)
      .join('\n');
    const identitySchedule = (input.sceneBlueprint.identityScheduleContracts ?? [])
      .filter((contract) => contract.firstNamedEpisode > input.sceneBlueprint.episodeNumber)
      .map((contract) => `- ${contract.canonicalName}: canonical name forbidden until episode ${contract.firstNamedEpisode}; allowed aliases: ${contract.allowedAliases.join(', ') || 'visual description only'}`)
      .join('\n');

    const flagContext = input.relevantFlags
      ? input.relevantFlags.map(f => `- ${f.name}: ${f.description}`).join('\n')
      : 'None specified';
    const premiseContracts = (input.premiseContracts ?? [])
      .map((contract) => {
        const atoms = contract.evidenceAtoms?.map((atom) => `${atom.canonicalFact}: ${atom.acceptedPatterns.slice(0, 6).join(', ')}`).join(' | ');
        return `- ${contract.fieldName}: ${contract.sourceText} (concrete evidence: ${atoms || contract.evidencePatterns.join(', ')})${contract.blocking ? ' [required]' : ''}`;
      })
      .join('\n');

    const sourceContextStr = buildSourceMaterialFidelitySection(input.sourceAnalysis);

    const structuralContext = buildStructuralContextSection({
      anchors: input.seasonAnchors,
      storyCircle: input.seasonStoryCircle,
      episodeStoryCircleRole: input.episodeStoryCircleRole,
      episodeCircle: input.episodeCircle,
    });

    return `
Write the scene content for the following scene blueprint:

${sourceContextStr}
${structuralContext}
## Story Context
- **Title**: ${input.storyContext.title}
- **Genre**: ${input.storyContext.genre}
- **Tone**: ${input.storyContext.tone}
- **World**: ${input.storyContext.worldContext}
${input.storyContext.userPrompt ? `- **User Instructions/Prompt**: ${input.storyContext.userPrompt}\n` : ''}${input.memoryContext ? `\n## Pipeline Memory (Insights from Prior Generations)\n${input.memoryContext}\n` : ''}${input.establishedCanon ? `\n## ${input.establishedCanon}\n(Treat the above as fixed truth — your prose must not contradict it.)\n` : ''}
${presenceContracts ? `\n### Canonical Character Presence Contracts\nThese are immutable generator contracts for this scene. They control whether a character is named, planted anonymously, or kept offscreen. Never change the policy to satisfy prose convenience.\n${presenceContracts}\n` : ''}
${identitySchedule ? `\n### Canonical Identity Schedule\nDo not reveal any canonical name before its scheduled episode. The protagonist may observe the person, use an allowed codename, or describe them visually, but must not disclose the forbidden identity through prose, dialogue, metadata, or recap.\n${identitySchedule}\n` : ''}
${premiseContracts ? `\n### Canonical Premise Contracts\nThese authored premise facts must become concrete reader-facing evidence in this scene. Use behavior, dialogue, a specific object, or a consequence; do not mention contracts or paste planning text. For every contract marked [required], include at least two distinctive evidence phrases naturally in the reader-facing prose, prefer the listed phrases over vague implication, and verify each required contract before returning.\n${premiseContracts}\n` : ''}
> Continuity (#26C): only name characters, factions, and props already established in this
> story. Do not invent a named character or object the reader hasn't met; reference the
> existing cast/world instead.
${(input.notYetIntroducedNames?.length ?? 0) > 0 ? `> NOT YET INTRODUCED (do NOT name these characters in this scene — the reader has not met
> them and they are not in this scene's cast; a casual mention would read as "who is this?"):
> ${input.notYetIntroducedNames!.join(', ')}.
` : ''}
## Scene Blueprint
- **Scene ID**: ${input.sceneBlueprint.id}
- **Name**: ${input.sceneBlueprint.name}
- **Description**: ${input.sceneBlueprint.description}
- **Location**: ${input.sceneBlueprint.location}
${input.sceneBlueprint.timeOfDay ? `- **Time of day**: ${input.sceneBlueprint.timeOfDay}` : ''}
${input.sceneTimeline?.timeJumpFromPrevious ? `- **Gap since previous scene**: ${input.sceneTimeline.timeJumpFromPrevious}` : ''}
- **Mood**: ${input.sceneBlueprint.mood}
- **Purpose**: ${input.sceneBlueprint.purpose}
- **Narrative Function**: ${this.stripAgentFacingPressureParagraphs(input.sceneBlueprint.narrativeFunction, input.sceneBlueprint.description || input.sceneBlueprint.name)}
${input.sceneBlueprint.themePressure ? `- **Theme Pressure**: ${input.sceneBlueprint.themePressure}` : ''}

### Scene Craft Targets
- Define 1-4 sceneTakeaways in the output: what the player learns, feels, or understands.
- Every scene must have a purpose in emotional, action, or character-related content that advances the story; descriptions, action, dialogue, visual metadata, choices, and final beat should reinforce that purpose.
- If themePressure is supplied, express it through action, cost, choice, subtext, relationship pressure, information, or identity movement. Never have dialogue state the theme question directly.
- Scene takeaways are load-bearing: they name what the player learns, feels, or understands about story, character, relationship, theme, information, or player-state pressure.
- If this scene begins after a time/place shift, include transitionIn with a short natural phrase.
- The scene keyMoment should be the beat where sceneTakeaways become felt, proven, revealed, or changed.
- keyMoments should name the emotional or narrative payoff, not just a location or mood.
- moodProgression should show the scene's tension or emotional movement from start to finish.
- Use selective sensory detail to establish place, mood, danger, intimacy, texture, or consequence.
- Respect active source style, genre, tone, user instructions, and style guide.
- Use precise, concrete language; avoid ornate prose and generic description.
- Make description carry pressure, movement, mood, threat, desire, or consequence.
- Keep dialogue spare, natural, character-specific, pressure-aware, and subtextual.
- Prefer subtext over explanation: characters may argue values, conceal motives, dodge, confess, threaten, or plead, but should rarely summarize exactly what the scene means.
- Cut into the scene near the active pressure and leave on the punch: once the turn, decision, consequence, or handoff lands, do not keep explaining it.
- Vary sentence rhythm with emotional intensity while respecting mobile beat caps.
- Reveal inner life through action, speech, silence, bodily response, facial expression, object handling, proximity, risk, and choice behavior.
- Build toward the scene keyMoment and end with resolution plus forward pressure.
- Avoid repeated plot events, dialogue, scene shapes, and descriptive phrasing unless intentional callback/payoff.
- Maintain consistent tone unless the scene event intentionally turns the tone.
- Scene beats should build toward the scene keyMoment. Intensity does not need to rise mechanically every beat, but tension, gravitas, danger, intimacy, consequence, or dramatic clarity should accumulate across the scene.
- Build a stakes ladder across the beats: each beat should raise risk, reveal cost, narrow options, shift leverage, or deepen consequence until the dominant/peak beat carries the maximum stakes. Rest beats can raise dread, clarity, regret, tenderness, or emotional cost instead of volume.
- Use rest beats only when they create contrast, aftermath, dread, tenderness, or sharper payoff.
- The final beat of each scene should land a pointed resolution or consequence, then create forward pressure into the next beat, choice, scene, encounter, or episode.
- Forward pressure may be a cliffhanger, reveal, unresolved cost, emotional rupture, new danger, changed relationship, choice consequence, or handoff.
- For non-finale episode endings, heighten next-episode pressure. For finale/resolution endings, resolve the central conflict and show aftermath.
- Never write a static meeting where characters only discuss information. Give dialogue scenes fitting physical activity, spatial pressure, object handling, preparation, travel, hiding, training, repair, cooking, cleaning, fighting, searching, ritual, medical care, escape, or another action appropriate to the circumstances.
- When characters are in jeopardy or believe they are in jeopardy, dialogue should become more pointed, urgent, interrupted, selective, or stripped down.
- Do not directly describe characters' thoughts and feelings. Externalize inner life through brief dialogue, muttered one-line self-speech, silence, interruption, bodily action, object handling, hesitation, distance or closeness, facial expression, choice behavior, callback objects, or what the character does next.
- If a moment carries deep emotional weight, memory, regret, longing, fear, or reminiscence, express it through action or brief understated dialogue. Use less explanation, not more.
- Keep dialogue spare, quick, and to the point unless the source style, genre, ritual, confession, comedy, or climax truly calls for longer speech.
- When physical action matters, include specific bodily movement: concrete movement, posture, proximity, hand placement, footwork, balance, collision, recoil, grip, breath, facial expression, or object interaction.
- Each non-rest beat should show a concrete shift in action, intent, leverage, mood, relationship dynamic, tactical position, information, or consequence.
- If the blueprint leaves small connective gaps, fill them naturally with local detail: transition, concrete action, emotional pressure, physical business, clue, consequence, or relationship texture.
- Do not contradict season anchors, source-material fidelity, established character state, player choices, flags, callbacks, or encounter setup context.
- Give the scene a storyboardable sequenceIntent: objective, visible activity, obstacle, startState, turningPoint, endState, visualThread, optional mechanicThread. Treat it as required for new output but backward-compatible for old content.
- Each non-establishing beat should include sequenceIntent with a beatRole so the storyboard can see setup -> pressure -> escalation -> turn -> consequence/handoff.
- Each non-establishing beat should include a coveragePlan so the storyboard can see shot scale, angle, staging, visible/offscreen cast, relationship blocking, and continuity. Avoid vague "dialogue coverage"; make the shot prove what changed.
- Vivid means vivid story intent, not ornate prose or generic cinematic styling. For player-facing prose, use concrete, concise action and dialogue that makes the story turn legible.
- For visual metadata and image-facing fields, provide specific story intent, visible action, relationship dynamics, required details, and subtext cues. Do not add art-direction language that fights the active ArtStyleProfile, negative prompt, provider settings, or style-bible anchors.
- Visual metadata should describe what must be understood, not impose a conflicting style. Avoid generic style words like cinematic, hyperreal, vivid colors, dramatic lighting, painterly, anime, flat, gritty, glossy, symmetrical, or high contrast unless they come from the active style contract.
- Every non-rest, non-establishing beat should answer: "What visibly changed by the end?"
- Prefer turns over topics: not "they discuss the charm," but "the charm changes hands and Mrs. Constantinou loses the ability to dismiss what she saw."
- Turn domains to use in prose, dramaticIntent, and existing mechanics hooks: ${FICTION_FIRST_TURN_DOMAINS.join(', ')}.
- When a turn is mechanically relevant, use existing fields only: onShow, textVariants, callbackHookId, plantsThreadId, paysOffThreadId, plotPointType, dramaticIntent, or choice/encounter setup that will carry the residue.
- If this scene includes fighting, weapons, pursuit, survival danger, or major physical action, make the danger concrete and serious: specific strikes, maneuvers, evasions, blocks, grapples, throws, falls, impacts, wounds, damage, destructive effects, loud forceful consequences, surprising tactical choices, environmental use, facial expressions, and bodily reactions.
- Do not let fights become abstract summaries. Show through action how the winning side succeeds and what the losing side physically loses, suffers, or fails to protect.
- In action scenes, the hero or allies should be wounded, damaged, depleted, exposed, or narrowly escape a specific harm.
- Every meaningful conflict should damage someone or something: physical injury, emotional hurt, social humiliation, relational rupture, resource loss, reputation damage, information exposure, identity pressure, moral compromise, lost leverage, increased danger, or narrowing options.
- Preserve rests where they serve contrast, aftermath, dread, tenderness, or sharper payoff; do not force constant combat or argument.
- Keep this scene spatially honest: it has one primary dramatic location. You may point toward a later major named location as a handoff, but do not stage arrival, access, introductions, encounters, clues, choices, or relationship turns there inside this scene.
- If the scene moves from one major named location to another, end on the handoff before meaningful action begins in the next place. The next location needs its own scene.

### Genre-Aware Jeopardy
${buildGenreAwareJeopardyGuidance(input.storyContext.genre)}

### Expert Design Template
- **Dramatic Question**: ${input.sceneBlueprint.dramaticQuestion}
- **Want vs Need**: ${input.sceneBlueprint.wantVsNeed}
- **Conflict Engine**: ${input.sceneBlueprint.conflictEngine}
- **Sequence Intent**: ${this.formatSequenceIntent(input.sceneBlueprint.sequenceIntent)}
${buildSceneConstructionProfileSection(input.sceneBlueprint)}
${buildSceneEventOwnershipPromptSection(input.sceneBlueprint)}
${input.sceneBlueprint.behavioralIntents?.length ? `
### Behavioral Intent (binding, non-owning)
These authored intents support the assigned central event; they are not separate scenes or event IDs. Concretize each through a visible actor, target, mechanism, response, and changed state. Never paste the intent label into prose.
${input.sceneBlueprint.behavioralIntents.map((intent) => intent.kind === 'behavioral_intent'
    ? `- ${intent.intentKind}: ${intent.intentText}; required slots: ${intent.requiredSlots.join(', ')}`
    : `- ${intent.kind}: ${'factText' in intent ? intent.factText : 'contextText' in intent ? intent.contextText : intent.eventText}`).join('\n')}
` : ''}
${input.sceneBlueprint.canonicalEvidenceRequirements?.length ? `
### Canonical Reader-Facing Evidence (binding)
These requirements belong to this scene's assigned event contracts. Realize them in the stated surface; evidence in another scene, metadata, or a sibling encounter route does not count. Keep the wording natural and fiction-first.
${input.sceneBlueprint.canonicalEvidenceRequirements.map((requirement) => `- ${requirement.eventId} / ${requirement.kind}: use one of [${requirement.acceptedPatterns.join(', ')}] on ${requirement.requiredSurface || 'the owner scene'}.`).join('\n')}
` : ''}
${input.sceneBlueprint.realizationTasks?.some((task) => task.ownerStage === 'scene_writer') ? `
### Immutable Realization Tasks (owner-stage contract)
These task IDs are assigned to this scene by the canonical narrative graph. Show the required evidence on the required surface; do not satisfy a task through synopsis, metadata, recap, or another scene. Return the IDs as diagnostics only after the prose actually realizes them.
Canonical event IDs allowed in claimedEventIds/eventEvidence: ${(input.sceneBlueprint.assignedEventIds ?? input.sceneBlueprint.narrativeEventIds ?? []).join(', ') || 'none'}.
Task IDs and planning labels are never event IDs and must not appear in claimedEventIds/eventEvidence.eventId.
Only use the exact task and atom IDs listed below in eventEvidence. Omit taskId or atomId when uncertain; never substitute a treatment atom, required-beat ID, or planning-contract ID.
${input.sceneBlueprint.realizationTasks.filter((task) => task.ownerStage === 'scene_writer').map((task) => `- task=${task.id}: ${describeNarrativeEvidenceTarget(task.target)}; atoms=${JSON.stringify(task.evidenceAtoms.map(compactPatchAtom))}`).join('\n')}
` : ''}
${input.sceneBlueprint.realizationTasks?.some((task) => task.ownerStage === 'choice_author') ? `
### Downstream Choice-Resolution Boundary
The canonical payoff requirements below belong to ChoiceAuthor after the player acts. Build the pressure and decision that make them possible, then stop before resolving them in scene beats. Do not pre-empt or duplicate their payoff.
${input.sceneBlueprint.realizationTasks.filter((task) => task.ownerStage === 'choice_author').flatMap((task) => task.evidenceAtoms.map((atom) => `- ${atom.description}`)).join('\n')}
` : ''}
${input.sceneBlueprint.turnContract ? `
### Scene Turn Contract
- **Central turn**: ${input.sceneBlueprint.turnContract.centralTurn}
- **Before state**: ${input.sceneBlueprint.turnContract.beforeState}
- **Turn event**: ${input.sceneBlueprint.turnContract.turnEvent}
- **After state**: ${input.sceneBlueprint.turnContract.afterState}
- **Handoff**: ${input.sceneBlueprint.turnContract.handoff}

This is the dramatic center of the scene. The prose must make the before-state readable, dramatize the turn event on-page, and show the after-state or handoff before the scene routes onward.
` : ''}
${(input.sceneBlueprint.relationshipPacing?.length || input.sceneBlueprint.mechanicPressure?.length || input.sceneBlueprint.authoredTreatmentFields?.length || input.sceneBlueprint.seasonPromiseContracts?.length || input.sceneBlueprint.stakesArchitectureContracts?.length || input.sceneBlueprint.storyCircleBeatContracts?.length || input.sceneBlueprint.arcPressureContracts?.length || input.sceneBlueprint.worldTreatmentContracts?.length || input.sceneBlueprint.characterTreatmentContracts?.length || input.sceneBlueprint.failureModeAuditContracts?.length) ? `
### Planning-Contract Realization (binding)
Every contract in the subsections below is binding for this scene. Never paste contract text, labels, or planning notes into prose, and do not state flags, scores, thresholds, or contract labels — no structural/QA language of any kind. Stage each contract as reader-facing action, behavior, choice pressure, information movement, cost, altered access, or visible residue.
` : ''}${input.sceneBlueprint.relationshipPacing?.length ? `
#### Relationship Pacing
Write the relationship at the earned stage, not the future desired stage. Instant chemistry is allowed; instant friendship, trust, intimacy, or settled group membership is not.
${input.sceneBlueprint.relationshipPacing.map((c) => `- ${c.npcId ? `NPC ${c.npcId}` : `Group ${c.groupId}`}: ${c.startStage} -> ${c.targetStage}; allowed labels: ${joinPromptList(c.allowedLabels, ', ', 'earned current-stage labels only')}; blocked labels: ${joinPromptList(c.blockedLabels, ', ', 'unearned future-stage labels')}; evidence required: ${joinPromptList(c.requiredEvidence, '; ', 'show the on-page behavior that earns any movement')}${c.startStage === 'unmet' && c.npcId ? ` — FIRST APPEARANCE: ${c.npcId} has never been on-page. If this scene includes them, stage the actual first meeting (how they enter, how the protagonist learns who they are) before they speak or act as known company.` : c.startStage === 'spark' && c.npcId ? ` — BARELY MET: ${c.npcId} was met at most one scene ago. When they first act here, ground who they are in a phrase (name + how the protagonist knows them); never write them as long-standing company.` : ''}`).join('\n')}
- Show relationship movement through behavior: proximity, eye contact, teasing, withholding, invitation, remembered detail, vulnerability, challenge, refusal, protection, or changed access.
- If an NPC is at unmet or first-meeting stage, do not let the protagonist text, call, DM, receive private replies from, or already have that NPC's number until the scene shows the introduction and how contact access is exchanged.
- If a group name appears early, make it a dare, joke, invitation, or fragile beginning unless prior scenes have earned settled membership.
- Never write "make it official", "we are the X Club", "official first meeting", or settled membership language for a new group at spark — name it as a toast, dare, joke, or provisional circle instead.
- A first introduction can turn unmet into spark, but it cannot also conduct the later friendship/trust/intimacy proof. Keep first-meeting prose curious, wary, provisional, or testing unless the ledger contract explicitly permits more.
- Treat McKee-square movement as behavior, not labels: care with agency, withheld care, active hostility, or control/coercion disguised as care. A scene that claims relationship movement must show the value turn on-page; a quiet setup scene must not imply that the relationship already moved.
- Do not use blocked labels in narration, scene takeaways, visual metadata, relationshipDynamic, or transition/bridge prose.
` : ''}
${input.sceneBlueprint.mechanicPressure?.length ? `
#### Narrative Mechanic Pressure
Mechanics are hidden story-dynamics accounting: dramatize what each means in the fiction — access, leverage, memory, suspicion, vulnerability, debt, identity pressure, learned pattern, changed permission, or narrowed options.
${input.sceneBlueprint.mechanicPressure.map((c) => `- ${c.id}: ${c.domain}/${c.function} — ${authorFacingMechanicPressureText(c)}; evidence: ${joinPromptList(c.evidenceRequired, '; ', 'show the on-page event that earns it')}; visible residue: ${joinPromptList(c.visibleResidue, '; ', 'show changed behavior, access, cost, clue, posture, or aftermath')}; allowed payoffs: ${joinPromptList(c.allowedPayoffs, '; ', 'small believable future permission')}; blocked payoffs: ${joinPromptList(c.blockedPayoffs, '; ', 'payoffs not yet earned')}`).join('\n')}
- If this scene creates pressure, show the event that earns it and the immediate residue before routing onward.
- If this scene spends prior pressure, make the payoff visible on-page as behavior, access, a clue, cost, altered tone, route permission, or changed NPC posture.
- A bridge/payoff beat may carry mechanics only if it also contains aftermath/residue and grounded movement or elapsed-time language when it routes to a new scene.
` : ''}
${input.sceneBlueprint.authoredTreatmentFields?.length ? `
#### Authored Treatment Fields
${input.sceneBlueprint.authoredTreatmentFields.map((c) => `- ${c.fieldName}: ${authorFacingTreatmentFieldText(c)}; must realize through ${joinPromptList(c.requiredRealization, ', ', 'final prose')}`).join('\n')}
- Pressure lanes must become visible pressure, not abstract summary.
- Encounter fields must show up inside setup, phase action, choices, or outcome prose.
- Ending/cliffhanger fields must land as a changed state plus forward question or pressure, not vague mood.
` : ''}
${input.sceneBlueprint.seasonPromiseContracts?.length ? `
#### Season Promises
${input.sceneBlueprint.seasonPromiseContracts.map((c) => `- ${c.contractKind}: ${c.sourceText}; realize through ${joinPromptList(c.requiredRealization, ', ', 'final prose')}`).join('\n')}
- Genre/tone promises should read through scene texture, stakes, behavior, and pressure, not through comparison-title name-drops.
- Theme and inaction promises must be tested by action, cost, choice, encounter pressure, narrowing options, loss, or altered permission.
- Premise/core-fantasy promises should become playable affordances, relationship/identity pressure, setting texture, or an engine the player can feel.
` : ''}
${input.sceneBlueprint.stakesArchitectureContracts?.length ? `
#### Stakes Architecture
Make each stake visible as something the protagonist can lose, protect, betray, claim, spend, or transform.
${input.sceneBlueprint.stakesArchitectureContracts.map((c) => `- ${c.fieldName} (${c.contractKind}${c.stakeLayer ? ` / ${c.stakeLayer}` : ''}): ${c.sourceText}; realize through ${joinPromptList(c.requiredRealization, ', ', 'final prose')}${c.prerequisiteContractIds?.length ? `; prerequisites: ${joinPromptList(c.prerequisiteContractIds)}` : ''}`).join('\n')}
- Material stakes should become resource, access, object, reputation, information, safety, or opportunity pressure.
- Relational stakes should become behavior: distance, loyalty, withholding, betrayal, repair, trust, alliance, route pressure, or changed posture.
- Identity stakes should become agency, self-concept, refusal, transformation, named inheritance, voice, or visible choice cost.
- Existential stakes must be grounded by personal/relational/identity stakes before they pay off. Foreshadow early danger if needed, but do not jump straight to abstract life-or-death scale.
- Emotional anchors should be planted or used as concrete objects, places, promises, rituals, names, visual motifs, or relationship tells that carry future pressure.
` : ''}
${input.sceneBlueprint.storyCircleBeatContracts?.length ? `
#### Legacy-Structure Beats (Hook / Plot Turn / Pinch / Midpoint / Climax / Resolution)
Stage the actual beat event and the state change it creates.
${input.sceneBlueprint.storyCircleBeatContracts.map((c) => `- ${c.beat}: ${c.sourceText}; event atoms: ${joinPromptList(c.eventAtoms, ' | ', c.sourceText)}${c.stateChange ? `; visible state change: ${c.stateChange}` : ''}`).join('\n')}
- Give the beat a local before -> event -> after/handoff shape.
- If this is a midpoint, pinch, climax, or resolution, make the recontextualization, cost, decisive choice, route consequence, or changed end state visible on-page.
- Do not satisfy this with summary narration. Use action, reveal, choice pressure, altered access, information movement, relationship posture, or ending state.
` : ''}
${input.sceneBlueprint.arcPressureContracts?.length ? `
#### Arc Pressure
${input.sceneBlueprint.arcPressureContracts.map((c) => `- ${c.arcTitle} / ${c.fieldName} (${c.contractKind}): ${c.sourceText}; event atoms: ${joinPromptList(c.eventAtoms, ' | ', c.sourceText)}; realize through ${joinPromptList(c.requiredRealization, ', ', 'final prose')}`).join('\n')}
- Arc questions must be tested, not answered in narration.
- Midpoint/recontextualization contracts must change what the player understands.
- Late-crisis contracts must show cost, narrowing options, damaged footing, or failed strategy.
- Finale/turnout/handoff contracts must leave visible residue in the scene's after-state.
` : ''}
${input.sceneBlueprint.worldTreatmentContracts?.length ? `
#### World / Location
Dramatize what each rule or place lets characters do, prevents, costs, hides, or tempts — never lore as exposition.
${input.sceneBlueprint.worldTreatmentContracts.map((c) => `- ${c.fieldName} (${c.contractKind}${c.locationName ? ` @ ${c.locationName}` : ''}): ${c.sourceText}; realize through ${joinPromptList(c.requiredRealization, ', ', 'final prose')}`).join('\n')}
- Major locations must not read as interchangeable backdrops. Let purpose, danger, sanctuary, faction ownership, sacred/costly objects, or choice pressure shape the visible action.
- Supernatural/world rules should appear as planted evidence, withheld information, behavior under constraint, altered access, or consequence pressure. Do not reveal future rules early unless this scene is the planned reveal/spend.
- Mood is guidance for texture; purpose, history, dramatic rules, and choice pressure should change what happens.
` : ''}
${input.sceneBlueprint.characterTreatmentContracts?.length ? `
#### Protagonist
Dramatize as behavior, subtext, vulnerability, memory, appetite, refusal, visible baseline, changed posture, or route/ending pressure — never Lie/Need labels, route math, or ending mechanics.
${input.sceneBlueprint.characterTreatmentContracts.map((c) => `- ${c.fieldName} (${c.contractKind}): ${c.sourceText}; realize through ${joinPromptList(c.requiredRealization, ', ', 'final prose')}`).join('\n')}
- Starting identity and role facts should appear as lived baseline, not biography dump.
- Want/Need/Lie/Wound/Truth pressure must change the scene's behavior, choice stakes, aftermath, or handoff.
- Climax/end-state pressure must feel earned by action and cost; do not summarize transformation without staging it.
- Visual identity should inform concrete attire/props when natural, but do not force every wardrobe detail into prose.
` : ''}
${input.sceneBlueprint.failureModeAuditContracts?.length ? `
#### Failure-Mode Mitigations
Stage each protection fiction-first as agency, causal setup, fair-play clue, irreversible residue, personal-before-existential grounding, thematic rhyme, or in-world mitigation.
${input.sceneBlueprint.failureModeAuditContracts.map((c) => `- ${c.label} (${c.status} / ${c.contractKind}): ${c.sourceText}; realize through ${joinPromptList(c.requiredRealization, ', ', 'final prose')}`).join('\n')}
- If this is a watch item, show the mitigation before or during the risky event, not after as explanation.
- If this is agency, the protagonist/player must cause the decisive turn through choice, preparation, sacrifice, leverage, or earned information.
- If this is setup/payoff or twist fairness, plant or cash out concrete evidence on-page with an alternate innocent read when appropriate.
- If this is reset/snowglobe prevention, leave visible state residue in behavior, access, relationship posture, information, route pressure, or aftermath.
` : ''}
${buildColdOpenProfileSection(input.sceneBlueprint)}

### Key Beats to Hit
${input.sceneBlueprint.keyBeats
  .filter((beat) => !isAgentFacingPressureNote(beat))
  .map((beat) => `- ${stripAgentFacingPressureLabel(beat)}`)
  .join('\n')}
${buildTreatmentEventPromptSections(input.sceneBlueprint)}
${buildRequiredBeatsSection(input.sceneBlueprint)}${input.sceneBlueprint.invariants?.length ? `### HOLD THESE LINES — treatment invariants (do NOT depict the negated event)
The treatment is emphatic that these do NOT happen this episode. Do not write prose
(or imply, in aftermath or a character's memory) that the negated event occurred:
${input.sceneBlueprint.invariants.map((inv) => `- The protagonist ${inv}.`).join('\n')}
` : ''}
${this.buildRevealDirectivesSection(input)}${formatForbiddenRevealsSection(input.forbiddenReveals ?? [])}
${this.buildEnumeratedObjectiveSection(input)}

${input.sceneBlueprint.choicePoint ? `
### Choice Point
- **Type**: ${input.sceneBlueprint.choicePoint.type}
- **Description**: ${input.sceneBlueprint.choicePoint.description}
- **Stakes**:
  - Want: ${input.sceneBlueprint.choicePoint.stakes.want}
  - Cost: ${input.sceneBlueprint.choicePoint.stakes.cost}
  - Identity: ${input.sceneBlueprint.choicePoint.stakes.identity}
${input.sceneBlueprint.choicePoint.stakesLayers ? `- **Stakes Layers**:
  - Material: ${input.sceneBlueprint.choicePoint.stakesLayers.material || 'None'}
  - Relational: ${input.sceneBlueprint.choicePoint.stakesLayers.relational || 'None'}
  - Identity: ${input.sceneBlueprint.choicePoint.stakesLayers.identity || 'None'}
  - Existential: ${input.sceneBlueprint.choicePoint.stakesLayers.existential || 'None'}` : ''}
` : ''}

## Characters

### Protagonist
- Name: ${input.protagonistInfo.name}
- Pronouns: ${input.protagonistInfo.pronouns}
- Description: ${input.protagonistInfo.description}${input.protagonistInfo.physicalDescription ? `\n- Physical Appearance (CANONICAL — use these exact details): ${input.protagonistInfo.physicalDescription}` : ''}

### NPCs in Scene
${npcDetails || 'No NPCs in this scene'}

## Relevant State Context
${flagContext}

${input.episodeEncounterContext ? `
## ENCOUNTER BUILDUP (CRITICAL — This scene is building toward the episode's climax)

This episode's climactic moment is a **${input.episodeEncounterContext.encounterType}** encounter (${input.episodeEncounterContext.encounterDifficulty}):
> "${input.episodeEncounterContext.encounterDescription}"

**What this scene must establish:**
> "${input.episodeEncounterContext.encounterBuildup}"

Write this scene with the encounter in mind. Every beat should move players emotionally and informationally toward that encounter:
- Plant the seeds of conflict that will explode in the encounter
- Establish or deepen the relationships that will be tested
- Surface the information, stakes, or personal history that makes the encounter's choices feel loaded
- Do NOT depict the encounter's defining event yet. If the encounter description names an attack, rescue, confrontation, chase, bargain, revelation, kiss, or escape, this scene may foreshadow or set it up but must leave the event itself for the encounter scene.
- DO NOT resolve the tension — build it, complicate it, and leave it unresolved for the encounter to detonate

The player should finish this scene feeling that something significant is coming. The encounter should feel INEVITABLE by the time they reach it.
` : ''}
${input.branchContext ? `
## Branch Topology Context
- **Scene role**: ${input.branchContext.role}
${input.branchContext.role === 'bottleneck' ? '- This scene is a **bottleneck**: every player path converges here. Acknowledge different prior paths when possible via textVariants.' : ''}
${input.branchContext.role === 'branch' ? '- This scene is **branch-only**: not every player reaches it. Earn its distinct tone and avoid redundant setup.' : ''}
${input.branchContext.role === 'reconvergence' ? `- This scene is a **reconvergence point**. Incoming branches: ${(input.branchContext.incomingBranchIds || []).join(', ') || 'multiple'}. Acknowledge different paths via conditional textVariants.` : ''}
${input.branchContext.stateReconciliationNotes && input.branchContext.stateReconciliationNotes.length > 0 ? `- State reconciliation notes:\n${input.branchContext.stateReconciliationNotes.map(n => `  - ${n}`).join('\n')}` : ''}
${input.branchContext.reconvergenceNarrativeAcknowledgment ? `- Suggested acknowledgment: "${input.branchContext.reconvergenceNarrativeAcknowledgment}"` : ''}
` : ''}
${buildResidueRequirementPromptSection(input.sceneBlueprint.residueRequirement)}
${input.activeThreads && input.activeThreads.length > 0 ? `
## Active Narrative Threads (setup/payoff)
You MUST plant or pay off the following threads in this scene. Set \`plantsThreadId\` or \`paysOffThreadId\` on the beat where each action happens.
${input.activeThreads.map(t => `- [${t.action.toUpperCase()}] thread \`${t.id}\` (${t.kind}): ${t.label}${t.hint ? ` — hint: ${t.hint}` : ''}`).join('\n')}
- Payoff must feel surprising-but-inevitable — the plant should read as incidental on first encounter.
- If planting, be subtle: a sensory detail, an off-hand remark, a named object. Never lampshade.
` : ''}
${input.twistDirectives && input.twistDirectives.length > 0 ? `
## Twist / Revelation Directives
This scene participates in an episode-level twist. Honor the role for each beat and set \`plotPointType\` accordingly.
${input.twistDirectives.map(d => `- Beat role: **${d.beatRole}** for a \`${d.twistKind}\` — ${d.hint}`).join('\n')}
- Twist beats MUST be preceded by at least one earlier setup beat in this or an earlier scene.
` : ''}
${input.arcTargets && (input.arcTargets.identityDeltaHints?.length || input.arcTargets.relationshipTrajectory?.length) ? `
## Character Arc Milestone Targets
Frame beats so the player's available choices can nudge the protagonist toward these milestones.
${(input.arcTargets.identityDeltaHints || []).map(h => `- Identity dimension \`${h.dimension}\`: target ${h.direction} (${h.magnitude})`).join('\n')}
${(input.arcTargets.relationshipTrajectory || []).map(r => `- Relationship with ${r.npcId} (${r.dimension}): ${r.direction} — ${r.hint}`).join('\n')}
` : ''}${buildSceneWriterCallbackSection((input.unresolvedCallbacks || []).map(h => ({
  id: h.id,
  sourceEpisode: h.sourceEpisode,
  sourceSceneId: '',
  sourceChoiceId: '',
  flags: h.flags,
  conditionKeys: h.conditionKeys,
  impactFactors: h.impactFactors,
  consequenceTier: h.consequenceTier,
  summary: h.summary,
  payoffWindow: { minEpisode: 0, maxEpisode: 0 },
  payoffCount: 0,
  resolved: false,
  createdAt: '',
})))}
${input.cliffhangerPlan ? `
## Story Circle Cliffhanger Plan (CRITICAL if this is the episode's final scene)
- Style: ${input.cliffhangerPlan.style}
- Next loop launch beat: ${input.cliffhangerPlan.storyCircleLaunchBeat || 'go'}
- Type: ${input.cliffhangerPlan.type}
- Intensity: ${input.cliffhangerPlan.intensity}
- Hook to deliver: ${input.cliffhangerPlan.hook}
- Setup that earns it: ${input.cliffhangerPlan.setup}
- Immediate episode tension to acknowledge/resolve: ${input.cliffhangerPlan.resolvedEpisodeTension}
- New open question: ${input.cliffhangerPlan.newOpenQuestion}
- Emotional charge: ${input.cliffhangerPlan.emotionalCharge}
- Next-episode pressure: ${this.scrubNextEpisodePressureForSceneWriter(input)}${input.revealProhibitions?.length ? `\n- DO NOT STATE OR CONFIRM (season secrets scheduled for later episodes — escalate mystery around them without confirming): ${input.revealProhibitions.map((meaning) => `"${meaning}"`).join('; ')}` : ''}

If this scene has no outgoing scene, write the last beat as serialized-TV craft:
1. Acknowledge the episode's immediate conflict or consequence.
2. Land the planned shock/emotional/reveal/danger/legacy hook as a concrete event or realization.
3. End with forward pressure, but do not rely on ellipses or a generic question as the whole hook.
4. Make the visual contract show the hook: the object, face, gesture, arrival, absence, or rupture the reader should remember.
5. The planned hook IS the episode's single closing image. Do NOT invent a SECOND, competing terminal object or delivery (a different gift, parcel, package, letter, or item arriving on the same doorstep/counter/threshold) — that contradicts the planned hook. If the hook is an object that arrives, that object is the only one; the final choice, if any, operates on the planned hook itself, not a substitute.
` : ''}
## Requirements
- Write up to ${input.targetBeatCount} beats for this scene (cap—use fewer if the scene doesn't need more)
- HARD OUTPUT BUDGET: the complete JSON response must stay under ${SCENE_WRITER_MAX_RAW_RESPONSE_CHARS} characters. Prefer 6-8 concise beats, compact visual contract strings, and no optional boilerplate. Use textVariants only when a real condition changes player-facing prose.
${input.targetBeatCount >= 6 ? '- If this is a scene-length episode, write at least 6 beats and keep the final beat as the visible choice point. Do not compress the episode into only setup to crisis to choice.\n' : ''}
- ${input.dialogueHeavy ? 'This is dialogue-heavy - focus on conversation' : 'Balance description with any dialogue'}
- The first non-empty player-facing beat MUST anchor POV to the player character with "you", "your", the protagonist's actual name, or a concrete pronoun before focusing on NPCs or setting.
- Add optional skillInsights on beats where hidden capability should change what the character notices.
- skillInsights are passive fiction-first prose, never labels. They reveal danger, opportunity, emotional subtext, contradictions, environmental tools, social leverage, or hidden costs.
- skillInsights shape: { "id": "slug", "skillWeights": { "perception": 0.6, "investigation": 0.4 }, "threshold": 55, "text": "Plain prose only.", "priority": 1 }
- Insight thresholds: 45 easy reveal, 55 meaningful reveal, 65 strong build reveal, 75 rare expert reveal.
- Never write "skill check", "threshold", "bonus", "modifier", "success chance", percentages, or raw skill/stat names as player-facing labels.
${input.previousSceneSummary ? `- Previous scene context: ${input.previousSceneSummary}` : ''}
${input.nextSceneContext ? `- Next scene context: ${input.nextSceneContext.name} (${input.nextSceneContext.location}) — ${input.nextSceneContext.encounterDescription || input.nextSceneContext.description}` : ''}
${input.continueInLocation ? `- CONTINUITY: the previous scene already took place in ${input.continueInLocation}. The protagonist is ALREADY here — open mid-presence (continue the visit), do NOT re-stage a first arrival, threshold-crossing, or "the smell hits you as you enter". Re-entering a location you never left reads as a continuity error.` : ''}
${input.sceneTimeline && (input.sceneTimeline.locationChanged || input.sceneTimeline.timeChanged) ? `
## SCENE TRANSITION HANDOFF (CRITICAL — time/place moved since the previous scene)
The previous scene ("${input.sceneTimeline.previous?.sceneName ?? 'previous scene'}") took place at ${input.sceneTimeline.previous?.location ?? 'its location'}${input.sceneTimeline.previous?.timeOfDay ? ` (${input.sceneTimeline.previous.timeOfDay})` : ''}. THIS scene is at ${input.sceneBlueprint.location}${input.sceneBlueprint.timeOfDay ? ` (${input.sceneBlueprint.timeOfDay})` : ''}${input.sceneTimeline.timeJumpFromPrevious ? ` — planned gap: ${input.sceneTimeline.timeJumpFromPrevious}` : ''}.
- \`transitionIn\` is REQUIRED for this scene: a short natural phrase that names the shift ("Later that night", "The next morning, across town").
- The FIRST beat must let the reader feel the jump on-page: ground the new time/place and, when the location changed, how or why the protagonist is now here (an arrival, an aftermath, a decision that moved them). One or two concrete details — not a travelogue.
- Do NOT open as if no time passed or as if the protagonist never moved; an unacknowledged cut from ${input.sceneTimeline.previous?.location ?? 'the previous place'} to ${input.sceneBlueprint.location} reads as a continuity error.
` : ''}
${(input.priorEncounterOutcomes?.length ?? 0) > 0 ? `
## POST-ENCOUNTER OUTCOME REACTIVITY (CRITICAL)
This scene follows an encounter that can end several ways, and the gameplay state already records which: ${input.priorEncounterOutcomes!.map(e => `"${e.encounterName}"${e.defeatStakes ? ` (a hard outcome means: ${e.defeatStakes})` : ''}`).join('; ')}.
- The opening MUST NOT read identically regardless of how that encounter went.
- Author at least one textVariant on an EARLY beat gated on the outcome flag so the prose reflects the result — e.g. an ally who was hurt appears injured, a costly win shows its cost, a defeat colors the mood. Use these EXACT flags:
${input.priorEncounterOutcomes!.flatMap(e => e.outcomeFlags.map(o => `  - { "type": "flag", "flag": "${o.flag}", "value": true }  // ${e.encounterName}: ${o.outcome}`)).join('\n')}
- Keep this lean: put these aftermath variants on one or two early beats only. Do not add textVariants to every beat.
- Keep the base text true for the most neutral (victory) path; the variants carry the harder outcomes.
${input.priorEncounterOutcomes!.some(e => e.goalPressure || e.threatPressure) ? `- The encounter ran under pressure the aftermath must still carry — ${input.priorEncounterOutcomes!.filter(e => e.goalPressure || e.threatPressure).map(e => [e.goalPressure ? `what was at stake: ${e.goalPressure}` : '', e.threatPressure ? `the rising danger: ${e.threatPressure}` : ''].filter(Boolean).join('; ')).join('; ')}. Let the prose show its residue (time lost, danger nearer, cost paid) in fiction-first terms — never name clocks, segments, or mechanics.` : ''}
` : ''}
${input.sceneBlueprint.choicePoint ? '- Mark the final beat as isChoicePoint: true for the Choice Author to add options' : ''}
${input.sceneBlueprint.relationshipPacing?.some((contract) => (contract.blockedLabels ?? []).length > 0) ? `
## FINAL RELATIONSHIP LABEL CHECK (before returning JSON)
Do not use any blocked relationship label in beat text, textVariants, dialogue, choices, outcome text, reminders, or residue. Keep the relationship at the exact earned stage and express warmth as invitation, curiosity, testing, guarded care, or provisional connection instead.
Blocked labels: ${Array.from(new Set(input.sceneBlueprint.relationshipPacing.flatMap((contract) => contract.blockedLabels ?? []))).join(', ')}
` : ''}
${input.nextSceneContext?.isEncounter && !input.sceneBlueprint.choicePoint ? `
## PRE-ENCOUNTER HANDOFF (CRITICAL)
This scene leads directly into an encounter scene: "${input.nextSceneContext.name}".
- The FINAL beat must bridge from the current scene into that encounter.
- Include one concrete handoff: a warning, departure, walk home, shortcut, pursuit setup, location shift, ominous sign, or unresolved danger that makes the encounter feel inevitable.
- Do not end on a newly introduced fact if the next scene starts in a different place or tactical situation; give the player a readable cause-and-effect path into the encounter.
- Preserve the final planned key beat from this scene while adding the bridge.
${input.nextSceneContext.encounterBeatPlan?.length ? `- Upcoming encounter beat plan:\n${input.nextSceneContext.encounterBeatPlan.map(beat => `  - ${beat}`).join('\n')}` : ''}
` : ''}${input.nextSceneContext?.location && input.nextSceneContext.location !== input.sceneBlueprint.location ? `
## MOTIVATED DEPARTURE (CRITICAL — the next scene is at ${input.nextSceneContext.location}, not here)
The reader must never find the protagonist somewhere new without seeing them decide to go. Before this scene ends, the prose must show WHY the protagonist leaves ${input.sceneBlueprint.location} and where they are headed (a reason to go: tiredness, a promise, an errand, an escape, a pull toward something).
${input.sceneBlueprint.choicePoint ? '- This scene ends on a choice point: build the departure PRESSURE in the beats BEFORE the choice (the night winding down, a reason to slip away), so the choice reads as how or on-what-terms the protagonist leaves — the Choice Author will land the exit itself in the outcomes.' : '- Land the decision and the first step of the exit in the final beat; the next scene opens on arrival, not on the missing middle.'}
` : ''}
${input.incomingChoiceContext ? `
## CHOICE PAYOFF (CRITICAL — the player CHOSE this)
This scene is entered because the player chose: "${input.incomingChoiceContext}"
Use one or more opening beats as needed to pay off this choice. Do not delay, hedge, skip, or teleport past the payoff.
- The opening sequence must show what you or the protagonist did or immediately experiences because of that choice.
- If the scene starts after a time/place shift, include the decision, departure/movement, and arrival before the next major interaction.
- The next planned story action must wait until the route into it is understandable.
- The opening text must show the immediate consequence of the choice — the SPECIFIC physical action or decision the player chose.
- The first beat's visual contract MUST directly depict the choice's consequence:
  - "visualMoment": Describe the EXACT action from the choice playing out (e.g., if they chose to spin in circles, show spinning in circles — not a generic pose)
  - "primaryAction": The verb-led physical action that matches the choice (e.g., "spins wildly with arms outstretched" not "stands on the moors")
  - "mustShowDetail": A specific visual element from the choice that the image MUST include
- If the player chose to kiss someone, show the kiss. If they chose to dance, show them dancing. If they chose to fight, show the fight. If they chose to laugh wildly and spin, show wild laughter and spinning.
- Do NOT generalize the choice into a mood or atmosphere shot. The image must show the SPECIFIC ACTION the player selected.
- Do NOT show or name a major NPC as familiar until the story has introduced them on the active path.
` : ''}
${premiseContracts ? `
### FINAL PREMISE EVIDENCE CHECK (before returning JSON)
For every required premise below, the reader-facing beat text must contain at
least two concrete evidence patterns from that contract. Prefer natural wording
that preserves the fact, but do not replace a specific fact with a vague mood.
This is a hard content requirement, not metadata. Re-read the beat text before
returning and revise it if any checklist item is absent:
${(input.premiseContracts ?? []).filter((contract) => contract.blocking).map((contract) => `- ${contract.fieldName}: include at least two typed facts: ${(contract.evidenceAtoms ?? []).map((atom) => `${atom.canonicalFact} [${atom.acceptedPatterns.slice(0, 5).join(', ')}]`).join(' | ') || contract.evidencePatterns.join(' | ')}`).join('\n')}
` : ''}

Create the scene content following the SceneContent schema. Include:
1. Engaging narrative prose for each beat
2. Distinct character voices in dialogue
3. Sensory details and atmosphere
4. Natural flow between beats
5. textVariants where state should affect content
6. Full beat visual contract fields (visualMoment, primaryAction, emotionalRead, relationshipDynamic, mustShowDetail, intensityTier) for every beat
7. dramaticIntent for every non-establishing beat, including visibleTurn and visualSubtextCue
8. scene-level sequenceIntent and beat-level sequenceIntent for every non-establishing beat in new multi-beat scenes
9. coveragePlan for every non-establishing beat, including shot scale, angle, staging, visible/offscreen cast, relationship blocking, and continuity
9. Optional visualContinuity metadata when it clarifies beat-to-beat flow; keep panelMode as "single" unless an explicit UX/config flag says otherwise
10. When unresolved callback hooks are listed above, author at least one TextVariant whose \`callbackHookId\` matches an existing hook id. \`callbackHookId\` is ONLY for those listed ledger hooks — a variant gated on a state/outcome flag (\`encounter_*\`, \`route_*\`, \`treatment_branch_*\`, \`tint:*\`) keeps that flag in its condition and sets NO callbackHookId (✓ condition: "encounter_x_partialVictory" with no callbackHookId; ✗ callbackHookId: "encounter_x_partialVictory")
11. sceneTakeaways and transitionIn when they clarify purpose and flow
12. claimedEventIds (or legacy realizedEventIds) containing only event IDs assigned to this scene, plus eventEvidence claims containing the exact eventId, taskId, atomId, supporting beatIds, and a short excerpt. Never claim an event unless the prose actually realizes it.

Respond with valid JSON matching the SceneContent type. Return raw JSON only: no markdown fences, no commentary, no trailing prose.
`;
  }

  private validateContent(content: SceneContent, input: SceneWriterInput): void {
    const allowedEventIds = new Set(
      input.sceneBlueprint.assignedEventIds
      ?? input.sceneBlueprint.narrativeEventIds
      ?? [],
    );
    const claimedEventIds = content.claimedEventIds ?? content.realizedEventIds ?? [];
    const ownedTasks = (input.sceneBlueprint.realizationTasks ?? []).filter((task) => task.ownerStage === 'scene_writer');
    const allowedTaskIds = new Set(ownedTasks.map((task) => task.id));
    const allowedAtomIds = new Set(ownedTasks.flatMap((task) => task.evidenceAtoms.map((atom) => atom.id)));
    for (const eventId of claimedEventIds) {
      if (!allowedEventIds.has(eventId)) {
        throw new Error(`Scene ${content.sceneId} acknowledged unassigned canonical event ${eventId}`);
      }
    }
    for (const claim of content.eventEvidence ?? []) {
      if (!claim || !allowedEventIds.has(claim.eventId)) {
        throw new Error(`Scene ${content.sceneId} supplied evidence for unassigned canonical event ${claim?.eventId ?? 'unknown'}`);
      }
      if (claim.taskId && !allowedTaskIds.has(claim.taskId)) {
        throw new Error(`Scene ${content.sceneId} supplied evidence for unassigned realization task ${claim.taskId}`);
      }
      if (claim.atomId && !allowedAtomIds.has(claim.atomId)) {
        throw new Error(`Scene ${content.sceneId} supplied evidence for unassigned realization atom ${claim.atomId}`);
      }
    }

    // Check beat count
    if (content.beats.length === 0) {
      throw new Error('Scene must have at least 1 beat');
    } else if (content.beats.length === 1) {
      console.warn('[SceneWriter] Scene has only 1 beat - considering splitting for better pacing, but accepting.');
    }

    // Check starting beat exists
    const startingBeat = content.beats.find(b => b.id === content.startingBeatId);
    if (!startingBeat) {
      throw new Error(`Starting beat ${content.startingBeatId} not found`);
    }

    // Check beat chain is valid and auto-fix invalid references (should already be fixed in normalizeContent, but double-check)
    const beatIds = new Set(content.beats.map(b => b.id));
    const beatIndexMap = new Map<string, number>();
    content.beats.forEach((b, idx) => {
      beatIndexMap.set(b.id, idx);
    });

    for (const beat of content.beats) {
      if (beat.nextBeatId && !beatIds.has(beat.nextBeatId)) {
        // This should have been fixed in normalizeContent, but fix it again just in case
        let fixed = false;
        
        // Try extracting all numbers and matching
        const allNumbers = beat.nextBeatId.match(/\d+/g);
        if (allNumbers) {
          // Try each number
          for (const num of allNumbers) {
            const candidateId = `beat-${num}`;
            if (beatIds.has(candidateId)) {
              console.warn(`[SceneWriter] VALIDATION: Beat ${beat.id} references non-existent beat ${beat.nextBeatId}, auto-fixing to ${candidateId}`);
              beat.nextBeatId = candidateId;
              fixed = true;
              break;
            }
          }
          
          // Try last number if still not fixed
          if (!fixed && allNumbers.length > 1) {
            const lastNumber = allNumbers[allNumbers.length - 1];
            const candidateId = `beat-${lastNumber}`;
            if (beatIds.has(candidateId)) {
              console.warn(`[SceneWriter] VALIDATION: Beat ${beat.id} references non-existent beat ${beat.nextBeatId}, auto-fixing to ${candidateId} (last number)`);
              beat.nextBeatId = candidateId;
              fixed = true;
            }
          }
        }
        
        // Use next beat in sequence if still not fixed
        if (!fixed) {
          const currentIndex = beatIndexMap.get(beat.id);
          if (currentIndex !== undefined && currentIndex < content.beats.length - 1) {
            const nextBeat = content.beats[currentIndex + 1];
            console.warn(`[SceneWriter] VALIDATION: Beat ${beat.id} references non-existent beat ${beat.nextBeatId}, auto-fixing to ${nextBeat.id} (next in sequence)`);
            beat.nextBeatId = nextBeat.id;
            fixed = true;
          } else {
            // Last beat - clear the reference
            console.warn(`[SceneWriter] VALIDATION: Beat ${beat.id} references non-existent beat ${beat.nextBeatId}, clearing reference (last beat)`);
            beat.nextBeatId = undefined;
          }
        }
      }
    }

    // Check choice point is marked if blueprint has one
    if (input.sceneBlueprint.choicePoint) {
      const hasChoicePoint = content.beats.some(b => b.isChoicePoint);
      if (!hasChoicePoint) {
        console.warn('[SceneWriter] VALIDATION: Scene blueprint has choice point but no beat is marked. Auto-fixing: marking last beat.');
        if (content.beats.length > 0) {
          content.beats[content.beats.length - 1].isChoicePoint = true;
        } else {
           throw new Error('Scene blueprint has choice point but no beats generated');
        }
      }
    }

    this.validatePreEncounterHandoff(content, input);

    // Check text length - warn on too short OR too long
    const MAX_SENTENCES = 4;
    const MAX_WORDS = TEXT_LIMITS.maxBeatWordCount;

    for (const beat of content.beats) {
      const text = typeof beat.text === 'string' ? beat.text : String(beat.text || '');
      if (!text || text.trim().length === 0) {
        // Empty beat is a real problem - provide placeholder
        console.warn(`[SceneWriter] Beat ${beat.id} has no text, adding placeholder`);
        beat.text = '[Scene continues...]';
      } else if (text.trim().length < 10) {
        // Very short beat - log warning but allow it
        console.warn(`[SceneWriter] Beat ${beat.id} has very short text (${text.trim().length} chars): "${text.trim()}"`);
      } else {
        // Check if beat exceeds its cap (varies by beat type)
        const wordCount = text.trim().split(/\s+/).length;
        const sentenceCount = (text.match(/[.!?]+/g) || []).length;
        const maxWords = beat.isClimaxBeat
          ? TEXT_LIMITS.maxClimaxBeatWordCount
          : beat.isKeyStoryBeat
            ? TEXT_LIMITS.maxKeyStoryBeatWordCount
            : MAX_WORDS;

        if (wordCount > maxWords || sentenceCount > MAX_SENTENCES) {
          console.warn(`[SceneWriter] Beat ${beat.id} exceeds cap: ${wordCount} words, ~${sentenceCount} sentences (cap: ${maxWords} words).`);
          console.warn(`[SceneWriter] Text: "${text.substring(0, 100)}..."`);
        }
      }

      if (!beat.shotType) {
        console.warn(`[SceneWriter] Beat ${beat.id} is missing shotType; image agent will need to guess shot intent`);
      }
      const contractChecks: Array<[string, string | undefined]> = [
        ['visualMoment', beat.visualMoment],
        ['mustShowDetail', beat.mustShowDetail],
      ];
      if (beat.shotType !== 'establishing') {
        contractChecks.push(
          ['primaryAction', beat.primaryAction],
          ['emotionalRead', beat.emotionalRead],
          ['relationshipDynamic', beat.relationshipDynamic],
        );
      }
      for (const [field, value] of contractChecks) {
        if (!value || value.trim().length < 8) {
          console.warn(`[SceneWriter] Beat ${beat.id} has weak ${field}; downstream visual fidelity may degrade`);
        }
      }
    }
  }

  private validatePreEncounterHandoff(content: SceneContent, input: SceneWriterInput): void {
    if (!input.nextSceneContext?.isEncounter || input.sceneBlueprint.choicePoint) return;
    if (!content.beats.length) return;

    const finalBeat = content.beats[content.beats.length - 1];
    const finalText = this.normalizeForHandoffCheck(finalBeat.text);
    if (!finalText) return;

    const bridgeMarkers = [
      'after', 'alone', 'approach', 'careful', 'danger', 'door', 'exit', 'follow',
      'fog', 'gate', 'home', 'leave', 'leaves', 'leaving', 'night', 'outside',
      'park', 'path', 'pursue', 'shortcut', 'stalk', 'street', 'trust', 'warn',
      'warning', 'watch', 'watched', 'walk',
    ];
    const nextContextTerms = [
      input.nextSceneContext.name,
      input.nextSceneContext.location,
      input.nextSceneContext.description,
      input.nextSceneContext.encounterDescription,
      ...(input.nextSceneContext.encounterBeatPlan || []),
    ]
      .flatMap((text) => this.extractHandoffKeywords(text))
      .filter((term) => term.length >= 4);

    const hasBridgeMarker = bridgeMarkers.some((marker) => finalText.includes(marker));
    const hasNextContextTerm = nextContextTerms.some((term) => finalText.includes(term));

    if (!hasBridgeMarker && !hasNextContextTerm) {
      throw new Error(
        `Pre-encounter handoff missing for ${input.sceneBlueprint.id}: final beat must bridge into ` +
        `${input.nextSceneContext.id} (${input.nextSceneContext.name}) with a warning, departure, ` +
        `location shift, pursuit setup, or other concrete cause-and-effect transition.`
      );
    }
  }

  private normalizeForHandoffCheck(text?: string): string {
    return String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private extractHandoffKeywords(text?: string): string[] {
    const stopWords = new Set([
      'about', 'after', 'again', 'being', 'from', 'have', 'into', 'must',
      'scene', 'that', 'their', 'there', 'this', 'through', 'using', 'what',
      'when', 'where', 'with', 'your',
    ]);
    return this.normalizeForHandoffCheck(text)
      .split(' ')
      .filter((word) => word.length >= 4 && !stopWords.has(word))
      .slice(0, 20);
  }

  private ensureBeatVisualContract(beat: GeneratedBeat): void {
    const text = (beat.text || '').trim();
    const subject = beat.speaker || 'the focal character';

    // Derive shotType from text signals when LLM didn't set it
    if (!beat.shotType) {
      beat.shotType = this.deriveShotType(beat, text);
    }

    if (beat.shotType === 'establishing') {
      // Establishing shots need only a visual moment describing the environment
      if (!beat.visualMoment || this.isAbstractOnly(beat.visualMoment)) {
        beat.visualMoment = this.deriveEstablishingVisualMoment(text);
      }
      // Clear character-centric fields so they don't bleed into image prompts
      beat.primaryAction = '';
      beat.emotionalRead = '';
      beat.relationshipDynamic = '';
      if (!beat.mustShowDetail || this.isAbstractOnly(beat.mustShowDetail)) {
        beat.mustShowDetail = this.deriveMustShowDetail(text);
      }
      return;
    }

    if (!beat.primaryAction || this.isAbstractOnly(beat.primaryAction)) {
      beat.primaryAction = this.derivePrimaryAction(text, subject);
    }
    if (!beat.visualMoment || this.isAbstractOnly(beat.visualMoment)) {
      beat.visualMoment = this.deriveVisualMoment(text, beat.primaryAction || 'acts', subject);
    }
    if (!beat.emotionalRead || this.isAbstractOnly(beat.emotionalRead)) {
      beat.emotionalRead = this.deriveEmotionalRead(text, beat.speakerMood);
    }
    if (!beat.relationshipDynamic || this.isAbstractOnly(beat.relationshipDynamic)) {
      beat.relationshipDynamic = this.deriveRelationshipDynamic(text);
    }
    if (!beat.mustShowDetail || this.isAbstractOnly(beat.mustShowDetail)) {
      beat.mustShowDetail = this.deriveMustShowDetail(text);
    }
    if (!beat.dramaticIntent || this.isWeakDramaticIntent(beat.dramaticIntent)) {
      beat.dramaticIntent = this.deriveDramaticIntent(beat, subject);
    }
    this.strengthenStaticVisualContract(beat, subject);
  }

  private isWeakStaticAction(action?: string): boolean {
    const normalized = (action || '').trim().toLowerCase();
    if (!normalized || normalized.length < 8) return true;
    return /\b(takes? a decisive physical action|reacts? under pressure|reports?|explains?|addresses?|observes?|focuses|voices?|deflects?|compliments?|speaks?|talks?|looks?|watches?|thinks?|realizes?|notices?|listens?|waits?|smiles?|continues)\b/.test(normalized);
  }

  private isWeakDramaticIntent(intent?: Beat['dramaticIntent']): boolean {
    if (!intent) return true;
    return !intent.visibleTurn || !intent.visualSubtextCue || !intent.obstacle;
  }

  private deriveDramaticIntent(beat: GeneratedBeat, subject: string): NonNullable<Beat['dramaticIntent']> {
    const text = (beat.text || '').trim();
    const primaryAction = beat.primaryAction || this.derivePrimaryAction(text, subject);
    const visibleTurn = this.deriveVisibleTurn(text, primaryAction, subject);
    const visualSubtextCue = this.deriveVisualSubtextCue(text, primaryAction, subject);
    const obstacle = this.deriveIntentObstacle(text);
    const objective = this.deriveCharacterObjective(text, subject);
    return {
      ...(beat.dramaticIntent || {}),
      characterObjectives: {
        ...(beat.dramaticIntent?.characterObjectives || {}),
        [subject]: beat.dramaticIntent?.characterObjectives?.[subject] || objective,
      },
      obstacle: beat.dramaticIntent?.obstacle || obstacle,
      statusBefore: beat.dramaticIntent?.statusBefore || this.deriveStatusBefore(text, subject),
      statusAfter: beat.dramaticIntent?.statusAfter || this.deriveStatusAfter(text, primaryAction, subject),
      subtext: beat.dramaticIntent?.subtext || this.deriveSubtext(text),
      visibleTurn: beat.dramaticIntent?.visibleTurn || visibleTurn,
      visualSubtextCue: beat.dramaticIntent?.visualSubtextCue || visualSubtextCue,
    };
  }

  private deriveVisibleTurn(text: string, action: string, subject: string): string {
    const lowered = text.toLowerCase();
    if (/(lie|lying|deflect|deny|glitch|imagining|casual|normal)/.test(lowered)) {
      return `${subject} lets one guarded reaction break through before recovering.`;
    }
    if (/(report|explain|warn|tell|says?|asks?|voice|speaks?)/.test(lowered)) {
      return `${subject} changes the room by putting the hidden pressure into words.`;
    }
    if (/(observe|watch|study|notice|realize|understand)/.test(lowered)) {
      return `${subject} notices the decisive clue and ${subject}'s posture changes around it.`;
    }
    if (/(phone|text|message|screen|photo|app)/.test(lowered)) {
      return `${subject} uses the phone as evidence, shifting the room's attention to the screen.`;
    }
    if (/(charm|ring|key|letter|map|knife|gun|cup|coffee|flower|pansy|bag|napkin)/.test(lowered)) {
      return `${subject} moves or reveals the key object so everyone has to notice it.`;
    }
    const escapedSubject = subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const strippedAction = action.replace(new RegExp(`^${escapedSubject}\\s+`, 'i'), '').replace(/[,.]\s*$/g, '').trim();
    return strippedAction
      ? `${subject} ${strippedAction}, and the room answers with a changed silence.`
      : `${subject} holds still long enough for the silence to change shape.`;
  }

  private deriveVisualSubtextCue(text: string, action: string, subject: string): string {
    const lowered = text.toLowerCase();
    const prop = text.match(/\b(phone|text|screen|photo|charm|ring|key|letter|map|knife|gun|cup|coffee|flower|pansy|shopping bag|napkin|counter|door|chair|window)\b/i)?.[0];
    if (prop) return `${subject} keeps a hand near the ${prop}, using the object as cover for what cannot be said.`;
    if (/(lie|deflect|deny|casual|normal|smile)/.test(lowered)) {
      return `${subject}'s smile holds a second too long before the mask settles again.`;
    }
    if (/(fear|panic|worry|guilt|shame|hurt)/.test(lowered)) {
      return `${subject}'s weight shifts back while ${subject}'s hands tighten, exposing the feeling under the words.`;
    }
    if (/(approach|enter|leave|walk|step|back away|retreat)/.test(lowered)) {
      return `The changing distance around ${subject} shows who is gaining or losing control.`;
    }
    return `${subject} holds position a beat too long, giving the room time to read the silence.`;
  }

  private strengthenStaticVisualContract(beat: GeneratedBeat, subject: string): void {
    if (beat.shotType === 'establishing') return;
    const intent = beat.dramaticIntent || this.deriveDramaticIntent(beat, subject);
    const needsStrength = this.isWeakStaticAction(beat.primaryAction);
    if (needsStrength) {
      beat.primaryAction = this.derivePhysicalBusinessFromIntent(beat.text || '', subject, intent);
    }
    if (!beat.visualMoment || this.isAbstractOnly(beat.visualMoment) || this.isWeakStaticAction(beat.visualMoment)) {
      beat.visualMoment = `${intent.visibleTurn} ${intent.visualSubtextCue}`.trim();
    }
    const visibleTurn = intent.visibleTurn || this.deriveVisibleTurn(beat.text || '', beat.primaryAction || '', subject);
    const cue = intent.visualSubtextCue || this.deriveVisualSubtextCue(beat.text || '', beat.primaryAction || '', subject);
    beat.dramaticIntent = { ...intent, visibleTurn, visualSubtextCue: cue };
    if (!beat.mustShowDetail || /one concrete prop|body detail|key prop/i.test(beat.mustShowDetail)) {
      beat.mustShowDetail = cue;
    }
    if (!beat.relationshipDynamic || this.isAbstractOnly(beat.relationshipDynamic)) {
      beat.relationshipDynamic = `${intent.statusBefore || 'status is unsettled'} -> ${intent.statusAfter || 'status visibly shifts'}`;
    }
  }

  private formatSequenceIntent(intent?: Beat['sequenceIntent']): string {
    if (!intent) return 'Derive from dramaticQuestion, conflictEngine, and keyBeats.';
    return [
      `objective=${intent.objective || 'derive'}`,
      `activity=${intent.activity || 'derive'}`,
      `obstacle=${intent.obstacle || 'derive'}`,
      `start=${intent.startState || 'derive'}`,
      `turn=${intent.turningPoint || 'derive'}`,
      `end=${intent.endState || 'derive'}`,
      `visualThread=${intent.visualThread || 'derive'}`,
      `mechanicThread=${intent.mechanicThread || 'optional'}`,
    ].join('; ');
  }

  private ensureBeatSequenceIntent(beat: GeneratedBeat, content: SceneContent, index: number): void {
    if (beat.shotType === 'establishing') return;
    const sceneIntent = content.sequenceIntent || this.deriveSceneSequenceIntent(content);
    if (!beat.sequenceIntent || this.isWeakSequenceIntent(beat.sequenceIntent)) {
      beat.sequenceIntent = {
        ...sceneIntent,
        ...(beat.sequenceIntent || {}),
        beatRole: beat.sequenceIntent?.beatRole || this.deriveSequenceBeatRole(index, content.beats.length, beat),
        turningPoint: beat.sequenceIntent?.turningPoint || beat.dramaticIntent?.visibleTurn || sceneIntent?.turningPoint,
        visualThread: beat.sequenceIntent?.visualThread || beat.dramaticIntent?.visualSubtextCue || sceneIntent?.visualThread,
      };
    }
  }

  private isWeakSequenceIntent(intent?: Beat['sequenceIntent']): boolean {
    if (!intent) return true;
    return !intent.objective || !intent.activity || !intent.turningPoint || !intent.endState || !intent.visualThread;
  }

  private deriveSceneSequenceIntent(content: SceneContent, input?: SceneWriterInput): NonNullable<Beat['sequenceIntent']> {
    const blueprint = input?.sceneBlueprint;
    const beats = content.beats || [];
    const firstBeat = beats.find((beat) => beat.shotType !== 'establishing') || beats[0];
    const turnBeat = beats.find((beat) => beat.isClimaxBeat || beat.isKeyStoryBeat || beat.intensityTier === 'dominant') || beats[Math.max(0, Math.floor(beats.length / 2))] || firstBeat;
    const lastBeat = beats[beats.length - 1] || firstBeat;
    const combined = [
      blueprint?.description,
      blueprint?.dramaticQuestion,
      blueprint?.conflictEngine,
      ...(blueprint?.keyBeats || []),
      ...beats.map((beat) => beat.text),
    ].filter(Boolean).join(' ');
    const subject = firstBeat?.speaker || content.charactersInvolved?.[0] || 'the focal character';
    return {
      ...(blueprint?.sequenceIntent || content.sequenceIntent || {}),
      sequenceId: blueprint?.sequenceIntent?.sequenceId || content.sequenceIntent?.sequenceId || `${content.sceneId || 'scene'}-sequence-1`,
      objective: blueprint?.sequenceIntent?.objective || content.sequenceIntent?.objective || this.deriveSequenceObjective(combined, subject),
      activity: blueprint?.sequenceIntent?.activity || content.sequenceIntent?.activity || this.deriveSequenceActivity(combined),
      obstacle: blueprint?.sequenceIntent?.obstacle || content.sequenceIntent?.obstacle || this.deriveIntentObstacle(combined),
      startState: blueprint?.sequenceIntent?.startState || content.sequenceIntent?.startState || this.deriveSequenceState(firstBeat, 'The sequence starts with pressure still unresolved.'),
      turningPoint: blueprint?.sequenceIntent?.turningPoint || content.sequenceIntent?.turningPoint || turnBeat?.dramaticIntent?.visibleTurn || this.deriveVisibleTurn(turnBeat?.text || combined, turnBeat?.primaryAction || 'acts', subject),
      endState: blueprint?.sequenceIntent?.endState || content.sequenceIntent?.endState || this.deriveSequenceState(lastBeat, 'By the end, the relationship, leverage, knowledge, or risk has visibly changed.'),
      visualThread: blueprint?.sequenceIntent?.visualThread || content.sequenceIntent?.visualThread || this.deriveVisualSubtextCue(combined, turnBeat?.primaryAction || '', subject),
      mechanicThread: blueprint?.sequenceIntent?.mechanicThread || content.sequenceIntent?.mechanicThread || this.deriveSequenceMechanicThread(combined),
    };
  }

  private deriveSequenceBeatRole(index: number, count: number, beat: GeneratedBeat): NonNullable<Beat['sequenceIntent']>['beatRole'] {
    if (beat.intensityTier === 'rest') return index >= count - 1 ? 'aftermath' : 'pressure';
    if (index === 0) return 'setup';
    if (beat.isClimaxBeat || beat.isKeyStoryBeat || beat.intensityTier === 'dominant') return 'turn';
    if (index >= count - 1) return beat.isChoicePoint ? 'handoff' : 'consequence';
    return index < Math.max(2, Math.floor(count / 2)) ? 'pressure' : 'escalation';
  }

  private deriveSequenceObjective(text: string, subject: string): string {
    const lowered = text.toLowerCase();
    if (/(argue|accuse|confront|apologize|forgive)/.test(lowered)) return `${subject} tries to change the relationship without losing control of the room.`;
    if (/(walk|travel|store|market|street|road|cross)/.test(lowered)) return `${subject} tries to reach the next place while the unresolved pressure follows along.`;
    if (/(search|investigat|clue|evidence|proof|discover)/.test(lowered)) return `${subject} tries to make hidden information visible and actionable.`;
    if (/(fight|duel|strike|battle|escape|chase|run)/.test(lowered)) return `${subject} tries to survive the pressure and change the tactical position.`;
    if (/(rest|recover|aftermath|quiet|settle)/.test(lowered)) return `${subject} tries to absorb what happened and recalibrate before the next pressure.`;
    return `${subject} tries to move the scene from uncertainty to a changed state.`;
  }

  private deriveSequenceActivity(text: string): string {
    const lowered = text.toLowerCase();
    if (/(walk|travel|store|market|street|road|cross)/.test(lowered)) return 'moving through the location while unresolved tension changes distance and attention';
    if (/(argue|accuse|confront)/.test(lowered)) return 'a confrontation carried through blocking, objects, and shifting status';
    if (/(search|investigat|clue|evidence|proof|discover)/.test(lowered)) return 'an investigation where attention moves from room to clue to reaction';
    if (/(fight|duel|strike|battle)/.test(lowered)) return 'a physical exchange where position, control, and cost change';
    if (/(escape|chase|run)/.test(lowered)) return 'an escape or chase where the route and risk keep changing';
    if (/(rest|recover|aftermath|quiet|settle)/.test(lowered)) return 'a quiet recovery sequence where posture, distance, and routine reveal the change';
    return 'a visible exchange of pressure, reaction, and consequence';
  }

  private deriveSequenceState(beat: GeneratedBeat | undefined, fallback: string): string {
    return beat?.dramaticIntent?.statusAfter || beat?.dramaticIntent?.visibleTurn || beat?.visualMoment || beat?.primaryAction || fallback;
  }

  private deriveSequenceMechanicThread(text: string): string | undefined {
    const lowered = text.toLowerCase();
    if (/(trust|believe|doubt|betray|forgive)/.test(lowered)) return 'trust';
    if (/(evidence|proof|clue|photo|phone|letter|key|charm)/.test(lowered)) return 'clue/evidence';
    if (/(leverage|control|power|corner)/.test(lowered)) return 'leverage';
    if (/(danger|risk|threat|escape|wound|cost)/.test(lowered)) return 'danger/risk';
    if (/(identity|mercy|justice|honest|values?)/.test(lowered)) return 'identity';
    if (/(resource|money|weapon|supplies|inventory)/.test(lowered)) return 'resource';
    return undefined;
  }

  private derivePhysicalBusinessFromIntent(text: string, subject: string, intent: NonNullable<Beat['dramaticIntent']>): string {
    const lowered = text.toLowerCase();
    if (/(phone|text|message|screen|photo|app)/.test(lowered)) return `${subject} angles the phone like evidence while watching for a reaction`;
    if (/(charm|ring|key|letter|map|knife|gun|cup|coffee|flower|pansy|bag|napkin)/.test(lowered)) return `${subject} brings the key object into the space between the characters`;
    if (/(deflect|deny|glitch|imagining|casual|normal|smile|compliment)/.test(lowered)) return `${subject} keeps their hands busy to hide the evasion`;
    if (/(report|explain|warn|tell|says?|asks?|voice|speaks?)/.test(lowered)) return `${subject} leans in and uses a concrete gesture to press the point`;
    if (/(observe|watch|study|notice|realize|understand)/.test(lowered)) return `${subject} shifts position to study the clue everyone else is avoiding`;
    if (/(guilt|shame|fear|hurt|worry)/.test(lowered)) return `${subject} pulls back as the feeling becomes visible in their hands and shoulders`;
    const cue = intent.visualSubtextCue || 'a visible body-language cue';
    return `${subject} reacts through ${cue}`;
  }

  private deriveCharacterObjective(text: string, subject: string): string {
    const lowered = text.toLowerCase();
    if (/(deflect|deny|glitch|imagining|casual|normal)/.test(lowered)) return 'avoid revealing the truth while preserving control';
    if (/(ask|question|look at this|show|evidence|proof|photo)/.test(lowered)) return 'make the other person acknowledge what is visible';
    if (/(report|warn|tell|explain)/.test(lowered)) return 'make someone else understand the danger or truth';
    if (/(observe|watch|study|notice|realize)/.test(lowered)) return 'read the situation without exposing too much';
    if (/(leave|door|walk away|retreat)/.test(lowered)) return 'escape the exchange before the real feeling is exposed';
    return `press for a visible change while keeping the deeper motive guarded`;
  }

  private deriveIntentObstacle(text: string): string {
    const lowered = text.toLowerCase();
    if (/(lie|deny|deflect|secret|hiding)/.test(lowered)) return 'someone is hiding the truth';
    if (/(guilt|shame|fear|hurt|worry)/.test(lowered)) return 'emotion makes the direct path risky';
    if (/(trust|love|relationship|family)/.test(lowered)) return 'the relationship cost is immediate';
    if (/(proof|evidence|photo|phone|screen|charm|key|letter)/.test(lowered)) return 'the evidence is visible but contested';
    return 'the other character resists the surface objective';
  }

  private deriveStatusBefore(text: string, subject: string): string {
    if (/(enters?|arrives?|approaches?)/i.test(text)) return 'the room has not yielded control yet';
    if (/(phone|evidence|proof|charm|key|letter)/i.test(text)) return 'the truth is still deniable';
    return 'leverage is unresolved at the start of the beat';
  }

  private deriveStatusAfter(text: string, action: string, subject: string): string {
    if (/(leave|walks? away|retreat|back away)/i.test(text)) return `${subject} changes status by creating distance`;
    if (/(shows?|reveals?|holds? up|photo|proof|evidence|charm|key|letter)/i.test(text)) return 'the visible evidence claims leverage';
    if (/(deny|deflect|glitch|imagining)/i.test(text)) return 'control depends on whether the evasion holds';
    return `${subject}'s visible action shifts attention and leverage`;
  }

  private deriveSubtext(text: string): string {
    const lowered = text.toLowerCase();
    if (/(deflect|deny|glitch|imagining|casual|normal)/.test(lowered)) return 'the surface reassurance is a cover for fear of exposure';
    if (/(guilt|shame|violation)/.test(lowered)) return 'the character is paying an emotional cost for the choice';
    if (/(trust|love|hurt|wrong)/.test(lowered)) return 'the relationship is being tested beneath the words';
    if (/(proof|evidence|photo|phone|charm|key|letter)/.test(lowered)) return 'an object is forcing an unspoken truth into the open';
    return 'the visible behavior reveals more than the spoken topic admits';
  }

  private deriveShotType(beat: GeneratedBeat, text: string): 'establishing' | 'character' | 'action' {
    // If there's a speaker it's inherently a character beat
    if (beat.speaker) return 'character';

    const lowered = text.toLowerCase();

    // Strong action verbs → action shot
    const hasActionVerb = /\b(grabs?|reaches?|recoils?|steps?\s+forward|stumbles?|lunges?|pushes?|pulls?|raises?|strikes?|dodges?|fires?|shoots?|charges?|slams?|throws?|catches?)\b/.test(lowered);
    if (hasActionVerb) return 'action';

    // Second-person text WITHOUT any character dialogue or action anchors
    // e.g. "Rain streaks down your apartment windows" → establishing
    // vs "You turn to face her" → character
    const hasCharacterPronounAction = /\byou\s+(turn|step|move|walk|run|reach|grab|look\s+at|face|stand\s+up|sit\s+down|rise|approach|back\s+away)\b/.test(lowered);
    if (hasCharacterPronounAction) return 'character';

    // Atmospheric keywords with second-person address describing the environment
    const hasAtmosphericEnv = /\b(rain|neon|window|street|city|sky|horizon|corridor|room|space|building|apartment|hall|fog|darkness|shadow|landscape|crowd|distance)\b/.test(lowered);
    const isPassiveDescription = !/(shout|cry|yell|sneer|smile|grin|frown|laugh|growl|whisper|mutter|hiss|says?|said|asks?|replies?|replies?)\b/.test(lowered);

    if (hasAtmosphericEnv && isPassiveDescription) return 'establishing';

    return 'character';
  }

  private deriveEstablishingVisualMoment(text: string): string {
    // Use the first sentence of the beat text as-is — it's the environment description
    const firstSentence = text.split(/[.!?]\s+/)[0]?.trim();
    if (firstSentence && firstSentence.length >= 15) {
      return firstSentence;
    }
    return text.substring(0, 120).trim();
  }

  private deriveVisualMoment(text: string, action: string, subject: string): string {
    const firstSentence = text.split(/[.!?]\s+/)[0]?.trim();
    if (firstSentence && firstSentence.length >= 12) {
      return firstSentence;
    }
    return `${subject} ${action} in a single, visually readable instant.`;
  }

  private derivePrimaryAction(text: string, subject: string): string {
    const match = text.toLowerCase().match(/\b(grabs?|reaches?|recoils?|steps?|stumbles?|lunges?|turns?|pushes?|pulls?|raises?|lowers?|clenches?|releases?|strikes?|dodges?|embraces?|confronts?|retreats?|advances?|kneels?|draws|aims|backs away|locks eyes)\b/);
    if (match) {
      return `${subject} ${match[0]}`;
    }
    return `${subject} shifts around the nearest object or threshold`;
  }

  private deriveEmotionalRead(text: string, speakerMood?: string): string {
    const lowered = text.toLowerCase();
    if (/(rage|angry|furious|snarl|clench|grit)/.test(lowered)) {
      return 'brow tightened, jaw clenched, shoulders pitched forward with aggressive tension';
    }
    if (/(fear|panic|recoil|flinch|stagger|alarm)/.test(lowered)) {
      return 'eyes widened, mouth tense, weight shifted backward in defensive recoil';
    }
    if (/(grief|sad|sorrow|tears?|mourn)/.test(lowered)) {
      return 'eyes glossed, mouth softened, shoulders dropping under emotional weight';
    }
    if (speakerMood) {
      return `face and posture visibly communicate ${speakerMood}`;
    }
    return 'emotion reads clearly through eyes, mouth tension, and posture';
  }

  private deriveRelationshipDynamic(text: string): string {
    const lowered = text.toLowerCase();
    if (/(confront|accuse|challenge|threat|argue)/.test(lowered)) {
      return 'confrontational spacing: one party presses in while the other resists or holds ground';
    }
    if (/(comfort|support|embrace|help|steady)/.test(lowered)) {
      return 'supportive proximity: bodies angled toward each other with reduced emotional distance';
    }
    if (/(betray|deceive|distrust|suspicion)/.test(lowered)) {
      return 'fractured trust: visible hesitation, guarded posture, and increased interpersonal distance';
    }
    return 'clear spatial and power dynamic between visible characters';
  }

  private deriveMustShowDetail(text: string): string {
    const quoted = text.match(/"([^"]{3,80})"/)?.[1];
    if (quoted) {
      return `a key prop or gesture tied to the spoken line "${quoted}"`;
    }
    const detail = text.match(/\b(letter|blade|blood|ring|key|door|map|gun|knife|pendant|wound|tear|fist|hands?|eyes)\b/i)?.[1];
    if (detail) {
      return `the ${detail} that anchors this beat's dramatic meaning`;
    }
    return 'one concrete prop or body detail that makes the beat unmistakable';
  }

  private isAbstractOnly(value?: string): boolean {
    if (!value) return true;
    const v = value.toLowerCase();
    return (
      /\btension rises\b/.test(v) ||
      /\bemotion deepens\b/.test(v) ||
      /\bconflict escalates\b/.test(v) ||
      /\bdramatic moment\b/.test(v) ||
      /\bthe mood\b/.test(v) ||
      /\bthe atmosphere\b/.test(v)
    );
  }

  /**
   * Collect issues that need revision feedback
   */
  private collectIssues(content: SceneContent, input: SceneWriterInput): string[] {
    const issues: string[] = [];
    const MAX_WORDS = TEXT_LIMITS.maxBeatWordCount;
    const MAX_SENTENCES = 4;

    // Check for beats that exceed their cap (varies by beat type)
    const longBeats: string[] = [];
    let climaxCount = 0;
    let keyStoryBeatCount = 0;
    for (const beat of content.beats || []) {
      const text = typeof beat.text === 'string' ? beat.text : String(beat.text || '');
      const wordCount = text.trim().split(/\s+/).length;
      const sentenceCount = this.countSentencesBounded(text);
      const originalTextChars = (beat as any).__sceneWriterOriginalTextCharCount || text.length;

      const maxWords = beat.isClimaxBeat
        ? TEXT_LIMITS.maxClimaxBeatWordCount
        : beat.isKeyStoryBeat
          ? TEXT_LIMITS.maxKeyStoryBeatWordCount
          : MAX_WORDS;
      if (beat.isClimaxBeat) climaxCount++;
      if (beat.isKeyStoryBeat) keyStoryBeatCount++;

      if (originalTextChars > SCENE_WRITER_MAX_PROCESSING_TEXT_CHARS) {
        issues.push(`OVERLONG BEAT TEXT - Beat "${beat.id}" returned ${originalTextChars} characters, exceeding the ${SCENE_WRITER_MAX_PROCESSING_TEXT_CHARS}-character scene processing budget. Rewrite it into concise player-facing prose under the beat word/sentence cap; do not preserve generation notes or boilerplate.`);
      }
      if (wordCount > maxWords || sentenceCount > MAX_SENTENCES) {
        longBeats.push(
          `Beat "${beat.id}" (${beat.isClimaxBeat ? 'climax' : beat.isKeyStoryBeat ? 'key' : 'standard'}): ` +
          `${wordCount}/${maxWords} words, ${sentenceCount}/${MAX_SENTENCES} sentences`
        );
      }
      if (/\{[A-Z][A-Za-z0-9]*\}/.test(text)) {
        issues.push(`SCHEMA PLACEHOLDER LEAK - Beat "${beat.id}" contains an unresolved {Variable} placeholder. Rewrite it as concrete player-facing prose.`);
      }

      for (const [variantIndex, variant] of (beat.textVariants || []).entries()) {
        const candidate = variant as { text?: unknown; condition?: unknown };
        const variantText = typeof candidate.text === 'string' ? candidate.text.trim() : '';
        const variantOriginalChars = (candidate as any).__sceneWriterOriginalTextCharCount || variantText.length;
        const hasCondition = this.isMeaningfulVariantCondition(candidate.condition);
        if (!variantText || !hasCondition) {
          issues.push(`MALFORMED TEXT VARIANT - Beat "${beat.id}" variant ${variantIndex + 1} must include a real condition object and non-empty text. Remove boilerplate variants or rewrite them as playable branch-residue prose.`);
        }
        if (variantOriginalChars > SCENE_WRITER_MAX_PROCESSING_TEXT_CHARS) {
          issues.push(`OVERLONG TEXT VARIANT - Beat "${beat.id}" variant ${variantIndex + 1} returned ${variantOriginalChars} characters, exceeding the ${SCENE_WRITER_MAX_PROCESSING_TEXT_CHARS}-character scene processing budget. Rewrite it as one concise branch-residue line.`);
        }
      }
    }
    if (climaxCount > 2) {
      issues.push(`TOO MANY CLIMAX BEATS - ${climaxCount} marked isClimaxBeat. Use max 1-2 per scene for true climaxes only.`);
    }
    if (keyStoryBeatCount > TEXT_LIMITS.maxKeyStoryBeatsPerScene) {
      issues.push(`TOO MANY KEY STORY BEATS - ${keyStoryBeatCount} marked isKeyStoryBeat. Cap is ${TEXT_LIMITS.maxKeyStoryBeatsPerScene} per scene.`);
    }
    if (longBeats.length > 0) {
      issues.push(`BEATS EXCEED CAP - Split or shorten any beat over its word or sentence cap:\n${longBeats.join('\n')}`);
    }

    if (input.protagonistInfo) {
      const povResult = new PovClarityValidator().validateScene(content, {
        protagonistName: input.protagonistInfo.name,
        characterNames: [
          input.protagonistInfo.name,
          ...(input.npcs || []).map(npc => npc.name),
        ],
      });
      for (const issue of povResult.issues) {
        issues.push(`POV CLARITY - Beat "${issue.beatId}": ${issue.issue} ${issue.suggestion}`);
      }
    }

    for (const issue of auditFictionFirstTurns(content.beats || [])) {
      issues.push(`FICTION-FIRST TURN ${issue.category.toUpperCase()} - Beat "${issue.beatId}": ${issue.message} ${issue.suggestion}`);
    }

    // Check for missing choice point
    if (input.sceneBlueprint.choicePoint) {
      const hasChoicePoint = content.beats?.some(b => b.isChoicePoint);
      if (!hasChoicePoint) {
        issues.push(`MISSING CHOICE POINT - The scene blueprint requires a choice, but no beat is marked as isChoicePoint: true. Mark the final beat where the player should make a decision.`);
      }
    }

    // Check for degenerative cases (0-1 beats when scene clearly needs more)
    const beatCount = content.beats?.length || 0;
    if (beatCount === 0) {
      issues.push(`NO BEATS - Scene must have at least 1 beat.`);
    } else if (beatCount === 1 && input.targetBeatCount >= 3) {
      issues.push(`SINGLE BEAT - Consider splitting into 2-3 beats for pacing.`);
    } else if (input.targetBeatCount >= 6 && input.sceneBlueprint.choicePoint && beatCount < 6) {
      issues.push(`SCENE-LENGTH UNDERFILL - This scene-length choice episode needs at least 6 beats before validation; found ${beatCount}. Expand with concrete escalation, reversal, discovery, cost, and choice residue beats.`);
    }

    return issues;
  }

  /**
   * Request a revision from the LLM with specific feedback
   */
  private async executeRevision(
    input: SceneWriterInput,
    originalContent: SceneContent,
    issues: string[]
  ): Promise<AgentResponse<SceneContent>> {
    console.log(`[SceneWriter] Requesting revision for ${issues.length} issues`);
    const compactOriginalContent = this.compactForRevisionPrompt(originalContent);

    const revisionPrompt = `
You previously generated scene content that has some issues that need fixing.

## Original Content
${JSON.stringify(compactOriginalContent, null, 2)}

## Issues to Fix
${issues.map((issue, i) => `${i + 1}. ${issue}`).join('\n\n')}${input.sceneBlueprint.realizationTasks?.some((task) => task.ownerStage === 'scene_writer') ? `

## Immutable Realization Envelope
The revision must preserve every meaning already present and must not remove, reassign, summarize, or change the actor of any required atom. Forbidden atoms remain forbidden even when their wording would make another requirement easier.
${JSON.stringify((input.sceneBlueprint.realizationTasks ?? [])
  .filter((task) => task.ownerStage === 'scene_writer')
  .map((task) => ({
    taskId: task.id,
    target: describeNarrativeEvidenceTarget(task.target),
    atoms: task.evidenceAtoms.map(compactPatchAtom),
  })))}` : ''}

## Instructions
Please revise the content to fix these issues. Return the COMPLETE revised scene content as valid JSON.

Key requirements:
- Each beat must stay under cap: 4 sentences, ${TEXT_LIMITS.maxBeatWordCount} words (climax: ${TEXT_LIMITS.maxClimaxBeatWordCount}, key: ${TEXT_LIMITS.maxKeyStoryBeatWordCount})
- Hard response budget: the entire JSON response must be under ${SCENE_WRITER_MAX_REVISION_RESPONSE_CHARS} characters. Use concise prose, omit optional empty arrays/boilerplate, and do not duplicate base beat text in textVariants.
- If an issue says OVERLONG, rewrite that beat from the scene blueprint and nearby context. Do not copy generation notes, placeholders, schema examples, or compacted excerpt markers into the revised JSON.
- Preserve existing beat IDs, choice-point flags, visual contract fields, thread IDs, callback IDs, and nextBeatId navigation unless a listed issue explicitly requires splitting or relinking beats${input.sceneBlueprint.realizationTasks?.some((task) => task.ownerStage === 'scene_writer') ? '; also preserve claimed event IDs and event-evidence claims' : ''}
- For POV clarity issues, rewrite only prose/textVariants needed to anchor the first non-empty beat to the player character with you/your, the protagonist's actual name, or a concrete pronoun.
- If a beat is too long, split it into multiple beats
- Maintain the narrative flow when splitting
- Keep beat IDs logical (beat-1, beat-2, etc.)
- Update nextBeatId references to maintain the chain
- If splitting the last beat, ensure the final beat has no nextBeatId (it ends the scene or leads to choices)

Return ONLY valid JSON matching the SceneContent schema.
`;

    try {
      const response = await this.callLLM(
        [{ role: 'user', content: revisionPrompt }],
        4,
        { jsonSchema: buildSceneContentJsonSchema(input.targetBeatCount) },
      );

      console.log(`[SceneWriter] Received revision (${response.length} chars)`);

      if (response.length > SCENE_WRITER_MAX_REVISION_RESPONSE_CHARS * 2) {
        return {
          success: false,
          error: `SceneWriter revision exceeded raw processing budget (${response.length} > ${SCENE_WRITER_MAX_REVISION_RESPONSE_CHARS * 2} chars). Retry with concise beat prose, no boilerplate fields, and only meaningful textVariants.`,
          rawResponse: response.slice(0, 1000),
        };
      }
      if (response.length > SCENE_WRITER_MAX_REVISION_RESPONSE_CHARS) {
        // Soft budget: a parseable response a few percent over is not worth an
        // episode abort — beat-level caps police prose bloat downstream.
        console.warn(`[SceneWriter] Revision over soft budget (${response.length} > ${SCENE_WRITER_MAX_REVISION_RESPONSE_CHARS} chars); accepting if parseable.`);
      }

      let revisedContent: SceneContent;
      try {
        revisedContent = this.parseJSON<SceneContent>(response);
      } catch (parseError) {
        console.error(`[SceneWriter] Revision JSON parse failed, using original content`);

        if (this.hasOverlongProcessingMarker(originalContent)) {
          return {
            success: false,
            error: 'SceneWriter revision failed after overlong beat text; refusing to accept bounded/generated-note content.',
          };
        }

        // Check if original content has missing isChoicePoint - pipeline will apply fallback
        if (input.sceneBlueprint.choicePoint) {
          const hasChoicePoint = originalContent.beats?.some(b => b.isChoicePoint);
          if (!hasChoicePoint) {
            console.warn(`[SceneWriter] Original content missing isChoicePoint - pipeline fallback will auto-mark last beat`);
          }
        }

        const originalHardIssues = this.collectIssues(originalContent, input)
          .filter((issue) => this.isHardPostRevisionIssue(issue));
        if (originalHardIssues.length > 0) {
          return {
            success: false,
            error: `SceneWriter revision unparseable and original content has ${originalHardIssues.length} hard issue(s): ${originalHardIssues.slice(0, 5).join(' | ')}`,
          };
        }

        return {
          success: true,
          data: originalContent,
          rawResponse: response,
        };
      }

      // Normalize and validate
      revisedContent = this.normalizeContent(revisedContent, input);
      revisedContent = this.boundOverlongContentForProcessing(revisedContent);

      // Preserve original IDs if revision changed them incorrectly
      revisedContent.sceneId = originalContent.sceneId;
      revisedContent.sceneName = originalContent.sceneName;

      console.log(`[SceneWriter] Revision complete: ${revisedContent.beats?.length || 0} beats (was ${originalContent.beats?.length || 0})`);

      const remainingIssues = this.collectIssues(revisedContent, input);
      const hardRemainingIssues = remainingIssues.filter((issue) => this.isHardPostRevisionIssue(issue));
      if (hardRemainingIssues.length > 0) {
        return {
          success: false,
          error: `SceneWriter revision still has ${hardRemainingIssues.length} hard issue(s): ${hardRemainingIssues.slice(0, 5).join(' | ')}`,
        };
      }

      // Validate (but don't retry again)
      this.validateContent(revisedContent, input);

      if (this.hasOverlongProcessingMarker(revisedContent)) {
        return {
          success: false,
          error: 'SceneWriter revision still contains overlong beat text.',
        };
      }

      return {
        success: true,
        data: this.stripInternalProcessingMarkers(revisedContent),
        rawResponse: response,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[SceneWriter] Revision failed: ${errorMsg}, checking whether original content is safe to use`);

      if (this.hasOverlongProcessingMarker(originalContent)) {
        return {
          success: false,
          error: `SceneWriter revision failed after overlong beat text: ${errorMsg}`,
        };
      }

      // Check if original content has missing isChoicePoint - pipeline will apply fallback
      if (input.sceneBlueprint.choicePoint) {
        const hasChoicePoint = originalContent.beats?.some(b => b.isChoicePoint);
        if (!hasChoicePoint) {
          console.warn(`[SceneWriter] Original content missing isChoicePoint - pipeline fallback will auto-mark last beat`);
        }
      }

      try {
        this.validatePreEncounterHandoff(originalContent, input);
      } catch (originalError) {
        const originalErrorMsg = originalError instanceof Error ? originalError.message : String(originalError);
        return {
          success: false,
          error: originalErrorMsg,
        };
      }

      const fallbackHardIssues = this.collectIssues(originalContent, input)
        .filter((issue) => this.isHardPostRevisionIssue(issue));
      if (fallbackHardIssues.length > 0) {
        return {
          success: false,
          error: `SceneWriter revision failed and original content has ${fallbackHardIssues.length} hard issue(s): ${fallbackHardIssues.slice(0, 5).join(' | ')}`,
        };
      }

      // Return original content if revision fails
      // Note: Pipeline has fallback to auto-mark isChoicePoint if missing
      return {
        success: true,
        data: originalContent,
        rawResponse: '',
      };
    }
  }
}
