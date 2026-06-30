/**
 * StyleStep
 *
 * Step 2 of the generator wizard — visual style, image renderer, narration.
 * Wraps the existing Images / Narration / Video buckets until they're
 * migrated into a tighter per-step layout.
 */

import React from 'react';
import { StepFrame } from './StepFrame';

interface StyleStepProps {
  children: React.ReactNode;
}

export const StyleStep: React.FC<StyleStepProps> = ({ children }) => (
  <StepFrame
    stepLabel="Step 2"
    title="Choose the look and voice"
    subtitle="Art direction, image rendering, narration. Safe defaults apply unless you change them."
  >
    {children}
  </StepFrame>
);
