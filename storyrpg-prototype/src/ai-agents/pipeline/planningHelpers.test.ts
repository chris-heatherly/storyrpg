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
    const fashionStyle = {
      styleSummary: 'Practical expedition layers with brass hardware.',
      styleTags: ['adventurer tailoring'],
      signatureGarments: ['waxed field jacket'],
      materials: ['canvas'],
      colorPalette: ['olive'],
      accessories: ['brass compass'],
    };
    const brief: any = {
      protagonist: { id: 'placeholder', name: 'Placeholder', description: 'n/a' },
      npcs: [],
    };
    const analysis: any = {
      protagonist: { id: 'hero', name: 'Alex', description: 'The lead.', fashionStyle },
      majorCharacters: [
        { id: 'hero', name: 'Alex', role: 'ally', importance: 'core', description: 'Duplicate protagonist.' },
        { id: 'ally-1', name: 'Jordan', role: 'ally', importance: 'supporting', description: 'Trusted ally.', fashionStyle },
      ],
    };

    const result = createCharacterBriefFromAnalysis(brief, analysis);
    expect(result.protagonist.id).toBe('hero');
    expect(result.protagonist.fashionStyle).toBe(fashionStyle);
    expect(result.npcs).toHaveLength(1);
    expect(result.npcs[0]?.id).toBe('ally-1');
    expect(result.npcs[0]?.fashionStyle).toBe(fashionStyle);
  });

  it('preserves authored relationship roles for character design', () => {
    const brief: any = {
      protagonist: { id: 'placeholder', name: 'Placeholder', description: 'n/a' },
      npcs: [],
    };
    const analysis: any = {
      protagonist: { id: 'hero', name: 'Kylie', description: 'The lead.' },
      majorCharacters: [
        { id: 'char-radu', name: 'Radu Stoian', role: 'love_interest', importance: 'core', description: 'The honest second lead.' },
        { id: 'char-stela', name: 'Stela Pavel', role: 'mentor', importance: 'core', description: 'A practitioner who wards Kylie.' },
        { id: 'char-mika', name: 'Mika Drăgan', role: 'rival', importance: 'core', description: 'A friend with divided loyalties.' },
      ],
    };

    const result = createCharacterBriefFromAnalysis(brief, analysis);

    expect(result.npcs.map((npc: any) => [npc.id, npc.role])).toEqual([
      ['char-radu', 'love_interest'],
      ['char-stela', 'mentor'],
      ['char-mika', 'rival'],
    ]);
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
        characterArchitecture: {
          protagonist: {
            lie: 'Trust makes me weak.',
            originPressure: 'A trusted ally once sold the protagonist out.',
            truth: 'Trust can become chosen leverage.',
            want: 'Keep both friends.',
            need: 'Choose a relationship honestly before the lie chooses for them.',
            arcMode: 'ambiguous',
            climaxChoice: {
              choiceQuestion: 'Will the protagonist trust openly or manipulate both friends?',
              integrateTruthOption: 'Trust one friend with the whole truth.',
              recommitLieOption: 'Hide the truth from both friends.',
              activeChoiceMechanism: 'The player chooses which friend receives the truth.',
            },
          },
          supportingCharacters: [],
        },
        seasonPromiseArchitecture: {
          seasonDramaticQuestion: 'Can the protagonist trust without losing leverage?',
          centralPressure: {
            type: 'relationship',
            description: 'Two friends apply incompatible pressure.',
            pressuresLieBy: 'Trust keeps becoming the leverage the protagonist needs.',
          },
          seasonPromise: {
            premisePromise: 'Friendship choices become dangerous leverage.',
            playerExperiencePromise: 'The player chooses who to trust and what costs to carry.',
            emotionalPromise: 'Every bond feels useful and unsafe.',
            variationPlan: ['Episode 2 turns trust into a public reveal.'],
          },
          seasonCompleteness: {
            resolvedQuestion: 'The protagonist chooses a trust pattern.',
            resolvedStakes: 'The friendship triangle changes.',
            characterStateChange: 'The protagonist can no longer treat trust as weakness.',
          },
        },
        informationLedger: [
          {
            id: 'info-trust-debt',
            label: 'Trust debt',
            description: 'The player knows a friend is hiding a debt.',
            audienceKnowledgeState: 'selective',
            tensionMode: 'suspense',
            knownBy: ['player', 'ally'],
            withheldFrom: ['protagonist'],
            introducedEpisode: 1,
            plannedRevealEpisode: 2,
            plannedPayoffEpisode: 2,
            setupTouchEpisodes: [1, 2],
            payoffPlan: 'The debt changes the trust choice.',
            isBoxQuestion: false,
            closesQuestionIds: ['q-trust-debt'],
            opensQuestionIds: [],
          },
        ],
        arcs: [
          {
            id: 'arc-1',
            name: 'Trust Arc',
            episodeRange: { start: 1, end: 3 },
            arcQuestion: 'Can trust survive pressure?',
            identityPressureFacet: 'The protagonist equates trust with weakness.',
            episodeTurnouts: [
              {
                episodeNumber: 2,
                turnType: 'revelation',
                description: 'The ally reveals a hidden debt.',
                leavesProtagonistWith: 'Knowledge that changes the next choice.',
                whyThisCannotMoveLater: 'The later confrontation depends on this reveal.',
              },
            ],
          },
        ],
        episodes: [
          {
            episodeNumber: 2,
            difficultyTier: 'hard',
            treatmentGuidance: {
              episodePromise: 'Can the protagonist keep both friends?',
              majorChoicePressures: ['Choose who to trust when both allies disagree.'],
              alternativePaths: ['Trusting the ally changes the later confrontation.'],
              authoredCliffhanger: 'A trusted ally arrives with impossible news.',
            },
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
    expect(directives?.treatmentGuidance?.episodePromise).toContain('keep both friends');
    expect(directives?.treatmentGuidance?.majorChoicePressures?.[0]).toContain('trust');
    expect(directives?.arcPressure?.arcName).toBe('Trust Arc');
    expect(directives?.arcPressure?.episodeTurnout?.turnType).toBe('revelation');
    expect(directives?.characterArchitecture?.protagonist.lie).toContain('Trust');
    expect(directives?.seasonPromiseArchitecture?.seasonDramaticQuestion).toContain('trust');
    expect(directives?.informationLedgerEntries?.[0]?.id).toBe('info-trust-debt');
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
