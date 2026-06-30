import { describe, expect, it } from 'vitest';
import { ARCHITECT_GATE_TAGS, classifyArchitectGateWarnings } from './architectGatePolicy';

const allOff = () => false;
const enable =
  (...flags: string[]) =>
  (flag: string) =>
    flags.includes(flag);

describe('architectGatePolicy', () => {
  it('exposes the five B0 craft tags mapped to their gate flags', () => {
    expect(ARCHITECT_GATE_TAGS).toEqual([
      { tag: '[TreatmentFidelity]', flag: 'GATE_TREATMENT_FIDELITY' },
      { tag: '[DramaticStructure]', flag: 'GATE_DRAMATIC_STRUCTURE' },
      { tag: '[ThemePressure]', flag: 'GATE_THEME_PRESSURE' },
      { tag: '[SceneTurnContract]', flag: 'GATE_SCENE_TURN_CONTRACT' },
      { tag: '[EpisodePressure]', flag: 'GATE_EPISODE_PRESSURE' },
    ]);
  });

  it('treats everything as advisory with no flags enabled (default-off guarantee)', () => {
    const warnings = [
      '[TreatmentFidelity] drifted from the treatment',
      '[DramaticStructure] missing find reversal',
      '[ThemePressure] theme never pressured',
    ];
    const { blocking, advisory } = classifyArchitectGateWarnings(warnings, allOff);
    expect(blocking).toEqual([]);
    expect(advisory).toEqual(warnings);
  });

  it('blocks only matching-tagged warnings when one flag is enabled', () => {
    const warnings = [
      '[TreatmentFidelity] drifted from the treatment',
      '[DramaticStructure] missing find reversal',
    ];
    const { blocking, advisory } = classifyArchitectGateWarnings(
      warnings,
      enable('GATE_TREATMENT_FIDELITY'),
    );
    expect(blocking).toEqual(['[TreatmentFidelity] drifted from the treatment']);
    expect(advisory).toEqual(['[DramaticStructure] missing find reversal']);
  });

  it('keeps untagged warnings advisory regardless of flags', () => {
    const warnings = ['some unrelated advisory note with no known tag'];
    expect(classifyArchitectGateWarnings(warnings, allOff)).toEqual({
      blocking: [],
      advisory: warnings,
    });
    expect(
      classifyArchitectGateWarnings(
        warnings,
        enable('GATE_TREATMENT_FIDELITY', 'GATE_DRAMATIC_STRUCTURE'),
      ),
    ).toEqual({ blocking: [], advisory: warnings });
  });

  it('handles multiple tags with multiple flags enabled', () => {
    const warnings = [
      '[TreatmentFidelity] drifted',
      '[DramaticStructure] flat',
      '[ThemePressure] absent',
      '[SceneTurnContract] no turn',
      '[EpisodePressure] slack',
      'untagged trailing note',
    ];
    const { blocking, advisory } = classifyArchitectGateWarnings(
      warnings,
      enable('GATE_DRAMATIC_STRUCTURE', 'GATE_EPISODE_PRESSURE'),
    );
    expect(blocking).toEqual(['[DramaticStructure] flat', '[EpisodePressure] slack']);
    expect(advisory).toEqual([
      '[TreatmentFidelity] drifted',
      '[ThemePressure] absent',
      '[SceneTurnContract] no turn',
      'untagged trailing note',
    ]);
  });
});
