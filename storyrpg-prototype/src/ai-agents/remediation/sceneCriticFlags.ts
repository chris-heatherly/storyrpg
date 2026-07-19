/**
 * SceneCritic targeting flags (SAR wave 2, R8 — authoring economics).
 *
 * Generation-time quality signals tag the SceneContent in place (mirroring the
 * validator evidence used by the commit review) so the flag-gated critic
 * review (GATE_SCENE_CRITIC_ON_FLAG) can spend its bounded rewrite budget
 * on the scenes that demonstrably struggled — not on every scene.
 *
 * A3 (quality-gap plan 14-50-23): advisory shadow evidence produced at scene
 * time — anchor planting misses, departure misses, relationship stage jumps
 * without dramatized evidence — also flags the scene, with a concrete critic
 * note. The advisory finding stays advisory (never blocks); the critic pass is
 * where a bounded rewrite can act on it while the scene is still cheap to fix.
 */

import type { SceneContent } from '../agents/SceneWriter';

export type SceneCriticFlagReason =
  | 'incremental-validation-regen'
  | 'realization-retry'
  | 'advisory-planting-miss'
  | 'advisory-departure-miss'
  | 'advisory-relationship-evidence'
  | 'mechanics-lint-residual';

interface CriticFlagged {
  criticFlags?: SceneCriticFlagReason[];
  criticNotes?: string[];
}

/** Tag a scene as a SceneCritic candidate (idempotent per reason). */
export function flagSceneForCritic(scene: SceneContent, reason: SceneCriticFlagReason): void {
  const tagged = scene as SceneContent & CriticFlagged;
  if (!tagged.criticFlags) tagged.criticFlags = [];
  if (!tagged.criticFlags.includes(reason)) tagged.criticFlags.push(reason);
}

/**
 * Attach a concrete, actionable instruction for the critic rewrite (idempotent
 * per note). Notes travel with the scene into the pre-commit review so the critic
 * fixes the NAMED gap instead of doing generic polish.
 */
export function addCriticNote(scene: SceneContent, note: string): void {
  const trimmed = note.trim();
  if (!trimmed) return;
  const tagged = scene as SceneContent & CriticFlagged;
  if (!tagged.criticNotes) tagged.criticNotes = [];
  if (!tagged.criticNotes.includes(trimmed)) tagged.criticNotes.push(trimmed);
}

/** The quality-signal reasons recorded on a scene, if any. */
export function sceneCriticFlags(scene: SceneContent): SceneCriticFlagReason[] {
  return (scene as SceneContent & CriticFlagged).criticFlags ?? [];
}

/** Actionable critic instructions recorded on a scene, if any. */
export function sceneCriticNotes(scene: SceneContent): string[] {
  return (scene as SceneContent & CriticFlagged).criticNotes ?? [];
}
