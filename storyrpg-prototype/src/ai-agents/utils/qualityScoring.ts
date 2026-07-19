import type { Story } from '../../types';
import { STORY_CIRCLE_BEATS, type StoryCircleBeat, type StoryCircleStructure } from '../../types/sourceAnalysis';
import type { ComprehensiveValidationReport } from '../../types/validation';
import type { QAReport } from '../agents/QAAgents';
import type {
  FinalStoryContractIssue,
  FinalStoryContractReport,
} from '../validators/FinalStoryContractValidator';
import type { QualityCouncilCheckpointReport, QualityCouncilReport } from '../quality-council/types';
import { lookupQualityDomainTag } from './qualityDomainTags';
import { storyCircleRoleBeats } from './storyCircleDistribution';

export type QualityDomainId =
  | 'story_circle_spine'
  | 'dramatic_structure_architecture'
  | 'prose_craft'
  | 'scene_coherence_prose_continuity'
  | 'choice_agency'
  | 'branching_consequence_memory'
  | 'character_npc_relationship_quality'
  | 'gameplay_mechanics_as_fiction'
  | 'encounters';

export type QualitySeverity = 'critical' | 'error' | 'warning' | 'suggestion';

export interface QualityFinding {
  id: string;
  severity: QualitySeverity;
  source: string;
  validator?: string;
  message: string;
  location?: string;
  mappedDomain?: QualityDomainId;
  conceptId?: string;
}

export interface QualityConceptScore {
  id: string;
  label: string;
  weight: number;
  score: number;
  criticalMisses: number;
  errors: number;
  warnings: number;
  suggestions: number;
  findings: QualityFinding[];
  /** Graded base score from an LLM judge (replaces the implicit 100 base). */
  gradedScore?: number;
  /** One-line judge evidence for the graded score. */
  gradedEvidence?: string;
  /**
   * Judge-only concepts are excluded from the domain average unless a judge
   * actually graded them or a finding landed on them — "no signal" must not
   * silently score 100.
   */
  judgeOnly?: boolean;
}

/** A graded 0-100 concept score produced by an LLM judge (prose craft, responsiveness). */
export interface GradedConceptScore {
  domainId: QualityDomainId;
  conceptId: string;
  score: number;
  evidence?: string;
  source: string;
}

export interface QualityDomainScore {
  id: QualityDomainId;
  label: string;
  weight: number;
  active: boolean;
  score: number;
  criticalMisses: number;
  errors: number;
  warnings: number;
  suggestions: number;
  evidence: string[];
  missingEvidence: string[];
  findings: QualityFinding[];
  concepts: QualityConceptScore[];
}

export interface QualityCap {
  id: string;
  maxScore: number;
  reason: string;
  domainId?: QualityDomainId;
}

export interface QualityEligibility {
  eligibleFor90: boolean;
  blockingReasons: string[];
  capsApplied: QualityCap[];
}

export const QUALITY_REPAIR_THRESHOLDS = {
  proseCraft: 70,
  responsiveness: 70,
} as const;

export interface QualityRepairTarget {
  kind: 'scene_prose' | 'route_pair';
  component: 'prose_craft' | 'responsiveness';
  threshold: number;
  actualScore: number;
  reason: string;
  sceneIds: string[];
  probeIds: string[];
}

export interface StoryCircleBeatEvidence {
  beat: StoryCircleBeat;
  status: 'realized' | 'metadata-only' | 'missing';
  expected: string[];
  evidence: string[];
  firstEpisodeIndex?: number;
  firstSceneIndex?: number;
}

export interface StoryCircleQualityScoreBasis {
  version: 4;
  profile: 'authored-treatment' | 'freeform';
  /** The sole run-level publishability score. Legacy report scores are diagnostics only. */
  publishabilityScore: number;
  rawScore: number;
  finalScore: number;
  evidenceCoverage: number;
  caps: QualityCap[];
  qualityEligibility: QualityEligibility;
  domains: QualityDomainScore[];
  storyCircle: {
    beats: Record<StoryCircleBeat, StoryCircleBeatEvidence>;
    missingBeats: StoryCircleBeat[];
    metadataOnlyBeats: StoryCircleBeat[];
    ordered: boolean;
  };
  legacySubscores: {
    qaScore?: number;
    validationScore?: number;
    finalStoryContractScore?: number;
  };
  repairTargets: QualityRepairTarget[];
  unmappedFindings: QualityFinding[];
  penalties: string[];
}

export interface StoryCircleQualityScoreReport extends StoryCircleQualityScoreBasis {
  generatedAt: string;
  formula: {
    rawQualityScore: string;
    domainScore: string;
    conceptScore: string;
    finalQualityScore: string;
  };
  scoringNotes: string[];
  /** G9 evidence sync: hash of the packaged episodes this score describes. */
  candidateStoryHash?: string;
  /** G9 evidence sync: staleness stamp inherited from the QA report the score consumed. */
  qaEvidence?: import('./qaEvidenceStamp').QaEvidenceStamp;
  /**
   * D2: state divergence (deterministic — flags/consequences the ENGINE
   * tracks) and perceptible divergence (judge-graded — what a READER feels)
   * are different measurements. Both are reported; neither substitutes for
   * the other. A run can be rich in state and cosmetic on the page.
   */
  divergenceReport?: {
    state: {
      totalChoices: number;
      choicesWithConsequences: number;
      note: string;
    };
    perceptible: {
      responsivenessScore?: number;
      choiceReflectedInProse?: number;
      npcReactsToPlayerChoice?: number;
      note: string;
    };
  };
}

export interface StoryCircleQualityScoreResult {
  score: number;
  basis: StoryCircleQualityScoreBasis;
  report: StoryCircleQualityScoreReport;
}

export interface StoryCircleQualityScoreInputs {
  brief?: Record<string, any>;
  finalStory?: Story | null;
  qaReport?: QAReport | null;
  bestPracticesReport?: ComprehensiveValidationReport | null;
  finalStoryContractReport?: FinalStoryContractReport | null;
  qualityCouncilReport?: QualityCouncilReport | null;
  incrementalValidationResults?: unknown[] | null;
}

export interface StoryCircleQualityScoreOptions {
  outputDir?: string;
  now?: Date;
  weightsMarkdownPath?: string;
}

type ConceptAccumulator = Omit<QualityConceptScore, 'score'>;
type DomainAccumulator = Omit<QualityDomainScore, 'score' | 'concepts'> & {
  concepts: Record<string, ConceptAccumulator>;
  defaultConceptId: string;
  requiresEvidence?: boolean;
};

interface StoryCircleEvidenceSummary {
  beats: Record<StoryCircleBeat, StoryCircleBeatEvidence>;
  missingBeats: StoryCircleBeat[];
  metadataOnlyBeats: StoryCircleBeat[];
  ordered: boolean;
  orderedViolation?: string;
  hasStoryCircleEvidence: boolean;
}

interface StoryCircleEvidenceScope {
  partialSeason: boolean;
  generatedEpisodeNumbers?: Set<number>;
}

interface FinalProseSegment {
  text: string;
  episodeIndex: number;
  sceneIndex: number;
}

interface StaticStorySignals {
  finalStoryPresent: boolean;
  sceneCount: number;
  beatCount: number;
  majorScenesWithoutTurn: number;
  totalChoices: number;
  meaningfulChoices: number;
  choicesWithConsequences: number;
  leakage: QualityFinding[];
  repeatedOrCentralLeakage: boolean;
  invalidEncounterTargets: string[];
  cosmeticBranching: boolean;
}

interface SidecarFinding {
  severity: QualitySeverity;
  source: string;
  validator?: string;
  message: string;
  location?: string;
  disposition?: 'blocking' | 'confirmed' | 'refuted' | 'uncorroborated';
  /** Explicit routing set by the producer; wins over the keyword fallback. */
  domainId?: QualityDomainId;
  conceptId?: string;
}

interface QualityConceptDefinition {
  id: string;
  label: string;
  weight: number;
  keywords?: string[];
  /** Excluded from the domain average unless graded by a judge or hit by a finding. */
  judgeOnly?: boolean;
}

interface QualityDomainDefinition {
  id: QualityDomainId;
  label: string;
  weight: number;
  defaultConceptId: string;
  concepts: QualityConceptDefinition[];
  /**
   * Domain only participates in the weighted average when it has evidence
   * (graded judge scores or findings). Prevents a judge-fed domain from
   * scoring a free 100 on runs where the judge never ran.
   */
  requiresEvidence?: boolean;
}

/**
 * v4 weights map the four product pillars:
 *   well told   = story_circle_spine 15 + dramatic_structure 15  = 30
 *   well written = prose_craft 15 + scene_coherence 10           = 25
 *   agency       = choice_agency 18 + mechanics 5 + encounters 2 = 25
 *   responsive   = branching 12 + character/NPC 8                = 20
 */
