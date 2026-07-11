/**
 * LLM scene-prose repair handler for the final-contract repair loop — the
 * "surgical scene repair" seam from the 2026-06-11 failure-cycle audit.
 *
 * The final contract names the exact episode + scene for each blocking issue
 * ("Authored required beat is missing from the final prose of episode 2 scene
 * s2-1: …"). Historically those findings hard-aborted the run AFTER every
 * episode had been generated — the most expensive failure mode in the corpus
 * (20 runs died at the final contract, median 73 minutes each, all work lost).
 *
 * This handler converts those aborts into bounded per-scene repair: group the
 * repairable blocking issues by scene, hand each scene to SceneCritic with the
 * finding's message + suggestion as director notes, merge the rewritten beats
 * back into the assembled story, and let the repair loop RE-VALIDATE. The run
 * aborts only when repair rounds exhaust with the issue still present.
 *
 * Scope: prose-realization findings on scenes that carry rewritable prose — the
 * classes where "rewrite this scene's prose to dramatize the named moment" is
 * the fix (RequiredBeatRealization, SignatureDevicePresence). This includes
 * ENCOUNTER scenes: their prose lives in `encounter.phases[].beats` /
 * `encounter.storylets[].beats`, not `scene.beats`, so those beats are flattened
 * for SceneCritic and the rewrite merged back to the surface it came from (a
 * signature device staged inside a `treatment-enc-*` encounter is the common
 * case — see mergeRewrittenEncounterBeatsIntoStory). The generation-time
 * no-boilerplate regen catches TEMPLATE encounter prose; it does not catch
 * fluent-but-unfaithful prose that summarized a staged signature away, which is
 * why this backstop must cover encounters. Purely structural classes (e.g.
 * AuthoredEpisodeConformance) remain out of scope (StructuralValidator.autoFix).
 */

import type { Scene as StoryScene } from '../../types';
import type { Story } from '../../types/story';
import type { SceneCritic } from '../agents/SceneCritic';
import type { SceneContent } from '../agents/SceneWriter';
import { isPlanningRegisterText } from '../constants/planningRegisterText';
import { SYNTHETIC_FALLBACK_PROSE_PATTERNS } from '../constants/syntheticFallbackProse';
import { isUnsafeCoverageMetadataText } from '../utils/coverageMetadataHygiene';
import { mergeRewrittenBeatsIntoStory, mergeRewrittenEncounterBeatsIntoStory } from '../pipeline/continuityRepair';
import { PIPELINE_TIMEOUTS, withTimeout } from '../utils/withTimeout';
import { hasDirectTreatmentEventRealization } from '../validators/TreatmentEventLedgerValidator';
import {
  characterIntroductionIssueCleared,
  parseCharacterIntroductionNpcId,
  scenePassesCharacterIntroductionOffPageCheck,
} from '../validators/CharacterIntroductionValidator';
import { collectReaderFacingTexts } from '../validators/encounterTextSurfaces';
import { contractRepairIssueFingerprint, type ContractRepairHandler, type ContractRepairReport } from './finalContractRepair';
import { contentTokensForRealization, evaluateMomentRealization, normalizeRealizationText, stopwordsForRealization } from './realizationEvaluator';
import { missingMomentTokens, requiredMomentFromMessage } from './realizationScoring';
import type { RepairDirective } from './gateRepairRouter';
import { missingRequiredMoments, requiredMomentsFor, type SceneContractSource, type RequiredMoment } from './sceneRealizationGuard';

/**
 * Validators whose blocking findings are fixable by a localized scene-prose
 * re-author. Both name a concrete authored moment the prose failed to
 * dramatize, and both carry the sceneId. (Other treatment-fidelity validators
 * — e.g. AuthoredEpisodeConformance, an episode-list mismatch — are NOT prose
 * problems and must not be "repaired" by rewriting prose.)
 */
const SCENE_PROSE_REPAIRABLE_VALIDATORS = new Set([
  'RequiredBeatRealizationValidator',
  'SignatureDevicePresenceValidator',
  // EncounterAnchorContentValidator names a concrete authored moment (central conflict /
  // required beat) the encounter prose failed to dramatize, and carries the encounter
  // sceneId — exactly the shape this handler repairs. The handler already rewrites encounter
  // prose (gatherEncounterProseBeats + mergeRewrittenEncounterBeatsIntoStory), so an
  // encounter-anchor miss now becomes a bounded scene-prose repair instead of a hard abort
  // (bite-me-g18). This retires the GATE_ENCOUNTER_ANCHOR_CONTENT policyException.
  'EncounterAnchorContentValidator',
  // bite-me-g23: malformed second-person encounter prose is a localized prose
  // corruption class. Explicit `GATE_ENCOUNTER_PROSE_INTEGRITY=1` runs should
  // try the existing scene-prose repair path before aborting.
  'EncounterProseIntegrityValidator',
  // Turn and transition failures are scene-flow defects. The existing per-scene
  // pass is still useful for a cheap first rewrite; the cluster handler below
  // gives them a wider repair window when the issue is structural.
  'SceneTurnRealizationValidator',
  'SceneTransitionContinuityValidator',
  'ContinuityChecker',
  'RelationshipArcLedgerValidator',
  'NarrativeMechanicPressureValidator',
  'TreatmentEventLedgerValidator',
  'ReferencedEventPresenceValidator',
  'CharacterIntroductionValidator',
  'NarrativeContractValidator',
  'SentenceOpenerVarietyValidator',
  // R5 (2026-07-06) — router/handler consistency: these validators' scene-
  // localized findings route to same_scene_retry / scene_cluster_rewrite in
  // gateRepairRouter, so the handler must admit them (a route with no admitting
  // handler is the same dead end as no route). All name an authored obligation
  // ("Season promise field X was planned but not realized…") whose fix is
  // dramatizing it in the named scene; unlocalized findings never reach this
  // handler (selectSceneProseRepairs requires a sceneId, and the router
  // classifies them architectural). AuthoredEpisodeConformanceValidator stays
  // deliberately EXCLUDED: episode-list mismatches are architecture in every
  // finding shape (see the module doc comment above).
  'TreatmentFieldUtilizationValidator',
  'SeasonPromiseRealizationValidator',
  'CharacterTreatmentRealizationValidator',
  'InformationLedgerScheduleValidator',
  'StoryCircleAnchorConformanceValidator',
  // Spatial-unit violations repair by rewriting the scene to stay in one
  // location; routed scene_cluster_rewrite (membership here covers the
  // cluster-already-attempted same-scene fallback).
  'SceneSpatialUnitValidator',
]);

/**
 * RouteContinuityValidator findings are architecture-class EXCEPT
 * `unsafe_fallback_prose` — deterministic fallback/template prose (from the
 * syntheticFallbackProse registry) that survived into reader-facing text.
 * That class is a localized prose defect whose only correct fix is an LLM
 * re-author of the affected scene, so it is admitted here by (validator, type)
 * pair rather than by validator alone.
 *
 * PovClarityValidator `pov_anchor_missing` (a scene's first prose beat never
 * anchors the player with you/your) is the same shape: scene-local prose whose
 * only correct fix is an LLM rewrite of the opening — there may be nothing for
 * deterministic pronoun coercion to work with when the beat never mentions the
 * player at all (bite-me 2026-07-05T23-54-17 s1-1 establishing shot).
 */
function isSceneProseRepairableIssue(issue: RepairableIssue): boolean {
  if (issue.validator && SCENE_PROSE_REPAIRABLE_VALIDATORS.has(issue.validator)) return true;
  if (issue.validator === 'RouteContinuityValidator' && issue.type === 'unsafe_fallback_prose') return true;
  // Encounter template collapse / malformed prose live in encounter phase/
  // storylet beats, which this handler already flattens and rewrites
  // (gatherEncounterProseBeats). Cost/stakes fields are covered by the
  // dedicated encounterCostRepairHandler in the same repair loop.
  if (
    issue.validator === 'EncounterQualityValidator'
    && (issue.type === 'encounter_template_collapse' || issue.type === 'encounter_malformed_prose')
  ) return true;
  // An empty playable scene (R5 dead end #2) is exactly what an LLM scene
  // re-author fixes: the handler seeds an empty beat scaffold (ids/wiring only
  // — deterministic code never writes reader-facing text) and SceneCritic
  // authors the prose. See scaffoldEmptySceneBeats.
  if (issue.validator === 'EmptyPlayableSceneValidator') return true;
  return issue.validator === 'PovClarityValidator' && issue.type === 'pov_anchor_missing';
}

const SCENE_CLUSTER_REPAIRABLE_VALIDATORS = new Set([
  'RequiredBeatRealizationValidator',
  'SignatureDevicePresenceValidator',
  'TreatmentEventLedgerValidator',
  'SceneTurnRealizationValidator',
  'ContinuityChecker',
  'SceneTransitionContinuityValidator',
  'RelationshipArcLedgerValidator',
  'NarrativeMechanicPressureValidator',
  // R5 (2026-07-06): router/handler consistency for cluster-routed classes.
  'SceneSpatialUnitValidator',
  'SeasonPromiseRealizationValidator',
  'CharacterTreatmentRealizationValidator',
  'InformationLedgerScheduleValidator',
  'StoryCircleAnchorConformanceValidator',
]);

const MOMENT_REALIZATION_VALIDATORS = new Set([
  'RequiredBeatRealizationValidator',
  'SignatureDevicePresenceValidator',
  'EncounterAnchorContentValidator',
  'SceneTurnRealizationValidator',
  'TreatmentEventLedgerValidator',
]);

type RepairableIssue = ContractRepairReport['blockingIssues'][number];

function repairIssueKey(issue: RepairableIssue): string {
  return [
    issue.validator ?? '',
    issue.sceneId ?? '',
    issue.episodeNumber ?? '',
    issue.message ?? '',
  ].join('::');
}

