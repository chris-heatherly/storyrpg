/**
 * Regression pins for the storyrpg-lite 2026-07-04T21-46-05 s1-2 abort.
 *
 * StoryArchitect.ensureCharacterIntroductionBeats emits requiredBeats whose
 * mustDepict is a writer DIRECTIVE ("You meet Stela Pavel for the first time
 * in this scene — show how they enter your attention, how they name
 * themselves or are named to you, and one concrete identifying detail before
 * any familiarity or group-belonging language."). Compound-clause token
 * scoring against that meta text is unrealizable by construction — good prose
 * never contains "identifying detail" or "group-belonging language" — so the
 * realization retry loop could never succeed and the run hard-aborted.
 *
 * Fixes pinned here:
 *  1. Intro directives score as 'character-introduction': depicted iff the
 *     prose actually NAMES the character (first-contact QUALITY stays with
 *     CharacterIntroductionValidator at the final contract).
 *  2. The deterministic insertion path never pastes the directive as player
 *     prose; it defers to SceneWriter / season-final repair.
 */
import { describe, expect, it } from 'vitest';
import { characterIntroductionMomentName, evaluateMomentRealization } from './realizationEvaluator';
import { insertMissingMomentBeats, missingRequiredMoments } from './sceneRealizationGuard';

const INTRO_DIRECTIVE =
  'You meet Stela Pavel for the first time in this scene — show how they enter your attention, '
  + 'how they name themselves or are named to you, and one concrete identifying detail before any '
  + 'familiarity or group-belonging language.';

describe('characterIntroductionMomentName', () => {
  it('extracts the character name from an intro directive', () => {
    expect(characterIntroductionMomentName(INTRO_DIRECTIVE)).toBe('Stela Pavel');
  });

  it('does not match ordinary authored moments', () => {
    expect(characterIntroductionMomentName('Kylie Marinescu arrives in Bucharest')).toBeUndefined();
    expect(characterIntroductionMomentName('At the rooftop bar she meets a stranger')).toBeUndefined();
  });
});

describe('character-introduction realization mode', () => {
  it('scores depicted when the prose names the character in full', () => {
    const prose = 'The woman behind the counter extends a hand. "Stela Pavel," she says, as if the name settles something.';
    const assessment = evaluateMomentRealization('RequiredBeatRealizationValidator', INTRO_DIRECTIVE, prose);
    expect(assessment.mode).toBe('character-introduction');
    expect(assessment.depicted).toBe(true);
  });

  it('scores depicted when the prose uses only the given name', () => {
    const prose = '"Call me Stela," she says, pressing a cool stone into your palm. Rose quartz, you think.';
    const assessment = evaluateMomentRealization('RequiredBeatRealizationValidator', INTRO_DIRECTIVE, prose);
    expect(assessment.depicted).toBe(true);
  });

  it('scores missing when the character is never named', () => {
    const prose = 'A woman watches you from behind the shelves. You browse the folklore section and leave without a word.';
    const assessment = evaluateMomentRealization('RequiredBeatRealizationValidator', INTRO_DIRECTIVE, prose);
    expect(assessment.mode).toBe('character-introduction');
    expect(assessment.depicted).toBe(false);
    expect(assessment.missingClauses[0]).toContain('Stela Pavel');
  });

  it('missingRequiredMoments accepts a first-meeting scene that names the character without the directive meta-words', () => {
    const missing = missingRequiredMoments(
      { requiredBeats: [{ tier: 'authored', mustDepict: INTRO_DIRECTIVE }] },
      [
        { id: 'b1', text: 'The bell above the bookshop door rings. A woman looks up from a ledger.' },
        { id: 'b2', text: '"Stela," she offers, before you can ask. "This is my shop." Her ring taps the counter twice.' },
      ],
    );
    expect(missing).toEqual([]);
  });
});

describe('insertion hard-stop for intro directives', () => {
  it('never pastes the directive as prose and defers to SceneWriter realization', () => {
    const beats = [
      { id: 'b1', text: 'You wander into the bookshop off Strada Lipscani.' },
      { id: 'b2', text: 'The shelves lean with folklore.', isChoicePoint: true, choices: [{}] },
    ];
    const missing = [{
      moment: INTRO_DIRECTIVE,
      validator: 'RequiredBeatRealizationValidator' as const,
      tier: 'authored',
      missingTokens: ['stela', 'pavel'],
    }];
    const skipped: string[] = [];

    insertMissingMomentBeats('s1-2', beats, missing, {
      onSkip: (_m, reason) => skipped.push(reason),
    });

    expect(beats.map((beat) => beat.id)).toEqual(['b1', 'b2']);
    // ContentGenerationPhase keys the defer-to-season-final path on this phrase.
    expect(skipped[0]).toContain('needs SceneWriter realization');
  });
});
