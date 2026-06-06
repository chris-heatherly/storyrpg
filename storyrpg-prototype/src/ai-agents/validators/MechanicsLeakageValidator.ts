/**
 * MechanicsLeakageValidator
 *
 * Flags player-facing prose that exposes raw mechanics. This is a heuristic
 * backstop for the fiction-first contract; it intentionally ignores authored
 * code/config strings and should be run only on rendered story text.
 */

import { BaseValidator, type ValidationIssue, type ValidationResult } from './BaseValidator';

export interface MechanicsLeakageText {
  id: string;
  text: string;
  sceneId?: string;
  beatId?: string;
}

export interface MechanicsLeakageInput {
  texts: MechanicsLeakageText[];
  /**
   * Opt-in strict escalation. Default (false / undefined) is byte-for-byte
   * identical to the historical behavior: every leak is a 'warning'. When
   * `true`, the SINGLE safe, deterministically-remediable leak class — bare
   * numeric stat deltas sitting in an isolated HUD/label/bullet fragment with
   * no narrative-frame verb (e.g. "Trust +10", "+5 reputation") — is escalated
   * to 'error'. Every other leak class (die-roll phrasing, embedded checks,
   * thresholds, probability framing, and stat deltas woven into a sentence)
   * stays 'warning' even in strict mode, because those require SceneWriter
   * regen rather than a clean string redaction.
   *
   * This validator already feeds a blocking final-contract path, so strict
   * escalation must be explicitly requested by the caller — it is never on by
   * default.
   */
  strict?: boolean;
  /**
   * Opt-in design-note / meta-narration scan. Default (false / undefined) is
   * byte-for-byte identical to the historical behavior (only LEAK_PATTERNS run).
   * When `true`, also flag prose that leaks agent-facing PLANNING language —
   * "the player", episode references, "<relationship> level is set", direct
   * flag/score/stat-variable mentions, and cross-episode setup/payoff narration.
   * These are emitted as 'warning' here; the caller (FinalStoryContractValidator)
   * decides blocking via its own gating flag.
   */
  scanDesignNotes?: boolean;
}

export interface MechanicsLeakageResult extends ValidationResult {
  metrics: {
    textsChecked: number;
    leaksFound: number;
  };
}