function mergeRepairIssues(existing: RepairableIssue[], incoming: RepairableIssue[]): RepairableIssue[] {
  const seen = new Set<string>();
  const merged: RepairableIssue[] = [];
  for (const issue of [...existing, ...incoming]) {
    const key = repairIssueKey(issue);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(issue);
  }
  return merged;
}

function isCumulativeMomentObligation(issue: RepairableIssue): boolean {
  return Boolean(
    issue.sceneId
    && issue.validator
    && MOMENT_REALIZATION_VALIDATORS.has(issue.validator)
    && requiredMomentFromMessage(issue.message),
  );
}

/**
 * Pick the blocking issues this handler can act on and group them by scene.
 * Caps at `maxScenes` scenes per round so a pathological report can't fan out
 * into unbounded LLM spend in one round. Scenes NOT yet attempted in earlier
 * rounds come first — without this, a stubborn scene from round 1 re-claims
 * its slot every round and starves scenes that never got a first attempt
 * (bite-me-g13 14-36-20: s3-1 was never repaired while treatment-enc-1-1 was
 * attempted twice).
 */
export function selectSceneProseRepairs(
  blockingIssues: RepairableIssue[],
  maxScenes = 4,
  attemptedScenes?: ReadonlySet<string>,
  allowIssue?: (issue: RepairableIssue) => boolean,
): Map<string, RepairableIssue[]> {
  const all = new Map<string, RepairableIssue[]>();
  for (const issue of blockingIssues ?? []) {
    if (!issue?.validator || !isSceneProseRepairableIssue(issue)) continue;
    if (!issue.sceneId) continue;
    if (allowIssue && !allowIssue(issue)) continue;
    const existing = all.get(issue.sceneId);
    if (existing) existing.push(issue);
    else all.set(issue.sceneId, [issue]);
  }
  const ordered = [...all.keys()].sort((a, b) => {
    const aAttempted = attemptedScenes?.has(a) ? 1 : 0;
    const bAttempted = attemptedScenes?.has(b) ? 1 : 0;
    return aAttempted - bAttempted; // stable: insertion order within each tier
  });
  const groups = new Map<string, RepairableIssue[]>();
  for (const sceneId of ordered.slice(0, maxScenes)) groups.set(sceneId, all.get(sceneId)!);
  return groups;
}

/**
 * Director notes for the SceneCritic rewrite, built from the findings. When the
 * scene's current prose is provided, each finding gets a NON-NEGOTIABLE
 * checklist: the full authored moment plus the exact content words the prose
 * does not yet carry. The validator that re-checks this scene is a keyword-
 * overlap heuristic, so a rewrite that paraphrases away the proper nouns
 * ("the park" for "Cișmigiu") will NOT clear the gate even if it reads well —
 * the notes say so explicitly. (bite-me-g13 14-36-20: the critic dramatized
 * one anchor of a two-anchor signature and the scene kept failing.)
 */
export function buildSceneRepairDirectorNotes(issues: RepairableIssue[], sceneProseText?: string): string {
  const lines: string[] = [
    'The final-story contract flagged this scene. Fix EVERY issue below by rewriting the scene\'s beat prose — dramatize each named moment ON-PAGE with concrete action, dialogue, and sensory detail. Do not summarize, allude to, or skip the staged moment.',
  ];
  for (const issue of issues) {
    lines.push(`- ${issue.message ?? 'unspecified finding'}${issue.suggestion ? ` (fix: ${issue.suggestion})` : ''}`);
    if (issue.validator === 'EmptyPlayableSceneValidator') {
      lines.push(
        '  NON-NEGOTIABLE: this scene currently has NO playable content — its beats are empty scaffolds awaiting prose. ' +
        'Author the scene from scratch in second person ("you/your"): give every beat concrete on-page action, dialogue, and sensory detail ' +
        'that fits this scene\'s place in the story (use the scene name and surrounding context). Do not leave any beat empty and do not write meta or planning text.',
      );
      continue;
    }
    if (issue.validator === 'SceneSpatialUnitValidator') {
      lines.push(
        '  NON-NEGOTIABLE: keep this scene\'s meaningful action in ONE major location. Rewrite so introductions, choices, encounters, reveals, and relationship turns all happen in the primary location; a second location may only be mentioned as a destination/handoff at the very end, never as a second stage for on-page action.',
      );
      continue;
    }
    if (issue.validator === 'EncounterProseIntegrityValidator') {
      lines.push(
        '  NON-NEGOTIABLE: fix malformed second-person rewrite residue everywhere in this scene. ' +
        'Phrases such as "you rooftop", "you candle", "you pulse", "you maze", "you kiss you", ' +
        'or "You kiss takes" are ungrammatical repair artifacts. Rewrite them into natural prose ' +
        'using "your", "the", or a concrete character/object as appropriate, while preserving events and choices.',
      );
      continue;
    }
    if (issue.validator === 'PlanningRegisterLeakValidator') {
      lines.push(
        '  NON-NEGOTIABLE: remove planning-register/task language such as "Open the episode", ' +
        '"Introduce X on-page", "Authored treatment choice", and "Decide how to handle". ' +
        'Rewrite the affected field as in-world second-person prose or concrete visual direction, preserving the intended story event.',
      );
      continue;
    }
    if (issue.type === 'unsafe_fallback_prose') {
      lines.push(
        '  NON-NEGOTIABLE: the quoted text is a deterministic fallback/template sentence the pipeline ' +
        'inserted when generation failed — it is not authored fiction. Replace it with specific, ' +
        'in-world second-person prose that depicts THIS scene\'s concrete outcome (who, what, where, cost). ' +
        'Do not reuse or lightly reword the template sentence.',
      );
      continue;
    }
    if (issue.validator === 'RelationshipArcLedgerValidator') {
      lines.push(
        '  NON-NEGOTIABLE: preserve instant chemistry if it is present, but downgrade unearned friendship, trust, intimacy, or group-membership labels into behavior: invitation, testing, guarded warmth, teasing, changed distance, vulnerability, or a fragile beginning.',
      );
      continue;
    }
    if (issue.validator === 'NarrativeMechanicPressureValidator') {
      lines.push(
        '  NON-NEGOTIABLE: hidden mechanics must become visible story pressure. Rewrite bare state changes as on-page evidence plus residue: access, leverage, clue, debt, suspicion, vulnerability, identity pressure, changed NPC posture, or route permission. Do not expose flags, scores, thresholds, or contract labels.',
      );
      continue;
    }
    if (issue.validator === 'TreatmentEventLedgerValidator') {
      const blogAftermath = /blogAftermath|gone viral|viral|readership|audience/i.test(issue.message ?? '');
      lines.push(
        blogAftermath
          ? '  NON-NEGOTIABLE: this is the authored public blog aftermath. In THIS scene, explicitly show the published post going viral or its audience surging; preserve the source timing by saying "by evening" (or an unmistakable equivalent), include the literal word "viral" or an equally direct public-reach action, and show concrete reader/share/notification evidence. Do not satisfy it with metaphor alone, private reaction, memory, or a later recap.'
          : '  NON-NEGOTIABLE: this is an authoritative treatment event. Stage it as immediate reader-facing action in THIS scene. Do not satisfy it through memory, backstory, later recap, "weeks ago" phrasing, or a character recalling what had happened.',
      );
      continue;
    }
    if (issue.validator === 'ContinuityChecker') {
      lines.push(
        '  NON-NEGOTIABLE: repair the exact knowledge gap in the flagged beat. If someone arrives at the protagonist\'s private address without an established route, add an in-world call, text, invitation, exchanged address, or the protagonist opening the door after contact before the arrival. Do not leave the arrival unexplained, and do not narrate validator or planning language.',
      );
      continue;
    }
    if (issue.validator === 'ReferencedEventPresenceValidator') {
      lines.push(
        '  NON-NEGOTIABLE: the scene objective promised a concrete listed clue/event. Add that specific clue/event to the player-facing prose in this scene, with enough concrete nouns for the validator to find it. Do not move it to metadata, recap, or a later scene.',
      );
      continue;
    }
    if (issue.validator === 'CharacterIntroductionValidator') {
      const offPage = /off-page familiarity|settled group belonging|back-reference/i.test(issue.message ?? '');
      const metadataOnly = /first appears in the cast|metadata only|never names them/i.test(issue.message ?? '');
      const namedCharacter = /"([^\"]+)"/.exec(issue.message ?? '')?.[1];
      const plantLeak = /anonymous plant|scheduled as an anonymous plant|roster identity must stay hidden|anonymous-plant-leak/i.test(
        `${issue.message || ''} ${issue.suggestion || ''}`,
      );
      const anonymousPlant = !plantLeak && /anonymous|stranger|first-contact plant|visual cues/i.test(
        `${issue.suggestion || ''} ${issue.message || ''}`,
      );
      lines.push(
        offPage
          ? '  NON-NEGOTIABLE: this is the reader\'s FIRST on-page meeting with the named character(s). Rewrite every beat in second person ("you/your"). Stage the encounter as live first contact: how you notice them, how they name themselves or are named to you, one concrete identifying detail, and guarded/testing warmth. The character must not be described through a back-reference such as "from the shadows", "the man from...", "someone you met", or any unseen prior event; do not use time-jump familiarity, club belonging, or "friends now" language.'
          : plantLeak
            ? '  NON-NEGOTIABLE: ANONYMOUS-PLANT LEAK. Remove or replace every roster-name mention of this character on all reader surfaces (beats, encounter outcomes, storylets, aftermath). Stage them only as a stranger/anonymous figure with distinctive visual cues. Do NOT introduce them by roster name; do NOT keep the name and add staging beside it.'
            : anonymousPlant
              ? '  NON-NEGOTIABLE: this is an ANONYMOUS PLANT. Stage first-contact with a stranger/anonymous figure and distinctive visual cues. Do NOT use their roster name yet. Keep identity linked for a later reveal.'
              : metadataOnly
                ? `  NON-NEGOTIABLE: ${namedCharacter || 'this cast character'} is already assigned to this scene and must exist on-page, not only in metadata. Name ${namedCharacter || 'the character'} naturally in the live encounter and give the protagonist one concrete action, visual detail, or line that establishes who they are. Do not remove them from the cast, replace them with an unnamed figure, or satisfy the issue with a recap.`
              : '  NON-NEGOTIABLE: introduce the named character on-page before treating them as known. Add a brief concrete arrival, recognition, relationship cue, or identifying detail in the prose; keep the existing cast and plot intact.',
      );
      continue;
    }
    if (issue.validator === 'NarrativeContractValidator') {
      if (/premise contract/i.test(issue.message ?? '')) {
        lines.push(
          '  NON-NEGOTIABLE: this is an authored premise obligation. Put the concrete identity/role/origin-pressure detail on the page in this scene through behavior, dialogue, an object, or a specific consequence. Do not satisfy it with a character sheet, scene title, synopsis, abstract adjective, or planning language; preserve second-person narration and all existing event ownership.',
        );
      } else if (/downstream seed/i.test(issue.message ?? '')) {
        lines.push(
          '  NON-NEGOTIABLE: carry the prior choice as residue in this scene. Show changed behavior, access, reputation, information, leverage, relationship posture, or an explicit callback. Do not replay the source event, mention the contract, expose a flag name, or invent a new event.',
        );
      } else if (/transition metadata|canonical transition/i.test(issue.message ?? '')) {
        lines.push(
          '  NON-NEGOTIABLE: keep the arriving scene in the canonical location and time. Add a natural bridge or arrival acknowledgment that makes the move legible, while preserving the scene\'s assigned event and avoiding a second location or a metadata explanation in reader prose.',
        );
      } else if (/scheduled (?:twist|revelation|payoff)|twist contract/i.test(issue.message ?? '')) {
        lines.push(
          '  NON-NEGOTIABLE: realize the scheduled turn in this scene with fair setup and concrete on-page evidence. Do not introduce an unrelated twist, move the reveal to another scene, or write an authorial explanation of the schedule.',
        );
      } else if (/viral blog payoff/i.test(issue.message ?? '')) {
        lines.push(
          '  NON-NEGOTIABLE: the authored blog aftermath must show concrete public reach in this scene. Keep the post publication and add visible audience consequence — readers, shares, notifications, local recognition, or a changed public position. A single private comment is insufficient. Do not write the phrase "the validator requires" or other planning language.',
        );
      } else if (/canonical identity|identity .* before/i.test(issue.message ?? '')) {
        lines.push(
          '  NON-NEGOTIABLE: preserve the visual/codename plant but remove the character\'s canonical name and first name from every reader-facing surface in this scene. Use only the allowed codename or distinctive visual description. Do not compensate by adding a recap or metadata name.',
        );
      } else if (/forbidden early role|forbidden.*role/i.test(issue.message ?? '')) {
        lines.push(
          '  NON-NEGOTIABLE: preserve the character\'s scheduled early role. Rewrite the scene so this character is a witness, visual plant, or romantic-pressure presence rather than an attacker or antagonist; move the threat to the authored anonymous danger without changing scene topology.',
        );
      }
      continue;
    }
    if (issue.validator === 'SentenceOpenerVarietyValidator') {
      lines.push(
        '  NON-NEGOTIABLE: rewrite only the flagged monotonous sentences so they no longer stack repeated "You ..." openings. Preserve all events, mechanics, flags, choice ids, conditions, consequences, speakers, and scene order exactly.',
      );
      continue;
    }
    if (sceneProseText !== undefined) {
      const moment = requiredMomentFromMessage(issue.message);
      if (moment) {
        const missing = missingMomentTokens(issue.validator, moment, sceneProseText);
        if (missing.length > 0) {
          lines.push(
            `  NON-NEGOTIABLE: dramatize EVERY part of that authored moment, not just one piece of it. ` +
            `These content words from the authored moment are still absent from the scene and MUST appear ` +
            `in the rewritten prose (verbatim or inflected — keep proper nouns like place names exactly): ` +
            missing.join(', '),
          );
        }
      }
    }
  }
  lines.push(
    'Keep beat ids, choice points, speakers, and established plot intact. Weave the missing moment into the existing beats (extend or rewrite beat text/textVariants); never contradict events already on the page.',
  );
  return lines.join('\n');
}