const DEFAULT_DOMAIN_DEFINITIONS: QualityDomainDefinition[] = [
  {
    id: 'story_circle_spine',
    label: 'Story Circle spine',
    weight: 15,
    defaultConceptId: 'complete_loop',
    concepts: [
      { id: 'complete_loop', label: 'Complete you -> need -> go -> search -> find -> take -> return -> change loop', weight: 16, keywords: ['complete loop', 'primary story circle beat', 'missing primary', 'episode local loop', 'episodecircle', 'episode circle'] },
      { id: 'beat_order_causal_progression', label: 'Beat order and causal progression', weight: 14, keywords: ['order', 'causal', 'chronology', 'out of order'] },
      { id: 'you_known_world_pressure', label: 'you: known-world pressure', weight: 9, keywords: ['you', 'known-world', 'baseline'] },
      { id: 'need_active_want_lack', label: 'need: active want/lack', weight: 10, keywords: ['need', 'want', 'lack'] },
      { id: 'go_threshold_crossing', label: 'go: threshold crossing', weight: 10, keywords: ['go', 'threshold'] },
      { id: 'search_adaptation_pressure', label: 'search: adaptation under pressure', weight: 11, keywords: ['search', 'adaptation'] },
      { id: 'find_apparent_victory', label: 'find: wanted thing / answer / apparent victory', weight: 10, keywords: ['find', 'answer', 'apparent victory'] },
      { id: 'take_real_price', label: 'take: real price / loss / sacrifice', weight: 12, keywords: ['take', 'price', 'loss', 'sacrifice'] },
      { id: 'return_prize_wound', label: 'return: prize and wound carried back', weight: 8, keywords: ['return', 'prize', 'wound', 'handoff', 'aftermath'] },
      { id: 'change_transformation_equilibrium', label: 'change: transformation / new equilibrium', weight: 10, keywords: ['change', 'transformation', 'equilibrium', 'metadata-only', 'not dramatized'] },
    ],
  },
  {
    id: 'dramatic_structure_architecture',
    label: 'Dramatic structure / season story architecture',
    weight: 15,
    defaultConceptId: 'season_dramatic_question',
    concepts: [
      { id: 'season_dramatic_question', label: 'Season dramatic question / central promise', weight: 18, keywords: ['dramatic question', 'central promise', 'seasonpromise', 'source fidelity', 'authored'] },
      { id: 'stakes_escalation', label: 'Stakes escalation', weight: 16, keywords: ['stakes', 'escalation', 'stakestriangle'] },
      { id: 'scene_to_scene_causality', label: 'Scene-to-scene causal progression', weight: 15, keywords: ['causal progression', 'scene-to-scene'] },
      { id: 'setup_payoff_architecture', label: 'Setup/payoff architecture', weight: 14, keywords: ['setup_payoff', 'setup', 'payoff', 'promise ledger'] },
      { id: 'arc_pressure_reversals_turns', label: 'Arc pressure / reversals / turns', weight: 12, keywords: ['arcpressure', 'arc pressure', 'reversal', 'turn'] },
      { id: 'climax_resolution_payoff', label: 'Climax and resolution payoff', weight: 12, keywords: ['climax', 'resolution'] },
      { id: 'information_reveal_control', label: 'Information/reveal control', weight: 6, keywords: ['informationledger', 'information ledger', 'reveal'] },
      { id: 'cold_opens_cliffhangers', label: 'Cold opens and cliffhangers', weight: 5, keywords: ['cold open', 'cliffhanger'] },
      { id: 'theme_pressure', label: 'Theme pressure', weight: 2, keywords: ['theme'] },
    ],
  },
  {
    id: 'prose_craft',
    label: 'Prose craft',
    weight: 15,
    defaultConceptId: 'sentence_craft',
    requiresEvidence: true,
    concepts: [
      { id: 'sentence_craft', label: 'Sentence craft', weight: 20, judgeOnly: true, keywords: ['sentence craft', 'clumsy sentence', 'awkward phrasing'] },
      { id: 'specificity_show_dont_tell', label: 'Specificity / show-don\'t-tell', weight: 20, judgeOnly: true, keywords: ['show don', 'generic description', 'abstract summary', 'specificity'] },
      { id: 'filler_density', label: 'Filler density', weight: 18, judgeOnly: true, keywords: ['filler', 'padding', 'stub', 'scaffold text', 'outcome text', 'outcometextquality'] },
      { id: 'rhythm_pacing', label: 'Rhythm and pacing', weight: 14, judgeOnly: true, keywords: ['monotony', 'opener', 'sentenceopener', 'repetitive rhythm', 'intensity_distribution', 'intensity distribution'] },
      { id: 'dialogue_naturalness', label: 'Dialogue naturalness', weight: 14, judgeOnly: true, keywords: ['stilted dialogue', 'unnatural dialogue', 'on-the-nose'] },
      { id: 'voice_style_consistency', label: 'Narrative voice / style consistency', weight: 14, judgeOnly: true, keywords: ['narrative voice', 'style drift', 'register shift'] },
      // B2/G7: judge-only, never capping — a low grade lowers the domain
      // average via the normalized weight formula and nothing else.
      { id: 'tone_lens_fidelity', label: 'Tone register / protagonist lens fidelity', weight: 14, judgeOnly: true, keywords: ['tone fidelity', 'tonal register', 'protagonist lens', 'perception lens'] },
    ],
  },
  {
    id: 'scene_coherence_prose_continuity',
    label: 'Scene coherence / prose continuity',
    weight: 10,
    defaultConceptId: 'scene_clear_dramatic_turn',
    concepts: [
      { id: 'scene_clear_dramatic_turn', label: 'Scene has a clear dramatic turn', weight: 20, keywords: ['sceneturn', 'scene turn', 'dramatic turn'] },
      { id: 'natural_coherent_scene_read', label: 'Scene reads naturally and coherently', weight: 18, keywords: ['scene coherence', 'coherent', 'natural'] },
      { id: 'no_out_of_place_story_concepts', label: 'No out-of-place story concepts', weight: 14, keywords: ['wrong scene', 'out-of-place', 'beat placement'] },
      { id: 'clean_transitions_continuity', label: 'Clean transitions and continuity', weight: 12, keywords: ['transition', 'continuity'] },
      { id: 'pov_clarity', label: 'POV clarity', weight: 10, keywords: ['povclarity', 'pov clarity'] },
      { id: 'concrete_on_page_realization', label: 'Concrete on-page realization', weight: 10, keywords: ['requiredbeat', 'beat realization', 'concrete', 'on-page'] },
      { id: 'tone_voice_consistency', label: 'Tone/voice consistency', weight: 8, keywords: ['tone', 'voice consistency'] },
      { id: 'no_planning_register_or_mechanics_leakage', label: 'No planning-register or mechanics leakage', weight: 8, keywords: ['planning-register', 'mechanics leakage', 'scaffolding', 'design note'] },
    ],
  },
  {
    id: 'choice_agency',
    label: 'Choice agency',
    weight: 18,
    defaultConceptId: 'meaningful_agency',
    concepts: [
      { id: 'meaningful_agency', label: 'Meaningful agency', weight: 22, keywords: ['meaningful agency', 'no player choice', 'choice surface'] },
      { id: 'want_cost_identity', label: 'Want / cost / identity', weight: 18, keywords: ['want', 'cost', 'identity'] },
      { id: 'choice_affects_story_state', label: 'Choice affects outcome, process, information, relationship, or identity', weight: 16, keywords: ['outcome', 'process', 'information', 'relationship', 'identity', 'state evidence'] },
      { id: 'choice_from_scene_pressure', label: 'Choice arises naturally from scene pressure', weight: 14, keywords: ['scene pressure', 'pressure'] },
      { id: 'dilemmas', label: 'Dilemmas', weight: 10, keywords: ['dilemma'] },
      { id: 'strategic_choices', label: 'Strategic choices', weight: 7, keywords: ['strategic'] },
      { id: 'relationship_choices', label: 'Relationship choices', weight: 7, keywords: ['relationship choice'] },
      { id: 'expression_choices', label: 'Expression choices', weight: 4, keywords: ['expression choice'] },
      { id: 'distribution_percentages', label: 'Distribution percentages', weight: 2, keywords: ['distribution', 'percentage'] },
    ],
  },
  {
    id: 'branching_consequence_memory',
    label: 'Branching / consequence memory',
    weight: 12,
    defaultConceptId: 'branch_residue_survives',
    concepts: [
      { id: 'branch_residue_survives', label: 'Branch residue survives reconvergence', weight: 20, keywords: ['residue', 'reconvergence'] },
      { id: 'choice_reflected_in_prose', label: 'Choice consequences visible in downstream prose', weight: 15, judgeOnly: true, keywords: ['choice_reflected_in_prose', 'downstream prose', 'consequence not visible'] },
      { id: 'specific_remembered_consequences', label: 'Consequences are specific and remembered', weight: 17, keywords: ['consequence memory', 'specific consequence', 'remembered'] },
      { id: 'cross_episode_payoffs', label: 'Cross-episode payoffs', weight: 15, keywords: ['cross-episode', 'callback', 'payoff'] },
      { id: 'meaningfully_different_branches', label: 'Branches create meaningfully different experiences', weight: 14, keywords: ['divergence', 'different experience'] },
      { id: 'convergent_spine_intact', label: 'Convergent spine stays intact', weight: 10, keywords: ['convergent spine', 'reconverge'] },
      { id: 'ending_route_effects', label: 'Ending eligibility / route effects', weight: 8, keywords: ['endingreachability', 'ending eligibility', 'route effect'] },
      { id: 'failure_recovery', label: 'Failure recovery', weight: 6, keywords: ['failure recovery'] },
      { id: 'branch_graph_correctness', label: 'Branch graph correctness', weight: 6, keywords: ['branch graph', 'scenegraphbranch'] },
      { id: 'branch_cap_telemetry', label: 'Branch cap telemetry', weight: 4, keywords: ['branch cap', 'cap telemetry'] },
    ],
  },
  {
    id: 'character_npc_relationship_quality',
    label: 'Character / NPC / relationship quality',
    weight: 8,
    defaultConceptId: 'protagonist_want_need_lie_truth',
    concepts: [
      { id: 'protagonist_want_need_lie_truth', label: 'Protagonist want / need / lie / truth', weight: 20, keywords: ['protagonist', 'want', 'need', 'lie', 'truth'] },
      { id: 'npc_reacts_to_player_choice', label: 'NPCs react to player choices', weight: 15, judgeOnly: true, keywords: ['npc_reacts_to_player_choice', 'npc does not react', 'static npc'] },
      { id: 'character_change_pressure', label: 'Character change under pressure', weight: 18, keywords: ['character change', 'arcdelta', 'arc_delta'] },
      { id: 'npc_desire_pressure_function', label: 'NPCs have clear desire, pressure, and function', weight: 14, keywords: ['npc', 'desire', 'function'] },
      { id: 'relationship_pacing_earned', label: 'Relationship pacing is earned', weight: 12, keywords: ['relationship pacing', 'earned'] },
      { id: 'relationship_payoffs_visible', label: 'Relationship payoffs are visible', weight: 10, keywords: ['relationship payoff'] },
      { id: 'supporting_characters_choice_pressure', label: 'Supporting characters create choice pressure', weight: 9, keywords: ['supporting character', 'choice pressure'] },
      { id: 'antagonist_opposition_pressure', label: 'Antagonist/opposition pressure', weight: 7, keywords: ['antagonist', 'opposition'] },
      { id: 'character_introductions', label: 'Character introductions', weight: 5, keywords: ['character introduction'] },
      { id: 'visual_identity_flavor', label: 'Visual identity / flavor', weight: 5, keywords: ['visual identity', 'flavor'] },
    ],
  },
  {
    id: 'gameplay_mechanics_as_fiction',
    label: 'Gameplay mechanics as fiction',
    weight: 5,
    defaultConceptId: 'fiction_first_presentation',
    concepts: [
      { id: 'fiction_first_presentation', label: 'Fiction-first presentation', weight: 22, keywords: ['fiction-first', 'mechanicsleakage', 'stat check', 'skill check', 'dc'] },
      { id: 'mechanics_create_story_pressure', label: 'Mechanics create story pressure', weight: 18, keywords: ['mechanicalstorytelling', 'narrativemechanicpressure', 'story pressure'] },
      { id: 'hidden_state_visible_residue', label: 'Hidden state produces visible residue', weight: 16, keywords: ['hidden state', 'visible residue'] },
      { id: 'skill_stat_surfaces_diegetic', label: 'Skill/stat surfaces feel diegetic', weight: 12, keywords: ['skill surface', 'diegetic', 'skillcoverage', 'statcheckbalance'] },
      { id: 'identity_state_matters', label: 'Identity state matters', weight: 10, keywords: ['identity state'] },
      { id: 'relationship_state_matters', label: 'Relationship state matters', weight: 10, keywords: ['relationship state'] },
      { id: 'flags_scores_tags_reliable', label: 'Flags/scores/tags are reliable', weight: 7, keywords: ['flagcontract', 'flag', 'score', 'tag'] },
      { id: 'inventory_items', label: 'Inventory/items', weight: 3, keywords: ['inventory', 'item'] },
      { id: 'numeric_balance', label: 'Numeric balance', weight: 2, keywords: ['numeric balance', 'balance'] },
    ],
  },
  {
    id: 'encounters',
    label: 'Encounters',
    weight: 2,
    defaultConceptId: 'encounter_story_pressure',
    concepts: [
      { id: 'encounter_story_pressure', label: 'Encounter as story pressure, not filler', weight: 17, keywords: ['encounter', 'story pressure', 'filler'] },
      { id: 'meaningful_outcome_states', label: 'Meaningful success / complicated / failure outcomes', weight: 15, keywords: ['success', 'complicated', 'failure outcome'] },
      { id: 'encounter_story_circle_target', label: 'Encounter Story Circle target', weight: 12, keywords: ['encounterstorycircletarget', 'story circle target'] },
      { id: 'cost_aftermath_consequence', label: 'Cost and aftermath consequence', weight: 11, keywords: ['aftermath', 'cost'] },
      { id: 'branching_outcome_quality', label: 'Branching outcome quality', weight: 10, keywords: ['branching outcome'] },
      { id: 'setup_context_prior_scenes', label: 'Setup context from prior scenes', weight: 9, keywords: ['setup context'] },
      { id: 'skill_approach_variety', label: 'Skill/approach variety', weight: 8, keywords: ['approach variety', 'skill'] },
      { id: 'clocks_tactical_structure', label: 'Clocks/tactical structure', weight: 6, keywords: ['clock', 'tactical'] },
      { id: 'environmental_elements', label: 'Environmental elements', weight: 5, keywords: ['environmental'] },
      { id: 'npc_dispositions_tells', label: 'NPC dispositions/tells', weight: 4, keywords: ['disposition', 'tell'] },
      { id: 'visual_encounter_staging', label: 'Visual encounter staging', weight: 3, keywords: ['visual encounter', 'staging'] },
    ],
  },
];

const STOPWORDS = new Set([
  'about',
  'after',
  'again',
  'against',
  'also',
  'because',
  'before',
  'being',
  'between',
  'could',
  'every',
  'from',
  'have',
  'into',
  'more',
  'must',
  'only',
  'over',
  'that',
  'their',
  'there',
  'they',
  'this',
  'through',
  'under',
  'when',
  'where',
  'which',
  'while',
  'with',
  'would',
  'your',
]);

const LEAKAGE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(?:stat|skill)\s+check\b/i, label: 'visible stat/skill check language' },
  { pattern: /\bDC\s*\d+\b/i, label: 'visible DC language' },
  { pattern: /\bdifficulty\s+class\b/i, label: 'visible difficulty class language' },
  { pattern: /\broll(?:ed|ing)?\s+(?:a|the)?\s*d(?:ice|20)\b/i, label: 'visible dice roll language' },
  { pattern: /\b(?:modifier|bonus|penalty)\s+(?:of\s+)?[+-]?\d+\b/i, label: 'visible modifier language' },
  { pattern: /\bsuccess\s+chance\b/i, label: 'visible success chance language' },
  { pattern: /\bfailure\s+chance\b/i, label: 'visible failure chance language' },
  { pattern: /\b(?:state flag|story flag|callbackHookId|branch residue|scene turn)\b/i, label: 'pipeline scaffolding language' },
  { pattern: /\bstory\s+circle\b/i, label: 'structural scaffolding language' },
  { pattern: /\bmechanic(?:s|al)?\s+(?:pressure|state|score|tag)\b/i, label: 'mechanics scaffolding language' },
];

export function deriveStoryCircleQualityScore(
  inputs: StoryCircleQualityScoreInputs,
  options: StoryCircleQualityScoreOptions = {},
): StoryCircleQualityScoreResult {
  const now = options.now ?? new Date();
  const profile = determineProfile(inputs.brief);
  const domainDefinitions = resolveDomainDefinitions(options.weightsMarkdownPath);
  const domains = createDomainAccumulators(domainDefinitions);
  const unmappedFindings: QualityFinding[] = [];
  const caps: QualityCap[] = [];
  const storyCircle = buildStoryCircleEvidence(inputs.finalStory, inputs.brief);
  const staticSignals = collectStaticStorySignals(inputs.finalStory);
  const sidecarFindings = readQualitySidecarFindings(options.outputDir);
  const collectedFindings = collectReportFindings(inputs, sidecarFindings);

  addStoryCircleFindings(domains, storyCircle);
  addStaticSignalFindings(domains, staticSignals);
  applyGradedConceptScores(domains, collectGradedConceptScores(inputs));
  collectedFindings.forEach((finding) => {
    const mappedDomain = mapFindingToDomain(finding);
    const qualityFinding = toQualityFinding(finding, mappedDomain);
    if (mappedDomain) {
      addFinding(domains[mappedDomain], qualityFinding);
    } else {
      unmappedFindings.push(qualityFinding);
    }
  });

  // Unmapped findings are routed INDIVIDUALLY (v3 collapsed any number of them
  // into one -7 warning, silently discarding their weight). Routing confidence
  // is low, so severity is dampened to warning — but each one still counts.
  unmappedFindings.forEach((finding) => {
    addFinding(domains.scene_coherence_prose_continuity, {
      ...finding,
      severity: finding.severity === 'critical' || finding.severity === 'error' ? 'warning' : finding.severity,
      mappedDomain: 'scene_coherence_prose_continuity',
      conceptId: 'natural_coherent_scene_read',
    });
  });

  const finalStoryContractScore = legacyFinalStoryContractScore(inputs.finalStoryContractReport);
  const legacySubscores = {
    qaScore: normalizeScore((inputs.qaReport as any)?.overallScore),
    validationScore: normalizeScore(inputs.bestPracticesReport?.overallScore),
    finalStoryContractScore,
  };

  applyCaps(caps, storyCircle, staticSignals, inputs, collectedFindings);
  const repairTargets = buildQualityRepairTargets(inputs);
  const evidenceCoverage = computeEvidenceCoverage(inputs, storyCircle, staticSignals, profile);
  if (evidenceCoverage < 75) {
    caps.push({
      id: 'evidence_coverage_below_75',
      maxScore: 69,
      reason: `Evidence coverage is ${evidenceCoverage}%, below the 75% floor.`,
    });
  } else if (evidenceCoverage < 90) {
    caps.push({
      id: 'evidence_coverage_below_90',
      maxScore: 79,
      reason: `Evidence coverage is ${evidenceCoverage}%, below the 90% high-confidence floor.`,
    });
  }

  const domainScores = Object.values(domains).map(finalizeDomainScore);
  const rawScore = weightedScore(domainScores);
  const cappedScore = applyScoreCaps(Math.round(rawScore), caps);
  const highScoreEligible = enforceAboveNinetyRequirements(cappedScore, caps, domainScores, storyCircle, staticSignals);
  const finalScore = highScoreEligible.score;
  highScoreEligible.addedCaps.forEach((cap) => caps.push(cap));
  const qualityEligibility = buildQualityEligibility(caps);

  const basis: StoryCircleQualityScoreBasis = {
    version: 4,
    profile,
    publishabilityScore: finalScore,
    rawScore,
    finalScore,
    evidenceCoverage,
    caps,
    qualityEligibility,
    domains: domainScores,
    storyCircle: {
      beats: storyCircle.beats,
      missingBeats: storyCircle.missingBeats,
      metadataOnlyBeats: storyCircle.metadataOnlyBeats,
      ordered: storyCircle.ordered,
    },
    legacySubscores,
    repairTargets,
    unmappedFindings,
    penalties: caps.map((cap) => `${cap.id}: ${cap.reason}`),
  };

  return {
    score: finalScore,
    basis,
    report: {
      ...basis,
      generatedAt: now.toISOString(),
      formula: {
        rawQualityScore: 'sum(domain.weight * domain.score) / sum(activeDomain.weight)',
        domainScore: 'sum(concept.weight * concept.score) / sum(activeConcept.weight); judge-only concepts inactive until graded or hit',
        conceptScore: 'clamp0to100((gradedScore ?? 100) - criticalMisses*25 - errors*18 - warnings*7 - suggestions*2)',
        finalQualityScore: 'applyCaps(round(rawQualityScore), caps)',
      },
      scoringNotes: [
        'Story Circle is the only structural scoring model.',
        'Legacy-structure fields are ignored; legacy-structure-only evidence receives no scoring credit.',
        'qaScore, validationScore, and finalStoryContractScore are retained only as diagnostics.',
        'v4: LLM judge grades (prose craft, responsiveness) set concept base scores; evidence-requiring domains are excluded from the average when their judge never ran.',
        'Publishability caps do not replace or weaken final-contract correctness gates; ungrounded judge findings remain advisory.',
        'D2: divergenceReport separates engine-tracked STATE divergence from judge-graded PERCEPTIBLE divergence; a run can be rich in state and cosmetic on the page.',
      ],
      divergenceReport: buildDivergenceReport(staticSignals, inputs.qaReport as any),
    },
  };
}

