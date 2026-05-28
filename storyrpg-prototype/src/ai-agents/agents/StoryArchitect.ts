/**
 * Story Architect Agent
 *
 * The master narrative designer responsible for:
 * - Creating episode blueprints with scene graphs
 * - Designing branch-and-bottleneck structure
 * - Establishing narrative arcs and pacing
 * - Defining major choice points and their stakes
 */

import { AgentConfig, GenerationSettingsConfig } from '../config';
import {
  StoryAnchors,
  SevenPointStructure,
  StructuralRole,
  SEVEN_POINT_BEATS,
  TreatmentEpisodeGuidance,
} from '../../types/sourceAnalysis';
import { BaseAgent, AgentResponse, AgentMessage } from './BaseAgent';
import {
  BRANCH_AND_BOTTLENECK,
  CRAFT_PRESSURE_GUIDANCE,
  CORE_DRAMATIC_STRUCTURE_RULES,
  buildGenreAwareJeopardyGuidance,
} from '../prompts/storytellingPrinciples';
import { STORY_ARCHITECT_BLUEPRINT_EXAMPLE } from '../prompts/examples/storyCraftExamples';
import type { EncounterCost, EncounterNarrativeStyle, EncounterType, NarrativeSequenceIntent, StakesLayers } from '../../types';
import type { ArcEpisodeTurnout, CliffhangerPlan, InformationLedgerEntry, SeasonPromiseArchitecture } from '../../types/seasonPlan';
import type { CharacterArchitecture, EndingMode, StoryEndingTarget } from '../../types/sourceAnalysis';
import { TreatmentFidelityValidator } from '../validators/TreatmentFidelityValidator';
import { DramaticStructureValidator } from '../validators/DramaticStructureValidator';
import { ThemePressureValidator } from '../validators/ThemePressureValidator';
import { SceneTurnContractValidator } from '../validators/SceneTurnContractValidator';
import { EpisodePressureArchitectureValidator } from '../validators/EpisodePressureArchitectureValidator';

// Input types
export interface StoryArchitectInput {
  // Story context
  storyTitle: string;
  genre: string;
  synopsis: string;
  tone: string;

  // Episode details
  episodeNumber: number;
  episodeTitle: string;
  episodeSynopsis: string;

  // Characters available
  protagonistDescription: string;
  availableNPCs: Array<{
    id: string;
    name: string;
    description: string;
    relationshipContext?: string;
    initialRelationship?: Partial<Record<'trust' | 'affection' | 'respect' | 'fear', number>>;
  }>;

  // World context
  worldContext: string;
  currentLocation: string;

  // Previous episode context (if any)
  previousEpisodeSummary?: string;

  // Constraints (caps—engine may generate fewer)
  targetSceneCount: number; // Max scenes per episode (cap)
  majorChoiceCount: number; // Suggested 2-3 major choices per episode

  // Pacing preferences
  pacing?: 'tight' | 'moderate' | 'expansive';

  // User instructions
  userPrompt?: string;

  /**
   * Season-level narrative anchors (from SeasonPlan.anchors). When present,
   * StoryArchitect keeps the episode's drama grounded to the same stakes,
   * goal, and final climax the rest of the pipeline targets.
   */
  seasonAnchors?: StoryAnchors;

  /**
   * Season-level 7-point beat map (from SeasonPlan.sevenPoint). Gives
   * StoryArchitect the text of every beat so it can weave the correct
   * beat into this episode's arc block.
   */
  seasonSevenPoint?: SevenPointStructure;

  /**
   * Which beat(s) of the season sevenPoint this specific episode carries
   * (from SeasonEpisode.structuralRole). Drives which `arc.*` fields are
   * required vs. optional and what dramatic function the episode serves.
   */
  episodeStructuralRole?: StructuralRole[];

  /**
   * Role-mapped episode ending contract. The final non-encounter scene should
   * resolve the episode's immediate tension, then open this hook.
   */
  cliffhangerPlan?: CliffhangerPlan;

  // Season plan data (encounter and branching directives from the master blueprint)
  seasonPlanDirectives?: {
    endingMode?: EndingMode;
    resolvedEndings?: StoryEndingTarget[];
    // Planned encounters for this episode
    plannedEncounters?: Array<{
      id: string;
      type: string;
      description: string;
      difficulty: string;
      npcsInvolved: string[];
      stakes: string;
      centralConflict?: string;
      aftermathConsequence?: string;
      relevantSkills: string[];
      encounterBuildup?: string;
      encounterSetupContext?: string[];
      isBranchPoint: boolean;
      branchOutcomes?: {
        victory: string;
        defeat: string;
        escape?: string;
      };
    }>;
    // Difficulty tier for this episode
    difficultyTier?: string;
    // Cross-episode branch effects that apply to this episode
    incomingBranchEffects?: Array<{
      branchName: string;
      pathName: string;
      impact: string;
      description: string;
    }>;
    // Flags this episode should set for later episodes
    flagsToSet?: Array<{ flag: string; description: string }>;
    // Flags from earlier episodes this episode should check
    flagsToCheck?: Array<{ flag: string; ifTrue: string; ifFalse: string }>;
    // Consequence chain effects that land in this episode
    consequenceEffects?: Array<{
      description: string;
      severity: string;
    }>;
    endingRoutes?: Array<{
      endingId: string;
      role: 'opens' | 'reinforces' | 'threatens' | 'locks';
      description: string;
    }>;
    treatmentGuidance?: TreatmentEpisodeGuidance;
    growthContext?: {
      focusSkills: string[];
      developmentScene: string;
      mentorshipOpportunity?: {
        npcId: string;
        npcName: string;
        requiredRelationship: { dimension: string; threshold: number };
        attribute: string;
        narrativeHook: string;
      } | null;
    };
    arcPressure?: {
      arcId: string;
      arcName: string;
      arcQuestion?: string;
      seasonQuestionRelation?: string;
      identityPressureFacet?: string;
      midpointRecontextualization?: {
        episodeNumber: number;
        questionBefore: string;
        questionAfter: string;
        description: string;
      };
      lateArcCrisis?: {
        episodeNumber: number;
        apparentFailure: string;
        irreversibleCost: string;
        description: string;
      };
      finaleAnswer?: string;
      handoffPressure?: string;
      episodeTurnout?: ArcEpisodeTurnout;
    };
    characterArchitecture?: CharacterArchitecture;
    seasonPromiseArchitecture?: SeasonPromiseArchitecture;
    informationLedgerEntries?: InformationLedgerEntry[];
  };

  // Pipeline memory context (optimization hints from prior runs, Claude only)
  memoryContext?: string;
}

type PlannedEncounterDirective = NonNullable<NonNullable<StoryArchitectInput['seasonPlanDirectives']>['plannedEncounters']>[number];

export type DramaticTurnDriver =
  | 'protagonist'
  | 'player_choice'
  | 'npc'
  | 'antagonist'
  | 'world'
  | 'coincidence';

export type InformationOwner =
  | 'player'
  | 'audience'
  | 'protagonist'
  | 'ally'
  | 'antagonist'
  | 'world';

export type ResidueType =
  | 'information'
  | 'relationship'
  | 'identity'
  | 'resource'
  | 'danger'
  | 'promise'
  | 'wound'
  | 'reputation'
  | 'access';

export type EpisodeTurnType =
  | 'reversal'
  | 'revelation'
  | 'escalation'
  | 'choice'
  | 'cost'
  | 'payoff';

export type BPlotMode =
  | 'scene'
  | 'sceneEpisode'
  | 'underlay'
  | 'offscreen_pressure';

export type CPlotFunction =
  | 'future_seed'
  | 'callback'
  | 'world_pressure'
  | 'tonal_counterweight';

export type CPlotTargetPayoff =
  | 'later_scene'
  | 'later_episode'
  | 'later_arc'
  | 'season';

export interface EpisodePressureLaneA {
  externalPressure: string;
  climaxIntersection: string;
}

export interface EpisodePressureLaneB {
  mode: BPlotMode;
  relationshipOrIdentityPressure: string;
  offscreenNpcMotivation?: string;
  protagonistVisibleSignals: string[];
  scenesOrEpisodes?: string[];
  climaxIntersection: string;
}

export interface EpisodePressureLaneC {
  function: CPlotFunction;
  seed: string;
  visiblePlant: string;
  payoffPlan: string;
  targetPayoff?: CPlotTargetPayoff;
}

export interface EpisodePressureLanes {
  aPlot: EpisodePressureLaneA;
  bPlot?: EpisodePressureLaneB;
  cPlot?: EpisodePressureLaneC;
}

export interface OpeningPromise {
  hook: string;
  episodePromise: string;
  activePressure: string;
  optionalStakes?: string;
}

export interface DramaticStructureAudit {
  episodeQuestion: string;
  episodeQuestionSetup?: string;
  episodeQuestionAnswer?: string;
  themeQuestion?: string;
  themePressure: string;
  themeAngle?: string;
  themeChoicePressure?: string;
  openingPromise?: OpeningPromise;
  episodePressureLanes?: EpisodePressureLanes;
  episodeEndStateDelta?: string;
  nextEpisodePressure?: string;
  personalStake: string;
  stakesLayers?: StakesLayers;
  majorTurns: Array<{
    id: string;
    description: string;
    driver: DramaticTurnDriver;
    protagonistInfluence: string;
    turnType?: EpisodeTurnType;
    closesQuestion?: string;
    opensQuestion?: string;
    memorableImageOrLine?: string;
  }>;
  informationPlan: Array<{
    item: string;
    knownBy: InformationOwner[];
    revealTiming: string;
    payoff: string;
  }>;
}

export interface SceneDramaticStructure {
  question: string;
  turn: string;
  pressurePeak: string;
  changedState: string;
}

export interface SceneTransitionOut {
  toSceneId: string;
  connector: 'therefore' | 'but';
  causalLink: string;
  pressureChange: string;
}

export interface SceneResidue {
  type: ResidueType;
  description: string;
}

// Output types
export interface SceneBlueprint {
  id: string;
  name: string;
  description: string;
  location: string;
  mood: string;
  purpose: 'bottleneck' | 'branch' | 'transition';

  // Expert Design Elements
  dramaticQuestion: string; // What are we here to find out?
  wantVsNeed: string; // Protagonist's conscious goal vs dramatic necessity
  conflictEngine: string; // What or who opposes them in this scene?
  dramaticStructure?: SceneDramaticStructure;
  personalStake?: string;
  themePressure?: string;
  stakesLayers?: StakesLayers;
  transitionOut?: SceneTransitionOut[];
  residue?: SceneResidue[];

  // NPCs present in this scene
  npcsPresent: string[];

  // Narrative function
  narrativeFunction: string;

  // Key beats to hit
  keyBeats: string[];
  sequenceIntent?: NarrativeSequenceIntent;

  // Choice point (if any)
  choicePoint?: {
    type: 'expression' | 'relationship' | 'strategic' | 'dilemma';
    // Whether this choice point should route to different scenes.
    // Only non-expression types may branch. Capped per episode.
    branches?: boolean;
    stakes: {
      want: string;
      cost: string;
      identity: string;
    };
    stakesLayers?: StakesLayers;
    themeAnswer?: string;
    description: string;
    optionHints: string[];
    consequenceDomain?: 'relationship' | 'reputation' | 'danger' | 'information' | 'identity' | 'leverage' | 'resource';
    reminderPlan?: {
      immediate: string;
      shortTerm: string;
      later?: string;
    };
    expectedResidue?: string[];
    competenceArc?: {
      testsNow: string;
      shortfall?: string;
      growthPath?: string;
    };
    failureBranchPurpose?: 'recovery' | 'training' | 'leverage' | 'alliance' | 'investigation' | 'regrouping';
  };

  // Scene connections
  leadsTo: string[]; // Scene IDs this can lead to
  requires?: string[]; // Scene IDs that must come before

  // Choice payoff context: describes what player choice leads to this scene.
  // Populate this for any scene that can be entered by a player choice, including
  // bottleneck and transition scenes. Multiple choice routes may also be bridged
  // with route metadata at assembly time.
  // Example: "Player chose to kiss Catherine on the moors"
  incomingChoiceContext?: string;

  // Encounter configuration (if this scene is an interactive encounter)
  isEncounter?: boolean;
  plannedEncounterId?: string;
  encounterType?: EncounterType;
  encounterStyle?: EncounterNarrativeStyle;
  encounterDescription?: string;
  encounterStakes?: string;
  encounterRequiredNpcIds?: string[];
  encounterRelevantSkills?: string[];
  encounterBeatPlan?: string[];
  encounterDifficulty?: 'easy' | 'moderate' | 'hard' | 'extreme';
  encounterPartialVictoryCost?: Partial<EncounterCost>;

  // For the encounter scene: describes the stakes and what prior scenes must establish.
  // For non-encounter scenes: describes how THIS scene specifically builds toward the episode encounter
  // (what it plants, reveals, or establishes that makes the encounter's choices more meaningful).
  encounterBuildup?: string;

  // For encounter scenes only: explicit list of flags and relationship thresholds from earlier
  // scenes that are designed to echo INSIDE the encounter as narrative shading, unlocked choices,
  // or stat bonuses. Format: "flag:<name> — <effect>", "relationship:<npcId>.<dim> <op> <n> — <effect>"
  // e.g. ["flag:defended_heathcliff — unlocks defiance choice",
  //        "relationship:hindley.trust < -20 — harshens Hindley's opening dialogue"]
  encounterSetupContext?: string[];
}

export interface EpisodeBlueprint {
  episodeId: string;
  number?: number;  // Episode number in the season
  title: string;
  synopsis: string;

  /**
   * Episode-level 7-point arc summary.
   *
   * This is a REPLACEMENT for the old `{ hook, risingAction, climax, resolution }`
   * shape. `risingAction` is no longer captured as a single field; the
   * progressive tension is now carried by the dedicated beat fields below.
   * `plotTurn2` is intentionally fused into `climax` (the season's Plot Turn 2
   * IS the decisive confrontation), matching how the season-level
   * {@link SevenPointStructure} is laid out.
   *
   * For buffer episodes (episodes with `structuralRole` of `rising` or
   * `falling`), the writer fills the 1-2 beats the episode actually lands and
   * leaves the others as empty strings. The SevenPointCoverageValidator only
   * enforces coverage at the SEASON level.
   */
  arc: {
    hook: string;          // Ordinary world + core value introduced
    plotTurn1: string;     // Inciting incident / world-disruption
    pinch1: string;        // First major setback against the antagonizing force
    midpoint: string;      // Commitment / reversal / path-to-victory discovered
    pinch2: string;        // Crisis + transformation culmination
    climax: string;        // Decisive confrontation (fuses PT2 + Climax)
    resolution: string;    // Aftermath + legacy
  };

  /**
   * Which beats of the season-level sevenPoint this episode is responsible
   * for landing. Copied through from the SeasonPlannerAgent's assignment so
   * validators can assert the episode's arc fields are populated for the
   * beats it owns.
   */
  structuralRole?: StructuralRole[];

  // Themes to weave through
  themes: string[];
  dramaticAudit?: DramaticStructureAudit;

  // Scene graph
  scenes: SceneBlueprint[];
  startingSceneId: string;

  // Branch structure
  bottleneckScenes: string[]; // Scene IDs that all paths must pass through

  // State tracking hints
  suggestedFlags: Array<{ name: string; description: string }>;
  suggestedScores: Array<{ name: string; description: string }>;
  suggestedTags: Array<{ name: string; description: string }>;

  // Consequence hints for future episodes
  narrativePromises: Array<{
    description: string;
    setupScene: string;
    importance: 'minor' | 'moderate' | 'major';
  }>;
}

export class StoryArchitect extends BaseAgent {
  private episodeStructureMode: GenerationSettingsConfig['episodeStructureMode'];
  private sceneEpisodeConfig: {
    minScenes: number;
    maxScenes: number;
  };
  private encounterMinimums: {
    short: number;    // 3-4 scenes
    medium: number;   // 5-7 scenes
    long: number;     // 8+ scenes
  };
  private sceneGraphBranching: {
    required: boolean;
    minPerEpisode: number;
    allowLinearBottleneckEpisodes: boolean;
  };
  private lastStructuralFeedback: string[] = [];

  constructor(config: AgentConfig, generationConfig?: GenerationSettingsConfig) {
    super('Story Architect', config);
    this.includeSystemPrompt = true;
    this.episodeStructureMode = generationConfig?.episodeStructureMode || 'standard';
    this.sceneEpisodeConfig = {
      minScenes: generationConfig?.sceneEpisodeMinScenes ?? 1,
      maxScenes: generationConfig?.sceneEpisodeMaxScenes ?? 1,
    };
    
    // Configure minimum encounters per episode length
    this.encounterMinimums = {
      short: generationConfig?.minEncountersShort ?? 1,
      medium: generationConfig?.minEncountersMedium ?? 1,
      long: generationConfig?.minEncountersLong ?? 1,
    };
    this.sceneGraphBranching = {
      required: generationConfig?.requireSceneGraphBranching !== false,
      minPerEpisode: generationConfig?.minSceneGraphBranchesPerEpisode ?? 1,
      allowLinearBottleneckEpisodes: generationConfig?.allowLinearBottleneckEpisodes === true,
    };
  }
  
  // Get minimum encounters based on scene count
  private getMinEncounters(sceneCount: number): number {
    if (this.episodeStructureMode === 'sceneEpisodes') return 0;
    if (sceneCount <= 4) return this.encounterMinimums?.short ?? 0;
    if (sceneCount <= 7) return this.encounterMinimums?.medium ?? 1;
    return this.encounterMinimums?.long ?? 1;
  }

  private getMinimumChoiceSceneCount(sceneCount: number): number {
    if (this.episodeStructureMode === 'sceneEpisodes') return 1;
    return Math.ceil(sceneCount * 0.4);
  }

  private createExpressionChoicePoint(scene: SceneBlueprint, reason: string): NonNullable<SceneBlueprint['choicePoint']> {
    const sceneGoal = scene.dramaticQuestion || scene.narrativeFunction || scene.description || scene.name;

    return {
      type: 'expression',
      branches: false,
      stakes: {
        want: `Express how the protagonist responds to ${sceneGoal}`,
        cost: 'The story beat continues, but the response colors how others read the protagonist.',
        identity: 'This choice defines the protagonist through tone, values, and emotional posture.',
      },
      description: `Let the player choose how they meet this moment: ${reason}.`,
      optionHints: [
        'Answer with restraint and careful attention.',
        'Answer with directness, making the feeling plain.',
        'Answer obliquely, revealing only part of the truth.',
      ],
      consequenceDomain: 'identity',
      reminderPlan: {
        immediate: 'Reflect the chosen tone in the next line of dialogue or narration.',
        shortTerm: 'Let a later scene echo how the protagonist carried themself here.',
      },
      expectedResidue: [
        `The protagonist's response in ${scene.name} leaves an emotional trace.`,
      ],
    };
  }

  private addChoicePointIfEligible(scene: SceneBlueprint, reason: string): boolean {
    if (scene.choicePoint || scene.isEncounter) return false;
    scene.choicePoint = this.createExpressionChoicePoint(scene, reason);
    console.log(`[StoryArchitect] Auto-added expression choicePoint to ${scene.id}: ${reason}`);
    return true;
  }

  private isFirstSeasonEpisode(input: StoryArchitectInput): boolean {
    return input.episodeNumber === 1;
  }

  private repairChoiceDensity(blueprint: EpisodeBlueprint, input: StoryArchitectInput): void {
    const scenes = blueprint.scenes || [];
    if (scenes.length === 0) return;

    const minimumChoiceScenes = this.getMinimumChoiceSceneCount(scenes.length);
    let choiceSceneCount = scenes.filter(scene => scene.choicePoint).length;

    const startingScene = scenes.find(scene => scene.id === blueprint.startingSceneId) || scenes[0];
    if (startingScene && !startingScene.choicePoint) {
      if (this.isFirstSeasonEpisode(input)) {
        if (this.addChoicePointIfEligible(startingScene, 'early player agency')) {
          choiceSceneCount++;
        }
      } else {
        const followUps = startingScene.leadsTo
          .map(id => scenes.find(scene => scene.id === id))
          .filter((scene): scene is SceneBlueprint => Boolean(scene));
        const secondSceneHasChoice = followUps.some(scene => scene.choicePoint);

        if (!secondSceneHasChoice) {
          if (this.addChoicePointIfEligible(startingScene, 'early player agency')) {
            choiceSceneCount++;
          } else {
            const repairedFollowUp = followUps.find(scene => this.addChoicePointIfEligible(scene, 'early player agency after an encounter opening'));
            if (repairedFollowUp) choiceSceneCount++;
          }
        }
      }
    }

    const sceneMap = new Map(scenes.map(scene => [scene.id, scene]));
    const visited = new Set<string>();
    const repairLongNonChoiceRuns = (sceneId: string, nonChoiceStreak: number): void => {
      const visitKey = `${sceneId}:${nonChoiceStreak}`;
      if (visited.has(visitKey)) return;
      visited.add(visitKey);

      const scene = sceneMap.get(sceneId);
      if (!scene) return;

      let currentStreak = scene.choicePoint ? 0 : nonChoiceStreak + 1;
      if (currentStreak > 2 && this.addChoicePointIfEligible(scene, 'breaking up a long passive scene run')) {
        choiceSceneCount++;
        currentStreak = 0;
      }

      for (const nextId of scene.leadsTo) {
        repairLongNonChoiceRuns(nextId, currentStreak);
      }
    };

    if (startingScene) {
      repairLongNonChoiceRuns(startingScene.id, 0);
    }

    const preferredScenes = [
      ...scenes.filter(scene => scene.purpose === 'bottleneck'),
      ...scenes.filter(scene => scene.purpose === 'transition'),
      ...scenes.filter(scene => scene.purpose === 'branch'),
    ];
    const seen = new Set<string>();
    for (const scene of preferredScenes) {
      if (choiceSceneCount >= minimumChoiceScenes) break;
      if (seen.has(scene.id)) continue;
      seen.add(scene.id);
      if (this.addChoicePointIfEligible(scene, 'meeting the episode choice-density requirement')) {
        choiceSceneCount++;
      }
    }
  }

  private tokenizeEncounterText(value: string | undefined): string[] {
    return (value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4);
  }

