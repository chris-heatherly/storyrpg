import { describe, expect, it } from 'vitest';
import type { Story } from '../../types';
import type { RelationshipPacingContract } from '../../types/scenePlan';
import { buildRelationshipArcLedger } from '../utils/relationshipArcLedger';
import { RelationshipArcLedgerValidator } from './RelationshipArcLedgerValidator';
import { SceneSpatialUnitValidator } from './SceneSpatialUnitValidator';
import { ThematicSquareTurnValidator } from './ThematicSquareTurnValidator';

function pacing(overrides: Partial<RelationshipPacingContract> = {}): RelationshipPacingContract {
  return {
    id: 'rel-stela',
    source: 'treatment',
    npcId: 'stela',
    startStage: 'unmet',
    targetStage: 'spark',
    allowedLabels: ['spark', 'new acquaintance'],
    blockedLabels: ['friend', 'trusted ally', 'best friend'],
    requiredEvidence: ['show on-page behavior before naming the bond'],
    minScenesSinceIntroduction: 1,
    maxDeltaThisScene: 6,
    mechanicDimensions: ['trust', 'affection'],
    ...overrides,
  };
}

function beat(id: string, text: string, extra: Record<string, unknown> = {}): any {
  return { id, text, ...extra };
}

function scene(id: string, text: string, extra: Record<string, unknown> = {}): any {
  return {
    id,
    name: id,
    startingBeatId: `${id}-b1`,
    beats: [beat(`${id}-b1`, text)],
    ...extra,
  };
}

function story(scenes: any[]): Story {
  return {
    id: 'test-story',
    title: 'Test Story',
    genre: 'urban fantasy',
    synopsis: '',
    coverImage: '',
    initialState: {
      attributes: { charm: 0, wit: 0, courage: 0, empathy: 0, resolve: 0, resourcefulness: 0 },
      skills: {},
      tags: [],
      inventory: [],
    },
    npcs: [
      { id: 'stela', name: 'Stela Pavel', description: '' },
      { id: 'mika', name: 'Mika Dragan', description: '' },
    ],
    episodes: [{
      id: 'ep1',
      number: 1,
      title: 'Episode 1',
      synopsis: '',
      coverImage: '',
      scenes,
      startingSceneId: scenes[0]?.id,
    }],
  } as Story;
}

