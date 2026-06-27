import type { AppliedConsequence } from '../types';

const CHOICE_CHANGE_FEEDBACK_TYPES = new Set<AppliedConsequence['type']>([
  'relationship',
  'identity',
  'skill',
  'attribute',
]);

function normalizeFeedbackSentence(text?: string | null): string | undefined {
  const normalized = text?.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
}

function trimTerminalPunctuation(text: string): string {
  return text.replace(/[.!?]\s*$/, '');
}

function lowercaseFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function isNeutralRelationshipFeedback(item: AppliedConsequence): boolean {
  if (item.type !== 'relationship') return false;
  const hint = item.narrativeHint || item.label;
  return /\b(neither|uncertain|indifferent|not at all afraid|cautious around)\b/i.test(hint);
}

export function getFictionFirstChangeFeedback(applied: AppliedConsequence[]): AppliedConsequence[] {
  return applied.filter((item) => CHOICE_CHANGE_FEEDBACK_TYPES.has(item.type));
}

function identityRecognitionLine(item: AppliedConsequence): string | undefined {
  const label = item.label.toLowerCase();
  if (label.includes('merciful')) return 'Mercy comes easier after what you chose.';
  if (label.includes('just')) return 'A sharper sense of justice settles into you.';
  if (label.includes('idealistic')) return 'Your hope holds its ground.';
  if (label.includes('pragmatic')) return 'You feel more willing to choose what works.';
  if (label.includes('cautious')) return 'Caution lingers at the edge of your next breath.';
  if (label.includes('bold')) return 'A bolder part of you steps forward.';
  if (label.includes('independent')) return 'You feel more prepared to stand on your own.';
  if (label.includes('leader')) return 'The part of you others follow grows clearer.';
  if (label.includes('heart')) return 'Your heart keeps its hand on the wheel.';
  if (label.includes('reason')) return 'Reason settles over the choice like a steadying hand.';
  if (label.includes('honest')) return 'The truth feels easier to carry.';
  if (label.includes('deceptive')) return 'A practiced mask settles more easily into place.';
  return normalizeFeedbackSentence(item.narrativeHint?.split('—')[1] || item.narrativeHint);
}

function skillRecognitionLine(item: AppliedConsequence): string | undefined {
  const source = `${item.label} ${item.narrativeHint ?? ''}`.toLowerCase();
  if (source.includes('persuasion') || source.includes('charm') || source.includes('deception')) {
    return item.direction === 'down'
      ? 'Your next words come less easily.'
      : 'Your next words come a little steadier.';
  }
  if (source.includes('investigation') || source.includes('perception') || source.includes('insight')) {
    return item.direction === 'down'
      ? 'The next clue feels harder to hold.'
      : 'The next clue feels easier to hold.';
  }
  if (source.includes('stealth') || source.includes('sleight')) {
    return item.direction === 'down'
      ? 'Silence feels harder to keep.'
      : 'Silence comes a little more naturally.';
  }
  if (source.includes('combat') || source.includes('athletics') || source.includes('acrobatics')) {
    return item.direction === 'down'
      ? 'Your body remembers the cost.'
      : 'Your body answers a little faster.';
  }
  if (source.includes('survival') || source.includes('medicine')) {
    return item.direction === 'down'
      ? 'The world feels harder to read.'
      : 'The world gives up a little more of its pattern.';
  }
  return item.direction === 'down'
    ? 'The mistake stays with you.'
    : 'The lesson settles in before the moment passes.';
}

export function buildChoiceRecognitionLine(feedback: AppliedConsequence[]): string | undefined {
  const relationship = feedback.find((item) => item.type === 'relationship' && !isNeutralRelationshipFeedback(item));
  if (relationship) return normalizeFeedbackSentence(relationship.narrativeHint);

  const identity = feedback.find((item) => item.type === 'identity');
  if (identity) return identityRecognitionLine(identity);

  const attribute = feedback.find((item) => item.type === 'attribute');
  if (attribute) return normalizeFeedbackSentence(attribute.narrativeHint);

  const skill = feedback.find((item) => item.type === 'skill');
  if (skill) return skillRecognitionLine(skill);

  return undefined;
}

function fictionFirstLineForItem(item: AppliedConsequence): string | undefined {
  if (item.type === 'identity') return identityRecognitionLine(item);
  if (item.type === 'skill') return skillRecognitionLine(item);
  return normalizeFeedbackSentence(item.narrativeHint || item.label);
}

function asSecondaryClause(sentence: string): string {
  const clause = trimTerminalPunctuation(sentence).trim();
  const practicedMatch = /^You feel more practiced in (.+)$/i.exec(clause);
  if (practicedMatch) {
    return 'the lesson settles in';
  }
  return lowercaseFirst(clause);
}

export function buildChoiceConsequenceSentence(applied: AppliedConsequence[]): string | undefined {
  const visible = getFictionFirstChangeFeedback(applied);
  const meaningful = visible.filter((item) => !isNeutralRelationshipFeedback(item));

  if (meaningful.length === 0) return undefined;

  const ordered = [
    ...meaningful.filter((item) => item.type === 'relationship'),
    ...meaningful.filter((item) => item.type === 'skill'),
    ...meaningful.filter((item) => item.type === 'attribute'),
    ...meaningful.filter((item) => item.type === 'identity'),
  ];

  const primary = ordered[0] ? fictionFirstLineForItem(ordered[0]) : undefined;
  if (!primary) return undefined;

  const secondary = ordered
    .slice(1)
    .map(fictionFirstLineForItem)
    .find(Boolean);

  if (!secondary) return normalizeFeedbackSentence(primary);

  return normalizeFeedbackSentence(`${trimTerminalPunctuation(primary)} as ${asSecondaryClause(secondary)}`);
}
