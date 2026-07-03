/**
 * Deterministic filler/scaffold sentences that pipeline code has historically
 * synthesized into reader-facing prose (SceneWriter synthetic lead-ins,
 * transit-bridge scaffolds, failed-scene markers).
 *
 * Policy: filler never ships. The generation-side producers have been removed
 * (SceneWriter fails the scene instead of padding); this list is the blocking
 * tripwire at the final contract in case any producer comes back or an old
 * checkpoint replays one.
 */
export interface SyntheticFallbackPattern {
  label: string;
  pattern: RegExp;
  suggestion: string;
}

const REWRITE_AS_PROSE =
  'Regenerate the scene: synthetic filler must be replaced by concrete staged action, dialogue, or sensory detail — never shipped.';

export const SYNTHETIC_FALLBACK_PROSE_PATTERNS: SyntheticFallbackPattern[] = [
  {
    label: 'synthetic lead-in: pressure mounting',
    pattern: /\bPressure is already mounting around you as this moment opens\b/i,
    suggestion: REWRITE_AS_PROSE,
  },
  {
    label: 'synthetic lead-in: first sign of choice',
    pattern: /\bYou catch the first sign that this moment will demand a choice\b/i,
    suggestion: REWRITE_AS_PROSE,
  },
  {
    label: 'synthetic lead-in: concrete detail changes the room',
    pattern: /\bA concrete detail changes the room, narrowing what\b/i,
    suggestion: REWRITE_AS_PROSE,
  },
  {
    label: 'synthetic lead-in: nearby stakes revealed plainly',
    pattern: /\bThe people nearby reveal new stakes without saying them plainly\b/i,
    suggestion: REWRITE_AS_PROSE,
  },
  {
    label: 'synthetic lead-in: pressure tightens toward decision',
    pattern: /\bThe pressure tightens as the scene drives toward a decision you cannot avoid\b/i,
    suggestion: REWRITE_AS_PROSE,
  },
  {
    label: 'synthetic lead-in: reads another specific shift',
    pattern: /\breads another specific shift in the moment before choosing a response\b/i,
    suggestion: REWRITE_AS_PROSE,
  },
  {
    label: 'synthetic anchor: you register the first shift',
    pattern: /\bYou register the first shift:/i,
    suggestion: REWRITE_AS_PROSE,
  },
  {
    label: 'synthetic anchor: when the moment turns',
    pattern: /\bwhen the moment turns:/i,
    suggestion: REWRITE_AS_PROSE,
  },
  {
    label: 'synthetic choice seed: moment turns on a decision',
    pattern: /\bThe moment turns on a decision\b[^.!?\n]{0,60}\bcannot avoid\b/i,
    suggestion: REWRITE_AS_PROSE,
  },
  {
    label: 'transit scaffold: grounding the next step',
    pattern: /\bgrounding the next step before the scene changes\b/i,
    suggestion: 'Write the transition as plain fiction (movement, time passing) without pipeline vocabulary.',
  },
  {
    label: 'failed-scene marker',
    pattern: /\[Scene content generation failed/i,
    suggestion: 'The scene never generated; the episode must fail or regenerate — a failure marker is not story content.',
  },
  {
    label: 'encounter-bridge scaffold: the moment arrives',
    pattern: /\bThe moment arrives before you can prepare for it:/i,
    suggestion: REWRITE_AS_PROSE,
  },
  {
    label: 'missing-content placeholder',
    pattern: /\[Scene content was not generated\]/i,
    suggestion: 'The scene never generated; the episode must fail or regenerate — a placeholder marker is not story content.',
  },
];
