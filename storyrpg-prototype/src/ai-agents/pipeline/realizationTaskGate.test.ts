import { describe, expect, it } from 'vitest';
import { validateOwnerRealizationTasks } from './realizationTaskGate';

describe('validateOwnerRealizationTasks', () => {
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
        requiredSurface: ['beat_text'],
        routePolicy: 'owner_surface',
        sourceContractIds: ['event:ep1-u8'],
        blocking: true,
      }],
      sceneContent: { beats: [{ id: 'b1', text: 'You publish the post and close the laptop.' }] },
    });

    expect(findings[0]?.code).toBe('OWNER_REALIZATION_MISSING');
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
        requiredSurface: ['beat_text'],
        routePolicy: 'owner_surface',
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
        requiredSurface: ['beat_text'],
        routePolicy: 'owner_surface',
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
        requiredSurface: ['beat_text'], routePolicy: 'owner_surface', sourceContractIds: ['wound'], blocking: true,
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
        requiredSurface: ['beat_text'],
        routePolicy: 'owner_surface',
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
        requiredSurface: ['beat_text'],
        routePolicy: 'owner_surface',
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
        ownerStage: 'choice_author', repairHandler: 'scene_prose', sceneId: 's1',
        evidenceAtoms: [{ id: 'tell-truth', description: 'truth choice', acceptedPatterns: ['tell her the truth'], kind: 'lexical', required: true }],
        target: { scope: 'owner', surfaces: ['choice_text'] },
        requiredSurface: ['choice_text'], routePolicy: 'owner_surface', sourceContractIds: ['choice'], blocking: true,
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
      outcomeTier: 'victory',
      evidenceAtoms: [{ id: 'gone', description: 'departure', acceptedPatterns: ['vanishes'], kind: 'route' as const, required: true }],
      target: { scope: 'route_terminal' as const, outcomeTier: 'victory', surfaces: ['terminal_storylet' as const] },
      requiredSurface: ['terminal_storylet' as const], routePolicy: 'terminal_required' as const,
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
      ownerStage: 'choice_author' as const, repairHandler: 'scene_prose' as const, sceneId: 's1',
      evidenceAtoms: [{ id: 'echo', description: 'echo', acceptedPatterns: ['remember'], kind: 'semantic' as const, required: true }],
      target: { scope: 'owner' as const, surfaces: ['choice_text' as const] },
      requiredSurface: ['choice_text' as const], routePolicy: 'owner_surface' as const,
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
        requiredSurface: ['encounter_outcome'], routePolicy: 'any_route', sourceContractIds: ['route'], blocking: true,
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
});
