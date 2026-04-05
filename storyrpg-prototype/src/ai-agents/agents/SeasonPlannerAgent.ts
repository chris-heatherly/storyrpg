/**
 * Season Planner Agent
 *
 * Creates comprehensive season plans from source material analysis.
 * The season plan:
 * - Maps out all episodes with dependencies
 * - Tracks story arcs and character introductions
 * - Persists locally so generation can resume later
 * - Identifies which episodes should be generated together
 */

import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse } from './BaseAgent';
import {
  SourceMaterialAnalysis,
  EpisodeOutline,
  CrossEpisodeBranch,
  ConsequenceChain,
  PlannedEncounter,
  EncounterCategory,
  EndingMode,
} from '../../types/sourceAnalysis';
import {
  SeasonPlan,
  SeasonEpisode,
  SeasonArc,
  EpisodeRecommendation,
  EpisodeSelectionState,
} from '../../types/seasonPlan';

// ========================================
// INPUT TYPES
// ========================================

export interface SeasonPlannerInput {
  // The source analysis to build a season plan from
  sourceAnalysis: SourceMaterialAnalysis;
  
  // User preferences
  preferences?: {
    targetScenesPerEpisode?: number;
    targetChoicesPerEpisode?: number;
    pacing?: 'tight' | 'moderate' | 'expansive';
    endingMode?: EndingMode;
  };
  
  // Optional: existing plan to update
  existingPlanId?: string;
}

// ========================================
// SEASON PLANNER AGENT
// ========================================

export class SeasonPlannerAgent extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Season Planner', config);
    this.includeSystemPrompt = true;
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Master Season Architect

You create the MASTER BLUEPRINT for interactive fiction series. Your season plan is the single source of truth
that guides ALL downstream generation - encounters, story architecture, branching, and consequences.

Your plans must define:

### 1. Episode Structure & Dependencies
- Map which episodes introduce key characters/locations
- Plot threads spanning multiple episodes
- Critical episodes that can't be skipped

### 2. Story Arcs
- Group episodes into narrative arcs
- Identify arc beginnings, midpoints, and climaxes

