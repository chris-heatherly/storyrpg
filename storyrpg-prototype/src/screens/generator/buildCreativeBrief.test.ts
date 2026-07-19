import { describe, expect, it } from 'vitest';
import type { FullCreativeBrief } from '../../ai-agents/pipeline/FullStoryPipeline';
import type { SourceMaterialAnalysis } from '../../types/sourceAnalysis';
import type { SeasonPlan } from '../../types/seasonPlan';
import { buildGeneratorCreativeBrief } from './buildCreativeBrief';

describe('buildGeneratorCreativeBrief', () => {
  it('prefers analyzed treatment truth over the raw prompt after prompt-only source analysis', () => {
    const sourceAnalysis = {
      sourceTitle: 'Bite Me',
      genre: 'Paranormal rom-com / dark vampire romance',
      tone: 'Champagne fizz on top, blood at the bottom',
      themes: ['voice', 'reinvention'],
      anchors: {
        goal: 'Build a life and a blog with her own name on it.',
      },
      setting: {
        location: 'Bucharest',
        timePeriod: 'Contemporary',
        worldDetails: 'A glamorous Bucharest where monsters hide in nightlife.',
      },
      protagonist: {
        id: 'char-kylie-marinescu',
        name: 'Kylie Marinescu',
        pronouns: 'she/her',
        description: 'A food writer rebuilding herself after a public breakup.',
      },
      majorCharacters: [
        {
          id: 'char-kylie-marinescu',
          name: 'Kylie Marinescu',
          role: 'protagonist',
          description: 'The protagonist.',
          importance: 'core',
        },
        {
          id: 'char-victor-valcescu',
          name: 'Victor Vâlcescu',
          role: 'antagonist',
          description: 'A Strigoi suitor.',
          importance: 'core',
        },
      ],
      keyLocations: [
        {
          id: 'loc-cismigiu-gardens',
          name: 'Cișmigiu Gardens',
          description: 'The foggy park where the attack happens.',
          importance: 'major',
        },
      ],
      episodeBreakdown: [
        {
          episodeNumber: 1,
          title: 'Dating After Dusk',
          synopsis: 'Kylie arrives, joins the Dusk Club, survives an attack, and writes Mr. Midnight.',
        },
      ],
      resolvedEndingMode: 'multiple',
      resolvedEndings: [{ id: 'witness', label: 'The Witness', summary: 'Kylie chooses herself.' }],
    } as unknown as SourceMaterialAnalysis;
    const seasonPlan = {
      id: 'bite-me-plan',
      seasonTitle: 'Bite Me',
      totalEpisodes: 8,
      episodes: [],
    } as unknown as SeasonPlan;

    const brief = buildGeneratorCreativeBrief({
      documentBrief: null,
      sourceAnalysis,
      seasonPlan,
      customStoryTitle: 'Bite Me',
      userPrompt: 'Generate Episode 1 only from the following treatment...',
    });

    expect(brief?.story).toMatchObject({
      title: 'Bite Me',
      genre: 'Paranormal rom-com / dark vampire romance',
      tone: 'Champagne fizz on top, blood at the bottom',
    });
    expect(brief?.story.genre).not.toBe('Action');
    expect(brief?.protagonist.name).toBe('Kylie Marinescu');
    expect(brief?.protagonist.pronouns).toBe('she/her');
    expect(brief?.protagonist.name).not.toBe('Hero');
    expect(brief?.world.keyLocations[0].id).toBe('loc-cismigiu-gardens');
    expect(brief?.episode).toMatchObject({ number: 1, title: 'Dating After Dusk' });
    expect(brief?.seasonPlan).toBe(seasonPlan);
    expect(brief?.userPrompt).toContain('Generate Episode 1 only');
    expect(brief?.endingMode).toBe('multiple');
    expect(brief?.endingTargets).toHaveLength(1);
  });

  it('still supports raw prompt generation before analysis exists', () => {
    const brief = buildGeneratorCreativeBrief({
      documentBrief: null,
      sourceAnalysis: null,
      seasonPlan: null,
      customStoryTitle: 'Untitled Prompt',
      userPrompt: 'A compact story idea.',
    });

    expect(brief?.story.title).toBe('Untitled Prompt');
    expect(brief?.story.genre).toBe('Action');
    expect(brief?.protagonist).toMatchObject({ name: '', pronouns: 'they/them' });
  });

  it('lets analyzed source override document brief once analysis is available', () => {
    const documentBrief = {
      story: { title: 'Old Doc', genre: 'Action', synopsis: 'Old', tone: 'Dramatic', themes: [] },
      world: { premise: '', timePeriod: '', technologyLevel: '', keyLocations: [] },
      protagonist: { id: 'p1', name: 'Hero', pronouns: 'he/him', description: '', role: '' },
      npcs: [],
      episode: { number: 1, title: 'Episode 1', synopsis: '', startingLocation: '' },
    } as FullCreativeBrief;
    const sourceAnalysis = {
      sourceTitle: 'Analyzed Title',
      genre: 'Mystery',
      tone: 'Noir',
      themes: [],
      setting: { location: 'City', timePeriod: 'Now', worldDetails: 'Analyzed world' },
      protagonist: { id: 'detective', name: 'Detective Vale', description: 'A real protagonist.' },
      majorCharacters: [],
      keyLocations: [],
      episodeBreakdown: [{ episodeNumber: 1, title: 'The Case', synopsis: 'A real first episode.' }],
    } as unknown as SourceMaterialAnalysis;

    const brief = buildGeneratorCreativeBrief({
      documentBrief,
      sourceAnalysis,
      seasonPlan: null,
      customStoryTitle: '',
      userPrompt: '',
    });

    expect(brief?.story.title).toBe('Analyzed Title');
    expect(brief?.story.genre).toBe('Mystery');
    expect(brief?.protagonist.name).toBe('Detective Vale');
  });

  it('does not carry placeholder document pronouns into analyzed source canon', () => {
    const documentBrief = {
      story: { title: 'Bite Me', genre: 'Action', synopsis: '', tone: '', themes: [] },
      world: { premise: '', timePeriod: '', technologyLevel: '', keyLocations: [] },
      protagonist: { id: 'protagonist', name: 'The Hero', pronouns: 'he/him', description: '', role: 'protagonist' },
      npcs: [],
      episode: { number: 1, title: 'Episode 1', synopsis: '', startingLocation: '' },
    } as FullCreativeBrief;
    const sourceAnalysis = {
      sourceTitle: 'Bite Me', genre: 'romance', tone: 'darkly comic', themes: [],
      setting: { location: 'Bucharest', timePeriod: 'Now', worldDetails: '' },
      protagonist: { id: 'char-kylie', name: 'Kylie Marinescu', pronouns: 'she/her', description: '', arc: '' },
      majorCharacters: [], keyLocations: [], episodeBreakdown: [{ episodeNumber: 1, title: 'One', synopsis: '' }],
    } as unknown as SourceMaterialAnalysis;

    const brief = buildGeneratorCreativeBrief({
      documentBrief, sourceAnalysis, seasonPlan: null, customStoryTitle: 'Bite Me', userPrompt: '',
    });

    expect(brief?.protagonist).toMatchObject({ name: 'Kylie Marinescu', pronouns: 'she/her' });
  });
});
