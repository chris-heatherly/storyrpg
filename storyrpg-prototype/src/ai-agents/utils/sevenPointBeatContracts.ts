import type { SeasonPlan } from '../../types/seasonPlan';
import type { SevenPointBeat, SevenPointStructure, TreatmentSeasonGuidance } from '../../types/sourceAnalysis';
import type {
  MechanicPressureContract,
  PlannedScene,
  RequiredBeat,
  SevenPointBeatRealizationContract,
  SevenPointBeatRealizationTarget,
} from '../../types/scenePlan';
import {
  treatmentFieldCloseMatch,
  treatmentFieldTokens,
} from './treatmentFieldContracts';

const BEATS: SevenPointBeat[] = ['hook', 'plotTurn1', 'pinch1', 'midpoint', 'pinch2', 'climax', 'resolution'];

const BEAT_LABELS: Record<SevenPointBeat, RegExp> = {
  hook: /\bhook\b/i,
  plotTurn1: /\bplot\s*turn\s*1\b/i,
  pinch1: /\bpinch\s*1\b/i,
  midpoint: /\bmidpoint\b/i,
  pinch2: /\bpinch\s*2\b/i,
  climax: /\bclimax\b/i,
  resolution: /\bresolution\b/i,
};

const STATE_CHANGE_RE =
  /\b(goes viral|go viral|skips? a day|genre changes?|changes?|reveals?|confesses?|confession|offers?|frames?|hospitalized|turns?|dies?|dark|saved?|rescued?|runs?|walks? out|chooses?|choice|ends?|final post|dawn|truths?|mirror|contract|freed|forgiven|surrender|refuse|humanity|voice)\b/i;

