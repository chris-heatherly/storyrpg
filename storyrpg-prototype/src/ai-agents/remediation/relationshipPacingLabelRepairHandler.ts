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
  // Group christening that uses "official" as a naming proposal, not a job title
  // (bite-me 2026-07-08: "Let's make it official. We'll call ourselves the Dusk
  // Club." survived first-official rewrites and sealed the ep1 contract). Keep
  // benign uses ("city official", "official business") untouched.
  [/\bmake\s+it\s+official\b/gi, 'try the name on'],
  [/\bmake\s+this\s+official\b/gi, 'try the name on'],
  [/\bmake\s+(?:ourselves|ourselves\s+\w+)\s+official\b/gi, 'try the name on'],
  [/\bmade\s+it\s+official\b/gi, 'tried the name on'],
  [/\bmaking\s+it\s+official\b/gi, 'trying the name on'],
  // "official first meeting" formalizes a group before it is earned ("Welcome to
  // the Dusk Club, official first meeting."). Drop the premature "official"
  // wherever it sits next to "first", noun-agnostic: the LLM keeps minting new
  // milestone nouns faster than a list can chase them (bite-me 2026-07-04:
  // "first official meeting", then "first official operation", then "first
  // official mission" each survived a noun-list version of this rule and
  // blocked the ep1 seal). This handler only runs on scenes already flagged
  // for the blocked label.
  [/\bofficial\s+first\s+/gi, 'first '],
  [/\bfirst\s+official\s+/gi, 'first '],
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

function repairText(value: unknown, subject?: string): { value: unknown; changed: boolean } {
  if (typeof value !== 'string' || !value.trim()) return { value, changed: false };
  const subjectAliases = subject
    ? [subject, subject.replace(/-/g, ' ')].map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    : [];
  const subjectRe = subjectAliases.length > 0 ? new RegExp(`\\b(?:${subjectAliases.join('|')})\\b`, 'i') : undefined;
  const rewrite = (text: string): string => {
    let next = text;
    for (const [pattern, replacement] of LABEL_REPLACEMENTS) next = next.replace(pattern, replacement);
    return next;
  };
  const next = subjectRe
    ? (value.match(/[^.!?]+[.!?]?/g) ?? [value])
      .map((sentence) => subjectRe.test(sentence) ? rewrite(sentence) : sentence)
      .join('')
    : rewrite(value);
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

interface ScopedRepairTarget {
  sceneId: string;
  subject?: string;
  fieldPath?: string;
}

function scopedTargets(
  issues: Parameters<ContractRepairHandler>[0]['blockingIssues'],
): ScopedRepairTarget[] {
  const targets: ScopedRepairTarget[] = [];
  for (const issue of issues) {
    if (!isRelationshipPacingIssue(issue) || !issue.sceneId) continue;
    const subject = /\bsubject "([^"]+)"/i.exec(issue.message ?? '')?.[1]
      ?? /\bgroup "([^"]+)"/i.exec(issue.message ?? '')?.[1];
    const fieldPath = issue.fieldPath
      ?? /\bmatched ([^:]+):\s*"/i.exec(issue.message ?? '')?.[1];
    targets.push({ sceneId: issue.sceneId, subject, fieldPath });
  }
  return targets;
}

function rewriteExactField(scene: MutableRecord, fieldPath: string, subject?: string): number {
  const parts = fieldPath.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let owner: unknown = scene;
  for (const part of parts.slice(0, -1)) {
    if (!owner || typeof owner !== 'object') return 0;
    owner = (owner as MutableRecord)[part];
  }
  if (!owner || typeof owner !== 'object') return 0;
  const key = parts[parts.length - 1];
  const result = repairText((owner as MutableRecord)[key], subject);
  if (!result.changed) return 0;
  (owner as MutableRecord)[key] = result.value;
  return 1;
}

function rewriteSubjectContracts(
  scene: MutableRecord,
  subject: string | undefined,
  forcedCap?: RelationshipPacingStage,
): number {
  if (!subject) return rewriteRelationshipPacingContracts(scene, forcedCap);
  const contracts = Array.isArray(scene.relationshipPacing) ? scene.relationshipPacing : [];
  let rewritten = 0;
  const key = subject.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  for (const contract of contracts) {
    if (!contract || typeof contract !== 'object') continue;
    const typed = contract as RelationshipPacingContract;
    const contractSubject = String(typed.npcId ?? typed.groupId ?? '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (contractSubject !== key) continue;
    if (typed.milestone && !forcedCap) continue;
    const capped = capTargetStage(typed, forcedCap);
    if (capped.changed) {
      typed.targetStage = capped.targetStage;
      rewritten += 1;
    }
  }
  return rewritten;
}

export function buildRelationshipPacingLabelRepairHandler(): ContractRepairHandler {
  return ({ story, blockingIssues }) => {
    if (!hasRelationshipPacingBlocker(blockingIssues)) return { story, changed: false };

    const sceneIds = sceneIdsForRelationshipPacing(blockingIssues);
    const targets = scopedTargets(blockingIssues);
    const permittedByScene = permittedStagesByScene(blockingIssues);
    if (sceneIds.size === 0) return { story, changed: false };

    let rewritten = 0;
    for (const episode of (story as Story).episodes ?? []) {
      for (const scene of episode.scenes ?? []) {
        if (!scene.id || !sceneIds.has(scene.id)) continue;
        const sceneTargets = targets.filter((target) => target.sceneId === scene.id);
        for (const target of sceneTargets) {
          rewritten += rewriteSubjectContracts(
            scene as unknown as MutableRecord,
            target.subject,
            permittedByScene.get(scene.id),
          );
          if (target.fieldPath) {
            rewritten += rewriteExactField(scene as unknown as MutableRecord, target.fieldPath, target.subject);
          } else {
            rewritten += rewriteSceneHeader(scene as unknown as MutableRecord);
            for (const beat of scene.beats ?? []) rewritten += rewriteBeat(beat as unknown as MutableRecord);
          }
        }
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
