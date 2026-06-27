import type { SeasonPlan } from '../../types/seasonPlan';
import type {
  LegacyStructuralBeat,
  LegacyStructuralMap,
  StoryCircleBeat,
  StoryCircleStructure,
  TreatmentSeasonGuidance,
} from '../../types/sourceAnalysis';
import { STORY_CIRCLE_BEATS } from '../../types/sourceAnalysis';
import type {
  MechanicPressureContract,
  PlannedScene,
  RequiredBeat,
  StoryCircleBeatRealizationContract,
  StoryCircleBeatRealizationTarget,
} from '../../types/scenePlan';
import {
  treatmentFieldCloseMatch,
  treatmentFieldTokens,
} from './treatmentFieldContracts';

const LEGACY_BEAT_BY_STORY_CIRCLE: Partial<Record<StoryCircleBeat, LegacyStructuralBeat>> = {
  you: 'hook',
  go: 'plotTurn1',
  search: 'pinch1',
  find: 'midpoint',
  take: 'pinch2',
  return: 'climax',
  change: 'resolution',
};

const BEAT_LABELS: Record<StoryCircleBeat, RegExp[]> = {
  you: [/\byou\b/i, /\bhook\b/i],
  need: [/\bneed\b/i, /\bwant\s*(?:vs\.?|\/)?\s*need\b/i, /\bprotagonist\s+need\b/i],
  go: [/\bgo\b/i, /\bplot\s*turn\s*1\b/i, /\binciting\s+threshold\b/i, /\bthreshold\b/i],
  search: [/\bsearch\b/i, /\bpinch\s*1\b/i],
  find: [/\bfind\b/i, /\bmidpoint\b/i],
  take: [/\btake\b/i, /\bpinch\s*2\b/i, /\bprice\b/i],
  return: [/\breturn\b/i, /\bclimax\b/i],
  change: [/\bchange\b/i, /\bresolution\b/i],
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

function normalizeBeatLine(line: string, beat: StoryCircleBeat): string | undefined {
  const label = BEAT_LABELS[beat].find((candidate) => candidate.test(line));
  if (!label) return undefined;
  const clean = line
    .replace(/^[-*]\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return undefined;
  const withoutLabel = clean
    .replace(label, '')
    .replace(/^\s*[:\-–—]\s*/, '')
    .trim();
  return withoutLabel || clean;
}

function extractBeatText(spine: string | undefined, beat: StoryCircleBeat): string | undefined {
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

function requiredRealizationFor(beat: StoryCircleBeat, sourceText: string): StoryCircleBeatRealizationTarget[] {
  const targets: StoryCircleBeatRealizationTarget[] = ['season_plan', 'scene_turn', 'final_prose'];
  if (beat === 'return' || beat === 'change') targets.push('episode_ending');
  if (STATE_CHANGE_RE.test(sourceText)) targets.push('mechanic_pressure');
  return dedupe(targets) as StoryCircleBeatRealizationTarget[];
}

function defaultTargetEpisode(beat: StoryCircleBeat, totalEpisodes: number): number {
  const max = Math.max(1, totalEpisodes || 1);
  const index = STORY_CIRCLE_BEATS.indexOf(beat);
  if (index <= 0) return 1;
  return Math.max(1, Math.min(max, Math.ceil(((index + 1) / STORY_CIRCLE_BEATS.length) * max)));
}

function targetEpisodeFor(
  guidance: TreatmentSeasonGuidance | undefined,
  beat: StoryCircleBeat,
  totalEpisodes: number,
): number {
  const explicit = guidance?.storyCircleBeatEpisodeAnchors?.[beat];
  if (explicit) return explicit;
  const legacyBeat = LEGACY_BEAT_BY_STORY_CIRCLE[beat];
  const legacyExplicit = legacyBeat ? guidance?.beatEpisodeAnchors?.[legacyBeat] : undefined;
  return legacyExplicit ?? defaultTargetEpisode(beat, totalEpisodes);
}

export function buildStoryCircleBeatContracts(input: {
  guidance?: TreatmentSeasonGuidance;
  storyCircle?: StoryCircleStructure;
  legacyStructure?: LegacyStructuralMap;
  totalEpisodes: number;
  treatmentSourced?: boolean;
}): StoryCircleBeatRealizationContract[] {
  const out: StoryCircleBeatRealizationContract[] = [];
  const hasAuthoredSpine = Boolean(input.guidance?.seasonSpine?.trim());
  const level: StoryCircleBeatRealizationContract['blockingLevel'] = input.treatmentSourced && hasAuthoredSpine
    ? 'treatment'
    : 'warning';

  for (const beat of STORY_CIRCLE_BEATS) {
    const authoredText = extractBeatText(input.guidance?.seasonSpine, beat);
    const legacyBeat = LEGACY_BEAT_BY_STORY_CIRCLE[beat];
    const sourceText = hasAuthoredSpine
      ? authoredText ?? ''
      : input.storyCircle?.[beat] ?? (legacyBeat ? input.legacyStructure?.[legacyBeat] : '') ?? '';
    if (!sourceText.trim()) continue;
    const atoms = eventAtoms(sourceText);
    out.push({
      id: `story-circle-${beat}-${slug(sourceText)}`,
      beat,
      sourceText,
      targetEpisodeNumber: targetEpisodeFor(input.guidance, beat, input.totalEpisodes),
      requiredRealization: requiredRealizationFor(beat, sourceText),
      eventAtoms: atoms.length > 0 ? atoms : [sourceText],
      stateChange: STATE_CHANGE_RE.test(sourceText) ? sourceText : undefined,
      targetSceneIds: [],
      blockingLevel: level,
    });
  }

  return out;
}

export function buildStoryCircleBeatContractsForPlan(
  plan: Pick<SeasonPlan, 'storyCircleBeatContracts' | 'storyCircle' | 'legacyStructure' | 'totalEpisodes'> & {
    treatmentSeasonGuidance?: TreatmentSeasonGuidance;
  },
): StoryCircleBeatRealizationContract[] {
  if ((plan.storyCircleBeatContracts ?? []).length > 0) return plan.storyCircleBeatContracts ?? [];
  return buildStoryCircleBeatContracts({
    guidance: plan.treatmentSeasonGuidance,
    storyCircle: plan.storyCircle,
    legacyStructure: plan.legacyStructure,
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

function scoreScene(contract: StoryCircleBeatRealizationContract, scene: PlannedScene): number {
  let score = treatmentFieldCloseMatch(contract.sourceText, sceneText(scene), storyCircleBeatMatchThreshold(contract)) ? 1 : 0;
  if (contract.targetEpisodeNumber === scene.episodeNumber) score += 0.4;
  if (scene.kind === 'encounter' && (contract.beat === 'search' || contract.beat === 'take' || contract.beat === 'return')) score += 0.35;
  if (scene.narrativeRole === 'turn' && (contract.beat === 'go' || contract.beat === 'find')) score += 0.3;
  if (scene.narrativeRole === 'release' && contract.beat === 'change') score += 0.4;
  if (scene.narrativeRole === 'setup' && contract.beat === 'you') score += 0.4;
  if (scene.hasChoice && (contract.beat === 'return' || contract.beat === 'go')) score += 0.2;
  return score;
}

function bestSceneForContract(contract: StoryCircleBeatRealizationContract, scenes: PlannedScene[]): PlannedScene | undefined {
  const candidates = scenes.filter((scene) => scene.episodeNumber === contract.targetEpisodeNumber);
  if (candidates.length === 0) return undefined;
  return candidates
    .map((scene) => ({ scene, score: scoreScene(contract, scene) }))
    .sort((a, b) => b.score - a.score || a.scene.order - b.scene.order)[0]?.scene;
}

function storyCircleOwnsContract(contract: StoryCircleBeatRealizationContract, scenes: PlannedScene[]): boolean {
  return scenes
    .filter((scene) => scene.episodeNumber === contract.targetEpisodeNumber)
    .some((scene) => (scene.storyCircleBeatContracts ?? []).some((storyCircleContract) =>
      storyCircleContract.blockingLevel !== 'warning'
      && storyCircleContract.targetEpisodeNumber === contract.targetEpisodeNumber
      && treatmentFieldCloseMatch(
        contract.sourceText,
        storyCircleContract.sourceText,
        Math.max(0.45, storyCircleBeatMatchThreshold(contract)),
      )
    ));
}

function requiredBeatFor(contract: StoryCircleBeatRealizationContract, scene: PlannedScene): RequiredBeat {
  return {
    id: `${scene.id}-story-circle-${contract.beat}`,
    sourceTurn: contract.sourceText,
    mustDepict: contract.sourceText,
    tier: contract.blockingLevel === 'treatment' ? 'authored' : 'seed',
  };
}

function pressureFor(contract: StoryCircleBeatRealizationContract, scene: PlannedScene): MechanicPressureContract | undefined {
  if (!contract.requiredRealization.includes('mechanic_pressure')) return undefined;
  return {
    id: `${contract.id}-pressure`,
    source: contract.blockingLevel === 'treatment' ? 'treatment' : 'planner',
    domain: contract.beat === 'change' || contract.beat === 'return' ? 'route' : 'flag',
    mechanicRef: { flag: contract.id },
    function: contract.beat === 'change' ? 'resolve' : contract.beat === 'return' ? 'payoff' : 'intensify',
    storyPressure: contract.stateChange ?? contract.sourceText,
    evidenceRequired: contract.eventAtoms,
    visibleResidue: ['show the beat changing story state, options, relationships, access, information, tone, or episode pressure'],
    allowedPayoffs: ['scene turn, choice pressure, reveal, route state, ending state, branch residue, or episode handoff'],
    blockedPayoffs: ['structural label only, metadata-only arc text, or summary that skips the authored beat event'],
    originatingSceneId: scene.id,
  };
}

export function assignStoryCircleBeatContractsToScenes(
  plan: Pick<SeasonPlan, 'storyCircleBeatContracts' | 'storyCircle' | 'legacyStructure' | 'totalEpisodes'> & {
    treatmentSeasonGuidance?: TreatmentSeasonGuidance;
  },
  scenes: PlannedScene[],
): StoryCircleBeatRealizationContract[] {
  const contracts = buildStoryCircleBeatContractsForPlan(plan);
  for (const contract of contracts) {
    if (storyCircleOwnsContract(contract, scenes)) {
      contract.targetSceneIds = [];
      continue;
    }
    const target = bestSceneForContract(contract, scenes);
    if (!target) continue;
    contract.targetSceneIds = dedupe([...contract.targetSceneIds, target.id]);
    const existing = target.storyCircleBeatContracts ?? [];
    if (!existing.some((candidate) => candidate.id === contract.id)) {
      target.storyCircleBeatContracts = [...existing, contract];
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

export function storyCircleBeatMatchThreshold(contract: StoryCircleBeatRealizationContract): number {
  const tokenCount = treatmentFieldTokens(contract.sourceText).length;
  if (tokenCount <= 4) return 0.45;
  if (contract.beat === 'return' || contract.beat === 'change') return 0.22;
  return 0.25;
}
