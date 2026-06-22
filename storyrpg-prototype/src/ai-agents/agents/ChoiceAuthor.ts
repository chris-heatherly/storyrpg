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
import { FALLBACK_OUTCOME_TEXT_POOLS, isFallbackReminderStub } from '../constants/choiceTextFallbacks';
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
import {
  SourceMaterialAnalysis,
  StoryAnchors,
  SevenPointStructure,
  StructuralRole,
} from '../../types/sourceAnalysis';
import type { ConsequenceTier, MechanicPressureContract, RelationshipPacingContract } from '../../types/scenePlan';
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
import { normalizeChoiceStatCheck } from '../utils/statCheckNormalization';

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
  availableScores: Array<{ name: string; description: string }>;
  availableTags: Array<{ name: string; description: string }>;

  // Scene connections (where can this choice lead?)
  possibleNextScenes: Array<{
    id: string;
    name: string;
    description: string;
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

  /**
   * Season-level 7-point beat map. ChoiceAuthor uses it to calibrate
   * choice weight: choices in the Climax / Pinch beats should be more
   * consequential than choices in Rising / Hook beats.
   */
  seasonSevenPoint?: SevenPointStructure;

  /**
   * Which beat(s) of the season this episode carries.
   */
  episodeStructuralRole?: StructuralRole[];

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
          { jsonSchema },
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

      // Validate the choices (structural)
      this.validateChoices(choiceSet, input);

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
              return revisionResult;
            } else {
              console.log(`[ChoiceAuthor] Revision did not improve quality, using original`);
            }
          }
        }
      }

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
      { jsonSchema: this.buildJsonSchema(input) },
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
    });
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

    return `Return one complete compact ChoiceSet JSON object. The deterministic schema is supplied by the caller; match it exactly.

Repair reason:
${issueList}

Scene: ${input.sceneBlueprint.id} / ${input.sceneBlueprint.name} / ${input.sceneBlueprint.location}
Beat id: ${input.beatId}
Beat text: ${input.beatText}

Choice point:
- type: ${choicePoint.type}
- options: exactly ${input.optionCount}
- description: ${choicePoint.description}
- option hints: ${optionHints || 'author fitting alternatives from the scene'}
- stakes.want: ${choicePoint.stakes.want}
- stakes.cost: ${choicePoint.stakes.cost}
- stakes.identity: ${choicePoint.stakes.identity}
${isBranching ? `Next scene targets:\n${branchTargets || nextScenes || 'Use available next scenes from schema context.'}` : ''}

Required choice fields:
- Every choice: id, text, choiceType, choiceIntent, impactFactors, consequenceTier, stakesAnnotation, consequences, outcomeTexts.
${isBranching ? '- Every choice must include nextSceneId.' : '- Every choice must include reactionText and tintFlag.'}
${meaningful ? '- Every choice must include statCheck.skillWeights, statCheck.difficulty, and at least one residueHints item.' : '- Expression choices must not include statCheck.'}
${choicePoint.type === 'dilemma' ? '- Every choice must include moralContract.' : ''}

Compactness:
- choice text: 5-${this.choiceLimits?.maxChoiceWords ?? 15} words.
- each outcomeTexts tier: exactly one vivid sentence.
- reactionText: exactly one sentence.
- residueHints.description: exactly one concrete sentence.
- designNotes: one short clause.
- Do not emit authorNotes, witnessReactions, failureResidue, reminderPlan, feedbackCue, visualResidueHint, memorableMoment, stakesLayers, storyVerb, or affordanceSource.

Stat checks for relationship/strategic/dilemma:
- skillWeights object with 1-3 of: athletics, stealth, perception, persuasion, intimidation, deception, investigation, survival.
- exact shape example: {"statCheck":{"skillWeights":{"persuasion":1},"difficulty":45}}

Consequences:
- setFlag shape: {"type":"setFlag","flag":"accepted_quartz","value":true}
- never put a flag name in value.

Return JSON only.`;
  }

  private collectChoiceAuthoringCompletenessIssues(choiceSet: ChoiceSet, input: ChoiceAuthorInput): string[] {
    const issues: string[] = [];
    const plannedChoiceType = input.sceneBlueprint.choicePoint?.type || choiceSet.choiceType || 'expression';
    const choices = Array.isArray(choiceSet.choices) ? choiceSet.choices : [];

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

      for (const consequenceIssue of this.collectConsequenceCompletenessIssues(choice, choiceId)) {
        issues.push(consequenceIssue);
      }
    });

    return issues;
  }

  private hasMeaningfulText(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }

  private collectConsequenceCompletenessIssues(choice: GeneratedChoice, choiceId: string): string[] {
    const issues: string[] = [];
    const consequences = Array.isArray(choice.consequences)
      ? choice.consequences
      : choice.consequences
        ? [choice.consequences as unknown as Consequence]
        : [];

    consequences.forEach((consequence, index) => {
      if (consequence?.type !== 'setFlag') return;
      const raw = consequence as unknown as Record<string, unknown>;
      const flag = typeof raw.flag === 'string'
        ? raw.flag.trim()
        : typeof raw.name === 'string'
          ? raw.name.trim()
          : '';
      const value = typeof raw.value === 'string' ? raw.value.trim() : raw.value;

      if (!flag && !this.parseFlagFromValue(value).flag) {
        issues.push(
          `Choice "${choiceId}" has malformed setFlag consequence #${index + 1}; use {"type":"setFlag","flag":"meaningful_flag","value":true}, not a bare value.`,
        );
      }
      if (flag && typeof value === 'string' && value.length > 0 && !this.parseBooleanString(value)) {
        issues.push(
          `Choice "${choiceId}" setFlag "${flag}" has non-boolean value "${value}"; setFlag.value must be true or false.`,
        );
      }
    });

    return issues;
  }

  private normalizeChoiceConsequences(choice: GeneratedChoice): void {
    const normalized: Consequence[] = [];
    for (const consequence of choice.consequences || []) {
      if (consequence?.type !== 'setFlag') {
        normalized.push(consequence);
        continue;
      }

      const raw = consequence as unknown as Record<string, unknown>;
      const authoredFlag = typeof raw.flag === 'string' && raw.flag.trim()
        ? raw.flag.trim()
        : typeof raw.name === 'string' && raw.name.trim()
          ? raw.name.trim()
          : '';
      const parsedFromValue = this.parseFlagFromValue(raw.value);
      const flag = authoredFlag || parsedFromValue.flag;
      if (!flag) continue;

      const explicitBoolean = typeof raw.value === 'boolean'
        ? raw.value
        : typeof raw.value === 'string'
          ? this.parseBooleanString(raw.value)
          : undefined;
      const value = explicitBoolean ?? parsedFromValue.value ?? true;
      normalized.push({ ...(raw as object), type: 'setFlag', flag, value } as Consequence);
    }
    choice.consequences = normalized;
  }

  private parseFlagFromValue(value: unknown): { flag?: string; value?: boolean } {
    if (typeof value !== 'string') return {};
    const trimmed = value.trim();
    if (!trimmed || this.parseBooleanString(trimmed) !== undefined) return {};
    const colonMatch = trimmed.match(/^([A-Za-z0-9_:\-./]+):(true|false)$/i);
    if (colonMatch) {
      return { flag: colonMatch[1], value: colonMatch[2].toLowerCase() === 'true' };
    }
    return { flag: trimmed, value: true };
  }

  private parseBooleanString(value: string): boolean | undefined {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    return undefined;
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
  async reauthorOutcomeTexts(ctx: {
    choiceText: string;
    stakes?: { want?: string; cost?: string; identity?: string };
    sceneName?: string;
    sceneLocation?: string;
    needTiers: Array<'success' | 'partial' | 'failure'>;
  }): Promise<Partial<Record<'success' | 'partial' | 'failure', string>>> {
    const tiers = ctx.needTiers.length ? ctx.needTiers : (['success', 'partial', 'failure'] as const);
    const stakesLines = ctx.stakes
      ? `WANT (what the player is reaching for): ${ctx.stakes.want ?? 'unstated'}\nCOST (what it risks): ${ctx.stakes.cost ?? 'unstated'}`
      : '';
    const settingLine = ctx.sceneLocation
      ? `SETTING (the outcome MUST stay physically consistent with this place — only reference objects/surroundings that plausibly exist here): ${ctx.sceneLocation}\n`
      : '';
    const prompt = `You are revising the outcome prose for ONE choice in an interactive story. The previous outcomes were placeholder stubs; replace them with scene-specific fiction.

CHOICE the player takes: "${ctx.choiceText}"
${ctx.sceneName ? `SCENE: ${ctx.sceneName}\n` : ''}${settingLine}${stakesLines}

Write a 1–3 sentence fiction-first outcome for each requested tier. Each MUST:
- dramatize what concretely happens in the fiction (action, sensory detail, a line of dialogue if it fits) — never restate the choice or the want/cost annotation;
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
    if (/^this route should keep carrying the decision forward\.?$/i.test(normalized)) return undefined;
    if (/^the route choice lands immediately\.?$/i.test(normalized)) return undefined;
    if (/^the next episode should follow the selected route\.?$/i.test(normalized)) return undefined;
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

      // Auto-generate reactionText fallback for non-branching choices
      if (!choice.nextSceneId && !choice.reactionText) {
        choice.reactionText = 'The moment settles, its weight already reshaping what comes next.';
        console.warn(`[ChoiceAuthor] Choice "${choice.id}" missing reactionText — using fallback`);
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
      choice.consequenceTier = this.normalizeConsequenceTier(choice, choiceSet.choiceType);
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

  private normalizeConsequenceTier(choice: GeneratedChoice, choiceType: ChoiceType): ChoiceConsequenceTier {
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
      sevenPoint: input.seasonSevenPoint,
      episodeStructuralRole: input.episodeStructuralRole,
    });

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

## Characters Present
**Protagonist**: ${input.protagonistInfo.name} (${input.protagonistInfo.pronouns})

**NPCs**:
${npcList || 'None'}

## Available Next Scenes
${nextSceneList}

${storyVerbList ? `## Story Verbs
Use these genre/source-specific action verbs as metadata when they fit. They should shape choice design, but the player-facing choice text should still read naturally.
${storyVerbList}
` : ''}

## Available State for Consequences
**Flags**:
${flagList || 'None defined'}
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
${input.arcTargets && (input.arcTargets.identityDeltaHints?.length || input.arcTargets.relationshipTrajectory?.length) ? `
## Character Arc Milestone Targets (from Arc Tracker)
Design at least ONE choice whose consequences move the protagonist toward these targets.
Tag any such consequence with \`arcDriving: true\` so downstream validators can measure it.
${(input.arcTargets.identityDeltaHints || []).map(h => `- Identity \`${h.dimension}\`: target ${h.direction} (${h.magnitude}). A consequence like \`{ type: "setFlag", name: "arc:${h.dimension}:${h.direction}", arcDriving: true }\` is ideal.`).join('\n')}
${(input.arcTargets.relationshipTrajectory || []).map(r => `- Relationship with ${r.npcId} (${r.dimension}): ${r.direction} — ${r.hint}`).join('\n')}
` : ''}
${input.sceneBlueprint.relationshipPacing?.length ? `
## Relationship Pacing Contracts
Design relationship consequences and aftermath at the earned stage, not the future desired stage.
${input.sceneBlueprint.relationshipPacing.map((c) => `- ${c.npcId ? `NPC ${c.npcId}` : `Group ${c.groupId}`}: ${c.startStage} -> ${c.targetStage}; max relationship delta this scene ${c.maxDeltaThisScene}; allowed labels: ${c.allowedLabels.join(', ')}; blocked labels: ${c.blockedLabels.join(', ')}; evidence: ${c.requiredEvidence.join('; ')}`).join('\n')}
- Relationship choices must show behavioral aftermath: changed distance, invitation, withholding, teasing, remembered detail, vulnerability, challenge, or refusal.
- Do not use blocked labels in choice text, outcome text, feedback, reminder plans, or residue.
` : ''}
${input.sceneBlueprint.mechanicPressure?.length ? `
## Narrative Mechanic Pressure Contracts
Treat mechanics as hidden story pressure, not numbers that directly cause results. Every non-expression consequence should declare or inherit a pressure contract and answer: what changed in the fiction, what future affordance it creates, what residue appears now, what payoff is allowed later, and what payoff is blocked until more evidence exists.
${input.sceneBlueprint.mechanicPressure.map((c) => `- ${c.id}: ${c.domain}/${c.function} — ${c.storyPressure}; evidence: ${c.evidenceRequired.join('; ') || 'show what earns it'}; residue: ${c.visibleResidue.join('; ') || 'show immediate behavior/access/cost/clue/posture'}; allowed payoffs: ${c.allowedPayoffs.join('; ') || 'earned future permission'}; blocked payoffs: ${c.blockedPayoffs.join('; ') || 'unsupported payoff'}`).join('\n')}
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
- relationship: {"type":"relationship","flag":"mika_trust_up","value":true,"npcId":"char-mika-drgan","change":5}
- score: {"type":"changeScore","name":"blog_reach","change":1}

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
    const branchTargets = input.requiredBranchTargets?.length
      ? input.requiredBranchTargets.map(t => `- ${t.sceneId}: ${t.intent}`).join('\n')
      : '';

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
${npcList || 'None'}

