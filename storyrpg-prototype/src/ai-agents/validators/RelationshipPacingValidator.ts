import type { Beat, Choice, ConditionExpression, Consequence, Scene, Story } from '../../types';
import type { PlannedScene, RelationshipPacingContract, RelationshipPacingStage, SeasonScenePlan } from '../../types/scenePlan';
import { BaseValidator, ValidationIssue, ValidationResult } from './BaseValidator';

export interface RelationshipPacingInput {
  story: Story;
  scenePlan?: SeasonScenePlan;
  treatmentSourced?: boolean;
}

interface SceneRef {
  planned?: PlannedScene;
  episodeNumber: number;
  scene: Scene;
}

const STAGE_RANK: Record<RelationshipPacingStage, number> = {
  unmet: 0,
  noticed: 1,
  spark: 2,
  acquaintance: 3,
  tentative_ally: 4,
  friend: 5,
  trusted_ally: 6,
  intimate: 7,
};

const PROVISIONAL_RE = /\b(joke|jokes|teas\w*|dare|invites?|invitation|maybe|almost|not yet|for now|for tonight|provisional|fragile|beginning|test\w*|tries?|offers?|asks?|names? it|calls? it)\b/i;
const SETTLED_GROUP_RE = /\b(?:dusk club|club|crew|circle|group)\s+(?:is|are|becomes?|became)\s+(?:now\s+)?(?:three|complete|family|official|real|theirs?)\b|\b(?:one of us|inside the circle|inner circle|permanent member)\b/i;
const NEGATED_WINDOW_RE = /\b(?:not|not yet|no|never|almost|maybe|trying to become|could become|might become)\s+(?:a\s+)?$/i;

function plannedById(scenePlan?: SeasonScenePlan): Map<string, PlannedScene> {
  const out = new Map<string, PlannedScene>();
  for (const scene of scenePlan?.scenes ?? []) out.set(scene.id, scene);
  return out;
}

function collectScenes(input: RelationshipPacingInput): SceneRef[] {
  const planned = plannedById(input.scenePlan);
  const refs: SceneRef[] = [];
  for (const episode of input.story.episodes ?? []) {
    for (const scene of episode.scenes ?? []) {
      refs.push({ episodeNumber: episode.number, scene, planned: planned.get(scene.id) });
    }
  }
  return refs.sort((a, b) => (a.episodeNumber - b.episodeNumber) || ((a.planned?.order ?? 0) - (b.planned?.order ?? 0)));
}

function choiceText(choice: Choice): string {
  const anyChoice = choice as Choice & {
    outcomeTexts?: Record<string, unknown>;
    reactionText?: string;
    designNotes?: string;
  };
  return [
    choice.text,
    choice.lockedText,
    choice.feedbackCue?.echoSummary,
    choice.feedbackCue?.progressSummary,
    choice.reminderPlan?.immediate,
    choice.reminderPlan?.shortTerm,
    ...(choice.residueHints ?? []).map((hint) => hint.description),
    ...(choice.witnessReactions ?? []).map((reaction) => `${reaction.reactionText} ${reaction.residueHint ?? ''}`),
    anyChoice.reactionText,
    anyChoice.designNotes,
    ...Object.values(anyChoice.outcomeTexts ?? {}).map((value) => typeof value === 'string' ? value : ''),
  ].filter(Boolean).join(' ');
}

function beatText(beat: Beat): string {
  return [
    beat.text,
    beat.visualMoment,
    beat.primaryAction,
    beat.emotionalRead,
    beat.relationshipDynamic,
    beat.dramaticIntent?.statusBefore,
    beat.dramaticIntent?.visibleTurn,
    beat.dramaticIntent?.statusAfter,
    beat.sequenceIntent?.startState,
    beat.sequenceIntent?.turningPoint,
    beat.sequenceIntent?.endState,
    ...(beat.textVariants ?? []).map((variant) => variant.text),
    ...((beat.choices ?? []) as Choice[]).map(choiceText),
  ].filter(Boolean).join(' ');
}

function sceneText(scene: Scene): string {
  return [scene.name, ...(scene.beats ?? []).map(beatText)].filter(Boolean).join(' ');
}

function contractKey(contract: RelationshipPacingContract): string | undefined {
  return contract.npcId ? `npc:${contract.npcId}` : contract.groupId ? `group:${contract.groupId}` : undefined;
}

