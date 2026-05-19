import { create } from 'zustand';

export type AppScreen = 'home' | 'login' | 'episodes' | 'reading' | 'settings' | 'visualizer' | 'generator';

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
  generatorSeasonPlanId?: string;
  generatorOrigin: GeneratorOrigin;
  navigateTo: (screen: AppScreen) => void;
  openPauseMenu: () => void;
  closePauseMenu: () => void;
  openVisualizer: (storyId: string) => void;
  closeVisualizer: () => void;
  openGenerator: (jobId?: string, origin?: GeneratorOrigin, seasonPlanId?: string) => void;
  closeGenerator: (nextScreen?: AppScreen) => void;
  /** Clear in-app routes after sign-out (avoids stale screen when session is restored). */
  resetAfterLogout: () => void;
}

export const useAppNavigationStore = create<AppNavigationState>((set, get) => ({
  currentScreen: 'home',
  showPauseMenu: false,
  visualizerStoryId: null,
  resumeJobId: undefined,
  generatorSeasonPlanId: undefined,
  generatorOrigin: 'home',
  navigateTo: (screen) => set({ currentScreen: screen }),
  openPauseMenu: () => set({ showPauseMenu: true }),
  closePauseMenu: () => set({ showPauseMenu: false }),
  openVisualizer: (storyId) => set({ visualizerStoryId: storyId, currentScreen: 'visualizer' }),
  closeVisualizer: () => set({ visualizerStoryId: null, currentScreen: 'settings' }),
<<<<<<< HEAD
  openGenerator: (jobId, origin, seasonPlanId) => {
    // Infer origin from the screen the user is currently on if not explicitly
    // provided, so back-nav always returns them to where they came from.
    const current = get().currentScreen;
    const inferred: GeneratorOrigin = origin
      || (current === 'home' || current === 'settings' ? current : 'home');
    set({
      resumeJobId: jobId,
      generatorSeasonPlanId: seasonPlanId,
      generatorOrigin: inferred,
      currentScreen: 'generator',
    });
  },
  closeGenerator: (nextScreen) => {
    const origin = get().generatorOrigin;
    set({ resumeJobId: undefined, generatorSeasonPlanId: undefined, currentScreen: nextScreen || origin });
  },
=======
  openGenerator: (jobId) => set({ resumeJobId: jobId, currentScreen: 'generator' }),
  closeGenerator: (nextScreen = 'settings') => set({ resumeJobId: undefined, currentScreen: nextScreen }),
  resetAfterLogout: () =>
    set({
      currentScreen: 'home',
      showPauseMenu: false,
      visualizerStoryId: null,
      resumeJobId: undefined,
    }),
>>>>>>> 48904bb (Add database-backed authentication and login-first web flow)
}));
