/**
 * Character Designer Agent
 *
 * The NPC and protagonist specialist responsible for:
 * - Creating compelling character profiles with distinct voices
 * - Designing character arcs that intersect the player journey
 * - Generating dialogue patterns and verbal tics
 * - Maintaining character relationship dynamics
 */

import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse } from './BaseAgent';

// Input types
export interface CharacterDesignerInput {
  // Story context
  storyContext: {
    title: string;
    genre: string;
    tone: string;
    themes: string[];
    userPrompt?: string;
  };

  // Characters to develop
  charactersToCreate: Array<{
    id: string;
    name: string;
    role: 'protagonist' | 'antagonist' | 'ally' | 'neutral' | 'wildcard';
    briefDescription: string;
    importance: 'major' | 'supporting' | 'minor';
  }>;

  // Relationship context
  protagonistId?: string;
  existingCharacters?: CharacterProfile[];

  // World context for grounding
  worldContext: string;
  culturalNotes?: string[];

  // Raw document content for additional context
  rawDocument?: string;

  // Pipeline memory context (optimization hints from prior runs, Claude only)
  memoryContext?: string;
}

// Output types
export type PronounSet = 'he/him' | 'she/her' | 'they/them';

export interface CharacterProfile {
  id: string;
  name: string;
  pronouns: PronounSet; // Character's pronouns for correct narrative usage
  role: string;
  importance: string;

  // Core identity
  overview: string; // 2-3 sentence summary
  fullBackground: string; // Detailed backstory

  // The Want/Fear/Flaw trinity
  want: string; // What they're actively pursuing
  fear: string; // What they're running from
  flaw: string; // What holds them back

  // Personality
  traits: string[]; // 3-5 defining traits
  values: string[]; // What they believe in
  quirks: string[]; // Memorable behaviors

  // Appearance
  physicalDescription: string;
  distinctiveFeatures: string[];
  typicalAttire: string;

  // Voice
  voiceProfile: VoiceProfile;

  // Relationships
  relationships: CharacterRelationship[];

  // Arc potential
  arcPotential: {
    currentState: string;
    possibleGrowth: string;
    possibleFall: string;
    triggerEvents: string[];
  };

  // Gameplay integration
  initialStats?: {
    trust: number;
    affection: number;
    respect: number;
    fear: number;
  };

  // Character skills (for skill checks and encounter advantages)
  skills?: Array<{
    name: string;
    level: number; // 1-100
    description?: string;
  }>;

  // Secret (for narrative reveals)
  hiddenSecret?: string;

  // Brief description for quick reference
  description?: string;

  // Pixar-style character depth (Rule #13: strong opinions)
  pixarDepth?: {
    coreOpinion: string;        // What they believe strongly about
    personalStakes: string;     // Why it matters to them personally
    strongOpinionOn: string;    // Topic they have strong views on
    polarOpposite: string;      // What would be their worst nightmare/opposite
  };
}

export interface VoiceProfile {
  // Speech patterns
  vocabulary: 'simple' | 'educated' | 'technical' | 'poetic' | 'street';
  sentenceLength: 'terse' | 'average' | 'verbose';
  formality: 'casual' | 'neutral' | 'formal';

  // Distinctive elements
  verbalTics: string[]; // "You know what I mean?", "Listen...", etc.
  favoriteExpressions: string[];
  avoidedWords: string[]; // Words they'd never use

  // Emotional tells
  whenHappy: string;
  whenAngry: string;
  whenNervous: string;
  whenLying: string;

  // Sample lines
  greetingExamples: string[];
  farewellExamples: string[];
  underStressExamples: string[];

  // Signature lines (catchphrases or memorable quotes)
  signatureLines?: string[];

  // Dialogue notes for writers
  writingGuidance: string;
}

export interface CharacterRelationship {
  targetId: string;
  targetName: string;
  relationshipType: string; // 'friend' | 'enemy' | 'family' | 'romantic' | 'professional' | 'complicated'

