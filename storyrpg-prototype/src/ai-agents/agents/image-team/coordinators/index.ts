/**
 * Image Team Coordinators
 *
 * Four coordinators split `ImageAgentTeam` into narrower concerns. Each
 * coordinator owns a slice of the pipeline and a subset of the image-team
 * agents. `ImageAgentTeam` becomes a thin facade that composes them.
 *
 * See `./README.md` for migration status and ownership tables.
 */

import type { AgentConfig } from '../../../config';

/**
 * Shared context that coordinators read from and write to. Mirrors the
 * `PipelineContext` shape from `pipeline/phases/index.ts` but adds
 * image-team-specific state that today lives as private fields on
 * `ImageAgentTeam`.
 */
export interface ImageTeamContext {
  agentConfig: AgentConfig;
  /** Active art style string (falls back to 'cinematic realism' in the monolith). */
  artStyle?: string;
  /**
   * Budget for identity-driven regenerations inside a single run.
   * The Consistency coordinator decrements this.
   */
  identityRegenerationsUsed: number;
  maxIdentityRegenerations: number;
  identityScoreThreshold: number;
}

export interface Coordinator {
  readonly name: string;
}

/**
 * Coordinator that plans image shots: storyboard, color script, cinematic
 * beat analysis, visual narrative / visual storytelling systems. Owns the
 * LLM-heavy planning agents.
 */
export interface ImagePlanningCoordinator extends Coordinator {
  readonly name: 'ImagePlanningCoordinator';
}

/**
 * Coordinator that turns plans into concrete image prompts and generated
 * images: illustrator, encounter images, character reference sheets.
 */
export interface ImageIllustrationCoordinator extends Coordinator {
  readonly name: 'ImageIllustrationCoordinator';
}

/**
 * Coordinator that scores and enforces character consistency across
 * generated images. Owns the reference-sheet cache, fingerprint registry,
 * identity gate, and drift auditing.
 */
export interface ImageConsistencyCoordinator extends Coordinator {
  readonly name: 'ImageConsistencyCoordinator';
}

/**
 * Coordinator that runs post-generation visual validators (composition,
 * pose diversity, transitions, expressions, body language, lighting, visual
 * storytelling). Phase 7 collapses these into a single `VisualQualityJudge`.
 */
export interface ImageQualityCoordinator extends Coordinator {
  readonly name: 'ImageQualityCoordinator';
}

export type AnyImageCoordinator =
  | ImagePlanningCoordinator
  | ImageIllustrationCoordinator
  | ImageConsistencyCoordinator
  | ImageQualityCoordinator;
