/**
 * Earned-bond preflight (B3, quality-gap analysis 2026-07-16).
 *
 * Run 16-30-16: "Scene s1-4 claims an earned bond for subject dusk-club at
 * 'name' without visible callback/payoff language" — the plan asked for a
 * friend-tier bond in one scene without staging anything that earns it, so
 * the prose declared the bond and the final-contract ledger flagged it after
 * the fact. This preflight catches the shape at PLAN time: a stage jump to
 * friend+ inside one scene must be accompanied by a dramatized earning path —
 * a social_test behavioral intent, a compiled milestone test path, or a
 * relationship choice owned by the scene.
 *
 * ADVISORY: plan-shape check only (stage ranks + planned markers) — never a
 * prose judgment and never gate input; the relationship-arc ledger remains
 * the on-page ruler at final contract.
 */

const STAGE_RANK: Record<string, number> = {
  unmet: 0,
  noticed: 1,
  spark: 2,
  acquaintance: 3,
  tentative_ally: 4,
  friend: 5,
  trusted_ally: 6,
  intimate: 7,
};

export interface EarnedBondScene {
  id: string;
  hasChoice?: boolean;
  choiceType?: string;
  behavioralIntents?: Array<{ kind?: string; intentKind?: string }>;
  relationshipPacing?: Array<{
    npcId?: string;
    groupId?: string;
    startStage: string;
    targetStage: string;
    requiredEvidence?: string[];
    milestone?: { testSceneIds?: string[] };
  }>;
}

export interface EarnedBondFinding {
  sceneId: string;
  subject: string;
  startStage: string;
  targetStage: string;
  message: string;
}

export function auditEarnedBonds(scenes: ReadonlyArray<EarnedBondScene>): EarnedBondFinding[] {
  const findings: EarnedBondFinding[] = [];
  for (const scene of scenes) {
    for (const pacing of scene.relationshipPacing ?? []) {
      const startRank = STAGE_RANK[pacing.startStage] ?? 0;
      const targetRank = STAGE_RANK[pacing.targetStage] ?? 0;
      if (targetRank < STAGE_RANK.friend || targetRank - startRank < 2) continue;
      const hasMilestoneTestPath = (pacing.milestone?.testSceneIds?.length ?? 0) > 0;
      const hasSocialTestIntent = (scene.behavioralIntents ?? []).some(
        (intent) => (intent.intentKind ?? intent.kind) === 'social_test',
      );
      const hasRelationshipChoice = Boolean(scene.hasChoice) && scene.choiceType === 'relationship';
      if (hasMilestoneTestPath || hasSocialTestIntent || hasRelationshipChoice) continue;
      const subject = pacing.npcId ?? pacing.groupId ?? 'unknown-subject';
      findings.push({
        sceneId: scene.id,
        subject,
        startStage: pacing.startStage,
        targetStage: pacing.targetStage,
        message: `Scene ${scene.id} is planned to advance ${subject} from "${pacing.startStage}" to "${pacing.targetStage}" within one scene, but the plan stages no earning path (no social_test intent, no milestone test path, no relationship choice) — the bond will read as declared, not earned.`,
      });
    }
  }
  return findings;
}

const STAGE_BY_RANK: Record<number, string> = Object.fromEntries(
  Object.entries(STAGE_RANK).map(([stage, rank]) => [rank, stage]),
);

export interface EarnedBondAutofixScene {
  id: string;
  relationshipPacing?: Array<{
    npcId?: string;
    groupId?: string;
    startStage: string;
    targetStage: string;
  }>;
}

/**
 * B3 autofix (r115 gap analysis, 2026-07-18): a scene planned to advance a
 * bond 2+ stages to friend+ with no staged earning path clamps the jump down
 * to the highest rank achievable in one scene without one — the audit's own
 * threshold (`targetRank - startRank < 2` is fine unaccompanied) says a
 * single-rank advance never needs a dramatized earning path, so that's the
 * ceiling. Deterministic plan-metadata edit only — no prose is authored; the
 * scene simply stops claiming a bigger leap than it stages. Same shape as
 * the C1 cast-order autofix: mutate the REAL blueprint scenes (the audit ran
 * on copies), matched back by sceneId + subject.
 */
export function applyEarnedBondAutofix(
  findings: ReadonlyArray<EarnedBondFinding>,
  scenes: ReadonlyArray<EarnedBondAutofixScene>,
): EarnedBondFinding[] {
  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
  const applied: EarnedBondFinding[] = [];
  for (const finding of findings) {
    const scene = sceneById.get(finding.sceneId);
    const pacing = scene?.relationshipPacing?.find(
      (candidate) => (candidate.npcId ?? candidate.groupId ?? 'unknown-subject') === finding.subject
        && candidate.startStage === finding.startStage
        && candidate.targetStage === finding.targetStage,
    );
    if (!pacing) continue;
    const startRank = STAGE_RANK[pacing.startStage] ?? 0;
    const clampedStage = STAGE_BY_RANK[startRank + 1];
    if (!clampedStage || clampedStage === pacing.targetStage) continue;
    pacing.targetStage = clampedStage;
    applied.push(finding);
  }
  return applied;
}