interface EncounterProseBeat {
  id?: string;
  text?: string;
  setupText?: string;
  escalationText?: string;
}
type RepairableTextCarrier = EncounterProseBeat & { textVariants?: Array<{ text?: string }>; nextBeatId?: string };
interface RepairableStoryScene {
  id?: string;
  name?: string;
  beats?: RepairableTextCarrier[];
  startingBeatId?: string;
  requiredBeats?: Array<{ tier?: string; mustDepict?: string }>;
  signatureMoment?: string;
  encounter?: {
    phases?: Array<{ beats?: EncounterProseBeat[] }>;
    storylets?: Array<{ beats?: EncounterProseBeat[] }> | Record<string, { beats?: EncounterProseBeat[] }>;
  };
}

function cloneRepairableScene(scene: RepairableStoryScene): RepairableStoryScene {
  return JSON.parse(JSON.stringify(scene)) as RepairableStoryScene;
}

function restoreRepairableScene(scene: RepairableStoryScene, snapshot: RepairableStoryScene): void {
  for (const key of Object.keys(scene) as Array<keyof RepairableStoryScene>) {
    delete scene[key];
  }
  Object.assign(scene, JSON.parse(JSON.stringify(snapshot)));
}

/**
 * Flatten an encounter scene's prose beats into the flat `{id, text}` shape
 * SceneCritic rewrites. Encounter prose lives in `encounter.phases[].beats`
 * (text in `setupText`) and `encounter.storylets[].beats` (text in `text`),
 * NOT `scene.beats`. Each surfaced beat keeps its real id so the rewrite merges
 * straight back via mergeRewrittenEncounterBeatsIntoStory. Only beats that
 * actually carry prose are surfaced (an empty bridge/choice beat has nothing to
 * rewrite). This is what lets a SignatureDevicePresence finding on a
 * `treatment-enc-*` scene be repaired instead of skipped.
 */
function gatherEncounterProseBeats(scene: RepairableStoryScene): Array<{ id?: string; text?: string }> {
  const enc = scene.encounter;
  if (!enc) return [];
  const out: Array<{ id?: string; text?: string }> = [];
  const collect = (beats: EncounterProseBeat[] | undefined): void => {
    for (const b of beats || []) {
      const prose = [b.text, b.setupText, b.escalationText].filter(Boolean).join(' ').trim();
      if (prose) out.push({ id: b.id, text: prose });
    }
  };
  for (const phase of enc.phases || []) collect(phase.beats);
  const storylets = Array.isArray(enc.storylets) ? enc.storylets : Object.values(enc.storylets ?? {});
  for (const storylet of storylets) collect(storylet?.beats);
  return out;
}

/**
 * The repairable prose beats for a scene: the flat scene beats when present,
 * otherwise the encounter's phase/storylet prose beats. Empty only when the
 * scene genuinely has no rewritable prose anywhere.
 */
function repairableBeatsFor(scene: RepairableStoryScene): Array<{ id?: string; text?: string }> {
  if (scene.beats?.length) return scene.beats;
  return gatherEncounterProseBeats(scene);
}

/** Number of empty beat scaffolds seeded into a beat-less flagged scene. */
const EMPTY_SCENE_SCAFFOLD_BEATS = 3;

/**
 * Seed EMPTY beat scaffolds into a scene with no beats at all so SceneCritic
 * has rewrite targets (R5 dead end #2: EmptyPlayableSceneValidator). The
 * scaffolds carry ids and nextBeatId wiring ONLY — text stays '' because
 * deterministic code never authors reader-facing prose; the LLM writes the
 * beats and pruneEmptyScaffoldBeats removes any scaffold it left empty, so an
 * empty scaffold can never ship (and re-validation still blocks the scene if
 * nothing was authored).
 */
function scaffoldEmptySceneBeats(scene: RepairableStoryScene): string[] {
  if (scene.beats?.length) return [];
  const sceneId = scene.id ?? 'scene';
  const ids: string[] = [];
  const beats: RepairableTextCarrier[] = [];
  for (let i = 1; i <= EMPTY_SCENE_SCAFFOLD_BEATS; i++) {
    const id = `${sceneId}-repair-b${i}`;
    ids.push(id);
    beats.push({ id, text: '' });
  }
  for (let i = 0; i < beats.length - 1; i++) beats[i].nextBeatId = ids[i + 1];
  scene.beats = beats;
  if (!scene.startingBeatId || !ids.includes(scene.startingBeatId)) {
    scene.startingBeatId = ids[0];
  }
  return ids;
}

/**
 * Remove scaffold beats the critic left empty and re-chain the survivors.
 * Restores the pre-scaffold scene when NO scaffold received prose (the repair
 * failed outright), so a failed empty-scene repair leaves the story exactly as
 * it was — still empty, still blocked by re-validation.
 */
