import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  containsSchemaPlaceholder,
  detectExplicitWritingStyleInstruction,
  normalizeAdaptationGuidance,
  normalizeCharacterFashionStyle,
  normalizeDirectLanguageFragments,
  normalizeSchemaAbstraction,
  normalizeSchemaVariableName,
  normalizeWritingStyleGuide,
  SourceMaterialAnalyzer,
} from './SourceMaterialAnalyzer';
import type { StoryAnchors, StorySchemaAbstraction } from '../../types/sourceAnalysis';
import { extractTreatmentFromMarkdown, looksLikeTreatmentMarkdown } from '../utils/treatmentExtraction';

const anchors: StoryAnchors = {
  stakes: 'The mountain village and the protagonist dignity.',
  goal: 'Find a cure before winter closes the pass.',
  incitingIncident: 'The village well turns black overnight.',
  climax: 'The protagonist confronts the keeper of the pass during the storm.',
};

describe('SourceMaterialAnalyzer schema abstraction helpers', () => {
  it('normalizes schema variable names to PascalCase without braces', () => {
    expect(normalizeSchemaVariableName('{emotional anchor location}')).toBe('EmotionalAnchorLocation');
    expect(normalizeSchemaVariableName('false-victory')).toBe('FalseVictory');
    expect(normalizeSchemaVariableName('')).toBe('StoryVariable');
  });

  it('detects external-style placeholders so they can be kept out of player prose', () => {
    expect(containsSchemaPlaceholder('{Goal}')).toBe(true);
    expect(containsSchemaPlaceholder('The Goal is named without braces.')).toBe(false);
  });

  it('adds required anchor variables and strips placeholder braces from metadata text', () => {
    const abstraction: StorySchemaAbstraction = {
      archetype: 'Temptation and Moral Cost',
      adaptationMode: 'inspired_by',
      schemaVariables: [
        {
          name: '{protagonist role}',
          description: 'The person chasing {Goal}.',
          examples: ['{Protagonist}'],
        },
      ],
      generalizationGuidance: ['Preserve {Temptation}, not the original setting.'],
      reusablePatternSummary: 'A pressured hero risks their {CoreValue}.',
    };

    const normalized = normalizeSchemaAbstraction(abstraction, anchors)!;

    expect(normalized.schemaVariables.map((variable) => variable.name)).toEqual(
      expect.arrayContaining(['ProtagonistRole', 'Stakes', 'Goal', 'IncitingIncident', 'Climax']),
    );
    expect(normalized.schemaVariables[0].description).toBe('The person chasing Goal.');
    expect(normalized.schemaVariables[0].examples).toEqual(['Protagonist']);
    expect(normalized.generalizationGuidance[0]).toBe('Preserve Temptation, not the original setting.');
  });

  it('falls back to inspired_by when the mode is outside StoryRPG values', () => {
    const normalized = normalizeSchemaAbstraction(
      {
        archetype: 'Unknown',
        adaptationMode: 'schema_chapters' as any,
        schemaVariables: [],
        generalizationGuidance: [],
        reusablePatternSummary: '',
      },
      anchors,
    )!;

    expect(normalized.adaptationMode).toBe('inspired_by');
  });
});

