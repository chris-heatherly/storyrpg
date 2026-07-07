import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Story } from '../../types';
import {
  deriveRunQualityScore,
  reconcileBestPracticesReportForFinalStory,
  savePipelineOutputs,
  writeFinalStoryPackage,
  savePartialStory,
  saveFinalStoryContractFailure,
} from './pipelineOutputWriter';

vi.mock('expo-file-system', () => ({
  default: {},
  writeAsStringAsync: vi.fn(),
  makeDirectoryAsync: vi.fn(),
  getInfoAsync: vi.fn(async () => ({ exists: false })),
  EncodingType: { UTF8: 'utf8', Base64: 'base64' },
}));

const tempDirs: string[] = [];

/**
 * QA report carrying high judge grades: QualityScore v4 only admits scores
 * above 90 when the prose-craft judge actually graded the run, and counts a
 * missing qaReport against evidence coverage.
 */
function judgedQAReport(overallScore = 44): any {
  return {
    overallScore,
    passesQA: true,
    criticalIssues: [],
    proseCraft: {
      overallScore: 93,
      conceptScores: [
        { conceptId: 'sentence_craft', score: 94, evidence: 'precise, active prose' },
        { conceptId: 'specificity_show_dont_tell', score: 93, evidence: 'concrete detail throughout' },
        { conceptId: 'filler_density', score: 92, evidence: 'no padding found' },
        { conceptId: 'rhythm_pacing', score: 93, evidence: 'varied openers' },
        { conceptId: 'dialogue_naturalness', score: 92, evidence: 'speech carries subtext' },
        { conceptId: 'voice_style_consistency', score: 94, evidence: 'one controlled voice' },
      ],
      issues: [],
      sampledSceneIds: ['scene-1'],
      recommendations: [],
    },
    responsiveness: {
      overallScore: 92,
      conceptScores: [
        { conceptId: 'choice_reflected_in_prose', score: 92, evidence: 'probes diverge' },
        { conceptId: 'npc_reacts_to_player_choice', score: 91, evidence: 'NPCs register choices' },
      ],
      probeVerdicts: [],
      issues: [],
      recommendations: [],
    },
  };
}

