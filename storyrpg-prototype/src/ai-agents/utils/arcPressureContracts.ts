import type { SeasonArc, SeasonPlan } from '../../types/seasonPlan';
import type { TreatmentSeasonGuidance } from '../../types/sourceAnalysis';
import type {
  ArcPressureTreatmentContract,
  ArcPressureTreatmentContractKind,
  ArcPressureTreatmentRealizationTarget,
  MechanicPressureContract,
  PlannedScene,
  RequiredBeat,
} from '../../types/scenePlan';
import {
  treatmentFieldCloseMatch,
  treatmentFieldTokens,
} from './treatmentFieldContracts';

type AuthoredArcGuidance = NonNullable<TreatmentSeasonGuidance['arcGuidance']>['arcs'][number];

const STATE_PRESSURE_RE =
  /\b(reveal|recontextual|crisis|cost|failure|betray|handoff|pressure|collision|confession|choice|chooses?|returns?|leaves?|discovers?|realizes?|changes?|cracks?|crack|warn|warning|missing|lie|truth|voice|privacy|friend|friendship|wanted|courted|lure|funnel)\b/i;

function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56) || 'arc';
}

function dedupe<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

export function isSceneBoundArcPressureKind(kind: ArcPressureTreatmentContractKind): boolean {
  return kind !== 'arc_identity'
    && kind !== 'arc_question'
    && kind !== 'season_relation';
}

export function arcPressureContractTargetsEpisode(
  contract: Pick<ArcPressureTreatmentContract, 'targetEpisodeNumbers'>,
  episodeNumber: number,
): boolean {
  return contract.targetEpisodeNumbers.length === 0 || contract.targetEpisodeNumbers.includes(episodeNumber);
}

