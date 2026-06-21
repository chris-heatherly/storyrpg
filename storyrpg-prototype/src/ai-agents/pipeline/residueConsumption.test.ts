import { describe, expect, it } from 'vitest';
import type { Story } from '../../types';
import { FlagContractValidator } from '../validators/FlagContractValidator';
import {
  applyResidueConsumption,
  planResidueConsumption,
} from './residueConsumption';

/** Minimal story: scene s1 sets `flag` via a choice; later scenes carry plain beats. */
function story(setFlags: string[], readFlag?: string): Story {
  return {
    episodes: [
      {
        id: 'ep1',
        number: 1,
        scenes: [
          {
            id: 's1',
            beats: [
              {
                id: 's1-b1',
                text: 'You decide.',
                choices: [
                  { id: 'c1', text: 'Choose.', consequences: setFlags.map((flag) => ({ type: 'setFlag', flag, value: true })) },
                ],
              },
            ],
          },
          {
            id: 's2',
            beats: [
              {
                id: 's2-b1',
                text: 'Later, you walk on.',
                ...(readFlag
                  ? { textVariants: [{ condition: { type: 'flag', flag: readFlag, value: true }, text: 'You recall it.' }] }
                  : {}),
              },
              { id: 's2-b2', text: 'And on.' },
            ],
          },
        ],
      },
    ],
  } as unknown as Story;
}

function writeOnly(s: Story): number {
  return new FlagContractValidator().validate({ story: s }).metrics.writeOnlyFlags;
}

describe('residueConsumption (WS0.2)', () => {
  it('detects a set-but-never-read consequential flag', () => {
    const debts = planResidueConsumption(story(['mika_claimed_kylie']));
    expect(debts.map((d) => d.flag)).toEqual(['mika_claimed_kylie']);
  });

  it('does not flag a flag that is already read', () => {
    expect(planResidueConsumption(story(['took_the_card'], 'took_the_card'))).toEqual([]);
  });

  it('excludes structural/plumbing namespaces (tint/route/treatment/encounter)', () => {
    const debts = planResidueConsumption(story(['tint:boldness', 'route_a', 'treatment_seed_ep1_1', 'encounter_s1_victory']));
    expect(debts).toEqual([]);
  });

  it('injects a flag-gated read downstream and drives write-only to 0', () => {
    const s = story(['mika_claimed_kylie', 'drank_dark_wine']);
    expect(writeOnly(s)).toBe(2);
    const res = applyResidueConsumption(s);
    expect(res.injected).toBe(2);
    expect(res.residual).toEqual([]);
    expect(writeOnly(s)).toBe(0);
  });

  it('is golden-parity (no mutation) when every flag is already read', () => {
    const s = story(['took_the_card'], 'took_the_card');
    const before = JSON.stringify(s);
    const res = applyResidueConsumption(s);
    expect(res.injected).toBe(0);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('composes base text + acknowledgment (never overwrites the beat)', () => {
    const s = story(['mika_claimed_kylie']);
    applyResidueConsumption(s);
    const beat = (s.episodes[0].scenes[1] as { beats: Array<{ text: string; textVariants?: Array<{ text: string }> }> }).beats[0];
    const injected = beat.textVariants?.find((v) => v.text.includes(beat.text));
    expect(injected).toBeTruthy();
    expect(injected!.text.startsWith(beat.text)).toBe(true);
  });

  it('uses concrete flag-derived prose instead of generic earlier-choice boilerplate', () => {
    const s = story(['lost_notebook']);
    applyResidueConsumption(s);
    const beat = (s.episodes[0].scenes[1] as { beats: Array<{ text: string; textVariants?: Array<{ text: string }> }> }).beats[0];
    const text = beat.textVariants?.[0]?.text ?? '';

    expect(text).toContain('missing notebook');
    expect(text).not.toMatch(/earlier choice|what you chose|decision you made before|something you decided/i);
  });

  it('does not inject generic memory-of-flag prose when no concrete acknowledgment exists', () => {
    const s = story(['mika_lie_forced']);
    const res = applyResidueConsumption(s);
    const beat = (s.episodes[0].scenes[1] as { beats: Array<{ text: string; textVariants?: Array<{ text: string }> }> }).beats[0];

    expect(res.injected).toBe(0);
    expect(res.residual).toEqual(['mika_lie_forced']);
    expect(beat.textVariants ?? []).toEqual([]);
  });

  it('is idempotent (a second pass injects nothing)', () => {
    const s = story(['mika_claimed_kylie', 'drank_dark_wine']);
    applyResidueConsumption(s);
    expect(applyResidueConsumption(s).injected).toBe(0);
  });
});
