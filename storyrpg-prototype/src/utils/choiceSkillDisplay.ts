import type { PlayerAttributes, PlayerState } from '../types';
import { ATTRIBUTE_TO_SKILL } from '../constants/pipeline';
import { computeEffectiveStat } from '../engine/resolutionEngine';

export type ChoiceSkillIconName =
  | 'activity'
  | 'brain'
  | 'clover'
  | 'compass'
  | 'drama'
  | 'eye'
  | 'flame'
  | 'footprints'
  | 'hand-heart'
  | 'handshake'
  | 'heart'
  | 'lightbulb'
  | 'message-circle'
  | 'move'
  | 'pickaxe'
  | 'scan-eye'
  | 'search'
  | 'shield'
  | 'sparkles'
  | 'target'
  | 'telescope'
  | 'user-check'
  | 'users'
  | 'venetian-mask'
  | 'zap';

export const FALLBACK_SKILL_ICON_NAME: ChoiceSkillIconName = 'activity';

const SKILL_ICON_NAMES: Record<string, ChoiceSkillIconName> = {
  athletics: 'footprints',
  awareness: 'eye',
  charm: 'heart',
  courage: 'shield',
  deception: 'venetian-mask',
  empathy: 'hand-heart',
  improvisation: 'zap',
  insight: 'scan-eye',
  intimidation: 'flame',
  intuition: 'sparkles',
  investigation: 'search',
  manipulation: 'drama',
  perception: 'eye',
  persuasion: 'message-circle',
  presence: 'user-check',
  resolve: 'shield',
  resourcefulness: 'pickaxe',
  self_control: 'target',
  social: 'users',
  stealth: 'footprints',
  subtlety: 'move',
  trust: 'handshake',
  wisdom: 'brain',
};

interface StatCheckForDisplay {
  skillWeights?: Record<string, number>;
  attribute?: keyof PlayerAttributes | string;
  skill?: string;
}

interface ConsequenceForDisplay {
  type?: string;
  skill?: string;
  dimension?: string;
  relationshipType?: string;
  aspect?: string;
  score?: string;
  flag?: string;
  tag?: string;
  value?: unknown;
}

interface ChoiceForSkillDisplay {
  text?: string;
  choiceType?: string;
  primarySkill?: string;
  statCheck?: StatCheckForDisplay;
  impactFactors?: string[];
  consequences?: ConsequenceForDisplay[];
}

export interface ChoiceSkillDisplay {
  skillKey?: string;
  skillLabel?: string;
  iconName: ChoiceSkillIconName;
  effectiveSkillValue?: number;
  skillBonusValue?: number;
}

export interface ChoiceSkillDisplayInput {
  skillKey?: string;
  player?: PlayerState;
  bonus?: number;
}

export interface ChoiceSkillReadoutState {
  isLocked?: boolean;
  primarySkillKey?: string;
  effectiveSkillValue?: number;
}

export function normalizeSkillKey(raw?: string | null): string | undefined {
  const normalized = raw?.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return normalized || undefined;
}

export function formatSkillLabel(raw?: string | null): string | undefined {
  const normalized = normalizeSkillKey(raw);
  if (!normalized) return undefined;
  return normalized.replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
}

export function getSkillIconName(raw?: string | null): ChoiceSkillIconName {
  const skillKey = normalizeSkillKey(raw);
  return skillKey ? SKILL_ICON_NAMES[skillKey] ?? FALLBACK_SKILL_ICON_NAME : FALLBACK_SKILL_ICON_NAME;
}

export function getDominantSkillKey(skillWeights?: Record<string, number>): string | undefined {
  if (!skillWeights) return undefined;

  let bestSkill: string | undefined;
  let bestWeight = -Infinity;
  for (const [skill, weight] of Object.entries(skillWeights)) {
    if (!Number.isFinite(weight) || weight <= 0) continue;
    if (weight > bestWeight) {
      bestSkill = skill;
      bestWeight = weight;
    }
  }

  return normalizeSkillKey(bestSkill);
}

export function getSkillKeyFromStatCheck(statCheck?: StatCheckForDisplay): string | undefined {
  if (!statCheck) return undefined;

  const weightedSkill = getDominantSkillKey(statCheck.skillWeights);
  if (weightedSkill) return weightedSkill;

  const directSkill = normalizeSkillKey(statCheck.skill);
  if (directSkill) return directSkill;

  const attribute = statCheck.attribute;
  if (!attribute) return undefined;

  const mappedSkill = ATTRIBUTE_TO_SKILL[attribute as keyof PlayerAttributes];
  return normalizeSkillKey(mappedSkill ?? String(attribute));
}

