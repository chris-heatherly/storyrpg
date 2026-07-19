/**
 * Choice Author Agent
 *
 * The player decision point specialist responsible for:
 * - Creating meaningful player choices with proper stakes
 * - Designing consequences for each option
 * - Ensuring choices reflect the Stakes Triangle
 * - Crafting compelling dilemmas and branching points
 */

import { AgentConfig, GenerationSettingsConfig } from '../config';
import { FALLBACK_OUTCOME_TEXT_POOLS, isFallbackOutcomeText, isFallbackReminderStub } from '../constants/choiceTextFallbacks';
import { BaseAgent, AgentResponse, TruncatedLLMResponseError } from './BaseAgent';
import { SceneBlueprint } from './StoryArchitect';
import {
  Choice,
  ChoiceAffordanceSource,
  ChoiceConsequenceTier,
  ChoiceFeedbackCue,
  ChoiceImpactFactor,
  ChoiceIntent,
  ChoiceType,
  Consequence,
  ConsequenceDomain,
  ConditionExpression,
  FiveFactorImpact,
  ReminderPlan,
  StakesLayers,
} from '../../types';
import type { StoryVerb } from '../utils/storyVerbs';
import { buildForbiddenLexicalReveals, formatForbiddenRevealsSection } from '../utils/forbiddenReveals';
import type { RelationshipEvidenceTag, RelationshipValueAxis } from '../../types/relationshipValue';
import {
  SourceMaterialAnalysis,
  StoryAnchors,
  StoryCircleRoleAssignment,
  StoryCircleStructure,
} from '../../types/sourceAnalysis';
import type { SeasonResidueObligation } from '../../types/seasonPlan';
import type { ConsequenceTier, MechanicPressureContract, RelationshipPacingContract } from '../../types/scenePlan';
import type { NarrativeStateContract } from '../../types/narrativeContract';
import { normalizeRelationshipKey } from '../utils/relationshipArcLedger';
import {
  effectiveNpcDeltaCap,
  isNpcPacingContract,
  mergeSceneRelationshipPacing,
} from '../utils/effectiveRelationshipPacing';
// Phase 1.4: STAKES_TRIANGLE / CHOICE_GEOMETRY / FIVE_FACTOR_TEST are delivered
// via the shared CORE_STORYTELLING_PROMPT (BaseAgent system prompt) and no
// longer re-embedded here, to eliminate token duplication and drift risk.
import { FiveFactorValidator } from '../validators/FiveFactorValidator';
import { StakesTriangleValidator } from '../validators/StakesTriangleValidator';
import { stabilizeByHysteresis } from '../remediation/judgeStabilizer';
import { isGateEnabled } from '../remediation/gateDefaults';
import { buildChoiceAuthorCallbackSection } from '../prompts/callbackPromptSection';
import { buildStructuralContextSection } from '../prompts/storytellingPrinciples';
import { CHOICE_AUTHOR_RESIDUE_EXAMPLE } from '../prompts/examples/storyCraftExamples';
import { DEFAULT_LIMITS } from '../utils/textEnforcer';
import { buildChoiceSetJsonSchema } from '../schemas/choiceSetSchema';
import {
  materializeSharedChoiceResolution,
  withReplacedSharedChoiceResolution,
} from '../pipeline/choiceSharedResolution';
import { normalizeChoiceStatCheck } from '../utils/statCheckNormalization';
import {
  normalizeCanonicalConsequences,
} from '../utils/canonicalChoiceConsequences';
import { authorFacingMechanicPressureText } from '../utils/treatmentFieldContracts';
import { isUnsafeCallbackProse } from '../constants/metaProse';

/**
 * Bucket C soft-gate decision for the LLM-judged stakes score.
 *
 * Pure + deterministic (no LLM, no env read inside) so it can be unit-tested at
 * the threshold seam. When `stabilizationEnabled` is false this reduces to the
 * historical hard gate (`score < failThreshold`). When enabled, a borderline
 * score in `[failThreshold - margin, failThreshold)` is treated as a pass, so it
 * does NOT trigger a revision — avoiding noise-driven regeneration churn.
 *
 * @returns true when the score should be treated as a stakes-quality FAILURE
 *          (i.e. the regeneration/revision path should run).
 */
export function shouldFailStakesScore(
  score: number,
  failThreshold: number,
  hysteresisMargin: number,
  stabilizationEnabled: boolean,
): boolean {
  return stabilizeByHysteresis(
    score,
    failThreshold,
    stabilizationEnabled ? hysteresisMargin : 0,
  );
}

function flattenDirectLanguageFragments(sourceAnalysis?: SourceMaterialAnalysis): string[] {
  const fragments = sourceAnalysis?.directLanguageFragments;
  if (!fragments) return [];
  if (Array.isArray(fragments)) {
    return fragments.map((fragment) => fragment.text).filter(Boolean);
  }
  return [
    ...(Array.isArray(fragments.dialogue) ? fragments.dialogue : []),
    ...(Array.isArray(fragments.prose) ? fragments.prose : []),
    ...(Array.isArray(fragments.terminology) ? fragments.terminology : []),
  ].filter(Boolean);
}

// Input types
export interface ChoiceAuthorInput {
  // Scene context
  sceneBlueprint: SceneBlueprint;
  beatText: string; // The beat text leading up to this choice
  beatId: string;

  // B1 (Season Canon): sealed read-only facts to honor ("ESTABLISHED CANON — do not
  // contradict"); pre-formatted by SeasonCanon.canonForPrompt.
  establishedCanon?: string;

  // Story context
  storyContext: {
    title: string;
    genre: string;
    tone: string;
    userPrompt?: string;
    worldContext?: string;
  };

  // Character context
  protagonistInfo: {
    name: string;
    pronouns: 'he/him' | 'she/her' | 'they/them';
  };

  npcsInScene: Array<{
    id: string;
    name: string;
    pronouns: 'he/him' | 'she/her' | 'they/them';
    description: string;
    voiceNotes?: string;
    physicalDescription?: string;
  }>;

  // Available state for conditions
  availableFlags: Array<{ name: string; description: string }>;
  /** Authored flag contracts whose consequences must be earned by the option's action. */
  authoredFlagContracts?: Array<{ name: string; description: string }>;
  /** Canonical season state ids; aliases are diagnostic-only and must never be emitted. */
  canonicalStateContracts?: Array<Pick<NarrativeStateContract, 'canonicalStateId' | 'aliases' | 'sourceEpisodeNumber' | 'targetEpisodeNumbers'>>;
  /** Canonical states whose authored setter surface is required in this episode. */
  requiredCanonicalStateIds?: string[];
  availableScores: Array<{ name: string; description: string }>;
  availableTags: Array<{ name: string; description: string }>;

  // Scene connections (where can this choice lead?)
  possibleNextScenes: Array<{
    id: string;
    name: string;
    description: string;
    /** Next scene's location — when it differs from this scene's, outcomes must land a motivated departure. */
    location?: string;
  }>;

  /**
   * Branch-recovery directive: author EXACTLY one choice routing to each target below,
   * each choice's wording fitting that target's authored intent. Set on a per-target
   * regeneration after a first attempt failed to fan out a branch point — so the LLM
   * writes a real, coherent choice per branch instead of falling back to templates.
   */
  requiredBranchTargets?: Array<{ sceneId: string; intent: string }>;

  // Guidance
  optionCount: number; // Reader-facing choice sets must have 3-4 options

  // Source material analysis for IP fidelity (optional)
  sourceAnalysis?: SourceMaterialAnalysis;

  /**
   * Season-level narrative anchors (from SeasonPlan.anchors). Keeps the
   * Stakes Triangle on every choice rooted in the SAME shared stakes as
   * the rest of the season.
   */
  seasonAnchors?: StoryAnchors;

  /** Primary season-level Story Circle beat map. */
  seasonStoryCircle?: StoryCircleStructure;

  /** Primary Story Circle beat(s) this episode carries. */
  episodeStoryCircleRole?: StoryCircleRoleAssignment[];
  /** Episode-level fractal Story Circle from StoryArchitect. */
  episodeCircle?: StoryCircleStructure;

  // Pipeline memory / optimization hints from prior runs (optional)
  memoryContext?: string;

  // Growth templates from GrowthConsequenceBuilder (development scenes only)
  growthTemplates?: {
    skillOptions: Array<{ skill: string; change: number }>;
    mentorship?: {
      attribute: string;
      change: number;
      npcId: string;
      npcName: string;
      condition: unknown;
      narrativeHook: string;
    };
  };

  // Branch topology context (Phase 1.1). Tells ChoiceAuthor whether this
  // beat is a true branch point (needs nextSceneId routing), a tinted choice,
  // or a reconvergence beat where state reconciliation should be expressed
  // via conditional text.
  branchContext?: {
    role: 'bottleneck' | 'branch' | 'reconvergence' | 'linear';
    isBranchPoint?: boolean;
    expectedBranches?: number;
    reconvergenceTargets?: string[];
    stateReconciliationHints?: string[];
  };

  /**
   * Season-assigned consequence tier for this scene's central choice.
   * The 60/25/10/5-style mix is allocated at season-plan time; ChoiceAuthor
   * should realize this scene's assigned tier, not rebalance an episode locally.
   */
  plannedConsequenceTier?: ConsequenceTier;

  // Character arc milestone targets (Phase 7.3). ChoiceAuthor aligns
  // consequence design with planned identity/relationship deltas.
  arcTargets?: {
    identityDeltaHints?: Array<{ dimension: string; direction: 'positive' | 'negative'; magnitude: 'minor' | 'moderate' | 'major' }>;
    relationshipTrajectory?: Array<{ npcId: string; dimension: string; direction: 'positive' | 'negative'; hint: string }>;
  };

  // Unresolved callback hooks from prior episodes (Plan 1: Delayed Consequences).
  // ChoiceAuthor MAY gate a new choice's `conditions` on one of these flags.
  // ChoiceAuthor also tags notable new choices with `memorableMoment` for
  // future episodes to pay off.
  unresolvedCallbacks?: Array<{
    id: string;
    sourceEpisode: number;
    summary: string;
    flags: string[];
    conditionKeys?: string[];
    impactFactors?: ChoiceImpactFactor[];
    consequenceTier?: ChoiceConsequenceTier;
  }>;

  /** Planned residue obligations assigned to this choice point to create. */
  outgoingResidueObligations?: SeasonResidueObligation[];
  /** Planned residue obligations this choice text may help pay off. */
  dueResidueObligations?: SeasonResidueObligation[];
  /** Consequential flags that should not be invented outside the planned residue contract. */
  disallowedUnplannedResidueFlags?: string[];

  // Genre/source-specific verbs that make choices feel native to the story.
  storyVerbs?: StoryVerb[];
}

const MIN_READER_CHOICES = 3;
const MAX_READER_CHOICES = 4;

function normalizeReaderChoiceCount(count: number | undefined): number {
  if (!Number.isFinite(count)) return MIN_READER_CHOICES;
  return Math.max(MIN_READER_CHOICES, Math.min(MAX_READER_CHOICES, Math.floor(count!)));
}

// Output types
export interface StakesAnnotation {
  want: string;
  cost: string;
  identity: string;
}

export interface GeneratedChoice extends Choice {
  // Additional metadata for review/debugging
  stakesAnnotation?: StakesAnnotation;
  authorNotes?: string;
  consequenceDomain?: ConsequenceDomain;
  reminderPlan?: ReminderPlan;
  feedbackCue?: ChoiceFeedbackCue;
}

export interface ChoiceSet {
  beatId: string;
  sceneId?: string;
  choiceType: ChoiceType;
  choices: GeneratedChoice[];
  /** LLM-authored route-invariant payoff, projected into every playable outcome. */
  sharedResolutionText?: string;

  // Overall stakes for this decision point
  overallStakes: StakesAnnotation;
  overallStakesLayers?: StakesLayers;

  // Design notes
  designNotes: string;
}

export class ChoiceAuthor extends BaseAgent {
  private fiveFactorValidator: FiveFactorValidator;
  private stakesValidator: StakesTriangleValidator;
  private minStakesScore = 60; // Minimum quality score for stakes
  // Bucket C judge-stabilization: how far below minStakesScore an LLM-judged
  // stakes score must fall before we trust the failure and trigger a revision.
  // Only applied when GATE_JUDGE_STABILIZATION === '1'; default-off keeps the
  // prior hard `< minStakesScore` behavior. See remediation/judgeStabilizer.ts.
  private stakesHysteresisMargin = 5;
  private choiceLimits: {
    maxChoiceWords: number;
    minChoices: number;
    maxChoices: number;
  };
  private choiceDistribution: {
    expression: number;
    relationship: number;
    strategic: number;
    dilemma: number;
  };
  private maxBranchingChoicesPerEpisode: number;

  // 1.7: running count of skills exercised by statChecks this agent has seen,
  // used to rotate auto-assigned default skills off the persuasion/investigation
  // monoculture toward >=5/6 attribute coverage across the season.
  private skillUsage: Record<string, number> = {};
  // Per-episode favoured skill order from the SeasonSkillPlan (P2-skills). Biases
  // skill selection/rebalance toward the season-planned spread so the whole season
  // exercises >=6 skills and no skill dominates. Empty = no plan (pure least-used).
  private episodeSkillTargets: string[] = [];
  // How far a skill's season usage must exceed the least-used relevant skill before
  // an authored single-skill statCheck is rebalanced onto the under-used one.
  private static readonly SKILL_REBALANCE_GAP = 2;
  // Hard cap on any one skill's share of total stat-check weight across the season.
  // When a skill is already at/over this share, an authored single-skill check on it
  // is rebalanced onto an under-used relevant skill EVEN IF the pairwise gap is below
  // SKILL_REBALANCE_GAP — this is what breaks the "perception carries 43%" monopoly
  // the gen-5 audit flagged (the pairwise gap alone let a dominant skill keep growing).
  private static readonly SKILL_DOMINANCE_CAP = 0.30;
  // Below this many total stat-checks the dominance cap is not enforced (small samples
  // make the share meaningless — one check is trivially 100%).
  private static readonly SKILL_DOMINANCE_MIN_SAMPLE = 4;
  // Candidate skills per choice type, ordered to lead away from the historical
  // persuasion-first default. Selection picks the least-used among these.
  // persuasion is confined to `relationship` (it was previously in `dilemma` too,
  // which let it carry ~40-46% of all stat-check weight); the other types pull
  // from the wider skill set so checks spread across all eight canonical skills.
  private static readonly RELEVANT_SKILLS: Record<string, string[]> = {
    relationship: ['persuasion', 'deception', 'intimidation', 'perception'],
    strategic: ['investigation', 'perception', 'stealth', 'athletics', 'survival'],
    dilemma: ['survival', 'investigation', 'athletics', 'intimidation', 'deception'],
  };

  /**
   * Set the favoured skill order for the episode currently being authored (from the
   * SeasonSkillPlan). ChoiceAuthor is a single persistent instance per run, so this
   * is called once per episode before its choices are authored.
   */
  setEpisodeSkillTargets(skills: string[] | undefined): void {
    this.episodeSkillTargets = Array.isArray(skills) ? skills : [];
  }

  constructor(config: AgentConfig, generationConfig?: GenerationSettingsConfig) {
    super('Choice Author', config);
    this.includeSystemPrompt = true;
    this.fiveFactorValidator = new FiveFactorValidator(config);
    this.stakesValidator = new StakesTriangleValidator(config);
    
    // Use generation config or fall back to defaults
    this.choiceLimits = {
      maxChoiceWords: generationConfig?.maxChoiceWords ?? DEFAULT_LIMITS.maxChoiceWords,
      minChoices: generationConfig?.minChoices ?? DEFAULT_LIMITS.minChoices,
      maxChoices: generationConfig?.maxChoices ?? DEFAULT_LIMITS.maxChoices,
    };
    
    // Choice type distribution targets (percentages, must sum to 100)
    // Types describe player experience. Branching is a separate cap.
    this.choiceDistribution = {
      expression: generationConfig?.choiceDistExpression ?? 35,
      relationship: generationConfig?.choiceDistRelationship ?? 30,
      strategic: generationConfig?.choiceDistStrategic ?? 20,
      dilemma: generationConfig?.choiceDistDilemma ?? 15,
    };
    
    // Branching is a property of any non-expression choice, not a type.
    // This caps how many choices per episode can route to different scenes.
    this.maxBranchingChoicesPerEpisode = generationConfig?.maxBranchingChoicesPerEpisode ?? 2;
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Choice Author

You craft the decision points that define the player's journey. Every choice you create should feel meaningful, weighty, and revealing of character.

(Stakes Triangle, Choice Geometry, and the Five-Factor Test are in the shared system prompt. Apply them rigorously — every choice must name Want/Cost/Identity and move at least one of Outcome/Process/Information/Relationship/Identity.)

## Choice Types (STRICT CATEGORIZATION)
Choice types describe the PLAYER EXPERIENCE, not structural routing:
- **expression**: Personality/voice choices, cosmetic, no plot impact. NEVER branches. (~${this.choiceDistribution?.expression ?? 35}% frequency)
- **relationship**: Bond building with NPCs. Affect trust, affection, respect, or fear. May branch. (~${this.choiceDistribution?.relationship ?? 30}% frequency)
- **strategic**: Skill/stat-based choices, investigation and discovery. May branch. (~${this.choiceDistribution?.strategic ?? 20}% frequency)
- **dilemma**: Value testing, high impact, no clearly right answer. May branch. (~${this.choiceDistribution?.dilemma ?? 15}% frequency)

IMPORTANT: Use EXACTLY these type names (expression, relationship, strategic, dilemma). Do NOT use "flavor", "information", "blind", or "branching".

## Branching (NOT a Choice Type)
Branching (routing to different scenes via nextSceneId) is a PROPERTY of a choice, not a type.
- Any relationship, strategic, or dilemma choice may include nextSceneId to route to a different scene.
- Expression choices must NEVER include nextSceneId.
- Maximum ${this.maxBranchingChoicesPerEpisode} branching choice sets per episode.
- When the scene blueprint has \`branches: true\`, include nextSceneId on each choice option.
- Encounter outcomes (victory/defeat/escape) are the PRIMARY branching mechanism.

## Type-Specific Requirements (ENFORCED)
- **dilemma** choices must include a \`moralContract\` object. It names competing value A, competing value B, the unavoidable cost, who benefits, who is harmed, and what remains uncertain. Dilemmas are not good/bad or optimal/suboptimal; each option protects one value under pressure and sacrifices another.
- Every meaningful non-expression choice must leave at least one residue through \`residueHints\`: immediate prose echo, later textVariant, relationship behavior, encounter advantage/complication, visual staging hint, or recap summary. Keep residue sparse and fictional, not mechanical.
- Hidden capability should appear as affordance, not visible stats: empathy reveals emotional tells, wit reveals contradictions, courage unlocks bold action, resolve unlocks endurance/refusal, resourcefulness reveals improvised paths, charm unlocks social openings. Do not expose numbers, odds, dice, or stat names in player-facing prose.
- **expression**: Must set at least one flag (e.g., "was_sarcastic", "chose_humor") for callback tracking. NPCs should be able to reference the player's personality later. NEVER include statCheck.
- **relationship**: Must include at least one consequence of type "relationship" (shifting trust, affection, respect, or fear with a specific NPC).
- **strategic**: Must include statCheck on at least one option (attribute or skill check with difficulty). The player's build should matter.
- **dilemma**: Must include statCheck on at least one option. Must have consequences on every option. No option should be obviously better than the others.

## Choice Design Principles
- **Avoid False Choices**: No options that lead to the same outcome or reveal the same info.
- **Stakes Triangle**: Every choicePoint MUST define Want, Cost, and Identity.
- **Author All Options**: Every dialogue option must be a legitimate, in-character line.
- **Choice Text**: 5-${this.choiceLimits?.maxChoiceWords ?? DEFAULT_LIMITS.maxChoiceWords} words, active voice, present tense, from protagonist perspective.
- **Option Count**: Provide ${this.choiceLimits?.minChoices ?? DEFAULT_LIMITS.minChoices}-${this.choiceLimits?.maxChoices ?? DEFAULT_LIMITS.maxChoices} choices per decision point.
- **Tint Flags**: Dilemma choices should set tint flags (e.g., "tint:mercy", "tint:justice") that color subsequent scene tone.
- **Callback Flags**: Expression choices should set memorable flags that NPCs can reference in later dialogue.
- **Consequence Legibility**: Meaningful choices should name the domain they most affect: relationship, reputation, danger, information, identity, leverage, or resource.
- **Turns over topics**: Each option should create a visible fiction-first turn, not merely reveal the same information in a different tone. Good turns change trust, evidence, leverage, secrecy pressure, proximity, risk, identity expression, resources, knowledge, or callback residue.
- **Answer the beat**: Read the beat text before authoring. If it just raised a hook — an unfamiliar term, a warning, a question aimed at the protagonist, a charged gesture — at least one option must let the player engage that hook directly (ask what it means, press the warning, answer the question). Choices that talk past what was just said read as unresponsive.
- **No obvious best option**: In any choice with stakes, every option must cost something a reasonable player might care about, and the risk/reward must genuinely compete. If you can rank the options best-to-worst without knowing the player, rewrite them: give the "safe" option a hidden price (lost information, cooled bond, closed door) and the "risky" option a real prize.
- **Reminder Planning as Story Memory**: reminderPlan and residueHints should point to visible story changes: colder distance, evidence now in someone else's hands, a secret harder to deny, altered access, changed reputation, or a later callback.
- **Reminder Planning**: Every meaningful choice should include an immediate echo and a short-term reminder plan.
- **Risk Framing**: Use fiction-first feedback cues such as "steady", "desperate", "you have leverage", or "you're out of your depth" instead of exposing numbers.

## Mechanical Storytelling Reactivity
- A meaningful choice should change what the world permits, what an NPC believes, how future choices read, or what failure creates.
- Prefer micro-reactivity over extra branches: callbacks, residue, scene tints, witness comments, altered prose, relationship tone, locked/unlocked options, and visual staging.
- Hidden state should surface as affordance: prior mercy, trust, items, tags, skills, promises, lies, and callback hooks should open, color, or close options.
- Failure should create playable story material: debt, suspicion, injury, lost leverage, exposure, obligation, damaged trust, or changed position.
- Use storyVerb metadata so choices feel native to the world, not generic.

## Condition Usage

Use conditions to:
- Lock choices behind requirements (skills, flags)
- Show locked choices with explanatory text
- Create different options for different character builds
- Gate choices behind identity dimensions (e.g., only show "merciful" option to players who have been merciful)

### Identity Conditions (NEW)
The player accumulates an identity profile from their choices. You can gate choices on identity:
\`{ "type": "identity", "dimension": "mercy_justice", "operator": "<", "value": -20 }\`
Available dimensions: mercy_justice, idealism_pragmatism, cautious_bold, loner_leader, heart_head, honest_deceptive
(Negative = first trait, Positive = second trait. E.g., mercy_justice: -50 = very merciful, +50 = very just)
Use identity conditions sparingly (1-2 per episode max) to reward consistent roleplaying.

## Consequence Types

- **setFlag**: Boolean state changes (use "tint:xxx" prefix for dilemma tint flags, normal names for callbacks)
- **changeScore**: Modify numeric values
- **addTag** / **removeTag**: Identity markers (use for character traits that emerge from choices)
- **relationship changes**: Trust, affection, respect, fear
- **attribute changes**: Core stats (rarely)

## Delayed Consequences (Butterfly Effect)

For meaningful choices, some consequences should NOT fire immediately. Instead, they fire later as callbacks:
- Use \`delayedConsequences\` array on choices to queue effects that trigger later
- Each delayed consequence has: consequence (the actual effect), description (human-readable), delay ({type: "scenes"|"episodes", count: N}), and optional triggerCondition
- Example: A player insults a merchant → 3 scenes later, the merchant's cousin refuses to help them
- Use sparingly: 1-2 delayed consequences per episode for maximum dramatic impact
- These create the "butterfly effect" where small choices ripple forward unpredictably

## Example Good Choices

### Flavor Choice (Free)
"How do you greet the merchant?"
- Wave casually
- Offer a formal bow
- Just get to business

### Branching Choice (Moderate)
"The guards are distracted. Do you..."
- Slip through the side door (leads to: scene-stealth-entry)
- Create a distraction and walk in boldly (leads to: scene-bold-entry)
- Wait for a better opportunity (leads to: scene-wait-longer)

### Dilemma (Identity-Defining)
"Marcus is trapped, but the diamond is right there..."
- Save Marcus (Want: loyalty | Cost: the score | Identity: puts people first)
- Grab the diamond (Want: the job | Cost: a friend | Identity: the mission matters more)

${CHOICE_AUTHOR_RESIDUE_EXAMPLE}

## Character Names and Pronouns

**CRITICAL**: When writing choice text or resolution text:
1. Use EXACT character names as provided - do not invent or alter names
2. Use CORRECT pronouns for each character based on their specified pronouns:
   - "he/him": he, him, his, himself
   - "she/her": she, her, hers, herself  
   - "they/them": they, them, their, theirs, themselves (singular) — only for characters explicitly marked as they/them
3. Use he/him or she/her by default. Only use they/them for characters explicitly designated as non-binary or transgender.
4. Be consistent throughout all choice text and resolutions

## Quality Checks

Before finalizing:
- Does every option feel valid?
- Are consequences proportional to choice weight?
- Would each option be chosen by SOMEONE?
- Is the dilemma genuinely hard?
`;
  }

