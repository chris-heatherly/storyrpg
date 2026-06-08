import { describe, expect, it } from 'vitest';
import { CallbackLedger } from './callbackLedger';
import { SeasonCanon } from './seasonCanon';
import {
  collectReferencedHookIds,
  extractCanonDeltasFromEpisode,
  evaluateEpisodeForSeal,
  sanitizeWithinEpisodeTintHooks,
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

describe('sanitizeWithinEpisodeTintHooks (within-episode tint hooks)', () => {
  // Reproduces the Endsong ep3 abort: SceneWriter gated a prose variant on a
  // within-episode tint flag AND tagged it with a ledger-style callbackHookId for
  // the same flag, which was never planted → dangling-payoff gate aborted.
  const tintEpisode = (): SealEpisode => ({
    number: 3,
    scenes: [
      {
        beats: [
          {
            textVariants: [
              { condition: { flag: 'chose_confidence_s3_1' }, callbackHookId: 'flag:chose_confidence_s3_1' },
              { condition: { flag: 'chose_confidence_s3_1' } }, // tint without a hook — fine
            ],
          },
        ],
      },
    ],
  });

  it('strips an unplanted same-variant tint hook (keeps condition.flag)', () => {
    const ep = tintEpisode();
    const ledger = new CallbackLedger(); // flag:chose_confidence_s3_1 NOT planted
    const stripped = sanitizeWithinEpisodeTintHooks(ep, ledger);
    expect(stripped).toEqual(['flag:chose_confidence_s3_1']);
    const v = ep.scenes![0].beats![0].textVariants![0];
    expect(v.callbackHookId).toBeUndefined(); // hook dropped
    expect(v.condition?.flag).toBe('chose_confidence_s3_1'); // tint preserved
  });

  it('lets the seal gate pass with only an advisory warning (no dangling error)', () => {
    const ledger = new CallbackLedger();
    const canon = new SeasonCanon();
    const result = evaluateEpisodeForSeal({ episode: tintEpisode(), episodeNumber: 3, seasonLength: 8, ledger, canon });
    expect(result.clean).toBe(true);
    expect(result.issues.some((i) => i.severity === 'error')).toBe(false);
    expect(result.issues.some((i) => i.location === 'tint-hook:flag:chose_confidence_s3_1' && i.severity === 'warning')).toBe(true);
    expect(result.referencedHookIds).not.toContain('flag:chose_confidence_s3_1');
  });

  it('does NOT strip a genuine dangling cross-episode payoff (no same-variant tint)', () => {
    const ep: SealEpisode = {
      number: 3,
      scenes: [{ beats: [{ textVariants: [{ callbackHookId: 'flag:real_promise_y' }] }] }],
    };
    const ledger = new CallbackLedger(); // not planted
    expect(sanitizeWithinEpisodeTintHooks(ep, ledger)).toEqual([]);
    const result = evaluateEpisodeForSeal({ episode: ep, episodeNumber: 3, seasonLength: 8, ledger, canon: new SeasonCanon() });
    expect(result.clean).toBe(false);
    expect(result.issues.some((i) => i.location === 'payoff:flag:real_promise_y' && i.severity === 'error')).toBe(true);
  });

  it('leaves a planted promise referenced as a payoff untouched', () => {
    const ep: SealEpisode = {
      number: 3,
      scenes: [{ beats: [{ textVariants: [{ condition: { flag: 'planted_z' }, callbackHookId: 'flag:planted_z' }] }] }],
    };
    const ledger = new CallbackLedger();
    ledger.add({ id: 'flag:planted_z', sourceEpisode: 1, sourceSceneId: 's', sourceChoiceId: 'c', flags: ['planted_z'], summary: 'planted', payoffWindow: { minEpisode: 1, maxEpisode: 8 } });
    expect(sanitizeWithinEpisodeTintHooks(ep, ledger)).toEqual([]); // planted → not stripped
    expect(ep.scenes![0].beats![0].textVariants![0].callbackHookId).toBe('flag:planted_z');
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
