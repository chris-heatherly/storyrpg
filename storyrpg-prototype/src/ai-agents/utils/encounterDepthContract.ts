/**
 * Encounter depth contract (G12).
 *
 * Every g12 encounter was a depth-2 tree whose 4th root option was a TERMINAL
 * victory at depth 1 with zero consequences — the bottleneck set-piece could be
 * won in one click. And the goal clock had 6 segments while the best authored
 * path could tick at most 5, so the rendered OBJECTIVE clock could never visibly
 * complete even on perfect play. Deterministic analysis + an honest-clock autofix.
 */

import type { Encounter } from '../../types/encounter';

export interface EncounterDepthAnalysis {
  /** Best (max) total goal ticks attainable along any single path. */
  maxGoalTicks: number;
  /** Best (max) total threat ticks attainable along any single path. */
  maxThreatTicks: number;
  goalSegments: number;
  /** Choice ids whose outcome ends the encounter in victory/partialVictory at depth 1. */
  oneClickWins: Array<{ choiceId: string; outcome: string; hasConsequences: boolean }>;
  maxDepth: number;
}

interface ChoiceLike {
  id?: string;
  text?: string;
  approach?: string;
  primarySkill?: string;
  outcomes?: Record<string, OutcomeLike | undefined>;
}

interface OutcomeLike {
  tier?: string;
  narrativeText?: string;
  goalTicks?: number;
  threatTicks?: number;
  isTerminal?: boolean;
  encounterOutcome?: string;
  consequences?: unknown[];
  nextSituation?: { setupText?: string; choices?: ChoiceLike[] };
  /** Sustained set-piece routing: this outcome advances to a sibling beat in the phase. */
  nextBeatId?: string;
}

interface BeatLike {
  id?: string;
  phase?: string;
  name?: string;
  description?: string;
  setupText?: string;
  choices?: ChoiceLike[];
}

interface PhaseLike {
  beats?: BeatLike[];
  startingBeatId?: string;
}

const WIN_OUTCOMES = new Set(['victory', 'partialVictory']);

/**
 * Base depth of each beat within a phase, following `nextBeatId` routing.
 *
 * A "sustained set-piece" lays its beats out FLAT inside one phase and chains them
 * beat-1 → beat-2 → … via `nextBeatId`, so a terminal victory in the LAST beat is
 * reached only after the earlier beats — it is NOT a one-click win. The depth walk
 * otherwise starts every top-level beat at depth 1, which mis-flagged those deep
 * resolution beats (G13: endsong ep3 beat-4 wins read as root one-click wins). Only
 * the phase's entry beat (and any beat no `nextBeatId` targets) is a true root at
 * depth 1; chained beats inherit depth = predecessor + 1 (min over predecessors).
 */
function beatBaseDepths(phase: PhaseLike, enc: { startingBeatId?: string }): Map<string, number> {
  const beats = phase.beats || [];
  const byId = new Map<string, BeatLike>();
  for (const b of beats) if (b.id) byId.set(b.id, b);
  const edges: Array<[string, string]> = [];
  for (const b of beats) {
    if (!b.id) continue;
    for (const choice of b.choices || []) {
      for (const outcome of Object.values(choice.outcomes || {})) {
        const nb = outcome?.nextBeatId;
        if (nb && byId.has(nb) && nb !== b.id) edges.push([b.id, nb]);
      }
    }
  }
  const targeted = new Set(edges.map((e) => e[1]));
  const startId = phase.startingBeatId || enc.startingBeatId;
  const depth = new Map<string, number>();
  const queue: string[] = [];
  for (const b of beats) {
    if (!b.id) continue;
    // Roots: the explicit entry beat, or any beat nothing routes into.
    if (b.id === startId || !targeted.has(b.id)) {
      depth.set(b.id, 1);
      queue.push(b.id);
    }
  }
  while (queue.length) {
    const id = queue.shift() as string;
    const d = depth.get(id) as number;
    for (const [from, to] of edges) {
      if (from !== id) continue;
      const nd = d + 1;
      if (!depth.has(to) || nd < (depth.get(to) as number)) {
        depth.set(to, nd);
        queue.push(to);
      }
    }
  }
  // Cyclic / unreachable beats fall back to root depth (conservative).
  for (const b of beats) if (b.id && !depth.has(b.id)) depth.set(b.id, 1);
  return depth;
}

