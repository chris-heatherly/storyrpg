import React, { ReactNode, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { FONT_SIZES, type FontSize } from './settingsStore';

interface GeneratorSettingsStoreState {
  fontSize: FontSize;
  setFontSize: (size: FontSize) => void;
  getFontSizes: () => (typeof FONT_SIZES)[FontSize];
  developerMode: boolean;
  setDeveloperMode: (enabled: boolean) => void;
  isLoaded: boolean;
  initialize: () => Promise<void>;
}

const STORAGE_KEY = 'storyrpg-generator-settings:v1';
const LEGACY_STORAGE_KEY = 'storyrpg-settings';

type StoredSettings = {
  state?: {
    fontSize?: FontSize;
    developerMode?: boolean;
  };
};

async function persistSettings(state: Pick<GeneratorSettingsStoreState, 'fontSize' | 'developerMode'>): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ state }));
}

export const useGeneratorSettingsStore = create<GeneratorSettingsStoreState>((set, get) => ({
  fontSize: 'medium',
  developerMode: false,
  isLoaded: false,
  setFontSize: (size) => {
    set({ fontSize: size });
    void persistSettings({
      fontSize: size,
      developerMode: get().developerMode,
    });
  },
  getFontSizes: () => FONT_SIZES[get().fontSize],
  setDeveloperMode: (enabled) => {
    set({ developerMode: enabled });
    void persistSettings({
      fontSize: get().fontSize,
      developerMode: enabled,
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
        const next = {
          fontSize: parsed.state?.fontSize || 'medium',
          developerMode: parsed.state?.developerMode ?? false,
        };
        set({ ...next, isLoaded: true });
        if (!storedValue) {
          await persistSettings(next);
        }
        return;
      }
    } catch {
      // Fall through to defaults.
    }

    set({ isLoaded: true });
  },
}));

export const GeneratorSettingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const initialize = useGeneratorSettingsStore((state) => state.initialize);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  return React.createElement(React.Fragment, null, children);
};
