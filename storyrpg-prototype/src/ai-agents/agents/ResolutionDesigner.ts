/**
 * Resolution Designer Agent
 *
 * The outcome design specialist responsible for:
 * - Creating three-tier resolution systems (full success, complicated success, interesting failure)
 * - Designing meaningful consequences for each outcome
 * - Ensuring failures are as narratively interesting as successes
 * - Balancing mechanical and narrative consequences
 */

import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse } from './BaseAgent';
import { Consequence } from '../../types';

// Input types
export interface ResolutionDesignerInput {
  // Story context
  storyContext: {
    title: string;
    genre: string;
    tone: string;
  };

  // Scene context
  sceneId: string;
  sceneName: string;

  // Challenge context
  challengeDescription: string;
  challengeStakes: {
    want: string;
    cost: string;
    identity: string;
  };

  // What's being attempted
  actionAttempted: string;

  // Protagonist info
  protagonistInfo: {
    name: string;
    pronouns: 'he/him' | 'she/her' | 'they/them';
  };

  // NPCs affected
  npcsAffected: Array<{
    id: string;
    name: string;
    pronouns: 'he/him' | 'she/her' | 'they/them';
    relationshipToProtagonist?: string;
  }>;

  // Available state for consequences
  availableFlags: Array<{ name: string; description: string }>;
  availableScores: Array<{ name: string; description: string }>;
  availableTags: Array<{ name: string; description: string }>;

  // Context for what comes next
  possibleNextScenes: Array<{
    id: string;
    name: string;
    description: string;
  }>;
}

// Output types
export interface ResolutionOutcome {
  type: 'full_success' | 'complicated_success' | 'interesting_failure';

  // Narrative description
  narrativeSummary: string;

  // What the player achieves (or doesn't)
  achievement: {
    primaryGoal: 'achieved' | 'partially_achieved' | 'not_achieved';
    explanation: string;
  };

  // Costs and complications
  costs: Array<{
    description: string;
    severity: 'minor' | 'moderate' | 'major';
  }>;

  // Mechanical consequences
  consequences: Consequence[];

  // Relationship changes
  relationshipChanges: Array<{
    npcId: string;
    npcName: string;
    dimension: 'trust' | 'affection' | 'respect' | 'fear';
    change: number;
    reason: string;
  }>;

  // Scene navigation
  nextSceneId?: string;
  sceneTransitionReason?: string;

  // What this reveals or opens up
  narrativeOpportunities: string[];

  // How this connects to stakes
  stakesConnection: {
    wantOutcome: string;
    costPaid: string;
    identityRevealed: string;
  };
}

export interface ResolutionDesign {
  sceneId: string;
  challengeId: string;

  // The three outcomes
  fullSuccess: ResolutionOutcome;
  complicatedSuccess: ResolutionOutcome;
  interestingFailure: ResolutionOutcome;

  // Balance analysis
  balanceAnalysis: {
    riskRewardRatio: string;
    playerAgencyPreserved: boolean;
    narrativeMomentum: string;
  };

  // Design notes
  designNotes: string;
}

export class ResolutionDesigner extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Resolution Designer', config);
    this.includeSystemPrompt = true;
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Resolution Designer

You design the outcomes of challenges - the moments where player choices and abilities determine what happens next. Your job is to make every outcome feel meaningful, even failures.

## Three-Tier Resolution Philosophy

### Full Success
The player achieves their goal without significant cost.
- Goal is completely achieved
- No major complications
- Momentum is maintained or enhanced
- Feels rewarding but not trivial

**Design Guidelines:**
- Should feel earned, not handed
- Can still have minor flavor complications
- Sets up for future success
- Rewards player skill/choice

### Complicated Success
The player achieves their goal, BUT something goes wrong.
- Primary goal is achieved
- A significant cost is paid
- New problem or complication arises
- Victory feels pyrrhic

**Design Guidelines:**
- The "but" should be meaningful
- Cost should relate to the stakes
- Creates interesting follow-up situations
- Player should feel they made progress despite setback

