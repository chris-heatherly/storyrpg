import type { Choice } from '../../types/choice';
import type { TextVariant } from '../../types/content';
import type { SeasonResidueObligation } from '../../types/seasonPlan';
import type { CallbackHook, SerializedCallbackLedger } from './callbackLedger';
import { isStructuralFlag } from './callbackLedger';
import { isFallbackReminderStub } from '../constants/choiceTextFallbacks';
import { isUnsafeCallbackProse } from '../constants/metaProse';

export type LedgerFlagClassification = 'future-window' | 'resolved-or-abandoned' | 'due-or-orphan';
export type PlannedFlagClassification =
  | 'planned_paid'
  | 'planned_due_missing'
  | 'future_window'
  | 'terminal_slice_ok'
  | 'unplanned_orphan';

export type ResidueEvidenceSurface =
  | 'beat_text'
  | 'text_variant'
  | 'choice_text'
  | 'dialogue'
  | 'encounter_outcome'
  | 'metadata';

export interface ChoiceMemoryBeat {
  id?: string;
  text?: string;
  textVariants?: TextVariant[];
  callbackHookIds?: string[];
  choices?: Choice[];
}

export interface ChoiceMemoryScene {
  sceneId: string;
  beats?: ChoiceMemoryBeat[];
}

export interface ChoiceMemoryChoiceSet {
  sceneId?: string;
  beatId?: string;
  choices?: Choice[];
}

export interface ResidueEvidence {
  obligationId: string;
  paid: boolean;
  metadataOnly: boolean;
  surface?: ResidueEvidenceSurface;
  sceneId?: string;
  beatId?: string;
  choiceId?: string;
}

export function cleanPlayerFacingProse(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
}

export function isPlayerFacingCallbackText(raw: unknown): raw is string {
  const value = cleanPlayerFacingProse(raw);
  return value.length >= 8 &&
    !isUnsafeCallbackProse(value) &&
    !isFallbackReminderStub(value) &&
    !/[a-z]+_[a-z0-9_]+/.test(value) &&
    !/\b(obligation|flag|callbackHookId|textVariant)\b/i.test(value);
}

export function isReferentialChoiceFlag(flag: unknown): flag is string {
  if (typeof flag !== 'string') return false;
  const normalized = flag.trim();
  return normalized.length > 0 &&
    !/^(?:tint|expr|expression|moment):/i.test(normalized) &&
    !isStructuralFlag(normalized);
}

export function extractConditionKeys(condition: unknown): string[] {
  if (!condition || typeof condition !== 'object') return [];
  const c = condition as Record<string, unknown>;
  const out: string[] = [];
  if (c.type === 'flag' && typeof c.flag === 'string') out.push(c.flag);
  if (Array.isArray(c.conditions)) {
    for (const child of c.conditions) out.push(...extractConditionKeys(child));
  }
  if (c.condition) out.push(...extractConditionKeys(c.condition));
  return out;
}

export function choiceSetsFlag(choice: Pick<Choice, 'consequences'>, flag: string): boolean {
  return (choice.consequences || []).some((consequence) =>
    consequence.type === 'setFlag' &&
    consequence.flag === flag &&
    consequence.value !== false,
  );
}

export function choiceSetsFlagInEpisode(choiceSets: ChoiceMemoryChoiceSet[], flag: string): boolean {
  return choiceSets.some((choiceSet) =>
    (choiceSet.choices || []).some((choice) => choiceSetsFlag(choice, flag)),
  );
}

export function hookCarriesFlag(hook: CallbackHook, flag: string): boolean {
  return hook.id === `flag:${flag}` ||
    hook.flags?.includes(flag) === true ||
    hook.conditionKeys?.includes(flag) === true;
}

export function classifyLedgerFlag(
  flag: string,
  ledger: SerializedCallbackLedger | undefined,
  generatedThrough: number,
): LedgerFlagClassification | undefined {
  const hooks = (ledger?.hooks || []).filter((hook) => hookCarriesFlag(hook, flag));
  if (hooks.length === 0) return undefined;
  if (hooks.every((hook) => hook.resolved || hook.abandoned)) return 'resolved-or-abandoned';
  const open = hooks.filter((hook) => !hook.resolved && !hook.abandoned);
  if (open.some((hook) => (hook.payoffEpisode ?? hook.payoffWindow?.maxEpisode ?? 0) > generatedThrough)) {
    return 'future-window';
  }
  return 'due-or-orphan';
}

