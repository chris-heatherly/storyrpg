/**
 * World Builder Agent
 *
 * The setting and lore specialist responsible for:
 * - Creating rich, immersive location descriptions
 * - Maintaining world bible consistency
 * - Generating faction dynamics and political tensions
 * - Designing discoverable lore elements
 */

import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse } from './BaseAgent';

// Input types
export interface WorldBuilderInput {
  // Story context
  storyContext: {
    title: string;
    genre: string;
    tone: string;
    synopsis: string;
    userPrompt?: string;
  };

  // World foundation
  worldPremise: string;
  timePeriod: string;
  technologyLevel: string;
  magicSystem?: string;

  // Locations to develop
  locationsToCreate: Array<{
    id: string;
    name: string;
    type: string; // 'city' | 'wilderness' | 'building' | 'room' | etc.
    briefDescription: string;
    importance: 'major' | 'minor' | 'backdrop';
  }>;

  // Existing world elements (for consistency)
  existingLocations?: LocationDetails[];
  existingFactions?: FactionDetails[];
  establishedLore?: string[];

  // Raw document content for additional context
  rawDocument?: string;

  // Pipeline memory / optimization hints from prior runs (optional)
  memoryContext?: string;
}

// Output types
export interface LocationDetails {
  id: string;
  name: string;
  type: string;

  // Descriptions at different detail levels
  overview: string; // 1-2 sentences for quick reference
  fullDescription: string; // 2-3 paragraphs for scene setting
  sensoryDetails: {
    sights: string[];
    sounds: string[];
    smells: string[];
    textures: string[];
    atmosphere: string;
  };

  // Narrative hooks
  secrets: string[]; // Hidden things players might discover
  dangers: string[]; // Potential threats
  opportunities: string[]; // Resources or advantages

  // Connections
  connectedLocations: string[];
  dominantFaction?: string;

  // State variations
  timeOfDayVariations?: {
    day: string;
    night: string;
    dawn?: string;
    dusk?: string;
  };

  weatherVariations?: {
    clear: string;
    rain: string;
    storm?: string;
  };
}

// Alias for backwards compatibility
export type Location = LocationDetails;

export interface FactionDetails {
  id: string;
  name: string;
  type: string; // 'political' | 'criminal' | 'religious' | 'commercial' | etc.

  // Core identity
  overview: string;
  goals: string[];
  methods: string[];
  values: string[];

  // Structure
  leaderDescription: string;
  memberProfile: string;
  hierarchy: string;

  // Relationships
  allies: string[];
  enemies: string[];
  neutralRelations: string[];

  // Player interaction
  howToJoin?: string;
  benefits?: string[];
  obligations?: string[];

  // Presence
  territories: string[];
  symbols: string[];
  recognition: string; // How to identify members
}

export interface WorldBible {
  // Core rules
  worldRules: string[]; // "Magic requires spoken words", "The dead don't stay dead", etc.
  taboos: string[]; // Things that don't exist or aren't done in this world

  // History
  majorEvents: Array<{
    name: string;
    description: string;
    yearsAgo: string;
    impact: string;
  }>;

  // Locations
  locations: LocationDetails[];

  // Factions
  factions: FactionDetails[];

  // Culture
  customs: string[];
  beliefs: string[];
  tensions: string[]; // Ongoing conflicts or controversies

  // Consistency notes
  doNotForget: string[]; // Critical details that must remain consistent
}

