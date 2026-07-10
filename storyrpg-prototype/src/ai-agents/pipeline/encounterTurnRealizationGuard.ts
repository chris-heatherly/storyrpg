/**
 * Assessment-only guard for authored encounter turn realization.
 *
 * DO NOT add a deterministic "repair" that writes contract/treatment text into
 * encounter prose. A previous repair here prepended the raw authored moment
 * plus a validator-register marker ("The encounter outcome changes on-page.")
 * onto storylet outcome beats. Because the injected text carried exactly the
 * tokens this assessment scores, it gamed the check, suppressed the LLM
 * retry-with-feedback loop in ContentGenerationPhase, and shipped 3rd-person /
 * planning-register / out-of-order prose to readers (bite-me, 2026-07).
 * Under-realized encounters must fail this assessment so the caller's
 * regeneration path fixes them in authored prose.
 */
import type { Scene } from '../../types';
import type { RequiredBeat, SceneTurnContract } from '../../types/scenePlan';
import type { EncounterStructure } from '../agents/EncounterArchitect';
import type { SceneBlueprint } from '../agents/StoryArchitect';
import { missingMomentTokens, momentDepicted } from '../remediation/realizationScoring';
import { isGenericScenePlannerText } from '../utils/sceneContractBuilders';
import { extractPreservedMarkers } from '../utils/treatmentEventAtomizer';
import {
  collectReaderFacingTexts,
  collectReaderFacingTextsForEncounterOutcomeTier,
  ENCOUNTER_OUTCOME_TIERS,
} from '../validators/encounterTextSurfaces';
import { normalizeRealizationText } from '../remediation/realizationEvaluator';

export interface EncounterTurnRealizationMiss {
  label: string;
  moment: string;
  missingTokens: string[];
  /** When set, the miss is scoped to one playable outcome tier's reader path. */
  outcomeTier?: string;
}

