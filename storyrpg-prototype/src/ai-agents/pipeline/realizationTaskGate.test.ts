import { describe, expect, it } from 'vitest';
import {
  prioritizeOwnerRepairFindings,
  shouldAdoptOwnerRepairCandidate,
  validateOwnerRealizationTasks,
} from './realizationTaskGate';
import { compileEventRealizationAtoms } from './eventAtomCompiler';

describe('validateOwnerRealizationTasks', () => {
  it('adopts a repair only when its target fingerprint clears without new blockers', () => {
    const finding = (fingerprint: string) => ({ fingerprint, taskId: fingerprint, code: 'OWNER_REALIZATION_MISSING' as const } as any);
    expect(shouldAdoptOwnerRepairCandidate({
      previous: [finding('event'), finding('presence')],
      candidate: [finding('presence')],
      targetFingerprint: 'event',
    })).toBe(true);
    expect(shouldAdoptOwnerRepairCandidate({
      previous: [finding('event')],
      candidate: [finding('event')],
      targetFingerprint: 'event',
    })).toBe(false);
    expect(shouldAdoptOwnerRepairCandidate({
      previous: [finding('event')],
      candidate: [finding('new-blocker')],
      targetFingerprint: 'event',
    })).toBe(false);
  });

  it('repairs canonical event evidence before supporting presence evidence', () => {
    const eventFinding = { fingerprint: 'event', taskId: 'event-task' } as any;
    const presenceFinding = { fingerprint: 'presence', taskId: 'presence-task' } as any;
    const tasks = [
      { id: 'presence-task' },
      { id: 'event-task', canonicalEventId: 'event:1' },
    ] as any;
    expect(prioritizeOwnerRepairFindings([presenceFinding, eventFinding], tasks)[0]).toBe(eventFinding);
  });

  it('requires an unconditional milestone and canonical member evidence on every option', () => {
    const task = {
      id: 'task:milestone:all-options', contractId: 'milestone', episodeNumber: 1,
      ownerStage: 'choice_author' as const, repairHandler: 'choice_reauthor' as const, sceneId: 's1-5',
      evidenceAtoms: [
        { id: 'milestone-id', description: 'milestone', acceptedPatterns: ['milestone:formation'], kind: 'lexical' as const, required: true },
        { id: 'mika-move', description: 'movement', acceptedPatterns: ['consequence:char-mika'], kind: 'lexical' as const, required: true },
        { id: 'mika-evidence', description: 'evidence', acceptedPatterns: ['evidence:char-mika'], kind: 'lexical' as const, required: true },
      ],
      target: { scope: 'all_options' as const, surfaces: ['choice_text' as const] }, sourceContractIds: ['milestone'], blocking: true,
    };
    const choice = (id: string, complete: boolean) => ({
      id, text: 'Choose how the club begins.', relationshipMilestoneId: complete ? 'formation' : undefined,
      consequences: complete ? [{ type: 'relationship', npcId: 'char-mika', dimension: 'trust', change: 1 }] : [],
      relationshipValueEvidence: complete ? [{ npcId: 'char-mika', axis: 'trust', evidenceTags: ['respected_agency'], reason: 'She listens.' }] : [],
    });

    expect(validateOwnerRealizationTasks({ sceneId: 's1-5', tasks: [task], choiceSet: { choices: [choice('a', true), choice('b', true)] }, currentStage: 'choice_author' })).toEqual([]);
    expect(validateOwnerRealizationTasks({ sceneId: 's1-5', tasks: [task], choiceSet: { choices: [choice('a', true), choice('b', false)] }, currentStage: 'choice_author' })[0]?.code).toBe('OWNER_REALIZATION_MISSING');
  });

  it('blocks a missing owner event before checkpoint', () => {
    const findings = validateOwnerRealizationTasks({
      sceneId: 's1-7',
      tasks: [{
        id: 'task:blog-aftermath',
        contractId: 'event:ep1-u8:aftermath',
        episodeNumber: 1,
        ownerStage: 'scene_writer',
        repairHandler: 'scene_prose',
        sceneId: 's1-7',
        evidenceAtoms: [{
          id: 'blog:viral',
          description: 'public reach',
          acceptedPatterns: ['viral', 'shares', 'readers'],
          kind: 'lexical',
          required: true,
        }],
        target: { scope: 'owner', surfaces: ['beat_text'] },
        sourceContractIds: ['event:ep1-u8'],
        blocking: true,
      }],
      sceneContent: { beats: [{ id: 'b1', text: 'You publish the post and close the laptop.' }] },
    });

    expect(findings[0]?.code).toBe('OWNER_REALIZATION_MISSING');
  });

  it('blocks ordinary depiction drift even when the event has no specialized evidence requirement', () => {
    const task = {
      id: 'task:event:writing:owner-event', contractId: 'event:writing', eventId: 'event:writing',
      episodeNumber: 1, ownerStage: 'scene_writer' as const, repairHandler: 'scene_prose' as const,
      sceneId: 's1-6', evidenceAtoms: [{
        id: 'event:writing:source-event', description: 'writing event',
        acceptedPatterns: ['Kylie writes the first post about the rescue.'],
        sourceText: 'Kylie writes the first post about the rescue.', kind: 'semantic' as const, required: true,
      }], target: { scope: 'owner' as const, surfaces: ['beat_text' as const] },
      sourceContractIds: ['treatment:writing'], blocking: true,
    };

    const findings = validateOwnerRealizationTasks({
      sceneId: 's1-6', tasks: [task],
      sceneContent: { beats: [{ id: 'b1', text: 'Kylie opens her laptop and writes the first post about the rescue.' }] },
    });
    expect(findings).toEqual([]);

    const drift = validateOwnerRealizationTasks({
      sceneId: 's1-6', tasks: [task],
      sceneContent: { beats: [{ id: 'b1', text: 'Kylie walks home beneath the streetlights, thinking about the stranger.' }] },
    });
    expect(drift[0]?.code).toBe('OWNER_REALIZATION_MISSING');
    expect(drift[0]?.evidenceDiagnostics?.[0]).toEqual(expect.objectContaining({
      atomId: 'event:writing:source-event',
      matched: false,
    }));
    expect(drift[0]?.evidenceDiagnostics?.[0]?.missingTerms.length).toBeGreaterThan(0);
  });

  it('accepts natural prose that independently realizes every atom of a compound event', () => {
    const sourceText = 'She wanders into a bookshop owned by Stela who befriends her and introduces Kylie to the secret nightlife world of Valescu Club and her other friend Mika.';
    const atoms = compileEventRealizationAtoms({
      eventId: 'event:ep1-u3', sourceText, knownLocations: ['Lumina Books', 'Valescu Club'],
    });
    const findings = validateOwnerRealizationTasks({
      sceneId: 's1-3',
      tasks: [{
        id: 'task:event:ep1-u3:owner-event', contractId: 'event:ep1-u3', canonicalEventId: 'event:ep1-u3',
        episodeNumber: 1, ownerStage: 'scene_writer', repairHandler: 'scene_prose', sceneId: 's1-3',
        evidenceAtoms: atoms, evidenceGroups: [{ id: 'event:ep1-u3:all', description: 'all actions', requirement: 'all', atomIds: atoms.map((atom) => atom.id), blocking: true, sourceContractIds: [] }],
        target: { scope: 'owner', surfaces: ['beat_text', 'dialogue'] }, sourceContractIds: [], blocking: true,
      }],
      sceneContent: { beats: [{
        id: 'b1',
        text: 'Kylie walks into Lumina Books. The bookshop is owned by Stela, who welcomes her instead of chasing her back into the rain. Stela introduces Kylie to the secret nightlife of Valescu Club, then introduces Kylie to Mika.',
      }] },
    });
    expect(findings).toEqual([]);
  });

  it('treats blocked relationship labels as forbidden rather than required', () => {
    const findings = validateOwnerRealizationTasks({
      sceneId: 's1-2',
      tasks: [{
        id: 'task:rel-stela',
        contractId: 'rel-stela',
        episodeNumber: 1,
        ownerStage: 'scene_writer',
        repairHandler: 'relationship_pacing',
        sceneId: 's1-2',
        evidenceAtoms: [{
          id: 'rel-stela:blocked:friend',
          description: 'friend is not yet earned',
          acceptedPatterns: ['friend'],
          kind: 'relationship_label',
          required: true,
          polarity: 'forbidden',
        }],
        target: { scope: 'owner', surfaces: ['beat_text'] },
        sourceContractIds: ['rel-stela'],
        blocking: true,
      }],
      sceneContent: { beats: [{ id: 'b1', text: 'Stela offers a guarded smile.' }] },
    });

    expect(findings).toHaveLength(0);
  });

  it('accepts punctuation and word-coverage paraphrases for premise evidence', () => {
    const findings = validateOwnerRealizationTasks({
      sceneId: 's1-1',
      tasks: [{
        id: 'task:premise:role',
        contractId: 'premise:role',
        episodeNumber: 1,
        ownerStage: 'scene_writer',
        repairHandler: 'premise_realization',
        sceneId: 's1-1',
        artifactPath: 'episodes[1].scenes[s1-1]',
        evidenceAtoms: [
          { id: 'age', description: 'age', acceptedPatterns: ['34-year-old american'], sourceText: 'A 34-year-old American food writer.', kind: 'semantic', required: true },
          { id: 'work', description: 'work', acceptedPatterns: ['american food'], sourceText: 'A 34-year-old American food writer.', kind: 'semantic', required: true },
        ],
        target: { scope: 'owner', surfaces: ['beat_text'] },
        sourceContractIds: ['role'],
        blocking: true,
      }],
      sceneContent: {
        beats: [{ id: 'b1', text: 'At 34, the American food writer studies the stalls and opens her notebook.' }],
      },
    });

    expect(findings).toEqual([]);
  });

  it('treats premise evidence atoms as a threshold rather than first-pattern requirements', () => {
    const findings = validateOwnerRealizationTasks({
      sceneId: 's1-1',
      tasks: [{
        id: 'task:premise:wound', contractId: 'premise:wound', episodeNumber: 1,
        ownerStage: 'scene_writer', repairHandler: 'premise_realization', sceneId: 's1-1',
        minimumEvidenceHits: 2,
        evidenceAtoms: [
          { id: 'engagement', description: 'engagement', acceptedPatterns: ['cancelled engagement'], kind: 'semantic', required: true },
          { id: 'humiliation', description: 'humiliation', acceptedPatterns: ['humiliated'], kind: 'semantic', required: true },
          { id: 'unknown', description: 'unknown', acceptedPatterns: ['privately unknown'], kind: 'semantic', required: true },
        ],
        target: { scope: 'owner', surfaces: ['beat_text'] }, sourceContractIds: ['wound'], blocking: true,
      }],
      sceneContent: { beats: [{ id: 'b1', text: 'The cancelled engagement left her publicly humiliated.' }] },
    });

    expect(findings).toEqual([]);
  });

  it('scopes forbidden relationship labels to the named subject', () => {
    const findings = validateOwnerRealizationTasks({
      sceneId: 's1-2',
      tasks: [{
        id: 'task:rel-stela',
        contractId: 'rel-stela',
        episodeNumber: 1,
        ownerStage: 'scene_writer',
        repairHandler: 'relationship_pacing',
        sceneId: 's1-2',
        evidenceScope: { npcId: 'char-stela-pavel' },
        evidenceAtoms: [{ id: 'friend', description: 'friend', acceptedPatterns: ['friend'], kind: 'relationship_label', required: true, polarity: 'forbidden' }],
        target: { scope: 'owner', surfaces: ['beat_text'] },
        sourceContractIds: ['rel-stela'],
        blocking: true,
      }],
      sceneContent: {
        beats: [{ id: 'b1', text: 'Stela introduces Kylie to her friend Mika.' }],
      },
    });

    expect(findings).toEqual([]);
  });

  it('matches ordinary inflection changes in premise evidence', () => {
    const findings = validateOwnerRealizationTasks({
      sceneId: 's1-1',
      tasks: [{
        id: 'task:premise:identity',
        contractId: 'premise:identity',
        episodeNumber: 1,
        ownerStage: 'scene_writer',
        repairHandler: 'premise_realization',
        sceneId: 's1-1',
        evidenceAtoms: [{ id: 'orders', description: 'orders second', acceptedPatterns: ['orders second'], sourceText: 'The observer orders second.', kind: 'semantic', required: true }],
        target: { scope: 'owner', surfaces: ['beat_text'] },
        sourceContractIds: ['identity'],
        blocking: true,
      }],
      sceneContent: { beats: [{ id: 'b1', text: 'She ordered second, then watched the room.' }] },
    });

    expect(findings).toEqual([]);
  });

  it('does not let evidence on the wrong owner surface satisfy a task', () => {
    const findings = validateOwnerRealizationTasks({
      sceneId: 's1',
      tasks: [{
        id: 'task:choice', contractId: 'choice', episodeNumber: 1,
        ownerStage: 'choice_author', repairHandler: 'choice_reauthor', sceneId: 's1',
        evidenceAtoms: [{ id: 'tell-truth', description: 'truth choice', acceptedPatterns: ['tell her the truth'], kind: 'lexical', required: true }],
        target: { scope: 'owner', surfaces: ['choice_text'] },
        sourceContractIds: ['choice'], blocking: true,
      }],
      sceneContent: { beats: [{ text: 'You decide to tell her the truth.' }] },
      choiceSet: { choices: [{ text: 'Stay silent' }] },
    });

    expect(findings.map((finding) => finding.code)).toEqual(['OWNER_REALIZATION_MISSING']);
  });

  it('requires terminal evidence on the terminal route surface', () => {
    const task = {
      id: 'task:threshold', contractId: 'threshold', eventId: 'threat', episodeNumber: 1,
      ownerStage: 'encounter_architect' as const, repairHandler: 'encounter_route' as const, sceneId: 's1',
      evidenceAtoms: [{ id: 'gone', description: 'departure', acceptedPatterns: ['vanishes'], kind: 'route' as const, required: true }],
      target: { scope: 'route_terminal' as const, outcomeTier: 'victory', surfaces: ['encounter_outcome' as const] },
      sourceContractIds: ['threat'], blocking: true,
    };
    const misplaced = validateOwnerRealizationTasks({
      sceneId: 's1', tasks: [task],
      encounter: {
        phases: [{ beats: [{ text: 'The stranger vanishes for a moment, then returns.' }] }],
        outcomes: { victory: { outcomeText: 'He walks you to the apartment door.' } },
      },
    });
    const terminal = validateOwnerRealizationTasks({
      sceneId: 's1', tasks: [task],
      encounter: { outcomes: { victory: { outcomeText: 'At the apartment door, the stranger vanishes.' } } },
    });

    expect(misplaced).toHaveLength(1);
    expect(terminal).toEqual([]);
  });

  it('preserves advisory severity and owner-stage filtering', () => {
    const task = {
      id: 'task:advisory', contractId: 'advisory', episodeNumber: 1,
      ownerStage: 'choice_author' as const, repairHandler: 'choice_reauthor' as const, sceneId: 's1',
      evidenceAtoms: [{ id: 'echo', description: 'echo', acceptedPatterns: ['remember'], kind: 'semantic' as const, required: true }],
      target: { scope: 'owner' as const, surfaces: ['choice_text' as const] },
      sourceContractIds: ['advisory'], blocking: false,
    };
    const skipped = validateOwnerRealizationTasks({
      sceneId: 's1', tasks: [task], mode: 'owner', currentStage: 'scene_writer',
    });
    const evaluated = validateOwnerRealizationTasks({
      sceneId: 's1', tasks: [task], mode: 'owner', currentStage: 'choice_author',
    });

    expect(skipped).toEqual([]);
    expect(evaluated[0]).toMatchObject({ blocking: false, ownerStage: 'choice_author' });
  });

  it('accepts any-route evidence when one playable route realizes it', () => {
    const findings = validateOwnerRealizationTasks({
      sceneId: 's1',
      tasks: [{
        id: 'task:any-route', contractId: 'route', eventId: 'route', episodeNumber: 1,
        ownerStage: 'encounter_architect', repairHandler: 'encounter_route', sceneId: 's1',
        evidenceAtoms: [{ id: 'recognition', description: 'recognition', acceptedPatterns: ['recognizes you'], kind: 'route', required: true }],
        target: { scope: 'any_route', outcomeTiers: ['victory', 'defeat'], surfaces: ['encounter_outcome'] },
        sourceContractIds: ['route'], blocking: true,
      }],
      encounter: {
        outcomes: {
          victory: { outcomeText: 'The doorman recognizes you and opens the door.' },
          defeat: { outcomeText: 'The door stays shut.' },
        },
      },
    });

    expect(findings).toEqual([]);
  });

  it('does not combine partial evidence from different routes', () => {
    const findings = validateOwnerRealizationTasks({
      sceneId: 's1',
      tasks: [{
        id: 'task:any-route-complete', contractId: 'route', eventId: 'route', episodeNumber: 1,
        ownerStage: 'encounter_architect', repairHandler: 'encounter_route', sceneId: 's1',
        evidenceAtoms: [
          { id: 'rescued', description: 'rescue', acceptedPatterns: ['rescues the child'], kind: 'route', required: true },
          { id: 'vanishes', description: 'departure', acceptedPatterns: ['vanishes into the rain'], kind: 'route', required: true },
        ],
        target: { scope: 'any_route', outcomeTiers: ['victory', 'defeat'], surfaces: ['encounter_outcome'] },
        sourceContractIds: ['route'], blocking: true,
      }],
      encounter: {
        outcomes: {
          victory: { outcomeText: 'She rescues the child.' },
          defeat: { outcomeText: 'The stranger vanishes into the rain.' },
        },
      },
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe('OWNER_REALIZATION_MISSING');
  });

  it('does not accept route evidence from a surface outside the target contract', () => {
    const findings = validateOwnerRealizationTasks({
      sceneId: 's1',
      tasks: [{
        id: 'task:route-surface', contractId: 'route', eventId: 'route', episodeNumber: 1,
        ownerStage: 'encounter_architect', repairHandler: 'encounter_route', sceneId: 's1',
        evidenceAtoms: [{ id: 'recognized', description: 'recognition', acceptedPatterns: ['recognizes you'], kind: 'route', required: true }],
        target: { scope: 'route_path', outcomeTier: 'victory', surfaces: ['encounter_outcome'] },
        sourceContractIds: ['route'], blocking: true,
      }],
      encounter: {
        phases: [{ beats: [{ text: 'The doorman recognizes you.' }] }],
        outcomes: { victory: { outcomeText: 'The door opens.' } },
      },
    });

    expect(findings.map((finding) => finding.code)).toEqual(['OWNER_REALIZATION_MISSING']);
  });

  it('keeps owner-stage and final-regression fingerprints in parity on the same artifact', () => {
    const task = {
      id: 'task:parity', contractId: 'event:parity', eventId: 'event', episodeNumber: 1,
      ownerStage: 'scene_writer' as const, repairHandler: 'scene_prose' as const, sceneId: 's1',
      evidenceAtoms: [{ id: 'visible-cost', description: 'cost', acceptedPatterns: ['broken window'], kind: 'semantic' as const, required: true }],
      target: { scope: 'owner' as const, surfaces: ['beat_text' as const] },
      sourceContractIds: ['event'], blocking: true,
    };
    const shared = { sceneId: 's1', tasks: [task], sceneContent: { beats: [{ text: 'The room is quiet.' }] } };
    const owner = validateOwnerRealizationTasks({ ...shared, mode: 'owner', currentStage: 'scene_writer' });
    const final = validateOwnerRealizationTasks({ ...shared, mode: 'final_regression' });

    expect(owner.map((finding) => finding.fingerprint)).toEqual(final.map((finding) => finding.fingerprint));
  });

  it('evaluates grouped owner evidence without trusting claimed event metadata', () => {
    const task = {
      id: 'task:event:bookshop:owner-event', contractId: 'event:bookshop', eventId: 'event:bookshop', episodeNumber: 1,
      ownerStage: 'scene_writer' as const, repairHandler: 'scene_prose' as const, sceneId: 's1-3',
      evidenceAtoms: [
        { id: 'bookshop', description: 'bookshop', acceptedPatterns: ['bookshop'], kind: 'semantic' as const, required: true },
        { id: 'stela', description: 'Stela', acceptedPatterns: ['Stela'], kind: 'lexical' as const, required: true },
      ],
      evidenceGroups: [{
        id: 'event:bookshop:owner', description: 'Bookshop event', requirement: 'all' as const,
        atomIds: ['bookshop', 'stela'], blocking: true, sourceContractIds: ['event:bookshop'],
      }],
      target: { scope: 'owner' as const, surfaces: ['beat_text' as const] },
      sourceContractIds: ['event:bookshop'], blocking: true,
    };

    expect(validateOwnerRealizationTasks({
      sceneId: 's1-3', tasks: [task], sceneContent: { claimedEventIds: ['event:bookshop'], beats: [{ text: 'She enters the bookshop.' }] },
    })[0]?.missingEvidenceAtoms).toEqual(['stela']);
    expect(validateOwnerRealizationTasks({
      sceneId: 's1-3', tasks: [task], sceneContent: { claimedEventIds: ['event:bookshop'], beats: [{ text: 'She enters the bookshop. Stela looks up.' }] },
    })).toEqual([]);
  });
});
