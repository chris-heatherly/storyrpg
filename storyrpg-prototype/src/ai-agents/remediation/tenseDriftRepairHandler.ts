import type { Story } from '../../types/story';
import type { ContractRepairHandler } from './finalContractRepair';

type MutableRecord = Record<string, unknown>;

function isTenseDriftIssue(issue: Parameters<ContractRepairHandler>[0]['blockingIssues'][number]): boolean {
  return issue.validator === 'NarrativeFailureModeValidator'
    && issue.type === 'prose_style_violation'
    && /\btense drift\b/i.test(issue.message ?? '')
    && Boolean(issue.sceneId)
    && Boolean(issue.beatId);
}

export function repairLiveActionTense(value: unknown): { value: unknown; changed: boolean } {
  if (typeof value !== 'string' || !value.trim()) return { value, changed: false };
  let next = value;
  const preserveLeadingCase = (match: string, replacement: string): string =>
    /^[A-Z]/.test(match) ? `${replacement.charAt(0).toUpperCase()}${replacement.slice(1)}` : replacement;

  next = next
    .replace(/\bBefore (he|she|it|they|Mika|Stela|Victor|Radu|Kylie|Sadie|Carmen) turned\b/g, 'Before $1 turns')
    .replace(/\b(he|she|it|they|Mika|Stela|Victor|Radu|Kylie|Sadie|Carmen) turned\b/g, '$1 turns')
    .replace(/\b(he|she|it|they|Mika|Stela|Victor|Radu|Kylie|Sadie|Carmen) looked\b/g, '$1 looks')
    .replace(/\b(he|she|it|they|Mika|Stela|Victor|Radu|Kylie|Sadie|Carmen) stepped\b/g, '$1 steps')
    .replace(/\b(he|she|it|they|Mika|Stela|Victor|Radu|Kylie|Sadie|Carmen) reached\b/g, '$1 reaches')
    .replace(/\b(he|she|it|they|Mika|Stela|Victor|Radu|Kylie|Sadie|Carmen) held\b/g, '$1 holds')
    .replace(/\b(he|she|it|they|Mika|Stela|Victor|Radu|Kylie|Sadie|Carmen) didn't\b/g, "$1 doesn't")
    .replace(/\byou saw\b/g, 'you see')
    .replace(/\byou felt\b/g, 'you feel')
    .replace(/\byou heard\b/g, 'you hear')
    .replace(/\byou watched\b/g, 'you watch')
    .replace(/\byou looked\b/g, 'you look')
    .replace(/\byou stepped\b/g, 'you step')
    .replace(/\byou turned\b/g, 'you turn')
    .replace(/\byou reached\b/g, 'you reach')
    .replace(/\byou took\b/g, 'you take')
    .replace(/\byou held\b/g, 'you hold')
    .replace(/\byou didn't\b/g, "you don't")
    .replace(/\byour glass clicked\b/gi, (match) => preserveLeadingCase(match, 'your glass clicks'))
    .replace(/\bit was gone\b/g, 'it is gone')
    .replace(/\bthere was\b/g, 'there is')
    .replace(/\bthere were\b/g, 'there are');

  return { value: next, changed: next !== value };
}

function findBeat(story: Story, sceneId: string, beatId: string): MutableRecord | undefined {
  for (const episode of story.episodes ?? []) {
    for (const scene of episode.scenes ?? []) {
      if (scene.id !== sceneId) continue;
      for (const beat of scene.beats ?? []) {
        if (beat.id === beatId) return beat as unknown as MutableRecord;
      }
    }
  }
  return undefined;
}

export function buildTenseDriftRepairHandler(): ContractRepairHandler {
  return ({ story, blockingIssues }) => {
    const issues = blockingIssues.filter(isTenseDriftIssue);
    if (issues.length === 0) return { story, changed: false };

    let rewritten = 0;
    for (const issue of issues) {
      const beat = findBeat(story as Story, issue.sceneId!, issue.beatId!);
      if (!beat) continue;
      const result = repairLiveActionTense(beat.text);
      if (!result.changed) continue;
      beat.text = result.value;
      rewritten += 1;
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
        details: `Rewrote ${rewritten} tense-drift beat(s) into present-tense live action`,
      },
    };
  };
}
