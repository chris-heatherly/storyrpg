/**
 * Visual Checks
 *
 * Adapter layer between existing image-team validators and the unified
 * `VisualQualityJudge` dispatch. Each existing validator keeps its prompt
 * and output shape. The wrappers here translate their report into the
 * judge's shared `VisualCheckResult` contract.
 *
 * Status: wrappers live next to this file. Phase 7 will progressively add
 * one wrapper per existing validator, then migrate call sites off the
 * direct `validate*` methods on `ImageAgentTeam` onto the judge.
 */

export * from './CompositionCheck';
