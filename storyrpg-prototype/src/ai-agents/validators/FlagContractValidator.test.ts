import { describe, expect, it } from 'vitest';
import type { Story } from '../../types';
import { FlagContractValidator } from './FlagContractValidator';

function story(scenes: unknown[]): Story {
  return { episodes: [{ id: 'ep1', scenes }] } as unknown as Story;
}

describe('FlagContractValidator (G12)', () => {
  it('treats an onShow type:flag entry as a SETTER, not a dead condition (bite-me-g16)', () => {
    // bite-me-g16 authored onShow flag sets using the condition form. The engine only
    // applies setFlag, so it was a no-op AND the validator wrongly read it as a dead
    // condition. Context-aware classification: onShow type:'flag' is a setter.
    const s = story([
      {
        id: 's1',
        beats: [
          {
            id: 'b1',
            text: 'base',
            onShow: [{ type: 'flag', flag: 'kylie_is_hopeful', value: true }],
            textVariants: [{ condition: 'kylie_is_hopeful', text: 'variant' }],
          },
        ],
      },
    ]);
    const r = new FlagContractValidator().validate({ story: s });
    expect(r.metrics.unsetConditionFlags).toBe(0); // not a dead condition
    expect(r.issues.some((i) => /never sets/.test(i.message))).toBe(false);
  });

  it('flags a condition reading a never-set flag, with a near-miss suggestion', () => {
    const s = story([
      {
        id: 's1',
        beats: [
          {
            id: 'b1',
            choices: [{ id: 'c1', consequences: [{ type: 'setFlag', flag: 'kylie_logs_for_now', value: true }] }],
          },
        ],
      },
      {
        id: 's2',
        beats: [
          {
            id: 'b2',
            text: 'base',
            textVariants: [{ condition: { type: 'flag', flag: 'kylie_logs_observations', value: true }, text: 'variant' }],
          },
        ],
      },
    ]);
    const r = new FlagContractValidator().validate({ story: s });
    expect(r.metrics.unsetConditionFlags).toBe(1);
    const issue = r.issues.find((i) => i.message.includes('kylie_logs_observations'))!;
    expect(issue.severity).toBe('error');
    expect(issue.suggestion).toContain('kylie_logs_for_now');
  });

  it('catches statCheck modifier conditions (the writing_glasses_worn class)', () => {
    const s = story([
      {
        id: 's1',
        beats: [{
          id: 'b1',
          choices: [{
            id: 'c1',
            statCheck: {
              modifiers: [{ id: 'm1', condition: { type: 'flag', flag: 'writing_glasses_worn', value: true }, delta: 10, reason: 'x' }],
            },
          }],
        }],
      },
    ]);
    const r = new FlagContractValidator().validate({ story: s });
    expect(r.metrics.unsetConditionFlags).toBe(1);
  });

  it('does not flag engine namespaces (_outcome_*, encounter.*, route_*)', () => {
    const s = story([
      {
        id: 's1',
        beats: [{
          id: 'b1',
          text: 'base',
          textVariants: [
            { condition: { type: 'flag', flag: '_outcome_success', value: true }, text: 'v' },
            { condition: { type: 'flag', flag: 'encounter.e1.outcome.victory', value: true }, text: 'v' },
            { condition: { type: 'flag', flag: 'route_a', value: true }, text: 'v' },
          ],
        }],
      },
    ]);
    const r = new FlagContractValidator().validate({ story: s });
    expect(r.metrics.unsetConditionFlags).toBe(0);
  });

  it('summarizes write-only flags as a single advisory warning', () => {
    const s = story([
      {
        id: 's1',
        beats: [{
          id: 'b1',
          choices: [{
            id: 'c1',
            consequences: [
              { type: 'setFlag', flag: 'mika_has_selected_kylie', value: true },
              { type: 'setFlag', flag: 'tint:boldness', value: true },
              { type: 'setFlag', flag: 'treatment_seed_ep1_1', value: true },
            ],
          }],
        }],
      },
    ]);
    const r = new FlagContractValidator().validate({ story: s });
    expect(r.metrics.writeOnlyFlags).toBe(1); // tint/treatment namespaces excluded
    expect(r.issues.filter((i) => i.severity === 'warning')).toHaveLength(1);
    expect(r.valid).toBe(true);
  });

  it('splits ledger-qualified future-window flags from true orphan write-only flags', () => {
    const s = story([
      {
        id: 's1',
        beats: [{
          id: 'b1',
          choices: [{
            id: 'c1',
            consequences: [
              { type: 'setFlag', flag: 'future_window_flag', value: true },
              { type: 'setFlag', flag: 'true_orphan_flag', value: true },
              { type: 'setFlag', flag: 'resolved_flag', value: true },
            ],
          }],
        }],
      },
    ]);

    const r = new FlagContractValidator().validate({
      story: s,
      generatedThroughEpisode: 3,
      callbackLedger: {
        version: 1,
        config: { payoffThreshold: 2, defaultWindowSpan: 3, maxActiveHooks: 24 },
        hooks: [
          {
            id: 'flag:future_window_flag',
            sourceEpisode: 3,
            sourceSceneId: 's1',
            sourceChoiceId: 'c1',
            flags: ['future_window_flag'],
            summary: 'Future payoff.',
            payoffWindow: { minEpisode: 3, maxEpisode: 5 },
            payoffCount: 0,
            resolved: false,
            createdAt: '2026-06-19T00:00:00.000Z',
          },
          {
            id: 'flag:resolved_flag',
            sourceEpisode: 1,
            sourceSceneId: 's1',
            sourceChoiceId: 'c1',
            flags: ['resolved_flag'],
            summary: 'Already paid.',
            payoffWindow: { minEpisode: 1, maxEpisode: 2 },
            payoffCount: 2,
            resolved: true,
            createdAt: '2026-06-19T00:00:00.000Z',
          },
        ],
      },
    });

    expect(r.metrics.futureWindowFlags).toBe(1);
    expect(r.metrics.resolvedLedgerFlags).toBe(1);
    expect(r.metrics.writeOnlyFlags).toBe(1);
    expect(r.issues[0].message).toContain('true_orphan_flag');
    expect(r.issues[0].message).not.toContain('future_window_flag');
  });

  it('still counts ledger hooks whose payoff window has expired as write-only debt', () => {
    const s = story([
      {
        id: 's1',
        beats: [{
          id: 'b1',
          choices: [{
            id: 'c1',
            consequences: [{ type: 'setFlag', flag: 'expired_hook_flag', value: true }],
          }],
        }],
      },
    ]);

    const r = new FlagContractValidator().validate({
      story: s,
      generatedThroughEpisode: 4,
      callbackLedger: {
        version: 1,
        config: { payoffThreshold: 2, defaultWindowSpan: 3, maxActiveHooks: 24 },
        hooks: [{
          id: 'flag:expired_hook_flag',
          sourceEpisode: 1,
          sourceSceneId: 's1',
          sourceChoiceId: 'c1',
          flags: ['expired_hook_flag'],
          summary: 'Expired payoff.',
          payoffWindow: { minEpisode: 1, maxEpisode: 3 },
          payoffCount: 0,
          resolved: false,
          createdAt: '2026-06-19T00:00:00.000Z',
        }],
      },
    });

    expect(r.metrics.futureWindowFlags).toBe(0);
    expect(r.metrics.writeOnlyFlags).toBe(1);
  });

  it('honors nested all/any condition expressions', () => {
    const s = story([
      {
        id: 's1',
        beats: [{
          id: 'b1',
          choices: [{ id: 'c1', consequences: [{ type: 'setFlag', flag: 'real_flag', value: true }] }],
        }, {
          id: 'b2',
          text: 'base',
          textVariants: [{
            condition: { type: 'and', conditions: [{ type: 'flag', flag: 'real_flag', value: true }, { type: 'flag', flag: 'ghost_flag', value: true }] },
            text: 'v',
          }],
        }],
      },
    ]);
    const r = new FlagContractValidator().validate({ story: s });
    expect(r.metrics.unsetConditionFlags).toBe(1);
    expect(r.issues[0].message).toContain('ghost_flag');
  });
});
