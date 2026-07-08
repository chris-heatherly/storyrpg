import { describe, expect, it } from 'vitest';
import type { StoryCircleStructure } from '../../types/sourceAnalysis';
import type { StoryCircleBeatRealizationContract } from '../../types/scenePlan';
import { buildEpisodeCircleBeatContracts } from '../utils/storyCircleBeatContracts';
import { EpisodeStoryCircleValidator, type EpisodeStoryCircleScene } from './EpisodeStoryCircleValidator';

const validator = new EpisodeStoryCircleValidator();

const circle: StoryCircleStructure = {
  you: 'Kylie begins the night using observation as armor at the public rooftop table.',
  need: 'Kylie needs proof that Mika’s welcome is not just another performance.',
  go: 'Kylie crosses into the members-only corridor where her old tactics stop working.',
  search: 'Kylie tests charm, suspicion, and trust while the corridor keeps changing.',
  find: 'Kylie finds Mika hiding the invitation ledger in the mirrored office.',
  take: 'Kylie takes the ledger and loses Mika’s easy trust in the same breath.',
  return: 'Kylie carries the ledger back to the rooftop with everyone watching.',
  change: 'Kylie chooses to publish nothing yet and becomes a participant instead of an observer.',
};

function scenes(contracts: StoryCircleBeatRealizationContract[] = []): EpisodeStoryCircleScene[] {
  const byScene = new Map<string, StoryCircleBeatRealizationContract[]>();
  for (const contract of contracts) {
    for (const sceneId of contract.targetSceneIds) {
      byScene.set(sceneId, [...(byScene.get(sceneId) ?? []), contract]);
    }
  }
  return [
    { id: 's3-1', narrativeRole: 'setup', storyCircleBeatContracts: byScene.get('s3-1') ?? [] },
    { id: 's3-2', narrativeRole: 'turn', storyCircleBeatContracts: byScene.get('s3-2') ?? [] },
    { id: 's3-3', narrativeRole: 'release', storyCircleBeatContracts: byScene.get('s3-3') ?? [] },
  ];
}

function contracts(episodeCircle: StoryCircleStructure = circle): StoryCircleBeatRealizationContract[] {
  return buildEpisodeCircleBeatContracts({
    episodeNumber: 3,
    episodeCircle,
    storyCircleRole: [{ beat: 'find', roleKind: 'primary' }],
    scenes: [
      { id: 's3-1', order: 0, narrativeRole: 'setup' },
      { id: 's3-2', order: 1, narrativeRole: 'turn', isEncounter: true },
      { id: 's3-3', order: 2, narrativeRole: 'release' },
    ],
  });
}

describe('EpisodeStoryCircleValidator', () => {
  it('passes a compact three-scene episode with all beats bound', () => {
    const result = validator.validate({
      episodeNumber: 3,
      episodeCircle: circle,
      storyCircleRole: [{ beat: 'find', roleKind: 'primary' }],
      scenes: scenes(contracts()),
    });

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('accepts a beat whose prose merely contains a placeholder word (live FP regression)', () => {
    const result = validator.validate({
      episodeNumber: 3,
      episodeCircle: {
        ...circle,
        need: 'Kylie needs to decide whether an unknown payout is worth the crew’s trust.',
      },
      storyCircleRole: [{ beat: 'find', roleKind: 'primary' }],
      scenes: scenes(contracts()),
    });

    expect(result.issues.some((issue) => issue.location === 'episodeCircle.need')).toBe(false);
  });

  it('still rejects whole-value and same-as placeholder beats', () => {
    for (const bad of ['TBD', 'unknown.', 'same as episode 2']) {
      const result = validator.validate({
        episodeNumber: 3,
        episodeCircle: { ...circle, need: bad },
        storyCircleRole: [{ beat: 'find', roleKind: 'primary' }],
        scenes: scenes(contracts()),
      });

      expect(result.issues.some((issue) => issue.location === 'episodeCircle.need')).toBe(true);
    }
  });

  it('does not require inactive episodeCircle beats outside the macro role', () => {
    const result = validator.validate({
      episodeNumber: 1,
      episodeCircle: { you: 'Opening normal.', need: 'Active pressure.' },
      storyCircleRole: [{ beat: 'you', roleKind: 'primary' }],
      scenes: [{ id: 's1-1', narrativeRole: 'setup' }],
    });

    expect(result.issues.some((issue) => issue.location === 'episodeCircle.take')).toBe(false);
  });

  it('fails missing episodeCircle.take when take is an active macro beat', () => {
    const result = validator.validate({
      episodeNumber: 3,
      episodeCircle: { ...circle, take: '' },
      storyCircleRole: [{ beat: 'take', roleKind: 'primary' }],
      scenes: scenes(contracts()),
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.location === 'episodeCircle.take')).toBe(true);
  });

  it('fails duplicate or generic beat text', () => {
    const duplicateCircle = {
      ...circle,
      find: 'Kylie learns a vague important thing about the club and trust.',
      take: 'Kylie learns a vague important thing about the club and trust.',
    };
    const result = validator.validate({
      episodeNumber: 3,
      episodeCircle: duplicateCircle,
      storyCircleRole: [{ beat: 'find', roleKind: 'primary' }],
      scenes: scenes(contracts(duplicateCircle)),
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('repeat the same structural text'))).toBe(true);
  });

  it('fails unbound beat contracts', () => {
    const result = validator.validate({
      episodeNumber: 3,
      episodeCircle: circle,
      storyCircleRole: [{ beat: 'find', roleKind: 'primary' }],
      scenes: scenes([]),
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('not bound to any scene'))).toBe(true);
  });

  it('blocks weak polarity pairs', () => {
    const weakCircle = {
      ...circle,
      you: 'Kylie holds the ledger and returns to the rooftop changed by the truth.',
      find: 'Kylie holds the ledger and returns to the rooftop changed by the truth.',
    };
    const result = validator.validate({
      episodeNumber: 3,
      episodeCircle: weakCircle,
      storyCircleRole: [{ beat: 'find', roleKind: 'primary' }],
      scenes: scenes(contracts(weakCircle)),
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.severity === 'error' && issue.message.includes('polarity pair'))).toBe(true);
  });

  it('fails return/change contracts that land before final aftermath pressure', () => {
    const misplaced = contracts().map((contract) =>
      contract.beat === 'return' || contract.beat === 'change'
        ? { ...contract, targetSceneIds: ['s3-1'] }
        : contract,
    );
    const result = validator.validate({
      episodeNumber: 3,
      episodeCircle: circle,
      storyCircleRole: [{ beat: 'find', roleKind: 'primary' }],
      scenes: scenes(misplaced),
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('final aftermath'))).toBe(true);
  });
});
