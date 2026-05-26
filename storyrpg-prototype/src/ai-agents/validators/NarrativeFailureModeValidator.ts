import type { SceneContent } from '../agents/SceneWriter';
import { BaseValidator, ValidationIssue, ValidationResult } from './BaseValidator';

export type NarrativeFailureModeCode =
  | 'escalation_trap'
  | 'mystery_box_collapse'
  | 'character_drift'
  | 'shaggy_dog'
  | 'passive_protagonist'
  | 'reset_disease'
  | 'theme_drift'
  | 'unmotivated_escalation'
  | 'snowglobe_arc'
  | 'inverted_thematic_rhyme'
  | 'convenient_coincidence'
  | 'telegraphed_twist'
  | 'cheating_twist';

export interface NarrativeFailureModeIssue extends ValidationIssue {
  code: NarrativeFailureModeCode;
  source?: string;
}

export interface NarrativeFailureModeInput {
  sceneContents?: SceneContent[];
  baseIssues?: Array<Pick<ValidationIssue, 'severity' | 'message' | 'location' | 'suggestion'> & { source?: string }>;
}

export interface NarrativeFailureModeMetrics {
  mappedIssueCount: number;
  convenientCoincidenceSignals: number;
  telegraphedTwistSignals: number;
}

export interface NarrativeFailureModeResult extends ValidationResult {
  issues: NarrativeFailureModeIssue[];
  metrics: NarrativeFailureModeMetrics;
}

interface FailureModeMapping {
  code: NarrativeFailureModeCode;
  matches: RegExp[];
  suggestion: string;
}

const FAILURE_MODE_MAPPINGS: FailureModeMapping[] = [
  {
    code: 'escalation_trap',
    matches: [/\bescalat(?:e|ion|ed|ing)\b/i, /\bstakes? ladder\b/i, /\bstakes? (?:jump|leap|raise)/i],
    suggestion: 'Slow the rise in threat until the scene has earned audience investment, personal cost, and causal pressure.',
  },
  {
    code: 'mystery_box_collapse',
    matches: [/\bmystery\b/i, /\bbox-question\b/i, /\bbox question\b/i, /\bopens? \d+ question/i, /\bunanswered question/i],
    suggestion: 'Plan the answer before introducing the question, and convert excess mysteries into suspense or dramatic irony.',
  },
  {
    code: 'character_drift',
    matches: [/\bcharacter drift\b/i, /\bestablished psychology\b/i, /\bidentity delta\b/i, /\bcharacter arc\b/i, /\bLie\b.*\bTruth\b/i],
    suggestion: 'Tie the action back to the character Lie, wound, want, need, relationship pressure, or earned change.',
  },
  {
    code: 'shaggy_dog',
    matches: [/\bsetup\b.*\bpayoff\b/i, /\bpayoff\b.*\bsetup\b/i, /\bunpaid\b/i, /\bshaggy dog\b/i, /\bcallback\b.*\bunresolved\b/i],
    suggestion: 'Pay off major setup in proportion to its emphasis, or demote/remove the setup.',
  },
  {
    code: 'passive_protagonist',
    matches: [/\bpassive protagonist\b/i, /\bprotagonist\b.*\bpassive\b/i, /\bplayer\b.*\bcaus(?:e|al|ed)\b/i, /\b60%\b.*\bcaus/i],
    suggestion: 'Rewrite the turn so the protagonist causes the decisive change through choice, preparation, sacrifice, or leverage.',
  },
  {
    code: 'reset_disease',
    matches: [/\breset\b/i, /\bstatus quo\b/i, /\bexit shift\b/i, /\bchoice residue\b/i, /\bno residue\b/i],
    suggestion: 'Leave a permanent strategic, emotional, relational, identity, or information change behind.',
  },
  {
    code: 'theme_drift',
    matches: [/\btheme\b/i, /\bcentral question\b/i, /\btheme question\b/i, /\bpress(?:es|ing)? on\b/i],
    suggestion: 'Make the scene answer, complicate, refuse, or reframe the theme question through protagonist-visible choice.',
  },
  {
    code: 'unmotivated_escalation',
    matches: [/\bunmotivated escalation\b/i, /\bescalation\b.*\bchoice\b/i, /\bstakes\b.*\bearned\b/i],
    suggestion: 'Anchor escalation in a prior choice, consequence, antagonist pressure, discovery, cost, or relationship change.',
  },
  {
    code: 'snowglobe_arc',
    matches: [/\bsnowglobe\b/i, /\barc\b.*\brestore/i, /\bpermanent change\b/i, /\breturns? to.*beginning\b/i],
    suggestion: 'Resolve the local question while leaving the protagonist or situation materially changed.',
  },
  {
    code: 'inverted_thematic_rhyme',
    matches: [/\bB-?plot\b/i, /\bsecondary (?:plot|pressure)\b/i, /\bthematic(?:ally)? rhyme\b/i, /\bA-?plot\b.*\bB-?plot\b/i],
    suggestion: 'When a secondary pressure lane exists, make it echo the same question in a different domain.',
  },
  {
    code: 'convenient_coincidence',
    matches: [/\bcoincidence\b/i, /\bdeus ex\b/i, /\bexternal rescue\b/i, /\brescued by\b/i, /\boutside force\b/i],
    suggestion: 'Move the solution into protagonist/player action instead of rescue, luck, prophecy, or villain-only action.',
  },
  {
    code: 'telegraphed_twist',
    matches: [/\btelegraph(?:ed|ing)?\b/i, /\bover-foreshadow/i, /\bpredictable twist\b/i, /\btoo obvious\b/i],
    suggestion: 'Reduce repeated clue language and add a plausible alternate interpretation for the same setup.',
  },
  {
    code: 'cheating_twist',
    matches: [/\bcheating twist\b/i, /\bno setup\b/i, /\bunplanted\b/i, /\bforeshadow\b.*\bmissing\b/i],
    suggestion: 'Plant the reveal earlier with at least one fair setup beat that reads differently after the reveal.',
  },
];

