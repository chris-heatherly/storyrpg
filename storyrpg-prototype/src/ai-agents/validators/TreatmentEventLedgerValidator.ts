import type { Beat, Scene, Story } from '../../types';
import type { StoryCircleBeatRealizationContract } from '../../types/scenePlan';
import { evaluateMomentRealization, normalizeRealizationText } from '../remediation/realizationEvaluator';
import { BaseValidator } from './BaseValidator';

export type TreatmentEventLedgerStatus = 'missing' | 'summary_only';

export interface TreatmentEventLedgerFinding {
  status: TreatmentEventLedgerStatus;
  severity: 'error' | 'warning';
  episodeId?: string;
  episodeNumber?: number;
  sceneId: string;
  contractId: string;
  sourceText: string;
  message: string;
  suggestion: string;
}

export interface TreatmentEventLedgerResult {
  valid: boolean;
  findings: TreatmentEventLedgerFinding[];
}

export interface TreatmentEventLedgerInput {
  story: Story;
  treatmentSourced?: boolean;
  requestedEpisodeNumbers?: number[];
  generatedEpisodeNumbers?: number[];
}

const SUMMARY_ONLY_RE =
  /\b(?:two\s+weeks?|three\s+weeks?|weeks?\s+ago|days?\s+ago|earlier|before\s+tonight|back\s+then|once|remembered|recalled|memory|backstory|it\s+was\s+on\s+one\s+of\s+those|had\s+(?:appeared|intervened|rescued|saved|happened|been|come|gone|left|met|found|started|landed))\b/i;

function textOfBeat(beat: Beat): string {
  const rawVariants = (beat as { textVariants?: unknown }).textVariants;
  const textVariants = Array.isArray(rawVariants)
    ? rawVariants
    : rawVariants && typeof rawVariants === 'object'
      ? [rawVariants]
      : [];
  return [
    beat.text,
    ...textVariants.map((variant) => (variant as { text?: unknown }).text),
  ].filter(Boolean).join(' ');
}

function readerFacingSceneProse(scene: Scene): string {
  const parts: string[] = [scene.name, ...(scene.beats || []).map(textOfBeat)];
  const enc = scene.encounter as
    | { situation?: string; phases?: Array<{ beats?: unknown[] }>; storylets?: unknown }
    | undefined;
  if (enc?.situation) parts.push(enc.situation);
  const collect = (beats: unknown[] | undefined): void => {
    for (const raw of beats || []) {
      const beat = raw as Partial<Beat> & { setupText?: string; escalationText?: string };
      parts.push(beat.text || '', beat.setupText || '', beat.escalationText || '');
    }
  };
  if (enc) {
    for (const phase of enc.phases || []) collect(phase.beats);
    const storylets = Array.isArray(enc.storylets)
      ? enc.storylets
      : Object.values((enc.storylets ?? {}) as Record<string, unknown>);
    for (const storylet of storylets) collect((storylet as { beats?: unknown[] } | undefined)?.beats);
  }
  return parts.filter(Boolean).join('\n');
}

function readerFacingEpisodeProse(scenes: Scene[]): string {
  return scenes.map(readerFacingSceneProse).filter(Boolean).join('\n');
}

function proseWindows(prose: string): string[] {
  const sentences = prose
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const windows: string[] = [];
  for (let i = 0; i < sentences.length; i += 1) {
    for (let size = 1; size <= 3 && i + size <= sentences.length; size += 1) {
      windows.push(sentences.slice(i, i + size).join(' '));
    }
  }
  return windows.length > 0 ? windows : [prose];
}

function nonSummaryProse(prose: string): string {
  return proseWindows(prose).filter((window) => !SUMMARY_ONLY_RE.test(window)).join(' ');
}

function isAbstractTrajectoryClause(clause: string): boolean {
  const normalized = normalizeRealizationText(clause);
  return /\b(?:begin|begins|began|build|builds|building|start|starts|started)\b/.test(normalized)
    && /\b(?:new|fresh|glamorous|better)\s+(?:life|start)\b/.test(normalized);
}

function ledgerMomentDepicted(moment: string, prose: string): boolean {
  const assessment = evaluateMomentRealization('RequiredBeatRealizationValidator', moment, prose);
  if (assessment.depicted) return true;
  if (
    assessment.mode === 'compound-clauses'
    && assessment.missingClauses.length > 0
    && assessment.missingClauses.every(isAbstractTrajectoryClause)
    && assessment.matchedClauses.length >= 2
  ) {
    return true;
  }
  return false;
}

function isMustDramatize(contract: StoryCircleBeatRealizationContract, treatmentSourced?: boolean): boolean {
  if (contract.blockingLevel !== 'treatment') return false;
  return contract.requiredRealization.includes('final_prose')
    && contract.requiredRealization.includes('scene_turn');
}

