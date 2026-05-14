import type { ImagePrompt } from '../agents/ImageGenerator';
import type { ImageRetryStage } from './slotTypes';

export interface CanonicalPromptSections {
  style?: string;
  identity?: string;
  environment?: string;
  moment?: string;
  composition?: string;
  continuity?: string;
  negatives?: string;
}

// B3: compressed canonical skeleton.
// Prior format used "STYLE\n<body>\n\nIDENTITY\n<body>\n\n..." which cost
// 1 label + 2 newlines per section. Single-line labeled format saves ~6
// newlines per prompt (trivial for text LLMs but meaningful for
// image-path tokenization and for Gemini's multimodal input budget
// where long prompts start getting truncated from the tail).
function joinSections(sections: CanonicalPromptSections): string {
  return [
    sections.style && `STYLE: ${sections.style}`,
    sections.identity && `IDENTITY: ${sections.identity}`,
    sections.environment && `ENVIRONMENT: ${sections.environment}`,
    sections.moment && `MOMENT: ${sections.moment}`,
    sections.composition && `COMPOSITION: ${sections.composition}`,
    sections.continuity && `CONTINUITY: ${sections.continuity}`,
  ].filter(Boolean).join('\n');
}

export function composeCanonicalPrompt(
  base: ImagePrompt,
  sections: CanonicalPromptSections,
): ImagePrompt {
  const prompt = joinSections({
    style: sections.style || base.style,
    identity: sections.identity,
    environment: sections.environment,
    moment: sections.moment || base.prompt,
    composition: sections.composition || [base.composition, base.cameraAngle].filter(Boolean).join(', '),
    continuity: sections.continuity || base.settingAdaptationNotes?.join('; '),
  });

  return {
    ...base,
    prompt: prompt || base.prompt,
    negativePrompt: sections.negatives || base.negativePrompt,
  };
}

export function budgetCanonicalPrompt(
  prompt: ImagePrompt,
  retryStage: ImageRetryStage,
): ImagePrompt {
  if (retryStage === 'primary' || retryStage === 'resume') {
    return prompt;
  }

  const next = { ...prompt };
  if (retryStage === 'retry') {
    next.settingAdaptationNotes = (next.settingAdaptationNotes || []).slice(0, 2);
    return next;
  }

  if (retryStage === 'aggressive_retry' || retryStage === 'fallback_provider') {
    next.settingAdaptationNotes = (next.settingAdaptationNotes || []).slice(0, 1);
    if (next.negativePrompt && next.negativePrompt.length > 300) {
      next.negativePrompt = next.negativePrompt.slice(0, 300);
    }
    if (next.prompt.length > 2200) {
      next.prompt = next.prompt.slice(0, 2200);
    }
  }

  return next;
}
