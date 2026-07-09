import { describe, expect, it } from 'vitest';
import type { Story } from '../../types';
import { buildChoiceSetJsonSchema } from '../schemas/choiceSetSchema';
import { buildRelationshipArcLedger } from './relationshipArcLedger';
import {
  normalizeCanonicalConsequence,
  normalizeCanonicalConsequences,
} from './canonicalChoiceConsequences';

function consequenceVariants(): Array<{
  required: string[];
  properties: Record<string, { enum?: string[] }>;
}> {
  const schema = buildChoiceSetJsonSchema({ choiceType: 'relationship' }).schema as any;
  return schema.properties.choices.items.properties.consequences.items.anyOf;
}

function matchingVariants(value: Record<string, unknown>): number {
  return consequenceVariants().filter((variant) => {
    const allowed = new Set(Object.keys(variant.properties));
    return variant.required.every((key) => key in value)
      && Object.keys(value).every((key) => allowed.has(key))
      && (!variant.properties.type.enum
        || variant.properties.type.enum.includes(String(value.type)));
  }).length;
}

describe('canonical choice consequence contract', () => {
  it('accepts every canonical discriminated consequence variant', () => {
    const variants = [
      { type: 'attribute', attribute: 'courage', change: 1 },
      { type: 'skill', skill: 'perception', change: 1 },
      { type: 'relationship', npcId: 'char-mika', dimension: 'trust', change: 3 },
      {
        type: 'relationshipEvidence',
        npcId: 'char-mika',
        axis: 'trust',
        evidenceTags: ['respected_agency'],
        reason: 'Mika sees Alex honor her decision.',
        intendedSurface: 'mutual_aid',
      },
      { type: 'setFlag', flag: 'asked_mika', value: true },
      { type: 'changeScore', score: 'blog_reach', change: 1 },
      { type: 'setScore', score: 'danger', value: 2 },
      { type: 'addTag', tag: 'truth_teller' },
      { type: 'removeTag', tag: 'outsider' },
      { type: 'addItem', item: { id: 'key', name: 'Key', description: 'A brass key.' } },
      { type: 'addItem', itemId: 'key', name: 'Key', description: 'A brass key.', quantity: 1 },
      { type: 'removeItem', itemId: 'key', quantity: 1 },
    ];

    expect(variants.map(matchingVariants)).toEqual(variants.map(() => 1));
    const normalized = normalizeCanonicalConsequences(variants);
    expect(normalized.rejected).toEqual([]);
    expect(normalized.consequences).toHaveLength(variants.length);
  });

  it('rejects mixed structured shapes instead of requiring flag/value everywhere', () => {
    const malformed = {
      type: 'relationship',
      npcId: 'char-mika',
      dimension: 'trust',
      change: 3,
      flag: 'mika_trust_up',
      value: true,
    };

    expect(matchingVariants(malformed)).toBe(0);
    expect(normalizeCanonicalConsequence(malformed).consequence).toEqual({
      type: 'relationship',
      npcId: 'char-mika',
      dimension: 'trust',
      change: 3,
    });
  });

  it('normalizes explicit legacy aliases but never infers relationship movement from a flag', () => {
    expect(normalizeCanonicalConsequence({
      type: 'adjustRelationship',
      npcId: 'mika',
      aspect: 'affection',
      delta: 2,
    }).consequence).toEqual({
      type: 'relationship',
      npcId: 'mika',
      dimension: 'affection',
      change: 2,
    });

    const malformed = normalizeCanonicalConsequence({
      type: 'relationship',
      npcId: 'mika',
      flag: 'mika_trust_up',
      value: true,
    });
    expect(malformed.consequence).toBeUndefined();
    expect(malformed.reason).toContain('npcId, dimension, and numeric change');
  });

  it('canonicalizes resolvable NPC ids and rejects unknown targets', () => {
    const resolveNpcId = (raw: string) => raw === 'Mika' ? 'char-mihaela-mika-drgan' : undefined;
    expect(normalizeCanonicalConsequence({
      type: 'relationship',
      npcId: 'Mika',
      dimension: 'trust',
      change: 4,
    }, { resolveNpcId, rejectUnresolvedNpcIds: true }).consequence).toEqual({
      type: 'relationship',
      npcId: 'char-mihaela-mika-drgan',
      dimension: 'trust',
      change: 4,
    });
    expect(normalizeCanonicalConsequence({
      type: 'relationship',
      npcId: 'Unknown',
      dimension: 'trust',
      change: 4,
    }, { resolveNpcId, rejectUnresolvedNpcIds: true }).consequence).toBeUndefined();
  });

  it('makes canonical relationship movement and evidence visible to the ledger', () => {
    const story = {
      npcs: [{
        id: 'char-mihaela-mika-drgan',
        name: 'Mihaela Mika Dragan',
        initialRelationship: {
          npcId: 'char-mihaela-mika-drgan',
          trust: 0,
          affection: 0,
          respect: 0,
          fear: 0,
        },
      }],
      episodes: [{
        number: 1,
        scenes: [{
          id: 's1',
          name: 'Mika at the table',
          beats: [{
            id: 'b1',
            text: 'Mika waits for an answer.',
            choices: [{
              id: 'c1',
              text: 'Tell Mika the truth',
              consequences: [{
                type: 'relationship',
                npcId: 'char-mihaela-mika-drgan',
                dimension: 'trust',
                change: 4,
              }],
              relationshipValueEvidence: [{
                npcId: 'char-mihaela-mika-drgan',
                axis: 'trust',
                evidenceTags: ['respected_agency'],
                reason: 'Alex lets Mika choose what happens next.',
              }],
            }],
          }],
        }],
      }],
    } as unknown as Story;

    const entry = buildRelationshipArcLedger(story).byKey.get('npc:char-mihaela-mika-drgan');
    expect(entry?.deltasByDimension.trust.positive).toBe(4);
    expect(entry?.evidenceTags).toContain('respected_agency');
    expect(entry?.relationshipChoiceSceneIds).toEqual(['s1']);
  });
});
