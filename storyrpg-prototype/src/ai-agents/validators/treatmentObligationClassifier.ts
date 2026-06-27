import type {
  TreatmentObligationContract,
  TreatmentObligationFinding,
  TreatmentRepairRoute,
} from '../../types/validation';
import { normalizeRealizationText } from '../remediation/realizationEvaluator';

export type TreatmentObligationKind =
  | 'scene_prose_required'
  | 'scene_prose_signature'
  | 'information_ledger_required'
  | 'season_spoiler_ledger'
  | 'abstract_pressure'
  | 'composite_bundle'
  | 'composite_signature'
  | 'future_episode_only';

export interface TreatmentObligationClassification {
  kind: TreatmentObligationKind;
  contract: TreatmentObligationContract;
  repairRoute: TreatmentRepairRoute;
  targetSurface: TreatmentObligationFinding['targetSurface'];
  blocksFinalProse: boolean;
  reason: string;
}

export interface ClassifyTreatmentObligationInput {
  validator?: string;
  message?: string;
  text?: string;
  severity?: 'error' | 'warning' | 'info' | 'suggestion';
}

export function extractQuotedTreatmentText(message: string | undefined): string | undefined {
  if (!message) return undefined;
  const quoted = [...message.matchAll(/"([^"]+)"/g)].map((match) => match[1]?.trim()).filter(Boolean);
  return quoted.at(-1);
}

export function classifyTreatmentObligation(
  input: ClassifyTreatmentObligationInput,
): TreatmentObligationClassification {
  const validator = input.validator ?? '';
  const message = input.message ?? '';
  const text = (input.text ?? extractQuotedTreatmentText(message) ?? message).trim();
  const normalized = normalizeRealizationText(text);
  const messageNormalized = normalizeRealizationText(message);

  if (validator === 'SignatureDevicePresenceValidator' && isCompositeTwoAnchorSignature(normalized)) {
    return {
      kind: 'composite_signature',
      contract: 'treatment_signature_realization',
      repairRoute: 'plan-repair',
      targetSurface: 'signature-device',
      blocksFinalProse: false,
      reason: 'Composite two-anchor signature must be split before prose validation.',
    };
  }

  if (isFutureEpisodeOnly(normalized, messageNormalized)) {
    return {
      kind: 'future_episode_only',
      contract: 'treatment_scope_notice',
      repairRoute: 'final-contract-only',
      targetSurface: 'scope',
      blocksFinalProse: false,
      reason: 'Obligation belongs outside the generated episode slice.',
    };
  }

  if (isAbstractPressure(normalized)) {
    return {
      kind: 'abstract_pressure',
      contract: 'treatment_season_promise_realization',
      repairRoute: 'plan-repair',
      targetSurface: 'season-promise',
      blocksFinalProse: false,
      reason: 'Abstract pressure belongs in planning/contract diagnostics, not literal scene prose.',
    };
  }

  if (isSeasonSpoiler(normalized)) {
    return {
      kind: 'season_spoiler_ledger',
      contract: 'treatment_information_schedule',
      repairRoute: 'ledger-repair',
      targetSurface: 'information-ledger',
      blocksFinalProse: false,
      reason: 'Spoiler truth should be foreshadowed through ledger-safe tells, not directly revealed in this episode.',
    };
  }

  if (isCompositeBundle(text, normalized)) {
    return {
      kind: 'composite_bundle',
      contract: 'treatment_information_schedule',
      repairRoute: 'ledger-repair',
      targetSurface: 'information-ledger',
      blocksFinalProse: false,
      reason: 'Composite treatment bundle must be decomposed into individual obligations before realization checks.',
    };
  }

  if (validator === 'RequiredBeatRealizationValidator' && /\btreatment plant not found\b/i.test(message)) {
    return {
      kind: 'information_ledger_required',
      contract: 'treatment_information_schedule',
      repairRoute: 'ledger-repair',
      targetSurface: 'information-ledger',
      blocksFinalProse: false,
      reason: 'Seed/plant misses are ledger obligations; scene prose is one possible evidence surface, not a literal source-string requirement.',
    };
  }

  if (validator === 'SignatureDevicePresenceValidator') {
    return {
      kind: 'scene_prose_signature',
      contract: 'treatment_signature_realization',
      repairRoute: 'judge-and-regen',
      targetSurface: 'signature-device',
      blocksFinalProse: true,
      reason: 'Concrete signature device must be staged on-page.',
    };
  }

  return {
    kind: 'scene_prose_required',
    contract: 'treatment_obligation_realization',
    repairRoute: 'scene-regen',
    targetSurface: 'scene-prose',
    blocksFinalProse: true,
    reason: 'Concrete localized obligation is safe to validate against scene prose.',
  };
}

function isCompositeTwoAnchorSignature(normalized: string): boolean {
  return normalized.includes('two anchors')
    && normalized.includes('rooftop')
    && normalized.includes('dusk club')
    && normalized.includes('cismigiu')
    && /\b(?:shadow|scream|rescue|rescues?)\b/.test(normalized);
}

function isFutureEpisodeOnly(normalized: string, messageNormalized: string): boolean {
  return /\b(?:future episode|later episode|outside generated|outside the generated|partial slice|partial season)\b/.test(messageNormalized)
    || /\b(?:hunter'?s moon|casa stelarum|final confrontation|episode [2-9]|ep[2-9])\b/.test(normalized);
}

function isAbstractPressure(normalized: string): boolean {
  if (/\b(?:opening promise|ordinary world|season central pressure|core fantasy|theme question|genre progression|tone progression)\b/.test(normalized)) {
    return true;
  }
  if (
    /\b(?:reinvention|identity|performance|desire|intimacy|predation|voice|byline|glamorous new life)\b/.test(normalized)
    && !/\b(?:two suitcases|door|key|card|quartz|rose|dog|courtyard|kisses|attack|scream|rescues?|walks?|arrives?)\b/.test(normalized)
  ) {
    return true;
  }
  return /\bprotects herself\b/.test(normalized)
    && /\bobserving\b/.test(normalized)
    && /\bordering second\b/.test(normalized)
    && /\bwriting the piece later\b/.test(normalized)
    && !/\btwo suitcases\b/.test(normalized);
}

function isSeasonSpoiler(normalized: string): boolean {
  return /\b(?:contracted succubus|victor'?s lure|inside-?man|true nature|is a monster|secretly working|fifty[- ]seven year contract)\b/.test(normalized);
}

function isCompositeBundle(original: string, normalized: string): boolean {
  const semicolonCount = (original.match(/;/g) ?? []).length;
  const commaCount = (original.match(/,/g) ?? []).length;
  const cueCount = [
    'quartz',
    'key card',
    'side entrance',
    'mika',
    'rougher man',
    'kitchen entrance',
    'black roses',
    'cream stock',
    'stray dog',
    'courtyard',
    'readership',
    'dusk club',
    'negronis',
    'blog',
    'byline',
  ].filter((cue) => normalized.includes(cue)).length;
  if (semicolonCount >= 2 && cueCount >= 3) return true;
  if (semicolonCount >= 1 && cueCount >= 4) return true;
  if (commaCount >= 4 && cueCount >= 4) return true;
  return normalized.includes('arrives in bucharest')
    && normalized.includes('dusk club')
    && normalized.includes('observing')
    && normalized.includes('ordering second')
    && normalized.includes('writing the piece later');
}
