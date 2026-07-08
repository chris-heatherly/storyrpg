/**
 * SceneCritic targeting flags (SAR wave 2, R8 — authoring economics).
 *
 * Generation-time quality signals tag the SceneContent in place (mirroring the
 * ad-hoc `voiceScore` tag runSceneCriticPass already reads) so the flag-gated
 * critic pass (GATE_SCENE_CRITIC_ON_FLAG) can spend its bounded rewrite budget
 * on the scenes that demonstrably struggled — not on every scene.
 */

import type { SceneContent } from '../agents/SceneWriter';

export type SceneCriticFlagReason = 'incremental-validation-regen' | 'realization-retry';

interface CriticFlagged {
  criticFlags?: SceneCriticFlagReason[];
}

/** Tag a scene as a SceneCritic candidate (idempotent per reason). */
export function flagSceneForCritic(scene: SceneContent, reason: SceneCriticFlagReason): void {
  const tagged = scene as SceneContent & CriticFlagged;
  if (!tagged.criticFlags) tagged.criticFlags = [];
  if (!tagged.criticFlags.includes(reason)) tagged.criticFlags.push(reason);
}

/** The quality-signal reasons recorded on a scene, if any. */
export function sceneCriticFlags(scene: SceneContent): SceneCriticFlagReason[] {
  return (scene as SceneContent & CriticFlagged).criticFlags ?? [];
}