describe('SourceMaterialAnalyzer treatment extraction', () => {
  const treatment = readFileSync(join(__dirname, '../fixtures/bite-me-treatment.md'), 'utf8');
  const refreshedTreatment = readFileSync(join(__dirname, '../fixtures/refreshed-treatment.md'), 'utf8');

  it('extracts treatment episode guidance and exactly three endings', () => {
    const extracted = extractTreatmentFromMarkdown(treatment);

    expect(extracted.isTreatment).toBe(true);
    expect(Object.keys(extracted.episodes)).toHaveLength(8);
    expect(extracted.episodes[1]?.episodePromise).toContain('first fabulous night');
    expect(extracted.episodes[1]?.majorChoicePressures).toEqual(
      expect.arrayContaining([expect.stringContaining('Accept Mika')]),
    );
    expect(extracted.episodes[1]?.alternativePaths).toEqual(
      expect.arrayContaining([expect.stringContaining('quartz')]),
    );
    expect(extracted.episodes[1]?.consequenceSeeds).toEqual(
      expect.arrayContaining([expect.stringContaining('black roses')]),
    );
    expect(extracted.episodes[1]?.authoredCliffhanger).toContain('horrible dream');
    expect(extracted.episodes[5]?.authoredCliffhanger).toContain('stag-crest ring');
    expect(extracted.branches.map((branch) => branch.name)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('The Quartz'),
        expect.stringContaining('The Blog War'),
        expect.stringContaining('Mika'),
        expect.stringContaining('The Mountain Confession'),
      ]),
    );
    expect(extracted.endings).toHaveLength(3);
    expect(extracted.endings.map((ending) => ending.name)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('The Consort'),
        expect.stringContaining('The Mountain Wife'),
        expect.stringContaining('The Witness'),
      ]),
    );
    expect(extracted.endings[0]?.targetConditions.join(' ')).toContain('Victor-aligned');
  });

  it('extracts refreshed treatment fields with flexible headings and episode title formats', () => {
    const extracted = extractTreatmentFromMarkdown(refreshedTreatment);

    expect(extracted.isTreatment).toBe(true);
    expect(extracted.metadata.formatVersion).toBe('storyrpg-treatment-v2');
    expect(extracted.metadata.confidence).toBe('high');
    expect(Object.keys(extracted.episodes)).toHaveLength(2);
    expect(extracted.episodes[1]?.authoredTitle).toBe('The Lantern Job');
    expect(extracted.episodes[1]?.actLabel).toBe('Act 1');
    expect(extracted.episodes[1]?.normalizedStructuralRoles).toEqual(['hook', 'plotTurn1']);
    expect(extracted.episodes[1]?.episodeTurns).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Mara arrives'),
        expect.stringContaining('lantern speaks'),
      ]),
    );
    expect(extracted.episodes[1]?.encounterCentralConflict).toContain('miracle worth protecting');
    expect(extracted.episodes[1]?.encounterAftermath).toContain('salt burns');
    expect(extracted.episodes[1]?.endingPressure).toContain('shadow points inland');
    expect(extracted.episodes[1]?.capabilityGrowthGuidance?.join(' ')).toContain('costlier clue');
    expect(extracted.episodes[2]?.authoredTitle).toBe('Breakwater Oath');
    expect(extracted.episodes[2]?.normalizedStructuralRoles).toEqual(['pinch1']);
    expect(extracted.branches[0]?.name).toContain('The Ledger Confession');
    expect(extracted.endings).toHaveLength(3);
    expect(extracted.endings.map((ending) => ending.name)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('The Keeper'),
        expect.stringContaining('The Open Door'),
        expect.stringContaining('The Burned Harbor'),
      ]),
    );
  });

  it('extracts regular-episode treatment fields from the updated prompt shape', () => {
    const regularTreatment = `
# Harbor Debt Treatment

## 2. Season Promise And Dramatic Engine

The season asks whether Mara can expose the harbor syndicate without becoming another keeper of secrets.

## 5. Stakes Architecture

- Material: Mara can lose her license and the ledger.
- Relational: Jonas may stop trusting her.
- Identity: Mara may become the kind of fixer she despises.

## 6. Information Ledger

- ID: info-ledger
- Audience/player knowledge state: selective
- Introduced episode: 1
- Setup touch episodes: 1, 2
- Planned reveal or payoff episode: 4

## 8. Arc Plan

Arc 1 asks whether the ledger is evidence or bait.

## 9. Episode Outline

### Episode 1: The Ledger Opens

- **Act:** Act 1
- **Arc:** The Harbor Debt
- **Structural role:** Hook + Plot Turn 1
- **Episode dramatic question:** Will Mara take the ledger case when it threatens Jonas?
- **Cold open function:** Hook + promise + material stakes.
- **A pressure lane:** Mara follows the missing ledger.
- **B pressure lane:** Jonas asks her to protect his brother.
- **C seed:** A red wax seal appears on the pier.
- **Episode turns:**
  - Mara finds the ledger in a fish crate.
  - Jonas lies about recognizing the seal.
- **Synopsis:** Mara takes a case that points back to someone she loves.
- **Opening situation:** The harbor auction turns hostile.
- **Encounter anchor:** The auction confrontation over the ledger.
- **How the encounter manifests the central conflict:** Mara must decide whether truth is worth burning Jonas.
- **Stakes layers present in the major scene/encounter:** Material: the ledger; Relational: Jonas's trust; Identity: Mara's honesty.
- **Theme angle:** What does truth cost when silence protects someone?
- **Lie pressure:** Mara believes safety comes from controlling every secret.
- **Encounter buildup:** Jonas warns her not to bid.
- **Major choice pressure:** Expose Jonas's lie or keep the ledger hidden.
- **Alternative paths:** Exposure earns public leverage but damages Jonas; secrecy preserves intimacy but loses time.
- **Information movement:** Plant the seal and touch the missing brother question.
- **Consequence seeds:** The red seal; Jonas's broken trust.
- **Ending turnout:** The ledger page names Mara's father.
- **End-state change:** Mara cannot investigate from the outside anymore.

## 11. Cross-Episode Branches And Consequence Chains

### Branch A - Jonas's Trust

If Mara exposes Jonas in Episode 1, Episode 2 begins with guarded access. If she protects him, Episode 2 begins with private help and public suspicion.

## 14. Alternate Endings

### Ending 1 - "The Witness"
- **Summary:** Mara exposes the syndicate and leaves the harbor.
- **Emotional register:** Bittersweet release.
- **Theme payoff:** Truth frees her only when she stops owning it alone.
- **State drivers:** Identity choice pattern; relationship with Jonas.
- **Target conditions:** Choose exposure with compassion.

### Ending 2 - "The Fixer"
- **Summary:** Mara controls the ledger and becomes the new broker.
- **Emotional register:** Corrupted victory.
- **Theme payoff:** Control preserves safety but kills trust.
- **State drivers:** Choice pattern around secrecy.
- **Target conditions:** Hide evidence repeatedly.

### Ending 3 - "The Debt Paid"
- **Summary:** Mara sacrifices her license to save Jonas and publish the names.
- **Emotional register:** Redemptive cost.
- **Theme payoff:** Love can pay truth's price without owning the outcome.
- **State drivers:** Relationship; resource loss.
- **Target conditions:** Protect Jonas while refusing the syndicate.
`;

    const extracted = extractTreatmentFromMarkdown(regularTreatment);

    expect(extracted.isTreatment).toBe(true);
    expect(extracted.seasonGuidance?.episodeStructureMode).toBe('standard');
    expect(extracted.seasonGuidance?.informationLedger).toContain('info-ledger');
    expect(extracted.seasonGuidance?.arcPlan).toContain('ledger is evidence or bait');
    expect(extracted.episodes[1]?.dramaticQuestion).toContain('Will Mara take');
    expect(extracted.episodes[1]?.arcLabel).toBe('The Harbor Debt');
    expect(extracted.episodes[1]?.aPressure).toContain('missing ledger');
    expect(extracted.episodes[1]?.bPressure).toContain('Jonas');
    expect(extracted.episodes[1]?.cSeed).toContain('red wax');
    expect(extracted.episodes[1]?.stakesLayers?.join(' ')).toContain('Identity');
    expect(extracted.episodes[1]?.themePressure).toContain('truth cost');
    expect(extracted.episodes[1]?.liePressure).toContain('controlling every secret');
    expect(extracted.episodes[1]?.informationMovement).toContain('Plant the seal');
    expect(extracted.episodes[1]?.endingTurnout).toContain('Mara');
    expect(extracted.episodes[1]?.endStateChange).toContain('outside');
    expect(extracted.endings).toHaveLength(3);
  });

  it('extracts sceneEpisode treatment fields and marks the treatment as sceneEpisodes', () => {
    const sceneEpisodeTreatment = `
# Harbor Debt SceneEpisode Treatment

## 1. Story Premise

This is the SCENEEPISODE version.

## 6. Information Ledger

- ID: info-seal
- Introduced sceneEpisode: 1
- Setup touch sceneEpisodes: 2, 4
- Planned reveal or payoff sceneEpisode: 7

## 9. SceneEpisode Outline

### SceneEpisode 1: The Auction Bell

- **Act:** Act 1
- **Arc:** The Harbor Debt
- **Structural role:** Hook
- **SceneEpisode dramatic question:** Will Mara make herself visible to save the ledger?
- **Opening image / hook function:** The auction bell rings with no one touching it.
- **Entry goal:** Buy the fish crate quietly.
- **Obstacle:** The syndicate bids with Jonas's family ring.
- Forced choice: Publicly challenge the bid or let the crate disappear.
- **Exit shift:** Mara leaves exposed as a bidder and implicated as a daughter.
- **Stakes layers present:** Material: ledger access; Relational: Jonas's trust; Identity: whether Mara hides or stands visible.
- **Theme pressure:** What does truth demand in public?
- **Lie pressure:** Mara believes invisibility keeps people safe.
- **A pressure:** Secure the ledger.
- **B pressure:** Preserve Jonas's trust.
- **C seed:** The red wax seal.
- **Information movement:** Plant the seal and open the brother question.
- **Meaningful choice pressure:** Challenge the bid or use Jonas's secret.
- **Alternative path or branchlet:** Challenge creates public suspicion; secrecy creates private debt.
- **Consequence residue:** The auctioneer now knows Mara's father's name.
- **Visual anchor:** A red seal stuck to a wet ledger page.
- **Why the next sceneEpisode exists because of this one:** The named father forces Mara to visit the closed registry.

## 10. Cross-SceneEpisode Branches And Consequence Chains

### Branch A - Public Bid

The public challenge changes sceneEpisode 3's access and reconverges at the registry.

## 13. Alternate Endings

### Ending 1 - "The Witness"
- **Summary:** Mara publishes the names.
- **Emotional register:** Bittersweet.
- **Theme payoff:** Truth shared is less poisonous.
- **State drivers:** Identity.
- **Target conditions:** Choose public truth.

### Ending 2 - "The Fixer"
- **Summary:** Mara controls the names.
- **Emotional register:** Corrupted.
- **Theme payoff:** Control repeats the wound.
- **State drivers:** Choice pattern.
- **Target conditions:** Hide evidence.

### Ending 3 - "The Debt Paid"
- **Summary:** Mara loses the license but saves Jonas.
- **Emotional register:** Redemptive.
- **Theme payoff:** Love accepts cost.
- **State drivers:** Relationship.
- **Target conditions:** Protect Jonas and expose the syndicate.
`;

    const extracted = extractTreatmentFromMarkdown(sceneEpisodeTreatment);

    expect(extracted.isTreatment).toBe(true);
    expect(extracted.seasonGuidance?.episodeStructureMode).toBe('sceneEpisodes');
    expect(extracted.seasonGuidance?.informationLedger).toContain('info-seal');
    expect(extracted.episodes[1]?.dramaticQuestion).toContain('make herself visible');
    expect(extracted.episodes[1]?.entryGoal).toContain('fish crate');
    expect(extracted.episodes[1]?.obstacle).toContain('family ring');
    expect(extracted.episodes[1]?.forcedChoice).toContain('challenge');
    expect(extracted.episodes[1]?.exitShift).toContain('exposed');
    expect(extracted.episodes[1]?.consequenceResidue).toContain('father');
    expect(extracted.episodes[1]?.nextEpisodeCausality).toContain('closed registry');
    expect(extracted.episodes[1]?.visualAnchor).toContain('red seal');
    expect(extracted.branches[0]?.name).toContain('Public Bid');
    expect(extracted.endings).toHaveLength(3);
  });

  it('extracts episode guidance from common workshop heading variants', () => {
    const variantTreatment = `
# Harbor Debt Treatment

## Episode Outline

#### SceneEp 1 — The Auction Bell

- **Dramatic question:** Will Mara stand up in public?
- **Act/Arc:** Act 1 / Arc 1.
- Forced choice: Challenge the bid or let the crate vanish.
- Exit shift: Mara leaves publicly exposed.
- Meaningful choices: Challenge publicly; bargain privately.
- Why next sceneEp exists: The exposed bid sends Mara to the registry.

#### Scene 2 - The Closed Registry

- Entry goal: Get the birth record.
- Obstacle: Jonas has already pulled the page.
- Consequence residue: Mara owes the archivist a favor.

## Alternate Endings

### Ending 1 - "The Witness"
- Summary: Mara publishes the names.
### Ending 2 - "The Fixer"
- Summary: Mara controls the names.
### Ending 3 - "The Debt Paid"
- Summary: Mara pays the cost.
`;

    const extracted = extractTreatmentFromMarkdown(variantTreatment);

    expect(extracted.isTreatment).toBe(true);
    expect(Object.keys(extracted.episodes)).toHaveLength(2);
    expect(extracted.episodes[1]?.authoredTitle).toBe('The Auction Bell');
    expect(extracted.episodes[1]?.actLabel).toBe('Act 1');
    expect(extracted.episodes[1]?.arcLabel).toBe('Arc 1.');
    expect(extracted.episodes[1]?.dramaticQuestion).toContain('stand up');
    expect(extracted.episodes[1]?.forcedChoice).toContain('Challenge');
    expect(extracted.episodes[1]?.majorChoicePressures?.join(' ')).toContain('bargain privately');
    expect(extracted.episodes[1]?.nextEpisodeCausality).toContain('registry');
    expect(extracted.episodes[2]?.authoredTitle).toBe('The Closed Registry');
    expect(extracted.episodes[2]?.entryGoal).toContain('birth record');
  });

  it('extracts episode guidance when filled treatment uses number-and-title bullets', () => {
    const bulletTreatment = `
# Harbor Debt SceneEpisode Treatment

## SceneEpisode Outline

- **SceneEpisode number and title:** 1 - The Auction Bell
- **SceneEpisode dramatic question:** Will Mara make herself visible?
- **Entry goal:** Buy the fish crate quietly.
- **Obstacle:** The syndicate bids with Jonas's ring.
- **Forced choice:** Challenge the bid or let the crate vanish.
- **Exit shift:** Mara leaves exposed.
- **Why the next sceneEpisode exists because of this one:** The named father sends Mara to the registry.

- SceneEpisode number and title: SE2 — The Closed Registry
- Entry goal: Get the birth record.
- Obstacle: Jonas has already pulled the page.
- Consequence residue: Mara owes the archivist a favor.

## Alternate Endings

### Ending 1 - "The Witness"
- Summary: Mara publishes the names.
### Ending 2 - "The Fixer"
- Summary: Mara controls the names.
### Ending 3 - "The Debt Paid"
- Summary: Mara pays the cost.
`;

    const extracted = extractTreatmentFromMarkdown(bulletTreatment);

    expect(extracted.isTreatment).toBe(true);
    expect(Object.keys(extracted.episodes)).toHaveLength(2);
    expect(extracted.episodes[1]?.authoredTitle).toBe('The Auction Bell');
    expect(extracted.episodes[1]?.entryGoal).toContain('fish crate');
    expect(extracted.episodes[1]?.nextEpisodeCausality).toContain('registry');
    expect(extracted.episodes[2]?.authoredTitle).toBe('The Closed Registry');
    expect(extracted.episodes[2]?.consequenceResidue).toContain('favor');
  });

  it('does not treat the prompt guide itself as a filled treatment', () => {
    const promptGuide = readFileSync(join(__dirname, '../../../../docs/STORY_TREATMENT_SCENEEPISODE_PROMPT.md'), 'utf8');
    const extracted = extractTreatmentFromMarkdown(promptGuide);

    expect(extracted.isTreatment).toBe(false);
    expect(extracted.metadata.detected).toBe(false);
    expect(extracted.metadata.warnings.join(' ')).toContain('prompt guide');
  });

  it('detects malformed treatment-like input and blocks silent generic fallback', () => {
    const malformedTreatment = `
# Bite Me Story Treatment

## 1. Episode Outline

### Ep One - Dating After Dusk
- **Episode promise:** Can Kylie survive her first fabulous night?
- **Major choice pressure:** Accept Mika's key card or keep distance.
- **Cliffhanger:** Stela texts that she had a horrible dream and is coming over with herbs.

## 2. Alternate Endings

### Ending One - "The Consort"
- **Summary:** Kylie chooses Victor.
`;
    const analyzer = new SourceMaterialAnalyzer({
      provider: 'anthropic',
      model: 'test',
      apiKey: 'test',
      maxTokens: 1000,
      temperature: 0,
    });
    const structure: any = {
      genre: 'paranormal romance',
      tone: 'dangerous',
      themes: [],
      setting: { timePeriod: 'present', location: 'Bucharest', worldDetails: '' },
      protagonist: { name: 'Kylie', description: 'A blogger.', arc: 'Claims her voice.' },
      majorCharacters: [],
      keyLocations: [],
      directLanguageFragments: { dialogue: [], prose: [], terminology: [] },
      storyArcs: [],
      majorPlotPoints: [],
      estimatedScope: { complexity: 'moderate', estimatedEpisodes: 1, reasoning: 'test' },
      endingAnalysis: { detectedMode: 'single', reasoning: 'fallback', explicitEndings: [] },
    };
    const breakdown: any = {
      episodes: [{
        episodeNumber: 1,
        title: 'Episode 1',
        synopsis: 'Synopsis',
        sourceChapters: '1',
        plotPoints: ['Plot'],
        mainCharacters: ['Kylie'],
        locations: ['Bucharest'],
        narrativeArc: { setup: 'setup', conflict: 'conflict', resolution: 'resolution' },
        structuralRole: ['hook'],
      }],
      totalEpisodes: 1,
      breakdownNotes: 'test',
    };

    expect(looksLikeTreatmentMarkdown(malformedTreatment)).toBe(true);
    expect(() => (analyzer as any).assembleAnalysis(
      { title: 'Bite Me', sourceText: malformedTreatment },
      structure,
      breakdown,
    )).toThrow(/Treatment extraction failed/);
  });

  it('overlays treatment guidance and endings onto assembled source analysis', () => {
    const analyzer = new SourceMaterialAnalyzer({
      provider: 'anthropic',
      model: 'test',
      apiKey: 'test',
      maxTokens: 1000,
      temperature: 0,
    });

    const structure: any = {
      genre: 'paranormal romance',
      tone: 'glamorous and dangerous',
      themes: ['voice', 'friendship'],
      setting: { timePeriod: 'present', location: 'Bucharest', worldDetails: 'Nightlife with supernatural pressure' },
      protagonist: { name: 'Kylie', description: 'A blogger.', arc: 'Claims her voice.' },
      majorCharacters: [],
      keyLocations: [],
      directLanguageFragments: { dialogue: [], prose: [], terminology: [] },
      storyArcs: [{ name: 'Dusk', description: 'Kylie learns the city.', chapters: 'all' }],
      majorPlotPoints: [
        { description: 'Kylie is attacked and rescued.', type: 'inciting_incident', importance: 'critical', approximatePosition: 'early' },
        { description: 'Kylie confronts Victor.', type: 'climax', importance: 'critical', approximatePosition: 'late' },
      ],
      estimatedScope: { complexity: 'moderate', estimatedEpisodes: 8, reasoning: 'treatment has eight episodes' },
      endingAnalysis: { detectedMode: 'single', reasoning: 'fallback', explicitEndings: [] },
    };
    const breakdown: any = {
      episodes: Array.from({ length: 8 }, (_, index) => ({
        episodeNumber: index + 1,
        title: `Episode ${index + 1}`,
        synopsis: `Synopsis ${index + 1}`,
        sourceChapters: `${index + 1}`,
        plotPoints: [`Plot ${index + 1}`],
        mainCharacters: ['Kylie'],
        locations: ['Bucharest'],
        narrativeArc: { setup: 'setup', conflict: 'conflict', resolution: 'resolution' },
        structuralRole: index === 4 ? ['midpoint'] : index === 7 ? ['climax', 'resolution'] : ['rising'],
      })),
      totalEpisodes: 8,
      breakdownNotes: 'eight episodes',
    };

    const analysis = (analyzer as any).assembleAnalysis(
      { title: 'Bite Me', sourceText: treatment },
      structure,
      breakdown,
    );

    expect(analysis.resolvedEndingMode).toBe('multiple');
    expect(analysis.resolvedEndings).toHaveLength(3);
    expect(analysis.episodeBreakdown[0].treatmentGuidance.authoredCliffhanger).toContain('horrible dream');
    expect(analysis.episodeBreakdown[4].treatmentGuidance.encounterAnchors[0]).toContain('mirror moment');
    expect(analysis.treatmentBranches.map((branch: any) => branch.name)).toEqual(
      expect.arrayContaining([expect.stringContaining('The Blog War')]),
    );
  });

  it('marks refreshed treatments as authored treatment input and preserves treatment episode count, titles, and guidance', () => {
    const analyzer = new SourceMaterialAnalyzer({
      provider: 'anthropic',
      model: 'test',
      apiKey: 'test',
      maxTokens: 1000,
      temperature: 0,
    });

    const structure: any = {
      genre: 'supernatural mystery',
      tone: 'salt-stung dread',
      themes: ['grief', 'truth'],
      setting: { timePeriod: 'present', location: 'harbor town', worldDetails: 'A lighthouse that answers grief' },
      protagonist: { name: 'Mara', description: 'A new lighthouse keeper.', arc: 'Learns truth must release grief.' },
      majorCharacters: [],
      keyLocations: [],
      directLanguageFragments: { dialogue: [], prose: [], terminology: [] },
      storyArcs: [{ name: 'The Light', description: 'Mara learns what the lighthouse imprisons.', chapters: 'all' }],
      majorPlotPoints: [
        { description: 'The lantern answers with her sister voice.', type: 'inciting_incident', importance: 'critical', approximatePosition: 'early' },
        { description: 'Mara opens the storm door.', type: 'climax', importance: 'critical', approximatePosition: 'late' },
      ],
      estimatedScope: { complexity: 'moderate', estimatedEpisodes: 1, reasoning: 'LLM undercounted' },
      endingAnalysis: { detectedMode: 'single', reasoning: 'fallback', explicitEndings: [] },
    };
    const breakdown: any = {
      episodes: [{
        episodeNumber: 1,
        title: 'Wrong LLM Title',
        synopsis: 'Mara arrives.',
        sourceChapters: '1',
        plotPoints: ['Mara arrives'],
        mainCharacters: ['Mara'],
        locations: ['Lighthouse'],
        narrativeArc: { setup: 'setup', conflict: 'conflict', resolution: 'resolution' },
        structuralRole: ['rising'],
      }],
      totalEpisodes: 1,
      breakdownNotes: 'undercounted',
    };

    const analysis = (analyzer as any).assembleAnalysis(
      { title: 'Harbor Light', sourceText: refreshedTreatment },
      structure,
      breakdown,
    );

    expect(analysis.sourceFormat).toBe('story_treatment');
    expect(analysis.treatmentMetadata.detected).toBe(true);
    expect(analysis.treatmentMetadata.formatVersion).toBe('storyrpg-treatment-v2');
    expect(analysis.totalEstimatedEpisodes).toBe(2);
    expect(analysis.episodeBreakdown.map((episode: any) => episode.title)).toEqual([
      'The Lantern Job',
      'Breakwater Oath',
    ]);
    expect(analysis.episodeBreakdown[0].structuralRole).toEqual(expect.arrayContaining(['hook', 'plotTurn1']));
    expect(analysis.episodeBreakdown[1].structuralRole).toEqual(expect.arrayContaining(['pinch1']));
    expect(analysis.episodeBreakdown[0].treatmentGuidance.encounterCentralConflict).toContain('miracle worth protecting');
    expect(analysis.resolvedEndings).toHaveLength(3);
  });
});

