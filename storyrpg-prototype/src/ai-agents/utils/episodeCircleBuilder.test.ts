import { describe, expect, it } from 'vitest';
import { buildScopedEpisodeCircle, flattenAuthoredEpisodeTurns } from './episodeCircleBuilder';
import type { StoryCircleRoleAssignment } from '../../types/sourceAnalysis';

describe('flattenAuthoredEpisodeTurns', () => {
  it('splits compound high-level description sentences into ordered turn fragments', () => {
    const turns = flattenAuthoredEpisodeTurns([
      'Kylie arrives in Bucharest with two suitcases. She explores the streets of Bucharest and wanders into a bookshop owned by Stela who befriends her.',
    ]);
    expect(turns.length).toBeGreaterThanOrEqual(2);
    expect(turns.some((t) => /explores the streets/i.test(t))).toBe(true);
    expect(turns.some((t) => /arrives in Bucharest/i.test(t))).toBe(true);
  });
});

describe('buildScopedEpisodeCircle', () => {
  const synopsis = 'Mara finds Jonas breaking into the archive at low tide. The sealed bell ledger names his sister as dead before she died. Mara must decide whether to protect Jonas or preserve the record. The episode ends with the bell chain moving by itself.';
  const roles: StoryCircleRoleAssignment[] = [{ beat: 'you', roleKind: 'primary', source: 'treatment' }];

  it('leaves inactive story-circle beats empty instead of repeating the full synopsis', () => {
    const circle = buildScopedEpisodeCircle({
      episodeNumber: 1,
      episodeTitle: 'The Sealed Bell',
      synopsis,
      majorPressure: 'Mara must choose between controlled silence and public risk.',
      episodeTurns: flattenAuthoredEpisodeTurns([synopsis]),
      storyCircleRole: roles,
    });

    expect(circle.you).toContain('Mara finds Jonas');
    expect(circle.need).toBe('');
    expect(circle.go).toBe('');
    expect(circle.change).toBe('');
    expect(JSON.stringify(circle)).not.toContain(synopsis);
  });

  it('fills you and need when both beats are active for the episode', () => {
    const circle = buildScopedEpisodeCircle({
      episodeNumber: 1,
      episodeTitle: 'The Sealed Bell',
      synopsis,
      majorPressure: 'Mara must choose between controlled silence and public risk.',
      episodeTurns: flattenAuthoredEpisodeTurns([synopsis]),
      storyCircleRole: [
        { beat: 'you', roleKind: 'primary', source: 'treatment' },
        { beat: 'need', roleKind: 'primary', source: 'treatment' },
      ],
    });

    expect(circle.you).toContain('Mara finds Jonas');
    expect(circle.need).toContain('controlled silence');
    expect(circle.go).toBe('');
    expect(circle.change).toBe('');
  });

  it('prefers episode-local arc text over synopsis fallback', () => {
    const circle = buildScopedEpisodeCircle({
      episodeNumber: 1,
      episodeTitle: 'Episode One',
      synopsis,
      storyCircleRole: roles,
      arc: { you: 'Local opening pressure only.' },
    });

    expect(circle.you).toContain('Local opening pressure only');
    expect(circle.you).not.toContain('bell chain moving');
  });
});