/**
 * D2 (quality-gap 14-50-23): run 14-50-23 carried hundreds of state
 * fingerprints while the responsiveness judge read 62 — both true, different
 * measurements, previously conflated in review. Report them side by side.
 */
function buildDivergenceReport(
  signals: StaticStorySignals,
  qa: any,
): NonNullable<StoryCircleQualityScoreReport['divergenceReport']> {
  const conceptScore = (conceptId: string): number | undefined => {
    const entry = (qa?.responsiveness?.conceptScores ?? []).find((candidate: any) => candidate?.conceptId === conceptId);
    return normalizeScore(entry?.score);
  };
  return {
    state: {
      totalChoices: signals.totalChoices,
      choicesWithConsequences: signals.choicesWithConsequences,
      note: 'Deterministic: choices whose flags/consequences the engine tracks. Measures bookkeeping, not reader experience.',
    },
    perceptible: {
      responsivenessScore: normalizeScore(qa?.responsiveness?.overallScore),
      choiceReflectedInProse: conceptScore('choice_reflected_in_prose'),
      npcReactsToPlayerChoice: conceptScore('npc_reacts_to_player_choice'),
      note: 'Judge-graded: whether a reader would FEEL the divergence (prose reflects the choice; NPC behavior changes downstream). This is the number responsiveness caps read.',
    },
  };
}

function createDomainAccumulators(definitions: QualityDomainDefinition[]): Record<QualityDomainId, DomainAccumulator> {
  return definitions.reduce((acc, definition) => {
    acc[definition.id] = {
      id: definition.id,
      label: definition.label,
      weight: definition.weight,
      active: definition.weight > 0,
      criticalMisses: 0,
      errors: 0,
      warnings: 0,
      suggestions: 0,
      evidence: [],
      missingEvidence: [],
      findings: [],
      concepts: definition.concepts.reduce((conceptAcc, concept) => {
        conceptAcc[concept.id] = {
          id: concept.id,
          label: concept.label,
          weight: concept.weight,
          criticalMisses: 0,
          errors: 0,
          warnings: 0,
          suggestions: 0,
          findings: [],
          judgeOnly: concept.judgeOnly,
        };
        return conceptAcc;
      }, {} as Record<string, ConceptAccumulator>),
      defaultConceptId: definition.defaultConceptId,
      requiresEvidence: definition.requiresEvidence,
    };
    return acc;
  }, {} as Record<QualityDomainId, DomainAccumulator>);
}

const PROSE_CRAFT_CONCEPT_IDS = new Set([
  'sentence_craft',
  'specificity_show_dont_tell',
  'filler_density',
  'rhythm_pacing',
  'dialogue_naturalness',
  'voice_style_consistency',
  'tone_lens_fidelity',
]);

const RESPONSIVENESS_CONCEPT_DOMAINS: Record<string, QualityDomainId> = {
  choice_reflected_in_prose: 'branching_consequence_memory',
  npc_reacts_to_player_choice: 'character_npc_relationship_quality',
};

/**
 * Pull graded concept scores out of the QA report's judge sections
 * (ProseCraftJudge / ResponsivenessJudge, attached by QARunner). Judges SET
 * concept base scores instead of the implicit 100 — the fix for the
 * "no signal = perfect score" failure mode.
 */
function collectGradedConceptScores(inputs: StoryCircleQualityScoreInputs): GradedConceptScore[] {
  const graded: GradedConceptScore[] = [];
  const qa = inputs.qaReport as any;

  (qa?.proseCraft?.conceptScores ?? []).forEach((entry: any) => {
    const conceptId = String(entry?.conceptId ?? '');
    const score = normalizeScore(entry?.score);
    if (score === undefined || !PROSE_CRAFT_CONCEPT_IDS.has(conceptId)) return;
    graded.push({ domainId: 'prose_craft', conceptId, score, evidence: entry?.evidence, source: 'prose-craft-judge' });
  });

  (qa?.responsiveness?.conceptScores ?? []).forEach((entry: any) => {
    const conceptId = String(entry?.conceptId ?? '');
    const score = normalizeScore(entry?.score);
    const domainId = RESPONSIVENESS_CONCEPT_DOMAINS[conceptId];
    if (score === undefined || !domainId) return;
    graded.push({ domainId, conceptId, score, evidence: entry?.evidence, source: 'responsiveness-judge' });
  });

  return graded;
}

function applyGradedConceptScores(
  domains: Record<QualityDomainId, DomainAccumulator>,
  graded: GradedConceptScore[],
): void {
  graded.forEach((grade) => {
    const concept = domains[grade.domainId]?.concepts[grade.conceptId];
    if (!concept) return;
    // Multiple grades for one concept (multi-episode QA merges): keep the lowest —
    // a story reads as weak as its weakest graded stretch.
    if (concept.gradedScore === undefined || grade.score < concept.gradedScore) {
      concept.gradedScore = grade.score;
      concept.gradedEvidence = grade.evidence;
    }
    domains[grade.domainId].evidence.push(
      `${grade.source} graded ${grade.conceptId}: ${grade.score}${grade.evidence ? ` (${trimForEvidence(grade.evidence)})` : ''}`,
    );
  });
}

function resolveDomainDefinitions(weightsMarkdownPath?: string): QualityDomainDefinition[] {
  const definitions = cloneDomainDefinitions(DEFAULT_DOMAIN_DEFINITIONS);
  const overrides = readWeightOverrides(weightsMarkdownPath);
  if (!overrides) {
    return definitions;
  }

  definitions.forEach((domain) => {
    const domainWeight = overrides.domainWeights.get(normalizeWeightLabel(domain.label));
    if (typeof domainWeight === 'number') {
      domain.weight = domainWeight;
    }
    const conceptOverrides = overrides.conceptWeights.get(normalizeWeightLabel(domain.label));
    if (!conceptOverrides) {
      return;
    }
    domain.concepts.forEach((concept) => {
      const conceptWeight = conceptOverrides.get(normalizeWeightLabel(concept.label));
      if (typeof conceptWeight === 'number') {
        concept.weight = conceptWeight;
      }
    });
  });

  return definitions;
}

function cloneDomainDefinitions(definitions: QualityDomainDefinition[]): QualityDomainDefinition[] {
  return definitions.map((domain) => ({
    ...domain,
    concepts: domain.concepts.map((concept) => ({ ...concept, keywords: [...(concept.keywords ?? [])] })),
  }));
}

function determineProfile(brief?: Record<string, any>): 'authored-treatment' | 'freeform' {
  if (!brief) {
    return 'freeform';
  }
  const sourceAnalysis = brief.multiEpisode?.sourceAnalysis;
  const hasTreatmentSource =
    typeof brief.rawDocument === 'string' && brief.rawDocument.trim().length > 0;
  const sourceFormat = sourceAnalysis?.sourceFormat ?? brief.sourceFormat;
  const hasTreatmentArtifacts =
    hasTreatmentSource ||
    sourceFormat === 'treatment' ||
    sourceFormat === 'document' ||
    Boolean(brief.treatment) ||
    Boolean(sourceAnalysis?.treatmentObligations) ||
    Boolean(brief.seasonPlan?.treatmentObligations);
  return hasTreatmentArtifacts ? 'authored-treatment' : 'freeform';
}

function addStoryCircleFindings(
  domains: Record<QualityDomainId, DomainAccumulator>,
  storyCircle: StoryCircleEvidenceSummary,
): void {
  // Only score beats that are in-scope for this package. Partial-season runs
  // already scope missingBeats / metadataOnlyBeats to active episode roles;
  // later-season beats stay "missing" in the raw map but must not emit findings.
  const inScope = new Set<StoryCircleBeat>([
    ...storyCircle.missingBeats,
    ...storyCircle.metadataOnlyBeats,
    ...STORY_CIRCLE_BEATS.filter((beat) => storyCircle.beats[beat]?.status === 'realized'),
  ]);
  // Full-season fallback: if nothing was scoped (no brief roles), keep legacy behavior.
  const beatsToScore = inScope.size > 0 ? [...inScope] : STORY_CIRCLE_BEATS;

  beatsToScore.forEach((beat) => {
    const beatEvidence = storyCircle.beats[beat];
    if (beatEvidence.status === 'realized') {
      domains.story_circle_spine.evidence.push(`${beat}: ${beatEvidence.evidence[0] ?? 'realized on-page'}`);
      return;
    }

    if (beatEvidence.status === 'metadata-only') {
      addFinding(domains.story_circle_spine, {
        id: makeFindingId('story-circle', `${beat}-metadata-only`, 'error'),
        severity: beat === 'take' || beat === 'change' ? 'critical' : 'error',
        source: 'story-circle',
        validator: 'QualityScoreV3',
        message: `Story Circle beat "${beat}" is labeled in metadata but not proven in final prose.`,
        mappedDomain: 'story_circle_spine',
        conceptId: storyCircleConceptId(beat),
      });
      return;
    }

    addFinding(domains.story_circle_spine, {
      id: makeFindingId('story-circle', `${beat}-missing`, 'critical'),
      severity: 'critical',
      source: 'story-circle',
      validator: 'QualityScoreV3',
      message: `Primary Story Circle beat "${beat}" is missing from final scoring evidence.`,
      mappedDomain: 'story_circle_spine',
      conceptId: storyCircleConceptId(beat),
    });
  });

  if (storyCircle.missingBeats.length > 0) {
    addFinding(domains.story_circle_spine, {
      id: makeFindingId('story-circle', 'complete-loop-missing-beats', 'critical'),
      severity: 'critical',
      source: 'story-circle',
      validator: 'QualityScoreV3',
      message: `Story Circle loop is incomplete: ${storyCircle.missingBeats.join(', ')} missing.`,
      mappedDomain: 'story_circle_spine',
      conceptId: 'complete_loop',
    });
  } else if (storyCircle.metadataOnlyBeats.length > 0) {
    addFinding(domains.story_circle_spine, {
      id: makeFindingId('story-circle', 'complete-loop-metadata-only', 'error'),
      severity: 'error',
      source: 'story-circle',
      validator: 'QualityScoreV3',
      message: `Story Circle loop has metadata-only beat(s): ${storyCircle.metadataOnlyBeats.join(', ')}.`,
      mappedDomain: 'story_circle_spine',
      conceptId: 'complete_loop',
    });
  }

  if (!storyCircle.ordered) {
    addFinding(domains.story_circle_spine, {
      id: makeFindingId('story-circle', 'beat-order', 'critical'),
      severity: 'critical',
      source: 'story-circle',
      validator: 'QualityScoreV3',
      message: storyCircle.orderedViolation ?? 'Story Circle beats are materially out of order.',
      mappedDomain: 'story_circle_spine',
      conceptId: 'beat_order_causal_progression',
    });
  }

  if (!storyCircle.hasStoryCircleEvidence) {
    domains.story_circle_spine.missingEvidence.push('No final Story Circle beat evidence was found.');
  }
}

function addStaticSignalFindings(
  domains: Record<QualityDomainId, DomainAccumulator>,
  signals: StaticStorySignals,
): void {
  if (!signals.finalStoryPresent) {
    addFinding(domains.scene_coherence_prose_continuity, {
      id: makeFindingId('story', 'missing-final-story', 'critical'),
      severity: 'critical',
      source: 'story',
      validator: 'QualityScoreV3',
      message: 'No final playable story content was available for scoring.',
      mappedDomain: 'scene_coherence_prose_continuity',
      conceptId: 'natural_coherent_scene_read',
    });
    return;
  }

  if (signals.sceneCount === 0 || signals.beatCount === 0) {
    addFinding(domains.scene_coherence_prose_continuity, {
      id: makeFindingId('story', 'missing-scene-beat-content', 'critical'),
      severity: 'critical',
      source: 'story',
      validator: 'QualityScoreV3',
      message: 'Final story lacks playable scene/beat content.',
      mappedDomain: 'scene_coherence_prose_continuity',
      conceptId: 'concrete_on_page_realization',
    });
  } else {
    domains.scene_coherence_prose_continuity.evidence.push(`${signals.sceneCount} scene(s) and ${signals.beatCount} beat(s) available for final-content scoring.`);
  }

  if (signals.majorScenesWithoutTurn > 1) {
    addFinding(domains.scene_coherence_prose_continuity, {
      id: makeFindingId('scene-turn', 'multiple-scenes-without-turn', 'error'),
      severity: 'error',
      source: 'scene-turn',
      validator: 'QualityScoreV3',
      message: `${signals.majorScenesWithoutTurn} major scenes lack realized scene-turn evidence.`,
      mappedDomain: 'scene_coherence_prose_continuity',
      conceptId: 'scene_clear_dramatic_turn',
    });
  } else if (signals.majorScenesWithoutTurn === 1) {
    addFinding(domains.scene_coherence_prose_continuity, {
      id: makeFindingId('scene-turn', 'one-scene-without-turn', 'warning'),
      severity: 'warning',
      source: 'scene-turn',
      validator: 'QualityScoreV3',
      message: 'One major scene lacks realized scene-turn evidence.',
      mappedDomain: 'scene_coherence_prose_continuity',
      conceptId: 'scene_clear_dramatic_turn',
    });
  }

  if (signals.totalChoices === 0) {
    addFinding(domains.choice_agency, {
      id: makeFindingId('agency', 'no-player-choices', 'critical'),
      severity: 'critical',
      source: 'agency',
      validator: 'QualityScoreV3',
      message: 'Final story contains no player choice surface.',
      mappedDomain: 'choice_agency',
      conceptId: 'meaningful_agency',
    });
  } else {
    domains.choice_agency.evidence.push(`${signals.meaningfulChoices}/${signals.totalChoices} choice(s) carry route, consequence, check, or state evidence.`);
    if (signals.meaningfulChoices === 0) {
      addFinding(domains.choice_agency, {
        id: makeFindingId('agency', 'cosmetic-choices', 'error'),
        severity: 'error',
        source: 'agency',
        validator: 'QualityScoreV3',
        message: 'Player choices are present but appear cosmetic or residue-free.',
        mappedDomain: 'choice_agency',
        conceptId: 'meaningful_agency',
      });
    }
  }

  if (signals.totalChoices > 0 && signals.choicesWithConsequences === 0) {
    addFinding(domains.branching_consequence_memory, {
      id: makeFindingId('mechanics-memory', 'missing-choice-consequence-memory', 'warning'),
      severity: 'warning',
      source: 'mechanics-memory',
      validator: 'QualityScoreV3',
      message: 'Choice surface lacks explicit consequence or memory evidence.',
      mappedDomain: 'branching_consequence_memory',
      conceptId: 'specific_remembered_consequences',
    });
  } else if (signals.choicesWithConsequences > 0) {
    domains.branching_consequence_memory.evidence.push(`${signals.choicesWithConsequences} choice(s) carry consequence or memory evidence.`);
  }

  signals.leakage.forEach((finding) => addFinding(domains.gameplay_mechanics_as_fiction, finding));

  signals.invalidEncounterTargets.forEach((target) => {
    const message = `Central encounter Story Circle target "${target}" does not match go/search/find/take.`;
    addFinding(domains.encounters, {
      id: makeFindingId('encounter-story-circle-target', target, 'error'),
      severity: 'error',
      source: 'encounter-story-circle-target',
      validator: 'QualityScoreV3',
      message,
      mappedDomain: 'encounters',
      conceptId: 'encounter_story_circle_target',
    });
    addFinding(domains.story_circle_spine, {
      id: makeFindingId('story-circle-encounter-target', target, 'error'),
      severity: 'error',
      source: 'encounter-story-circle-target',
      validator: 'QualityScoreV3',
      message,
      mappedDomain: 'story_circle_spine',
      conceptId: 'search_adaptation_pressure',
    });
  });
}

