/**
 * Reconvergence residue by construction (CONSISTENCY_PLAN WS2a).
 *
 * THE #1 ARCHIVED-RUN KILLER: 16 runs died on "Reconverged branch target <id> has
 * no conditional text, callback hook, or onShow residue to acknowledge the branch
 * path" — the SceneGraphBranchValidator detects missing residue AFTER all prose is
 * authored and the pipeline aborts the whole run. Detection without authoring/repair
 * converts a craft gap into a zero-output run.
 *
 * This module makes residue exist BY CONSTRUCTION instead of being hunted at
 * validation time, in three layers:
 *
 *   1. PLANNING — {@link attachResidueRequirements} stamps a structured
 *      {@link ResidueRequirement} onto every scene blueprint that is a planned
 *      reconvergence target (≥2 distinct incoming planned paths, or a
 *      BranchManager reconvergence point). SceneWriter renders it as a MANDATORY
 *      deliverable ({@link buildResidueRequirementPromptSection}).
 *   2. REPAIR — when the validator still finds missing residue, the pipeline runs
 *      ONE targeted SceneCritic regen per offending scene with
 *      {@link buildResidueRepairDirectorNotes} injected
 *      (see remediation/reconvergenceResidueRepair.ts).
 *   3. DEGRADE — unrepaired residue findings are downgraded to advisory warnings
 *      ({@link degradeMissingResidueIssues}) so the story SHIPS with a recorded
 *      warning rather than aborting (gate: GATE_RECONVERGENCE_RESIDUE_REPAIR).
 *
 * Pure: no LLM, no I/O, no wall-clock. All shapes are structural so the module has
 * no imports from agents/ (SceneWriter and StoryArchitect import the
 * {@link ResidueRequirement} type from here without creating a cycle).
 */

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * A structured, planning-time requirement attached to a reconvergence-target
 * scene's blueprint: "this scene is reached from multiple paths; it MUST
 * acknowledge the path taken".
 */
export interface ResidueRequirement {
  sceneId: string;
  /** Scene ids of the distinct planned paths that land on this scene. */
  reconvergedFrom: string[];
  /**
   * The residue channel the writer should use. `conditionalText` (flag-gated
   * textVariants) is the canonical channel — it is also the only one the
   * SceneCritic repair pass can merge back (`applyRewrittenBeatsToSceneContents`
   * merges text + textVariants only). `onShow` / `callbackHook` are accepted
   * alternates that the validator also credits.
   */
  expectedResidue: 'conditionalText' | 'onShow' | 'callbackHook';
  /**
   * Candidate flags that distinguish the incoming paths (deterministically known
   * at plan time: treatment seeds / branch axes the incoming choice points must
   * set). May be empty — the prompt then directs the writer to key variants on
   * the episode's Relevant State Context flags instead.
   */
  gatingFlags: string[];
  /** Human-readable one-liners describing each incoming path (for the prompt). */
  pathSummaries: string[];
  /** BranchManager's suggested narrative acknowledgment, when one was planned. */
  acknowledgmentHint?: string;
}

// Structural blueprint shapes (subset of StoryArchitect's SceneBlueprint /
// EpisodeBlueprint — kept structural so this module imports nothing from agents/).
export interface ResidueBlueprintSceneLike {
  id: string;
  name?: string;
  description?: string;
  leadsTo?: string[];
  isEncounter?: boolean;
  choicePoint?: {
    description?: string;
    setsTreatmentSeeds?: string[];
    setsBranchAxes?: string[];
  };
  residueRequirement?: ResidueRequirement;
}

export interface ResidueBlueprintLike {
  scenes: ResidueBlueprintSceneLike[];
}

export interface ResidueBranchAnalysisLike {
  reconvergencePoints?: Array<{
    sceneId: string;
    incomingBranches?: string[];
    narrativeAcknowledgment?: string;
    stateReconciliation?: Array<{ stateVariable?: string; howToHandle?: string }>;
  }>;
}

// Structural validation-result shapes (subset of SceneGraphBranchValidationResult).
export interface ResidueIssueLike {
  type: string;
  severity: 'error' | 'warning';
  message: string;
  sceneId?: string;
  targetSceneId?: string;
}

export interface ResidueValidationResultLike {
  valid: boolean;
  issues: ResidueIssueLike[];
}

const MISSING_RESIDUE_TYPE = 'missing_branch_residue';

