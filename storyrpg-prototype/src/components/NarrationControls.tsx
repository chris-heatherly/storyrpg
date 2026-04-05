/**
 * Narration Controls Component
 * Provides audio playback controls for story narration
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Play, Pause, SkipForward, Volume2 } from 'lucide-react-native';
import { TERMINAL } from '../theme';

interface NarrationControlsProps {
  isPlaying: boolean;
  onPlayPause: () => void;
  onSkip?: () => void;
  disabled?: boolean;
  currentTime?: number;
  duration?: number;
}

export const NarrationControls: React.FC<NarrationControlsProps> = ({
  isPlaying,
  onPlayPause,
  onSkip,
  disabled = false,
  currentTime = 0,
  duration = 0,
}) => {
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <View style={styles.container}>
      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.playButton, disabled && styles.disabled]}
          onPress={onPlayPause}
          disabled={disabled}
        >
          {isPlaying ? (
            <Pause size={20} color="white" />
          ) : (
            <Play size={20} color="white" />
          )}
        </TouchableOpacity>

        {onSkip && (
          <TouchableOpacity
            style={[styles.skipButton, disabled && styles.disabled]}
            onPress={onSkip}
            disabled={disabled}
          >
            <SkipForward size={16} color={TERMINAL.colors.muted} />
          </TouchableOpacity>
        )}

        <Volume2 size={14} color={TERMINAL.colors.muted} style={styles.volumeIcon} />
      </View>

      {duration > 0 && (
        <View style={styles.timeContainer}>
          <Text style={styles.timeText}>
            {formatTime(currentTime)} / {formatTime(duration)}
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: 8,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  playButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: TERMINAL.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  volumeIcon: {
    marginLeft: 8,
  },
  disabled: {
    opacity: 0.5,
  },
  timeContainer: {
    marginLeft: 12,
  },
  timeText: {
    color: TERMINAL.colors.muted,
    fontSize: 11,
    fontFamily: 'monospace',
  },
});

export default NarrationControls;
