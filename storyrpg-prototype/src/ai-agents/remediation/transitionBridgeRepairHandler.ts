import type { Beat, Story } from '../../types';
import { SceneTransitionContinuityValidator } from '../validators/SceneTransitionContinuityValidator';
import type { ContractRepairHandler, ContractRepairReport } from './finalContractRepair';

const TRANSITION_FINDING_RE =
  /into scene "([^"]+)" \(episode (\d+)\) via choice bridge "([^"]+)": planned shift \(([^)]*)\)/;
const LOCATION_SHIFT_RE = /location (.+?) → ([^,]+)/;

interface ParsedTransitionFinding {
  targetSceneId: string;
  episodeNumber: number;
  bridgeBeatId: string;
  fromLocation?: string;
  toLocation?: string;
}

function parseTransitionFinding(message: string | undefined): ParsedTransitionFinding | undefined {
  if (!message) return undefined;
  const match = TRANSITION_FINDING_RE.exec(message);
  if (!match) return undefined;
  return {
    targetSceneId: match[1],
    episodeNumber: Number(match[2]),
    bridgeBeatId: match[3],
    fromLocation: LOCATION_SHIFT_RE.exec(match[4])?.[1]?.trim(),
    toLocation: LOCATION_SHIFT_RE.exec(match[4])?.[2]?.trim(),
  };
}

function findBridgeBeat(story: Story, episodeNumber: number, sceneId: string | undefined, beatId: string): Beat | undefined {
  for (const episode of story.episodes || []) {
    if (episode.number !== episodeNumber) continue;
    for (const scene of episode.scenes || []) {
      if (sceneId && scene.id !== sceneId) continue;
      const beat = (scene.beats || []).find((candidate) => candidate.id === beatId);
      if (beat) return beat;
    }
  }
  return undefined;
}

function transitionSentence(parsed: ParsedTransitionFinding): string {
  const from = parsed.fromLocation || 'where you were';
  const to = parsed.toLocation || parsed.targetSceneId;
  const loweredTo = to.toLowerCase();
  if (/\bcar\b/.test(loweredTo)) {
    return `You drive out of ${from} and into the ${to}, the ride making the distance impossible to miss.`;
  }
  return `You leave ${from} and arrive at ${to}, grounding the next step before the scene changes.`;
}

function prependTransition(beat: Beat, sentence: string): boolean {
  const current = String(beat.text || '').trim();
  if (current.toLowerCase().includes(sentence.toLowerCase())) return false;
  beat.text = current ? `${sentence} ${current}` : sentence;
  return true;
}

export function repairTransitionBridgeContinuity(
  story: Story,
  blockingIssues: ContractRepairReport['blockingIssues'],
): number {
  let touched = 0;
  for (const issue of blockingIssues) {
    if (issue.validator !== 'SceneTransitionContinuityValidator') continue;
    const parsed = parseTransitionFinding(issue.message);
    if (!parsed) continue;
    const beat = findBridgeBeat(story, parsed.episodeNumber, issue.sceneId, parsed.bridgeBeatId);
    if (!beat) continue;
    if (prependTransition(beat, transitionSentence(parsed))) touched += 1;
  }
  return touched;
}

export function repairDetectedTransitionBridgeContinuity(story: Story): number {
  const result = new SceneTransitionContinuityValidator().validate({ story });
  if (result.valid) return 0;
  return repairTransitionBridgeContinuity(
    story,
    result.issues.map((issue) => ({
      validator: 'SceneTransitionContinuityValidator',
      type: 'transition_continuity_violation',
      severity: issue.severity,
      message: issue.message,
    })),
  );
}

export function buildTransitionBridgeRepairHandler(): ContractRepairHandler {
  return ({ story, blockingIssues }) => {
    const touched = repairTransitionBridgeContinuity(story, blockingIssues);
    if (touched === 0) return { story, changed: false };
    return {
      story,
      changed: true,
      record: {
        rule: 'final_contract_transition_bridge',
        scope: 'scene',
        attempted: touched,
        succeeded: true,
        degraded: false,
        blocked: false,
        attempts: 1,
        details: `Added transition prose to ${touched} choice bridge beat(s)`,
      },
    };
  };
}