describe('deriveRunQualityScore', () => {
  it('scores complete coherent Story Circle output above 90 while keeping legacy subscores diagnostic', () => {
    const result = deriveRunQualityScore({
      finalStory: makeStoryCircleStory(),
      qaReport: judgedQAReport(44),
      bestPracticesReport: { overallScore: 52, overallPassed: true, blockingIssues: [], warnings: [], suggestions: [] } as any,
      finalStoryContractReport: passingFinalStoryContract(),
    });

    expect(result.score).toBeGreaterThan(90);
    expect(result.basis.version).toBe(4);
    expect(result.basis.legacySubscores).toMatchObject({
      qaScore: 44,
      validationScore: 52,
      finalStoryContractScore: 100,
    });
    expect(result.basis.caps).toEqual([]);
    expect(result.basis.storyCircle.missingBeats).toEqual([]);
    expect(Object.fromEntries(result.basis.domains.map((domain) => [domain.id, domain.weight]))).toMatchObject({
      story_circle_spine: 15,
      dramatic_structure_architecture: 15,
      prose_craft: 15,
      scene_coherence_prose_continuity: 10,
      choice_agency: 18,
      branching_consequence_memory: 12,
      character_npc_relationship_quality: 8,
      gameplay_mechanics_as_fiction: 5,
      encounters: 2,
    });
    expect(result.basis.domains.find((domain) => domain.id === 'story_circle_spine')?.concepts)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'take_real_price', weight: 12 }),
        expect.objectContaining({ id: 'change_transformation_equilibrium', weight: 10 }),
      ]));
  });

  it('caps below 70 when every enabled Quality Council checkpoint errors before producing findings', () => {
    const result = deriveRunQualityScore({
      finalStory: makeStoryCircleStory(),
      finalStoryContractReport: passingFinalStoryContract(),
      qualityCouncilReport: {
        enabled: true,
        mode: 'repair-routing',
        checkpoints: ['plan', 'choice', 'route-playtest', 'final'].map((checkpoint) => ({
          checkpoint,
          status: 'error',
          summary: 'OpenRouter request failed.',
          findings: [],
          error: '401 Missing Authentication header',
          callsUsed: 1,
        })),
        summary: {
          recommendedRepairRoutes: [],
          highConfidenceFindings: [],
          advisoryFindings: [],
          fusionUsed: false,
          callsUsed: 4,
        },
      } as any,
    });

    expect(result.score).toBeLessThanOrEqual(69);
    expect(result.basis.caps.map((cap) => cap.id)).toContain('quality_council_all_checkpoints_failed');
  });

  it('does not cap when optional Fusion transport fails after the base final council passes', () => {
    const result = deriveRunQualityScore({
      finalStory: makeStoryCircleStory(),
      qaReport: judgedQAReport(),
      finalStoryContractReport: passingFinalStoryContract(),
      qualityCouncilReport: {
        enabled: true,
        mode: 'repair-routing',
        checkpoints: [
          {
            checkpoint: 'plan',
            status: 'passed',
            summary: 'Plan council passed.',
            findings: [],
            callsUsed: 1,
          },
          {
            checkpoint: 'route-playtest',
            status: 'passed',
            summary: 'Route council passed.',
            findings: [],
            callsUsed: 1,
          },
          {
            checkpoint: 'final',
            status: 'passed',
            summary: 'Final council passed.',
            findings: [],
            callsUsed: 1,
          },
          {
            checkpoint: 'final',
            status: 'error',
            summary: 'Quality Council final failed: OpenRouter API error: 404 - No endpoints found that can handle the requested parameters.',
            findings: [],
            error: 'OpenRouter API error: 404 - No endpoints found that can handle the requested parameters.',
            fusionUsed: true,
            callsUsed: 1,
          },
        ],
        summary: {
          recommendedRepairRoutes: [],
          highConfidenceFindings: [],
          advisoryFindings: [],
          fusionUsed: true,
          callsUsed: 4,
        },
      } as any,
    });

    expect(result.score).toBeGreaterThan(90);
    expect(result.basis.caps.map((cap) => cap.id)).not.toContain('quality_council_checkpoint_failed');
  });

  it('caps below 50 when route continuity blockers remain in the final contract', () => {
    const result = deriveRunQualityScore({
      finalStory: makeStoryCircleStory(),
      finalStoryContractReport: {
        ...passingFinalStoryContract(),
        passed: false,
        blockingIssues: [{
          type: 'route_chronology_violation',
          severity: 'error',
          message: 'Reader route stages walkHome before rooftopMeet.',
          validator: 'RouteContinuityValidator',
        }],
      } as any,
    });

    expect(result.score).toBeLessThanOrEqual(49);
    expect(result.basis.caps.map((cap) => cap.id)).toContain('route_continuity_hard_fail');
  });

  it('loads category and concept weight overrides from the tweakable markdown file', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'storyrpg-quality-weights-'));
    tempDirs.push(tempDir);
    const weightsPath = join(tempDir, 'QUALITY_SCORE_WEIGHTS.md');
    await writeFile(weightsPath, [
      '# Test weights',
      '## Category Weights',
      '| Category | Weight |',
      '|---|---:|',
      '| Story Circle spine | 21% |',
      '## Story Circle spine',
      '| Concept | Weight |',
      '|---|---:|',
      '| take: real price / loss / sacrifice | 30% |',
    ].join('\n'));

    const result = deriveRunQualityScore({
      finalStory: makeStoryCircleStory(),
      finalStoryContractReport: passingFinalStoryContract(),
    }, { weightsMarkdownPath: weightsPath });
    const storyCircle = result.basis.domains.find((domain) => domain.id === 'story_circle_spine');

    expect(storyCircle?.weight).toBe(21);
    expect(storyCircle?.concepts.find((concept) => concept.id === 'take_real_price')?.weight).toBe(30);
  });

  it('caps below 70 when any primary Story Circle beat is missing', () => {
    const result = deriveRunQualityScore({
      finalStory: makeStoryCircleStory({ omitBeats: ['go'] }),
      finalStoryContractReport: passingFinalStoryContract(),
    });

    expect(result.score).toBeLessThan(70);
    expect(result.basis.storyCircle.missingBeats).toContain('go');
    expect(result.basis.caps.map((cap) => cap.id)).toContain('story_circle_primary_beat_missing');
  });

  it('caps below 60 when the take price beat is missing', () => {
    const result = deriveRunQualityScore({
      finalStory: makeStoryCircleStory({ omitBeats: ['take'] }),
      finalStoryContractReport: passingFinalStoryContract(),
    });

    expect(result.score).toBeLessThan(60);
    expect(result.basis.caps.map((cap) => cap.id)).toContain('take_price_missing_or_weak');
  });

  it('caps below 60 when the change equilibrium beat is missing', () => {
    const result = deriveRunQualityScore({
      finalStory: makeStoryCircleStory({ omitBeats: ['change'] }),
      finalStoryContractReport: passingFinalStoryContract(),
    });

    expect(result.score).toBeLessThan(60);
    expect(result.basis.caps.map((cap) => cap.id)).toContain('change_equilibrium_missing_or_weak');
  });

  it('does not cap inactive take/change beats on a partial ep1 you-only slice', () => {
    const story = makeStoryCircleStory({
      omitBeats: ['need', 'go', 'search', 'find', 'take', 'return', 'change'],
    });
    (story as any).generatedOutputScope = {
      isPartialSeason: true,
      generatedEpisodeRange: { startEpisode: 1, endEpisode: 1 },
      sourceEpisodeCount: 8,
      requestedEpisodeCount: 1,
    };
    const result = deriveRunQualityScore({
      finalStory: story,
      brief: {
        seasonPlan: {
          episodes: [{
            episodeNumber: 1,
            storyCircleRole: [{ beat: 'you', roleKind: 'primary' }],
          }],
        },
      },
      finalStoryContractReport: passingFinalStoryContract(),
    });

    expect(result.basis.caps.map((cap) => cap.id)).not.toContain('take_price_missing_or_weak');
    expect(result.basis.caps.map((cap) => cap.id)).not.toContain('change_equilibrium_missing_or_weak');
  });

  it('caps metadata-only Story Circle labels below 70 when not realized in final prose', () => {
    const result = deriveRunQualityScore({
      finalStory: makeStoryCircleStory({ metadataOnly: true }),
      finalStoryContractReport: passingFinalStoryContract(),
    });

    expect(result.score).toBeLessThan(70);
    expect(result.basis.storyCircle.metadataOnlyBeats).toEqual(expect.arrayContaining(['you', 'take', 'change']));
    expect(result.basis.caps.map((cap) => cap.id)).toContain('episode_circle_metadata_only');
  });

  it('caps below 70 when critical beat placement is out of chronology', () => {
    const result = deriveRunQualityScore({
      finalStory: makeWrongOrderStoryCircleStory(),
      finalStoryContractReport: passingFinalStoryContract(),
    });

    expect(result.score).toBeLessThan(70);
    expect(result.basis.storyCircle.ordered).toBe(false);
    expect(result.basis.caps.map((cap) => cap.id)).toContain('story_circle_beats_out_of_order');
  });

  it('does not prove a generated Story Circle contract from unrelated later-scene prose', () => {
    const story = makeStory();
    const episode = story.episodes[0] as any;
    episode.scenes = [
      {
        id: 'scene-search-carrier',
        name: 'Search Carrier',
        startingBeatId: 'beat-search-carrier',
        turnType: 'preparation',
        storyCircleBeatContracts: [{
          id: 'search-future-contract',
          beat: 'search',
          sourceText: 'Mara searches the future castle for the forbidden ledger.',
          targetEpisodeNumber: 1,
          targetSceneIds: ['scene-search-carrier'],
          blockingLevel: 'structural',
        }],
        beats: [{ id: 'beat-search-carrier', text: 'Mara pockets a key and waits at the old threshold.', choices: [] }],
      },
      {
        id: 'scene-go',
        name: 'Go',
        startingBeatId: 'beat-go',
        turnType: 'threshold_crossing',
        storyCircleBeatContracts: [{
          id: 'go-contract',
          beat: 'go',
          sourceText: STORY_CIRCLE_FIXTURE.go,
          targetEpisodeNumber: 1,
          targetSceneIds: ['scene-go'],
          blockingLevel: 'structural',
        }],
        beats: [{
          id: 'beat-go',
          text: `${STORY_CIRCLE_FIXTURE.go} Mara searches the future castle for the forbidden ledger.`,
          choices: [],
        }],
      },
    ];

    const result = deriveRunQualityScore({
      finalStory: story,
      brief: {
        seasonPlan: {
          storyCircle: {
            search: 'Mara searches the future castle for the forbidden ledger.',
          },
        },
      },
      finalStoryContractReport: passingFinalStoryContract(),
    });

    expect(result.basis.storyCircle.beats.search.status).toBe('metadata-only');
    expect(result.basis.storyCircle.ordered).toBe(true);
    expect(result.basis.caps.map((cap) => cap.id)).not.toContain('story_circle_beats_out_of_order');
  });

  it('does not prove long Story Circle scaffold expectations from a small token overlap', () => {
    const story = makeStory();
    const episode = story.episodes[0] as any;
    episode.scenes = [{
      id: 's1-arrival-cold-open',
      name: 'Kylie arrives in Bucharest',
      startingBeatId: 'beat-arrival',
      turnType: 'setup',
      storyCircleBeatContracts: [{
        id: 'future-search',
        beat: 'search',
        sourceText: 'Test adaptation under pressure through failed plans, new rules, allies, tools, and identity-revealing choices: The slow-burn mountain weekend in Bucharest and Victor first explicit demand to discuss the blog.',
        targetEpisodeNumber: 1,
        targetSceneIds: ['s1-arrival-cold-open'],
        blockingLevel: 'structural',
      }],
      beats: [{
        id: 'beat-arrival',
        text: 'Kylie arrives in Bucharest with two suitcases and her grandmother address.',
        choices: [],
      }],
    }];

    const result = deriveRunQualityScore({
      finalStory: story,
      finalStoryContractReport: passingFinalStoryContract(),
    });

    expect(result.basis.storyCircle.beats.search.status).toBe('metadata-only');
    expect(result.basis.storyCircle.beats.search.evidence).not.toEqual(
      expect.arrayContaining([expect.stringContaining('final prose matches')]),
    );
  });

  it('scopes partial-season Story Circle scoring to generated episodes instead of future season beats', () => {
    const story = makeStoryCircleStory();
    story.generatedOutputScope = {
      sourceEpisodeCount: 8,
      requestedEpisodeCount: 1,
      generatedEpisodeRange: { startEpisode: 1, endEpisode: 1 },
      isPartialSeason: true,
      treatmentCompleteness: 'partial-slice',
    };
    const scene = story.episodes[0].scenes[0] as any;
    scene.storyCircleBeatContracts = [
      ...(scene.storyCircleBeatContracts ?? []),
      {
        id: 'future-search',
        beat: 'search',
        sourceText: 'The slow-burn mountain weekend at Casa Lupului offers an honest alternative.',
        targetEpisodeNumber: 4,
        targetSceneIds: [scene.id],
        blockingLevel: 'treatment',
      },
    ];

    const result = deriveRunQualityScore({
      finalStory: story,
      qaReport: judgedQAReport(),
      brief: {
        seasonPlan: {
          storyCircle: {
            search: 'The slow-burn mountain weekend at Casa Lupului offers an honest alternative.',
            change: 'On the Hunter Moon, Kylie chooses the Mountain Wife route.',
          },
          storyCircleBeatContracts: [{
            beat: 'search',
            sourceText: 'The slow-burn mountain weekend at Casa Lupului offers an honest alternative.',
            targetEpisodeNumber: 4,
          }],
        },
      },
      finalStoryContractReport: passingFinalStoryContract(),
    });

    expect(result.score).toBeGreaterThan(90);
    expect(JSON.stringify(result.basis.storyCircle)).not.toMatch(/Casa Lupului|slow-burn mountain|Hunter Moon|Mountain Wife/);
    expect(result.basis.storyCircle.beats.search.status).toBe('realized');
    expect(result.basis.caps.map((cap) => cap.id)).not.toContain('episode_circle_metadata_only');
  });

  it('caps leakage below 70 and repeated leakage below 50', () => {
    const result = deriveRunQualityScore({
      finalStory: makeStoryCircleStory({
        // Same pattern recurring (2x "skill check") plus a DC mention: 3 total
        // occurrences — repeated/central under the v4 occurrence-count rule.
        extraProse: ' A visible skill check begins here. Another skill check follows, and the DC 12 result is announced to the player.',
      }),
      finalStoryContractReport: passingFinalStoryContract(),
    });

    expect(result.score).toBeLessThan(50);
    expect(result.basis.caps.map((cap) => cap.id)).toEqual(expect.arrayContaining([
      'player_facing_mechanics_leakage',
      'repeated_or_central_leakage',
    ]));
  });

  it('caps cosmetic branching below 80', () => {
    const result = deriveRunQualityScore({
      finalStory: makeStoryCircleStory({ cosmeticChoice: true }),
      finalStoryContractReport: passingFinalStoryContract(),
    });

    expect(result.score).toBeLessThan(80);
    expect(result.basis.caps.map((cap) => cap.id)).toContain('branching_cosmetic_or_residue_free');
  });

  it('awards no structural credit for Story Circle-only evidence', () => {
    const story = makeStoryCircleStory({ omitEpisodeCircle: true });
    const result = deriveRunQualityScore({
      finalStory: story,
      brief: {
        seasonPlan: {
          storyCircle: {
            you: '',
            need: '',
            go: 'legacy turn',
            search: 'legacy pinch',
            find: 'legacy find',
            take: 'legacy pinch',
            return: 'legacy return',
            change: 'legacy change',
          },
        },
      },
      finalStoryContractReport: passingFinalStoryContract(),
    });

    expect(result.score).toBeLessThan(70);
    expect(result.basis.storyCircle.missingBeats).toEqual(['you', 'need']);
  });
});

