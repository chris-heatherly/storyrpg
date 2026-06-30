import type { Choice } from '../../types/choice';
import type { TextVariant } from '../../types/content';
import type { SeasonResidueObligation } from '../../types/seasonPlan';
import type { SceneBlueprint, EpisodeBlueprint } from '../agents/StoryArchitect';
import type { ChoiceSet } from '../agents/ChoiceAuthor';
import type { SceneContent } from '../agents/SceneWriter';
import type { CallbackLedger, SerializedCallbackLedger } from './callbackLedger';
import { isStructuralFlag } from './callbackLedger';
import { buildCallbackCondition } from './callbackOrchestration';
import {
  choiceSetsFlag,
  choiceSetsFlagInEpisode,
  extractConditionKeys,
  hasResidueEvidence as hasChoiceMemoryResidueEvidence,
  isPlayerFacingCallbackText,
} from './choiceMemoryDebt';

export const AUTO_RESIDUE_OBLIGATION_TAG = 'auto-residue-obligation';

export interface ResidueObligationMetrics {
  plannedOutgoing: string[];
  createdOutgoing: string[];
  missingOutgoing: string[];
  dueIncoming: string[];
  paidIncoming: string[];
  missingIncoming: string[];
  futureWindow: string[];
  terminalSliceOk: string[];
  unplannedConsequentialFlags: string[];
  autoInjected: string[];
  unrepairable: string[];
  outOfSliceSource: string[];
  metadataOnly: string[];
}

export interface ImplementEpisodeResidueObligationsParams {
  episodeNumber: number;
  sceneContents: SceneContent[];
  choiceSets: ChoiceSet[];
  blueprint?: EpisodeBlueprint;
  seasonResiduePlan?: SeasonResidueObligation[];
  callbackLedger?: CallbackLedger;
  importedCallbackLedger?: SerializedCallbackLedger;
  generatedThroughEpisode: number;
  maxPerBeat?: number;
  maxPerScene?: number;
  maxPerEpisode?: number;
}

export function isExcludedResidueFlag(flag: string): boolean {
  return isStructuralFlag(flag) || flag.startsWith('treatment_seed_');
}

export function residueObligationsForEpisode(
  plan: SeasonResidueObligation[] | undefined,
  episodeNumber: number,
): {
  incomingResidue: SeasonResidueObligation[];
  outgoingResidue: SeasonResidueObligation[];
  dueResidue: SeasonResidueObligation[];
} {
  const obligations = plan || [];
  const outgoingResidue = obligations.filter((obligation) => obligation.sourceEpisodeNumber === episodeNumber);
  const incomingResidue = obligations.filter((obligation) =>
    obligation.sourceEpisodeNumber <= episodeNumber &&
    obligation.targetEpisodeNumbers.includes(episodeNumber),
  );
  return {
    incomingResidue,
    outgoingResidue,
    dueResidue: incomingResidue,
  };
}

export function applyChoiceResidueBackstop(
  choiceSet: ChoiceSet,
  sceneBlueprint: SceneBlueprint,
  obligations: SeasonResidueObligation[] | undefined,
): { stamped: number; addedFlags: number } {
  const assignedIds = sceneBlueprint.choicePoint?.residueObligationIds || [];
  if (!assignedIds.length || !choiceSet.choices.length) return { stamped: 0, addedFlags: 0 };
  const obligationsById = new Map((obligations || []).map((obligation) => [obligation.id, obligation]));
  let stamped = 0;
  let addedFlags = 0;

  for (const id of assignedIds) {
    const obligation = obligationsById.get(id);
    if (!obligation?.flag) continue;
    const matchingChoice = choiceSet.choices.find((choice) => choiceSetsFlag(choice, obligation.flag))
      || choiceSet.choices.find((choice) => choice.text.toLowerCase().includes(obligation.choiceAnchor.toLowerCase().slice(0, 24)))
      || choiceSet.choices[0];
    if (!matchingChoice) continue;
    matchingChoice.residueObligationIds = Array.from(new Set([...(matchingChoice.residueObligationIds || []), id]));
    stamped += 1;
    if (!choiceSetsFlag(matchingChoice, obligation.flag)) {
      matchingChoice.consequences = [
        ...(matchingChoice.consequences || []),
        { type: 'setFlag', flag: obligation.flag, value: true },
      ];
      addedFlags += 1;
    }
    const reminder = obligation.sourceMaterial;
    if (!matchingChoice.reminderPlan && (reminder.reminderImmediate || reminder.reminderShortTerm)) {
      matchingChoice.reminderPlan = {
        immediate: reminder.reminderImmediate || reminder.feedbackEcho || obligation.authoringGuidance,
        shortTerm: reminder.reminderShortTerm || reminder.feedbackProgress || reminder.reminderImmediate || obligation.authoringGuidance,
        ...(reminder.reminderLater ? { later: reminder.reminderLater } : {}),
      };
    }
    if (!matchingChoice.feedbackCue && (reminder.feedbackEcho || reminder.feedbackProgress)) {
      matchingChoice.feedbackCue = {
        echoSummary: reminder.feedbackEcho,
        progressSummary: reminder.feedbackProgress,
        checkClass: 'dramatic',
      };
    }
    if (!matchingChoice.residueHints?.length && reminder.residueHints?.length) {
      matchingChoice.residueHints = reminder.residueHints.map((description) => ({
        kind: 'later_text_variant',
        description,
        targetEpisode: obligation.targetEpisodeNumbers[0],
        callbackHookId: `flag:${obligation.flag}`,
      }));
    }
  }

  return { stamped, addedFlags };
}

