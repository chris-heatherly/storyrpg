import type { Choice, Relationship, Story } from '../../types';
import type { McKeeValueRung, RelationshipEvidenceTag, RelationshipSurface } from '../../types/relationshipValue';
import type { SeasonScenePlan } from '../../types/scenePlan';
import {
  classifyRelationshipValueState,
  enforceRelationshipTransition,
  getSurfacesForRung,
  relationshipValueKey,
} from '../../engine/relationshipValueLadder';
import {
  collectRelationshipScenes,
  relationshipConsequencesForScene,
  sceneVisibleText,
} from '../utils/relationshipArcLedger';
import { BaseValidator, type ValidationIssue, type ValidationResult } from './BaseValidator';

export interface ThematicSquareTurnInput {
  story: Story;
  scenePlan?: SeasonScenePlan;
  treatmentSourced?: boolean;
}

const SURFACE_RUNG: Record<RelationshipSurface, McKeeValueRung> = {
  confession: 'positive',
  mutual_aid: 'positive',
  sacrifice: 'positive',
  forgiveness: 'positive',
  agency_respecting_protection: 'positive',
  absence: 'contrary',
  cold_greeting: 'contrary',
  withheld_help: 'contrary',
  missed_callback: 'contrary',
  confrontation: 'contradiction',
  sabotage: 'contradiction',
  route_block: 'contradiction',
  public_accusation: 'contradiction',
  aid_with_cost: 'negationOfNegation',
  protective_control: 'negationOfNegation',
  agency_removal: 'negationOfNegation',
  guilt_callback: 'negationOfNegation',
  conditional_help: 'negationOfNegation',
};

const RUNG_EVIDENCE: Record<McKeeValueRung, Set<RelationshipEvidenceTag>> = {
  positive: new Set(['respected_agency', 'sacrificed_without_control', 'repaired_harm', 'protected_player']),
  contrary: new Set(['withheld_care', 'ignored_need']),
  contradiction: new Set(['sabotaged_player', 'publicly_attacked', 'retaliated']),
  negationOfNegation: new Set(['overrode_player_choice', 'aid_with_strings', 'used_guilt_as_leverage', 'protective_control']),
};

const SETUP_ONLY_RE = /\b(?:first impression|introduction|introduce|setup|plants?|notices?|glimpse|meets?|arrives?)\b/i;

function relationshipFromNpc(npc: Story['npcs'][number]): Relationship {
  return {
    npcId: npc.id,
    trust: Number(npc.initialRelationship?.trust ?? 0),
    affection: Number(npc.initialRelationship?.affection ?? 0),
    respect: Number(npc.initialRelationship?.respect ?? 0),
    fear: Number(npc.initialRelationship?.fear ?? 0),
  };
}

function relationshipFor(state: Map<string, Relationship>, npcId: string): Relationship {
  return state.get(npcId) ?? { npcId, trust: 0, affection: 0, respect: 0, fear: 0 };
}

function applyRelationshipChoiceDeltas(base: Relationship, choice: Choice): Relationship {
  let next = { ...base };
  for (const consequence of choice.consequences ?? []) {
    if (consequence.type !== 'relationship' || consequence.npcId !== base.npcId) continue;
    const dim = consequence.dimension;
    next = { ...next, [dim]: Number(next[dim] ?? 0) + Number(consequence.change ?? 0) };
  }
  return next;
}

function hasRequiredEvidence(tags: RelationshipEvidenceTag[], rung: McKeeValueRung): boolean {
  const required = RUNG_EVIDENCE[rung];
  return tags.some((tag) => required.has(tag));
}

function sceneHasRelationshipChoice(scene: Story['episodes'][number]['scenes'][number]): boolean {
  return (scene.beats ?? []).some((beat) => (beat.choices ?? []).some((choice) =>
    choice.choiceType === 'relationship'
    || (choice.consequences ?? []).some((consequence) => consequence.type === 'relationship')
    || (choice.relationshipValueEvidence ?? []).length > 0
  ));
}

export class ThematicSquareTurnValidator extends BaseValidator {
  constructor() {
    super('ThematicSquareTurnValidator');
  }

