import { describe, expect, it } from 'vitest';
import type { InformationLedgerEntry } from '../../types/seasonPlan';
import { buildForbiddenReveals, formatForbiddenRevealsSection } from './forbiddenReveals';

const entry = (over: Partial<InformationLedgerEntry>): InformationLedgerEntry => ({
  id: 'info-1',
  label: 'Carmen is the anonymous account',
  description: 'Carmen Iliescu runs the anonymous DM account.',
  audienceKnowledgeState: 'withheld',
  tensionMode: 'mystery',
  knownBy: [],
  introducedEpisode: 2,
  setupTouchEpisodes: [],
  payoffPlan: '',
  isBoxQuestion: false,
  ...over,
} as InformationLedgerEntry);

describe('buildForbiddenReveals (G12)', () => {
  it('forbids entries whose reveal episode is later than the current one', () => {
    const items = buildForbiddenReveals([entry({ plannedRevealEpisode: 6 })], 2);
    expect(items).toHaveLength(1);
    expect(items[0].revealEpisode).toBe(6);
  });

  it('allows entries at/after their reveal episode', () => {
    expect(buildForbiddenReveals([entry({ plannedRevealEpisode: 2 })], 2)).toHaveLength(0);
    expect(buildForbiddenReveals([entry({ plannedRevealEpisode: 2 })], 5)).toHaveLength(0);
  });

  it('forbids undated withheld entries; allows undated shared ones', () => {
    expect(buildForbiddenReveals([entry({ plannedRevealEpisode: undefined })], 2)).toHaveLength(1);
    expect(buildForbiddenReveals([entry({ plannedRevealEpisode: undefined, audienceKnowledgeState: 'shared' })], 2)).toHaveLength(0);
  });

  it('exempts ids the scene is scheduled to reveal, and marks setup-touch hints', () => {
    expect(buildForbiddenReveals([entry({ plannedRevealEpisode: 6 })], 2, ['info-1'])).toHaveLength(0);
    const hinted = buildForbiddenReveals([entry({ plannedRevealEpisode: 6, setupTouchEpisodes: [2, 3] })], 2);
    expect(hinted[0].hintAllowed).toBe(true);
  });

  it('formats an empty list as an empty string (prompt unchanged)', () => {
    expect(formatForbiddenRevealsSection([])).toBe('');
    const section = formatForbiddenRevealsSection(buildForbiddenReveals([entry({ plannedRevealEpisode: 6 })], 2));
    expect(section).toContain('Forbidden Reveals');
    expect(section).toContain('Carmen');
    expect(section).toContain('episode 6');
  });
});
