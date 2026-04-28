/**
 * ProgressStep
 *
 * Step 4 of the generator wizard — active generation. Shows the grouped
 * `PipelineProgress` and any child checkpoint/retry UI owned by the parent
 * screen.
 */

import React from 'react';
import { StepFrame } from './StepFrame';

interface ProgressStepProps {
  children: React.ReactNode;
}

export const ProgressStep: React.FC<ProgressStepProps> = ({ children }) => (
  <StepFrame
    stepLabel="Step 4"
    title="Generating your story"
    subtitle="The pipeline is running. This usually takes a few minutes depending on settings."
  >
    {children}
  </StepFrame>
);
