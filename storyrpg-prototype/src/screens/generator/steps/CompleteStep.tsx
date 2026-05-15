/**
 * CompleteStep
 *
 * Terminal step of the generator wizard — shown once generation finishes
 * successfully. Frames the "Play now / View in library / Generate another /
 * Export" action set owned by `GeneratorScreen`.
 */

import React from 'react';
import { StepFrame } from './StepFrame';

interface CompleteStepProps {
  children: React.ReactNode;
}

export const CompleteStep: React.FC<CompleteStepProps> = ({ children }) => (
  <StepFrame
    stepLabel="Done"
    title="Your story is ready"
    subtitle="Play it now, drop it into your library, or spin up another one."
  >
    {children}
  </StepFrame>
);