function locationFor(ref: SceneRef, contract: RelationshipPacingContract): string {
  return `relationshipPacing:ep${ref.episodeNumber}:${ref.scene.id}:${contract.id}`;
}

function isNegated(text: string, index: number): boolean {
  const prefix = text.slice(Math.max(0, index - 40), index).toLowerCase();
  return NEGATED_WINDOW_RE.test(prefix);
}

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function blockedLabelHits(text: string, contract: RelationshipPacingContract): string[] {
  const hits: string[] = [];
  for (const label of contract.blockedLabels ?? []) {
    if (!label || label.length < 3) continue;
    const re = new RegExp(`\\b${escaped(label)}\\b`, 'ig');
    for (const match of text.matchAll(re)) {
      if (!isNegated(text, match.index ?? 0)) hits.push(label);
    }
  }
  if (contract.groupId && SETTLED_GROUP_RE.test(text) && !PROVISIONAL_RE.test(text)) {
    hits.push('settled group membership');
  }
  return Array.from(new Set(hits));
}

function relationshipConsequences(scene: Scene): Consequence[] {
  const out: Consequence[] = [];
  for (const beat of scene.beats ?? []) {
    out.push(...(beat.onShow ?? []));
    for (const choice of (beat.choices ?? []) as Choice[]) {
      out.push(...(choice.consequences ?? []));
    }
  }
  return out;
}

function relationshipConditions(scene: Scene): Array<{ choiceId?: string; condition: ConditionExpression }> {
  const out: Array<{ choiceId?: string; condition: ConditionExpression }> = [];
  const collect = (condition: ConditionExpression | undefined, choiceId?: string): void => {
    if (!condition) return;
    out.push({ choiceId, condition });
  };
  for (const beat of scene.beats ?? []) {
    for (const choice of (beat.choices ?? []) as Choice[]) collect(choice.conditions, choice.id);
  }
  return out;
}

function walkRelationshipConditions(condition: ConditionExpression, visit: (condition: any) => void): void {
  const raw = condition as any;
  if (!raw || typeof raw !== 'object') return;
  if (raw.type === 'relationship' || (raw.npcId && raw.dimension && raw.operator)) visit(raw);
  for (const child of raw.conditions ?? []) walkRelationshipConditions(child, visit);
  if (raw.condition) walkRelationshipConditions(raw.condition, visit);
}

export class RelationshipPacingValidator extends BaseValidator {
  constructor() {
    super('RelationshipPacingValidator');
  }