  validate(input: ThematicSquareTurnInput): ValidationResult {
    const issues: ValidationIssue[] = [];
    const relationships = new Map<string, Relationship>();
    const valueStates = new Map<string, ReturnType<typeof classifyRelationshipValueState>>();
    for (const npc of input.story.npcs ?? []) {
      relationships.set(npc.id, relationshipFromNpc(npc));
    }

    for (const ref of collectRelationshipScenes(input.story, input.scenePlan)) {
      const text = sceneVisibleText(ref.scene);
      const relationshipScene = sceneHasRelationshipChoice(ref.scene)
        || (ref.scene.relationshipPacing ?? ref.planned?.relationshipPacing ?? []).length > 0;
      if (relationshipScene && !sceneHasRelationshipChoice(ref.scene) && !SETUP_ONLY_RE.test(text)) {
        issues.push(this.warning(
          `Scene "${ref.scene.id}" carries relationship pressure but no relationship choice or explicit setup posture.`,
          `thematicSquare:ep${ref.episodeNumber}:${ref.scene.id}`,
          'Either make this a deliberate setup/first-impression scene or add a relationship choice that turns the value.',
        ));
      }

      for (const beat of ref.scene.beats ?? []) {
        for (const choice of beat.choices ?? []) {
          for (const evidence of choice.relationshipValueEvidence ?? []) {
            const intended = evidence.intendedSurface;
            const expectedRung = intended ? SURFACE_RUNG[intended] : undefined;
            const before = valueStates.get(relationshipValueKey(evidence.npcId, evidence.axis));
            const relationshipAfter = applyRelationshipChoiceDeltas(relationshipFor(relationships, evidence.npcId), choice);
            const proposed = classifyRelationshipValueState({
              npcId: evidence.npcId,
              axis: evidence.axis,
              relationship: relationshipAfter,
              previousState: before,
              evidenceTags: evidence.evidenceTags,
              lastUpdatedEpisode: ref.episodeNumber,
              lastUpdatedSceneId: ref.scene.id,
            });
            const transition = enforceRelationshipTransition(before, proposed);
            const allowed = new Set(transition.state.allowedSurfaces ?? getSurfacesForRung(transition.state.rung));

            if (intended && expectedRung && !hasRequiredEvidence(evidence.evidenceTags, expectedRung)) {
              issues.push(this.error(
                `Choice "${choice.id}" claims thematic-square surface "${intended}" without the required ${expectedRung} evidence tags.`,
                `thematicSquare:ep${ref.episodeNumber}:${ref.scene.id}:${beat.id}:${choice.id}:${evidence.npcId}`,
                'Use evidence tags that match the intended McKee-square movement, or change the intended surface.',
              ));
            }

            if (intended && !allowed.has(intended)) {
              issues.push(this.error(
                `Choice "${choice.id}" claims surface "${intended}", but the deterministic thematic-square rung is "${transition.state.rung}" and only allows ${transition.state.allowedSurfaces.join(', ')}.`,
                `thematicSquare:ep${ref.episodeNumber}:${ref.scene.id}:${beat.id}:${choice.id}:${evidence.npcId}`,
                'Adjust relationship stats/evidence to earn that surface, or choose a surface allowed by the computed rung.',
              ));
            }

            if (transition.blockedTransition) {
              issues.push(this.error(
                `Choice "${choice.id}" attempts blocked thematic-square transition ${transition.blockedTransition.from} -> ${transition.blockedTransition.to}: ${transition.blockedTransition.reason}`,
                `thematicSquare:ep${ref.episodeNumber}:${ref.scene.id}:${beat.id}:${choice.id}:${evidence.npcId}:transition`,
                'Route through an intermediate rung or add the required betrayal, control/coercion, or repair evidence.',
              ));
            }

            valueStates.set(relationshipValueKey(evidence.npcId, evidence.axis), transition.state);
          }
        }
      }

      for (const { consequence } of relationshipConsequencesForScene(ref.scene)) {
        if (consequence.type !== 'relationship') continue;
        const current = relationshipFor(relationships, consequence.npcId);
        relationships.set(consequence.npcId, {
          ...current,
          [consequence.dimension]: Number(current[consequence.dimension] ?? 0) + Number(consequence.change ?? 0),
        });
      }
    }

    const errors = issues.filter((issue) => issue.severity === 'error').length;
    const warnings = issues.filter((issue) => issue.severity === 'warning').length;
    return {
      valid: errors === 0,
      score: issues.length === 0 ? 100 : Math.max(0, 100 - errors * 18 - warnings * 4),
      issues,
      suggestions: issues.map((issue) => issue.suggestion).filter((value): value is string => Boolean(value)),
    };
  }
}