  async execute(rawInput: ChoiceAuthorInput): Promise<AgentResponse<ChoiceSet>> {
    const input: ChoiceAuthorInput = {
      ...rawInput,
      optionCount: normalizeReaderChoiceCount(rawInput.optionCount),
    };
    const prompt = this.buildCompactPrompt(input);
    const jsonSchema = this.buildJsonSchema(input);

    console.log(`[ChoiceAuthor] Creating choices for beat: ${input.beatId}`);

    try {
      let firstResponse: string;
      try {
        firstResponse = await this.callLLM(
          [{ role: 'user', content: prompt }],
          1,
          { jsonSchema: this.buildCompactRetryJsonSchema(input) },
        );
      } catch (llmError) {
        if (!(llmError instanceof TruncatedLLMResponseError)) throw llmError;
        console.warn(`[ChoiceAuthor] ${input.beatId}: structured response truncated before parse — retrying with a compact-output directive.`);
        firstResponse = '';
      }

      console.log(`[ChoiceAuthor] Received response (${firstResponse.length} chars)`);

      // Parse, with one focused compact retry: a full choice set is heavy output that
      // weaker models truncate mid-JSON, and re-running the SAME oversized prompt (the
      // phase-level retry) tends to truncate again. A retry that asks for the same
      // content in a more COMPACT form is far more likely to fit and parse.
      const { choiceSet: parsedSet, response } = await this.parseChoiceSetWithCompactRetry(input, firstResponse);
      let choiceSet: ChoiceSet = parsedSet;
      let rawResponse = response;

      const completenessIssues = this.collectChoiceAuthoringCompletenessIssues(choiceSet, input);
      if (completenessIssues.length > 0) {
        const issueList = completenessIssues.map((issue, index) => `${index + 1}. ${issue}`).join('\n');
        console.warn(
          `[ChoiceAuthor] ${input.beatId}: choice set omitted required authoring fields — retrying before normalization.\n${issueList}`,
        );
        const retryPrompt =
          this.buildCompactRepairPrompt(input, issueList);
        rawResponse = await this.callLLM(
          [{ role: 'user', content: retryPrompt }],
          4,
          { jsonSchema },
        );
        choiceSet = this.parseJSON<ChoiceSet>(rawResponse);
        const retryIssues = this.collectChoiceAuthoringCompletenessIssues(choiceSet, input);
        if (retryIssues.length > 0) {
          throw new Error(
            `ChoiceAuthor retry still omitted required authoring fields: ${retryIssues.join('; ')}`,
          );
        }
      }

      // Normalize arrays that the LLM might return as strings or undefined
      // Pass the input so we can use blueprint stakes as fallback
      choiceSet = this.normalizeChoiceSet(choiceSet, input);

      console.log(`[ChoiceAuthor] Choice set has ${choiceSet.choices?.length || 0} choices`);

      // Validate the choices (structural). Production authoring must not synthesize
      // reader-facing reaction/residue prose. If normalization changes routing and
      // makes a previously conditional field required, the completeness check below
      // routes the set through the focused ChoiceAuthor repair surface.
      this.validateChoices(choiceSet, input, { allowSyntheticReaderTextFallbacks: false });

      const postNormalizationIssues = this.collectChoiceAuthoringCompletenessIssues(choiceSet, input);
      if (postNormalizationIssues.length > 0) {
        console.warn(
          `[ChoiceAuthor] ${input.beatId}: normalization left required authoring fields incomplete — ` +
          `running a focused prose repair. ${postNormalizationIssues.join('; ')}`,
        );
        const revisionResult = await this.executeRevision(input, choiceSet, postNormalizationIssues);
        const revisedIssues = revisionResult.data
          ? this.collectChoiceAuthoringCompletenessIssues(revisionResult.data, input)
          : postNormalizationIssues;
        if (!revisionResult.success || !revisionResult.data || revisedIssues.length > 0) {
          throw new Error(
            `ChoiceAuthor post-normalization repair still omitted required authoring fields: ${revisedIssues.join('; ')}`,
          );
        }
        choiceSet = revisionResult.data;
        rawResponse = revisionResult.rawResponse ?? rawResponse;
      }
      this.validateAuthoredFlagSemantics(choiceSet, input);

      // Choice variants and residue fields are a separate producer surface
      // from SceneWriter prose. Enforce relationship pacing here so a blocked
      // label such as "friend" cannot be introduced by a choice author after
      // the scene writer correctly staged a first meeting at spark.
      const relationshipLabelIssues = this.collectBlockedRelationshipLabelIssues(choiceSet, input);
      if (relationshipLabelIssues.length > 0) {
        const revisionResult = await this.executeRevision(input, choiceSet, relationshipLabelIssues);
        if (revisionResult.success && revisionResult.data && this.collectBlockedRelationshipLabelIssues(revisionResult.data, input).length < relationshipLabelIssues.length) {
          choiceSet = revisionResult.data;
          rawResponse = revisionResult.rawResponse ?? rawResponse;
        }
      }

      // For dilemma choices or choices that branch, run LLM quality validation with feedback loop
      const hasBranching = choiceSet.choices.some(c => c.nextSceneId);
      if (choiceSet.choiceType === 'dilemma' || hasBranching) {
        const issues = await this.validateChoiceQuality(choiceSet, input);

        // If there are quality issues, attempt revision
        if (issues.length > 0) {
          console.log(`[ChoiceAuthor] Found ${issues.length} quality issues, attempting revision...`);
          const revisionResult = await this.executeRevision(input, choiceSet, issues);

          if (revisionResult.success && revisionResult.data) {
            // Re-validate the revised content (but don't loop again to avoid infinite revision)
            const revisedIssues = await this.validateChoiceQuality(revisionResult.data, input);
            if (revisedIssues.length < issues.length) {
              console.log(`[ChoiceAuthor] Revision improved quality: ${issues.length} -> ${revisedIssues.length} issues`);
              choiceSet = revisionResult.data;
              rawResponse = revisionResult.rawResponse ?? rawResponse;
            } else {
              console.log(`[ChoiceAuthor] Revision did not improve quality, using original`);
            }
          }
        }
      }

      // Authoring-time stub repair: normalizeChoiceSet fills any tier the LLM
      // omitted with a deterministic fallback line. Historically those stubs
      // shipped and were only caught by OutcomeTextQualityValidator at the
      // episode/season contract (`outcome_text_stub` — the #1 recent run
      // blocker), burning a full contract round before the focused re-author
      // ran. Run that same focused re-author HERE, while the choice is being
      // authored, so a stub tier costs one small LLM call now instead of a
      // contract failure later. The contract gate stays on as the regression net.
      if (isGateEnabled('GATE_CHOICE_OUTCOME_TIER_REAUTHOR')) {
        await this.reauthorStubOutcomeTiers(choiceSet, input);
      }
      materializeSharedChoiceResolution(choiceSet);

      return {
        success: true,
        data: choiceSet,
        rawResponse,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[ChoiceAuthor] Error:`, errorMsg);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  private collectBlockedRelationshipLabelIssues(choiceSet: ChoiceSet, input: ChoiceAuthorInput): string[] {
    const contracts = input.sceneBlueprint.relationshipPacing ?? [];
    if (contracts.length === 0) return [];
    const blocked = contracts.flatMap((contract) => contract.blockedLabels ?? []).filter(Boolean);
    if (blocked.length === 0) return [];
    const issues: string[] = [];
    const surfaces = (choice: Choice): string[] => [
      choice.text,
      choice.lockedText,
      choice.reactionText,
      choice.feedbackCue?.echoSummary,
      choice.feedbackCue?.progressSummary,
      choice.reminderPlan?.immediate,
      choice.reminderPlan?.shortTerm,
      choice.reminderPlan?.later,
      ...(choice.outcomeTexts ? Object.values(choice.outcomeTexts) : []),
      ...(choice.residueHints ?? []).map((hint) => hint.description),
    ].filter((value): value is string => typeof value === 'string');
    const sharedResolution = choiceSet.sharedResolutionText ?? '';
    for (const label of blocked) {
      if (new RegExp(`\\b${label.replace(/[.*+?^${}()|[\\]\\]/g, '\\\\$&')}\\b`, 'i').test(sharedResolution)) {
        issues.push(`Shared choice resolution uses blocked early relationship label "${label}".`);
      }
    }
    for (const choice of choiceSet.choices ?? []) {
      const text = surfaces(choice).join(' ');
      for (const label of blocked) {
        if (new RegExp(`\\b${label.replace(/[.*+?^${}()|[\\]\\]/g, '\\\\$&')}\\b`, 'i').test(text)) {
          issues.push(`Choice "${choice.id}" uses blocked early relationship label "${label}". Rewrite it as provisional spark, guarded warmth, invitation, or testing at the current earned stage.`);
        }
      }
    }
    return issues;
  }

  /**
   * Parse the choice-set JSON, with ONE focused compact retry. A full choice set is
   * the agent's heaviest output (3–5 choices × {stakes, consequences, three 1–3
   * sentence outcome tiers}), and weaker models truncate it mid-JSON — which either
   * throws (unterminated string) or parses to a set with DROPPED choices (parseJSON's
   * truncation recovery). Re-running the same oversized prompt (the phase-level retry)
   * tends to truncate again; a retry that asks for the SAME content more COMPACTLY is
   * far more likely to fit and parse. Only fires on a failure/truncation, so a clean
   * first response (including every golden/_transportOverride run) keeps the
   * single-call path. A still-failing compact retry rethrows, so execute() fails and
   * the phase falls back exactly as before.
   */
  private async parseChoiceSetWithCompactRetry(
    input: ChoiceAuthorInput,
    firstResponse: string,
  ): Promise<{ choiceSet: ChoiceSet; response: string }> {
    try {
      const choiceSet = this.parseJSON<ChoiceSet>(firstResponse);
      const choiceCount = Array.isArray(choiceSet.choices) ? choiceSet.choices.length : 0;
      if (!this.wasLastResponseTruncated() && choiceCount >= MIN_READER_CHOICES) {
        return { choiceSet, response: firstResponse };
      }
      const reason = this.wasLastResponseTruncated()
        ? 'truncation dropped content'
        : `only ${choiceCount} choice(s) were returned`;
      console.warn(`[ChoiceAuthor] ${input.beatId}: response parsed but ${reason} — retrying with a compact-output directive.`);
    } catch (parseError) {
      const msg = parseError instanceof Error ? parseError.message : String(parseError);
      console.warn(`[ChoiceAuthor] ${input.beatId}: JSON parse failed (${msg.slice(0, 120)}) — retrying with a compact-output directive.`);
    }
    const compactPrompt = this.buildCompactRepairPrompt(
      input,
      'Previous response was incomplete or too long. Re-emit the complete ChoiceSet in compact form.',
    );
    const response = await this.callLLM(
      [{ role: 'user', content: compactPrompt }],
      4,
      { jsonSchema: this.buildCompactRetryJsonSchema(input) },
    );
    const choiceSet = this.parseJSON<ChoiceSet>(response); // rethrows on failure → execute() fails → phase falls back
    const choiceCount = Array.isArray(choiceSet.choices) ? choiceSet.choices.length : 0;
    if (choiceCount < MIN_READER_CHOICES) {
      throw new Error(`ChoiceAuthor compact retry returned only ${choiceCount} choice(s); refusing to synthesize placeholder choices.`);
    }
    return { choiceSet, response };
  }

  private buildJsonSchema(input: ChoiceAuthorInput) {
    const choicePoint = input.sceneBlueprint.choicePoint;
    return buildChoiceSetJsonSchema({
      choiceType: choicePoint?.type,
      branching: Boolean(choicePoint?.branches || input.requiredBranchTargets?.length),
      optionCount: input.optionCount,
      requiresSharedResolution: this.choiceResolutionTasks(input).length > 0,
    });
  }

  private buildCompactRetryJsonSchema(input: ChoiceAuthorInput) {
    const choicePoint = input.sceneBlueprint.choicePoint;
    const schema = buildChoiceSetJsonSchema({
      choiceType: choicePoint?.type,
      branching: Boolean(choicePoint?.branches || input.requiredBranchTargets?.length),
      optionCount: input.optionCount,
      compact: true,
      requiresSharedResolution: this.choiceResolutionTasks(input).length > 0,
    });
    return {
      ...schema,
      name: 'choice_set_compact_retry',
      maxOutputTokens: 6144,
    };
  }

  private buildCompactRepairPrompt(input: ChoiceAuthorInput, issueList: string): string {
    const choicePoint = input.sceneBlueprint.choicePoint!;
    const isBranching = Boolean(choicePoint.branches || input.requiredBranchTargets?.length);
    const meaningful = choicePoint.type !== 'expression';
    const nextScenes = input.possibleNextScenes
      .slice(0, Math.max(4, input.optionCount))
      .map(scene => `${scene.id}: ${scene.name} — ${scene.description}`)
      .join('\n');
    const branchTargets = input.requiredBranchTargets?.length
      ? input.requiredBranchTargets.map(t => `${t.sceneId}: ${t.intent}`).join('\n')
      : '';
    const optionHints = (choicePoint.optionHints || []).slice(0, input.optionCount).join(' | ');
    const choiceResolutionSection = this.buildChoiceResolutionTaskSection(input);
    const requiresSharedResolution = choiceResolutionSection.length > 0;
    const departureHandoffSection = this.buildDepartureHandoffSection(input);

    return `Return one complete compact ChoiceSet JSON object. The deterministic schema is supplied by the caller; match it exactly. Return ONLY JSON.

Repair reason:
${issueList}

Scene: ${input.sceneBlueprint.id} / ${input.sceneBlueprint.name} / ${input.sceneBlueprint.location}
Beat id: ${input.beatId}
Beat text: ${String(input.beatText || '').slice(0, 900)}
Allowed acting cast: ${[input.protagonistInfo.name, ...input.npcsInScene.map((npc) => npc.name)].join(', ')}. Do not introduce, rename, or substitute any other acting person in reader-facing choice prose.

Choice point:
- type: ${choicePoint.type}
- options: exactly ${input.optionCount}
- description: ${choicePoint.description}
- option hints: ${optionHints || 'author fitting alternatives from the scene'}
- stakes.want: ${choicePoint.stakes.want}
- stakes.cost: ${choicePoint.stakes.cost}
- stakes.identity: ${choicePoint.stakes.identity}
${isBranching ? `Next scene targets:\n${branchTargets || nextScenes || 'Use available next scenes from schema context.'}` : ''}${choiceResolutionSection ? `\n${choiceResolutionSection}` : ''}${departureHandoffSection ? `\n${departureHandoffSection}` : ''}

Required choice fields:
${requiresSharedResolution ? '- Top level: beatId, choiceType, choices, overallStakes, designNotes, sharedResolutionText.\n' : ''}- Every choice: id, text, choiceType, choiceIntent, impactFactors, consequenceTier, stakesAnnotation, consequences, outcomeTexts.
${isBranching ? '- Every choice must include nextSceneId.' : '- Every choice must include reactionText and tintFlag.'}
${meaningful ? '- Every choice must include statCheck.skillWeights, statCheck.difficulty, and at least one residueHints item.' : '- Expression choices must not include statCheck.'}
${choicePoint.type === 'dilemma' ? '- Every choice must include moralContract.' : ''}

Compactness:
- choice text: 5-${this.choiceLimits?.maxChoiceWords ?? 15} words.
- each stakesAnnotation field: at most 12 words.
- each outcomeTexts tier: exactly one vivid sentence, at most 16 words.
- reactionText: exactly one sentence, at most 16 words.
- residueHints.description: exactly one concrete sentence, at most 16 words.
- designNotes: one short clause, at most 8 words.
- Do not emit authorNotes, witnessReactions, failureResidue, reminderPlan, feedbackCue, visualResidueHint, memorableMoment, stakesLayers, storyVerb, or affordanceSource.

Stat checks for relationship/strategic/dilemma:
- skillWeights object with 1-3 of: athletics, stealth, perception, persuasion, intimidation, deception, investigation, survival.
- exact shape example: {"statCheck":{"skillWeights":{"persuasion":1},"difficulty":45}}

Consequences:
- setFlag shape: {"type":"setFlag","flag":"accepted_quartz","value":true}
- relationship shape: {"type":"relationship","npcId":"char-mihaela-mika-drgan","dimension":"trust","change":5}
- changeScore shape: {"type":"changeScore","score":"blog_reach","change":1}
- never put a flag name in value.
- never add flag/value fields to relationship or score consequences.

Return JSON only.`;
  }

  private collectChoiceAuthoringCompletenessIssues(choiceSet: ChoiceSet, input: ChoiceAuthorInput): string[] {
    const issues: string[] = [];
    const plannedChoiceType = input.sceneBlueprint.choicePoint?.type || choiceSet.choiceType || 'expression';
    const choices = Array.isArray(choiceSet.choices) ? choiceSet.choices : [];

    if (this.choiceResolutionTasks(input).length > 0 && !this.hasMeaningfulText(choiceSet.sharedResolutionText)) {
      issues.push('Choice set omitted sharedResolutionText required by its canonical choice-resolution task.');
    }

    if (choices.length < MIN_READER_CHOICES) {
      issues.push(`Choice set returned only ${choices.length} choice(s); at least ${MIN_READER_CHOICES} authored choices are required.`);
      return issues;
    }

    choices.forEach((choice, index) => {
      const choiceId = choice.id || `choice-${index + 1}`;
      const isBranching = typeof choice.nextSceneId === 'string' && choice.nextSceneId.trim().length > 0;
      if (!isBranching && !this.hasMeaningfulText(choice.reactionText)) {
        issues.push(`Choice "${choiceId}" is non-branching but omitted reactionText.`);
      }
      if (!isBranching && !this.hasMeaningfulText(choice.tintFlag)) {
        issues.push(`Choice "${choiceId}" is non-branching but omitted tintFlag.`);
      }
      if (plannedChoiceType !== 'expression') {
        const skillWeights = choice.statCheck && typeof choice.statCheck === 'object'
          ? (choice.statCheck as { skillWeights?: unknown }).skillWeights
          : undefined;
        const hasSkillWeights = Boolean(
          skillWeights &&
          typeof skillWeights === 'object' &&
          !Array.isArray(skillWeights) &&
          Object.keys(skillWeights as Record<string, unknown>).length > 0,
        );
        if (!hasSkillWeights) {
          issues.push(`Choice "${choiceId}" is ${plannedChoiceType} but omitted statCheck.skillWeights.`);
        }
        const residueHints = Array.isArray(choice.residueHints) ? choice.residueHints : [];
        if (residueHints.length === 0) {
          issues.push(`Choice "${choiceId}" is ${plannedChoiceType} but omitted residueHints.`);
        } else if (!residueHints.some(hint => this.hasMeaningfulText(hint?.description))) {
          issues.push(`Choice "${choiceId}" has residueHints with no concrete description.`);
        }
      }

      for (const consequenceIssue of this.collectConsequenceCompletenessIssues(choice, choiceId, input)) {
        issues.push(consequenceIssue);
      }
    });

    issues.push(...this.collectUnknownActingCharacterIssues(choiceSet, input));

    const routeContract = input.sceneBlueprint.routeRealizationContract;
    if (routeContract?.requiresVisibleResidue && choices.length > 1) {
      const normalizeSurface = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
      const routeSurfaces = choices.map((choice) => normalizeSurface([
        choice.reactionText,
        ...(choice.outcomeTexts ? Object.values(choice.outcomeTexts) : []),
        ...(choice.residueHints ?? []).map((hint) => hint.description),
      ].filter(Boolean).join(' ')));
      if (new Set(routeSurfaces).size !== routeSurfaces.length) {
        issues.push('Two or more non-expression options have identical visible route residue; author distinct immediate reactions/outcomes before convergence.');
      }
    }

    return issues;
  }

  /**
   * Choice prose is a closed-cast owner surface. This deliberately checks only
   * name-shaped tokens used in human-action syntax; capitalized places, titles,
   * organizations, and sentence openers are not findings. The focused author
   * retry remains responsible for rewriting prose.
   */
  private collectUnknownActingCharacterIssues(choiceSet: ChoiceSet, input: ChoiceAuthorInput): string[] {
    const canonicalContext = [
      input.protagonistInfo.name,
      ...input.npcsInScene.map((npc) => npc.name),
    ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0).join(' ');
    const canonicalTokens = new Set(
      Array.from(canonicalContext.matchAll(/[\p{L}][\p{L}'’.-]*/gu), (match) => match[0].toLocaleLowerCase()),
    );
    const prose = [
      choiceSet.sharedResolutionText,
      ...(choiceSet.choices ?? []).flatMap((choice) => [
        choice.reactionText,
        ...(choice.outcomeTexts ? Object.values(choice.outcomeTexts) : []),
      ]),
    ].filter((value): value is string => typeof value === 'string').join(' ');
    const candidates = new Set(
      Array.from(prose.matchAll(/\b\p{Lu}[\p{Ll}.-]{2,}\b/gu), (match) => match[0]),
    );
    const nonNameTokens = new Set([
      'the', 'this', 'that', 'these', 'those', 'what', 'when', 'where', 'why', 'how',
      'your', 'her', 'his', 'their', 'our', 'its',
    ]);
    const issues: string[] = [];
    for (const candidate of candidates) {
      const normalizedCandidate = candidate.toLocaleLowerCase();
      if (nonNameTokens.has(normalizedCandidate) || canonicalTokens.has(normalizedCandidate)) continue;
      const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const actsAsPerson = new RegExp(
        `(?:\\b${escaped}['’]s\\s+(?:face|eyes?|voice|hands?|smile|gaze|expression|shoulders?|phone)|` +
        `\\b(?:you|he|she|they)\\s+(?:and|with|beside)\\s+${escaped}\\b|` +
        `\\b${escaped}\\s+(?:says?|said|asks?|asked|replies?|smiles?|raises?|looks?|turns?|leans?|nods?|laughs?|meets?|takes?|holds?|steps?|watches?|follows?)\\b)`,
        'iu',
      ).test(prose);
      if (!actsAsPerson) continue;
      issues.push(
        `Reader-facing choice prose introduces unknown acting character "${candidate}". ` +
        `Use only the protagonist and canonical scene roster: ${[input.protagonistInfo.name, ...input.npcsInScene.map((npc) => npc.name)].join(', ')}.`,
      );
    }
    return issues;
  }

  private hasMeaningfulText(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }

  private choiceResolutionTasks(input: ChoiceAuthorInput) {
    return (input.sceneBlueprint.realizationTasks ?? []).filter((task) =>
      task.ownerStage === 'choice_author' && task.target.scope === 'all_choice_outcomes',
    );
  }

  /**
   * Repairs only the authored route-invariant payoff. This keeps valid option
   * geometry, consequences, and tier-specific reactions intact instead of
   * regenerating the entire ChoiceSet for one semantic miss.
   */
  public async repairSharedResolution(
    input: ChoiceAuthorInput,
    choiceSet: ChoiceSet,
    feedback: string,
  ): Promise<AgentResponse<ChoiceSet>> {
    const tasks = this.choiceResolutionTasks(input);
    if (tasks.length === 0) {
      return { success: false, error: 'No canonical shared choice-resolution task is assigned to this scene.' };
    }
    const requirements = tasks.flatMap((task) => task.evidenceAtoms.map((atom) => {
      const craft = atom.semanticRole === 'relationship_change'
        ? 'Show an observable personal bid and reciprocal acceptance; a label or group name alone is insufficient.'
        : atom.semanticRole === 'state_change'
          ? 'Show the prior state, causal turn, and changed state.'
          : atom.semanticRole === 'action'
            ? 'Stage the named actor completing the action on-page.'
            : 'Make the required meaning observable on-page.';
      return `- ${atom.description}: ${craft}`;
    }));
    const blockedLabels = Array.from(new Set(
      (input.sceneBlueprint.relationshipPacing ?? []).flatMap((contract) => contract.blockedLabels ?? []),
    ));
    const prompt = `Rewrite ONLY the shared post-choice resolution passage for this interactive-fiction choice set.

The passage is shown after every option and every success/partial/failure result. It must preserve route invariance while completing every required meaning once. Write one or two concise, fiction-first sentences. Do not mention tasks, contracts, validation, choices, outcomes, stats, or mechanics.

CURRENT PASSAGE:
${choiceSet.sharedResolutionText ?? '(missing)'}

VALIDATION FEEDBACK:
${feedback}

REQUIRED MEANINGS:
${requirements.join('\n')}

SCENE CONTEXT:
- Protagonist: ${input.protagonistInfo.name}
- Scene: ${input.sceneBlueprint.name}
- Choice beat: ${input.beatText}
${blockedLabels.length > 0 ? `- Relationship labels not yet earned: ${blockedLabels.join(', ')}` : ''}

Return JSON only: {"sharedResolutionText":"..."}`;
    try {
      const rawResponse = await this.callLLM(
        [{ role: 'user', content: prompt }],
        2,
        {
          jsonSchema: {
            name: 'choice_shared_resolution_repair',
            description: 'A focused authored repair for one route-invariant choice payoff.',
            maxOutputTokens: 512,
            // r116 (2026-07-18): a bare 512-token cap with no outputBudget made
            // this call infeasible on thinking-enabled Gemini models — with no
            // outputBudget declared, the resolver never reserves any room for
            // thinking on top of the 512, so the model's own minimal-reasoning
            // tokens alone consumed nearly the entire cap before any JSON
            // output ("thoughtsTokens: 509" of a 512-token request) and every
            // attempt truncated. Same class of bug, same fix, as the
            // encounter-description re-author (EncounterArchitect.ts) — no
            // totalCeiling, so the resolver computes the true requirement
            // (visible + reasoning + safety) bounded by the provider's actual
            // configured cap, instead of the bare, unreserved 512.
            outputBudget: {
              visibleTokens: 256,
              reasoningProfile: 'minimal',
              safetyTokens: 64,
            },
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['sharedResolutionText'],
              properties: {
                sharedResolutionText: { type: 'string', minLength: 20, maxLength: 600 },
              },
            },
          },
        },
      );
      const parsed = this.parseJSON<{ sharedResolutionText?: string }>(rawResponse);
      const resolution = parsed.sharedResolutionText?.trim();
      if (!resolution) {
        return { success: false, error: 'Focused shared-resolution repair returned no prose.', rawResponse };
      }
      if (isUnsafeCallbackProse(resolution)) {
        return { success: false, error: 'Focused shared-resolution repair returned authoring or system prose.', rawResponse };
      }
      const candidate = withReplacedSharedChoiceResolution(choiceSet, resolution);
      const labelIssues = this.collectBlockedRelationshipLabelIssues(candidate, input);
      if (labelIssues.length > 0) {
        return { success: false, error: labelIssues.join('; '), rawResponse };
      }
      return { success: true, data: candidate, rawResponse };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private buildChoiceResolutionTaskSection(input: ChoiceAuthorInput): string {
    const tasks = this.choiceResolutionTasks(input);
    if (tasks.length === 0) return '';
    return `## Canonical Shared Choice Resolution
Write one fiction-first sharedResolutionText passage that happens after any option resolves and before the route continues. It must naturally realize every requirement below. Do not paste task ids or planning labels. This passage is authored once and will be shown on every option and every outcome tier.
- Keep sharedResolutionText to the MINIMAL invariant fact (what is now true on every route). The emotional texture belongs in each option's own outcomeTexts, which must stay tier-distinct — never let the shared passage carry so much that every outcome reads identical regardless of what the player chose.
${tasks.flatMap((task) => task.evidenceAtoms.map((atom) => `- ${atom.description}: use a natural realization equivalent to ${atom.acceptedPatterns.join(' / ')}`)).join('\n')}`;
  }

  /**
   * G1 (treatment-gap analysis 2026-07-15): when this choice point's scene
   * leads to a different location, the outcome texts are the LAST prose the
   * reader sees before the cut — they must land the motivated departure, or
   * the protagonist teleports (run 20-44-49: rooftop ended on a lingering
   * gaze, next line she was in Cismigiu Gardens).
   */
  private buildDepartureHandoffSection(input: ChoiceAuthorInput): string {
    const here = input.sceneBlueprint.location?.trim();
    const destinations = Array.from(new Set(
      (input.possibleNextScenes ?? [])
        .map((scene) => scene.location?.trim())
        .filter((location): location is string => Boolean(location && (!here || location !== here))),
    ));
    if (destinations.length === 0) return '';
    return `## MOTIVATED DEPARTURE (the story moves to ${destinations.join(' / ')} next)
The next scene is NOT here${here ? ` (currently: ${here})` : ''}. Every outcomeTexts tier must end with the protagonist deciding or beginning to leave, with a visible reason (tiredness, an errand, an escape, a pull toward something) — so arriving at ${destinations.join(' or ')} reads as cause-and-effect, never a teleport. Keep it to one clause inside the existing sentence budget; vary it by tier.
CRITICAL: the departure must point at ${destinations.join(' or ')} and NOWHERE ELSE. Never write "home", "back to the apartment", or any other destination unless it IS the next location — a character who announces going home and then appears at ${destinations[0]} is a continuity error the reader will feel.`;
  }

  private collectConsequenceCompletenessIssues(choice: GeneratedChoice, choiceId: string, input: ChoiceAuthorInput): string[] {
    const issues: string[] = [];
    const consequences = Array.isArray(choice.consequences)
      ? choice.consequences
      : choice.consequences
        ? [choice.consequences as unknown as Consequence]
        : [];

    const canonical = normalizeCanonicalConsequences(consequences);
    for (const rejected of canonical.rejected) {
      issues.push(
        `Choice "${choiceId}" has malformed consequence #${rejected.index + 1}: ${rejected.reason}.`,
      );
    }

    const allowedScores = new Set((input.availableScores ?? []).map((score) => score.name));
    for (const consequence of canonical.consequences) {
      if (consequence.type !== 'changeScore') continue;
      if (typeof consequence.score !== 'string' || !allowedScores.has(consequence.score)) {
        issues.push(
          `Choice "${choiceId}" changes unknown score "${String(consequence.score ?? '')}"; use one of ${Array.from(allowedScores).join(', ') || 'no canonical scores'}.`,
        );
      }
    }

    return issues;
  }

  private normalizeChoiceConsequences(choice: GeneratedChoice): void {
    const canonical = normalizeCanonicalConsequences(choice.consequences || []);
    if (canonical.rejected.length > 0) {
      throw new Error(
        `Choice "${choice.id}" contains non-canonical consequences: ${
          canonical.rejected.map((item) => `#${item.index + 1} ${item.reason}`).join('; ')
        }`,
      );
    }
    choice.consequences = canonical.consequences;
  }

  /**
   * Distinct, tier-appropriate fallback outcome prose for a choice whose LLM-authored
   * `outcomeTexts` were missing. Uses the choice's stakes triangle (want/cost) when
   * present so success leans on the WANT and partial/failure lean on the COST; even
   * without stakes the three tiers lead with different clauses so they never collapse
   * into the identical-copy stub the old fallback produced. Fiction-first: no stats/dice.
   */
  private buildFallbackOutcomeText(
    choice: ChoiceSet['choices'][number],
    tier: 'success' | 'partial' | 'failure',
  ): string {
    // Deterministic, fiction-first fallback used ONLY when the LLM omitted a tier or
    // produced colliding tiers. It must NOT leak authoring scaffolding: an earlier
    // version pasted the stakes `want`/`cost` annotations verbatim behind connectives
    // like "It works — you get what you reached for: <want>." — which shipped
    // design-note text (and lowercased proper nouns, "victor gets a post…") straight
    // into player prose (G10 Bite Me/Endsong). These are intentionally generic in-world
    // beats; the LLM author plus the OutcomeTextQuality validator are the real quality
    // path. Vary the line by the choice id so sibling choices in one scene don't collide
    // and trip the dedupe backstop, and so a stub is at least tier- and choice-distinct.
    // Openers are deliberately varied (object-first, sensory, second-person) so a
    // scene that falls back on several tiers does not produce a run of "You …" /
    // "It …" lines that reads as flat template output (and trips the
    // SentenceOpenerVarietyValidator).
    const pools = FALLBACK_OUTCOME_TEXT_POOLS;
    const id = String(choice.id || choice.text || '');
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    const variants = pools[tier];
    return variants[hash % variants.length];
  }

  /**
   * Focused LLM re-author of a choice's outcome tiers — the final-contract repair
   * seam for `outcome_text_stub` findings. When ChoiceAuthor failed (or partially
   * authored) and a choice shipped with the deterministic stub prose, this rewrites
   * ONLY the named tiers from the choice's own text + stakes triangle, as a small
   * structured call (3 short strings) that succeeds far more reliably than re-running
   * full choice authoring. Returns the authored tiers; the caller replaces a stub only
   * when the new text is non-empty and not itself a stub. Never throws into the loop —
   * a parse/transport failure surfaces as an empty result so the stub simply remains.
   */
  /**
   * Final-contract twin of repairSharedResolution: re-author the
   * route-invariant payoff from minimal context (the full ChoiceAuthorInput is
   * gone by final-contract time). Returns the passage only; the caller
   * projects it into every outcome tier, so deterministic code copies prose
   * but never writes it.
   */
  async reauthorSharedResolutionText(ctx: {
    currentPassage?: string;
    requiredMeanings: string[];
    sceneName?: string;
    protagonistName?: string;
    feedback?: string;
  }): Promise<string | undefined> {
    const prompt = `Rewrite ONLY the shared post-choice resolution passage for one interactive-fiction choice set.

The passage is appended after every option's outcome, so it must hold true on every route. Write one or two concise, fiction-first, second-person sentences. Do not mention tasks, contracts, validation, choices, outcomes, stats, or mechanics.

CURRENT PASSAGE:
${ctx.currentPassage?.trim() || '(missing)'}

REQUIRED MEANINGS (each must be observably dramatized in the passage):
${ctx.requiredMeanings.map((meaning) => `- ${meaning}`).join('\n')}
${ctx.feedback ? `\nVALIDATION FEEDBACK:\n${ctx.feedback}\n` : ''}
SCENE: ${ctx.sceneName || 'the current scene'}
PROTAGONIST: ${ctx.protagonistName || 'the protagonist'}

Return ONLY a JSON object: {"sharedResolutionText":"..."}. No prose outside the JSON.`;
    try {
      const raw = await this.callLLM([{ role: 'user', content: prompt }], 2);
      const parsed = this.parseJSON<{ sharedResolutionText?: unknown }>(raw);
      const value = parsed?.sharedResolutionText;
      if (typeof value === 'string' && value.trim().length >= 12) return value.trim();
      return undefined;
    } catch (err) {
      console.warn(`[ChoiceAuthor] reauthorSharedResolutionText failed: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  }

  /**
   * G4 (treatment-gap analysis 2026-07-15): tier-distinct renderings of the
   * SAME shared resolution. Projecting one identical passage into all nine
   * outcome tiers made the Dusk Club bond a naming ceremony regardless of
   * what the player said (run 20-44-49) — convergent endpoint, distinct
   * residue is the standing outcome-tier principle.
   */
  async reauthorSharedResolutionVariants(ctx: {
    currentPassage?: string;
    requiredMeanings: string[];
    sceneName?: string;
    protagonistName?: string;
    feedback?: string;
    tiers: string[];
  }): Promise<Record<string, string> | undefined> {
    const tiers = ctx.tiers.length > 0 ? ctx.tiers.slice(0, 4) : ['success', 'partial', 'failure'];
    const prompt = `Rewrite the shared post-choice resolution for one interactive-fiction choice set as TIER-DISTINCT prose.

Every outcome tier must land the SAME resolution facts — the route converges — but each tier renders them with its own texture and cost: a clean win reads earned, a partial win reads frayed or provisional, a failure reads fail-forward (the fact still lands, paid for). Never reuse a sentence between tiers. One or two concise, fiction-first, second-person sentences per tier. Do not mention tasks, contracts, validation, choices, outcomes, stats, or mechanics.

CURRENT PASSAGE (previously pasted identically into every tier — replace):
${ctx.currentPassage?.trim() || '(missing)'}

REQUIRED MEANINGS (each must be observably dramatized in EVERY tier):
${ctx.requiredMeanings.map((meaning) => `- ${meaning}`).join('\n')}
${ctx.feedback ? `\nVALIDATION FEEDBACK:\n${ctx.feedback}\n` : ''}
SCENE: ${ctx.sceneName || 'the current scene'}
PROTAGONIST: ${ctx.protagonistName || 'the protagonist'}
TIERS: ${tiers.join(', ')}

Return ONLY a JSON object mapping each tier to its passage: {${tiers.map((tier) => `"${tier}":"..."`).join(',')}}. No prose outside the JSON.`;
    try {
      const raw = await this.callLLM([{ role: 'user', content: prompt }], 2);
      const parsed = this.parseJSON<Record<string, unknown>>(raw);
      if (!parsed) return undefined;
      const variants: Record<string, string> = {};
      for (const tier of tiers) {
        const value = parsed[tier];
        if (typeof value !== 'string' || value.trim().length < 12) return undefined;
        variants[tier] = value.trim();
      }
      const distinct = new Set(Object.values(variants).map((value) => value.toLowerCase()));
      if (distinct.size < Object.keys(variants).length) return undefined;
      return variants;
    } catch (err) {
      console.warn(`[ChoiceAuthor] reauthorSharedResolutionVariants failed: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  }

  async reauthorOutcomeTexts(ctx: {
    choiceText: string;
    stakes?: { want?: string; cost?: string; identity?: string };
    sceneName?: string;
    sceneLocation?: string;
    needTiers: Array<'success' | 'partial' | 'failure'>;
    previousOutcomeTexts?: Partial<Record<'success' | 'partial' | 'failure', string>>;
    siblingChoiceTexts?: string[];
    repairDirective?: string;
  }): Promise<Partial<Record<'success' | 'partial' | 'failure', string>>> {
    const tiers = ctx.needTiers.length ? ctx.needTiers : (['success', 'partial', 'failure'] as const);
    const stakesLines = ctx.stakes
      ? `WANT (what the player is reaching for): ${ctx.stakes.want ?? 'unstated'}\nCOST (what it risks): ${ctx.stakes.cost ?? 'unstated'}`
      : '';
    const settingLine = ctx.sceneLocation
      ? `SETTING (the outcome MUST stay physically consistent with this place — only reference objects/surroundings that plausibly exist here): ${ctx.sceneLocation}\n`
      : '';
    const previousLines = ctx.previousOutcomeTexts
      ? `PREVIOUS OUTCOMES TO REPLACE:\n${tiers.map((tier) => `${tier}: ${ctx.previousOutcomeTexts?.[tier] ?? '(missing)'}`).join('\n')}\n`
      : '';
    const siblingLines = ctx.siblingChoiceTexts?.length
      ? `SIBLING CHOICES THIS OPTION MUST FEEL DIFFERENT FROM:\n${ctx.siblingChoiceTexts.map((text) => `- ${text}`).join('\n')}\n`
      : '';
    const repairLine = ctx.repairDirective
      ? `FOCUSED REPAIR DIRECTIVE: ${ctx.repairDirective}\n`
      : '';
    const prompt = `You are revising the outcome prose for ONE choice in an interactive story. Replace weak, repetitive, missing, or placeholder outcomes with scene-specific fiction.

CHOICE the player takes: "${ctx.choiceText}"
${ctx.sceneName ? `SCENE: ${ctx.sceneName}\n` : ''}${settingLine}${stakesLines}
${previousLines}${siblingLines}${repairLine}

Write a 1–3 sentence fiction-first outcome for each requested tier. Each MUST:
- dramatize what concretely happens in the fiction (action, sensory detail, a line of dialogue if it fits) — never restate the choice or the want/cost annotation;
- make this option's immediate action and NPC/world response unmistakably specific to THIS choice, rather than interchangeable with a sibling option;
- stay grounded in the SETTING above — do not introduce furniture or surroundings from a different kind of place (e.g. no indoor furniture in an outdoor scene);
- be distinct from the other tiers and begin with a different opening word;
- never mention stats, dice, percentages, DCs, or any game mechanic;
- success = the cleaner version of what they reached for; partial = some of it lands but the cost settles in; failure = they miss it and the cost lands.

Return ONLY a JSON object with exactly these keys: ${tiers.join(', ')}. Example: {"success":"…","partial":"…","failure":"…"}. No prose outside the JSON.`;

    try {
      const raw = await this.callLLM([{ role: 'user', content: prompt }], 2);
      const parsed = this.parseJSON<Record<string, unknown>>(raw);
      const out: Partial<Record<'success' | 'partial' | 'failure', string>> = {};
      for (const tier of tiers) {
        const value = parsed?.[tier];
        if (typeof value === 'string' && value.trim().length >= 12) out[tier] = value.trim();
      }
      return out;
    } catch (err) {
      console.warn(`[ChoiceAuthor] reauthorOutcomeTexts failed (stub kept): ${err instanceof Error ? err.message : String(err)}`);
      return {};
    }
  }

  /**
   * Authoring-time counterpart of the final-contract outcome-text repair
   * (`buildOutcomeTextRepairHandler`): scan the just-normalized choice set for
   * tiers that are deterministic fallback stubs and re-author ONLY those tiers
   * via {@link reauthorOutcomeTexts}, before the set ever leaves this agent.
   * A tier is replaced only with real prose (non-empty, not itself a stub, not
   * an echo of the choice label); a failed re-author leaves the stub in place
   * for the contract gate to catch — never worse than the pre-existing path.
   * Mutates the choice set in place; never throws into the authoring flow.
   */
  private async reauthorStubOutcomeTiers(choiceSet: ChoiceSet, input: ChoiceAuthorInput): Promise<void> {
    const tiers = ['success', 'partial', 'failure'] as const;
    const normalize = (value: unknown): string =>
      String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const beatSnippet = (input.beatText || '').trim();
    const sceneLocation = beatSnippet.length >= 12
      ? (beatSnippet.length > 200 ? `${beatSnippet.slice(0, 200)}…` : beatSnippet)
      : undefined;

    for (const choice of choiceSet.choices ?? []) {
      const ot = choice.outcomeTexts;
      if (!ot) continue;
      const needTiers = tiers.filter((tier) => isFallbackOutcomeText(ot[tier]));
      if (needTiers.length === 0) continue;

      console.warn(
        `[ChoiceAuthor] Choice "${choice.id}" carries ${needTiers.length} stub outcome tier(s) ` +
        `(${needTiers.join(', ')}) — re-authoring at generation time.`,
      );
      const authored = await this.reauthorOutcomeTexts({
        choiceText: String(choice.text || choice.id || 'the choice'),
        stakes: choice.stakesAnnotation,
        sceneName: input.sceneBlueprint?.name,
        sceneLocation,
        needTiers,
      });
      let replaced = 0;
      for (const tier of needTiers) {
        const value = authored[tier];
        if (
          typeof value === 'string'
          && value.trim().length >= 12
          && !isFallbackOutcomeText(value)
          && normalize(value) !== normalize(choice.text)
        ) {
          ot[tier] = value.trim();
          replaced += 1;
        }
      }
      if (replaced < needTiers.length) {
        console.warn(
          `[ChoiceAuthor] Generation-time re-author left ${needTiers.length - replaced} stub tier(s) on ` +
          `choice "${choice.id}" — the outcome-text contract gate remains the net.`,
        );
      }
    }
  }

  /**
   * Backstop for outcome-text distinctness: if any two tiers (or a tier and the choice
   * label) are identical after normalization, re-derive the colliding tier(s) from the
   * distinct fallbacks so no stub outcome ships. Mutates the choice in place.
   */
  private dedupeOutcomeTexts(choice: ChoiceSet['choices'][number]): void {
    const ot = choice.outcomeTexts;
    if (!ot) return;
    const label = String(choice.text || '').trim();
    const collides = (value: string | undefined, others: Array<string | undefined>): boolean =>
      Boolean(value) && (value!.trim() === label || others.some(o => o && o.trim() === value!.trim()));
    if (collides(ot.success, [ot.partial, ot.failure])) ot.success = this.buildFallbackOutcomeText(choice, 'success');
    if (collides(ot.partial, [ot.success, ot.failure])) ot.partial = this.buildFallbackOutcomeText(choice, 'partial');
    if (collides(ot.failure, [ot.success, ot.partial])) ot.failure = this.buildFallbackOutcomeText(choice, 'failure');
  }

  private cleanReaderReminderText(text: string | undefined): string | undefined {
    const normalized = text?.replace(/\s+/g, ' ').trim();
    if (!normalized || isFallbackReminderStub(normalized)) return undefined;
    if (isUnsafeCallbackProse(normalized)) return undefined;
    if (/^this route should keep carrying the decision forward\.?$/i.test(normalized)) return undefined;
    if (/^the route choice lands immediately\.?$/i.test(normalized)) return undefined;
    if (/^the next episode should follow the selected route\.?$/i.test(normalized)) return undefined;
    if (/^the selected (?:route|choice) changes the next scene\.?$/i.test(normalized)) return undefined;
    if (/^later narration remembers which path the player chose\.?$/i.test(normalized)) return undefined;
    if (/^you chose\b/i.test(normalized)) return undefined;
    if (/\bpeople remember what the protagonist risked\b/i.test(normalized)) return undefined;
    if (/\bthe protagonist\b/i.test(normalized)) return undefined;
    return normalized;
  }

  private buildReaderReminderPlan(
    current: ReminderPlan | undefined,
    blueprint: ReminderPlan | undefined
  ): ReminderPlan | undefined {
    const immediate = this.cleanReaderReminderText(current?.immediate) || this.cleanReaderReminderText(blueprint?.immediate);
    const shortTerm = this.cleanReaderReminderText(current?.shortTerm) || this.cleanReaderReminderText(blueprint?.shortTerm);
    const later = this.cleanReaderReminderText(current?.later) || this.cleanReaderReminderText(blueprint?.later);
    const first = immediate || shortTerm;
    const second = shortTerm || immediate;
    if (!first || !second) return undefined;
    return {
      immediate: first,
      shortTerm: second,
      ...(later ? { later } : {}),
    };
  }

  private normalizeChoiceSet(choiceSet: ChoiceSet, input: ChoiceAuthorInput): ChoiceSet {
    // Get blueprint stakes as fallback
    const blueprintStakes = input.sceneBlueprint.choicePoint?.stakes || {
      want: 'achieve their goal',
      cost: 'face consequences',
      identity: 'reveal their character'
    };
    const blueprintStakesLayers = input.sceneBlueprint.choicePoint?.stakesLayers || input.sceneBlueprint.stakesLayers;
    const blueprintDomain = input.sceneBlueprint.choicePoint?.consequenceDomain;
    const blueprintReminder = input.sceneBlueprint.choicePoint?.reminderPlan;
    const blueprintCompetenceArc = input.sceneBlueprint.choicePoint?.competenceArc;

    // CRITICAL: Always use the input beatId to ensure correct mapping during assembly
    // The LLM might return a different beatId, but we need it to match the actual beat
    choiceSet.beatId = input.beatId;
    
    // The planner's assigned type is AUTHORITATIVE. choiceTypePlanner.assignChoiceTypes
    // allocates the season's target distribution (35/30/20/15) onto choicePoint.type;
    // treating the LLM's set type as the source of truth lets that distribution drift
    // (observed: strategic -> 0%, dilemma over-weighted). When the blueprint carries a
    // planned type, force it; the LLM type is only a fallback when no plan exists.
    const plannedChoiceType = input.sceneBlueprint.choicePoint?.type;
    if (plannedChoiceType) {
      if (choiceSet.choiceType && choiceSet.choiceType !== plannedChoiceType) {
        console.warn(
          `[ChoiceAuthor] Set "${choiceSet.beatId}" authored type "${choiceSet.choiceType}" ` +
          `but the planner assigned "${plannedChoiceType}" — overriding to the planned type.`
        );
      }
      choiceSet.choiceType = plannedChoiceType;
    } else if (!choiceSet.choiceType) {
      choiceSet.choiceType = 'expression';
    }
    if (!choiceSet.designNotes) {
      choiceSet.designNotes = '';
    }
    if (!choiceSet.overallStakesLayers && blueprintStakesLayers) {
      choiceSet.overallStakesLayers = blueprintStakesLayers;
    }

    // Ensure choices is an array
    if (!choiceSet.choices) {
      choiceSet.choices = [];
    } else if (!Array.isArray(choiceSet.choices)) {
      choiceSet.choices = [choiceSet.choices as unknown as GeneratedChoice];
    }

    // Do not synthesize placeholder choices. Too-few choices means the authoring
    // call did not satisfy the deterministic schema and should retry/fail upstream.
    if (choiceSet.choices.length < MIN_READER_CHOICES) {
      throw new Error(`ChoiceAuthor returned only ${choiceSet.choices.length} choice(s); refusing to synthesize placeholder choices.`);
    }
    
    // AUTO-FIX: If LLM returned more than 4 choices, trim to the reader contract.
    if (choiceSet.choices.length > MAX_READER_CHOICES) {
      console.warn(`[ChoiceAuthor] LLM returned ${choiceSet.choices.length} choices, trimming to maximum of ${MAX_READER_CHOICES}`);
      choiceSet.choices = choiceSet.choices.slice(0, MAX_READER_CHOICES);
    }

    // Normalize each choice
    for (let i = 0; i < choiceSet.choices.length; i++) {
      const choice = choiceSet.choices[i];

      // Ensure choice has id and text
      if (!choice.id) {
        choice.id = `choice-${i + 1}`;
      }
      if (!choice.text) {
        choice.text = `Option ${i + 1}`;
      } else if (typeof choice.text !== 'string') {
        // LLM sometimes returns text as an object - convert it
        choice.text = String(choice.text);
        console.warn(`[ChoiceAuthor] Choice ${choice.id || i} had non-string text, converted to string`);
      }

      // Normalize outcomeTexts — when the LLM omits a tier, fall back to a DISTINCT,
      // tier-appropriate line (success/partial/failure read differently) instead of
      // copying the choice label into all three tiers. The old identical-copy fallback
      // shipped stub outcomes where every resolution read the same flat instruction
      // (gen-5 audit: 3 choices with success===partial===failure===choice.text).
      if (!choice.outcomeTexts || typeof choice.outcomeTexts !== 'object') {
        choice.outcomeTexts = {
          success: this.buildFallbackOutcomeText(choice, 'success'),
          partial: this.buildFallbackOutcomeText(choice, 'partial'),
          failure: this.buildFallbackOutcomeText(choice, 'failure'),
        };
        console.warn(`[ChoiceAuthor] Choice "${choice.id}" missing outcomeTexts — synthesized distinct tier fallbacks`);
      } else {
        if (!choice.outcomeTexts.success) choice.outcomeTexts.success = this.buildFallbackOutcomeText(choice, 'success');
        if (!choice.outcomeTexts.partial) choice.outcomeTexts.partial = this.buildFallbackOutcomeText(choice, 'partial');
        if (!choice.outcomeTexts.failure) choice.outcomeTexts.failure = this.buildFallbackOutcomeText(choice, 'failure');
      }
      // Backstop: if any two tiers (or a tier and the choice label) are still identical
      // after normalization, the outcome reads the same regardless of how it resolves.
      // Re-derive the colliding tiers from the distinct fallbacks so no stub ships.
      this.dedupeOutcomeTexts(choice);
      // Advisory: identical success/failure prose means the stat-check outcome makes
      // no narrative difference — usually lazy authoring. Surface it; don't rewrite.
      if (
        choice.outcomeTexts.success &&
        choice.outcomeTexts.success === choice.outcomeTexts.failure &&
        choice.outcomeTexts.success !== choice.text
      ) {
        console.warn(`[ChoiceAuthor] Choice "${choice.id}" has identical success/failure outcome prose — the outcome reads the same either way.`);
      }

      if (choice.consequences && !Array.isArray(choice.consequences)) {
        choice.consequences = [choice.consequences as unknown as Consequence];
      }
      if (!choice.consequences) {
        choice.consequences = [];
      }
      this.normalizeChoiceConsequences(choice);

      const setsRouteFlag = choice.consequences?.some(
        consequence => consequence.type === 'setFlag' && typeof consequence.flag === 'string' && consequence.flag.startsWith('route_') && consequence.value !== false
      );
      if (setsRouteFlag && choice.nextSceneId) {
        console.warn(
          `[ChoiceAuthor] Choice "${choice.id}" sets a cross-episode route flag and also had nextSceneId "${choice.nextSceneId}" — removing nextSceneId.`
        );
        delete choice.nextSceneId;
      }

      // Auto-generate a tintFlag if the choice doesn't branch and none was provided
      if (!choice.nextSceneId && !choice.tintFlag) {
        // Canonical identity-engine vocabulary only (G12: non-canonical tints are inert).
        const tintsByType: Record<string, string> = {
          expression: 'tint:emotion',
          relationship: 'tint:teamwork',
          strategic: 'tint:pragmatism',
          dilemma: 'tint:sacrifice',
        };
        choice.tintFlag = tintsByType[choiceSet.choiceType] || 'tint:boldness';
        console.warn(`[ChoiceAuthor] Choice "${choice.id}" missing tintFlag — using fallback "${choice.tintFlag}"`);
      }

      // Enforce: all choices in a set share the set's choiceType.
      // The set-level type is the source of truth — individual deviations
      // would escape structural validation (e.g. branching->nextSceneId checks).
      if (choice.choiceType && choice.choiceType !== choiceSet.choiceType) {
        console.warn(
          `[ChoiceAuthor] Choice "${choice.id}" has type "${choice.choiceType}" but ` +
          `set type is "${choiceSet.choiceType}" — overriding to match set type`
        );
      }
      choice.choiceType = choiceSet.choiceType;

      choice.choiceIntent = this.normalizeChoiceIntent(choice, choiceSet.choiceType);
      choice.impactFactors = this.normalizeImpactFactors(choice, choiceSet.choiceType);
      choice.consequenceTier = this.normalizeConsequenceTier(
        choice,
        choiceSet.choiceType,
        input.plannedConsequenceTier,
      );
      choice.stakes = {
        want: choice.stakes?.want || choice.stakesAnnotation?.want || blueprintStakes.want,
        cost: choice.stakes?.cost || choice.stakesAnnotation?.cost || blueprintStakes.cost,
        identity: choice.stakes?.identity || choice.stakesAnnotation?.identity || blueprintStakes.identity,
      };
      if (!choice.stakesLayers && blueprintStakesLayers) {
        choice.stakesLayers = blueprintStakesLayers;
      }

      // Keep stakesAnnotation in lock-step with the AUTHORED triangle (choice.stakes,
      // computed just above). Historically the annotation could retain StoryArchitect's
      // placeholder sentinel while choice.stakes held the real authored text, which made
      // the season validator score the placeholder. Mirroring the two prevents that drift.
      // See constants/placeholderStakes.ts and resolveStakesForValidation.
      choice.stakesAnnotation = {
        want: choice.stakes.want,
        cost: choice.stakes.cost,
        identity: choice.stakes.identity,
      };

      if (!choice.consequenceDomain) {
        choice.consequenceDomain = blueprintDomain || this.defaultDomainForChoiceType(choiceSet.choiceType);
      }

      if (choice.conditions && !choice.affordanceSource) {
        const inferredSource = this.inferAffordanceSource(choice.conditions);
        if (inferredSource) {
          choice.affordanceSource = inferredSource;
        }
      }

      if (choice.witnessReactions && !Array.isArray(choice.witnessReactions)) {
        choice.witnessReactions = [choice.witnessReactions as unknown as NonNullable<GeneratedChoice['witnessReactions']>[number]];
      }
      // Witness npcId canonicalization happens authoritatively at final assembly
      // (FinalStoryContractValidator -> canonicalizeStoryWitnessReactions) against
      // story.npcs. We deliberately do NOT normalize here: the per-scene NPC list is
      // built from raw blueprint labels, so resolving against it would mis-validate
      // or erroneously drop valid cross-scene witnesses.

      if (!choice.storyVerb && input.storyVerbs?.length && choiceSet.choiceType !== 'expression') {
        const matchedVerb = this.inferStoryVerb(choice, input.storyVerbs);
        if (matchedVerb) {
          choice.storyVerb = matchedVerb;
        }
      }

      const readerReminderPlan = this.buildReaderReminderPlan(choice.reminderPlan, blueprintReminder);
      if (readerReminderPlan) {
        choice.reminderPlan = readerReminderPlan;
      } else {
        delete choice.reminderPlan;
      }

      const checkClass = choice.feedbackCue?.checkClass ||
        (choice.statCheck?.retryableAfterChange || blueprintCompetenceArc?.growthPath ? 'retryable' : 'dramatic');
      const echoSummary = this.cleanReaderReminderText(choice.feedbackCue?.echoSummary) || choice.reminderPlan?.immediate;
      const progressSummary = this.cleanReaderReminderText(choice.feedbackCue?.progressSummary) || choice.reminderPlan?.shortTerm;
      const feedbackCue: ChoiceFeedbackCue = {
        ...(choice.feedbackCue || {}),
        checkClass,
      };
      if (echoSummary) feedbackCue.echoSummary = echoSummary;
      else delete feedbackCue.echoSummary;
      if (progressSummary) feedbackCue.progressSummary = progressSummary;
      else delete feedbackCue.progressSummary;
      choice.feedbackCue = feedbackCue;

      if (choice.statCheck?.difficulty && blueprintCompetenceArc?.growthPath && choiceSet.choiceType !== 'expression') {
        choice.statCheck.retryableAfterChange ??= true;
      }
      choice.statCheck = normalizeChoiceStatCheck(choice.statCheck);
    }

    this.repairRelationshipTargets(choiceSet, input);

    const routeFlags = input.availableFlags.filter(flag => flag.name.startsWith('route_'));
    const shouldAssignRouteFlags = routeFlags.length >= 2 || Boolean(input.sceneBlueprint.choicePoint?.branches);
    const hasRouteFlagConsequence = choiceSet.choices.some(choice =>
      choice.consequences?.some(
        consequence => consequence.type === 'setFlag' && typeof consequence.flag === 'string' && consequence.flag.startsWith('route_') && consequence.value !== false
      )
    );
    if (shouldAssignRouteFlags && routeFlags.length > 0 && !hasRouteFlagConsequence) {
      choiceSet.choices.forEach((choice, index) => {
        const routeFlag = routeFlags[index % routeFlags.length];
        choice.consequences = [
          ...(choice.consequences || []),
          { type: 'setFlag', flag: routeFlag.name, value: true },
        ];
        const readerReminderPlan = this.buildReaderReminderPlan(choice.reminderPlan, undefined);
        if (readerReminderPlan) choice.reminderPlan = readerReminderPlan;
        else delete choice.reminderPlan;
        choice.feedbackCue = {
          ...(choice.feedbackCue || {}),
          checkClass: choice.feedbackCue?.checkClass || 'dramatic',
        };
        if (!choice.reminderPlan) {
          delete choice.feedbackCue.echoSummary;
          delete choice.feedbackCue.progressSummary;
        }
        delete choice.nextSceneId;
      });
      console.warn(`[ChoiceAuthor] Added cross-episode route flag consequences to ${choiceSet.choices.length} choice(s).`);
    }

    // W5.2 (mustDiverge): at a GENUINE intra-episode branch point — choices route to
    // >=2 distinct scenes — register a BRANCH-tier consequence so the consequence
    // budget stops reading 0% structural branching. Cross-episode route_ branches are
    // handled above (they delete nextSceneId); this covers the in-episode fork that
    // keeps nextSceneId. A `treatment_branch_<target>` setFlag is attached to each
    // branching choice (keyed to its destination), giving the reconvergence residue
    // something to acknowledge. Additive + deterministic; only fires when the fork is
    // real, so non-branching scenes are untouched.
    const branchingChoices = choiceSet.choices.filter(
      choice => typeof choice.nextSceneId === 'string' && choice.nextSceneId.length > 0,
    );
    const distinctBranchTargets = new Set(branchingChoices.map(choice => choice.nextSceneId));
    const alreadyHasBranchConsequence = choiceSet.choices.some(choice =>
      choice.consequences?.some(
        c => c.type === 'setFlag'
          && typeof c.flag === 'string'
          && (c.flag.startsWith('route_') || c.flag.startsWith('treatment_branch_'))
          && c.value !== false,
      ),
    );
    if (distinctBranchTargets.size >= 2 && !alreadyHasBranchConsequence) {
      for (const choice of branchingChoices) {
        const target = String(choice.nextSceneId).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        const branchFlag = `treatment_branch_${target}`;
        if (choice.consequences?.some(c => c.type === 'setFlag' && c.flag === branchFlag)) continue;
        choice.consequences = [
          ...(choice.consequences || []),
          { type: 'setFlag', flag: branchFlag, value: true },
        ];
      }
      console.warn(`[ChoiceAuthor] Registered BRANCH-tier consequences for ${distinctBranchTargets.size}-way intra-episode branch.`);
    }

    // Ensure overallStakes exists with values from blueprint as fallback
    if (!choiceSet.overallStakes) {
      choiceSet.overallStakes = {
        want: blueprintStakes.want,
        cost: blueprintStakes.cost,
        identity: blueprintStakes.identity
      };
      console.log(`[ChoiceAuthor] Used blueprint stakes as fallback for overallStakes`);
    } else {
      // Fill in any missing fields from blueprint
      if (!choiceSet.overallStakes.want) {
        choiceSet.overallStakes.want = blueprintStakes.want;
      }
      if (!choiceSet.overallStakes.cost) {
        choiceSet.overallStakes.cost = blueprintStakes.cost;
      }
      if (!choiceSet.overallStakes.identity) {
        choiceSet.overallStakes.identity = blueprintStakes.identity;
      }
    }

    return choiceSet;
  }

  private defaultDomainForChoiceType(choiceType: ChoiceType): ConsequenceDomain {
    switch (choiceType) {
      case 'relationship':
        return 'relationship';
      case 'strategic':
        return 'leverage';
      case 'dilemma':
        return 'identity';
      default:
        return 'information';
    }
  }

  private inferAffordanceSource(condition: ConditionExpression): ChoiceAffordanceSource | undefined {
    switch (condition.type) {
      case 'identity':
        return 'identity';
      case 'relationship':
        return 'relationship';
      case 'tag':
        return 'tag';
      case 'item':
        return 'item';
      case 'skill':
      case 'attribute':
        return 'skill';
      case 'flag':
      case 'score':
        return 'flag';
      case 'and':
      case 'or': {
        for (const child of condition.conditions) {
          const inferred = this.inferAffordanceSource(child);
          if (inferred) return inferred;
        }
        return undefined;
      }
      case 'not':
        return this.inferAffordanceSource(condition.condition);
      default:
        return undefined;
    }
  }

  private inferStoryVerb(choice: GeneratedChoice, storyVerbs: StoryVerb[]): string | undefined {
    const text = [
      choice.text,
      choice.stakes?.want,
      choice.stakes?.cost,
      choice.stakes?.identity,
      choice.reactionText,
      choice.outcomeTexts?.success,
      choice.outcomeTexts?.partial,
      choice.outcomeTexts?.failure,
    ].filter(Boolean).join(' ').toLowerCase();

    const directMatch = storyVerbs.find(storyVerb => {
      const escaped = storyVerb.verb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
    });
    if (directMatch) return directMatch.verb;

    const byDomain = storyVerbs.find(storyVerb =>
      choice.consequenceDomain && storyVerb.consequenceDomains?.includes(choice.consequenceDomain)
    );
    return byDomain?.verb;
  }

  private normalizeChoiceIntent(choice: GeneratedChoice, choiceType: ChoiceType): ChoiceIntent {
    if (choiceType === 'expression') return 'flavor';
    if (choice.choiceIntent === 'flavor' || choice.choiceIntent === 'branching' || choice.choiceIntent === 'blind' || choice.choiceIntent === 'dilemma') {
      if (choice.choiceIntent === 'flavor' && choice.nextSceneId) return 'branching';
      if (choice.choiceIntent === 'branching' && !choice.nextSceneId && choiceType === 'relationship') return 'blind';
      return choice.choiceIntent;
    }
    if (choiceType === 'dilemma') return 'dilemma';
    if (choice.nextSceneId) return 'branching';
    return 'blind';
  }

  private normalizeImpactFactors(choice: GeneratedChoice, choiceType: ChoiceType): ChoiceImpactFactor[] {
    const allowed: ChoiceImpactFactor[] = ['outcome', 'process', 'information', 'relationship', 'identity'];
    const factors = new Set<ChoiceImpactFactor>();

    for (const factor of choice.impactFactors || []) {
      if (allowed.includes(factor)) factors.add(factor);
    }

    if (choiceType === 'expression') {
      return [];
    }
    if (choice.nextSceneId) factors.add('outcome');
    if (choiceType === 'relationship') factors.add('relationship');
    if (choiceType === 'strategic') factors.add('information');
    if (choiceType === 'dilemma') {
      factors.add('identity');
      factors.add('relationship');
    }
    if (Array.isArray(choice.consequences) && choice.consequences.length > 0 && factors.size === 0) {
      factors.add('process');
    }

    return Array.from(factors);
  }

  private normalizeConsequenceTier(
    choice: GeneratedChoice,
    choiceType: ChoiceType,
    plannedTier?: ConsequenceTier,
  ): ChoiceConsequenceTier {
    if (plannedTier === 'callback') return 'callback';
    if (plannedTier === 'tint') return 'sceneTint';
    if (plannedTier === 'branchlet') return 'branchlet';
    if (plannedTier === 'branch') {
      // Topology remains authoritative: a structural branch cannot be created
      // by relabeling a choice that has no route target.
      return choice.nextSceneId ? 'structuralBranch' : 'branchlet';
    }
    if (choiceType === 'expression') return 'sceneTint';
    if (choice.consequenceTier === 'callback' || choice.consequenceTier === 'sceneTint' || choice.consequenceTier === 'branchlet' || choice.consequenceTier === 'structuralBranch') {
      if (choice.consequenceTier === 'structuralBranch' && !choice.nextSceneId) return 'branchlet';
      return choice.consequenceTier;
    }
    if (choice.nextSceneId) return 'structuralBranch';
    if (choice.memorableMoment?.id || choice.reminderPlan?.later) return 'callback';
    // 1.3: a choice that sets a trackable (non-tint, non-routing) flag is a
    // callback opportunity by default — the callback ledger seeds a hook for it
    // (1.1) and the orphan-flag reconciliation later demotes it to sceneTint if
    // nothing ever reads it. Defaulting these to 'callback' (instead of
    // branchlet/sceneTint) is what moves the realized mix toward the 60/25/10/5
    // budget without inventing routing the story doesn't have.
    if (this.setsTrackableFlag(choice)) return 'callback';
    return choiceType === 'dilemma' ? 'branchlet' : 'sceneTint';
  }

  /**
   * True when the choice sets at least one flag that is meant to be read later
   * (a callback opportunity): a `setFlag` consequence whose flag is neither a
   * cosmetic `tint:` flag nor a structural `route_` flag, and which sets rather
   * than clears the flag.
   */
  private setsTrackableFlag(choice: GeneratedChoice): boolean {
    return (choice.consequences ?? []).some(
      (c) =>
        c.type === 'setFlag' &&
        typeof c.flag === 'string' &&
        !c.flag.startsWith('tint:') &&
        !c.flag.startsWith('route_') &&
        !c.flag.startsWith('treatment_branch_') &&
        c.value !== false,
    );
  }

  /** Record the skills exercised by a choice set's existing statChecks (1.7). */
  private trackStatCheckSkills(choices: GeneratedChoice[]): void {
    for (const choice of choices) {
      const sc = choice.statCheck as { skill?: string; skillWeights?: Record<string, number> } | undefined;
      if (!sc) continue;
      if (sc.skillWeights) {
        for (const skill of Object.keys(sc.skillWeights)) {
          this.skillUsage[skill] = (this.skillUsage[skill] ?? 0) + 1;
        }
      } else if (sc.skill) {
        this.skillUsage[sc.skill] = (this.skillUsage[sc.skill] ?? 0) + 1;
      }
    }
  }

  /**
   * Least-used skill relevant to the choice type, for a rotated default (1.7).
   * Biased toward the episode's SeasonSkillPlan targets (P2-skills): among the
   * type-relevant candidates, prefer those the plan favours for this episode, then
   * pick the season-wide least-used so coverage spreads across all eight skills.
   */
  private leastUsedRelevantSkill(choiceType: ChoiceType): string {
    const candidates = ChoiceAuthor.RELEVANT_SKILLS[choiceType] ?? ['investigation'];
    const targeted = candidates.filter((s) => this.episodeSkillTargets.includes(s));
    const pool = targeted.length > 0 ? targeted : candidates;
    let best = pool[0];
    let bestCount = Infinity;
    for (const skill of pool) {
      const count = this.skillUsage[skill] ?? 0;
      if (count < bestCount) {
        bestCount = count;
        best = skill;
      }
    }
    return best;
  }

  /**
   * Rebalance authored single-skill stat-checks off an over-used skill onto an
   * under-used, type-relevant one (P2-skills). The LLM favours a couple of skills
   * (perception in the audited run), so without this the season exercises <6 skills
   * with one dominating >30% of weight. Stat-check skills are mechanical (never shown
   * to the player), and we only ever swap WITHIN a choice type's plausible skill set,
   * so the swap stays narratively coherent. Multi-skill (blended) checks are left
   * untouched — those are intentional. Updates the running season usage counts.
   */
  private rebalanceStatCheckSkills(choiceSet: ChoiceSet): void {
    // Only rebalance when a SeasonSkillPlan is active for this episode — without a
    // plan we leave authored skills exactly as written (preserves single-shot/test
    // behavior; the plan is what makes season-wide spread intentional).
    if (this.episodeSkillTargets.length === 0) return;
    const candidates = ChoiceAuthor.RELEVANT_SKILLS[choiceSet.choiceType];
    if (!candidates) return;
    for (const choice of choiceSet.choices) {
      const sc = choice.statCheck as { skill?: string; skillWeights?: Record<string, number>; difficulty?: number } | undefined;
      if (!sc) continue;
      const weights = sc.skillWeights;
      // Only rebalance a single-dominant-skill check.
      const single =
        weights && Object.keys(weights).length === 1
          ? Object.keys(weights)[0]
          : !weights && sc.skill
            ? sc.skill
            : undefined;
      if (!single || !candidates.includes(single)) continue;

      const target = this.leastUsedRelevantSkill(choiceSet.choiceType);
      if (target === single) continue;
      const gap = (this.skillUsage[single] ?? 0) - (this.skillUsage[target] ?? 0);
      // Season-wide dominance: force a swap once `single` exceeds its share cap, even
      // when the pairwise gap is small — otherwise a perpetually-favoured skill keeps
      // its lead and never trips the gap test (the gen-5 perception monopoly).
      const totalUsage = Object.values(this.skillUsage).reduce((a, b) => a + b, 0);
      const singleShare = totalUsage > 0 ? (this.skillUsage[single] ?? 0) / totalUsage : 0;
      const overCap =
        totalUsage >= ChoiceAuthor.SKILL_DOMINANCE_MIN_SAMPLE &&
        singleShare > ChoiceAuthor.SKILL_DOMINANCE_CAP;
      if (gap < ChoiceAuthor.SKILL_REBALANCE_GAP && !overCap) continue;

      const difficulty = sc.difficulty ?? (choiceSet.choiceType === 'dilemma' ? 60 : 50);
      choice.statCheck = { skillWeights: { [target]: 1.0 }, difficulty };
      this.skillUsage[single] = Math.max(0, (this.skillUsage[single] ?? 0) - 1);
      this.skillUsage[target] = (this.skillUsage[target] ?? 0) + 1;
    }
  }

  private buildResidueObligationSection(input: ChoiceAuthorInput): string {
    const outgoing = input.outgoingResidueObligations || [];
    const due = input.dueResidueObligations || [];
    if (outgoing.length === 0 && due.length === 0) return '';
    const describe = (obligation: SeasonResidueObligation) =>
      `- ${obligation.id}: flag ${obligation.flag}; ${obligation.choiceAnchor}; surface ${obligation.requiredSurface.join(', ')}; guidance: ${obligation.authoringGuidance || obligation.sourceMaterial.reminderShortTerm || obligation.sourceMaterial.feedbackEcho || 'make the consequence visible in fiction'}`;
    return `
## Planned Residue Contract
These are season-planned choice echoes. Do not invent extra consequential flags outside this contract.
${outgoing.length ? `
Outgoing obligations this choice point MUST create:
${outgoing.map(describe).join('\n')}
- At least one option must set each listed flag with a \`setFlag\` consequence.
- Stamp the matching \`residueObligationIds\` on the option that creates it.
- Source \`residueHints\`, \`reminderPlan\`, and \`feedbackCue\` from the guidance above.
` : ''}
${due.length ? `
Due obligations this choice point MAY pay through choice text or conditional options:
${due.map(describe).join('\n')}
- If paid through conditional choice text, gate it on the exact flag/condition key.
` : ''}
`;
  }

  private buildCanonicalContinuitySection(input: ChoiceAuthorInput): string {
    const route = input.sceneBlueprint.routeRealizationContract;
    const lexical = input.sceneBlueprint.lexicalArtifactContracts ?? [];
    if (!route && lexical.length === 0) return '';
    const lexicalLines = lexical.map((contract) => contract.creatorSceneId === input.sceneBlueprint.id
      ? `- ${contract.canonicalValue}: ${contract.routePolicy === 'source_invariant' ? 'canonical on every option; do not offer alternate naming choices and use the exact value downstream' : `player-selected; every outcome and later reference must use the selected value from [${contract.allowedAlternatives.join(', ')}]`}`
      : `- ${contract.canonicalValue}: not yet created; forbidden on every choice-facing surface in this scene.`);
    return `
## Canonical Route And Lexical Continuity
${route ? `- Planned type: ${route.choiceType || 'unspecified'}; convergence: ${route.convergencePolicy}; allowed destinations: ${route.allowedTargetSceneIds.join(', ') || 'episode terminal'}.
- Route-invariant events: ${route.routeInvariantEventIds.join(', ') || 'none'}.
- ${route.requiresVisibleResidue ? 'Every non-expression option must leave distinct visible immediate residue in its own outcome text before convergence. State deltas alone do not count.' : 'This expression choice may vary tone without inventing route consequences.'}` : ''}
${lexicalLines.join('\n')}
Shared resolution may contain only facts invariant across every option. Never hard-code a route-sensitive selected value into sharedResolutionText.
`;
  }

  private buildPrompt(input: ChoiceAuthorInput): string {
    const npcList = input.npcsInScene
      .map(npc => {
        let entry = `- ${npc.name} (${npc.id}, ${npc.pronouns}): ${npc.description}`;
        if (npc.voiceNotes) entry += `\n  Voice: ${npc.voiceNotes}`;
        if (npc.physicalDescription) entry += `\n  Appearance: ${npc.physicalDescription}`;
        return entry;
      })
      .join('\n');

    const nextSceneList = input.possibleNextScenes
      .map(scene => `- ${scene.id}: "${scene.name}" - ${scene.description}`)
      .join('\n');

    const storyVerbList = (input.storyVerbs || [])
      .map(storyVerb => {
        const sources = storyVerb.typicalSources?.length ? ` sources: ${storyVerb.typicalSources.join(', ')}` : '';
        const domains = storyVerb.consequenceDomains?.length ? ` domains: ${storyVerb.consequenceDomains.join(', ')}` : '';
        return `- ${storyVerb.verb}: ${storyVerb.description}${sources || domains ? ` (${[sources.trim(), domains.trim()].filter(Boolean).join('; ')})` : ''}`;
      })
      .join('\n');

    const flagList = input.availableFlags
      .map(f => `- ${f.name}: ${f.description}`)
      .join('\n');
    const authoredFlagList = (input.authoredFlagContracts ?? [])
      .map(f => `- ${f.name}: ${f.description}`)
      .join('\n');
    const canonicalStateList = (input.canonicalStateContracts ?? [])
      .map(state => `- ${state.canonicalStateId}${state.aliases.length > 0 ? ` (registered aliases: ${state.aliases.join(', ')})` : ''} — source episode ${state.sourceEpisodeNumber}; future use in episode(s) ${state.targetEpisodeNumbers.join(', ')}`)
      .join('\n');
    const routeFlags = input.availableFlags.filter(f => f.name.startsWith('route_'));

    const scoreList = input.availableScores
      .map(s => `- ${s.name}: ${s.description}`)
      .join('\n');

    let sourceContextStr = '';
    const directFragments = flattenDirectLanguageFragments(input.sourceAnalysis);
    if (directFragments.length) {
      const directFragmentList = directFragments
        .map(fragment => `- "${fragment}"`)
        .join('\n');

      sourceContextStr = `
## Source Material Fidelity (IP Research)
The following iconic language and style fragments have been identified from the source IP. 
**Use this specific terminology and character voice when writing choice text.**

### Iconic Dialogue Fragments
${directFragmentList}
`;
    }

    const choicePoint = input.sceneBlueprint.choicePoint!;

    const structuralContext = buildStructuralContextSection({
      anchors: input.seasonAnchors,
      storyCircle: input.seasonStoryCircle,
      episodeStoryCircleRole: input.episodeStoryCircleRole,
      episodeCircle: input.episodeCircle,
    });
    const residueSection = this.buildResidueObligationSection(input);
    const canonicalContinuitySection = this.buildCanonicalContinuitySection(input);

    return `
Create player choices for the following decision point:

${sourceContextStr}
${structuralContext}
## Story Context
- **Title**: ${input.storyContext.title}
- **Genre**: ${input.storyContext.genre}
- **Tone**: ${input.storyContext.tone}
${input.storyContext.worldContext ? `- **World**: ${input.storyContext.worldContext}\n` : ''}${input.storyContext.userPrompt ? `- **User Instructions/Prompt**: ${input.storyContext.userPrompt}\n` : ''}${input.memoryContext ? `\n## Pipeline Memory (Insights from Prior Generations)\n${input.memoryContext}\n` : ''}${input.establishedCanon ? `\n## ${input.establishedCanon}\n(Treat the above as fixed truth — choices and their consequences must not contradict it.)\n` : ''}
## Scene Context
- **Scene**: ${input.sceneBlueprint.name}
- **Location**: ${input.sceneBlueprint.location}
- **Mood**: ${input.sceneBlueprint.mood}

## The Moment
This beat leads up to the choice:

"${input.beatText}"

${buildChoiceAuthorCallbackSection((input.unresolvedCallbacks || []).map(h => ({
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
})), { authorNewHooks: true })}
${residueSection}
## Choice Point Design
- **Type**: ${choicePoint.type}
- **Description**: ${choicePoint.description}
- **Stakes**:
  - Want: ${choicePoint.stakes.want}
  - Cost: ${choicePoint.stakes.cost}
  - Identity: ${choicePoint.stakes.identity}
${choicePoint.stakesLayers ? `- **Stakes Layers**:
  - Material: ${choicePoint.stakesLayers.material || 'None'}
  - Relational: ${choicePoint.stakesLayers.relational || 'None'}
  - Identity: ${choicePoint.stakesLayers.identity || 'None'}
  - Existential: ${choicePoint.stakesLayers.existential || 'None'}` : ''}
- **Option Hints**: ${choicePoint.optionHints.join(', ')}
${choicePoint.consequenceDomain ? `- **Consequence Domain**: ${choicePoint.consequenceDomain}` : ''}
${choicePoint.reminderPlan ? `- **Reminder Plan**:\n  - Immediate: ${choicePoint.reminderPlan.immediate}\n  - Short-term: ${choicePoint.reminderPlan.shortTerm}${choicePoint.reminderPlan.later ? `\n  - Later: ${choicePoint.reminderPlan.later}` : ''}` : ''}
${choicePoint.expectedResidue?.length ? `- **Expected Residue**: ${choicePoint.expectedResidue.join(', ')}` : ''}
${choicePoint.competenceArc ? `- **Competence Arc**:\n  - Tests now: ${choicePoint.competenceArc.testsNow}\n  - Shortfall: ${choicePoint.competenceArc.shortfall || 'None'}\n  - Growth path: ${choicePoint.competenceArc.growthPath || 'None'}` : ''}
${input.growthTemplates ? `
## Growth Context (Development Scene)

This is a DEVELOPMENT scene. Each choice option should grow a DIFFERENT skill.
Frame each option as an action ("Spar with Marcus"), not a stat label ("Increase athletics").

Available growth options:
${input.growthTemplates.skillOptions.map(s => `- ${s.skill}: +${s.change}`).join('\n')}
${input.growthTemplates.mentorship ? `
NPC Mentorship available:
- ${input.growthTemplates.mentorship.npcName} can teach ${input.growthTemplates.mentorship.attribute} (+${input.growthTemplates.mentorship.change})
- Gate with a relationship condition on the mentorship option
- Hook: "${input.growthTemplates.mentorship.narrativeHook}"
- Always include a non-gated alternative
` : ''}` : ''}
${choicePoint.failureBranchPurpose ? `- **Failure Branch Purpose**: ${choicePoint.failureBranchPurpose}` : ''}

${formatForbiddenRevealsSection(buildForbiddenLexicalReveals(input.sceneBlueprint.realizationTasks))}
## Characters Present
**Protagonist**: ${input.protagonistInfo.name} (${input.protagonistInfo.pronouns})

**NPCs**:
${npcList || 'None'}
This is a CLOSED CAST for reader-facing choice prose. Only the protagonist and listed NPCs may act, speak, react, or be named as present. Do not invent or substitute character names.

## Available Next Scenes
${nextSceneList}

${storyVerbList ? `## Story Verbs
Use these genre/source-specific action verbs as metadata when they fit. They should shape choice design, but the player-facing choice text should still read naturally.
${storyVerbList}
` : ''}

## Available State for Consequences
**Flags**:
${flagList || 'None defined'}
${authoredFlagList ? `
## Authored Flag Contracts
These flags represent authored story facts, not generic route labels. Only set a flag when the selected option's player-facing action and immediate outcome visibly perform the described fact. The choice text must make that action legible; do not attach a flag to a merely adjacent or thematic option.
${authoredFlagList}
` : ''}
${canonicalStateList ? `
## Canonical Narrative State Contracts
These are the only canonical ids for season-spanning authored state. Emit the exact canonicalStateId in setFlag consequences. Do not invent a synonym or replace it with a prose-derived alias; aliases are accepted only when explicitly registered above.
${canonicalStateList}
` : ''}
${input.requiredCanonicalStateIds?.length ? `
## Required State Setters For This Episode
At least one option in this choice set must visibly perform and set each state below. Use the exact id in a setFlag consequence; do not substitute a generic trust flag.
${input.requiredCanonicalStateIds.map((id) => `- ${id}`).join('\n')}
` : ''}
${routeFlags.length > 0 ? `
## Cross-Episode Route Branching
These flags are route gates for scene-length branch episodes: ${routeFlags.map(f => f.name).join(', ')}
- When this choice is the branch origin, each route-changing option should set exactly one of these flags with a \`setFlag\` consequence.
- Do not use \`nextSceneId\` for the main route branch when route flags are available; future episodes unlock from the chosen flag.
- Include reminder/residue copy so the reconvergence episode can acknowledge what the player chose.
` : ''}

**Scores**:
${scoreList || 'None defined'}

${input.branchContext ? `
## Branch Topology Context (from Branch Manager)
- **Beat role**: ${input.branchContext.role}
${input.branchContext.isBranchPoint ? `- This IS a branch point — include \`nextSceneId\` on at least ${Math.max(2, input.branchContext.expectedBranches || 2)} options.` : '- This is NOT a branch point — choices should be tint choices. Do NOT include \`nextSceneId\` unless the scene blueprint routes to different scenes.'}
${input.branchContext.reconvergenceTargets && input.branchContext.reconvergenceTargets.length > 0 ? `- Reconvergence targets (if branching): ${input.branchContext.reconvergenceTargets.join(', ')}` : ''}
${input.branchContext.stateReconciliationHints && input.branchContext.stateReconciliationHints.length > 0 ? `- State reconciliation hints:\n${input.branchContext.stateReconciliationHints.map(h => `  - ${h}`).join('\n')}` : ''}
` : ''}
${input.requiredBranchTargets && input.requiredBranchTargets.length > 0 ? `
## REQUIRED BRANCHING — author one choice per target
This is a branch point that MUST fan out. Author EXACTLY one choice routing to EACH
target below: set that choice's \`nextSceneId\` to the target's scene id, and write the
choice so its wording clearly FITS that target's authored intent (a player picking it
would naturally arrive there). Do not point two choices at the same target; do not omit
a target.
These repair choices must meet the SAME quality bar as first-pass choices — routing is
not an excuse for thin authoring:
- Full Stakes Triangle on EVERY choice: name what the player Wants, what it Costs, and what it says about Identity.
- Each choice carries at least one of the five impact factors (Outcome / Process / Information / Relationship / Identity).
- Real consequences — durable state, relationship, or flag changes, not empty routing.
- For flag consequences, use the canonical shape exactly:
  \`{ "type": "setFlag", "flag": "meaningful_flag_name", "value": true }\`.
  Never put the flag name in \`value\`, and never emit a bare \`"value": "true"\` or \`"value": "false"\`.
- Include a \`statCheck\` wherever the choice type requires one.
- \`outcomeTexts\` (success/partial/failure) must each be a real dramatized beat in the fiction — never a stub or an echo of the choice text.
${input.requiredBranchTargets.map(t => `- nextSceneId "${t.sceneId}" → ${t.intent}`).join('\n')}
` : ''}
${input.plannedConsequenceTier ? `
## Season-Assigned Consequence Tier
The season planner assigned THIS scene's central choice to the "${input.plannedConsequenceTier}" consequence tier.
This is the scene's allocated slice of the season consequence budget; do not rebalance this episode toward global percentages.

Use the matching generated choice tier:
- callback -> \`consequenceTier: "callback"\`, small visible memory/state echo, no scene routing
- tint -> \`consequenceTier: "sceneTint"\`, same route with a real tintFlag and visible immediate/replayable residue
- branchlet -> \`consequenceTier: "branchlet"\`, short divergence or strong branch residue that reconverges
- branch -> \`consequenceTier: "structuralBranch"\`, true route split when branch topology provides distinct next scenes

If branch topology makes the assigned tier impossible, stay fiction-first and choose the nearest feasible lower-cost tier, but preserve visible residue and explain the tradeoff in \`designNotes\`.
` : ''}
${canonicalContinuitySection}
${input.arcTargets && (input.arcTargets.identityDeltaHints?.length || input.arcTargets.relationshipTrajectory?.length) ? `
## Character Arc Milestone Targets (from Arc Tracker)
Design at least ONE choice whose consequences move the protagonist toward these targets.
Use canonical consequences only; arc movement is measured from their actual discriminated fields.
${(input.arcTargets.identityDeltaHints || []).map(h => `- Identity \`${h.dimension}\`: target ${h.direction} (${h.magnitude}). A consequence like \`{ "type": "setFlag", "flag": "arc:${h.dimension}:${h.direction}", "value": true }\` is ideal.`).join('\n')}
${(input.arcTargets.relationshipTrajectory || []).map(r => `- Relationship with ${r.npcId} (${r.dimension}): ${r.direction} — ${r.hint}`).join('\n')}
` : ''}
${input.sceneBlueprint.relationshipPacing?.length ? `
## Relationship Pacing Contracts
Design relationship consequences and aftermath at the earned stage, not the future desired stage.
${input.sceneBlueprint.relationshipPacing.map((c) => `- ${c.npcId ? `NPC ${c.npcId}` : `Group ${c.groupId}`}: ${c.startStage} -> ${c.targetStage}; max relationship delta this scene ${c.maxDeltaThisScene}; allowed labels: ${c.allowedLabels.join(', ')}; blocked labels: ${c.blockedLabels.join(', ')}; evidence: ${c.requiredEvidence.join('; ')}`).join('\n')}
- When a contract includes an authored milestone, qualifying options MUST carry relationshipMilestoneId and relationshipGroupId, plus canonical relationship movement and relationshipValueEvidence for every named member. A generic relationship/expression choice does not earn group membership.
${input.sceneBlueprint.relationshipPacing.filter((c) => c.milestone).map((c) => `  MILESTONE ${c.milestone!.id}: group ${c.groupId}; members ${c.milestone!.memberNpcIds.join(', ')}; choice scene ${c.milestone!.choiceSceneId}; route policy ${c.milestone!.routeRealizationPolicy ?? 'selected_route'}; required evidence tags ${c.milestone!.requiredEvidenceTags.join(', ')}.${c.milestone!.routeRealizationPolicy === 'all_routes' ? ' This event is canonical on EVERY option: vary tone, cost, leadership, or identity, but do not offer an option that prevents or rejects formation.' : ''}`).join('\n')}
- Relationship choices must show behavioral aftermath: changed distance, invitation, withholding, teasing, remembered detail, vulnerability, challenge, or refusal.
- A relationship choice that claims meaning must include both a numeric relationship consequence and relationshipValueEvidence. The numeric consequence answers what hidden trust/affection/respect/fear changed; relationshipValueEvidence answers what dramatic kind of moment occurred.
- Use relationshipValueEvidence to mark the McKee-square surface the choice earned: mutual aid or confession requires agency-respecting evidence; withheld care requires absence/avoidance evidence; hostility requires sabotage/attack/retaliation evidence; protective control or aid-with-strings requires coercion, guilt, agency removal, or conditional-help evidence.
- Do not use large relationship deltas as a shortcut around pacing. If the scene does not contain a full relationship test, keep deltas small and avoid friend/trusted/intimate labels.
- First-meeting choices cannot assume private phone access. Do not write choices, feedback, reminders, or witness reactions where the protagonist texts/calls/DMs an unmet NPC or already has their number before on-page exchange.
- Do not use blocked labels in choice text, outcome text, feedback, reminder plans, or residue.
- When a group/club is being named at spark, write the christening as a dare, joke, toast, or provisional name. Never write "make it official", "we are the X Club", "official first meeting", or settled membership language — those labels are blocked until the ledger earns them.
` : ''}
${input.sceneBlueprint.mechanicPressure?.length ? `
## Narrative Mechanic Pressure Contracts
Treat mechanics as hidden story pressure, not numbers that directly cause results. Every non-expression consequence should declare or inherit a pressure contract and answer: what changed in the fiction, what future affordance it creates, what residue appears now, what payoff is allowed later, and what payoff is blocked until more evidence exists.
${input.sceneBlueprint.mechanicPressure.map((c) => `- ${c.id}: ${c.domain}/${c.function} — ${authorFacingMechanicPressureText(c)}; evidence: ${c.evidenceRequired.join('; ') || 'show what earns it'}; residue: ${c.visibleResidue.join('; ') || 'show immediate behavior/access/cost/clue/posture'}; allowed payoffs: ${c.allowedPayoffs.join('; ') || 'earned future permission'}; blocked payoffs: ${c.blockedPayoffs.join('; ') || 'unsupported payoff'}`).join('\n')}
- Use \`residueHints\`, \`reminderPlan\`, \`feedbackCue\`, or \`witnessReactions\` to make hidden pressure visible.
- Bare state math is not enough unless the consequence is purely infrastructural.
- Conditions/gates should spend pressure that has already been planted or is reachable through prior choices.
` : ''}
${input.sceneBlueprint.characterTreatmentContracts?.length ? `
## Protagonist Treatment Contracts For This Choice
Use these authored protagonist fields to shape option pressure and aftermath. Do not display contract labels or raw mechanics.
${input.sceneBlueprint.characterTreatmentContracts.map((c) => `- ${c.fieldName} (${c.contractKind}): ${c.sourceText}; realize through ${c.requiredRealization.join(', ')}`).join('\n')}
- At least one choice should test the relevant Want/Need/Lie/Truth gap when those contracts are present.
- Consequences should leave visible identity, route, relationship, information, or reputation residue that makes later payoff believable.
- Ending/climax contracts require active player/protagonist agency; do not let the route resolve through outside rescue or summary.
` : ''}
${input.sceneBlueprint.worldTreatmentContracts?.length ? `
## World/Location Treatment Contracts For This Choice
Use authored setting rules and location pressure as fiction-first affordances, risks, gates, consequences, residue, or information movement. Do not display rule labels or raw mechanics.
${input.sceneBlueprint.worldTreatmentContracts.map((c) => `- ${c.fieldName} (${c.contractKind}${c.locationName ? ` @ ${c.locationName}` : ''}): ${c.sourceText}; realize through ${c.requiredRealization.join(', ')}`).join('\n')}
- Location choice pressure should affect what options are tempting, risky, forbidden, costly, or newly possible.
- Dramatic/supernatural rules should constrain outcomes and create visible residue; do not contradict a rule to make a convenient branch.
- If a choice spends access, sanctuary, faction leverage, sacred object, taboo, or danger pressure, include residueHints/reminderPlan/feedbackCue so later scenes can pay it off.
` : ''}
## Requirements
- Create ${input.optionCount} distinct choices
- Each choice must have the complete Stakes Triangle
- Include appropriate consequences for each choice
- Link choices to next scenes where appropriate
- Use conditions if any options should be locked
- Use the choicePoint consequence/reminder guidance when provided
- When a choice changes scenes, make the choice text and reminder/feedback copy explain why that route follows. The pipeline will insert one or more bridge beats before the target scene; do not rely on the target opener to do all transition work.

## Outcome Texts (REQUIRED for every choice)

Every choice MUST include \`outcomeTexts\` — three 1–3 sentence narrative passages depicting
the choice enacted in the fiction. They are selected at play time by the skill check tier.
Write them in second person, present tense, grounded in the specific scene:

- **success**: The action lands cleanly. The protagonist achieves what they wanted.
- **partial**: A complication arises — partial success, unexpected cost, or a twist.
- **failure**: The action backfires or falls flat. Something goes wrong.

STAY IN THIS SETTING — **${input.sceneBlueprint.location}**. Every outcome must be
physically consistent with this place: only reference objects, surfaces, and surroundings
that plausibly exist here. Do NOT borrow furniture or scenery from a different kind of
location (e.g. never put a coffee table, rug, or sofa in an outdoor park or street scene).

VARY THE SENTENCE OPENERS. The reader is "you", so second person is correct — but do
NOT stack subject-first "You …" declaratives. Never let two consecutive sentences in a
tier begin with "You"/"Your". Open sentences instead with the object or consequence, a
dependent clause, a sensory beat, an NPC's name/action, dialogue, or the environment as
subject. The "You" can fall mid-sentence.
- Flat (avoid): "You take the card. You clock the squeeze, too quick. You let the thought dissolve."
- Varied (prefer): "The card is warm from her hand. Too quick, too tight — you clock the squeeze, then the music pulls you forward and the thought dissolves."

## Reaction Text (REQUIRED for non-branching choices)

Every choice that does NOT branch to a new scene must also include \`reactionText\`:
1–2 sentences showing the world's immediate response AFTER the payoff.
This is the echo, not the action itself. It ends the moment and flows into the next scene.

## Tint Flag (for non-branching choices)

Provide a \`tintFlag\` that best characterises the tone this choice sets. Use ONLY
this canonical vocabulary (anything else is ignored by the identity engine):
\`tint:mercy\`, \`tint:justice\`, \`tint:forgiveness\`, \`tint:punishment\`, \`tint:compassion\`,
\`tint:vengeance\`, \`tint:idealism\`, \`tint:pragmatism\`, \`tint:sacrifice\`, \`tint:survival\`,
\`tint:honor\`, \`tint:expedience\`, \`tint:caution\`, \`tint:boldness\`, \`tint:patience\`,
\`tint:aggression\`, \`tint:diplomacy\`, \`tint:force\`, \`tint:independence\`, \`tint:leadership\`,
\`tint:teamwork\`, \`tint:solitude\`, \`tint:emotion\`, \`tint:logic\`, \`tint:intuition\`,
\`tint:calculation\`, \`tint:honesty\`, \`tint:deception\`, \`tint:truth\`, \`tint:manipulation\`.
Branching choices (those with \`nextSceneId\`) do NOT need a \`tintFlag\`.

## Moral Contract (REQUIRED for dilemma choices)

Every dilemma option must include \`moralContract\`:
- \`valueA\` and \`valueB\`: the two values in real conflict
- \`unavoidableCost\`: what cannot be protected no matter what the player chooses
- \`benefits\`: who gains or is protected
- \`harms\`: who pays, loses trust, loses safety, or is exposed
- \`uncertainty\`: what the player cannot know yet

## Residue Hints (REQUIRED for meaningful non-expression choices)

Every relationship, strategic, or dilemma choice must include at least one \`residueHints\` item.
Use these to tell later systems how the choice should echo without forcing a graph branch.
Valid kinds: \`immediate_prose_echo\`, \`later_text_variant\`, \`relationship_behavior\`,
\`encounter_advantage\`, \`encounter_complication\`, \`visual_staging\`, \`recap_summary\`.

## Stat Check (REQUIRED for relationship, strategic, dilemma)

Each stat check defines a CHALLENGE GEOMETRY — the combination of skills the situation demands.
Use \`skillWeights\` (must sum to 1.0, use 1-3 skills) instead of a single \`attribute\`.

Available skills: athletics, stealth, perception, persuasion, intimidation, deception, investigation, survival

Examples:
  Simple:  "statCheck": { "skillWeights": { "persuasion": 1.0 }, "difficulty": 50 }
  Complex: "statCheck": { "skillWeights": { "persuasion": 0.5, "perception": 0.3, "deception": 0.2 }, "difficulty": 55 }

Think about what the situation DEMANDS:
  - Talking down an armed suspect: persuasion 0.4, perception 0.3, intimidation 0.3
  - Sneaking past guards: stealth 0.6, perception 0.3, athletics 0.1
  - Investigating a crime scene: investigation 0.5, perception 0.3, survival 0.2

- **expression**: NO \`statCheck\`. Never.
- **relationship**: Add \`statCheck\` with skillWeights relevant to the social dynamic.
- **strategic** / **dilemma**: Add \`statCheck\` with skillWeights + difficulty 35–80.
- Difficulty bands: easy 35-45, moderate 45-60, hard 60-70, extreme 71-80.
- Any difficulty above 60 must have at least one support: prepared modifier, useful item/clue, relationship leverage, alternate route, or playable failure residue.
- Any difficulty above 70 must have at least two supports.
- Prepared advantage belongs in \`statCheck.modifiers\`. It is hidden math from prior state, but \`hint\` must be fiction-first prose.
- Never expose stats, rolls, thresholds, bonuses, modifiers, percentages, or skill-check language to the player.

Modifier example:
  "modifiers": [
    {
      "id": "kept_the_chapel_promise",
      "condition": { "type": "flag", "flag": "kept_chapel_promise", "value": true },
      "delta": 15,
      "reason": "The NPC remembers the promise and is easier to reach.",
      "hint": "The promise she made in the chapel still gives you a way in."
    }
  ]

## Required JSON Shape

Return one compact JSON object matching the deterministic schema. Do not copy a
boilerplate example. Emit only fields that are required below or conditionally
required for this choice type.

Minimum object:
- Top level: beatId, choiceType, choices, overallStakes, designNotes.
- Each choice: id, text, choiceType, choiceIntent, impactFactors, consequenceTier,
  stakesAnnotation, consequences, outcomeTexts.
- Non-branching choices: add reactionText and tintFlag.
- relationship/strategic/dilemma choices: add statCheck and residueHints.
- dilemma choices: add moralContract.
- Branching choices: add nextSceneId.

Compactness limits:
- text: 5-${this.choiceLimits?.maxChoiceWords ?? 15} words.
- outcomeTexts.success / partial / failure: exactly ONE vivid sentence each.
- reactionText: exactly ONE sentence.
- residueHints.description: exactly ONE concrete sentence.
- designNotes: one short clause, not reasoning prose.
- Do not emit witnessReactions, failureResidue, reminderPlan, feedbackCue,
  visualResidueHint, memorableMoment, stakesLayers, storyVerb, or affordanceSource
  unless the prompt explicitly requires that field for this scene.

Canonical consequence examples:
- setFlag: {"type":"setFlag","flag":"accepted_quartz","value":true}
- relationship: {"type":"relationship","npcId":"char-mihaela-mika-drgan","dimension":"trust","change":5}
- score: {"type":"changeScore","score":"blog_reach","change":1}

CRITICAL REQUIREMENTS:
1. Create exactly ${input.optionCount} unique, meaningful choices
2. The "overallStakes" field is REQUIRED with want, cost, and identity filled in
3. Each choice needs stakesAnnotation with want, cost, and identity
4. Each choice needs choiceIntent, impactFactors, consequenceTier, and consequences
5. ${choicePoint.branches ? 'This is a BRANCHING choice point — set nextSceneId on each choice to one of the available next scenes' : 'Only include nextSceneId if this choice should route to a different scene (expression choices must NOT have nextSceneId)'}
6. Every choice MUST have compact outcomeTexts (success, partial, failure) — original prose, not the choice text
7. Non-branching choices MUST have reactionText and tintFlag
8. relationship/strategic/dilemma choices MUST have statCheck
9. Dilemma choices MUST include moralContract with competing values and unavoidable cost
10. Meaningful non-expression choices MUST include at least one residueHints item
11. \`setFlag\` consequences MUST use \`flag\` plus boolean \`value\`: \`{"type":"setFlag","flag":"accepted_quartz","value":true}\`; never \`{"type":"setFlag","value":"accepted_quartz"}\` and never bare \`{"type":"setFlag","value":"true"}\`
12. residueHints should describe visible fiction-first turns, not abstract state deltas
13. Expression/flavor choices must use choiceIntent "flavor", consequenceTier "sceneTint", and must NOT branch
14. Meaningful choices must include at least one impact factor from outcome, process, information, relationship, identity
15. Stat-check failure should create playable fiction inside outcomeTexts.failure, not only metadata
16. Return ONLY valid JSON, no markdown, no extra text
`;
  }

  private buildCompactPrompt(input: ChoiceAuthorInput): string {
    const choicePoint = input.sceneBlueprint.choicePoint!;
    const nextSceneList = input.possibleNextScenes
      .slice(0, Math.max(4, input.optionCount))
      .map(scene => `- ${scene.id}: ${scene.name} — ${scene.description}`)
      .join('\n');
    const npcList = input.npcsInScene
      .slice(0, 6)
      .map(npc => `- ${npc.name} (${npc.id}, ${npc.pronouns})${npc.voiceNotes ? ` voice: ${npc.voiceNotes}` : ''}`)
      .join('\n');
    const flagList = input.availableFlags
      .slice(0, 24)
      .map(f => `${f.name}: ${f.description}`)
      .join('\n');
    const routeFlags = input.availableFlags.filter(f => f.name.startsWith('route_')).map(f => f.name);
    const scoreList = input.availableScores
      .slice(0, 12)
      .map(s => `${s.name}: ${s.description}`)
      .join('\n');
    const callbackList = (input.unresolvedCallbacks || [])
      .slice(0, 6)
      .map(h => `- ${h.id}: ${h.summary}`)
      .join('\n');
    const canonicalContinuitySection = this.buildCanonicalContinuitySection(input);
    const branchTargets = input.requiredBranchTargets?.length
      ? input.requiredBranchTargets.map(t => `- ${t.sceneId}: ${t.intent}`).join('\n')
      : '';
    const choiceResolutionSection = this.buildChoiceResolutionTaskSection(input);
    const requiresSharedResolution = choiceResolutionSection.length > 0;
    const departureHandoffSection = this.buildDepartureHandoffSection(input);

    return `Create a compact playable ChoiceSet. Return ONLY JSON. The deterministic response schema is supplied by the caller; match that schema exactly and do not invent fields.

## Story
- Title: ${input.storyContext.title}
- Genre/Tone: ${input.storyContext.genre} / ${input.storyContext.tone}
- Protagonist: ${input.protagonistInfo.name} (${input.protagonistInfo.pronouns})

## Scene
- Id: ${input.sceneBlueprint.id}
- Name: ${input.sceneBlueprint.name}
- Location: ${input.sceneBlueprint.location}
- Mood: ${input.sceneBlueprint.mood}
- Choice beat id: ${input.beatId}
- Beat text: ${input.beatText}

## Choice Point
- Type: ${choicePoint.type}
- Description: ${choicePoint.description}
- Want: ${choicePoint.stakes.want}
- Cost: ${choicePoint.stakes.cost}
- Identity: ${choicePoint.stakes.identity}
- Option hints: ${choicePoint.optionHints.join(', ')}
${choicePoint.branches ? '- Branching: yes' : '- Branching: no'}
${choicePoint.consequenceDomain ? `- Consequence domain: ${choicePoint.consequenceDomain}` : ''}
${choicePoint.expectedResidue?.length ? `- Expected residue: ${choicePoint.expectedResidue.join('; ')}` : ''}
${choicePoint.failureBranchPurpose ? `- Failure branch purpose: ${choicePoint.failureBranchPurpose}` : ''}

## Characters Present
 - ${input.protagonistInfo.name} (protagonist)
${npcList || 'None'}
This is a CLOSED CAST for reader-facing choice prose. Only the protagonist and the people listed here may act, speak, react, or be named as present. Do not invent a person, substitute names from another story, or rename a canonical character.

## Available Next Scenes
${nextSceneList || 'None'}
${branchTargets ? `
## Required Branch Targets
Author exactly one choice for each target below. Set nextSceneId to that target.
${branchTargets}
` : ''}
${canonicalContinuitySection}

## Available State
Flags:
${flagList || 'None'}
${routeFlags.length ? `Route flags: ${routeFlags.join(', ')}` : ''}
Scores:
${scoreList || 'None'}
${callbackList ? `
Callbacks available for small echoes:
${callbackList}
` : ''}
${input.sceneBlueprint.relationshipPacing?.some((contract) => contract.milestone) ? `
## Authored Relationship Milestone
${input.sceneBlueprint.relationshipPacing.filter((contract) => contract.milestone).map((contract) => {
    const milestone = contract.milestone!;
    return `- ${milestone.id}: group ${contract.groupId}; members ${milestone.memberNpcIds.join(', ')}; route policy ${milestone.routeRealizationPolicy ?? 'selected_route'}.${milestone.routeRealizationPolicy === 'all_routes' ? ' EVERY option must still realize formation; choices vary how it happens and what it costs, never whether it happens.' : ''}`;
  }).join('\n')}
Use only the exact canonical NPC ids listed under Characters Present in every relationship consequence and relationshipValueEvidence entry.
` : ''}${choiceResolutionSection ? `\n${choiceResolutionSection}` : ''}${departureHandoffSection ? `\n${departureHandoffSection}` : ''}

## Required Shape
Top level fields: beatId, choiceType, choices, overallStakes, designNotes${requiresSharedResolution ? ', sharedResolutionText' : ''}.
Each choice fields: id, text, choiceType, choiceIntent, impactFactors, consequenceTier, stakesAnnotation, consequences, outcomeTexts.
Non-branching choices also need reactionText and tintFlag.
Relationship/strategic/dilemma choices also need statCheck and residueHints.
Dilemma choices also need moralContract.
Branching choices need nextSceneId.

## Output Limits
- Create exactly ${input.optionCount} choices.
- Choice text: 5-${this.choiceLimits?.maxChoiceWords ?? 15} words.
- stakesAnnotation.want/cost/identity: at most 12 words each.
- outcomeTexts.success/partial/failure: exactly one vivid sentence each, at most 16 words.
- reactionText: exactly one sentence, at most 16 words.
- residueHints.description: exactly one concrete sentence, at most 16 words.
- designNotes: one short clause, at most 8 words.
${requiresSharedResolution ? '- sharedResolutionText: one or two vivid sentences; realize the route-invariant canonical payoff once.\n' : ''}- Do not emit witnessReactions, failureResidue, reminderPlan, feedbackCue, visualResidueHint, memorableMoment, stakesLayers, storyVerb, affordanceSource, or authorNotes.

## Consequences
- setFlag: {"type":"setFlag","flag":"accepted_quartz","value":true}
- relationship: {"type":"relationship","npcId":"char-mihaela-mika-drgan","dimension":"trust","change":5}
- score: {"type":"changeScore","score":"blog_reach","change":1}
- Never put the flag name in value. Never emit {"type":"setFlag","value":"flag_name"}.

## Stat Checks
Expression choices: no statCheck.
Relationship/strategic/dilemma choices: include statCheck using skillWeights and difficulty.
Available skills: athletics, stealth, perception, persuasion, intimidation, deception, investigation, survival.
Example: {"skillWeights":{"persuasion":1},"difficulty":45}

## Quality Rules
- Every option must feel valid and scene-specific.
- Every choice needs stakesAnnotation.want, stakesAnnotation.cost, stakesAnnotation.identity.
- outcomeTexts must dramatize different success/partial/failure results, not repeat the choice text.
- Non-branching choices must have reactionText and tintFlag.
- Meaningful non-expression choices must include at least one residueHints item.
- Keep mechanics fiction-first: no dice, DCs, stats, thresholds, percentages, or system language in player-facing text.
- Use second person for the protagonist, with varied sentence openers.`;
  }

  private validateChoices(
    choiceSet: ChoiceSet,
    input: ChoiceAuthorInput,
    options: { allowSyntheticReaderTextFallbacks?: boolean } = {},
  ): void {
    const allowSyntheticReaderTextFallbacks = options.allowSyntheticReaderTextFallbacks ?? true;
    const relationshipSignalText = [
      input.sceneBlueprint.choicePoint?.type,
      input.sceneBlueprint.choicePoint?.consequenceDomain,
      input.sceneBlueprint.encounterBuildup,
      ...(input.sceneBlueprint.encounterSetupContext || []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const sceneCallsForRelationshipPayoff =
      /relationship|trust|affection|respect|fear|bond|ally|rival|love/.test(relationshipSignalText);

    // Check choice count
    if (choiceSet.choices.length < MIN_READER_CHOICES) {
      throw new Error(`Must have at least ${MIN_READER_CHOICES} choices`);
    }

    if (choiceSet.choices.length > MAX_READER_CHOICES) {
      throw new Error(`Should not have more than ${MAX_READER_CHOICES} choices`);
    }

    // Check each choice has required fields (auto-fix where possible)
    for (let i = 0; i < choiceSet.choices.length; i++) {
      const choice = choiceSet.choices[i];
      
      // Auto-fix missing id
      if (!choice.id) {
        choice.id = `choice-${i + 1}`;
        console.warn(`[ChoiceAuthor] Auto-generated id for choice ${i}: ${choice.id}`);
      }
      
      // Auto-fix missing text
      if (!choice.text) {
        choice.text = `Option ${i + 1}`;
        console.warn(`[ChoiceAuthor] Auto-generated text for choice ${choice.id}`);
      }

      const text = typeof choice.text === 'string' ? choice.text : String(choice.text);
      
      // Auto-fix too short text
      if (text.length < 5) {
        choice.text = `Choose: ${text || 'this option'}`;
        console.warn(`[ChoiceAuthor] Extended short choice text for ${choice.id}`);
      }

      // Auto-fix too long text (truncate with ellipsis)
      if (text.length > 150) {
        choice.text = text.substring(0, 147) + '...';
        console.warn(`[ChoiceAuthor] Truncated long choice text for ${choice.id}`);
      }
    }

    // Check for duplicate IDs
    const ids = choiceSet.choices.map(c => c.id);
    const uniqueIds = new Set(ids);
    if (uniqueIds.size !== ids.length) {
      throw new Error('Choice IDs must be unique');
    }

    this.normalizeCanonicalChoiceParticipants(choiceSet, input);

    // === STRUCTURAL ENFORCEMENT: branching is a property, not a type ===
    
    // Expression choices must NEVER branch (nextSceneId not allowed)
    if (choiceSet.choiceType === 'expression') {
      for (const choice of choiceSet.choices) {
        if (choice.nextSceneId) {
          console.warn(
            `[ChoiceAuthor] Expression choice "${choice.id}" has nextSceneId "${choice.nextSceneId}" — ` +
            `expression choices are cosmetic and must not route to different scenes. Removing nextSceneId.`
          );
          delete choice.nextSceneId;
        }
      }
    }

    // Relationship choices MUST include per-option relationship movement/evidence.
    if (choiceSet.choiceType === 'relationship') {
      const repaired = this.ensureRelationshipChoiceMovement(choiceSet, input);
      if (repaired > 0) {
        console.warn(
          `[ChoiceAuthor] Relationship choice set "${choiceSet.beatId}" had no relationship ` +
          `movement/evidence on ${repaired} option(s) — repaired at option level.`
        );
      }
      this.ensureAuthoredRelationshipMilestone(choiceSet, input);
    }
    // Mechanic-pressure metadata may attach a default magnitude of 6; clamp
    // relationship deltas AFTER that so planned maxDeltaThisScene wins.
    this.ensureMechanicPressureMetadata(choiceSet, input, { allowSyntheticReaderTextFallbacks });
    this.capRelationshipConsequences(choiceSet, input);

    if (sceneCallsForRelationshipPayoff) {
      const hasRelationshipPayoff = choiceSet.choices.some(choice =>
        choice.consequences?.some(con => con.type === 'relationship')
        || choice.reminderPlan?.shortTerm
        || choice.feedbackCue?.echoSummary
      );
      if (!hasRelationshipPayoff) {
        console.warn(
          `[ChoiceAuthor] Scene "${input.sceneBlueprint.id}" carries relationship setup, but choice set "${choiceSet.beatId}" ` +
          `does not visibly spend it. Add relationship consequences or reminder/feedback copy so prior bonds matter.`
        );
      }
    }

    // Strategic, dilemma, and relationship choices MUST include statCheck on ≥1 option.
    // Auto-assign a default statCheck if the LLM forgot. Rotate the skill off
    // the historical persuasion/investigation/survival monoculture (1.7): record
    // skills already in use, then pick the least-used skill relevant to the
    // choice type so the season exercises >=5/6 attributes.
    if (choiceSet.choiceType === 'strategic' || choiceSet.choiceType === 'dilemma' || choiceSet.choiceType === 'relationship') {
      this.trackStatCheckSkills(choiceSet.choices);
      const hasStatCheck = choiceSet.choices.some(c => c.statCheck);
      if (!hasStatCheck) {
        const defaultSkill = this.leastUsedRelevantSkill(choiceSet.choiceType);
        const defaultDiff = choiceSet.choiceType === 'dilemma' ? 60 : 50;
        choiceSet.choices[0].statCheck = { skillWeights: { [defaultSkill]: 1.0 }, difficulty: defaultDiff };
        this.skillUsage[defaultSkill] = (this.skillUsage[defaultSkill] ?? 0) + 1;
        console.warn(
          `[ChoiceAuthor] ${choiceSet.choiceType.toUpperCase()} choice set "${choiceSet.beatId}" ` +
          `had no statCheck — auto-assigned ${defaultSkill}@${defaultDiff} to choice-0.`
        );
      } else {
        // Spread authored stat-checks off the LLM's favoured skill toward under-used,
        // type-relevant ones so the season covers >=6 skills with no >30% dominance.
        this.rebalanceStatCheckSkills(choiceSet);
      }
    }

    // Expression choices should set flags for callback tracking
    if (choiceSet.choiceType === 'expression') {
      const setsFlag = choiceSet.choices.some(c =>
        c.consequences?.some(con => con.type === 'setFlag')
      );
      if (!setsFlag) {
        console.warn(
          `[ChoiceAuthor] Expression choice set "${choiceSet.beatId}" sets no flags. ` +
          `Expression choices should set memorable flags (e.g., "was_sarcastic_to_bartender") ` +
          `so NPCs can reference them in later dialogue callbacks.`
        );
      }
    }

    // If blueprint says this choice point should branch, ensure nextSceneId is present
    if (input.sceneBlueprint.choicePoint?.branches) {
      const possibleScenes = input.possibleNextScenes || [];
      for (const choice of choiceSet.choices) {
        if (!choice.nextSceneId) {
          if (possibleScenes.length > 0) {
            const idx = choiceSet.choices.indexOf(choice) % possibleScenes.length;
            choice.nextSceneId = possibleScenes[idx]?.id;
            console.warn(
              `[ChoiceAuthor] Blueprint marks this as branching but choice "${choice.id}" ` +
              `missing nextSceneId — auto-assigned to "${choice.nextSceneId}"`
            );
          } else {
            console.warn(
              `[ChoiceAuthor] Blueprint marks this as branching but choice "${choice.id}" ` +
              `has no nextSceneId and no possible next scenes available`
            );
          }
        }
      }
    }

    // === nextSceneId must align with scene leadsTo — auto-correct if invalid ===
    const leadsTo = input.sceneBlueprint.leadsTo || [];
    if (leadsTo.length > 0) {
      for (let i = 0; i < choiceSet.choices.length; i++) {
        const choice = choiceSet.choices[i];
        if (choice.nextSceneId && !leadsTo.includes(choice.nextSceneId)) {
          const corrected = leadsTo[i % leadsTo.length];
          console.warn(
            `[ChoiceAuthor] Choice "${choice.id}" routes to "${choice.nextSceneId}" ` +
            `which is NOT in leadsTo [${leadsTo.join(', ')}]. Auto-correcting to "${corrected}".`
          );
          choice.nextSceneId = corrected;
        }
      }
    } else {
      for (const choice of choiceSet.choices) {
        if (choice.nextSceneId && !this.isTerminalRouteTarget(choice.nextSceneId)) {
          console.warn(
            `[ChoiceAuthor] Choice "${choice.id}" on terminal scene "${input.sceneBlueprint.id}" ` +
            `invented nextSceneId "${choice.nextSceneId}". Routing to episode-end instead.`
          );
          choice.nextSceneId = 'episode-end';
        }
      }
    }

    // === Guard: nextSceneId must not point backward to the current scene or its ancestors ===
    const currentSceneId = input.sceneBlueprint.id;
    for (const choice of choiceSet.choices) {
      if (choice.nextSceneId === currentSceneId) {
        const corrected = leadsTo.length > 0 ? leadsTo[0] : undefined;
        console.warn(
          `[ChoiceAuthor] Choice "${choice.id}" creates a self-loop to "${currentSceneId}". ` +
          `Auto-correcting to "${corrected || 'undefined (will advance naturally)'}".`
        );
        choice.nextSceneId = corrected;
      }
    }

    // For dilemma choices or choices that branch, ensure stakes are present
    const choicesBranch = choiceSet.choices.some(c => c.nextSceneId);
    if (choiceSet.choiceType === 'dilemma' || choicesBranch) {
      const stakes = choiceSet.overallStakes;
      // Stakes should have been auto-filled in normalization, so just warn if still missing
      if (!stakes.want || !stakes.cost || !stakes.identity) {
        console.warn(`[ChoiceAuthor] Stakes incomplete after normalization, using fallbacks`);
        // These should have been set in normalization, but just in case:
        if (!stakes.want) stakes.want = 'achieve their goal';
        if (!stakes.cost) stakes.cost = 'face potential consequences';
        if (!stakes.identity) stakes.identity = 'reveal what matters to them';
      }

      // Stakes quality check - just warn, don't fail
      const minStakesLength = 10;
      if (stakes.want.length < minStakesLength) {
        console.warn(`[ChoiceAuthor] Stakes WANT is brief (${stakes.want.length} chars)`);
      }
      if (stakes.cost.length < minStakesLength) {
        console.warn(`[ChoiceAuthor] Stakes COST is brief (${stakes.cost.length} chars)`);
      }
      if (stakes.identity.length < minStakesLength) {
        console.warn(`[ChoiceAuthor] Stakes IDENTITY is brief (${stakes.identity.length} chars)`);
      }

      // Check individual choice stakes
      for (const choice of choiceSet.choices) {
        if (choice.stakesAnnotation) {
          const s = choice.stakesAnnotation;
          if (!s.want || !s.cost || !s.identity) {
            throw new Error(`Choice "${choice.id}" has incomplete stakes annotation`);
          }
        }

        if ((choiceSet.choiceType === 'dilemma' || choice.nextSceneId) && !choice.reminderPlan?.shortTerm) {
          console.warn(
            `[ChoiceAuthor] Choice "${choice.id}" is high-stakes but lacks a strong reminderPlan.shortTerm; ` +
            `the story may fail to visibly remember it`
          );
        }
      }

      // Five-Factor check: high-stakes choices (dilemma or branching) must affect at least 1 factor
      for (const choice of choiceSet.choices) {
        if (choice.consequences && choice.consequences.length > 0) {
          const impact = this.fiveFactorValidator.analyzeConsequencesHeuristic(
            choice.consequences.map(c => ({ ...c }))
          );
          const factorCount = this.fiveFactorValidator.countFactors(impact);

          if (factorCount === 0) {
            console.warn(
              `[ChoiceAuthor] Choice "${choice.id}" has consequences but affects 0 of 5 factors - ` +
              `consider adding impact to OUTCOME, PROCESS, INFORMATION, RELATIONSHIP, or IDENTITY`
            );
          }
        } else if (choiceSet.choiceType === 'dilemma') {
          // Dilemmas should always have consequences
          console.warn(
            `[ChoiceAuthor] Dilemma choice "${choice.id}" has no consequences - ` +
            `dilemmas should have meaningful impact`
          );
        }
      }
    }

    // For dilemmas, ensure no single choice is obviously better
    if (choiceSet.choiceType === 'dilemma') {
      // Check that consequences are balanced (rough heuristic)
      const hasPositive = choiceSet.choices.some(c =>
        c.consequences?.some(con =>
          (con.type === 'changeScore' && con.change > 0) ||
          (con.type === 'relationship' && con.change > 0)
        )
      );
      const hasNegative = choiceSet.choices.some(c =>
        c.consequences?.some(con =>
          (con.type === 'changeScore' && con.change < 0) ||
          (con.type === 'relationship' && con.change < 0)
        )
      );

      // This is a soft check - dilemmas should have tradeoffs
      if (!hasPositive && !hasNegative) {
        console.warn('Dilemma choices have no positive or negative consequences - consider adding tradeoffs');
      }

      // Dilemma choices should set tint flags (e.g., "tint:mercy", "tint:justice")
      const setsTintFlag = choiceSet.choices.some(c =>
        c.consequences?.some(con =>
          con.type === 'setFlag' && typeof con.flag === 'string' && con.flag.startsWith('tint:')
        )
      );
      if (!setsTintFlag) {
        console.warn(
          `[ChoiceAuthor] Dilemma choice set "${choiceSet.beatId}" sets no tint flags. ` +
          `Dilemma choices should set tint flags (e.g., {type:"setFlag", flag:"tint:mercy", value:true}) ` +
          `so subsequent scenes can adapt their tone via textVariants.`
        );
      }

      for (const choice of choiceSet.choices) {
        if (!choice.moralContract) {
          choice.moralContract = {
            valueA: choice.stakesAnnotation?.want || choiceSet.overallStakes?.want || 'protect one value',
            valueB: choice.stakesAnnotation?.identity || choiceSet.overallStakes?.identity || 'protect a competing value',
            unavoidableCost: choice.stakesAnnotation?.cost || choiceSet.overallStakes?.cost || 'Someone pays a cost either way.',
            benefits: [],
            harms: [],
            uncertainty: 'The full consequence is not yet visible.',
          };
          console.warn(`[ChoiceAuthor] Dilemma choice "${choice.id}" missing moralContract — added advisory fallback.`);
        }
      }
    }

    for (const choice of choiceSet.choices) {
      if (allowSyntheticReaderTextFallbacks && choiceSet.choiceType !== 'expression' && (!choice.residueHints || choice.residueHints.length === 0)) {
        choice.residueHints = [{
          kind: choice.reminderPlan?.later ? 'later_text_variant' : 'immediate_prose_echo',
          description:
            choice.reminderPlan?.later ||
            choice.reminderPlan?.shortTerm ||
            choice.feedbackCue?.progressSummary ||
            'Let this choice echo in later prose, relationship behavior, or recap language.',
        }];
        console.warn(`[ChoiceAuthor] Meaningful choice "${choice.id}" missing residueHints — added advisory fallback.`);
      }
    }
  }

  private validateAuthoredFlagSemantics(choiceSet: ChoiceSet, input: ChoiceAuthorInput): void {
    const contracts = input.authoredFlagContracts ?? [];
    if (contracts.length === 0) return;
    const byName = new Map(contracts.map((contract) => [contract.name, contract.description]));
    const canonicalByAlias = new Map<string, string>();
    for (const state of input.canonicalStateContracts ?? []) {
      for (const alias of state.aliases) canonicalByAlias.set(alias, state.canonicalStateId);
    }
    for (const choice of choiceSet.choices) {
      for (const consequence of choice.consequences ?? []) {
        if (consequence.type !== 'setFlag' || consequence.value === false || typeof consequence.flag !== 'string') continue;
        const canonical = canonicalByAlias.get(consequence.flag);
        if (canonical && canonical !== consequence.flag) {
          throw new Error(`Choice "${choice.id}" emits registered state alias "${consequence.flag}"; use canonical state id "${canonical}".`);
        }
        const description = byName.get(consequence.flag);
        if (!description) continue;
        const surface = [
          input.beatText,
          choice.text,
          choice.outcomeTexts?.success,
          choice.outcomeTexts?.partial,
          choice.outcomeTexts?.failure,
          choice.reminderPlan?.immediate,
          choice.reminderPlan?.shortTerm,
        ].filter(Boolean).join(' ').toLowerCase();
        const descriptionText = description.toLowerCase();
        const semanticAction = /confid/.test(descriptionText)
          ? /confid|open(?:s|ed)?\s+up|share|tell|admit|reveal/.test(surface)
          : descriptionText.split(/[^a-z0-9]+/)
            .filter((token) => token.length >= 5)
            .filter((token) => !new Set(['player', 'episode', 'scene', 'early', 'later', 'with']).has(token))
            .some((token) => surface.includes(token));
        if (!semanticAction) {
          throw new Error(
            `Authored flag "${consequence.flag}" is set by choice "${choice.id}" without staging its contracted action: ${description}`,
          );
        }
      }
    }
  }

  private isTerminalRouteTarget(sceneId: string | undefined): boolean {
    if (!sceneId) return false;
    const id = sceneId.trim().toLowerCase();
    return id === 'episode-end' || id === 'story-end' || id === 'the-end' || id === 'end' || id.startsWith('episode-');
  }

  private isProtagonistNpc(candidate: { id?: string; name?: string } | undefined, input: ChoiceAuthorInput): boolean {
    if (!candidate) return false;
    const protagonistName = input.protagonistInfo.name.trim().toLowerCase();
    const protagonistSlug = protagonistName.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const id = String(candidate.id || '').trim().toLowerCase();
    const name = String(candidate.name || '').trim().toLowerCase();
    const protagonistNorm = protagonistName.replace(/[^a-z0-9]/g, '');
    const idNorm = id.replace(/[^a-z0-9]/g, '');
    const nameNorm = name.replace(/[^a-z0-9]/g, '');
    return Boolean(
      (protagonistName && name === protagonistName) ||
      (protagonistName && name.startsWith(`${protagonistName} `)) ||
      (protagonistName && id === protagonistName) ||
      (protagonistSlug && id === protagonistSlug) ||
      (protagonistSlug && id === `char-${protagonistSlug}`) ||
      (protagonistSlug && id.startsWith(`char-${protagonistSlug}-`)) ||
      (protagonistSlug && id.startsWith(`${protagonistSlug}-`)) ||
      (protagonistNorm.length >= 4 && (idNorm.startsWith(`char${protagonistNorm}`) || nameNorm.startsWith(protagonistNorm)))
    );
  }

  private selectRelationshipNpc(input: ChoiceAuthorInput): ChoiceAuthorInput['npcsInScene'][number] | undefined {
    const validNpcs = input.npcsInScene.filter(candidate => !this.isProtagonistNpc(candidate, input));
    if (validNpcs.length === 0) return undefined;
    const trajectory = input.arcTargets?.relationshipTrajectory?.[0];
    if (trajectory) {
      return validNpcs.find(candidate => candidate.id === trajectory.npcId) ?? validNpcs[0];
    }
    return validNpcs[0];
  }

  private relationshipPacingKey(value: string | undefined): string | undefined {
    const normalized = normalizeRelationshipKey(value);
    if (!normalized) return undefined;
    return normalized.replace(/^char-/, '') || undefined;
  }

  private relationshipPacingKeysMatch(a: string | undefined, b: string | undefined): boolean {
    const left = this.relationshipPacingKey(a);
    const right = this.relationshipPacingKey(b);
    if (!left || !right) return false;
    return left === right || left.includes(right) || right.includes(left);
  }

  private relationshipPacingForNpc(input: ChoiceAuthorInput, npcId?: string): RelationshipPacingContract | undefined {
    const contracts = input.sceneBlueprint.relationshipPacing ?? [];
    if (npcId) {
      const exact = contracts.find((contract) => contract.npcId === npcId);
      if (exact) return exact;
      const aliased = contracts.find((contract) => this.relationshipPacingKeysMatch(contract.npcId, npcId));
      if (aliased) return aliased;
      // Fall back to NPC name aliases from the scene cast when contract ids are display names.
      const npc = input.npcsInScene.find((candidate) =>
        this.relationshipPacingKeysMatch(candidate.id, npcId)
        || this.relationshipPacingKeysMatch(candidate.name, npcId)
      );
      if (npc) {
        const byCast = contracts.find((contract) =>
          this.relationshipPacingKeysMatch(contract.npcId, npc.id)
          || this.relationshipPacingKeysMatch(contract.npcId, npc.name)
        );
        if (byCast) return byCast;
      }
    }
    return contracts.find((contract) => isNpcPacingContract(contract));
  }

  private relationshipConsequenceDimension(input: ChoiceAuthorInput): 'trust' | 'affection' | 'respect' | 'fear' {
    const trajectoryDimension = input.arcTargets?.relationshipTrajectory?.[0]?.dimension;
    if (trajectoryDimension === 'bond') return 'affection';
    if (
      trajectoryDimension === 'trust'
      || trajectoryDimension === 'affection'
      || trajectoryDimension === 'respect'
      || trajectoryDimension === 'fear'
    ) {
      return trajectoryDimension;
    }
    const pacingDimension = input.sceneBlueprint.relationshipPacing?.[0]?.mechanicDimensions?.[0];
    return pacingDimension ?? 'trust';
  }

  private ensureAuthoredRelationshipMilestone(choiceSet: ChoiceSet, input: ChoiceAuthorInput): void {
    const contract = (input.sceneBlueprint.relationshipPacing ?? []).find((candidate) =>
      candidate.milestone?.choiceSceneId === input.sceneBlueprint.id
      && candidate.milestone.kind === 'group_formation'
    );
    const milestone = contract?.milestone;
    if (!contract?.groupId || !milestone || choiceSet.choices.length === 0) return;

    const selectedChoice = choiceSet.choices.find((candidate) =>
      candidate.relationshipMilestoneId === milestone.id
      || /\b(?:join|form|found|name|christen|choose|stay|accept|together|club|circle|crew)\b/i.test(
        `${candidate.text ?? ''} ${candidate.choiceIntent ?? ''}`,
      )
    ) ?? choiceSet.choices[0];
    const choices = milestone.routeRealizationPolicy === 'all_routes'
      ? choiceSet.choices
      : [selectedChoice];

    const maxDelta = Math.max(1, Math.min(6, Math.abs(contract.maxDeltaThisScene || 6)));
    for (const choice of choices) {
      choice.choiceType = 'relationship';
      choice.relationshipMilestoneId = milestone.id;
      choice.relationshipGroupId = contract.groupId;
      for (const rawNpcId of milestone.memberNpcIds) {
        const npcId = this.canonicalNpcIdForInput(rawNpcId, input);
        if (!npcId) {
          throw new Error(`Relationship milestone "${milestone.id}" references unknown member "${rawNpcId}".`);
        }
        const hasMovement = (choice.consequences ?? []).some((consequence) =>
          consequence.type === 'relationship' && consequence.npcId === npcId
        );
        if (!hasMovement) {
          choice.consequences = [
            ...(choice.consequences ?? []),
            { type: 'relationship', npcId, dimension: contract.mechanicDimensions[0] ?? 'trust', change: maxDelta },
          ];
        }
        this.ensureRelationshipValueEvidence(
          choice,
          npcId,
          contract.mechanicDimensions[0] ?? 'trust',
          true,
        );
      }
    }
  }

  private canonicalNpcIdForInput(value: string | undefined, input: ChoiceAuthorInput): string | undefined {
    if (!value) return undefined;
    const matches = input.npcsInScene.filter((npc) =>
      this.relationshipPacingKeysMatch(npc.id, value)
      || this.relationshipPacingKeysMatch(npc.name, value)
    );
    return matches.length === 1 ? matches[0].id : undefined;
  }

  /** Normalize known aliases in structured choice metadata and reject foreign
   * participants before the result reaches the relationship ledger. Reader
   * prose is never deterministically rewritten here. */
  private normalizeCanonicalChoiceParticipants(choiceSet: ChoiceSet, input: ChoiceAuthorInput): void {
    const normalize = (value: string | undefined, field: string): string | undefined => {
      if (!value) return value;
      const canonical = this.canonicalNpcIdForInput(value, input);
      if (!canonical) {
        throw new Error(`${field} references unknown NPC "${value}". Use only the canonical scene roster: ${input.npcsInScene.map((npc) => `${npc.name} (${npc.id})`).join(', ')}.`);
      }
      return canonical;
    };
    const normalizeConsequence = (consequence: Consequence, field: string): void => {
      if (consequence.type === 'relationship' || consequence.type === 'relationshipEvidence') {
        consequence.npcId = normalize(consequence.npcId, `${field}.npcId`)!;
      }
    };
    const normalizeCondition = (condition: unknown, field: string): void => {
      if (!condition || typeof condition !== 'object') return;
      const raw = condition as { type?: string; npcId?: string; conditions?: unknown[]; condition?: unknown };
      if (raw.type === 'relationship' && raw.npcId) raw.npcId = normalize(raw.npcId, `${field}.npcId`);
      for (const child of raw.conditions ?? []) normalizeCondition(child, `${field}.conditions`);
      if (raw.condition) normalizeCondition(raw.condition, `${field}.condition`);
    };
    for (const choice of choiceSet.choices ?? []) {
      for (const [index, consequence] of (choice.consequences ?? []).entries()) {
        normalizeConsequence(consequence, `choice ${choice.id}.consequences[${index}]`);
      }
      for (const [index, delayed] of (choice.delayedConsequences ?? []).entries()) {
        normalizeConsequence(delayed.consequence, `choice ${choice.id}.delayedConsequences[${index}]`);
      }
      for (const [index, evidence] of (choice.relationshipValueEvidence ?? []).entries()) {
        evidence.npcId = normalize(evidence.npcId, `choice ${choice.id}.relationshipValueEvidence[${index}].npcId`)!;
      }
      for (const [index, reaction] of (choice.witnessReactions ?? []).entries()) {
        reaction.npcId = normalize(reaction.npcId, `choice ${choice.id}.witnessReactions[${index}].npcId`)!;
      }
      for (const [index, hint] of (choice.residueHints ?? []).entries()) {
        if (hint.targetNpcId) hint.targetNpcId = normalize(hint.targetNpcId, `choice ${choice.id}.residueHints[${index}].targetNpcId`);
      }
      normalizeCondition(choice.conditions, `choice ${choice.id}.conditions`);
    }
  }

  /** Default early-scene safety cap when no pacing contract is present (matches pacingMaxDelta(0)). */
  private static readonly DEFAULT_RELATIONSHIP_DELTA_CAP = 6;

  private capRelationshipConsequences(choiceSet: ChoiceSet, input: ChoiceAuthorInput): number {
    const contracts = mergeSceneRelationshipPacing(undefined, input.sceneBlueprint.relationshipPacing);
    let capped = 0;
    for (const choice of choiceSet.choices) {
      for (const consequence of choice.consequences ?? []) {
        if (consequence.type !== 'relationship' || typeof consequence.change !== 'number') continue;
        const contractCap = effectiveNpcDeltaCap(contracts, consequence.npcId, new Map());
        const max = contractCap ?? ChoiceAuthor.DEFAULT_RELATIONSHIP_DELTA_CAP;
        if (consequence.change > max) {
          consequence.change = max;
          capped += 1;
        } else if (consequence.change < -max) {
          consequence.change = -max;
          capped += 1;
        }
      }
    }
    if (capped > 0) {
      console.warn(`[ChoiceAuthor] Capped ${capped} relationship consequence delta(s) to scene pacing contract.`);
    }
    return capped;
  }

  private ensureMechanicPressureMetadata(
    choiceSet: ChoiceSet,
    input: ChoiceAuthorInput,
    options: { allowSyntheticReaderTextFallbacks?: boolean } = {},
  ): number {
    const allowSyntheticReaderTextFallbacks = options.allowSyntheticReaderTextFallbacks ?? true;
    if (choiceSet.choiceType === 'expression') return 0;
    const sceneContracts = input.sceneBlueprint.mechanicPressure ?? [];
    let repaired = 0;

    for (const choice of choiceSet.choices) {
      const meaningful = this.meaningfulConsequences(choice.consequences ?? []);
      if (meaningful.length === 0 && !choice.conditions && !choice.statCheck && !choice.nextSceneId) continue;

      if (!choice.mechanicPressure?.length) {
        const inherited = this.matchMechanicPressureContracts(meaningful, sceneContracts);
        choice.mechanicPressure = inherited.length > 0
          ? inherited
          : [this.fallbackMechanicPressureContract(choice, choiceSet, input, meaningful[0])];
        repaired += 1;
      }

      if (allowSyntheticReaderTextFallbacks && !choice.residueHints?.length) {
        choice.residueHints = [{
          kind: choice.nextSceneId ? 'later_text_variant' : 'immediate_prose_echo',
          description: this.residueDescriptionForChoice(choice, choice.mechanicPressure[0]),
        }];
        repaired += 1;
      }

      if (!choice.reminderPlan || this.isMechanicalReminderPlan(choice.reminderPlan.immediate)) {
        const pressure = choice.mechanicPressure[0];
        choice.reminderPlan = {
          immediate: this.fictionFirstImmediateReminder(choice, pressure, input),
          shortTerm: this.fictionFirstShortTermReminder(choice, pressure, input),
        };
        repaired += 1;
      }

      repaired += this.capUnsupportedMechanicMagnitude(choice, choice.mechanicPressure);
    }

    if (repaired > 0) {
      console.warn(`[ChoiceAuthor] Added narrative mechanic pressure metadata/residue to ${repaired} choice field(s).`);
    }
    return repaired;
  }

  private isMechanicalReminderPlan(text: string | undefined): boolean {
    const value = String(text || '');
    return /\bchoice leaves visible pressure around\b/i.test(value)
      || /\bRelationship with\b[\s\S]{0,160}\bmoving only as far as\b/i.test(value)
      || /\bGroup belonging\b[\s\S]{0,160}\bmoving only as far as\b/i.test(value);
  }

  private fictionFirstImmediateReminder(
    choice: Choice,
    contract: MechanicPressureContract | undefined,
    input: ChoiceAuthorInput,
  ): string {
    switch (contract?.domain) {
      case 'relationship':
        return this.relationshipImmediateReminder(choice, contract, input);
      case 'item':
        return `The object sits differently in the hand now, heavier with what it opens, costs, or proves.`;
      case 'information':
      case 'flag':
        return `A new silence opens around what can be said aloud.`;
      case 'skill':
        return `The attempt leaves proof in the room: what worked, what failed, and what the next risk will demand.`;
      case 'identity':
        return `Your answer settles into your posture before anyone names what it says about you.`;
      case 'route':
        return `The choice changes the path in a way the next scene can feel before it explains.`;
      case 'score':
      case 'resource':
        return `The moment leaves a visible cost behind: less room to bluff, delay, or pretend nothing changed.`;
      default:
        return `The room moves around the answer before anyone names what changed.`;
    }
  }

  private fictionFirstShortTermReminder(
    choice: Choice,
    contract: MechanicPressureContract | undefined,
    input: ChoiceAuthorInput,
  ): string {
    switch (contract?.domain) {
      case 'relationship': {
        const npcId = contract.mechanicRef.npcId;
        const npc = input.npcsInScene.find((candidate) => candidate.id === npcId && !this.isProtagonistNpc(candidate, input));
        return npc
          ? `${npc.name} carries the answer into the next silence.`
          : `The next silence keeps the shape of the answer.`;
      }
      case 'item':
        return `The next door, hand, or lie has to account for what was taken up.`;
      case 'information':
      case 'flag':
        return `The next conversation has to step around the truth now in the room.`;
      case 'skill':
        return `The next risk starts with the proof this attempt left behind.`;
      case 'identity':
        return `The next room reads the answer in your posture before you explain it.`;
      case 'route':
        return `The next threshold feels different before anyone explains why.`;
      case 'score':
      case 'resource':
        return `The next demand arrives with less room to pretend nothing was spent.`;
      default:
        return `The next silence, glance, or opened door carries what changed.`;
    }
  }

  private relationshipImmediateReminder(
    choice: Choice,
    contract: MechanicPressureContract,
    input: ChoiceAuthorInput,
  ): string {
    const npcId = contract.mechanicRef.npcId;
    const npc = input.npcsInScene.find((candidate) => candidate.id === npcId && !this.isProtagonistNpc(candidate, input));
    const relationship = (choice.consequences ?? []).find((consequence): consequence is Consequence & {
      type: 'relationship';
      change?: number;
    } => consequence.type === 'relationship' && (!npcId || consequence.npcId === npcId));
    const change = relationship?.change ?? 0;

    if (!npc) {
      return change < 0
        ? `Your answer leaves a little more distance in the room, visible before anyone says why.`
        : `Your answer changes your posture by a fraction, enough for the next room to read it.`;
    }

    if (change < 0) {
      return `${npc.name}'s attention cools by a fraction; the next words have to cross a little more distance.`;
    }
    if (change > 0) {
      return `${npc.name} softens by a fraction, not trust yet, but enough to change the next silence.`;
    }
    return `${npc.name} clocks the answer and adjusts by inches, careful enough that the room can feel it.`;
  }

  private meaningfulConsequences(consequences: Consequence[]): Consequence[] {
    return consequences.filter((consequence) => {
      if (!consequence || typeof consequence !== 'object') return false;
      if (consequence.type === 'setFlag') {
        return Boolean((consequence as Consequence & { flag?: string }).flag)
          && !/^(_|ui_|debug_|choice_seen_|visited_)/i.test((consequence as Consequence & { flag?: string }).flag || '');
      }
      return [
        'relationship',
        'attribute',
        'skill',
        'changeScore',
        'setScore',
        'addItem',
        'removeItem',
        'addTag',
        'removeTag',
      ].includes(consequence.type);
    });
  }

  private matchMechanicPressureContracts(
    consequences: Consequence[],
    contracts: MechanicPressureContract[],
  ): MechanicPressureContract[] {
    const matches: MechanicPressureContract[] = [];
    for (const consequence of consequences) {
      const match = contracts.find((contract) => this.contractMatchesConsequence(contract, consequence));
      if (match) matches.push(match);
    }
    return matches.length > 0 ? Array.from(new Map(matches.map((c) => [c.id, c])).values()) : contracts.slice(0, 1);
  }

  private contractMatchesConsequence(contract: MechanicPressureContract, consequence: Consequence): boolean {
    switch (consequence.type) {
      case 'relationship':
        return contract.domain === 'relationship'
          && (!contract.mechanicRef.npcId || contract.mechanicRef.npcId === consequence.npcId)
          && (!contract.mechanicRef.relationshipDimension || contract.mechanicRef.relationshipDimension === consequence.dimension);
      case 'skill':
        return contract.domain === 'skill' && (!contract.mechanicRef.skill || contract.mechanicRef.skill === consequence.skill);
      case 'attribute':
        return contract.domain === 'identity' && (!contract.mechanicRef.identityAxis || contract.mechanicRef.identityAxis === consequence.attribute);
      case 'setFlag':
        return contract.domain === 'flag' && (!contract.mechanicRef.flag || contract.mechanicRef.flag === consequence.flag);
      case 'changeScore':
      case 'setScore':
        return contract.domain === 'score' && (!contract.mechanicRef.score || contract.mechanicRef.score === consequence.score);
      case 'addItem':
      case 'removeItem':
        return contract.domain === 'item';
      case 'addTag':
      case 'removeTag':
        return contract.domain === 'identity';
      default:
        return false;
    }
  }

  private fallbackMechanicPressureContract(
    choice: Choice,
    choiceSet: ChoiceSet,
    input: ChoiceAuthorInput,
    consequence?: Consequence,
  ): MechanicPressureContract {
    const domain = this.domainForConsequence(consequence, choice);
    const id = `${input.sceneBlueprint.id}-${choice.id}-pressure`;
    const relationshipNpcId = consequence?.type === 'relationship'
      ? (consequence as Consequence & { npcId?: string }).npcId
      : undefined;
    const pacingCap = domain === 'relationship'
      ? this.relationshipPacingForNpc(input, relationshipNpcId)?.maxDeltaThisScene
      : undefined;
    return {
      id,
      source: 'choice',
      domain,
      mechanicRef: this.mechanicRefForConsequence(consequence, choice),
      function: choice.nextSceneId ? 'gate' : 'plant',
      storyPressure: input.sceneBlueprint.choicePoint?.stakes.cost || input.sceneBlueprint.wantVsNeed || choice.text,
      evidenceRequired: ['show what the player does, risks, learns, gives, withholds, or proves'],
      visibleResidue: ['show immediate changed behavior, access, posture, clue, cost, memory, or narrowed option'],
      allowedPayoffs: [input.plannedConsequenceTier === 'branch' ? 'route permission with visible cost' : 'later callback, text variant, small access shift, or NPC posture change'],
      blockedPayoffs: ['instant intimacy, loyalty, mastery, full trust, or information the player did not earn'],
      originatingSceneId: input.sceneBlueprint.id,
      maxMagnitudeThisScene: domain === 'relationship'
        ? Math.abs(pacingCap && pacingCap > 0 ? pacingCap : ChoiceAuthor.DEFAULT_RELATIONSHIP_DELTA_CAP)
        : 10,
    };
  }

  private domainForConsequence(consequence: Consequence | undefined, choice: Choice): MechanicPressureContract['domain'] {
    if (!consequence) {
      if (choice.statCheck) return 'skill';
      if (choice.nextSceneId) return 'route';
      return 'flag';
    }
    switch (consequence.type) {
      case 'relationship': return 'relationship';
      case 'skill': return 'skill';
      case 'attribute':
      case 'addTag':
      case 'removeTag': return 'identity';
      case 'setFlag': return 'flag';
      case 'changeScore':
      case 'setScore': return 'score';
      case 'addItem':
      case 'removeItem': return 'item';
      default: return 'resource';
    }
  }

  private mechanicRefForConsequence(
    consequence: Consequence | undefined,
    choice: Choice,
  ): MechanicPressureContract['mechanicRef'] {
    if (!consequence) {
      const skill = choice.statCheck?.skill || Object.keys(choice.statCheck?.skillWeights ?? {})[0];
      return skill ? { skill } : choice.nextSceneId ? { routeId: choice.nextSceneId } : {};
    }
    switch (consequence.type) {
      case 'relationship':
        return { npcId: consequence.npcId, relationshipDimension: consequence.dimension };
      case 'skill':
        return { skill: consequence.skill };
      case 'attribute':
        return { identityAxis: String(consequence.attribute) };
      case 'setFlag':
        return { flag: consequence.flag };
      case 'changeScore':
      case 'setScore':
        return { score: consequence.score };
      case 'addItem':
        return { itemId: 'itemId' in consequence ? consequence.itemId : consequence.item.name };
      case 'removeItem':
        return { itemId: consequence.itemId };
      case 'addTag':
      case 'removeTag':
        return { identityAxis: consequence.tag };
      default:
        return {};
    }
  }

  private residueDescriptionForChoice(choice: Choice, contract?: MechanicPressureContract): string {
    const pressure = contract?.storyPressure || choice.text;
    switch (contract?.domain) {
      case 'relationship':
        return `Show the NPC's changed distance, testing, warmth, withholding, or remembered detail after "${choice.text}".`;
      case 'item':
        return `Show the object as access, burden, clue, obligation, or callback pressure after "${choice.text}".`;
      case 'information':
      case 'flag':
        return `Show what the player now knows, hides, risks exposing, or can act on after "${choice.text}".`;
      case 'skill':
        return `Show what the player proves, fails, learns, or notices so later tactics feel earned.`;
      default:
        return `After "${choice.text}", make the changed access, posture, tone, cost, clue, memory, or narrowed options visible.`;
    }
  }

  private capUnsupportedMechanicMagnitude(choice: Choice, contracts: MechanicPressureContract[] | undefined): number {
    let capped = 0;
    const maxByDomain = new Map(contracts?.map((contract) => [contract.domain, contract.maxMagnitudeThisScene]) ?? []);
    for (const consequence of choice.consequences ?? []) {
      const domain = this.domainForConsequence(consequence, choice);
      const max = maxByDomain.get(domain);
      if (!max || max <= 0) continue;
      if ((consequence.type === 'relationship' || consequence.type === 'skill' || consequence.type === 'attribute' || consequence.type === 'changeScore') && typeof consequence.change === 'number') {
        if (consequence.change > max) {
          consequence.change = max;
          capped += 1;
        } else if (consequence.change < -max) {
          consequence.change = -max;
          capped += 1;
        }
      }
    }
    return capped;
  }

  private repairRelationshipTargets(choiceSet: ChoiceSet, input: ChoiceAuthorInput): number {
    const targetNpc = this.selectRelationshipNpc(input);
    if (!targetNpc) return 0;

    let repaired = 0;
    for (const choice of choiceSet.choices) {
      for (const consequence of choice.consequences ?? []) {
        if (consequence.type !== 'relationship') continue;
        const rel = consequence as Consequence & { npcId?: string; characterId?: string };
        const target = { id: rel.npcId || rel.characterId, name: rel.npcId || rel.characterId };
        if (!this.isProtagonistNpc(target, input)) continue;
        rel.npcId = targetNpc.id;
        delete rel.characterId;
        repaired += 1;
      }
    }
    if (repaired > 0) {
      console.warn(
        `[ChoiceAuthor] Retargeted ${repaired} protagonist relationship consequence(s) to NPC "${targetNpc.id}".`
      );
    }
    return repaired;
  }

  private addRelationshipConsequences(choiceSet: ChoiceSet, input: ChoiceAuthorInput): number {
    const npc = this.selectRelationshipNpc(input);
    if (!npc) return 0;

    const dimension = this.relationshipConsequenceDimension(input);
    const maxDelta = Math.abs(this.relationshipPacingForNpc(input, npc.id)?.maxDeltaThisScene ?? 6);
    let repaired = 0;
    for (let i = 0; i < choiceSet.choices.length; i += 1) {
      const choice = choiceSet.choices[i];
      const text = `${choice.text || ''} ${choice.choiceIntent || ''}`.toLowerCase();
      const positive = /\b(accept|trust|help|protect|honest|stay|listen|gentle|kind|join|share|comfort)\b/.test(text)
        ? true
        : /\b(refuse|reject|lie|hide|leave|cruel|mock|threaten|push|accuse|withdraw)\b/.test(text)
          ? false
          : i === 0;
      choice.consequences = [...(choice.consequences || []), {
        type: 'relationship',
        npcId: npc.id,
        dimension,
        change: positive ? Math.min(5, maxDelta) : -Math.min(3, maxDelta),
      }];
      this.ensureRelationshipValueEvidence(choice, npc.id, dimension, positive);
      repaired += 1;
    }
    return repaired;
  }

  private relationshipChoiceHasMovement(choice: Choice): boolean {
    return (choice.consequences ?? []).some((consequence) => consequence.type === 'relationship')
      || (choice.relationshipValueEvidence ?? []).length > 0;
  }

  private ensureRelationshipChoiceMovement(choiceSet: ChoiceSet, input: ChoiceAuthorInput): number {
    const npc = this.selectRelationshipNpc(input);
    if (!npc) return 0;
    const dimension = this.relationshipConsequenceDimension(input);
    const maxDelta = Math.abs(this.relationshipPacingForNpc(input, npc.id)?.maxDeltaThisScene ?? 6);
    let repaired = 0;

    for (let i = 0; i < choiceSet.choices.length; i += 1) {
      const choice = choiceSet.choices[i];
      if (this.relationshipChoiceHasMovement(choice)) {
        const rel = (choice.consequences ?? []).find((consequence) => consequence.type === 'relationship') as (Consequence & { npcId?: string; dimension?: string; change?: number }) | undefined;
        this.ensureRelationshipValueEvidence(choice, rel?.npcId ?? npc.id, this.normalizeRelationshipDimension(rel?.dimension) ?? dimension, Number(rel?.change ?? 1) >= 0);
        continue;
      }

      const text = `${choice.text || ''} ${choice.choiceIntent || ''}`.toLowerCase();
      const positive = /\b(accept|trust|help|protect|honest|stay|listen|gentle|kind|join|share|comfort)\b/.test(text)
        ? true
        : /\b(refuse|reject|lie|hide|leave|cruel|mock|threaten|push|accuse|withdraw)\b/.test(text)
          ? false
          : i === 0;
      choice.consequences = [...(choice.consequences || []), {
        type: 'relationship',
        npcId: npc.id,
        dimension,
        change: positive ? Math.min(5, maxDelta) : -Math.min(3, maxDelta),
      }];
      this.ensureRelationshipValueEvidence(choice, npc.id, dimension, positive);
      repaired += 1;
    }

    return repaired;
  }

  private normalizeRelationshipDimension(value: string | undefined): RelationshipValueAxis | undefined {
    if (value === 'affection') return 'love';
    if (value === 'fear') return 'safety';
    if (value === 'trust' || value === 'respect') return value;
    return undefined;
  }

  private ensureRelationshipValueEvidence(choice: Choice, npcId: string, dimension: RelationshipValueAxis | 'affection' | 'fear', positive: boolean): void {
    if ((choice.relationshipValueEvidence ?? []).some((evidence) => evidence.npcId === npcId)) return;
    const axis: RelationshipValueAxis = dimension === 'fear' ? 'safety' : dimension === 'affection' ? 'love' : dimension;
    const evidenceTags: RelationshipEvidenceTag[] = positive ? ['respected_agency'] : ['withheld_care'];
    choice.relationshipValueEvidence = [
      ...(choice.relationshipValueEvidence ?? []),
      {
        npcId,
        axis,
        evidenceTags,
        // A generic fallback proves directional movement only. It cannot
        // claim a thematic-square surface until the canonical relationship
        // transition compiler has checked the before/after rung.
        reason: `The choice "${choice.text}" visibly changes the relationship surface.`,
      },
    ];
  }

  /**
   * Analyze five-factor impact for a choice (public method for external use)
   */
  analyzeFiveFactorImpact(choice: GeneratedChoice): FiveFactorImpact {
    const consequences = (choice.consequences || []).map(c => ({ ...c }));
    return this.fiveFactorValidator.analyzeConsequencesHeuristic(consequences);
  }

  /**
   * LLM-based quality validation for branching/dilemma choices
   * Validates stakes quality and five-factor impact
   * Returns issues for potential revision
   */
  private async validateChoiceQuality(choiceSet: ChoiceSet, input: ChoiceAuthorInput): Promise<string[]> {
    console.log(`[ChoiceAuthor] Running LLM quality validation for ${choiceSet.choiceType} choice`);
    const issues: string[] = [];

    // 1. Stakes Quality Validation
    const stakesResult = await this.stakesValidator.validate({
      choiceId: choiceSet.beatId,
      choiceType: choiceSet.choiceType,
      choiceText: choiceSet.choices.map(c => c.text).join(' | '),
      want: choiceSet.overallStakes.want,
      cost: choiceSet.overallStakes.cost,
      identity: choiceSet.overallStakes.identity,
      context: `Scene: ${input.sceneBlueprint.name}. ${input.sceneBlueprint.description}`,
    });

    // Collect stakes validation issues.
    // Bucket C soft-gate: apply hysteresis to the overall-score boundary so a
    // borderline LLM-judged draw does not trigger a (noisy) revision. The
    // `!stakesResult.passed` arm still fires on genuine component failures
    // (error-level want/cost/identity), which are not borderline. Default-off
    // via GATE_JUDGE_STABILIZATION keeps the prior hard `< minStakesScore` gate.
    const overallScore = stakesResult.score?.overall;
    const stabilizationEnabled = isGateEnabled('GATE_JUDGE_STABILIZATION');
    const overallScoreFails =
      overallScore !== undefined &&
      shouldFailStakesScore(
        overallScore,
        this.minStakesScore,
        this.stakesHysteresisMargin,
        stabilizationEnabled,
      );
    if (!stakesResult.passed || overallScoreFails) {
      const score = overallScore ?? 'N/A';
      console.warn(
        `[ChoiceAuthor] Stakes quality issue: score ${score}/${this.minStakesScore}. ` +
        `Issues: ${stakesResult.issues.map(i => i.message).join('; ')}`
      );

      for (const issue of stakesResult.issues) {
        const suggestion = issue.suggestion ? ` Suggestion: ${issue.suggestion}` : '';
        issues.push(`STAKES: ${issue.message}${suggestion}`);
      }
    } else {
      // Advisory checkpoint: if stakes passed only because hysteresis absorbed a
      // borderline-band score, record it so the soft-gate degrade is observable.
      // (No audit baseDir is plumbed into ChoiceAuthor; remediation-ledger
      // wiring is deferred rather than threading new params through the agent.)
      if (
        stabilizationEnabled &&
        overallScore !== undefined &&
        overallScore < this.minStakesScore &&
        stakesResult.passed
      ) {
        console.warn(
          `[ChoiceAuthor] Stakes soft-gate degraded (score ${overallScore} in ` +
          `[${this.minStakesScore - this.stakesHysteresisMargin}, ${this.minStakesScore}) ` +
          `band) - skipping revision (GATE_JUDGE_STABILIZATION). Ledger wiring deferred.`
        );
      } else {
        console.log(`[ChoiceAuthor] Stakes validation passed (score: ${overallScore})`);
      }
    }

    // 2. Five-Factor LLM Validation for each choice
    for (const choice of choiceSet.choices) {
      const fiveFactorResult = await this.fiveFactorValidator.validate({
        choiceId: choice.id,
        choiceType: choiceSet.choiceType,
        choiceText: choice.text,
        consequences: (choice.consequences || []).map(c => ({ ...c })),
        context: `Scene: ${input.sceneBlueprint.name}`,
      });

      const factorCount = this.fiveFactorValidator.countFactors(fiveFactorResult.impact);

      if (!fiveFactorResult.passed) {
        const errorIssues = fiveFactorResult.issues.filter(i => i.level === 'error');
        for (const issue of errorIssues) {
          console.warn(`[ChoiceAuthor] Five-factor issue for choice "${choice.id}": ${issue.message}`);
          issues.push(`FIVE-FACTOR (choice "${choice.id}"): ${issue.message}`);
        }
      }

      if (factorCount === 0 && (choiceSet.choiceType === 'dilemma' || choice.nextSceneId)) {
        const label = choiceSet.choiceType === 'dilemma' ? 'Dilemma' : 'Branching';
        const msg = `${label} choice "${choice.id}" affects 0 of 5 factors - must change at least OUTCOME, PROCESS, INFORMATION, RELATIONSHIP, or IDENTITY`;
        console.warn(`[ChoiceAuthor] ${msg}`);
        issues.push(`FIVE-FACTOR: ${msg}`);
      }

      console.log(
        `[ChoiceAuthor] Choice "${choice.id}" affects ${factorCount} factors: ` +
        Object.entries(fiveFactorResult.impact)
          .filter(([, v]) => v)
          .map(([k]) => k.toUpperCase())
          .join(', ') || 'none'
      );
    }

    console.log(`[ChoiceAuthor] LLM quality validation complete - ${issues.length} issues found`);
    return issues;
  }

  /**
   * Execute a revision pass to fix identified issues
   */
  private async executeRevision(
    input: ChoiceAuthorInput,
    originalChoiceSet: ChoiceSet,
    issues: string[]
  ): Promise<AgentResponse<ChoiceSet>> {
    console.log(`[ChoiceAuthor] Executing revision to fix ${issues.length} issues`);

    const issueList = issues.map((issue, i) => `${i + 1}. ${issue}`).join('\n');
    const choicePoint = input.sceneBlueprint.choicePoint!;

    const revisionPrompt = `
You previously generated choices for a ${choicePoint.type} decision point, but there are quality issues that need to be fixed.

## Original Choice Set
\`\`\`json
${JSON.stringify(originalChoiceSet, null, 2)}
\`\`\`

## Issues to Fix
${issueList}

## How to Fix

### STAKES Issues
- WANT: Make it clear what the player is trying to achieve
- COST: Make it clear what they risk losing or sacrificing
- IDENTITY: Make it clear what choosing this says about who they are

### FIVE-FACTOR Issues
Ensure each non-flavor choice affects at least ONE of:
- OUTCOME: Changes what happens next in the story
- PROCESS: Changes how something happens
- INFORMATION: Reveals or conceals important information
- RELATIONSHIP: Affects how characters relate to each other
- IDENTITY: Shapes who the protagonist is becoming

Add consequences that create these impacts:
- setFlag consequences for OUTCOME/PROCESS changes
- relationship consequences with positive/negative change values
- addTag/removeTag for IDENTITY changes

## Story Context
- **Scene**: ${input.sceneBlueprint.name}
- **Location**: ${input.sceneBlueprint.location}
- **Choice Type**: ${choicePoint.type}
- **Stakes**:
  - Want: ${choicePoint.stakes.want}
  - Cost: ${choicePoint.stakes.cost}
  - Identity: ${choicePoint.stakes.identity}

## Requirements
Return a REVISED ChoiceSet JSON that fixes all the issues above.
Keep the same basic structure but improve:
1. Stakes descriptions (want, cost, identity) - make them more specific and meaningful
2. Consequences - ensure they create real impact on the 5 factors
3. Choice text - ensure it reveals intent and character
4. Reminder planning - make it clear how the story will echo this choice soon after it happens
5. Consequence legibility - clarify the main domain of impact and the fiction-first risk framing

Return ONLY valid JSON, no markdown, no extra text.
`;

    try {
      const response = await this.callLLM(
        [{ role: 'user', content: revisionPrompt }],
        4,
        { jsonSchema: this.buildJsonSchema(input) },
      );

      console.log(`[ChoiceAuthor] Received revision response (${response.length} chars)`);

      let revisedChoiceSet: ChoiceSet;
      try {
        revisedChoiceSet = this.parseJSON<ChoiceSet>(response);
      } catch (parseError) {
        console.error(`[ChoiceAuthor] Revision JSON parse failed, using original`);
        return {
          success: true,
          data: originalChoiceSet,
          rawResponse: response,
        };
      }

      const completenessIssues = this.collectChoiceAuthoringCompletenessIssues(revisedChoiceSet, input);
      if (completenessIssues.length > 0) {
        throw new Error(
          `ChoiceAuthor revision omitted required authoring fields: ${completenessIssues.join('; ')}`,
        );
      }

      // Normalize the revised content
      revisedChoiceSet = this.normalizeChoiceSet(revisedChoiceSet, input);

      // Validate structural requirements
      this.validateChoices(revisedChoiceSet, input, { allowSyntheticReaderTextFallbacks: false });

      console.log(`[ChoiceAuthor] Revision complete`);
      return {
        success: true,
        data: revisedChoiceSet,
        rawResponse: response,
      };
    } catch (error) {
      console.error(`[ChoiceAuthor] Revision failed, using original:`, error);
      return {
        success: true,
        data: originalChoiceSet,
      };
    }
  }
}