function collectReportFindings(
  inputs: StoryCircleQualityScoreInputs,
  sidecarFindings: SidecarFinding[],
): SidecarFinding[] {
  const findings: SidecarFinding[] = [];
  const finalContract = inputs.finalStoryContractReport;

  finalContract?.blockingIssues?.forEach((issue) => {
    if (issue.disposition === 'refuted' || issue.disposition === 'uncorroborated') return;
    findings.push({
      severity: finalContractIssueSeverity(issue, 'error'),
      source: 'final-story-contract',
      validator: issue.validator,
      message: issue.message,
      location: (issue as any).path,
      disposition: issue.disposition,
    });
  });

  finalContract?.warnings?.forEach((issue) => {
    if (issue.disposition === 'refuted' || issue.disposition === 'uncorroborated') return;
    findings.push({
      severity: finalContractIssueSeverity(issue, 'warning'),
      source: 'final-story-contract',
      validator: issue.validator,
      message: issue.message,
      location: (issue as any).path,
      disposition: issue.disposition,
    });
  });

  const validation = inputs.bestPracticesReport as any;
  validation?.blockingIssues?.forEach((issue: any) => {
    findings.push({
      severity: issue?.severity === 'critical' ? 'critical' : 'error',
      source: 'validation',
      validator: issue?.validator ?? issue?.type,
      message: stringifyMessage(issue),
      location: issue?.path ?? issue?.location,
    });
  });
  validation?.warnings?.forEach((issue: any) => {
    findings.push({
      severity: 'warning',
      source: 'validation',
      validator: issue?.validator ?? issue?.type,
      message: stringifyMessage(issue),
      location: issue?.path ?? issue?.location,
    });
  });
  validation?.suggestions?.forEach((issue: any) => {
    findings.push({
      severity: 'suggestion',
      source: 'validation',
      validator: issue?.validator ?? issue?.type,
      message: stringifyMessage(issue),
      location: issue?.path ?? issue?.location,
    });
  });

  const qa = inputs.qaReport as any;
  qa?.criticalIssues?.forEach((message: unknown) => {
    findings.push({
      severity: 'critical',
      source: 'qa-report',
      validator: 'QAReport',
      message: String(message),
    });
  });
  qa?.continuityIssues?.forEach((message: unknown) => {
    findings.push({
      severity: 'error',
      source: 'qa-report',
      validator: 'ContinuityQA',
      message: String(message),
    });
  });
  qa?.characterConsistency?.issues?.forEach((message: unknown) => {
    findings.push({
      severity: 'warning',
      source: 'qa-report',
      validator: 'CharacterConsistencyQA',
      message: String(message),
    });
  });
  qa?.choiceQuality?.issues?.forEach((message: unknown) => {
    findings.push({
      severity: 'warning',
      source: 'qa-report',
      validator: 'ChoiceQualityQA',
      message: String(message),
    });
  });
  (qa?.proseCraft?.issues ?? []).forEach((issue: any) => {
    findings.push({
      severity: normalizeJudgeSeverity(issue?.severity),
      source: 'prose-craft-judge',
      validator: 'ProseCraftJudge',
      message: stringifyMessage(issue?.description ?? issue),
      location: [issue?.location?.sceneId, issue?.location?.beatId].filter(Boolean).join('/') || undefined,
      domainId: 'prose_craft',
      conceptId: PROSE_CRAFT_CONCEPT_IDS.has(String(issue?.conceptId)) ? String(issue.conceptId) : undefined,
    });
  });
  (qa?.responsiveness?.issues ?? []).forEach((issue: any) => {
    const conceptId = String(issue?.conceptId ?? '');
    const domainId = RESPONSIVENESS_CONCEPT_DOMAINS[conceptId] ?? 'branching_consequence_memory';
    findings.push({
      severity: normalizeJudgeSeverity(issue?.severity),
      source: 'responsiveness-judge',
      validator: 'ResponsivenessJudge',
      message: stringifyMessage(issue?.description ?? issue),
      location: [issue?.location?.sceneId, issue?.location?.beatId].filter(Boolean).join('/') || undefined,
      domainId,
      conceptId: RESPONSIVENESS_CONCEPT_DOMAINS[conceptId] ? conceptId : undefined,
    });
  });

  inputs.qualityCouncilReport?.checkpoints?.forEach((checkpoint) => {
    if (isOptionalFusionTransportError(checkpoint, inputs.qualityCouncilReport?.checkpoints || [])) return;
    if (checkpoint.status === 'error') {
      findings.push({
        severity: 'critical',
        source: 'quality-council',
        validator: `QualityCouncil:${checkpoint.checkpoint}:error`,
        message: checkpoint.error || checkpoint.summary || `${checkpoint.checkpoint} Quality Council checkpoint failed before producing findings.`,
      });
    }

    (checkpoint.findings || []).forEach((finding) => {
      findings.push({
        // v4: council severities are honored as-is. The LLM judges are the only
        // semantic reviewers in the loop; demoting their errors below regex
        // validators' (v3 behavior) inverted the signal hierarchy.
        severity: finding.severity === 'error' ? 'error' : finding.severity === 'warning' ? 'warning' : 'suggestion',
        source: 'quality-council',
        validator: finding.validatorMapping || `QualityCouncil:${finding.category}`,
        message: `${finding.category}: ${finding.evidence.join(' ')}`,
        location: [
          finding.target?.episodeId,
          finding.target?.sceneId,
          finding.target?.beatId,
          finding.target?.choiceId,
        ].filter(Boolean).join('/') || undefined,
      });
    });
  });

  sidecarFindings.forEach((finding) => findings.push(finding));
  return findings;
}

function normalizeJudgeSeverity(severity: unknown): QualitySeverity {
  return severity === 'error' ? 'error' : severity === 'suggestion' ? 'suggestion' : 'warning';
}

function finalContractIssueSeverity(issue: FinalStoryContractIssue, fallback: QualitySeverity): QualitySeverity {
  const severity = (issue as any).severity;
  if (severity === 'critical' || severity === 'error' || severity === 'warning' || severity === 'suggestion') {
    return severity;
  }
  const type = String((issue as any).type ?? issue.validator ?? '').toLowerCase();
  if (type.includes('hard') || type.includes('blocking') || type.includes('critical')) {
    return 'critical';
  }
  return fallback;
}

function mapFindingToDomain(finding: SidecarFinding): QualityDomainId | undefined {
  // Explicit routing wins: producer-set domain, then the validator tag registry.
  // The keyword sniff below is a fallback for unregistered sources only.
  if (finding.domainId) {
    return finding.domainId;
  }
  const tag = lookupQualityDomainTag(finding.validator);
  if (tag) {
    return tag.domainId;
  }

  const haystack = `${finding.validator ?? ''} ${finding.source} ${finding.message}`.toLowerCase();

  if (
    haystack.includes('storycircle') ||
    haystack.includes('story circle') ||
    haystack.includes('episodecircle') ||
    haystack.includes('story_circle') ||
    haystack.includes('encounterstorycircletarget') ||
    haystack.includes('encounter story circle target') ||
    haystack.includes('threshold crossing') ||
    haystack.includes('return-with-difference')
  ) {
    return 'story_circle_spine';
  }

  if (
    haystack.includes('sceneturn') ||
    haystack.includes('scene turn') ||
    haystack.includes('requiredbeat') ||
    haystack.includes('beat realization') ||
    haystack.includes('scene coherence') ||
    haystack.includes('routecontinuity') ||
    haystack.includes('route continuity') ||
    haystack.includes('route_chronology') ||
    haystack.includes('choice_bridge_sibling') ||
    haystack.includes('bridge sibling') ||
    haystack.includes('route_duplicate') ||
    haystack.includes('unsafe_fallback_prose') ||
    haystack.includes('fallback prose') ||
    haystack.includes('role_fidelity') ||
    haystack.includes('chronology') ||
    haystack.includes('wrong scene') ||
    haystack.includes('beat placement') ||
    haystack.includes('transition') ||
    haystack.includes('povclarity') ||
    haystack.includes('sentenceopener') ||
    haystack.includes('outcometextquality') ||
    haystack.includes('failure_modes') ||
    haystack.includes('intensity_distribution')
  ) {
    return 'scene_coherence_prose_continuity';
  }

  if (
    haystack.includes('seasonpromise') ||
    haystack.includes('dramatic question') ||
    haystack.includes('central promise') ||
    haystack.includes('stakes') ||
    haystack.includes('setup_payoff') ||
    haystack.includes('setup/payoff') ||
    haystack.includes('promise ledger') ||
    haystack.includes('arcpressure') ||
    haystack.includes('arc pressure') ||
    haystack.includes('reversal') ||
    haystack.includes('climax') ||
    haystack.includes('resolution') ||
    haystack.includes('informationledger') ||
    haystack.includes('information ledger') ||
    haystack.includes('reveal') ||
    haystack.includes('cliffhanger') ||
    haystack.includes('twist_quality') ||
    haystack.includes('twistquality') ||
    haystack.includes('cold open') ||
    haystack.includes('dramatic structure') ||
    haystack.includes('theme') ||
    haystack.includes('treatment') ||
    haystack.includes('source fidelity') ||
    haystack.includes('authored') ||
    haystack.includes('signaturedevice')
  ) {
    return 'dramatic_structure_architecture';
  }

  if (
    haystack.includes('branch') ||
    haystack.includes('divergence') ||
    haystack.includes('endingreachability') ||
    haystack.includes('residue') ||
    haystack.includes('callback') ||
    haystack.includes('consequence memory') ||
    haystack.includes('reconvergence') ||
    haystack.includes('route effect') ||
    haystack.includes('branch graph') ||
    haystack.includes('scenegraphbranch') ||
    haystack.includes('cosmetic')
  ) {
    return 'branching_consequence_memory';
  }

  if (
    haystack.includes('choice') ||
    haystack.includes('consequencetier') ||
    haystack.includes('stakestriangle') ||
    haystack.includes('fivefactor') ||
    haystack.includes('dilemma') ||
    haystack.includes('strategic') ||
    haystack.includes('distribution')
  ) {
    return 'choice_agency';
  }

  if (
    haystack.includes('flagcontract') ||
    haystack.includes('mechanicalstorytelling') ||
    haystack.includes('narrativemechanicpressure') ||
    haystack.includes('statcheckbalance') ||
    haystack.includes('skillcoverage') ||
    haystack.includes('skill surface') ||
    haystack.includes('fiction-first') ||
    haystack.includes('mechanicsleakage') ||
    haystack.includes('stat check') ||
    haystack.includes('skill check') ||
    haystack.includes('hidden state') ||
    haystack.includes('inventory') ||
    haystack.includes('numeric balance') ||
    haystack.includes('mechanic')
  ) {
    return 'gameplay_mechanics_as_fiction';
  }

  if (
    haystack.includes('voice') ||
    haystack.includes('npc') ||
    haystack.includes('relationship') ||
    haystack.includes('identity') ||
    haystack.includes('arcdelta') ||
    haystack.includes('arc_delta') ||
    haystack.includes('character')
  ) {
    return 'character_npc_relationship_quality';
  }

  // Encounters LAST among content domains: "encounter" appears incidentally in
  // messages about choices/scenes set inside encounter scenes, and this domain
  // carries the smallest weight — greedy matching here diluted real findings
  // (v3 checked it second). Registered encounter validators route via tags above.
  if (
    haystack.includes('encounter anchor') ||
    haystack.includes('encounteranchor') ||
    haystack.includes('encounter') ||
    haystack.includes('clock') ||
    haystack.includes('tactical') ||
    haystack.includes('environmental')
  ) {
    return 'encounters';
  }

  if (
    haystack.includes('leak') ||
    haystack.includes('design note') ||
    haystack.includes('scaffolding') ||
    haystack.includes('player-facing prose')
  ) {
    return 'scene_coherence_prose_continuity';
  }

  return undefined;
}

function mapFindingToConcept(domainId: QualityDomainId, finding: SidecarFinding | QualityFinding): string | undefined {
  if ('conceptId' in finding && finding.conceptId) {
    return finding.conceptId;
  }
  const tag = lookupQualityDomainTag(finding.validator);
  if (tag?.conceptId && tag.domainId === domainId) {
    return tag.conceptId;
  }
  const domain = DEFAULT_DOMAIN_DEFINITIONS.find((definition) => definition.id === domainId);
  if (!domain) {
    return undefined;
  }
  const haystack = `${finding.validator ?? ''} ${finding.source} ${finding.message}`.toLowerCase();
  const matched = domain.concepts.find((concept) =>
    (concept.keywords ?? []).some((keyword) => haystack.includes(keyword.toLowerCase())),
  );
  return matched?.id ?? domain.defaultConceptId;
}

function toQualityFinding(finding: SidecarFinding, mappedDomain?: QualityDomainId): QualityFinding {
  return {
    id: makeFindingId(finding.source, `${finding.validator ?? 'unknown'}-${finding.message}`, finding.severity),
    severity: finding.severity,
    source: finding.source,
    validator: finding.validator,
    message: finding.message,
    location: finding.location,
    mappedDomain,
    conceptId: mappedDomain ? mapFindingToConcept(mappedDomain, finding) : undefined,
  };
}

function addFinding(domain: DomainAccumulator, finding: QualityFinding): void {
  const semanticKey = qualityFindingSemanticKey(finding);
  if (domain.findings.some((existing) =>
    existing.id === finding.id ||
    qualityFindingSemanticKey(existing) === semanticKey
  )) {
    return;
  }
  domain.findings.push(finding);
  if (finding.severity === 'critical') {
    domain.criticalMisses += 1;
  } else if (finding.severity === 'error') {
    domain.errors += 1;
  } else if (finding.severity === 'warning') {
    domain.warnings += 1;
  } else {
    domain.suggestions += 1;
  }

  const conceptId = finding.conceptId && domain.concepts[finding.conceptId]
    ? finding.conceptId
    : mapFindingToConcept(domain.id, finding) ?? domain.defaultConceptId;
  const concept = domain.concepts[conceptId];
  if (!concept || concept.findings.some((existing) => existing.id === finding.id)) {
    return;
  }
  concept.findings.push(finding);
  if (finding.severity === 'critical') {
    concept.criticalMisses += 1;
  } else if (finding.severity === 'error') {
    concept.errors += 1;
  } else if (finding.severity === 'warning') {
    concept.warnings += 1;
  } else {
    concept.suggestions += 1;
  }
}