function pruneEmptyScaffoldBeats(
  scene: RepairableStoryScene,
  scaffoldedBeatIds: string[],
  preScaffoldSnapshot: RepairableStoryScene | undefined,
): number {
  if (scaffoldedBeatIds.length === 0) return 0;
  const scaffoldIds = new Set(scaffoldedBeatIds);
  const beats = scene.beats ?? [];
  const kept = beats.filter((beat) => !(beat.id && scaffoldIds.has(beat.id) && !(beat.text ?? '').trim()));
  const removed = beats.length - kept.length;
  if (removed === 0) return 0;
  const keptScaffolds = kept.filter((beat) => beat.id && scaffoldIds.has(beat.id));
  if (keptScaffolds.length === 0 && preScaffoldSnapshot) {
    restoreRepairableScene(scene, preScaffoldSnapshot);
    return removed;
  }
  scene.beats = kept;
  for (let i = 0; i < keptScaffolds.length; i++) {
    keptScaffolds[i].nextBeatId = keptScaffolds[i + 1]?.id;
  }
  if (scene.startingBeatId && scaffoldIds.has(scene.startingBeatId) && !kept.some((beat) => beat.id === scene.startingBeatId)) {
    scene.startingBeatId = kept[0]?.id ?? preScaffoldSnapshot?.startingBeatId;
  }
  return removed;
}

function readerFacingTextForCarrier(carrier: RepairableTextCarrier): string {
  return [carrier.text, carrier.setupText, carrier.escalationText].filter(Boolean).join(' ').trim();
}

function setReaderFacingTextForCarrier(carrier: RepairableTextCarrier, text: string): void {
  if (
    (carrier.text === undefined || carrier.text === '')
    && typeof carrier.setupText === 'string'
    && carrier.setupText.length > 0
  ) {
    carrier.setupText = text;
    return;
  }
  if (
    (carrier.text === undefined || carrier.text === '')
    && (carrier.setupText === undefined || carrier.setupText === '')
    && typeof carrier.escalationText === 'string'
    && carrier.escalationText.length > 0
  ) {
    carrier.escalationText = text;
    return;
  }
  carrier.text = text;
}

function mutableTextCarriersFor(scene: RepairableStoryScene): RepairableTextCarrier[] {
  if (scene.beats?.length) return scene.beats;
  const enc = scene.encounter;
  if (!enc) return [];
  const out: RepairableTextCarrier[] = [];
  for (const phase of enc.phases || []) out.push(...(phase.beats || []));
  const storylets = Array.isArray(enc.storylets) ? enc.storylets : Object.values(enc.storylets ?? {});
  for (const storylet of storylets) out.push(...(storylet?.beats || []));
  return out.filter((carrier) => readerFacingTextForCarrier(carrier).length > 0);
}

/**
 * The scene's prose as the realization validators scan it (scene name + flat
 * beat text/variants + encounter phase/storylet text/setupText/escalationText/
 * variants) — the haystack for predicting whether a finding will clear.
 */
function sceneProseForScoring(scene: RepairableStoryScene): string {
  type ProseBeat = EncounterProseBeat & {
    textVariants?: Array<{ text?: string }>;
    visualMoment?: string;
    primaryAction?: string;
  };
  const parts: string[] = [scene.name ?? ''];
  const collect = (beats: ProseBeat[] | undefined): void => {
    for (const b of beats || []) {
      parts.push(b.text ?? '', b.setupText ?? '', b.escalationText ?? '');
      parts.push(b.visualMoment ?? '', b.primaryAction ?? '');
      for (const variant of b.textVariants || []) parts.push(variant?.text ?? '');
    }
  };
  collect(scene.beats as ProseBeat[] | undefined);
  const enc = scene.encounter;
  if (enc) {
    parts.push(...collectReaderFacingTexts(scene as unknown as StoryScene));
    for (const phase of enc.phases || []) collect(phase.beats as ProseBeat[] | undefined);
    const storylets = Array.isArray(enc.storylets) ? enc.storylets : Object.values(enc.storylets ?? {});
    for (const storylet of storylets) collect(storylet?.beats as ProseBeat[] | undefined);
  }
  return parts.filter(Boolean).join(' ');
}

function defaultSceneProseForScoring(scene: RepairableStoryScene): string {
  const parts: string[] = [scene.name ?? ''];
  const collect = (beats: EncounterProseBeat[] | undefined): void => {
    for (const b of beats || []) {
      parts.push(b.text ?? '', b.setupText ?? '', b.escalationText ?? '');
    }
  };
  collect(scene.beats);
  const enc = scene.encounter;
  if (enc) {
    parts.push(...collectReaderFacingTexts(scene as unknown as StoryScene));
    for (const phase of enc.phases || []) collect(phase.beats);
    const storylets = Array.isArray(enc.storylets) ? enc.storylets : Object.values(enc.storylets ?? {});
    for (const storylet of storylets) collect(storylet?.beats);
  }
  return parts.filter(Boolean).join(' ');
}

