import type { Story } from '../../types/story';
import type { ContractRepairHandler } from './finalContractRepair';
import type { RelationshipPacingContract, RelationshipPacingStage } from '../../types/scenePlan';

type MutableRecord = Record<string, unknown>;

const RELATIONSHIP_VALIDATORS = new Set(['RelationshipArcLedgerValidator']);

const LABEL_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bfor\s+the\s+([A-Z][A-Za-z0-9'’ -]*(?:club|circle|crew|group))\b/gi, 'for whatever this $1 becomes'],
  [/\bthe\s+([A-Z][A-Za-z0-9'’ -]*(?:club|circle|crew|group))'s\s+trust\b/gi, 'this fragile circle\'s trust'],
  [/\bthe\s+(club|circle|crew|group)'s\s+trust\b/gi, 'this fragile circle\'s trust'],
  [/\b([A-Z][A-Za-z0-9'’ -]*(?:club|circle|crew|group))\s+is\s+real\b/gi, '$1 is still a dare'],
  [/\b(?:the\s+)?[A-Z][A-Za-z0-9'’ -]*(?:club|circle|crew|group)\s+is\s+now\b/gi, 'the name stays provisional as'],
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
  [/\bfriendship\b/gi, 'guarded warmth'],
  [/\bnew friends\b/gi, 'new companions'],
  [/\bmy friends\b/gi, 'these companions'],
  [/\bfriends\b/gi, 'companions'],
  [/\bfriend\b/gi, 'ally'],
];

const STAGE_ORDER: RelationshipPacingStage[] = [
  'unmet',
  'noticed',
  'spark',
  'acquaintance',
  'tentative_ally',
  'friend',
  'trusted_ally',
  'intimate',
];

function stageRank(stage: RelationshipPacingStage | undefined): number {
  return stage ? STAGE_ORDER.indexOf(stage) : -1;
}

function capTargetStage(
  contract: RelationshipPacingContract,
  forcedCap?: RelationshipPacingStage,
): { changed: boolean; targetStage: RelationshipPacingStage } {
  const current = contract.targetStage;
  let capped: RelationshipPacingStage = forcedCap || current;

  if (!forcedCap) {
    if (stageRank(contract.startStage) <= stageRank('unmet')) capped = 'spark';
    else if (stageRank(contract.startStage) <= stageRank('spark')) capped = 'acquaintance';
    else if (stageRank(contract.startStage) <= stageRank('acquaintance')) capped = 'tentative_ally';
  }

  if (stageRank(capped) < 0 || stageRank(current) <= stageRank(capped)) return { changed: false, targetStage: current };
  return { changed: true, targetStage: capped };
}

function hasRelationshipPacingBlocker(
  issues: Parameters<ContractRepairHandler>[0]['blockingIssues'],
): boolean {
  return issues.some((issue) => isRelationshipPacingIssue(issue));
}

function isRelationshipPacingIssue(
  issue: Parameters<ContractRepairHandler>[0]['blockingIssues'][number],
): boolean {
  return RELATIONSHIP_VALIDATORS.has(String(issue.validator));
}

function sceneIdsForRelationshipPacing(
  issues: Parameters<ContractRepairHandler>[0]['blockingIssues'],
): Set<string> {
  const ids = new Set<string>();
  for (const issue of issues) {
    if (!isRelationshipPacingIssue(issue)) continue;
    if (issue.sceneId) ids.add(issue.sceneId);
  }
  return ids;
}

function permittedStagesByScene(
  issues: Parameters<ContractRepairHandler>[0]['blockingIssues'],
): Map<string, RelationshipPacingStage> {
  const out = new Map<string, RelationshipPacingStage>();
  const stageOptions = STAGE_ORDER.filter((stage) => stage !== 'unmet');
  for (const issue of issues) {
    if (!isRelationshipPacingIssue(issue)) continue;
    if (!issue.sceneId) continue;
    const text = [issue.message, issue.suggestion].filter(Boolean).join(' ');
    const explicit = stageOptions.find((stage) =>
      new RegExp(`\\bonly permits ${stage.replace(/_/g, '[_\\\\s-]')}\\b`, 'i').test(text)
    );
    const fallback: RelationshipPacingStage | undefined = /\bbeyond acquaintance before any player relationship choice\b/i.test(text)
      ? 'acquaintance'
      : /\bonly permits (?:a\s+)?provisional spark\b/i.test(text)
      ? 'spark'
      : /\badvances past provisional spark\b/i.test(text)
      ? 'spark'
      : undefined;
    const permitted = explicit || fallback;
    if (!permitted) continue;
    const previous = out.get(issue.sceneId);
    if (!previous || stageRank(permitted) < stageRank(previous)) out.set(issue.sceneId, permitted);
  }
  return out;
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

  const stakes = choice.stakes;
  if (stakes && typeof stakes === 'object' && !Array.isArray(stakes)) {
    for (const key of ['want', 'cost', 'identity']) rewritten += rewriteStringField(stakes as MutableRecord, key);
  }

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

function rewriteRelationshipPacingContracts(scene: MutableRecord, forcedCap?: RelationshipPacingStage): number {
  const contracts = Array.isArray(scene.relationshipPacing) ? scene.relationshipPacing : [];
  let rewritten = 0;
  for (const contract of contracts) {
    if (!contract || typeof contract !== 'object') continue;
    const typed = contract as RelationshipPacingContract;
    const capped = capTargetStage(typed, forcedCap);
    if (!capped.changed) continue;
    typed.targetStage = capped.targetStage;
    typed.allowedLabels = (typed.allowedLabels || []).filter((label) => !/\b(?:friend|trusted|inner circle|intimate|family|one of us)\b/i.test(label));
    if (typed.allowedLabels.length === 0) {
      typed.allowedLabels = capped.targetStage === 'spark'
        ? ['spark', 'invitation', 'guarded warmth']
        : ['new acquaintance', 'guarded warmth', 'testing trust'];
    }
    typed.blockedLabels = Array.from(new Set([
      ...(typed.blockedLabels || []),
      'friend',
      'best friend',
      'trusted ally',
      'inner circle',
      'one of us',
      'family',
      'intimate',
    ]));
    rewritten += 1;
  }
  return rewritten;
}

export function buildRelationshipPacingLabelRepairHandler(): ContractRepairHandler {
  return ({ story, blockingIssues }) => {
    if (!hasRelationshipPacingBlocker(blockingIssues)) return { story, changed: false };

    const sceneIds = sceneIdsForRelationshipPacing(blockingIssues);
    const permittedByScene = permittedStagesByScene(blockingIssues);
    if (sceneIds.size === 0) return { story, changed: false };

    let rewritten = 0;
    for (const episode of (story as Story).episodes ?? []) {
      for (const scene of episode.scenes ?? []) {
        if (!scene.id || !sceneIds.has(scene.id)) continue;
        rewritten += rewriteRelationshipPacingContracts(
          scene as unknown as MutableRecord,
          permittedByScene.get(scene.id),
        );
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