### Interesting Failure
The player does NOT achieve their goal, but the story moves forward AND the character grows.
- Primary goal is NOT achieved
- But something else happens instead
- New information, opportunity, or situation emerges
- Story doesn't dead-end
- **The character gains something even in defeat**

**Design Guidelines:**
- NEVER make failure boring
- Failure should reveal character or world
- Opens alternative paths forward
- Player should want to see what happens next
- **Silver Lining Requirement**: Every failure MUST include at least one positive consequence alongside the negative ones. This represents what the character learned or gained from the experience:
  - A skill or attribute increase from facing adversity (e.g. resolve +2, or +1 to a tested skill)
  - A relationship moment (an NPC respects the attempt even if it failed)
  - An identity-defining tag (e.g. "determined", "battle-tested")
  - New awareness or information that wasn't available before
- Failure consequences should be net-negative but never purely negative. The player should feel that their character is developing even when things go wrong.

## Stakes Triangle Integration

Every outcome should connect to the stakes:
- **WANT**: Did they get what they wanted?
- **COST**: What price did they pay?
- **IDENTITY**: What did this reveal about them?
- **GROWTH**: How did this change the character? (especially for failure)

## Consequence Design

### Mechanical Consequences
- Flags: Boolean state changes
- Scores: Numeric changes (+/- 1-3 typically)
- Tags: Identity markers gained/lost
- Relationships: Trust/affection/respect/fear changes
- Attributes: Core character attributes (courage, wit, resolve, etc.) — use for growth
- Skills: Genre-specific skills — use to show improvement or learning

### Severity Scaling
- **Full Success**: Positive consequences reflecting mastery and confidence
- **Complicated Success**: Mix of positive and negative, with net-positive growth
- **Interesting Failure**: Primarily negative BUT always include a growth silver lining (attribute/skill increase or positive relationship shift)