export function arcPressureContractTargetsScene(
  contract: Pick<ArcPressureTreatmentContract, 'targetEpisodeNumbers' | 'targetSceneIds'>,
  scene: Pick<PlannedScene, 'id' | 'episodeNumber'>,
): boolean {
  if (!arcPressureContractTargetsEpisode(contract, scene.episodeNumber)) return false;
  return contract.targetSceneIds.length === 0 || contract.targetSceneIds.includes(scene.id);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function eventAtoms(sourceText: string): string[] {
  const atoms = sourceText
    .split(/\s*(?:→|;|\.|\band\b|\bbut\b|\bwhile\b|\bso\b|,)\s*/i)
    .map((part) => part.trim().replace(/^[-–—:,]+|[-–—:,]+$/g, '').trim())
    .filter((part) => treatmentFieldTokens(part).length >= 3);
  return dedupe(atoms).slice(0, 8);
}

function episodeRangeFor(arc: Pick<SeasonArc, 'episodeRange'> | AuthoredArcGuidance, totalEpisodes: number): { start: number; end: number } {
  const range = 'episodeRange' in arc ? arc.episodeRange : undefined;
  const start = Math.max(1, Math.min(totalEpisodes, Number(range?.start) || 1));
  const end = Math.max(start, Math.min(totalEpisodes, Number(range?.end) || start));
  return { start, end };
}

function midpointEpisode(range: { start: number; end: number }): number {
  return Math.max(range.start, Math.min(range.end, Math.round((range.start + range.end) / 2)));
}

function crisisEpisode(range: { start: number; end: number }): number {
  return Math.max(range.start, Math.min(range.end, Math.ceil(range.start + Math.max(1, range.end - range.start) * (2 / 3))));
}

function requiredRealizationFor(kind: ArcPressureTreatmentContractKind, sourceText: string): ArcPressureTreatmentRealizationTarget[] {
  const targets: ArcPressureTreatmentRealizationTarget[] = ['season_arc'];
  switch (kind) {
    case 'arc_identity':
      return targets;
    case 'arc_question':
    case 'season_relation':
      targets.push('scene_turn', 'final_prose');
      break;
    case 'lie_facet':
      targets.push('scene_turn', 'choice', 'mechanic_pressure', 'final_prose');
      break;
    case 'arc_midpoint_recontextualization':
      targets.push('scene_turn', 'information_ledger', 'mechanic_pressure', 'final_prose');
      break;
    case 'arc_late_crisis':
      targets.push('scene_turn', 'choice', 'mechanic_pressure', 'episode_ending', 'final_prose');
      break;
    case 'arc_finale_answer':
      targets.push('scene_turn', 'episode_ending', 'final_prose');
      break;
    case 'arc_handoff_pressure':
      targets.push('scene_turn', 'mechanic_pressure', 'next_arc_plan', 'final_prose');
      break;
    case 'arc_episode_turnout':
      targets.push('scene_turn', 'episode_ending', 'final_prose');
      break;
  }
  if (STATE_PRESSURE_RE.test(sourceText) && !targets.includes('mechanic_pressure')) {
    targets.push('mechanic_pressure');
  }
  return dedupe(targets);
}

function contract(
  input: {
    arcId: string;
    arcTitle: string;
    source: ArcPressureTreatmentContract['source'];
    level: ArcPressureTreatmentContract['blockingLevel'];
    fieldName: string;
    kind: ArcPressureTreatmentContractKind;
    sourceText: string | undefined;
    targetEpisodeNumbers: number[];
  },
): ArcPressureTreatmentContract | undefined {
  const sourceText = text(input.sourceText);
  if (!sourceText) return undefined;
  const atoms = eventAtoms(sourceText);
  return {
    id: `arc-pressure-${slug(input.arcId)}-${input.kind}-${slug(sourceText)}`,
    source: input.source,
    arcId: input.arcId,
    arcTitle: input.arcTitle,
    fieldName: input.fieldName,
    sourceText,
    contractKind: input.kind,
    requiredRealization: requiredRealizationFor(input.kind, sourceText),
    targetEpisodeNumbers: dedupe(input.targetEpisodeNumbers).sort((a, b) => a - b),
    targetSceneIds: [],
    eventAtoms: atoms.length > 0 ? atoms : [sourceText],
    blockingLevel: input.level,
  };
}

function guidanceArcId(guidance: AuthoredArcGuidance): string {
  return `arc-${guidance.arcIndex || slug(guidance.title || 'arc')}`;
}

export function buildArcPressureContracts(input: {
  guidance?: TreatmentSeasonGuidance;
  arcs?: SeasonArc[];
  totalEpisodes: number;
  treatmentSourced?: boolean;
}): ArcPressureTreatmentContract[] {
  const out: ArcPressureTreatmentContract[] = [];
  const authored = input.guidance?.arcGuidance?.arcs ?? [];
  const treatmentLevel = input.treatmentSourced && authored.length > 0;
  const level: ArcPressureTreatmentContract['blockingLevel'] = treatmentLevel ? 'treatment' : 'warning';

  if (authored.length > 0) {
    for (const arc of authored) {
      const range = episodeRangeFor(arc, input.totalEpisodes);
      const episodeNumbers: number[] = [];
      for (let ep = range.start; ep <= range.end; ep += 1) episodeNumbers.push(ep);
      const arcId = guidanceArcId(arc);
      const arcTitle = arc.title || `Arc ${arc.arcIndex}`;
      const maybe = [
        contract({
          arcId,
          arcTitle,
          source: 'treatment',
          level,
          fieldName: 'Arc title / Episode range',
          kind: 'arc_identity',
          sourceText: `${arcTitle} Episodes ${range.start}-${range.end}`,
          targetEpisodeNumbers: episodeNumbers,
        }),
        contract({
          arcId,
          arcTitle,
          source: 'treatment',
          level,
          fieldName: 'Arc dramatic question',
          kind: 'arc_question',
          sourceText: arc.arcDramaticQuestion,
          targetEpisodeNumbers: [range.start, ...episodeNumbers],
        }),
        contract({
          arcId,
          arcTitle,
          source: 'treatment',
          level,
          fieldName: 'Relation to season question',
          kind: 'season_relation',
          sourceText: arc.relationToSeasonQuestion,
          targetEpisodeNumbers: episodeNumbers,
        }),
        contract({
          arcId,
          arcTitle,
          source: 'treatment',
          level,
          fieldName: 'Facet of protagonist Lie under pressure',
          kind: 'lie_facet',
          sourceText: arc.lieFacet,
          targetEpisodeNumbers: episodeNumbers,
        }),
        contract({
          arcId,
          arcTitle,
          source: 'treatment',
          level,
          fieldName: 'Midpoint recontextualization',
          kind: 'arc_midpoint_recontextualization',
          sourceText: arc.midpointRecontextualization,
          targetEpisodeNumbers: [midpointEpisode(range)],
        }),
        contract({
          arcId,
          arcTitle,
          source: 'treatment',
          level,
          fieldName: 'Late-arc crisis / all-is-lost beat',
          kind: 'arc_late_crisis',
          sourceText: arc.lateArcCrisis,
          targetEpisodeNumbers: [crisisEpisode(range)],
        }),
        contract({
          arcId,
          arcTitle,
          source: 'treatment',
          level,
          fieldName: 'Arc finale answer',
          kind: 'arc_finale_answer',
          sourceText: arc.finaleAnswer,
          targetEpisodeNumbers: [range.end],
        }),
        contract({
          arcId,
          arcTitle,
          source: 'treatment',
          level,
          fieldName: 'Handoff pressure to next arc or finale',
          kind: 'arc_handoff_pressure',
          sourceText: arc.handoffPressure,
          targetEpisodeNumbers: range.end < input.totalEpisodes ? [range.end, range.end + 1] : [range.end],
        }),
        ...(arc.episodeTurnouts ?? []).map((turnout) => contract({
          arcId,
          arcTitle,
          source: 'treatment',
          level,
          fieldName: `Episode ${turnout.episodeNumber} turnout`,
          kind: 'arc_episode_turnout',
          sourceText: turnout.sourceText || turnout.description,
          targetEpisodeNumbers: [turnout.episodeNumber],
        })),
      ];
      out.push(...maybe.filter(Boolean) as ArcPressureTreatmentContract[]);
    }
    return out;
  }

  for (const arc of input.arcs ?? []) {
    const range = episodeRangeFor(arc, input.totalEpisodes);
    const episodeNumbers: number[] = [];
    for (let ep = range.start; ep <= range.end; ep += 1) episodeNumbers.push(ep);
    out.push(...([
      contract({
        arcId: arc.id,
        arcTitle: arc.name,
        source: 'analysis_fallback',
        level,
        fieldName: 'Arc dramatic question',
        kind: 'arc_question',
        sourceText: arc.arcQuestion,
        targetEpisodeNumbers: episodeNumbers,
      }),
      contract({
        arcId: arc.id,
        arcTitle: arc.name,
        source: 'analysis_fallback',
        level,
        fieldName: 'Arc finale answer',
        kind: 'arc_finale_answer',
        sourceText: arc.finaleAnswer,
        targetEpisodeNumbers: [range.end],
      }),
    ].filter(Boolean) as ArcPressureTreatmentContract[]));
  }

  return out;
}

export function buildArcPressureContractsForPlan(
  plan: Pick<SeasonPlan, 'arcPressureContracts' | 'arcs' | 'totalEpisodes'> & {
    treatmentSeasonGuidance?: TreatmentSeasonGuidance;
  },
): ArcPressureTreatmentContract[] {
  const existing = plan.arcPressureContracts ?? [];
  if (existing.length > 0) {
    if (plan.treatmentSeasonGuidance?.arcGuidance?.arcs?.length) {
      const canonical = buildArcPressureContracts({
        guidance: plan.treatmentSeasonGuidance,
        arcs: plan.arcs,
        totalEpisodes: plan.totalEpisodes,
        treatmentSourced: true,
      });
      const canonicalById = new Map(canonical.map((contract) => [contract.id, contract]));
      const canonicalBySignature = new Map(canonical.map((contract) => [
        `${contract.arcId}:${contract.contractKind}:${contract.sourceText}`,
        contract,
      ]));
      return existing.map((contract) => {
        const authoritative = canonicalById.get(contract.id)
          ?? canonicalBySignature.get(`${contract.arcId}:${contract.contractKind}:${contract.sourceText}`);
        if (!authoritative) return contract;
        const targetEpisodesChanged = contract.targetEpisodeNumbers.join(',') !== authoritative.targetEpisodeNumbers.join(',');
        return {
          ...contract,
          blockingLevel: authoritative.blockingLevel,
          eventAtoms: authoritative.eventAtoms,
          requiredRealization: authoritative.requiredRealization,
          targetEpisodeNumbers: authoritative.targetEpisodeNumbers,
          targetSceneIds: targetEpisodesChanged ? [] : contract.targetSceneIds,
        };
      });
    }
    const arcRanges = new Map((plan.arcs ?? []).map((arc) => [arc.id, episodeRangeFor(arc, plan.totalEpisodes)]));
    return existing.map((contract) => {
      if (contract.contractKind !== 'arc_late_crisis') return contract;
      const range = arcRanges.get(contract.arcId);
      if (!range) return contract;
      const targetEpisodeNumbers = [crisisEpisode(range)];
      const targetEpisodesChanged = contract.targetEpisodeNumbers.join(',') !== targetEpisodeNumbers.join(',');
      return {
        ...contract,
        targetEpisodeNumbers,
        targetSceneIds: targetEpisodesChanged ? [] : contract.targetSceneIds,
      };
    });
  }
  return buildArcPressureContracts({
    guidance: plan.treatmentSeasonGuidance,
    arcs: plan.arcs,
    totalEpisodes: plan.totalEpisodes,
    treatmentSourced: Boolean(plan.treatmentSeasonGuidance?.arcGuidance?.arcs?.length),
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
    scene.encounter?.aftermathConsequence,
    ...(scene.requiredBeats ?? []).map((beat) => `${beat.sourceTurn} ${beat.mustDepict}`),
    ...(scene.mechanicPressure ?? []).map((pressure) => pressure.storyPressure),
  ].filter(Boolean).join(' ');
}

function scoreScene(contract: ArcPressureTreatmentContract, scene: PlannedScene): number {
  let score = treatmentFieldCloseMatch(contract.sourceText, sceneText(scene), arcPressureMatchThreshold(contract)) ? 1 : 0;
  if (contract.targetEpisodeNumbers.includes(scene.episodeNumber)) score += 0.45;
  if (scene.narrativeRole === 'turn' && (
    contract.contractKind === 'arc_question'
    || contract.contractKind === 'lie_facet'
    || contract.contractKind === 'arc_midpoint_recontextualization'
  )) score += 0.35;
  if ((scene.narrativeRole === 'payoff' || scene.kind === 'encounter') && contract.contractKind === 'arc_late_crisis') score += 0.35;
  if (scene.narrativeRole === 'release' && (
    contract.contractKind === 'arc_finale_answer'
    || contract.contractKind === 'arc_handoff_pressure'
    || contract.contractKind === 'arc_episode_turnout'
  )) score += 0.35;
  if (scene.hasChoice && (contract.contractKind === 'lie_facet' || contract.contractKind === 'arc_late_crisis')) score += 0.25;
  return score;
}

function bestSceneForEpisode(contract: ArcPressureTreatmentContract, scenes: PlannedScene[], episodeNumber: number): PlannedScene | undefined {
  const candidates = scenes.filter((scene) => scene.episodeNumber === episodeNumber);
  if (candidates.length === 0) return undefined;
  if (
    contract.contractKind === 'arc_episode_turnout'
    || contract.contractKind === 'arc_finale_answer'
    || contract.contractKind === 'arc_handoff_pressure'
  ) {
    const endingCandidates = candidates.filter((scene) =>
      scene.narrativeRole === 'release'
      || scene.narrativeRole === 'payoff'
    );
    const orderedEndingCandidates = endingCandidates.length > 0 ? endingCandidates : candidates;
    if (orderedEndingCandidates.length > 0) {
      return orderedEndingCandidates
        .map((scene) => ({ scene, score: scoreScene(contract, scene) }))
        .sort((a, b) => {
          const releaseDelta = Number(b.scene.narrativeRole === 'release') - Number(a.scene.narrativeRole === 'release');
          if (releaseDelta !== 0) return releaseDelta;
          return b.scene.order - a.scene.order || b.score - a.score;
        })[0]?.scene;
    }
  }
  return candidates
    .map((scene) => ({ scene, score: scoreScene(contract, scene) }))
    .sort((a, b) => b.score - a.score || a.scene.order - b.scene.order)[0]?.scene;
}

function shouldRequireBeat(contract: ArcPressureTreatmentContract): boolean {
  return contract.blockingLevel !== 'warning'
    && contract.contractKind !== 'arc_identity'
    && contract.contractKind !== 'arc_question'
    && contract.contractKind !== 'season_relation';
}

function requiredBeatFor(contract: ArcPressureTreatmentContract, scene: PlannedScene): RequiredBeat {
  return {
    id: `${scene.id}-arc-pressure-${slug(contract.contractKind)}`,
    sourceTurn: contract.sourceText,
    mustDepict: contract.sourceText,
    tier: contract.blockingLevel === 'treatment' ? 'authored' : 'seed',
  };
}

function pressureDomain(contract: ArcPressureTreatmentContract): MechanicPressureContract['domain'] {
  if (contract.contractKind === 'lie_facet') return 'identity';
  if (contract.contractKind === 'arc_midpoint_recontextualization') return 'information';
  if (contract.contractKind === 'arc_late_crisis') return 'resource';
  if (contract.contractKind === 'arc_handoff_pressure') return 'route';
  if (contract.contractKind === 'arc_finale_answer' || contract.contractKind === 'arc_episode_turnout') return 'flag';
  return 'flag';
}

function pressureFor(contract: ArcPressureTreatmentContract, scene: PlannedScene): MechanicPressureContract | undefined {
  if (!isSceneBoundArcPressureKind(contract.contractKind)) return undefined;
  if (!contract.requiredRealization.includes('mechanic_pressure')) return undefined;
  return {
    id: `${contract.id}-pressure`,
    source: contract.source === 'treatment' ? 'treatment' : 'planner',
    domain: pressureDomain(contract),
    mechanicRef: { flag: contract.id },
    function: contract.contractKind === 'arc_finale_answer'
      ? 'resolve'
      : contract.contractKind === 'arc_handoff_pressure'
        ? 'plant'
        : contract.contractKind === 'arc_late_crisis'
          ? 'complicate'
          : 'intensify',
    storyPressure: contract.sourceText,
    evidenceRequired: contract.eventAtoms,
    visibleResidue: ['show how the arc pressure changes behavior, options, information, trust, cost, identity, access, or episode state'],
    allowedPayoffs: ['scene turn, major choice pressure, reveal, route state, episode turnout, next-arc handoff, or ending state'],
    blockedPayoffs: ['arc title only, treatment summary only, act label only, or state change claimed without on-page cost/residue'],
    originatingSceneId: scene.id,
  };
}

export function assignArcPressureContractsToScenes(
  plan: Pick<SeasonPlan, 'arcPressureContracts' | 'arcs' | 'totalEpisodes'> & {
    treatmentSeasonGuidance?: TreatmentSeasonGuidance;
  },
  scenes: PlannedScene[],
): ArcPressureTreatmentContract[] {
  const contracts = buildArcPressureContractsForPlan(plan);
  const canonicalById = new Map(contracts.map((contract) => [contract.id, contract]));
  const canonicalBySignature = new Map(contracts.map((contract) => [
    `${contract.arcId}:${contract.contractKind}:${contract.sourceText}`,
    contract,
  ]));

  for (const scene of scenes) {
    const existing = scene.arcPressureContracts ?? [];
    if (existing.length === 0) continue;
    const normalized = existing.map((contract) =>
      canonicalById.get(contract.id)
      ?? canonicalBySignature.get(`${contract.arcId}:${contract.contractKind}:${contract.sourceText}`)
      ?? contract
    );
    const kept = normalized.filter((contract) =>
      isSceneBoundArcPressureKind(contract.contractKind)
      && arcPressureContractTargetsScene(contract, scene)
    );
    const removed = normalized.filter((contract) => !kept.some((candidate) => candidate.id === contract.id));
    if (removed.length === 0 && kept.length === existing.length) {
      scene.arcPressureContracts = kept;
      continue;
    }
    const removedIds = new Set(removed.map((contract) => contract.id));
    const removedTexts = new Set(removed.map((contract) => contract.sourceText));
    scene.arcPressureContracts = kept;
    scene.requiredBeats = scene.requiredBeats?.filter((beat) =>
      !removedTexts.has(beat.sourceTurn)
      && !removedTexts.has(beat.mustDepict)
      && !Array.from(removedIds).some((id) => beat.id.includes(id) || beat.id.includes(slug(id)))
    );
    scene.mechanicPressure = scene.mechanicPressure?.filter((pressure) =>
      !removedIds.has(pressure.id)
      && !removedIds.has(pressure.mechanicRef?.flag ?? '')
      && !removedTexts.has(pressure.storyPressure)
    );
  }

  for (const contract of contracts) {
    if (!isSceneBoundArcPressureKind(contract.contractKind)) continue;
    for (const episodeNumber of contract.targetEpisodeNumbers) {
      const target = bestSceneForEpisode(contract, scenes, episodeNumber);
      if (!target) continue;
      contract.targetSceneIds = dedupe([...contract.targetSceneIds, target.id]);
      const existing = target.arcPressureContracts ?? [];
      if (!existing.some((candidate) => candidate.id === contract.id)) {
        target.arcPressureContracts = [...existing, contract];
      }
      if (shouldRequireBeat(contract)) {
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
  }
  return contracts;
}

export function arcPressureMatchThreshold(contract: ArcPressureTreatmentContract): number {
  const tokenCount = treatmentFieldTokens(contract.sourceText).length;
  if (contract.contractKind === 'arc_identity') return 0.45;
  if (tokenCount <= 3) return 0.45;
  if (contract.contractKind === 'arc_finale_answer' || contract.contractKind === 'arc_episode_turnout') return 0.24;
  return 0.27;
}

export function findAuthoredArcGuidanceForArc(
  arc: Partial<SeasonArc>,
  guidance?: TreatmentSeasonGuidance,
): AuthoredArcGuidance | undefined {
  const arcs = guidance?.arcGuidance?.arcs ?? [];
  if (arcs.length === 0) return undefined;
  const name = text(arc.name).toLowerCase();
  const range = arc.episodeRange;
  return arcs.find((candidate) => {
    if (name && candidate.title && treatmentFieldCloseMatch(candidate.title, name, 0.45)) return true;
    return Boolean(range && candidate.episodeRange
      && candidate.episodeRange.start === range.start
      && candidate.episodeRange.end === range.end);
  });
}

export function arcGuidanceId(guidance: AuthoredArcGuidance): string {
  return guidanceArcId(guidance);
}
