import type { Story } from '../../types/story';
import type { ContractRepairHandler } from './finalContractRepair';

type MutableRecord = Record<string, unknown>;

const RELATIONSHIP_VALIDATOR = 'RelationshipPacingValidator';

const LABEL_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bthe\s+dusk club is now three\b/gi, 'they joke about calling it the Dusk Club'],
  [/\bdusk club is now three\b/gi, 'Dusk Club is still just a joke between three near-strangers'],
  [/\binner circle\b/gi, 'people moving around him'],
  [/\binside the circle\b/gi, 'near the edge of the circle'],
  [/\bone of us\b/gi, 'almost invited in'],
  [/\bpermanent member\b/gi, 'provisional guest'],
  [/\btrusted club\b/gi, 'guarded circle'],
  [/\bfriends now\b/gi, 'not strangers anymore'],
  [/\bbest friend\b/gi, 'sharp new ally'],
  [/\btrusted ally\b/gi, 'guarded ally'],
  [/\btrusted help\b/gi, 'guarded help'],
  [/\bearned friend\b/gi, 'fragile ally'],
  [/\bbond with history\b/gi, 'beginning with a little history'],
  [/\btrusts completely\b/gi, 'takes a small risk'],
  [/\bfriend group\b/gi, 'fragile new circle'],
  [/\bnew friends\b/gi, 'new companions'],
  [/\bfriends\b/gi, 'companions'],
  [/\bfriend\b/gi, 'ally'],
];

function hasRelationshipPacingBlocker(
  issues: Parameters<ContractRepairHandler>[0]['blockingIssues'],
): boolean {
  return issues.some((issue) => issue.validator === RELATIONSHIP_VALIDATOR || issue.type === 'relationship_pacing_violation');
}

function sceneIdsForRelationshipPacing(
  issues: Parameters<ContractRepairHandler>[0]['blockingIssues'],
): Set<string> {
  const ids = new Set<string>();
  for (const issue of issues) {
    if (issue.validator !== RELATIONSHIP_VALIDATOR && issue.type !== 'relationship_pacing_violation') continue;
    if (issue.sceneId) ids.add(issue.sceneId);
  }
  return ids;
}

function repairText(value: unknown): { value: unknown; changed: boolean } {
  if (typeof value !== 'string' || !value.trim()) return { value, changed: false };
  let next = value;
  for (const [pattern, replacement] of LABEL_REPLACEMENTS) {
    next = next.replace(pattern, replacement);
  }
  return { value: next, changed: next !== value };
}

function rewriteStringField(record: MutableRecord, key: string): number {
  const result = repairText(record[key]);
  if (!result.changed) return 0;
  record[key] = result.value;
  return 1;
}

function rewriteChoice(choice: MutableRecord): number {
  let rewritten = 0;
  for (const key of ['text', 'lockedText', 'reactionText']) rewritten += rewriteStringField(choice, key);

  const outcomeTexts = choice.outcomeTexts;
  if (outcomeTexts && typeof outcomeTexts === 'object' && !Array.isArray(outcomeTexts)) {
    for (const [key, value] of Object.entries(outcomeTexts as MutableRecord)) {
      const result = repairText(value);
      if (!result.changed) continue;
      (outcomeTexts as MutableRecord)[key] = result.value;
      rewritten += 1;
    }
  }

  const feedbackCue = choice.feedbackCue;
  if (feedbackCue && typeof feedbackCue === 'object' && !Array.isArray(feedbackCue)) {
    rewritten += rewriteStringField(feedbackCue as MutableRecord, 'echoSummary');
  }

  for (const hint of (Array.isArray(choice.residueHints) ? choice.residueHints : [])) {
    if (hint && typeof hint === 'object') rewritten += rewriteStringField(hint as MutableRecord, 'description');
  }

  for (const reaction of (Array.isArray(choice.witnessReactions) ? choice.witnessReactions : [])) {
    if (!reaction || typeof reaction !== 'object') continue;
    rewritten += rewriteStringField(reaction as MutableRecord, 'reactionText');
    rewritten += rewriteStringField(reaction as MutableRecord, 'residueHint');
  }

  return rewritten;
}

function rewriteBeat(beat: MutableRecord): number {
  let rewritten = rewriteStringField(beat, 'text');
  for (const variant of (Array.isArray(beat.textVariants) ? beat.textVariants : [])) {
    if (variant && typeof variant === 'object') rewritten += rewriteStringField(variant as MutableRecord, 'text');
  }
  for (const choice of (Array.isArray(beat.choices) ? beat.choices : [])) {
    if (choice && typeof choice === 'object') rewritten += rewriteChoice(choice as MutableRecord);
  }
  return rewritten;
}

function rewriteSceneHeader(scene: MutableRecord): number {
  let rewritten = 0;
  rewritten += rewriteStringField(scene, 'name');
  rewritten += rewriteStringField(scene, 'title');
  return rewritten;
}

export function buildRelationshipPacingLabelRepairHandler(): ContractRepairHandler {
  return ({ story, blockingIssues }) => {
    if (!hasRelationshipPacingBlocker(blockingIssues)) return { story, changed: false };

    const sceneIds = sceneIdsForRelationshipPacing(blockingIssues);
    if (sceneIds.size === 0) return { story, changed: false };

    let rewritten = 0;
    for (const episode of (story as Story).episodes ?? []) {
      for (const scene of episode.scenes ?? []) {
        if (!scene.id || !sceneIds.has(scene.id)) continue;
        rewritten += rewriteSceneHeader(scene as unknown as MutableRecord);
        for (const beat of scene.beats ?? []) rewritten += rewriteBeat(beat as unknown as MutableRecord);
      }
    }

    if (rewritten === 0) return { story, changed: false };
    return {
      story,
      changed: true,
      record: {
        rule: 'final_contract_relationship_pacing_labels',
        scope: 'scene',
        attempted: rewritten,
        succeeded: true,
        degraded: false,
        blocked: false,
        attempts: 1,
        details: `Downgraded ${rewritten} visible relationship-pacing label field(s)`,
      },
    };
  };
}
