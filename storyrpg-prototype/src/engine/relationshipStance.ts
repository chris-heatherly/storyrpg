import type { Relationship } from '../types/player';

export type RelationshipStance =
  | 'loyal_conspirator'
  | 'affectionate_skeptic'
  | 'guarded_ally'
  | 'respectful_rival'
  | 'hostile_admirer'
  | 'frightened_dependent'
  | 'wary_opponent'
  | 'neutral_acquaintance';

export interface RelationshipStanceProfile {
  stance: RelationshipStance;
  dialogueTone: string;
  visualBlocking: string;
  encounterBehavior: string;
  callbackPosture: string;
}

export function deriveRelationshipStance(relationship?: Partial<Relationship>): RelationshipStanceProfile {
  const trust = relationship?.trust ?? 0;
  const affection = relationship?.affection ?? 0;
  const respect = relationship?.respect ?? 0;
  const fear = relationship?.fear ?? 0;

  if (trust >= 45 && affection >= 25 && respect >= 20 && fear < 35) {
    return stanceProfile(
      'loyal_conspirator',
      'warm, quick, and privately candid',
      'stands close, shares the same focus, leans into whispered plans',
      'offers help early and takes risks to preserve the plan',
      'remembers prior kindness as shared history',
    );
  }

  if (affection >= 35 && trust >= 10 && respect < 25) {
    return stanceProfile(
      'affectionate_skeptic',
      'fond but questioning, teasing when worried',
      'keeps near the protagonist but angles their body away during doubt',
      'helps with emotional support while challenging weak plans',
      'callbacks carry warmth with a barb of concern',
    );
  }

  if (trust >= 25 && fear >= 25) {
    return stanceProfile(
      'guarded_ally',
      'careful, measured, loyal with reservations',
      'maintains a small pocket of distance, watches exits and hands',
      'helps if the ask is specific, resists reckless escalation',
      'callbacks acknowledge debt without full surrender',
    );
  }

  if (respect >= 35 && trust < 20 && fear < 45) {
    return stanceProfile(
      'respectful_rival',
      'formal, sharp, and competitive',
      'faces the protagonist directly, equal height and opposing lines',
      'assists only when competence is proven or goals align',
      'callbacks frame past choices as evidence in an ongoing contest',
    );
  }

  if (respect >= 30 && trust < -15) {
    return stanceProfile(
      'hostile_admirer',
      'cutting, controlled, grudgingly impressed',
      'keeps distance but tracks the protagonist as the center of threat',
      'blocks easy paths while leaving room for earned bargains',
      'callbacks weaponize admiration as pressure',
    );
  }

  if (fear >= 55 && trust >= 15) {
    return stanceProfile(
      'frightened_dependent',
      'deferential, urgent, and brittle',
      'hovers behind or beside the protagonist, smaller in the frame',
      'follows directions but may panic under cost',
      'callbacks emphasize safety, rescue, and dependence',
    );
  }

  if (trust <= -25 || fear >= 65) {
    return stanceProfile(
      'wary_opponent',
      'guarded, clipped, and suspicious',
      'uses barriers, shadows, or other people to keep separation',
      'withholds help and looks for leverage or escape',
      'callbacks reopen old injuries before new trust can form',
    );
  }

  return stanceProfile(
    'neutral_acquaintance',
    'situational and observant',
    'shares the frame without strong proximity or opposition',
    'responds to immediate incentives more than history',
    'callbacks stay factual rather than intimate',
  );
}

function stanceProfile(
  stance: RelationshipStance,
  dialogueTone: string,
  visualBlocking: string,
  encounterBehavior: string,
  callbackPosture: string,
): RelationshipStanceProfile {
  return {
    stance,
    dialogueTone,
    visualBlocking,
    encounterBehavior,
    callbackPosture,
  };
}
