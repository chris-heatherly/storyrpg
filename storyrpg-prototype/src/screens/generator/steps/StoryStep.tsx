/**
 * StoryStep
 *
 * Step 1 of the generator wizard — collects the user's primary story inputs
 * (source document or creative prompt, title, genre). This component is a
 * thin frame around the existing story-bucket render blocks owned by
 * `GeneratorScreen`. Callers pass the existing UI as children so we can
 * migrate content into the wizard incrementally without moving every piece
 * of state out of the parent screen in one PR.
 */

import React from 'react';
import { StepFrame } from './StepFrame';

interface StoryStepProps {
  children: React.ReactNode;
}

export const StoryStep: React.FC<StoryStepProps> = ({ children }) => (
  <StepFrame
    stepLabel="Step 1"
    title="Tell us your story"
    subtitle="Start from a document or a creative prompt. We'll handle the rest."
  >
    {children}
  </StepFrame>
);
