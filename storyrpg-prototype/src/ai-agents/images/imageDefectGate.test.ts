import { describe, expect, it } from 'vitest';

import {
  buildDefectRetryPrompt,
  normalizeImageDefectReport,
  promptAllowsFloating,
} from './imageDefectGate';

describe('image defect gate helpers', () => {
  it('maps visible text, bad anatomy, duplicates, floating, panels, and sheet artifacts to retryable issues', () => {
    const report = normalizeImageDefectReport({
      passed: false,
      issues: [
        'visible text in corner',
        'extra arms',
        'duplicate body',
        'floating character',
        'comic panel leakage',
        'reference sheet annotations',
        'photorealistic architectural visualization',
        'real estate photo HDR interior background',
        'generic cinematic concept art style drift',
        'first-person POV with disembodied hands',
      ],
      reason: 'bad image',
    });

    expect(report.passed).toBe(false);
    expect(report.issues).toEqual([
      'visible_text',
      'extra_limbs',
      'duplicate_body',
      'floating_character',
      'panel_leakage',
      'reference_sheet_artifact',
      'photorealism',
      'environment_photorealism',
      'style_drift',
      'first_person_pov',
    ]);
  });

  it('does not reject floating when the prompt explicitly asks for airborne motion', () => {
    const report = normalizeImageDefectReport(
      { passed: false, issues: ['floating character'] },
      { prompt: 'Mika jumps across the platform, airborne for one dramatic instant.' },
    );

    expect(report.issues).not.toContain('floating_character');
  });

  it('adds defect-specific correction text and negative prompt terms', () => {
    const patch = buildDefectRetryPrompt(
      { prompt: 'A full-body character reference.', negativePrompt: 'text' },
      ['visible_text', 'extra_limbs', 'panel_leakage', 'first_person_pov', 'environment_photorealism'],
    );

    expect(patch.prompt.prompt).toContain('IMAGE QA CORRECTION');
    expect(patch.prompt.prompt).toContain('Replace readable screens');
    expect(patch.prompt.prompt).toContain('exactly two arms');
    expect(patch.prompt.negativePrompt).toContain('extra arms');
    expect(patch.prompt.negativePrompt).toContain('multi-panel layout');
    expect(patch.prompt.negativePrompt).toContain('disembodied hands');
    expect(patch.prompt.negativePrompt).toContain('real estate photo');
  });

  it('detects prompts that intentionally allow floating', () => {
    expect(promptAllowsFloating('a dreamlike vision of a figure levitating')).toBe(true);
    expect(promptAllowsFloating('neutral standing pose, feet planted')).toBe(false);
  });

  it('keeps issue-driven reasons consistent with contradictory model prose', () => {
    const report = normalizeImageDefectReport({
      passed: false,
      issues: ['visible text'],
      reason: 'The image has no visible text.',
    });

    expect(report.passed).toBe(false);
    expect(report.issues).toContain('visible_text');
    expect(report.reason).toContain('Detected issue(s): visible_text.');
    expect(report.reason).toContain('Raw assessment: The image has no visible text.');
  });
});
