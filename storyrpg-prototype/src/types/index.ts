/**
 * Canonical data-model barrel.
 *
 * The concrete definitions live in topic-oriented modules:
 *   - `./player`       — attributes, identity, inventory, player state
 *   - `./conditions`   — Condition / ConditionExpression union
 *   - `./consequences` — Consequence / AppliedConsequence / DelayedConsequence
 *   - `./choice`       — player-facing Choice + resolution metadata
 *   - `./content`      — Beat, TextVariant, VideoAnimationInstruction
 *   - `./encounter`    — Encounter, cinematic visual contract, storylets
 *   - `./story`        — Scene, Episode, Story, GameSession, season planning
 *
 * New code should import directly from the specific submodule for clarity;
 * existing imports from `../types` continue to work via these re-exports.
 */

export * from './player';
export * from './conditions';
export * from './consequences';
export * from './choice';
export * from './content';
export * from './encounter';
export * from './story';
