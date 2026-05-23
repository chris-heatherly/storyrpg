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

export function buildChoiceRecognitionLine(feedback: AppliedConsequence[]): string | undefined {
  const relationship = feedback.find((item) => item.type === 'relationship');
  if (relationship) return normalizeFeedbackSentence(relationship.narrativeHint);

  const identity = feedback.find((item) => item.type === 'identity');
  if (identity) return identityRecognitionLine(identity);

  const attribute = feedback.find((item) => item.type === 'attribute');
  if (attribute) return normalizeFeedbackSentence(attribute.narrativeHint);

  const skill = feedback.find((item) => item.type === 'skill');
  if (skill) return normalizeFeedbackSentence(skill.narrativeHint);

  return undefined;
}