  private sceneMatchesPlannedEncounter(
    scene: SceneBlueprint,
    plannedEncounter: PlannedEncounterDirective
  ): boolean {
    if (!scene.isEncounter || !scene.encounterType) return false;
    if (scene.plannedEncounterId) {
      return scene.plannedEncounterId === plannedEncounter.id;
    }

    const sceneTokens = new Set([
      ...this.tokenizeEncounterText(scene.name),
      ...this.tokenizeEncounterText(scene.description),
      ...this.tokenizeEncounterText(scene.encounterDescription),
      ...scene.npcsPresent.map((npcId) => npcId.toLowerCase()),
    ]);
    const plannedTokens = this.tokenizeEncounterText(plannedEncounter.description);
    const overlap = plannedTokens.filter((token) => sceneTokens.has(token));

    return overlap.length >= Math.min(3, plannedTokens.length);
  }

  private normalizeEncounterType(value: string | undefined): EncounterType {
    const validTypes: EncounterType[] = [
      'combat',
      'chase',
      'heist',
      'negotiation',
      'investigation',
      'survival',
      'social',
      'romantic',
      'dramatic',
      'puzzle',
      'exploration',
      'stealth',
      'mixed',
    ];
    return validTypes.includes(value as EncounterType) ? value as EncounterType : 'dramatic';
  }

  private normalizeEncounterDifficulty(value: string | undefined): 'easy' | 'moderate' | 'hard' | 'extreme' {
    const normalized = (value || '').toLowerCase();
    if (normalized.includes('extreme') || normalized.includes('climax') || normalized.includes('finale') || normalized.includes('peak')) {
      return 'extreme';
    }
    if (normalized.includes('hard') || normalized.includes('high') || normalized.includes('danger')) {
      return 'hard';
    }
    if (normalized.includes('easy') || normalized.includes('intro') || normalized.includes('low')) {
      return 'easy';
    }
    return 'moderate';
  }

  private inferEncounterStyle(type: EncounterType, description: string): EncounterNarrativeStyle {
    const text = description.toLowerCase();
    if (type === 'romantic' || text.includes('romantic') || text.includes('desire')) return 'romantic';
    if (type === 'social' || type === 'negotiation') return 'social';
    if (type === 'stealth') return 'stealth';
    if (type === 'investigation' || type === 'puzzle') return 'mystery';
    if (type === 'exploration' || text.includes('unknown')) return 'adventure';
    if (type === 'combat' || type === 'chase' || type === 'survival' || text.includes('attack')) return 'action';
    return 'dramatic';
  }

  private defaultSkillsForEncounterType(type: EncounterType): string[] {
    switch (type) {
      case 'combat':
      case 'chase':
      case 'survival':
        return ['resolve', 'athletics', 'awareness'];
      case 'stealth':
      case 'heist':
        return ['stealth', 'deception', 'awareness'];
      case 'investigation':
      case 'puzzle':
        return ['investigation', 'insight', 'focus'];
      case 'romantic':
        return ['empathy', 'honesty', 'resolve'];
      case 'social':
      case 'negotiation':
        return ['persuasion', 'empathy', 'resolve'];
      case 'exploration':
        return ['awareness', 'survival', 'resolve'];
      default:
        return ['resolve', 'empathy', 'awareness'];
    }
  }

  private buildEncounterBeatPlan(plannedEncounter: PlannedEncounterDirective, existingBeats: string[] | undefined): string[] {
    const beats = [...(existingBeats || []).filter((beat) => beat.trim())];
    const description = plannedEncounter.description || 'The planned encounter arrives and forces a decisive response.';
    const stakes = plannedEncounter.stakes || 'The outcome changes what the protagonist can risk next.';
    const outcomes = plannedEncounter.branchOutcomes;

    beats.push(`Opening pressure: ${description}`);
    beats.push(`Escalation: ${stakes}`);
    if (outcomes?.victory || outcomes?.defeat || outcomes?.escape) {
      beats.push(`Outcome fork: victory means ${outcomes.victory || 'gaining ground'}, defeat means ${outcomes.defeat || 'paying a visible cost'}${outcomes.escape ? `, escape means ${outcomes.escape}` : ''}`);
    } else {
      beats.push('Decision point: the protagonist must choose whether to fight, flee, freeze, bargain, or reveal who they are becoming.');
    }

    return Array.from(new Set(beats)).slice(0, Math.max(3, Math.min(5, beats.length)));
  }

  private scoreSceneForPlannedEncounter(scene: SceneBlueprint, plannedEncounter: PlannedEncounterDirective): number {
    const plannedTokens = new Set([
      ...this.tokenizeEncounterText(plannedEncounter.description),
      ...this.tokenizeEncounterText(plannedEncounter.stakes),
      ...(plannedEncounter.npcsInvolved || []).map((npcId) => npcId.toLowerCase()),
    ]);
    const sceneTokens = new Set([
      ...this.tokenizeEncounterText(scene.name),
      ...this.tokenizeEncounterText(scene.description),
      ...this.tokenizeEncounterText(scene.encounterDescription),
      ...this.tokenizeEncounterText(scene.narrativeFunction),
      ...(scene.keyBeats || []).flatMap((beat) => this.tokenizeEncounterText(beat)),
      ...(scene.npcsPresent || []).map((npcId) => npcId.toLowerCase()),
    ]);

    let score = 0;
    for (const token of plannedTokens) {
      if (sceneTokens.has(token)) score += 2;
    }
    if (scene.isEncounter) score += 6;
    if (scene.purpose === 'bottleneck') score += 3;
    if (scene.encounterType === plannedEncounter.type) score += 2;
    if (scene.name.toLowerCase().includes('encounter') || scene.name.toLowerCase().includes('confront')) score += 2;
    return score;
  }

  private findSceneForPlannedEncounter(blueprint: EpisodeBlueprint, plannedEncounter: PlannedEncounterDirective): SceneBlueprint | undefined {
    const exact = blueprint.scenes.find((scene) => scene.plannedEncounterId === plannedEncounter.id);
    if (exact) return exact;

    const ranked = [...blueprint.scenes]
      .map((scene, index) => ({ scene, index, score: this.scoreSceneForPlannedEncounter(scene, plannedEncounter) }))
      .sort((a, b) => b.score - a.score || (a.scene.isEncounter === b.scene.isEncounter ? 0 : a.scene.isEncounter ? -1 : 1));

    const semanticMatch = ranked.find((entry) => entry.score >= 6);
    if (semanticMatch) return semanticMatch.scene;

    const preferredIndex = Math.min(Math.max(1, Math.floor(blueprint.scenes.length * 0.65)), Math.max(0, blueprint.scenes.length - 2));
    return blueprint.scenes.find((scene, index) => scene.isEncounter || (scene.purpose === 'bottleneck' && index >= preferredIndex))
      || blueprint.scenes[preferredIndex]
      || blueprint.scenes[0];
  }

  private applyPlannedEncounterToScene(scene: SceneBlueprint, plannedEncounter: PlannedEncounterDirective): void {
    const encounterType = this.normalizeEncounterType(plannedEncounter.type);
    const existingSkills = scene.encounterRelevantSkills || [];
    const plannedSkills = plannedEncounter.relevantSkills || [];
    const npcIds = new Set([...(scene.npcsPresent || []), ...(scene.encounterRequiredNpcIds || []), ...(plannedEncounter.npcsInvolved || [])]);

    scene.isEncounter = true;
    scene.plannedEncounterId = plannedEncounter.id;
    scene.encounterType = encounterType;
    scene.encounterStyle = scene.encounterStyle || this.inferEncounterStyle(encounterType, plannedEncounter.description);
    scene.encounterDescription = scene.encounterDescription?.trim()
      ? scene.encounterDescription
      : plannedEncounter.description;
    scene.encounterStakes = scene.encounterStakes?.trim()
      ? scene.encounterStakes
      : plannedEncounter.stakes || `The outcome of ${plannedEncounter.description} changes the protagonist's immediate safety and trust.`;
    scene.encounterRequiredNpcIds = Array.from(npcIds);
    scene.npcsPresent = Array.from(npcIds);
    scene.encounterRelevantSkills = Array.from(new Set([
      ...existingSkills,
      ...plannedSkills,
      ...this.defaultSkillsForEncounterType(encounterType),
    ])).slice(0, 5);
    scene.encounterBeatPlan = this.buildEncounterBeatPlan(plannedEncounter, scene.encounterBeatPlan);
    scene.encounterDifficulty = scene.encounterDifficulty || this.normalizeEncounterDifficulty(plannedEncounter.difficulty);
    scene.encounterBuildup = scene.encounterBuildup?.trim()
      ? scene.encounterBuildup
      : plannedEncounter.encounterBuildup || `Earlier scenes establish why ${plannedEncounter.description} is unavoidable and personal.`;
    scene.encounterSetupContext = Array.from(new Set([
      ...(scene.encounterSetupContext || []),
      ...(plannedEncounter.encounterSetupContext || []),
    ]));
    scene.purpose = scene.purpose || 'bottleneck';
  }

  private repairPlannedEncounterCoverage(blueprint: EpisodeBlueprint, input: StoryArchitectInput): void {
    const plannedEncounters = input.seasonPlanDirectives?.plannedEncounters || [];
    if (plannedEncounters.length === 0 || blueprint.scenes.length === 0) return;

    for (const plannedEncounter of plannedEncounters) {
      const matchedScene = this.findSceneForPlannedEncounter(blueprint, plannedEncounter);
      if (!matchedScene) continue;

      const wasBound = matchedScene.plannedEncounterId === plannedEncounter.id && matchedScene.isEncounter;
      this.applyPlannedEncounterToScene(matchedScene, plannedEncounter);
      if (!blueprint.bottleneckScenes.includes(matchedScene.id)) {
        blueprint.bottleneckScenes.push(matchedScene.id);
      }

      if (!wasBound) {
        console.warn(
          `[StoryArchitect] Repaired planned encounter "${plannedEncounter.id}" by binding it to scene "${matchedScene.id}"`
        );
      }
    }
  }

  private repairSceneGraphBranchCoverage(blueprint: EpisodeBlueprint): void {
    if (!this.sceneGraphBranching.required || this.sceneGraphBranching.allowLinearBottleneckEpisodes) return;
    const scenes = blueprint.scenes || [];
    if (scenes.length < 3) return;

    const validBranchCount = scenes.filter(scene =>
      scene.choicePoint?.branches &&
      scene.choicePoint.type !== 'expression' &&
      new Set(scene.leadsTo || []).size >= 2 &&
      !scene.isEncounter
    ).length;
    if (validBranchCount >= this.sceneGraphBranching.minPerEpisode) return;

    const sceneIndex = new Map(scenes.map((scene, index) => [scene.id, index]));
    const candidate = scenes.find((scene, index) =>
      index < scenes.length - 2 &&
      !scene.isEncounter &&
      scene.choicePoint &&
      scene.choicePoint.type !== 'expression'
    ) || scenes.find((scene, index) =>
      index < scenes.length - 2 &&
      !scene.isEncounter &&
      scene.choicePoint
    ) || scenes.find((scene, index) =>
      index < scenes.length - 2 &&
      !scene.isEncounter
    );
    if (!candidate) return;

    const candidateIndex = sceneIndex.get(candidate.id) ?? 0;
    const futureSceneIds = scenes
      .slice(candidateIndex + 1)
      .map((scene) => scene.id)
      .filter((id, index, arr) => arr.indexOf(id) === index)
      .slice(0, 2);
    if (futureSceneIds.length < 2) return;

    candidate.purpose = 'branch';
    candidate.leadsTo = futureSceneIds;
    if (!candidate.choicePoint || candidate.choicePoint.type === 'expression') {
      candidate.choicePoint = {
        type: 'dilemma',
        branches: true,
        stakes: {
          want: candidate.choicePoint?.stakes?.want || `Choose how to handle ${candidate.name}`,
          cost: candidate.choicePoint?.stakes?.cost || 'One path skips a chance for safety, trust, or information.',
          identity: candidate.choicePoint?.stakes?.identity || 'This choice defines the protagonist under pressure.',
        },
        description: candidate.choicePoint?.description || `Choose the route through ${candidate.name}.`,
        optionHints: [],
        consequenceDomain: candidate.choicePoint?.consequenceDomain || 'identity',
        reminderPlan: candidate.choicePoint?.reminderPlan || {
          immediate: 'The selected route changes the next scene.',
          shortTerm: 'Later narration remembers which path the player chose.',
        },
        expectedResidue: candidate.choicePoint?.expectedResidue || [
          `The route chosen in ${candidate.name} changes what context the player carries forward.`,
        ],
      };
    }

    candidate.choicePoint.type = candidate.choicePoint.type === 'expression' ? 'dilemma' : candidate.choicePoint.type;
    candidate.choicePoint.branches = true;
    candidate.choicePoint.optionHints = futureSceneIds.map((targetId) => {
      const target = scenes.find((scene) => scene.id === targetId);
      return target ? `Move toward ${target.name}` : `Move toward ${targetId}`;
    });
    candidate.choicePoint.consequenceDomain = candidate.choicePoint.consequenceDomain || 'identity';
    candidate.choicePoint.reminderPlan = candidate.choicePoint.reminderPlan || {
      immediate: 'The selected route changes the next scene.',
      shortTerm: 'Later narration remembers which path the player chose.',
    };
    candidate.choicePoint.expectedResidue = candidate.choicePoint.expectedResidue?.length
      ? candidate.choicePoint.expectedResidue
      : [`The route chosen in ${candidate.name} changes what context the player carries forward.`];

    console.warn(
      `[StoryArchitect] Repaired scene-graph branching by turning "${candidate.id}" into a branch scene with leadsTo: ${futureSceneIds.join(', ')}`
    );
  }

  private collectAuthoredResidue(guidance: TreatmentEpisodeGuidance | undefined): string[] {
    if (!guidance) return [];

    return Array.from(new Set([
      ...(guidance.alternativePaths || []),
      ...(guidance.consequenceSeeds || []),
      guidance.consequenceResidue,
    ].map((value) => value?.trim()).filter(Boolean) as string[]));
  }

  private hasBlueprintText(value: unknown): value is string {
    return typeof value === 'string'
      && value.trim().length > 0
      && !/\b(tbd|none|n\/a|unknown|placeholder|not specified)\b/i.test(value);
  }

  private hasConcretePersonalStake(value: unknown): value is string {
    if (!this.hasBlueprintText(value)) return false;
    const text = value.trim();
    const personalTerms = /\b(friend|family|sibling|parent|child|lover|ally|mentor|home|name|reputation|trust|promise|vow|identity|future|memory|belonging|freedom|dignity|relationship|bond|wound|secret|debt|cost|lose|loss|save|protect|betray|exile|access)\b/i;
    const abstractOnly = /\b(everything|the world|the realm|the kingdom|the city|all hope|fate|destiny|survival|stakes are high|danger grows)\b/i;
    return personalTerms.test(text) || !abstractOnly.test(text);
  }

  private pickBlueprintText(...values: Array<string | undefined>): string {
    return values.find((value) => this.hasBlueprintText(value)) || '';
  }

  private pickPersonalStake(...values: Array<string | undefined>): string {
    return values.find((value) => this.hasConcretePersonalStake(value)) || this.pickBlueprintText(...values);
  }

  private hasThemeChoiceAction(value: unknown): value is string {
    return this.hasBlueprintText(value)
      && /\b(player|protagonist|choice|chooses|choose|decision|decides|act|acts|action|refusal|refuses|sacrifice|risks|commit|commits|reveals|hides|protects|betrays|trusts|confronts|accepts|rejects|identity|cost|open|block|archive|read|wait|decline|publish|invite|thank|kiss|scream|run|freeze|fight)\b/i.test(value);
  }

  private buildTreatmentThemeChoicePressure(
    guidance: TreatmentEpisodeGuidance | undefined,
    themePressure: string,
  ): string {
    const authoredChoice = guidance?.forcedChoice || guidance?.majorChoicePressures?.[0] || themePressure;
    return `Player/protagonist choice makes the theme answerable: ${authoredChoice}. The action tests ${themePressure}`;
  }

  private normalizeInformationPlan(
    items: unknown,
    guidance: TreatmentEpisodeGuidance | undefined,
    fallbackItem: string,
    fallbackPayoff: string,
  ): DramaticStructureAudit['informationPlan'] {
    const rawItems = Array.isArray(items) ? items : items ? [items] : [];
    const normalized = rawItems.map((raw, index) => {
      const item = raw && typeof raw === 'object' ? raw as Partial<DramaticStructureAudit['informationPlan'][number]> : {};
      const fallback = index === 0
        ? fallbackItem
        : (guidance?.cSeed || guidance?.informationMovement || guidance?.visualAnchor || fallbackItem);
      return {
        item: this.pickBlueprintText(item.item, fallback),
        knownBy: this.sanitizeInformationOwners(item.knownBy),
        revealTiming: this.pickBlueprintText(item.revealTiming, 'During this episode.'),
        payoff: this.pickBlueprintText(item.payoff, fallbackPayoff),
      };
    });

    return normalized.length > 0
      ? normalized
      : [{
          item: fallbackItem,
          knownBy: ['player', 'protagonist'],
          revealTiming: 'During this episode.',
          payoff: fallbackPayoff,
        }];
  }

  private shouldRemoveCurrentExistentialStake(value: string | undefined): boolean {
    if (!this.hasBlueprintText(value)) return true;
    if (this.episodeStructureMode === 'sceneEpisodes') return true;
    return /\bexistential\b/i.test(value)
      && /\bunknown to|unaware|hidden from|not yet known|audience knows/i.test(value);
  }

  private mergeTreatmentStakesLayers(
    existing: StakesLayers | undefined,
    inferred: StakesLayers,
  ): StakesLayers {
    const merged: StakesLayers = {
      ...inferred,
      ...(existing || {}),
    };
    if (this.shouldRemoveCurrentExistentialStake(merged.existential)) {
      delete merged.existential;
    }
    return merged;
  }

  private inferTreatmentStakesLayers(guidance: TreatmentEpisodeGuidance | undefined, input: StoryArchitectInput): StakesLayers {
    const authored = (guidance?.stakesLayers || []).join(' ');
    const layers: StakesLayers = {};

    const materialSource = [
      guidance?.entryGoal,
      guidance?.obstacle,
      guidance?.aPressure,
      authored,
    ].filter(Boolean).join(' ');
    const relationalSource = [
      guidance?.bPressure,
      guidance?.powerShift,
      authored,
      input.availableNPCs?.[0]?.name,
    ].filter(Boolean).join(' ');
    const identitySource = [
      guidance?.liePressure,
      guidance?.themePressure,
      guidance?.forcedChoice,
      authored,
    ].filter(Boolean).join(' ');

    layers.material = materialSource || 'Access, evidence, time, safety, or leverage can be lost by how this scene turns.';
    layers.relational = relationalSource || 'Trust, intimacy, reputation, or alliance pressure changes around the protagonist.';
    layers.identity = identitySource || 'The protagonist must show who they are becoming under pressure.';

    if (!this.shouldRemoveCurrentExistentialStake(authored)
      && /\bexistential|survival|life|death|freedom|home|meaning|irreversible\b/i.test(authored)) {
      layers.existential = authored;
    }

    return layers;
  }

  private splitAuthoredChoiceOptions(pressure: string): string[] {
    const cleaned = pressure
      .replace(/^\s*[-*]\s+/, '')
      .replace(/\s+[—–-]\s+(?=WANT:|COST:|IDENTITY:).*/i, '')
      .replace(/\s*\(\d+\)\s*/g, ' | ')
      .trim();
    const options = cleaned
      .split(/\s*(?:\||,?\s+or\s+|\/|;)\s*/i)
      .map((option) => option.replace(/^\(?\d+\)?\.?\s*/, '').trim())
      .filter((option) => option.length > 0);
    return Array.from(new Set(options)).slice(0, 4);
  }

  private chooseAuthoredChoicePressure(guidance: TreatmentEpisodeGuidance | undefined): string | undefined {
    const pressures = guidance?.majorChoicePressures || [];
    return pressures.find((pressure) => this.splitAuthoredChoiceOptions(pressure).length >= 2)
      || pressures.find((pressure) => this.hasBlueprintText(pressure));
  }

  private findSceneForAuthoredChoice(blueprint: EpisodeBlueprint): SceneBlueprint | undefined {
    return blueprint.scenes?.find((scene) => scene.choicePoint && !scene.isEncounter)
      || blueprint.scenes?.find((scene) => scene.choicePoint)
      || blueprint.scenes?.find((scene) => !scene.isEncounter)
      || blueprint.scenes?.[0];
  }

  private inferChoiceConsequenceDomain(pressure: string, guidance: TreatmentEpisodeGuidance | undefined): NonNullable<SceneBlueprint['choicePoint']>['consequenceDomain'] {
    const text = [pressure, guidance?.bPressure, guidance?.consequenceResidue, guidance?.informationMovement].filter(Boolean).join(' ').toLowerCase();
    if (/\b(trust|friend|family|lover|relationship|mika|stela|radu|daniel|victor)\b/.test(text)) return 'relationship';
    if (/\b(photo|publish|blog|message|secret|read|archive|name|codename|information|laptop)\b/.test(text)) return 'information';
    if (/\b(key|card|quartz|access|money|resource|object|item)\b/.test(text)) return 'resource';
    if (/\b(reputation|public|column|blog|publish)\b/.test(text)) return 'reputation';
    if (/\b(danger|threat|attack|safety)\b/.test(text)) return 'danger';
    return 'identity';
  }

  private repairTreatmentMajorChoicePressure(blueprint: EpisodeBlueprint, input: StoryArchitectInput): void {
    const guidance = input.seasonPlanDirectives?.treatmentGuidance;
    const pressure = this.chooseAuthoredChoicePressure(guidance);
    if (!pressure) return;

    const scene = this.findSceneForAuthoredChoice(blueprint);
    if (!scene) return;

    const options = this.splitAuthoredChoiceOptions(pressure);
    const stakesLayers = this.inferTreatmentStakesLayers(guidance, input);
    const personalStake = this.pickPersonalStake(
      scene.personalStake,
      blueprint.dramaticAudit?.personalStake,
      guidance?.liePressure,
      guidance?.bPressure,
      guidance?.consequenceResidue,
      `The protagonist's identity, reputation, trust, and future options are at risk.`
    );
    const residue = this.collectAuthoredResidue(guidance);
    const existingChoice = scene.choicePoint;

    scene.choicePoint = {
      ...(existingChoice || {}),
      type: existingChoice?.type === 'expression' || !existingChoice?.type ? 'dilemma' : existingChoice.type,
      branches: existingChoice?.branches || false,
      stakes: {
        want: pressure,
        cost: guidance?.consequenceResidue || guidance?.exitShift || existingChoice?.stakes?.cost || 'Each option leaves a different cost, residue, or lost possibility.',
        identity: guidance?.liePressure || guidance?.themePressure || existingChoice?.stakes?.identity || 'The choice defines who the protagonist becomes under pressure.',
      },
      stakesLayers: this.mergeTreatmentStakesLayers(existingChoice?.stakesLayers, stakesLayers),
      themeAnswer: existingChoice?.themeAnswer || guidance?.themePressure || guidance?.liePressure,
      description: `Authored treatment choice: ${pressure}`,
      optionHints: options.length >= 2 ? options : [pressure],
      consequenceDomain: existingChoice?.consequenceDomain || this.inferChoiceConsequenceDomain(pressure, guidance),
      reminderPlan: {
        immediate: existingChoice?.reminderPlan?.immediate || `The next beat visibly responds to the authored choice: ${pressure}`,
        shortTerm: existingChoice?.reminderPlan?.shortTerm || `Later sceneEpisode pressure remembers which option the player chose.`,
        ...(existingChoice?.reminderPlan?.later
          ? { later: existingChoice.reminderPlan.later }
          : residue[0]
            ? { later: `Carry forward treatment residue: ${residue[0]}` }
            : {}),
      },
      expectedResidue: Array.from(new Set([
        ...(existingChoice?.expectedResidue || []),
        ...residue,
        `Authored choice pressure remains visible: ${pressure}`,
      ])),
    };

    scene.personalStake = personalStake;
    scene.keyBeats = Array.isArray(scene.keyBeats) ? scene.keyBeats : [];
    if (!scene.keyBeats.some((beat) => beat.includes(pressure))) {
      scene.keyBeats.push(`Choice pressure: ${pressure}`);
    }
  }

