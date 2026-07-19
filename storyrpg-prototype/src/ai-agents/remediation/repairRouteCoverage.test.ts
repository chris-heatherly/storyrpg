/**
 * Repair-route coverage invariant (R3 + R5 of the 2026-07-06 reliability plan).
 *
 * POLICY: every craft-finding class that can BLOCK the final contract must
 * route to an actionable repair directive — never `diagnostic_stop`. A
 * diagnostic_stop on a blocking class means the repair loop cannot touch the
 * finding AND (via the architecture guard) withholds LLM repair from every
 * other finding in the same report, so a single unroutable finding aborts an
 * otherwise-repairable run. Three separate postmortems trace to exactly this
 * shape (outcome-stub starvation 2026-07-03, restage+tense abort 2026-07-05,
 * encounter-cost abort 2026-07-06).
 *
 * R5 extension: the second half of this file enumerates EVERY default-on
 * blocking gate in gateRegistry.ts and pins where its representative blocking
 * issue lands:
 *   - FINAL_GATE_ROUTES        — routes to an actionable directive (never
 *                                diagnostic_stop). blueprint_rebalance /
 *                                episode_replan entries are honest
 *                                architecture classifications: unrepairable at
 *                                the final contract but explicitly classified,
 *                                with the earlier-placement enforcement noted.
 *   - DIAGNOSTIC_STOP_ALLOWLIST — the (rare) classes where diagnostic_stop is
 *                                genuinely intended, each with a rationale.
 *   - ENFORCED_BEFORE_FINAL_REPAIR — season-final-registered gates whose
 *                                enforcement throws BEFORE the final-contract
 *                                repair loop, so their findings never enter
 *                                the router.
 * Gates whose placement is plan/scene/episode with no season-final audit
 * dispatch are exempt (blocking there is cheap fail-fast before the expensive
 * final-contract abort shape exists).
 *
 * When a new blocking class is added to a final-contract validator, add it
 * here WITH its repair route. If this test fails, wire a router rule and a
 * repair handler — do not delete the case.
 */

import { describe, expect, it } from 'vitest';
import { GateRepairRouter, type RepairDirectiveKind } from './gateRepairRouter';
import { GATE_REGISTRY, type GateSpec } from './gateRegistry';
import { buildEncounterMetadataRepairHandler } from './encounterMetadataRepairHandler';
import { buildEncounterRouteRepairHandler } from './encounterRouteRepairHandler';
import { buildChoiceResolutionRepairHandler } from './choiceResolutionRepairHandler';
import {
  buildSceneClusterRepairHandler,
  isSceneClusterRepairableIssue,
  isSceneProseRepairableIssue,
  selectSceneProseRepairs,
} from './sceneProseRepairHandler';
import { isTenseDriftIssue } from './tenseDriftRepairHandler';
import { VALIDATOR_REGISTRY } from '../validators/validatorRegistry';
import { validateEncounterProducerOutput } from '../pipeline/producerBlockerChecks';
import type { FinalStoryContractIssueType } from '../validators/FinalStoryContractValidator';
import type { Story } from '../../types/story';

interface BlockingClassCase {
  name: string;
  issue: {
    validator: string;
    type?: string;
    severity?: string;
    message?: string;
    suggestion?: string;
    sceneId?: string;
    beatId?: string;
    episodeNumber?: number;
    repairHandler?: string;
  };
}

/**
 * The known blocking craft-finding classes at the final contract, as the
 * repair loop sees them (validator + type + a representative message).
 */
const BLOCKING_CLASSES: BlockingClassCase[] = [
  {
    name: 'deterministic fallback prose in reader-facing text (syntheticFallbackProse registry)',
    issue: {
      validator: 'RouteContinuityValidator',
      type: 'unsafe_fallback_prose',
      severity: 'error',
      message: 'Unsafe fallback/planning prose survived in scene:s1-1.encounterMeta[3]: "Relief arrives with a complication still attached."',
      sceneId: 's1-1',
      episodeNumber: 1,
    },
  },
  {
    name: 'duplicate-event restage of an owned story event',
    issue: {
      validator: 'RouteContinuityValidator',
      type: 'route_duplicate_event',
      severity: 'error',
      message: 'Scene s1-6 restages the threatEncounter owned by s1-3; rewrite the later scene as consequence or memory.',
      sceneId: 's1-6',
      episodeNumber: 1,
    },
  },
  {
    name: 'encounter template collapse (build degraded to deterministic filler)',
    issue: {
      validator: 'EncounterQualityValidator',
      type: 'encounter_template_collapse',
      severity: 'error',
      message: 'Encounter in scene "treatment-enc-1-1" ships generic template prose (matched 2 fallback signature(s)).',
      sceneId: 'treatment-enc-1-1',
      episodeNumber: 1,
    },
  },
  {
    name: 'malformed second-person encounter prose',
    issue: {
      validator: 'EncounterQualityValidator',
      type: 'encounter_malformed_prose',
      severity: 'error',
      message: 'Encounter in scene "treatment-enc-1-1" contains malformed second-person prose (you rooftop).',
      sceneId: 'treatment-enc-1-1',
      episodeNumber: 1,
    },
  },
  {
    name: 'opening beat missing player POV anchor',
    issue: {
      validator: 'PovClarityValidator',
      type: 'pov_anchor_missing',
      severity: 'error',
      message: 'Scene "s1-1" opens without anchoring the player character.',
      sceneId: 's1-1',
      episodeNumber: 1,
    },
  },
  {
    name: 'ambiguous protagonist-pronoun residue',
    issue: {
      validator: 'protagonistPronounResolver',
      type: 'ambiguous_protagonist_pronoun',
      severity: 'error',
      message: 'Scene "s1-4" has ambiguous wrong-gender pronoun residue with no second-person anchor.',
      sceneId: 's1-4',
      episodeNumber: 1,
    },
  },
  {
    name: 'deterministic stub outcome tier on a choice',
    issue: {
      validator: 'OutcomeTextQualityValidator',
      type: 'outcome_text_stub',
      severity: 'error',
      message: 'Choice "c-2" ships the deterministic fallback outcome text for tier partial.',
      episodeNumber: 1,
    },
  },
  {
    name: 'tense drift in live-action narration',
    issue: {
      validator: 'NarrativeFailureModeValidator',
      type: 'prose_style_violation',
      severity: 'error',
      message: 'Beat beat-s1-2-03b narrates live action in past tense.',
      sceneId: 's1-2',
      beatId: 'beat-s1-2-03b',
      episodeNumber: 1,
    },
  },
  {
    name: 'semantic realization miss from renamed SemanticRealizationJudge',
    issue: {
      validator: 'SemanticRealizationJudge',
      type: 'semantic_realization_violation',
      severity: 'error',
      message: 'Canonical realization validation confirms that task task:premise:wound is missing: premise:wound:semantic:2.',
      sceneId: 's1-1',
      episodeNumber: 1,
      repairHandler: 'premise_realization',
    },
  },
  {
    name: 'scene-localized QA critical finding',
    issue: {
      validator: 'QARunner',
      type: 'qa_blocker_present',
      severity: 'error',
      message: 'QA report did not pass: voice collapse in opening scene',
      sceneId: 's1-1',
      episodeNumber: 1,
    },
  },
];