function qualityFindingSemanticKey(finding: QualityFinding): string {
  return [
    finding.severity,
    finding.validator ?? '',
    finding.location ?? '',
    finding.conceptId ?? '',
    normalizeFindingMessage(finding.message),
  ].join('|');
}

function normalizeFindingMessage(message: string): string {
  return message
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function finalizeDomainScore(domain: DomainAccumulator): QualityDomainScore {
  const concepts = Object.values(domain.concepts).map(finalizeConceptScore);
  const score = weightedConceptScore(concepts);
  const { defaultConceptId: _defaultConceptId, concepts: _concepts, requiresEvidence, ...rest } = domain;
  // Evidence-requiring domains (judge-fed, e.g. prose_craft) drop out of the
  // weighted average entirely when nothing graded or hit them — a domain with
  // no reader in the loop must not contribute a free 100.
  const hasEvidence =
    domain.findings.length > 0 ||
    Object.values(domain.concepts).some(
      (concept) => concept.gradedScore !== undefined || concept.findings.length > 0,
    );
  const active = rest.active && (!requiresEvidence || hasEvidence);
  if (requiresEvidence && !hasEvidence) {
    rest.missingEvidence.push('No judge grades or findings reached this evidence-requiring domain; it is excluded from the weighted score.');
  }
  return { ...rest, active, concepts, score };
}

function finalizeConceptScore(concept: ConceptAccumulator): QualityConceptScore {
  // A judge grade replaces the implicit 100 base; validator findings still
  // subtract on top of it.
  const base = concept.gradedScore ?? 100;
  const score = clampScore(
    base -
      concept.criticalMisses * 25 -
      concept.errors * 18 -
      concept.warnings * 7 -
      concept.suggestions * 2,
  );
  return { ...concept, score };
}

function conceptIsActive(concept: Pick<QualityConceptScore, 'weight' | 'judgeOnly' | 'gradedScore' | 'findings'>): boolean {
  if (concept.weight <= 0) return false;
  if (!concept.judgeOnly) return true;
  return concept.gradedScore !== undefined || concept.findings.length > 0;
}

function weightedConceptScore(concepts: QualityConceptScore[]): number {
  const activeConcepts = concepts.filter(conceptIsActive);
  const weighted = activeConcepts.reduce((sum, concept) => sum + concept.weight * concept.score, 0);
  const totalWeight = activeConcepts.reduce((sum, concept) => sum + concept.weight, 0);
  return totalWeight > 0 ? Math.round(weighted / totalWeight) : 0;
}

function weightedScore(domains: QualityDomainScore[]): number {
  const activeDomains = domains.filter((domain) => domain.active && domain.weight > 0);
  const weighted = activeDomains.reduce((sum, domain) => sum + domain.weight * domain.score, 0);
  const totalWeight = activeDomains.reduce((sum, domain) => sum + domain.weight, 0);
  return totalWeight > 0 ? weighted / totalWeight : 0;
}

function isEpisodeStoryCircleFinding(finding: SidecarFinding): boolean {
  const haystack = `${finding.validator ?? ''} ${finding.source} ${finding.message}`.toLowerCase();
  return haystack.includes('episodestorycirclevalidator')
    || haystack.includes('episode story circle')
    || haystack.includes('episodecircle')
    || haystack.includes('episode circle')
    || haystack.includes('episode local loop')
    || haystack.includes('metadata-only');
}

function hasIssue(issues: Array<Partial<FinalStoryContractIssue>>, pattern: RegExp): boolean {
  return issues.some((issue) =>
    pattern.test(`${issue.type ?? ''} ${issue.validator ?? ''} ${issue.message ?? ''}`),
  );
}

function isUngroundedAdvisory(value: unknown): boolean {
  return /evidence-ungrounded|ungrounded (?:claim|evidence)|quoted text not found/i.test(String(value ?? ''));
}

function judgeIssueSceneIds(issues: any[]): string[] {
  return uniqueStrings(
    issues
      .filter((issue) => !isUngroundedAdvisory(issue?.description ?? issue))
      .map((issue) => issue?.location?.sceneId)
      .filter((sceneId): sceneId is string => typeof sceneId === 'string' && sceneId.length > 0),
  );
}

function buildQualityRepairTargets(inputs: StoryCircleQualityScoreInputs): QualityRepairTarget[] {
  const qa = inputs.qaReport as any;
  const targets: QualityRepairTarget[] = [];
  const proseScore = normalizeScore(qa?.proseCraft?.overallScore);
  const proseIssues = Array.isArray(qa?.proseCraft?.issues) ? qa.proseCraft.issues : [];
  const groundedProseErrors = proseIssues.filter((issue: any) =>
    issue?.severity === 'error' && !isUngroundedAdvisory(issue?.description ?? issue),
  );
  if (
    proseScore !== undefined
    && (proseScore < QUALITY_REPAIR_THRESHOLDS.proseCraft || groundedProseErrors.length > 0)
  ) {
    const issueSceneIds = judgeIssueSceneIds(groundedProseErrors.length > 0 ? groundedProseErrors : proseIssues);
    const sampledSceneIds = Array.isArray(qa?.proseCraft?.sampledSceneIds)
      ? qa.proseCraft.sampledSceneIds.filter((sceneId: unknown): sceneId is string => typeof sceneId === 'string')
      : [];
    targets.push({
      kind: 'scene_prose',
      component: 'prose_craft',
      threshold: QUALITY_REPAIR_THRESHOLDS.proseCraft,
      actualScore: proseScore,
      reason: groundedProseErrors.length > 0
        ? `${groundedProseErrors.length} grounded prose-craft error(s) require focused scene repair.`
        : `Prose craft ${proseScore} is below the ${QUALITY_REPAIR_THRESHOLDS.proseCraft} repair floor.`,
      sceneIds: uniqueStrings([...issueSceneIds, ...sampledSceneIds]).slice(0, 3),
      probeIds: [],
    });
  }

  const responsivenessScore = normalizeScore(qa?.responsiveness?.overallScore);
  const responsivenessIssues = Array.isArray(qa?.responsiveness?.issues) ? qa.responsiveness.issues : [];
  const groundedResponsivenessErrors = responsivenessIssues.filter((issue: any) =>
    issue?.severity === 'error' && !isUngroundedAdvisory(issue?.description ?? issue),
  );
  const probeVerdicts = Array.isArray(qa?.responsiveness?.probeVerdicts) ? qa.responsiveness.probeVerdicts : [];
  const weakProbeIds = uniqueStrings(
    probeVerdicts
      .filter((probe: any) => probe?.verdict === 'cosmetic' || probe?.npcReaction === 'static')
      .map((probe: any) => probe?.probeId)
      .filter((probeId: unknown): probeId is string => typeof probeId === 'string' && probeId.length > 0),
  );
  if (
    responsivenessScore !== undefined
    && (
      responsivenessScore < QUALITY_REPAIR_THRESHOLDS.responsiveness
      || groundedResponsivenessErrors.length > 0
      || weakProbeIds.length > 0
    )
  ) {
    targets.push({
      kind: 'route_pair',
      component: 'responsiveness',
      threshold: QUALITY_REPAIR_THRESHOLDS.responsiveness,
      actualScore: responsivenessScore,
      reason: weakProbeIds.length > 0
        ? `${weakProbeIds.length} route-pair probe(s) are cosmetic or leave NPC reactions static.`
        : groundedResponsivenessErrors.length > 0
          ? `${groundedResponsivenessErrors.length} grounded responsiveness error(s) require route-pair repair.`
          : `Responsiveness ${responsivenessScore} is below the ${QUALITY_REPAIR_THRESHOLDS.responsiveness} repair floor.`,
      sceneIds: judgeIssueSceneIds(
        groundedResponsivenessErrors.length > 0 ? groundedResponsivenessErrors : responsivenessIssues,
      ),
      probeIds: weakProbeIds,
    });
  }
  return targets;
}

function applyCaps(
  caps: QualityCap[],
  storyCircle: StoryCircleEvidenceSummary,
  signals: StaticStorySignals,
  inputs: StoryCircleQualityScoreInputs,
  collectedFindings: SidecarFinding[],
): void {
  const scope = storyCircleEvidenceScope(inputs.finalStory ?? null);
  const activeBeats = collectActiveStoryCircleBeats(inputs.brief, scope);

  if (storyCircle.missingBeats.length > 0) {
    caps.push({
      id: 'story_circle_primary_beat_missing',
      maxScore: 69,
      reason: `Missing primary Story Circle beat(s): ${storyCircle.missingBeats.join(', ')}.`,
      domainId: 'story_circle_spine',
    });
  }

  if (!storyCircle.ordered) {
    caps.push({
      id: 'story_circle_beats_out_of_order',
      maxScore: 69,
      reason: storyCircle.orderedViolation ?? 'Story Circle beats are materially out of order.',
      domainId: 'story_circle_spine',
    });
  }

  const take = storyCircle.beats.take;
  if ((!activeBeats.size || activeBeats.has('take')) && (!take || take.status !== 'realized')) {
    caps.push({
      id: 'take_price_missing_or_weak',
      maxScore: 59,
      reason: 'Story Circle take/price beat is missing, weak, or metadata-only.',
      domainId: 'story_circle_spine',
    });
  }

  const change = storyCircle.beats.change;
  if ((!activeBeats.size || activeBeats.has('change')) && (!change || change.status !== 'realized')) {
    caps.push({
      id: 'change_equilibrium_missing_or_weak',
      maxScore: 59,
      reason: 'Story Circle change/transformed-equilibrium beat is missing, weak, or metadata-only.',
      domainId: 'story_circle_spine',
    });
  }

  if (storyCircle.metadataOnlyBeats.length > 0) {
    caps.push({
      id: 'episode_circle_metadata_only',
      maxScore: 69,
      reason: `Story Circle beat(s) labeled but not realized in final prose: ${storyCircle.metadataOnlyBeats.join(', ')}.`,
      domainId: 'story_circle_spine',
    });
  }

  const episodeStoryCircleFindings = collectedFindings.filter(isEpisodeStoryCircleFinding);
  if (episodeStoryCircleFindings.length > 0) {
    caps.push({
      id: 'episode_story_circle_local_loop_unproven',
      maxScore: 89,
      reason: `${episodeStoryCircleFindings.length} episode-level Story Circle local-loop finding(s) remain in validator evidence.`,
      domainId: 'story_circle_spine',
    });
  }

  if (signals.invalidEncounterTargets.length > 0) {
    caps.push({
      id: 'encounter_story_circle_target_mismatch',
      maxScore: 79,
      reason: 'Central encounter target does not match go/search/find/take.',
      domainId: 'story_circle_spine',
    });
  }

  if (signals.majorScenesWithoutTurn > 1) {
    caps.push({
      id: 'major_scenes_without_turn',
      maxScore: 69,
      reason: 'More than one major scene lacks a realized scene turn.',
      domainId: 'scene_coherence_prose_continuity',
    });
  }

  const hasWrongChronologyFinding = inputs.finalStoryContractReport?.blockingIssues?.some((issue) =>
    /wrong scene|chronolog|beat placement|critical beat/i.test(`${issue.validator ?? ''} ${issue.message}`),
  ) ?? false;
  if (hasWrongChronologyFinding) {
    caps.push({
      id: 'critical_beat_wrong_scene_or_chronology',
      maxScore: 69,
      reason: 'A critical beat appears in the wrong scene or chronology.',
      domainId: 'scene_coherence_prose_continuity',
    });
  }

  const deterministicChronologyFindings = collectedFindings.filter((finding) =>
    !isUngroundedAdvisory(finding.message)
    && finding.source !== 'qa-report'
    && finding.source !== 'quality-council'
    && /chronolog|timeline|out.of.order|duplicate.*(?:event|atom)|route_duplicate_event|causal order|prerequisite/i
      .test(`${finding.validator ?? ''} ${finding.message}`),
  );
  const chronologyErrors = deterministicChronologyFindings.filter((finding) =>
    finding.severity === 'critical' || finding.severity === 'error',
  );
  if (chronologyErrors.length > 0) {
    caps.push({
      id: 'chronology_health_error',
      maxScore: 69,
      reason: `${chronologyErrors.length} grounded chronology/causal-order error(s) remain.`,
      domainId: 'scene_coherence_prose_continuity',
    });
  } else if (deterministicChronologyFindings.length > 0) {
    caps.push({
      id: 'chronology_health_warning',
      maxScore: 84,
      reason: `${deterministicChronologyFindings.length} chronology/causal-order warning(s) remain.`,
      domainId: 'scene_coherence_prose_continuity',
    });
  }

  const twistFindings = collectedFindings.filter((finding) =>
    !isUngroundedAdvisory(finding.message)
    && /TwistQualityValidator|twist realization|foreshadow.*(?:missing|after|late)|reveal.*(?:unearned|unprepared)/i
      .test(`${finding.validator ?? ''} ${finding.message}`),
  );
  const twistErrors = twistFindings.filter((finding) =>
    finding.severity === 'critical' || finding.severity === 'error',
  );
  if (twistErrors.length > 0) {
    caps.push({
      id: 'twist_realization_error',
      maxScore: 79,
      reason: `${twistErrors.length} twist/foreshadow realization error(s) remain.`,
      domainId: 'dramatic_structure_architecture',
    });
  } else if (twistFindings.length > 0) {
    caps.push({
      id: 'twist_realization_warning',
      maxScore: 89,
      reason: `${twistFindings.length} twist/foreshadow realization warning(s) remain.`,
      domainId: 'dramatic_structure_architecture',
    });
  }

  const obligationFindings = collectedFindings.filter((finding) =>
    !isUngroundedAdvisory(finding.message)
    && /ObligationLedgerValidator|ResidueObligationValidator|SetupPayoffValidator|CallbackCoverageValidator|missing.*(?:obligation|payoff|callback)|unpaid|dangling.*(?:promise|setup)|planned_residue_debt/i
      .test(`${finding.validator ?? ''} ${finding.message}`),
  );
  const obligationErrors = obligationFindings.filter((finding) =>
    finding.severity === 'critical' || finding.severity === 'error',
  );
  if (obligationErrors.length > 0) {
    caps.push({
      id: 'obligation_health_error',
      maxScore: 74,
      reason: `${obligationErrors.length} payoff/callback/residue obligation error(s) remain.`,
      domainId: 'dramatic_structure_architecture',
    });
  } else if (obligationFindings.length > 0) {
    caps.push({
      id: 'obligation_health_warning',
      maxScore: 84,
      reason: `${obligationFindings.length} payoff/callback/residue obligation warning(s) remain.`,
      domainId: 'dramatic_structure_architecture',
    });
  }

  // Abort-time triage residue (audit Phase 2 "≤15 blocking set"): unrepaired
  // non-core blockers that shipped as demoted warnings instead of aborting the
  // run (finalContractAbortPolicy.applyFinalContractAbortTriage). Every one of
  // these was an error-severity blocker before demotion, so a single
  // error-tier cap applies. Sub-90 ⇒ blockingCapCount increments ⇒ the ledger
  // band leaves `ship` — the defect ships VISIBLY, never silently.
  const demotedContractFindings = inputs.finalStoryContractReport?.warnings?.filter(
    (issue) => (issue as { demotedFromBlocking?: boolean }).demotedFromBlocking === true,
  ) ?? [];
  if (demotedContractFindings.length > 0) {
    caps.push({
      id: 'unrepaired_contract_findings',
      maxScore: 74,
      reason:
        `${demotedContractFindings.length} unrepaired final-contract finding(s) shipped via abort-time triage `
        + `(non-core classes: ${[...new Set(demotedContractFindings.map((issue) => issue.type))].slice(0, 6).join(', ')}).`,
    });
  }

  const routeBlockingIssues = inputs.finalStoryContractReport?.blockingIssues?.filter((issue) =>
    issue.validator === 'RouteContinuityValidator',
  ) ?? [];
  const routeHardBlockers = routeBlockingIssues.filter((issue) =>
    /route_chronology_violation|choice_bridge_sibling_leak|route_duplicate_event|role_fidelity_violation/i
      .test(`${issue.type} ${issue.message}`),
  );
  const unsafeFallbackBlockers = routeBlockingIssues.filter((issue) =>
    /unsafe_fallback_prose|fallback/i.test(`${issue.type} ${issue.message}`),
  );
  if (routeHardBlockers.length > 0) {
    caps.push({
      id: 'route_continuity_hard_fail',
      maxScore: 49,
      reason: `${routeHardBlockers.length} route continuity blocker(s) remain in the playable story path.`,
      domainId: 'scene_coherence_prose_continuity',
    });
  }

  if (unsafeFallbackBlockers.length > 0) {
    caps.push({
      id: 'unsafe_fallback_prose_survived',
      maxScore: 39,
      reason: `${unsafeFallbackBlockers.length} unsafe fallback/planning prose blocker(s) survived into story content.`,
      domainId: 'scene_coherence_prose_continuity',
    });
  }

  // Arbitration demotions are audit evidence, not quality defects. They must
  // not trigger a cap merely because the original heuristic type remains in
  // the warning message. Hard caps read BLOCKING issues only: warnings are
  // advisory by definition, and run 2026-07-16T14-50-23 was capped at 74 by
  // its own ADVISORY departure warnings ("…departure is missing:
  // transition:ep1:…:treatment-enc-1-1…" regex-matched the treatment-atom
  // cap) while zero blocking issues existed.
  const finalContractIssues = [
    ...(inputs.finalStoryContractReport?.blockingIssues || []),
  ].filter((issue) => issue.disposition !== 'refuted' && issue.disposition !== 'uncorroborated');
  if (hasIssue(finalContractIssues, /planning_register|planning-register|raw treatment|scaffold|fallback prose|protagonist synopsis/i)) {
    caps.push({
      id: 'planning_register_leak',
      maxScore: 69,
      reason: 'Planning-register, raw treatment, or fallback scaffold language appears in generated artifacts.',
      domainId: 'scene_coherence_prose_continuity',
    });
  }
  if (hasIssue(finalContractIssues, /empty_scene|empty encounter|empty scene|no playable beats|no beats/i)) {
    caps.push({
      id: 'empty_scene_or_encounter',
      maxScore: 69,
      reason: 'An empty scene or encounter remains in the final package.',
      domainId: 'scene_coherence_prose_continuity',
    });
  }
  if (hasIssue(finalContractIssues, /missing.*(?:required|treatment|atom)|required.*(?:missing|not dramatized)|missing_required_atom/i)) {
    caps.push({
      id: 'missing_required_treatment_atom',
      maxScore: 74,
      reason: 'A concrete required treatment obligation is missing from final prose.',
      domainId: 'scene_coherence_prose_continuity',
    });
  }
  if (hasIssue(finalContractIssues, /duplicate.*(?:treatment|atom|event)|out.of.order|chronolog|atom_out_of_order|duplicate_atom/i)) {
    caps.push({
      id: 'duplicate_or_out_of_order_treatment_atom',
      maxScore: 79,
      reason: 'A treatment event is duplicated or realized out of chronological order.',
      domainId: 'scene_coherence_prose_continuity',
    });
  }
  if (hasIssue(finalContractIssues, /false choice|cosmetic choice|meaningful choice|agency.*(?:missing|weak|false)|choice.*(?:no consequence|only changes tone)/i)) {
    caps.push({
      id: 'false_meaningful_choice',
      maxScore: 84,
      reason: 'A choice framed as meaningful lacks concrete outcome, process, relationship, information, resource, identity, or callback impact.',
      domainId: 'choice_agency',
    });
  }

  if (signals.leakage.length > 0) {
    caps.push({
      id: 'player_facing_mechanics_leakage',
      maxScore: 69,
      reason: 'Player-facing mechanics or scaffolding leakage exists.',
      domainId: 'gameplay_mechanics_as_fiction',
    });
  }

  if (signals.repeatedOrCentralLeakage) {
    caps.push({
      id: 'repeated_or_central_leakage',
      maxScore: 49,
      reason: 'Repeated or central player-facing mechanics/scaffolding leakage exists.',
      domainId: 'gameplay_mechanics_as_fiction',
    });
  }

  const hasDivergenceFinding = inputs.finalStoryContractReport?.blockingIssues?.some((issue) =>
    /divergence|cosmetic|residue-free|residue free/i.test(`${issue.validator ?? ''} ${issue.message}`),
  ) ?? false;
  if (signals.cosmeticBranching || hasDivergenceFinding) {
    caps.push({
      id: 'branching_cosmetic_or_residue_free',
      maxScore: 79,
      reason: 'Branching is cosmetic or residue-free.',
      domainId: 'branching_consequence_memory',
    });
  }

  const allCouncilCheckpoints = inputs.qualityCouncilReport?.checkpoints || [];
  const councilCheckpoints = inputs.qualityCouncilReport?.enabled
    ? allCouncilCheckpoints.filter((checkpoint) =>
      checkpoint.status !== 'skipped'
      && !isOptionalFusionTransportError(checkpoint, allCouncilCheckpoints)
    )
    : [];
  const councilErrors = councilCheckpoints.filter((checkpoint) => checkpoint.status === 'error');
  const councilParseErrors = councilCheckpoints.filter((checkpoint) =>
    checkpoint.parseStatus === 'raw_findings_dropped' || checkpoint.parseStatus === 'error',
  );
  if (councilParseErrors.length > 0) {
    caps.push({
      id: 'quality_council_parser_failed_closed',
      maxScore: 79,
      reason: `${councilParseErrors.length} Quality Council checkpoint(s) had parse diagnostics that made acceptance unsafe.`,
    });
  }
  if (councilErrors.length > 0 && councilErrors.length === councilCheckpoints.length) {
    caps.push({
      id: 'quality_council_all_checkpoints_failed',
      maxScore: 69,
      reason: 'Quality Council was enabled, but every runnable checkpoint failed before producing review findings.',
    });
  } else if (councilErrors.length > 0) {
    caps.push({
      id: 'quality_council_checkpoint_failed',
      maxScore: 79,
      reason: `${councilErrors.length} enabled Quality Council checkpoint(s) failed before producing review findings.`,
    });
  }

  const proseScore = normalizeScore((inputs.qaReport as any)?.proseCraft?.overallScore);
  const proseIssues = Array.isArray((inputs.qaReport as any)?.proseCraft?.issues)
    ? (inputs.qaReport as any).proseCraft.issues
    : [];
  const groundedProseErrors = proseIssues.filter((issue: any) =>
    issue?.severity === 'error' && !isUngroundedAdvisory(issue?.description ?? issue),
  );
  if (proseScore !== undefined && proseScore < QUALITY_REPAIR_THRESHOLDS.proseCraft) {
    caps.push({
      id: 'prose_craft_below_publish_floor',
      maxScore: proseScore < 60 ? 69 : 79,
      reason: `Prose craft ${proseScore} is below the ${QUALITY_REPAIR_THRESHOLDS.proseCraft} publish/repair floor.`,
      domainId: 'prose_craft',
    });
  } else if (groundedProseErrors.length > 0) {
    caps.push({
      id: 'prose_craft_errors_remain',
      maxScore: 79,
      reason: `${groundedProseErrors.length} grounded prose-craft error(s) remain.`,
      domainId: 'prose_craft',
    });
  }

  const responsivenessScore = normalizeScore((inputs.qaReport as any)?.responsiveness?.overallScore);
  const responsivenessIssues = Array.isArray((inputs.qaReport as any)?.responsiveness?.issues)
    ? (inputs.qaReport as any).responsiveness.issues
    : [];
  const groundedResponsivenessErrors = responsivenessIssues.filter((issue: any) =>
    issue?.severity === 'error' && !isUngroundedAdvisory(issue?.description ?? issue),
  );
  const responsivenessProbes = Array.isArray((inputs.qaReport as any)?.responsiveness?.probeVerdicts)
    ? (inputs.qaReport as any).responsiveness.probeVerdicts
    : [];
  const cosmeticProbeCount = responsivenessProbes.filter((probe: any) =>
    probe?.verdict === 'cosmetic' || probe?.npcReaction === 'static',
  ).length;
  if (responsivenessScore !== undefined && responsivenessScore < QUALITY_REPAIR_THRESHOLDS.responsiveness) {
    caps.push({
      id: 'responsiveness_below_publish_floor',
      maxScore: responsivenessScore < 60 ? 69 : 79,
      reason: `Responsiveness ${responsivenessScore} is below the ${QUALITY_REPAIR_THRESHOLDS.responsiveness} publish/repair floor.`,
      domainId: 'branching_consequence_memory',
    });
  } else if (groundedResponsivenessErrors.length > 0 || cosmeticProbeCount > 0) {
    caps.push({
      id: 'responsiveness_errors_remain',
      maxScore: 84,
      reason: `${groundedResponsivenessErrors.length} grounded responsiveness error(s) and ${cosmeticProbeCount} cosmetic/static route probe(s) remain.`,
      domainId: 'branching_consequence_memory',
    });
  }

  if (!signals.finalStoryPresent || inputs.finalStoryContractReport?.passed === false) {
    caps.push({
      id: 'final_package_playability_hard_blocker',
      maxScore: 49,
      reason: 'A final package/playability hard blocker remains.',
    });
  }

  if (signals.totalChoices === 0) {
    caps.push({
      id: 'meaningful_player_agency_missing',
      maxScore: 69,
      reason: 'Meaningful player agency is missing from the final playable story.',
      domainId: 'choice_agency',
    });
  }
}

function isOptionalFusionTransportError(
  checkpoint: QualityCouncilCheckpointReport,
  allCheckpoints: QualityCouncilCheckpointReport[],
): boolean {
  if (checkpoint.status !== 'error' || !checkpoint.fusionUsed) return false;
  const siblingPassed = allCheckpoints.some((candidate) =>
    candidate !== checkpoint
    && candidate.checkpoint === checkpoint.checkpoint
    && !candidate.fusionUsed
    && (candidate.status === 'passed' || candidate.status === 'findings')
  );
  if (!siblingPassed) return false;
  return /openrouter api error|no endpoints found|provider routing|requested parameters|404/i
    .test(`${checkpoint.summary || ''} ${checkpoint.error || ''}`);
}

function applyScoreCaps(score: number, caps: QualityCap[]): number {
  return caps.reduce((current, cap) => Math.min(current, cap.maxScore), score);
}

function buildQualityEligibility(caps: QualityCap[]): QualityEligibility {
  const blockingCaps = caps.filter((cap) => cap.maxScore < 90);
  return {
    eligibleFor90: blockingCaps.length === 0,
    blockingReasons: blockingCaps.map((cap) => cap.reason),
    capsApplied: caps,
  };
}

function enforceAboveNinetyRequirements(
  score: number,
  caps: QualityCap[],
  domains: QualityDomainScore[],
  storyCircle: StoryCircleEvidenceSummary,
  signals: StaticStorySignals,
): { score: number; addedCaps: QualityCap[] } {
  if (score < 90) {
    return { score, addedCaps: [] };
  }
  const addedCaps: QualityCap[] = [];
  const noCaps = caps.length === 0;
  // Partial-season packages only require in-scope beats (already reflected in
  // missingBeats / metadataOnlyBeats). Full seasons still require the full loop.
  const inScopeBeats = STORY_CIRCLE_BEATS.filter((beat) =>
    storyCircle.beats[beat]?.status === 'realized'
    || storyCircle.missingBeats.includes(beat)
    || storyCircle.metadataOnlyBeats.includes(beat)
    || (
      storyCircle.missingBeats.length === 0
      && storyCircle.metadataOnlyBeats.length === 0
      && storyCircle.beats[beat]?.status !== 'missing'
    ),
  );
  const beatsRequiredFor90 = inScopeBeats.length > 0 ? inScopeBeats : STORY_CIRCLE_BEATS;
  const allStoryCircleRealized = beatsRequiredFor90.every((beat) => storyCircle.beats[beat].status === 'realized')
    && storyCircle.missingBeats.length === 0
    && storyCircle.metadataOnlyBeats.length === 0;
  const allCoreDomainsAtLeast85 = domains
    .filter((domain) => domain.active)
    .every((domain) => domain.score >= 85);
  const noLeakage = signals.leakage.length === 0;
  const meaningfulAgency = signals.totalChoices > 0 && signals.meaningfulChoices > 0;
  // v4: a 90+ score is a claim about how the story READS, so it must be earned
  // with the prose-craft judge in the loop — deficit-free is not the same as good.
  const proseCraftJudged = domains.some((domain) => domain.id === 'prose_craft' && domain.active);

  if (!noCaps || !allStoryCircleRealized || !allCoreDomainsAtLeast85 || !noLeakage || !meaningfulAgency || !proseCraftJudged) {
    addedCaps.push({
      id: 'above_90_requirements_not_met',
      maxScore: 89,
      reason: 'Scores at or above 90 require no caps, all in-scope Story Circle beats realized on-page, all core domains at least 85, no leakage, meaningful agency, and prose-craft judge evidence.',
    });
    return { score: Math.min(score, 89), addedCaps };
  }

  return { score, addedCaps };
}

function computeEvidenceCoverage(
  inputs: StoryCircleQualityScoreInputs,
  storyCircle: StoryCircleEvidenceSummary,
  signals: StaticStorySignals,
  profile: 'authored-treatment' | 'freeform',
): number {
  const checks = [
    signals.finalStoryPresent,
    signals.sceneCount > 0 && signals.beatCount > 0,
    storyCircle.hasStoryCircleEvidence,
    Boolean(inputs.finalStoryContractReport),
    // v4: QA evidence counts toward coverage (v3 had a hardcoded `true` here
    // that permanently inflated coverage by one slot).
    Boolean(inputs.qaReport),
    signals.totalChoices > 0,
  ];

  if (profile === 'authored-treatment') {
    checks.push(hasTreatmentEvidence(inputs));
  }

  const available = checks.filter(Boolean).length;
  return Math.round((available / checks.length) * 100);
}

function hasTreatmentEvidence(inputs: StoryCircleQualityScoreInputs): boolean {
  const brief = inputs.brief;
  if (!brief) {
    return false;
  }
  return Boolean(
    brief.rawDocument ||
      brief.treatment ||
      brief.multiEpisode?.sourceAnalysis?.treatmentObligations ||
      brief.seasonPlan?.treatmentObligations ||
      inputs.finalStoryContractReport?.treatmentObligationCanonicalReport,
  );
}

function buildStoryCircleEvidence(story?: Story | null, brief?: Record<string, any>): StoryCircleEvidenceSummary {
  const beats = {} as Record<StoryCircleBeat, StoryCircleBeatEvidence>;
  const expectedByBeat = new Map<StoryCircleBeat, string[]>();
  const metadataByBeat = new Map<StoryCircleBeat, Array<{ text: string; episodeIndex?: number; sceneIndex?: number }>>();
  const scope = storyCircleEvidenceScope(story);
  const proseSegments = collectFinalProseSegments(story);
  const prose = proseSegments.map((segment) => segment.text).join('\n').toLowerCase();

  STORY_CIRCLE_BEATS.forEach((beat) => {
    expectedByBeat.set(beat, []);
    metadataByBeat.set(beat, []);
  });

  collectExpectedStoryCircleText(expectedByBeat, brief, scope);
  collectFinalStoryCircleMetadata(metadataByBeat, expectedByBeat, story, scope);

  STORY_CIRCLE_BEATS.forEach((beat) => {
    const expected = uniqueStrings(expectedByBeat.get(beat) ?? []);
    const metadata = metadataByBeat.get(beat) ?? [];
    const localizedMatches = metadata.flatMap((item) => {
      const localizedProse = proseForEvidenceItem(proseSegments, item);
      if (!localizedProse || !textProvesExpectation(localizedProse, item.text)) {
        return [];
      }
      return [{
        text: `final prose matches "${trimForEvidence(item.text)}"`,
        episodeIndex: item.episodeIndex,
        sceneIndex: item.sceneIndex,
      }];
    });
    const proseMatches: Array<{ text: string; episodeIndex?: number; sceneIndex?: number }> = localizedMatches.length > 0
      ? localizedMatches
      : metadata.length === 0
        ? expected
          .filter((text) => textProvesExpectation(prose, text))
          .map((text) => ({ text: `final prose matches "${trimForEvidence(text)}"` }))
        : [];

    if (proseMatches.length > 0) {
      const first = proseMatches.find((match) => match.episodeIndex !== undefined || match.sceneIndex !== undefined)
        ?? metadata[0];
      beats[beat] = {
        beat,
        status: 'realized',
        expected,
        evidence: proseMatches.map((match) => match.text),
        firstEpisodeIndex: first?.episodeIndex,
        firstSceneIndex: first?.sceneIndex,
      };
      return;
    }

    if (metadata.length > 0 || expected.length > 0) {
      const first = metadata[0];
      beats[beat] = {
        beat,
        status: 'metadata-only',
        expected,
        evidence: metadata.map((item) => item.text),
        firstEpisodeIndex: first?.episodeIndex,
        firstSceneIndex: first?.sceneIndex,
      };
      return;
    }

    beats[beat] = {
      beat,
      status: 'missing',
      expected: [],
      evidence: [],
    };
  });

  const missingBeats = STORY_CIRCLE_BEATS.filter((beat) => beats[beat].status === 'missing');
  const metadataOnlyBeats = STORY_CIRCLE_BEATS.filter((beat) => beats[beat].status === 'metadata-only');
  const activeBeats = collectActiveStoryCircleBeats(brief, scope);
  const scopedMissingBeats = activeBeats.size > 0
    ? missingBeats.filter((beat) => activeBeats.has(beat))
    : missingBeats;
  const scopedMetadataOnlyBeats = activeBeats.size > 0
    ? metadataOnlyBeats.filter((beat) => {
      if (!activeBeats.has(beat)) return false;
      const expected = beats[beat].expected;
      return expected.length > 0 || beats[beat].status === 'metadata-only';
    })
    : metadataOnlyBeats;
  const order = checkStoryCircleOrder(beats);

  return {
    beats,
    missingBeats: scopedMissingBeats,
    metadataOnlyBeats: scopedMetadataOnlyBeats,
    ordered: order.ordered,
    orderedViolation: order.violation,
    hasStoryCircleEvidence: STORY_CIRCLE_BEATS.some((beat) => beats[beat].status !== 'missing'),
  };
}

function collectActiveStoryCircleBeats(
  brief?: Record<string, any>,
  scope: StoryCircleEvidenceScope = { partialSeason: false },
): Set<StoryCircleBeat> {
  const active = new Set<StoryCircleBeat>();
  const episodes = brief?.seasonPlan?.episodes;
  if (!Array.isArray(episodes)) return active;
  for (const episode of episodes) {
    if (!scopeIncludesEpisode(scope, episode?.episodeNumber ?? episode?.number)) continue;
    for (const beat of storyCircleRoleBeats(episode?.storyCircleRole)) {
      active.add(beat);
    }
  }
  return active;
}

function storyCircleEvidenceScope(story?: Story | null): StoryCircleEvidenceScope {
  const generatedOutputScope = (story as any)?.generatedOutputScope;
  const episodes = Array.isArray((story as any)?.episodes) ? (story as any).episodes : [];
  const generatedEpisodeNumbers = new Set<number>();
  episodes.forEach((episode: any, index: number) => {
    const number = typeof episode?.number === 'number' ? episode.number : index + 1;
    generatedEpisodeNumbers.add(number);
  });
  const range = generatedOutputScope?.generatedEpisodeRange;
  if (range && typeof range.startEpisode === 'number' && typeof range.endEpisode === 'number') {
    for (let n = range.startEpisode; n <= range.endEpisode; n += 1) generatedEpisodeNumbers.add(n);
  }
  return {
    partialSeason: Boolean(generatedOutputScope?.isPartialSeason),
    generatedEpisodeNumbers: generatedEpisodeNumbers.size > 0 ? generatedEpisodeNumbers : undefined,
  };
}

function scopeIncludesEpisode(scope: StoryCircleEvidenceScope, episodeNumber: unknown): boolean {
  if (!scope.partialSeason || !scope.generatedEpisodeNumbers || scope.generatedEpisodeNumbers.size === 0) return true;
  return typeof episodeNumber === 'number' && scope.generatedEpisodeNumbers.has(episodeNumber);
}

function collectExpectedStoryCircleText(
  expectedByBeat: Map<StoryCircleBeat, string[]>,
  brief?: Record<string, any>,
  scope: StoryCircleEvidenceScope = { partialSeason: false },
): void {
  if (!brief) {
    return;
  }

  if (!scope.partialSeason) {
    addStoryCircleStructure(expectedByBeat, brief.seasonPlan?.storyCircle);
    addStoryCircleStructure(expectedByBeat, brief.multiEpisode?.sourceAnalysis?.storyCircle);
  }

  const seasonContracts = brief.seasonPlan?.storyCircleBeatContracts;
  if (Array.isArray(seasonContracts)) {
    seasonContracts
      .filter((contract: any) => scopeIncludesEpisode(scope, contract?.targetEpisodeNumber))
      .forEach((contract: any) => addContractExpectedText(expectedByBeat, contract));
  }

  const sourceContracts = brief.multiEpisode?.sourceAnalysis?.storyCircleBeatContracts;
  if (Array.isArray(sourceContracts)) {
    sourceContracts
      .filter((contract: any) => scopeIncludesEpisode(scope, contract?.targetEpisodeNumber))
      .forEach((contract: any) => addContractExpectedText(expectedByBeat, contract));
  }

  const episodes = brief.seasonPlan?.episodes;
  if (Array.isArray(episodes)) {
    episodes.filter((episode: any) => scopeIncludesEpisode(scope, episode?.episodeNumber ?? episode?.number)).forEach((episode: any) => {
      addStoryCircleRoleText(expectedByBeat, episode?.storyCircleRole, episode?.summary);
    });
  }

  const breakdown = brief.multiEpisode?.sourceAnalysis?.episodeBreakdown;
  if (Array.isArray(breakdown)) {
    breakdown.filter((episode: any) => scopeIncludesEpisode(scope, episode?.episodeNumber ?? episode?.number)).forEach((episode: any) => {
      addStoryCircleRoleText(expectedByBeat, episode?.storyCircleRole, episode?.summary);
    });
  }
}

function collectFinalStoryCircleMetadata(
  metadataByBeat: Map<StoryCircleBeat, Array<{ text: string; episodeIndex?: number; sceneIndex?: number }>>,
  expectedByBeat: Map<StoryCircleBeat, string[]>,
  story?: Story | null,
  scope: StoryCircleEvidenceScope = { partialSeason: false },
): void {
  const episodes = Array.isArray((story as any)?.episodes) ? (story as any).episodes : [];
  episodes.forEach((episode: any, episodeIndex: number) => {
    addEpisodeCircleMetadata(metadataByBeat, expectedByBeat, episode?.episodeCircle, episodeIndex);
    addStoryCircleRoleMetadata(metadataByBeat, expectedByBeat, episode?.storyCircleRole, episode?.title, episodeIndex);

    const scenes = Array.isArray(episode?.scenes) ? episode.scenes : [];
    scenes.forEach((scene: any, sceneIndex: number) => {
      const contracts = scene?.storyCircleBeatContracts ?? scene?.storyCircleContracts ?? scene?.beatRealizationContracts;
      if (Array.isArray(contracts)) {
        contracts.forEach((contract: any) => {
          const beat = normalizeStoryCircleBeat(contract?.beat ?? contract?.storyCircleBeat ?? contract?.targetBeat);
          if (!beat) {
            return;
          }
          if (!scopeIncludesEpisode(scope, contract?.targetEpisodeNumber ?? episode?.number ?? episodeIndex + 1)) {
            return;
          }
          const text = contract?.sourceText ?? contract?.target ?? contract?.requirement ?? contract?.description ?? contract?.summary;
          pushBeatMetadata(metadataByBeat, beat, text ?? `scene ${scene.id ?? sceneIndex + 1} contract`, episodeIndex, sceneIndex);
          pushExpectedText(expectedByBeat, beat, text);
        });
      }

      const target = normalizeStoryCircleBeat(scene?.encounterStoryCircleTarget ?? scene?.storyCircleTarget);
      if (target) {
        pushBeatMetadata(metadataByBeat, target, `encounter target ${target}`, episodeIndex, sceneIndex);
      }
    });
  });
}

function addStoryCircleStructure(
  expectedByBeat: Map<StoryCircleBeat, string[]>,
  storyCircle?: Partial<StoryCircleStructure>,
): void {
  if (!storyCircle || typeof storyCircle !== 'object') {
    return;
  }
  STORY_CIRCLE_BEATS.forEach((beat) => pushExpectedText(expectedByBeat, beat, storyCircle[beat]));
}

function addContractExpectedText(expectedByBeat: Map<StoryCircleBeat, string[]>, contract: any): void {
  const beat = normalizeStoryCircleBeat(contract?.beat ?? contract?.storyCircleBeat ?? contract?.targetBeat);
  if (!beat) {
    return;
  }
  pushExpectedText(
    expectedByBeat,
    beat,
    contract?.sourceText ?? contract?.target ?? contract?.requirement ?? contract?.description ?? contract?.summary,
  );
}

function addStoryCircleRoleText(
  expectedByBeat: Map<StoryCircleBeat, string[]>,
  role: unknown,
  summary: unknown,
): void {
  const roles = normalizeStoryCircleRoles(role);
  roles.forEach((beat) => pushExpectedText(expectedByBeat, beat, summary));
}

function addEpisodeCircleMetadata(
  metadataByBeat: Map<StoryCircleBeat, Array<{ text: string; episodeIndex?: number; sceneIndex?: number }>>,
  expectedByBeat: Map<StoryCircleBeat, string[]>,
  episodeCircle: unknown,
  episodeIndex: number,
): void {
  if (!episodeCircle || typeof episodeCircle !== 'object') {
    return;
  }
  STORY_CIRCLE_BEATS.forEach((beat) => {
    const text = (episodeCircle as any)[beat];
    if (typeof text === 'string' && text.trim().length > 0) {
      pushBeatMetadata(metadataByBeat, beat, text, episodeIndex);
      pushExpectedText(expectedByBeat, beat, text);
    }
  });
}

function addStoryCircleRoleMetadata(
  metadataByBeat: Map<StoryCircleBeat, Array<{ text: string; episodeIndex?: number; sceneIndex?: number }>>,
  expectedByBeat: Map<StoryCircleBeat, string[]>,
  role: unknown,
  title: unknown,
  episodeIndex: number,
): void {
  normalizeStoryCircleRoles(role).forEach((beat) => {
    const text = typeof title === 'string' ? `episode role ${beat}: ${title}` : `episode role ${beat}`;
    pushBeatMetadata(metadataByBeat, beat, text, episodeIndex);
    pushExpectedText(expectedByBeat, beat, typeof title === 'string' ? title : undefined);
  });
}

function pushBeatMetadata(
  metadataByBeat: Map<StoryCircleBeat, Array<{ text: string; episodeIndex?: number; sceneIndex?: number }>>,
  beat: StoryCircleBeat,
  text: unknown,
  episodeIndex?: number,
  sceneIndex?: number,
): void {
  const value = typeof text === 'string' && text.trim().length > 0 ? text.trim() : beat;
  metadataByBeat.get(beat)?.push({ text: value, episodeIndex, sceneIndex });
}

function pushExpectedText(expectedByBeat: Map<StoryCircleBeat, string[]>, beat: StoryCircleBeat, text: unknown): void {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return;
  }
  expectedByBeat.get(beat)?.push(text.trim());
}

