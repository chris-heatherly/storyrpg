import { create } from 'zustand';

export type AppScreen = 'home' | 'episodes' | 'reading' | 'settings' | 'visualizer' | 'generator';

interface AppNavigationState {
  currentScreen: AppScreen;
  showPauseMenu: boolean;
  visualizerStoryId: string | null;
  resumeJobId?: string;
  navigateTo: (screen: AppScreen) => void;
  openPauseMenu: () => void;
  closePauseMenu: () => void;
  openVisualizer: (storyId: string) => void;
  closeVisualizer: () => void;
  openGenerator: (jobId?: string) => void;
  closeGenerator: (nextScreen?: AppScreen) => void;
}

export const useAppNavigationStore = create<AppNavigationState>((set) => ({
  currentScreen: 'home',
  showPauseMenu: false,
  visualizerStoryId: null,
  resumeJobId: undefined,
  navigateTo: (screen) => set({ currentScreen: screen }),
  openPauseMenu: () => set({ showPauseMenu: true }),
  closePauseMenu: () => set({ showPauseMenu: false }),
  openVisualizer: (storyId) => set({ visualizerStoryId: storyId, currentScreen: 'visualizer' }),
  closeVisualizer: () => set({ visualizerStoryId: null, currentScreen: 'settings' }),
  openGenerator: (jobId) => set({ resumeJobId: jobId, currentScreen: 'generator' }),
  closeGenerator: (nextScreen = 'settings') => set({ resumeJobId: undefined, currentScreen: nextScreen }),
}));