const EXTERNAL_RESCUE = /\b(?:guards?|police|soldiers?|authorit(?:y|ies)|mentor|ally|stranger|backup|reinforcements|the cavalry)\s+(?:arrive|arrives|appears?|intervenes?|saves?|solve|solves|rescue|rescues)\b|\b(?:arrive|arrives|appears?)\s+(?:just in time|out of nowhere)\b|\b(?:deus ex|coincidence|coincidentally|by chance|luckily|fortune|randomly|prophecy|fate|destiny|external rescue|someone else solves|villain slips)\b/i;
const PROTAGONIST_AGENCY = /\b(?:player|protagonist|hero|lead|they|she|he|we|you)\s+(?:choose|chooses|decide|decides|refuse|refuses|sacrifice|sacrifices|use|uses|reveal|reveals|leverage|leverages|risk|risks|commit|commits|confront|confronts|act|acts|prepared|earned|pay|pays|trade|trades|give|gives|break|breaks|accept|accepts)\b|\b(?:chooses?|decides?|refuses?|sacrifices?|uses?|reveals?|leverages?|risks?|commits?|confronts?|acts?|prepared|earned|trades?)\b|\bbecause (?:of|they|she|he|you|we)\b|\bthrough (?:choice|preparation|sacrifice|leverage|action)\b/i;

const TWIST_PHRASES: Array<{ label: string; pattern: RegExp }> = [
  { label: 'something is off', pattern: /\bsomething (?:is|was|feels|felt|seems|seemed) off\b/gi },
  { label: 'not what it seems', pattern: /\bnot (?:what|who) (?:it|they|he|she|this|that) seems?\b/gi },
  { label: 'hidden truth', pattern: /\bhidden truth\b/gi },
  { label: 'secret betrayal', pattern: /\bsecret betrayal\b/gi },
  { label: 'real villain', pattern: /\breal villain\b/gi },
  { label: 'traitor among us', pattern: /\btraitor (?:among|in|inside)\b/gi },
];

export class NarrativeFailureModeValidator extends BaseValidator {
  constructor() {
    super('NarrativeFailureModeValidator');
  }

