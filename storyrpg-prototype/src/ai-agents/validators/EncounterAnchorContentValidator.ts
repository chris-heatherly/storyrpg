/**
 * Encounter Anchor Content Validator (Remediation §4.2 — "expand, do not rewrite").
 *
 * When a story is generated from an authored treatment, each Section-9 encounter
 * anchor becomes a planned encounter scene ({@link PlannedScene} with
 * `kind: 'encounter'`) carrying authored content: a `centralConflict` and/or
 * authored {@link RequiredBeat}s (the staged image/turn the encounter exists to
 * depict). The pipeline must EXPAND those anchors on-page, never emit them as
 * empty placeholders. The audited ENDSONG run shipped the Ep3 wall-breach as an
 * empty encounter scene, which let the poisoning-never-administered hole through
 * (RC7 §4.2).
 *
 * This validator closes that hole at the FINAL-STORY level. For every final scene
 * whose planned counterpart is an authored encounter anchor, it asserts (all
 * BLOCKING):
 *
 *  1. **Non-empty.** The scene has ≥1 reader-facing beat (a flat scene beat OR an
 *     encounter-phase beat with non-blank, non-placeholder text). A scene that
 *     carries only a trivial encounter shell with no readable beats fails — this
 *     is the half the existing `FinalStoryContractValidator.empty_scene` check
 *     (`!scene.encounter && beats.length === 0`) cannot see, because the encounter
 *     shell is present. (The companion tightening of `empty_scene` lands in the
 *     Wiring phase, not here.)
 *  2. **Central conflict depicted.** If the anchor authored a `centralConflict`,
 *     its substance must appear in the scene's reader-facing text.
 *  3. **Required beats depicted.** Each authored `requiredBeat.mustDepict` (on the
 *     scene OR on its encounter detail) must appear in the scene's reader-facing
 *     text. `connective`-tier beats are exempt — that band is reserved for the
 *     model's legitimate invention (§6 non-goals).
 *
 * Pure / deterministic — reads the plan's authored encounter anchors and the final
 * story's prose; no clock, no randomness, no LLM. Generator-internal (fiction-first:
 * it inspects prose for authored content, never injects stats/dice/DCs). Like the
 * other recent validators it is unconditional here; the caller (Wiring phase)
 * registers it DEFAULT-OFF behind a gate flag and promotes it to blocking after the
 * ENDSONG re-run proves it green.
 */

import { BaseValidator, ValidationIssue, ValidationResult } from './BaseValidator';
import type { Beat, Episode, Scene, Story } from '../../types';
import type { EncounterPhase } from '../../types/encounter';
import type { PlannedScene, RequiredBeat, SeasonScenePlan } from '../../types/scenePlan';

/** Context for {@link EncounterAnchorContentValidator.validate}. */
export interface EncounterAnchorContentContext {
  /**
   * The season scene plan whose `kind: 'encounter'` scenes carry the authored
   * encounter anchors (centralConflict + requiredBeats). Scenes are matched to
   * the final story by `id` (a planned encounter's id IS the encounter/scene id).
   */
  scenePlan: SeasonScenePlan;
  /**
   * Minimum token-overlap score for an authored anchor to count as "depicted"
   * in the prose. Defaults to {@link DEFAULT_MIN_DEPICT_SCORE}.
   */
  minDepictScore?: number;
}

/** Default depiction threshold — a substantial-but-not-verbatim overlap. */
export const DEFAULT_MIN_DEPICT_SCORE = 0.34;

/** Placeholder/residue text that does NOT count as a reader-facing beat. */
const PLACEHOLDER_TEXT_PATTERN =
  /^\s*(\[?(tbd|todo|placeholder|to be (written|generated|continued)|continued|coming soon)\]?\.?)\s*$/i;

const STOPWORDS = new Set([
  'about', 'after', 'again', 'against', 'also', 'and', 'because', 'become', 'before', 'being', 'between',
  'choice', 'chooses', 'could', 'during', 'episode', 'every', 'from', 'have', 'into', 'keeps', 'later',
  'leave', 'leaves', 'major', 'make', 'makes', 'must', 'opens', 'paths', 'player', 'pressure', 'scene',
  'should', 'that', 'their', 'them', 'then', 'there', 'this', 'through', 'when', 'where', 'will', 'with', 'without',
]);

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value: string | undefined): string[] {
  if (!value) return [];
  return normalize(value)
    .split(' ')
    .filter((token) => token.length >= 4 && !STOPWORDS.has(token));
}

