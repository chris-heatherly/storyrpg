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
