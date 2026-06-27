import { describe, expect, it } from 'vitest';
import { STORY_CIRCLE_BEATS } from '../../types/sourceAnalysis';
import {
  STORY_CIRCLE_BEAT_DEFINITIONS,
  STORY_CIRCLE_BEAT_DEFINITION_LINES,
  STORY_CIRCLE_GEOMETRY_PRINCIPLES,
} from '../utils/storyCircleDistribution';
import { buildStructuralContextSection } from './storytellingPrinciples';

const storyCircle = {
  you: 'Mara runs the night desk by habit, guarding her reputation and pretending the missing calls do not scare her.',
  need: 'Mara wants the switchboard promotion and needs to admit she is lonely enough to answer the forbidden line.',
  go: 'A dead caller uses her childhood nickname, and Mara stays on the line after every rule says to hang up.',
  search: 'Mara tests calls, lies to supervisors, recruits Eli, and learns which voices can cross through static.',
  find: 'Mara gets the caller log that proves the missing voices are still reachable.',
  take: 'Using the log costs Eli his job and exposes Mara as the operator who broke the emergency protocol.',
  return: 'Mara brings the log back to the switchboard floor while every operator is listening and the line keeps ringing.',
  change: 'Mara answers in her own name, accepts the public cost, and turns the old desk into a rescue line.',
};

describe('buildStructuralContextSection Story Circle prompt contract', () => {
  it('emits every full canonical beat definition without shortening it', () => {
    const section = buildStructuralContextSection({
      anchors: {
        stakes: 'Every unanswered call erases a person from town memory.',
        goal: 'Mara must identify the forbidden caller before dawn.',
        incitingIncident: 'A dead caller uses Mara\'s childhood nickname.',
        climax: 'Mara answers the final call in front of the whole switchboard.',
      },
      storyCircle,
      episodeStoryCircleRole: [{ beat: 'take', roleKind: 'primary', source: 'llm' }],
      episodeCircle: storyCircle,
    });

    for (const beat of STORY_CIRCLE_BEATS) {
      const line = STORY_CIRCLE_BEAT_DEFINITION_LINES.find((candidate) => candidate.startsWith(`\`${beat}\``));
      expect(line).toBeDefined();
      expect(section).toContain(`\`${beat}\`: ${STORY_CIRCLE_BEAT_DEFINITIONS[beat]}`);
      expect(section).toContain(line!);
    }
    expect(section).toContain('Canonical Story Circle Beat Definitions (authoritative');
    expect(section).toContain('Story Circle Shape Principles (authoritative');
    for (const principle of STORY_CIRCLE_GEOMETRY_PRINCIPLES) {
      expect(section).toContain(principle);
    }
    expect(section).toContain('Full Definition(s) For This Episode');
    expect(section).toContain('Cold opens are the first visible\nrealization of `you + need`');
  });

  it('ignores legacy Story Circle-only context instead of migrating it', () => {
    const section = buildStructuralContextSection({
      anchors: {
        stakes: 'The ward loses patients if Mara obeys the old rules.',
        goal: 'Mara must recover the missing medicine ledger.',
        incitingIncident: 'A locked cabinet opens during the blackout.',
        climax: 'Mara reads the ledger aloud to the board.',
      },
    });

    expect(section).toContain('Season Story Circle Beat Map');
    expect(section).toContain('This Episode\'s Story Circle Role');
    expect(section).toContain('(none supplied)');
    expect(section).not.toContain('Legacy 7-Point');
  });
});