  validate(input: RelationshipPacingInput): ValidationResult {
    const issues: ValidationIssue[] = [];
    const seenScenes = new Map<string, number>();
    const accumulated = new Map<string, number>();

    for (const npc of input.story.npcs ?? []) {
      const initial = (npc as { initialRelationship?: Partial<Record<'trust' | 'affection' | 'respect' | 'fear', number>> }).initialRelationship;
      for (const dim of ['trust', 'affection', 'respect', 'fear'] as const) {
        const value = Number(initial?.[dim] ?? 0);
        if (value <= 0) continue;
        accumulated.set(`npc:${npc.id}:${dim}`, value);
        accumulated.set(`npc:${npc.id}`, (accumulated.get(`npc:${npc.id}`) ?? 0) + value);
      }
    }

    for (const ref of collectScenes(input)) {
      const contracts = ref.scene.relationshipPacing ?? ref.planned?.relationshipPacing ?? [];
      const text = sceneText(ref.scene);
      const consequences = relationshipConsequences(ref.scene);

      for (const contract of contracts) {
        const key = contractKey(contract);
        const loc = locationFor(ref, contract);
        const priorScenes = key ? (seenScenes.get(key) ?? 0) : 0;
        const priorPositive = key ? (accumulated.get(key) ?? 0) : 0;
        const highTarget = STAGE_RANK[contract.targetStage] >= STAGE_RANK.friend;
        const treatmentBlocking = input.treatmentSourced || contract.source === 'treatment';

        const blocked = blockedLabelHits(text, contract);
        if (blocked.length > 0) {
          issues.push({
            severity: treatmentBlocking || highTarget ? 'error' : 'warning',
            location: loc,
            message: `Scene "${ref.scene.id}" uses unearned relationship label(s): ${blocked.join(', ')}.`,
            suggestion: `Rewrite as ${contract.allowedLabels.join(', ') || contract.targetStage} unless prior scenes and relationship consequences have earned the stronger label.`,
          });
        }

        if (highTarget && priorScenes < Math.max(1, contract.minScenesSinceIntroduction)) {
          issues.push({
            severity: treatmentBlocking ? 'error' : 'warning',
            location: loc,
            message: `Scene "${ref.scene.id}" targets ${contract.targetStage} before enough on-page relationship history exists.`,
            suggestion: 'Add earlier relationship turns, or lower this scene to spark/acquaintance/tentative_ally.',
          });
        }

        for (const consequence of consequences) {
          if (consequence.type !== 'relationship') continue;
          if (contract.npcId && consequence.npcId !== contract.npcId) continue;
          if (typeof consequence.change !== 'number') continue;
          const max = Math.abs(contract.maxDeltaThisScene);
          if (max > 0 && Math.abs(consequence.change) > max) {
            issues.push({
              severity: 'error',
              location: loc,
              message: `Relationship consequence for ${consequence.npcId}.${consequence.dimension} changes by ${consequence.change}, above this scene's pacing cap of ${max}.`,
              suggestion: 'Reduce the delta or add a major visible sacrifice, rescue, secret, or prior relationship scene that earns a larger shift.',
            });
          }
        }

        if (highTarget && priorPositive < 12 && !/\b(rescue|saved|sacrifice|secret|confess|risked|protected|bled|wounded)\b/i.test(text)) {
          issues.push({
            severity: treatmentBlocking ? 'error' : 'warning',
            location: loc,
            message: `Scene "${ref.scene.id}" claims a high relationship stage without enough visible evidence or accumulated relationship movement.`,
            suggestion: 'Show concrete reciprocity, vulnerability, protection, remembered detail, or challenge before naming the bond.',
          });
        }
      }

      for (const { choiceId, condition } of relationshipConditions(ref.scene)) {
        walkRelationshipConditions(condition, (raw) => {
          const key = raw.npcId && raw.dimension ? `npc:${raw.npcId}:${raw.dimension}` : undefined;
          if (!key || typeof raw.value !== 'number') return;
          const available = accumulated.get(key) ?? 0;
          if ((raw.operator === '>' || raw.operator === '>=') && available < raw.value) {
            issues.push({
              severity: 'error',
              location: `relationshipPacing:ep${ref.episodeNumber}:${ref.scene.id}:${choiceId ?? 'condition'}`,
              message: `Relationship-gated choice requires ${raw.npcId}.${raw.dimension} ${raw.operator} ${raw.value}, but prior authored relationship gains only reach ${available}.`,
              suggestion: 'Lower the gate, add prior relationship consequences, or move the gated option later.',
            });
          }
        });
      }

      const contractedKeys = new Set<string>();
      for (const contract of contracts) {
        const key = contractKey(contract);
        if (key) contractedKeys.add(key);
        if (key) seenScenes.set(key, (seenScenes.get(key) ?? 0) + 1);
      }
      const consequenceNpcIds = new Set<string>();
      for (const consequence of consequences) {
        if (consequence.type !== 'relationship' || typeof consequence.change !== 'number') continue;
        consequenceNpcIds.add(consequence.npcId);
        const key = `npc:${consequence.npcId}:${consequence.dimension}`;
        if (consequence.change > 0) accumulated.set(key, (accumulated.get(key) ?? 0) + consequence.change);
        const broadKey = `npc:${consequence.npcId}`;
        if (consequence.change > 0) accumulated.set(broadKey, (accumulated.get(broadKey) ?? 0) + consequence.change);
      }
      for (const npcId of consequenceNpcIds) {
        const key = `npc:${npcId}`;
        if (!contractedKeys.has(key)) seenScenes.set(key, (seenScenes.get(key) ?? 0) + 1);
      }
    }

    return {
      valid: !issues.some((issue) => issue.severity === 'error'),
      score: issues.length === 0 ? 100 : Math.max(0, 100 - issues.length * 15),
      issues,
      suggestions: issues.map((issue) => issue.suggestion).filter((value): value is string => Boolean(value)),
    };
  }
}