describe('reconcileBestPracticesReportForFinalStory', () => {
  it('drops stale relationship-id blockers when the final story no longer contains the target', () => {
    const story = makeStory();
    story.episodes[0].scenes[0].beats[0].choices = [{
      id: 'choice-1',
      text: 'Ask Kylie.',
      consequences: [{ type: 'setFlag', flag: 'asked_kylie', value: true }],
    } as any];

    const report = reconcileBestPracticesReportForFinalStory({
      overallScore: 93,
      overallPassed: false,
      qualityScore: 93,
      metrics: {},
      blockingIssues: [{
        category: 'mechanical_storytelling',
        message: 'Relationship consequence on choice "choice-1" targets unknown NPC "char-kylie-marinescu" — the delta will be silently dropped at runtime.',
      }],
      warnings: [],
      suggestions: [],
      timestamp: 'now',
      duration: 1,
    } as any, story);

    expect(report?.overallPassed).toBe(true);
    expect(report?.blockingIssues).toEqual([]);
  });

  it('keeps relationship-id blockers when the final story still contains the target', () => {
    const story = makeStory();
    story.episodes[0].scenes[0].beats[0].choices = [{
      id: 'choice-1',
      text: 'Trust Kylie.',
      consequences: [{ type: 'relationship', npcId: 'char-kylie-marinescu', value: 1 }],
    } as any];

    const report = reconcileBestPracticesReportForFinalStory({
      overallScore: 93,
      overallPassed: false,
      qualityScore: 93,
      metrics: {},
      blockingIssues: [{
        category: 'mechanical_storytelling',
        message: 'Relationship consequence on choice "choice-1" targets unknown NPC "char-kylie-marinescu" — the delta will be silently dropped at runtime.',
      }],
      warnings: [],
      suggestions: [],
      timestamp: 'now',
      duration: 1,
    } as any, story);

    expect(report?.overallPassed).toBe(false);
    expect(report?.blockingIssues).toHaveLength(1);
  });

  it('drops stale stat-check blockers when final story weights are normalized', () => {
    const story = makeStory();
    story.episodes[0].scenes[0].beats[0].choices = [{
      id: 'choice-1',
      text: 'Answer honestly.',
      statCheck: { difficulty: 35, skillWeights: { deception: 1 } },
      consequences: [],
    } as any];

    const report = reconcileBestPracticesReportForFinalStory({
      overallScore: 93,
      overallPassed: false,
      qualityScore: 93,
      metrics: {},
      blockingIssues: [{
        category: 'stat_check_balance',
        message: 'Stat check "choice-1" has skillWeights totaling -1.00 instead of 1.0.',
      }],
      warnings: [],
      suggestions: [],
      timestamp: 'now',
      duration: 1,
    } as any, story);

    expect(report?.overallPassed).toBe(true);
    expect(report?.blockingIssues).toEqual([]);
  });
});