// ── Planning-time derivation ───────────────────────────────────────────────────

/**
 * Derive the residue requirements for an episode blueprint: every non-encounter
 * scene with ≥2 distinct incoming `leadsTo` sources (the same planned-graph signal
 * the pipeline later uses to set `isConvergencePoint`, which is what the validator
 * keys missing_branch_residue on), plus any BranchManager reconvergence point.
 *
 * Encounter scenes are skipped: the validator credits a genuinely-branched
 * encounter (≥2 outcomes/storylets) as path-reactive by construction, and their
 * content is authored by EncounterArchitect, not SceneWriter.
 */
export function deriveResidueRequirements(
  blueprint: ResidueBlueprintLike,
  branchAnalysis?: ResidueBranchAnalysisLike,
): ResidueRequirement[] {
  const scenes = blueprint.scenes || [];
  const byId = new Map(scenes.map((scene) => [scene.id, scene]));
  const incomingByTarget = new Map<string, Set<string>>();
  for (const scene of scenes) {
    for (const targetId of new Set(scene.leadsTo || [])) {
      if (targetId === scene.id || !byId.has(targetId)) continue;
      const sources = incomingByTarget.get(targetId) || new Set<string>();
      sources.add(scene.id);
      incomingByTarget.set(targetId, sources);
    }
  }

  const reconvByScene = new Map(
    (branchAnalysis?.reconvergencePoints || []).map((point) => [point.sceneId, point]),
  );

  const requirements: ResidueRequirement[] = [];
  for (const scene of scenes) {
    if (scene.isEncounter) continue;
    const sources = [...(incomingByTarget.get(scene.id) || [])];
    const reconv = reconvByScene.get(scene.id);
    if (sources.length < 2 && !reconv) continue;

    const gatingFlags = new Set<string>();
    const pathSummaries: string[] = [];
    for (const sourceId of sources) {
      const source = byId.get(sourceId);
      if (!source) continue;
      for (const flag of source.choicePoint?.setsTreatmentSeeds || []) gatingFlags.add(flag);
      for (const flag of source.choicePoint?.setsBranchAxes || []) gatingFlags.add(flag);
      const summary = source.choicePoint?.description || source.description || '';
      pathSummaries.push(
        `${sourceId}${source.name ? ` ("${source.name}")` : ''}${summary ? `: ${truncate(summary, 160)}` : ''}`,
      );
    }
    for (const note of reconv?.stateReconciliation || []) {
      if (note?.stateVariable || note?.howToHandle) {
        pathSummaries.push(`state: ${[note.stateVariable, note.howToHandle].filter(Boolean).join(' — ')}`);
      }
    }

    requirements.push({
      sceneId: scene.id,
      reconvergedFrom: sources.length > 0 ? sources : reconv?.incomingBranches || [],
      expectedResidue: 'conditionalText',
      gatingFlags: [...gatingFlags],
      pathSummaries,
      acknowledgmentHint: reconv?.narrativeAcknowledgment,
    });
  }
  return requirements;
}

/**
 * Stamp the derived requirements onto the blueprint's scenes
 * (`scene.residueRequirement`) so they ride the existing SceneBlueprint flow into
 * the SceneWriter prompt. Returns the number of scenes stamped. Mutates in place
 * (like the rest of the blueprint-normalization path); idempotent.
 */
export function attachResidueRequirements(
  blueprint: ResidueBlueprintLike,
  branchAnalysis?: ResidueBranchAnalysisLike,
): number {
  const requirements = deriveResidueRequirements(blueprint, branchAnalysis);
  const byScene = new Map(requirements.map((req) => [req.sceneId, req]));
  let stamped = 0;
  for (const scene of blueprint.scenes || []) {
    const requirement = byScene.get(scene.id);
    if (!requirement) continue;
    scene.residueRequirement = requirement;
    stamped += 1;
  }
  return stamped;
}

// ── Prompt rendering (SceneWriter mandatory-deliverable section) ──────────────

/**
 * Render the requirement as a mandatory SceneWriter prompt section (same pattern
 * as the POST-ENCOUNTER OUTCOME REACTIVITY / treatment-anchor injections).
 * Returns '' when there is no requirement, leaving the prompt byte-identical.
 */
