import { describe, expect, it } from 'vitest';
import type { SceneContent, SceneSemanticPatch } from '../agents/SceneWriter';
import { stableHash } from './artifacts/store';
import { applySceneSemanticPatch, SemanticPatchOperationLimitError } from './sceneSemanticPatch';

function scene(): SceneContent {
  return {
    sceneId: 's1-3', sceneName: 'Bookshop', startingBeatId: 'b1',
    beats: [
      { id: 'b1', text: 'Stela welcomes Kylie into the warmth of the bookshop.', nextBeatId: 'b2' },
      { id: 'b2', text: 'Mika arrives with a burst of color.', nextBeatId: 'b3' },
      { id: 'b3', text: 'The room settles around their new triangle.' },
    ],
    moodProgression: [], charactersInvolved: [], keyMoments: [], continuityNotes: [],
  };
}

describe('applySceneSemanticPatch', () => {
  it('changes only the requested beat and preserves accepted prose byte-for-byte', () => {
    const baseline = scene();
    const patch: SceneSemanticPatch = {
      baseSceneHash: stableHash(baseline), targetTaskId: 'task:event', targetAtomIds: ['atom:club'],
      operations: [{ op: 'replace_beat_text', beatId: 'b3', text: 'Stela offers to take Kylie into the secret nightlife orbit of Valescu Club.' }],
      claimedEvidence: [{ atomId: 'atom:club', beatIds: ['b3'] }],
    };
    const result = applySceneSemanticPatch(baseline, patch);
    expect(result.scene.beats[0].text).toBe(baseline.beats[0].text);
    expect(result.scene.beats[1].text).toBe(baseline.beats[1].text);
    expect(result.scene.beats[2].text).toContain('Valescu Club');
    expect(baseline.beats[2].text).toBe('The room settles around their new triangle.');
  });

  it('rejects stale and nonlocal patches', () => {
    const baseline = scene();
    expect(() => applySceneSemanticPatch(baseline, {
      baseSceneHash: 'stale', targetTaskId: 'task:event', targetAtomIds: ['atom'],
      operations: [{ op: 'replace_beat_text', beatId: 'b1', text: 'A sufficiently long replacement line.' }],
      claimedEvidence: [{ atomId: 'atom', beatIds: ['b1'] }],
    })).toThrow(/stale/);
    expect(() => applySceneSemanticPatch(baseline, {
      baseSceneHash: stableHash(baseline), targetTaskId: 'task:event', targetAtomIds: ['atom'],
      operations: [
        { op: 'replace_beat_text', beatId: 'b1', text: 'A sufficiently long replacement line.' },
        { op: 'replace_beat_text', beatId: 'b3', text: 'Another sufficiently long replacement line.' },
      ],
      claimedEvidence: [{ atomId: 'atom', beatIds: ['b1', 'b3'] }],
    })).toThrow(/adjacent/);
  });

  it('measures adjacency against the immutable baseline when an insert shifts indexes', () => {
    const baseline = scene();
    const result = applySceneSemanticPatch(baseline, {
      baseSceneHash: stableHash(baseline), targetTaskId: 'task-1', targetAtomIds: ['atom-1'], claimedEvidence: [],
      operations: [
        { op: 'insert_beat_after', beatId: 'b1', text: 'A new authored reaction makes the first meaning explicit.' },
        { op: 'replace_beat_text', beatId: 'b2', text: 'The adjacent response now carries the required consequence.' },
      ],
    });
    expect(result.scene.beats.map((beat) => beat.id)).toEqual(['b1', expect.stringContaining('semantic-repair'), 'b2', 'b3']);
  });

  it('allows a caller-bounded third local operation without widening the beat window', () => {
    const baseline = scene();
    const patch = {
      baseSceneHash: stableHash(baseline), targetTaskId: 'task-1', targetAtomIds: ['atom-1'], claimedEvidence: [],
      operations: [
        { op: 'replace_beat_text' as const, beatId: 'b1', text: 'Stela gives Kylie her full name and offers a chair by the counter.' },
        { op: 'replace_beat_text' as const, beatId: 'b2', text: 'Mika tests the newcomer with a question, then accepts her answer.' },
        { op: 'insert_beat_after' as const, beatId: 'b2', text: 'Stela answers by telling Kylie where the Lantern Circle meets.' },
      ],
    };

    expect(() => applySceneSemanticPatch(baseline, patch)).toThrow(/between one and 2 operations/);
    const result = applySceneSemanticPatch(baseline, patch, 3);
    expect(result.changedBeatIds).toEqual(expect.arrayContaining(['b1', 'b2']));
    expect(result.insertedBeatIds).toHaveLength(1);
  });

  it('signals operation-limit violations with a structured error for capacity escalation', () => {
    const baseline = scene();
    const patch = {
      baseSceneHash: stableHash(baseline), targetTaskId: 'task-1', targetAtomIds: ['atom-1'], claimedEvidence: [],
      operations: [
        { op: 'replace_beat_text' as const, beatId: 'b1', text: 'Stela gives Kylie her full name and offers a chair by the counter.' },
        { op: 'replace_beat_text' as const, beatId: 'b2', text: 'Mika tests the newcomer with a question, then accepts her answer.' },
        { op: 'insert_beat_after' as const, beatId: 'b2', text: 'Stela answers by telling Kylie where the Lantern Circle meets.' },
      ],
    };
    try {
      applySceneSemanticPatch(baseline, patch);
      expect.unreachable('patch above the operation limit must throw');
    } catch (error) {
      expect(error).toBeInstanceOf(SemanticPatchOperationLimitError);
      expect((error as SemanticPatchOperationLimitError).code).toBe('patch_operation_limit');
    }
  });
});
