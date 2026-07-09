/**
 * Deterministic filler/scaffold sentences that pipeline code has historically
 * synthesized into reader-facing prose (SceneWriter synthetic lead-ins,
 * transit-bridge scaffolds, failed-scene markers).
 *
 * Policy: filler never ships. LLMs do the writing; deterministic systems
 * enforce the rules and, on failure, get the LLMs to rewrite — they never take
 * over the writing. The generation-side producers have been removed where
 * possible (SceneWriter fails the scene instead of padding); this list is the
 * blocking tripwire at the final contract in case any producer comes back or
 * an old checkpoint replays one.
 *
 * REGISTRATION CONTRACT: any deterministic code path that writes a placeholder
 * string into a reader-facing field (run-survival fallbacks included) MUST
 * register that string here (or, for choice outcome tiers, in
 * `choiceTextFallbacks.ts`). RouteContinuityValidator scans all reader-facing
 * surfaces against this list and raises blocking `unsafe_fallback_prose`
 * findings, which the final-contract repair loop routes to an LLM rewrite.
 * `deterministicProseNeverShips.test.ts` enforces completeness for the known
 * deterministic producers.
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
    label: 'retired encounter synopsis wrapper: face this pressure',
    pattern: /\bYou face this pressure:/i,
    suggestion: 'Re-author encounter.description as concrete second-person playable metadata.',
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

  // ── encounterConverter deterministic fallbacks (registered 2026-07-04) ──
  // convertEncounterStructureToEncounter and convertOutcome write these when
  // the EncounterArchitect output omits storylet beats / stakes / outcome
  // narrativeText. They are run-survival placeholders, NOT authored fiction:
  // registering them here makes them blocking `unsafe_fallback_prose`
  // findings so the repair loop re-authors them with an LLM (or the run fails
  // loudly) instead of shipping template prose to readers.
  {
    label: 'encounter fallback: bare success stub',
    pattern: /^\s*Success!\s*$/,
    suggestion: REWRITE_AS_PROSE,
  },
  {
    label: 'encounter fallback: bare partial-success stub',
    pattern: /^\s*Partial success\.{3}\s*$/,
    suggestion: REWRITE_AS_PROSE,
  },
  {
    label: 'encounter fallback: bare failure stub',
    pattern: /^\s*Things go wrong\.{3}\s*$/,
    suggestion: REWRITE_AS_PROSE,
  },
  {
    label: 'encounter fallback: phase success stub',
    pattern: /^\s*You succeeded!\s*$/,
    suggestion: REWRITE_AS_PROSE,
  },
  {
    label: 'encounter fallback: phase failure stub',
    pattern: /^\s*Things didn['’]t go as planned\.{3}\s*$/,
    suggestion: REWRITE_AS_PROSE,
  },
  {
    label: 'encounter fallback: generic victory stake',
    pattern: /^\s*Complete the objective successfully\.?\s*$/i,
    suggestion: REWRITE_AS_PROSE,
  },
  {
    label: 'encounter fallback: generic defeat stake',
    pattern: /^\s*Face the consequences of failure\.?\s*$/i,
    suggestion: REWRITE_AS_PROSE,
  },
  {
    label: 'encounter fallback: victory outcome template',
    pattern: /\bThe pressure eases, and the protagonist carries the moment forward\b/i,
    suggestion: REWRITE_AS_PROSE,
  },
  {
    label: 'encounter fallback: partial-victory outcome template',
    pattern: /\bThe protagonist gets through, but relief arrives with a complication still attached\b/i,
    suggestion: REWRITE_AS_PROSE,
  },
  {
    label: 'encounter fallback: defeat outcome template',
    pattern: /\bThe moment slips away, leaving the protagonist to carry what it taught them\b/i,
    suggestion: REWRITE_AS_PROSE,
  },
  {
    label: 'encounter fallback: escape outcome template',
    pattern: /\bThe protagonist gets clear, but the fear follows close behind\b/i,
    suggestion: REWRITE_AS_PROSE,
  },
  {
    label: 'encounter fallback: cost immediate-effect template',
    pattern: /\bThe win leaves something unsettled that follows the protagonist forward\b/i,
    suggestion: REWRITE_AS_PROSE,
  },
  {
    label: 'encounter fallback: cost complication template',
    pattern: /^\s*Relief arrives with a complication still attached\.?\s*$/i,
    suggestion: REWRITE_AS_PROSE,
  },
  {
    label: 'encounter fallback: aftermath complication template',
    pattern: /\bThe aftermath stays complicated in a way the next scene will remember\b/i,
    suggestion: REWRITE_AS_PROSE,
  },

  // ── readerTextFallbacks deterministic choice-set strings (registered 2026-07-04) ──
  // createFallbackChoiceSet / buildBranchFallbackChoiceSet fire only after
  // ChoiceAuthor failed 3 attempts + per-target branch regen. Their output is
  // a structural placeholder: registering the strings here guarantees the
  // final contract blocks and the LLM repair loop re-authors them, so a
  // deterministic choice set can never ship silently.
  {
    label: 'fallback choice: generic act option',
    pattern: /^\s*Act before the moment closes\.?\s*$/i,
    suggestion: 'Re-author this choice with ChoiceAuthor: the option label is the deterministic fallback template, not an authored choice.',
  },
  {
    label: 'fallback choice: generic wait option',
    pattern: /^\s*Wait long enough to read the danger\.?\s*$/i,
    suggestion: 'Re-author this choice with ChoiceAuthor: the option label is the deterministic fallback template, not an authored choice.',
  },
  {
    label: 'fallback choice: generic ask option',
    pattern: /^\s*Ask what is really at stake\.?\s*$/i,
    suggestion: 'Re-author this choice with ChoiceAuthor: the option label is the deterministic fallback template, not an authored choice.',
  },
  // NOTE: the templated fallback options ("Respond to <anchor>", "Hold back
  // and study <anchor>", "Press for the truth behind <anchor>") are NOT
  // registered — their shape is indistinguishable from legitimately authored
  // choice text, so blocking on them would false-positive. The fallback choice
  // set is still reliably detected through its reaction text, outcome-tier
  // suffixes (choiceTextFallbacks.ts), and the static labels above.
  {
    label: 'fallback choice: reaction template',
    pattern: /\bThe choice changes the room['’]s next silence\b/i,
    suggestion: REWRITE_AS_PROSE,
  },
  {
    label: 'fallback choice: residue echo instruction',
    pattern: /\bThe scene should echo this as an immediate tonal residue\b/i,
    suggestion: 'This is an authoring instruction, not fiction — replace with in-world residue prose.',
  },
  {
    label: 'fallback stakes: generic want',
    pattern: /^\s*Change what can happen next\.?\s*$/i,
    suggestion: REWRITE_AS_PROSE,
  },
  {
    label: 'fallback stakes: generic cost',
    pattern: /^\s*The choice gives up one kind of safety to claim another\.?\s*$/i,
    suggestion: REWRITE_AS_PROSE,
  },
  {
    label: 'fallback stakes: generic identity',
    pattern: /^\s*The choice reveals what the protagonist is becoming under pressure\.?\s*$/i,
    suggestion: REWRITE_AS_PROSE,
  },
  {
    label: 'fallback reminder: tone-of-scene template',
    pattern: /^\s*The decision changes the tone of the scene\.?\s*$/i,
    suggestion: REWRITE_AS_PROSE,
  },
  {
    label: 'fallback residue: visible-residue-in-scene template',
    pattern: /^\s*The choice leaves visible residue(?: in the scene)?\.?\s*$/i,
    suggestion: REWRITE_AS_PROSE,
  },
  {
    label: 'fallback residue: carries-into-next-scene template',
    pattern: /^\s*The residue carries into the next scene\.?\s*$/i,
    suggestion: REWRITE_AS_PROSE,
  },
  {
    label: 'fallback prose: story-pressure template',
    pattern: /^\s*The story pressure changes(?: what can happen next)?\.?\s*$/i,
    suggestion: REWRITE_AS_PROSE,
  },
  {
    label: 'fallback prose: pressure-changes-shape template',
    pattern: /^\s*The pressure changes shape\.?\s*$/i,
    suggestion: REWRITE_AS_PROSE,
  },
  {
    label: 'assembly sanitizer: beat prose needs re-author placeholder',
    pattern: /^\s*The moment still needs authored prose before it can continue\.?\s*$/i,
    suggestion: REWRITE_AS_PROSE,
  },
  {
    label: 'coverage scaffold: track the visible consequence',
    pattern: /\bTrack\s+the\s+visible\s+consequence\s+of\b/i,
    suggestion: REWRITE_AS_PROSE,
  },
  {
    label: 'coverage scaffold: SequenceDirector preserve',
    pattern: /\bSequenceDirector:\s*preserve\b/i,
    suggestion: REWRITE_AS_PROSE,
  },
  // NOT registered: the beat-METADATA defaults from sanitizeSceneContentForReader
  // ("The protagonist absorbs the consequence.", "The relationship pressure
  // changes.", "The situation pressure changes.") land only in emotionalRead /
  // relationshipDynamic — agent/image-facing context fields, not reader prose.
  // Deterministic defaults are allowed for metadata; blocking them would fail
  // most normal runs. If those strings ever start reaching reader-visible
  // fields, register them then.
];
