import { describe, expect, it } from 'vitest';
import {
  compactSceneWriterInput,
  isSceneWriterCompactRetryReason,
} from './sceneWriterInputCompaction';
import type { SceneWriterInput } from '../../agents/SceneWriter';

function repeatedContract(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `contract-${index}`,
    source: index % 2 === 0 ? 'treatment' : 'derived',
    fieldName: `Field ${index}`,
    contractKind: 'pressure',
    sourceText: `Important treatment source text ${index}: Kylie tests whether being adored is the same as being safe. ${'extra '.repeat(90)}`,
    requiredRealization: ['scene_turn', 'mechanic_pressure', 'final_prose'],
    targetEpisodeNumbers: [1, 2, 3],
    targetSceneIds: ['s1-1'],
    linkedContractIds: Array.from({ length: 20 }, (_, i) => `linked-${index}-${i}`),
    blockingLevel: index % 3 === 0 ? 'treatment' : 'advisory',
    ...overrides,
  };
}

function makeOversizedInput(): SceneWriterInput {
  const mechanicPressure = Array.from({ length: 120 }, (_, index) => ({
    id: `pressure-${index}`,
    source: 'treatment',
    domain: index % 3 === 0 ? 'relationship' : 'information',
    function: index % 2 === 0 ? 'plant' : 'intensify',
    mechanicRef: { flag: `flag-${index}` },
    storyPressure: `Pressure ${index}: the key card, blog, roses, and Mika's steering must remain visible as story residue. ${'detail '.repeat(60)}`,
    evidenceRequired: ['show behavior before naming the bond', 'show aftermath', 'show changed access'],
    visibleResidue: ['changed distance', 'withheld information', 'visible access object'],
    allowedPayoffs: ['earned invitation', 'guarded warmth', 'testing trust'],
    blockedPayoffs: ['instant friendship', 'offscreen confession', 'unearned intimacy'],
    blockingLevel: index < 20 ? 'treatment' : 'advisory',
  }));

  return {
    sceneBlueprint: {
      id: 's1-1',
      name: 'Club Door',
      description: `Mika tests Kylie at the door. ${'long description '.repeat(100)}`,
      location: 'Vâlcescu Club',
      mood: 'charged',
      purpose: 'transition',
      narrativeFunction: `The key card becomes access leverage. ${'function '.repeat(100)}`,
      dramaticQuestion: `What does accepting the card cost? ${'question '.repeat(100)}`,
      wantVsNeed: `Kylie wants the glittering city but needs to notice the obligations attached to access. ${'want '.repeat(100)}`,
      conflictEngine: `Mika offers access as friendship and as handling. ${'conflict '.repeat(100)}`,
      npcsPresent: ['mika'],
      keyBeats: Array.from({ length: 30 }, (_, i) => `Key beat ${i}: Mika offers or withholds access. ${'beat '.repeat(20)}`),
      leadsTo: ['s1-2'],
      requiredBeats: Array.from({ length: 24 }, (_, i) => ({
        id: `rb-${i}`,
        sourceTurn: `Required source turn ${i}: Kylie must clock the side door card. ${'source '.repeat(40)}`,
        mustDepict: `Depict source turn ${i} on page. ${'depict '.repeat(40)}`,
        tier: i < 12 ? 'authored' : 'supporting',
      })),
      mechanicPressure,
      authoredTreatmentFields: Array.from({ length: 40 }, (_, i) => repeatedContract(i, { fieldName: 'A pressure lane' })),
      seasonPromiseContracts: Array.from({ length: 16 }, (_, i) => repeatedContract(i, { contractKind: 'tone_progression' })),
      stakesArchitectureContracts: Array.from({ length: 18 }, (_, i) => repeatedContract(i, { stakeLayer: 'identity' })),
      worldTreatmentContracts: Array.from({ length: 32 }, (_, i) => repeatedContract(i, { locationName: 'Vâlcescu Club' })),
      characterTreatmentContracts: Array.from({ length: 18 }, (_, i) => repeatedContract(i, { characterName: 'Kylie Marinescu' })),
      branchConsequenceContracts: Array.from({ length: 14 }, (_, i) => repeatedContract(i, { contractKind: 'branch_origin_choice' })),
      failureModeAuditContracts: Array.from({ length: 20 }, (_, i) => repeatedContract(i, { label: 'Escalation trap', status: 'avoided' })),
      sevenPointBeatContracts: [repeatedContract(0, { beat: 'hook', eventAtoms: ['Kylie arrives', 'the blog begins'] })],
      arcPressureContracts: [repeatedContract(1, { arcTitle: 'Champagne', eventAtoms: ['friendship pressure'] })],
      choicePoint: {
        type: 'relationship',
        description: `Accept the side-door card or keep distance. ${'choice '.repeat(80)}`,
        stakes: {
          want: `Access to the glittering club. ${'want '.repeat(40)}`,
          cost: `Obligation to Mika. ${'cost '.repeat(40)}`,
          identity: `Observer or author. ${'identity '.repeat(40)}`,
        },
        optionHints: Array.from({ length: 20 }, (_, i) => `option ${i}`),
      },
    } as any,
    storyContext: {
      title: 'Bite Me',
      genre: 'paranormal rom-com',
      tone: 'champagne over blood',
      worldContext: 'Bucharest nightlife.',
    },
    protagonistInfo: { name: 'Kylie', pronouns: 'she/her', description: 'New in the city.' },
    npcs: [],
    targetBeatCount: 8,
    dialogueHeavy: false,
  };
}

describe('sceneWriterInputCompaction', () => {
  it('shrinks oversized scene-blueprint contracts while preserving treatment-critical source text', () => {
    const input = makeOversizedInput();
    const originalJson = JSON.stringify(input.sceneBlueprint);

    const result = compactSceneWriterInput(input);
    const compactJson = JSON.stringify(result.input.sceneBlueprint);

    expect(result.diagnostics.originalSceneBytes).toBeGreaterThan(100_000);
    expect(result.diagnostics.compactSceneBytes).toBeLessThan(45_000);
    expect(compactJson.length).toBeLessThan(originalJson.length / 3);
    expect(result.input.sceneBlueprint).not.toBe(input.sceneBlueprint);
    expect(input.sceneBlueprint.mechanicPressure).toHaveLength(120);
    expect(result.input.sceneBlueprint.mechanicPressure).toHaveLength(12);
    expect(result.input.sceneBlueprint.requiredBeats).toHaveLength(8);
    expect(compactJson).toContain('Kylie tests whether being adored is the same as being safe');
    expect(compactJson).toContain('the key card, blog, roses, and Mika');
    expect(compactJson).not.toContain('linked-0-19');
  });

  it('recognizes max-token truncation as compact retry worthy', () => {
    expect(isSceneWriterCompactRetryReason('TruncatedLLMResponseError: stop_reason=max_tokens')).toBe(true);
    expect(isSceneWriterCompactRetryReason('SceneWriter response exceeded raw processing budget')).toBe(true);
    expect(isSceneWriterCompactRetryReason('network down')).toBe(false);
  });
});