  private ensureDramaticAuditMinimums(blueprint: EpisodeBlueprint, input: StoryArchitectInput): void {
    const guidance = input.seasonPlanDirectives?.treatmentGuidance;
    const audit = blueprint.dramaticAudit || {} as DramaticStructureAudit;
    const themePressure = this.pickBlueprintText(
      audit.themePressure,
      guidance?.themePressure,
      guidance?.liePressure,
      `This episode tests the theme through protagonist choice, cost, identity, relationship, and information pressure.`
    );
    const personalStake = this.pickPersonalStake(
      audit.personalStake,
      guidance?.liePressure,
      guidance?.bPressure,
      guidance?.consequenceResidue,
      `The protagonist's identity, reputation, trust, and future options are at risk.`
    );
    const stakesLayers = this.mergeTreatmentStakesLayers(
      audit.stakesLayers,
      this.inferTreatmentStakesLayers(guidance, input)
    );

    blueprint.dramaticAudit = {
      ...audit,
      episodeQuestion: this.pickBlueprintText(
        audit.episodeQuestion,
        guidance?.dramaticQuestion,
        `Will the protagonist change the situation in ${input.episodeTitle}?`
      ),
      themeQuestion: this.pickBlueprintText(
        audit.themeQuestion,
        'What does the protagonist owe the truth of who they are becoming?'
      ),
      themePressure,
      themeAngle: this.pickBlueprintText(audit.themeAngle, guidance?.themePressure, themePressure),
      themeChoicePressure: this.hasThemeChoiceAction(audit.themeChoicePressure)
        ? audit.themeChoicePressure
        : this.buildTreatmentThemeChoicePressure(guidance, themePressure),
      personalStake,
      stakesLayers,
      majorTurns: Array.isArray(audit.majorTurns) && audit.majorTurns.length > 0
        ? audit.majorTurns
        : [{
            id: 'turn-1',
            description: guidance?.forcedChoice || guidance?.obstacle || `The protagonist must act in ${input.episodeTitle}.`,
            turnType: 'choice',
            driver: 'player_choice',
            protagonistInfluence: guidance?.forcedChoice || 'The player/protagonist action changes the episode pressure.',
            closesQuestion: 'The opening pressure becomes a decision.',
            opensQuestion: guidance?.cliffhangerQuestion || guidance?.nextEpisodePressure || guidance?.endingPressure || guidance?.nextEpisodeCausality || 'The choice leaves visible residue.',
            memorableImageOrLine: guidance?.visualAnchor || input.episodeTitle,
          }],
      informationPlan: this.normalizeInformationPlan(
        audit.informationPlan,
        guidance,
        guidance?.informationMovement || guidance?.cSeed || themePressure,
        guidance?.nextEpisodePressure || guidance?.cliffhangerQuestion || guidance?.endingPressure || guidance?.nextEpisodeCausality || 'The information changes what the player can choose next.',
      ),
    };

    for (const scene of blueprint.scenes || []) {
      scene.themePressure = this.pickBlueprintText(scene.themePressure, themePressure);
      scene.personalStake = this.pickPersonalStake(scene.personalStake, personalStake);
      scene.stakesLayers = this.mergeTreatmentStakesLayers(scene.stakesLayers, stakesLayers);
      if (scene.choicePoint) {
        scene.choicePoint.themeAnswer = this.pickBlueprintText(scene.choicePoint.themeAnswer, blueprint.dramaticAudit.themeChoicePressure);
        scene.choicePoint.stakesLayers = this.mergeTreatmentStakesLayers(scene.choicePoint.stakesLayers, stakesLayers);
      }
    }
  }

  private repairTreatmentForwardPressure(blueprint: EpisodeBlueprint, guidance: TreatmentEpisodeGuidance | undefined): void {
    const endingPressure = guidance?.endingPressure
      || guidance?.cliffhangerHook
      || guidance?.cliffhangerQuestion
      || guidance?.nextEpisodePressure
      || guidance?.authoredCliffhanger
      || guidance?.endingTurnout
      || guidance?.nextEpisodeCausality;
    if (!this.hasBlueprintText(endingPressure)) return;

    const finalScenes = (blueprint.scenes || []).filter((scene) => (scene.leadsTo || []).length === 0);
    const finalScene = finalScenes[0] || blueprint.scenes?.[blueprint.scenes.length - 1];
    if (!finalScene) return;

    finalScene.keyBeats = Array.isArray(finalScene.keyBeats) ? finalScene.keyBeats : [];
    if (!finalScene.keyBeats.some((beat) => beat.includes(endingPressure))) {
      finalScene.keyBeats.push(`Forward pressure: ${endingPressure}`);
    }
    finalScene.narrativeFunction = finalScene.narrativeFunction
      ? `${finalScene.narrativeFunction} Forward pressure: ${endingPressure}`
      : `Forward pressure: ${endingPressure}`;
    finalScene.dramaticStructure = {
      question: finalScene.dramaticStructure?.question || guidance?.dramaticQuestion || blueprint.dramaticAudit?.episodeQuestion || 'What changes because of this scene?',
      turn: finalScene.dramaticStructure?.turn || guidance?.forcedChoice || guidance?.informationMovement || endingPressure,
      pressurePeak: finalScene.dramaticStructure?.pressurePeak || guidance?.endingTurnout || guidance?.consequenceResidue || endingPressure,
      changedState: finalScene.dramaticStructure?.changedState || endingPressure,
    };
    finalScene.residue = Array.isArray(finalScene.residue) ? finalScene.residue : [];
    if (!finalScene.residue.some((item) => item.description?.includes(endingPressure))) {
      finalScene.residue.push({ type: 'promise', description: endingPressure });
    }

    blueprint.arc = blueprint.arc || {
      hook: '',
      plotTurn1: '',
      pinch1: '',
      midpoint: '',
      pinch2: '',
      climax: '',
      resolution: '',
    };
    if (!blueprint.arc.resolution?.includes(endingPressure)) {
      blueprint.arc.resolution = [blueprint.arc.resolution, endingPressure].filter(Boolean).join(' ');
    }
  }

  private repairTreatmentDramaticAudit(blueprint: EpisodeBlueprint, input: StoryArchitectInput): void {
    const guidance = input.seasonPlanDirectives?.treatmentGuidance || {};

    const stakesLayers = this.inferTreatmentStakesLayers(guidance, input);
    const episodeQuestion = guidance.dramaticQuestion
      || blueprint.dramaticAudit?.episodeQuestion
      || `Will the protagonist change the situation in ${input.episodeTitle}?`;
    const themePressure = guidance.themePressure
      || guidance.liePressure
      || `This episode tests the theme through the protagonist's choice, cost, identity, and relationship pressure.`;
    const themeChoicePressure = this.hasThemeChoiceAction(blueprint.dramaticAudit?.themeChoicePressure)
      ? blueprint.dramaticAudit!.themeChoicePressure
      : this.buildTreatmentThemeChoicePressure(guidance, themePressure);
    const personalStake = guidance.liePressure
      || guidance.bPressure
      || guidance.consequenceResidue
      || `The protagonist's identity, reputation, trust, and future options are at risk.`;
    const nextEpisodePressure = guidance.nextEpisodePressure
      || guidance.cliffhangerQuestion
      || guidance.cliffhangerHook
      || guidance.nextEpisodeCausality
      || guidance.endingPressure
      || guidance.authoredCliffhanger
      || guidance.endingTurnout
      || guidance.consequenceResidue
      || `The changed state of ${input.episodeTitle} creates the next pressure.`;
    const openingPromise = {
      hook: this.pickBlueprintText(
        blueprint.dramaticAudit?.openingPromise?.hook,
        guidance.openingImage,
        guidance.coldOpenFunction,
        guidance.entryGoal,
        input.episodeSynopsis,
      ),
      episodePromise: this.pickBlueprintText(
        blueprint.dramaticAudit?.openingPromise?.episodePromise,
        guidance.episodePromise,
        episodeQuestion,
      ),
      activePressure: this.pickBlueprintText(
        blueprint.dramaticAudit?.openingPromise?.activePressure,
        guidance.obstacle,
        guidance.aPressure,
        guidance.forcedChoice,
        input.episodeSynopsis,
      ),
      optionalStakes: this.pickBlueprintText(
        blueprint.dramaticAudit?.openingPromise?.optionalStakes,
        personalStake,
      ),
    };
    const episodePressureLanes = {
      aPlot: {
        externalPressure: this.pickBlueprintText(
          blueprint.dramaticAudit?.episodePressureLanes?.aPlot?.externalPressure,
          guidance.aPressure,
          guidance.entryGoal,
          input.episodeSynopsis,
        ),
        climaxIntersection: this.pickBlueprintText(
          blueprint.dramaticAudit?.episodePressureLanes?.aPlot?.climaxIntersection,
          guidance.endingTurnout,
          guidance.exitShift,
          nextEpisodePressure,
        ),
      },
      ...(blueprint.dramaticAudit?.episodePressureLanes?.bPlot || guidance.bPressure ? {
        bPlot: {
          mode: blueprint.dramaticAudit?.episodePressureLanes?.bPlot?.mode
            || (this.episodeStructureMode === 'sceneEpisodes' ? 'sceneEpisode' : 'scene'),
          relationshipOrIdentityPressure: this.pickBlueprintText(
            blueprint.dramaticAudit?.episodePressureLanes?.bPlot?.relationshipOrIdentityPressure,
            guidance.bPressure,
            personalStake,
          ),
          protagonistVisibleSignals: Array.isArray(blueprint.dramaticAudit?.episodePressureLanes?.bPlot?.protagonistVisibleSignals)
            && blueprint.dramaticAudit!.episodePressureLanes!.bPlot!.protagonistVisibleSignals.length > 0
            ? blueprint.dramaticAudit!.episodePressureLanes!.bPlot!.protagonistVisibleSignals
            : [this.pickBlueprintText(guidance.bPressure, personalStake)],
          climaxIntersection: this.pickBlueprintText(
            blueprint.dramaticAudit?.episodePressureLanes?.bPlot?.climaxIntersection,
            guidance.exitShift,
            guidance.consequenceResidue,
            nextEpisodePressure,
          ),
          scenesOrEpisodes: blueprint.dramaticAudit?.episodePressureLanes?.bPlot?.scenesOrEpisodes,
        },
      } : {}),
      ...(blueprint.dramaticAudit?.episodePressureLanes?.cPlot || guidance.cSeed ? {
        cPlot: {
          function: blueprint.dramaticAudit?.episodePressureLanes?.cPlot?.function || 'future_seed',
          seed: this.pickBlueprintText(
            blueprint.dramaticAudit?.episodePressureLanes?.cPlot?.seed,
            guidance.cSeed,
            nextEpisodePressure,
          ),
          visiblePlant: this.pickBlueprintText(
            blueprint.dramaticAudit?.episodePressureLanes?.cPlot?.visiblePlant,
            guidance.cSeed,
            guidance.visualAnchor,
            nextEpisodePressure,
          ),
          payoffPlan: this.pickBlueprintText(
            blueprint.dramaticAudit?.episodePressureLanes?.cPlot?.payoffPlan,
            `Carry forward from ${input.episodeTitle}.`,
          ),
          targetPayoff: blueprint.dramaticAudit?.episodePressureLanes?.cPlot?.targetPayoff || 'later_episode',
        },
      } : {}),
    };

    blueprint.dramaticAudit = {
      episodeQuestion: this.pickBlueprintText(blueprint.dramaticAudit?.episodeQuestion, episodeQuestion),
      episodeQuestionSetup: this.pickBlueprintText(blueprint.dramaticAudit?.episodeQuestionSetup, guidance.openingImage, guidance.openingSituation, guidance.entryGoal, episodeQuestion),
      episodeQuestionAnswer: this.pickBlueprintText(blueprint.dramaticAudit?.episodeQuestionAnswer, guidance.exitShift, guidance.endingTurnout, nextEpisodePressure),
      themeQuestion: this.pickBlueprintText(blueprint.dramaticAudit?.themeQuestion, 'What does the protagonist owe the truth of who they are becoming?'),
      themePressure: this.pickBlueprintText(blueprint.dramaticAudit?.themePressure, themePressure),
      themeAngle: this.pickBlueprintText(blueprint.dramaticAudit?.themeAngle, guidance.themePressure, themePressure),
      themeChoicePressure,
      openingPromise,
      episodePressureLanes,
      episodeEndStateDelta: this.pickBlueprintText(blueprint.dramaticAudit?.episodeEndStateDelta, guidance.endStateChange, guidance.exitShift, guidance.consequenceResidue, nextEpisodePressure),
      nextEpisodePressure: this.pickBlueprintText(blueprint.dramaticAudit?.nextEpisodePressure, nextEpisodePressure),
      personalStake: this.pickPersonalStake(blueprint.dramaticAudit?.personalStake, personalStake),
      stakesLayers: this.mergeTreatmentStakesLayers(blueprint.dramaticAudit?.stakesLayers, stakesLayers),
      majorTurns: Array.isArray(blueprint.dramaticAudit?.majorTurns) && blueprint.dramaticAudit!.majorTurns.length > 0
        ? blueprint.dramaticAudit!.majorTurns
        : [
            {
              id: 'turn-1',
              description: guidance.entryGoal || guidance.openingImage || `The episode opens its pressure in ${input.episodeTitle}.`,
              turnType: 'escalation',
              driver: 'protagonist',
              protagonistInfluence: guidance.entryGoal || 'The protagonist enters with intent and chooses how to meet the pressure.',
              closesQuestion: 'The opening situation becomes active.',
              opensQuestion: episodeQuestion,
              memorableImageOrLine: guidance.visualAnchor || guidance.openingImage || input.episodeTitle,
            },
            {
              id: 'turn-2',
              description: guidance.forcedChoice || guidance.obstacle || `The protagonist must make a consequential choice.`,
              turnType: 'choice',
              driver: 'player_choice',
              protagonistInfluence: guidance.forcedChoice || 'The player choice reshapes the pressure and residue.',
              closesQuestion: 'Passive chronology ends.',
              opensQuestion: guidance.consequenceResidue || nextEpisodePressure,
              memorableImageOrLine: guidance.visualAnchor || guidance.consequenceResidue || input.episodeTitle,
            },
            {
              id: 'turn-3',
              description: guidance.exitShift || guidance.endingTurnout || nextEpisodePressure,
              turnType: 'cost',
              driver: 'protagonist',
              protagonistInfluence: guidance.exitShift || 'The protagonist leaves changed by the choice and its cost.',
              closesQuestion: episodeQuestion,
              opensQuestion: nextEpisodePressure,
              memorableImageOrLine: guidance.visualAnchor || guidance.endingTurnout || nextEpisodePressure,
            },
          ],
      informationPlan: this.normalizeInformationPlan(
        blueprint.dramaticAudit?.informationPlan,
        guidance,
        guidance.informationMovement || guidance.cSeed || guidance.visualAnchor || nextEpisodePressure,
        nextEpisodePressure,
      ),
    };

    for (const scene of blueprint.scenes || []) {
      scene.personalStake = this.pickPersonalStake(scene.personalStake, personalStake);
      scene.themePressure = this.pickBlueprintText(scene.themePressure, themePressure);
      scene.stakesLayers = this.mergeTreatmentStakesLayers(scene.stakesLayers, stakesLayers);
      if (scene.choicePoint) {
        scene.choicePoint.stakesLayers = this.mergeTreatmentStakesLayers(scene.choicePoint.stakesLayers, stakesLayers);
      }
    }

    if (this.episodeStructureMode === 'sceneEpisodes' && blueprint.scenes?.[0]) {
      const firstScene = blueprint.scenes[0];
      const pressureBeat = `Pressure: ${guidance.obstacle || guidance.forcedChoice || guidance.themePressure || guidance.liePressure || episodeQuestion}`;
      firstScene.keyBeats = Array.isArray(firstScene.keyBeats) ? firstScene.keyBeats : [];
      if (!/\b(pressure|threat|danger|risk|cost|want|need|fear|question|choice|choose|decide|reveal|secret|must|promise|trust|relationship|identity|help|refus\w*|confront\w*)\b|[?]/i.test(firstScene.keyBeats[0] || '')) {
        firstScene.keyBeats.unshift(pressureBeat);
      }
    }
  }

  private sanitizeInformationOwners(owners: unknown): InformationOwner[] {
    const rawOwners = Array.isArray(owners) ? owners : owners ? [owners] : [];
    const mapped = rawOwners.flatMap((owner): InformationOwner[] => {
      const value = String(owner || '').toLowerCase();
      if (!value.trim()) return [];
      if (['player', 'audience', 'protagonist', 'ally', 'antagonist', 'world'].includes(value)) {
        return [value as InformationOwner];
      }
      if (/\b(player|reader|audience)\b/.test(value)) return ['player'];
      if (/\b(protagonist|lead|hero|heroine|kylie|aethavyr)\b/.test(value)) return ['protagonist'];
      if (/\b(ally|friend|stela|mika|radu|companion|support)\b/.test(value)) return ['ally'];
      if (/\b(antagonist|villain|victor|enemy|opponent)\b/.test(value)) return ['antagonist'];
      if (/\b(world|public|city|court|community|society)\b/.test(value)) return ['world'];
      return [];
    });
    const unique = Array.from(new Set(mapped));
    return unique.length > 0 ? unique : ['player', 'protagonist'];
  }

  private repairTreatmentResidue(blueprint: EpisodeBlueprint, input: StoryArchitectInput): void {
    const guidance = input.seasonPlanDirectives?.treatmentGuidance;
    const authoredResidue = this.collectAuthoredResidue(guidance);
    if (authoredResidue.length === 0) return;

    blueprint.narrativePromises = Array.isArray(blueprint.narrativePromises)
      ? blueprint.narrativePromises
      : [];

    const setupScene = blueprint.startingSceneId || blueprint.scenes?.[0]?.id || `episode-${input.episodeNumber}`;
    for (const residue of authoredResidue) {
      const alreadyPromised = blueprint.narrativePromises.some((promise) =>
        promise.description?.includes(residue)
      );
      if (!alreadyPromised) {
        blueprint.narrativePromises.push({
          description: `Treatment residue to carry forward: ${residue}`,
          setupScene,
          importance: 'moderate',
        });
      }
    }

    const choiceScene = blueprint.scenes?.find((scene) => scene.choicePoint);
    if (!choiceScene?.choicePoint) return;

    choiceScene.choicePoint.expectedResidue = Array.from(new Set([
      ...(choiceScene.choicePoint.expectedResidue || []),
      ...authoredResidue,
    ]));

    choiceScene.choicePoint.reminderPlan = {
      immediate: choiceScene.choicePoint.reminderPlan?.immediate
        || `Show immediate residue from the authored path: ${authoredResidue[0]}`,
      shortTerm: choiceScene.choicePoint.reminderPlan?.shortTerm
        || `Keep this authored residue visible after reconvergence: ${authoredResidue[0]}`,
      ...(choiceScene.choicePoint.reminderPlan?.later
        ? { later: choiceScene.choicePoint.reminderPlan.later }
        : { later: `Future scenes should remember: ${authoredResidue[0]}` }),
    };
  }

  private validatePlannedEncounterCoverage(blueprint: EpisodeBlueprint, input: StoryArchitectInput): void {
    const plannedEncounters = input.seasonPlanDirectives?.plannedEncounters || [];
    if (plannedEncounters.length === 0) return;

    const encounterScenes = blueprint.scenes.filter((scene) => scene.isEncounter && scene.encounterType);
    if (encounterScenes.length < plannedEncounters.length) {
      throw new Error(
        `Blueprint defines ${encounterScenes.length} encounter scene(s), but season plan requires ${plannedEncounters.length}`
      );
    }

    for (const plannedEncounter of plannedEncounters) {
      const matchedScene = encounterScenes.find((scene) => this.sceneMatchesPlannedEncounter(scene, plannedEncounter));
      if (!matchedScene) {
        throw new Error(
          `Blueprint is missing required planned encounter "${plannedEncounter.id}" (${plannedEncounter.type}): ${plannedEncounter.description}`
        );
      }
      if (matchedScene.plannedEncounterId !== plannedEncounter.id) {
        throw new Error(
          `Encounter scene "${matchedScene.id}" must set plannedEncounterId="${plannedEncounter.id}" to bind the blueprint to the season plan`
        );
      }
      matchedScene.encounterType = this.normalizeEncounterType(plannedEncounter.type);
      if (!matchedScene.encounterStakes?.trim()) {
        throw new Error(`Encounter scene "${matchedScene.id}" is missing encounterStakes`);
      }
      if (!matchedScene.encounterRelevantSkills || matchedScene.encounterRelevantSkills.length === 0) {
        throw new Error(`Encounter scene "${matchedScene.id}" is missing encounterRelevantSkills`);
      }
      if (!matchedScene.encounterBeatPlan || matchedScene.encounterBeatPlan.length < 3) {
        throw new Error(`Encounter scene "${matchedScene.id}" must include encounterBeatPlan with at least 3 planned beats`);
      }
      const requiredNpcIds = new Set(matchedScene.encounterRequiredNpcIds || []);
      const sceneNpcIds = new Set(matchedScene.npcsPresent || []);
      const missingNpcIds: string[] = [];
      for (const npcId of plannedEncounter.npcsInvolved || []) {
        if (!requiredNpcIds.has(npcId)) {
          missingNpcIds.push(npcId);
          requiredNpcIds.add(npcId);
        }
        if (!sceneNpcIds.has(npcId)) {
          sceneNpcIds.add(npcId);
        }
      }
      if (missingNpcIds.length > 0) {
        console.warn(
          `[StoryArchitect] Encounter scene "${matchedScene.id}" omitted planned NPC(s) ${missingNpcIds.join(', ')} in encounterRequiredNpcIds; auto-merging from season plan`
        );
      }
      matchedScene.encounterRequiredNpcIds = Array.from(requiredNpcIds);
      matchedScene.npcsPresent = Array.from(sceneNpcIds);
    }
  }