function activeEpisodeSet(input: TreatmentEventLedgerInput): Set<number> | undefined {
  const numbers = [
    ...(input.requestedEpisodeNumbers || []),
    ...(input.generatedEpisodeNumbers || []),
  ].filter((value): value is number => Number.isFinite(value));
  return numbers.length > 0 ? new Set(numbers) : undefined;
}

function inActiveEpisodeScope(
  episodeNumber: number | undefined,
  contract: StoryCircleBeatRealizationContract,
  activeEpisodes: Set<number> | undefined,
): boolean {
  if (typeof episodeNumber === 'number' && activeEpisodes && !activeEpisodes.has(episodeNumber)) {
    return false;
  }
  if (
    typeof episodeNumber === 'number'
    && typeof contract.targetEpisodeNumber === 'number'
    && contract.targetEpisodeNumber !== episodeNumber
  ) {
    return false;
  }
  return true;
}

function directWindowDepicts(moment: string, windows: string[]): boolean {
  return windows.some((window) => {
    if (SUMMARY_ONLY_RE.test(window)) return false;
    return ledgerMomentDepicted(moment, window);
  });
}

export function hasDirectTreatmentEventRealization(moment: string, prose: string): boolean {
  const windows = proseWindows(prose);
  return directWindowDepicts(moment, windows) || ledgerMomentDepicted(moment, nonSummaryProse(prose));
}

function directRealizationStatus(
  contract: StoryCircleBeatRealizationContract,
  prose: string,
): 'direct' | TreatmentEventLedgerStatus {
  const sourceText = contract.sourceText.trim();
  const atoms = (contract.eventAtoms || []).map((atom) => atom.trim()).filter(Boolean);
  const globalDepicted =
    ledgerMomentDepicted(sourceText, prose)
    || atoms.some((atom) => ledgerMomentDepicted(atom, prose));
  if (!globalDepicted) return 'missing';

  const windows = proseWindows(prose);
  if (directWindowDepicts(sourceText, windows)) return 'direct';

  const meaningfulAtoms = atoms.length > 0 ? atoms : [sourceText];
  const directAtoms = meaningfulAtoms.every((atom) => directWindowDepicts(atom, windows));
  return directAtoms ? 'direct' : 'summary_only';
}

function episodeLevelDirectRealization(contract: StoryCircleBeatRealizationContract, prose: string): boolean {
  const sourceText = contract.sourceText.trim();
  const atoms = (contract.eventAtoms || []).map((atom) => atom.trim()).filter(Boolean);
  const filteredProse = nonSummaryProse(prose);
  if (!filteredProse) return false;
  if (ledgerMomentDepicted(sourceText, filteredProse)) {
    return true;
  }
  return atoms.length > 0
    && atoms.every((atom) => ledgerMomentDepicted(atom, filteredProse));
}

export class TreatmentEventLedgerValidator extends BaseValidator {
  constructor() {
    super('TreatmentEventLedgerValidator');
  }

  validate(input: TreatmentEventLedgerInput): TreatmentEventLedgerResult {
    const findings: TreatmentEventLedgerFinding[] = [];
    const activeEpisodes = activeEpisodeSet(input);

    for (const episode of input.story.episodes || []) {
      if (typeof episode.number === 'number' && activeEpisodes && !activeEpisodes.has(episode.number)) {
        continue;
      }
      const episodeProse = readerFacingEpisodeProse(episode.scenes || []);
      for (const scene of episode.scenes || []) {
        const prose = readerFacingSceneProse(scene);
        for (const contract of scene.storyCircleBeatContracts || []) {
          if (!contract.requiredRealization.includes('final_prose')) continue;
          if (!isMustDramatize(contract, input.treatmentSourced)) continue;
          if (!inActiveEpisodeScope(episode.number, contract, activeEpisodes)) continue;
          if (contract.targetSceneIds.length > 0 && !contract.targetSceneIds.includes(scene.id)) continue;

          const status = directRealizationStatus(contract, prose);
          if (status === 'direct') continue;
          if (episodeLevelDirectRealization(contract, episodeProse)) continue;

          const severity: 'error' | 'warning' = input.treatmentSourced ? 'error' : 'warning';
          const message = status === 'summary_only'
            ? `Treatment event ledger summary-only realization in scene "${scene.id}": must dramatize on-page, not summarize as memory/backstory: "${contract.sourceText}".`
            : `Treatment event ledger miss in scene "${scene.id}": must dramatize on-page, not summarize later: "${contract.sourceText}".`;
          findings.push({
            status,
            severity,
            episodeId: episode.id,
            episodeNumber: episode.number,
            sceneId: scene.id,
            contractId: contract.id,
            sourceText: contract.sourceText,
            message,
            suggestion:
              `Stage the authored Story Circle ${contract.beat} as present-tense reader-facing action in this scene; summary, memory, or later recap is not sufficient.`,
          });
        }
      }
    }

    return {
      valid: findings.every((finding) => finding.severity !== 'error'),
      findings,
    };
  }
}
