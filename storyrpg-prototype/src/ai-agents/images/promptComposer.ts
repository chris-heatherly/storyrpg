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

function joinSections(sections: CanonicalPromptSections): string {
  return [
    sections.style && `STYLE\n${sections.style}`,
    sections.identity && `IDENTITY\n${sections.identity}`,
    sections.environment && `ENVIRONMENT\n${sections.environment}`,
    sections.moment && `MOMENT\n${sections.moment}`,
    sections.composition && `COMPOSITION\n${sections.composition}`,
    sections.continuity && `CONTINUITY\n${sections.continuity}`,
  ].filter(Boolean).join('\n\n');
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