export function implementEpisodeResidueObligations(
  params: ImplementEpisodeResidueObligationsParams,
): ResidueObligationMetrics {
  const metrics = emptyMetrics();
  const plan = params.seasonResiduePlan || [];
  if (plan.length === 0) return metrics;

  const maxPerBeat = params.maxPerBeat ?? 1;
  const maxPerScene = params.maxPerScene ?? 2;
  const maxPerEpisode = params.maxPerEpisode ?? 4;
  const { episodeNumber, generatedThroughEpisode } = params;
  const sceneBlueprintsById = new Map((params.blueprint?.scenes || []).map((scene) => [scene.id, scene]));
  const sceneIndexById = new Map(params.sceneContents.map((scene, index) => [scene.sceneId, index]));
  const usedPerBeat = new Map<string, number>();
  const usedPerScene = new Map<string, number>();
  let injectedThisEpisode = 0;

  const outgoing = plan.filter((obligation) => obligation.sourceEpisodeNumber === episodeNumber);
  const due = plan.filter((obligation) =>
    obligation.sourceEpisodeNumber <= episodeNumber &&
    obligation.targetEpisodeNumbers.includes(episodeNumber),
  );

  for (const obligation of outgoing) {
    metrics.plannedOutgoing.push(obligation.id);
    if (choiceSetsFlagInEpisode(params.choiceSets, obligation.flag)) metrics.createdOutgoing.push(obligation.id);
    else metrics.missingOutgoing.push(obligation.id);
    seedCallbackHookForObligation(obligation, params);
  }

  for (const obligation of plan) {
    if (obligation.targetEpisodeNumbers.some((target) => target > generatedThroughEpisode)) {
      metrics.futureWindow.push(obligation.id);
    }
    if (
      obligation.payoffPolicy === 'terminal_slice_ok' &&
      obligation.sourceEpisodeNumber === generatedThroughEpisode
    ) {
      metrics.terminalSliceOk.push(obligation.id);
    }
  }

  for (const obligation of due) {
    metrics.dueIncoming.push(obligation.id);
    if (hasResidueEvidence(params.sceneContents, params.choiceSets, obligation)) {
      metrics.paidIncoming.push(obligation.id);
      continue;
    }
    if (obligation.payoffPolicy === 'terminal_slice_ok' && episodeNumber === generatedThroughEpisode) {
      metrics.terminalSliceOk.push(obligation.id);
      continue;
    }
    if (injectedThisEpisode >= maxPerEpisode) {
      metrics.unrepairable.push(obligation.id);
      metrics.missingIncoming.push(obligation.id);
      continue;
    }

    const prose = pickResidueProse(obligation);
    if (!prose) {
      metrics.unrepairable.push(obligation.id);
      metrics.missingIncoming.push(obligation.id);
      continue;
    }

    const target = findTargetBeat({
      obligation,
      sceneContents: params.sceneContents,
      sceneBlueprintsById,
      sceneIndexById,
      episodeNumber,
      maxPerBeat,
      maxPerScene,
      usedPerBeat,
      usedPerScene,
    });
    if (!target) {
      metrics.unrepairable.push(obligation.id);
      metrics.missingIncoming.push(obligation.id);
      continue;
    }

    const callbackHookId = resolveCallbackHookId(obligation, params.callbackLedger, params.importedCallbackLedger);
    const baseText = typeof target.beat.text === 'string' ? target.beat.text.trim() : '';
    const variant: TextVariant = {
      condition: buildCallbackCondition(obligation.conditionKey || obligation.flag),
      text: baseText ? `${baseText}\n\n${prose}` : prose,
      callbackHookId,
      residueObligationId: obligation.id,
      reminderTag: AUTO_RESIDUE_OBLIGATION_TAG,
    };
    target.beat.textVariants = [...(target.beat.textVariants || []), variant];
    target.beat.callbackHookIds = Array.from(new Set([
      ...(target.beat.callbackHookIds || []),
      ...(callbackHookId ? [callbackHookId] : []),
    ]));
    if (callbackHookId) {
      params.callbackLedger?.recordPayoff(callbackHookId, {
        episode: params.episodeNumber,
        sceneId: target.scene.sceneId,
        beatId: target.beat.id,
        source: 'residue_obligation',
        residueObligationId: obligation.id,
      });
    }
    usedPerBeat.set(target.beat.id, (usedPerBeat.get(target.beat.id) ?? 0) + 1);
    usedPerScene.set(target.scene.sceneId, (usedPerScene.get(target.scene.sceneId) ?? 0) + 1);
    injectedThisEpisode += 1;
    metrics.autoInjected.push(obligation.id);
    metrics.paidIncoming.push(obligation.id);
  }

  for (const flag of unplannedConsequentialFlags(params.choiceSets, plan, episodeNumber)) {
    metrics.unplannedConsequentialFlags.push(flag);
  }

  dedupeMetricArrays(metrics);
  return metrics;
}