export class WorldBuilder extends BaseAgent {
  constructor(config: AgentConfig) {
    super('World Builder', config);
    this.includeSystemPrompt = true;
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: World Builder

You create rich, consistent, and evocative settings that serve the story. Every location should feel real, lived-in, and full of narrative potential.

## World Building Principles

### Emergent Worldbuilding
- History should be revealed through play, not exposition dumps
- Show culture through details: what people eat, how they greet, what they fear
- Let players discover the world rather than being told about it

### Environmental Storytelling
- Every location tells a story through its details
- The scratches on the doorframe, the worn path in the carpet, the missing portrait
- Imply depth without explaining everything

### Consistent Rule Systems
- Magic, technology, and society must follow internal logic
- If something breaks the rules, it should be significant
- Players should be able to predict how the world works

### Sensory Immersion
- Engage all five senses in every location
- Sound and smell are often more evocative than sight
- Atmosphere is more important than architecture

## Location Design

### For Each Location, Consider:
1. **History**: What happened here? What traces remain?
2. **Function**: What is this place FOR? Who uses it?
3. **Atmosphere**: What FEELING should this evoke?
4. **Secrets**: What isn't immediately obvious?
5. **Connections**: How does this relate to other places?

### Sensory Details
- SIGHTS: Lighting, colors, movement, notable objects
- SOUNDS: Background noise, silence, echoes, voices
- SMELLS: Pleasant, unpleasant, distinctive, memories they evoke
- TEXTURES: What would you feel if you touched things?
- ATMOSPHERE: The emotional weight of the space

## Faction Design

### Every Faction Needs:
1. **Clear Goals**: What do they want? Why?
2. **Methods**: How do they pursue their goals?
3. **Internal Logic**: Why do members join and stay?
4. **Visibility**: How would players recognize them?
5. **Tension**: What conflicts do they create?

## Consistency Rules

- Track established facts and never contradict them
- If the sun sets in the west in Scene 1, it sets in the west forever
- Names, dates, and relationships must remain stable
- Note anything that future content must remember

## Quality Standards

Before finalizing:
- Would I want to explore this place?
- Does it feel real and lived-in?
- Are there layers to discover?
- Does it serve the story's themes?
- Is it internally consistent?
`;
  }

  async execute(input: WorldBuilderInput): Promise<AgentResponse<WorldBible>> {
    const prompt = this.buildPrompt(input);

    // Debug: Log input locations
    console.log(`[WorldBuilder] Input locations to create:`,
      input.locationsToCreate.map(l => `${l.id}: "${l.name}" (${l.importance})`).join(', ')
    );

    try {
      const response = await this.callLLM([
        { role: 'user', content: prompt }
      ]);

      // Debug: Log raw response length
      console.log(`[WorldBuilder] Received response (${response.length} chars)`);

      let worldBible: WorldBible;
      try {
        worldBible = this.parseJSON<WorldBible>(response);
      } catch (parseError) {
        console.error(`[WorldBuilder] JSON parse failed. Raw response (first 500 chars):`, response.substring(0, 500));
        throw parseError;
      }

      // Debug: Log output locations before validation
      console.log(`[WorldBuilder] Output locations from LLM:`,
        worldBible.locations?.map(l => `${l.id}: "${l.name}" (desc: ${l.fullDescription?.length || 0} chars)`).join(', ') || 'none'
      );

      // Debug: If locations have undefined IDs, log the raw location data
      if (worldBible.locations?.some(l => !l.id)) {
        console.error(`[WorldBuilder] WARNING: Some locations have undefined IDs!`);
        console.error(`[WorldBuilder] Raw locations data:`, JSON.stringify(worldBible.locations, null, 2).substring(0, 1000));
      }

      // Normalize arrays that the LLM might return as strings or undefined
      worldBible = this.normalizeWorldBible(worldBible);

      // Check for missing locations and retry if needed
      if (input.locationsToCreate && input.locationsToCreate.length > 0) {
        const receivedIds = new Set(worldBible.locations?.map(l => l.id) || []);
        const missingLocations = input.locationsToCreate.filter(loc => !receivedIds.has(loc.id));

        if (missingLocations.length > 0) {
          console.log(`[WorldBuilder] Missing ${missingLocations.length} locations, retrying for: ${missingLocations.map(l => l.id).join(', ')}`);

          // Retry for missing locations
          const additionalLocations = await this.fetchMissingLocations(
            missingLocations,
            input,
            worldBible
          );

          // Merge the additional locations
          worldBible.locations = [...(worldBible.locations || []), ...additionalLocations];
          console.log(`[WorldBuilder] After retry, total locations: ${worldBible.locations.length}`);
        }
      }

      this.validateWorldBible(worldBible, input);

      // Run quality checks and attempt revision if needed
      const qualityIssues = this.collectQualityIssues(worldBible);
      if (qualityIssues.length > 0) {
        console.log(`[WorldBuilder] Found ${qualityIssues.length} quality issues, attempting revision...`);
        const revisedBible = await this.executeRevision(input, worldBible, qualityIssues);

        // Re-check quality after revision
        const revisedIssues = this.collectQualityIssues(revisedBible);
        if (revisedIssues.length < qualityIssues.length) {
          console.log(`[WorldBuilder] Revision improved quality: ${qualityIssues.length} -> ${revisedIssues.length} issues`);
          // Re-validate structural requirements
          this.validateWorldBible(revisedBible, input);
          return {
            success: true,
            data: revisedBible,
            rawResponse: response,
          };
        } else {
          console.log(`[WorldBuilder] Revision did not improve quality, using original`);
        }
      }

      return {
        success: true,
        data: worldBible,
        rawResponse: response,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[WorldBuilder] Error:`, errorMsg);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Fetch missing locations with a follow-up LLM call
   */
  private async fetchMissingLocations(
    missingLocations: WorldBuilderInput['locationsToCreate'],
    input: WorldBuilderInput,
    existingBible: WorldBible
  ): Promise<WorldBible['locations']> {
    const locationList = missingLocations
      .map(loc => `- ID: "${loc.id}", Name: "${loc.name}", Type: ${loc.type}, Importance: ${loc.importance}\n  Description: ${loc.briefDescription}`)
      .join('\n');

    const locationIds = missingLocations.map(loc => `"${loc.id}"`).join(', ');

    const prompt = `
You previously created a world bible but missed some locations. Please create ONLY these specific locations.

## Story Context
- **Title**: ${input.storyContext.title}
- **Genre**: ${input.storyContext.genre}
- **Tone**: ${input.storyContext.tone}

## MISSING LOCATIONS TO CREATE (REQUIRED)
${locationList}

## CRITICAL: You MUST create ALL ${missingLocations.length} locations listed above.
Each location MUST have its "id" set to EXACTLY one of: ${locationIds}

Return ONLY a JSON object with a "locations" array containing these ${missingLocations.length} locations:

{
  "locations": [
    {
      "id": "exact-id-from-list",
      "name": "Location Name",
      "type": "village|forest|castle|etc",
      "fullDescription": "A detailed 2-3 sentence description of this place...",
      "sensoryDetails": {
        "sights": ["detail 1", "detail 2"],
        "sounds": ["detail 1"],
        "smells": ["detail 1"]
      },
      "connections": ["connected-location-id"],
      "secrets": ["hidden detail"]
    }
  ]
}

IMPORTANT: Return EXACTLY ${missingLocations.length} locations with IDs matching: ${locationIds}
`;

    try {
      const response = await this.callLLM([
        { role: 'user', content: prompt }
      ]);

      console.log(`[WorldBuilder] Retry response received (${response.length} chars)`);

      const parsed = this.parseJSON<{ locations: WorldBible['locations'] }>(response);
      const locations = parsed.locations || [];

      console.log(`[WorldBuilder] Retry returned ${locations.length} locations: ${locations.map(l => l.id).join(', ')}`);

      // Normalize each location to match LocationDetails interface
      return locations.map(loc => ({
        ...loc,
        overview: loc.overview || loc.fullDescription?.substring(0, 200) || '',
        sensoryDetails: loc.sensoryDetails || { sights: [], sounds: [], smells: [], textures: [], atmosphere: '' },
        connectedLocations: Array.isArray(loc.connectedLocations) ? loc.connectedLocations : (Array.isArray((loc as any).connections) ? (loc as any).connections : []),
        secrets: Array.isArray(loc.secrets) ? loc.secrets : [],
        dangers: Array.isArray(loc.dangers) ? loc.dangers : [],
        opportunities: Array.isArray(loc.opportunities) ? loc.opportunities : [],
      }));
    } catch (error) {
      console.error(`[WorldBuilder] Retry failed, generating placeholder locations:`, error);

      // Generate placeholder locations as fallback
      return missingLocations.map(loc => ({
        id: loc.id,
        name: loc.name,
        type: loc.type,
        overview: loc.briefDescription,
        fullDescription: `${loc.briefDescription} This ${loc.type} serves as an important location in the story, providing a backdrop for key events and character interactions.`,
        sensoryDetails: {
          sights: [`The ${loc.type} stretches before you`],
          sounds: ['Ambient sounds fill the air'],
          smells: ['A distinctive scent lingers'],
          textures: [],
          atmosphere: `The atmosphere of ${loc.name}`,
        },
        connectedLocations: [],
        secrets: [`There is more to ${loc.name} than meets the eye`],
        dangers: [],
        opportunities: [],
      }));
    }
  }