  // Current state
  currentDynamic: string;
  history: string;

  // Tension
  unresolvedIssues: string[];
  potentialConflicts: string[];

  // Evolution potential
  couldBecome: string[];
}

export interface CharacterBible {
  characters: CharacterProfile[];

  // Protagonist reference (for quick access)
  protagonist?: CharacterProfile;

  // Relationship web
  relationshipSummary: string;
  keyDynamics: Array<{
    characters: string[];
    dynamic: string;
    narrativePotential: string;
  }>;

  // Casting notes
  ensembleBalance: string; // Analysis of how characters complement each other
  gaps: string[]; // Character types that might be missing

  // Consistency notes
  voiceDistinctions: string; // How to keep characters from sounding alike
  doNotForget: string[]; // Critical character facts
}

export class CharacterDesigner extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Character Designer', config);
    this.includeSystemPrompt = true;
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Character Designer

You create memorable, consistent, and narratively compelling characters. Every character should feel like a real person with their own inner life, not just a plot device.

## Character Design Principles

### The Want/Fear/Flaw Trinity
Every significant character MUST have:
- **WANT**: An active goal they're pursuing (external motivation)
- **FEAR**: Something they're running from or avoiding (internal motivation)
- **FLAW**: A character weakness that creates conflict (the obstacle)

The best characters have wants, fears, and flaws that conflict with each other.

### Voice Distinction
- Every character must sound DIFFERENT
- Use vocabulary, rhythm, and verbal tics to distinguish
- A reader should identify the speaker without dialogue tags
- Speech patterns reveal background, education, and personality

### Relationship Dynamics
- Characters exist in webs of relationship, not isolation
- Every relationship should have both connection AND tension
- Relationships should be able to change based on player actions
- The most interesting NPCs want something FROM the player

### Show, Don't Tell
- Reveal character through action and dialogue, not description
- Backstory should be implied, not explained
- Let players discover depths over time

## Voice Profile Guidelines

### Vocabulary Levels
- **Simple**: Common words, concrete thinking, direct statements
- **Educated**: Varied vocabulary, abstract concepts, complex sentences
- **Technical**: Jargon-heavy, precise, assumes shared knowledge
- **Poetic**: Metaphorical, rhythmic, emotionally evocative
- **Street**: Slang, contractions, local color

### Verbal Tics
- Filler words: "like", "you know", "basically"
- Sentence starters: "Look,", "Listen,", "Here's the thing..."
- Emphasis patterns: Repetition, intensifiers, understatement
- Unique phrases they return to

### Emotional Tells
Define how speech CHANGES under different emotions:
- Happy: Faster? More animated? More generous?
- Angry: Clipped? Louder? Colder?
- Nervous: Rambling? Quiet? Deflecting?
- Lying: Overly detailed? Vague? Defensive?

## Sample Dialogue Requirements

For each character, provide examples that demonstrate:
1. How they greet someone they like vs. dislike
2. How they say goodbye casually vs. formally
3. How they sound under stress or pressure
4. At least 3 lines that only THIS character would say

## Quality Standards