function makeStory(): Story {
  return {
    id: 'story-writer-test',
    title: 'Story Writer Test',
    genre: 'Mystery',
    synopsis: 'A tiny story package fixture.',
    coverImage: '',
    author: 'Test',
    tags: [],
    initialState: {
      attributes: {
        charm: 0,
        wit: 0,
        courage: 0,
        empathy: 0,
        resolve: 0,
        resourcefulness: 0,
      },
      skills: {},
      tags: [],
      inventory: [],
    },
    npcs: [],
    episodes: [
      {
        id: 'episode-1',
        number: 1,
        title: 'Episode 1',
        synopsis: 'Test episode.',
        coverImage: '',
        startingSceneId: 'scene-1',
        scenes: [
          {
            id: 'scene-1',
            name: 'Scene 1',
            startingBeatId: 'beat-1',
            beats: [{ id: 'beat-1', text: 'The package writes.', choices: [] }],
          },
        ],
      },
    ],
  };
}

const STORY_CIRCLE_FIXTURE = {
  you: 'Mara tends the quiet archive while council pressure tightens around her old life',
  need: 'Mara needs the missing lantern key because her fear keeps the truth locked away',
  go: 'Mara crosses the floodlit threshold into the forbidden stacks where retreat becomes dangerous',
  search: 'Mara adapts under pressure by bargaining with echoes and reading the room instead of hiding',
  find: 'Mara obtains the hidden answer but learns it exposes her mentor to ruin',
  take: 'Mara pays the price by burning her safe alibi and choosing the wound over comfort',
  return: 'Mara carries the lantern prize and the wound back into the council chamber',
  change: 'Mara creates a new equilibrium by speaking as the archive keeper instead of the obedient clerk',
} as const;