export function hasResidueEvidence(
  sceneContents: SceneContent[],
  choiceSets: ChoiceSet[],
  obligation: SeasonResidueObligation,
): boolean {
  return hasChoiceMemoryResidueEvidence(sceneContents, choiceSets, obligation);
}

export function unplannedConsequentialFlags(
  choiceSets: ChoiceSet[],
  plan: SeasonResidueObligation[] | undefined,
  episodeNumber?: number,
): string[] {
  const planned = new Set((plan || [])
    .filter((obligation) => episodeNumber == null || obligation.sourceEpisodeNumber === episodeNumber)
    .map((obligation) => obligation.flag));
  const flags = new Set<string>();
  for (const choiceSet of choiceSets) {
    for (const choice of choiceSet.choices || []) {
      for (const consequence of choice.consequences || []) {
        if (
          consequence.type === 'setFlag' &&
          typeof consequence.flag === 'string' &&
          consequence.value !== false &&
          !planned.has(consequence.flag) &&
          !isExcludedResidueFlag(consequence.flag)
        ) {
          flags.add(consequence.flag);
        }
      }
    }
  }
  return [...flags];
}

function findTargetBeat(params: {
  obligation: SeasonResidueObligation;
  sceneContents: SceneContent[];
  sceneBlueprintsById: Map<string, SceneBlueprint>;
  sceneIndexById: Map<string, number>;
  episodeNumber: number;
  maxPerBeat: number;
  maxPerScene: number;
  usedPerBeat: Map<string, number>;
  usedPerScene: Map<string, number>;
}): { scene: SceneContent; beat: SceneContent['beats'][number] } | undefined {
  const sourceIdx = params.obligation.sourceEpisodeNumber === params.episodeNumber && params.obligation.sourceSceneId
    ? (params.sceneIndexById.get(params.obligation.sourceSceneId) ?? -1)
    : -1;
  const targetSceneIds = new Set(params.obligation.targetSceneIds || []);
  const compatible = params.sceneContents
    .map((scene, index) => ({ scene, index, blueprint: params.sceneBlueprintsById.get(scene.sceneId) }))
    .filter(({ scene, index }) => index > sourceIdx && (!targetSceneIds.size || targetSceneIds.has(scene.sceneId)))
    .sort((a, b) => scoreScene(b.blueprint, params.obligation) - scoreScene(a.blueprint, params.obligation));

  for (const { scene } of compatible) {
    if ((params.usedPerScene.get(scene.sceneId) ?? 0) >= params.maxPerScene) continue;
    for (const beat of scene.beats || []) {
      if (!beat.id) continue;
      if (beat.isChoicePoint || (beat as { choices?: unknown[] }).choices?.length) continue;
      if ((params.usedPerBeat.get(beat.id) ?? 0) >= params.maxPerBeat) continue;
      if ((beat.textVariants || []).some((variant) => variant.reminderTag === AUTO_RESIDUE_OBLIGATION_TAG)) continue;
      return { scene, beat };
    }
  }
  return undefined;
}