describe('repair-route coverage for blocking final-contract classes', () => {
  const router = new GateRepairRouter({});

  for (const testCase of BLOCKING_CLASSES) {
    it(`routes "${testCase.name}" to an actionable repair (not diagnostic_stop)`, () => {
      const route = router.routeIssue(testCase.issue);
      expect(
        route.kind,
        `(${testCase.issue.validator}/${testCase.issue.type}) fell to ${route.kind}: ${route.reason}`,
      ).not.toBe('diagnostic_stop');
    });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// R5: every default-on blocking gate is enumerated and its representative
// issue routes somewhere EXPLICIT.
// ────────────────────────────────────────────────────────────────────────────

interface RoutedGateCase extends BlockingClassCase {
  /** The exact directive the router must choose. Never diagnostic_stop here. */
  expected: Exclude<RepairDirectiveKind, 'diagnostic_stop'>;
  /**
   * For blueprint_rebalance / episode_replan expectations (unrepairable at the
   * final contract): where the class IS enforced earlier, or the shift-left
   * follow-up if no earlier placement exists yet.
   */
  architectureNote?: string;
}

/**
 * Representative blocking issue(s) per default-on blocking gate that can
 * execute at season-final (placement or auditPlacements), shaped the way the
 * final-contract repair loop sees them.
 */
const FINAL_GATE_ROUTES: Record<string, RoutedGateCase[]> = {
  GATE_DESIGN_NOTE_LEAK: [{
    name: 'echo-summary/reminder line shipped as beat prose or textVariant',
    issue: {
      validator: 'FinalStoryContractValidator',
      type: 'echo_summary_variant',
      severity: 'error',
      message: 'Beat beat-2 has a textVariant whose entire text is a choice\'s echo-summary/reminder line ("You chose to open the door…") — at runtime it REPLACES the beat\'s prose with a one-line feedback cue.',
      sceneId: 'scene-1',
      beatId: 'beat-2',
      episodeNumber: 1,
    },
    expected: 'deterministic_cleanup', // buildDesignNoteLeakStripHandler
  }],
  GATE_SETUP_PAYOFF: [{
    name: 'unified obligation ledger thread debt (setup without payoff)',
    issue: {
      validator: 'ObligationLedgerValidator',
      type: 'obligation_ledger_debt',
      severity: 'error',
      message: 'Obligation ledger debt: thread "the locked archive question" opened in episode 1 never pays off on the generated route.',
      episodeNumber: 1,
    },
    expected: 'deterministic_cleanup', // buildObligationPayoffRepairHandler (auto-callback realizer)
  }],
  GATE_CALLBACK_COVERAGE: [{
    name: 'unified obligation ledger callback debt',
    issue: {
      validator: 'ObligationLedgerValidator',
      type: 'obligation_ledger_debt',
      severity: 'error',
      message: 'Obligation ledger debt: callback opportunity "the borrowed lighter" has no realized payoff variant in generated scope.',
      episodeNumber: 2,
    },
    expected: 'deterministic_cleanup',
  }],
  GATE_TREATMENT_SEED_ONPAGE: [{
    name: 'declared treatment seed flag never set by any choice',
    issue: {
      validator: 'ObligationLedgerValidator',
      type: 'obligation_ledger_debt',
      severity: 'error',
      message: 'Treatment seed "treatment_seed_blog_counter" is declared for episode 1 but no choice sets its flag.',
      episodeNumber: 1,
    },
    expected: 'blueprint_rebalance',
    architectureNote: 'Consequence architecture (a setFlag wire), not prose. Earlier placement exists: plan-time TreatmentSeedOnPageValidator fail-fast (primary placement).',
  }],
  GATE_ENCOUNTER_POV: [{
    // r115 gap analysis (2026-07-18): this fixture previously used the bare
    // `pov_break` type and expected `deterministic_cleanup` — but
    // FinalStoryContractValidator only ever emits `encounter_pov_break` for
    // encounter scenes, and the `deterministic_cleanup` classification was an
    // accident of the message text containing the word "protagonist" (a
    // fragile validator+text regex catch-all), not a real executed route —
    // no file in the pipeline dispatches on `deterministic_cleanup` at all.
    // Third/first-person narration is residue that already survived the
    // deterministic pronoun resolver; only an LLM rewrite can fix it.
    name: 'third-person protagonist narration in a second-person encounter (encounter_pov_break)',
    issue: {
      validator: 'PovClarityValidator',
      type: 'encounter_pov_break',
      severity: 'error',
      message: 'Beat narrates the protagonist in the third person ("Kylie… she…") in a second-person story — a POV break.',
      sceneId: 's1-2',
      beatId: 's1-2-b4',
      episodeNumber: 1,
    },
    expected: 'same_scene_retry',
  }],
  GATE_PROTAGONIST_PRONOUN: [{
    // Live regression: bite-me-r115_2026-07-18T04-37-51 shipped s1-1 with
    // `timeline.transitionIn` = 'The story begins as Kylie Marinescu steps
    // into her new apartment...' — full-name third-person narration in a
    // second-person story. This is the exact non-encounter counterpart of
    // the GATE_ENCOUNTER_POV case above (bare `pov_break`, not
    // `encounter_pov_break`), re-promoted to blocking after this run supplied
    // the first genuine shadow-evidence data point (see gateDefaults.ts).
    name: 'third-person protagonist narration in a second-person story (pov_break)',
    issue: {
      validator: 'PovClarityValidator',
      type: 'pov_break',
      severity: 'error',
      message: 'Scene "s1-1" narrates the protagonist in the third person in 1 place(s) — a POV break in a second-person story. e.g. "The story begins as Kylie Marinescu steps into her new apartment in Bucharest for the first time."',
      sceneId: 's1-1',
      episodeNumber: 1,
    },
    expected: 'same_scene_retry',
  }],
  GATE_POV_ANCHOR: [{
    name: 'opening beat missing player POV anchor',
    issue: {
      validator: 'PovClarityValidator',
      type: 'pov_anchor_missing',
      severity: 'error',
      message: 'Scene "s1-1" opens without anchoring the player character.',
      sceneId: 's1-1',
      episodeNumber: 1,
    },
    expected: 'same_scene_retry',
  }],
  GATE_PLANNING_REGISTER_PROSE: [{
    name: 'planning-register instruction leaked into reader-facing prose',
    issue: {
      validator: 'PlanningRegisterLeakValidator',
      type: 'planning_register_prose',
      severity: 'error',
      message: 'Planning-register instruction leaked into story content (Introduce X on-page) at episodes[0].scenes[2].beats[0]: "Introduce Stela on-page before the club invitation."',
      sceneId: 's1-3',
      beatId: 's1-3-b1',
      episodeNumber: 1,
    },
    expected: 'deterministic_cleanup',
  }],
  GATE_PROSE_STYLE_CONSISTENCY: [{
    name: 'tense drift / repetitive-motif prose-style violation',
    issue: {
      validator: 'NarrativeFailureModeValidator',
      type: 'prose_style_violation',
      severity: 'error',
      message: '[Tense drift] Beat "beat-s1-2-03b" appears to narrate live action in past tense: "Your glass clicked against theirs."',
      sceneId: 's1-2',
      beatId: 'beat-s1-2-03b',
      episodeNumber: 1,
    },
    expected: 'same_scene_retry', // deterministic tense handler + same-scene rewrite
  }],
  GATE_OUTCOME_TEXT_QUALITY: [{
    name: 'deterministic stub outcome tier on a choice',
    issue: {
      validator: 'OutcomeTextQualityValidator',
      type: 'outcome_text_stub',
      severity: 'error',
      message: 'Choice "c-2" ships the deterministic fallback outcome text for tier partial.',
      episodeNumber: 1,
    },
    expected: 'same_scene_retry', // ChoiceAuthor.reauthorOutcomeTexts
  }],
  GATE_ENCOUNTER_SETPIECE_DEPTH: [{
    name: 'sustained set piece collapsed to one phase + flat tension curve',
    issue: {
      validator: 'EncounterSetPieceDepthValidator',
      severity: 'error',
      message: 'Encounter scene "Wall Breach and Repulse" is staged as a sustained set piece but collapsed to 1 phase(s) and a 1-point tension curve — the escalation was summarized, not dramatized. Intent: "a sustained defensive set piece (wall breach + repulse)".',
      episodeNumber: 3,
    },
    expected: 'blueprint_rebalance',
    architectureNote: 'Missing encounter STRUCTURE (phases/tension curve) — no prose rewrite can add it. Earlier enforcement: EncounterArchitect sustained-set-piece beat floor at encounter build time. Shift-left follow-up: an encounter-structure repair handler (scaffold phases deterministically, LLM authors their prose).',
  }],
  GATE_REFERENCED_EVENT_PRESENCE: [{
    name: 'enumerated scene-objective clue absent from prose',
    issue: {
      validator: 'ReferencedEventPresenceValidator',
      severity: 'error',
      message: 'Scene objective enumerates "the maiden name" but the prose shows no such clue.',
      sceneId: 's1-6',
      episodeNumber: 1,
    },
    expected: 'same_scene_retry',
  }],
  GATE_REQUIRED_BEAT_REALIZATION: [{
    name: 'authored required beat missing from final prose',
    issue: {
      validator: 'RequiredBeatRealizationValidator',
      severity: 'error',
      message: 'Authored required beat is missing from the final prose of episode 2 scene s2-1: "You kiss the stranger under the archive window as the alarm fades."',
      sceneId: 's2-1',
      episodeNumber: 2,
    },
    expected: 'same_scene_retry',
  }],
  GATE_TREATMENT_SEED_REALIZATION: [{
    name: 'authored seed beat absent from its bound episode',
    issue: {
      validator: 'RequiredBeatRealizationValidator',
      severity: 'error',
      message: 'Authored seed beat is missing from the final prose of episode 1 scene s1-2: "The stray dog in the courtyard, watching."',
      sceneId: 's1-2',
      episodeNumber: 1,
    },
    expected: 'same_scene_retry',
  }],
  GATE_SCENE_TRANSITION_CONTINUITY: [{
    name: 'unacknowledged time/place jump between adjacent scenes',
    issue: {
      validator: 'SceneTransitionContinuityValidator',
      severity: 'error',
      message: 'Scene s2-3 opens at the Dusk Club with no acknowledgment of the location jump from the courtyard handoff.',
      sceneId: 's2-3',
      episodeNumber: 2,
    },
    expected: 'scene_cluster_rewrite',
  }],
  GATE_SCENE_TURN_REALIZATION: [{
    name: 'planned central turn not dramatized on-page',
    issue: {
      validator: 'SceneTurnRealizationValidator',
      severity: 'error',
      message: 'Scene "s1-4" does not dramatize its planned central turn: "Stela names the price of the invitation."',
      sceneId: 's1-4',
      episodeNumber: 1,
    },
    expected: 'scene_cluster_rewrite',
  }],
  GATE_NARRATIVE_MECHANIC_PRESSURE: [{
    name: 'hidden mechanic changes with no visible story evidence/residue',
    issue: {
      validator: 'NarrativeMechanicPressureValidator',
      severity: 'error',
      message: 'Hidden flag "victor_suspicion" changes in scene s2-2 with no visible story evidence or residue on-page.',
      sceneId: 's2-2',
      episodeNumber: 2,
    },
    expected: 'same_scene_retry',
  }],
  GATE_TREATMENT_FIELD_UTILIZATION: [{
    name: 'authored treatment field not realized in its target scene',
    issue: {
      validator: 'TreatmentFieldUtilizationValidator',
      severity: 'error',
      message: 'Character treatment field "Mika\'s guarded warmth" was planned but not realized in reader-facing story pressure: "Mika tests you with a dare at the kitchen entrance."',
      sceneId: 's1-3',
      episodeNumber: 1,
    },
    expected: 'same_scene_retry',
  }],
  GATE_SEASON_PROMISE_REALIZATION: [{
    name: 'season promise with a scene target not realized on-page',
    issue: {
      validator: 'SeasonPromiseRealizationValidator',
      severity: 'error',
      message: 'Season promise "glamorous danger" was planned but not realized as reader-facing pressure: "The rooftop bar hums with watchers while you nurse a negroni."',
      sceneId: 's1-2',
      episodeNumber: 1,
    },
    expected: 'same_scene_retry',
  }],
  GATE_CHARACTER_TREATMENT_REALIZATION: [{
    name: 'character treatment obligation with a scene target not realized on-page',
    issue: {
      validator: 'CharacterTreatmentRealizationValidator',
      severity: 'error',
      message: 'Character treatment obligation for "Victor" was planned but not realized on-page: "Victor lets the mask slip when the lights die."',
      sceneId: 's2-4',
      episodeNumber: 2,
    },
    expected: 'same_scene_retry',
  }],
  GATE_FAILURE_MODE_AUDIT_REALIZATION: [
    {
      name: 'authored failure-mode mitigation, scene-targeted',
      issue: {
        validator: 'NarrativeFailureModeValidator',
        type: 'narrative_failure_mode_violation',
        severity: 'error',
        message: 'Authored failure-mode mitigation was not realized: "The mystery box question is answered on-page." (audit contract failure-mode-mystery-box)',
        sceneId: 's3-1',
        episodeNumber: 3,
      },
      expected: 'scene_cluster_rewrite',
    },
    {
      name: 'authored failure-mode mitigation with no scene target',
      issue: {
        validator: 'NarrativeFailureModeValidator',
        type: 'narrative_failure_mode_violation',
        severity: 'error',
        message: 'Authored failure-mode mitigation was not realized anywhere in generated scope: "Escalation is earned by protagonist choice." (audit contract failure-mode-escalation-trap)',
        episodeNumber: 3,
      },
      expected: 'blueprint_rebalance',
      architectureNote: 'No scene target to rewrite. Earlier placement exists: the same contracts are checked at plan time (runPlanTimeFidelityChecks pre-generation).',
    },
  ],
  GATE_CHARACTER_INTRODUCTION: [{
    name: 'named character treated as known with no on-page introduction',
    issue: {
      validator: 'CharacterIntroductionValidator',
      severity: 'error',
      message: 'Scene "s1-3" treats "Stela" as known company with no on-page introduction.',
      sceneId: 's1-3',
      episodeNumber: 1,
    },
    expected: 'same_scene_retry',
  }],
  GATE_AUTHORED_EPISODE_CONFORMANCE: [{
    name: 'season plan drifted from the authored episode list',
    issue: {
      validator: 'AuthoredEpisodeConformanceValidator',
      severity: 'error',
      message: 'Season plan drops authored episode 5 "The Contract"; the authored episode list must be preserved.',
    },
    expected: 'blueprint_rebalance',
    architectureNote: 'Episode-list architecture in every finding shape. Earlier placement exists: plan-time fail-fast (runPlanTimeFidelityChecks); the final dispatch is a mid-run drift regression net.',
  }],
  GATE_ENCOUNTER_ANCHOR_CONTENT: [{
    name: 'encounter prose does not depict its authored central conflict',
    issue: {
      validator: 'EncounterAnchorContentValidator',
      severity: 'error',
      message: 'Encounter "treatment-enc-1-1" does not depict its central conflict: "Rough hands pin you to the tree; the man in the charcoal suit asks if you can stand."',
      sceneId: 'treatment-enc-1-1',
      episodeNumber: 1,
    },
    expected: 'same_scene_retry',
  }],
  GATE_INFORMATION_LEDGER_SCHEDULE: [
    {
      name: 'information reveal scheduled into a concrete scene but never landed',
      issue: {
        validator: 'InformationLedgerScheduleValidator',
        severity: 'error',
        message: 'Authored reveal INFO-3 is scheduled for scene s2-5 but its marker never lands in the scene\'s prose.',
        sceneId: 's2-5',
        episodeNumber: 2,
      },
      expected: 'same_scene_retry',
    },
    {
      name: 'reveal-before-setup schedule violation (no scene target)',
      issue: {
        validator: 'InformationLedgerScheduleValidator',
        severity: 'error',
        message: 'INFO "INFO-1" reveals/pays off in episode 1 before its setup in episode 2 — information movement must never precede its setup.',
        episodeNumber: 1,
      },
      expected: 'episode_replan',
      architectureNote: 'Schedule ordering is plan architecture. Earlier placement exists: plan-time fail-fast (primary placement); the final dispatch is a drift regression net.',
    },
  ],
  GATE_SIGNATURE_DEVICE_PRESENCE: [{
    name: 'authored signature staged moment absent from its scene',
    issue: {
      validator: 'SignatureDevicePresenceValidator',
      severity: 'error',
      message: 'Signature staged moment is missing from scene s1-5: "You leap from the balcony rail to catch the child mid-fall."',
      sceneId: 's1-5',
      episodeNumber: 1,
    },
    expected: 'same_scene_retry',
  }],
  GATE_SIGNATURE_PRESENCE_STRICT: [{
    name: 'authored signature device inverted/negated in prose (strict presence)',
    issue: {
      validator: 'SignatureDevicePresenceValidator',
      severity: 'error',
      message: 'Signature staged moment is inverted in scene s2-2: "You leap to catch the child" is negated by the shipped prose.',
      sceneId: 's2-2',
      episodeNumber: 2,
    },
    expected: 'same_scene_retry',
  }],
  GATE_SCENE_SPATIAL_UNIT: [{
    name: 'scene conducts meaningful action in two major locations',
    issue: {
      validator: 'SceneSpatialUnitValidator',
      severity: 'error',
      message: 'Scene "s1-4" conducts meaningful action in multiple major locations (the bookshop and the Dusk Club); a scene is one continuous place.',
      sceneId: 's1-4',
      episodeNumber: 1,
    },
    expected: 'scene_cluster_rewrite',
  }],
  GATE_RELATIONSHIP_ARC_LEDGER: [
    {
      name: 'unearned relationship label in prose (label class)',
      issue: {
        validator: 'RelationshipArcLedgerValidator',
        severity: 'error',
        message: 'Scene "s1-3" uses unearned relationship label(s): trusted ally.',
        sceneId: 's1-3',
        episodeNumber: 1,
      },
      expected: 'same_scene_retry', // deterministic label handler + style rewrite
    },
    {
      name: 'relationship delta above ledger cap (deterministic clamp)',
      issue: {
        validator: 'RelationshipArcLedgerValidator',
        severity: 'error',
        message: 'Scene "s1-3" changes char-mika-dragan.trust by 10, above the ledger cap 8 without major evidence.',
        sceneId: 's1-3',
        episodeNumber: 1,
      },
      expected: 'same_scene_retry',
    },
    {
      name: 'relationship stage reached without a player relationship choice (choice-architecture class)',
      issue: {
        validator: 'RelationshipArcLedgerValidator',
        severity: 'error',
        message: 'Relationship with "stela" reaches trusted_ally without a player relationship choice.',
        episodeNumber: 2,
      },
      expected: 'episode_replan',
      architectureNote: 'Choice/relationship architecture — must NOT be forced into prose repair. SHIFT-LEFT CANDIDATE: no plan-time check validates planned relationship-choice scheduling against pacing-contract stage targets today (pacing contracts only steer generation prompts); see the R5 report.',
    },
  ],
  GATE_THEMATIC_SQUARE_TURN: [{
    name: 'relationship value turn without deterministic thematic-square evidence',
    issue: {
      validator: 'ThematicSquareTurnValidator',
      severity: 'error',
      message: 'Relationship value turn in scene s2-6 lacks a deterministic Love→Control rung in relationshipValueEvidence.',
      sceneId: 's2-6',
      episodeNumber: 2,
    },
    expected: 'episode_replan',
    architectureNote: 'Evidence lives in choice metadata / episode structure, not any one scene\'s prose.',
  }],
  GATE_STORY_CIRCLE_ANCHOR_CONFORMANCE: [
    {
      name: 'story-circle beat drift localized to a scene',
      issue: {
        validator: 'StoryCircleAnchorConformanceValidator',
        severity: 'error',
        message: 'Authored anchor "incitingIncident" is bound to scene s1-2 but the generated scene does not stage it.',
        sceneId: 's1-2',
        episodeNumber: 1,
      },
      expected: 'same_scene_retry',
    },
    {
      name: 'season-spine beat placement drift (no scene target)',
      issue: {
        validator: 'StoryCircleAnchorConformanceValidator',
        severity: 'error',
        message: 'Episode 4 storyCircleRole "take" contradicts the authored season spine (expected "find").',
        episodeNumber: 4,
      },
      expected: 'blueprint_rebalance',
      architectureNote: 'Season-spine architecture. Earlier placement exists: plan-time fail-fast (primary placement); the final dispatch is a drift regression net.',
    },
  ],
};

/**
 * The classes where diagnostic_stop IS the intended disposition, each with a
 * written rationale. Keep this list minimal — every entry here is a class the
 * repair loop deliberately does not touch.
 */
const DIAGNOSTIC_STOP_ALLOWLIST: Record<string, { rationale: string; issue: BlockingClassCase['issue'] }> = {
  GATE_ENCOUNTER_OUTCOME_VARIANT: {
    rationale:
      'The regen route (authorEncounterOutcomeVariants + OutcomeVariantAuthor) runs BEFORE desync detection on every '
      + 'enforcement pass, so a surviving encounter_outcome_desync is residue the variant author could not cover. The '
      + 'repair is a flag-GATED textVariant on the reconvergence scene — conditioned-variant authoring is not something '
      + 'the scene-prose rewrite can do safely (it rewrites unconditioned beat prose). The finding blocks only in strict '
      + 'mode; in default mode it ships as a warning.',
    issue: {
      validator: 'encounterOutcomeFlags',
      type: 'encounter_outcome_desync',
      severity: 'error',
      message: 'Encounter treatment-enc-3-1 outcomes [success, partial_victory] reconverge into scene s3-5, which has no text conditioned on the outcome.',
      sceneId: 's3-5',
      episodeNumber: 3,
    },
  },
};

/**
 * Default-on blocking gates registered for season-final execution whose
 * enforcement THROWS before/outside the final-contract repair loop — their
 * findings never reach the router, so a routing case would be fiction. Each
 * entry documents where the gate actually enforces (and its repair half).
 */
const ENFORCED_BEFORE_FINAL_REPAIR: Record<string, string> = {
  GATE_DUPLICATE_ESTABLISHING_BEAT:
    'Enforced at episode scene-graph validation (sceneGraphValidation.ts): the deterministic dual-first-entry repair '
    + 'runs first, then the gate fail-fasts the EPISODE (cheap) — findings are never emitted into the final-contract '
    + 'repair loop.',
};

describe('R5: every default-on blocking gate has an explicit repair disposition', () => {
  const router = new GateRepairRouter({});
  const defaultOnBlocking = GATE_REGISTRY.filter((gate) => gate.kind === 'blocking' && gate.defaultOn);
  const executesAtSeasonFinal = (gate: GateSpec): boolean =>
    gate.placement === 'season-final' || (gate.auditPlacements ?? []).includes('season-final');

  it('categorizes every default-on blocking gate exactly once (no silent dead ends)', () => {
    const routed = new Set(Object.keys(FINAL_GATE_ROUTES));
    const allowlisted = new Set(Object.keys(DIAGNOSTIC_STOP_ALLOWLIST));
    const failFast = new Set(Object.keys(ENFORCED_BEFORE_FINAL_REPAIR));

    for (const gate of defaultOnBlocking) {
      const categories = [routed.has(gate.id), allowlisted.has(gate.id), failFast.has(gate.id)].filter(Boolean).length;
      if (executesAtSeasonFinal(gate)) {
        expect(
          categories,
          `${gate.id} executes at season-final but is not categorized (add a FINAL_GATE_ROUTES case with a router rule, `
          + 'or an explicit allowlist/fail-fast entry with a rationale — do not leave it to the diagnostic_stop fall-through)',
        ).toBe(1);
      } else {
        expect(
          categories,
          `${gate.id} never executes at season-final (placement=${gate.placement}); it must not appear in the season-final maps`,
        ).toBe(0);
      }
    }
  });

  it('has no stale map entries for unregistered or non-blocking gates', () => {
    const eligible = new Set(defaultOnBlocking.map((gate) => gate.id));
    for (const id of [
      ...Object.keys(FINAL_GATE_ROUTES),
      ...Object.keys(DIAGNOSTIC_STOP_ALLOWLIST),
      ...Object.keys(ENFORCED_BEFORE_FINAL_REPAIR),
    ]) {
      expect(eligible.has(id), `${id} is mapped here but is not a default-on blocking gate in GATE_REGISTRY`).toBe(true);
    }
  });

  for (const [gateId, cases] of Object.entries(FINAL_GATE_ROUTES)) {
    for (const testCase of cases) {
      it(`${gateId}: routes "${testCase.name}" to ${testCase.expected}`, () => {
        const route = router.routeIssue(testCase.issue);
        expect(
          route.kind,
          `(${testCase.issue.validator}/${testCase.issue.type ?? testCase.name}) routed to ${route.kind}: ${route.reason}`,
        ).toBe(testCase.expected);
        expect(route.kind).not.toBe('diagnostic_stop');
      });
    }
  }

  for (const [gateId, entry] of Object.entries(DIAGNOSTIC_STOP_ALLOWLIST)) {
    it(`${gateId}: diagnostic_stop is intended (allowlisted with rationale)`, () => {
      // The allowlist stays honest both ways: the rationale is written, AND the
      // route really is diagnostic_stop — if someone wires a repair route later
      // this fails so the entry moves to FINAL_GATE_ROUTES.
      expect(entry.rationale.length).toBeGreaterThanOrEqual(80);
      const route = router.routeIssue(entry.issue);
      expect(route.kind).toBe('diagnostic_stop');
    });
  }

  it('keeps the diagnostic_stop allowlist rare', () => {
    expect(Object.keys(DIAGNOSTIC_STOP_ALLOWLIST).length).toBeLessThanOrEqual(2);
  });
});

describe('executable field-owning repair coverage', () => {
  it('routes encounter.description to its owner and the registered handler clears the finding', async () => {
    const story = {
      id: 'route-coverage',
      title: 'Route Coverage',
      episodes: [{
        id: 'ep1',
        scenes: [{
          id: 's1-1',
          name: 'Threshold',
          beats: [{ id: 'b1', text: 'The latch shifts beneath your hand.' }],
          encounter: {
            description: 'You face this pressure: open the door.',
            sourceSynopsis: 'Author-only source.',
          },
        }],
      }],
    } as unknown as Story;
    const issue = {
      validator: 'RouteContinuityValidator',
      type: 'unsafe_fallback_prose',
      severity: 'error',
      sceneId: 's1-1',
      fieldPath: 'encounter.description',
      message: 'Unsafe fallback prose in encounter.description.',
    };
    const route = new GateRepairRouter({ story }).routeIssue(issue);
    expect(route.kind).toBe('same_scene_retry');
    expect(route.reason).toContain('encounter.description');

    const handler = buildEncounterMetadataRepairHandler({
      author: () => ({
        reauthorEncounterDescription: async () => 'The latch gives once, then jams as footsteps close behind you.',
      }),
    });
    const result = await handler({
      story,
      blockingIssues: [issue],
    });
    expect(result.changed).toBe(true);
    const encounter = story.episodes[0].scenes[0].encounter;
    expect(validateEncounterProducerOutput('s1-1', encounter)).toHaveLength(0);
  });
});


/**
 * CLOSURE SWEEP (Systemic Guards Plan W2.1): every blocking final-stage
 * validator in validatorRegistry must be represented in this file's routing
 * tables — BLOCKING_CLASSES, DIAGNOSTIC_STOP_ALLOWLIST,
 * ENFORCED_BEFORE_FINAL_REPAIR — or carry a written exemption below. Adding or
 * RENAMING a blocking validator without completing its routing row is the
 * exact defect class behind three production abort waves (outcome-stub
 * 2026-07-03, SemanticRealizationJudge rename 2026-07-14, prose-handler
 * allowlist starvation 2026-07-14). This sweep turns the next instance into a
 * red build instead of a dead run.
 */
const CLOSURE_SWEEP_EXEMPTIONS: Record<string, string> = {
  NarrativeContractValidator: 'Routed via the repairHandler-keyed rules shared with SemanticRealizationJudge (gateRepairRouter ~787); its classes are exercised through the judge cases above under the shared branch.',
  PromiseLedgerValidators: 'Composite promise-ledger arm enforced through Season Canon promise checks; representative issues predate the closure sweep — add routed cases when next touched.',
  CanonConsistencyValidator: 'Canon drift is enforced before the final repair loop (canon seal path); add a pre-final row or routed case when next touched.',
  MechanicsLeakageValidator: 'Design-note/mechanics leaks are handled by the deterministic strip + rewrite path (2026-06-14 remediation); add a routed case when next touched.',
  MechanicalStorytellingValidator: 'Witness-id integrity class predating the closure sweep; add a routed case when next touched.',
  SceneGraphBranchValidator: 'Branch fan-out is a structural invariant (GATE_BRANCH_FANOUT) enforced at generation time, before final repair.',
  DuplicateEstablishingBeatValidator: 'Held FP-prone and default-off since the Group A promotion review (2026-06-11); no default-ON blocking surface today.',
  TreatmentSeedOnPageValidator: 'Seed projection is repaired by applyOnPageContracts on both ChoiceAuthor paths (2026-06-13); add a routed case when next touched.',
};

/**
 * ROUTED AND CLAIMED (2026-07-15): routing metadata alone allowed a FOURTH
 * starvation — route_duplicate_event routed scene_cluster_rewrite since
 * 2026-07-05 while both prose handlers' admission lists excluded the
 * validator, so the directive was a dead end no test looked at (bite-me
 * 2026-07-15T20-44-49: the sole remaining blocker went unattempted through an
 * entire enforcement). For every case in this file whose route is an LLM
 * prose directive, at least one registered handler's REAL admission logic
 * must accept the issue. Dedicated-handler claims (choice/encounter/outcome
 * shapes) are each backed by an executable test that runs the actual handler.
 */
const LLM_PROSE_DIRECTIVES = new Set<RepairDirectiveKind>(['same_scene_retry', 'scene_cluster_rewrite']);

function llmHandlerClaims(issue: BlockingClassCase['issue']): string[] {
  const probe = issue as never;
  const extra = issue as { repairHandler?: string; outcomeTier?: string; fieldPath?: string };
  const claims: string[] = [];
  if (isSceneProseRepairableIssue(probe)) claims.push('scene_prose');
  if (isSceneClusterRepairableIssue(probe)) claims.push('scene_cluster');
  if (isTenseDriftIssue(probe)) claims.push('tense_drift_deterministic');
  if (extra.repairHandler === 'choice_reauthor') claims.push('choice_resolution');
  if (extra.repairHandler === 'encounter_route' || extra.outcomeTier) claims.push('encounter_route');
  if (issue.type === 'outcome_text_stub') claims.push('outcome_text_reauthor');
  if (
    issue.type === 'unsafe_fallback_prose'
    && /^encounter\.(?:description|phases\[\d+\]\.description)$/.test(extra.fieldPath ?? '')
  ) claims.push('encounter_metadata');
  return claims;
}

describe('routed AND claimed — every LLM prose directive has an admitting handler', () => {
  const router = new GateRepairRouter({});
  const allCases: BlockingClassCase[] = [
    ...BLOCKING_CLASSES,
    ...Object.values(FINAL_GATE_ROUTES).flat(),
  ];
  for (const testCase of allCases) {
    it(`"${testCase.name}" is admitted when routed to LLM repair`, () => {
      const route = router.routeIssue(testCase.issue);
      if (!LLM_PROSE_DIRECTIVES.has(route.kind)) return;
      const claims = llmHandlerClaims(testCase.issue);
      expect(
        claims,
        `(${testCase.issue.validator}/${testCase.issue.type ?? '-'}) routes ${route.kind} but NO handler admission accepts it — a route with no admitting handler is the same dead end as no route`,
      ).not.toEqual([]);
    });
  }
});

describe('blocking-validator closure sweep', () => {
  it('every blocking final-stage validator is routed, allowlisted, pre-final-enforced, or exempt with rationale', () => {
    const normalized = (name: string): string => name.replace(/\s*\(.*\)$/, '').trim();
    const coveredNames = new Set<string>([
      ...BLOCKING_CLASSES.map((c) => c.issue.validator),
      ...Object.values(DIAGNOSTIC_STOP_ALLOWLIST).map((entry) => entry.issue.validator),
      ...Object.values(FINAL_GATE_ROUTES).flat().map((entry) => entry.issue.validator),
    ]);
    const preFinal = new Set(Object.keys(ENFORCED_BEFORE_FINAL_REPAIR).map(normalized));
    const missing = VALIDATOR_REGISTRY
      .filter((entry) => entry.tier === 'blocking' && entry.stage === 'final')
      .map((entry) => normalized(entry.validator))
      .filter((name) => !coveredNames.has(name) && !preFinal.has(name) && !(name in CLOSURE_SWEEP_EXEMPTIONS));
    expect(missing, `Blocking final-stage validator(s) with no routing row: ${missing.join(', ')} — add a BLOCKING_CLASSES case with its repair route (or a written exemption).`).toEqual([]);
  });
});

/**
 * R6 (2026-07-18, r118 postmortem): the closure sweep above is keyed on
 * VALIDATOR NAME via VALIDATOR_REGISTRY, which has exactly one row for
 * `FinalStoryContractValidator` covering its entire native issue-type union —
 * so the sweep goes green the moment ANY one of that validator's ~35 native
 * types is exercised anywhere in this file (today that's `echo_summary_variant`
 * via GATE_DESIGN_NOTE_LEAK), while `duplicate_high_pressure_event` sat with
 * zero repair route for the whole session undetected. This sweep is keyed on
 * TYPE instead, so a validator-name match can no longer hide an unrouted type.
 *
 * `ALL_FINAL_STORY_CONTRACT_ISSUE_TYPES` is compiler-checked against
 * `FinalStoryContractIssueType` (a missing or extra key fails to compile), so a
 * newly-added union member forces a triage decision here — either a case below
 * or an entry in `NATIVE_TYPE_EXEMPTIONS` with a written reason.
 */
const ALL_FINAL_STORY_CONTRACT_ISSUE_TYPES: Record<FinalStoryContractIssueType, true> = {
  empty_scene: true,
  empty_encounter_scene: true,
  placeholder_scene: true,
  invalid_encounter: true,
  missing_runtime_encounter: true,
  broken_navigation: true,
  routing_contradiction: true,
  choice_bridge_skips_required_setup: true,
  choice_count_contract: true,
  supernatural_canon_contradiction: true,
  beat_id_collision: true,
  encounter_template_collapse: true,
  encounter_malformed_prose: true,
  encounter_one_click_win: true,
  encounter_clock_coverage_gap: true,
  missing_requested_episode: true,
  failed_incremental_validation: true,
  unrepaired_callback_debt: true,
  callback_opportunity_advisory: true,
  planned_residue_debt: true,
  obligation_ledger_debt: true,
  source_role_mismatch: true,
  partial_season_scope: true,
  treatment_fidelity_violation: true,
  ambiguous_protagonist_pronoun: true,
  protagonist_placeholder_leak: true,
  npc_pronoun_inconsistency: true,
  outcome_text_stub: true,
  echo_summary_variant: true,
  planning_register_prose: true,
  prose_style_violation: true,
  unset_flag_condition: true,
  promised_clue_absent: true,
  choice_type_plan_nonconformance: true,
  consequence_tier_plan_nonconformance: true,
  skill_plan_nonconformance: true,
  sentence_opener_monotony: true,
  encounter_prose_integrity: true,
  encounter_pov_break: true,
  pov_break: true,
  pov_anchor_missing: true,
  protagonist_as_npc: true,
  encounter_outcome_desync: true,
  continuity_error: true,
  transition_continuity_violation: true,
  scene_turn_realization_violation: true,
  semantic_realization_violation: true,
  mechanic_pressure_violation: true,
  treatment_field_utilization_violation: true,
  treatment_event_ledger_violation: true,
  season_promise_realization_violation: true,
  character_treatment_realization_violation: true,
  narrative_failure_mode_violation: true,
  duplicate_high_pressure_event: true,
  scene_location_event_mismatch: true,
  route_chronology_violation: true,
  choice_bridge_sibling_leak: true,
  route_duplicate_event: true,
  unsafe_fallback_prose: true,
  role_fidelity_violation: true,
  qa_blocker_present: true,
};

interface NativeTypeCase {
  name: string;
  issue: BlockingClassCase['issue'];
}

/**
 * Newly-triaged native types (r118 postmortem, 2026-07-18) — each constructed
 * from the exact shape `FinalStoryContractValidator.ts` emits (validator field,
 * or its absence, verified against the real push site). Every one of these
 * fell to `diagnostic_stop` before this pass; each now routes to an actionable
 * directive with an admitting handler.
 */
const NATIVE_TYPE_ROUTES: NativeTypeCase[] = [
  {
    name: 'protagonist_placeholder_leak: stale launch identity reached reader prose',
    issue: {
      validator: 'FinalStoryContractValidator',
      type: 'protagonist_placeholder_leak',
      severity: 'error',
      message: 'Placeholder protagonist identity appears in reader-facing prose at story/episodes[0]/scenes[0]/beats[0]/text.',
      sceneId: 's1-1',
      episodeNumber: 1,
    },
  },
  {
    name: 'duplicate_high_pressure_event: later scene restages an earlier staged event',
    issue: {
      validator: 'FinalStoryContractValidator',
      type: 'duplicate_high_pressure_event',
      severity: 'error',
      message: 'Reachable scenes "s1-4" and "s1-5" appear to restage the same high-pressure event (rooftop, named_person, vanish, night).',
      sceneId: 's1-5',
      episodeNumber: 1,
    },
  },
  {
    name: 'scene_location_event_mismatch: staged event names a different location than the scene plan',
    issue: {
      validator: 'FinalStoryContractValidator',
      type: 'scene_location_event_mismatch',
      severity: 'error',
      message: 'Scene "Cismigiu Attack" is planned at "Kylie\'s Lipscani Apartment" but its staged high-pressure event names a different location signal (park).',
      sceneId: 's1-7',
      episodeNumber: 1,
    },
  },
  {
    name: 'supernatural_canon_contradiction: vampire character scheduled for a daytime meal',
    issue: {
      validator: 'FinalStoryContractValidator',
      type: 'supernatural_canon_contradiction',
      severity: 'error',
      message: 'Canon contradiction in s1-2-b3: vampire/strigoi character scheduled for a daytime meal ("Victor invites you to brunch").',
      sceneId: 's1-2',
      beatId: 's1-2-b3',
      episodeNumber: 1,
    },
  },
  {
    name: 'empty_scene (native, no validator tag): non-encounter scene with zero reader-facing beats',
    issue: {
      type: 'empty_scene',
      severity: 'error',
      message: 'Non-encounter scene "s1-4" has no reader-facing beats.',
      sceneId: 's1-4',
      episodeNumber: 1,
    },
  },
  {
    name: 'placeholder_scene: scene is only placeholder or branch-residue text',
    issue: {
      type: 'placeholder_scene',
      severity: 'error',
      message: 'Scene "s1-4" is only placeholder or branch-residue text.',
      sceneId: 's1-4',
      episodeNumber: 1,
    },
  },
  {
    name: 'qa_blocker_present (MechanicsLeakageValidator tag): design-note/mechanics leak in reader-facing text',
    issue: {
      validator: 'MechanicsLeakageValidator',
      type: 'qa_blocker_present',
      severity: 'error',
      message: 'Design-note leak in s1-3:b2: "[remember: Stela is cold here]".',
      sceneId: 's1-3',
      episodeNumber: 1,
    },
  },
];

/**
 * Genuinely fine to diagnostic_stop today: structural/graph-integrity or
 * episode-scope defects with no scene-local prose fix (a rewrite cannot repair
 * a dangling scene pointer or a missing episode), OR types that can never
 * reach `severity: 'error'` in the first place (hardcoded warning-only
 * telemetry). Each entry states which, and — for the repairable-in-principle
 * ones — the shift-left follow-up that would actually close the gap.
 */
const NATIVE_DIAGNOSTIC_STOP_ALLOWLIST: Record<string, { rationale: string; issue: BlockingClassCase['issue'] }> = {
  broken_navigation: {
    rationale:
      'Scene-graph corruption (missing/dangling startingSceneId, or a scene unreachable from the episode start). No '
      + 'prose rewrite can repair a broken graph pointer — this indicates an upstream generation or repair-round bug '
      + 'and should hard-abort for investigation rather than being silently patched.',
    issue: {
      type: 'broken_navigation',
      severity: 'error',
      message: 'Episode startingSceneId "s1-1" does not point at a scene.',
      episodeNumber: 1,
    },
  },
  beat_id_collision: {
    rationale:
      'Cross-scene beat-id collision. StructuralValidator already runs a deterministic autofix (namespacing) before '
      + 'this gate; anything still reaching here is unrepaired residue from a failed autofix, not a prose defect — '
      + 'the correct response is to hard-abort and fix the autofix, not to reattempt via LLM rewrite.',
    issue: {
      type: 'beat_id_collision',
      severity: 'error',
      message: 'Beat id "b1" in scene "s1-4" duplicates "b1" in scene "s1-5".',
      sceneId: 's1-4',
      episodeNumber: 1,
    },
  },
  missing_runtime_encounter: {
    rationale:
      'A scene that failed encounter validation but shipped with no runtime `scene.encounter` object at all — data '
      + 'loss between incremental validation and final assembly, not a prose gap. No text exists to rewrite; this '
      + 'needs investigation of the assembly step that dropped the encounter, a shift-left fix, not a repair route.',
    issue: {
      type: 'missing_runtime_encounter',
      severity: 'error',
      message: 'Scene "treatment-enc-1-1" failed encounter validation but has no runtime encounter in the final story.',
      sceneId: 'treatment-enc-1-1',
      episodeNumber: 1,
    },
  },
  missing_requested_episode: {
    rationale:
      'An entire requested episode is absent from the final story — there is no scene to target because the episode '
      + 'was never generated. The fix is re-running generation for that episode at the orchestration layer, which is '
      + 'outside the final-contract repair loop\'s scope (bounded per-scene/per-cluster prose rewrites).',
    issue: {
      type: 'missing_requested_episode',
      severity: 'error',
      message: 'Requested episode 2 is missing from the final story.',
      episodeNumber: 2,
    },
  },
  partial_season_scope: {
    rationale:
      'Treatment-sourced output is missing planned episodes relative to the source season plan — season-scope '
      + 'architecture, not a scene-local defect, and (in full-season mode) has no scene target at all. Regenerating '
      + 'the missing episodes is an orchestration-layer action, not a same-scene or cluster prose rewrite.',
    issue: {
      type: 'partial_season_scope',
      severity: 'error',
      message: 'Treatment-sourced output is missing planned episode(s): generated episode(s) 1 of 3 source episode(s). Full-season mode cannot pass.',
    },
  },
  source_role_mismatch: {
    rationale:
      'Generated episode title differs from the source season plan\'s title for that episode number — a season-plan '
      + 'reconciliation drift, not a scene prose defect; there is no beat text to rewrite to fix a title mismatch.',
    issue: {
      type: 'source_role_mismatch',
      severity: 'error',
      message: 'Episode 1 title differs from the source plan: "Dating After Dark" vs "Dating After Dusk".',
      episodeNumber: 1,
    },
  },
  routing_contradiction: {
    rationale:
      'A beat/choice explicit next-scene target contradicts the scene\'s own `leadsTo` list — a routing-pointer '
      + 'defect. Rewriting this scene\'s prose cannot change where a choice or beat routes; the correct fix is a '
      + 'deterministic pointer correction, which does not exist as a repair handler today (shift-left candidate).',
    issue: {
      type: 'routing_contradiction',
      severity: 'error',
      message: 'Choice "c1" routes to "s1-6", which is not in scene "s1-4".leadsTo [s1-5].',
      sceneId: 's1-4',
      beatId: 's1-4-b4',
      episodeNumber: 1,
    },
  },
  choice_bridge_skips_required_setup: {
    rationale:
      'A choice bridge jumps over one or more scenes that carry required, un-authored-as-skippable setup content — a '
      + 'branch-routing defect. The fix is re-routing through (or past) the skipped scenes, not rewriting this '
      + 'scene\'s own prose, which a same-scene or cluster rewrite cannot do safely.',
    issue: {
      type: 'choice_bridge_skips_required_setup',
      severity: 'error',
      message: 'Choice "c1" jumps from "s1-2" to "s1-5", skipping required setup scene(s): s1-3, s1-4.',
      sceneId: 's1-2',
      beatId: 's1-2-b4',
      episodeNumber: 1,
    },
  },
  invalid_encounter: {
    rationale:
      'Encounter scene fails the deterministic playable-encounter contract (phase/storylet/routing structure), the '
      + 'same architecture-class defect as GATE_ENCOUNTER_SETPIECE_DEPTH above ("missing encounter STRUCTURE — no '
      + 'prose rewrite can add it"). The generative fix lives in EncounterArchitect at build time; no scene-prose '
      + 'repair handler can safely restructure phases/storylets after the fact.',
    issue: {
      validator: 'IncrementalEncounterValidator',
      type: 'invalid_encounter',
      severity: 'error',
      message: 'Encounter scene "treatment-enc-1-1" does not satisfy the playable encounter contract.',
      sceneId: 'treatment-enc-1-1',
      episodeNumber: 1,
    },
  },
  choice_count_contract: {
    rationale:
      'A choice surface has the wrong number of options (not 3-4) — a choice-SET-cardinality defect, not resolution '
      + 'text. The existing choice-resolution repair handler re-authors a choice\'s shared resolution TEXT '
      + '(repairHandler: choice_reauthor); it does not add or remove options from the set. No handler exists today '
      + 'that safely regenerates choice cardinality — shift-left candidate for ChoiceAuthor.',
    issue: {
      validator: 'FinalStoryContractValidator',
      type: 'choice_count_contract',
      severity: 'error',
      message: 'Choice surface at episodes[0].scenes[3].beats[3].choices has 2 choice(s); reader-facing story and encounter beats must have 3-4 choices.',
      sceneId: 's1-4',
      beatId: 's1-4-b4',
      episodeNumber: 1,
    },
  },
  unset_flag_condition: {
    rationale:
      'A choice/beat condition reads a flag nothing in the generated scope ever sets — a flag-wiring defect. No '
      + 'deterministic flag-repair handler exists (unlike ObligationLedgerValidator\'s callback/setup-payoff class); '
      + 'a prose rewrite cannot wire a missing setFlag consequence onto an unrelated earlier choice.',
    issue: {
      validator: 'FlagContractValidator',
      type: 'unset_flag_condition',
      severity: 'error',
      message: 'Condition reads flag "blog_post_timing" but no choice in generated scope sets it.',
      episodeNumber: 1,
    },
  },
};

describe('R6: every native FinalStoryContractValidator issue type routes or is allowlisted', () => {
  const router = new GateRepairRouter({});
  void ALL_FINAL_STORY_CONTRACT_ISSUE_TYPES; // exhaustiveness check only; not iterated directly (see comment above)

  for (const testCase of NATIVE_TYPE_ROUTES) {
    it(`routes "${testCase.name}" to an actionable repair (not diagnostic_stop)`, () => {
      const route = router.routeIssue(testCase.issue);
      expect(
        route.kind,
        `(${testCase.issue.validator ?? '(none)'}/${testCase.issue.type}) fell to ${route.kind}: ${route.reason}`,
      ).not.toBe('diagnostic_stop');
    });
  }

  for (const [type, entry] of Object.entries(NATIVE_DIAGNOSTIC_STOP_ALLOWLIST)) {
    it(`${type}: diagnostic_stop is intended (allowlisted with rationale)`, () => {
      expect(entry.rationale.length).toBeGreaterThanOrEqual(80);
      const route = router.routeIssue(entry.issue);
      expect(
        route.kind,
        `${type} routes to ${route.kind} now, not diagnostic_stop — move it from NATIVE_DIAGNOSTIC_STOP_ALLOWLIST to NATIVE_TYPE_ROUTES.`,
      ).toBe('diagnostic_stop');
    });
  }

  it('every NATIVE_TYPE_ROUTES / NATIVE_DIAGNOSTIC_STOP_ALLOWLIST case routed to an LLM prose directive is admitted by a handler', () => {
    for (const testCase of NATIVE_TYPE_ROUTES) {
      const route = router.routeIssue(testCase.issue);
      if (!LLM_PROSE_DIRECTIVES.has(route.kind)) continue;
      const claims = llmHandlerClaims(testCase.issue);
      expect(
        claims,
        `(${testCase.issue.validator ?? '(none)'}/${testCase.issue.type}) routes ${route.kind} but no handler admission accepts it.`,
      ).not.toEqual([]);
    }
  });
});

/**
 * EXECUTABLE-CLAIM CHECK: routing metadata alone is not enough — the
 * SemanticRealizationJudge starvation had healthy-looking routes while the
 * prose handler's own allowlist silently dropped the class. For each class
 * that starved in production, assert the concrete claim logic accepts it.
 */
describe('handler claims for production-starved classes', () => {
  it('scene-prose selection claims judge-confirmed scene_prose misses', () => {
    const groups = selectSceneProseRepairs([
      {
        type: 'semantic_realization_violation',
        severity: 'error',
        message: 'missing: event:ep1-u1:semantic:1. Missing meaning(s): Kylie arrives with her luggage.',
        validator: 'SemanticRealizationJudge',
        repairHandler: 'scene_prose',
        sceneId: 's1-1',
        episodeNumber: 1,
      },
    ] as never);
    expect([...groups.keys()]).toEqual(['s1-1']);
  });

  it('choice-resolution handler claims choice_reauthor findings', async () => {
    const handler = buildChoiceResolutionRepairHandler({
      author: () => ({ reauthorSharedResolutionText: async () => undefined }),
    });
    const story = { episodes: [{ number: 1, scenes: [{ id: 's1-4', name: 'Test', beats: [{ id: 'b1', choices: [{ id: 'c1', text: 'x', outcomeTexts: { success: 'A result lands here.' } }] }] }] }] } as never;
    const result = await handler({
      story,
      blockingIssues: [{
        type: 'semantic_realization_violation', severity: 'error', validator: 'SemanticRealizationJudge',
        sceneId: 's1-4', repairHandler: 'choice_reauthor', taskId: 'task:x',
        message: 'missing shared resolution',
      }],
    } as never);
    expect(result.attemptedIssueKeys?.length).toBe(1);
  });

  it('scene-cluster handler claims route_duplicate_event restage findings (bite-me 2026-07-15T20-44-49)', async () => {
    const story = {
      episodes: [{
        number: 1,
        scenes: [
          { id: 's1-6', name: 'Night out', beats: [{ id: 'a1', text: 'The club empties around you.' }] },
          { id: 's1-blog-aftermath', name: 'The post becomes public pressure', beats: [{ id: 'b1', text: "You hit 'Publish.' The counter climbs." }] },
        ],
      }],
    } as never;
    const issue = {
      validator: 'RouteContinuityValidator',
      type: 'route_duplicate_event',
      severity: 'error',
      sceneId: 's1-blog-aftermath',
      episodeNumber: 1,
      message: 'Reader route restages lateNightWriting in "s1-blog-aftermath" after that event was already owned earlier. Later scenes may carry aftermath or residue only.',
      suggestion: 'Rewrite the later scene as consequence, memory, public reaction, changed access, or distinct escalation instead of replaying the owned event.',
    };
    const router = new GateRepairRouter({ story: story as never });
    const handler = buildSceneClusterRepairHandler({
      critic: () => ({
        execute: async () => ({
          success: true,
          data: { rewrittenBeats: [{ id: 'b1', text: 'Your phone will not stop shaking; the city has read it, and the comments keep arriving.' }] },
        }),
      }) as never,
      routeIssue: (candidate) => router.routeIssue(candidate),
    });
    const result = await handler({ story, blockingIssues: [issue] } as never);
    expect(result.attemptedIssueKeys?.length).toBe(1);
    expect(result.changed).toBe(true);
  });

  it('encounter-route handler claims outcome-tier findings', async () => {
    const handler = buildEncounterRouteRepairHandler({
      author: () => ({ reauthorEncounterRoute: async () => 0 }),
    });
    const story = { episodes: [{ number: 1, scenes: [{ id: 'enc-1', encounter: { storylets: { victory: { beats: [] } } } }] }] } as never;
    const result = await handler({
      story,
      blockingIssues: [{
        type: 'semantic_realization_violation', severity: 'error', validator: 'SemanticRealizationJudge',
        sceneId: 'enc-1', repairHandler: 'encounter_route', outcomeTier: 'victory', taskId: 'task:y',
        message: 'missing route evidence',
      }],
    } as never);
    expect(result.attemptedIssueKeys?.length).toBe(1);
  });
});