### 3. ENCOUNTER PLANNING (Critical)
- Define 1-3 interactive encounters PER EPISODE
- Encounters are the ACTION SEQUENCES - combat, chases, social confrontations, stealth, puzzles
- Vary encounter types across the season (don't repeat the same type)
- Design a DIFFICULTY CURVE: introduction → rising → peak → falling → finale
- Encounter difficulty should escalate through the season
- Climactic episodes should have the hardest encounters

### 4. CROSS-EPISODE BRANCHING (Critical)
- Player choices should MATTER across episodes, not just within them
- Define 2-4 major branch points where choices create different experiences later
- Branches should reconverge eventually (finite parallel content)
- Use story flags to track decisions

### 5. CONSEQUENCE CHAINS
- Design cascading consequences: a choice in episode 2 ripples into episodes 4 and 6
- Create the feeling of a living, responsive world
- Include both positive and negative long-term effects

## Key Principles
- Every encounter should feel like an ACTION/REACTION sequence
- Encounter outcomes at branch points should lead to FUNDAMENTALLY different paths, not just tonal changes
- The season should feel like a complete arc: setup → escalation → climax → resolution
`;
  }

  async execute(input: SeasonPlannerInput): Promise<AgentResponse<SeasonPlan>> {
    const { sourceAnalysis, preferences } = input;

    console.log(`[SeasonPlanner] Creating season plan for: ${sourceAnalysis.sourceTitle}`);

    // Always use LLM - we need it for encounter planning and cross-episode branching
    let planData: Partial<SeasonPlan> & { 
      encounterPlan?: any; 
      crossEpisodeBranches?: any[];
      consequenceChains?: any[];
      seasonFlags?: any[];
      episodeEncounters?: Record<number, any[]>;
      episodeEndingRoutes?: Record<number, any[]>;
    };

    try {
      const prompt = this.buildPlanningPrompt(sourceAnalysis, preferences);
      const response = await this.callLLM([{ role: 'user', content: prompt }]);
      planData = this.parseJSON(response);
      const topKeys = Object.keys(planData);
      console.log(`[SeasonPlanner] LLM plan received with ${topKeys.length} top-level keys: ${topKeys.join(', ')}`);
      
      // Detect possible truncation — warn if critical fields are missing
      const criticalFields = ['arcs', 'episodeEncounters', 'crossEpisodeBranches', 'episodeEndingRoutes'];
      const missingCritical = criticalFields.filter(f => !(f in planData));
      if (missingCritical.length > 0) {
        console.warn(`[SeasonPlanner] WARNING: LLM response may be truncated — missing fields: ${missingCritical.join(', ')}. Response length: ${response.length} chars. Falling back for missing data.`);
      }
    } catch (error) {
      console.warn(`[SeasonPlanner] LLM planning failed, using fallback:`, error);
      planData = this.buildFallbackPlan(sourceAnalysis);
    }

    // Build the complete season plan
    const seasonPlan = this.buildSeasonPlan(sourceAnalysis, planData, preferences);

    console.log(`[SeasonPlanner] Created plan with ${seasonPlan.totalEpisodes} episodes, ${seasonPlan.arcs.length} arcs, ${seasonPlan.encounterPlan.totalEncounters} encounters, ${seasonPlan.crossEpisodeBranches.length} cross-episode branches`);

    return {
      success: true,
      data: seasonPlan,
    };
  }

  private buildPlanningPrompt(
    analysis: SourceMaterialAnalysis,
    preferences?: SeasonPlannerInput['preferences']
  ): string {
    const episodeSummaries = analysis.episodeBreakdown
      .map(ep => `Episode ${ep.episodeNumber}: "${ep.title}" - ${ep.synopsis}`)
      .join('\n');

    const characterList = analysis.majorCharacters
      .map(c => `- ${c.name} (${c.role}): ${c.description}`)
      .join('\n');

    const arcList = analysis.storyArcs
      .map(arc => `- ${arc.name}: ${arc.description} (Episodes ${arc.estimatedEpisodeRange.start}-${arc.estimatedEpisodeRange.end})`)
      .join('\n');
    const activeEndingMode = preferences?.endingMode || analysis.resolvedEndingMode || analysis.detectedEndingMode || 'single';
    const endingList = (analysis.resolvedEndings || [])
      .map((ending) => {
        const drivers = ending.stateDrivers.map((driver) => `${driver.type}: ${driver.label}`).join('; ');
        const conditions = ending.targetConditions.join(' | ');
        return `- ${ending.id} | ${ending.name}: ${ending.summary}
  Theme payoff: ${ending.themePayoff}
  Emotional register: ${ending.emotionalRegister}
  Drivers: ${drivers || 'n/a'}
  Conditions: ${conditions || 'n/a'}`;
      })
      .join('\n');

    return `
Create a comprehensive MASTER SEASON PLAN for this interactive fiction series.
This plan is the BLUEPRINT that guides ALL episode generation - encounters, branches, and consequences.

## Source Material
- **Title**: ${analysis.sourceTitle}
- **Genre**: ${analysis.genre}
- **Tone**: ${analysis.tone}
- **Themes**: ${analysis.themes.join(', ')}
- **Total Episodes**: ${analysis.totalEstimatedEpisodes}

## Episode Breakdown
${episodeSummaries}

## Major Characters
${characterList}

## Story Arcs
${arcList}

## Protagonist
- **Name**: ${analysis.protagonist.name}
- **Arc**: ${analysis.protagonist.arc}

## User Preferences
- Scenes per episode: ${preferences?.targetScenesPerEpisode || 6}
- Choices per episode: ${preferences?.targetChoicesPerEpisode || 3}
- Pacing: ${preferences?.pacing || 'moderate'}

## Ending Targets
- Active ending mode: ${activeEndingMode}
${endingList ? endingList : '- No explicit endings supplied. Create a convergent primary ending route that still pays off the source themes.'}

## YOUR TASK - MASTER BLUEPRINT

**Design each episode from the encounter outward.** The encounter is not a scene you add — it IS the episode. The episode's narrative exists to build toward the encounter, make its choices feel earned, and then play out the consequences.

### THE ENCOUNTER-FIRST PLANNING PROCESS

For each episode, answer in this order:

1. **What is the most dramatically intense confrontation possible in this episode?** That is the encounter. You are NOT bound to the source material — invent or heighten any confrontation that fits the themes. A social standoff in a drawing room is as valid as a sword fight.

2. **What does the player need to feel and know before reaching that encounter?** Plan buildup scenes that establish: the relationships that will be tested, the information that will become a weapon, and the personal stakes that make each encounter choice feel like a value statement, not just a tactical decision.

3. **What do the encounter choices draw on?** The best encounter choices reference what was established in the buildup — "do I use the trust I built with this character?" or "do I reveal the secret I discovered in the opening scene?" Plan the skills, relationships, and information that should be in play.

4. **What are the branching outcomes?** Victory, defeat, and escape should diverge meaningfully — not just different text, but different situations with different emotional weight and different paths forward.

You must plan THREE critical things at the SEASON level:

### 1. ENCOUNTER PLANNING (Encounter-First)
For each episode, design the encounter FIRST as the dramatic anchor, then plan how the episode builds toward it.
- Each encounter must feel like the episode's reason for existing — the culmination of everything that came before
- Plan what information/relationships/stakes the pre-encounter scenes must establish so the encounter choices feel loaded
- Design a DIFFICULTY CURVE across the season (introduction → rising → peak → falling → finale)
- Vary encounter types — no two consecutive episodes should use the same type
- Encounters at arc climaxes should be the hardest and most personally costly

In the \`episodeEncounters\` JSON, add an \`encounterBuildup\` field describing what the episode's earlier scenes need to establish for the encounter to land.

### 2. CROSS-EPISODE BRANCHING
Player choices should have consequences ACROSS episodes, not just within them.
- Identify 2-4 major branch points where player choices create DIFFERENT experiences in later episodes
- Encounter outcomes (victory/defeat/escape) are the richest source of cross-episode branches
- Branches should eventually reconverge (you can't make infinite parallel stories)

### 3. CONSEQUENCE CHAINS
Track how a single decision ripples through the season.
- A mercy shown in episode 2 might save you in episode 5
- An alliance formed in episode 1 might betray you in episode 4
- These create the feeling of a living, responsive world

### 4. ENDING TARGETING
- In \`single\` mode, all major routes must ultimately point back toward ONE ending target.
- In \`multiple\` mode, preserve DISTINCT routes and tie them to specific ending IDs.
- Use \`crossEpisodeBranches.paths[].targetEndingIds\` to show which ending routes a branch serves.
- Use \`episodeEndingRoutes\` to mark whether each episode opens, reinforces, threatens, or locks a route.

Return this JSON:
{
  "seasonTitle": "Compelling season title",
  "seasonSynopsis": "2-3 sentence season overview",
  "arcs": [
    {
      "name": "Arc name",
      "description": "Arc description",
      "episodeRange": { "start": 1, "end": 3 },
      "keyMoments": [
        { "episodeNumber": 1, "description": "Key moment", "importance": "critical" }
      ]
    }
  ],
  "episodeDependencies": {
    "2": [1],
    "3": [1, 2]
  },
  "episodeEncounters": {
    "1": [
      {
        "id": "enc-1-1",
        "type": "combat|social|chase|stealth|puzzle|exploration|mixed",
        "description": "What this encounter is about — be specific and dramatic",
        "difficulty": "easy|moderate|hard|extreme",
        "npcsInvolved": ["character names"],
        "stakes": "What's personally at risk for the protagonist — not just plot stakes",
        "relevantSkills": ["athletics", "persuasion", "stealth"],
        "encounterBuildup": "What the episode's earlier scenes must establish so this encounter's choices feel earned — relationships built, information revealed, personal stakes made clear",
        "encounterSetupContext": [
          "flag:example_flag — how the earlier choice echoes inside the encounter",
          "relationship:npc-id.trust >= 20 — what changes if trust is high enough"
        ],
        "isBranchPoint": false,
        "branchOutcomes": {
          "victory": "What happens on success — specific narrative consequence",
          "defeat": "What happens on failure — specific narrative consequence",
          "escape": "Optional escape outcome"
        }
      }
    ]
  },
  "episodeEndingRoutes": {
    "1": [
      {
        "endingId": "ending-1",
        "role": "opens|reinforces|threatens|locks",
        "description": "How this episode moves the player toward or away from that ending"
      }
    ]
  },
  "difficultyCurve": [
    { "episodeNumber": 1, "difficulty": "introduction", "encounterCount": 1 },
    { "episodeNumber": 2, "difficulty": "rising", "encounterCount": 2 }
  ],
  "crossEpisodeBranches": [
    {
      "id": "branch-1",
      "name": "The Alliance Choice",
      "originEpisode": 2,
      "trigger": {
        "type": "encounter_outcome|story_choice|relationship_state",
        "description": "What triggers this branch"
      },
      "paths": [
        {
          "id": "path-1a",
          "name": "Alliance with rebels",
          "condition": "Player chose to help the rebels",
          "targetEndingIds": ["ending-1"],
          "affectedEpisodes": [
            { "episodeNumber": 3, "impact": "major", "description": "Rebels provide safe passage" },
            { "episodeNumber": 5, "impact": "moderate", "description": "Rebel contact provides intel" }
          ]
        },
        {
          "id": "path-1b",
          "name": "Loyal to the crown",
          "condition": "Player chose to report the rebels",
          "targetEndingIds": ["ending-2"],
          "affectedEpisodes": [
            { "episodeNumber": 3, "impact": "major", "description": "Must fight through rebel territory alone" },
            { "episodeNumber": 5, "impact": "moderate", "description": "Crown rewards with resources" }
          ]
        }
      ],
      "reconvergence": {
        "episodeNumber": 6,
        "description": "Both paths lead to the same final confrontation"
      }
    }
  ],
  "consequenceChains": [
    {
      "id": "chain-1",
      "origin": {
        "episodeNumber": 1,
        "description": "Spare the guard's life"
      },
      "consequences": [
        { "episodeNumber": 3, "description": "Guard remembers mercy, provides information", "severity": "noticeable" },
        { "episodeNumber": 5, "description": "Guard becomes unexpected ally in final battle", "severity": "dramatic" }
      ]
    }
  ],
  "seasonFlags": [
    {
      "flag": "spared_guard",
      "description": "Player showed mercy to the guard in episode 1",
      "setInEpisode": 1,
      "checkedInEpisodes": [3, 5]
    }
  ],
  "characterIntroductions": [
    { "characterId": "char-1", "characterName": "Name", "introducedInEpisode": 1, "role": "protagonist" }
  ],
  "locationIntroductions": [
    { "locationId": "loc-1", "locationName": "Name", "introducedInEpisode": 1 }
  ],
  "recommendedGenerationOrder": [1, 2, 3, 4],
  "criticalEpisodes": [1, 3, 5],
  "warnings": ["Any adaptation concerns"]
}

CRITICAL RULES:
- Every episode MUST have at least 1 encounter — and it must be the episode's dramatic anchor
- Every encounter MUST have an encounterBuildup field describing what earlier scenes must establish
- Every encounter SHOULD include encounterSetupContext when earlier relationship/flag setup should visibly pay off inside the encounter
- Use encounterSetupContext entries in the format: "flag:<name> — <effect>" or "relationship:<npcId>.<dimension> <operator> <threshold> — <effect>"
- Preserve relationship operators exactly (\`<\`, \`<=\`, \`>\`, \`>=\`, \`==\`, \`!=\`) so downstream agents know whether high or low relationship state matters
- In \`multiple\` mode, make sure multiple distinct ending IDs remain reachable in the plan
- In \`single\` mode, branch routes may diverge temporarily but should reconverge toward the same final ending target
- Encounter types MUST VARY — no two consecutive episodes use the same type
- At least 2 cross-episode branches for a season with 3+ episodes (encounter outcomes are the best source)
- Consequence chains should span at least 2 episodes
- Difficulty should generally increase through the season
- You are NOT limited to what the source material literally contains — invent more dramatically intense encounters that fit the themes
- Return ONLY valid JSON
`;
  }

  private buildFallbackPlan(analysis: SourceMaterialAnalysis): Partial<SeasonPlan> & {
    encounterPlan?: any;
    crossEpisodeBranches?: any[];
    consequenceChains?: any[];
    seasonFlags?: any[];
    episodeEncounters?: Record<number, any[]>;
    episodeEndingRoutes?: Record<number, any[]>;
  } {
    // Fallback plan with auto-generated encounters and basic branching
    const episodeDependencies: Record<number, number[]> = {};
    for (let i = 2; i <= analysis.totalEstimatedEpisodes; i++) {
      episodeDependencies[i] = [i - 1];
    }

    // Auto-generate encounters based on episode content
    const encounterTypes: EncounterCategory[] = ['combat', 'social', 'romantic', 'dramatic', 'exploration', 'chase', 'stealth', 'puzzle', 'mixed'];
    const episodeEncounters: Record<number, PlannedEncounter[]> = {};
    const episodeEndingRoutes: Record<number, Array<{ endingId: string; role: string; description: string }>> = {};
    const totalEps = analysis.totalEstimatedEpisodes;
    const activeEndings = analysis.resolvedEndings || [];
    const activeMode = analysis.resolvedEndingMode || analysis.detectedEndingMode || 'single';

    analysis.episodeBreakdown.forEach((ep, idx) => {
      const epNum = ep.episodeNumber;
      const progress = epNum / totalEps;
      
      // Determine difficulty based on position in season
      let difficulty: PlannedEncounter['difficulty'] = 'easy';
      if (progress > 0.75) difficulty = 'extreme';
      else if (progress > 0.5) difficulty = 'hard';
      else if (progress > 0.25) difficulty = 'moderate';
      
      // Create 1-2 encounters per episode
      const encounterCount = epNum === totalEps || progress > 0.5 ? 2 : 1;
      const encounters: PlannedEncounter[] = [];
      
      for (let i = 0; i < encounterCount; i++) {
        const typeIdx = (idx * 2 + i) % encounterTypes.length;
        encounters.push({
          id: `enc-${epNum}-${i + 1}`,
          type: encounterTypes[typeIdx],
          description: `${encounterTypes[typeIdx]} encounter in "${ep.title}"`,
          difficulty,
          npcsInvolved: ep.mainCharacters.slice(0, 2),
          stakes: ep.narrativeFunction.conflict,
          relevantSkills: [],
          isBranchPoint: i === encounterCount - 1 && epNum < totalEps,
          branchOutcomes: i === encounterCount - 1 ? {
            victory: `Success in ${ep.title}`,
            partialVictory: `Costly success in ${ep.title}`,
            defeat: `Setback in ${ep.title}`,
          } : undefined,
        });
      }
      
      episodeEncounters[epNum] = encounters;
      episodeEndingRoutes[epNum] = activeEndings.length > 0
        ? (activeMode === 'multiple'
          ? activeEndings.map((ending, routeIndex) => ({
              endingId: ending.id,
              role: epNum === totalEps ? 'locks' : epNum === 1 ? 'opens' : (routeIndex + epNum) % 3 === 0 ? 'threatens' : 'reinforces',
              description: epNum === totalEps
                ? `This episode commits the player to ${ending.name}.`
                : epNum === 1
                  ? `This episode opens the possibility of ${ending.name}.`
                  : `This episode keeps ${ending.name} active through encounter and choice pressure.`,
            }))
          : [{
              endingId: activeEndings[0].id,
              role: epNum === totalEps ? 'locks' : epNum === 1 ? 'opens' : 'reinforces',
              description: epNum === totalEps
                ? `This episode locks the convergent route toward ${activeEndings[0].name}.`
                : `This episode keeps the season converging toward ${activeEndings[0].name}.`,
            }])
        : [];
    });

    return {
      seasonTitle: `${analysis.sourceTitle}: Season 1`,
      seasonSynopsis: `An interactive adaptation of ${analysis.sourceTitle}, spanning ${analysis.totalEstimatedEpisodes} episodes.`,
      arcs: analysis.storyArcs.map(arc => ({
        id: arc.id,
        name: arc.name,
        description: arc.description,
        episodeRange: arc.estimatedEpisodeRange,
        keyMoments: [],
        status: 'not_started' as const,
        completionPercentage: 0,
      })),
      episodeEncounters,
      episodeEndingRoutes,
      crossEpisodeBranches: [],
      consequenceChains: [],
      seasonFlags: [],
    };
  }

  private buildSeasonPlan(
    analysis: SourceMaterialAnalysis,
    planData: Partial<SeasonPlan> & {
      episodeEncounters?: Record<number | string, any[]>;
      crossEpisodeBranches?: any[];
      consequenceChains?: any[];
      seasonFlags?: any[];
      difficultyCurve?: any[];
      episodeEndingRoutes?: Record<number | string, any[]>;
    },
    preferences?: SeasonPlannerInput['preferences']
  ): SeasonPlan {
    const now = new Date();
    const planId = `season-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Parse episode dependencies from LLM output or use defaults
    const dependenciesMap: Record<number, number[]> = 
      (planData as any).episodeDependencies || {};

    // Parse encounter data per episode
    const episodeEncountersMap: Record<number, PlannedEncounter[]> = {};
    const rawEncounters = planData.episodeEncounters || {};
    const episodeEndingRoutesMap: Record<number, SeasonEpisode['endingRoutes']> = {};
    const rawEndingRoutes = planData.episodeEndingRoutes || {};
    for (const [epKey, encounters] of Object.entries(rawEncounters)) {
      const epNum = parseInt(String(epKey));
      if (!isNaN(epNum) && Array.isArray(encounters)) {
        episodeEncountersMap[epNum] = encounters.map((enc: any) => ({
          id: enc.id || `enc-${epNum}-${Math.random().toString(36).substr(2, 6)}`,
          type: (enc.type || 'mixed') as EncounterCategory,
          description: enc.description || 'Encounter',
          difficulty: enc.difficulty || 'moderate',
          npcsInvolved: enc.npcsInvolved || [],
          stakes: enc.stakes || '',
          relevantSkills: enc.relevantSkills || [],
          encounterBuildup: enc.encounterBuildup || '',
          encounterSetupContext: Array.isArray(enc.encounterSetupContext) ? enc.encounterSetupContext : undefined,
          isBranchPoint: !!enc.isBranchPoint,
          branchOutcomes: enc.branchOutcomes || undefined,
        }));
      }
    }
    for (const [epKey, routes] of Object.entries(rawEndingRoutes)) {
      const epNum = parseInt(String(epKey));
      if (!isNaN(epNum) && Array.isArray(routes)) {
        episodeEndingRoutesMap[epNum] = routes
          .map((route: any) => {
            if (!route || typeof route !== 'object') return null;
            const role = route.role === 'opens' || route.role === 'reinforces' || route.role === 'threatens' || route.role === 'locks'
              ? route.role
              : 'reinforces';
            return {
              endingId: route.endingId || '',
              role,
              description: route.description || '',
            };
          })
          .filter(Boolean) as NonNullable<SeasonEpisode['endingRoutes']>;
      }
    }

    // Parse cross-episode branches
    const crossEpisodeBranches: CrossEpisodeBranch[] = (planData.crossEpisodeBranches || []).map((branch: any) => ({
      id: branch.id || `branch-${Math.random().toString(36).substr(2, 6)}`,
      name: branch.name || 'Unnamed branch',
      originEpisode: branch.originEpisode || 1,
      trigger: {
        type: branch.trigger?.type || 'story_choice',
        description: branch.trigger?.description || '',
        sourceId: branch.trigger?.sourceId,
      },
      paths: (branch.paths || []).map((path: any) => ({
        id: path.id || `path-${Math.random().toString(36).substr(2, 6)}`,
        name: path.name || 'Unnamed path',
        condition: path.condition || '',
        targetEndingIds: Array.isArray(path.targetEndingIds)
          ? path.targetEndingIds.filter((endingId: unknown) => typeof endingId === 'string')
          : undefined,
        affectedEpisodes: (path.affectedEpisodes || []).map((ae: any) => ({
          episodeNumber: ae.episodeNumber,
          impact: ae.impact || 'moderate',
          description: ae.description || '',
        })),
      })),
      reconvergence: branch.reconvergence || undefined,
    }));

    // Parse consequence chains
    const consequenceChains: ConsequenceChain[] = (planData.consequenceChains || []).map((chain: any) => ({
      id: chain.id || `chain-${Math.random().toString(36).substr(2, 6)}`,
      origin: {
        episodeNumber: chain.origin?.episodeNumber || 1,
        description: chain.origin?.description || '',
        sourceId: chain.origin?.sourceId,
      },
      consequences: (chain.consequences || []).map((c: any) => ({
        episodeNumber: c.episodeNumber,
        description: c.description || '',
        severity: c.severity || 'noticeable',
      })),
    }));

    // Parse season flags
    const seasonFlags = (planData.seasonFlags || []).map((f: any) => ({
      flag: f.flag || '',
      description: f.description || '',
      setInEpisode: f.setInEpisode || 1,
      checkedInEpisodes: f.checkedInEpisodes || [],
    }));

    // Build difficulty curve
    const difficultyCurve = planData.difficultyCurve || analysis.episodeBreakdown.map((ep, idx) => {
      const progress = (idx + 1) / analysis.totalEstimatedEpisodes;
      let difficulty: string;
      if (progress <= 0.15) difficulty = 'introduction';
      else if (progress <= 0.45) difficulty = 'rising';
      else if (progress <= 0.7) difficulty = 'peak';
      else if (progress <= 0.85) difficulty = 'falling';
      else difficulty = 'finale';
      return {
        episodeNumber: ep.episodeNumber,
        difficulty,
        encounterCount: (episodeEncountersMap[ep.episodeNumber] || []).length || 1,
      };
    });

    // Calculate total encounter count
    let totalEncounters = 0;
    const typeDistribution: Record<string, number> = {};
    for (const encounters of Object.values(episodeEncountersMap)) {
      totalEncounters += encounters.length;
      for (const enc of encounters) {
        typeDistribution[enc.type] = (typeDistribution[enc.type] || 0) + 1;
      }
    }

    // Build SeasonEpisode objects with encounter data
    const episodes: SeasonEpisode[] = analysis.episodeBreakdown.map(ep => {
      const deps = dependenciesMap[ep.episodeNumber] || 
        (ep.episodeNumber > 1 ? [ep.episodeNumber - 1] : []);
      
      // Find characters introduced in this episode
      const introducesCharacters = analysis.majorCharacters
        .filter(c => c.firstAppearance === ep.episodeNumber)
        .map(c => c.id);

      // Find which episodes this sets up (episodes that depend on it)
      const setupsFor = Object.entries(dependenciesMap)
        .filter(([_, deps]) => deps.includes(ep.episodeNumber))
        .map(([epNum]) => parseInt(epNum));

      // Get encounter data for this episode
      const plannedEncounters = episodeEncountersMap[ep.episodeNumber] || [];
      
      // Get difficulty tier from curve
      const curveEntry = difficultyCurve.find((d: any) => d.episodeNumber === ep.episodeNumber);
      const difficultyTier = (curveEntry?.difficulty || 'rising') as 'introduction' | 'rising' | 'peak' | 'falling' | 'finale';

      // Find cross-episode branches that originate or affect this episode
      const outgoingBranches = crossEpisodeBranches
        .filter(b => b.originEpisode === ep.episodeNumber)
        .map(b => b.id);
      
      const incomingBranches = crossEpisodeBranches
        .filter(b => b.paths.some(p => 
          p.affectedEpisodes.some(ae => ae.episodeNumber === ep.episodeNumber)
        ))
        .map(b => b.id);

      // Find flags set/checked in this episode
      const setsFlags = seasonFlags
        .filter(f => f.setInEpisode === ep.episodeNumber)
        .map(f => ({ flag: f.flag, description: f.description }));
      
      const checksFlags = seasonFlags
        .filter(f => f.checkedInEpisodes.includes(ep.episodeNumber))
        .map(f => ({ flag: f.flag, ifTrue: f.description, ifFalse: `No ${f.flag}` }));

      return {
        ...ep,
        status: 'planned' as const,
        dependsOn: deps,
        setupsForEpisodes: setupsFor,
        resolvesPlotsFrom: deps.slice(0, -1),
        introducesCharacters,
        // New encounter planning fields
        plannedEncounters,
        difficultyTier,
        outgoingBranches: outgoingBranches.length > 0 ? outgoingBranches : undefined,
        incomingBranches: incomingBranches.length > 0 ? incomingBranches : undefined,
        setsFlags: setsFlags.length > 0 ? setsFlags : undefined,
        checksFlags: checksFlags.length > 0 ? checksFlags : undefined,
        endingRoutes: episodeEndingRoutesMap[ep.episodeNumber]?.length
          ? episodeEndingRoutesMap[ep.episodeNumber]
          : undefined,
      };
    });

    // Build arcs from LLM output or source analysis
    const arcs: SeasonArc[] = (planData.arcs || analysis.storyArcs.map(arc => ({
      id: arc.id,
      name: arc.name,
      description: arc.description,
      episodeRange: arc.estimatedEpisodeRange,
      keyMoments: [],
      status: 'not_started' as const,
      completionPercentage: 0,
    }))).map(arc => ({
      ...arc,
      status: 'not_started' as const,
      completionPercentage: 0,
    }));

    // Build character introductions
    const characterIntroductions = (planData as any).characterIntroductions || 
      analysis.majorCharacters.map(c => ({
        characterId: c.id,
        characterName: c.name,
        introducedInEpisode: c.firstAppearance,
        role: c.role,
      }));

    // Build location introductions
    const locationIntroductions = (planData as any).locationIntroductions ||
      analysis.keyLocations.map(loc => ({
        locationId: loc.id,
        locationName: loc.name,
        introducedInEpisode: loc.firstAppearance,
      }));

    return {
      id: planId,
      sourceTitle: analysis.sourceTitle,
      sourceAuthor: analysis.sourceAuthor,
      createdAt: now,
      updatedAt: now,
      analysisVersion: analysis.analysisTimestamp?.toISOString() || now.toISOString(),
      seasonTitle: planData.seasonTitle || `${analysis.sourceTitle}: Season 1`,
      seasonSynopsis: planData.seasonSynopsis || `An interactive adaptation spanning ${analysis.totalEstimatedEpisodes} episodes.`,
      totalEpisodes: analysis.totalEstimatedEpisodes,
      estimatedTotalDuration: `${analysis.totalEstimatedEpisodes * 15}-${analysis.totalEstimatedEpisodes * 25} minutes`,
      genre: analysis.genre,
      tone: analysis.tone,
      themes: analysis.themes,
      arcs,
      endingMode: preferences?.endingMode || analysis.resolvedEndingMode || analysis.detectedEndingMode || 'single',
      resolvedEndings: analysis.resolvedEndings || [],
      episodes,
      progress: {
        selectedCount: 0,
        completedCount: 0,
        inProgressCount: 0,
        percentComplete: 0,
        nextRecommendedEpisode: 1,
      },
      protagonist: analysis.protagonist,
      characterIntroductions,
      locationIntroductions,
      // New encounter master plan
      encounterPlan: {
        totalEncounters,
        difficultyCurve: difficultyCurve.map((d: any) => ({
          episodeNumber: d.episodeNumber,
          difficulty: d.difficulty,
          encounterCount: d.encounterCount,
        })),
        typeDistribution,
      },
      // New cross-episode branching
      crossEpisodeBranches,
      consequenceChains,
      seasonFlags,
      preferences: {
        targetScenesPerEpisode: preferences?.targetScenesPerEpisode || 6,
        targetChoicesPerEpisode: preferences?.targetChoicesPerEpisode || 3,
        pacing: preferences?.pacing || 'moderate',
      },
      warnings: this.validateEndingPlan({
        warnings: analysis.warnings || [],
        endingMode: preferences?.endingMode || analysis.resolvedEndingMode || analysis.detectedEndingMode || 'single',
        resolvedEndingCount: (analysis.resolvedEndings || []).length,
        episodes,
        crossEpisodeBranches,
      }),
      notes: [],
    };
  }

  private validateEndingPlan(input: {
    warnings: string[];
    endingMode: EndingMode;
    resolvedEndingCount: number;
    episodes: SeasonEpisode[];
    crossEpisodeBranches: CrossEpisodeBranch[];
  }): string[] {
    const warnings = [...input.warnings];
    const referencedEndingIds = new Set<string>();

    for (const episode of input.episodes) {
      for (const route of episode.endingRoutes || []) {
        if (route.endingId) referencedEndingIds.add(route.endingId);
      }
    }
    for (const branch of input.crossEpisodeBranches) {
      for (const path of branch.paths) {
        for (const endingId of path.targetEndingIds || []) {
          referencedEndingIds.add(endingId);
        }
      }
    }

    if (input.endingMode === 'multiple' && input.resolvedEndingCount < 2) {
      warnings.push('Multiple-ending mode is active, but fewer than two distinct ending targets were resolved.');
    }
    if (input.endingMode === 'single' && input.resolvedEndingCount > 1) {
      warnings.push('Single-ending mode is active, but more than one ending target remains resolved.');
    }
    if (input.resolvedEndingCount > 0 && referencedEndingIds.size === 0) {
      warnings.push('Ending targets were resolved but never referenced by episode routes or cross-episode branches.');
    }
    if (input.endingMode === 'multiple' && referencedEndingIds.size === 1 && input.resolvedEndingCount > 1) {
      warnings.push('Multiple-ending mode is active, but the season plan only references one ending route.');
    }

    return warnings;
  }

  /**
   * Get recommendations for which episodes to generate based on current selection
   */
  getEpisodeRecommendations(
    plan: SeasonPlan,
    selectedEpisodes: number[]
  ): EpisodeRecommendation[] {
    const recommendations: EpisodeRecommendation[] = [];

    for (const episode of plan.episodes) {
      if (selectedEpisodes.includes(episode.episodeNumber)) continue;
      if (episode.status === 'completed') continue;

      // Check if this episode is needed for selected episodes
      const isNeededBySelected = selectedEpisodes.some(selNum => {
        const selEp = plan.episodes.find(e => e.episodeNumber === selNum);
        return selEp?.dependsOn.includes(episode.episodeNumber);
      });

      // Check if this episode introduces critical characters for selected episodes
      const introducesNeededCharacter = episode.introducesCharacters.some(charId => {
        return selectedEpisodes.some(selNum => {
          const selEp = plan.episodes.find(e => e.episodeNumber === selNum);
          return selEp?.mainCharacters.includes(charId);
        });
      });

      if (isNeededBySelected) {
        recommendations.push({
          episodeNumber: episode.episodeNumber,
          reason: `Required dependency for episode(s) ${selectedEpisodes.filter(n => 
            plan.episodes.find(e => e.episodeNumber === n)?.dependsOn.includes(episode.episodeNumber)
          ).join(', ')}`,
          priority: 'must_generate',
          dependencyChain: this.getDependencyChain(plan, episode.episodeNumber),
        });
      } else if (introducesNeededCharacter) {
        recommendations.push({
          episodeNumber: episode.episodeNumber,
          reason: `Introduces character(s) needed in selected episodes`,
          priority: 'recommended',
          dependencyChain: this.getDependencyChain(plan, episode.episodeNumber),
        });
      }
    }

    return recommendations.sort((a, b) => {
      const priorityOrder = { must_generate: 0, recommended: 1, optional: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  /**
   * Get the full dependency chain for an episode
   */
  private getDependencyChain(plan: SeasonPlan, episodeNumber: number): number[] {
    const chain: number[] = [];
    const visited = new Set<number>();

    const addDeps = (epNum: number) => {
      if (visited.has(epNum)) return;
      visited.add(epNum);
      
      const ep = plan.episodes.find(e => e.episodeNumber === epNum);
      if (!ep) return;

      for (const dep of ep.dependsOn) {
        addDeps(dep);
      }
      chain.push(epNum);
    };

    addDeps(episodeNumber);
    return chain;
  }

  /**
   * Validate episode selection and return warnings
   */
  validateSelection(
    plan: SeasonPlan,
    selectedEpisodes: number[]
  ): EpisodeSelectionState {
    const warnings: string[] = [];
    const sorted = [...selectedEpisodes].sort((a, b) => a - b);

    // Check for missing dependencies
    for (const epNum of sorted) {
      const ep = plan.episodes.find(e => e.episodeNumber === epNum);
      if (!ep) continue;

      for (const dep of ep.dependsOn) {
        if (!sorted.includes(dep) && plan.episodes.find(e => e.episodeNumber === dep)?.status !== 'completed') {
          warnings.push(`Episode ${epNum} depends on Episode ${dep}, which is not selected or completed.`);
        }
      }
    }

    // Check for skipped episodes in arcs
    for (const arc of plan.arcs) {
      const arcEpisodes = sorted.filter(
        n => n >= arc.episodeRange.start && n <= arc.episodeRange.end
      );
      if (arcEpisodes.length > 0 && arcEpisodes.length < (arc.episodeRange.end - arc.episodeRange.start + 1)) {
        const missing = [];
        for (let i = arc.episodeRange.start; i <= arc.episodeRange.end; i++) {
          if (!sorted.includes(i)) missing.push(i);
        }
        if (missing.length > 0) {
          warnings.push(`Arc "${arc.name}" has gaps: episodes ${missing.join(', ')} are not selected.`);
        }
      }
    }

    // Recommend optimal order
    const recommendedOrder = this.getOptimalOrder(plan, sorted);

    return {
      planId: plan.id,
      selectedEpisodes: sorted,
      recommendedOrder,
      warnings,
    };
  }

  /**
   * Get optimal generation order for selected episodes
   */
  private getOptimalOrder(plan: SeasonPlan, selectedEpisodes: number[]): number[] {
    const ordered: number[] = [];
    const remaining = new Set(selectedEpisodes);
    const completed = new Set(
      plan.episodes.filter(e => e.status === 'completed').map(e => e.episodeNumber)
    );

    while (remaining.size > 0) {
      // Find episodes whose dependencies are satisfied
      const ready = [...remaining].filter(epNum => {
        const ep = plan.episodes.find(e => e.episodeNumber === epNum);
        if (!ep) return false;
        return ep.dependsOn.every(dep => completed.has(dep) || ordered.includes(dep));
      });

      if (ready.length === 0) {
        // Circular dependency or missing deps - add remaining in order
        const remainingArray = [...remaining].sort((a, b) => a - b);
        ordered.push(...remainingArray);
        break;
      }

      // Add the lowest-numbered ready episode
      const next = Math.min(...ready);
      ordered.push(next);
      remaining.delete(next);
    }

    return ordered;
  }
}
