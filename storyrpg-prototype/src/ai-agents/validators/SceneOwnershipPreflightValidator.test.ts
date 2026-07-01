import { describe, expect, it } from 'vitest';
import { SceneOwnershipPreflightValidator, type SceneOwnershipPreflightScene } from './SceneOwnershipPreflightValidator';

function scene(overrides: Partial<SceneOwnershipPreflightScene>): SceneOwnershipPreflightScene {
  return {
    id: overrides.id ?? 's1-1',
    episodeNumber: overrides.episodeNumber ?? 1,
    order: overrides.order ?? 0,
    kind: overrides.kind ?? 'standard',
    title: overrides.title ?? 'Scene',
    dramaticPurpose: overrides.dramaticPurpose ?? 'The protagonist faces pressure.',
    locations: overrides.locations ?? ['Station'],
    requiredBeats: overrides.requiredBeats,
    treatmentAtomIds: overrides.treatmentAtomIds,
    storyCircleBeatContracts: overrides.storyCircleBeatContracts,
    coldOpenProfile: overrides.coldOpenProfile,
    turnContract: overrides.turnContract,
  };
}

describe('SceneOwnershipPreflightValidator', () => {
  it('blocks duplicate primary treatment atom ownership', () => {
    const result = new SceneOwnershipPreflightValidator().validate({
      episodeNumber: 1,
      scenes: [
        scene({ id: 's1-1', treatmentAtomIds: ['atom-1'] }),
        scene({ id: 's1-2', order: 1, treatmentAtomIds: ['atom-1'] }),
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.message).join(' ')).toContain('multiple primary scene owners');
  });

  it('blocks non-opening cold-open required beats', () => {
    const result = new SceneOwnershipPreflightValidator().validate({
      episodeNumber: 1,
      scenes: [
        scene({ id: 's1-open', order: 0, coldOpenProfile: { storyCircleBeats: ['you'] } }),
        scene({
          id: 's1-later',
          order: 1,
          requiredBeats: [{
            id: 'cold-open-leak',
            tier: 'coldopen',
            sourceTurn: 'The protagonist arrives at the station.',
            mustDepict: 'The protagonist arrives at the station.',
          }],
        }),
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.message).join(' ')).toContain('cold-open required beat');
  });

  it('blocks concrete encounter cues on non-encounter scenes', () => {
    const result = new SceneOwnershipPreflightValidator().validate({
      episodeNumber: 1,
      scenes: [
        scene({
          id: 's1-threat-summary',
          requiredBeats: [{
            id: 'threat',
            tier: 'authored',
            sourceTurn: 'In the park, an attacker corners the protagonist.',
            mustDepict: 'In the park, an attacker corners the protagonist.',
          }],
        }),
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.message).join(' ')).toContain('encounter/threat cue');
  });

  it('requires the episode Story Circle role to have a scene owner', () => {
    const result = new SceneOwnershipPreflightValidator().validate({
      episodeNumber: 1,
      storyCircleRole: [{ beat: 'need', roleKind: 'primary' }],
      scenes: [scene({ id: 's1-open' })],
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.message).join(' ')).toContain('Story Circle role "need"');
  });
});
