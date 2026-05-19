import React from 'react';
import { Story } from '../types';
import { StoryVisualizer } from '../visualizer';

interface VisualizerScreenProps {
  story: Story;
  onBack: () => void;
  onJumpToNode?: (nodeId: string) => void;
}

export const VisualizerScreen: React.FC<VisualizerScreenProps> = ({
  story,
  onBack,
}) => {
  return <StoryVisualizer story={story} onBack={onBack} />;
};

export default VisualizerScreen;
