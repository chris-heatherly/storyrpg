import { describe, expect, it } from 'vitest';

import { auditFictionFirstTurns, FICTION_FIRST_TURN_DOMAINS, inferTurnDomains } from './turnAudit';

describe('fiction-first turn audit', () => {
  it('flags repeated explain/observe beats without readable turns', () => {
    const issues = auditFictionFirstTurns([
      {
        id: 'beat-1',
        text: 'Mara explains the old rule while Ari listens.',
        shotType: 'character',
        primaryAction: 'Mara explains the rule',
      },
      {
        id: 'beat-2',
        text: 'Ari observes the room and thinks about what it means.',
        shotType: 'character',
        primaryAction: 'Ari observes the room',
      },
    ]);

    expect(issues).toContainEqual(expect.objectContaining({
      category: 'topic_run',
      beatId: 'beat-2',
    }));
  });

  it('flags mechanically relevant turns that have no existing you', () => {
    const issues = auditFictionFirstTurns([
      {
        id: 'beat-evidence',
        text: 'Daphne takes the cracked charm, making the secret harder to deny.',
        shotType: 'character',
        intensityTier: 'dominant',
        dramaticIntent: {
          visibleTurn: 'The charm changes hands and Daphne gains leverage.',
          visualSubtextCue: 'Mrs. Constantinou releases the charm with shaking fingers.',
        },
      },
    ]);

    expect(issues).toContainEqual(expect.objectContaining({
      category: 'missing_mechanics_hook',
      domains: expect.arrayContaining(['evidence_transfer', 'secret_pressure', 'leverage_shift']),
    }));
  });

  it('allows rest beats with visible recalibration', () => {
    const issues = auditFictionFirstTurns([
      {
        id: 'beat-rest',
        text: 'After the argument, Alex sets the cup down and leaves more space between them.',
        shotType: 'character',
        intensityTier: 'rest',
        dramaticIntent: {
          visibleTurn: 'Alex chooses distance instead of another joke.',
          visualSubtextCue: 'The untouched coffee sits between them.',
        },
      },
    ]);

    expect(issues).toEqual([]);
  });

  it('shares the expected turn-domain vocabulary', () => {
    expect(FICTION_FIRST_TURN_DOMAINS).toEqual([
      'trust_shift',
      'evidence_transfer',
      'leverage_shift',
      'secret_pressure',
      'proximity_shift',
      'risk_change',
      'identity_expression',
      'resource_change',
      'knowledge_gain',
    ]);
    expect(inferTurnDomains({
      text: 'Ari learns the secret and steps closer with the letter.',
    })).toEqual(expect.arrayContaining(['knowledge_gain', 'secret_pressure', 'proximity_shift', 'evidence_transfer']));
  });
});