export interface EncounterTurnRealizationAssessment {
  passed: boolean;
  prose: string;
  misses: EncounterTurnRealizationMiss[];
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function normalizeForPattern(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function depictsDeclinedEntry(moment: string, prose: string): boolean {
  const needle = normalizeForPattern(moment);
  if (!/\bdeclin(?:e|es|ed|ing)\s+to\s+come\s+in\b|\brefus(?:e|es|ed|ing)\s+to\s+(?:come\s+in|enter)\b/.test(needle)) {
    return false;
  }
  const hay = normalizeForPattern(prose);
  return [
    /\bdeclin(?:e|es|ed|ing)\b[\s\S]{0,80}\b(?:come\s+in|enter|inside|cross)\b/,
    /\brefus(?:e|es|ed|ing)\b[\s\S]{0,80}\b(?:come\s+in|enter|inside|cross)\b/,
    /\b(?:will\s+not|won\s+t|doesn\s+t|does\s+not)\b[\s\S]{0,80}\b(?:come\s+in|enter|inside|cross)\b/,
  ].some((pattern) => pattern.test(hay));
}

function missingTokensCoveredByEncounterSynonyms(miss: EncounterTurnRealizationMiss, prose: string): boolean {
  const missing = new Set(miss.missingTokens.map((token) => normalizeForPattern(token)));
  const declineEntryTokens = new Set(['decline', 'declines', 'declined', 'declining', 'come']);
  if (missing.size === 0) return false;
  if (![...missing].every((token) => declineEntryTokens.has(token))) return false;
  return depictsDeclinedEntry(miss.moment, prose);
}

function concreteTurnMoment(contract: SceneTurnContract | undefined): string {
  if (!contract) return '';
  const central = cleanText(contract.centralTurn);
  if (central && !isGenericScenePlannerText(central)) return central;
  const event = cleanText(contract.turnEvent);
  if (event && !isGenericScenePlannerText(event)) return event;
  return '';
}

function concreteRequiredBeatMoments(beats: RequiredBeat[] | undefined): Array<{ label: string; moment: string }> {
  const out: Array<{ label: string; moment: string }> = [];
  for (const beat of beats ?? []) {
    if (beat.tier === 'connective' || beat.tier === 'seed') continue;
    const moment = cleanText(beat.mustDepict || beat.sourceTurn);
    if (!moment || isGenericScenePlannerText(moment)) continue;
    out.push({ label: `required beat ${beat.id || beat.tier}`, moment });
  }
  return out;
}

function uniqueMoments(moments: Array<{ label: string; moment: string }>): Array<{ label: string; moment: string }> {
  const seen = new Set<string>();
  const out: Array<{ label: string; moment: string }> = [];
  for (const entry of moments) {
    const key = entry.moment.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

/** Signature atoms (preserved markers + concrete content phrases) that every terminal must realize. */
function signatureAtomsForMoments(moments: Array<{ label: string; moment: string }>): string[] {
  const atoms = new Set<string>();
  for (const { moment } of moments) {
    for (const marker of extractPreservedMarkers(moment)) {
      const cleaned = cleanText(marker);
      if (cleaned) atoms.add(cleaned);
    }
  }
  return Array.from(atoms);
}

function atomPresentInProse(atom: string, prose: string): boolean {
  const needle = normalizeRealizationText(atom);
  if (!needle) return true;
  const hay = normalizeRealizationText(prose);
  if (hay.includes(needle)) return true;
  // Soft clock-time / viral equivalence (mirrors TreatmentEventLedgerValidator).
  if (/^\d{1,2}\s*a\.?m\.?$/i.test(atom) || /^4am$/i.test(atom)) {
    return /\b4\s*a\.?m\.?\b|\bfour\s+(?:in\s+the\s+)?morning\b/.test(hay);
  }
  if (/^viral$/i.test(atom) || /^gone viral$/i.test(atom)) {
    return /\bviral\b|\bgone\s+viral\b/.test(hay);
  }
  return false;
}

export function assessEncounterTurnRealization(
  sceneBlueprint: Pick<SceneBlueprint, 'id' | 'name' | 'turnContract' | 'requiredBeats' | 'signatureMoment'>,
  encounter: EncounterStructure,
): EncounterTurnRealizationAssessment {
  const scene = {
    id: sceneBlueprint.id,
    name: sceneBlueprint.name,
    beats: [],
    encounter,
  } as unknown as Scene;
  const prose = collectReaderFacingTexts(scene).join(' ');
  const moments = uniqueMoments([
    ...(concreteTurnMoment(sceneBlueprint.turnContract)
      ? [{ label: 'scene turn', moment: concreteTurnMoment(sceneBlueprint.turnContract) }]
      : []),
    ...(cleanText(sceneBlueprint.signatureMoment) && !isGenericScenePlannerText(sceneBlueprint.signatureMoment)
      ? [{ label: 'signature moment', moment: cleanText(sceneBlueprint.signatureMoment) }]
      : []),
    ...concreteRequiredBeatMoments(sceneBlueprint.requiredBeats),
  ]);
  const misses: EncounterTurnRealizationMiss[] = moments
    .filter(({ moment }) => !momentDepicted('RequiredBeatRealizationValidator', moment, prose))
    .map(({ label, moment }) => ({
      label,
      moment,
      missingTokens: missingMomentTokens('RequiredBeatRealizationValidator', moment, prose),
    }))
    .filter((miss) => !missingTokensCoveredByEncounterSynonyms(miss, prose));

  // Per-tier check: success paths must each carry the full turn/required moment.
  // Defeat/escape get the signature-atom lock below (same load-bearing markers)
  // without requiring the entire compound turn on every failure path.
  const byTier = collectReaderFacingTextsForEncounterOutcomeTier(scene, ENCOUNTER_OUTCOME_TIERS);
  const successTiers = new Set(['victory', 'partialVictory', 'success', 'complicated']);
  const signatureAtoms = signatureAtomsForMoments(moments);
  for (const [tier, tierTexts] of byTier) {
    const tierProse = tierTexts.join(' ');
    if (!tierProse.trim()) continue;
    if (successTiers.has(tier)) {
      for (const { label, moment } of moments) {
        if (momentDepicted('RequiredBeatRealizationValidator', moment, tierProse)) continue;
        if (missingTokensCoveredByEncounterSynonyms({
          label,
          moment,
          missingTokens: missingMomentTokens('RequiredBeatRealizationValidator', moment, tierProse),
        }, tierProse)) continue;
        const missingTokens = missingMomentTokens('RequiredBeatRealizationValidator', moment, tierProse);
        // Avoid duplicate global misses when the union also failed.
        if (misses.some((m) => m.label === label && !m.outcomeTier && m.moment === moment)) continue;
        misses.push({
          label: `${label} [${tier}]`,
          moment,
          missingTokens,
          outcomeTier: tier,
        });
      }
    }
    // Signature-atom lock across ALL terminals with tier-specific prose.
    for (const atom of signatureAtoms) {
      if (atomPresentInProse(atom, tierProse)) continue;
      if (misses.some((m) => m.outcomeTier === tier && m.moment === atom)) continue;
      misses.push({
        label: `signature atom [${tier}]`,
        moment: atom,
        missingTokens: [atom],
        outcomeTier: tier,
      });
    }
  }

  return { passed: misses.length === 0, prose, misses };
}

export function formatEncounterTurnRealizationFeedback(assessment: EncounterTurnRealizationAssessment): string {
  if (assessment.passed) return '';
  return assessment.misses
    .map((miss) => {
      const missing = miss.missingTokens.length > 0
        ? ` Missing content words: ${miss.missingTokens.join(', ')}.`
        : '';
      const tier = miss.outcomeTier ? ` (outcome path: ${miss.outcomeTier})` : '';
      return `- ${miss.label}${tier} is under-realized: "${miss.moment}".${missing}`;
    })
    .join('\n');
}