function normalizeStoryCircleRoles(role: unknown): StoryCircleBeat[] {
  if (Array.isArray(role)) {
    return role.map(normalizeStoryCircleBeat).filter(Boolean) as StoryCircleBeat[];
  }
  const beat = normalizeStoryCircleBeat(role);
  return beat ? [beat] : [];
}

function normalizeStoryCircleBeat(value: unknown): StoryCircleBeat | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  return STORY_CIRCLE_BEATS.includes(normalized as StoryCircleBeat)
    ? (normalized as StoryCircleBeat)
    : undefined;
}

function storyCircleConceptId(beat: StoryCircleBeat): string {
  return {
    you: 'you_known_world_pressure',
    need: 'need_active_want_lack',
    go: 'go_threshold_crossing',
    search: 'search_adaptation_pressure',
    find: 'find_apparent_victory',
    take: 'take_real_price',
    return: 'return_prize_wound',
    change: 'change_transformation_equilibrium',
  }[beat];
}

function checkStoryCircleOrder(beats: Record<StoryCircleBeat, StoryCircleBeatEvidence>): { ordered: boolean; violation?: string } {
  let previousOrder = -1;
  let previousBeat: StoryCircleBeat | undefined;
  for (const beat of STORY_CIRCLE_BEATS) {
    const evidence = beats[beat];
    if (evidence.status !== 'realized' || evidence.firstEpisodeIndex === undefined) {
      continue;
    }
    const order = evidence.firstEpisodeIndex * 1000 + (evidence.firstSceneIndex ?? 0);
    if (order < previousOrder) {
      return {
        ordered: false,
        violation: `Story Circle beat "${beat}" appears before "${previousBeat}" in final chronology.`,
      };
    }
    previousOrder = order;
    previousBeat = beat;
  }
  return { ordered: true };
}