  private buildPrompt(input: WorldBuilderInput): string {
    const hasLocations = input.locationsToCreate && input.locationsToCreate.length > 0;

    const locationList = hasLocations
      ? input.locationsToCreate
          .map(loc => `- ID: "${loc.id}", Name: "${loc.name}", Type: ${loc.type}, Importance: ${loc.importance}\n  Description: ${loc.briefDescription}`)
          .join('\n')
      : 'None provided - you must CREATE 3-5 appropriate locations based on the story context.';

    const locationIds = hasLocations
      ? input.locationsToCreate.map(loc => `"${loc.id}"`).join(', ')
      : 'You will generate IDs: "location-1", "location-2", "location-3", etc.';

    const existingLore = input.establishedLore
      ? input.establishedLore.map(l => `- ${l}`).join('\n')
      : 'None established yet';

    const locationInstructions = hasLocations
      ? `Each location in the "locations" array MUST have "id" set to EXACTLY one of: ${locationIds}`
      : `You MUST create 3-5 locations appropriate for this ${input.storyContext.genre} story. Use IDs: "location-1", "location-2", "location-3", etc. The first location ("location-1") will be where the story begins.`;

    return `
Create a comprehensive world bible for the following story:

## Story Context
- **Title**: ${input.storyContext.title}
- **Genre**: ${input.storyContext.genre}
- **Tone**: ${input.storyContext.tone}
- **Synopsis**: ${input.storyContext.synopsis}
${input.storyContext.userPrompt ? `- **User Instructions/Prompt**: ${input.storyContext.userPrompt}\n` : ''}

## World Foundation
- **Premise**: ${input.worldPremise}
- **Time Period**: ${input.timePeriod}
- **Technology Level**: ${input.technologyLevel}
${input.magicSystem ? `- **Magic System**: ${input.magicSystem}` : ''}

## Locations
${locationList}

## Established Lore (Must Maintain Consistency)
${existingLore}
${input.rawDocument ? `
## Original Source Document (Reference for Additional Context)
Use this document to extract any additional world details, locations, characters, or lore that might be helpful:

${input.rawDocument.substring(0, 3000)}${input.rawDocument.length > 3000 ? '\n... (truncated)' : ''}
` : ''}${input.memoryContext ? `
## Pipeline Memory (Insights from Prior Generations)
${input.memoryContext}
` : ''}
## Requirements

Create a WorldBible JSON object. Keep descriptions CONCISE but evocative (1-2 sentences each, not paragraphs).

{
  "worldRules": ["rule 1", "rule 2"],
  "taboos": ["taboo 1"],
  "majorEvents": [{"name": "Event", "description": "brief", "yearsAgo": "50", "impact": "brief"}],
  "locations": [
    {
      "id": "location-1",
      "name": "Name",
      "type": "type",
      "overview": "One sentence",
      "fullDescription": "Two to three sentences describing this place. Must be at least 80 characters.",
      "sensoryDetails": {
        "sights": ["sight 1", "sight 2"],
        "sounds": ["sound 1"],
        "smells": ["smell 1"],
        "textures": ["texture 1"],
        "atmosphere": "one phrase"
      },
      "secrets": ["one secret"],
      "dangers": ["one danger"],
      "opportunities": ["one opportunity"],
      "connectedLocations": [],
      "timeOfDayVariations": {"day": "brief", "night": "brief"}
    }
  ],
  "factions": [
    {
      "id": "faction-1",
      "name": "Name",
      "type": "type",
      "overview": "One sentence",
      "goals": ["goal"],
      "methods": ["method"],
      "values": ["value"],
      "leaderDescription": "brief",
      "memberProfile": "brief",
      "hierarchy": "brief",
      "allies": [],
      "enemies": [],
      "neutralRelations": [],
      "territories": [],
      "symbols": ["symbol"],
      "recognition": "brief"
    }
  ],
  "customs": ["custom 1"],
  "beliefs": ["belief 1"],
  "tensions": ["tension 1"],
  "doNotForget": ["fact 1"]
}

CRITICAL REQUIREMENTS:
1. ${locationInstructions}
2. Each location "fullDescription" must be 80-200 characters (2-3 sentences, NOT paragraphs)
3. Each location needs "sensoryDetails" with all 5 senses
4. Create exactly 3 locations and 2 factions (no more)
5. Keep ALL text concise - quality over quantity
6. IDs must be strings: "location-1", "faction-1", etc.

Respond with ONLY valid JSON, no markdown, no extra text.
`;
  }