const LEAK_PATTERNS: Array<{ pattern: RegExp; label: string; suggestion: string }> = [
  {
    // NOTE: bare "roll"/"rolled" are common physical action verbs ("roll to
    // safety", "rolled away") — false-positives that hard-block real stories.
    // Qualify to the RPG sense while still catching genuine die-result leaks:
    //   - roll + die expression / "dice" / "check" / "for <skill>"
    //   - "roll a 17" / "rolled a 4"  (roll + "a" + bare number = a die result;
    //     "roll a barrel" / "rolled 3 times" don't match — number is required)
    //   - "roll under/over/above/below 12"  (comparison against a target number)
    // "dice", "d20", etc. are unambiguous on their own.
    pattern: /\b(?:roll(?:ed)?\s+(?:a\s+)?(?:d\d+|dice|check|for\s+\w+)|roll(?:ed)?\s+a\s+\d+|roll(?:ed)?\s+(?:under|over|above|below)\s+\d+|dice|d20|d12|d10|d8|d6|d4)\b/i,
    label: 'dice language',
    suggestion: 'Describe uncertainty and outcome through action, tension, and consequence instead of dice.',
  },
  {
    // NOTE: bare "DC" hits abbreviations, initials, proper nouns ("DC circuit",
    // "D.C. Raines"). Qualify to RPG sense: "DC 15", "DC 20", etc.
    pattern: /\b(?:DC\s+\d+|difficulty\s*class|check\s*(?:failed|succeeded|success|failure)|saving throw)\b/i,
    label: 'check/threshold language',
    suggestion: 'Replace checks and thresholds with fictional affordances, pressure, or limits.',
  },
  {
    // NOTE: the optimization terms must stay RPG-specific. Bare "build",
    // "bonus", and "modifier" are ordinary English ("mortals build and fall",
    // "a welcome bonus") and false-positive on fiction-first prose, hard-failing
    // the whole story at the final contract. Qualify them to their mechanical
    // sense; "+N bonus" is still caught by the numeric-stat-delta pattern below.
    pattern: /\b(?:skill\s*check|level requirement|character\s+build|(?:stat|skill|attribute)\s+(?:modifier|bonus)|success chance|failure chance)\b/i,
    label: 'player-facing optimization language',
    suggestion: 'Describe capability through what the character notices, risks, or can lean on in the fiction.',
  },
  {
    // NOTE: the original pattern made the leading stat word optional, catching
    // any bare "+N"/"-N" (temperatures, heights, years, grid offsets) as false
    // positives. Require a stat word on at least one side so "+200 feet" and
    // "-10 degrees" don't fire, but "trust +10" and "+5 XP" still do.
    // The right-side branch uses (?<!\S) instead of \b before +/- because \b
    // fails when + follows whitespace (start of a clause like "+5 XP gained").
    pattern: /(?:\b(?:XP|experience\s*points?|hp|health|trust|affection|respect|fear|reputation|score|points?|stat|skill)\s*[+\-]\s*\d+|(?<!\S)[+\-]\s*\d+\s*(?:XP|experience\s*points?|hp|health|trust|affection|respect|fear|reputation|score|points?|stat|skill)\b)/i,
    label: 'numeric stat delta',
    suggestion: 'Show the visible relationship, identity, or resource shift without numeric deltas.',
  },
  {
    // NOTE: "\d*" made the number optional, so "skill is remarkable" and
    // "score is impressive" fired. Require an actual number so only genuine
    // numeric thresholds are caught. Handle both "score above 12" and the
    // multi-word "score must be above 12" / "skill needs to be below 10".
    pattern: /\b(?:threshold|score|stat|skill|attribute)\s+(?:(?:must be|needs to be)\s+)?(?:>=|<=|above|below|is)\s+\d+\b|\b(?:threshold|score|stat|skill|attribute)\s+(?:must be|needs to be)\s+\d+\s+or\s+(?:above|below)\b/i,
    label: 'raw threshold',
    suggestion: 'Turn raw thresholds into fiction-first locked reasons or character perception.',
  },
  {
    // NOTE: bare "\d+%" catches any percentage in prose ("100% certain",
    // "50% madness"). Qualify to RPG-mechanic sense: percentage must be
    // adjacent to success/failure language. The explicit "odds/probability/
    // chance of success/fail" phrases are unambiguous and unchanged.
    pattern: /\b\d+%\s*(?:chance|probability|likelihood)\s+(?:of|to)\s+(?:success|succeed|fail|failure)|\b(?:odds|probability|chance)\s+(?:of|to)\s+(?:success|succeed|fail)\b/i,
    label: 'probability language',
    suggestion: 'Express likelihood as story risk, leverage, preparation, or desperation.',
  },
];

/**
 * Strict-mode escalation criterion — the SINGLE safe, deterministically
 * remediable leak class. These mirror the autofix layer
 * ({@link file:../remediation/repairs/mechanicsLeakageRepair.ts}) one-for-one so
 * "what strict mode hard-blocks" and "what the autofix can cleanly scrub" stay
 * the exact same set: a bare numeric stat delta sitting at a fragment boundary
 * with NO narrative-frame verb anywhere in the text. Anything narrative-framed
 * is left as a 'warning' for the SceneWriter regen path.
 */
const STAT_WORD =
  '(?:XP|experience\\s*points?|hp|health|trust|affection|respect|fear|reputation|score|points?|stat|skill)';

const ISOLATED_DELTA_PATTERN = new RegExp(
  '(?:^|[.,:;\\n\\u2022\\-]\\s*)' +
    '(?:' +
    `${STAT_WORD}\\s*[+\\-]\\s*\\d+` +
    '|' +
    `[+\\-]\\s*\\d+\\s*${STAT_WORD}` +
    ')' +
    '(?=\\s*(?:[.,:;\\n\\u2022]|$))',
  'i',
);

