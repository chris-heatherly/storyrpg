import { describe, expect, it } from 'vitest';
import {
  compactSceneWriterInput,
  droppedBlockingContracts,
  isSceneWriterCompactRetryReason,
  totalContractBlocks,
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
      storyCircleBeatContracts: [repeatedContract(0, { beat: 'you', eventAtoms: ['Kylie arrives', 'the blog begins'] })],
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
    // R3 headroom: blocking contracts (20 treatment mechanicPressure, 16
    // enforced requiredBeats in this fixture) are kept up to 2x the soft cap
    // instead of silently dropped, so the compact budget is higher than the
    // pre-R3 45KB — but still a ~3x shrink of the oversized input.
    expect(result.diagnostics.compactSceneBytes).toBeLessThan(75_000);
    expect(compactJson.length).toBeLessThan(originalJson.length / 2.5);
    expect(result.input.sceneBlueprint).not.toBe(input.sceneBlueprint);
    expect(input.sceneBlueprint.mechanicPressure).toHaveLength(120);
    expect(result.input.sceneBlueprint.mechanicPressure).toHaveLength(20);
    expect(result.input.sceneBlueprint.requiredBeats).toHaveLength(16);
    expect(compactJson).toContain('Kylie tests whether being adored is the same as being safe');
    expect(compactJson).toContain('the key card, blog, roses, and Mika');
    expect(compactJson).not.toContain('linked-0-19');
  });

  it('recognizes max-token truncation as compact retry worthy', () => {
    expect(isSceneWriterCompactRetryReason('TruncatedLLMResponseError: stop_reason=max_tokens')).toBe(true);
    expect(isSceneWriterCompactRetryReason('SceneWriter response exceeded raw processing budget')).toBe(true);
    expect(isSceneWriterCompactRetryReason('network down')).toBe(false);
  });

  // R3 (contract-budget honesty): compaction reports WHAT it dropped, and
  // whether a season-final validator still enforces the dropped obligation.
  describe('dropped-contract detail', () => {
    function minimalInput(sceneBlueprint: Record<string, unknown>): SceneWriterInput {
      return {
        sceneBlueprint: { id: 's1-1', name: 'Scene', npcsPresent: [], leadsTo: [], ...sceneBlueprint } as any,
        storyContext: { title: 'T', genre: 'g', tone: 't', worldContext: 'w' },
        protagonistInfo: { name: 'Kylie', pronouns: 'she/her', description: 'd' },
        npcs: [],
        targetBeatCount: 6,
        dialogueHeavy: false,
      };
    }

    it('gives blocking requiredBeats overflow headroom up to 2x the soft cap (no silent drop, no spurious abort)', () => {
      const input = minimalInput({
        requiredBeats: Array.from({ length: 12 }, (_, i) => ({
          id: `rb-${i}`,
          tier: 'authored',
          mustDepict: `Stela presses artifact number ${i} into your hand at the courtyard gate.`,
        })),
      });
      const { input: compacted, diagnostics } = compactSceneWriterInput(input);

      expect(compacted.sceneBlueprint.requiredBeats).toHaveLength(12);
      expect(diagnostics.droppedContracts).toEqual([]);
      expect(droppedBlockingContracts(diagnostics)).toEqual([]);
    });

    it('reports genuine blocking overload (past the hard cap) as blocking drops', () => {
      const input = minimalInput({
        requiredBeats: Array.from({ length: 20 }, (_, i) => ({
          id: `rb-${i}`,
          tier: 'authored',
          mustDepict: `Stela presses artifact number ${i} into your hand at the courtyard gate.`,
        })),
      });
      const { diagnostics } = compactSceneWriterInput(input);

      expect(diagnostics.compactCounts.requiredBeats).toBe(16);
      const dropped = diagnostics.droppedContracts.filter((c) => c.family === 'requiredBeats');
      expect(dropped).toHaveLength(4);
      expect(dropped.every((c) => c.blocking)).toBe(true);
      expect(droppedBlockingContracts(diagnostics)).toHaveLength(4);
    });

    it('reports unenforced dropped beats as advisory (connective tissue never blocks)', () => {
      const input = minimalInput({
        requiredBeats: [
          ...Array.from({ length: 8 }, (_, i) => ({
            id: `rb-${i}`,
            tier: 'authored',
            mustDepict: `Stela presses artifact number ${i} into your hand at the courtyard gate.`,
          })),
          { id: 'rb-conn', tier: 'connective', mustDepict: 'They drive for a while.' },
        ],
      });
      const { diagnostics } = compactSceneWriterInput(input);

      const dropped = diagnostics.droppedContracts.filter((c) => c.family === 'requiredBeats');
      expect(dropped).toHaveLength(1);
      expect(dropped[0].tier).toBe('connective');
      expect(dropped[0].blocking).toBe(false);
      expect(droppedBlockingContracts(diagnostics)).toEqual([]);
    });

    it('classifies treatment-blocking contract-family overflow as blocking and advisory overflow as not', () => {
      const contract = (i: number, blockingLevel: string) => ({
        id: `arc-${blockingLevel}-${i}`,
        fieldName: `field-${i}`,
        sourceText: `Arc pressure ${i}: the champagne friendship carries a price.`,
        blockingLevel,
      });
      // arcPressureContracts soft cap is 4 (hard cap 8 for blocking items);
      // ranking keeps the treatment-blocking ones, so the 2 dropped are
      // advisory. Then flip: 10 treatment → 2 past the hard cap drop.
      const advisoryOverflow = compactSceneWriterInput(minimalInput({
        arcPressureContracts: [
          ...Array.from({ length: 4 }, (_, i) => contract(i, 'treatment')),
          ...Array.from({ length: 2 }, (_, i) => contract(10 + i, 'advisory')),
        ],
      })).diagnostics;
      expect(advisoryOverflow.droppedCounts.arcPressureContracts).toBe(2);
      expect(droppedBlockingContracts(advisoryOverflow)).toEqual([]);

      const blockingOverflow = compactSceneWriterInput(minimalInput({
        arcPressureContracts: Array.from({ length: 10 }, (_, i) => contract(i, 'treatment')),
      })).diagnostics;
      expect(blockingOverflow.compactCounts.arcPressureContracts).toBe(8);
      expect(droppedBlockingContracts(blockingOverflow)).toHaveLength(2);
      expect(droppedBlockingContracts(blockingOverflow)[0]).toMatchObject({
        family: 'arcPressureContracts',
        blocking: true,
        blockingLevel: 'treatment',
      });
    });

    it('does not report dedupe casualties as drops (the surviving twin carries the contract)', () => {
      const twin = {
        id: 'rb-same',
        tier: 'authored',
        mustDepict: 'Stela presses the warm quartz into your hand at the courtyard gate.',
      };
      const { diagnostics } = compactSceneWriterInput(minimalInput({ requiredBeats: [twin, { ...twin }] }));
      expect(diagnostics.droppedContracts).toEqual([]);
      expect(diagnostics.compactCounts.requiredBeats).toBe(1);
    });

    it('totals contract blocks from the original (pre-compaction) counts', () => {
      const { diagnostics } = compactSceneWriterInput(minimalInput({
        requiredBeats: Array.from({ length: 10 }, (_, i) => ({ id: `rb-${i}`, tier: 'authored', mustDepict: `Moment ${i}` })),
        invariants: ['a', 'b', 'c'],
      }));
      expect(totalContractBlocks(diagnostics)).toBe(13);
    });
  });
});