  private normalizeWorldBible(bible: WorldBible): WorldBible {
    // Top-level arrays
    if (!bible.worldRules) {
      bible.worldRules = [];
    } else if (!Array.isArray(bible.worldRules)) {
      bible.worldRules = [bible.worldRules as unknown as string];
    }

    if (!bible.taboos) {
      bible.taboos = [];
    } else if (!Array.isArray(bible.taboos)) {
      bible.taboos = [bible.taboos as unknown as string];
    }

    if (!bible.majorEvents) {
      bible.majorEvents = [];
    } else if (!Array.isArray(bible.majorEvents)) {
      bible.majorEvents = [bible.majorEvents as unknown as { name: string; description: string; yearsAgo: string; impact: string }];
    }

    if (!bible.locations) {
      bible.locations = [];
    } else if (!Array.isArray(bible.locations)) {
      bible.locations = [bible.locations as unknown as LocationDetails];
    }

    if (!bible.factions) {
      bible.factions = [];
    } else if (!Array.isArray(bible.factions)) {
      bible.factions = [bible.factions as unknown as FactionDetails];
    }

    if (!bible.customs) {
      bible.customs = [];
    } else if (!Array.isArray(bible.customs)) {
      bible.customs = [bible.customs as unknown as string];
    }

    if (!bible.beliefs) {
      bible.beliefs = [];
    } else if (!Array.isArray(bible.beliefs)) {
      bible.beliefs = [bible.beliefs as unknown as string];
    }

    if (!bible.tensions) {
      bible.tensions = [];
    } else if (!Array.isArray(bible.tensions)) {
      bible.tensions = [bible.tensions as unknown as string];
    }

    if (!bible.doNotForget) {
      bible.doNotForget = [];
    } else if (!Array.isArray(bible.doNotForget)) {
      bible.doNotForget = [bible.doNotForget as unknown as string];
    }

    // Normalize location arrays
    for (const location of bible.locations) {
      if (!location.secrets) {
        location.secrets = [];
      } else if (!Array.isArray(location.secrets)) {
        location.secrets = [location.secrets as unknown as string];
      }

      if (!location.dangers) {
        location.dangers = [];
      } else if (!Array.isArray(location.dangers)) {
        location.dangers = [location.dangers as unknown as string];
      }

      if (!location.opportunities) {
        location.opportunities = [];
      } else if (!Array.isArray(location.opportunities)) {
        location.opportunities = [location.opportunities as unknown as string];
      }

      if (!location.connectedLocations) {
        location.connectedLocations = [];
      } else if (!Array.isArray(location.connectedLocations)) {
        location.connectedLocations = [location.connectedLocations as unknown as string];
      }

      // Normalize sensory details
      if (!location.sensoryDetails) {
        location.sensoryDetails = {
          sights: [],
          sounds: [],
          smells: [],
          textures: [],
          atmosphere: ''
        };
      } else {
        if (!location.sensoryDetails.sights) {
          location.sensoryDetails.sights = [];
        } else if (!Array.isArray(location.sensoryDetails.sights)) {
          location.sensoryDetails.sights = [location.sensoryDetails.sights as unknown as string];
        }
        if (!location.sensoryDetails.sounds) {
          location.sensoryDetails.sounds = [];
        } else if (!Array.isArray(location.sensoryDetails.sounds)) {
          location.sensoryDetails.sounds = [location.sensoryDetails.sounds as unknown as string];
        }
        if (!location.sensoryDetails.smells) {
          location.sensoryDetails.smells = [];
        } else if (!Array.isArray(location.sensoryDetails.smells)) {
          location.sensoryDetails.smells = [location.sensoryDetails.smells as unknown as string];
        }
        if (!location.sensoryDetails.textures) {
          location.sensoryDetails.textures = [];
        } else if (!Array.isArray(location.sensoryDetails.textures)) {
          location.sensoryDetails.textures = [location.sensoryDetails.textures as unknown as string];
        }
      }
    }

    // Normalize faction arrays
    for (const faction of bible.factions) {
      if (!faction.goals) {
        faction.goals = [];
      } else if (!Array.isArray(faction.goals)) {
        faction.goals = [faction.goals as unknown as string];
      }

      if (!faction.methods) {
        faction.methods = [];
      } else if (!Array.isArray(faction.methods)) {
        faction.methods = [faction.methods as unknown as string];
      }

      if (!faction.values) {
        faction.values = [];
      } else if (!Array.isArray(faction.values)) {
        faction.values = [faction.values as unknown as string];
      }

      if (!faction.allies) {
        faction.allies = [];
      } else if (!Array.isArray(faction.allies)) {
        faction.allies = [faction.allies as unknown as string];
      }

      if (!faction.enemies) {
        faction.enemies = [];
      } else if (!Array.isArray(faction.enemies)) {
        faction.enemies = [faction.enemies as unknown as string];
      }

      if (!faction.neutralRelations) {
        faction.neutralRelations = [];
      } else if (!Array.isArray(faction.neutralRelations)) {
        faction.neutralRelations = [faction.neutralRelations as unknown as string];
      }

      if (!faction.territories) {
        faction.territories = [];
      } else if (!Array.isArray(faction.territories)) {
        faction.territories = [faction.territories as unknown as string];
      }

      if (!faction.symbols) {
        faction.symbols = [];
      } else if (!Array.isArray(faction.symbols)) {
        faction.symbols = [faction.symbols as unknown as string];
      }

      if (faction.benefits && !Array.isArray(faction.benefits)) {
        faction.benefits = [faction.benefits as unknown as string];
      }

      if (faction.obligations && !Array.isArray(faction.obligations)) {
        faction.obligations = [faction.obligations as unknown as string];
      }
    }

    return bible;
  }

