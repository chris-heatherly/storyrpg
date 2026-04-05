import React, { ReactNode, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

export type FontSize = 'small' | 'medium' | 'large';

interface FontSizeConfig {
  base: number;
  small: number;
  medium: number;
  large: number;
  header: number;
}

export const FONT_SIZES: Record<FontSize, FontSizeConfig> = {
  small: {
    base: 11,
    small: 9,
    medium: 11,
    large: 13,
    header: 16,
  },
  medium: {
    base: 13,
    small: 10,
    medium: 13,
    large: 15,
    header: 18,
  },
  large: {
    base: 15,
    small: 12,
    medium: 15,
    large: 18,
    header: 22,
  },
};

interface SettingsStoreState {
  fontSize: FontSize;
  setFontSize: (size: FontSize) => void;
  getFontSizes: () => FontSizeConfig;
  developerMode: boolean;
  setDeveloperMode: (enabled: boolean) => void;
  preferVideo: boolean;
  setPreferVideo: (enabled: boolean) => void;
  isLoaded: boolean;
  initialize: () => Promise<void>;
}

const STORAGE_KEY = 'storyrpg-settings:v2';
const LEGACY_STORAGE_KEY = 'storyrpg-settings';

type StoredSettings = {
  state?: {
    fontSize?: FontSize;
    developerMode?: boolean;
    preferVideo?: boolean;
  };
};

async function persistSettings(state: Pick<SettingsStoreState, 'fontSize' | 'developerMode' | 'preferVideo'>): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ state }));
}

export const useSettingsStore = create<SettingsStoreState>((set, get) => ({
  fontSize: 'medium',
  developerMode: false,
  preferVideo: true,
  isLoaded: false,
  setFontSize: (size) => {
    set({ fontSize: size });
    void persistSettings({
      fontSize: size,
      developerMode: get().developerMode,
      preferVideo: get().preferVideo,
    });
  },
  getFontSizes: () => FONT_SIZES[get().fontSize],
  setDeveloperMode: (enabled) => {
    set({ developerMode: enabled });
    void persistSettings({
      fontSize: get().fontSize,
      developerMode: enabled,
      preferVideo: get().preferVideo,
    });
  },
  setPreferVideo: (enabled) => {
    set({ preferVideo: enabled });
    void persistSettings({
      fontSize: get().fontSize,
      developerMode: get().developerMode,
      preferVideo: enabled,
    });
  },
  initialize: async () => {
    if (get().isLoaded) return;
    try {
      const [storedValue, legacyValue] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY),
        AsyncStorage.getItem(LEGACY_STORAGE_KEY),
      ]);
      const raw = storedValue || legacyValue;
      if (raw) {
        const parsed = JSON.parse(raw) as StoredSettings;
        set({
          fontSize: parsed.state?.fontSize || 'medium',
          developerMode: parsed.state?.developerMode ?? false,
          preferVideo: parsed.state?.preferVideo ?? true,
          isLoaded: true,
        });
        if (!storedValue) {
          await persistSettings({
            fontSize: parsed.state?.fontSize || 'medium',
            developerMode: parsed.state?.developerMode ?? false,
            preferVideo: parsed.state?.preferVideo ?? true,
          });
        }
        return;
      }
    } catch {
      // Fall through to defaults.
    }

    set({ isLoaded: true });
  },
}));

export const SettingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const initialize = useSettingsStore((state) => state.initialize);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  return React.createElement(React.Fragment, null, children);
};