Before finalizing:
- Would I recognize this character's voice immediately?
- Do they have internal contradictions that create depth?
- Are their relationships complex, not one-dimensional?
- Could they carry a scene on their own?
- Do they serve the story's themes?
`;
  }

  async execute(input: CharacterDesignerInput): Promise<AgentResponse<CharacterBible>> {
    const prompt = this.buildPrompt(input);

    // Debug: Log input characters
    console.log(`[CharacterDesigner] Input characters to create:`,
      input.charactersToCreate.map(c => `${c.id}: "${c.name}" (${c.role})`).join(', ')
    );

    try {
      const response = await this.callLLM([
        { role: 'user', content: prompt }
      ]);

      console.log(`[CharacterDesigner] Received response (${response.length} chars)`);

      let characterBible: CharacterBible;
      try {
        characterBible = this.parseJSON<CharacterBible>(response);
      } catch (parseError) {
        console.error(`[CharacterDesigner] JSON parse failed. Raw response (first 500 chars):`, response.substring(0, 500));
        throw parseError;
      }

      // Debug: Log output characters
      console.log(`[CharacterDesigner] Output characters from LLM:`,
        characterBible.characters?.map(c => `${c.id}: "${c.name}"`).join(', ') || 'none'
      );

      // Normalize arrays that the LLM might return as strings or undefined
      characterBible = this.normalizeCharacterBible(characterBible);

      this.validateCharacterBible(characterBible, input);

      // Run quality checks and attempt revision if needed
      const qualityIssues = this.collectQualityIssues(characterBible, input);
      if (qualityIssues.length > 0) {
        console.log(`[CharacterDesigner] Found ${qualityIssues.length} quality issues, attempting revision...`);
        const revisedBible = await this.executeRevision(input, characterBible, qualityIssues);

        // Re-check quality after revision
        const revisedIssues = this.collectQualityIssues(revisedBible, input);
        if (revisedIssues.length < qualityIssues.length) {
          console.log(`[CharacterDesigner] Revision improved quality: ${qualityIssues.length} -> ${revisedIssues.length} issues`);
          // Re-validate structural requirements
          this.validateCharacterBible(revisedBible, input);
          return {
            success: true,
            data: revisedBible,
            rawResponse: response,
          };
        } else {
          console.log(`[CharacterDesigner] Revision did not improve quality, using original`);
        }
      }

      return {
        success: true,
        data: characterBible,
        rawResponse: response,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[CharacterDesigner] Error:`, errorMsg);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  private buildPrompt(input: CharacterDesignerInput): string {
    const characterList = input.charactersToCreate
      .map(c => `- ID: "${c.id}", Name: "${c.name}", Role: ${c.role}, Importance: ${c.importance}\n  Description: ${c.briefDescription}`)
      .join('\n');

    const characterIds = input.charactersToCreate.map(c => `"${c.id}"`).join(', ');

    const existingList = input.existingCharacters
      ? input.existingCharacters.map(c => `- ${c.name}: ${c.overview}`).join('\n')
      : 'None yet';

    return `
Create character profiles for this story. Keep descriptions CONCISE (1-2 sentences each).

## Story Context
- **Title**: ${input.storyContext.title}
- **Genre**: ${input.storyContext.genre}
- **Tone**: ${input.storyContext.tone}
- **Themes**: ${input.storyContext.themes.join(', ')}
${input.storyContext.userPrompt ? `- **User Instructions/Prompt**: ${input.storyContext.userPrompt}\n` : ''}

## World Context
${input.worldContext}
${input.rawDocument ? `
## Original Source Document (Reference for Additional Context)
Use this to extract character details, personalities, relationships, or backstory mentioned in the original document:

${input.rawDocument.substring(0, 3000)}${input.rawDocument.length > 3000 ? '\n... (truncated)' : ''}
` : ''}${input.memoryContext ? `
## Pipeline Memory (Insights from Prior Generations)
${input.memoryContext}
` : ''}
## Characters to Create (MUST use these exact IDs: ${characterIds})
${characterList}

## Required JSON Structure

{
  "characters": [
    {
      "id": "EXACT_ID_FROM_INPUT",
      "name": "Character Name",
      "pronouns": "he/him OR she/her (use they/them ONLY if character is explicitly non-binary or transgender)",
      "overview": "One sentence summary",
      "role": "protagonist/antagonist/ally/neutral",
      "importance": "major/supporting/minor",
      "physicalDescription": "Brief appearance",
      "want": "What they desire most",
      "fear": "What they're afraid of",
      "flaw": "Their key weakness",
      "voiceProfile": {
        "vocabularyLevel": "simple/moderate/sophisticated",
        "speechPattern": "How they talk",
        "verbalTics": ["tic 1"],
        "emotionalTendency": "How they express emotion",
        "greetingExamples": ["Hello example 1", "Hello example 2"],
        "farewellExamples": ["Goodbye example 1"],
        "underStressExamples": ["Stressed line 1"],
        "signatureLines": ["Unique line 1", "Unique line 2", "Unique line 3"]
      },
      "relationships": [{"characterId": "other-id", "type": "friend/rival/etc", "description": "brief"}],
      "arcPotential": {"growth": "How they could grow", "fall": "How they could fall"},
      "secrets": ["One secret"]
    }
  ],
  "relationshipSummary": "Brief overview of how characters relate",
  "keyDynamics": [{"characters": ["id1", "id2"], "dynamic": "brief", "narrativePotential": "brief"}],
  "ensembleBalance": "How characters complement each other",
  "gaps": ["Any missing character types"],
  "voiceDistinctions": "How to keep characters sounding distinct from each other",
  "doNotForget": ["Critical character facts to remember"]
}

CRITICAL REQUIREMENTS:
1. Each character "id" MUST be EXACTLY one of: ${characterIds}
2. Each character MUST have "pronouns" set to "he/him" or "she/her". Only use "they/them" if the character is explicitly non-binary or transgender. Default to he/him or she/her based on the character's identity.
3. Each character MUST have want, fear, and flaw filled in
4. Each voiceProfile MUST have at least 2 greetingExamples and 3 signatureLines
5. MUST include "voiceDistinctions" at the top level (not nested)
6. Keep ALL descriptions concise - one sentence each
7. Return ONLY valid JSON, no markdown, no extra text
`;
  }

  private normalizeCharacterBible(bible: CharacterBible): CharacterBible {
    // Top-level arrays
    if (!bible.characters) {
      bible.characters = [];
    } else if (!Array.isArray(bible.characters)) {
      bible.characters = [bible.characters as unknown as CharacterProfile];
    }

    if (!bible.keyDynamics) {
      bible.keyDynamics = [];
    } else if (!Array.isArray(bible.keyDynamics)) {
      bible.keyDynamics = [bible.keyDynamics as unknown as { characters: string[]; dynamic: string; narrativePotential: string }];
    }

    if (!bible.gaps) {
      bible.gaps = [];
    } else if (!Array.isArray(bible.gaps)) {
      bible.gaps = [bible.gaps as unknown as string];
    }

    if (!bible.doNotForget) {
      bible.doNotForget = [];
    } else if (!Array.isArray(bible.doNotForget)) {
      bible.doNotForget = [bible.doNotForget as unknown as string];
    }

    // Normalize each character's arrays
    for (const character of bible.characters) {
      if (!character.traits) {
        character.traits = [];
      } else if (!Array.isArray(character.traits)) {
        character.traits = [character.traits as unknown as string];
      }

      if (!character.values) {
        character.values = [];
      } else if (!Array.isArray(character.values)) {
        character.values = [character.values as unknown as string];
      }

      if (!character.quirks) {
        character.quirks = [];
      } else if (!Array.isArray(character.quirks)) {
        character.quirks = [character.quirks as unknown as string];
      }

      if (!character.distinctiveFeatures) {
        character.distinctiveFeatures = [];
      } else if (!Array.isArray(character.distinctiveFeatures)) {
        character.distinctiveFeatures = [character.distinctiveFeatures as unknown as string];
      }

      const validPronouns: PronounSet[] = ['he/him', 'she/her', 'they/them'];
      if (!character.pronouns || !validPronouns.includes(character.pronouns)) {
        const desc = (character.physicalDescription || character.overview || '').toLowerCase();
        const name = (character.name || '').toLowerCase();
        if (desc.includes(' she ') || desc.includes(' her ') || desc.includes('woman') || desc.includes('girl') || desc.includes('female') || desc.includes('queen') || desc.includes('princess') || desc.includes('duchess') || desc.includes('goddess') || desc.includes('mother') || desc.includes('sister') || desc.includes('wife') || desc.includes('daughter')) {
          character.pronouns = 'she/her';
        } else if (desc.includes(' he ') || desc.includes(' his ') || desc.includes(' him ') || desc.includes('man') || desc.includes('boy') || desc.includes('male') || desc.includes('king') || desc.includes('prince') || desc.includes('duke') || desc.includes('god') || desc.includes('father') || desc.includes('brother') || desc.includes('husband') || desc.includes('son')) {
          character.pronouns = 'he/him';
        } else if (desc.includes('non-binary') || desc.includes('nonbinary') || desc.includes('trans') || desc.includes('genderqueer') || desc.includes('genderfluid') || desc.includes('agender')) {
          character.pronouns = 'they/them';
        } else {
          character.pronouns = 'he/him';
        }
      }

      if (!character.relationships) {
        character.relationships = [];
      } else if (!Array.isArray(character.relationships)) {
        character.relationships = [character.relationships as unknown as CharacterRelationship];
      }

      // Normalize voice profile arrays
      if (character.voiceProfile) {
        const voice = character.voiceProfile;

        if (!voice.verbalTics) {
          voice.verbalTics = [];
        } else if (!Array.isArray(voice.verbalTics)) {
          voice.verbalTics = [voice.verbalTics as unknown as string];
        }

        if (!voice.favoriteExpressions) {
          voice.favoriteExpressions = [];
        } else if (!Array.isArray(voice.favoriteExpressions)) {
          voice.favoriteExpressions = [voice.favoriteExpressions as unknown as string];
        }

        if (!voice.avoidedWords) {
          voice.avoidedWords = [];
        } else if (!Array.isArray(voice.avoidedWords)) {
          voice.avoidedWords = [voice.avoidedWords as unknown as string];
        }

        if (!voice.greetingExamples) {
          voice.greetingExamples = [];
        } else if (!Array.isArray(voice.greetingExamples)) {
          voice.greetingExamples = [voice.greetingExamples as unknown as string];
        }

        if (!voice.farewellExamples) {
          voice.farewellExamples = [];
        } else if (!Array.isArray(voice.farewellExamples)) {
          voice.farewellExamples = [voice.farewellExamples as unknown as string];
        }

        if (!voice.underStressExamples) {
          voice.underStressExamples = [];
        } else if (!Array.isArray(voice.underStressExamples)) {
          voice.underStressExamples = [voice.underStressExamples as unknown as string];
        }
      }

      // Normalize arc potential
      if (character.arcPotential) {
        if (!character.arcPotential.triggerEvents) {
          character.arcPotential.triggerEvents = [];
        } else if (!Array.isArray(character.arcPotential.triggerEvents)) {
          character.arcPotential.triggerEvents = [character.arcPotential.triggerEvents as unknown as string];
        }
      }

      // Normalize relationship arrays
      for (const rel of character.relationships) {
        if (!rel.unresolvedIssues) {
          rel.unresolvedIssues = [];
        } else if (!Array.isArray(rel.unresolvedIssues)) {
          rel.unresolvedIssues = [rel.unresolvedIssues as unknown as string];
        }

        if (!rel.potentialConflicts) {
          rel.potentialConflicts = [];
        } else if (!Array.isArray(rel.potentialConflicts)) {
          rel.potentialConflicts = [rel.potentialConflicts as unknown as string];
        }

        if (!rel.couldBecome) {
          rel.couldBecome = [];
        } else if (!Array.isArray(rel.couldBecome)) {
          rel.couldBecome = [rel.couldBecome as unknown as string];
        }
      }
    }

    // Normalize keyDynamics character arrays
    for (const dynamic of bible.keyDynamics) {
      if (!dynamic.characters) {
        dynamic.characters = [];
      } else if (!Array.isArray(dynamic.characters)) {
        dynamic.characters = [dynamic.characters as unknown as string];
      }
    }

    return bible;
  }

  private validateCharacterBible(bible: CharacterBible, input: CharacterDesignerInput): void {
    console.log(`[CharacterDesigner] Validating character bible...`);
    console.log(`[CharacterDesigner] Requested IDs:`, input.charactersToCreate.map(c => c.id).join(', '));
    console.log(`[CharacterDesigner] Received IDs:`, bible.characters?.map(c => c.id).join(', ') || 'none');

    // Check we have characters
    if (!bible.characters || bible.characters.length === 0) {
      throw new Error('Character bible must have at least 1 character');
    }

    // Check all requested characters are present
    const characterIds = new Set(bible.characters.map(c => c.id));
    for (const requested of input.charactersToCreate) {
      if (!characterIds.has(requested.id)) {
        throw new Error(`Missing requested character: ${requested.id}. Requested: [${input.charactersToCreate.map(c => c.id).join(', ')}]. Received: [${Array.from(characterIds).join(', ')}]`);
      }
    }

    // Validate each character
    for (const character of bible.characters) {
      // Must have Want/Fear/Flaw
      if (!character.want || !character.fear || !character.flaw) {
        throw new Error(`Character ${character.id} missing Want/Fear/Flaw trinity`);
      }

      // Must have voice profile
      if (!character.voiceProfile) {
        throw new Error(`Character ${character.id} missing voice profile`);
      }

      // Voice profile must have sample lines
      const voice = character.voiceProfile;
      if (!voice.greetingExamples || voice.greetingExamples.length < 2) {
        throw new Error(`Character ${character.id} needs more greeting examples`);
      }
    }

    // Check for voice distinction notes
    if (!bible.voiceDistinctions) {
      throw new Error('Character bible must include voice distinction notes');
    }
  }

  /**
   * Collect quality issues that could be improved (beyond structural validation)
   */
  private collectQualityIssues(bible: CharacterBible, input: CharacterDesignerInput): string[] {
    const issues: string[] = [];

    for (const character of bible.characters) {
      // Check Want/Fear/Flaw depth
      if (character.want && character.want.length < 15) {
        issues.push(`CHARACTER "${character.name}": WANT is too brief (${character.want.length} chars). Make it more specific.`);
      }
      if (character.fear && character.fear.length < 15) {
        issues.push(`CHARACTER "${character.name}": FEAR is too brief (${character.fear.length} chars). Make it more specific.`);
      }
      if (character.flaw && character.flaw.length < 15) {
        issues.push(`CHARACTER "${character.name}": FLAW is too brief (${character.flaw.length} chars). Make it more specific.`);
      }

      // Check voice profile completeness
      const voice = character.voiceProfile;
      if (voice) {
        if (!voice.verbalTics || voice.verbalTics.length < 1) {
          issues.push(`CHARACTER "${character.name}": Missing verbal tics. What phrases do they repeat?`);
        }
        if (!voice.underStressExamples || voice.underStressExamples.length < 1) {
          issues.push(`CHARACTER "${character.name}": Missing "under stress" examples. How do they talk when pressured?`);
        }
        if (!voice.farewellExamples || voice.farewellExamples.length < 1) {
          issues.push(`CHARACTER "${character.name}": Missing farewell examples. How do they say goodbye?`);
        }
        // Check for signature lines (important for voice distinction)
        const signatureLines = (voice as any).signatureLines;
        if (!signatureLines || signatureLines.length < 3) {
          issues.push(`CHARACTER "${character.name}": Needs at least 3 signature lines that only THIS character would say.`);
        }
      }

      // Check for relationships (major characters should have them)
      const requestedChar = input.charactersToCreate.find(c => c.id === character.id);
      if (requestedChar?.importance === 'major') {
        if (!character.relationships || character.relationships.length < 1) {
          issues.push(`CHARACTER "${character.name}": Major character should have at least 1 defined relationship.`);
        }
      }

      // Check arc potential
      if (!character.arcPotential) {
        issues.push(`CHARACTER "${character.name}": Missing arc potential. How could they grow or fall?`);
      } else {
        if (!character.arcPotential.possibleGrowth && !(character.arcPotential as any).growth) {
          issues.push(`CHARACTER "${character.name}": Arc potential missing growth path. How could they become better?`);
        }
        if (!character.arcPotential.possibleFall && !(character.arcPotential as any).fall) {
          issues.push(`CHARACTER "${character.name}": Arc potential missing fall path. How could they become worse?`);
        }
      }

      // Check physical description
      if (!character.physicalDescription || character.physicalDescription.length < 20) {
        issues.push(`CHARACTER "${character.name}": Physical description is too brief. Add distinctive visual details.`);
      }
    }

    // Check key dynamics
    if (!bible.keyDynamics || bible.keyDynamics.length < 1) {
      issues.push(`ENSEMBLE: Missing key dynamics between characters.`);
    }

    // Check ensemble balance analysis
    if (!bible.ensembleBalance || bible.ensembleBalance.length < 20) {
      issues.push(`ENSEMBLE: Missing or brief ensemble balance analysis.`);
    }

    return issues;
  }

  /**
   * Execute a revision pass to fix identified quality issues
   */
  private async executeRevision(
    input: CharacterDesignerInput,
    originalBible: CharacterBible,
    issues: string[]
  ): Promise<CharacterBible> {
    console.log(`[CharacterDesigner] Executing revision to fix ${issues.length} quality issues`);

    const issueList = issues.map((issue, i) => `${i + 1}. ${issue}`).join('\n');

    const revisionPrompt = `
You previously created a character bible, but there are quality issues that need improvement.

## Original Character Bible
\`\`\`json
${JSON.stringify(originalBible, null, 2)}
\`\`\`

## Issues to Fix
${issueList}

## Story Context
- **Title**: ${input.storyContext.title}
- **Genre**: ${input.storyContext.genre}
- **Tone**: ${input.storyContext.tone}
- **Themes**: ${input.storyContext.themes.join(', ')}

## How to Fix

### WANT/FEAR/FLAW Issues
- WANT: What do they actively desire? Make it specific and concrete.
- FEAR: What are they running from or avoiding? Make it emotionally resonant.
- FLAW: What personal weakness creates conflict? Make it impactful.

### VOICE PROFILE Issues
- Add verbal tics (phrases they repeat)
- Add under-stress examples (how they sound when pressured)
- Add farewell examples (how they say goodbye)
- Add signature lines (unique phrases ONLY this character would say)

### RELATIONSHIP Issues
- Define relationships with other characters
- Include both current dynamic and history
- Note unresolved issues and potential conflicts

### ARC POTENTIAL Issues
- Define growth path (how they could become better)
- Define fall path (how they could become worse)
- Include trigger events that could cause change

## Requirements
Return a REVISED CharacterBible JSON that fixes all the issues above.
Keep all existing content but improve the flagged areas.
Return ONLY valid JSON, no markdown, no extra text.
`;

    try {
      const response = await this.callLLM([
        { role: 'user', content: revisionPrompt }
      ]);

      console.log(`[CharacterDesigner] Received revision response (${response.length} chars)`);

      let revisedBible: CharacterBible;
      try {
        revisedBible = this.parseJSON<CharacterBible>(response);
        revisedBible = this.normalizeCharacterBible(revisedBible);
        console.log(`[CharacterDesigner] Revision complete`);
        return revisedBible;
      } catch (parseError) {
        console.error(`[CharacterDesigner] Revision JSON parse failed, using original`);
        return originalBible;
      }
    } catch (error) {
      console.error(`[CharacterDesigner] Revision failed, using original:`, error);
      return originalBible;
    }
  }
}
