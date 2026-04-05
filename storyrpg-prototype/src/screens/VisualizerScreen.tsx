import React from 'react';
import { Story } from '../types';
import { StoryBrowser } from '../components/StoryBrowser';

interface VisualizerScreenProps {
  story: Story;
  onBack: () => void;
  onJumpToNode?: (nodeId: string) => void;
}

export const VisualizerScreen: React.FC<VisualizerScreenProps> = ({
  story,
  onBack,
  onJumpToNode,
}) => {
  // StoryBrowser now handles both columns and flow map views internally
  return (
    <StoryBrowser 
      story={story} 
      onClose={onBack} 
      onJumpToNode={onJumpToNode}
    />
  );
};

export default VisualizerScreen;
