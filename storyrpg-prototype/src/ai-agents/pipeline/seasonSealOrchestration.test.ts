import { describe, expect, it } from 'vitest';
import { CallbackLedger } from './callbackLedger';
import { SeasonCanon } from './seasonCanon';
import {
  collectReferencedHookIds,
  extractCanonDeltasFromEpisode,
  evaluateEpisodeForSeal,
  sealEpisodeIntoCanon,
  type SealEpisode,
} from './seasonSealOrchestration';

const episode: SealEpisode = {
  number: 1,
  scenes: [
    {
      beats: [
        {
          textVariants: [{ callbackHookId: 'flag:lysandra_trusted' }, { callbackHookId: 'within-ep1-x' }],
          choices: [
            { consequences: [{ type: 'setFlag', flag: 'lysandra_trusted', value: true }, { type: 'setFlag', flag: 'tint:warm', value: true }] },
          ],
        },
      ],
    },
  ],
};

describe('collectReferencedHookIds', () => {
  it('gathers callbackHookId values from beat textVariants', () => {
    expect(collectReferencedHookIds(episode).sort()).toEqual(['flag:lysandra_trusted', 'within-ep1-x']);
  });
});

describe('extractCanonDeltasFromEpisode', () => {
  it('turns trackable set-flags into knowledge facts (excludes tint:/route_)', () => {
    const deltas = extractCanonDeltasFromEpisode(episode, 'hero');
    expect(deltas.knowledge).toEqual([
      { characterId: 'hero', factId: 'flag:lysandra_trusted', summary: 'Established: lysandra_trusted' },
    ]);
  });

  it('merges LLM-supplied extra deltas', () => {
    const deltas = extractCanonDeltasFromEpisode(episode, 'hero', {
      worldFacts: [{ id: 'wf1', statement: 'A' }],
      knowledge: [{ characterId: 'hero', factId: 'reveal-x', summary: 'X' }],
    });
    expect(deltas.worldFacts).toHaveLength(1);
    expect(deltas.knowledge?.map((k) => k.factId)).toContain('reveal-x');
  });
});

describe('evaluateEpisodeForSeal', () => {
  it('is clean when no promises are due/dangling and no impossible knowledge', () => {
    const ledger = new CallbackLedger();
    // The episode references this hook as a payoff, so it must exist in the ledger.
    ledger.add({ id: 'flag:lysandra_trusted', sourceEpisode: 1, sourceSceneId: 's', sourceChoiceId: 'c', flags: ['lysandra_trusted'], summary: 'trust', payoffWindow: { minEpisode: 1, maxEpisode: 3 } });
    const canon = new SeasonCanon();
    const result = evaluateEpisodeForSeal({ episode, episodeNumber: 1, seasonLength: 3, ledger, canon });
    expect(result.clean).toBe(true);
    expect(result.referencedHookIds).toContain('flag:lysandra_trusted');
  });

  it('flags a dangling payoff (real hook id absent, within-ep excluded)', () => {
    const ledger = new CallbackLedger(); // no 'flag:lysandra_trusted' hook exists
    const canon = new SeasonCanon();
    const result = evaluateEpisodeForSeal({ episode, episodeNumber: 1, seasonLength: 3, ledger, canon });
    // flag:lysandra_trusted is referenced but not a ledger hook → dangling; within-ep1-x excluded
    expect(result.clean).toBe(false);
    expect(result.issues.some((i) => i.location === 'payoff:flag:lysandra_trusted')).toBe(true);
    expect(result.issues.some((i) => i.location?.includes('within-ep1-x'))).toBe(false);
  });

  it('flags a promise due-and-unpaid this episode', () => {
    const ledger = new CallbackLedger();
    ledger.add({ id: 'h', sourceEpisode: 0, sourceSceneId: 's', sourceChoiceId: 'c', flags: ['f'], summary: 'owed', payoffEpisode: 1, payoffWindow: { minEpisode: 1, maxEpisode: 1 } });
    const canon = new SeasonCanon();
    const result = evaluateEpisodeForSeal({ episode: { number: 1, scenes: [] }, episodeNumber: 1, seasonLength: 3, ledger, canon });
    expect(result.clean).toBe(false);
    expect(result.issues.some((i) => i.location === 'promise:h')).toBe(true);
  });
});

describe('sealEpisodeIntoCanon', () => {
  it('freezes facts and is a no-op on an already-sealed episode', () => {
    const canon = new SeasonCanon();
    const first = sealEpisodeIntoCanon({ canon, episode, episodeNumber: 1 });
    expect(first).toBeDefined();
    expect(canon.isSealed(1)).toBe(true);
    expect(canon.knows('protagonist', 'flag:lysandra_trusted', 1)).toBe(true);
    // resume: already sealed → no-op, does not throw
    expect(sealEpisodeIntoCanon({ canon, episode, episodeNumber: 1 })).toBeUndefined();
  });
});