export function classifyPlannedFlag(
  flag: string,
  residuePlan: SeasonResidueObligation[] | undefined,
  consumerFlags: Set<string>,
  generatedThrough: number,
): PlannedFlagClassification {
  const obligations = (residuePlan || []).filter((obligation) =>
    obligation.flag === flag || obligation.conditionKey === flag,
  );
  if (obligations.length === 0) return 'unplanned_orphan';
  if (consumerFlags.has(flag)) return 'planned_paid';
  if (obligations.some((obligation) =>
    obligation.payoffPolicy === 'terminal_slice_ok' &&
    obligation.sourceEpisodeNumber === generatedThrough
  )) {
    return 'terminal_slice_ok';
  }
  if (obligations.some((obligation) =>
    obligation.targetEpisodeNumbers.some((target) => target > generatedThrough)
  )) {
    return 'future_window';
  }
  return 'planned_due_missing';
}

export function findResidueEvidence(
  sceneContents: ChoiceMemoryScene[],
  choiceSets: ChoiceMemoryChoiceSet[],
  obligation: SeasonResidueObligation,
): ResidueEvidence {
  const conditionKey = obligation.conditionKey || obligation.flag;
  let metadataOnly: ResidueEvidence | undefined;

  const noteMetadata = (partial: Omit<ResidueEvidence, 'obligationId' | 'paid' | 'metadataOnly'>): void => {
    metadataOnly ??= {
      obligationId: obligation.id,
      paid: false,
      metadataOnly: true,
      ...partial,
    };
  };

  for (const scene of sceneContents) {
    for (const beat of scene.beats || []) {
      for (const variant of beat.textVariants || []) {
        const keys = extractConditionKeys(variant.condition);
        const idMatches = variant.residueObligationId === obligation.id;
        const conditionMatches = keys.includes(conditionKey);
        if (idMatches || conditionMatches) {
          if (isPlayerFacingCallbackText(variant.text)) {
            return {
              obligationId: obligation.id,
              paid: true,
              metadataOnly: false,
              surface: 'text_variant',
              sceneId: scene.sceneId,
              beatId: beat.id,
            };
          }
          noteMetadata({ surface: 'text_variant', sceneId: scene.sceneId, beatId: beat.id });
        }
      }

      const hookMatches = beat.callbackHookIds?.includes(`flag:${obligation.flag}`) === true;
      if (hookMatches) {
        if (obligation.requiredSurface.includes('beat_text') && textMatchesResidueCue(beat.text, obligation)) {
          return {
            obligationId: obligation.id,
            paid: true,
            metadataOnly: false,
            surface: 'beat_text',
            sceneId: scene.sceneId,
            beatId: beat.id,
          };
        }
        noteMetadata({ surface: 'metadata', sceneId: scene.sceneId, beatId: beat.id });
      }
    }
  }

  for (const choiceSet of choiceSets) {
    for (const choice of choiceSet.choices || []) {
      const idMatches = choice.residueObligationIds?.includes(obligation.id) === true;
      const conditionMatches = choice.conditions ? extractConditionKeys(choice.conditions).includes(conditionKey) : false;
      if (idMatches || conditionMatches) {
        if (obligation.requiredSurface.includes('choice_text') && isPlayerFacingCallbackText(choice.text)) {
          return {
            obligationId: obligation.id,
            paid: true,
            metadataOnly: false,
            surface: 'choice_text',
            sceneId: choiceSet.sceneId,
            beatId: choiceSet.beatId,
            choiceId: choice.id,
          };
        }
        noteMetadata({ surface: 'metadata', sceneId: choiceSet.sceneId, beatId: choiceSet.beatId, choiceId: choice.id });
      }
    }
  }

  return metadataOnly ?? {
    obligationId: obligation.id,
    paid: false,
    metadataOnly: false,
  };
}

export function hasResidueEvidence(
  sceneContents: ChoiceMemoryScene[],
  choiceSets: ChoiceMemoryChoiceSet[],
  obligation: SeasonResidueObligation,
): boolean {
  return findResidueEvidence(sceneContents, choiceSets, obligation).paid;
}

function textMatchesResidueCue(text: unknown, obligation: SeasonResidueObligation): boolean {
  const value = cleanPlayerFacingProse(text).toLowerCase();
  if (!isPlayerFacingCallbackText(value)) return false;
  const candidates = [
    obligation.choiceAnchor,
    obligation.authoringGuidance,
    obligation.sourceMaterial.choiceText,
    obligation.sourceMaterial.feedbackEcho,
    obligation.sourceMaterial.feedbackProgress,
    obligation.sourceMaterial.reminderImmediate,
    obligation.sourceMaterial.reminderShortTerm,
    obligation.sourceMaterial.reminderLater,
    ...(obligation.sourceMaterial.residueHints || []),
    ...(obligation.sourceMaterial.witnessReactions || []),
  ];
  const tokens = new Set(value.split(/[^a-z0-9]+/).filter((token) => token.length >= 4));
  for (const candidate of candidates) {
    const cueTokens = cleanPlayerFacingProse(candidate)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4);
    if (cueTokens.length === 0) continue;
    const overlap = cueTokens.filter((token) => tokens.has(token)).length;
    if (overlap >= Math.min(2, cueTokens.length)) return true;
  }
  return false;
}