function hasToken(value: string, tokens: string[]): boolean {
  return tokens.some(token => value.includes(token));
}

function getSkillKeyFromConsequence(consequence: ConsequenceForDisplay): string | undefined {
  if (consequence.type === 'skill') {
    return normalizeSkillKey(consequence.skill);
  }

  if (consequence.type === 'relationship') {
    const relationshipDimension = normalizeSkillKey(
      consequence.dimension ?? consequence.relationshipType ?? consequence.aspect
    );
    if (relationshipDimension === 'respect') return 'resolve';
    if (relationshipDimension === 'fear') return 'intimidation';
    return 'empathy';
  }

  if (consequence.type === 'addTag') {
    const tag = normalizeSkillKey(consequence.tag);
    if (tag && hasToken(tag, ['supernatural', 'mystical', 'quartz', 'intuition'])) return 'intuition';
    if (tag && hasToken(tag, ['self_reliant', 'independent'])) return 'resolve';
  }

  if (consequence.type === 'changeScore') {
    const score = normalizeSkillKey(consequence.score);
    if (score && hasToken(score, ['awareness', 'supernatural', 'clue'])) return 'insight';
    if (score && hasToken(score, ['trust', 'affection'])) return 'empathy';
  }

  return undefined;
}

function inferSkillKeyFromChoiceText(choice: ChoiceForSkillDisplay): string | undefined {
  const text = normalizeSkillKey(choice.text) ?? '';
  const consequenceText = (choice.consequences ?? [])
    .map(consequence => [
      consequence.flag,
      consequence.tag,
      consequence.score,
      consequence.value,
    ].filter(Boolean).join('_'))
    .join('_')
    .toLowerCase();
  const searchable = `${text}_${consequenceText}`;

  if (hasToken(searchable, ['blog', 'write', 'wit', 'humor', 'question', 'probe'])) return 'insight';
  if (hasToken(searchable, ['romantic', 'kiss', 'flirt', 'charm'])) return 'charm';
  if (hasToken(searchable, ['mystic', 'supernatural', 'quartz', 'herb', 'intuition', 'secret'])) return 'intuition';
  if (hasToken(searchable, ['memory', 'honor', 'past', 'grandmother', 'wisdom'])) return 'wisdom';
  if (hasToken(searchable, ['future', 'firm', 'decline', 'self', 'handle', 'earn', 'claim'])) return 'resolve';
  if (hasToken(searchable, ['accept', 'gratitude', 'grateful', 'trust', 'kind', 'help'])) return 'empathy';
  if (hasToken(searchable, ['danger', 'mysterious', 'stranger', 'wolf'])) return 'intuition';

  return undefined;
}

export function getSkillKeyFromChoice(choice: ChoiceForSkillDisplay): string | undefined {
  const directSkill = normalizeSkillKey(choice.primarySkill);
  if (directSkill) return directSkill;

  const statCheckSkill = getSkillKeyFromStatCheck(choice.statCheck);
  if (statCheckSkill) return statCheckSkill;

  for (const consequence of choice.consequences ?? []) {
    const consequenceSkill = getSkillKeyFromConsequence(consequence);
    if (consequenceSkill) return consequenceSkill;
  }

  const impactFactors = (choice.impactFactors ?? []).map(factor => normalizeSkillKey(factor)).filter(Boolean);
  if (impactFactors.includes('relationship')) return 'empathy';
  if (impactFactors.includes('information')) return 'investigation';
  if (impactFactors.includes('identity')) return 'resolve';

  const choiceType = normalizeSkillKey(choice.choiceType);
  if (choiceType === 'relationship') return 'empathy';
  if (choiceType === 'strategic') return 'investigation';
  if (choiceType === 'dilemma') return 'resolve';

  return inferSkillKeyFromChoiceText(choice) ?? 'resolve';
}

export function resolveChoiceSkillDisplay({
  skillKey,
  player,
  bonus,
}: ChoiceSkillDisplayInput): ChoiceSkillDisplay {
  const normalizedSkillKey = normalizeSkillKey(skillKey);
  const roundedBonus = Math.max(0, Math.round(bonus ?? 0));

  return {
    skillKey: normalizedSkillKey,
    skillLabel: formatSkillLabel(normalizedSkillKey),
    iconName: getSkillIconName(normalizedSkillKey),
    effectiveSkillValue: normalizedSkillKey && player
      ? Math.round(computeEffectiveStat(player, normalizedSkillKey))
      : undefined,
    skillBonusValue: roundedBonus > 0 ? roundedBonus : undefined,
  };
}

export function shouldShowChoiceSkillReadout(choice: ChoiceSkillReadoutState): boolean {
  return !choice.isLocked
    && !!choice.primarySkillKey;
}
