/**
 * Flag-consumption audit (treatment-gap analysis 2026-07-15, G3).
 *
 * Choice consequences were write-only: run 20-44-49 set 38 flags and read 17
 * — including the episode's THEMATIC spine choice (dad_post1_tone_*), whose
 * viral aftermath ignored the player entirely. And the machinery demonstrably
 * works when wired: the aftermath conditions on two of the three Dusk-Club
 * founding flags while the third sibling silently lost its reflection.
 *
 * This is the INVERSE edge of the obligation ledger's "seed declared but no
 * choice sets it": a flag SET but never READ is a promise made to the player
 * and dropped. Advisory by design — findings land as final-contract warnings
 * and ledger metrics, never blockers.
 */

import type { Story } from '../../types';

/**
 * Season-scope flag families that are legitimately consumed by LATER episodes
 * (or by season-level systems), so an in-episode read is not required. Keep
 * this list justified: anything here is invisible to the audit.
 */
const SEASON_SCOPE_FLAG_RE = [
  // Personality tint accumulators; read by season-level tone/ending logic.
  /^tint:/,
  // Cross-episode treatment chains; the next episode's plan consumes them.
  /^consequence_treatment_chain_/,
  // Branch-topology markers stamped for route accounting, not prose.
  /^treatment_branch_/,
  // Structural flags (encounter outcome plumbing etc.) have their own contract.
  /^encounter_/,
];

export interface FlagConsumptionFinding {
  type: 'flag_never_consumed' | 'flag_family_asymmetric_variants';
  flag: string;
  sceneId?: string;
  /** For asymmetric families: the sibling flags that DO have a read at the site. */
  consumedSiblings?: string[];
  message: string;
}

export interface FlagConsumptionAudit {
  setFlags: Map<string, { sceneId?: string; siblingFamily: string[] }>;
  readFlags: Set<string>;
  findings: FlagConsumptionFinding[];
}

type AnyRecord = Record<string, unknown>;

function collectReads(value: unknown, reads: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectReads(item, reads);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const record = value as AnyRecord;
  // textVariant / choice / encounter conditions: { type: 'flag', flag: 'x' }
  if (record.type === 'flag' && typeof record.flag === 'string') reads.add(record.flag);
  // requiredFlags / requiresFlags arrays of names
  for (const key of ['requiredFlags', 'requiresFlags']) {
    const flags = record[key];
    if (Array.isArray(flags)) for (const flag of flags) if (typeof flag === 'string') reads.add(flag);
  }
  for (const child of Object.values(record)) collectReads(child, reads);
}

function collectSets(story: Story): Map<string, { sceneId?: string; siblingFamily: string[] }> {
  const sets = new Map<string, { sceneId?: string; siblingFamily: string[] }>();
  for (const episode of story.episodes ?? []) {
    for (const scene of episode.scenes ?? []) {
      const sceneRecord = scene as unknown as AnyRecord;
      const surfaces: unknown[] = [sceneRecord.beats, sceneRecord.encounter].filter(Boolean);
      for (const surface of surfaces) {
        visitChoiceGroups(surface, (choices) => {
          // Flags set by sibling choices of one beat form a mutually-exclusive family.
          const family = choices.flatMap((choice) => flagsSetByChoice(choice));
          for (const choice of choices) {
            for (const flag of flagsSetByChoice(choice)) {
              if (!sets.has(flag)) sets.set(flag, { sceneId: scene.id, siblingFamily: family });
            }
          }
        });
      }
    }
  }
  return sets;
}

function flagsSetByChoice(choice: unknown): string[] {
  const record = choice as AnyRecord;
  const consequences = Array.isArray(record?.consequences) ? record.consequences : [];
  return consequences
    .filter((entry): entry is AnyRecord => Boolean(entry && typeof entry === 'object'))
    .filter((entry) => entry.type === 'setFlag' && typeof entry.flag === 'string')
    .map((entry) => entry.flag as string);
}

function visitChoiceGroups(value: unknown, visit: (choices: unknown[]) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) visitChoiceGroups(item, visit);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const record = value as AnyRecord;
  if (Array.isArray(record.choices) && record.choices.length > 0) visit(record.choices);
  for (const child of Object.values(record)) visitChoiceGroups(child, visit);
}

export function auditFlagConsumption(story: Story): FlagConsumptionAudit {
  const setFlags = collectSets(story);
  const readFlags = new Set<string>();
  collectReads(story.episodes ?? [], readFlags);

  const findings: FlagConsumptionFinding[] = [];
  for (const [flag, origin] of setFlags) {
    if (readFlags.has(flag)) continue;
    if (SEASON_SCOPE_FLAG_RE.some((pattern) => pattern.test(flag))) continue;
    const consumedSiblings = origin.siblingFamily.filter(
      (sibling) => sibling !== flag && readFlags.has(sibling),
    );
    if (consumedSiblings.length > 0) {
      findings.push({
        type: 'flag_family_asymmetric_variants',
        flag,
        sceneId: origin.sceneId,
        consumedSiblings,
        message: `Choice flag "${flag}" (set in ${origin.sceneId ?? 'a scene'}) is never read, but its sibling choice(s) ${consumedSiblings.map((name) => `"${name}"`).join(', ')} are — one player path silently loses its reflection.`,
      });
    } else {
      findings.push({
        type: 'flag_never_consumed',
        flag,
        sceneId: origin.sceneId,
        message: `Choice flag "${flag}" (set in ${origin.sceneId ?? 'a scene'}) is never read by any textVariant condition, choice gate, or encounter requirement — the world does not react to this player decision.`,
      });
    }
  }
  // Asymmetric families first: they are proven-reactive sites with one path dropped.
  findings.sort((left, right) =>
    Number(right.type === 'flag_family_asymmetric_variants') - Number(left.type === 'flag_family_asymmetric_variants'));
  return { setFlags, readFlags, findings };
}
