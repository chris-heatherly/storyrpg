import { describe, expect, it } from 'vitest';

import type { InformationLedgerEntry } from '../../types/seasonPlan';
import type { Story, Episode } from '../../types/story';
import type { Consequence } from '../../types/consequences';
import { InformationLedgerScheduleValidator } from './InformationLedgerScheduleValidator';

function infoEntry(overrides: Partial<InformationLedgerEntry> = {}): InformationLedgerEntry {
  return {
    id: 'info-1',
    label: 'Sylvanor is Starborn',
    description: 'The hint that Sylvanor carries Starborn blood.',
    audienceKnowledgeState: 'selective',
    tensionMode: 'foreshadowing',
    knownBy: ['world'],
    introducedEpisode: 2,
    plannedRevealEpisode: 6,
    setupTouchEpisodes: [2],
    payoffPlan: 'Sylvanor reveals the Starborn lineage in the midpoint.',
    isBoxQuestion: false,
    ...overrides,
  };
}

function setFlag(flag: string): Consequence {
  return { type: 'setFlag', flag, value: true };
}

/**
 * Build a story whose episodes each carry a single scene with a single beat. The
 * `flags` map assigns setFlag emitters (on the beat's onShow) per episode number.
 */
function story(flagsByEpisode: Record<number, string[]>, episodeNumbers = [1, 2, 3, 4, 5, 6]): Pick<Story, 'episodes'> {
  const episodes: Episode[] = episodeNumbers.map((n) => ({
    id: `ep-${n}`,
    number: n,
    title: `Episode ${n}`,
    synopsis: '',
    coverImage: '' as unknown as Episode['coverImage'],
    startingSceneId: `ep-${n}-s1`,
    scenes: [
      {
        id: `ep-${n}-s1`,
        name: `Episode ${n} scene`,
        beats: [
          {
            id: `ep-${n}-s1-b1`,
            text: `Beat in episode ${n}.`,
            onShow: (flagsByEpisode[n] ?? []).map(setFlag),
          },
        ],
        startingBeatId: `ep-${n}-s1-b1`,
      },
    ],
  }));
  return { episodes };
}

describe('InformationLedgerScheduleValidator', () => {
  it('passes when authored setup lands on its episode and reveal lands on its authored episode', () => {
    const result = new InformationLedgerScheduleValidator().validate(
      [infoEntry()],
      story({
        2: ['info_1_setup'],
        6: ['info_1_reveal'],
      }),
    );

    expect(result.valid).toBe(true);
    expect(result.metrics.entryCount).toBe(1);
    expect(result.metrics.onScheduleCount).toBe(1);
    expect(result.metrics.revealBeforeSetupCount).toBe(0);
    expect(result.metrics.offPlacementCount).toBe(0);
  });

  it('blocks (error) when the reveal precedes its setup on-page', () => {
    const result = new InformationLedgerScheduleValidator().validate(
      [infoEntry()],
      // reveal flag fires in ep3, setup flag not until ep5 → reveal before setup.
      story({
        3: ['info_1_reveal'],
        5: ['info_1_setup'],
      }),
    );

    expect(result.valid).toBe(false);
    expect(result.metrics.revealBeforeSetupCount).toBe(1);
    expect(result.issues.some((i) => i.severity === 'error' && /before its setup/.test(i.message))).toBe(true);
  });

  it('warns (not blocks) on off-by-one reveal placement', () => {
    const result = new InformationLedgerScheduleValidator().validate(
      [infoEntry()],
      // setup on the authored ep2, but reveal lands ep5 instead of authored ep6.
      story({
        2: ['info_1_setup'],
        5: ['info_1_reveal'],
      }),
    );

    expect(result.valid).toBe(true); // warnings do not invalidate
    expect(result.metrics.offPlacementCount).toBe(1);
    expect(result.issues.some((i) => i.severity === 'warning' && /not its authored reveal episode/.test(i.message))).toBe(true);
  });

  it('blocks when an authored reveal never lands anywhere', () => {
    const result = new InformationLedgerScheduleValidator().validate(
      [infoEntry()],
      story({ 2: ['info_1_setup'] }), // setup only, no reveal flag at all
    );

    expect(result.valid).toBe(false);
    expect(result.metrics.missingRevealCount).toBe(1);
    expect(result.issues.some((i) => i.severity === 'error' && /no reveal landed/.test(i.message))).toBe(true);
  });

  it('honors a caller-supplied observed schedule override', () => {
    const result = new InformationLedgerScheduleValidator().validate(
      [infoEntry()],
      story({}), // empty story; override drives the result instead of the scan
      { observedSchedule: { 'info-1': { setupEpisode: 2, revealEpisode: 6 } } },
    );

    expect(result.valid).toBe(true);
    expect(result.metrics.onScheduleCount).toBe(1);
  });

  it('is vacuously clean when there is no authored ledger', () => {
    const result = new InformationLedgerScheduleValidator().validate(undefined, story({}));
    expect(result.valid).toBe(true);
    expect(result.metrics.entryCount).toBe(0);
  });
});