/**
 * A needle token counts as present if a haystack token matches it exactly OR via
 * a shared stem (one is a prefix of the other; both already ≥4 chars). Matches
 * the inflected forms prose actually uses ("breach"~"breached").
 */
function tokenPresent(token: string, hayTokens: string[], haySet: Set<string>): boolean {
  if (haySet.has(token)) return true;
  for (const h of hayTokens) {
    if (h.startsWith(token) || token.startsWith(h)) return true;
  }
  return false;
}

function tokenOverlapScore(needle: string, haystack: string): number {
  const needed = [...new Set(tokens(needle))];
  if (needed.length === 0) return 0;
  const hayTokens = [...new Set(tokens(haystack))];
  const haySet = new Set(hayTokens);
  const hits = needed.filter((token) => tokenPresent(token, hayTokens, haySet)).length;
  return hits / needed.length;
}

/** True iff `needle`'s substance appears in `haystack` (substring or token overlap). */
function isDepicted(needle: string | undefined, haystack: string, minScore: number): boolean {
  if (!needle?.trim()) return true; // nothing authored to depict
  const normalizedNeedle = normalize(needle);
  if (normalizedNeedle.length === 0) return true;
  const normalizedHaystack = normalize(haystack);
  if (normalizedHaystack.includes(normalizedNeedle)) return true;
  return tokenOverlapScore(needle, haystack) >= minScore;
}

/** True iff `text` is a real reader-facing beat (non-blank, non-placeholder). */
function isReaderFacingText(text: string | undefined): boolean {
  const trimmed = (text ?? '').trim();
  if (trimmed.length === 0) return false;
  return !PLACEHOLDER_TEXT_PATTERN.test(trimmed);
}

/** Collect every reader-facing beat text from a final scene (flat beats + encounter phases). */
export function collectReaderFacingTexts(scene: Scene): string[] {
  const texts: string[] = [];
  for (const beat of scene.beats ?? []) {
    if (isReaderFacingText(beat.text)) texts.push(beat.text);
    for (const variant of beat.textVariants ?? []) {
      if (isReaderFacingText(variant.text)) texts.push(variant.text);
    }
  }
  const collectBeatText = (beat: unknown): void => {
    // Standard Beat carries `text`; EncounterBeat carries `setupText` (+ escalationText).
    const withText = beat as Partial<Beat> & { setupText?: string; escalationText?: string };
    for (const text of [withText.text, withText.setupText, withText.escalationText]) {
      if (isReaderFacingText(text)) texts.push(text!);
    }
    for (const variant of (withText as Partial<Beat>).textVariants ?? []) {
      if (isReaderFacingText(variant.text)) texts.push(variant.text);
    }
  };

  const phases: EncounterPhase[] = scene.encounter?.phases ?? [];
  for (const phase of phases) {
    for (const beat of phase.beats ?? []) collectBeatText(beat);
    if (isReaderFacingText(phase.onSuccess?.outcomeText)) texts.push(phase.onSuccess!.outcomeText);
    if (isReaderFacingText(phase.onFailure?.outcomeText)) texts.push(phase.onFailure!.outcomeText);
  }

  // Storylets are where most branching encounter prose lives (victory / partialVictory
  // / defeat / escape follow-ups). Their beats are reader-facing and frequently carry
  // the encounter's authored "dark half" (e.g. the attack/rescue that resolves a
  // two-location anchor) — so they MUST be collected, else an anchor depicted only in
  // its storylets is wrongly reported as not depicted.
  const storylets = scene.encounter?.storylets;
  const storyletList = Array.isArray(storylets)
    ? storylets
    : Object.values((storylets ?? {}) as Record<string, unknown>);
  for (const storylet of storyletList) {
    if (!storylet || typeof storylet !== 'object') continue;
    for (const beat of (storylet as { beats?: unknown[] }).beats ?? []) collectBeatText(beat);
  }
  return texts;
}

/**
 * Reader-facing encounter META texts that {@link collectReaderFacingTexts} does not
 * cover: clock names/descriptions, stakes, encounter-level outcomes, and the nested
 * choice-tree narrativeTexts. G12 shipped misgendered goalClock/stakes prose and
 * third-person outcome/storylet prose in exactly these fields — the POV/pronoun
 * scans need them. Kept separate from collectReaderFacingTexts so the anchor-
 * depiction semantics there are unchanged.
 */