  private validateWorldBible(bible: WorldBible, input: WorldBuilderInput): void {
    const hasRequestedLocations = input.locationsToCreate && input.locationsToCreate.length > 0;

    // Debug: Log validation start
    console.log(`[WorldBuilder] Validating world bible...`);
    console.log(`[WorldBuilder] Requested location IDs:`, hasRequestedLocations ? input.locationsToCreate.map(l => l.id).join(', ') : '(none - AI generated)');
    console.log(`[WorldBuilder] Received location IDs:`, bible.locations?.map(l => l.id).join(', ') || 'none');

    // Check we have locations
    if (!bible.locations || bible.locations.length === 0) {
      throw new Error('World bible must have at least 1 location');
    }

    // If specific locations were requested, check they are all present
    if (hasRequestedLocations) {
      const locationIds = new Set(bible.locations.map(l => l.id));
      for (const requested of input.locationsToCreate) {
        if (!locationIds.has(requested.id)) {
          throw new Error(`Missing requested location: ${requested.id}. Requested: [${input.locationsToCreate.map(l => l.id).join(', ')}]. Received: [${Array.from(locationIds).join(', ')}]`);
        }
      }
    }

    // Check locations have required fields
    for (const location of bible.locations) {
      // Validate ID exists
      if (!location.id) {
        console.error(`[WorldBuilder] Location missing ID:`, JSON.stringify(location).substring(0, 200));
        throw new Error(`Location "${location.name || 'unnamed'}" is missing an ID`);
      }

      const descLength = location.fullDescription?.length || 0;
      if (!location.fullDescription || descLength < 50) {
        console.error(`[WorldBuilder] Location "${location.id}" has insufficient description (${descLength} chars, need 50+)`);
        console.error(`[WorldBuilder] Description was: "${location.fullDescription || '(empty)'}"`);
        throw new Error(`Location ${location.id} ("${location.name}") has insufficient description: ${descLength} chars (need 50+). Description: "${(location.fullDescription || '').substring(0, 100)}..."`);
      }
      if (!location.sensoryDetails) {
        throw new Error(`Location ${location.id} ("${location.name}") missing sensory details object`);
      }
    }

    // Check we have world rules (warn if fewer than 3, but don't fail)
    if (!bible.worldRules || bible.worldRules.length === 0) {
      throw new Error(`World bible must have at least 1 world rule, got 0`);
    }
    if (bible.worldRules.length < 3) {
      console.warn(`[WorldBuilder] Only ${bible.worldRules.length} world rules returned (expected 3+). Proceeding anyway.`);
    }

    // Check we have factions
    if (!bible.factions || bible.factions.length < 1) {
      throw new Error(`World bible must have at least 1 faction, got ${bible.factions?.length || 0}`);
    }

    console.log(`[WorldBuilder] Validation passed! ${bible.locations.length} locations, ${bible.factions.length} factions`);
  }