const NARRATIVE_FRAME =
  /\b(?:increase[ds]?|increasing|decrease[ds]?|decreasing|gain(?:ed|s|ing)?|earn(?:ed|s|ing)?|lost|lose[ds]?|losing|appear(?:ed|s|ing)?|spark(?:ed|s|ing)?|gr(?:ew|ows?|owing)|rose|rises?|rising|fell|falls?|falling|drop(?:ped|s|ping)?)\b/i;

/**
 * True when `text` contains a safe, isolated stat-delta fragment that strict
 * mode should escalate to 'error'. Narrative-framed text is never escalated.
 */
function hasSafeIsolatedDelta(text: string): boolean {
  if (NARRATIVE_FRAME.test(text)) return false;
  return ISOLATED_DELTA_PATTERN.test(text);
}

/**
 * Agent-facing PLANNING / meta-narration that must never reach reader prose.
 * Kept SEPARATE from LEAK_PATTERNS so the carefully-tuned mechanics patterns are
 * untouched and these only run when the caller opts in via `scanDesignNotes`.
 */
const DESIGN_NOTE_PATTERNS: Array<{ pattern: RegExp; label: string; suggestion: string }> = [
  {
    pattern: /\bthe\s+player\b/i,
    label: 'meta-narration (addresses "the player")',
    suggestion: 'Write to the protagonist in-fiction; never reference "the player".',
  },
  {
    pattern: /\bEpisode\s+\d+\b/i,
    label: 'planning reference to an episode number',
    suggestion: 'Remove cross-episode planning notes from reader prose.',
  },
  {
    pattern: /\b(?:loyalty|trust|affection|respect|fear|reputation|relationship)\s+level\s+is\s+set\b/i,
    label: 'design-note system-variable narration',
    suggestion: 'Show the relationship shift in fiction; do not narrate a variable being set.',
  },
  {
    pattern: /\b(?:this|the)\s+(?:flag|score|stat|variable)\s+is\s+(?:set|used|referenced)\b/i,
    label: 'direct system-variable mention',
    suggestion: 'Remove system-variable mentions from reader prose.',
  },
  {
    pattern: /\b(?:shaping|sets?\s+up|pays?\s+off|foreshadow(?:s|ing|es)?)\b[^.]*\bEpisode\s+\d+/i,
    label: 'cross-episode planning narration',
    suggestion: 'Keep setup/payoff planning out of reader prose.',
  },
];

export class MechanicsLeakageValidator extends BaseValidator {
  constructor() {
    super('MechanicsLeakageValidator');
  }

  validate(input: MechanicsLeakageInput): MechanicsLeakageResult {
    const issues: ValidationIssue[] = [];
    const strict = input.strict === true;
    const scanDesignNotes = input.scanDesignNotes === true;

    for (const item of input.texts) {
      const escalate = strict && hasSafeIsolatedDelta(item.text);
      const location = [item.sceneId, item.beatId, item.id].filter(Boolean).join(':') || item.id;
      for (const check of LEAK_PATTERNS) {
        if (!check.pattern.test(item.text)) continue;
        const message = `Player-facing text "${item.id}" exposes ${check.label}.`;
        // Default / non-strict: always 'warning' (byte-for-byte unchanged).
        // Strict: escalate ONLY the safe isolated-stat-delta class to 'error';
        // every other leak class in this text stays a 'warning'.
        issues.push(
          escalate && check.label === 'numeric stat delta'
            ? this.error(message, location, check.suggestion)
            : this.warning(message, location, check.suggestion),
        );
      }
      if (scanDesignNotes) {
        for (const check of DESIGN_NOTE_PATTERNS) {
          if (!check.pattern.test(item.text)) continue;
          const message = `Player-facing text "${item.id}" leaks ${check.label}.`;
          issues.push(this.warning(message, location, check.suggestion));
        }
      }
    }

    const leaksFound = issues.length;
    return {
      valid: leaksFound === 0,
      score: Math.max(0, 100 - leaksFound * 12),
      issues,
      suggestions: issues.map((issue) => issue.suggestion).filter((value): value is string => Boolean(value)),
      metrics: {
        textsChecked: input.texts.length,
        leaksFound,
      },
    };
  }
}
