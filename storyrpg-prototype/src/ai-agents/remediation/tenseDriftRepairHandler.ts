import type { Story } from '../../types/story';
import type { ContractRepairHandler } from './finalContractRepair';
import { hasPastEventMarker, pastTenseLiveActionMatches } from '../utils/proseTense';

type MutableRecord = Record<string, unknown>;

export function isTenseDriftIssue(issue: Parameters<ContractRepairHandler>[0]['blockingIssues'][number]): boolean {
  return issue.validator === 'NarrativeFailureModeValidator'
    && issue.type === 'prose_style_violation'
    && /\btense drift\b/i.test(issue.message ?? '')
    && Boolean(issue.sceneId);
}

/**
 * Past → { base, third } present conversions for every verb the tense-drift
 * detector (PAST_TENSE_LIVE_ACTION in utils/proseTense.ts) matches — plus the
 * common live-action verbs drifted scenes use that the detector misses — so a
 * repaired beat actually clears re-validation instead of shaving one
 * construction off a still-blocking count. Person-aware: "you saw" → "you
 * see", "she saw" → "she sees".
 */
const PAST_TO_PRESENT: Record<string, { base: string; third: string }> = {
  was: { base: 'are', third: 'is' },
  were: { base: 'are', third: 'are' },
  had: { base: 'have', third: 'has' },
  did: { base: 'do', third: 'does' },
  "didn't": { base: "don't", third: "doesn't" },
  felt: { base: 'feel', third: 'feels' },
  took: { base: 'take', third: 'takes' },
  saw: { base: 'see', third: 'sees' },
  heard: { base: 'hear', third: 'hears' },
  watched: { base: 'watch', third: 'watches' },
  looked: { base: 'look', third: 'looks' },
  stepped: { base: 'step', third: 'steps' },
  turned: { base: 'turn', third: 'turns' },
  reached: { base: 'reach', third: 'reaches' },
  held: { base: 'hold', third: 'holds' },
  laughed: { base: 'laugh', third: 'laughs' },
  asked: { base: 'ask', third: 'asks' },
  said: { base: 'say', third: 'says' },
  met: { base: 'meet', third: 'meets' },
  found: { base: 'find', third: 'finds' },
  made: { base: 'make', third: 'makes' },
  walked: { base: 'walk', third: 'walks' },
  ran: { base: 'run', third: 'runs' },
  wrote: { base: 'write', third: 'writes' },
  gave: { base: 'give', third: 'gives' },
  opened: { base: 'open', third: 'opens' },
  closed: { base: 'close', third: 'closes' },
  kept: { base: 'keep', third: 'keeps' },
  thought: { base: 'think', third: 'thinks' },
  knew: { base: 'know', third: 'knows' },
  wanted: { base: 'want', third: 'wants' },
  needed: { base: 'need', third: 'needs' },
  clicked: { base: 'click', third: 'clicks' },
  shattered: { base: 'shatter', third: 'shatters' },
  followed: { base: 'follow', third: 'follows' },
  stopped: { base: 'stop', third: 'stops' },
  bled: { base: 'bleed', third: 'bleeds' },
  came: { base: 'come', third: 'comes' },
  pulled: { base: 'pull', third: 'pulls' },
  pushed: { base: 'push', third: 'pushes' },
  put: { base: 'put', third: 'puts' },
  stood: { base: 'stand', third: 'stands' },
  sat: { base: 'sit', third: 'sits' },
  finished: { base: 'finish', third: 'finishes' },
  sent: { base: 'send', third: 'sends' },
};

const PAST_VERB_ALTERNATION = Object.keys(PAST_TO_PRESENT).join('|');

// Subject anchor mirrors the detector, plus 'there' and an optional single
// intervening noun after a determiner ("The handshake was firm").
const SUBJECT_PAST_VERB = new RegExp(
  `\\b(you|he|she|it|they|there|(?:[Tt]he|[Aa]n?|[Yy]our|[Hh]er|[Hh]is|[Tt]heir)\\s+[a-z]+|[A-Z][a-z]+)\\s+(${PAST_VERB_ALTERNATION})\\b`,
  'g',
);

