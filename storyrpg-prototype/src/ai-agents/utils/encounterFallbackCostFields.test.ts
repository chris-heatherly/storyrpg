/**
 * Golden convergence tests for the targeted encounter cost/stakes-field
 * re-author (2026-07-06 encounter-cost postmortem replay).
 *
 * The failure being pinned: `buildDefaultEncounterCost` / `deriveEncounterCost`
 * injected "Relief arrives with a complication still attached." into
 * `cost.visibleComplication` when the LLM omitted the cost object; the
 * no-boilerplate scan flagged the registered string; whole-encounter
 * regeneration could not converge (the injection recurs on every omission),
 * so the run hard-aborted. These tests prove the targeted repair CONVERGES:
 * collect finds exactly the offending fields, apply replaces them in place,
 * and a re-collect comes back empty.
 */

import { describe, expect, it } from 'vitest';
import {
  applyAuthoredCostFieldTexts,
  buildCostReauthorPrompt,
  collectFallbackCostFieldEntries,
} from './encounterFallbackCostFields';

const COMPLICATION_TEMPLATE = 'Relief arrives with a complication still attached.';
const IMMEDIATE_TEMPLATE = 'The win leaves something unsettled that follows the protagonist forward.';

/** The shape the 07-06 run failed on: a structure whose normalize pass injected default cost text. */
function structureWithInjectedCost() {
  return {
    sceneId: 'treatment-enc-1-1',
    beats: [{
      id: 'beat-2',
      setupText: 'The doorman blocks the service corridor, one hand out for the stamp you do not have.',
      choices: [{
        id: 'b2-c1',
        text: 'Talk your way past him',
        outcomes: {
          success: { narrativeText: 'He waves you through with a warning look.', goalTicks: 3, threatTicks: 0, isTerminal: true, encounterOutcome: 'victory' },
          complicated: {
            narrativeText: 'He lets you pass, but palms your grandmother\u2019s chain as the price.',
            goalTicks: 2,
            threatTicks: 1,
            isTerminal: true,
            encounterOutcome: 'partialVictory',
            cost: {
              domain: 'mixed',
              severity: 'minor',
              whoPays: 'protagonist',
              immediateEffect: IMMEDIATE_TEMPLATE,
              visibleComplication: COMPLICATION_TEMPLATE,
            },
          },
          failure: { narrativeText: 'He steers you back toward the street, grip firm on your shoulder.', goalTicks: 0, threatTicks: 3, isTerminal: true, encounterOutcome: 'defeat' },
        },
      }],
    }],
    partialVictoryCost: {
      domain: 'mixed',
      severity: 'minor',
      whoPays: 'protagonist',
      immediateEffect: IMMEDIATE_TEMPLATE,
      visibleComplication: COMPLICATION_TEMPLATE,
    },
    stakes: { victory: 'You reach the back room before the meeting breaks up.', defeat: 'Face the consequences of failure.' },
  };
}

describe('collectFallbackCostFieldEntries', () => {
  it('finds every deterministic-injection cost/stakes string (07-06 replay)', () => {
    const structure = structureWithInjectedCost();
    const entries = collectFallbackCostFieldEntries(structure);
    const byKey = entries.map((entry) => entry.key).sort();
    // outcome cost (2 fields) + partialVictoryCost (2 fields) + generic defeat stake
    expect(byKey).toEqual(['defeat', 'immediateEffect', 'immediateEffect', 'visibleComplication', 'visibleComplication']);
    expect(entries.every((entry) => entry.label.length > 0)).toBe(true);
  });

  it('carries surrounding fiction as context for the re-author prompt', () => {
    const structure = structureWithInjectedCost();
    const entries = collectFallbackCostFieldEntries(structure);
    const outcomeEntry = entries.find(
      (entry) => entry.key === 'visibleComplication' && entry.context.includes('palms your grandmother'),
    );
    expect(outcomeEntry).toBeDefined();
  });

  it('stays quiet on authored cost fields', () => {
    const authored = {
      cost: {
        immediateEffect: 'The doorman pockets the chain, and your wrist still aches from his grip.',
        visibleComplication: 'Word of what you traded will reach Stela before you do.',
      },
      stakes: { victory: 'You reach the back room in time.', defeat: 'You are walked back to the street.' },
    };
    expect(collectFallbackCostFieldEntries(authored)).toHaveLength(0);
  });
});

describe('buildCostReauthorPrompt', () => {
  it('shows the ACTUAL placeholder string, never just the registry label', () => {
    const entries = collectFallbackCostFieldEntries(structureWithInjectedCost());
    const prompt = buildCostReauthorPrompt(entries, { sceneName: 'Valescu Club back corridor' });
    expect(prompt).toContain(COMPLICATION_TEMPLATE);
    expect(prompt).toContain(IMMEDIATE_TEMPLATE);
    expect(prompt).toContain('Valescu Club back corridor');
  });
});

describe('applyAuthoredCostFieldTexts — convergence', () => {
  it('replaces placeholders in place so a re-collect comes back empty', () => {
    const structure = structureWithInjectedCost();
    const entries = collectFallbackCostFieldEntries(structure);
    const authored = Object.fromEntries(entries.map((entry, i) => [
      entry.id,
      `The doorman keeps the chain, and everyone in the corridor saw you hand it over (${i}).`,
    ]));
    const replaced = applyAuthoredCostFieldTexts(entries, authored);
    expect(replaced).toBe(entries.length);
    // CONVERGENCE: the exact scan that failed the 07-06 run now comes back clean.
    expect(collectFallbackCostFieldEntries(structure)).toHaveLength(0);
    const outcomeCost = structure.beats[0].choices[0].outcomes.complicated.cost;
    expect(outcomeCost.visibleComplication).not.toBe(COMPLICATION_TEMPLATE);
  });

  it('refuses replacements that are themselves registered fallbacks, echoes, or stubs', () => {
    const structure = structureWithInjectedCost();
    const entries = collectFallbackCostFieldEntries(structure);
    const bad: Record<string, string> = {};
    for (const [i, entry] of entries.entries()) {
      bad[entry.id] = i === 0
        ? COMPLICATION_TEMPLATE // another registered fallback
        : i === 1
          ? entry.currentText // echo of the placeholder
          : 'Too short.'; // stub
    }
    expect(applyAuthoredCostFieldTexts(entries, bad)).toBe(0);
    // Placeholders stay in place for the contract gate to catch — never worse.
    expect(collectFallbackCostFieldEntries(structure)).toHaveLength(entries.length);
  });
});
