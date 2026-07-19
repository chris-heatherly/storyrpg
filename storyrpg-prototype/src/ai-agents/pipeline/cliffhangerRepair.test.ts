import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Episode } from '../../types';
import { CliffhangerValidator, type CliffhangerAnalysis } from '../validators';
import { repairWeakCliffhangerBeforeImages, type CliffhangerRepairDeps } from './cliffhangerRepair';
import type { FullCreativeBrief } from './FullStoryPipeline';
import type { EpisodeBlueprint } from '../agents/StoryArchitect';
import type { SceneContent } from '../agents/SceneWriter';
import type { ChoiceSet } from '../agents/ChoiceAuthor';
import type { WorldBible } from '../agents/WorldBuilder';
import type { CharacterBible } from '../agents/CharacterDesigner';

function analysis(score: number, quality: CliffhangerAnalysis['quality'], text: string): CliffhangerAnalysis {
  return {
    hasCliffhanger: quality !== 'missing',
    quality,
    type: 'mystery',
    score,
    strengths: [],
    weaknesses: quality === 'weak' ? ['weak'] : [],
    finalBeatText: text,
    unresolvedTension: '',
    emotionalHook: '',
    suggestions: ['deliver the planned question'],
  };
}

function fixture() {
  const cliffhangerPlan = {
    type: 'mystery', intensity: 'medium', hook: 'Who sent the familiar photograph?',
    setup: 'The photograph was planted earlier.', resolvedEpisodeTension: 'Kylie publishes the post.',
    newOpenQuestion: 'Who is watching?', emotionalCharge: 'unease',
    nextEpisodePressure: 'Trace the photograph.', style: 'serialized_tv',
  };
  const brief = {
    story: { title: 'T', genre: 'mystery', synopsis: '', tone: '', themes: [] },
    world: { premise: '', timePeriod: '', technologyLevel: '', keyLocations: [] },
    protagonist: { id: 'kylie', name: 'Kylie', pronouns: 'she/her', description: '', role: '' },
    npcs: [],
    episode: { number: 1, title: 'One', synopsis: '', startingLocation: '' },
    seasonPlan: {
      episodes: [
        { episodeNumber: 1, cliffhangerPlan },
        { episodeNumber: 2 },
      ],
      scenePlan: {
        narrativeContractGraph: {
          realizationTasks: [{
            id: 'task:ending', contractId: 'ending', episodeNumber: 1,
            ownerStage: 'scene_writer', repairHandler: 'scene_prose', sceneId: 's1-final',
            target: { scope: 'owner', surfaces: ['beat_text'] }, sourceContractIds: ['ending'], blocking: true,
            evidenceAtoms: [
              { id: 'literal:kylie', description: 'Kylie owns the final decision.', acceptedPatterns: ['Kylie'], kind: 'lexical', verificationAuthority: 'literal', required: true },
              { id: 'forbidden:threat', description: 'A new attacker displaces Kylie from the ending.', acceptedPatterns: ['attacker'], kind: 'semantic', verificationAuthority: 'semantic_judge', required: true, polarity: 'forbidden' },
            ],
          }],
        },
      },
    },
  } as unknown as FullCreativeBrief;
  const blueprint = { scenes: [{ id: 's1-final', leadsTo: [] }] } as unknown as EpisodeBlueprint;
  const sceneContents = [{
    sceneId: 's1-final',
    beats: [{ id: 's1-final-b1', text: 'Kylie closes the laptop after publishing the post.' }],
  }] as unknown as SceneContent[];
  const assembleEpisode: CliffhangerRepairDeps['assembleEpisode'] = (_brief, _world, _characters, _blueprint, scenes) => ({
    id: 'ep-1', number: 1, title: 'One', synopsis: '', coverImage: '', startingSceneId: 's1-final',
    scenes: scenes.map((scene) => ({ id: scene.sceneId, name: scene.sceneId, startingBeatId: scene.beats[0]?.id, beats: scene.beats })),
  } as unknown as Episode);
  return {
    brief,
    blueprint,
    sceneContents,
    assembleEpisode,
    worldBible: { locations: [] } as unknown as WorldBible,
    characterBible: { characters: [] } as unknown as CharacterBible,
    choiceSets: [] as ChoiceSet[],
  };
}