type StoryCircleFixtureBeat = keyof typeof STORY_CIRCLE_FIXTURE;

function makeStoryCircleStory(options: {
  omitBeats?: StoryCircleFixtureBeat[];
  metadataOnly?: boolean;
  extraProse?: string;
  cosmeticChoice?: boolean;
  omitEpisodeCircle?: boolean;
} = {}): Story {
  const story = makeStory();
  const episode = story.episodes[0] as any;
  const scene = episode.scenes[0] as any;
  const circle = Object.fromEntries(
    Object.entries(STORY_CIRCLE_FIXTURE).filter(([beat]) => !options.omitBeats?.includes(beat as StoryCircleFixtureBeat)),
  );

  if (!options.omitEpisodeCircle) {
    episode.episodeCircle = circle;
  }

  scene.turnType = 'irreversible_choice';
  scene.beats[0].text = options.metadataOnly
    ? `Mara pauses in a dim room and decides the night cannot stay simple.${options.extraProse ?? ''}`
    : `${Object.values(circle).join(' ')}${options.extraProse ?? ''}`;
  scene.beats[0].choices = [
    options.cosmeticChoice
      ? { id: 'choice-1', text: 'Nod without changing anything.' }
      : {
          id: 'choice-1',
          text: 'Carry the lantern into the chamber.',
          nextSceneId: 'scene-1',
          consequences: [{ type: 'setFlag', flag: 'carried_lantern_truth', value: true }],
          outcomeText: 'The choice leaves a remembered promise in the chamber.',
        },
  ] as any;

  return story;
}

