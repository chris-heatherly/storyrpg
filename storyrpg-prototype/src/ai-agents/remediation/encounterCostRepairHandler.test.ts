/**
 * Final-contract convergence replay for the encounter cost-field failure class
 * (2026-07-06 postmortem, R2/R3: every class the final contract blocks must
 * carry a repair that provably clears it).
 *
 * Chain under test:
 *  1. A runtime story ships an encounter whose cost fields carry the
 *     registered deterministic placeholder ("Relief arrives with a
 *     complication still attached.").
 *  2. RouteContinuityValidator raises a BLOCKING `unsafe_fallback_prose`
 *     finding on that scene (the final contract's net for this class).
 *  3. GateRepairRouter routes the finding to `same_scene_retry` (repairable,
 *     not diagnostic_stop — so it cannot starve the LLM-repair guard).
 *  4. buildEncounterCostRepairHandler re-authors exactly the offending fields.
 *  5. Re-validation comes back clean — the repair CONVERGES.
 */

import { describe, expect, it } from 'vitest';
import type { Story } from '../../types/story';
import { RouteContinuityValidator } from '../validators/RouteContinuityValidator';
import { GateRepairRouter } from './gateRepairRouter';
import {
  applyAuthoredCostFieldTexts,
  collectFallbackCostFieldEntries,
} from '../utils/encounterFallbackCostFields';
import { buildEncounterCostRepairHandler, collectFallbackCostEncounters, type CostReauthorAgent } from './encounterCostRepairHandler';

const COMPLICATION_TEMPLATE = 'Relief arrives with a complication still attached.';

function storyWithFallbackCost(): Story {
  return {
    id: 'bite-me-replay',
    title: 'Bite Me',
    metadata: {},
    npcs: [],
    episodes: [{
      id: 'ep-1',
      number: 1,
      title: 'Episode 1',
      scenes: [{
        id: 'treatment-enc-1-1',
        name: 'Valescu Club Doorman',
        beats: [{
          id: 'b1',
          text: 'The doorman blocks the corridor, palm out, while the bass thuds behind the velvet curtain for you.',
        }],
        encounter: {
          id: 'enc-1',
          stakes: {
            victory: 'You reach the back room before the meeting breaks up.',
            defeat: 'You are walked back out to the street.',
          },
          phases: [{
            beats: [{
              id: 'enc-b1',
              setupText: 'He weighs your accent, your shoes, and the empty place a stamp should be.',
              choices: [{
                id: 'c1',
                text: 'Talk your way past him',
                outcomes: {
                  complicated: {
                    narrativeText: 'He lets you through, but keeps your grandmother\u2019s chain as the price.',
                    encounterOutcome: 'partialVictory',
                    cost: {
                      domain: 'mixed',
                      severity: 'minor',
                      whoPays: 'protagonist',
                      immediateEffect: 'The chain disappears into his fist before you can argue.',
                      visibleComplication: COMPLICATION_TEMPLATE,
                    },
                  },
                },
              }],
            }],
          }],
        },
      }],
    }],
  } as unknown as Story;
}

function unsafeFallbackIssues(story: Story) {
  return new RouteContinuityValidator()
    .validate({ story })
    .issues.filter((issue) => issue.type === 'unsafe_fallback_prose');
}

function stubAuthor(): CostReauthorAgent {
  return {
    async reauthorFallbackCostFields(tree) {
      const entries = collectFallbackCostFieldEntries(tree);
      const authored = Object.fromEntries(entries.map((entry) => [
        entry.id,
        'Every regular in the corridor watched him pocket the chain, and they will remember your face.',
      ]));
      return applyAuthoredCostFieldTexts(entries, authored);
    },
  };
}

describe('encounter cost-field final-contract convergence (07-06 replay)', () => {
  it('the final contract blocks the deterministic placeholder as unsafe_fallback_prose', () => {
    const issues = unsafeFallbackIssues(storyWithFallbackCost());
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].sceneId).toBe('treatment-enc-1-1');
  });

  it('the finding routes to a repairable directive, not diagnostic_stop', () => {
    const story = storyWithFallbackCost();
    const [issue] = unsafeFallbackIssues(story);
    const route = new GateRepairRouter({ story }).routeIssue(issue);
    expect(route.kind).toBe('same_scene_retry');
  });

  it('the targeted handler finds the encounter and its repair clears re-validation', async () => {
    const story = storyWithFallbackCost();
    expect(collectFallbackCostEncounters(story).map((t) => t.sceneId)).toEqual(['treatment-enc-1-1']);

    const handler = buildEncounterCostRepairHandler({ author: stubAuthor });
    const result = await handler({ story, blockingIssues: [] });
    expect(result.changed).toBe(true);

    // CONVERGENCE: the exact validator that blocked now passes.
    expect(unsafeFallbackIssues(story)).toHaveLength(0);
  });

  it('a failed re-author leaves the placeholder for the gate (never worse)', async () => {
    const story = storyWithFallbackCost();
    const handler = buildEncounterCostRepairHandler({
      author: () => ({ async reauthorFallbackCostFields() { return 0; } }),
    });
    const result = await handler({ story, blockingIssues: [] });
    expect(result.changed).toBe(false);
    expect(unsafeFallbackIssues(story).length).toBeGreaterThan(0);
  });
});
