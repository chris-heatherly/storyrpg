import { create } from 'zustand';

export type AppScreen = 'home' | 'episodes' | 'reading' | 'settings' | 'visualizer' | 'generator' | 'recap';

/**
 * Screens that are valid "launch origins" for the generator — the screen the
 * user was on when they opened the generator, which is where Back should
 * return them.
 */
export type GeneratorOrigin = Extract<AppScreen, 'home' | 'settings'>;

interface AppNavigationState {
  currentScreen: AppScreen;
  showPauseMenu: boolean;
  visualizerStoryId: string | null;
  resumeJobId?: string;
  generatorOrigin: GeneratorOrigin;
  navigateTo: (screen: AppScreen) => void;
  openPauseMenu: () => void;
  closePauseMenu: () => void;
  openVisualizer: (storyId: string) => void;
  closeVisualizer: () => void;
  openGenerator: (jobId?: string, origin?: GeneratorOrigin) => void;
  closeGenerator: (nextScreen?: AppScreen) => void;
}

export const useAppNavigationStore = create<AppNavigationState>((set, get) => ({
  currentScreen: 'home',
  showPauseMenu: false,
  visualizerStoryId: null,
  resumeJobId: undefined,
  generatorOrigin: 'home',
  navigateTo: (screen) => set({ currentScreen: screen }),
  openPauseMenu: () => set({ showPauseMenu: true }),
  closePauseMenu: () => set({ showPauseMenu: false }),
  openVisualizer: (storyId) => set({ visualizerStoryId: storyId, currentScreen: 'visualizer' }),
  closeVisualizer: () => set({ visualizerStoryId: null, currentScreen: 'settings' }),
  openGenerator: (jobId, origin) => {
    // Infer origin from the screen the user is currently on if not explicitly
    // provided, so back-nav always returns them to where they came from.
    const current = get().currentScreen;
    const inferred: GeneratorOrigin = origin
      || (current === 'home' || current === 'settings' ? current : 'home');
    set({ resumeJobId: jobId, generatorOrigin: inferred, currentScreen: 'generator' });
  },
  closeGenerator: (nextScreen) => {
    const origin = get().generatorOrigin;
    set({ resumeJobId: undefined, currentScreen: nextScreen || origin });
  },
}));
