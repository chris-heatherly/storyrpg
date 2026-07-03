import type { Beat, Scene, Story } from '../../types';
import type { SeasonScenePlan } from '../../types/scenePlan';
import { SceneTransitionContinuityValidator } from '../validators/SceneTransitionContinuityValidator';
import type { ContractRepairHandler, ContractRepairReport } from './finalContractRepair';

const TRANSITION_FINDING_RE =
  /into scene "([^"]+)" \(episode (\d+)\) via choice bridge "([^"]+)": planned shift \(([^)]*)\)/;
const ADJACENT_TRANSITION_FINDING_RE =
  /into scene "([^"]+)" \(episode (\d+)\): planned shift \(([^)]*)\)/;
const LOCATION_SHIFT_RE = /location (.+?) → ([^,]+)/;

interface ParsedTransitionFinding {
  targetSceneId: string;
  episodeNumber: number;
  bridgeBeatId?: string;
  fromLocation?: string;
  toLocation?: string;
}

function parseTransitionFinding(message: string | undefined): ParsedTransitionFinding | undefined {
  if (!message) return undefined;
  const match = TRANSITION_FINDING_RE.exec(message);
  if (match) {
    return {
      targetSceneId: match[1],
      episodeNumber: Number(match[2]),
      bridgeBeatId: match[3],
      fromLocation: LOCATION_SHIFT_RE.exec(match[4])?.[1]?.trim(),
      toLocation: LOCATION_SHIFT_RE.exec(match[4])?.[2]?.trim(),
    };
  }
  const adjacentMatch = ADJACENT_TRANSITION_FINDING_RE.exec(message);
  if (!adjacentMatch) return undefined;
  return {
    targetSceneId: adjacentMatch[1],
    episodeNumber: Number(adjacentMatch[2]),
    fromLocation: LOCATION_SHIFT_RE.exec(adjacentMatch[3])?.[1]?.trim(),
    toLocation: LOCATION_SHIFT_RE.exec(adjacentMatch[3])?.[2]?.trim(),
  };
}

function findBridgeBeat(
  story: Story,
  episodeNumber: number,
  sceneId: string | undefined,
  targetSceneId: string,
  beatId?: string,
): Beat | undefined {
  for (const episode of story.episodes || []) {
    if (episode.number !== episodeNumber) continue;
    for (const scene of episode.scenes || []) {
      if (sceneId && scene.id !== sceneId) continue;
      const beat = (scene.beats || []).find((candidate) =>
        beatId ? candidate.id === beatId : candidate.nextSceneId === targetSceneId
      );
      if (beat) return beat;
    }
  }
  return undefined;
}

function findScene(story: Story, episodeNumber: number, sceneId: string): Scene | undefined {
  for (const episode of story.episodes || []) {
    if (episode.number !== episodeNumber) continue;
    return (episode.scenes || []).find((scene) => scene.id === sceneId);
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
  return `You leave ${from} behind and make your way to ${to}.`;
}

function prependTransition(beat: Beat, sentence: string): boolean {
  const current = String(beat.text || '').trim();
  if (current.toLowerCase().includes(sentence.toLowerCase())) return false;
  beat.text = current ? `${sentence} ${current}` : sentence;
  return true;
}

function setTransitionIn(scene: Scene, sentence: string): boolean {
  const current = String(scene.timeline?.transitionIn || '').trim();
  if (current.toLowerCase().includes(sentence.toLowerCase())) return false;
  scene.timeline = {
    ...(scene.timeline || {}),
    transitionIn: current ? `${sentence} ${current}` : sentence,
  };
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
    if (!parsed.bridgeBeatId) {
      const scene = findScene(story, parsed.episodeNumber, parsed.targetSceneId);
      if (scene && setTransitionIn(scene, transitionSentence(parsed))) touched += 1;
      continue;
    }
    const beat = findBridgeBeat(story, parsed.episodeNumber, undefined, parsed.targetSceneId, parsed.bridgeBeatId);
    if (!beat) continue;
    if (prependTransition(beat, transitionSentence(parsed))) touched += 1;
  }
  return touched;
}

export function repairDetectedTransitionBridgeContinuity(story: Story, scenePlan?: SeasonScenePlan): number {
  const result = new SceneTransitionContinuityValidator().validate({ story, scenePlan });
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
