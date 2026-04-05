import { describe, expect, it } from 'vitest';
import {
  buildSeasonPlanDirectives,
  createCharacterBriefFromAnalysis,
  createEpisodeOptions,
} from './planningHelpers';

describe('planningHelpers', () => {
  it('creates episode options from source analysis', () => {
    const analysis: any = {
      totalEstimatedEpisodes: 6,
      episodeBreakdown: [
        { title: 'Episode 1' },
        { title: 'Episode 2' },
        { title: 'Episode 3' },
        { title: 'Episode 4' },
        { title: 'Episode 5' },
        { title: 'Episode 6' },
      ],
    };

    const options = createEpisodeOptions(analysis);
    expect(options[0]?.count).toBe(1);
    expect(options.at(-1)?.count).toBe(6);
  });

  it('filters the protagonist from major character NPCs', () => {
    const brief: any = {
      protagonist: { id: 'placeholder', name: 'Placeholder', description: 'n/a' },
      npcs: [],
    };
    const analysis: any = {
      protagonist: { id: 'hero', name: 'Alex', description: 'The lead.' },
      majorCharacters: [
        { id: 'hero', name: 'Alex', role: 'ally', importance: 'core', description: 'Duplicate protagonist.' },
        { id: 'ally-1', name: 'Jordan', role: 'ally', importance: 'supporting', description: 'Trusted ally.' },
      ],
    };

    const result = createCharacterBriefFromAnalysis(brief, analysis);
    expect(result.protagonist.id).toBe('hero');
    expect(result.npcs).toHaveLength(1);
    expect(result.npcs[0]?.id).toBe('ally-1');
  });

  it('builds episode-scoped season plan directives', () => {
    const warningMessages: string[] = [];
    const brief: any = {
      episode: { number: 2 },
      seasonPlan: {
        endingMode: 'multiple',
        resolvedEndings: [{ id: 'ending-a' }],
        consequenceChains: [
          {
            consequences: [{ episodeNumber: 2, description: 'Consequence', severity: 'high' }],
          },
        ],
        crossEpisodeBranches: [
          {
            id: 'branch-1',
            name: 'Main Branch',
            paths: [
              {
                name: 'Path A',
                affectedEpisodes: [{ episodeNumber: 2, impact: 'major', description: 'Pressure arrives' }],
              },
            ],
          },
        ],
        episodes: [
          {
            episodeNumber: 2,
            difficultyTier: 'hard',
            incomingBranches: ['branch-1'],
            setsFlags: ['met_rival'],
            checksFlags: ['saved_friend'],
            endingRoutes: [{ endingId: 'ending-a', role: 'opens', description: 'Moves toward ending A' }],
            plannedEncounters: [
              {
                id: 'enc-2-1',
                type: 'dramatic',
                description: 'A hard confrontation',
                difficulty: 'hard',
                npcsInvolved: ['eros'],
                stakes: 'Everything matters',
                relevantSkills: ['persuasion'],
              },
            ],
          },
        ],
      },
    };

    const directives = buildSeasonPlanDirectives(brief, (message) => warningMessages.push(message));
    expect(warningMessages).toHaveLength(0);
    expect(directives?.plannedEncounters?.[0]?.id).toBe('enc-2-1');
    expect(directives?.incomingBranchEffects?.[0]?.branchName).toBe('Main Branch');
    expect(directives?.consequenceEffects?.[0]?.severity).toBe('high');
  });
});
