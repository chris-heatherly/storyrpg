/**
 * Generate-to-satisfy construction constraints (R2.5).
 * Planning prompts and ESC elaboration must satisfy ownership/evidence up front
 * so drift is prevented rather than only detected downstream.
 */

/** Static planner instruction block — LLMs write; this only lists hard criteria. */
export function buildGenerateToSatisfyPlannerBlock(): string {
  return [
    'GENERATE-TO-SATISFY (construction constraints — do not narrate these as prose):',
    '- Every scene owns exactly one primary dramatic turn and one NarrativeRealizationTask owner per route event.',
    '- Required semantic premises must be dramatizable in second-person fiction (no pronoun-sheet / pure-interiority obligations).',
    '- Forbidden literal stems must not contradict required semantic stems in the same scene.',
    '- For authored_lite: elaborate the frozen Episode Spine Contract; never reorder spineUnitId or invent topology.',
    '- Choice fanout and encounter set-pieces must be planned in the blueprint fields that SceneWriter/EncounterArchitect consume — do not leave them as soft intent only.',
  ].join('\n');
}

/** ESC elaboration reminder — patch onto frozen spine; never rewrite spine order. */
export function buildEscElaborationPatchConstraint(): string {
  return [
    'ESC ELABORATION PATCH RULE:',
    '- Treat spineUnitId order as frozen.',
    '- You may deepen description, ownership labels, evidence targets, and choice/encounter setup fields.',
    '- You may not invent new spine units, delete units, or reorder the contract to dodge a gate.',
  ].join('\n');
}
