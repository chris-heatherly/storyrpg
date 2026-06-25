import type { Story } from '../../types/story';
import type { ContractRepairHandler } from './finalContractRepair';

type MutableRecord = Record<string, unknown>;

const READER_TEXT_KEYS = new Set([
  'text',
  'lockedText',
  'reactionText',
  'setupText',
  'escalationText',
  'outcomeText',
  'narrativeText',
  'description',
]);

function hasPlayerReferenceBlocker(
  issues: Parameters<ContractRepairHandler>[0]['blockingIssues'],
): boolean {
  return issues.some((issue) => /\bthe\s+player\b/i.test(`${issue.message ?? ''} ${issue.suggestion ?? ''}`));
}

export function repairPlayerReferenceProse(value: unknown): { value: unknown; changed: boolean } {
  if (typeof value !== 'string' || !/\b(?:the\s+player|player's)\b/i.test(value)) return { value, changed: false };
  let next = value;
  const preserveLeadingCase = (match: string, replacement: string): string =>
    /^[A-Z]/.test(match) ? `${replacement.charAt(0).toUpperCase()}${replacement.slice(1)}` : replacement;
  next = next.replace(/\bthe player opposite you\b/gi, (match) => preserveLeadingCase(match, 'the person opposite you'));
  next = next.replace(/\bthe other player's\b/gi, (match) => preserveLeadingCase(match, "the other person's"));
  next = next.replace(/\bthe other player\b/gi, (match) => preserveLeadingCase(match, 'the other person'));
  next = next.replace(/\bwhich option the player chose\b/gi, 'which choice you made');
  next = next.replace(/\bthe player chose\b/gi, 'you chose');
  next = next.replace(/\bthe player\b/gi, (match) => preserveLeadingCase(match, 'you'));
  return { value: next, changed: next !== value };
}

function rewriteStringField(record: MutableRecord, key: string): number {
  const result = repairPlayerReferenceProse(record[key]);
  if (!result.changed) return 0;
  record[key] = result.value;
  return 1;
}

function rewriteReaderFacingFields(value: unknown): number {
  if (!value || typeof value !== 'object') return 0;
  let rewritten = 0;
  if (Array.isArray(value)) {
    for (const item of value) rewritten += rewriteReaderFacingFields(item);
    return rewritten;
  }

  const record = value as MutableRecord;
  for (const key of Object.keys(record)) {
    if (READER_TEXT_KEYS.has(key)) rewritten += rewriteStringField(record, key);
  }

  const outcomeTexts = record.outcomeTexts;
  if (outcomeTexts && typeof outcomeTexts === 'object' && !Array.isArray(outcomeTexts)) {
    for (const key of Object.keys(outcomeTexts as MutableRecord)) {
      rewritten += rewriteStringField(outcomeTexts as MutableRecord, key);
    }
  }

  for (const key of Object.keys(record)) {
    const child = record[key];
    if (child && typeof child === 'object') rewritten += rewriteReaderFacingFields(child);
  }
  return rewritten;
}

export function buildPlayerFacingProseRepairHandler(): ContractRepairHandler {
  return ({ story, blockingIssues }) => {
    if (!hasPlayerReferenceBlocker(blockingIssues)) return { story, changed: false };

    const rewritten = rewriteReaderFacingFields(story as Story);
    if (rewritten === 0) return { story, changed: false };

    return {
      story,
      changed: true,
      record: {
        rule: 'final_contract_player_reference_prose',
        scope: 'season',
        attempted: rewritten,
        succeeded: true,
        degraded: false,
        blocked: false,
        attempts: 1,
        details: `Rewrote ${rewritten} reader-facing "the player" reference(s) into in-fiction prose`,
      },
    };
  };
}
