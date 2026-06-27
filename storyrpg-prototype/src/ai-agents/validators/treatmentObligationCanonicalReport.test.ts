import { describe, expect, it } from 'vitest';
import { buildTreatmentObligationCanonicalReport } from './treatmentObligationCanonicalReport';
import type { FidelityFinding } from './runFidelityValidators';

function finding(overrides: Partial<FidelityFinding>): FidelityFinding {
  return {
    validator: 'TreatmentFieldUtilizationValidator',
    severity: 'error',
    message: 'Episode 1 treatment field "signature" was planned but not realized in reader-facing story pressure: "Silver comb opens the hidden door.".',
    episodeNumber: 1,
    sceneId: 's1-1',
    ...overrides,
  };
}

describe('treatment obligation canonical report', () => {
  it('dedupes the same signature field from treatment utilization and signature presence', () => {
    const report = buildTreatmentObligationCanonicalReport({
      treatmentSourced: true,
      fidelityFindings: [
        finding({
          validator: 'TreatmentFieldUtilizationValidator',
          message: 'Episode 1 treatment field "signature" was planned but not realized in reader-facing story pressure: "Silver comb opens the hidden door.".',
        }),
        finding({
          validator: 'SignatureDevicePresenceValidator',
          message: 'Signature device is missing from the final prose of episode 1 scene "s1-1": "Silver comb opens the hidden door.". The staged signature moment must be depicted, not summarized away.',
        }),
      ],
    });

    expect(report.metrics.rawFindingCount).toBe(2);
    expect(report.metrics.canonicalFindingCount).toBe(1);
    expect(report.metrics.suppressedDuplicateCount).toBe(1);
    expect(report.findings[0].contract).toBe('treatment_signature_realization');
  });

  it('dedupes the same season promise from treatment utilization and season promise realization', () => {
    const report = buildTreatmentObligationCanonicalReport({
      treatmentSourced: true,
      fidelityFindings: [
        finding({
          message: 'Episode 1 treatment field "promise" was planned but not realized in reader-facing story pressure: "Every victory should cost public trust.".',
        }),
        finding({
          validator: 'SeasonPromiseRealizationValidator',
          message: 'Season promise "player_promise" was planned but not realized as reader-facing story material: "Every victory should cost public trust.".',
        }),
      ],
    });

    expect(report.metrics.canonicalFindingCount).toBe(1);
    expect(report.findings[0].contract).toBe('treatment_season_promise_realization');
    expect(report.groupedEvidence[0].evidence).toHaveLength(2);
  });

  it('dedupes the same encounter beat from treatment utilization and encounter anchor content', () => {
    const report = buildTreatmentObligationCanonicalReport({
      treatmentSourced: true,
      fidelityFindings: [
        finding({
          message: 'Episode 1 treatment field "encounter" was planned but not realized in reader-facing story pressure: "The doorman recognizes the forged invitation.".',
        }),
        finding({
          validator: 'EncounterAnchorContentValidator',
          message: 'Encounter anchor required beat was not depicted: "The doorman recognizes the forged invitation.".',
        }),
      ],
    });

    expect(report.metrics.canonicalFindingCount).toBe(1);
    expect(report.findings[0].contract).toBe('treatment_encounter_anchor_realization');
  });

  it('keeps plan-time assignment failures separate from final on-page realization failures', () => {
    const report = buildTreatmentObligationCanonicalReport({
      treatmentSourced: true,
      planTimeFidelityFindings: [
        finding({
          message: 'Episode 1 treatment field "promise" was not consumed into a concrete plan artifact: "Every victory should cost public trust.".',
        }),
      ],
      fidelityFindings: [
        finding({
          message: 'Episode 1 treatment field "promise" was planned but not realized in reader-facing story pressure: "Every victory should cost public trust.".',
        }),
      ],
    });

    expect(report.metrics.rawFindingCount).toBe(2);
    expect(report.metrics.canonicalFindingCount).toBe(2);
    expect(report.findings.map((entry) => entry.phase).sort()).toEqual(['final', 'plan']);
  });

  it('keeps missing information and wrong-order information findings separate', () => {
    const report = buildTreatmentObligationCanonicalReport({
      treatmentSourced: true,
      fidelityFindings: [
        finding({
          validator: 'InformationLedgerScheduleValidator',
          message: 'INFO "mentor-lie" has an authored reveal/payoff in episode 2 but no reveal/payoff landed anywhere in the final story.',
        }),
        finding({
          validator: 'InformationLedgerScheduleValidator',
          message: 'INFO "mentor-lie" reveals/pays off in episode 1 before its setup in episode 2 — information movement must never precede its setup.',
        }),
      ],
    });

    expect(report.metrics.canonicalFindingCount).toBe(2);
    expect(report.findings.every((entry) => entry.contract === 'treatment_information_schedule')).toBe(true);
  });

  it('keeps missing and inverted signature devices separate', () => {
    const report = buildTreatmentObligationCanonicalReport({
      treatmentSourced: true,
      fidelityFindings: [
        finding({
          validator: 'SignatureDevicePresenceValidator',
          message: 'Signature device is missing from the final prose of episode 1 scene "s1-1": "Silver comb opens the hidden door.". The staged signature moment must be depicted, not summarized away.',
        }),
        finding({
          validator: 'SignatureDevicePresenceValidator',
          message: 'Signature device appears INVERTED/negated in episode 1 scene "s1-1": "Silver comb opens the hidden door.". The prose negates the staged moment instead of depicting it.',
        }),
      ],
    });

    expect(report.metrics.canonicalFindingCount).toBe(2);
    expect(report.metrics.suppressedDuplicateCount).toBe(0);
  });

  it('only canonicalizes failure-mode findings tied to authored audit contracts', () => {
    const report = buildTreatmentObligationCanonicalReport({
      treatmentSourced: true,
      fidelityFindings: [
        finding({
          validator: 'NarrativeFailureModeValidator',
          message: '[Passive protagonist] Authored failure-mode audit mitigation was not realized: "Kylie must choose the cover story herself.".',
        }),
        finding({
          validator: 'NarrativeFailureModeValidator',
          message: '[Convenient coincidence] The ending appears to resolve through outside rescue.',
        }),
      ],
    });

    expect(report.metrics.rawFindingCount).toBe(1);
    expect(report.findings[0].contract).toBe('treatment_failure_mode_realization');
  });

  it('keeps partial-season scope notices separate from treatment misses', () => {
    const report = buildTreatmentObligationCanonicalReport({
      treatmentSourced: true,
      requestedEpisodeNumbers: [1, 2, 3, 4],
      generatedEpisodeNumbers: [1],
      fidelityFindings: [
        finding({
          message: 'Episode 1 treatment field "promise" was planned but not realized in reader-facing story pressure: "Every victory should cost public trust.".',
        }),
      ],
      finalContractIssues: [{
        type: 'partial_season_scope',
        severity: 'warning',
        message: 'Treatment-sourced output is a partial slice: generated episode(s) 1 of 4 source episode(s). This is not a full treatment completion.',
      }],
    });

    expect(report.metrics.canonicalFindingCount).toBe(2);
    expect(report.findings.map((entry) => entry.contract).sort()).toEqual([
      'treatment_scope_notice',
      'treatment_season_promise_realization',
    ]);
  });

  it('keeps suppressed duplicates inspectable', () => {
    const report = buildTreatmentObligationCanonicalReport({
      treatmentSourced: true,
      fidelityFindings: [
        finding({
          validator: 'TreatmentFieldUtilizationValidator',
          message: 'Episode 1 treatment field "signature" was planned but not realized in reader-facing story pressure: "Silver comb opens the hidden door.".',
        }),
        finding({
          validator: 'SignatureDevicePresenceValidator',
          message: 'Signature device is missing from the final prose of episode 1 scene "s1-1": "Silver comb opens the hidden door.". The staged signature moment must be depicted, not summarized away.',
        }),
      ],
    });

    expect(report.suppressedDuplicates).toHaveLength(1);
    expect(report.suppressedDuplicates[0].suppressed.sourceValidator).toBe('SignatureDevicePresenceValidator');
    expect(report.suppressedDuplicates[0].canonicalId).toBe(report.findings[0].id);
  });

  it('routes composite Bite Me seed bundles to information-ledger repair', () => {
    const report = buildTreatmentObligationCanonicalReport({
      treatmentSourced: true,
      fidelityFindings: [
        finding({
          validator: 'RequiredBeatRealizationValidator',
          message: 'Treatment plant not found on-page in episode 1 (bound to scene "s1-blog-aftermath"): "The quartz (the apartment\'s standing ward); the side-entrance key card; Mika\'s half-second of stillness; the rougher man at the kitchen entrance; the black roses and cream-stock card delivered impossibly fast; the stray dog in the courtyard, watching; the readership number climbing at episode\'s end.". A cold open, recurring object, or information-ledger tell from the treatment was dropped.',
        }),
      ],
    });

    expect(report.findings[0]).toMatchObject({
      contract: 'treatment_information_schedule',
      repairRoute: 'ledger-repair',
      targetSurface: 'information-ledger',
    });
  });

  it('routes abstract opening promises away from scene prose realization', () => {
    const report = buildTreatmentObligationCanonicalReport({
      treatmentSourced: true,
      fidelityFindings: [
        finding({
          validator: 'RequiredBeatRealizationValidator',
          message: 'Authored required beat is missing from the final prose of episode 1 scene "s1-arrival-cold-open": "Opening promise: a heartbroken woman gets a glamorous new life and her own byline.". The authored turn must be dramatized on-page, not dropped or truncated.',
        }),
      ],
    });

    expect(report.findings[0]).toMatchObject({
      contract: 'treatment_season_promise_realization',
      repairRoute: 'plan-repair',
      targetSurface: 'season-promise',
    });
  });

  it('routes composite two-anchor signatures to plan repair instead of scene stuffing', () => {
    const report = buildTreatmentObligationCanonicalReport({
      treatmentSourced: true,
      fidelityFindings: [
        finding({
          validator: 'SignatureDevicePresenceValidator',
          message: 'Signature device is missing from the final prose of episode 1 scene "s1-5": "Two anchors, light then dark — the rooftop bar at sunset where the Dusk Club locks into place and Kylie catches both men watching her; then Cișmigiu at 1am, eight seconds of fog, a shadow, a scream, and a rescue.". The staged signature moment must be depicted, not summarized away.',
        }),
      ],
    });

    expect(report.findings[0]).toMatchObject({
      contract: 'treatment_signature_realization',
      repairRoute: 'plan-repair',
      targetSurface: 'signature-device',
    });
  });
});