const BASE_FORM_SUBJECTS = new Set(['you', 'they', 'we', 'i']);

/**
 * Dialogue is exempt from narration-tense rules ("I was in Paris" inside
 * quotes is fine); apply a transform only to the unquoted spans.
 */
function transformOutsideQuotes(text: string, transform: (span: string) => string): string {
  const parts = text.split(/("[^"]*"|\u201c[^\u201d]*\u201d)/);
  return parts.map((part, index) => (index % 2 === 1 ? part : transform(part))).join('');
}

export function repairLiveActionTense(value: unknown): { value: unknown; changed: boolean } {
  if (typeof value !== 'string' || !value.trim()) return { value, changed: false };
  const next = transformOutsideQuotes(value, (span) =>
    span.replace(SUBJECT_PAST_VERB, (match, subject: string, verb: string) => {
      const forms = PAST_TO_PRESENT[verb.toLowerCase()];
      if (!forms) return match;
      const person = BASE_FORM_SUBJECTS.has(subject.toLowerCase()) ? forms.base : forms.third;
      return `${subject} ${person}`;
    }),
  );
  return { value: next, changed: next !== value };
}

function findScene(story: Story, sceneId: string): MutableRecord | undefined {
  for (const episode of story.episodes ?? []) {
    for (const scene of episode.scenes ?? []) {
      if (scene.id === sceneId) return scene as unknown as MutableRecord;
    }
  }
  return undefined;
}

/**
 * Beats in the flagged scene that read as past-tense live action. The
 * validator names ONE beat, but tense drift is usually scene-wide (the writer
 * chose the wrong narration convention for the whole scene) — repairing only
 * the named beat leaves the scene blocking and mixes tenses mid-scene
 * (bite-me 2026-07-05T20-47-31: all of s1-2 was past tense).
 */
function driftedBeatsInScene(scene: MutableRecord): MutableRecord[] {
  const beats = Array.isArray(scene.beats) ? (scene.beats as MutableRecord[]) : [];
  return beats.filter((beat) => {
    const text = typeof beat.text === 'string' ? beat.text : '';
    if (!text || hasPastEventMarker(text)) return false;
    return pastTenseLiveActionMatches(text) >= 1;
  });
}

export function buildTenseDriftRepairHandler(): ContractRepairHandler {
  return ({ story, blockingIssues }) => {
    const issues = blockingIssues.filter(isTenseDriftIssue);
    if (issues.length === 0) return { story, changed: false };

    let rewritten = 0;
    const repairedScenes = new Set<string>();
    for (const issue of issues) {
      if (repairedScenes.has(issue.sceneId!)) continue;
      repairedScenes.add(issue.sceneId!);
      const scene = findScene(story as Story, issue.sceneId!);
      if (!scene) continue;
      for (const beat of driftedBeatsInScene(scene)) {
        const result = repairLiveActionTense(beat.text);
        if (!result.changed) continue;
        beat.text = result.value;
        rewritten += 1;
        const variants = Array.isArray(beat.textVariants) ? (beat.textVariants as MutableRecord[]) : [];
        for (const variant of variants) {
          const variantResult = repairLiveActionTense(variant.text);
          if (variantResult.changed) variant.text = variantResult.value;
        }
      }
    }

    if (rewritten === 0) return { story, changed: false };
    return {
      story,
      changed: true,
      record: {
        rule: 'final_contract_tense_drift',
        scope: 'scene',
        attempted: issues.length,
        succeeded: true,
        degraded: false,
        blocked: false,
        attempts: 1,
        details: `Rewrote ${rewritten} tense-drift beat(s) across ${repairedScenes.size} scene(s) into present-tense live action`,
      },
    };
  };
}
