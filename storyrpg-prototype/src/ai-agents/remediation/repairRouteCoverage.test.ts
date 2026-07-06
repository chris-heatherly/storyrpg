/**
 * Repair-route coverage invariant (R3 of the 2026-07-06 reliability plan).
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
 * When a new blocking class is added to a final-contract validator, add it
 * here WITH its repair route. If this test fails, wire a router rule and a
 * repair handler — do not delete the case.
 */

import { describe, expect, it } from 'vitest';
import { GateRepairRouter } from './gateRepairRouter';

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
