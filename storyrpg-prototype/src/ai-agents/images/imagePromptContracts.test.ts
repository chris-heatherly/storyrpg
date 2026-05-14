import { describe, expect, it } from 'vitest';
import { applyPromptContract, sanitizeStyleContaminationText } from './imagePromptContracts';

describe('image prompt contracts', () => {
  it('preserves raw style text and does not add universal anti-style negatives', () => {
    const result = applyPromptContract({
      prompt: 'A film still with bokeh, depth of field, DSLR photo realism, Octane render lighting.',
      style: 'flat anime cel shading',
      negativePrompt: 'watermark',
    }, {
      style: 'flat anime cel shading',
      mode: 'story-beat',
      styleSource: 'raw-season-style',
      characterIdentity: [],
    });

    expect(result.style).toBe('flat anime cel shading');
    expect(result.prompt).toContain('film still');
    expect(result.negativePrompt).toBe('watermark');
    expect(result.negativeContract).toBe('watermark');
  });

  it('does not rewrite style terms inside negative clauses', () => {
    const cleaned = sanitizeStyleContaminationText(
      'Render the scene cleanly; never as photorealism, live-action, 3D render, or generic cinematic concept art.',
    );
    expect(cleaned.text).toContain('never as photorealism, live-action, 3D render, or generic cinematic concept art');
    expect(cleaned.text).not.toContain('never as stylized illustrated finish');
  });

  it('removes object leakage from prompt text', () => {
    const cleaned = sanitizeStyleContaminationText('Identity anchors: [object Object].');
    expect(cleaned.text).toBe('Identity anchors: structured identity details.');
    expect(cleaned.sanitizedTerms).toContain('[object Object]');
  });
});