function textProvesExpectation(prose: string, expectation: string): boolean {
  const tokens = meaningfulTokens(expectation);
  if (tokens.length === 0) {
    return false;
  }
  const requiredMatches = tokens.length <= 3 ? tokens.length : Math.min(tokens.length, Math.max(4, Math.ceil(tokens.length * 0.35)));
  const matches = tokens.filter((token) => prose.includes(token)).length;
  return matches >= requiredMatches;
}

function meaningfulTokens(text: string): string[] {
  return uniqueStrings(
    text
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4 && !STOPWORDS.has(token))
      .slice(0, 24),
  );
}

function collectStaticStorySignals(story?: Story | null): StaticStorySignals {
  const finalStoryPresent = Boolean(story);
  const episodes = Array.isArray((story as any)?.episodes) ? (story as any).episodes : [];
  let sceneCount = 0;
  let beatCount = 0;
  let majorScenesWithoutTurn = 0;
  let totalChoices = 0;
  let meaningfulChoices = 0;
  let choicesWithConsequences = 0;
  const invalidEncounterTargets: string[] = [];
  const prose: string[] = [];

  episodes.forEach((episode: any) => {
    const scenes = Array.isArray(episode?.scenes) ? episode.scenes : [];
    scenes.forEach((scene: any) => {
      sceneCount += 1;
      const beats = Array.isArray(scene?.beats) ? scene.beats : [];
      beatCount += beats.length;
      const addChoice = (choice: any) => {
        totalChoices += 1;
        if (typeof choice?.text === 'string') {
          prose.push(choice.text);
        }
        if (typeof choice?.outcomeText === 'string') {
          prose.push(choice.outcomeText);
        }

        const hasConsequence = Array.isArray(choice?.consequences) && choice.consequences.length > 0;
        const hasMemory = Boolean(choice?.memoryImpact ?? choice?.residue ?? choice?.flagEffects ?? choice?.relationshipEffects);
        const hasRoute = Boolean(choice?.nextSceneId ?? choice?.targetSceneId ?? choice?.goto ?? choice?.branchId);
        const hasCheck = Boolean(choice?.statCheck ?? choice?.skillCheck ?? choice?.check);
        if (hasConsequence || hasMemory) {
          choicesWithConsequences += 1;
        }
        if (hasConsequence || hasMemory || hasRoute || hasCheck) {
          meaningfulChoices += 1;
        }
      };

      beats.forEach((beat: any) => {
        if (typeof beat?.text === 'string') {
          prose.push(beat.text);
        }
        const beatChoices = Array.isArray(beat?.choices) ? beat.choices : [];
        beatChoices.forEach(addChoice);
      });

      const hasTurnEvidence = Boolean(
        scene?.turnContract ??
          scene?.sceneTurn ??
          scene?.dramaticTurn ??
          scene?.sceneTurnRealization ??
          scene?.turnType,
      );
      if (beats.length > 0 && !hasTurnEvidence) {
        majorScenesWithoutTurn += 1;
      }

      const encounterTarget = scene?.encounterStoryCircleTarget ?? scene?.storyCircleTarget;
      if ((scene?.isEncounter || scene?.encounter || encounterTarget) && encounterTarget) {
        const target = String(encounterTarget);
        if (!['go', 'search', 'find', 'take'].includes(target)) {
          invalidEncounterTargets.push(target);
        }
      }

      const choices = Array.isArray(scene?.choices) ? scene.choices : [];
      choices.forEach(addChoice);
    });
  });

  const leakageScan = detectLeakage(prose.join('\n'));
  return {
    finalStoryPresent,
    sceneCount,
    beatCount,
    majorScenesWithoutTurn,
    totalChoices,
    meaningfulChoices,
    choicesWithConsequences,
    leakage: leakageScan.findings,
    // v4 calibration: "repeated or central" means the SAME pattern recurs or
    // leakage is pervasive (3+ total occurrences). v3 counted distinct patterns
    // once each, so two single slips hit the harsh 49 cap while fifty
    // occurrences of one pattern did not.
    repeatedOrCentralLeakage: leakageScan.maxPatternOccurrences >= 2 || leakageScan.totalOccurrences >= 3,
    invalidEncounterTargets: uniqueStrings(invalidEncounterTargets),
    cosmeticBranching: totalChoices > 0 && meaningfulChoices === 0,
  };
}

