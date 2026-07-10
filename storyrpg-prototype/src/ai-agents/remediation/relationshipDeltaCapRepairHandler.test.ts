import { describe, expect, it } from 'vitest';
import type { Story } from '../../types/story';
import { RelationshipArcLedgerValidator } from '../validators/RelationshipArcLedgerValidator';
import { buildRelationshipDeltaCapRepairHandler } from './relationshipDeltaCapRepairHandler';

function makeBiteMeDeltaStory(overrides?: {
  trustChange?: number;
  respectChange?: number;
  maxDelta?: number;
}): Story {
  const trustChange = overrides?.trustChange ?? 10;
  const respectChange = overrides?.respectChange ?? 10;
  const maxDelta = overrides?.maxDelta ?? 8;
  return {
    id: 'bite-me-delta-cap',
    title: 'Bite Me',
    genre: 'paranormal-romance',
    synopsis: 'Test',
    initialState: {
      flags: {},
      attributes: {},
      resources: {},
      relationships: {},
      inventory: [],
      storyVariables: {},
      skills: {},
    },
    npcs: [
      { id: 'char-mika-dragan', name: 'Mika Dragan' },
      { id: 'char-stela-pavel', name: 'Stela Pavel' },
    ],
    episodes: [{
      id: 'ep1',
      number: 1,
      title: 'Episode 1',
      startingSceneId: 's1-3',
      scenes: [{
        id: 's1-3',
        title: 'Confession',
        name: 'Confession',
        startingBeatId: 's1-3-b1',
        relationshipPacing: [{
          id: 's1-3-rel-mika',
          source: 'planner',
          npcId: 'char-mika-dragan',
          startStage: 'acquaintance',
          targetStage: 'acquaintance',
          allowedLabels: ['guarded warmth'],
          blockedLabels: ['friend'],
          requiredEvidence: ['show reciprocity'],
          minScenesSinceIntroduction: 0,
          maxDeltaThisScene: maxDelta,
          mechanicDimensions: ['trust', 'respect'],
        }],
        beats: [{
          id: 's1-3-b1',
          text: 'Mika waits while you decide how much of the blog to confess.',
          choices: [{
            id: 'confess',
            text: 'Tell Mika everything about the blog',
            choiceType: 'relationship',
            consequences: [
              { type: 'relationship', npcId: 'char-mika-dragan', dimension: 'trust', change: trustChange },
              { type: 'relationship', npcId: 'char-mika-dragan', dimension: 'respect', change: respectChange },
            ],
          }],
        }],
      }],
    }],
  } as unknown as Story;
}

describe('buildRelationshipDeltaCapRepairHandler', () => {
  it('clamps Bite Me s1-3 over-cap trust/respect deltas and clears ledger-cap blockers', async () => {
    const story = makeBiteMeDeltaStory();
    const initial = new RelationshipArcLedgerValidator().validate({ story, treatmentSourced: true });
    const capIssues = initial.issues.filter((issue) => /above the ledger cap/i.test(issue.message));
    expect(capIssues.length).toBeGreaterThanOrEqual(2);

    const result = await buildRelationshipDeltaCapRepairHandler()({
      story,
      blockingIssues: capIssues.map((issue) => ({
        validator: 'RelationshipArcLedgerValidator',
        type: 'relationship_pacing_violation',
        sceneId: 's1-3',
        severity: issue.severity,
        message: issue.message,
      })),
    });

    expect(result.changed).toBe(true);
    const choice = story.episodes[0].scenes[0].beats[0].choices![0];
    expect(choice.consequences).toEqual(expect.arrayContaining([
      expect.objectContaining({ npcId: 'char-mika-dragan', dimension: 'trust', change: 8 }),
      expect.objectContaining({ npcId: 'char-mika-dragan', dimension: 'respect', change: 8 }),
    ]));

    const after = new RelationshipArcLedgerValidator().validate({ story, treatmentSourced: true });
    expect(after.issues.filter((issue) => /above the ledger cap/i.test(issue.message))).toHaveLength(0);
  });

  it('does not invent major-evidence tags and still fails when deltas remain over cap', async () => {
    const story = makeBiteMeDeltaStory({ trustChange: 10, respectChange: 10, maxDelta: 8 });
    // Simulate a no-op path: handler only clamps matching issues; leave deltas if
    // we pass empty blocking issues, then validator must still fail over-cap.
    const noop = await buildRelationshipDeltaCapRepairHandler()({
      story,
      blockingIssues: [],
    });
    expect(noop.changed).toBe(false);

    const stillOver = new RelationshipArcLedgerValidator().validate({ story, treatmentSourced: true });
    expect(stillOver.issues.some((issue) => /above the ledger cap/i.test(issue.message))).toBe(true);
    expect(story.episodes[0].scenes[0].beats[0].choices![0].relationshipValueEvidence).toBeUndefined();
  });

  it('clamps to the issue cap when it is stricter than the NPC contract cap', async () => {
    const story = makeBiteMeDeltaStory({ trustChange: 10, maxDelta: 8 });
    const result = await buildRelationshipDeltaCapRepairHandler()({
      story,
      blockingIssues: [{
        validator: 'RelationshipArcLedgerValidator',
        type: 'relationship_pacing_violation',
        sceneId: 's1-3',
        severity: 'error',
        message: 'Scene "s1-3" changes char-mika-dragan.trust by 10, above the ledger cap 6 without major evidence.',
      }],
    });

    expect(result.changed).toBe(true);
    const choice = story.episodes[0].scenes[0].beats[0].choices![0];
    expect(choice.consequences).toEqual(expect.arrayContaining([
      expect.objectContaining({ npcId: 'char-mika-dragan', dimension: 'trust', change: 6 }),
    ]));
  });
});