  /**
   * Collect quality issues that could be improved (beyond structural validation)
   */
  private collectQualityIssues(bible: WorldBible): string[] {
    const issues: string[] = [];

    // Check location quality
    for (const location of bible.locations) {
      // Check description quality
      const descLength = location.fullDescription?.length || 0;
      if (descLength < 80) {
        issues.push(`LOCATION "${location.name}" (${location.id}): Description is brief (${descLength} chars). Add more evocative detail.`);
      }

      // Check sensory details completeness
      const sensory = location.sensoryDetails;
      if (!sensory.sights || sensory.sights.length < 2) {
        issues.push(`LOCATION "${location.name}": Missing or insufficient visual details (sights). Add at least 2 sights.`);
      }
      if (!sensory.sounds || sensory.sounds.length < 1) {
        issues.push(`LOCATION "${location.name}": Missing sound details. What would you hear here?`);
      }
      if (!sensory.smells || sensory.smells.length < 1) {
        issues.push(`LOCATION "${location.name}": Missing smell details. What would you smell here?`);
      }
      if (!sensory.atmosphere) {
        issues.push(`LOCATION "${location.name}": Missing atmosphere description. What feeling does this place evoke?`);
      }

      // Check narrative hooks
      if (!location.secrets || location.secrets.length < 1) {
        issues.push(`LOCATION "${location.name}": Missing secrets. Add at least one hidden detail players might discover.`);
      }
    }

    // Check faction quality
    for (const faction of bible.factions) {
      if (!faction.goals || faction.goals.length < 1) {
        issues.push(`FACTION "${faction.name}": Missing goals. What does this faction want?`);
      }
      if (!faction.methods || faction.methods.length < 1) {
        issues.push(`FACTION "${faction.name}": Missing methods. How does this faction pursue its goals?`);
      }
      if (!faction.symbols || faction.symbols.length < 1) {
        issues.push(`FACTION "${faction.name}": Missing symbols. How would you recognize a member?`);
      }
    }

    // Check world rules quality
    if (bible.worldRules.length < 5) {
      issues.push(`WORLD RULES: Only ${bible.worldRules.length} rules. Consider adding more to establish world consistency.`);
    }

    // Check for do-not-forget items
    if (!bible.doNotForget || bible.doNotForget.length < 2) {
      issues.push(`CONSISTENCY: Add more "doNotForget" items to track critical world facts.`);
    }

    return issues;
  }

