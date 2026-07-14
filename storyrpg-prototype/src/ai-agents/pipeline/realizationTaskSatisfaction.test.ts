import { describe, expect, it } from 'vitest';
import type { NarrativeRealizationTask } from '../../types/narrativeContract';
import {
  evaluateTaskSatisfaction,
  satisfactionExpressionForTask,
  type NarrativeAtomVerdict,
} from './realizationTaskSatisfaction';

function task(overrides: Partial<NarrativeRealizationTask> = {}): NarrativeRealizationTask {
  return {
    id: 'task:mixed', contractId: 'premise:mixed', episodeNumber: 1, ownerStage: 'scene_writer',
    repairHandler: 'premise_realization', sceneId: 's1', sourceContractIds: ['treatment'], blocking: true,
    minimumEvidenceHits: 2,
    evidenceAtoms: [
      { id: 'literal', description: 'Literal fact', acceptedPatterns: ['name'], kind: 'semantic', verificationAuthority: 'literal', required: true },
      { id: 'semantic-a', description: 'First meaning', acceptedPatterns: ['meaning a'], kind: 'semantic', verificationAuthority: 'semantic_judge', required: true },
      { id: 'semantic-b', description: 'Alternative meaning', acceptedPatterns: ['meaning b'], kind: 'semantic', verificationAuthority: 'semantic_judge', required: false },
    ],
    target: { scope: 'owner', surfaces: ['beat_text'] },
    ...overrides,
  };
}

function verdict(atomId: string, outcome: NarrativeAtomVerdict['outcome']): NarrativeAtomVerdict {
  return {
    taskId: 'task:mixed', atomId, groupKey: 'owner:1',
    authority: atomId === 'literal' ? 'literal' : 'semantic_judge', outcome,
  };
}

describe('realization task satisfaction', () => {
  it('normalizes a legacy threshold into one authority-neutral expression', () => {
    expect(satisfactionExpressionForTask(task())).toEqual({
      allOfAtomIds: [],
      anyOfGroups: [{
        id: 'task:mixed:legacy-threshold',
        atomIds: ['literal', 'semantic-a', 'semantic-b'],
        minimumHits: 2,
      }],
    });
  });

  it('is invariant to evaluator partition and verdict order', () => {
    const canonical = [verdict('literal', 'pass'), verdict('semantic-a', 'pass'), verdict('semantic-b', 'miss')];
    const expected = evaluateTaskSatisfaction(task(), canonical);
    for (let iteration = 0; iteration < 100; iteration += 1) {
      const rotated = canonical.slice(iteration % canonical.length).concat(canonical.slice(0, iteration % canonical.length));
      expect(evaluateTaskSatisfaction(task(), rotated)).toEqual(expected);
    }
    expect(expected.status).toBe('satisfied');
  });

  it('does not let an unavailable optional authority override a satisfied threshold', () => {
    expect(evaluateTaskSatisfaction(task(), [
      verdict('literal', 'pass'), verdict('semantic-a', 'pass'), verdict('semantic-b', 'unavailable'),
    ]).status).toBe('satisfied');
  });

  it('reports provider unavailability only while that atom can change the result', () => {
    expect(evaluateTaskSatisfaction(task(), [
      verdict('literal', 'pass'), verdict('semantic-a', 'unavailable'), verdict('semantic-b', 'miss'),
    ])).toMatchObject({ status: 'unavailable', unavailableAtomIds: ['semantic-a'] });
  });

  it('does not promote an optional miss into a blocker when required evidence already explains the shortfall', () => {
    // Live Bite Me shape: minimumEvidenceHits=1, required name + optional she/her.
    const biteMe = task({
      id: 'task:premise:canonical-identity',
      minimumEvidenceHits: 1,
      evidenceAtoms: [
        {
          id: 'name', description: 'Named Kylie Marinescu', acceptedPatterns: ['Kylie Marinescu'],
          kind: 'semantic', verificationAuthority: 'literal', required: true,
        },
        {
          id: 'pronouns', description: 'Uses she/her pronouns', acceptedPatterns: ['she/her'],
          kind: 'semantic', verificationAuthority: 'semantic_judge', required: false,
        },
      ],
    });
    const namePass = evaluateTaskSatisfaction(biteMe, [
      { taskId: biteMe.id, atomId: 'name', groupKey: 'owner:1', authority: 'literal', outcome: 'pass' },
      { taskId: biteMe.id, atomId: 'pronouns', groupKey: 'owner:1', authority: 'semantic_judge', outcome: 'miss' },
    ]);
    expect(namePass).toMatchObject({ status: 'satisfied', missingAtomIds: [] });

    const bothMiss = evaluateTaskSatisfaction(biteMe, [
      { taskId: biteMe.id, atomId: 'name', groupKey: 'owner:1', authority: 'literal', outcome: 'miss' },
      { taskId: biteMe.id, atomId: 'pronouns', groupKey: 'owner:1', authority: 'semantic_judge', outcome: 'miss' },
    ]);
    expect(bothMiss.status).toBe('missing');
    expect(bothMiss.missingAtomIds).toEqual(['name']);
    expect(bothMiss.missingAtomIds).not.toContain('pronouns');
  });
});