function makeWrongOrderStoryCircleStory(): Story {
  const story = makeStory();
  const episode = story.episodes[0] as any;
  episode.scenes = [
    {
      id: 'scene-go-first',
      name: 'Go First',
      startingBeatId: 'beat-go',
      turnType: 'threshold_crossing',
      storyCircleBeatContracts: [{ beat: 'go', sourceText: STORY_CIRCLE_FIXTURE.go }],
      beats: [{ id: 'beat-go', text: STORY_CIRCLE_FIXTURE.go, choices: [] }],
    },
    {
      id: 'scene-you-after',
      name: 'You After Go',
      startingBeatId: 'beat-rest',
      turnType: 'return_with_difference',
      storyCircleBeatContracts: [
        { beat: 'you', sourceText: STORY_CIRCLE_FIXTURE.you },
        { beat: 'need', sourceText: STORY_CIRCLE_FIXTURE.need },
        { beat: 'search', sourceText: STORY_CIRCLE_FIXTURE.search },
        { beat: 'find', sourceText: STORY_CIRCLE_FIXTURE.find },
        { beat: 'take', sourceText: STORY_CIRCLE_FIXTURE.take },
        { beat: 'return', sourceText: STORY_CIRCLE_FIXTURE.return },
        { beat: 'change', sourceText: STORY_CIRCLE_FIXTURE.change },
      ],
      beats: [{
        id: 'beat-rest',
        text: [
          STORY_CIRCLE_FIXTURE.you,
          STORY_CIRCLE_FIXTURE.need,
          STORY_CIRCLE_FIXTURE.search,
          STORY_CIRCLE_FIXTURE.find,
          STORY_CIRCLE_FIXTURE.take,
          STORY_CIRCLE_FIXTURE.return,
          STORY_CIRCLE_FIXTURE.change,
        ].join(' '),
        choices: [{
          id: 'choice-1',
          text: 'Carry the consequence forward.',
          nextSceneId: 'scene-you-after',
          consequences: [{ type: 'setFlag', flag: 'accepted_wrong_order_cost', value: true }],
        }],
      }],
    },
  ];
  return story;
}

