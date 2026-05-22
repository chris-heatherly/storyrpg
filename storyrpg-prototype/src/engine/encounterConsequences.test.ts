import { describe, expect, it } from 'vitest';
import { buildEncounterConsequencePayload } from './encounterConsequences';
import type { EncounterChoiceOutcome } from '../types';

describe('encounterConsequences', () => {
  it('combines memory flags, outcome consequences, and cost consequences', () => {
    const outcome: EncounterChoiceOutcome = {
      tier: 'complicated',
      goalTicks: 1,
      threatTicks: 1,
      narrativeText: 'You get through, but Mika sees who you left behind.',
      isTerminal: true,
      encounterOutcome: 'partialVictory',
      consequences: [
        { type: 'setFlag', flag: 'mika_saw_the_gate_choice', value: true },
      ],
      cost: {
        domain: 'relationship',
        severity: 'moderate',
        whoPays: 'relationship',
        immediateEffect: 'Mika pulls away.',
        visibleComplication: 'Mika trusts you less after the gate.',
        consequences: [
          { type: 'relationship', npcId: 'char-mika-drgan', dimension: 'trust', change: -10 },
        ],
      },
    };

    const payload = buildEncounterConsequencePayload({
      encounterId: 'gate-escape',
      choiceId: 'leave-guard',
      tier: 'complicated',
      outcome,
    });

    expect(payload.consequences).toEqual([
      { type: 'setFlag', flag: 'encounter.gate-escape.choice.leave-guard.complicated', value: true },
      { type: 'setFlag', flag: 'encounter.gate-escape.outcome.partialVictory', value: true },
      { type: 'setFlag', flag: 'mika_saw_the_gate_choice', value: true },
      { type: 'relationship', npcId: 'char-mika-drgan', dimension: 'trust', change: -10 },
    ]);
  });

  it('preserves delayed aftermath from the outcome', () => {
    const outcome: EncounterChoiceOutcome = {
      tier: 'failure',
      goalTicks: 0,
      threatTicks: 2,
      narrativeText: 'The rumor starts before dawn.',
      delayedConsequences: [
        {
          description: 'The club hears how badly this went.',
          delay: { type: 'scenes', count: 1 },
          consequence: { type: 'changeScore', score: 'club_suspicion', change: 2 },
        },
      ],
    };

    const payload = buildEncounterConsequencePayload({
      encounterId: 'rooftop',
      choiceId: 'provoke-lucian',
      tier: 'failure',
      outcome,
    });

    expect(payload.consequences).toContainEqual({
      type: 'setFlag',
      flag: 'encounter.rooftop.choice.provoke-lucian.failure',
      value: true,
    });
    expect(payload.delayedConsequences).toEqual(outcome.delayedConsequences);
  });
});
