/**
 * Regression pins for the 2026-07-04 "Kylie Marinescu arrives in Bucharest."
 * beat leak (bite-me / storyrpg-lite s1-1). Chain: a coldopen requiredBeat
 * carried the third-person planning atom as mustDepict; the second-person
 * scene prose could never contain the protagonist's name, so token-overlap
 * scored the faithfully-dramatized arrival as missing (1/4 < 0.5); after two
 * futile retries the guard pasted the planning text verbatim as player prose.
 *
 * Fixes pinned here:
 *  1. POV-aware realization scoring — with the run's protagonist aliases
 *     armed, name tokens are excluded from needed tokens when the prose is
 *     second-person, so the real scene scores depicted.
 *  2. Insertion hard-stop — a moment that NAMES the protagonist is never
 *     inserted verbatim into second-person prose; it defers to SceneWriter /
 *     the season-final semantic gate.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { evaluateMomentRealization, setRealizationPovContext } from './realizationEvaluator';
import { insertMissingMomentBeats, missingRequiredMoments } from './sceneRealizationGuard';

const LEAKED_MOMENT = 'Kylie Marinescu arrives in Bucharest';

/** Abridged second-person prose from the actual leaking run (storyrpg-lite 2026-07-04T05-06-46 s1-1). */
const RUN_BEATS = [
  { id: 's1-1-beat-1', text: 'The taxi leaves you on a curb slick with rain. Two suitcases, your entire life condensed.' },
  { id: 's1-1-beat-2', text: 'You drag your bags over the uneven cobblestones. In your hand, a slip of paper, softened from the journey.' },
  { id: 's1-1-beat-3', text: 'An ancient iron key grinds in the lock. The heavy door swings inward, releasing the scent of beeswax.' },
  { id: 's1-1-beat-6', text: 'From the tall, curtained window, Bucharest glitters below, a city of secrets waiting to be written.' },
];

afterEach(() => {
  setRealizationPovContext(null);
});

describe('POV-aware realization scoring (2026-07-04 arrival leak)', () => {
  it('without POV context the second-person arrival is a false negative (the old bug)', () => {
    const prose = RUN_BEATS.map((b) => b.text).join(' ');
    const assessment = evaluateMomentRealization('RequiredBeatRealizationValidator', LEAKED_MOMENT, prose);
    expect(assessment.depicted).toBe(false);
    expect(assessment.missingTokens).toContain('kylie');
    expect(assessment.missingTokens).toContain('marinescu');
  });

  it('with the protagonist armed, second-person prose satisfies name tokens and the arrival scores depicted', () => {
    setRealizationPovContext({ protagonistAliases: ['Kylie Marinescu'] });
    const prose = RUN_BEATS.map((b) => b.text).join(' ');
    const assessment = evaluateMomentRealization('RequiredBeatRealizationValidator', LEAKED_MOMENT, prose);
    expect(assessment.depicted).toBe(true);
  });

  it('does NOT relax name tokens for third-person-named prose (name genuinely absent stays missing)', () => {
    setRealizationPovContext({ protagonistAliases: ['Kylie Marinescu'] });
    const thirdPersonProse = 'The taxi leaves a stranger on a curb slick with rain. Bucharest glitters beyond the window.';
    const assessment = evaluateMomentRealization('RequiredBeatRealizationValidator', LEAKED_MOMENT, thirdPersonProse);
    expect(assessment.depicted).toBe(false);
  });

  it('missingRequiredMoments no longer flags the coldopen contract on the real prose', () => {
    setRealizationPovContext({ protagonistAliases: ['Kylie Marinescu'] });
    const missing = missingRequiredMoments(
      { requiredBeats: [{ tier: 'coldopen', mustDepict: LEAKED_MOMENT }] },
      RUN_BEATS,
    );
    expect(missing).toEqual([]);
  });
});

describe('insertion hard-stop for protagonist-named moments', () => {
  it('never pastes a protagonist-named coldopen moment into second-person prose (defers to SceneWriter realization)', () => {
    setRealizationPovContext({ protagonistAliases: ['Kylie Marinescu'] });
    const beats = [
      { id: 'b1', text: 'You drag your bags over the cobblestones toward the address on the slip of paper.' },
      { id: 'b2', text: 'The courtyard is quiet.', isChoicePoint: true, choices: [{}] },
    ];
    const missing = [{
      moment: LEAKED_MOMENT,
      validator: 'RequiredBeatRealizationValidator' as const,
      tier: 'coldopen',
      missingTokens: ['kylie', 'marinescu', 'arrives', 'bucharest'],
    }];
    const skipped: string[] = [];

    insertMissingMomentBeats('s1-1', beats, missing, {
      allowColdOpenInsertion: true,
      onSkip: (_m, reason) => skipped.push(reason),
    });

    expect(beats.map((beat) => beat.id)).toEqual(['b1', 'b2']);
    // The skip reason must include this phrase — ContentGenerationPhase keys
    // the defer-to-season-final path on it (otherwise the scene hard-fails).
    expect(skipped[0]).toContain('needs SceneWriter realization');
    expect(skipped[0]).toContain('names the protagonist');
  });

  it('still inserts protagonist-free concrete moments (existing recovery unchanged)', () => {
    setRealizationPovContext({ protagonistAliases: ['Kylie Marinescu'] });
    const beats = [
      { id: 'b1', text: 'You wait in the courtyard while your breath fogs.' },
      { id: 'b2', text: 'A door opens.', isChoicePoint: true, choices: [{}] },
    ];
    const missing = [{
      moment: 'The stray dog in the courtyard, watching from behind the gate.',
      validator: 'RequiredBeatRealizationValidator' as const,
      tier: 'seed',
      missingTokens: ['stray', 'watching'],
    }];

    insertMissingMomentBeats('s1-1', beats, missing);

    expect(beats.some((beat) => beat.id?.includes('authored-seed'))).toBe(true);
  });
});