  protected getAgentSpecificPrompt(): string {
    const sceneEpisodeMode = this.episodeStructureMode === 'sceneEpisodes'
      ? `
## SCENE-LENGTH EPISODE MODE

This run uses scene-length episodes. One runtime episode equals one dramatic scene.
- The blueprint MUST contain exactly one scene.
- Normal episodes use one non-encounter scene with a choicePoint and a cliffhanger/forward-pressure ending.
- Milestone episodes use one encounter scene when season plan directives include a planned encounter.
- Do not require scene-to-scene branching inside the episode. Structural branching happens across episodes via route flags.
- The single scene should escalate tension across its beats and hand off into the next runtime episode.
`
      : '';
    return `
## Your Role: Story Architect

You are the master narrative designer for interactive fiction. Your primary job is to design episodes built around a single, intensely dramatic ENCOUNTER that everything else exists to earn.

${BRANCH_AND_BOTTLENECK}

## THE ENCOUNTER-FIRST DESIGN PROCESS

**The encounter IS the episode.** Everything else is setup.

Design every episode using this process — in this order:

### Step 1: Choose the Encounter
Identify the most dramatically charged moment this episode can contain. Ask: "What is the ONE scene where the stakes are highest, the conflict is most intense, and the player's choices feel most consequential?" That is your encounter. It is the episode's reason for existing.

You are NOT limited to the source material. Feel free to invent or heighten a confrontation, crisis, or conflict that maximises drama — as long as it fits the themes and characters. A quiet Victorian novel can become an intense social encounter. A romantic story can have a harrowing escape. A literary classic can have a scene of shocking confrontation.

### Step 2: Design What Players Need to Know
Before the encounter, players must:
- Know who the enemy/obstacle is and why they're a threat
- Understand the personal stakes (not just plot stakes — what does THIS mean for this character's identity?)
- Have formed opinions, relationships, and loyalties that make each encounter choice feel loaded
- Be emotionally invested in the outcome

For every scene before the encounter, ask: **"What does this scene give the player that makes the encounter's choices matter more?"**

### Step 3: Design the Encounter's Internal Choices
The encounter must have multiple meaningful choices at each beat. Each choice should:
- Draw on what was established in earlier scenes (relationships, information, values)
- Have a different skill/attribute that makes it viable for different player builds
- Carry the IDENTITY stakes from the episode (not just tactical stakes)
- Make the player understand the risk domain and leverage in story terms, even though the numbers stay hidden

### Step 4: Place the Encounter at the Episode's Climax
The encounter goes at the dramatic peak — roughly two-thirds to three-quarters of the way through. Everything before it is buildup. Everything after it is consequence.

---

## ENCOUNTER TYPES (All Genres — Required Every Episode)

**Encounters are not limited to action stories.** Every genre has scenes of intense, skill-tested conflict.

- **Combat**: Fights, duels, physical confrontations, battles. *(adventure, action)*
- **Chase**: Pursuit, escape, race against time. *(thriller, gothic)*
- **Stealth**: Infiltration, avoiding detection, moving unseen. *(spy, heist)*
- **Social**: The most versatile type. Use for ANY high-stakes interpersonal confrontation where failure has real consequences — accusations, ultimatums, confessions forced under pressure, an argument that could end a relationship, persuasion against someone who doesn't want to be persuaded.
  - Literary examples: Hindley's public humiliation of Heathcliff (Wuthering Heights); Rochester's interrogation of Jane (Jane Eyre); Darcy's disastrous first proposal (Pride and Prejudice); the final confrontation between Edmund and his father (King Lear); Hester refusing to name Dimmesdale (The Scarlett Letter).
  - **USE THIS for any literary, romantic, gothic, or character-driven story.**
- **Puzzle**: Investigation, deduction under pressure, decrypting a situation. *(mystery, thriller)*
- **Exploration**: Dangerous terrain, survival, navigating the unknown. *(adventure, gothic)*
- **Mixed**: Two types combined (e.g. a chase that turns into a social confrontation).

When in doubt, **use social**. Almost every story has a scene where the protagonist is directly confronted by another character with something real at stake. That is your encounter.

For encounter scenes, set:
- \`isEncounter: true\`
- \`plannedEncounterId\`: If this episode has pre-planned encounters, copy the exact encounter ID here
- \`encounterType\`: "combat" | "chase" | "stealth" | "social" | "romantic" | "dramatic" | "puzzle" | "exploration" | "investigation" | "negotiation" | "survival" | "heist" | "mixed"
- \`encounterStyle\`: "action" | "social" | "romantic" | "dramatic" | "mystery" | "stealth" | "adventure" | "mixed"
- \`encounterDescription\`: Exactly what the protagonist must overcome — be specific
- \`encounterStakes\`: The personal stakes this encounter is cashing in
- \`encounterRequiredNpcIds\`: Every NPC ID that must actively participate in the encounter
- \`encounterRelevantSkills\`: The skills/approaches the encounter should test
- \`encounterBeatPlan\`: At least 3 short beat intents in order (opening pressure, escalation, crisis/resolution)
- \`encounterDifficulty\`: "easy" | "moderate" | "hard" | "extreme"
- \`encounterBuildup\`: What earlier scenes must establish so this encounter's choices feel earned
- \`encounterSetupContext\`: Array of strings naming the specific flags and relationship thresholds from earlier scenes that are designed to pay off INSIDE the encounter

**\`encounterSetupContext\` format** — one entry per payoff:
- \`"flag:<flagName> — <effect>"\` e.g. \`"flag:defended_heathcliff — unlocks defiance choice in the confrontation"\`
- \`"relationship:<npcId>.<dimension> <op> <threshold> — <effect>"\` e.g. \`"relationship:hindley.trust < -20 — Hindley's opening line is crueller and colder"\`

Every flag set by a pre-encounter choice, and every relationship dimension involving an encounter NPC, should appear here with a description of how it echoes. This list is passed directly to the EncounterArchitect so it can author the conditional content.

Encounters are ALWAYS bottleneck scenes. They provide agency through skill choices WITHIN the encounter, not through plot branching.

---

## PRE-ENCOUNTER SCENES: The Setup

For every scene that comes BEFORE the encounter, fill in \`encounterBuildup\` — a sentence describing what this specific scene contributes to making the encounter land:

- "Establishes Hindley's cruelty so the player feels the stakes when Heathcliff finally stands up to him"
- "Shows Catherine's fascination with the Linton world — the competing pull that makes the encounter's choice hard"
- "Reveals information that becomes a weapon in the encounter's skill checks"

Every non-encounter scene must earn its place by making the encounter MORE meaningful.

---

## Choice Types (Player Experience)

- **Expression (~35%)**: Personality/voice choices. Cosmetic, no plot impact. NEVER branches.
- **Relationship (~30%)**: Bond building with NPCs. Affect trust, affection, respect, fear. May branch.
- **Strategic (~20%)**: Skill/stat-based choices. May branch.
- **Dilemma (~15%)**: Value-testing, high impact, no clearly right answer. May branch.

## Branching

Branching is a PROPERTY of any non-expression choice.
- Set \`branches: true\` on the choicePoint when the scene should diverge
- Include at least ${this.sceneGraphBranching?.minPerEpisode ?? 1} scene-graph branch choice point(s) per episode unless the request explicitly says linear
- A scene-graph branch means: a non-expression choicePoint with \`branches: true\` AND at least two distinct \`leadsTo\` scene IDs
- Max 1-2 branching choice points per episode; keep them small and reconvergent
- Encounter outcomes (victory/defeat/escape) are valuable, but they DO NOT count as regular scene-graph branching

## Choice Architecture Rules

1. **Choice Density**: At least 50% of scenes MUST have a choicePoint.
2. **Season Opening Choice Rule**: In Episode 1, the first scene MUST have a choicePoint. No delayed second-scene exception.
3. **No Choice Gaps**: Never more than 2 consecutive scenes without a choicePoint.
4. **Stakes Triangle**: Every choicePoint must define Want, Cost, and Identity.
5. **Consequence Legibility**: Major choicePoints should name the consequence domain and how the story will remember the decision.
6. **Competence Arc**: When a future confrontation can be softened or redirected through prep, define what the player can try now, what they lack, and what growth path could help later.

## Scene Types

- **BOTTLENECK**: All players experience this. Use for the encounter, crucial revelations, and emotional peaks.
- **BRANCH**: Player choice leads to meaningfully different paths that eventually reconverge.
- **TRANSITION**: Connects scenes, lower stakes, moves story forward.

## Scene Count Guidelines

- 3-6 scenes is required
- The encounter is typically scene 3-5 (two-thirds of the way through)
- 2-3 scenes before the encounter: setup and escalation
- 1-2 scenes after: consequence and resolution

## Tint System

Dilemma choices set tint flags (e.g., "tint:mercy") that color subsequent scenes. Plan for NPC reactions and textVariants conditioned on these flags.

## Callback & Flag Planning

Expression choices should set memorable flags. Plan at least 1 callback per episode where a later scene references an earlier choice.

Remember: The encounter is the heart. Design outward from it.
${sceneEpisodeMode}
`
  }