  /**
   * Execute a revision pass to fix identified quality issues
   */
  private async executeRevision(
    input: WorldBuilderInput,
    originalBible: WorldBible,
    issues: string[]
  ): Promise<WorldBible> {
    console.log(`[WorldBuilder] Executing revision to fix ${issues.length} quality issues`);

    const issueList = issues.map((issue, i) => `${i + 1}. ${issue}`).join('\n');

    const revisionPrompt = `
You previously created a world bible, but there are quality issues that need improvement.

## Original World Bible
\`\`\`json
${JSON.stringify(originalBible, null, 2)}
\`\`\`

## Issues to Fix
${issueList}

## Story Context
- **Title**: ${input.storyContext.title}
- **Genre**: ${input.storyContext.genre}
- **Tone**: ${input.storyContext.tone}

## How to Fix

### LOCATION Issues
- Add richer descriptions (aim for 80-150 characters)
- Ensure ALL sensory details are filled: sights (2+), sounds (1+), smells (1+), atmosphere
- Add secrets (hidden details players might discover)
- Make each location feel unique and lived-in

### FACTION Issues
- Add clear goals (what do they want?)
- Add methods (how do they operate?)
- Add symbols (how to recognize them)

### WORLD RULES Issues
- Add rules that define how the world works
- Include both possibilities and limitations

## Requirements
Return a REVISED WorldBible JSON that fixes all the issues above.
Keep all existing content but improve the flagged areas.
Return ONLY valid JSON, no markdown, no extra text.
`;

    try {
      const response = await this.callLLM([
        { role: 'user', content: revisionPrompt }
      ]);

      console.log(`[WorldBuilder] Received revision response (${response.length} chars)`);

      let revisedBible: WorldBible;
      try {
        revisedBible = this.parseJSON<WorldBible>(response);
        revisedBible = this.normalizeWorldBible(revisedBible);
        console.log(`[WorldBuilder] Revision complete`);
        return revisedBible;
      } catch (parseError) {
        console.error(`[WorldBuilder] Revision JSON parse failed, using original`);
        return originalBible;
      }
    } catch (error) {
      console.error(`[WorldBuilder] Revision failed, using original:`, error);
      return originalBible;
    }
  }
}
