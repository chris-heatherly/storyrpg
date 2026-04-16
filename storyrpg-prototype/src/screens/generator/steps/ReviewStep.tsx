/**
 * ReviewStep
 *
 * Step 3 of the generator wizard — shows the user's inputs, runs analysis,
 * and surfaces the post-analysis review card (title edit, ending mode,
 * character refs, episode picker). Wraps the existing analysis-review
 * render block.
 */

import React from 'react';
import { StepFrame } from './StepFrame';

interface ReviewStepProps {
  children: React.ReactNode;
}

export const ReviewStep: React.FC<ReviewStepProps> = ({ children }) => (
  <StepFrame
    stepLabel="Step 3"
    title="Review and analyze"
    subtitle="We'll scan your source and confirm the story plan before committing to a full generation run."
  >
    {children}
  </StepFrame>
);