afterEach(() => vi.restoreAllMocks());

describe('repairWeakCliffhangerBeforeImages', () => {
  it('rejects a contract-regressing candidate, retries once, and commits only the safe candidate', async () => {
    const f = fixture();
    vi.spyOn(CliffhangerValidator.prototype, 'quickAnalyze').mockImplementation((episode) => {
      const text = episode.scenes[0].beats.at(-1)?.text ?? '';
      return text.includes('after publishing the post') ? analysis(40, 'weak', text) : analysis(75, 'good', text);
    });
    const improve = vi.spyOn(CliffhangerValidator.prototype, 'improveCliffhanger')
      .mockResolvedValueOnce({
        success: true,
        data: { originalText: '', improvedText: 'An attacker arrives and steals the ending from Kylie.', cliffhangerType: 'mystery', explanation: 'unsafe' },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { originalText: '', improvedText: 'Kylie closes the laptop; the familiar photograph leaves one question unanswered.', cliffhangerType: 'mystery', explanation: 'safe' },
      });
    const emitted: string[] = [];
    const deps: CliffhangerRepairDeps = {
      sceneWriterConfig: { provider: 'anthropic', model: 'test', apiKey: 'x' } as never,
      emit: (event) => emitted.push(event.message),
      recordRemediationSafe: vi.fn(async () => undefined),
      assembleEpisode: f.assembleEpisode,
      validateSceneContract: vi.fn(async ({ scene }) => scene.beats.some((beat) => beat.text.includes('attacker'))
        ? [{ blocking: true, fingerprint: 'ending-displaced', code: 'SEMANTIC_FORBIDDEN_EVIDENCE_PRESENT', taskId: 'task:ending', message: 'The attacker displaces Kylie.' }]
        : []),
    };

    await repairWeakCliffhangerBeforeImages(
      deps, f.brief, f.worldBible, f.characterBible, f.blueprint,
      f.sceneContents, f.choiceSets,
    );

    expect(improve).toHaveBeenCalledTimes(2);
    expect(improve.mock.calls[0]?.[3]).toMatchObject({
      requiredMeanings: ['Kylie owns the final decision.'],
      forbiddenMeanings: ['A new attacker displaces Kylie from the ending.'],
    });
    expect(improve.mock.calls[1]?.[3]?.retryFeedback).toContain('attacker displaces Kylie');
    expect(f.sceneContents[0].beats[0].text).toContain('familiar photograph');
    expect(f.sceneContents[0].beats[0].text).not.toContain('attacker');
    expect(emitted.join('\n')).toContain('Rejected cliffhanger candidate 1/2');
  });

  it('retains the original ending when both bounded candidates regress the canonical contract', async () => {
    const f = fixture();
    const original = f.sceneContents[0].beats[0].text;
    vi.spyOn(CliffhangerValidator.prototype, 'quickAnalyze').mockImplementation((episode) => {
      const text = episode.scenes[0].beats.at(-1)?.text ?? '';
      return text === original ? analysis(40, 'weak', text) : analysis(75, 'good', text);
    });
    vi.spyOn(CliffhangerValidator.prototype, 'improveCliffhanger').mockResolvedValue({
      success: true,
      data: { originalText: '', improvedText: 'An attacker arrives with an unrelated threat.', cliffhangerType: 'mystery', explanation: 'unsafe' },
    });
    const deps: CliffhangerRepairDeps = {
      sceneWriterConfig: { provider: 'anthropic', model: 'test', apiKey: 'x' } as never,
      emit: vi.fn(),
      recordRemediationSafe: vi.fn(async () => undefined),
      assembleEpisode: f.assembleEpisode,
      validateSceneContract: vi.fn(async ({ scene }) => scene.beats.some((beat) => beat.text.includes('attacker'))
        ? [{ blocking: true, fingerprint: 'ending-displaced', code: 'SEMANTIC_FORBIDDEN_EVIDENCE_PRESENT', taskId: 'task:ending' }]
        : []),
    };

    await repairWeakCliffhangerBeforeImages(
      deps, f.brief, f.worldBible, f.characterBible, f.blueprint,
      f.sceneContents, f.choiceSets,
    );

    expect(f.sceneContents[0].beats[0].text).toBe(original);
  });
});