export function analyzeEncounterDepth(enc: Encounter): EncounterDepthAnalysis {
  const analysis: EncounterDepthAnalysis = {
    maxGoalTicks: 0,
    maxThreatTicks: 0,
    goalSegments: enc.goalClock?.segments ?? 0,
    oneClickWins: [],
    maxDepth: 0,
  };

  // Returns best attainable {goal, threat} from this choice list downward.
  const walkChoices = (choices: ChoiceLike[] | undefined, depth: number): { goal: number; threat: number } => {
    let bestGoal = 0;
    let bestThreat = 0;
    for (const choice of choices || []) {
      analysis.maxDepth = Math.max(analysis.maxDepth, depth);
      for (const [, outcome] of Object.entries(choice.outcomes || {})) {
        if (!outcome) continue;
        const g = Math.max(0, outcome.goalTicks ?? 0);
        const t = Math.max(0, outcome.threatTicks ?? 0);
        const isWin = outcome.isTerminal && WIN_OUTCOMES.has(String(outcome.encounterOutcome ?? ''));
        if (depth === 1 && isWin) {
          analysis.oneClickWins.push({
            choiceId: choice.id ?? '(unnamed)',
            outcome: String(outcome.encounterOutcome),
            hasConsequences: Array.isArray(outcome.consequences) && outcome.consequences.length > 0,
          });
        }
        const nested = outcome.nextSituation?.choices?.length
          ? walkChoices(outcome.nextSituation.choices, depth + 1)
          : { goal: 0, threat: 0 };
        bestGoal = Math.max(bestGoal, g + nested.goal);
        bestThreat = Math.max(bestThreat, t + nested.threat);
      }
    }
    return { goal: bestGoal, threat: bestThreat };
  };

  for (const phase of enc.phases || []) {
    const baseDepth = beatBaseDepths(phase as PhaseLike, enc as { startingBeatId?: string });
    for (const beat of phase.beats || []) {
      // A beat reached only by routing from earlier beats is not a depth-1 root;
      // start its walk at the beat's computed base depth so a terminal win in a
      // late sustained-set-piece beat isn't mis-flagged as a one-click win.
      const startDepth = baseDepth.get((beat as BeatLike).id ?? '') ?? 1;
      const { goal, threat } = walkChoices((beat as { choices?: ChoiceLike[] }).choices, startDepth);
      analysis.maxGoalTicks = Math.max(analysis.maxGoalTicks, goal);
      analysis.maxThreatTicks = Math.max(analysis.maxThreatTicks, threat);
    }
  }
  return analysis;
}

export interface ClockShrinkResult {
  goalShrunk: boolean;
  goalFrom?: number;
  goalTo?: number;
}

/**
 * Honest-clock autofix: if no authored path can fill the goal clock, shrink the
 * clock to the best attainable ticks (floor 2) so perfect play visibly completes
 * the objective. Mutates in place; no-op when already attainable.
 */
export function shrinkClockToAttainable(enc: Encounter, analysis?: EncounterDepthAnalysis): ClockShrinkResult {
  const a = analysis ?? analyzeEncounterDepth(enc);
  const result: ClockShrinkResult = { goalShrunk: false };
  const goal = enc.goalClock;
  if (goal && a.maxGoalTicks > 0 && goal.segments > a.maxGoalTicks) {
    result.goalFrom = goal.segments;
    result.goalTo = Math.max(2, a.maxGoalTicks);
    goal.segments = result.goalTo;
    result.goalShrunk = true;
  }
  return result;
}

export interface DeepenResult {
  /** Root wins demoted into a two-layer finish (the depth contract now holds). */
  lifted: Array<{ beatId: string; choiceId: string; outcome: string }>;
  /** Flat root wins routed through an appended top-level finish beat. */
  flatRouted: Array<{ beatId: string; choiceId: string; outcome: string; finishBeatId: string }>;
  /** Root wins left alone because no playable repair shape was available. */
  skipped: Array<{ beatId: string; choiceId: string; outcome: string }>;
}

/**
 * Reader-safe closing prose for the injected finish step. Static by design — this
 * is the deterministic safety-net register (same philosophy as the auto-callback
 * realizer): fiction-first, no mechanics talk, and deliberately absent from
 * TEMPLATE_SIGNATURES so the boilerplate scan never flags it.
 */
