import { describe, expect, it } from 'vitest';
import { runCorpus, loadLabels } from './replay-corpus';

/**
 * CI gate for the labeled recurring-defect corpus (WS0.1). Enforced labels must hold:
 * a confirmed defect stays caught, a confirmed false-positive stays quiet. Hermetic
 * fixtures (committed) always run; live generated-stories labels enforce only when the
 * run is present locally (gitignored runs skip, never fail). Pending labels never gate.
 */
describe('defect corpus (recurring-defect regression)', () => {
  const outcomes = runCorpus();

  it('has at least one enforced hermetic label', () => {
    const enforcedFixtures = loadLabels().filter(
      (l) => l.status === 'enforced' && l.corpus.includes('fixtures'),
    );
    expect(enforcedFixtures.length).toBeGreaterThan(0);
  });

  it('every enforced label that resolves passes (defect caught / FP not flagged)', () => {
    const failures = outcomes
      .filter((o) => o.label.status === 'enforced' && o.result === 'fail')
      .map((o) => `${o.label.class} · ${o.label.gate} · ${o.label.runMatch}: ${o.reason}`);
    expect(failures).toEqual([]);
  });

  it('hermetic fixtures are always present (never skipped for absence)', () => {
    const fixtureSkips = outcomes.filter(
      (o) => o.label.corpus.includes('fixtures') && o.result === 'skipped',
    );
    expect(fixtureSkips.map((o) => o.reason)).toEqual([]);
  });
});
