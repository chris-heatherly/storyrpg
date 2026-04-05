import React from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Text,
  Platform,
} from 'react-native';
import { StoryReader } from '../components/StoryReader';
import { useGamePlayerState, useGameStoryState } from '../stores/gameStore';
import { useSettingsStore } from '../stores/settingsStore';
import { TERMINAL } from '../theme';

interface ReadingScreenProps {
  onEpisodeComplete: () => void;
  onPause: () => void;
}

export const ReadingScreen: React.FC<ReadingScreenProps> = ({
  onEpisodeComplete,
  onPause,
}) => {
  const { currentEpisode } = useGameStoryState();
  const { player } = useGamePlayerState();
  const fonts = useSettingsStore((state) => state.getFontSizes());

  return (
    <View style={styles.container}>
      {/* Minimal overlay header */}
      <View style={styles.headerOverlay}>
        <TouchableOpacity style={styles.pauseButton} onPress={onPause}>
          <View style={styles.pauseButtonBackground}>
            <Text style={[styles.pauseIcon, { fontSize: fonts.small }]}>☰</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Story Reader - full screen */}
      <View style={styles.readerContainer}>
        <StoryReader onEpisodeComplete={onEpisodeComplete} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000', // Match StoryReader background
    width: '100%',
    height: '100%',
  },
  headerOverlay: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 20,
    left: 20,
    zIndex: 1000,
  },
  pauseButton: {
    // Touchable area
  },
  pauseButtonBackground: {
    backgroundColor: 'rgba(10, 10, 10, 0.85)',
    borderRadius: 20,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(51, 255, 51, 0.3)',
  },
  pauseIcon: {
    fontFamily: 'Courier',
    color: TERMINAL.colors.primary,
  },
  readerContainer: {
    flex: 1,
    width: '100%',
    height: '100%',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