export function collectEncounterMetaTexts(scene: Scene): string[] {
  const enc = scene.encounter as unknown as Record<string, unknown> | undefined;
  if (!enc) return [];
  const texts: string[] = [];
  const KEYS = new Set([
    'narrativeText', 'outcomeText', 'setupText', 'escalationText',
    'visualMoment', 'visualNarrative', 'visibleCost', 'visibleComplication',
    'immediateEffect', 'lingeringEffect',
    'description', 'victory', 'defeat', 'onSuccess', 'onFailure',
  ]);
  const seen = new Set<object>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node as object);
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (typeof value === 'string') {
        if (KEYS.has(key) && isReaderFacingText(value)) texts.push(value);
      } else if (value && typeof value === 'object') {
        visit(value);
      }
    }
  };
  visit(enc);
  return texts;
}

/**
 * Authored required beats bound to a planned encounter scene — both the scene-level
 * {@link PlannedScene.requiredBeats} and the encounter-level
 * {@link PlannedSceneEncounter.requiredBeats}. `connective`-tier beats are excluded
 * (that band is the model's to invent freely); `seed`-tier beats (distributed
 * cold-open / consequence-seed / information-ledger plants) are ADVISORY and likewise
 * excluded here — a dropped seed warns at the season-final realization pass, it never
 * blocks an encounter anchor (consistent with the standard-scene path, WS12B).
 */
function authoredRequiredBeats(scene: PlannedScene): RequiredBeat[] {
  const all = [...(scene.requiredBeats ?? []), ...(scene.encounter?.requiredBeats ?? [])];
  const seen = new Set<string>();
  const out: RequiredBeat[] = [];
  for (const rb of all) {
    if (rb.tier === 'connective' || rb.tier === 'seed') continue;
    const key = rb.id || rb.mustDepict;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rb);
  }
  return out;
}

/**
 * True iff the planned scene is an authored encounter anchor — a `kind: 'encounter'`
 * scene that carries authored content (a centralConflict or ≥1 non-connective
 * required beat). Inferred encounters (no authored content) are exempt: §6 forbids
 * asserting against invented units.
 */
function isAuthoredEncounterAnchor(scene: PlannedScene): boolean {
  if (scene.kind !== 'encounter') return false;
  if ((scene.encounter?.centralConflict ?? '').trim().length > 0) return true;
  return authoredRequiredBeats(scene).length > 0;
}

export class EncounterAnchorContentValidator extends BaseValidator {
  constructor() {
    super('EncounterAnchorContentValidator');
  }

