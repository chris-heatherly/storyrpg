import type { Story } from '../../types/story';
import type { Choice, Consequence } from '../../types';
import {
  effectiveNpcDeltaCap,
  mergeSceneRelationshipPacing,
  pacingKeysMatch,
} from '../utils/effectiveRelationshipPacing';
import { buildNpcAliases } from '../utils/relationshipArcLedger';
import type { ContractRepairHandler } from './finalContractRepair';

const LEDGER_VALIDATOR = 'RelationshipArcLedgerValidator';
const LEDGER_CAP_RE = /above the ledger cap/i;
const DELTA_ISSUE_RE =
  /Scene "([^"]+)" changes ([^\s.]+)\.([a-z]+) by (-?\d+), above the ledger cap (\d+)/i;

function isLedgerCapIssue(
  issue: Parameters<ContractRepairHandler>[0]['blockingIssues'][number],
): boolean {
  if (String(issue.validator) !== LEDGER_VALIDATOR) return false;
  return LEDGER_CAP_RE.test(String(issue.message ?? ''));
}

function parseLedgerCapIssue(message: string | undefined): {
  sceneId: string;
  npcId: string;
  dimension: string;
  delta: number;
  cap: number;
} | undefined {
  const match = DELTA_ISSUE_RE.exec(message ?? '');
  if (!match) return undefined;
  return {
    sceneId: match[1],
    npcId: match[2],
    dimension: match[3],
    delta: Number(match[4]),
    cap: Number(match[5]),
  };
}

function contractCapForNpc(
  story: Story,
  sceneId: string,
  npcId: string,
): number | undefined {
  const aliases = buildNpcAliases(story);
  for (const episode of story.episodes ?? []) {
    for (const scene of episode.scenes ?? []) {
      if (scene.id !== sceneId) continue;
      const contracts = mergeSceneRelationshipPacing(undefined, scene.relationshipPacing);
      return effectiveNpcDeltaCap(contracts, npcId, aliases);
    }
  }
  return undefined;
}

function clampConsequence(
  consequence: Consequence,
  npcId: string,
  dimension: string,
  cap: number,
): boolean {
  if (consequence.type !== 'relationship') return false;
  if (!pacingKeysMatch(consequence.npcId, npcId)) return false;
  if (String(consequence.dimension) !== dimension) return false;
  if (typeof consequence.change !== 'number') return false;
  if (Math.abs(consequence.change) <= cap) return false;
  consequence.change = consequence.change > 0 ? cap : -cap;
  return true;
}

function clampChoiceConsequences(
  choice: Choice,
  npcId: string,
  dimension: string,
  cap: number,
): number {
  let clamped = 0;
  for (const consequence of choice.consequences ?? []) {
    if (clampConsequence(consequence, npcId, dimension, cap)) clamped += 1;
  }
  return clamped;
}

/**
 * Deterministic final-contract repair: clamp relationship consequence deltas
 * that exceed the planned/scene ledger cap. Does not invent major-evidence tags.
 */
export function buildRelationshipDeltaCapRepairHandler(): ContractRepairHandler {
  return ({ story, blockingIssues }) => {
    const targets = blockingIssues
      .filter(isLedgerCapIssue)
      .map((issue) => parseLedgerCapIssue(issue.message))
      .filter((target): target is NonNullable<typeof target> => Boolean(target));
    if (targets.length === 0) return { story, changed: false };

    let clamped = 0;
    const changedFieldPaths: string[] = [];

    for (const episode of (story as Story).episodes ?? []) {
      for (const scene of episode.scenes ?? []) {
        const sceneTargets = targets.filter((target) => target.sceneId === scene.id);
        if (sceneTargets.length === 0) continue;

        for (const target of sceneTargets) {
          const sceneCap = contractCapForNpc(story as Story, target.sceneId, target.npcId);
          // Issue cap is authoritative (validator already applied NPC-only semantics).
          const cap = sceneCap !== undefined
            ? Math.min(sceneCap, target.cap)
            : target.cap;
          if (!Number.isFinite(cap) || cap <= 0) continue;

          for (let beatIndex = 0; beatIndex < (scene.beats ?? []).length; beatIndex += 1) {
            const beat = scene.beats[beatIndex];
            for (let choiceIndex = 0; choiceIndex < (beat.choices ?? []).length; choiceIndex += 1) {
              const choice = beat.choices![choiceIndex];
              const before = clamped;
              clamped += clampChoiceConsequences(choice, target.npcId, target.dimension, cap);
              if (clamped > before) {
                changedFieldPaths.push(
                  `episodes[${episode.number - 1}].scenes[${scene.id}].beats[${beatIndex}].choices[${choiceIndex}].consequences`,
                );
              }
            }
          }
        }
      }
    }

    if (clamped <= 0) return { story, changed: false };

    return {
      story,
      changed: true,
      changedFieldPaths,
      record: {
        rule: 'relationship_delta_cap_clamp',
        scope: 'autofix',
        attempted: clamped,
        succeeded: true,
        degraded: false,
        blocked: false,
        attempts: 1,
      },
    };
  };
}