## Authoring Style (STRICT LIMITS)
Each outcome's "narrativeSummary" MUST be extremely brief for mobile reading.
- **STRICT MAXIMUM 2 sentences per summary.**
- Target: 15-30 words.
- Focused on immediate impact and drama.
- DO NOT write paragraphs or detailed prose.
`;
  }

  async execute(input: ResolutionDesignerInput): Promise<AgentResponse<ResolutionDesign>> {
    const prompt = this.buildPrompt(input);

    console.log(`[ResolutionDesigner] Designing resolutions for: ${input.challengeDescription}`);

    try {
      const response = await this.callLLM([
        { role: 'user', content: prompt }
      ]);

      console.log(`[ResolutionDesigner] Received response (${response.length} chars)`);

      let design: ResolutionDesign;
      try {
        design = this.parseJSON<ResolutionDesign>(response);
      } catch (parseError) {
        console.error(`[ResolutionDesigner] JSON parse failed. Raw response (first 500 chars):`, response.substring(0, 500));
        throw parseError;
      }

      // Normalize the output
      design = this.normalizeDesign(design, input);

      // Validate the design
      this.validateDesign(design, input);

      return {
        success: true,
        data: design,
        rawResponse: response,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[ResolutionDesigner] Error:`, errorMsg);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  private normalizeDesign(design: ResolutionDesign, input: ResolutionDesignerInput): ResolutionDesign {
    // Ensure sceneId
    if (!design.sceneId) {
      design.sceneId = input.sceneId;
    }

    // Ensure challengeId
    if (!design.challengeId) {
      design.challengeId = `challenge-${input.sceneId}`;
    }

    // Normalize each outcome type
    design.fullSuccess = this.normalizeOutcome(design.fullSuccess, 'full_success');
    design.complicatedSuccess = this.normalizeOutcome(design.complicatedSuccess, 'complicated_success');
    design.interestingFailure = this.normalizeOutcome(design.interestingFailure, 'interesting_failure');

    // Ensure balance analysis
    if (!design.balanceAnalysis) {
      design.balanceAnalysis = {
        riskRewardRatio: 'balanced',
        playerAgencyPreserved: true,
        narrativeMomentum: 'maintained'
      };
    }

    // Ensure design notes
    if (!design.designNotes) {
      design.designNotes = '';
    }

    return design;
  }

  private normalizeOutcome(outcome: ResolutionOutcome, type: ResolutionOutcome['type']): ResolutionOutcome {
    if (!outcome) {
      outcome = {
        type,
        narrativeSummary: '',
        achievement: { primaryGoal: 'not_achieved', explanation: '' },
        costs: [],
        consequences: [],
        relationshipChanges: [],
        narrativeOpportunities: [],
        stakesConnection: { wantOutcome: '', costPaid: '', identityRevealed: '' }
      };
    }

    // Ensure type
    if (!outcome.type) {
      outcome.type = type;
    }

    // Ensure achievement
    if (!outcome.achievement) {
      outcome.achievement = { primaryGoal: 'not_achieved', explanation: '' };
    }

    // Ensure arrays
    if (!outcome.costs) {
      outcome.costs = [];
    } else if (!Array.isArray(outcome.costs)) {
      outcome.costs = [outcome.costs as unknown as { description: string; severity: 'minor' | 'moderate' | 'major' }];
    }

    if (!outcome.consequences) {
      outcome.consequences = [];
    } else if (!Array.isArray(outcome.consequences)) {
      outcome.consequences = [outcome.consequences as unknown as Consequence];
    }

    if (!outcome.relationshipChanges) {
      outcome.relationshipChanges = [];
    } else if (!Array.isArray(outcome.relationshipChanges)) {
      outcome.relationshipChanges = [outcome.relationshipChanges as unknown as { npcId: string; npcName: string; dimension: 'trust' | 'affection' | 'respect' | 'fear'; change: number; reason: string }];
    }

    if (!outcome.narrativeOpportunities) {
      outcome.narrativeOpportunities = [];
    } else if (!Array.isArray(outcome.narrativeOpportunities)) {
      outcome.narrativeOpportunities = [outcome.narrativeOpportunities as unknown as string];
    }

    // Ensure stakes connection
    if (!outcome.stakesConnection) {
      outcome.stakesConnection = { wantOutcome: '', costPaid: '', identityRevealed: '' };
    }

    return outcome;
  }

  private buildPrompt(input: ResolutionDesignerInput): string {
    const npcsList = input.npcsAffected
      .map(npc => `- ${npc.name} (${npc.id}, ${npc.pronouns})${npc.relationshipToProtagonist ? `: ${npc.relationshipToProtagonist}` : ''}`)
      .join('\n');

    const flagsList = input.availableFlags
      .map(f => `- ${f.name}: ${f.description}`)
      .join('\n');

    const scoresList = input.availableScores
      .map(s => `- ${s.name}: ${s.description}`)
      .join('\n');

    const nextScenesList = input.possibleNextScenes
      .map(s => `- ${s.id}: "${s.name}" - ${s.description}`)
      .join('\n');

    return `
Design three-tier resolution outcomes for the following challenge:

## Story Context
- **Title**: ${input.storyContext.title}
- **Genre**: ${input.storyContext.genre}
- **Tone**: ${input.storyContext.tone}

## Scene Context
- **Scene**: ${input.sceneName} (${input.sceneId})

## Challenge
- **Description**: ${input.challengeDescription}
- **Action Attempted**: ${input.actionAttempted}

## Stakes
- **WANT**: ${input.challengeStakes.want}
- **COST**: ${input.challengeStakes.cost}
- **IDENTITY**: ${input.challengeStakes.identity}

## Protagonist
- **Name**: ${input.protagonistInfo.name}
- **Pronouns**: ${input.protagonistInfo.pronouns}

## NPCs Affected
${npcsList || 'None'}

## Available State Variables

**Flags**:
${flagsList || 'None defined'}

**Scores**:
${scoresList || 'None defined'}

## Possible Next Scenes
${nextScenesList || 'None specified'}

## Required JSON Structure

{
  "sceneId": "${input.sceneId}",
  "challengeId": "challenge-1",
  "fullSuccess": {
    "type": "full_success",
    "narrativeSummary": "MAX 2 SENTENCES: Brief description of what happens",
    "achievement": {
      "primaryGoal": "achieved",
      "explanation": "How the goal was achieved"
    },
    "costs": [],
    "consequences": [
      { "type": "setFlag", "flag": "flag_name", "value": true }
    ],
    "relationshipChanges": [
      {
        "npcId": "npc-id",
        "npcName": "NPC Name",
        "dimension": "trust",
        "change": 1,
        "reason": "Why this changed"
      }
    ],
    "nextSceneId": "scene-id",
    "sceneTransitionReason": "Why this scene comes next",
    "narrativeOpportunities": ["What this opens up"],
    "stakesConnection": {
      "wantOutcome": "They got what they wanted",
      "costPaid": "Minimal cost",
      "identityRevealed": "Shows them as capable"
    }
  },
  "complicatedSuccess": {
    "type": "complicated_success",
    "narrativeSummary": "MAX 2 SENTENCES: Goal achieved but with complications",
    "achievement": {
      "primaryGoal": "partially_achieved",
      "explanation": "How it was achieved with cost"
    },
    "costs": [
      { "description": "What went wrong", "severity": "moderate" }
    ],
    "consequences": [
      { "type": "changeScore", "score": "score_name", "change": -1 }
    ],
    "relationshipChanges": [],
    "narrativeOpportunities": ["What complications create"],
    "stakesConnection": {
      "wantOutcome": "Got it, but...",
      "costPaid": "Significant cost paid",
      "identityRevealed": "Shows their determination"
    }
  },
  "interestingFailure": {
    "type": "interesting_failure",
    "narrativeSummary": "MAX 2 SENTENCES: Goal not achieved but story moves forward and character grows",
    "achievement": {
      "primaryGoal": "not_achieved",
      "explanation": "How it failed interestingly"
    },
    "costs": [
      { "description": "Consequence of failure", "severity": "major" }
    ],
    "consequences": [
      { "type": "setFlag", "flag": "failed_flag", "value": true },
      { "type": "attribute", "attribute": "resolve", "change": 2 }
    ],
    "relationshipChanges": [],
    "narrativeOpportunities": ["What failure reveals or opens", "What the character learned"],
    "stakesConnection": {
      "wantOutcome": "Did not get what they wanted",
      "costPaid": "Full cost realized",
      "identityRevealed": "Shows their vulnerability but also their growth"
    }
  },
  "balanceAnalysis": {
    "riskRewardRatio": "Analysis of risk vs reward",
    "playerAgencyPreserved": true,
    "narrativeMomentum": "How each outcome maintains momentum"
  },
  "designNotes": "Reasoning behind the design"
}

CRITICAL REQUIREMENTS:
1. All three outcomes must be meaningfully different
2. Interesting failure must still move the story forward
3. Consequences must be appropriate to outcome severity
4. Stakes triangle must be addressed in each outcome
5. Complicated success must have a real, meaningful cost
6. Interesting failure MUST include at least one positive growth consequence (attribute or skill increase) alongside the negative ones
7. Return ONLY valid JSON, no markdown, no extra text
`;
  }

  private validateDesign(design: ResolutionDesign, input: ResolutionDesignerInput): void {
    // Check all three outcomes exist
    if (!design.fullSuccess || !design.complicatedSuccess || !design.interestingFailure) {
      throw new Error('Must have all three outcome types');
    }

    // Check full success has achieved goal
    if (design.fullSuccess.achievement.primaryGoal !== 'achieved') {
      console.warn('Full success should have primaryGoal: achieved');
    }

    // Check interesting failure has not achieved goal
    if (design.interestingFailure.achievement.primaryGoal === 'achieved') {
      throw new Error('Interesting failure should not have achieved the primary goal');
    }

    // Check complicated success has costs
    if (design.complicatedSuccess.costs.length === 0) {
      console.warn('Complicated success should have at least one cost');
    }

    // Check interesting failure has narrative opportunities
    if (design.interestingFailure.narrativeOpportunities.length === 0) {
      console.warn('Interesting failure should have narrative opportunities');
    }

    // Check each outcome has some consequences or relationship changes
    for (const outcome of [design.fullSuccess, design.complicatedSuccess, design.interestingFailure]) {
      if (outcome.consequences.length === 0 && outcome.relationshipChanges.length === 0) {
        console.warn(`Outcome ${outcome.type} has no mechanical consequences`);
      }
    }
  }
}