  validate(input: NarrativeFailureModeInput): NarrativeFailureModeResult {
    const issues: NarrativeFailureModeIssue[] = [];
    const mapped = this.mapBaseIssues(input.baseIssues ?? []);
    issues.push(...mapped);

    const coincidenceSignals = this.detectConvenientCoincidence(input.sceneContents ?? []);
    issues.push(...coincidenceSignals);

    const telegraphSignals = this.detectTelegraphedTwist(input.sceneContents ?? []);
    issues.push(...telegraphSignals);

    const errorCount = issues.filter((issue) => issue.severity === 'error').length;
    const warningCount = issues.filter((issue) => issue.severity === 'warning').length;

    return {
      valid: errorCount === 0,
      score: Math.max(0, 100 - errorCount * 15 - warningCount * 5),
      issues,
      suggestions: Array.from(new Set(issues.map((issue) => issue.suggestion).filter((s): s is string => Boolean(s)))),
      metrics: {
        mappedIssueCount: mapped.length,
        convenientCoincidenceSignals: coincidenceSignals.length,
        telegraphedTwistSignals: telegraphSignals.length,
      },
    };
  }

  private mapBaseIssues(
    baseIssues: Array<Pick<ValidationIssue, 'severity' | 'message' | 'location' | 'suggestion'> & { source?: string }>,
  ): NarrativeFailureModeIssue[] {
    const mapped: NarrativeFailureModeIssue[] = [];
    const seen = new Set<string>();

    for (const issue of baseIssues) {
      const message = issue.message ?? '';
      const mapping = FAILURE_MODE_MAPPINGS.find((candidate) => (
        candidate.matches.some((pattern) => pattern.test(message))
      ));
      if (!mapping) continue;

      const key = `${mapping.code}:${issue.location ?? ''}:${message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      mapped.push({
        code: mapping.code,
        severity: issue.severity,
        message: `[${this.formatCode(mapping.code)}] ${message}`,
        location: issue.location,
        suggestion: issue.suggestion || mapping.suggestion,
        source: issue.source,
      });
    }

    return mapped;
  }

  private detectConvenientCoincidence(sceneContents: SceneContent[]): NarrativeFailureModeIssue[] {
    const endingScenes = sceneContents.slice(-2);
    const issues: NarrativeFailureModeIssue[] = [];

    for (const scene of endingScenes) {
      const text = collectSceneText(scene);
      if (!text || !EXTERNAL_RESCUE.test(text) || PROTAGONIST_AGENCY.test(text)) continue;
      issues.push({
        code: 'convenient_coincidence',
        severity: 'error',
        message: '[Convenient coincidence] The ending appears to resolve through outside rescue, luck, fate, or external arrival rather than protagonist/player action.',
        location: scene.sceneId,
        suggestion: 'Rewrite the resolution so the protagonist/player causes the decisive turn through a choice, cost, preparation, relationship leverage, or earned information.',
        source: 'scene_ending_heuristic',
      });
    }

    return issues;
  }

  private detectTelegraphedTwist(sceneContents: SceneContent[]): NarrativeFailureModeIssue[] {
    const text = sceneContents.map(collectSceneText).join('\n');
    if (!text.trim()) return [];

    for (const phrase of TWIST_PHRASES) {
      const matches = text.match(phrase.pattern) ?? [];
      if (matches.length >= 3) {
        return [{
          code: 'telegraphed_twist',
          severity: 'warning',
          message: `[Telegraphed twist] The clue phrase "${phrase.label}" appears ${matches.length} times, making the twist setup too legible.`,
          suggestion: 'Vary the setup language, reduce repeated suspicious phrasing, and make at least one clue serve a plausible non-twist interpretation.',
          source: 'twist_phrase_density',
        }];
      }
    }

    return [];
  }

  private formatCode(code: NarrativeFailureModeCode): string {
    return code.split('_').map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');
  }
}

function collectSceneText(scene: SceneContent): string {
  const candidate = scene as unknown as {
    sceneId?: string;
    sceneName?: string;
    summary?: string;
    description?: string;
    text?: string;
    beats?: Array<Record<string, unknown>>;
  };
  const parts: string[] = [
    candidate.sceneName,
    candidate.summary,
    candidate.description,
    candidate.text,
  ].filter((value): value is string => typeof value === 'string');

  for (const beat of candidate.beats ?? []) {
    parts.push(...[
      beat.text,
      beat.narration,
      beat.description,
      beat.dialogue,
      beat.content,
      beat.choicePrompt,
    ].filter((value): value is string => typeof value === 'string'));
  }

  return parts.join('\n');
}
