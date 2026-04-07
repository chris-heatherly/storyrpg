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
import { BaseAgent, AgentResponse, AgentMessage } from './BaseAgent';
import { BRANCH_AND_BOTTLENECK } from '../prompts/storytellingPrinciples';
import type { EncounterCost, EncounterNarrativeStyle, EncounterType } from '../../types';
import type { EndingMode, StoryEndingTarget } from '../../types/sourceAnalysis';

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
  };

  // Pipeline memory context (optimization hints from prior runs, Claude only)
  memoryContext?: string;
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

  // NPCs present in this scene
  npcsPresent: string[];

  // Narrative function
  narrativeFunction: string;

  // Key beats to hit
  keyBeats: string[];

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

  // Choice payoff context: describes what player choice leads to this scene
  // Only populated for branch scenes that are entered as a result of a player choice.
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

  // Narrative arc
  arc: {
    hook: string;
    risingAction: string;
    climax: string;
    resolution: string;
  };

  // Themes to weave through
  themes: string[];

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
  private encounterMinimums: {
    short: number;    // 3-4 scenes
    medium: number;   // 5-7 scenes
    long: number;     // 8+ scenes
  };
  private lastStructuralFeedback: string[] = [];

  constructor(config: AgentConfig, generationConfig?: GenerationSettingsConfig) {
    super('Story Architect', config);
    this.includeSystemPrompt = true;
    
    // Configure minimum encounters per episode length
    this.encounterMinimums = {
      short: generationConfig?.minEncountersShort ?? 1,
      medium: generationConfig?.minEncountersMedium ?? 1,
      long: generationConfig?.minEncountersLong ?? 1,
    };
  }
  
  // Get minimum encounters based on scene count
  private getMinEncounters(sceneCount: number): number {
    if (sceneCount <= 4) return this.encounterMinimums?.short ?? 0;
    if (sceneCount <= 7) return this.encounterMinimums?.medium ?? 1;
    return this.encounterMinimums?.long ?? 1;
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
    plannedEncounter: NonNullable<NonNullable<StoryArchitectInput['seasonPlanDirectives']>['plannedEncounters']>[number]
  ): boolean {
    if (!scene.isEncounter || !scene.encounterType) return false;
    if (scene.plannedEncounterId) {
      return scene.plannedEncounterId === plannedEncounter.id && scene.encounterType === plannedEncounter.type;
    }
    if (scene.encounterType !== plannedEncounter.type) return false;

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
- Max 1-2 branching choice points per episode (encounter outcomes ARE the primary branching)
- Encounter outcomes (victory/defeat/escape) create the most meaningful divergence

## Choice Architecture Rules

1. **Choice Density**: At least 50% of scenes MUST have a choicePoint.
2. **First Choice Rule**: The first scene MUST have a choicePoint.
3. **No Choice Gaps**: Never more than 2 consecutive scenes without a choicePoint.
4. **Stakes Triangle**: Every choicePoint must define Want, Cost, and Identity.
5. **Consequence Legibility**: Major choicePoints should name the consequence domain and how the story will remember the decision.
6. **Competence Arc**: When a future confrontation can be softened or redirected through prep, define what the player can try now, what they lack, and what growth path could help later.

## Scene Types

- **BOTTLENECK**: All players experience this. Use for the encounter, crucial revelations, and emotional peaks.
- **BRANCH**: Player choice leads to meaningfully different paths that eventually reconverge.
- **TRANSITION**: Connects scenes, lower stakes, moves story forward.

## Scene Count Guidelines

- 5-8 scenes is ideal
- The encounter is typically scene 3-5 (two-thirds of the way through)
- 2-3 scenes before the encounter: setup and escalation
- 1-2 scenes after: consequence and resolution

## Tint System

Dilemma choices set tint flags (e.g., "tint:mercy") that color subsequent scenes. Plan for NPC reactions and textVariants conditioned on these flags.

## Callback & Flag Planning

Expression choices should set memorable flags. Plan at least 1 callback per episode where a later scene references an earlier choice.

Remember: The encounter is the heart. Design outward from it.
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

      const assistantPrefill = retryCount > 0 ? '{"episodeId":' : '';
      if (retryCount > 0) {
        messages.push({
          role: 'assistant',
          content: assistantPrefill
        });

        const structuralFeedback = this.lastStructuralFeedback.length > 0
          ? `\nSTRUCTURAL ISSUES FROM PREVIOUS ATTEMPT:\n${this.lastStructuralFeedback.map(f => `- ${f}`).join('\n')}\n`
          : '';

        messages[0].content += `\n\n⚠️ PREVIOUS ATTEMPT FAILED — FIX ALL ISSUES BELOW:${structuralFeedback}
REQUIREMENTS:
- The first scene MUST have a choicePoint
- At least ${Math.ceil(input.targetSceneCount * 0.5)} out of up to ${input.targetSceneCount} scenes must have choicePoint
- Include choicePoint with type, stakes (want/cost/identity), and description for each choice scene
- All leadsTo references must point to valid scene IDs
- Scene graph must be fully connected from startingSceneId
- Include at least one encounter scene with encounterDescription, encounterDifficulty, encounterBuildup, encounterStakes, encounterRelevantSkills, and encounterBeatPlan`;
        this.lastStructuralFeedback = [];
      }

      const rawResponse = await this.callLLM(messages);
      // Anthropic prefill: the API returns only the continuation, so re-attach the prefix
      const response = assistantPrefill + rawResponse;

      console.log(`[StoryArchitect] Received response (${response.length} chars)`);

      let blueprint: EpisodeBlueprint;
      try {
        blueprint = this.parseJSON<EpisodeBlueprint>(response);
      } catch (parseError) {
        console.error(`[StoryArchitect] JSON parse failed. Raw response (first 500 chars):`, response.substring(0, 500));
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

        // Normalize requires
        if (scene.requires && !Array.isArray(scene.requires)) {
          scene.requires = [scene.requires as unknown as string];
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
        
        // Filter out invalid scene references
        scene.leadsTo = scene.leadsTo.filter(targetId => {
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
        
        // Log if we made repairs
        if (originalLeadsTo.length !== scene.leadsTo.length || 
            !originalLeadsTo.every((id, idx) => scene.leadsTo[idx] === id)) {
          console.log(`[StoryArchitect] Repaired leadsTo for ${scene.id}: [${originalLeadsTo.join(', ')}] -> [${scene.leadsTo.join(', ')}]`);
        }
      }

      // Also repair bottleneckScenes to remove invalid references
      blueprint.bottleneckScenes = blueprint.bottleneckScenes.filter(id => {
        if (validSceneIds.has(id)) return true;
        console.warn(`[StoryArchitect] Removed invalid bottleneck reference: ${id}`);
        return false;
      });

      if (!blueprint.bottleneckScenes) {
        blueprint.bottleneckScenes = [];
      } else if (!Array.isArray(blueprint.bottleneckScenes)) {
        blueprint.bottleneckScenes = [blueprint.bottleneckScenes as unknown as string];
      }

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

      // Ensure arc object exists
      if (!blueprint.arc) {
        blueprint.arc = {
          hook: '',
          risingAction: '',
          climax: '',
          resolution: ''
        };
      }

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

      if ((isChoiceDensityError || isEncounterPlanningError || isStructuralError) && retryCount < maxRetries) {
        console.log(`[StoryArchitect] Retrying due to structural blueprint issue: ${errorMsg.slice(0, 120)}`);
        this.lastStructuralFeedback = [errorMsg];
        return this.execute(input, retryCount + 1);
      }

      return {
        success: false,
        error: errorMsg,
      };
    }
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
- Maximum scene count (cap): Up to ${input.targetSceneCount} scenes—generate fewer if the story doesn't need more
- Major choice points: ${input.majorChoiceCount} significant decisions
- Use branch-and-bottleneck structure
- Every major choice needs WANT, COST, and IDENTITY stakes
- **Intensity guidance in keyBeats**: For each scene, indicate which keyBeats are the dominant peak(s) (prefix with "PEAK:") and suggest where rest/breathing beats should fall (prefix with "REST:"). The SceneWriter uses this to shape the intensity arc. Example: ["REST: the quiet village at dawn", "PEAK: confrontation erupts at the market", "the aftermath settles"]
${this.buildSeasonPlanDirectivesSection(input)}

## Required JSON Structure

{
  "episodeId": "episode-1",
  "title": "Episode Title",
  "synopsis": "Brief episode summary",
  "arc": {
    "hook": "Opening hook description",
    "risingAction": "Rising action description",
    "climax": "Climax description",
    "resolution": "Resolution description"
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
      "keyBeats": ["beat 1", "beat 2"],
      "leadsTo": ["scene-2"],
      "encounterBuildup": "Establishes the antagonist's power and the protagonist's vulnerability — makes the encounter's stakes personal",
      "choicePoint": {
        "type": "dilemma",
        "stakes": {"want": "goal", "cost": "sacrifice", "identity": "what it reveals"},
        "description": "The choice",
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
1. The "scenes" array must contain 3-${input.targetSceneCount} scenes (cap—use fewer if story doesn't need more)
2. Each scene MUST have: id, name, description, location, mood, purpose, npcsPresent, narrativeFunction, keyBeats, leadsTo
3. purpose MUST be one of: "bottleneck", "branch", "transition"
4. startingSceneId MUST match one of the scene ids
5. Return ONLY valid JSON, no markdown, no extra text

CHOICE PAYOFF REQUIREMENTS:
- For every scene with purpose "branch" that is reached via a player choice (i.e., it appears in another scene's leadsTo because of a branching choicePoint), include "incomingChoiceContext" — a string describing what player choice leads to this scene and what it means dramatically.
- Example: "Player chose to defy the authority figure, asserting independence at the cost of safety"
- This context ensures the scene writer can pay off the choice in the opening beat's text AND visuals.
- Bottleneck scenes and starting scenes do NOT need incomingChoiceContext.

ENCOUNTER REQUIREMENTS:
- At least ${this.getMinEncounters(input.targetSceneCount)} scene(s) MUST be an encounter (isEncounter: true)
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

CHOICE DENSITY REQUIREMENTS (CRITICAL - Interactive fiction requires player choices):
6. At least 40% of scenes MUST have a choicePoint defined (branching, dilemma, or flavor)
7. Players need agency early - either the FIRST scene has a choicePoint, OR the first scene is very brief (< 200 words) and the SECOND scene has one
8. NEVER have more than 2 scenes in a row without a choicePoint
9. Every choicePoint must have type, stakes, and description
10. Major branching/dilemma choices MUST have complete stakes (want, cost, identity)
11. BOTTLENECK scenes CAN have flavor choices - players still get agency in HOW they react even if the story beat is fixed
12. Major choicePoints should include consequenceDomain and reminderPlan so later agents know how to preserve residue
13. Use competenceArc and failureBranchPurpose when a future confrontation should open recovery, training, leverage, alliance, investigation, or regrouping paths

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

  private buildSeasonPlanDirectivesSection(input: StoryArchitectInput): string {
    const directives = input.seasonPlanDirectives;
    if (!directives) return '';

    let section = '\n## SEASON PLAN DIRECTIVES (Master Blueprint)\n';
    section += 'The following directives come from the season-level master plan. Follow them precisely.\n\n';

    if (directives.difficultyTier) {
      section += `**Difficulty Tier**: ${directives.difficultyTier} — calibrate encounters and tension accordingly.\n\n`;
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

    if (directives.plannedEncounters && directives.plannedEncounters.length > 0) {
      section += '### Pre-Planned Encounters\n';
      section += 'These encounters MUST be included as encounter scenes in the blueprint. Copy each encounter ID into the scene field `plannedEncounterId` exactly so downstream generation can bind the scene to the season plan.\n\n';
      for (const enc of directives.plannedEncounters) {
        section += `- **${enc.id}** (${enc.type}, ${enc.difficulty}): ${enc.description}\n`;
        section += `  Stakes: ${enc.stakes}\n`;
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
      section += 'to upcoming challenges. Place development scenes BEFORE hard checks.\n\n';
      section += 'For every hard check (difficulty > 50), plan a FAILURE-RECOVERY BRANCH:\n';
      section += 'failure -> recovery/growth scene -> softer re-approach or alternative -> reconverge.\n';
      section += 'Failure is never a dead end. It is a detour through growth.\n\n';
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

    // Choice density pre-check (non-throwing)
    const scenesWithChoices = blueprint.scenes.filter(s => s.choicePoint);
    const density = scenesWithChoices.length / blueprint.scenes.length;
    if (density < 0.4) {
      issues.push(`Choice density ${Math.round(density * 100)}% is below 40% minimum (${scenesWithChoices.length}/${blueprint.scenes.length} scenes have choices)`);
    }

    // Encounter coverage pre-check
    const encounterScenes = blueprint.scenes.filter(s => s.isEncounter);
    const minEncounters = this.getMinEncounters(blueprint.scenes.length);
    if (encounterScenes.length < minEncounters) {
      issues.push(`Only ${encounterScenes.length} encounter scene(s), need at least ${minEncounters}`);
    }

    return issues;
  }

  private validateBlueprint(blueprint: EpisodeBlueprint, input: StoryArchitectInput): void {
    // Check scene count
    if (blueprint.scenes.length < 3) {
      throw new Error('Blueprint must have at least 3 scenes');
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

    // Rule 2: Early player agency - first scene has choice OR is brief and second scene has choice
    const firstScene = blueprint.scenes.find(s => s.id === blueprint.startingSceneId);
    if (firstScene && !firstScene.choicePoint) {
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
}
