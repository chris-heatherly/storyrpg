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
function story(
  flagsByEpisode: Record<number, string[]>,
  episodeNumbers = [1, 2, 3, 4, 5, 6],
  textByEpisode: Record<number, string> = {},
): Pick<Story, 'episodes'> {
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
            text: textByEpisode[n] ?? `Beat in episode ${n}.`,
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
  it('passes when authored setup lands on its episode and the reveal is DEPICTED in its authored episode', () => {
    const result = new InformationLedgerScheduleValidator().validate(
      [infoEntry()],
      story(
        {
          2: ['info_1_setup'],
          6: ['info_1_reveal'],
        },
        [1, 2, 3, 4, 5, 6],
        // Step 4: the reveal episode's prose actually depicts the fact (Sylvanor / Starborn).
        { 6: 'At the midpoint, Sylvanor finally reveals his Starborn blood to the court.' },
      ),
    );

    expect(result.valid).toBe(true);
    expect(result.metrics.entryCount).toBe(1);
    expect(result.metrics.onScheduleCount).toBe(1);
    expect(result.metrics.revealBeforeSetupCount).toBe(0);
    expect(result.metrics.offPlacementCount).toBe(0);
    expect(result.metrics.flaggedNotDepictedCount).toBe(0);
  });

  it('Step 4: WARNS (not blocks) when the reveal flag is set but the fact is not depicted in the prose', () => {
    const result = new InformationLedgerScheduleValidator().validate(
      [infoEntry()],
      // reveal flag set in ep6, but ep6 prose says nothing about Sylvanor/Starborn.
      story({ 2: ['info_1_setup'], 6: ['info_1_reveal'] }),
    );
    expect(result.valid).toBe(true); // warning, not error — flag stays the blocking signal
    expect(result.metrics.flaggedNotDepictedCount).toBe(1);
    expect(result.metrics.missingRevealCount).toBe(0); // the reveal DID land (flag) — just not depicted
    expect(result.issues.some((i) => i.severity === 'warning' && /not depicted/.test(i.message))).toBe(true);
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

  it('partial-season: does not flag a reveal scheduled for an UNGENERATED episode (gen-5)', () => {
    // Reveal scheduled for ep6, but only ep1–3 were generated → not "missing".
    const result = new InformationLedgerScheduleValidator().validate(
      [infoEntry({ introducedEpisode: 2, setupTouchEpisodes: [2], plannedRevealEpisode: 6 })],
      story({ 2: ['info_1_setup'] }, [1, 2, 3]),
    );
    expect(result.metrics.missingRevealCount).toBe(0);
    expect(result.valid).toBe(true);
  });

  it('partial-season: STILL flags an in-range reveal that never landed (real INFO entry)', () => {
    // Reveal scheduled for ep2, which WAS generated, but no reveal flag landed → real miss.
    const result = new InformationLedgerScheduleValidator().validate(
      [infoEntry({ id: 'info-a', introducedEpisode: 1, setupTouchEpisodes: [1], plannedRevealEpisode: 2 })],
      story({ 1: ['info-a_setup'] }, [1, 2, 3]),
    );
    expect(result.metrics.missingRevealCount).toBe(1);
    expect(result.valid).toBe(false);
  });

  it('exempts arc-reframe SUMMARY entries from the discrete-reveal requirement', () => {
    // `info-arc-<N>-reframe` entries are arc recontextualization summaries injected by
    // the SeasonPlanner — delivered across the arc's scenes, not as a discrete id-tagged
    // reveal/flag. Requiring a discrete reveal for them is a category error (the gen-5
    // false positive). They must NOT be flagged even when no reveal "lands".
    const result = new InformationLedgerScheduleValidator().validate(
      [infoEntry({ id: 'info-arc-1-reframe', label: 'Champagne (Arc 1) reframe', introducedEpisode: 1, setupTouchEpisodes: [1], plannedRevealEpisode: 2 })],
      story({ 1: ['something_unrelated'] }, [1, 2, 3]),
    );
    expect(result.metrics.missingRevealCount).toBe(0);
    expect(result.valid).toBe(true);
  });

  it('detects a reveal that lands inside an ENCOUNTER beat (phases/storylets, not scene.beats)', () => {
    // Encounter scenes carry their setup/reveal beats under encounter.phases /
    // encounter.storylets — not scene.beats. A reveal flag set there must be detected,
    // not reported "never landed".
    const encStory: Pick<Story, 'episodes'> = {
      episodes: [1, 2].map((n) => ({
        id: `ep-${n}`, number: n, title: `Episode ${n}`, synopsis: '',
        coverImage: '' as unknown as Episode['coverImage'], startingSceneId: `ep-${n}-s1`,
        scenes: [
          n === 2
            ? ({
                id: 'treatment-enc-2-1', name: 'Velvet Booth', startingBeatId: '', beats: [],
                encounter: {
                  phases: [{ id: 'p1', beats: [{ id: 'p1-b1', text: 'x', onShow: [setFlag('info-1-reveal')] }] }],
                  storylets: {},
                },
              } as unknown as Episode['scenes'][number])
            : ({ id: `ep-${n}-s1`, name: 's', startingBeatId: `ep-${n}-s1-b1`, beats: [{ id: `ep-${n}-s1-b1`, text: 'setup', onShow: [setFlag('info-1_setup')] }] } as unknown as Episode['scenes'][number]),
        ],
      })),
    };
    const result = new InformationLedgerScheduleValidator().validate(
      [infoEntry({ id: 'info-1', introducedEpisode: 1, setupTouchEpisodes: [1], plannedRevealEpisode: 2 })],
      encStory,
    );
    expect(result.metrics.missingRevealCount).toBe(0);
    expect(result.valid).toBe(true);
  });
});