function passingFinalStoryContract() {
  return {
    passed: true,
    blockingIssues: [],
    warnings: [],
    metrics: {
      episodesChecked: 1,
      scenesChecked: 1,
      beatsChecked: 1,
      encounterScenesChecked: 0,
      validEncounterScenes: 0,
      requestedEpisodesMissing: 0,
      failedIncrementalResults: 0,
      callbackIssues: 0,
      mechanicsLeaks: 0,
    },
    generatedAt: '2026-05-28T00:00:00.000Z',
  } as any;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('pipelineOutputWriter', () => {
  it('savePartialStory writes a marked recovery snapshot with the completed episodes (B2)', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'storyrpg-partial-'));
    tempDirs.push(tempDir);
    const outputDir = `${tempDir}/`;

    await savePartialStory(outputDir, makeStory());

    const raw = await readFile(`${outputDir}partial-story.json`, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed._partial).toBe(true);
    expect(parsed.episodeCount).toBe(1);
    expect(parsed.story.title).toBe('Story Writer Test');
  });

  it('savePartialStory is best-effort and does not throw on a bad dir', async () => {
    await expect(savePartialStory('', makeStory())).resolves.toBeUndefined();
  });

  it('saveFinalStoryContractFailure writes failed report and diagnostic partial without package files', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'storyrpg-contract-failed-'));
    tempDirs.push(tempDir);
    const outputDir = `${tempDir}/`;

    await saveFinalStoryContractFailure(outputDir, makeStory(), {
      passed: false,
      blockingIssues: [{
        type: 'outcome_text_stub',
        severity: 'error',
        message: 'Outcome text is still a fallback stub.',
      }],
      warnings: [],
      metrics: {
        episodesChecked: 1,
        scenesChecked: 1,
        beatsChecked: 1,
        encounterScenesChecked: 0,
        validEncounterScenes: 0,
        requestedEpisodesMissing: 0,
        failedIncrementalResults: 0,
        callbackIssues: 0,
        mechanicsLeaks: 0,
      },
      generatedAt: '2026-06-19T00:00:00.000Z',
    });

    const report = JSON.parse(await readFile(`${outputDir}07b-final-story-contract.failed.json`, 'utf8'));
    expect(report.passed).toBe(false);
    expect(report.blockingIssues[0].type).toBe('outcome_text_stub');

    const partial = JSON.parse(await readFile(`${outputDir}partial-story.json`, 'utf8'));
    expect(partial._partial).toBe(true);
    expect(partial._diagnostic).toBe(true);
    expect(partial.story.title).toBe('Story Writer Test');

    await expect(readFile(`${outputDir}story.json`, 'utf8')).rejects.toThrow();
    await expect(readFile(`${outputDir}manifest.json`, 'utf8')).rejects.toThrow();
    await expect(readFile(`${outputDir}08-final-story.json`, 'utf8')).rejects.toThrow();
  });

  it('writes final story packages through Node built-in modules when require is unavailable', async () => {
    const originalGetBuiltinModule = process.getBuiltinModule;
    const requestedModules: string[] = [];
    vi.spyOn(process, 'getBuiltinModule').mockImplementation(((name: string) => {
      requestedModules.push(name);
      return originalGetBuiltinModule(name);
    }) as typeof process.getBuiltinModule);

    const tempDir = await mkdtemp(join(tmpdir(), 'storyrpg-output-writer-'));
    tempDirs.push(tempDir);
    const outputDir = `${tempDir}/`;

    const result = await writeFinalStoryPackage(outputDir, makeStory(), {
      generator: { version: 'test', pipeline: 'vitest' },
    });

    await expect(readFile(result.storyJsonPath, 'utf8')).resolves.toContain('story-writer-test');
    await expect(readFile(result.manifestPath, 'utf8')).resolves.toContain('story.json');
    await expect(readFile(`${outputDir}08-final-story.json`, 'utf8')).rejects.toThrow();
    expect(requestedModules).toEqual(expect.arrayContaining(['fs', 'path', 'crypto']));
  });

  it('persists generator style profile and anchors onto the story body', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'storyrpg-output-writer-'));
    tempDirs.push(tempDir);
    const outputDir = `${tempDir}/`;

    const result = await writeFinalStoryPackage(outputDir, makeStory(), {
      generator: {
        version: 'test',
        pipeline: 'vitest',
        artStyleProfile: { name: 'Verbatim', family: 'unknown', rawStyle: 'bright comic art' },
        styleAnchors: { character: { imagePath: 'generated-stories/story/style-bible/character.png' } },
      },
    });

    const pkg = JSON.parse(await readFile(result.storyJsonPath, 'utf8'));
    expect(pkg.story.artStyleProfile).toMatchObject({ rawStyle: 'bright comic art' });
    expect(pkg.story.styleAnchors.character.imagePath).toBe('generated-stories/story/style-bible/character.png');
  });

  it('creates recovered prompt artifacts for bound story images that lack exact prompt files', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'storyrpg-output-writer-'));
    tempDirs.push(tempDir);
    const outputDir = `${tempDir}/`;
    const story = makeStory();
    story.episodes[0].scenes[0].beats[0].image =
      'generated-stories/story-writer-test/images/storyboard-v2/panels/storyboard-v2-story-beat-episode-1-scene-1-beat-1.png';

    await writeFinalStoryPackage(outputDir, story, {
      generator: { version: 'test', artStyle: 'local style lock' },
    });

    const prompt = JSON.parse(await readFile(
      `${outputDir}images/prompts/storyboard-v2-story-beat-episode-1-scene-1-beat-1.json`,
      'utf8',
    ));
    expect(prompt.metadata).toMatchObject({
      type: 'recovered-bound-image-prompt',
      storyId: 'story-writer-test',
      exactOriginalPromptMissing: true,
    });
    expect(prompt.prompt).toContain('The package writes.');
    expect(prompt.prompt).toContain('local style lock');

    const report = JSON.parse(await readFile(`${outputDir}image-prompt-binding-report.json`, 'utf8'));
    expect(report).toMatchObject({ checked: 1, alreadyPresent: 0, recovered: 1 });
    expect(report.records[0]).toMatchObject({
      status: 'recovered',
      promptPath: 'images/prompts/storyboard-v2-story-beat-episode-1-scene-1-beat-1.json',
    });
  });

  it('preserves existing exact prompt artifacts when writing final packages', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'storyrpg-output-writer-'));
    tempDirs.push(tempDir);
    const outputDir = `${tempDir}/`;
    const story = makeStory();
    story.episodes[0].scenes[0].beats[0].image =
      'generated-stories/story-writer-test/images/beat-episode-1-scene-1-beat-1.png';

    await mkdir(`${outputDir}images/prompts`, { recursive: true });
    await writeFile(
      `${outputDir}images/prompts/beat-episode-1-scene-1-beat-1.json`,
      JSON.stringify({ identifier: 'original', prompt: 'original provider prompt' }, null, 2),
    );

    await writeFinalStoryPackage(outputDir, story, {
      generator: { version: 'test', artStyle: 'local style lock' },
    });

    const prompt = JSON.parse(await readFile(`${outputDir}images/prompts/beat-episode-1-scene-1-beat-1.json`, 'utf8'));
    expect(prompt).toEqual({ identifier: 'original', prompt: 'original provider prompt' });

    const report = JSON.parse(await readFile(`${outputDir}image-prompt-binding-report.json`, 'utf8'));
    expect(report).toMatchObject({ checked: 1, alreadyPresent: 1, recovered: 0 });
  });

  it('writes the final story contract sidecar and manifest summary', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'storyrpg-output-writer-'));
    tempDirs.push(tempDir);
    const outputDir = `${tempDir}/`;

    await savePipelineOutputs(outputDir, {
      brief: {
        story: {
          id: 'story-writer-test',
          title: 'Story Writer Test',
          genre: 'Mystery',
          synopsis: 'A tiny story package fixture.',
          themes: [],
        },
      },
      finalStory: makeStoryCircleStory(),
      qaReport: judgedQAReport(),
      finalStoryContractReport: passingFinalStoryContract(),
    } as any, 123);

    const contract = JSON.parse(await readFile(`${outputDir}07b-final-story-contract.json`, 'utf8'));
    expect(contract).toMatchObject({ passed: true });

    const qualityReport = JSON.parse(await readFile(`${outputDir}07c-quality-score-report.json`, 'utf8'));
    expect(qualityReport).toMatchObject({
      version: 4,
      finalScore: expect.any(Number),
      storyCircle: expect.objectContaining({ missingBeats: [] }),
      legacySubscores: expect.objectContaining({ finalStoryContractScore: 100 }),
    });

    const manifest = JSON.parse(await readFile(`${outputDir}manifest.json`, 'utf8'));
    expect(manifest.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Final Story Contract', type: 'final-story-contract' }),
      expect.objectContaining({ name: 'Quality Score Report', type: 'quality-score' }),
    ]));
    expect(manifest.summary).toMatchObject({
      finalStoryContractPassed: true,
      finalStoryContractBlockingIssues: 0,
      qualityScore: expect.any(Number),
      qualityScoreBasis: expect.objectContaining({
        version: 4,
        evidenceCoverage: 100,
        legacySubscores: expect.objectContaining({ finalStoryContractScore: 100 }),
      }),
    });
    expect(manifest.summary.qualityScore).toBeGreaterThan(90);
  });

  it('supersedes stale failure diagnostics when a later successful package is written', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'storyrpg-output-writer-'));
    tempDirs.push(tempDir);
    const outputDir = `${tempDir}/`;
    await writeFile(`${outputDir}07b-final-story-contract.failed.json`, JSON.stringify({ passed: false }));
    await writeFile(`${outputDir}99-pipeline-errors.json`, JSON.stringify({ errorCount: 1 }));

    await savePipelineOutputs(outputDir, {
      brief: {
        story: {
          id: 'story-writer-test',
          title: 'Story Writer Test',
          genre: 'Mystery',
          synopsis: 'A tiny story package fixture.',
          themes: [],
        },
      },
      finalStory: makeStory(),
      finalStoryContractReport: {
        passed: true,
        blockingIssues: [],
        warnings: [],
        metrics: {
          episodesChecked: 1,
          scenesChecked: 1,
          beatsChecked: 1,
          encounterScenesChecked: 0,
          validEncounterScenes: 0,
          requestedEpisodesMissing: 0,
          failedIncrementalResults: 0,
          callbackIssues: 0,
          mechanicsLeaks: 0,
        },
        generatedAt: '2026-05-28T00:00:00.000Z',
      },
    } as any, 123);

    await expect(readFile(`${outputDir}07b-final-story-contract.failed.json`, 'utf8')).rejects.toThrow();
    await expect(readFile(`${outputDir}99-pipeline-errors.json`, 'utf8')).rejects.toThrow();

    const supersededRoot = join(outputDir, 'superseded-failures');
    const { readdir } = await import('fs/promises');
    const dirs = await readdir(supersededRoot);
    expect(dirs).toHaveLength(1);
    const marker = JSON.parse(await readFile(join(supersededRoot, dirs[0], 'superseded-by-success.json'), 'utf8'));
    expect(marker.moved.map((entry: { from: string }) => entry.from)).toEqual(expect.arrayContaining([
      '07b-final-story-contract.failed.json',
      '99-pipeline-errors.json',
    ]));
  });
});
