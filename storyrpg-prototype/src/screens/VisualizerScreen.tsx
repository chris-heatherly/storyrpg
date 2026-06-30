import React from 'react';
import { Story } from '../types';
import { StoryVisualizer } from '../visualizer';

interface VisualizerScreenProps {
  story: Story;
  onBack: () => void;
  onJumpToNode?: (nodeId: string) => void;
  onStoryUpdated?: (story: Story) => void;
}

export const VisualizerScreen: React.FC<VisualizerScreenProps> = ({
  story,
  onBack,
  onStoryUpdated,
}) => {
  return <StoryVisualizer story={story} onBack={onBack} onStoryUpdated={onStoryUpdated} />;
};

export default VisualizerScreen;