  async execute(input: StoryArchitectInput, retryCount: number = 0): Promise<AgentResponse<EpisodeBlueprint>> {
    const maxRetries = 2;
    const prompt = this.buildPrompt(input);

    console.log(`[StoryArchitect] Building episode blueprint...${retryCount > 0 ? ` (retry ${retryCount}/${maxRetries})` : ''}`);

    try {
      const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
        { role: 'user', content: prompt }
      ];

      if (retryCount > 0) {
        const structuralFeedback = this.lastStructuralFeedback.length > 0
          ? `\nSTRUCTURAL ISSUES FROM PREVIOUS ATTEMPT:\n${this.lastStructuralFeedback.map(f => `- ${f}`).join('\n')}\n`
          : '';

      messages[0].content += `\n\n⚠️ PREVIOUS ATTEMPT FAILED — FIX ALL ISSUES BELOW:${structuralFeedback}
REQUIREMENTS:
- The scenes array MUST contain ${this.episodeStructureMode === 'sceneEpisodes' ? 'exactly 1 scene' : `3-${input.targetSceneCount} scenes`}
- The first scene MUST have a choicePoint
- At least ${Math.ceil(input.targetSceneCount * 0.5)} out of up to ${input.targetSceneCount} scenes must have choicePoint
- Include choicePoint with type, stakes (want/cost/identity), and description for each choice scene
- All leadsTo references must point to valid scene IDs
- Scene graph must be fully connected from startingSceneId
- Include at least one encounter scene with encounterDescription, encounterDifficulty, encounterBuildup, encounterStakes, encounterRelevantSkills, and encounterBeatPlan`;
        this.lastStructuralFeedback = [];
      }

      const rawResponse = await this.callLLM(messages);
      const response = rawResponse;

      console.log(`[StoryArchitect] Received response (${response.length} chars)`);

      let blueprint: EpisodeBlueprint;
      try {
        blueprint = this.unwrapDynamoTypedJson(this.parseJSON<EpisodeBlueprint>(response)) as EpisodeBlueprint;
      } catch (parseError) {
        console.error(`[StoryArchitect] JSON parse failed. Raw response (first 500 chars):`, response.substring(0, 500));
        if (retryCount < maxRetries) {
          this.lastStructuralFeedback = [
            'Previous response was not parseable strict JSON. Return one plain JSON object only: no markdown, no comments, no trailing commas, no DynamoDB typed wrappers like {"S":"value"} or {"L":[...]}.',
          ];
          return this.execute(input, retryCount + 1);
        }
        throw parseError;
      }

      // Debug: Log the parsed blueprint structure
      console.log(`[StoryArchitect] Parsed blueprint keys:`, Object.keys(blueprint));
      console.log(`[StoryArchitect] blueprint.scenes type:`, typeof blueprint.scenes, Array.isArray(blueprint.scenes) ? `(array of ${blueprint.scenes.length})` : '');

      // Check for alternative scene key names the LLM might use
      const rawBlueprint = blueprint as unknown as Record<string, unknown>;
      if (!blueprint.scenes && rawBlueprint.sceneGraph) {
        console.log(`[StoryArchitect] Found scenes under 'sceneGraph' key`);
        blueprint.scenes = rawBlueprint.sceneGraph as SceneBlueprint[];
      }
      if (!blueprint.scenes && rawBlueprint.sceneList) {
        console.log(`[StoryArchitect] Found scenes under 'sceneList' key`);
        blueprint.scenes = rawBlueprint.sceneList as SceneBlueprint[];
      }
      const episodeObj = rawBlueprint.episode as Record<string, unknown> | undefined;
      if (!blueprint.scenes && episodeObj?.scenes) {
        console.log(`[StoryArchitect] Found scenes under 'episode.scenes' key`);
        blueprint.scenes = episodeObj.scenes as SceneBlueprint[];
      }

      // Normalize arrays that the LLM might return as strings or undefined
      if (!blueprint.scenes) {
        console.error(`[StoryArchitect] No scenes found! Raw blueprint (first 1000 chars):`, JSON.stringify(blueprint).substring(0, 1000));
        blueprint.scenes = [];
      } else if (!Array.isArray(blueprint.scenes)) {
        blueprint.scenes = [blueprint.scenes as unknown as SceneBlueprint];
      }

      for (let i = 0; i < blueprint.scenes.length; i++) {
        const scene = blueprint.scenes[i];

        // Normalize scalar fields that might be undefined
        if (!scene.id) {
          scene.id = `scene-${i + 1}`;
        }
        if (!scene.name) {
          scene.name = `Scene ${i + 1}`;
        }
        if (!scene.description) {
          scene.description = '';
        }
        if (!scene.location) {
          scene.location = 'location-1'; // Default to first location
        }
        if (!scene.mood) {
          scene.mood = 'neutral';
        }
        if (!scene.purpose) {
          scene.purpose = 'transition';
        }
        if (!scene.narrativeFunction) {
          scene.narrativeFunction = '';
        }

        // Normalize leadsTo
        if (!scene.leadsTo) {
          scene.leadsTo = [];
        } else if (!Array.isArray(scene.leadsTo)) {
          scene.leadsTo = [scene.leadsTo as unknown as string];
        }

        // Normalize npcsPresent
        if (!scene.npcsPresent) {
          scene.npcsPresent = [];
        } else if (!Array.isArray(scene.npcsPresent)) {
          scene.npcsPresent = [scene.npcsPresent as unknown as string];
        }

        // Normalize keyBeats
        if (!scene.keyBeats) {
          scene.keyBeats = [];
        } else if (!Array.isArray(scene.keyBeats)) {
          scene.keyBeats = [scene.keyBeats as unknown as string];
        }

        if (scene.transitionOut && !Array.isArray(scene.transitionOut)) {
          scene.transitionOut = [scene.transitionOut as unknown as SceneTransitionOut];
        }

        if (scene.residue && !Array.isArray(scene.residue)) {
          scene.residue = [scene.residue as unknown as SceneResidue];
        }

        // Normalize requires
        if (scene.requires && !Array.isArray(scene.requires)) {
          scene.requires = [scene.requires as unknown as string];
        }
        if (scene.requires) {
          scene.requires = scene.requires.filter((targetId) => targetId !== scene.id);
        }

        // Normalize choicePoint
        if (scene.choicePoint) {
          if (!scene.choicePoint.optionHints) {
            scene.choicePoint.optionHints = [];
          } else if (!Array.isArray(scene.choicePoint.optionHints)) {
            scene.choicePoint.optionHints = [scene.choicePoint.optionHints as unknown as string];
          }
          if (scene.choicePoint.expectedResidue && !Array.isArray(scene.choicePoint.expectedResidue)) {
            scene.choicePoint.expectedResidue = [scene.choicePoint.expectedResidue as unknown as string];
          }
          // Ensure stakes exists
          if (!scene.choicePoint.stakes) {
            scene.choicePoint.stakes = { want: '', cost: '', identity: '' };
          }
        }
      }

      // === AUTO-REPAIR: Fix invalid leadsTo references ===
      // Build set of valid scene IDs
      const validSceneIds = new Set(blueprint.scenes.map(s => s.id));
      
      for (let i = 0; i < blueprint.scenes.length; i++) {
        const scene = blueprint.scenes[i];
        const originalLeadsTo = [...scene.leadsTo];
        
        // Filter out invalid scene references and self-routes. A scene that
        // points to itself becomes its own dependency prerequisite and blocks
        // content generation, especially in single-scene sceneEpisodes.
        scene.leadsTo = scene.leadsTo.filter(targetId => {
          if (targetId === scene.id) {
            console.warn(`[StoryArchitect] Removed self leadsTo reference: ${scene.id} -> ${targetId}`);
            return false;
          }
          if (validSceneIds.has(targetId)) {
            return true;
          }
          console.warn(`[StoryArchitect] Removed invalid leadsTo reference: ${scene.id} -> ${targetId}`);
          return false;
        });
        
        // If leadsTo is now empty and this isn't the last scene, add sequential link
        if (scene.leadsTo.length === 0 && i < blueprint.scenes.length - 1) {
          const nextScene = blueprint.scenes[i + 1];
          scene.leadsTo = [nextScene.id];
          console.log(`[StoryArchitect] Auto-added sequential link: ${scene.id} -> ${nextScene.id}`);
        }

        const distinctLeadsTo = new Set(scene.leadsTo);
        if (scene.choicePoint?.branches && distinctLeadsTo.size < 2) {
          scene.choicePoint.branches = false;
          console.warn(`[StoryArchitect] Removed branches=true from ${scene.id}; fewer than two distinct future scene targets remain`);
        }
        
        // Log if we made repairs
        if (originalLeadsTo.length !== scene.leadsTo.length || 
            !originalLeadsTo.every((id, idx) => scene.leadsTo[idx] === id)) {
          console.log(`[StoryArchitect] Repaired leadsTo for ${scene.id}: [${originalLeadsTo.join(', ')}] -> [${scene.leadsTo.join(', ')}]`);
        }
      }

      if (!blueprint.bottleneckScenes) {
        blueprint.bottleneckScenes = [];
      } else if (!Array.isArray(blueprint.bottleneckScenes)) {
        blueprint.bottleneckScenes = [blueprint.bottleneckScenes as unknown as string];
      }

      // Also repair bottleneckScenes to remove invalid references
      blueprint.bottleneckScenes = blueprint.bottleneckScenes.filter(id => {
        if (validSceneIds.has(id)) return true;
        console.warn(`[StoryArchitect] Removed invalid bottleneck reference: ${id}`);
        return false;
      });

      // Normalize other top-level arrays
      if (!blueprint.themes) {
        blueprint.themes = [];
      } else if (!Array.isArray(blueprint.themes)) {
        blueprint.themes = [blueprint.themes as unknown as string];
      }

      if (!blueprint.suggestedFlags) {
        blueprint.suggestedFlags = [];
      } else if (!Array.isArray(blueprint.suggestedFlags)) {
        blueprint.suggestedFlags = [blueprint.suggestedFlags as unknown as { name: string; description: string }];
      }

      if (!blueprint.suggestedScores) {
        blueprint.suggestedScores = [];
      } else if (!Array.isArray(blueprint.suggestedScores)) {
        blueprint.suggestedScores = [blueprint.suggestedScores as unknown as { name: string; description: string }];
      }

      if (!blueprint.suggestedTags) {
        blueprint.suggestedTags = [];
      } else if (!Array.isArray(blueprint.suggestedTags)) {
        blueprint.suggestedTags = [blueprint.suggestedTags as unknown as { name: string; description: string }];
      }

      if (!blueprint.narrativePromises) {
        blueprint.narrativePromises = [];
      } else if (!Array.isArray(blueprint.narrativePromises)) {
        blueprint.narrativePromises = [blueprint.narrativePromises as unknown as { description: string; setupScene: string; importance: 'minor' | 'moderate' | 'major' }];
      }

      if (blueprint.dramaticAudit) {
        if (!Array.isArray(blueprint.dramaticAudit.majorTurns)) {
          blueprint.dramaticAudit.majorTurns = blueprint.dramaticAudit.majorTurns
            ? [blueprint.dramaticAudit.majorTurns as unknown as DramaticStructureAudit['majorTurns'][number]]
            : [];
        }
        if (!Array.isArray(blueprint.dramaticAudit.informationPlan)) {
          blueprint.dramaticAudit.informationPlan = blueprint.dramaticAudit.informationPlan
            ? [blueprint.dramaticAudit.informationPlan as unknown as DramaticStructureAudit['informationPlan'][number]]
            : [];
        }
        blueprint.dramaticAudit.informationPlan = blueprint.dramaticAudit.informationPlan.map(item => ({
          ...item,
          knownBy: Array.isArray(item.knownBy)
            ? item.knownBy
            : item.knownBy
              ? [item.knownBy as unknown as InformationOwner]
              : [],
        }));
        const bPlot = blueprint.dramaticAudit.episodePressureLanes?.bPlot;
        if (bPlot) {
          bPlot.protagonistVisibleSignals = Array.isArray(bPlot.protagonistVisibleSignals)
            ? bPlot.protagonistVisibleSignals
            : bPlot.protagonistVisibleSignals
              ? [bPlot.protagonistVisibleSignals as unknown as string]
              : [];
          if (bPlot.scenesOrEpisodes && !Array.isArray(bPlot.scenesOrEpisodes)) {
            bPlot.scenesOrEpisodes = [bPlot.scenesOrEpisodes as unknown as string];
          }
        }
      }

      // Ensure startingSceneId is set - default to first scene if not provided
      if (!blueprint.startingSceneId && blueprint.scenes.length > 0) {
        blueprint.startingSceneId = blueprint.scenes[0].id;
        console.log(`[StoryArchitect] Set default startingSceneId to: ${blueprint.startingSceneId}`);
      }

      // Ensure episodeId and title have defaults
      if (!blueprint.episodeId) {
        blueprint.episodeId = 'episode-1';
      }
      if (!blueprint.title) {
        blueprint.title = 'Untitled Episode';
      }
      if (!blueprint.synopsis) {
        blueprint.synopsis = '';
      }

      // Ensure arc object exists with the full 7-point shape. Missing fields
      // are backfilled to '' so downstream code can rely on their presence;
      // SevenPointCoverageValidator enforces that episodes actually populate
      // the beats their structuralRole claims to cover.
      if (!blueprint.arc) {
        blueprint.arc = {
          hook: '',
          plotTurn1: '',
          pinch1: '',
          midpoint: '',
          pinch2: '',
          climax: '',
          resolution: '',
        };
      } else {
        const a: Partial<EpisodeBlueprint['arc']> = blueprint.arc as Partial<EpisodeBlueprint['arc']>;
        blueprint.arc = {
          hook: a.hook ?? '',
          plotTurn1: a.plotTurn1 ?? '',
          pinch1: a.pinch1 ?? '',
          midpoint: a.midpoint ?? '',
          pinch2: a.pinch2 ?? '',
          climax: a.climax ?? '',
          resolution: a.resolution ?? '',
        };
      }

      // Propagate the caller's structuralRole assignment so validators and
      // downstream writers can see which beats this episode owns.
      if (!blueprint.structuralRole && input.episodeStructuralRole) {
        blueprint.structuralRole = [...input.episodeStructuralRole];
      }

      this.repairChoiceDensity(blueprint, input);
      this.repairPlannedEncounterCoverage(blueprint, input);
      this.repairSceneGraphBranchCoverage(blueprint);
      this.repairTreatmentDramaticAudit(blueprint, input);
      this.repairTreatmentMajorChoicePressure(blueprint, input);
      this.repairTreatmentForwardPressure(blueprint, input.seasonPlanDirectives?.treatmentGuidance);
      this.repairTreatmentResidue(blueprint, input);
      this.ensureDramaticAuditMinimums(blueprint, input);
      this.repairSceneTransitions(blueprint);
      this.repairSceneTurnContracts(blueprint);

      // Log choice point info BEFORE validation
      const scenesWithChoices = blueprint.scenes?.filter(s => s.choicePoint) || [];
      console.log(`[StoryArchitect] Blueprint has ${blueprint.scenes?.length || 0} scenes, ${scenesWithChoices.length} with choicePoints, ${blueprint.bottleneckScenes.length} bottlenecks, startingSceneId: ${blueprint.startingSceneId}`);
      if (scenesWithChoices.length > 0) {
        console.log(`[StoryArchitect] Scenes with choices: ${scenesWithChoices.map(s => `${s.id} (${s.choicePoint?.type})`).join(', ')}`);
      } else {
        console.warn(`[StoryArchitect] WARNING: No scenes have choicePoints!`);
      }

      // Validate the blueprint (structural graph validation)
      const structuralIssues = this.collectStructuralIssues(blueprint, input);
      if (structuralIssues.length > 0 && retryCount < maxRetries) {
        console.log(`[StoryArchitect] Structural validation found ${structuralIssues.length} issue(s), retrying with feedback...`);
        this.lastStructuralFeedback = structuralIssues;
        return this.execute(input, retryCount + 1);
      }

      this.validateBlueprint(blueprint, input);

      return {
        success: true,
        data: blueprint,
        rawResponse: response,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[StoryArchitect] Error:`, errorMsg);

      const isChoiceDensityError = errorMsg.includes('choice density') ||
                                    errorMsg.includes('choicePoint') ||
                                    errorMsg.includes('consecutive scenes without choices');
      const isEncounterPlanningError = errorMsg.includes('encounter scene') ||
                                       errorMsg.includes('planned encounter') ||
                                       errorMsg.includes('season plan requires') ||
                                       errorMsg.includes('Blueprint only defines');
      const isStructuralError = errorMsg.includes('non-existent scene') ||
                                 errorMsg.includes('Bottleneck scene') ||
                                 errorMsg.includes('Starting scene') ||
                                 errorMsg.includes('must have at least');
      const isTreatmentFidelityError = errorMsg.includes('[TreatmentFidelity]');
      const isDramaticStructureError = errorMsg.includes('[DramaticStructure]');
      const isThemePressureError = errorMsg.includes('[ThemePressure]');
      const isSceneTurnContractError = errorMsg.includes('[SceneTurnContract]');
      const isEpisodePressureError = errorMsg.includes('[EpisodePressure]');
      const isParseError = errorMsg.includes('Failed to parse JSON response') ||
                           errorMsg.includes('Expected double-quoted property name') ||
                           errorMsg.includes('Unexpected token');

      if ((isChoiceDensityError || isEncounterPlanningError || isStructuralError || isTreatmentFidelityError || isDramaticStructureError || isThemePressureError || isSceneTurnContractError || isEpisodePressureError || isParseError) && retryCount < maxRetries) {
        console.log(`[StoryArchitect] Retrying due to structural blueprint issue: ${errorMsg.slice(0, 120)}`);
        this.lastStructuralFeedback = isParseError
          ? [
              'Previous response was not parseable strict JSON. Return one plain JSON object only: no markdown, no comments, no trailing commas, no DynamoDB typed wrappers like {"S":"value"} or {"L":[...]}.',
            ]
          : [errorMsg];
        return this.execute(input, retryCount + 1);
      }

      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  private unwrapDynamoTypedJson(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.unwrapDynamoTypedJson(item));
    }
    if (!value || typeof value !== 'object') return value;

    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length === 1) {
      if ('S' in record) return String(record.S ?? '');
      if ('N' in record) {
        const asNumber = Number(record.N);
        return Number.isFinite(asNumber) ? asNumber : record.N;
      }
      if ('BOOL' in record) return Boolean(record.BOOL);
      if ('NULL' in record) return null;
      if ('L' in record && Array.isArray(record.L)) {
        return record.L.map((item) => this.unwrapDynamoTypedJson(item));
      }
      if ('M' in record && record.M && typeof record.M === 'object') {
        return this.unwrapDynamoTypedJson(record.M);
      }
    }

    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(record)) {
      out[key] = this.unwrapDynamoTypedJson(inner);
    }
    return out;
  }

  private buildPrompt(input: StoryArchitectInput): string {
    const npcList = input.availableNPCs
      .map(npc => {
        const baseline = npc.initialRelationship
          ? Object.entries(npc.initialRelationship)
              .filter(([, value]) => typeof value === 'number')
              .map(([key, value]) => `${key}=${value}`)
              .join(', ')
          : '';
        return `- ${npc.name} (${npc.id}): ${npc.description}${npc.relationshipContext ? ` [${npc.relationshipContext}]` : ''}${baseline ? ` [baseline relationship: ${baseline}]` : ''}`;
      })
      .join('\n');

    return `
Create an episode blueprint for the following story.

## DESIGN PROCESS — FOLLOW IN ORDER

**Before writing any scene, complete these steps mentally:**

1. **ENCOUNTER FIRST**: Identify the single most dramatically charged moment this episode can contain. This is your encounter. It goes into the blueprint as a scene with \`isEncounter: true\`. It is the episode's climax.
2. **WHAT DOES THE PLAYER NEED?** Before reaching the encounter, what must the player know, feel, and care about for the encounter's choices to hit hard? List the relationships, information, and emotional stakes the prior scenes must establish.
3. **DESIGN THE BUILDUP**: Create 2–4 scenes that escalate toward the encounter. Each one must earn its place by giving the player something they need for the encounter. Fill in \`encounterBuildup\` on every non-encounter scene.
4. **DESIGN THE AFTERMATH**: 1–2 scenes after the encounter that play out the consequences.
5. **THEN** write the full JSON blueprint.

Do NOT adapt the source material rigidly. Invent or heighten confrontations, crises, and conflicts to maximise drama. A quiet scene in the source can become an intense encounter if the themes support it.

## Story Context
- **Title**: ${input.storyTitle}
- **Genre**: ${input.genre}
- **Synopsis**: ${input.synopsis}
- **Tone**: ${input.tone}
${input.userPrompt ? `- **User Instructions/Prompt**: ${input.userPrompt}\n` : ''}

## Episode Details
- **Episode ${input.episodeNumber}**: "${input.episodeTitle}"
- **Episode Synopsis**: ${input.episodeSynopsis}
${input.previousEpisodeSummary ? `- **Previous Episode**: ${input.previousEpisodeSummary}` : ''}

## Characters
**Protagonist**: ${input.protagonistDescription}

**Available NPCs**:
${npcList}

## World Context
${input.worldContext}

**Current Location**: ${input.currentLocation}
${input.memoryContext ? `
## Pipeline Memory (Insights from Prior Generations)
${input.memoryContext}
` : ''}
## Requirements
- Scene count: ${this.episodeStructureMode === 'sceneEpisodes' ? 'exactly 1 scene' : `exactly within the hard range of 3-${input.targetSceneCount} scenes`}
- Episode turns: plan 3-6 major episode turns through the scene graph, keyBeats, encounterBuildup, choicePoints, sequenceIntent, and cliffhanger planning. Do not add a separate chapter-beat schema.
- Major choice points: ${input.majorChoiceCount} significant decisions
- Use branch-and-bottleneck structure
- Every major choice needs WANT, COST, and IDENTITY stakes
${this.episodeStructureMode === 'sceneEpisodes'
  ? '- **Scene-length central pressure**: If the season plan marks this episode as a milestone encounter, manifest the pressure as the one encounter scene. Otherwise, build one non-encounter dramatic scene with at least one choicePoint and a final cliffhanger/forward-pressure beat.'
  : "- **Encounter as central conflict**: The episode's central conflict MUST manifest in an encounter scene. Buildup scenes make that encounter feel earned; aftermath scenes show what the encounter changed."}
- **Intensity guidance in keyBeats**: For each scene, indicate which keyBeats are the dominant peak(s) (prefix with "PEAK:") and suggest where rest/breathing beats should fall (prefix with "REST:"). The SceneWriter uses this to shape the intensity arc. Example: ["REST: the quiet village at dawn", "PEAK: confrontation erupts at the market", "the aftermath settles"]
- **Pressure, not mandatory combat**: Every scene should create story pressure, but the pressure must match the genre and moment. Use physical danger, social cost, mystery revelation, romantic vulnerability, moral compromise, environmental threat, resource loss, or identity pressure as appropriate.
- **Decisive beats**: keyBeats should include specific actions, surprising complications, character development, visible consequences, and forward pressure.
- **Turn ladder, not topic list**: Frame each scene as an active situation. keyBeats should bend or flip something: trust shifts, evidence changes hands, a secret becomes harder to deny, leverage is gained/lost, distance/closeness changes, danger/reputation/resources change, identity is expressed, or knowledge becomes actionable.
- **Sequence intent, not random panels**: Every multi-beat scene should include \`sequenceIntent\` that names the objective, visible activity, obstacle, startState, turningPoint, endState, visualThread, and optional mechanicThread. This field is optional for old content compatibility, but REQUIRED-BY-PROCESS for new generated scenes with multiple beats or storyboard panels.
- **Visible activity, not just topic**: Scene descriptions and keyBeats should name the physical carrier of the scene: object transfer, pursuit, concealment, search, ritual, repair, argument blocking, distance change, environmental pressure, or another visible action pattern. Avoid static "they discuss X" scenes unless the visible business makes the power shift readable.
- **Fiction-first mechanics**: When a key turn should matter later, route it through existing fields only: choice stakes/consequenceDomain, encounterSetupContext, encounterBuildup, flags/relationships implied by choicePoint stakes, stat checks, skill/attribute/relationship conditions, or callback residue. Do not invent a new mechanics layer.
- **Capability growth is story plus mechanics**: If the protagonist falls short, fail forward into preparation, training, mentorship, recovery, alliance, investigation, or alternate leverage. Future encounters should respect improved skills, attributes, relationships, flags, identity, prior choices, and encounter outcomes without exposing stats or grind language.
- **Rest scenes still turn**: REST beats may be quiet, but they should show settling, contrast, recovery, relationship recalibration, or the cost of the prior pressure.
- **Plans go wrong**: When characters follow a plan, include a plausible complication that forces improvisation unless the scene is deliberately a rest beat.
- **No arbitrary escalation treadmill**: Escalate the episode's overall pressure, but do not make every conversation an argument or every beat more dangerous than everything before it.

## Scene Splitting

Split episode turns into separate scenes when there is a meaningful change in location, time, character dynamics, objective, obstacle, or dramatic tension.

Do not create a new scene for tiny tonal shifts. Fold small shifts into beats. A new scene should represent a real change in situation, not just a new topic.

Each scene should have a concise mood label and keyBeats that describe major turns, not topics.
Use keyBeats to show the scene's purpose, pressure, visible action, and handoff into the next scene or encounter.

## Scene Content Purpose

Every scene must have a purpose the player can feel: emotional pressure, action pressure, character development, relationship movement, information gain, consequence, or meaningful aftermath.

Scene descriptions, keyBeats, choice stakes, encounter buildup, and handoffs should all reinforce that purpose.

Do not plan scenes as topic containers. Plan scenes as situations where something changes.

## Scene Arc

Each scene should build toward its keyMoment.

The beat sequence may include rest, contrast, reversal, dread, or aftermath, but the scene should not feel flat. The final beat should land a pointed resolution, consequence, reveal, emotional shift, choice, or handoff.

Non-finale episode endings should open authored forward pressure into the next episode. Finale/resolution endings should resolve the main conflict and show aftermath rather than forcing a fake cliffhanger.
${this.episodeStructureMode === 'sceneEpisodes' ? 'SCENE-LENGTH MODE: The single scene is the whole runtime episode. Its final beat must land the supplied cliffhanger/forward-pressure contract, escalating season tension through action, drama, stakes, revelation, cost, or emotional pressure.' : ''}

## Conflict And Action Planning

If a scene includes conflict, fighting, weapons, pursuit, survival, or physical action, plan concrete jeopardy and consequence.

For fights or weapon use, keyBeats should include:
- specific maneuvers
- destructive impact
- wounds or visible damage
- tactical reversals
- environmental use
- what winning or losing costs

For non-physical conflict, damage may be emotional, social, relational, resource, reputation, information, or identity damage.

${CRAFT_PRESSURE_GUIDANCE}

${CORE_DRAMATIC_STRUCTURE_RULES}

## P1-P8 Blueprint Audit Requirements

Populate \`dramaticAudit\` at the episode level and \`dramaticStructure\`,
\`personalStake\`, \`stakesLayers\`, \`transitionOut\`, and \`residue\` on every scene.

- \`dramaticAudit.episodeQuestion\`: the episode-level dramatic question.
- \`dramaticAudit.episodeQuestionSetup\`: how the opening scene or opening beat poses/promises the episode question.
- \`dramaticAudit.episodeQuestionAnswer\`: how the climax, encounter, major choice, or final turn answers, complicates, or reframes the question.
- \`dramaticAudit.themeQuestion\`: the working season theme as a question, not a noun. Convert broad themes like "family" or "power" into a playable question.
- \`dramaticAudit.themePressure\`: how this episode tests the season theme as plot pressure.
- \`dramaticAudit.themeAngle\`: the specific angle this episode takes on the theme question. Avoid repeating the same angle as nearby episodes unless it escalates or reverses it.
- \`dramaticAudit.themeChoicePressure\`: how protagonist/player choices can answer, complicate, refuse, or distort the theme question.
- \`dramaticAudit.openingPromise\`: hook, episodePromise, activePressure, and optionalStakes. In \`sceneEpisodes\`, this is carried by the first beat or first 1-2 beats, not a separate cold-open scene.
- \`dramaticAudit.episodePressureLanes\`: A/B/C pressure architecture. A-plot is required external pressure; B-plot is protagonist-facing relationship/identity pressure; C-plot is a future seed.
- \`dramaticAudit.episodeEndStateDelta\`: what is different by episode end: identity, relationship, leverage, knowledge, danger, reputation, access, resource, future option, or emotional footing.
- \`dramaticAudit.nextEpisodePressure\`: non-finale forward pressure grown from consequence, choice residue, reveal, relationship rupture, new danger, promise, C-plot seed, or unresolved cost.
- \`dramaticAudit.personalStake\`: the concrete personal stake under the episode plot.
- \`dramaticAudit.stakesLayers\`: the episode stakes taxonomy. Fill material, relational, identity, and/or existential as applicable.
- \`dramaticAudit.majorTurns\`: 3-7 major episode turns; at least 60% should be driven or reshaped by protagonist/player action. Each turn should include turnType and should close, open, or memorably land pressure.
- \`dramaticAudit.informationPlan\`: major clues, secrets, threats, or open questions, who knows them, when the player learns them, and how they pay off.
- \`scene.dramaticStructure\`: question, turn, pressurePeak, changedState.
- Scene Turn Contract: every scene must show entry intent, active obstacle, forced decision, and exit shift through existing fields.
  - Entry intent: use \`dramaticQuestion\`, \`wantVsNeed\`, choice stakes, or \`sequenceIntent.objective\`.
  - Active obstacle: use \`conflictEngine\` or \`sequenceIntent.obstacle\`.
  - Forced decision: use a \`choicePoint\`, or make \`keyBeats\` / \`pressurePeak\` force commitment, refusal, revelation, sacrifice, tradeoff, or irreversible reaction.
  - Exit shift: use \`dramaticStructure.changedState\`, \`sequenceIntent.endState\`, \`residue\`, or \`transitionOut.pressureChange\`.
- Multi-character scenes must shift power at least once: leverage, trust, vulnerability, intimacy, distance, status, information, threat, debt, or public/private advantage changes hands.
- Removability test: every scene must change at least one narrative consequence category: information, relationship, identity, resource/access, danger, promise/setup/payoff, choice consequence, theme pressure, stakes, route state, or emotional footing.
- \`scene.personalStake\`: the concrete personal cost or value at risk in this scene.
- \`scene.themePressure\`: how this scene presses, complicates, sets up, or pays off the theme question. Rest/aftermath scenes may express this through consequence or residue.
- \`scene.stakesLayers\`: the scene stakes taxonomy. Major scenes and encounters need at least three layers.
- \`choicePoint.themeAnswer\`: how this choice lets the protagonist/player answer, complicate, refuse, or distort the theme question.
- \`choicePoint.stakesLayers\`: the stakes taxonomy behind the playable Stakes Triangle.
- \`scene.transitionOut\`: one entry for every \`leadsTo\` target. Use connector "therefore" or "but"; never use simple chronology.
- \`scene.residue\`: what remains changed after the scene. Reconverged paths must preserve residue.

Stakes layers and the Stakes Triangle work together:
- Stakes layers answer: what kind of loss is on the table?
- The Stakes Triangle answers: what does the player want, what does it cost, and what identity does it express?
- Existential stakes must be personally grounded. Do not write only "the world is at risk"; name the person, home, future, freedom, identity, or irreversible loss that makes it felt.
- Major scenes, encounters, dilemmas, climaxes, and \`sceneEpisodes\` must stack at least three stakes layers.
- Stakes must escalate gradually. Establish what the protagonist personally stands to lose before expanding to existential or world-scale stakes.
- Key beats should form a stakes ladder: each beat raises risk, reveals cost, narrows options, shifts leverage, or deepens consequence until the pressurePeak. Rest beats can raise dread, clarity, regret, or emotional cost.

Theme pressure rules:
- Use a question, not a noun: "What do you owe family when loyalty costs your selfhood?", not "family".
- Theme must be answerable by protagonist/player choices. Different branches may answer the same question differently; do not force one moral answer.
- Do not resolve the theme through external events alone.
- Do not state the theme question directly in dialogue. Characters can argue values, defend decisions, lie, plead, confess, or threaten, but they should not announce the thesis.

Scene Turn Contract:
- Every scene enters with intent, meets an obstacle, forces a decision, and exits on changed footing.
- "Decision" does not always mean visible player choice. In bottleneck, rest, or aftermath scenes it can be a commitment, refusal, revelation, sacrifice, tradeoff, or irreversible reaction.
- In multi-character scenes, make the power dynamic shift at least once. This may be dominance, leverage, trust, vulnerability, intimacy, distance, information, status, threat, debt, or public/private advantage.
- Every scene must pass the removability test: if removing it changes no later knowledge, relationship, consequence, choice pressure, state, setup/payoff, theme pressure, stakes, route state, or emotional footing, rewrite it.
- \`sceneEpisodes\` must satisfy this contract especially clearly because the one scene is also the whole runtime episode.

Episode Pressure Architecture:
- Do not use Story Circle and do not force 4-5 literal acts. Use episode turns instead.
- The opening promise should hook the player, state the episode's playable promise, and put active pressure onscreen. For \`sceneEpisodes\`, the first keyBeat must already contain pressure, desire, threat, question, choice, revelation, or relationship tension.
- A-plot is required: the external episode pressure that intersects the climax/encounter/major choice.
- B-plot is playable relationship or identity pressure. It can be a dedicated scene, a dedicated \`sceneEpisode\`, an underlay inside A-plot scenes, or offscreen NPC motivation that surfaces through protagonist-visible signals. B-plot scenes must still include the protagonist.
- C-plot is a future-pressure seed, not a required scene lane: callback, world-pressure hint, tonal counterweight, object/motif setup, or future reveal. Give it a visible plant and payoff plan; do not bloat the episode with filler.
- The protagonist remains the viewpoint. Do not create non-protagonist POV scenes or omniscient cutaways.

For \`sceneEpisodes\`, the single scene must satisfy both scene-level craft and
episode-level dramatic shape.

## Genre-Aware Jeopardy Policy
${buildGenreAwareJeopardyGuidance(input.genre)}

Apply the craft guidance through existing fields only: \`keyBeats\`, \`dramaticQuestion\`, \`conflictEngine\`,
\`sequenceIntent\`, \`encounterBeatPlan\`, \`encounterBuildup\`, \`encounterSetupContext\`, choice stakes, consequence domains, and cliffhanger planning. Do not invent
a new chapter-beat layer.
${STORY_ARCHITECT_BLUEPRINT_EXAMPLE}
${this.buildSeasonPlanDirectivesSection(input)}
${this.buildStructuralContextSection(input)}
${this.buildCliffhangerPlanSection(input)}

## Required JSON Structure

{
  "episodeId": "episode-1",
  "title": "Episode Title",
  "synopsis": "Brief episode summary",
  "dramaticAudit": {
    "episodeQuestion": "The episode-level dramatic question the player wants answered",
    "episodeQuestionSetup": "How the opening scene or first sceneEpisode beat poses/promises the episode question",
    "episodeQuestionAnswer": "How the climax, encounter, major choice, or final turn answers, complicates, or reframes the question",
    "themeQuestion": "The season theme as a playable question, not a noun",
    "themePressure": "How the episode tests the season theme through conflict, cost, choice, information, relationship, or identity",
    "themeAngle": "The distinct angle this episode takes on the theme question",
    "themeChoicePressure": "How protagonist/player choices answer, complicate, refuse, or distort the theme question",
    "openingPromise": {
      "hook": "Immediate hook for the first scene or first sceneEpisode beat",
      "episodePromise": "The kind of pressure/play this episode promises",
      "activePressure": "The pressure already active at the start",
      "optionalStakes": "Optional personal stakes established in the opening"
    },
    "episodePressureLanes": {
      "aPlot": {
        "externalPressure": "The objective, threat, mystery, mission, survival problem, or main encounter pressure",
        "climaxIntersection": "How the A-plot intersects the climax, encounter, or major choice"
      },
      "bPlot": {
        "mode": "scene|sceneEpisode|underlay|offscreen_pressure",
        "relationshipOrIdentityPressure": "The protagonist-facing relationship or identity pressure",
        "offscreenNpcMotivation": "Optional NPC motive/secret/fear happening offscreen",
        "protagonistVisibleSignals": ["What the protagonist can notice: behavior, clue, withholding, changed trust, rumor, delayed reveal"],
        "scenesOrEpisodes": ["scene-1"],
        "climaxIntersection": "How B pressure intersects or resonates with the A-plot at climax/major choice"
      },
      "cPlot": {
        "function": "future_seed|callback|world_pressure|tonal_counterweight",
        "seed": "The planted future pressure",
        "visiblePlant": "What the protagonist/player sees now",
        "payoffPlan": "How this can pay off later",
        "targetPayoff": "later_scene|later_episode|later_arc|season"
      }
    },
    "episodeEndStateDelta": "What is different by episode end",
    "nextEpisodePressure": "Forward pressure for non-finale episodes, or aftermath/legacy/future cost for finales",
    "personalStake": "The concrete personal stake underneath the plot stake",
    "stakesLayers": {
      "material": "What can be lost, gained, broken, spent, stolen, or blocked",
      "relational": "Who trusts, loves, fears, depends on, or rejects whom",
      "identity": "Who the protagonist becomes by acting this way",
      "existential": "What survival, freedom, future, home, meaning, or irreversible fate is threatened"
    },
    "majorTurns": [
      {
        "id": "turn-1",
        "description": "A major episode turn",
        "turnType": "reversal|revelation|escalation|choice|cost|payoff",
        "driver": "protagonist",
        "protagonistInfluence": "How the protagonist/player causes or meaningfully reshapes this turn",
        "closesQuestion": "What pressure/question this turn closes or alters",
        "opensQuestion": "What bigger/sharper pressure this turn opens",
        "memorableImageOrLine": "Memorable line, image, reveal, cost, or emotional beat"
      }
    ],
    "informationPlan": [
      {
        "item": "Major clue, secret, threat, or open question",
        "knownBy": ["player", "protagonist"],
        "revealTiming": "When the player/protagonist learns it",
        "payoff": "How this information changes a later choice, reveal, or consequence"
      }
    ]
  },
  "arc": {
    "hook": "Ordinary world + core value introduced (fill if this episode carries the 'hook' beat)",
    "plotTurn1": "Inciting incident / world-disruption (fill if this episode carries 'plotTurn1')",
    "pinch1": "First major setback against the antagonizing force (fill if this episode carries 'pinch1')",
    "midpoint": "Commitment / reversal / path-to-victory discovered (fill if this episode carries 'midpoint')",
    "pinch2": "Crisis + transformation culmination (fill if this episode carries 'pinch2')",
    "climax": "Decisive confrontation that fuses PT2 and the season Climax (fill if this episode carries 'climax')",
    "resolution": "Aftermath and legacy (fill if this episode carries 'resolution')"
  },
  "themes": ["theme1", "theme2"],
  "scenes": [
    {
      "id": "scene-1",
      "name": "Scene Name (Buildup)",
      "description": "What happens in this scene",
      "location": "location-1",
      "mood": "tense/calm/mysterious/etc",
      "purpose": "bottleneck",
      "npcsPresent": ["npc-id"],
      "narrativeFunction": "What this scene accomplishes",
      "dramaticQuestion": "What this scene is here to find out",
      "wantVsNeed": "Protagonist's conscious goal vs dramatic necessity",
      "conflictEngine": "What or who opposes the protagonist here",
      "dramaticStructure": {
        "question": "Scene-level question or pressure",
        "turn": "The reversal, discovery, cost, or recontextualization",
        "pressurePeak": "The highest-cost or lowest-point beat",
        "changedState": "What is different by the end"
      },
      "personalStake": "Specific person, bond, promise, identity, reputation, home, future, or irreversible cost at risk",
      "themePressure": "How this scene presses, complicates, sets up, or pays off the theme question",
      "stakesLayers": {
        "material": "What concrete resource, access, object, safety, or position can change",
        "relational": "Which bond, trust, dependency, loyalty, or rejection is at risk",
        "identity": "Who the protagonist becomes if they act or fail here"
      },
      "sequenceIntent": {
        "objective": "What this visual sequence is trying to accomplish",
        "activity": "The concrete visible activity carrying it",
        "obstacle": "What resists or complicates the objective",
        "startState": "Visible/emotional/mechanical state at the start",
        "turningPoint": "The moment the sequence bends",
        "endState": "What has changed by the end",
        "visualThread": "Recurring prop, distance, blocking, wound, clue, gesture, or motif",
        "mechanicThread": "Optional fiction-first hook such as trust, leverage, clue, danger, resource, identity, callback, or encounter clock"
      },
      "keyBeats": ["beat 1", "beat 2"],
      "leadsTo": ["scene-2"],
      "transitionOut": [
        {
          "toSceneId": "scene-2",
          "connector": "therefore",
          "causalLink": "Why scene-2 happens because of or in reaction to this scene",
          "pressureChange": "What pressure changes across the transition"
        }
      ],
      "residue": [
        {
          "type": "information",
          "description": "What remains changed after this scene"
        }
      ],
      "encounterBuildup": "Establishes the antagonist's power and the protagonist's vulnerability — makes the encounter's stakes personal",
      "choicePoint": {
        "type": "dilemma",
        "stakes": {"want": "goal", "cost": "sacrifice", "identity": "what it reveals"},
        "stakesLayers": {
          "relational": "The ally may stop trusting the protagonist",
          "identity": "The protagonist chooses what kind of person they are becoming"
        },
        "description": "The choice",
        "themeAnswer": "How the protagonist/player choice answers, complicates, refuses, or distorts the theme question",
        "optionHints": ["option 1", "option 2"],
        "consequenceDomain": "relationship",
        "reminderPlan": {
          "immediate": "The ally reacts with visible hurt",
          "shortTerm": "The next shared scene is colder",
          "later": "This choice is named during the encounter"
        },
        "expectedResidue": ["ally trust drops", "tone turns colder"],
        "competenceArc": {
          "testsNow": "Whether the player can keep the ally on-side under pressure",
          "shortfall": "They lack social leverage if trust is already weak",
          "growthPath": "A later prep scene could rebuild trust before the confrontation"
        },
        "failureBranchPurpose": "alliance"
      }
    },
    {
      "id": "scene-2",
      "name": "The Confrontation (ENCOUNTER — Episode Climax)",
      "description": "The protagonist faces the episode's central conflict head-on",
      "location": "location-2",
      "mood": "urgent",
      "purpose": "bottleneck",
      "npcsPresent": ["antagonist-id"],
      "narrativeFunction": "The climactic encounter the whole episode has been building to",
      "keyBeats": ["confrontation begins", "escalating pressure", "critical decision moment"],
      "leadsTo": ["scene-3"],
      "isEncounter": true,
      "plannedEncounterId": "enc-1-1",
      "encounterType": "social",
      "encounterDescription": "Protagonist must stand their ground against the antagonist's accusations/force using the relationships and information built in earlier scenes",
      "encounterStakes": "If the protagonist fails here, they lose both public credibility and a relationship they have been trying to preserve",
      "themePressure": "The confrontation forces the player to decide what truth costs when loyalty is public",
      "dramaticStructure": {
        "question": "Can the protagonist use the proof without losing the ally?",
        "turn": "The antagonist makes the accusation personal.",
        "pressurePeak": "The protagonist must spend trust to land truth.",
        "changedState": "The court knows the truth and the ally sees the cost."
      },
      "personalStake": "The protagonist may lose both public credibility and the ally's trust",
      "stakesLayers": {
        "material": "The court record and access can change",
        "relational": "The ally may stop trusting the protagonist",
        "identity": "The protagonist becomes someone willing to pay for truth"
      },
      "encounterRequiredNpcIds": ["antagonist-id", "ally-id"],
      "encounterRelevantSkills": ["persuasion", "empathy", "resolve"],
      "encounterBeatPlan": [
        "Opening accusation puts the protagonist on the back foot",
        "New evidence or emotional leverage escalates the confrontation",
        "A final all-in choice decides who gives ground and what it costs"
      ],
      "encounterDifficulty": "hard",
      "encounterBuildup": "Scene 1 established the antagonist's leverage and the protagonist's personal stake — players enter this encounter knowing exactly what they stand to lose",
      "encounterSetupContext": [
        "flag:defended_protagonist — unlocks a bold defiance choice inside the encounter",
        "relationship:antagonist-id.trust < -20 — antagonist's opening attack is more vicious",
        "relationship:ally-id.affection > 30 — ally speaks up at a critical moment"
      ]
    },
    {
      "id": "scene-3",
      "name": "Aftermath",
      "description": "Consequences of the encounter play out",
      "location": "location-1",
      "mood": "somber/triumphant/mixed",
      "purpose": "bottleneck",
      "npcsPresent": ["npc-id"],
      "narrativeFunction": "Resolution and setup for next episode",
      "dramaticStructure": {
        "question": "What remains after the confrontation?",
        "turn": "The saved proof leaves a new relational debt.",
        "pressurePeak": "The ally names the cost without forgiving it yet.",
        "changedState": "The protagonist carries truth forward with damaged trust."
      },
      "personalStake": "The protagonist's future with the ally remains uncertain",
      "themePressure": "The aftermath shows the cost of choosing truth over comfort",
      "stakesLayers": {
        "material": "The case outcome changes what resources remain available",
        "relational": "The ally's trust remains wounded",
        "identity": "The protagonist must live with the kind of truth-teller they became"
      },
      "keyBeats": ["immediate consequence", "new reality", "what's changed"],
      "leadsTo": []
    }
  ],
  "startingSceneId": "scene-1",
  "bottleneckScenes": ["scene-1", "scene-3"],
  "suggestedFlags": [{"name": "flag_name", "description": "what it tracks"}],
  "suggestedScores": [{"name": "score_name", "description": "what it measures"}],
  "suggestedTags": [{"name": "tag_name", "description": "identity marker"}],
  "narrativePromises": [{"description": "setup", "setupScene": "scene-1", "importance": "major"}]
}

CRITICAL REQUIREMENTS:
1. The "scenes" array must contain 3-${input.targetSceneCount} scenes
2. Each scene MUST have: id, name, description, location, mood, purpose, npcsPresent, narrativeFunction, keyBeats, leadsTo
2a. Each newly generated multi-beat scene SHOULD include sequenceIntent with a visible activity, visualThread, turningPoint, and endState. Missing sequenceIntent is tolerated for compatibility/fallbacks, but lowers storyboard QA quality.
3. purpose MUST be one of: "bottleneck", "branch", "transition"
4. startingSceneId MUST match one of the scene ids
5. Return ONLY valid JSON, no markdown, no extra text
5a. Include \`dramaticAudit\` with episodeQuestion, episodeQuestionSetup, episodeQuestionAnswer, openingPromise, episodePressureLanes, episodeEndStateDelta, nextEpisodePressure, themeQuestion, themePressure, themeAngle, themeChoicePressure, personalStake, stakesLayers, majorTurns, and informationPlan.
5b. Every scene must include \`dramaticStructure\`, \`personalStake\`, \`themePressure\`, \`stakesLayers\`, \`transitionOut\`, and \`residue\`.
5c. Every \`leadsTo\` target must have a matching \`transitionOut.toSceneId\` whose connector is "therefore" or "but".
5d. Major scenes, encounters, dilemmas, climaxes, and sceneEpisodes must include at least three stakes layers. Dilemmas and climaxes must include relational or identity stakes. Existential stakes must be personally grounded and earned.
5e. Major choicePoints must include \`themeAnswer\`; the theme must be answerable by protagonist/player choice, not by external rescue or coincidence.
5f. Every scene must satisfy the Scene Turn Contract through existing fields: entry intent, active obstacle, forced decision, and exit shift. Multi-character scenes must shift power at least once, and every scene must pass the removability test.
5g. Episode pressure lanes must be protagonist-facing. B-plots may be scenes or sceneEpisodes only when the protagonist directly experiences the relationship/identity pressure. C-plots are future seeds with visible plants and payoff plans, not filler scenes.

CHOICE PAYOFF REQUIREMENTS:
- For every scene that can be reached by a player choice (i.e., it appears in another scene's leadsTo because of a choicePoint), include "incomingChoiceContext" — a string describing what player choice leads to this scene and what it means dramatically.
- Example: "Player chose to defy the authority figure, asserting independence at the cost of safety"
- This context ensures the scene writer and route-bridge system can pay off the choice in text AND visuals.
- Bottleneck and transition scenes still need incomingChoiceContext when a choice can route into them.
- Starting scenes do NOT need incomingChoiceContext.

ENCOUNTER REQUIREMENTS:
- At least ${this.getMinEncounters(input.targetSceneCount)} scene(s) MUST be an encounter (isEncounter: true)
- The encounter MUST manifest the episode's central conflict / pressure event. It is where the episode's relationships, information, risks, prior choices, player capabilities, and current stakes are tested through play.
- Encounter scenes MUST have: isEncounter, plannedEncounterId (when pre-planned encounters exist), encounterType, encounterDescription, encounterStakes, encounterRequiredNpcIds, encounterRelevantSkills, encounterBeatPlan, encounterDifficulty, encounterBuildup
- encounterType MUST be one of: "combat", "chase", "stealth", "social", "romantic", "dramatic", "puzzle", "exploration", "investigation", "negotiation", "survival", "heist", "mixed"
- encounterStyle MUST reflect the dramatic mode of the encounter even when the structural type is broad
- encounterDifficulty MUST be one of: "easy", "moderate", "hard", "extreme"
- encounterStakes must describe the PERSONAL stakes, not just tactical stakes
- encounterRequiredNpcIds must include every character who the encounter actually tests against
- encounterRelevantSkills must contain 2-5 skills or approaches the EncounterArchitect can build choices around
- encounterBeatPlan must contain at least 3 ordered beat intents that describe the encounter arc
- encounterBuildup on the encounter scene: describe the FULL STAKES and what the prior scenes establish to make this encounter land
- encounterBuildup on NON-encounter scenes: describe what THIS scene specifically contributes to making the encounter's choices feel earned
- encounterSetupContext on the encounter scene: list every flag and relationship threshold from prior scenes that should echo inside the encounter (format: "flag:<name> — <effect>" or "relationship:<id>.<dim> <op> <n> — <effect>")
- Encounter scenes should be bottlenecks and should NOT have a regular choicePoint (they have skill-based choices instead)
- The encounter should be the episode's dramatic climax — roughly scene 3 of 5, or scene 4 of 6

CLIFFHANGER REQUIREMENTS:
- The final scene should usually be an aftermath / consequence scene, not the encounter itself.
- The final scene must acknowledge what happened in the episode's central conflict before opening the next pressure.
- If a Cliffhanger Plan is supplied, the final scene's narrativeFunction and keyBeats MUST explicitly support it.
- For high-intensity cliffhangers, make the final keyBeat a concrete shock, emotional rupture, betrayal, reframe, arrival, loss, or decision — not vague unease.
- Do not fake unresolved tension by simply stopping mid-action; make the hook earned by prior setup.

CHOICE DENSITY REQUIREMENTS (CRITICAL - Interactive fiction requires player choices):
6. At least 40% of scenes MUST have a choicePoint defined (branching, dilemma, or flavor)
7. For Episode 1, the FIRST scene MUST have a choicePoint. For later episodes, players need agency early: either the first scene has a choicePoint, OR the first scene is very brief (< 200 words) and the SECOND scene has one
8. NEVER have more than 2 scenes in a row without a choicePoint
9. Every choicePoint must have type, stakes, and description
10. Major branching/dilemma choices MUST have complete stakes (want, cost, identity)
11. BOTTLENECK scenes CAN have flavor choices - players still get agency in HOW they react even if the story beat is fixed
12. Major choicePoints should include consequenceDomain and reminderPlan so later agents know how to preserve residue
13. Use competenceArc and failureBranchPurpose when a future confrontation should open recovery, training, leverage, alliance, investigation, or regrouping paths
14. At least ${this.sceneGraphBranching?.minPerEpisode ?? 1} non-expression choicePoint MUST set branches=true and offer at least two distinct leadsTo targets, unless the user's prompt explicitly asks for a linear episode.

SCENE LINKING & CONTINUITY (CRITICAL):
12. Every scene (except the final scene) MUST have at least one valid ID in the "leadsTo" array.
13. Scene IDs in "leadsTo" MUST exist in your "scenes" array.
14. Ensure the logical flow makes sense - don't just link sequentially if the narrative suggests a different path.
15. NO DEAD ENDS: Every possible path through the episode must reach either a resolution scene or lead to "episode-end".
16. ENCOUNTERS: Encounters are bottlenecks. They should always lead to a resolution or transition scene after they are completed.
17. Naming: Use consistent IDs like scene-1, scene-2, scene-3a, scene-3b, etc.

If you don't include enough choice points, the story will be rejected as non-interactive.
`;
  }

  /**
   * Surface the season-level anchors, the full 7-point map, and the beats
   * this episode is responsible for landing. The 7-point / anchor data
   * drives the `arc.*` fields and the dramatic function of every scene.
   */
  private buildStructuralContextSection(input: StoryArchitectInput): string {
    const { seasonAnchors, seasonSevenPoint, episodeStructuralRole } = input;
    if (!seasonAnchors && !seasonSevenPoint && (!episodeStructuralRole || episodeStructuralRole.length === 0)) {
      return '';
    }

    const anchorLines = seasonAnchors
      ? [
          `- Stakes: ${seasonAnchors.stakes}`,
          `- Goal: ${seasonAnchors.goal}`,
          `- Inciting Incident: ${seasonAnchors.incitingIncident}`,
          `- Climax: ${seasonAnchors.climax}`,
        ].join('\n')
      : '';

    const beatLines = seasonSevenPoint
      ? SEVEN_POINT_BEATS.map((beat) => `- ${beat}: ${seasonSevenPoint[beat]}`).join('\n')
      : '';

    const roleLine = episodeStructuralRole && episodeStructuralRole.length > 0
      ? episodeStructuralRole.join(', ')
      : '(not assigned — treat as a rising / falling buffer episode)';

    return `
## Season Anchors (shared reference — every beat must serve these)
${anchorLines || '(none supplied)'}

## Season 7-Point Beat Map
${beatLines || '(none supplied)'}

## This Episode's Structural Role
${roleLine}

Populate \`arc.<beat>\` ONLY for beats listed in this episode's structural role.
Leave the other \`arc.*\` fields as empty strings — the season sevenPoint above
already carries them at other episodes. The \`arc.climax\` field MUST, when
filled, reference or rephrase the season Climax anchor above so the season
reads as a single story.
`;
  }

  private buildCliffhangerPlanSection(input: StoryArchitectInput): string {
    const plan = input.cliffhangerPlan;
    if (!plan) return '';

    return `
## Seven-Point Cliffhanger Plan (final scene contract)
- Style: ${plan.style}
- Structural role: ${plan.mappedStructuralRole}
- Type: ${plan.type}
- Intensity: ${plan.intensity}
- Hook to deliver: ${plan.hook}
- Setup that must make it earned: ${plan.setup}
- Immediate episode tension to acknowledge/resolve: ${plan.resolvedEpisodeTension}
- New open question: ${plan.newOpenQuestion}
- Emotional charge: ${plan.emotionalCharge}
- Next-episode pressure: ${plan.nextEpisodePressure}

Design the final scene as "aftermath plus hook": show the consequence of this episode's encounter/choice, then end on the new question or pressure above.
`;
  }

  private buildSeasonPlanDirectivesSection(input: StoryArchitectInput): string {
    const directives = input.seasonPlanDirectives;
    if (!directives) return '';

    let section = '\n## SEASON PLAN DIRECTIVES (Master Blueprint)\n';
    section += 'The following directives come from the season-level master plan. Follow them precisely.\n\n';

    if (directives.difficultyTier) {
      section += `**Difficulty Tier**: ${directives.difficultyTier} — calibrate encounters and tension accordingly.\n\n`;
    }

    if (directives.arcPressure) {
      const arc = directives.arcPressure;
      section += '### Arc Pressure Architecture\n';
      section += 'The season 7-point spine remains authoritative. This arc is a 3-8 episode pressure movement inside that spine; do not create literal act structure or non-protagonist POV scenes.\n\n';
      section += `- Arc: ${arc.arcName} (${arc.arcId})\n`;
      if (arc.arcQuestion) {
        section += `- Arc question: ${arc.arcQuestion}\n`;
      }
      if (arc.seasonQuestionRelation) {
        section += `- Relation to season question/stakes: ${arc.seasonQuestionRelation}\n`;
      }
      if (arc.identityPressureFacet) {
        section += `- Identity pressure facet: ${arc.identityPressureFacet}\n`;
      }
      if (arc.episodeTurnout) {
        section += `- This episode's arc turn-out (${arc.episodeTurnout.turnType}): ${arc.episodeTurnout.description}\n`;
        section += `  Leaves protagonist with: ${arc.episodeTurnout.leavesProtagonistWith}\n`;
        section += `  Why this cannot move later: ${arc.episodeTurnout.whyThisCannotMoveLater}\n`;
      }
      if (arc.midpointRecontextualization) {
        section += `- Arc midpoint recontextualization, Episode ${arc.midpointRecontextualization.episodeNumber}: ${arc.midpointRecontextualization.description}\n`;
        section += `  Before: ${arc.midpointRecontextualization.questionBefore}\n`;
        section += `  After: ${arc.midpointRecontextualization.questionAfter}\n`;
      }
      if (arc.lateArcCrisis) {
        section += `- Late arc crisis, Episode ${arc.lateArcCrisis.episodeNumber}: ${arc.lateArcCrisis.description}\n`;
        section += `  Apparent failure: ${arc.lateArcCrisis.apparentFailure}\n`;
        section += `  Irreversible cost: ${arc.lateArcCrisis.irreversibleCost}\n`;
      }
      if (arc.finaleAnswer) {
        section += `- Arc finale answer: ${arc.finaleAnswer}\n`;
      }
      if (arc.handoffPressure) {
        section += `- Handoff pressure: ${arc.handoffPressure}\n`;
      }
      section += 'Use this episode to land its arc turn-out through consequence, reversal, discovery, cost, escalation, choice residue, crisis, finale, or handoff. If episodeStructureMode is sceneEpisodes, this single-scene episode carries only its assigned arc turn-out, not the whole arc.\n\n';
    }

    if (directives.characterArchitecture) {
      const architecture = directives.characterArchitecture;
      const protagonist = architecture.protagonist;
      section += '### Character Architecture Pressure\n';
      section += 'Use this as agent-facing psychology only; do not expose Lie/Wound/Truth labels to the player. Express the pressure through wants, choices, costs, relationship behavior, subtext, and consequences.\n\n';
      section += `- Protagonist Lie/protective belief: ${protagonist.lie}\n`;
      section += `- Origin pressure: ${protagonist.originPressure}\n`;
      section += `- Truth/counter-belief: ${protagonist.truth}\n`;
      section += `- Want: ${protagonist.want}\n`;
      section += `- Need: ${protagonist.need}\n`;
      section += `- Arc mode: ${protagonist.arcMode}\n`;
      section += `- Climax choice: ${protagonist.climaxChoice.choiceQuestion}\n`;
      section += `  Truth option: ${protagonist.climaxChoice.integrateTruthOption}\n`;
      section += `  Lie option: ${protagonist.climaxChoice.recommitLieOption}\n`;
      section += `  Active mechanism: ${protagonist.climaxChoice.activeChoiceMechanism}\n`;
      const supporting = architecture.supportingCharacters.filter((character) => character.screenTimeTier !== 'minor');
      if (supporting.length > 0) {
        section += 'Supporting micro-Lies to use only where protagonist-visible:\n';
        for (const character of supporting.slice(0, 5)) {
          section += `- ${character.characterName} (${character.pressureRole}): ${character.microLie} / ${character.truthOrCounterPressure}\n`;
          if (character.protagonistVisibleSignals.length > 0) {
            section += `  Visible signals: ${character.protagonistVisibleSignals.join(' | ')}\n`;
          }
        }
      }
      section += 'Episode scenes should pressure one clean slice of the Lie/Truth gap. In sceneEpisodes mode, the single sceneEpisode should expose, reward, punish, tempt, reframe, or force a choice around one aspect of this gap.\n\n';
    }

    if (directives.seasonPromiseArchitecture) {
      const promise = directives.seasonPromiseArchitecture;
      section += '### Season Promise Architecture\n';
      section += 'Follow this contract without adding fixed TV tent-poles, mandatory re-pilots, or penultimate-climax rules. The seven-point spine remains authoritative.\n\n';
      section += `- Season dramatic question: ${promise.seasonDramaticQuestion}\n`;
      section += `- Central pressure (${promise.centralPressure.type}): ${promise.centralPressure.description}\n`;
      section += `  Pressures the protagonist by: ${promise.centralPressure.pressuresLieBy}\n`;
      section += `- Premise promise: ${promise.seasonPromise.premisePromise}\n`;
      section += `- Player experience promise: ${promise.seasonPromise.playerExperiencePromise}\n`;
      section += `- Emotional promise: ${promise.seasonPromise.emotionalPromise}\n`;
      if (promise.seasonPromise.variationPlan.length > 0) {
        section += 'Fresh promise variations to echo across scenes/choices:\n';
        for (const variation of promise.seasonPromise.variationPlan.slice(0, 5)) {
          section += `- ${variation}\n`;
        }
      }
      section += `- Season completeness target: ${promise.seasonCompleteness.resolvedQuestion}\n`;
      section += `  Stakes resolved/changed: ${promise.seasonCompleteness.resolvedStakes}\n`;
      section += `  Character state change: ${promise.seasonCompleteness.characterStateChange}\n`;
      if (promise.seasonCompleteness.openFuturePressure) {
        section += `  Earned future pressure: ${promise.seasonCompleteness.openFuturePressure}\n`;
      }
      section += 'This episode should either establish, vary, complicate, pay off, or hand forward the season promise. In sceneEpisodes mode, do that through one focused scene-length turn.\n\n';
    }

    if (directives.informationLedgerEntries && directives.informationLedgerEntries.length > 0) {
      section += '### Information Ledger Entries For This Episode\n';
      section += 'Use these to control who knows what and when. Do not reveal withheld information early. Prefer suspense/dramatic irony when the player can know the threat without breaking protagonist POV.\n\n';
      for (const entry of directives.informationLedgerEntries) {
        section += `- ${entry.id} / ${entry.label} (${entry.tensionMode}, ${entry.audienceKnowledgeState})\n`;
        section += `  Description: ${entry.description}\n`;
        section += `  Known by: ${entry.knownBy.join(', ')}\n`;
        if (entry.withheldFrom?.length) {
          section += `  Withheld from: ${entry.withheldFrom.join(', ')}\n`;
        }
        section += `  Introduced: Episode ${entry.introducedEpisode}`;
        if (entry.plannedRevealEpisode) section += ` | Reveal: Episode ${entry.plannedRevealEpisode}`;
        if (entry.plannedPayoffEpisode) section += ` | Payoff: Episode ${entry.plannedPayoffEpisode}`;
        section += '\n';
        if (entry.setupTouchEpisodes.length > 0) {
          section += `  Setup touches: ${entry.setupTouchEpisodes.join(', ')}\n`;
        }
        section += `  Payoff plan: ${entry.payoffPlan}\n`;
      }
      section += 'For sceneEpisodes, this one scene-length episode should perform one clean information job: plant, touch, reveal, pay off, close, or sharpen one question.\n\n';
    }

    if (directives.endingMode) {
      section += `**Ending Mode**: ${directives.endingMode}\n`;
      if (directives.resolvedEndings && directives.resolvedEndings.length > 0) {
        section += '### Active Ending Targets\n';
        section += 'Use these endgame routes to shape branch pressure and climax meaning:\n\n';
        for (const ending of directives.resolvedEndings) {
          section += `- **${ending.id} / ${ending.name}**: ${ending.summary}\n`;
          section += `  Theme payoff: ${ending.themePayoff}\n`;
          section += `  Emotional register: ${ending.emotionalRegister}\n`;
          if (ending.stateDrivers.length > 0) {
            section += `  State drivers: ${ending.stateDrivers.map((driver) => `${driver.type}: ${driver.label}`).join('; ')}\n`;
          }
          if (ending.targetConditions.length > 0) {
            section += `  Target conditions: ${ending.targetConditions.join(' | ')}\n`;
          }
        }
        section += '\n';
      }
      if (directives.endingRoutes && directives.endingRoutes.length > 0) {
        section += '### Episode Ending Route Pressure\n';
        section += 'These route beats should be visible in the scenes you design:\n\n';
        for (const route of directives.endingRoutes) {
          section += `- **${route.endingId}** (${route.role}): ${route.description}\n`;
        }
        section += '\n';
      }
    }

    if (directives.treatmentGuidance) {
      const guidance = directives.treatmentGuidance;
      section += '### Authored Treatment Guidance\n';
      section += 'These details came from the user-authored treatment. Preserve them as binding episode intent, not optional flavor. Do not compress away authored setup/opening beats when they are needed to earn the listed choices, consequences, or cliffhanger.\n\n';
      if (guidance.episodePromise) {
        section += `- Episode promise: ${guidance.episodePromise}\n`;
      }
      if (guidance.dramaticQuestion) {
        section += `- Dramatic question: ${guidance.dramaticQuestion}\n`;
      }
      if (guidance.coldOpenFunction) {
        section += `- Cold open / hook function: ${guidance.coldOpenFunction}\n`;
      }
      if (guidance.openingImage) {
        section += `- Opening image: ${guidance.openingImage}\n`;
      }
      if (guidance.toneRegister) {
        section += `- Tone register: ${guidance.toneRegister}\n`;
      }
      if (guidance.actLabel) {
        section += `- Act: ${guidance.actLabel}\n`;
      }
      if (guidance.arcLabel) {
        section += `- Arc: ${guidance.arcLabel}\n`;
      }
      if (guidance.rawStructuralRole) {
        section += `- Structural role: ${guidance.rawStructuralRole}\n`;
      }
      if (guidance.synopsis) {
        section += `- Authored synopsis: ${guidance.synopsis}\n`;
      }
      if (guidance.openingSituation) {
        section += `- Opening situation: ${guidance.openingSituation}\n`;
      }
      if (guidance.episodeTurns?.length) {
        section += 'Episode turns that should shape scene purposes, keyBeats, sequenceIntent, encounter buildup, choices, and aftermath. Do not create a new schema layer; express these through existing blueprint fields:\n';
        for (const turn of guidance.episodeTurns) {
          section += `- ${turn}\n`;
        }
      }
      if (guidance.entryGoal || guidance.obstacle || guidance.forcedChoice || guidance.exitShift) {
        section += 'Scene/sceneEpisode contract that must be expressed through generated scenes:\n';
        if (guidance.entryGoal) section += `- Entry goal: ${guidance.entryGoal}\n`;
        if (guidance.obstacle) section += `- Obstacle: ${guidance.obstacle}\n`;
        if (guidance.forcedChoice) section += `- Forced choice: ${guidance.forcedChoice}\n`;
        if (guidance.exitShift) section += `- Exit shift: ${guidance.exitShift}\n`;
      }
      if (guidance.powerShift || guidance.subtextGap) {
        section += 'Authored scene craft pressure:\n';
        if (guidance.powerShift) section += `- Power shift: ${guidance.powerShift}\n`;
        if (guidance.subtextGap) section += `- Subtext gap: ${guidance.subtextGap}\n`;
      }
      if (guidance.aPressure || guidance.bPressure || guidance.cSeed) {
        section += 'Authored A/B/C pressure lanes:\n';
        if (guidance.aPressure) section += `- A pressure: ${guidance.aPressure}\n`;
        if (guidance.bPressure) section += `- B pressure: ${guidance.bPressure}\n`;
        if (guidance.cSeed) section += `- C seed: ${guidance.cSeed}\n`;
      }
      if (guidance.stakesLayers?.length) {
        section += 'Authored stakes layers to stack visibly in the major scene/encounter:\n';
        for (const layer of guidance.stakesLayers) {
          section += `- ${layer}\n`;
        }
      }
      if (guidance.themePressure) {
        section += `- Theme pressure: ${guidance.themePressure}\n`;
      }
      if (guidance.liePressure) {
        section += `- Lie pressure: ${guidance.liePressure}\n`;
      }
      if (guidance.informationMovement) {
        section += `- Information movement: ${guidance.informationMovement}\n`;
      }
      if (guidance.encounterAnchors?.length) {
        section += `- Encounter anchors: ${guidance.encounterAnchors.join(' | ')}\n`;
      }
      if (guidance.encounterCentralConflict) {
        section += `- Encounter central conflict: ${guidance.encounterCentralConflict}\n`;
      }
      if (guidance.encounterBuildup) {
        section += `- Encounter buildup: ${guidance.encounterBuildup}\n`;
      }
      if (guidance.encounterAftermath) {
        section += `- Encounter aftermath/consequence: ${guidance.encounterAftermath}\n`;
      }
      if (guidance.majorChoicePressures?.length) {
        section += 'Major authored choice pressures that MUST become real choicePoint scenes when treatment-driven:\n';
        for (const pressure of guidance.majorChoicePressures) {
          section += `- ${pressure}\n`;
        }
      }
      if (guidance.alternativePaths?.length) {
        section += 'Authored alternative paths and reconvergence/residue notes:\n';
        for (const path of guidance.alternativePaths) {
          section += `- ${path}\n`;
        }
      }
      if (guidance.consequenceSeeds?.length) {
        section += 'Consequence seeds that should become flags, callbacks, scene tints, or later route pressure:\n';
        for (const seed of guidance.consequenceSeeds) {
          section += `- ${seed}\n`;
        }
      }
      if (guidance.consequenceResidue) {
        section += `- Consequence residue: ${guidance.consequenceResidue}\n`;
      }
      if (guidance.visualAnchor) {
        section += `- Visual anchor: ${guidance.visualAnchor}\n`;
      }
      if (guidance.endStateChange) {
        section += `- End-state change / removability proof: ${guidance.endStateChange}\n`;
      }
      if (guidance.nextEpisodeCausality) {
        section += `- Why the next unit exists because of this one: ${guidance.nextEpisodeCausality}\n`;
      }
      if (guidance.resolvedEpisodeTension) {
        section += `- Resolved episode tension: ${guidance.resolvedEpisodeTension}\n`;
      }
      if (guidance.cliffhangerHook) {
        section += `- Cliffhanger hook to deliver: ${guidance.cliffhangerHook}\n`;
      }
      if (guidance.cliffhangerQuestion) {
        section += `- Cliffhanger question that should become next episode pressure: ${guidance.cliffhangerQuestion}\n`;
      }
      if (guidance.nextEpisodePressure) {
        section += `- Next-episode pressure: ${guidance.nextEpisodePressure}\n`;
      }
      if (guidance.cliffhangerSetup) {
        section += `- Cliffhanger setup that earns the ending: ${guidance.cliffhangerSetup}\n`;
      }
      if (guidance.emotionalCharge) {
        section += `- Cliffhanger emotional charge: ${guidance.emotionalCharge}\n`;
      }
      if (guidance.endingPressure || guidance.authoredCliffhanger || guidance.endingTurnout) {
        section += `- Authored ending pressure (MUST be supported by the final scene narrativeFunction/keyBeats unless this is a finale): ${guidance.endingPressure || guidance.authoredCliffhanger || guidance.endingTurnout}\n`;
      }
      if (guidance.resolutionAftermath) {
        section += `- Finale resolution/aftermath: ${guidance.resolutionAftermath}\n`;
      }
      if (guidance.capabilityGrowthGuidance?.length) {
        section += 'Capability/growth/fail-forward guidance to express through existing skills, attributes, relationships, flags, consequences, and encounter outcomes:\n';
        for (const growth of guidance.capabilityGrowthGuidance) {
          section += `- ${growth}\n`;
        }
      }
      section += '\nMechanical intent: for important scenes, plan which skills are tested, where passive insights can reveal usable fiction, which prior flags/items/relationships become prepared advantages, what failure recovery route exists, and what branch residue survives reconvergence. Express these through existing scene blueprint fields, choice setup context, encounterSetupContext, consequence seeds, and keyBeats; do not invent a separate runtime schema.\n';
      section += '\nCRITICAL: At least one authored major choice pressure must appear as a concrete scene choicePoint unless the episode is structurally impossible without breaking the treatment. Alternative paths must leave visible residue after reconvergence. If you change scene order for pacing, keep the authored setup/choice/consequence/cliffhanger chain legible.\n\n';
    }

    if (directives.plannedEncounters && directives.plannedEncounters.length > 0) {
      section += '### Pre-Planned Encounters\n';
      section += 'These encounters MUST be included as encounter scenes in the blueprint. Copy each encounter ID into the scene field `plannedEncounterId` exactly so downstream generation can bind the scene to the season plan.\n\n';
      for (const enc of directives.plannedEncounters) {
        section += `- **${enc.id}** (${enc.type}, ${enc.difficulty}): ${enc.description}\n`;
        section += `  Stakes: ${enc.stakes}\n`;
        if (enc.centralConflict) {
          section += `  Central conflict to manifest through play: ${enc.centralConflict}\n`;
        }
        if (enc.aftermathConsequence) {
          section += `  Aftermath/consequence to pay off after the encounter: ${enc.aftermathConsequence}\n`;
        }
        if (enc.npcsInvolved.length > 0) {
          section += `  NPCs: ${enc.npcsInvolved.join(', ')}\n`;
        }
        if (enc.relevantSkills.length > 0) {
          section += `  Skills: ${enc.relevantSkills.join(', ')}\n`;
        }
        if (enc.encounterBuildup) {
          section += `  Buildup: ${enc.encounterBuildup}\n`;
        }
        if (enc.encounterSetupContext && enc.encounterSetupContext.length > 0) {
          section += `  Setup payoff context:\n`;
          for (const payoff of enc.encounterSetupContext) {
            section += `    - ${payoff}\n`;
          }
        }
        if (enc.isBranchPoint && enc.branchOutcomes) {
          section += `  BRANCH POINT — Victory: ${enc.branchOutcomes.victory} | Defeat: ${enc.branchOutcomes.defeat}${enc.branchOutcomes.escape ? ` | Escape: ${enc.branchOutcomes.escape}` : ''}\n`;
        }
        section += '\n';
      }
    }

    if (directives.incomingBranchEffects && directives.incomingBranchEffects.length > 0) {
      section += '### Cross-Episode Branch Effects\n';
      section += 'Previous player choices affect this episode. Incorporate these variations:\n\n';
      for (const effect of directives.incomingBranchEffects) {
        section += `- **${effect.branchName}** → ${effect.pathName} (${effect.impact}): ${effect.description}\n`;
      }
      section += '\n';
    }

    if (directives.flagsToCheck && directives.flagsToCheck.length > 0) {
      section += '### Flags to Check\n';
      section += 'The episode should reference these flags from earlier episodes:\n\n';
      for (const flag of directives.flagsToCheck) {
        section += `- **${flag.flag}**: If set → ${flag.ifTrue} | If not set → ${flag.ifFalse}\n`;
      }
      section += '\n';
    }

    if (directives.flagsToSet && directives.flagsToSet.length > 0) {
      section += '### Flags to Set\n';
      section += 'This episode should establish these flags for future episodes:\n\n';
      for (const flag of directives.flagsToSet) {
        section += `- **${flag.flag}**: ${flag.description}\n`;
      }
      if (this.episodeStructureMode === 'sceneEpisodes') {
        section += 'Scene-length branch origins must turn route flags into choice consequences: exactly one sibling route flag should be set by the player choice, and main route branching should happen through route-gated future episodes rather than nextSceneId scene routing.\n';
      }
      section += '\n';
    }

    if (directives.consequenceEffects && directives.consequenceEffects.length > 0) {
      section += '### Consequence Chain Effects\n';
      section += 'Previous choices ripple into this episode:\n\n';
      for (const effect of directives.consequenceEffects) {
        section += `- (${effect.severity}): ${effect.description}\n`;
      }
      section += '\n';
    }

    if (directives.growthContext) {
      const gc = directives.growthContext;
      section += '### GROWTH PLAN FOR THIS EPISODE\n';
      section += `Focus skills: ${gc.focusSkills.join(', ')}\n`;
      section += `Development scene concept: ${gc.developmentScene}\n`;
      if (gc.mentorshipOpportunity) {
        const m = gc.mentorshipOpportunity;
        section += `Mentorship: ${m.npcName} can teach ${m.attribute} if ${m.requiredRelationship.dimension} >= ${m.requiredRelationship.threshold}\n`;
        section += `Narrative hook: ${m.narrativeHook}\n`;
      } else {
        section += 'No mentorship opportunity this episode.\n';
      }
      section += '\n';
      section += 'Include 1-2 DEVELOPMENT SCENES (purpose: transition, choicePoint.type: strategic,\n';
      section += 'choicePoint.consequenceDomain: resource) with competenceArc filled to link growth\n';
      section += 'to upcoming challenges. Place development scenes BEFORE hard checks when the story calls for preparation.\n\n';
      section += 'Capability comes from story progression AND existing mechanics: skills, attributes,\n';
      section += 'relationships, flags, identity, prior choices, consequences, and encounter outcomes.\n';
      section += 'If a player falls short, plan a fiction-first fail-forward path: preparation,\n';
      section += 'training, mentorship, recovery, alliance, investigation, alternate leverage,\n';
      section += 'or a harder re-approach that reconverges. Do not frame this as grinding,\n';
      section += 'stat math, or a mechanical chore in player-facing prose.\n\n';
      if (gc.mentorshipOpportunity) {
        section += 'Include a MENTORSHIP SCENE where the NPC offers training gated by relationship.\n';
        section += 'Always provide a non-gated alternative so the scene works for all players.\n\n';
      }
    }

    return section;
  }

  /**
   * Collect structural issues without throwing, for use in the Karpathy retry loop.
   * Returns an array of issue descriptions; empty = no issues.
   */
  private collectStructuralIssues(blueprint: EpisodeBlueprint, input: StoryArchitectInput): string[] {
    const issues: string[] = [];
    const sceneIds = new Set(blueprint.scenes.map(s => s.id));

    // Graph connectivity: check for orphaned or dangling references
    for (const scene of blueprint.scenes) {
      for (const targetId of scene.leadsTo) {
        if (!sceneIds.has(targetId)) {
          issues.push(`Scene "${scene.id}" references non-existent scene "${targetId}" in leadsTo`);
        }
      }
    }

    // Check reachability from starting scene
    if (blueprint.startingSceneId && sceneIds.has(blueprint.startingSceneId)) {
      const reachable = new Set<string>();
      const queue = [blueprint.startingSceneId];
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (reachable.has(current)) continue;
        reachable.add(current);
        const scene = blueprint.scenes.find(s => s.id === current);
        if (scene) {
          for (const next of scene.leadsTo) {
            if (!reachable.has(next)) queue.push(next);
          }
        }
      }
      const unreachable = blueprint.scenes.filter(s => !reachable.has(s.id));
      if (unreachable.length > 0) {
        issues.push(`${unreachable.length} scene(s) unreachable from starting scene: ${unreachable.map(s => s.id).join(', ')}`);
      }
    }

    // Branching factor: scenes with many outgoing edges may be poorly designed
    for (const scene of blueprint.scenes) {
      if (scene.leadsTo.length > 4) {
        issues.push(`Scene "${scene.id}" has ${scene.leadsTo.length} outgoing paths (max recommended: 4)`);
      }
    }

    if (this.sceneGraphBranching.required && !this.sceneGraphBranching.allowLinearBottleneckEpisodes && this.episodeStructureMode !== 'sceneEpisodes') {
      const branchPointCount = blueprint.scenes.filter(scene =>
        scene.choicePoint?.branches &&
        scene.choicePoint.type !== 'expression' &&
        new Set(scene.leadsTo || []).size >= 2
      ).length;
      if (branchPointCount < this.sceneGraphBranching.minPerEpisode) {
        issues.push(
          `Only ${branchPointCount} scene-graph branch choicePoint(s); need at least ${this.sceneGraphBranching.minPerEpisode}. ` +
          `Add a non-expression choicePoint with branches=true and 2 distinct leadsTo targets that later reconverge.`
        );
      }
    }

    // Choice density pre-check (non-throwing)
    if (this.episodeStructureMode === 'sceneEpisodes' && blueprint.scenes.length !== this.sceneEpisodeConfig.maxScenes) {
      issues.push(`Scene-length episode blueprint has ${blueprint.scenes.length} scene(s); expected exactly ${this.sceneEpisodeConfig.maxScenes}`);
    } else if (blueprint.scenes.length > input.targetSceneCount) {
      issues.push(`Blueprint has ${blueprint.scenes.length} scenes; maximum is ${input.targetSceneCount}`);
    }

    const scenesWithChoices = blueprint.scenes.filter(s => s.choicePoint);
    const density = scenesWithChoices.length / blueprint.scenes.length;
    const hasEncounterScene = blueprint.scenes.some(scene => scene.isEncounter);
    if (density < 0.4 && !(this.episodeStructureMode === 'sceneEpisodes' && hasEncounterScene)) {
      issues.push(`Choice density ${Math.round(density * 100)}% is below 40% minimum (${scenesWithChoices.length}/${blueprint.scenes.length} scenes have choices)`);
    }

    if (this.isFirstSeasonEpisode(input)) {
      const startingScene = blueprint.scenes.find(s => s.id === blueprint.startingSceneId);
      if (startingScene && !startingScene.choicePoint && !(this.episodeStructureMode === 'sceneEpisodes' && startingScene.isEncounter)) {
        issues.push(
          `First scene "${startingScene.id}" of episode 1 has no choicePoint. ` +
          `The first scene of the first episode of each season must include a player choice.`
        );
      }
    }

    // Encounter coverage pre-check
    const encounterScenes = blueprint.scenes.filter(s => s.isEncounter);
    const minEncounters = this.getMinEncounters(blueprint.scenes.length);
    if (encounterScenes.length < minEncounters) {
      issues.push(`Only ${encounterScenes.length} encounter scene(s), need at least ${minEncounters}`);
    }

    issues.push(...this.collectTreatmentFidelityIssues(blueprint, input));
    issues.push(...this.collectDramaticStructureIssues(blueprint, input, false));
    issues.push(...this.collectThemePressureIssues(blueprint, false));
    issues.push(...this.collectSceneTurnContractIssues(blueprint, false));
    issues.push(...this.collectEpisodePressureIssues(blueprint, input, false));

    return issues;
  }

