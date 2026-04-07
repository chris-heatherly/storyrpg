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

  it('includes growthContext when seasonPlan has growthCurve entry for episode', () => {
    const brief: any = {
      episode: { number: 2 },
      seasonPlan: {
        episodes: [{ episodeNumber: 2, difficultyTier: 'medium' }],
        consequenceChains: [],
        crossEpisodeBranches: [],
        growthCurve: [
          {
            episodeNumber: 2,
            focusSkills: ['persuasion', 'athletics'],
            developmentScene: 'A training montage in the courtyard',
            mentorshipOpportunity: {
              npcId: 'marcus',
              npcName: 'Marcus',
              requiredRelationship: { dimension: 'respect', threshold: 60 },
              attribute: 'courage',
              narrativeHook: 'Marcus offers to train you',
            },
          },
        ],
      },
    };
    const directives = buildSeasonPlanDirectives(brief);
    expect(directives?.growthContext).toBeDefined();
    expect(directives!.growthContext!.focusSkills).toEqual(['persuasion', 'athletics']);
    expect(directives!.growthContext!.developmentScene).toBe('A training montage in the courtyard');
    expect(directives!.growthContext!.mentorshipOpportunity?.npcId).toBe('marcus');
    expect(directives!.growthContext!.mentorshipOpportunity?.attribute).toBe('courage');
  });

  it('returns growthContext as undefined when no growthCurve exists', () => {
    const brief: any = {
      episode: { number: 1 },
      seasonPlan: {
        episodes: [{ episodeNumber: 1, difficultyTier: 'easy' }],
        consequenceChains: [],
        crossEpisodeBranches: [],
      },
    };
    const directives = buildSeasonPlanDirectives(brief);
    expect(directives?.growthContext).toBeUndefined();
  });

  it('returns growthContext as undefined when growthCurve has no matching episode', () => {
    const brief: any = {
      episode: { number: 3 },
      seasonPlan: {
        episodes: [{ episodeNumber: 3, difficultyTier: 'hard' }],
        consequenceChains: [],
        crossEpisodeBranches: [],
        growthCurve: [
          { episodeNumber: 1, focusSkills: ['stealth'], developmentScene: 'Sneaking drill' },
        ],
      },
    };
    const directives = buildSeasonPlanDirectives(brief);
    expect(directives?.growthContext).toBeUndefined();
  });

  it('sets mentorshipOpportunity to null when growthCurve entry omits it', () => {
    const brief: any = {
      episode: { number: 1 },
      seasonPlan: {
        episodes: [{ episodeNumber: 1, difficultyTier: 'easy' }],
        consequenceChains: [],
        crossEpisodeBranches: [],
        growthCurve: [
          { episodeNumber: 1, focusSkills: ['investigation'], developmentScene: 'Library study' },
        ],
      },
    };
    const directives = buildSeasonPlanDirectives(brief);
    expect(directives?.growthContext).toBeDefined();
    expect(directives!.growthContext!.focusSkills).toEqual(['investigation']);
    expect(directives!.growthContext!.mentorshipOpportunity).toBeFalsy();
  });
});