## Available Next Scenes
${nextSceneList || 'None'}
${branchTargets ? `
## Required Branch Targets
Author exactly one choice for each target below. Set nextSceneId to that target.
${branchTargets}
` : ''}

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

## Required Shape
Top level fields: beatId, choiceType, choices, overallStakes, designNotes.
Each choice fields: id, text, choiceType, choiceIntent, impactFactors, consequenceTier, stakesAnnotation, consequences, outcomeTexts.
Non-branching choices also need reactionText and tintFlag.
Relationship/strategic/dilemma choices also need statCheck and residueHints.
Dilemma choices also need moralContract.
Branching choices need nextSceneId.

## Output Limits
- Create exactly ${input.optionCount} choices.
- Choice text: 5-${this.choiceLimits?.maxChoiceWords ?? 15} words.
- outcomeTexts.success/partial/failure: exactly one vivid sentence each.
- reactionText: exactly one sentence.
- residueHints.description: exactly one concrete sentence.
- designNotes: one short clause.
- Do not emit witnessReactions, failureResidue, reminderPlan, feedbackCue, visualResidueHint, memorableMoment, stakesLayers, storyVerb, affordanceSource, or authorNotes.

## Consequences
- setFlag: {"type":"setFlag","flag":"accepted_quartz","value":true}
- relationship: {"type":"relationship","flag":"mika_trust_up","value":true,"npcId":"char-mika-drgan","change":5}
- score: {"type":"changeScore","name":"blog_reach","change":1}
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

  private validateChoices(choiceSet: ChoiceSet, input: ChoiceAuthorInput): void {
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

    // Relationship choices MUST include ≥1 relationship consequence
    if (choiceSet.choiceType === 'relationship') {
      const hasRelConsequence = choiceSet.choices.some(c =>
        c.consequences?.some(con => con.type === 'relationship')
      );
      if (!hasRelConsequence) {
        const repaired = this.addRelationshipConsequences(choiceSet, input);
        console.warn(
          `[ChoiceAuthor] Relationship choice set "${choiceSet.beatId}" had no relationship ` +
          `consequences — ${repaired > 0 ? `repaired ${repaired} option(s)` : 'no suitable NPC found for repair'}.`
        );
      }
      this.capRelationshipConsequences(choiceSet, input);
    }
    if (choiceSet.choiceType !== 'relationship' && input.sceneBlueprint.relationshipPacing?.length) {
      this.capRelationshipConsequences(choiceSet, input);
    }
    this.ensureMechanicPressureMetadata(choiceSet, input);

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
      if (choiceSet.choiceType !== 'expression' && (!choice.residueHints || choice.residueHints.length === 0)) {
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
    return Boolean(
      (protagonistName && name === protagonistName) ||
      (protagonistName && id === protagonistName) ||
      (protagonistSlug && id === protagonistSlug) ||
      (protagonistSlug && id === `char-${protagonistSlug}`)
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

  private relationshipPacingForNpc(input: ChoiceAuthorInput, npcId?: string): RelationshipPacingContract | undefined {
    const contracts = input.sceneBlueprint.relationshipPacing ?? [];
    if (npcId) {
      const exact = contracts.find((contract) => contract.npcId === npcId);
      if (exact) return exact;
    }
    return contracts.find((contract) => contract.npcId) ?? contracts[0];
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

  private capRelationshipConsequences(choiceSet: ChoiceSet, input: ChoiceAuthorInput): number {
    let capped = 0;
    for (const choice of choiceSet.choices) {
      for (const consequence of choice.consequences ?? []) {
        if (consequence.type !== 'relationship' || typeof consequence.change !== 'number') continue;
        const contract = this.relationshipPacingForNpc(input, consequence.npcId);
        if (!contract || !Number.isFinite(contract.maxDeltaThisScene) || contract.maxDeltaThisScene <= 0) continue;
        const max = Math.abs(contract.maxDeltaThisScene);
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

  private ensureMechanicPressureMetadata(choiceSet: ChoiceSet, input: ChoiceAuthorInput): number {
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

      if (!choice.residueHints?.length) {
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
          shortTerm: `Later scenes should remember how this changed access, posture, information, risk, or trust.`,
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
        return `The object stays in the scene as more than a prop; someone has to carry what it opens, costs, or proves.`;
      case 'information':
      case 'flag':
        return `The answer changes what can be safely said next, and what has to stay hidden a little longer.`;
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
        return `The next beat should show the choice in posture, access, tone, cost, clue, memory, or narrowed options.`;
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
      maxMagnitudeThisScene: domain === 'relationship' ? 6 : 10,
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
        return `Show immediate residue from ${pressure}: changed access, posture, tone, cost, clue, memory, or narrowed options.`;
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
      repaired += 1;
    }
    return repaired;
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
      this.validateChoices(revisedChoiceSet, input);

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
