import { describe, expect, it } from 'vitest';
import { classifyTreatmentObligation } from './treatmentObligationClassifier';

describe('treatment obligation classifier', () => {
  it('keeps concrete signature devices blocking', () => {
    const result = classifyTreatmentObligation({
      validator: 'SignatureDevicePresenceValidator',
      text: 'Victor walks Kylie home and kisses her hand at the threshold.',
    });

    expect(result).toMatchObject({
      kind: 'scene_prose_signature',
      blocksFinalProse: true,
      targetSurface: 'signature-device',
    });
  });

  it('downgrades composite two-anchor signatures until they are split', () => {
    const result = classifyTreatmentObligation({
      validator: 'SignatureDevicePresenceValidator',
      text: 'Two anchors, light then dark — the rooftop bar at sunset where the Dusk Club locks into place and Kylie catches both men watching her; then Cișmigiu at 1am, eight seconds of fog, a shadow, a scream, and a rescue.',
    });

    expect(result).toMatchObject({
      kind: 'composite_signature',
      blocksFinalProse: false,
      repairRoute: 'plan-repair',
    });
  });

  it('downgrades abstract opening promises', () => {
    const result = classifyTreatmentObligation({
      validator: 'RequiredBeatRealizationValidator',
      text: 'Opening promise: a heartbroken woman gets a glamorous new life and her own byline.',
    });

    expect(result).toMatchObject({
      kind: 'abstract_pressure',
      blocksFinalProse: false,
      targetSurface: 'season-promise',
    });
  });

  it('downgrades broad arrival identity summaries after split obligations are created', () => {
    const result = classifyTreatmentObligation({
      validator: 'RequiredBeatRealizationValidator',
      text: "She arrives in Bucharest with two suitcases and her grandmother's address, gathers the Dusk Club over too-dark negronis, and protects herself the way she always has — by observing, ordering second, and writing the piece later.",
    });

    expect(result).toMatchObject({
      kind: 'composite_bundle',
      blocksFinalProse: false,
      targetSurface: 'information-ledger',
    });
  });

  it('routes spoiler truths to ledger-safe handling', () => {
    const result = classifyTreatmentObligation({
      validator: 'RequiredBeatRealizationValidator',
      text: "Mika is a contracted succubus working as Victor's lure and inside-man.",
    });

    expect(result).toMatchObject({
      kind: 'season_spoiler_ledger',
      blocksFinalProse: false,
      repairRoute: 'ledger-repair',
    });
  });

  it('routes semicolon seed bundles away from literal scene prose', () => {
    const result = classifyTreatmentObligation({
      validator: 'RequiredBeatRealizationValidator',
      text: "The quartz (the apartment's standing ward); the side-entrance key card; Mika's half-second of stillness; the rougher man at the kitchen entrance; the black roses and cream-stock card delivered impossibly fast; the stray dog in the courtyard, watching; the readership number climbing at episode's end.",
    });

    expect(result).toMatchObject({
      kind: 'composite_bundle',
      blocksFinalProse: false,
      targetSurface: 'information-ledger',
    });
  });
});