  private validateBlueprint(blueprint: EpisodeBlueprint, input: StoryArchitectInput): void {
    // Check scene count
    if (this.episodeStructureMode === 'sceneEpisodes') {
      if (blueprint.scenes.length !== this.sceneEpisodeConfig.maxScenes) {
        throw new Error(`Scene-length blueprint must have exactly ${this.sceneEpisodeConfig.maxScenes} scene`);
      }
    } else if (blueprint.scenes.length < 3) {
      throw new Error('Blueprint must have at least 3 scenes');
    }
    if (this.episodeStructureMode !== 'sceneEpisodes' && blueprint.scenes.length > input.targetSceneCount) {
      throw new Error(`Blueprint must have no more than ${input.targetSceneCount} scenes`);
    }

    // Check starting scene exists
    const startingScene = blueprint.scenes.find(s => s.id === blueprint.startingSceneId);
    if (!startingScene) {
      throw new Error(`Starting scene ${blueprint.startingSceneId} not found in scenes`);
    }

    // Check all leadsTo references are valid
    const sceneIds = new Set(blueprint.scenes.map(s => s.id));
    for (const scene of blueprint.scenes) {
      for (const targetId of scene.leadsTo) {
        if (!sceneIds.has(targetId)) {
          throw new Error(`Scene ${scene.id} references non-existent scene ${targetId}`);
        }
      }
    }

    // Check bottleneck scenes exist
    for (const bottleneckId of blueprint.bottleneckScenes) {
      if (!sceneIds.has(bottleneckId)) {
        throw new Error(`Bottleneck scene ${bottleneckId} not found in scenes`);
      }
    }

    // Check major choices have stakes
    const majorChoices = blueprint.scenes.filter(
      s => s.choicePoint && (s.choicePoint.branches || s.choicePoint.type === 'dilemma')
    );

    for (const scene of majorChoices) {
      const stakes = scene.choicePoint!.stakes;
      if (!stakes.want || !stakes.cost || !stakes.identity) {
        throw new Error(`Scene ${scene.id} has a major choice but incomplete stakes`);
      }
      if (!scene.choicePoint?.consequenceDomain) {
        throw new Error(`Scene ${scene.id} has a major choice but no consequenceDomain`);
      }
      if (!scene.choicePoint?.reminderPlan?.immediate || !scene.choicePoint?.reminderPlan?.shortTerm) {
        throw new Error(`Scene ${scene.id} has a major choice but no usable reminderPlan`);
      }
    }

    if (this.sceneGraphBranching.required && !this.sceneGraphBranching.allowLinearBottleneckEpisodes && this.episodeStructureMode !== 'sceneEpisodes') {
      const validBranchPointCount = blueprint.scenes.filter(scene =>
        scene.choicePoint?.branches &&
        scene.choicePoint.type !== 'expression' &&
        new Set(scene.leadsTo || []).size >= 2
      ).length;
      if (validBranchPointCount < this.sceneGraphBranching.minPerEpisode) {
        throw new Error(
          `Insufficient scene-graph branching: ${validBranchPointCount}/${this.sceneGraphBranching.minPerEpisode} valid branch point(s). ` +
          `At least one non-expression choicePoint must set branches=true and lead to 2+ distinct future scenes.`
        );
      }
    }

    const encounterScenes = blueprint.scenes.filter(scene => scene.isEncounter);
    if (encounterScenes.length < this.getMinEncounters(blueprint.scenes.length)) {
      throw new Error(
        `Blueprint only defines ${encounterScenes.length} encounter scene(s); expected at least ${this.getMinEncounters(blueprint.scenes.length)}`
      );
    }
    for (const scene of encounterScenes) {
      if (!scene.encounterDescription?.trim()) {
        throw new Error(`Encounter scene "${scene.id}" is missing encounterDescription`);
      }
      if (!scene.encounterDifficulty) {
        throw new Error(`Encounter scene "${scene.id}" is missing encounterDifficulty`);
      }
      if (!scene.encounterBuildup?.trim()) {
        throw new Error(`Encounter scene "${scene.id}" is missing encounterBuildup`);
      }
      if (!scene.encounterStakes?.trim()) {
        throw new Error(`Encounter scene "${scene.id}" is missing encounterStakes`);
      }
      if (!scene.encounterRelevantSkills || scene.encounterRelevantSkills.length === 0) {
        throw new Error(`Encounter scene "${scene.id}" is missing encounterRelevantSkills`);
      }
      if (!scene.encounterBeatPlan || scene.encounterBeatPlan.length < 3) {
        throw new Error(`Encounter scene "${scene.id}" is missing encounterBeatPlan with at least 3 beats`);
      }
      if (!scene.encounterType) {
        throw new Error(`Encounter scene "${scene.id}" is missing encounterType (must be one of: combat, chase, stealth, social, romantic, dramatic, puzzle, exploration, investigation, negotiation, survival, heist, mixed)`);
      }
    }
    this.validatePlannedEncounterCoverage(blueprint, input);
    const treatmentIssues = this.collectTreatmentFidelityIssues(blueprint, input);
    if (treatmentIssues.length > 0) {
      throw new Error(treatmentIssues.join('\n'));
    }
    const dramaticStructureIssues = this.collectDramaticStructureIssues(blueprint, input, true);
    if (dramaticStructureIssues.length > 0) {
      throw new Error(dramaticStructureIssues.join('\n'));
    }
    const themePressureIssues = this.collectThemePressureIssues(blueprint, true);
    if (themePressureIssues.length > 0) {
      throw new Error(themePressureIssues.join('\n'));
    }
    const sceneTurnContractIssues = this.collectSceneTurnContractIssues(blueprint, true);
    if (sceneTurnContractIssues.length > 0) {
      throw new Error(sceneTurnContractIssues.join('\n'));
    }
    const episodePressureIssues = this.collectEpisodePressureIssues(blueprint, input, true);
    if (episodePressureIssues.length > 0) {
      throw new Error(episodePressureIssues.join('\n'));
    }

    // === CHOICE DENSITY VALIDATION ===
    // This is critical for interactive fiction - stories without choices aren't interactive
    // But we also respect branch-and-bottleneck architecture where bottlenecks may be passive

    const scenesWithChoices = blueprint.scenes.filter(s => s.choicePoint);
    const choiceDensity = scenesWithChoices.length / blueprint.scenes.length;

    // Rule 1: At least 40% of scenes must have choice points (allows for bottleneck pattern)
    if (choiceDensity < 0.4) {
      console.warn(`[StoryArchitect] Low choice density: ${Math.round(choiceDensity * 100)}% of scenes have choices`);
      throw new Error(
        `Insufficient choice density: only ${scenesWithChoices.length}/${blueprint.scenes.length} scenes have choice points. ` +
        `Interactive fiction requires at least 40% of scenes to have player choices.`
      );
    }

    // Rule 2: Season-opening player agency. Episode 1 establishes the
    // season's playable contract, so the starting scene itself must include
    // a choice. Later episodes keep the existing "brief opening into
    // second-scene choice" flexibility.
    const firstScene = blueprint.scenes.find(s => s.id === blueprint.startingSceneId);
    if (firstScene && this.isFirstSeasonEpisode(input) && !firstScene.choicePoint && !(this.episodeStructureMode === 'sceneEpisodes' && firstScene.isEncounter)) {
      console.warn(`[StoryArchitect] First scene of episode 1 has no choice point`);
      throw new Error(
        `First scene "${firstScene.name}" has no choicePoint. ` +
        `The first scene of the first episode of each season must include a player choice.`
      );
    }

    if (firstScene && !this.isFirstSeasonEpisode(input) && !firstScene.choicePoint && !(this.episodeStructureMode === 'sceneEpisodes' && firstScene.isEncounter)) {
      // First scene doesn't have a choice - check if second scene does
      const secondSceneIds = firstScene.leadsTo;
      const secondScenes = secondSceneIds.map(id => blueprint.scenes.find(s => s.id === id)).filter(Boolean);
      const secondSceneHasChoice = secondScenes.some(s => s?.choicePoint);

      if (!secondSceneHasChoice) {
        console.warn(`[StoryArchitect] Neither first nor second scene has a choice point`);
        throw new Error(
          `First scene "${firstScene.name}" has no choicePoint and neither do its follow-up scenes. ` +
          `Players need agency early - add a choice to the first or second scene.`
        );
      } else {
        console.log(`[StoryArchitect] First scene is a bottleneck, but second scene has choice - OK`);
      }
    }

    // Rule 3: No more than 2 consecutive scenes without choices
    // Build the scene graph and check paths
    const sceneMap = new Map(blueprint.scenes.map(s => [s.id, s]));
    const visited = new Set<string>();

    const checkConsecutiveNonChoice = (sceneId: string, nonChoiceStreak: number): void => {
      if (visited.has(sceneId)) return;
      visited.add(sceneId);

      const scene = sceneMap.get(sceneId);
      if (!scene) return;

      const currentStreak = scene.choicePoint ? 0 : nonChoiceStreak + 1;

      if (currentStreak > 2) {
        console.warn(`[StoryArchitect] Scene "${scene.id}" is part of a ${currentStreak}-scene stretch without choices`);
        throw new Error(
          `Too many consecutive scenes without choices. Scene "${scene.name}" is part of a ${currentStreak}-scene stretch ` +
          `without player agency. Maximum allowed is 2 scenes between choices.`
        );
      }

      for (const nextId of scene.leadsTo) {
        checkConsecutiveNonChoice(nextId, currentStreak);
      }
    };

    // Start from the first scene
    if (firstScene) {
      checkConsecutiveNonChoice(firstScene.id, 0);
    }

    console.log(`[StoryArchitect] Choice density validation passed: ${scenesWithChoices.length}/${blueprint.scenes.length} scenes have choices (${Math.round(choiceDensity * 100)}%)`);
  }

