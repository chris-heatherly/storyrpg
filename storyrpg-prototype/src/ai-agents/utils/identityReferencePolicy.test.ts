import { describe, expect, it } from 'vitest';
import type {
  NarrativeIdentityScheduleContract,
  NarrativeLexicalArtifactContract,
  NarrativeRealizationTask,
} from '../../types/narrativeContract';
import {
  findIdentityReferenceViolations,
  resolveSceneIdentityReferencePolicies,
} from './identityReferencePolicy';

const schedule: NarrativeIdentityScheduleContract = {
  id: 'identity:radu',
  characterId: 'radu',
  canonicalName: 'Radu Stoian',
  allowedAliases: ['The Mountain', 'the charcoal-suited stranger'],
  forbiddenBeforeNamedEpisode: ['Radu Stoian', 'Radu'],
  firstVisualEpisode: 1,
  firstNamedEpisode: 2,
  sourceContractIds: ['source:radu'],
};

const lexicalArtifact: NarrativeLexicalArtifactContract = {
  id: 'lexical:mountain',
  episodeNumber: 2,
  creatorEventId: 'ep2-u2',
  creatorSceneId: 's2-coining',
  creatorPropositionId: 'ep2-u2:p2',
  kind: 'codeword',
  canonicalValue: 'The Mountain',
  routePolicy: 'source_invariant',
  allowedAlternatives: [],
  forbiddenBeforeSceneIds: ['s2-opening'],
  sourceContractIds: ['source:radu'],
  blocking: true,
};

describe('resolveSceneIdentityReferencePolicies', () => {
  it('does not treat a future-created codename as a legal pre-reveal alias', () => {
    const [policy] = resolveSceneIdentityReferencePolicies({
      episodeNumber: 1,
      sceneId: 's1-ending',
      identityScheduleContracts: [schedule],
      lexicalArtifactContracts: [lexicalArtifact],
    });

    expect(policy.availableAliases).toEqual(['the charcoal-suited stranger']);
    expect(policy.unavailableAliases).toEqual(['The Mountain']);
    expect(policy.forbiddenReferences).toEqual(expect.arrayContaining(['Radu Stoian', 'Radu', 'The Mountain']));
  });

  it('honors a scene-local forbidden literal task even without a lexical artifact', () => {
    const task = {
      id: 'task:forbidden-alias',
      sceneId: 's1-ending',
      evidenceAtoms: [{
        id: 'atom:forbidden-alias',
        description: 'Do not use the codename yet.',
        acceptedPatterns: ['The Mountain'],
        kind: 'lexical',
        verificationAuthority: 'literal',
        required: true,
        polarity: 'forbidden',
      }],
    } as NarrativeRealizationTask;
    const [policy] = resolveSceneIdentityReferencePolicies({
      episodeNumber: 1,
      sceneId: 's1-ending',
      identityScheduleContracts: [schedule],
      realizationTasks: [task],
    });

    expect(policy.availableAliases).not.toContain('The Mountain');
    expect(policy.unavailableAliases).toContain('The Mountain');
  });

  it('locates the exact contaminated field without mutating prose', () => {
    const [policy] = resolveSceneIdentityReferencePolicies({
      episodeNumber: 1,
      sceneId: 's1-ending',
      identityScheduleContracts: [schedule],
      lexicalArtifactContracts: [lexicalArtifact],
    });
    const scene = {
      id: 's1-ending',
      beats: [
        { id: 'b1', text: 'You close the laptop.' },
        { id: 'b4', text: 'A message arrives from The Mountain.' },
      ],
    };

    expect(findIdentityReferenceViolations(scene, [policy])).toEqual([
      expect.objectContaining({ reference: 'The Mountain', fieldPath: 'scene.beats[1].text' }),
    ]);
    expect(scene.beats[1].text).toContain('The Mountain');
  });

  it('reports a full canonical name once instead of duplicating its first-name match', () => {
    const [policy] = resolveSceneIdentityReferencePolicies({
      episodeNumber: 1,
      sceneId: 's1-ending',
      identityScheduleContracts: [schedule],
      lexicalArtifactContracts: [lexicalArtifact],
    });

    const violations = findIdentityReferenceViolations(
      { beatText: 'Radu Stoian waits beneath the streetlamp.' },
      [policy],
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].reference).toBe('Radu Stoian');
  });
});
