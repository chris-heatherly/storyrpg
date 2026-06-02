/**
 * Canon-consistency validator (Season Canon, Phase 3).
 *
 * Catches the recurring impossible-knowledge bug: an episode has a character act
 * on a fact they could not yet know. It checks STRUCTURED knowledge claims (the
 * LLM-extracted "in episode N, character C references fact F") against the frozen
 * SeasonCanon's who-knows-what-when ledger — deterministically, by factId.
 *
 * State-scoped, so it never false-alarms: a claim is impossible ONLY when the
 * canon says the character learns that fact in a LATER episode. A fact the
 * character genuinely learns THIS episode is fine; an unknown factId is treated
 * as newly introduced this episode (advisory, not blocking) rather than an error,
 * because not every reference is a canon fact.
 *
 * Pure functions over a SeasonCanon — unit-testable, no I/O. Wiring into the
 * per-episode seal is Phase 4.
 */

import type { SeasonCanon } from '../pipeline/seasonCanon';
import type { ValidationIssue, ValidationResult } from './BaseValidator';

/** "In `episode`, `characterId` references/acts on fact `factId`." */
export interface KnowledgeClaim {
  characterId: string;
  factId: string;
  summary?: string;
  episode: number;
}

/**
 * Flag impossible knowledge: a claim where the canon establishes the fact for the
 * character only in a LATER episode. Returns blocking issues.
 */
export function validateKnowledgeConsistency(
  claims: KnowledgeClaim[],
  canon: SeasonCanon,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const claim of claims) {
    const establishedAt = canon.knowledgeEstablishedEpisode(claim.characterId, claim.factId);
    // Unknown fact: not yet in canon → treated as introduced this episode (the
    // seal will freeze it). Not an error here.
    if (establishedAt === undefined) continue;
    if (establishedAt > claim.episode) {
      issues.push({
        severity: 'error',
        message: `Impossible knowledge: in episode ${claim.episode}, ${claim.characterId} acts on "${claim.summary ?? claim.factId}", but they don't learn it until episode ${establishedAt}.`,
        location: `knowledge:${claim.characterId}:${claim.factId}`,
        suggestion: `Either move the establishing reveal to episode ${claim.episode} or earlier, or remove this reference until episode ${establishedAt}.`,
      });
    }
  }
  return issues;
}

export interface CanonConsistencyInput {
  canon: SeasonCanon;
  claims: KnowledgeClaim[];
}

export function validateCanonConsistency(input: CanonConsistencyInput): ValidationResult {
  const issues = validateKnowledgeConsistency(input.claims, input.canon);
  return {
    valid: issues.every((i) => i.severity !== 'error'),
    score: issues.length === 0 ? 100 : Math.max(0, 100 - issues.length * 20),
    issues,
    suggestions: issues.map((i) => i.suggestion).filter((s): s is string => !!s),
  };
}