function scoreScene(scene: SceneBlueprint | undefined, obligation: SeasonResidueObligation): number {
  if (!scene) return 0;
  let score = 0;
  const npcSet = new Set(scene.npcsPresent || []);
  for (const npcId of obligation.targetNpcIds || []) if (npcSet.has(npcId)) score += 5;
  const haystack = [
    scene.name,
    scene.description,
    scene.dramaticQuestion,
    scene.narrativeFunction,
    ...(scene.keyBeats || []),
  ].join(' ').toLowerCase();
  for (const topic of obligation.targetTopics || []) {
    if (topic && haystack.includes(topic.toLowerCase())) score += 3;
  }
  if (scene.residueObligationIds?.includes(obligation.id)) score += 10;
  return score;
}

function pickResidueProse(obligation: SeasonResidueObligation): string {
  const source = obligation.sourceMaterial || {};
  const candidates = [
    source.feedbackEcho,
    source.feedbackProgress,
    source.reminderShortTerm,
    source.reminderImmediate,
    source.reminderLater,
    ...(source.residueHints || []),
    ...(source.witnessReactions || []),
  ];
  for (const raw of candidates) {
    const text = cleanProse(raw);
    if (isPlayerFacingCallbackText(text)) return text;
  }
  return '';
}

function cleanProse(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
}

function resolveCallbackHookId(
  obligation: SeasonResidueObligation,
  callbackLedger?: CallbackLedger,
  importedCallbackLedger?: SerializedCallbackLedger,
): string | undefined {
  const expected = `flag:${obligation.flag}`;
  if (callbackLedger?.has(expected)) return expected;
  if (importedCallbackLedger?.hooks?.some((hook) => hook.id === expected || hook.flags?.includes(obligation.flag))) return expected;
  return undefined;
}

function seedCallbackHookForObligation(
  obligation: SeasonResidueObligation,
  params: ImplementEpisodeResidueObligationsParams,
): void {
  if (!params.callbackLedger || !obligation.flag || isExcludedResidueFlag(obligation.flag)) return;
  const choice = findChoiceSettingFlag(params.choiceSets, obligation.flag);
  if (!choice) return;
  const hook = params.callbackLedger.recordFlagSet({
    choice,
    flag: obligation.flag,
    episode: params.episodeNumber,
    sceneId: obligation.sourceSceneId || sceneIdForChoice(params.choiceSets, choice.id) || '',
    residueObligationId: obligation.id,
    payoffEpisode: obligation.payoffPolicy === 'specific_episode' ? obligation.targetEpisodeNumbers[0] : undefined,
  });
  if (hook && obligation.payoffPolicy === 'specific_episode' && obligation.targetEpisodeNumbers[0]) {
    params.callbackLedger.setPayoffEpisode(hook.id, obligation.targetEpisodeNumbers[0], params.generatedThroughEpisode);
  }
}

function findChoiceSettingFlag(choiceSets: ChoiceSet[], flag: string): Choice | undefined {
  for (const choiceSet of choiceSets) {
    const choice = choiceSet.choices.find((candidate) => choiceSetsFlag(candidate, flag));
    if (choice) return choice;
  }
  return undefined;
}

function sceneIdForChoice(choiceSets: ChoiceSet[], choiceId: string): string | undefined {
  return choiceSets.find((choiceSet) => choiceSet.choices.some((choice) => choice.id === choiceId))?.sceneId;
}

function emptyMetrics(): ResidueObligationMetrics {
  return {
    plannedOutgoing: [],
    createdOutgoing: [],
    missingOutgoing: [],
    dueIncoming: [],
    paidIncoming: [],
    missingIncoming: [],
    futureWindow: [],
    terminalSliceOk: [],
    unplannedConsequentialFlags: [],
    autoInjected: [],
    unrepairable: [],
    outOfSliceSource: [],
    metadataOnly: [],
  };
}

function dedupeMetricArrays(metrics: ResidueObligationMetrics): void {
  for (const key of Object.keys(metrics) as Array<keyof ResidueObligationMetrics>) {
    metrics[key] = Array.from(new Set(metrics[key])) as string[];
  }
}
