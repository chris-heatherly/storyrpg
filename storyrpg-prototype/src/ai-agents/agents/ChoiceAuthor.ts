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
import { BaseAgent, AgentResponse } from './BaseAgent';
import { SceneBlueprint } from './StoryArchitect';
import {
  Choice,
  ChoiceFeedbackCue,
  ChoiceType,
  Consequence,
  ConsequenceDomain,
  ConditionExpression,
  FiveFactorImpact,
  ReminderPlan,
} from '../../types';
import { SourceMaterialAnalysis } from '../../types/sourceAnalysis';
import { STAKES_TRIANGLE, CHOICE_GEOMETRY, FIVE_FACTOR_TEST } from '../prompts/storytellingPrinciples';
import { FiveFactorValidator } from '../validators/FiveFactorValidator';
import { StakesTriangleValidator } from '../validators/StakesTriangleValidator';
import { DEFAULT_LIMITS } from '../utils/textEnforcer';

// Input types
export interface ChoiceAuthorInput {
  // Scene context
  sceneBlueprint: SceneBlueprint;
  beatText: string; // The beat text leading up to this choice
  beatId: string;

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

  // Guidance
  optionCount: number; // Usually 2-4

  // Source material analysis for IP fidelity (optional)
  sourceAnalysis?: SourceMaterialAnalysis;

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

  // Design notes
  designNotes: string;
}

export class ChoiceAuthor extends BaseAgent {
  private fiveFactorValidator: FiveFactorValidator;
  private stakesValidator: StakesTriangleValidator;
  private minStakesScore = 60; // Minimum quality score for stakes
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

${STAKES_TRIANGLE}

${CHOICE_GEOMETRY}

${FIVE_FACTOR_TEST}

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

## The Five-Factor Test
Every choice (except expression) MUST affect at least one:
1. **Outcome**: What happens in the story.
2. **Process**: How it happens.
3. **Information**: What is learned.
4. **Relationship**: Bonds with NPCs.
5. **Identity**: Who the protagonist is becoming.

## Type-Specific Requirements (ENFORCED)
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
- **Reminder Planning**: Every meaningful choice should include an immediate echo and a short-term reminder plan.
- **Risk Framing**: Use fiction-first feedback cues such as "steady", "desperate", "you have leverage", or "you're out of your depth" instead of exposing numbers.

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

