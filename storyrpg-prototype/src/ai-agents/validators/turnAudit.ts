import type { Consequence } from '../../types/consequences';
import type { TextVariant } from '../../types/content';

export const FICTION_FIRST_TURN_DOMAINS = [
  'trust_shift',
  'evidence_transfer',
  'leverage_shift',
  'secret_pressure',
  'proximity_shift',
  'risk_change',
  'identity_expression',
  'resource_change',
  'knowledge_gain',
] as const;

export type FictionFirstTurnDomain = typeof FICTION_FIRST_TURN_DOMAINS[number];

export interface TurnAuditBeat {
  id?: string;
  text?: string;
  shotType?: 'establishing' | 'character' | 'action';
  intensityTier?: 'dominant' | 'supporting' | 'rest';
  isClimaxBeat?: boolean;
  isKeyStoryBeat?: boolean;
  primaryAction?: string;
  visualMoment?: string;
  mustShowDetail?: string;
  emotionalRead?: string;
  relationshipDynamic?: string;
  dramaticIntent?: {
    visibleTurn?: string;
    visualSubtextCue?: string;
    subtext?: string;
    statusBefore?: string;
    statusAfter?: string;
  };
  onShow?: Consequence[];
  textVariants?: TextVariant[];
  plantsThreadId?: string;
  paysOffThreadId?: string;
  plotPointType?: string;
}

export interface TurnAuditIssue {
  beatId: string;
  category: 'topic_run' | 'missing_mechanics_hook';
  severity: 'warning';
  message: string;
  suggestion: string;
  domains: FictionFirstTurnDomain[];
}

const TOPIC_ONLY_RE = /\b(reports?|explains?|addresses?|observes?|focuses|voices?|deflects?|compliments?|speaks?|talks?|looks?|watches?|thinks?|realizes?|notices?|listens?|waits?|smiles?|continues|discuss(?:es)?|asks?|answers?)\b/i;
const PHYSICAL_TURN_RE = /\b(gives?|takes?|hands?|slides?|reveals?|hides?|pockets?|drops?|grips?|releases?|steps?|backs? away|leans?|corners?|blocks?|opens?|closes?|turns?|crosses?|pulls?|pushes?|reaches?|kneels?|runs?|walks?|breaks?|chooses?|refuses?)\b/i;

function asText(beat: TurnAuditBeat): string {
  return [
    beat.text,
    beat.primaryAction,
    beat.visualMoment,
    beat.mustShowDetail,
    beat.emotionalRead,
    beat.relationshipDynamic,
    beat.dramaticIntent?.visibleTurn,
    beat.dramaticIntent?.visualSubtextCue,
    beat.dramaticIntent?.subtext,
    beat.dramaticIntent?.statusBefore,
    beat.dramaticIntent?.statusAfter,
  ].filter(Boolean).join(' ').toLowerCase();
}

export function inferTurnDomains(beat: TurnAuditBeat): FictionFirstTurnDomain[] {
  const text = asText(beat);
  const domains = new Set<FictionFirstTurnDomain>();
  if (/\b(trust|distrust|betray|believe|doubt|forgive|respect|affection|fear)\b/.test(text)) domains.add('trust_shift');
  if (/\b(evidence|proof|clue|photo|phone|screen|letter|charm|key|map|document|recording|hands? over|changes? hands?|gives?|takes?)\b/.test(text)) domains.add('evidence_transfer');
  if (/\b(leverage|control|power|status|corner|blocks?|claims?|forces?|yields?|backs? away|presses?)\b/.test(text)) domains.add('leverage_shift');
  if (/\b(secret|lie|truth|deny|deflect|expose|reveal|hide|harder to deny)\b/.test(text)) domains.add('secret_pressure');
  if (/\b(close|closer|distance|steps? back|steps? toward|leans?|retreat|approach|touch|pulls? away)\b/.test(text)) domains.add('proximity_shift');
  if (/\b(danger|risk|threat|panic|caught|cost|wound|escape|safe|unsafe)\b/.test(text)) domains.add('risk_change');
  if (/\b(identity|mercy|justice|honest|deceptive|bold|cautious|heart|head|choice defines|values?)\b/.test(text)) domains.add('identity_expression');
  if (/\b(resource|money|weapon|food|medicine|supplies|inventory|item|cup|coffee|bag|ring)\b/.test(text)) domains.add('resource_change');
  if (/\b(learns?|understands?|discovers?|realizes?|notices?|information|knowledge|pattern|answer|question)\b/.test(text)) domains.add('knowledge_gain');
  return Array.from(domains);
}

function hasReadableTurn(beat: TurnAuditBeat): boolean {
  if (beat.intensityTier === 'rest') {
    return Boolean(beat.dramaticIntent?.visibleTurn || beat.dramaticIntent?.visualSubtextCue || PHYSICAL_TURN_RE.test(asText(beat)));
  }
  const text = asText(beat);
  return Boolean(beat.dramaticIntent?.visibleTurn && beat.dramaticIntent?.visualSubtextCue)
    || PHYSICAL_TURN_RE.test(text)
    || inferTurnDomains(beat).length > 0;
}

function isTopicOnlyBeat(beat: TurnAuditBeat): boolean {
  if (beat.shotType === 'establishing' || beat.intensityTier === 'rest') return false;
  const text = asText(beat);
  return TOPIC_ONLY_RE.test(text) && !hasReadableTurn(beat);
}

function hasMechanicsHook(beat: TurnAuditBeat): boolean {
  return Boolean(
    beat.onShow?.length
      || beat.textVariants?.some((variant) => variant?.callbackHookId || variant?.condition)
      || beat.plantsThreadId
      || beat.paysOffThreadId
      || beat.plotPointType,
  );
}

export function auditFictionFirstTurns(beats: TurnAuditBeat[]): TurnAuditIssue[] {
  const issues: TurnAuditIssue[] = [];
  let topicRun: TurnAuditBeat[] = [];

  const flushTopicRun = () => {
    if (topicRun.length >= 2) {
      const last = topicRun[topicRun.length - 1];
      issues.push({
        beatId: last.id || `beat-${beats.indexOf(last) + 1}`,
        category: 'topic_run',
        severity: 'warning',
        message: `${topicRun.length} consecutive non-rest beats explain, observe, or discuss without a readable fiction-first turn.`,
        suggestion: 'Convert at least one topic beat into a turn: evidence changes hands, leverage shifts, proximity changes, a secret becomes harder to deny, or risk visibly changes.',
        domains: [],
      });
    }
    topicRun = [];
  };

  for (const beat of beats) {
    if (isTopicOnlyBeat(beat)) {
      topicRun.push(beat);
    } else {
      flushTopicRun();
    }

    const domains = inferTurnDomains(beat);
    const important = beat.isClimaxBeat || beat.isKeyStoryBeat || beat.intensityTier === 'dominant' || domains.length > 0;
    if (
      important
      && beat.intensityTier !== 'rest'
      && beat.shotType !== 'establishing'
      && domains.length > 0
      && !hasMechanicsHook(beat)
    ) {
      issues.push({
        beatId: beat.id || `beat-${beats.indexOf(beat) + 1}`,
        category: 'missing_mechanics_hook',
        severity: 'warning',
        message: `Mechanically relevant turn (${domains.join(', ')}) has no existing state/callback/thread hook.`,
        suggestion: 'Use existing structures when appropriate: onShow consequences, textVariants, callbackHookId, plantsThreadId, paysOffThreadId, or plotPointType.',
        domains,
      });
    }
  }
  flushTopicRun();

  return issues;
}