  private repairSceneTransitions(blueprint: EpisodeBlueprint): void {
    const scenes = blueprint.scenes || [];
    const sceneMap = new Map(scenes.map((scene, index) => [scene.id, { scene, index }]));

    for (const [index, scene] of scenes.entries()) {
      const leadsTo = Array.isArray(scene.leadsTo) ? scene.leadsTo : [];
      const existingTransitions = Array.isArray(scene.transitionOut)
        ? scene.transitionOut
        : scene.transitionOut
          ? [scene.transitionOut as unknown as SceneTransitionOut]
          : [];
      const transitionByTarget = new Map(
        existingTransitions
          .filter((transition) => transition?.toSceneId)
          .map((transition) => [transition.toSceneId, transition])
      );

      scene.transitionOut = leadsTo.map((toSceneId, leadIndex) => {
        const existing = transitionByTarget.get(toSceneId);
        const target = sceneMap.get(toSceneId);
        const connector = existing?.connector === 'therefore' || existing?.connector === 'but'
          ? existing.connector
          : this.inferTransitionConnector(scene, target?.index ?? index + leadIndex + 1, index, leadIndex);

        return {
          toSceneId,
          connector,
          causalLink: this.pickBlueprintText(
            existing?.causalLink,
            this.buildTransitionCausalLink(scene, target?.scene, connector),
          ),
          pressureChange: this.pickBlueprintText(
            existing?.pressureChange,
            this.buildTransitionPressureChange(scene, target?.scene, connector),
          ),
        };
      });
    }
  }