describe('SourceMaterialAnalyzer writing style helpers', () => {
  it('detects explicit prose style instructions in the user prompt', () => {
    expect(
      detectExplicitWritingStyleInstruction('A detective story in rain-slick streets. Write in spare noir prose.')
    ).toBe('Write in spare noir prose.');

    expect(
      detectExplicitWritingStyleInstruction('Use a literary, close third-person style with brittle dialogue.')
    ).toBe('Use a literary, close third-person style with brittle dialogue.');
  });

  it('ignores ordinary plot and tone prompts without prose-style instructions', () => {
    expect(
      detectExplicitWritingStyleInstruction('A dark fantasy about a knight investigating a haunted abbey.')
    ).toBeUndefined();
  });

  it('ignores visual art style instructions', () => {
    expect(
      detectExplicitWritingStyleInstruction('A mystery about a haunted pier. Art style should be watercolor noir.')
    ).toBeUndefined();
  });

  it('prefers explicit prompt style over inferred guide metadata', () => {
    const guide = normalizeWritingStyleGuide(
      { source: 'inferred_from_material', summary: 'Use lyrical mythic prose.' },
      'Write in spare noir prose.',
      { genre: 'fantasy', tone: 'mythic' },
    );

    expect(guide.source).toBe('explicit_prompt');
    expect(guide.evidence).toEqual(['Write in spare noir prose.']);
  });

  it('preserves direct language fragments and adaptation guidance during normalization', () => {
    expect(
      normalizeDirectLanguageFragments({
        dialogue: ['Never tell me the odds.'],
        prose: ['The city breathed smoke.'],
        terminology: ['jump drive'],
      })
    ).toEqual({
      dialogue: ['Never tell me the odds.'],
      prose: ['The city breathed smoke.'],
      terminology: ['jump drive'],
    });

    expect(
      normalizeAdaptationGuidance({
        narrativeVoice: 'Cool, observant, lightly ironic.',
        dialogueStyle: 'Clipped and evasive.',
        toneNotes: 'Tense but dry.',
        keyThemesToPreserve: ['loyalty'],
        iconicMoments: ['the rooftop confession'],
      })
    ).toMatchObject({
      narrativeVoice: 'Cool, observant, lightly ironic.',
      dialogueStyle: 'Clipped and evasive.',
      toneNotes: 'Tense but dry.',
      elementsToPreserve: ['loyalty', 'the rooftop confession'],
    });
  });

  it('normalizes character fashion style metadata', () => {
    expect(
      normalizeCharacterFashionStyle({
        styleSummary: ' Tailored dockside noir ',
        styleTags: [' trench coat ', ''],
        signatureGarments: ['weathered coat'],
        materials: ['wool'],
        colorPalette: ['charcoal'],
        accessories: ['silver lighter'],
        sourceEvidence: ['coat mentioned twice'],
      })
    ).toEqual({
      styleSummary: 'Tailored dockside noir',
      styleTags: ['trench coat'],
      signatureGarments: ['weathered coat'],
      materials: ['wool'],
      colorPalette: ['charcoal'],
      accessories: ['silver lighter'],
      sourceEvidence: ['coat mentioned twice'],
    });

    expect(normalizeCharacterFashionStyle({ styleSummary: '', styleTags: [] })).toBeUndefined();
  });

  it('assembles a writing style guide and source-fidelity fields for old-safe analysis output', () => {
    const analyzer = new SourceMaterialAnalyzer({
      provider: 'anthropic',
      model: 'test',
      apiKey: 'test',
      maxTokens: 1000,
      temperature: 0,
    });

    const structure = {
      genre: 'mystery',
      tone: 'dry and tense',
      themes: ['truth'],
      setting: { timePeriod: 'now', location: 'Harbor City', worldDetails: 'rain and debt' },
      protagonist: {
        name: 'Mara',
        description: 'A private investigator.',
        arc: 'Learns to trust again.',
        fashionStyle: {
          styleSummary: 'Rumpled investigator layers built around a rain-dark trench coat.',
          styleTags: ['noir detective'],
          signatureGarments: ['rain-dark trench coat'],
          materials: ['gabardine'],
          colorPalette: ['slate', 'black'],
          accessories: ['notebook'],
        },
      },
      majorCharacters: [
        {
          name: 'Boss Vale',
          role: 'antagonist',
          description: 'The harbor boss.',
          importance: 'core',
          fashionStyle: {
            styleSummary: 'Immaculate white suits made threatening by blood-red accents.',
            styleTags: ['crime boss tailoring'],
            signatureGarments: ['white suit'],
            materials: ['linen'],
            colorPalette: ['white', 'red'],
            accessories: ['ruby tie pin'],
            sourceEvidence: ['The boss wore white.'],
          },
        },
      ],
      keyLocations: [],
      directLanguageFragments: {
        dialogue: ['Everyone owes someone.'],
        prose: ['Rain turned the harbor lights into bruises.'],
        terminology: ['dockside'],
      },
      adaptationGuidance: {
        narrativeVoice: 'Hardboiled but intimate.',
        keyThemesToPreserve: ['truth'],
        iconicMoments: ['the pier reveal'],
      },
      storyArcs: [{ name: 'The Missing Ledger', description: 'Mara follows a debt trail.', chapters: 'all' }],
      majorPlotPoints: [
        { description: 'The ledger vanishes.', type: 'inciting_incident', importance: 'critical', approximatePosition: 'early' },
        { description: 'Mara confronts the harbor boss.', type: 'climax', importance: 'critical', approximatePosition: 'late' },
      ],
      estimatedScope: { complexity: 'simple', estimatedEpisodes: 1, reasoning: 'short mystery' },
      writingStyleGuide: {
        source: 'inferred_from_material',
        summary: 'Hardboiled, intimate mystery prose.',
      },
      endingAnalysis: { detectedMode: 'single', reasoning: 'one mystery solution', explicitEndings: [] },
    };

    const breakdown = {
      episodes: [
        {
          episodeNumber: 1,
          title: 'The Missing Ledger',
          synopsis: 'Mara takes the case and finds the boss.',
          sourceChapters: 'all',
          plotPoints: ['The ledger vanishes.', 'Mara confronts the harbor boss.'],
          mainCharacters: ['Mara'],
          locations: ['Harbor City'],
          narrativeArc: { setup: 'The case arrives.', conflict: 'The trail tightens.', resolution: 'The boss is exposed.' },
          structuralRole: ['hook', 'plotTurn1', 'climax', 'resolution'],
        },
      ],
      totalEpisodes: 1,
      breakdownNotes: 'single episode',
    };

    const analysis = (analyzer as any).assembleAnalysis(
      { title: 'Harbor Debt', sourceText: 'Rain and ledgers.', userPrompt: 'A mystery. Write in spare noir prose.' },
      structure,
      breakdown,
    );

    expect(analysis.writingStyleGuide.source).toBe('explicit_prompt');
    expect(analysis.writingStyleGuide.evidence).toEqual(['Write in spare noir prose.']);
    expect(analysis.directLanguageFragments.dialogue).toEqual(['Everyone owes someone.']);
    expect(analysis.adaptationGuidance.narrativeVoice).toBe('Hardboiled but intimate.');
    expect(analysis.protagonist.fashionStyle?.styleTags).toEqual(['noir detective']);
    expect(analysis.majorCharacters[0].fashionStyle?.signatureGarments).toEqual(['white suit']);
  });
});