function collectFinalProse(story?: Story | null): string[] {
  return collectFinalProseSegments(story).map((segment) => segment.text);
}

function collectFinalProseSegments(story?: Story | null): FinalProseSegment[] {
  const prose: FinalProseSegment[] = [];
  const episodes = Array.isArray((story as any)?.episodes) ? (story as any).episodes : [];
  episodes.forEach((episode: any, episodeIndex: number) => {
    const scenes = Array.isArray(episode?.scenes) ? episode.scenes : [];
    scenes.forEach((scene: any, sceneIndex: number) => {
      if (typeof scene?.title === 'string') {
        prose.push({ text: scene.title, episodeIndex, sceneIndex });
      }
      const beats = Array.isArray(scene?.beats) ? scene.beats : [];
      beats.forEach((beat: any) => {
        if (typeof beat?.text === 'string') {
          prose.push({ text: beat.text, episodeIndex, sceneIndex });
        }
        const beatChoices = Array.isArray(beat?.choices) ? beat.choices : [];
        beatChoices.forEach((choice: any) => {
          if (typeof choice?.text === 'string') {
            prose.push({ text: choice.text, episodeIndex, sceneIndex });
          }
          if (typeof choice?.outcomeText === 'string') {
            prose.push({ text: choice.outcomeText, episodeIndex, sceneIndex });
          }
        });
      });
      const choices = Array.isArray(scene?.choices) ? scene.choices : [];
      choices.forEach((choice: any) => {
        if (typeof choice?.text === 'string') {
          prose.push({ text: choice.text, episodeIndex, sceneIndex });
        }
        if (typeof choice?.outcomeText === 'string') {
          prose.push({ text: choice.outcomeText, episodeIndex, sceneIndex });
        }
      });
    });
  });
  return prose;
}

function proseForEvidenceItem(
  segments: FinalProseSegment[],
  item: { episodeIndex?: number; sceneIndex?: number },
): string {
  const scoped = segments.filter((segment) =>
    (item.episodeIndex === undefined || segment.episodeIndex === item.episodeIndex)
    && (item.sceneIndex === undefined || segment.sceneIndex === item.sceneIndex),
  );
  return scoped.map((segment) => segment.text).join('\n').toLowerCase();
}

interface LeakageScan {
  findings: QualityFinding[];
  totalOccurrences: number;
  maxPatternOccurrences: number;
}

function detectLeakage(prose: string): LeakageScan {
  if (!prose.trim()) {
    return { findings: [], totalOccurrences: 0, maxPatternOccurrences: 0 };
  }
  let totalOccurrences = 0;
  let maxPatternOccurrences = 0;
  const findings = LEAKAGE_PATTERNS.flatMap(({ pattern, label }) => {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    const count = Array.from(prose.matchAll(new RegExp(pattern.source, flags))).length;
    if (count === 0) {
      return [];
    }
    totalOccurrences += count;
    maxPatternOccurrences = Math.max(maxPatternOccurrences, count);
    return [
      {
        id: makeFindingId('leakage-scan', label, 'error'),
        severity: 'error' as const,
        source: 'leakage-scan',
        validator: 'QualityScoreV4',
        message: `Player-facing prose contains ${label}${count > 1 ? ` (${count} occurrences)` : ''}.`,
        mappedDomain: 'gameplay_mechanics_as_fiction' as const,
        conceptId: 'fiction_first_presentation',
      },
    ];
  });
  return { findings, totalOccurrences, maxPatternOccurrences };
}

function readQualitySidecarFindings(outputDir?: string): SidecarFinding[] {
  if (!outputDir) {
    return [];
  }
  const fs = getNodeFs();
  if (!fs) {
    return [];
  }

  try {
    if (!fs.existsSync(outputDir)) {
      return [];
    }
    const files = fs.readdirSync(outputDir).filter((file: string) =>
      /(?:narrative-diagnostics|incremental-contract|branch-metrics|treatment-density-report|residue-ledger|season-canon)\.json$/.test(file),
    );
    return files.flatMap((file: string) => extractSidecarFindings(file, readJsonFile(fs, `${outputDir.replace(/\/$/, '')}/${file}`)));
  } catch {
    return [];
  }
}

interface WeightOverrides {
  domainWeights: Map<string, number>;
  conceptWeights: Map<string, Map<string, number>>;
}

function readWeightOverrides(weightsMarkdownPath?: string): WeightOverrides | undefined {
  const fs = getNodeFs();
  if (!fs) {
    return undefined;
  }

  const candidates = uniqueStrings([
    weightsMarkdownPath ?? '',
    typeof process !== 'undefined' ? `${process.cwd()}/docs/QUALITY_SCORE_WEIGHTS.md` : '',
    typeof process !== 'undefined' ? `${process.cwd()}/../docs/QUALITY_SCORE_WEIGHTS.md` : '',
  ]);

  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) {
        return parseWeightMarkdown(fs.readFileSync(candidate, 'utf8'));
      }
    } catch {
      // Ignore malformed/unreadable override files and fall back to typed defaults.
    }
  }

  return undefined;
}

function parseWeightMarkdown(markdown: string): WeightOverrides {
  const overrides: WeightOverrides = {
    domainWeights: new Map(),
    conceptWeights: new Map(),
  };
  let mode: 'none' | 'categories' | 'concepts' = 'none';
  let currentDomain = '';

  markdown.split(/\r?\n/).forEach((line) => {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      const title = stripHeadingWeight(heading[1].trim());
      if (normalizeWeightLabel(title) === 'category weights') {
        mode = 'categories';
        currentDomain = '';
        return;
      }
      currentDomain = normalizeWeightLabel(title);
      mode = 'concepts';
      if (!overrides.conceptWeights.has(currentDomain)) {
        overrides.conceptWeights.set(currentDomain, new Map());
      }
      return;
    }

    if (!line.trim().startsWith('|') || line.includes('---')) {
      return;
    }
    const cells = line
      .split('|')
      .map((cell) => cell.trim())
      .filter(Boolean);
    if (cells.length < 2 || /^category$/i.test(cells[0]) || /^concept$/i.test(cells[0])) {
      return;
    }

    const label = normalizeWeightLabel(cells[0]);
    const weight = parseWeightValue(cells[1]);
    if (weight === undefined) {
      return;
    }

    if (mode === 'categories') {
      overrides.domainWeights.set(label, weight);
    } else if (mode === 'concepts' && currentDomain) {
      overrides.conceptWeights.get(currentDomain)?.set(label, weight);
    }
  });

  return overrides;
}

function parseWeightValue(value: string): number | undefined {
  const match = value.match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    return undefined;
  }
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stripHeadingWeight(value: string): string {
  return value.replace(/\s*(?:--|-|—)\s*\d+(?:\.\d+)?%?\s*$/, '').trim();
}

function normalizeWeightLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/→|->/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function extractSidecarFindings(file: string, data: any): SidecarFinding[] {
  if (!data || typeof data !== 'object') {
    return [];
  }
  const findings: SidecarFinding[] = [];
  const source = `sidecar:${file}`;

  if (Array.isArray(data.checks)) {
    data.checks.forEach((check: any) => {
      const passed =
        check?.passed === true ||
        check?.status === 'passed' ||
        (typeof check?.score === 'number' && check.score >= 80);
      if (passed) {
        return;
      }
      findings.push({
        severity: check?.severity === 'critical' ? 'critical' : check?.severity === 'error' ? 'error' : 'warning',
        source,
        validator: check?.name ?? check?.id,
        message: check?.message ?? check?.summary ?? `${check?.name ?? 'diagnostic check'} did not pass.`,
      });
    });
  }

  ['blockingIssues', 'errors', 'warnings', 'suggestions', 'issues'].forEach((key) => {
    const values = data[key];
    if (!Array.isArray(values)) {
      return;
    }
    values.forEach((issue: any) => {
      const severity: QualitySeverity =
        key === 'blockingIssues' || key === 'errors'
          ? 'error'
          : key === 'suggestions'
            ? 'suggestion'
            : 'warning';
      findings.push({
        severity,
        source,
        validator: issue?.validator ?? issue?.type ?? issue?.id,
        message: stringifyMessage(issue),
        location: issue?.path ?? issue?.location,
      });
    });
  });

  if (file.includes('branch-metrics')) {
    const branchScore = normalizeScore(data.branchDivergenceScore ?? data.divergenceScore ?? data.meaningfulBranchScore);
    if (branchScore !== undefined && branchScore < 60) {
      findings.push({
        severity: 'error',
        source,
        validator: 'BranchMetrics',
        message: `Branch divergence score is ${branchScore}, indicating cosmetic or residue-free branching.`,
      });
    }
  }

  return findings;
}

function getNodeFs(): any | undefined {
  try {
    const getBuiltinModule = (typeof process !== 'undefined'
      ? (process as unknown as { getBuiltinModule?: (mod: string) => unknown }).getBuiltinModule
      : undefined);
    if (typeof getBuiltinModule === 'function') {
      const builtin = getBuiltinModule('fs');
      if (builtin) {
        return builtin;
      }
    }
    const req = (Function('return typeof require !== "undefined" ? require : null'))() as
      | ((mod: string) => unknown)
      | null;
    return req ? req('fs') : undefined;
  } catch {
    return undefined;
  }
}

function readJsonFile(fs: any, filePath: string): any {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return undefined;
  }
}

function legacyFinalStoryContractScore(report?: FinalStoryContractReport | null): number | undefined {
  if (!report) {
    return undefined;
  }
  const blocking = report.blockingIssues?.length ?? 0;
  const warnings = report.warnings?.length ?? 0;
  const metrics = report.metrics;
  const mechanicalLeaks =
    (metrics?.mechanicsLeaks ?? 0) +
    (metrics?.designNoteLeaks ?? 0) +
    (metrics?.requestedEpisodesMissing ?? 0) +
    (metrics?.failedIncrementalResults ?? 0);
  const validEncounterScenes = metrics?.validEncounterScenes ?? 0;
  const encounterScenesChecked = metrics?.encounterScenesChecked ?? 0;
  const encounterPenalty =
    encounterScenesChecked > 0
      ? Math.max(0, Math.round(((encounterScenesChecked - validEncounterScenes) / encounterScenesChecked) * 25))
      : 0;
  return clampScore(100 - blocking * 18 - warnings * 5 - mechanicalLeaks * 10 - encounterPenalty);
}

function stringifyMessage(issue: any): string {
  if (typeof issue === 'string') {
    return issue;
  }
  if (issue?.message) {
    return String(issue.message);
  }
  if (issue?.summary) {
    return String(issue.summary);
  }
  return JSON.stringify(issue);
}

function normalizeScore(score: unknown): number | undefined {
  return typeof score === 'number' && Number.isFinite(score) ? clampScore(score) : undefined;
}

function clampScore(score: number): number {
  if (!Number.isFinite(score)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function trimForEvidence(value: string): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length > 140 ? `${trimmed.slice(0, 137)}...` : trimmed;
}

function makeFindingId(source: string, message: string, severity: QualitySeverity): string {
  return `${source}:${severity}:${message}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 160);
}