  async execute(input: ChoiceAuthorInput): Promise<AgentResponse<ChoiceSet>> {
    const prompt = this.buildPrompt(input);

    console.log(`[ChoiceAuthor] Creating choices for beat: ${input.beatId}`);

    try {
      const response = await this.callLLM([
        { role: 'user', content: prompt }
      ]);

      console.log(`[ChoiceAuthor] Received response (${response.length} chars)`);

      let choiceSet: ChoiceSet;
      try {
        choiceSet = this.parseJSON<ChoiceSet>(response);
      } catch (parseError) {
        console.error(`[ChoiceAuthor] JSON parse failed. Raw response (first 500 chars):`, response.substring(0, 500));
        throw parseError;
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
        rawResponse: response,
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

  private normalizeChoiceSet(choiceSet: ChoiceSet, input: ChoiceAuthorInput): ChoiceSet {
    // Get blueprint stakes as fallback
    const blueprintStakes = input.sceneBlueprint.choicePoint?.stakes || {
      want: 'achieve their goal',
      cost: 'face consequences',
      identity: 'reveal their character'
    };
    const blueprintDomain = input.sceneBlueprint.choicePoint?.consequenceDomain;
    const blueprintReminder = input.sceneBlueprint.choicePoint?.reminderPlan;
    const blueprintCompetenceArc = input.sceneBlueprint.choicePoint?.competenceArc;

    // CRITICAL: Always use the input beatId to ensure correct mapping during assembly
    // The LLM might return a different beatId, but we need it to match the actual beat
    choiceSet.beatId = input.beatId;
    
    if (!choiceSet.choiceType) {
      // Use the blueprint's choice type if available
      choiceSet.choiceType = input.sceneBlueprint.choicePoint?.type || 'expression';
    }
    if (!choiceSet.designNotes) {
      choiceSet.designNotes = '';
    }

    // Ensure choices is an array
    if (!choiceSet.choices) {
      choiceSet.choices = [];
    } else if (!Array.isArray(choiceSet.choices)) {
      choiceSet.choices = [choiceSet.choices as unknown as GeneratedChoice];
    }

    // AUTO-FIX: If LLM returned fewer than 2 choices, generate placeholder choices
    if (choiceSet.choices.length < 2) {
      console.warn(`[ChoiceAuthor] LLM only returned ${choiceSet.choices.length} choices, auto-generating to reach minimum of 2`);
      
      // Get option hints from blueprint if available
      const optionHints = input.sceneBlueprint.choicePoint?.optionHints || [];
      const possibleScenes = input.possibleNextScenes || [];
      
      while (choiceSet.choices.length < 2) {
        const idx = choiceSet.choices.length;
        const hintText = optionHints[idx] || `Option ${idx + 1}`;
        const nextScene = possibleScenes[idx] || possibleScenes[0];
        
        const generatedChoice: GeneratedChoice = {
          id: `auto-choice-${idx + 1}`,
          text: hintText,
          choiceType: choiceSet.choiceType || 'expression',
          consequences: [],
          nextSceneId: nextScene?.id,
          stakesAnnotation: {
            want: blueprintStakes.want,
            cost: blueprintStakes.cost,
            identity: blueprintStakes.identity,
          },
        };
        
        choiceSet.choices.push(generatedChoice);
        console.log(`[ChoiceAuthor] Auto-generated choice: "${generatedChoice.text}" -> ${generatedChoice.nextSceneId || 'no target'}`);
      }
    }
    
    // AUTO-FIX: If LLM returned more than 5 choices, trim to 5
    if (choiceSet.choices.length > 5) {
      console.warn(`[ChoiceAuthor] LLM returned ${choiceSet.choices.length} choices, trimming to maximum of 5`);
      choiceSet.choices = choiceSet.choices.slice(0, 5);
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

      // Normalize outcomeTexts — fallback to the choice text if the LLM omitted them
      if (!choice.outcomeTexts || typeof choice.outcomeTexts !== 'object') {
        choice.outcomeTexts = {
          success: choice.text,
          partial: choice.text,
          failure: choice.text,
        };
        console.warn(`[ChoiceAuthor] Choice "${choice.id}" missing outcomeTexts — using choice text as fallback`);
      } else {
        if (!choice.outcomeTexts.success) choice.outcomeTexts.success = choice.text;
        if (!choice.outcomeTexts.partial) choice.outcomeTexts.partial = choice.text;
        if (!choice.outcomeTexts.failure) choice.outcomeTexts.failure = choice.text;
      }

      // Auto-generate a tintFlag if the choice doesn't branch and none was provided
      if (!choice.nextSceneId && !choice.tintFlag) {
        const tintsByType: Record<string, string> = {
          expression: 'tint:personal',
          relationship: 'tint:connected',
          strategic: 'tint:pragmatic',
          dilemma: 'tint:conflicted',
        };
        choice.tintFlag = tintsByType[choiceSet.choiceType] || 'tint:decisive';
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

      if (choice.consequences && !Array.isArray(choice.consequences)) {
        choice.consequences = [choice.consequences as unknown as Consequence];
      }
      if (!choice.consequences) {
        choice.consequences = [];
      }

      // Normalize stakesAnnotation for each choice if present but incomplete
      if (choice.stakesAnnotation) {
        if (!choice.stakesAnnotation.want) {
          choice.stakesAnnotation.want = blueprintStakes.want;
        }
        if (!choice.stakesAnnotation.cost) {
          choice.stakesAnnotation.cost = blueprintStakes.cost;
        }
        if (!choice.stakesAnnotation.identity) {
          choice.stakesAnnotation.identity = blueprintStakes.identity;
        }
      }

      if (!choice.consequenceDomain) {
        choice.consequenceDomain = blueprintDomain || this.defaultDomainForChoiceType(choiceSet.choiceType);
      }

      if (!choice.reminderPlan) {
        choice.reminderPlan = blueprintReminder || {
          immediate: 'The moment lands immediately.',
          shortTerm: 'The next scene should remember this choice.',
          later: choice.nextSceneId ? 'This route should keep carrying the decision forward.' : undefined,
        };
      } else {
        if (!choice.reminderPlan.immediate) {
          choice.reminderPlan.immediate = blueprintReminder?.immediate || 'The moment lands immediately.';
        }
        if (!choice.reminderPlan.shortTerm) {
          choice.reminderPlan.shortTerm = blueprintReminder?.shortTerm || 'The next scene should remember this choice.';
        }
      }

      if (!choice.feedbackCue) {
        choice.feedbackCue = {
          echoSummary: choice.reminderPlan.immediate,
          progressSummary: choice.reminderPlan.shortTerm,
          checkClass: choice.statCheck?.retryableAfterChange || blueprintCompetenceArc?.growthPath ? 'retryable' : 'dramatic',
        };
      } else {
        if (!choice.feedbackCue.echoSummary) {
          choice.feedbackCue.echoSummary = choice.reminderPlan.immediate;
        }
        if (!choice.feedbackCue.progressSummary) {
          choice.feedbackCue.progressSummary = choice.reminderPlan.shortTerm;
        }
        if (!choice.feedbackCue.checkClass) {
          choice.feedbackCue.checkClass = choice.statCheck?.retryableAfterChange || blueprintCompetenceArc?.growthPath ? 'retryable' : 'dramatic';
        }
      }

      if (choice.statCheck?.difficulty && blueprintCompetenceArc?.growthPath && choiceSet.choiceType !== 'expression') {
        choice.statCheck.retryableAfterChange ??= true;
      }
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

    const flagList = input.availableFlags
      .map(f => `- ${f.name}: ${f.description}`)
      .join('\n');

    const scoreList = input.availableScores
      .map(s => `- ${s.name}: ${s.description}`)
      .join('\n');

    let sourceContextStr = '';
    if (input.sourceAnalysis?.directLanguageFragments?.length) {
      const directFragments = input.sourceAnalysis.directLanguageFragments
        .map(fragment => `- "${fragment.text}"`)
        .join('\n');

      sourceContextStr = `
## Source Material Fidelity (IP Research)
The following iconic language and style fragments have been identified from the source IP. 
**Use this specific terminology and character voice when writing choice text.**

### Iconic Dialogue Fragments
${directFragments}
`;
    }

    const choicePoint = input.sceneBlueprint.choicePoint!;

    return `
Create player choices for the following decision point:

${sourceContextStr}

## Story Context
- **Title**: ${input.storyContext.title}
- **Genre**: ${input.storyContext.genre}
- **Tone**: ${input.storyContext.tone}
${input.storyContext.worldContext ? `- **World**: ${input.storyContext.worldContext}\n` : ''}${input.storyContext.userPrompt ? `- **User Instructions/Prompt**: ${input.storyContext.userPrompt}\n` : ''}${input.memoryContext ? `\n## Pipeline Memory (Insights from Prior Generations)\n${input.memoryContext}\n` : ''}
## Scene Context
- **Scene**: ${input.sceneBlueprint.name}
- **Location**: ${input.sceneBlueprint.location}
- **Mood**: ${input.sceneBlueprint.mood}

## The Moment
This beat leads up to the choice:

"${input.beatText}"

## Choice Point Design
- **Type**: ${choicePoint.type}
- **Description**: ${choicePoint.description}
- **Stakes**:
  - Want: ${choicePoint.stakes.want}
  - Cost: ${choicePoint.stakes.cost}
  - Identity: ${choicePoint.stakes.identity}
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

## Available State for Consequences
**Flags**:
${flagList || 'None defined'}

**Scores**:
${scoreList || 'None defined'}

## Requirements
- Create ${input.optionCount} distinct choices
- Each choice must have the complete Stakes Triangle
- Include appropriate consequences for each choice
- Link choices to next scenes where appropriate
- Use conditions if any options should be locked
- Use the choicePoint consequence/reminder guidance when provided

## Outcome Texts (REQUIRED for every choice)

Every choice MUST include \`outcomeTexts\` — three 1–3 sentence narrative passages depicting
the choice enacted in the fiction. They are selected at play time by the skill check tier.
Write them in second person, present tense, grounded in the specific scene:

- **success**: The action lands cleanly. The protagonist achieves what they wanted.
- **partial**: A complication arises — partial success, unexpected cost, or a twist.
- **failure**: The action backfires or falls flat. Something goes wrong.

## Reaction Text (REQUIRED for non-branching choices)

Every choice that does NOT branch to a new scene must also include \`reactionText\`:
1–2 sentences showing the world's immediate response AFTER the payoff.
This is the echo, not the action itself. It ends the moment and flows into the next scene.

## Tint Flag (for non-branching choices)

Provide a \`tintFlag\` string like \`"tint:mercy"\`, \`"tint:reckless"\`, \`"tint:cunning"\`,
\`"tint:honest"\`, \`"tint:defiant"\`, etc. that best characterises the tone this choice sets.
Branching choices (those with \`nextSceneId\`) do NOT need a \`tintFlag\`.

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
- **strategic** / **dilemma**: Add \`statCheck\` with skillWeights + difficulty 40–80.

## Required JSON Structure

{
  "beatId": "${input.beatId}",
  "choiceType": "${choicePoint.type}",
  "choices": [
    {
      "id": "choice-1",
      "text": "Choice text here (5-${this.choiceLimits?.maxChoiceWords ?? 15} words)",
      "choiceType": "${choicePoint.type}",
      "consequences": [],
      "nextSceneId": "scene-id-if-branching-or-omit",
      "statCheck": { "attribute": "charm", "difficulty": 55 },
      "consequenceDomain": "relationship",
      "reminderPlan": {
        "immediate": "The ally stiffens at what you said.",
        "shortTerm": "The next scene opens with colder distance.",
        "later": "This choice is named again under pressure."
      },
      "feedbackCue": {
        "echoSummary": "You chose pressure over comfort.",
        "progressSummary": "This changes how they face you next.",
        "checkClass": "dramatic"
      },
      "outcomeTexts": {
        "success": "Vivid 1-3 sentence description of full success.",
        "partial": "Vivid 1-3 sentence description of partial success or complication.",
        "failure": "Vivid 1-3 sentence description of failure or backfire."
      },
      "reactionText": "1-2 sentence world reaction (omit if nextSceneId is set).",
      "tintFlag": "tint:bold",
      "stakesAnnotation": {
        "want": "what player wants",
        "cost": "what they risk",
        "identity": "what it reveals"
      }
    }
  ],
  "overallStakes": {
    "want": "${choicePoint.stakes.want}",
    "cost": "${choicePoint.stakes.cost}",
    "identity": "${choicePoint.stakes.identity}"
  },
  "designNotes": "Your reasoning"
}

CRITICAL REQUIREMENTS:
1. Create exactly ${input.optionCount} unique, meaningful choices
2. The "overallStakes" field is REQUIRED with want, cost, and identity filled in
3. Each choice needs stakesAnnotation with want, cost, and identity
4. Include appropriate consequences (flags, scores, relationships)
5. ${choicePoint.branches ? 'This is a BRANCHING choice point — set nextSceneId on each choice to one of the available next scenes' : 'Only include nextSceneId if this choice should route to a different scene (expression choices must NOT have nextSceneId)'}
6. Every choice MUST have outcomeTexts (success, partial, failure) — original prose, not the choice text
7. Non-branching choices MUST have reactionText and tintFlag
8. relationship/strategic/dilemma choices MUST have statCheck
9. Meaningful choices should include consequenceDomain, reminderPlan, and feedbackCue
10. Return ONLY valid JSON, no markdown, no extra text
`;
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
    if (choiceSet.choices.length < 2) {
      throw new Error('Must have at least 2 choices');
    }

    if (choiceSet.choices.length > 5) {
      throw new Error('Should not have more than 5 choices');
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
        console.warn(
          `[ChoiceAuthor] Relationship choice set "${choiceSet.beatId}" has no relationship ` +
          `consequences on any option. Relationship choices must shift at least one NPC ` +
          `dimension (trust, affection, respect, fear).`
        );
      }
    }

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
    // Auto-assign a default statCheck if the LLM forgot.
    if (choiceSet.choiceType === 'strategic' || choiceSet.choiceType === 'dilemma' || choiceSet.choiceType === 'relationship') {
      const hasStatCheck = choiceSet.choices.some(c => c.statCheck);
      if (!hasStatCheck) {
        const defaultSkill = choiceSet.choiceType === 'relationship' ? 'persuasion'
          : choiceSet.choiceType === 'strategic' ? 'investigation'
          : 'survival';
        const defaultDiff = choiceSet.choiceType === 'dilemma' ? 60 : 50;
        choiceSet.choices[0].statCheck = { skillWeights: { [defaultSkill]: 1.0 }, difficulty: defaultDiff };
        console.warn(
          `[ChoiceAuthor] ${choiceSet.choiceType.toUpperCase()} choice set "${choiceSet.beatId}" ` +
          `had no statCheck — auto-assigned ${defaultSkill}@${defaultDiff} to choice-0.`
        );
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
          con.type === 'setFlag' && con.flag.startsWith('tint:')
        )
      );
      if (!setsTintFlag) {
        console.warn(
          `[ChoiceAuthor] Dilemma choice set "${choiceSet.beatId}" sets no tint flags. ` +
          `Dilemma choices should set tint flags (e.g., {type:"setFlag", flag:"tint:mercy", value:true}) ` +
          `so subsequent scenes can adapt their tone via textVariants.`
        );
      }
    }
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

    // Collect stakes validation issues
    const overallScore = stakesResult.score?.overall;
    if (!stakesResult.passed || (overallScore !== undefined && overallScore < this.minStakesScore)) {
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
      console.log(`[ChoiceAuthor] Stakes validation passed (score: ${overallScore})`);
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
      const response = await this.callLLM([
        { role: 'user', content: revisionPrompt }
      ]);

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
