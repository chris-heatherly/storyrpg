import { describe, expect, it } from 'vitest';
import {
  extractPlantsFromChoiceSet,
  plantsToUnresolvedCallbacks,
  mergeUnresolvedForScene,
  type EpisodePlant,
} from './episodePlantContext';
import type { CallbackLedger } from './callbackLedger';

// Stub ledger exposing only the method the module uses.
const ledger = {
  trackableFlagsOf: (choice: any) =>
    (choice.consequences ?? [])
      .filter((c: any) => c.type === 'setFlag' && c.value !== false && !String(c.flag).startsWith('tint:') && !String(c.flag).startsWith('route_'))
      .map((c: any) => c.flag),
} as unknown as CallbackLedger;

const choice = (id: string, flag: string | undefined, summary?: string) => ({
  id,
  text: id,
  consequences: flag ? [{ type: 'setFlag', flag, value: true }] : [],
  feedbackCue: summary ? { echoSummary: summary } : undefined,
});

describe('extractPlantsFromChoiceSet', () => {
  it('extracts (flag, authored summary, sceneId) for flag-setting choices with an ack', () => {
    const cs = {
      sceneId: 'scene-1',
      choices: [
        choice('c1', 'lysandra_trusted', 'You chose her over the chain of command.'),
        choice('c2', undefined, 'no flag'),                // no flag → skipped
        choice('c3', 'route_x', 'routing'),                // structural flag → skipped by ledger rule
        choice('c4', 'galen_warned'),                      // flag but no authored summary → skipped
      ] as any,
    };
    const plants = extractPlantsFromChoiceSet(cs, ledger);
    expect(plants).toEqual([
      { flag: 'lysandra_trusted', summary: 'You chose her over the chain of command.', sceneId: 'scene-1' },
    ]);
  });
});

describe('plantsToUnresolvedCallbacks', () => {
  it('shapes plants as unresolved-callback entries, deduped by flag', () => {
    const plants: EpisodePlant[] = [
      { flag: 'f1', summary: 's1', sceneId: 'scene-1' },
      { flag: 'f1', summary: 's1b', sceneId: 'scene-2' }, // dup flag
      { flag: 'f2', summary: 's2', sceneId: 'scene-1' },
    ];
    const out = plantsToUnresolvedCallbacks(plants, 1);
    expect(out.map((h) => h.flags[0])).toEqual(['f1', 'f2']);
    expect(out[0]).toMatchObject({ id: 'within-ep1-f1', sourceEpisode: 1, flags: ['f1'] });
  });
});

describe('mergeUnresolvedForScene', () => {
  it('merges cross-episode hooks with within-episode plants', () => {
    const cross = [{ id: 'x', sourceEpisode: 0, summary: 'prior', flags: ['ep0flag'] }];
    const plants: EpisodePlant[] = [{ flag: 'f1', summary: 's1', sceneId: 'scene-1' }];
    const merged = mergeUnresolvedForScene(cross, plants, 1)!;
    expect(merged.map((h) => h.flags[0])).toEqual(['ep0flag', 'f1']);
  });

  it('does not duplicate a flag already covered by a cross-episode hook', () => {
    const cross = [{ id: 'x', sourceEpisode: 0, summary: 'prior', flags: ['f1'] }];
    const plants: EpisodePlant[] = [{ flag: 'f1', summary: 's1', sceneId: 'scene-1' }];
    const merged = mergeUnresolvedForScene(cross, plants, 1)!;
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('x');
  });

  it('returns undefined when nothing to surface', () => {
    expect(mergeUnresolvedForScene(undefined, [], 1)).toBeUndefined();
  });
});