function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 54) || 'beat';
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function normalizeBeatLine(line: string, beat: SevenPointBeat): string | undefined {
  if (!BEAT_LABELS[beat].test(line)) return undefined;
  const clean = line
    .replace(/^[-*]\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return undefined;
  const withoutLabel = clean
    .replace(BEAT_LABELS[beat], '')
    .replace(/^\s*[:\-–—]\s*/, '')
    .trim();
  return withoutLabel || clean;
}

function extractBeatText(spine: string | undefined, beat: SevenPointBeat): string | undefined {
  if (!spine?.trim()) return undefined;
  const matchingLines = spine
    .split(/\r?\n/)
    .map((line) => normalizeBeatLine(line, beat))
    .filter((line): line is string => Boolean(line));
  if (matchingLines.length === 0) return undefined;
  return matchingLines.sort((a, b) => b.length - a.length)[0];
}

function eventAtoms(text: string): string[] {
  const atoms = text
    .replace(/\([^)]*\bEp(?:isode)?\.?\s*#?\s*\d+[^)]*\)/gi, '')
    .split(/\s*(?:→|;|\.|\band then\b|\bwhile\b|\bbut\b)\s*/i)
    .map((part) => part.trim().replace(/^[-–—:,]+|[-–—:,]+$/g, '').trim())
    .filter((part) => treatmentFieldTokens(part).length >= 3);
  return dedupe(atoms).slice(0, 8);
}

function requiredRealizationFor(beat: SevenPointBeat, sourceText: string): SevenPointBeatRealizationTarget[] {
  const targets: SevenPointBeatRealizationTarget[] = ['season_plan', 'scene_turn', 'final_prose'];
  if (beat === 'climax' || beat === 'resolution') targets.push('episode_ending');
  if (STATE_CHANGE_RE.test(sourceText)) targets.push('mechanic_pressure');
  return dedupe(targets) as SevenPointBeatRealizationTarget[];
}

function defaultTargetEpisode(beat: SevenPointBeat, totalEpisodes: number): number {
  const max = Math.max(1, totalEpisodes || 1);
  switch (beat) {
    case 'hook':
      return 1;
    case 'plotTurn1':
      return Math.max(1, Math.min(max, Math.ceil(max * 0.25)));
    case 'pinch1':
      return Math.max(1, Math.min(max, Math.ceil(max * 0.4)));
    case 'midpoint':
      return Math.max(1, Math.min(max, Math.ceil(max * 0.5)));
    case 'pinch2':
      return Math.max(1, Math.min(max, Math.ceil(max * 0.75)));
    case 'climax':
    case 'resolution':
      return max;
    default:
      return 1;
  }
}

export function buildSevenPointBeatContracts(input: {
  guidance?: TreatmentSeasonGuidance;
  sevenPoint?: SevenPointStructure;
  totalEpisodes: number;
  treatmentSourced?: boolean;
}): SevenPointBeatRealizationContract[] {
  const out: SevenPointBeatRealizationContract[] = [];
  const hasAuthoredSpine = Boolean(input.guidance?.seasonSpine?.trim());
  const level: SevenPointBeatRealizationContract['blockingLevel'] = input.treatmentSourced && hasAuthoredSpine
    ? 'treatment'
    : 'warning';

  for (const beat of BEATS) {
    const authoredText = extractBeatText(input.guidance?.seasonSpine, beat);
    const sourceText = hasAuthoredSpine
      ? authoredText ?? ''
      : input.sevenPoint?.[beat] ?? '';
    if (!sourceText.trim()) continue;
    const atoms = eventAtoms(sourceText);
    out.push({
      id: `seven-point-${beat}-${slug(sourceText)}`,
      beat,
      sourceText,
      targetEpisodeNumber: input.guidance?.beatEpisodeAnchors?.[beat] ?? defaultTargetEpisode(beat, input.totalEpisodes),
      requiredRealization: requiredRealizationFor(beat, sourceText),
      eventAtoms: atoms.length > 0 ? atoms : [sourceText],
      stateChange: STATE_CHANGE_RE.test(sourceText) ? sourceText : undefined,
      targetSceneIds: [],
      blockingLevel: level,
    });
  }

  return out;
}

export function buildSevenPointBeatContractsForPlan(
  plan: Pick<SeasonPlan, 'sevenPointBeatContracts' | 'sevenPoint' | 'totalEpisodes'> & {
    treatmentSeasonGuidance?: TreatmentSeasonGuidance;
  },
): SevenPointBeatRealizationContract[] {
  if ((plan.sevenPointBeatContracts ?? []).length > 0) return plan.sevenPointBeatContracts ?? [];
  return buildSevenPointBeatContracts({
    guidance: plan.treatmentSeasonGuidance,
    sevenPoint: plan.sevenPoint,
    totalEpisodes: plan.totalEpisodes,
    treatmentSourced: Boolean(plan.treatmentSeasonGuidance?.seasonSpine),
  });
}

function sceneText(scene: PlannedScene): string {
  return [
    scene.title,
    scene.dramaticPurpose,
    scene.stakes,
    scene.turnContract?.centralTurn,
    scene.turnContract?.turnEvent,
    scene.turnContract?.afterState,
    scene.signatureMoment,
    scene.encounter?.description,
    scene.encounter?.centralConflict,
    ...(scene.requiredBeats ?? []).map((beat) => `${beat.sourceTurn} ${beat.mustDepict}`),
    ...(scene.mechanicPressure ?? []).map((pressure) => pressure.storyPressure),
  ].filter(Boolean).join(' ');
}

function scoreScene(contract: SevenPointBeatRealizationContract, scene: PlannedScene): number {
  let score = treatmentFieldCloseMatch(contract.sourceText, sceneText(scene), sevenPointBeatMatchThreshold(contract)) ? 1 : 0;
  if (contract.targetEpisodeNumber === scene.episodeNumber) score += 0.4;
  if (scene.kind === 'encounter' && (contract.beat === 'pinch1' || contract.beat === 'pinch2' || contract.beat === 'climax')) score += 0.35;
  if (scene.narrativeRole === 'turn' && (contract.beat === 'plotTurn1' || contract.beat === 'midpoint')) score += 0.3;
  if (scene.narrativeRole === 'release' && contract.beat === 'resolution') score += 0.4;
  if (scene.narrativeRole === 'setup' && contract.beat === 'hook') score += 0.4;
  if (scene.hasChoice && (contract.beat === 'climax' || contract.beat === 'plotTurn1')) score += 0.2;
  return score;
}

function bestSceneForContract(contract: SevenPointBeatRealizationContract, scenes: PlannedScene[]): PlannedScene | undefined {
  const candidates = scenes.filter((scene) => scene.episodeNumber === contract.targetEpisodeNumber);
  if (candidates.length === 0) return undefined;
  return candidates
    .map((scene) => ({ scene, score: scoreScene(contract, scene) }))
    .sort((a, b) => b.score - a.score || a.scene.order - b.scene.order)[0]?.scene;
}

function requiredBeatFor(contract: SevenPointBeatRealizationContract, scene: PlannedScene): RequiredBeat {
  return {
    id: `${scene.id}-seven-point-${contract.beat}`,
    sourceTurn: contract.sourceText,
    mustDepict: contract.sourceText,
    tier: contract.blockingLevel === 'treatment' ? 'authored' : 'seed',
  };
}

function pressureFor(contract: SevenPointBeatRealizationContract, scene: PlannedScene): MechanicPressureContract | undefined {
  if (!contract.requiredRealization.includes('mechanic_pressure')) return undefined;
  return {
    id: `${contract.id}-pressure`,
    source: contract.blockingLevel === 'treatment' ? 'treatment' : 'planner',
    domain: contract.beat === 'resolution' || contract.beat === 'climax' ? 'route' : 'flag',
    mechanicRef: { flag: contract.id },
    function: contract.beat === 'resolution' ? 'resolve' : contract.beat === 'climax' ? 'payoff' : 'intensify',
    storyPressure: contract.stateChange ?? contract.sourceText,
    evidenceRequired: contract.eventAtoms,
    visibleResidue: ['show the beat changing story state, options, relationships, access, information, tone, or episode pressure'],
    allowedPayoffs: ['scene turn, choice pressure, reveal, route state, ending state, branch residue, or episode handoff'],
    blockedPayoffs: ['structural label only, metadata-only arc text, or summary that skips the authored beat event'],
    originatingSceneId: scene.id,
  };
}

export function assignSevenPointBeatContractsToScenes(
  plan: Pick<SeasonPlan, 'sevenPointBeatContracts' | 'sevenPoint' | 'totalEpisodes'> & {
    treatmentSeasonGuidance?: TreatmentSeasonGuidance;
  },
  scenes: PlannedScene[],
): SevenPointBeatRealizationContract[] {
  const contracts = buildSevenPointBeatContractsForPlan(plan);
  for (const contract of contracts) {
    const target = bestSceneForContract(contract, scenes);
    if (!target) continue;
    contract.targetSceneIds = dedupe([...contract.targetSceneIds, target.id]);
    const existing = target.sevenPointBeatContracts ?? [];
    if (!existing.some((candidate) => candidate.id === contract.id)) {
      target.sevenPointBeatContracts = [...existing, contract];
    }
    if (contract.blockingLevel !== 'warning') {
      const beat = requiredBeatFor(contract, target);
      if (!(target.requiredBeats ?? []).some((candidate) => candidate.id === beat.id)) {
        target.requiredBeats = [...(target.requiredBeats ?? []), beat];
      }
      const pressure = pressureFor(contract, target);
      if (pressure && !(target.mechanicPressure ?? []).some((candidate) => candidate.id === pressure.id)) {
        target.mechanicPressure = [...(target.mechanicPressure ?? []), pressure];
      }
    }
  }
  return contracts;
}

export function sevenPointBeatMatchThreshold(contract: SevenPointBeatRealizationContract): number {
  const tokenCount = treatmentFieldTokens(contract.sourceText).length;
  if (tokenCount <= 4) return 0.45;
  if (contract.beat === 'climax' || contract.beat === 'resolution') return 0.22;
  return 0.25;
}
