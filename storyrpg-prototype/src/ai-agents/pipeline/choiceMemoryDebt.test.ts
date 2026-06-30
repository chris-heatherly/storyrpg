import { describe, expect, it } from 'vitest';
import type { SeasonResidueObligation } from '../../types/seasonPlan';
import {
  classifyLedgerFlag,
  classifyPlannedFlag,
  findResidueEvidence,
  isPlayerFacingCallbackText,
} from './choiceMemoryDebt';

function obligation(overrides: Partial<SeasonResidueObligation> = {}): SeasonResidueObligation {
  return {
    id: 'residue:mika_protection',
    source: 'choice_moment',
    sourceEpisodeNumber: 1,
    choiceAnchor: 'Accept Mika protection',
    flag: 'accepted_mikas_protection',
    conditionKey: 'accepted_mikas_protection',
    kind: 'relationship_behavior',
    payoffPolicy: 'specific_episode',
    targetEpisodeNumbers: [2],
    sourceMaterial: {
      feedbackEcho: 'Mika keeps half a step closer after you let her protect you.',
    },
    authoringGuidance: 'Show Mika behaving as though protection was accepted.',
    requiredSurface: ['text_variant'],
    priority: 'major',
    ...overrides,
  };
}

describe('choiceMemoryDebt', () => {
  it('classifies callback-ledger flags by future window and resolved state', () => {
    const ledger = {
      version: 1 as const,
      config: { payoffThreshold: 2, defaultWindowSpan: 3, maxActiveHooks: 24 },
      hooks: [
        {
          id: 'flag:future_flag',
          sourceEpisode: 1,
          sourceSceneId: 's1',
          sourceChoiceId: 'c1',
          flags: ['future_flag'],
          summary: 'Future payoff.',
          payoffWindow: { minEpisode: 2, maxEpisode: 5 },
          payoffCount: 0,
          resolved: false,
          createdAt: '2026-06-24T00:00:00.000Z',
        },
        {
          id: 'flag:resolved_flag',
          sourceEpisode: 1,
          sourceSceneId: 's1',
          sourceChoiceId: 'c2',
          flags: ['resolved_flag'],
          summary: 'Resolved payoff.',
          payoffWindow: { minEpisode: 1, maxEpisode: 2 },
          payoffCount: 2,
          resolved: true,
          createdAt: '2026-06-24T00:00:00.000Z',
        },
      ],
    };

    expect(classifyLedgerFlag('future_flag', ledger, 3)).toBe('future-window');
    expect(classifyLedgerFlag('resolved_flag', ledger, 3)).toBe('resolved-or-abandoned');
    expect(classifyLedgerFlag('missing_flag', ledger, 3)).toBeUndefined();
  });

  it('classifies planned residue separately from true orphan flags', () => {
    expect(classifyPlannedFlag('accepted_mikas_protection', [obligation()], new Set(), 1)).toBe('future_window');
    expect(classifyPlannedFlag('accepted_mikas_protection', [obligation()], new Set(['accepted_mikas_protection']), 2)).toBe('planned_paid');
    expect(classifyPlannedFlag('accepted_mikas_protection', [obligation()], new Set(), 2)).toBe('planned_due_missing');
    expect(classifyPlannedFlag('unplanned_flag', [obligation()], new Set(), 2)).toBe('unplanned_orphan');
  });

  it('requires player-facing prose before residue counts as paid', () => {
    const planned = obligation();
    const metadataOnly = findResidueEvidence(
      [{
        sceneId: 's2',
        beats: [{
          id: 'b2',
          text: 'The hallway narrows.',
          textVariants: [{
            condition: { type: 'flag', flag: 'accepted_mikas_protection', value: true },
            text: 'residue:mika_protection callbackHookId flag',
            residueObligationId: 'residue:mika_protection',
          }],
        }],
      }],
      [],
      planned,
    );
    expect(metadataOnly.paid).toBe(false);
    expect(metadataOnly.metadataOnly).toBe(true);

    const paid = findResidueEvidence(
      [{
        sceneId: 's2',
        beats: [{
          id: 'b2',
          text: 'The hallway narrows.',
          textVariants: [{
            condition: { type: 'flag', flag: 'accepted_mikas_protection', value: true },
            text: 'The hallway narrows around you. Mika keeps half a step closer after your answer.',
            residueObligationId: 'residue:mika_protection',
          }],
        }],
      }],
      [],
      planned,
    );
    expect(paid.paid).toBe(true);
    expect(paid.surface).toBe('text_variant');
  });

  it('filters raw identifiers and planning notes from player-facing proof', () => {
    expect(isPlayerFacingCallbackText('Mika keeps half a step closer.')).toBe(true);
    expect(isPlayerFacingCallbackText('accepted_mikas_protection')).toBe(false);
    expect(isPlayerFacingCallbackText('Add a textVariant for callbackHookId.')).toBe(false);
  });
});