export function buildResidueRequirementPromptSection(requirement?: ResidueRequirement): string {
  if (!requirement) return '';
  const from = requirement.reconvergedFrom.length > 0
    ? requirement.reconvergedFrom.join(', ')
    : 'multiple branch paths';
  const lines: string[] = [
    '',
    '## RECONVERGENCE RESIDUE (MANDATORY — validator-enforced, the run fails without it)',
    `This scene is reached from MULTIPLE story paths (${from}). Players arrive here having made different choices, and the prose MUST acknowledge the path taken — identical text on every path is a validation failure.`,
    '- Author at least one textVariant on an EARLY beat whose condition keys on a flag that distinguishes the incoming paths. The base text must read correctly on every path; the variants carry the path-specific residue (a wound, a debt, a witness, a changed relationship).',
  ];
  if (requirement.gatingFlags.length > 0) {
    lines.push(`- Key the conditions on these flags set by the incoming branch choices: ${requirement.gatingFlags.map((flag) => `\`${flag}\``).join(', ')}.`);
  } else {
    lines.push('- Key the conditions on flags from the Relevant State Context above (or a relationship/score condition) that the incoming branch choices change.');
  }
  if (requirement.pathSummaries.length > 0) {
    lines.push('- Incoming paths to acknowledge:');
    for (const summary of requirement.pathSummaries) lines.push(`  - ${summary}`);
  }
  if (requirement.acknowledgmentHint) {
    lines.push(`- Suggested acknowledgment: "${requirement.acknowledgmentHint}"`);
  }
  lines.push('- Acceptable alternate channels if conditional text truly cannot work here: an `onShow` consequence on an early beat, or a TextVariant carrying a `callbackHookId`.');
  lines.push('');
  return lines.join('\n');
}

// ── Validation-result helpers (repair/degrade) ─────────────────────────────────

/** Scene ids carrying an ERROR-severity missing_branch_residue finding. */
export function missingResidueSceneIds(result: ResidueValidationResultLike): string[] {
  const ids = new Set<string>();
  for (const issue of result.issues || []) {
    if (issue.type !== MISSING_RESIDUE_TYPE || issue.severity !== 'error') continue;
    const sceneId = issue.targetSceneId || issue.sceneId;
    if (sceneId) ids.add(sceneId);
  }
  return [...ids];
}

/** Whether the result contains any ERROR-severity missing-residue finding. */
export function hasMissingResidueFindings(result: ResidueValidationResultLike): boolean {
  return missingResidueSceneIds(result).length > 0;
}

/**
 * Degrade unrepaired missing-residue ERRORS to advisory WARNINGS and recompute
 * `valid` from the remaining errors — the "ship with a recorded warning, never
 * abort" terminal state. Non-residue errors are untouched (they still block).
 * Returns a NEW result object (the input is not mutated) plus the downgraded
 * issues so the caller can emit/ledger them.
 */
export function degradeMissingResidueIssues<T extends ResidueValidationResultLike>(
  result: T,
): { result: T; downgraded: ResidueIssueLike[] } {
  const downgraded: ResidueIssueLike[] = [];
  const issues = (result.issues || []).map((issue) => {
    if (issue.type !== MISSING_RESIDUE_TYPE || issue.severity !== 'error') return issue;
    const advisory = { ...issue, severity: 'warning' as const };
    downgraded.push(advisory);
    return advisory;
  });
  if (downgraded.length === 0) return { result, downgraded };
  const valid = !issues.some((issue) => issue.severity === 'error');
  return { result: { ...result, issues, valid }, downgraded };
}

// ── Repair-time directive (assembled-episode view) ─────────────────────────────

// Structural assembled-scene shape (subset of src/types Scene).
export interface ResidueEpisodeSceneLike {
  id: string;
  name?: string;
  leadsTo?: string[];
  beats?: Array<{
    id?: string;
    nextSceneId?: string;
    choices?: Array<{
      id?: string;
      text?: string;
      nextSceneId?: string;
      nextBeatId?: string;
      consequences?: Array<{ type?: string; flag?: string }>;
    }>;
  }>;
  encounter?: {
    id?: string;
    outcomes?: Record<string, { nextSceneId?: string } | null | undefined>;
  };
}

export interface ResidueRepairDirective {
  reconvergedFrom: string[];
  gatingFlags: string[];
  pathSummaries: string[];
}

/**
 * Derive the repair-time residue directive from the ASSEMBLED episode: which
 * scenes/choices actually route into the target, and which real, already-authored
 * flags (setFlag consequences on those routing choices) distinguish the paths.
 * This is more precise than the planning-time requirement because at repair time
 * the choices exist.
 */
export function deriveEpisodeResidueDirective(
  scenes: ResidueEpisodeSceneLike[],
  targetSceneId: string,
): ResidueRepairDirective {
  const sources = new Set<string>();
  const gatingFlags = new Set<string>();
  const pathSummaries: string[] = [];
  for (const scene of scenes || []) {
    if (scene.id === targetSceneId) continue;
    let routes = false;
    if (scene.leadsTo?.includes(targetSceneId)) routes = true;
    for (const beat of scene.beats || []) {
      if (beat.nextSceneId === targetSceneId) routes = true;
      for (const choice of beat.choices || []) {
        const bridgeTarget = choice.nextBeatId
          ? (scene.beats || []).find((candidate) => candidate.id === choice.nextBeatId)?.nextSceneId
          : undefined;
        if ((choice.nextSceneId || bridgeTarget) !== targetSceneId) continue;
        routes = true;
        const flags = (choice.consequences || [])
          .filter((consequence) => consequence?.type === 'setFlag' && consequence.flag)
          .map((consequence) => consequence.flag as string);
        for (const flag of flags) gatingFlags.add(flag);
        pathSummaries.push(
          `from ${scene.id}${scene.name ? ` ("${scene.name}")` : ''} via choice "${truncate(choice.text || choice.id || '', 120)}"${flags.length > 0 ? ` (sets: ${flags.join(', ')})` : ''}`,
        );
      }
    }
    for (const [outcome, target] of Object.entries(scene.encounter?.outcomes || {})) {
      if (target?.nextSceneId === targetSceneId) {
        routes = true;
        const encounterId = scene.encounter?.id || scene.id;
        const flag = `encounter_${encounterId}_${outcome}`;
        gatingFlags.add(flag);
        pathSummaries.push(`from encounter ${encounterId} on outcome "${outcome}" (flag: ${flag})`);
      }
    }
    if (routes) sources.add(scene.id);
  }
  return { reconvergedFrom: [...sources], gatingFlags: [...gatingFlags], pathSummaries };
}

/**
 * Director notes for the ONE targeted SceneCritic regen of a residue-less
 * reconvergence scene: an explicit, surgical instruction to ADD flag-gated
 * textVariants on an early beat, preserving everything else.
 */
export function buildResidueRepairDirectorNotes(
  sceneId: string,
  directive: ResidueRepairDirective,
  requirement?: ResidueRequirement,
): string {
  const gatingFlags = [...new Set([...(directive.gatingFlags || []), ...(requirement?.gatingFlags || [])])];
  const pathSummaries = directive.pathSummaries.length > 0
    ? directive.pathSummaries
    : requirement?.pathSummaries || [];
  const lines: string[] = [
    `RECONVERGENCE RESIDUE REPAIR for scene ${sceneId} (validator-enforced).`,
    'This scene is reached from multiple story paths, but its prose reads identically on every path. Fix it surgically:',
    '- ADD at least one `textVariants` entry to the FLAGGED (earliest) beat. Each variant: { "condition": { "type": "flag", "flag": "<flag>", "value": true }, "text": "<one or two sentences of path-specific residue prose>" }.',
    '- Keep the beat\'s base `text` true on every path; the variants carry the path-specific acknowledgment (a wound, a debt, a witness, a changed relationship).',
    '- Do NOT change beat ids, navigation, choices, or any other beat. Return the flagged beat (with its existing text plus the new textVariants) in `rewrittenBeats`.',
  ];
  if (gatingFlags.length > 0) {
    lines.push(`- Use ONLY these existing flags (set by the incoming branch choices): ${gatingFlags.map((flag) => `\`${flag}\``).join(', ')}. Do not invent new flags.`);
  } else {
    lines.push('- Gate each variant on a flag named after its incoming path/choice; prefer flags the incoming choices already set.');
  }
  if (pathSummaries.length > 0) {
    lines.push('- Incoming paths to acknowledge:');
    for (const summary of pathSummaries) lines.push(`  - ${summary}`);
  }
  if (requirement?.acknowledgmentHint) {
    lines.push(`- Planned acknowledgment: "${requirement.acknowledgmentHint}"`);
  }
  return lines.join('\n');
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}
