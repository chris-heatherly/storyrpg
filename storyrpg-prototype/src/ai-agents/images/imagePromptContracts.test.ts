import { describe, expect, it } from 'vitest';
import { applyPromptContract, sanitizeStyleContaminationText } from './imagePromptContracts';

describe('image prompt contracts', () => {
  it('strips competing photoreal/render-engine language from positive prompt text', () => {
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

    expect(result.prompt).not.toMatch(/film still|bokeh|depth of field|DSLR|Octane render/i);
    expect(result.promptContract?.sanitizedTerms).toEqual(expect.arrayContaining([
      'film still',
      'bokeh',
      'depth of field',
      'DSLR photo',
      'Octane render',
    ]));
    expect(result.negativePrompt).toMatch(/photorealism/);
  });

  it('removes object leakage from prompt text', () => {
    const cleaned = sanitizeStyleContaminationText('Identity anchors: [object Object].');
    expect(cleaned.text).toBe('Identity anchors: structured identity details.');
    expect(cleaned.sanitizedTerms).toContain('[object Object]');
  });
});