const SEAL_PROSE = {
  victory: {
    setupText: 'The opening is real — and it is closing. One clean motion ends this.',
    choiceText: 'Drive it home',
    success: 'It ends the way you called it. No wasted motion, nothing left to chance.',
    complicated: 'It lands, but not clean — the win is yours with a cost trailing behind it.',
    failure: 'The finish slips sideways. You keep what you earned, but not the clean ending.',
  },
  partialVictory: {
    setupText: 'What you have taken is yours — barely. It needs holding before it slips.',
    choiceText: 'Hold what you have won',
    success: 'It holds. Not pretty, but it holds.',
    complicated: 'Your grip costs you, but it does not break.',
    failure: 'It costs more than it should. What you took stays taken.',
  },
} as const;

const SEAL_APPROACHES = [
  { approach: 'aggressive', label: 'Force the finish', skill: 'resolve' },
  { approach: 'cautious', label: 'Hold the line', skill: 'composure' },
  { approach: 'clever', label: 'Turn the opening', skill: 'perception' },
] as const;

function flagSlug(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function uniqueBeatId(phase: PhaseLike, base: string): string {
  const existing = new Set((phase.beats || []).map((beat) => beat.id).filter(Boolean));
  if (!existing.has(base)) return base;
  let i = 2;
  while (existing.has(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

function buildSealChoice(
  encSlug: string,
  choice: ChoiceLike,
  outcome: OutcomeLike,
  won: string,
  choiceId: string,
  approach: typeof SEAL_APPROACHES[number],
): ChoiceLike {
  const prose = SEAL_PROSE[won as keyof typeof SEAL_PROSE];
  const downgraded = 'partialVictory';
  const sealConsequences = (tag: string): unknown[] =>
    Array.isArray(outcome.consequences) && outcome.consequences.length > 0
      ? [...outcome.consequences]
      : [{ type: 'setFlag', flag: `${encSlug}_${flagSlug(choiceId)}_${flagSlug(approach.approach)}_${tag}`, value: true }];

  return {
    id: `${choiceId}-${approach.approach}-seal`,
    text: approach.label || prose.choiceText,
    approach: approach.approach,
    primarySkill: choice.primarySkill || approach.skill,
    outcomes: {
      success: {
        tier: 'success', narrativeText: prose.success, goalTicks: 1, threatTicks: 0,
        isTerminal: true, encounterOutcome: won, consequences: sealConsequences('won'),
      },
      complicated: {
        tier: 'complicated', narrativeText: prose.complicated, goalTicks: 1, threatTicks: 0,
        isTerminal: true, encounterOutcome: downgraded, consequences: sealConsequences('held'),
      },
      failure: {
        tier: 'failure', narrativeText: prose.failure, goalTicks: 0, threatTicks: 1,
        isTerminal: true, encounterOutcome: downgraded, consequences: sealConsequences('held'),
      },
    },
  };
}

function buildSealChoices(
  encSlug: string,
  choice: ChoiceLike,
  outcome: OutcomeLike,
  won: string,
  choiceId: string,
): ChoiceLike[] {
  return SEAL_APPROACHES.map((approach) => buildSealChoice(encSlug, choice, outcome, won, choiceId, approach));
}

/**
 * One-click-win autofix (G13): demote a root-level terminal victory/partialVictory
 * into a two-step finish so the set-piece keeps a middle.
 *
 * The EncounterArchitect prompt forbids root terminal wins, but the model keeps
 * emitting a 4th root choice whose success/complicated outcomes end the encounter
 * at depth 1 with zero consequences — every G13 run hard-failed the depth gate on
 * it. This is the repair rung of that gate (the sibling of shrinkClockToAttainable
 * for the clock half): the authored win prose plays as an intermediate result, then
 * a short follow-up situation holds the actual terminal outcome, which always
 * carries consequences. The follow-up covers all three result tiers (the reader
 * resolves tiers by weighted roll; a missing tier dead-ends playback), and a roll
 * gone wrong at the finish never revokes the earned win — it downgrades a clean
 * victory to partialVictory at worst.
 *
 * Only tree-routed encounters (outcomes embed `nextSituation`) are repaired; in the
 * reader's flat nextBeatId mode an embedded situation is never walked, so flat
 * encounters are skipped rather than risk an unplayable beat. Idempotent: after the
 * lift the win sits at depth 2, so a re-run finds nothing to demote.
 */
export function deepenRootTerminalWins(enc: Encounter): DeepenResult {
  const result: DeepenResult = { lifted: [], flatRouted: [], skipped: [] };
  const encAny = enc as unknown as { id?: string; sceneId?: string; phases?: PhaseLike[]; startingBeatId?: string };
  const encSlug = flagSlug(String(encAny.id ?? encAny.sceneId ?? 'encounter'));

  // Mirrors the reader's isTreeBasedEncounter(): first phase → first beat → first
  // choice → any outcome embeds nextSituation.
  const firstChoice = encAny.phases?.[0]?.beats?.[0]?.choices?.[0];
  const treeRouted = !!(
    firstChoice?.outcomes &&
    Object.values(firstChoice.outcomes).some((o) => o?.nextSituation)
  );

  for (const phase of encAny.phases || []) {
    const baseDepth = beatBaseDepths(phase, encAny);
    const originalBeats = [...(phase.beats || [])];
    for (const beat of originalBeats) {
      if ((baseDepth.get(beat.id ?? '') ?? 1) !== 1) continue;
      for (const choice of beat.choices || []) {
        for (const outcome of Object.values(choice.outcomes || {})) {
          if (!outcome?.isTerminal) continue;
          const won = String(outcome.encounterOutcome ?? '');
          if (!WIN_OUTCOMES.has(won)) continue;

          const record = { beatId: beat.id ?? '(unnamed)', choiceId: choice.id ?? '(unnamed)', outcome: won };
          if (!treeRouted) {
            if (!phase.beats) {
              result.skipped.push(record);
              continue;
            }
            const prose = SEAL_PROSE[won as keyof typeof SEAL_PROSE];
            const choiceId = choice.id ?? 'choice';
            const finishBeatId = uniqueBeatId(phase, `${beat.id ?? 'beat'}-${choiceId}-${flagSlug(won)}-finish`);
            phase.beats.push({
              id: finishBeatId,
              phase: 'resolution',
              name: won === 'victory' ? 'Finish the opening' : 'Hold the opening',
              description: prose.setupText,
              setupText: prose.setupText,
              choices: buildSealChoices(encSlug, choice, outcome, won, choiceId),
            });
            outcome.isTerminal = false;
            delete outcome.encounterOutcome;
            outcome.nextBeatId = finishBeatId;
            result.flatRouted.push({ ...record, finishBeatId });
            continue;
          }

          const prose = SEAL_PROSE[won as keyof typeof SEAL_PROSE];
          const choiceId = choice.id ?? 'choice';

          outcome.isTerminal = false;
          delete outcome.encounterOutcome;
          outcome.nextSituation = {
            setupText: prose.setupText,
            choices: buildSealChoices(encSlug, choice, outcome, won, choiceId),
          };
          result.lifted.push(record);
        }
      }
    }
  }
  return result;
}

/**
 * Source-side variant of {@link deepenRootTerminalWins} for the EncounterArchitect
 * DRAFT shape, whose beats live at the top level (`structure.beats`) rather than
 * nested under `phases`. The draft is the last point before the agent→runtime
 * conversion, so repairing the one-click win HERE — the moment the LLM output is
 * parsed and normalized — keeps the defect from ever being persisted, leaving the
 * final-contract pass in EncounterQualityValidator a redundant net instead of the
 * sole line of defense.
 *
 * Implementation: wrap the flat draft as a single phase and delegate. The wrapper's
 * `beats` array IS `structure.beats`, and every beat/choice/outcome is shared by
 * reference, so the in-place demotion the delegate performs propagates straight back
 * into the draft. Inherits the delegate's guarantees: idempotent (a re-run finds the
 * win already at depth 2), and shape-preserving — a flat sustained-set-piece draft is
 * detected as non-tree-routed and SKIPPED, exactly as in the final-contract pass, so
 * it still blocks downstream rather than getting an unplayable embedded situation.
 */
export function deepenStructureRootWins(structure: {
  id?: string;
  sceneId?: string;
  beats?: unknown[];
  startingBeatId?: string;
}): DeepenResult {
  const wrapper = {
    id: structure.id,
    sceneId: structure.sceneId,
    startingBeatId: structure.startingBeatId,
    phases: [{ beats: structure.beats, startingBeatId: structure.startingBeatId }],
  };
  return deepenRootTerminalWins(wrapper as unknown as Encounter);
}