  private inferTransitionConnector(
    scene: SceneBlueprint,
    targetIndex: number,
    sceneIndex: number,
    leadIndex: number
  ): 'therefore' | 'but' {
    if (leadIndex > 0 || scene.choicePoint?.branches) return 'but';
    if (targetIndex > sceneIndex + 1) return 'but';
    return 'therefore';
  }

  private buildTransitionCausalLink(
    scene: SceneBlueprint,
    target: SceneBlueprint | undefined,
    connector: 'therefore' | 'but'
  ): string {
    const sceneChange = this.pickBlueprintText(
      scene.dramaticStructure?.changedState,
      scene.residue?.[0]?.description,
      scene.choicePoint?.reminderPlan?.immediate,
      scene.choicePoint?.description,
      scene.keyBeats?.[scene.keyBeats.length - 1],
      scene.narrativeFunction,
      scene.description,
    );
    const targetPressure = this.pickBlueprintText(
      target?.dramaticQuestion,
      target?.conflictEngine,
      target?.description,
      target?.name,
      'the next scene',
    );
    const connectorText = connector === 'but'
      ? 'that result creates a complication'
      : 'that result makes the next pressure necessary';
    return `${scene.name} changes the situation: ${sceneChange}. ${connectorText}, driving ${target?.name || 'the next scene'}: ${targetPressure}`;
  }

  private buildTransitionPressureChange(
    scene: SceneBlueprint,
    target: SceneBlueprint | undefined,
    connector: 'therefore' | 'but'
  ): string {
    const pressureBeat = scene.keyBeats?.find((beat) =>
      /\b(peak|cost|choice|pressure|risk|danger|reveal|turn)\b/i.test(beat)
    );
    const fromPressure = this.pickBlueprintText(
      scene.dramaticStructure?.pressurePeak,
      scene.choicePoint?.stakes?.cost,
      scene.personalStake,
      scene.conflictEngine,
      pressureBeat,
      scene.name,
    );
    const toPressure = this.pickBlueprintText(
      target?.conflictEngine,
      target?.dramaticQuestion,
      target?.personalStake,
      target?.narrativeFunction,
      target?.name,
      'a sharper problem',
    );
    const verb = connector === 'but' ? 'reverses into' : 'escalates into';
    return `${fromPressure} ${verb} ${toPressure}.`;
  }

  private repairSceneTurnContracts(blueprint: EpisodeBlueprint): void {
    for (const scene of blueprint.scenes || []) {
      if (scene.choicePoint || this.sceneHasForcedDecision(scene)) continue;

      const forcedReaction = this.buildForcedReactionText(scene);
      scene.keyBeats = Array.isArray(scene.keyBeats) ? scene.keyBeats : [];
      if (!scene.keyBeats.some((beat) => beat.includes(forcedReaction))) {
        scene.keyBeats.push(`PEAK: ${forcedReaction}`);
      }

      scene.dramaticStructure = {
        question: scene.dramaticStructure?.question || scene.dramaticQuestion || `What changes in ${scene.name}?`,
        turn: scene.dramaticStructure?.turn || scene.conflictEngine || scene.keyBeats[0] || forcedReaction,
        pressurePeak: this.pickBlueprintText(scene.dramaticStructure?.pressurePeak, forcedReaction),
        changedState: this.pickBlueprintText(
          scene.dramaticStructure?.changedState,
          `${scene.name} leaves the protagonist committed to a changed course because ${forcedReaction}`,
        ),
      };

      scene.residue = Array.isArray(scene.residue) ? scene.residue : [];
      if (!scene.residue.some((residue) => residue.description?.includes(forcedReaction))) {
        scene.residue.push({
          type: 'danger',
          description: forcedReaction,
        });
      }
    }
  }

  private sceneHasForcedDecision(scene: SceneBlueprint): boolean {
    const text = [
      scene.dramaticStructure?.pressurePeak,
      scene.dramaticStructure?.changedState,
      scene.sequenceIntent?.turningPoint,
      ...(scene.keyBeats || []),
      ...(scene.transitionOut || []).flatMap((transition) => [transition.causalLink, transition.pressureChange]),
      ...(scene.residue || []).map((residue) => residue.description),
    ].filter(Boolean).join(' ');
    return /\b(decide|decides|decision|choose|chooses|choice|chose|commit|commits|commitment|refuse|refuses|refusal|accept|accepts|reject|rejects|reveal|reveals|hide|hides|sacrifice|sacrifices|tradeoff|trade-off|risk|risks|betray|betrays|trust|trusts|confront|confronts|promise|promises|confess|confesses|answer|answers|must|cannot|can no longer|turns toward|turns away|irreversible)\b/i.test(text);
  }

  private buildForcedReactionText(scene: SceneBlueprint): string {
    const pressure = this.pickBlueprintText(
      scene.dramaticStructure?.pressurePeak,
      scene.conflictEngine,
      scene.personalStake,
      scene.keyBeats?.[scene.keyBeats.length - 1],
      scene.description,
      scene.name,
    );
    const target = this.pickBlueprintText(
      scene.dramaticQuestion,
      scene.wantVsNeed,
      scene.narrativeFunction,
      'what the pressure means now',
    );
    return `The pressure forces an irreversible reaction: the protagonist must commit, refuse, reveal, or accept a cost around ${target}; ${pressure}`;
  }

  private collectTreatmentFidelityIssues(blueprint: EpisodeBlueprint, input: StoryArchitectInput): string[] {
    const result = new TreatmentFidelityValidator().validate({
      blueprint,
      treatmentGuidance: input.seasonPlanDirectives?.treatmentGuidance,
      cliffhangerPlan: input.cliffhangerPlan,
      plannedEncounters: input.seasonPlanDirectives?.plannedEncounters,
    });
    return result.issues;
  }

  private collectDramaticStructureIssues(
    blueprint: EpisodeBlueprint,
    _input: StoryArchitectInput,
    logWarnings: boolean
  ): string[] {
    const result = new DramaticStructureValidator().validate(blueprint, {
      episodeStructureMode: this.episodeStructureMode,
      requireSceneLevelMetadata: true,
    });

    if (logWarnings) {
      for (const issue of result.issues) {
        if (issue.severity === 'warning') {
          console.warn(`[StoryArchitect][P1-P8] ${issue.message}${issue.suggestion ? ` Suggestion: ${issue.suggestion}` : ''}`);
        }
      }
    }

    return result.issues
      .filter(issue => issue.severity === 'error')
      .map(issue => `[DramaticStructure] ${issue.message}${issue.location ? ` (${issue.location})` : ''}${issue.suggestion ? ` Suggestion: ${issue.suggestion}` : ''}`);
  }

  private collectThemePressureIssues(
    blueprint: EpisodeBlueprint,
    logWarnings: boolean
  ): string[] {
    const result = new ThemePressureValidator().validate(blueprint);

    if (logWarnings) {
      for (const issue of result.issues) {
        if (issue.severity === 'warning') {
          console.warn(`[StoryArchitect][Theme] ${issue.message}${issue.suggestion ? ` Suggestion: ${issue.suggestion}` : ''}`);
        }
      }
    }

    return result.issues
      .filter(issue => issue.severity === 'error')
      .map(issue => `[ThemePressure] ${issue.message}${issue.location ? ` (${issue.location})` : ''}${issue.suggestion ? ` Suggestion: ${issue.suggestion}` : ''}`);
  }

  private collectSceneTurnContractIssues(
    blueprint: EpisodeBlueprint,
    logWarnings: boolean
  ): string[] {
    const result = new SceneTurnContractValidator().validate(blueprint, {
      episodeStructureMode: this.episodeStructureMode,
    });

    if (logWarnings) {
      for (const issue of result.issues) {
        if (issue.severity === 'warning') {
          console.warn(`[StoryArchitect][SceneTurn] ${issue.message}${issue.suggestion ? ` Suggestion: ${issue.suggestion}` : ''}`);
        }
      }
    }

    return result.issues
      .filter(issue => issue.severity === 'error')
      .map(issue => `[SceneTurnContract] ${issue.message}${issue.location ? ` (${issue.location})` : ''}${issue.suggestion ? ` Suggestion: ${issue.suggestion}` : ''}`);
  }

  private collectEpisodePressureIssues(
    blueprint: EpisodeBlueprint,
    input: StoryArchitectInput,
    logWarnings: boolean
  ): string[] {
    const isFinale = Boolean(
      input.episodeStructuralRole?.includes('resolution') ||
      input.cliffhangerPlan?.mappedStructuralRole === 'resolution'
    );
    const result = new EpisodePressureArchitectureValidator().validate(blueprint, {
      episodeStructureMode: this.episodeStructureMode,
      isFinale,
      targetSceneCount: input.targetSceneCount,
    });

    if (logWarnings) {
      for (const issue of result.issues) {
        if (issue.severity === 'warning') {
          console.warn(`[StoryArchitect][EpisodePressure] ${issue.message}${issue.suggestion ? ` Suggestion: ${issue.suggestion}` : ''}`);
        }
      }
    }

    return result.issues
      .filter(issue => issue.severity === 'error')
      .map(issue => `[EpisodePressure] ${issue.message}${issue.location ? ` (${issue.location})` : ''}${issue.suggestion ? ` Suggestion: ${issue.suggestion}` : ''}`);
  }
}
