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
import { validateEncounterProducerOutput } from '../pipeline/producerBlockerChecks';
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
    name: 'third-person protagonist narration in a second-person story (pov_break)',
    issue: {
      validator: 'PovClarityValidator',
      type: 'pov_break',
      severity: 'error',
      message: 'Beat narrates the protagonist in the third person ("Kylie… she…") in a second-person story — a POV break.',
      sceneId: 's1-2',
      beatId: 's1-2-b4',
      episodeNumber: 1,
    },
    expected: 'deterministic_cleanup', // name-anchored pronoun coercion autofix
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