  validate(story: Story, ctx: EncounterAnchorContentContext): ValidationResult {
    const issues: ValidationIssue[] = [];
    const minScore = ctx.minDepictScore ?? DEFAULT_MIN_DEPICT_SCORE;

    // Index final scenes by id (with their episode for diagnostics).
    const finalById = new Map<string, { scene: Scene; episode: Episode }>();
    const generatedEpisodeNumbers = new Set<number>();
    for (const episode of story.episodes ?? []) {
      if (typeof episode.number === 'number') generatedEpisodeNumbers.add(episode.number);
      for (const scene of episode.scenes ?? []) {
        finalById.set(scene.id, { scene, episode });
      }
    }

    const anchors = (ctx.scenePlan.scenes ?? []).filter(isAuthoredEncounterAnchor);

    for (const planned of anchors) {
      // Partial-season scoping: a treatment can plan anchors for all N episodes, but a
      // run may generate only a subset (e.g. the first 3). Skip anchors whose episode
      // was not generated — those scenes are legitimately absent, not "dropped". Only
      // applies when we can tell which episodes ran (story has numbered episodes).
      if (
        generatedEpisodeNumbers.size > 0
        && typeof planned.episodeNumber === 'number'
        && !generatedEpisodeNumbers.has(planned.episodeNumber)
      ) {
        continue;
      }

      const found = finalById.get(planned.id);
      const loc = typeof planned.episodeNumber === 'number'
        ? `encounterAnchor:ep${planned.episodeNumber}:${planned.id}`
        : `encounterAnchor:${planned.id}`;

      if (!found) {
        // An authored encounter anchor that produced no final scene is a dropped
        // anchor — the strongest form of "not depicted".
        issues.push(this.error(
          `Authored encounter anchor "${planned.title || planned.id}" (Ep ${planned.episodeNumber}) has no corresponding scene in the final story — the authored encounter was dropped.`,
          loc,
          'Ensure the authored encounter anchor is expanded into a generated scene; do not drop authored encounters.',
        ));
        continue;
      }

      const { scene, episode } = found;
      const readerTexts = collectReaderFacingTexts(scene);

      // 1) Non-empty: ≥1 reader-facing beat IN THE ANCHOR SCENE ITSELF. (This check
      // stays anchor-scoped: an empty encounter shell is a real defect even if sibling
      // scenes have prose.)
      if (readerTexts.length === 0) {
        issues.push(this.error(
          `Authored encounter anchor "${planned.title || planned.id}" (Ep ${planned.episodeNumber}) has no reader-facing beats in the final story — it is an empty encounter placeholder.`,
          loc,
          'Generate the encounter\'s phases/beats on-page; an authored encounter anchor must depict its conflict, not ship an empty shell.',
        ));
        continue; // nothing to match against; the deeper checks would just pile on.
      }

      // Depiction is checked EPISODE-WIDE, not just within the anchor scene. The
      // scenePlan often authors a moment as a "required beat" of the encounter anchor
      // (e.g. Ep2's cab-breakdown meet-cute hung on the Velvet Booth encounter), but the
      // pipeline legitimately distributes such moments across the episode's scenes. The
      // fidelity contract is "the authored moment is depicted on-page in its episode" —
      // so matching anchor-only produced false negatives for correctly-distributed beats.
      const haystack = (episode.scenes ?? [])
        .flatMap(s => collectReaderFacingTexts(s))
        .join('\n');

      // 2) Central conflict depicted. A central conflict is THEMATIC ("the kiss is the moment
      // her appetite finally outvotes her noticing — the surrender Victor stages") — so a
      // token-overlap test against that abstract sentence FALSE-POSITIVES even when the scene
      // fully realizes it (bite-me-g18 maze: kiss/surrender/maze/candle all on-page, overlap
      // still < 0.34). The encounter's SIGNATURE moment is the CONCRETE staging of that same
      // pressure; when the signature is depicted, the conflict it exists to stage is realized.
      // Credit either path, so the thematic-overlap miss alone no longer hard-blocks. (The
      // concrete required-beat checks below stay strict.)
      const centralConflict = planned.encounter?.centralConflict ?? '';
      const signatureMoment = authoredRequiredBeats(planned).find((rb) => rb.tier === 'signature')?.mustDepict;
      const signatureDepicted = Boolean(signatureMoment?.trim()) && isDepicted(signatureMoment, haystack, minScore);
      if (
        centralConflict.trim().length > 0
        && !isDepicted(centralConflict, haystack, minScore)
        && !signatureDepicted
      ) {
        issues.push(this.error(
          `Authored encounter anchor "${planned.title || planned.id}" (Ep ${planned.episodeNumber}) does not depict its central conflict on-page: "${centralConflict.trim()}".`,
          loc,
          'Make the encounter prose realize the authored central conflict (the pressure the encounter exists to stage), not just a generic fight.',
        ));
      }

      // 3) Each authored (non-connective) required beat depicted.
      for (const rb of authoredRequiredBeats(planned)) {
        if (!isDepicted(rb.mustDepict, haystack, minScore)) {
          issues.push(this.error(
            `Authored encounter anchor "${planned.title || planned.id}" (Ep ${planned.episodeNumber}) does not depict required beat ${rb.id} (${rb.tier}): "${rb.mustDepict}".`,
            `${loc}:beat:${rb.id}`,
            'Realize this authored beat in the encounter prose; required beats are FIXED — do not drop, invert, or summarize them away.',
          ));
        }
      }
    }

    return finalize(issues);
  }
}

function finalize(issues: ValidationIssue[]): ValidationResult {
  const errors = issues.filter((i) => i.severity === 'error').length;
  const nonErrors = issues.length - errors;
  const score = Math.max(0, 100 - errors * 10 - nonErrors * 2);
  return {
    valid: errors === 0,
    score,
    issues,
    suggestions: issues.map((i) => i.suggestion).filter((s): s is string => Boolean(s)),
  };
}
