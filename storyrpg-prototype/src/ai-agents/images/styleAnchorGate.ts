export interface StyleAnchorValidationResult {
  passed: boolean;
  score?: number;
  reason?: string;
  issues?: string[];
  skipped?: boolean;
  allowedAsStyleReference?: boolean;
}

export interface StyleAnchorGateDecision<T> {
  anchor?: T;
  source: 'preapproved-character' | 'uploaded-style-reference' | 'generated-character-anchor' | 'none';
  rejectedGeneratedAnchor: boolean;
  rejectionReason?: string;
}

export function chooseSeasonStyleAnchor<T>(input: {
  preapprovedCharacterAnchor?: T;
  uploadedStyleReference?: T;
  generatedCharacterAnchor?: T;
  generatedCharacterValidation?: StyleAnchorValidationResult;
}): StyleAnchorGateDecision<T> {
  if (input.preapprovedCharacterAnchor) {
    return {
      anchor: input.preapprovedCharacterAnchor,
      source: 'preapproved-character',
      rejectedGeneratedAnchor: false,
    };
  }

  if (input.uploadedStyleReference) {
    return {
      anchor: input.uploadedStyleReference,
      source: 'uploaded-style-reference',
      rejectedGeneratedAnchor: false,
    };
  }

  if (input.generatedCharacterAnchor && input.generatedCharacterValidation?.passed === true) {
    return {
      anchor: input.generatedCharacterAnchor,
      source: 'generated-character-anchor',
      rejectedGeneratedAnchor: false,
    };
  }

  if (input.generatedCharacterAnchor) {
    return {
      source: 'none',
      rejectedGeneratedAnchor: true,
      rejectionReason: input.generatedCharacterValidation?.reason || 'generated style anchor did not pass validation',
    };
  }

  return {
    source: 'none',
    rejectedGeneratedAnchor: false,
  };
}