function uniqueRequiredMoments(...groups: RequiredMoment[][]): RequiredMoment[] {
  const seen = new Set<string>();
  const out: RequiredMoment[] = [];
  for (const moment of groups.flat()) {
    const key = `${moment.validator}::${moment.tier}::${normalizeRealizationText(moment.moment)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(moment);
  }
  return out;
}

function requiredMomentLabel(moment: RequiredMoment): string {
  return `[${moment.tier}] ${moment.moment}`;
}

function requiredMomentsLostAfterRewrite(
  before: RepairableStoryScene,
  after: RepairableStoryScene,
  plannedSource?: SceneContractSource,
): RequiredMoment[] {
  const moments = uniqueRequiredMoments(requiredMomentsFor(before), requiredMomentsFor(plannedSource));
  if (moments.length === 0) return [];
  const beforeProse = defaultSceneProseForScoring(before);
  const afterProse = defaultSceneProseForScoring(after);
  return moments
    .filter((moment) =>
      evaluateMomentRealization(moment.validator, moment.moment, beforeProse).depicted
      && !evaluateMomentRealization(moment.validator, moment.moment, afterProse).depicted,
    );
}

function requiredMomentsLostByRewrite(
  before: RepairableStoryScene,
  after: RepairableStoryScene,
  plannedSource?: SceneContractSource,
): string[] {
  return requiredMomentsLostAfterRewrite(before, after, plannedSource).map(requiredMomentLabel);
}

function targetCarrierForRequiredMoment(scene: RepairableStoryScene, moment: RequiredMoment): RepairableTextCarrier | undefined {
  const carriers = mutableTextCarriersFor(scene);
  if (carriers.length === 0) return undefined;
  const stopwords = stopwordsForRealization(moment.validator);
  const momentTokens = new Set(contentTokensForRealization(moment.moment, stopwords));
  let best = carriers[0];
  let bestScore = -1;
  for (const carrier of carriers) {
    const text = readerFacingTextForCarrier(carrier);
    const tokens = new Set(contentTokensForRealization(text, stopwords));
    const score = [...momentTokens].filter((token) => tokens.has(token)).length;
    if (score > bestScore) {
      best = carrier;
      bestScore = score;
    }
  }
  return best;
}

function preserveLostRequiredMoments(
  before: RepairableStoryScene,
  after: RepairableStoryScene,
  plannedSource?: SceneContractSource,
): { preserved: number; remainingLost: string[] } {
  let preserved = 0;
  const lost = requiredMomentsLostAfterRewrite(before, after, plannedSource);
  for (const moment of lost) {
    const carrier = targetCarrierForRequiredMoment(after, moment);
    if (!carrier) continue;
    const sentence = fictionFacingRequiredBeatSentence(moment.moment);
    const currentText = readerFacingTextForCarrier(carrier);
    if (normalizeRealizationText(currentText).includes(normalizeRealizationText(sentence))) continue;
    setReaderFacingTextForCarrier(carrier, `${currentText.trim()} ${sentence}`.trim());
    preserved += 1;
  }
  return {
    preserved,
    remainingLost: requiredMomentsLostByRewrite(before, after, plannedSource),
  };
}

function realizedRequiredMomentLabels(
  scene: RepairableStoryScene,
  plannedSource?: SceneContractSource,
): string[] {
  const moments = uniqueRequiredMoments(requiredMomentsFor(scene), requiredMomentsFor(plannedSource));
  if (moments.length === 0) return [];
  const prose = defaultSceneProseForScoring(scene);
  return moments
    .filter((moment) => evaluateMomentRealization(moment.validator, moment.moment, prose).depicted)
    .map(requiredMomentLabel);
}

function plannedSourceMomentsDepicted(scene: RepairableStoryScene, plannedSource?: SceneContractSource): boolean {
  const moments = requiredMomentsFor(plannedSource);
  if (moments.length === 0) return true;
  const prose = sceneProseForScoring(scene);
  return moments.every((moment) => evaluateMomentRealization(moment.validator, moment.moment, prose).depicted);
}

function plannedMissingMomentNotes(scene: RepairableStoryScene, plannedSource?: SceneContractSource): string {
  const missing = missingRequiredMoments(
    plannedSource,
    repairableBeatsFor(scene) as Array<{ text?: string; setupText?: string; escalationText?: string; textVariants?: Array<{ text?: string }> }>,
  );
  if (missing.length === 0) return '';
  return [
    '',
    'ACTIVE PLANNED MOMENTS: the scene-construction contract still requires these moments on-page. Fold them into the same scene turn as concrete action, dialogue, sensory detail, or immediate consequence. Do not paste them as summary sentences.',
    ...missing.map((moment) => {
      const missingTokens = moment.missingTokens.length > 0
        ? ` Missing content words: ${moment.missingTokens.join(', ')}.`
        : '';
      return `- [${moment.tier}] ${moment.moment}${missingTokens}`;
    }),
  ].join('\n');
}

/** Predict whether CharacterIntroductionValidator issues are cleared after repair. */
export function characterIntroductionIssuesCleared(
  scene: RepairableStoryScene,
  issues: RepairableIssue[],
): boolean {
  const introIssues = issues.filter((issue) => issue.validator === 'CharacterIntroductionValidator');
  if (introIssues.length === 0) return true;
  return introIssues.every((issue) => {
    const location = String((issue as RepairableIssue & { location?: unknown }).location || '');
    const message = String(issue.message || '');
    const isOffPage = location.includes(':offpage-familiarity')
      || location.includes(':offpage-backreference')
      || /off-page familiarity|settled group belonging|back-reference/i.test(message);
    if (isOffPage) {
      const name = /"([^"]+)"/.exec(message)?.[1];
      return scenePassesCharacterIntroductionOffPageCheck(
        scene as unknown as import('../../types').Scene,
        name ? [name] : [],
      );
    }
    const isPlantLeak = location.includes(':anonymous-plant-leak')
      || /anonymous plant|scheduled as an anonymous plant|roster identity must stay hidden/i.test(message);
    const npcId = parseCharacterIntroductionNpcId(location);
    // Metadata-only / never-names: require the name in prose, OR anonymous-plant
    // first-contact staging. Plant-leak: name must be ABSENT (handled inside
    // characterIntroductionIssueCleared — do not pass a bogus pop()'d suffix).
    const anonymousHint = !isPlantLeak && /anonymous|stranger|first-contact plant|visual cues/i.test(
      `${issue.suggestion || ''} ${message}`,
    );
    return characterIntroductionIssueCleared(
      scene as unknown as import('../../types').Scene,
      issue,
      {
        npcId,
        ...(anonymousHint || isPlantLeak
          ? { anonymousPlantNpcIds: new Set([npcId || ''].filter(Boolean)) }
          : {}),
      },
    );
  });
}

function allMomentsDepicted(
  scene: RepairableStoryScene,
  issues: RepairableIssue[],
  plannedSource?: SceneContractSource,
): boolean {
  const prose = sceneProseForScoring(scene);
  return plannedSourceMomentsDepicted(scene, plannedSource) && issues.every((issue) => {
    if (issue.validator === 'CharacterIntroductionValidator') {
      return characterIntroductionIssuesCleared(scene, [issue]);
    }
    if (isProseHygieneIssue(issue)) {
      return proseHygieneIssueCleared(scene, issue);
    }
    const moment = requiredMomentFromMessage(issue.message);
    if (!moment) return !MOMENT_REALIZATION_VALIDATORS.has(issue.validator ?? '');
    if (issue.validator === 'TreatmentEventLedgerValidator') {
      return hasDirectTreatmentEventRealization(moment, prose);
    }
    if (issue.validator === 'RequiredBeatRealizationValidator') {
      return requiredBeatFullyLandedForRepair(moment, prose);
    }
    return evaluateMomentRealization(issue.validator, moment, prose).depicted;
  });
}

/** Localized prose defects that should not cause whole-scene restore rollback. */
function isProseHygieneIssue(issue: RepairableIssue): boolean {
  return issue.type === 'unsafe_fallback_prose'
    || issue.validator === 'RelationshipArcLedgerValidator'
    || (issue.validator === 'RouteContinuityValidator' && issue.type === 'unsafe_fallback_prose');
}

function sceneContainsRegisteredPlaceholder(scene: RepairableStoryScene): boolean {
  const prose = sceneProseForScoring(scene);
  return /The moment still needs authored prose before it can continue/i.test(prose)
    || SYNTHETIC_FALLBACK_PROSE_PATTERNS.some((entry) => entry.pattern.test(prose));
}

function sceneContainsTreatmentProseLeak(scene: RepairableStoryScene): boolean {
  type FieldBeat = {
    text?: string;
    setupText?: string;
    escalationText?: string;
    visualMoment?: string;
    primaryAction?: string;
    textVariants?: Array<{ text?: string }>;
  };
  const checkBeat = (beat: FieldBeat | undefined): boolean => {
    if (!beat) return false;
    const fields = [
      beat.text, beat.setupText, beat.escalationText,
      beat.visualMoment, beat.primaryAction,
      ...(beat.textVariants ?? []).map((v) => v?.text),
    ];
    return fields.some((field) => typeof field === 'string' && isUnsafeCoverageMetadataText(field));
  };
  if ((scene.beats ?? []).some((beat) => checkBeat(beat as FieldBeat))) return true;
  const enc = scene.encounter;
  if (!enc) return false;
  for (const phase of enc.phases || []) {
    if ((phase.beats ?? []).some((beat) => checkBeat(beat as FieldBeat))) return true;
  }
  const storylets = Array.isArray(enc.storylets) ? enc.storylets : Object.values(enc.storylets ?? {});
  for (const storylet of storylets) {
    if ((storylet?.beats ?? []).some((beat) => checkBeat(beat as FieldBeat))) return true;
  }
  return false;
}

function proseHygieneIssueCleared(scene: RepairableStoryScene, issue: RepairableIssue): boolean {
  if (issue.type === 'unsafe_fallback_prose') {
    // Cleared only when both registered synthetic placeholders AND treatment
    // synopsis leaks (including visualMoment/primaryAction) are gone.
    return !sceneContainsRegisteredPlaceholder(scene) && !sceneContainsTreatmentProseLeak(scene);
  }
  if (issue.validator === 'RelationshipArcLedgerValidator') {
    // Critic rewrites are accepted for predicted-clear; final revalidation is the net.
    // Restoring over a successful label soften resurrected the prior failure mode.
    return true;
  }
  return true;
}

function proseHygieneIssuesCleared(scene: RepairableStoryScene, issues: RepairableIssue[]): boolean {
  const hygiene = issues.filter(isProseHygieneIssue);
  if (hygiene.length === 0) return false;
  return hygiene.every((issue) => proseHygieneIssueCleared(scene, issue));
}

function requiredBeatFullyLandedForRepair(moment: string, prose: string): boolean {
  const assessment = evaluateMomentRealization('RequiredBeatRealizationValidator', moment, prose);
  if (!assessment.depicted) return false;
  return missingRequiredBeatTokensForRepair(moment, prose).length === 0;
}

function missingRequiredBeatTokensForRepair(moment: string, prose: string): string[] {
  const missing = missingMomentTokens('RequiredBeatRealizationValidator', moment, prose);
  const normalizedProse = normalizeRealizationText(prose);
  return missing.filter((token) => !(token === 'kylie' && /\byou\b/.test(normalizedProse)));
}

function missingRequiredBeatFragmentsForRepair(moment: string, prose: string): string[] {
  const assessment = evaluateMomentRealization('RequiredBeatRealizationValidator', moment, prose);
  return assessment.missingClauses.filter((clause) => {
  const tokens = contentTokensForRealization(clause, stopwordsForRealization('RequiredBeatRealizationValidator'));
    return tokens.length > 0;
  });
}

function targetBeatForRequiredBeatFallback(scene: RepairableStoryScene, moment: string): { text?: string } | undefined {
  const beats = repairableBeatsFor(scene);
  if (beats.length === 0) return undefined;
  const stopwords = stopwordsForRealization('RequiredBeatRealizationValidator');
  const momentTokens = new Set(contentTokensForRealization(moment, stopwords));
  let best = beats[0];
  let bestScore = -1;
  for (const beat of beats) {
    const text = beat.text ?? '';
    const tokens = new Set(contentTokensForRealization(text, stopwords));
    const score = [...momentTokens].filter((token) => tokens.has(token)).length;
    if (score > bestScore) {
      best = beat;
      bestScore = score;
    }
  }
  return best;
}

function fictionFacingRequiredBeatSentence(moment: string): string {
  let sentence = moment.trim().replace(/\s+/g, ' ');
  sentence = sentence
    .replace(/^(?:and|or|then)\s+/i, '')
    .replace(/^That her job is\b/i, 'Your job is')
    .replace(/\bthe protagonist's\b/ig, 'your')
    .replace(/\bthe protagonist\b/ig, 'you');
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

function isSafeRequiredBeatFallbackSentence(sentence: string): boolean {
  const tokens = contentTokensForRealization(sentence, stopwordsForRealization('RequiredBeatRealizationValidator'));
  return tokens.length >= 4
    || /["'“”‘’][^"'“”‘’]{8,}["'“”‘’]/.test(sentence)
    || (/\byou\b/i.test(sentence) && /,\s*[a-z][a-z'’.-]{2,}\.?$/i.test(sentence));
}

function compactSceneTurnFragments(moment: string, prose: string): string[] {
  const fragments = missingRequiredBeatFragmentsForRepair(moment, prose);
  return fragments.filter((fragment) => {
    const tokens = contentTokensForRealization(fragment, stopwordsForRealization('RequiredBeatRealizationValidator'));
    if (tokens.length === 0 || tokens.length > 14) return false;
    if (/\b(?:yesterday|tomorrow|week|month|year|episode|later|earlier|before|after|meanwhile)\b/i.test(fragment)) {
      return false;
    }
    return true;
  });
}

function appendRequiredBeatFallback(scene: RepairableStoryScene, issues: RepairableIssue[]): number {
  let appended = 0;
  for (const issue of issues) {
    if (issue.validator !== 'RequiredBeatRealizationValidator') continue;
    const moment = requiredMomentFromMessage(issue.message);
    if (!moment) continue;
    if (requiredBeatFullyLandedForRepair(moment, sceneProseForScoring(scene))) continue;
    const beat = targetBeatForRequiredBeatFallback(scene, moment);
    if (!beat || typeof beat.text !== 'string') continue;
    const fragments = missingRequiredBeatFragmentsForRepair(moment, sceneProseForScoring(scene));
    for (const fragment of (fragments.length > 0 ? fragments : [moment])) {
      const sentence = fictionFacingRequiredBeatSentence(fragment);
      if (!isSafeRequiredBeatFallbackSentence(sentence)) continue;
      if (isPlanningRegisterText(sentence)) continue;
      if (normalizeRealizationText(beat.text).includes(normalizeRealizationText(sentence))) continue;
      beat.text = `${beat.text.trim()} ${sentence}`.trim();
      appended += 1;
    }
    if (fragments.length > 0 || !requiredBeatFullyLandedForRepair(moment, sceneProseForScoring(scene))) {
      const sentence = fictionFacingRequiredBeatSentence(moment);
      if (!isSafeRequiredBeatFallbackSentence(sentence)) continue;
      if (isPlanningRegisterText(sentence)) continue;
      if (!normalizeRealizationText(beat.text).includes(normalizeRealizationText(sentence))) {
        beat.text = `${beat.text.trim()} ${sentence}`.trim();
        appended += 1;
      }
    }
  }
  return appended;
}

function appendSceneTurnFallback(scene: RepairableStoryScene, issues: RepairableIssue[]): number {
  let appended = 0;
  for (const issue of issues) {
    if (issue.validator !== 'SceneTurnRealizationValidator') continue;
    if (/generic planner central turn/i.test(issue.message || '')) continue;
    if (scene.encounter) continue;
    const moment = requiredMomentFromMessage(issue.message);
    if (!moment) continue;
    if (requiredBeatFullyLandedForRepair(moment, sceneProseForScoring(scene))) continue;
    const fragments = compactSceneTurnFragments(moment, sceneProseForScoring(scene));
    if (fragments.length === 0) continue;
    const beat = targetBeatForRequiredBeatFallback(scene, moment);
    if (!beat || typeof beat.text !== 'string') continue;
    for (const fragment of fragments) {
      const sentence = fictionFacingRequiredBeatSentence(fragment);
      if (normalizeRealizationText(beat.text).includes(normalizeRealizationText(sentence))) continue;
      beat.text = `${beat.text.trim()} ${sentence}`.trim();
      appended += 1;
    }
  }
  return appended;
}

/** Find a scene by id across the assembled story's episodes. */
function findStoryScene(story: Story, sceneId: string, episodeNumber?: number): RepairableStoryScene | undefined {
  for (const episode of (story as { episodes?: Array<{ number?: number; scenes?: RepairableStoryScene[] }> }).episodes ?? []) {
    if (episodeNumber !== undefined && episode.number !== undefined && episode.number !== episodeNumber) continue;
    for (const scene of episode.scenes ?? []) {
      if (scene.id === sceneId) return scene;
    }
  }
  return undefined;
}

function findSceneCluster(
  story: Story,
  centerSceneId: string,
  episodeNumber?: number,
): Array<{ scene: RepairableStoryScene; role: 'previous' | 'center' | 'next' }> {
  for (const episode of (story as { episodes?: Array<{ number?: number; scenes?: RepairableStoryScene[] }> }).episodes ?? []) {
    if (episodeNumber !== undefined && episode.number !== undefined && episode.number !== episodeNumber) continue;
    const scenes = episode.scenes ?? [];
    const index = scenes.findIndex((scene) => scene.id === centerSceneId);
    if (index < 0) continue;
    const out: Array<{ scene: RepairableStoryScene; role: 'previous' | 'center' | 'next' }> = [];
    if (scenes[index - 1]) out.push({ scene: scenes[index - 1], role: 'previous' });
    out.push({ scene: scenes[index], role: 'center' });
    if (scenes[index + 1]) out.push({ scene: scenes[index + 1], role: 'next' });
    return out;
  }
  return [];
}

/** Adapt an assembled-story scene to the SceneContent shape SceneCritic reads. */
function adaptSceneForCritic(
  scene: RepairableStoryScene,
  beats: Array<{ id?: string; text?: string }>,
): SceneContent {
  return {
    sceneId: scene.id ?? '',
    sceneName: scene.name ?? scene.id ?? '',
    beats,
    moodProgression: [],
    charactersInvolved: [],
    keyMoments: [],
    continuityNotes: [],
  } as unknown as SceneContent;
}

export interface SceneProseRepairOptions {
  /**
   * Provides the SceneCritic to rewrite with (the run's critic, or a one-off
   * the caller constructs from the scene-writer config). Returning null
   * disables the handler for the round (changed: false).
   */
  critic: () => SceneCritic | null;
  /** Optional progress sink (goes to the pipeline event stream). */
  emit?: (message: string) => void;
  /** Scenes repaired per round cap (default 4). */
  maxScenesPerRound?: number;
  /**
   * Optional repair router hook. When provided, same-scene prose repair only
   * receives findings classified as `same_scene_retry`.
   */
  routeIssue?: (issue: RepairableIssue) => RepairDirective;
  /**
   * Optional final guard for deterministic fallback appends. This is separate
   * from routeIssue so callers can keep cluster rewrites while forbidding late
   * one-beat stuffing for time-coded or overloaded findings.
   */
  allowRequiredBeatFallback?: (issue: RepairableIssue, scene: RepairableStoryScene) => boolean;
  /**
   * Planned scene obligations from the season scene plan. Assembled story scenes
   * intentionally omit generator-only `requiredBeats`, but repair rewrites must
   * still preserve already-realized planned treatment moments.
   */
  plannedMomentSources?: ReadonlyMap<string, SceneContractSource> | Record<string, SceneContractSource | undefined>;
  /**
   * When true, do not commit an LLM rewrite unless the handler's local realization
   * check predicts the current blocking checklist will clear. This is used by the
   * final-contract loop to avoid repeated spend on partial rewrites of the same
   * authored moment; other callers may keep degraded partial-repair behavior.
   */
  requirePredictedClear?: boolean;
  /**
   * Shared between the prose and cluster handlers of ONE final-contract loop:
   * cluster centers already attempted (episodeNumber:sceneId keys). The prose
   * handler defers a scene to cluster repair while any of its blockers route
   * scene_cluster_rewrite — but the cluster handler never re-attempts a
   * center. Without this set the two handlers deadlock from round 2 on: prose
   * keeps deferring, cluster keeps skipping, and the scene's blocker survives
   * to fail the run (bite-me 2026-07-03T14-10-21 s1-1). Once cluster has had
   * its attempt, the prose handler takes the scene's same-scene findings.
   */
  clusterAttemptedCenters?: Set<string>;
}

function plannedMomentSourceFor(
  sources: SceneProseRepairOptions['plannedMomentSources'],
  sceneId: string | undefined,
): SceneContractSource | undefined {
  if (!sources || !sceneId) return undefined;
  if (typeof (sources as ReadonlyMap<string, SceneContractSource>).get === 'function') {
    return (sources as ReadonlyMap<string, SceneContractSource>).get(sceneId);
  }
  return (sources as Record<string, SceneContractSource | undefined>)[sceneId];
}

/**
 * Build the ContractRepairHandler. Plugs into runFinalContractRepair alongside
 * the deterministic handlers; the loop re-validates after each round, so a
 * successful rewrite clears the finding on the next validation pass.
 */
export function buildSceneProseRepairHandler(opts: SceneProseRepairOptions): ContractRepairHandler {
  // Persists across repair rounds (the handler is built once per contract
  // enforcement), so later rounds prioritize scenes never attempted yet.
  const attemptedScenes = new Set<string>();
  // Also persists across rounds: concrete authored moments already repaired for
  // a scene become preservation obligations on later rewrites of that scene.
  // Without this, round N can fix moment B while accidentally deleting moment A
  // because A no longer appears in the current contract's blocking list.
  const cumulativeMomentIssuesByScene = new Map<string, RepairableIssue[]>();
  return async ({ story, blockingIssues }) => {
    const clusterRoutedSceneKeys = new Set<string>();
    if (opts.routeIssue) {
      for (const issue of blockingIssues ?? []) {
        if (!issue.sceneId) continue;
        const route = opts.routeIssue(issue);
        if (route.kind === 'scene_cluster_rewrite') {
          clusterRoutedSceneKeys.add(`${issue.episodeNumber ?? ''}:${issue.sceneId}`);
        }
      }
    }
    const groups = selectSceneProseRepairs(
      blockingIssues,
      opts.maxScenesPerRound ?? 4,
      attemptedScenes,
      opts.routeIssue
        ? (issue) => {
            const sceneKey = `${issue.episodeNumber ?? ''}:${issue.sceneId}`;
            if (clusterRoutedSceneKeys.has(sceneKey) && !opts.clusterAttemptedCenters?.has(sceneKey)) {
              opts.emit?.(`Scene-prose contract repair deferred ${issue.sceneId || '(unknown scene)'} to cluster repair because the scene has scene-cluster routed blocker(s).`);
              return false;
            }
            const route = opts.routeIssue!(issue);
            if (route.kind !== 'same_scene_retry') {
              // Cluster-routed issue on a center cluster repair already tried:
              // take it same-scene rather than orphaning it (the cluster
              // handler never re-attempts a center).
              if (route.kind === 'scene_cluster_rewrite' && opts.clusterAttemptedCenters?.has(sceneKey)) {
                opts.emit?.(`Scene-prose contract repair taking ${issue.sceneId || '(unknown scene)'} same-scene after cluster repair already attempted it.`);
                return true;
              }
              opts.emit?.(`Scene-prose contract repair routed away from ${issue.sceneId || '(unknown scene)'}: ${route.kind} (${route.reason})`);
              return false;
            }
            return true;
          }
        : undefined,
    );
    if (groups.size === 0) return { story, changed: false };

    const critic = opts.critic();
    if (!critic) {
      opts.emit?.('Scene-prose contract repair skipped: no SceneCritic available.');
      return { story, changed: false };
    }

    let totalMerged = 0;
    let criticCalls = 0;
    const repairedScenes: string[] = [];
    const clearedScenes: string[] = [];
    // Fingerprints of the CURRENT round's issues this handler actually worked
    // on — reported so the loop charges per-issue budget only for attempted
    // issues (capped at maxScenesPerRound, so selection ≠ attempt; see g23).
    const attemptedIssueKeys = new Set<string>();
    for (const [sceneId, currentIssues] of groups) {
      const cumulativeMomentIssues = mergeRepairIssues(
        cumulativeMomentIssuesByScene.get(sceneId) ?? [],
        currentIssues.filter(isCumulativeMomentObligation),
      );
      if (cumulativeMomentIssues.length > 0) {
        cumulativeMomentIssuesByScene.set(sceneId, cumulativeMomentIssues);
      }
      const issues = mergeRepairIssues(currentIssues, cumulativeMomentIssues);
      const scene = findStoryScene(story, sceneId, issues[0]?.episodeNumber);
      // Empty playable scene (R5 dead end #2): a flagged scene with NO beats
      // gets an empty scaffold so SceneCritic has rewrite targets. Wiring only
      // — the LLM authors the prose; unfilled scaffolds are pruned afterwards.
      let scaffoldedBeatIds: string[] = [];
      let preScaffoldSnapshot: RepairableStoryScene | undefined;
      if (
        scene
        && repairableBeatsFor(scene).length === 0
        && issues.some((issue) => issue.validator === 'EmptyPlayableSceneValidator')
      ) {
        preScaffoldSnapshot = cloneRepairableScene(scene);
        scaffoldedBeatIds = scaffoldEmptySceneBeats(scene);
        if (scaffoldedBeatIds.length > 0) {
          opts.emit?.(`Scene-prose contract repair: seeded ${scaffoldedBeatIds.length} empty beat scaffold(s) in ${sceneId} for LLM authoring (empty playable scene).`);
        }
      }
      const initialBeats = scene ? repairableBeatsFor(scene) : [];
      if (!scene || initialBeats.length === 0) {
        opts.emit?.(`Scene-prose contract repair: scene ${sceneId} not found or has no rewritable prose; skipping.`);
        continue;
      }
      attemptedScenes.add(sceneId);
      for (const issue of currentIssues) attemptedIssueKeys.add(contractRepairIssueFingerprint(issue));
      // Encounter scenes carry prose in encounter.phases/storylets, not
      // scene.beats — merge the rewrite back to the surface it came from.
      const isEncounterScene = !scene.beats?.length;
      const plannedSource = plannedMomentSourceFor(opts.plannedMomentSources, sceneId);
      const preservedMomentLabels = realizedRequiredMomentLabels(scene, plannedSource);
      const preservationNotes = preservedMomentLabels.length > 0
        ? `\n\nLOCKED EXISTING MOMENTS: this scene already depicts these required moments. Preserve them on-page while making the repair; do not paraphrase them away or delete their concrete nouns/dialogue.\n- ${preservedMomentLabels.join('\n- ')}`
        : '';
      const sceneBeforeRepair = cloneRepairableScene(scene);
      try {
        // Up to two critic passes per scene per round: the first works from a
        // checklist of the moment's still-missing content words; if the merged
        // result STILL would not clear the validator's keyword check (mirrored
        // locally — no LLM cost), one immediate retry runs with the freshly
        // recomputed missing-word list. Without this, a partial dramatization
        // burned an entire repair round before re-validation caught it.
        let sceneMerged = 0;
        let predictedClear = false;
        let lostRequiredMomentsForRetry: string[] = [];
        for (let attempt = 1; attempt <= 2 && !predictedClear; attempt++) {
          const beats = repairableBeatsFor(scene); // re-read: attempt 2 sees attempt 1's merge
          const plannedNotes = plannedMissingMomentNotes(scene, plannedSource);
          const retryNotes = lostRequiredMomentsForRetry.length > 0
            ? `\n\nPREVIOUS REWRITE WAS REJECTED because it deleted these already-realized required moments. This retry must keep them explicitly on-page while adding the missing repair:\n- ${lostRequiredMomentsForRetry.join('\n- ')}`
            : '';
          const critique = await withTimeout(
            critic.execute({
              scene: adaptSceneForCritic(scene, beats),
              directorNotes: `${buildSceneRepairDirectorNotes(issues, sceneProseForScoring(scene))}${plannedNotes}${preservationNotes}${retryNotes}`,
            }),
            PIPELINE_TIMEOUTS.llmAgent,
            `SceneCritic.contractRepair(${sceneId}#${attempt})`,
          ).catch((err) => {
            opts.emit?.(`Scene-prose contract repair for ${sceneId} attempt ${attempt} failed (keeping latest merged prose): ${err instanceof Error ? err.message : String(err)}`);
            return undefined;
          });
          if (!critique) break;
          criticCalls += 1;
          if (critique.success && critique.data) {
            // Surface rewrites that matched NO beat (drifted ids) — otherwise the
            // repair looks like it ran while the gate keeps failing, with no signal.
            const warnUnmatched = (ids: string[]) => opts.emit?.(
              `Scene-prose contract repair: ${ids.length} rewritten beat(s) [${ids.join(', ')}] in ${sceneId} matched no beat ` +
              `(drifted beat ids) — those rewrites were NOT applied.`,
            );
            const beforeRewrite = cloneRepairableScene(scene);
            const merged = isEncounterScene
              ? mergeRewrittenEncounterBeatsIntoStory(story as never, sceneId, critique.data.rewrittenBeats as never, warnUnmatched)
              : mergeRewrittenBeatsIntoStory(story as never, sceneId, critique.data.rewrittenBeats as never, warnUnmatched);
            if (merged > 0) {
              const preservation = preserveLostRequiredMoments(
                beforeRewrite,
                scene,
                plannedSource,
              );
              if (preservation.remainingLost.length > 0) {
                restoreRepairableScene(scene, beforeRewrite);
                lostRequiredMomentsForRetry = preservation.remainingLost;
                opts.emit?.(
                  `Scene-prose contract repair: rejected rewrite for ${sceneId} because it lost already-realized required moment(s): ` +
                  preservation.remainingLost.join('; '),
                );
              } else {
                if (preservation.preserved > 0) {
                  opts.emit?.(
                    `Scene-prose contract repair: preserved ${preservation.preserved} already-realized required moment(s) in ${sceneId} after rewrite.`,
                  );
                }
                sceneMerged += merged;
              }
            }
          }
          predictedClear = allMomentsDepicted(scene, issues, plannedSource);
          if (!predictedClear && attempt === 1) {
            opts.emit?.(`Scene-prose contract repair: ${sceneId} still missing authored content after rewrite — retrying with the remaining checklist.`);
          }
        }
        const fallbackIssues = opts.allowRequiredBeatFallback
          ? issues.filter((issue) => opts.allowRequiredBeatFallback!(issue, scene))
          : issues;
        const skippedFallbacks = issues.length - fallbackIssues.length;
        if (!predictedClear && skippedFallbacks > 0) {
          opts.emit?.(
            `Scene-prose contract repair: skipped ${skippedFallbacks} required beat fallback append(s) in ${sceneId}; router marked them unsafe for late prose insertion.`,
          );
        }
        const fallbackAppended = appendRequiredBeatFallback(scene, fallbackIssues);
        if (fallbackAppended > 0) {
          sceneMerged += fallbackAppended;
          predictedClear = allMomentsDepicted(scene, issues, plannedSource);
          opts.emit?.(
            `Scene-prose contract repair: appended ${fallbackAppended} required beat fallback(s) in ${sceneId}` +
            ` (${predictedClear ? 'now depicts every flagged moment' : 'authored content STILL incomplete'}).`,
          );
        }
        if (sceneMerged > 0) {
          if (opts.requirePredictedClear && !predictedClear) {
            // Don't whole-scene restore when hygiene-only issues (placeholder /
            // membership labels) cleared — that resurrected registered
            // fallback prose forever (bite-me 2026-07-08T00-01-23).
            if (proseHygieneIssuesCleared(scene, issues)) {
              totalMerged += sceneMerged;
              repairedScenes.push(sceneId);
              opts.emit?.(
                `Scene-prose contract repair: kept ${sceneId} rewrite because prose-hygiene findings cleared even though the authored checklist is still incomplete.`,
              );
              continue;
            }
            restoreRepairableScene(scene, sceneBeforeRepair);
            opts.emit?.(
              `Scene-prose contract repair: restored ${sceneId} because the rewrite still did not satisfy the authored checklist after bounded retry.`,
            );
            continue;
          }
          totalMerged += sceneMerged;
          repairedScenes.push(sceneId);
          if (predictedClear) clearedScenes.push(sceneId);
          opts.emit?.(
            `Scene-prose contract repair: rewrote ${sceneMerged} beat(s) in ${sceneId} for ${issues.length} blocking finding(s)` +
            ` (${predictedClear ? 'now depicts every flagged moment' : 'authored content STILL incomplete after retry'}).`,
          );
        }
      } catch (err) {
        opts.emit?.(`Scene-prose contract repair for ${sceneId} failed (keeping original): ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        // Empty-scene scaffolds the LLM did not fill must never survive: prune
        // them (restoring the pre-scaffold scene when nothing was authored).
        const pruned = pruneEmptyScaffoldBeats(scene, scaffoldedBeatIds, preScaffoldSnapshot);
        if (pruned > 0) {
          opts.emit?.(`Scene-prose contract repair: pruned ${pruned} unfilled beat scaffold(s) from ${sceneId}.`);
        }
      }
    }

    if (totalMerged === 0) {
      // Still report what was attempted: a failed attempt spends the issue's
      // budget just like a successful one.
      return { story, changed: false, attemptedIssueKeys: Array.from(attemptedIssueKeys) };
    }
    return {
      story,
      changed: true,
      attemptedIssueKeys: Array.from(attemptedIssueKeys),
      record: {
        rule: 'final_contract_scene_prose',
        scope: 'scene',
        attempted: groups.size,
        succeeded: clearedScenes.length === groups.size,
        degraded: clearedScenes.length < groups.size,
        blocked: false,
        attempts: criticCalls,
        details: `Rewrote ${totalMerged} beat(s) across ${repairedScenes.join(', ')}; ${clearedScenes.length}/${groups.size} scene(s) predicted to clear`,
      },
    };
  };
}

export function buildSceneClusterRepairHandler(opts: SceneProseRepairOptions): ContractRepairHandler {
  const attemptedCenters = opts.clusterAttemptedCenters ?? new Set<string>();
  return async ({ story, blockingIssues }) => {
    const candidates = blockingIssues.filter(
      (issue) => {
        if (!issue.sceneId || !issue.validator || !SCENE_CLUSTER_REPAIRABLE_VALIDATORS.has(issue.validator)) return false;
        if (!opts.routeIssue) return true;
        const route = opts.routeIssue(issue);
        if (route.kind !== 'scene_cluster_rewrite') {
          opts.emit?.(`Scene-cluster contract repair routed away from ${issue.sceneId}: ${route.kind} (${route.reason})`);
          return false;
        }
        return true;
      },
    );
    if (candidates.length === 0) return { story, changed: false };

    const critic = opts.critic();
    if (!critic) {
      opts.emit?.('Scene-cluster contract repair skipped: no SceneCritic available.');
      return { story, changed: false };
    }

    const centers = candidates
      .filter((issue) => !attemptedCenters.has(`${issue.episodeNumber ?? ''}:${issue.sceneId}`))
      .slice(0, opts.maxScenesPerRound ?? 2);
    if (centers.length === 0) return { story, changed: false };

    let totalMerged = 0;
    let criticCalls = 0;
    const repairedCenters: string[] = [];
    // See buildSceneProseRepairHandler — attempted issues (capped at 2
    // centers/round) are reported so only they spend per-issue budget.
    const attemptedIssueKeys = new Set<string>();

    for (const issue of centers) {
      const centerId = issue.sceneId!;
      attemptedCenters.add(`${issue.episodeNumber ?? ''}:${centerId}`);
      const cluster = findSceneCluster(story, centerId, issue.episodeNumber);
      if (cluster.length === 0) {
        opts.emit?.(`Scene-cluster contract repair: scene ${centerId} not found; skipping.`);
        continue;
      }
      const clusterSummary = cluster
        .map(({ scene, role }) => `${role}: ${scene.id || '(unknown)'} — ${scene.name || ''}`)
        .join(' | ');
      const centerIssues = candidates.filter((candidate) =>
        candidate.sceneId === centerId
        && candidate.episodeNumber === issue.episodeNumber,
      );
      for (const candidate of centerIssues) attemptedIssueKeys.add(contractRepairIssueFingerprint(candidate));
      const centerIssueNotes = centerIssues
        .map((candidate) => `- ${candidate.message ?? 'unspecified finding'}${candidate.suggestion ? ` (fix: ${candidate.suggestion})` : ''}`)
        .join('\n');
      const sharedNotes = [
        'The final-story contract flagged a scene-flow failure. Repair this cluster so the center scene has a complete dramatic turn: setup/pre-turn pressure -> turn event -> aftermath or handoff.',
        `Flagged finding(s):\n${centerIssueNotes}`,
        `Cluster order: ${clusterSummary}`,
        issue.validator === 'NarrativeMechanicPressureValidator'
          ? 'Mechanic-pressure repair goal: plant, intensify, and spend hidden state as visible fiction. Show evidence before the mechanic changes, show residue immediately after, and only let later choices/routes/payoffs use pressure that the cluster has earned.'
          : '',
        'Preserve scene ids, beat ids where possible, choices, nextSceneId routes, and established facts. Do not invent a new plot branch. Add or rewrite only enough prose to make the turn earned and the transition grounded.',
      ].filter(Boolean).join('\n');

      for (const { scene, role } of cluster) {
        const sceneId = scene.id;
        if (!sceneId) continue;
        const beats = repairableBeatsFor(scene);
        if (beats.length === 0) continue;
        const isEncounterScene = !scene.beats?.length;
        const plannedSource = plannedMomentSourceFor(opts.plannedMomentSources, sceneId);
        const preservedMomentLabels = realizedRequiredMomentLabels(scene, plannedSource);
        const preservationNotes = preservedMomentLabels.length > 0
          ? `\n\nLOCKED EXISTING MOMENTS: the current ${role} scene already depicts these required moments. Preserve them on-page while making the repair; do not paraphrase them away or delete their concrete nouns/dialogue.\n- ${preservedMomentLabels.join('\n- ')}`
          : '';
        try {
          let lostRequiredMomentsForRetry: string[] = [];
          for (let attempt = 1; attempt <= 2; attempt++) {
            const attemptBeats = attempt === 1 ? beats : repairableBeatsFor(scene);
            const retryNotes = lostRequiredMomentsForRetry.length > 0
              ? `\n\nPREVIOUS REWRITE WAS REJECTED because it deleted these already-realized required moments. This retry must keep them explicitly on-page while adding the missing repair:\n- ${lostRequiredMomentsForRetry.join('\n- ')}`
              : '';
            const critique = await withTimeout(
              critic.execute({
                scene: adaptSceneForCritic(scene, attemptBeats),
                directorNotes: `${sharedNotes}\n\nThis is the ${role} scene in the repair cluster. ${role === 'center'
                  ? 'Make the central turn visible and followed through.'
                  : 'Make this neighbor support continuity into or out of the central turn without stealing the turn.'}${preservationNotes}${retryNotes}`,
              }),
              PIPELINE_TIMEOUTS.llmAgent,
              `SceneCritic.clusterRepair(${centerId}:${sceneId}#${attempt})`,
            );
            criticCalls += 1;
            if (critique.success && critique.data) {
              const warnUnmatched = (ids: string[]) => opts.emit?.(
                `Scene-cluster contract repair: ${ids.length} rewritten beat(s) [${ids.join(', ')}] in ${sceneId} matched no beat.`,
              );
              const beforeRewrite = cloneRepairableScene(scene);
              const merged = isEncounterScene
                ? mergeRewrittenEncounterBeatsIntoStory(story as never, sceneId, critique.data.rewrittenBeats as never, warnUnmatched)
                : mergeRewrittenBeatsIntoStory(story as never, sceneId, critique.data.rewrittenBeats as never, warnUnmatched);
              if (merged > 0) {
                const preservation = preserveLostRequiredMoments(
                  beforeRewrite,
                  scene,
                  plannedSource,
                );
                if (preservation.remainingLost.length > 0) {
                  restoreRepairableScene(scene, beforeRewrite);
                  lostRequiredMomentsForRetry = preservation.remainingLost;
                  opts.emit?.(
                    `Scene-cluster contract repair: rejected rewrite for ${sceneId} because it lost already-realized required moment(s): ` +
                    preservation.remainingLost.join('; '),
                  );
                  if (attempt < 2) continue;
                } else {
                  if (preservation.preserved > 0) {
                    opts.emit?.(
                      `Scene-cluster contract repair: preserved ${preservation.preserved} already-realized required moment(s) in ${sceneId} after rewrite.`,
                    );
                  }
                  totalMerged += merged;
                  break;
                }
              }
            }
            break;
          }
        } catch (err) {
          opts.emit?.(`Scene-cluster contract repair for ${sceneId} failed (keeping original): ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      const pairedRequiredBeatIssues = blockingIssues.filter(
        (blockingIssue) =>
          blockingIssue.sceneId === centerId
          && blockingIssue.episodeNumber === issue.episodeNumber
          && blockingIssue.validator === 'RequiredBeatRealizationValidator',
      );
      if (pairedRequiredBeatIssues.length > 0) {
        const centerScene = cluster.find((entry) => entry.role === 'center')?.scene;
        const safeFallbackIssues = centerScene && opts.allowRequiredBeatFallback
          ? pairedRequiredBeatIssues.filter((blockingIssue) => opts.allowRequiredBeatFallback!(blockingIssue, centerScene))
          : pairedRequiredBeatIssues;
        const skipped = pairedRequiredBeatIssues.length - safeFallbackIssues.length;
        if (skipped > 0) {
          opts.emit?.(
            `Scene-cluster contract repair: skipped ${skipped} required beat fallback append(s) in ${centerId}; router marked them unsafe for late prose insertion.`,
          );
        }
        const appended = centerScene ? appendRequiredBeatFallback(centerScene, safeFallbackIssues) : 0;
        if (appended > 0) {
          totalMerged += appended;
          opts.emit?.(
            `Scene-cluster contract repair: re-appended ${appended} required beat fallback(s) in ${centerId} after cluster rewrite.`,
          );
        }
      }
      const centerScene = cluster.find((entry) => entry.role === 'center')?.scene;
      const appendedSceneTurn = centerScene ? appendSceneTurnFallback(centerScene, centerIssues) : 0;
      if (appendedSceneTurn > 0) {
        totalMerged += appendedSceneTurn;
        opts.emit?.(
          `Scene-cluster contract repair: re-appended ${appendedSceneTurn} compact scene-turn fragment(s) in ${centerId} after cluster rewrite.`,
        );
      }
      repairedCenters.push(centerId);
    }

    if (totalMerged === 0) return { story, changed: false, attemptedIssueKeys: Array.from(attemptedIssueKeys) };
    return {
      story,
      changed: true,
      attemptedIssueKeys: Array.from(attemptedIssueKeys),
      record: {
        rule: 'final_contract_scene_cluster',
        scope: 'scene',
        attempted: repairedCenters.length,
        succeeded: true,
        degraded: false,
        blocked: false,
        attempts: criticCalls,
        details: `Cluster-rewrote ${totalMerged} beat(s) around ${repairedCenters.join(', ')}`,
      },
    };
  };
}
