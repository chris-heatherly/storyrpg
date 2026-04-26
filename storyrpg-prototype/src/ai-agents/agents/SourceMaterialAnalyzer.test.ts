import { describe, expect, it } from 'vitest';

import {
  containsSchemaPlaceholder,
  detectExplicitWritingStyleInstruction,
  normalizeAdaptationGuidance,
  normalizeDirectLanguageFragments,
  normalizeSchemaAbstraction,
  normalizeSchemaVariableName,
  normalizeWritingStyleGuide,
  SourceMaterialAnalyzer,
} from './SourceMaterialAnalyzer';
import type { StoryAnchors, StorySchemaAbstraction } from '../../types/sourceAnalysis';

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
      protagonist: { name: 'Mara', description: 'A private investigator.', arc: 'Learns to trust again.' },
      majorCharacters: [],
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
  });
});