describe('relationship arc enforcement', () => {
  it('builds a deterministic ledger from introductions, choices, deltas, and evidence', () => {
    const s = story([
      scene('s1-1', 'At Lumina Books, Stela Pavel looks up from a stack of paperbacks.'),
      scene('s1-2', 'Stela waits to see whether you will trust the warning.', {
        beats: [beat('s1-2-b1', 'Stela waits to see whether you will trust the warning.', {
          choices: [{
            id: 'c1',
            text: "Respect Stela's caution",
            choiceType: 'relationship',
            consequences: [{ type: 'relationship', npcId: 'stela', dimension: 'trust', change: 4 }],
            relationshipValueEvidence: [{
              npcId: 'stela',
              axis: 'love',
              evidenceTags: ['respected_agency'],
              intendedSurface: 'mutual_aid',
              reason: 'You accept help without demanding everything.',
            }],
          }],
        })],
      }),
    ]);

    const ledger = buildRelationshipArcLedger(s);
    const stela = ledger.byKey.get('npc:stela');
    expect(stela?.introducedSceneId).toBe('s1-1');
    expect(stela?.relationshipChoiceSceneIds).toEqual(['s1-2']);
    expect(stela?.deltasByDimension.trust.positive).toBe(4);
    expect(stela?.currentStage).toBe('tentative_ally');
  });

  it('blocks meaningful action in two major named locations inside one scene', () => {
    const s = story([
      scene(
        's1-1',
        'At Lumina Books, Stela Pavel closes the shop and walks you through Lipscani. At the velvet rope outside Vâlcescu Club, Mika Dragan clocks your shoes and says, "Side door."',
        { timeline: { location: 'Lumina Books' } },
      ),
      scene('s1-2', 'The rooftop at Vâlcescu Club waits above the city.', {
        timeline: { location: 'Vâlcescu Club' },
      }),
    ]);

    const result = new SceneSpatialUnitValidator().validate({ story: s, treatmentSourced: true });
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('multiple major locations'))).toBe(true);
  });

  it('clamps a scene target that outruns the deterministic relationship ledger instead of blocking (2026-07-04 policy)', () => {
    // effectiveTargetStage() clamps to the ledger head: an over-reaching planned
    // target validates at the EARNED stage rather than aborting the run
    // (bite-me 2026-07-04: s1-3 targeted acquaintance, ledger permitted spark).
    const s = story([
      scene('s1-1', 'At Lumina Books, Stela Pavel looks up and says hello.', {
        relationshipPacing: [pacing({ targetStage: 'friend', allowedLabels: ['friend'] })],
      }),
    ]);

    const result = new RelationshipArcLedgerValidator().validate({ story: s, treatmentSourced: true });
    expect(result.issues.some((issue) => issue.message.includes('only permits'))).toBe(false);
    expect(result.valid).toBe(true);
  });

  it('deduplicates repeated relationship pacing contract findings without making them valid', () => {
    const duplicate = pacing({
      id: 'rel-stela-cap',
      targetStage: 'spark',
      maxDeltaThisScene: 2,
    });
    const s = story([
      scene('s1-1', 'Stela offers more than the moment has earned.', {
        relationshipPacing: [duplicate, { ...duplicate }],
        beats: [beat('s1-1-b1', 'Stela offers more than the moment has earned.', {
          choices: [{
            id: 'c1',
            text: 'Lean in',
            choiceType: 'relationship',
            consequences: [{ type: 'relationship', npcId: 'stela', dimension: 'trust', change: 6 }],
          }],
        })],
      }),
    ]);

    const result = new RelationshipArcLedgerValidator().validate({ story: s, treatmentSourced: true });
    const capIssues = result.issues.filter((issue) => issue.message.includes('above the ledger cap'));

    expect(result.valid).toBe(false);
    expect(capIssues).toHaveLength(1);
  });

  it('keeps repeated group mentions at spark without a group-defining relationship choice', () => {
    const s = story([
      scene('s1-1', 'At the station, the circle name starts as a dare.', {
        relationshipPacing: [pacing({
          id: 'rel-circle-1',
          source: 'planner',
          npcId: undefined,
          groupId: 'circle',
          targetStage: 'spark',
        })],
      }),
      scene('s1-2', 'The circle name comes up again, still as an invitation rather than membership.', {
        relationshipPacing: [pacing({
          id: 'rel-circle-2',
          source: 'planner',
          npcId: undefined,
          groupId: 'circle',
          targetStage: 'spark',
        })],
      }),
    ]);

    const ledger = buildRelationshipArcLedger(s);
    expect(ledger.byKey.get('group:circle')?.currentStage).toBe('spark');
    expect(new RelationshipArcLedgerValidator().validate({ story: s, treatmentSourced: true }).valid).toBe(true);
  });

  it('allows a group to advance when a relationship-choice contract defines the group turn', () => {
    const s = story([
      scene('s1-1', 'At the station, the circle name becomes a deliberate shared commitment.', {
        relationshipPacing: [pacing({
          id: 'rel-circle-choice',
          source: 'choice',
          npcId: undefined,
          groupId: 'circle',
          targetStage: 'acquaintance',
        })],
      }),
    ]);

    const ledger = buildRelationshipArcLedger(s);
    expect(ledger.byKey.get('group:circle')?.currentStage).toBe('acquaintance');
    expect(new RelationshipArcLedgerValidator().validate({ story: s, treatmentSourced: true }).valid).toBe(true);
  });

  it('blocks a relationship choice whose thematic-square surface disagrees with evidence', () => {
    const s = story([
      scene('s1-1', 'Stela offers help only if you stop asking questions.', {
        beats: [beat('s1-1-b1', 'Stela offers help only if you stop asking questions.', {
          choices: [{
            id: 'c1',
            text: 'Accept the bargain',
            choiceType: 'relationship',
            consequences: [
              { type: 'relationship', npcId: 'stela', dimension: 'affection', change: 8 },
              { type: 'relationship', npcId: 'stela', dimension: 'fear', change: 8 },
            ],
            relationshipValueEvidence: [{
              npcId: 'stela',
              axis: 'love',
              evidenceTags: ['aid_with_strings'],
              intendedSurface: 'mutual_aid',
              reason: 'The help has strings attached.',
            }],
          }],
        })],
      }),
    ]);

    const result = new ThematicSquareTurnValidator().validate({ story: s, treatmentSourced: true });
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('without the required positive evidence'))).toBe(true);
  });
});
