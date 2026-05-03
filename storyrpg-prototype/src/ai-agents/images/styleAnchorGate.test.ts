import { describe, expect, it } from 'vitest';

import { chooseGeminiStyleAnchor } from './styleAnchorGate';

describe('chooseGeminiStyleAnchor', () => {
  it('rejects a generated anchor that fails validation', () => {
    const decision = chooseGeminiStyleAnchor({
      generatedCharacterAnchor: 'generated',
      generatedCharacterValidation: {
        passed: false,
        reason: 'off style',
      },
    });

    expect(decision.anchor).toBeUndefined();
    expect(decision.source).toBe('none');
    expect(decision.rejectedGeneratedAnchor).toBe(true);
    expect(decision.rejectionReason).toBe('off style');
  });

  it('allows generated anchors only after validation passes', () => {
    const decision = chooseGeminiStyleAnchor({
      generatedCharacterAnchor: 'generated',
      generatedCharacterValidation: {
        passed: true,
      },
    });

    expect(decision.anchor).toBe('generated');
    expect(decision.source).toBe('generated-character-anchor');
    expect(decision.rejectedGeneratedAnchor).toBe(false);
  });

  it('lets user-provided style sources bypass generated-anchor validation', () => {
    const uploaded = chooseGeminiStyleAnchor({
      uploadedStyleReference: 'uploaded',
      generatedCharacterAnchor: 'generated',
      generatedCharacterValidation: { passed: false, reason: 'off style' },
    });
    const preapproved = chooseGeminiStyleAnchor({
      preapprovedCharacterAnchor: 'preapproved',
      uploadedStyleReference: 'uploaded',
      generatedCharacterAnchor: 'generated',
      generatedCharacterValidation: { passed: false, reason: 'off style' },
    });

    expect(uploaded.anchor).toBe('uploaded');
    expect(uploaded.source).toBe('uploaded-style-reference');
    expect(uploaded.rejectedGeneratedAnchor).toBe(false);
    expect(preapproved.anchor).toBe('preapproved');
    expect(preapproved.source).toBe('preapproved-character');
    expect(preapproved.rejectedGeneratedAnchor).toBe(false);
  });
});
