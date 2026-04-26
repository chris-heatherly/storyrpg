import React, { useEffect, useState } from 'react';
import { Text, StyleSheet, Animated, View, Platform } from 'react-native';
import { TERMINAL, TIMING } from '../theme';
import { useSettingsStore } from '../stores/settingsStore';

interface NarrativeTextProps {
  text: string;
  speaker?: string;
  speakerMood?: string;
  animate?: boolean;
  onAnimationComplete?: () => void;
}

export const NarrativeText: React.FC<NarrativeTextProps> = ({
  text,
  animate = true,
  onAnimationComplete,
}) => {
  const fonts = useSettingsStore((state) => state.getFontSizes());

  const [displayedText, setDisplayedText] = useState(animate ? '' : text);
  const [fadeAnim] = useState(new Animated.Value(animate ? 0 : 1));

  useEffect(() => {
    if (!animate) {
      setDisplayedText(text);
      // CRITICAL FIX: Must call onAnimationComplete even when not animating
      // Otherwise isAnimating stays true and Continue button never appears
      onAnimationComplete?.();
      return;
    }

    setDisplayedText('');

    if (!text) {
      onAnimationComplete?.();
      return;
    }

    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: TIMING.normal,
      useNativeDriver: Platform.OS !== 'web',
    }).start();

    // Typewriter effect
    let currentIndex = 0;
    const interval = setInterval(() => {
      if (currentIndex < text.length) {
        setDisplayedText(text.slice(0, currentIndex + 1));
        currentIndex++;
      } else {
        clearInterval(interval);
        onAnimationComplete?.();
      }
    }, 10); 

    return () => {
      clearInterval(interval);
      // Ensure completion callback is called even if interrupted
      // This prevents getting stuck in an 'isAnimating' state
      if (currentIndex < text.length) {
        onAnimationComplete?.();
      }
    };
  }, [text, animate]);

  const skipAnimation = () => {
    setDisplayedText(text);
    onAnimationComplete?.();
  };

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      <Text
        style={[
          styles.narrativeText,
          { 
            fontSize: fonts.large,
            lineHeight: Math.round(fonts.large * 1.45),
            fontWeight: '500',
            fontStyle: 'normal',
            color: TERMINAL.colors.textBody,
          },
        ]}
        onPress={animate ? skipAnimation : undefined}
      >
        {displayedText}
        {animate && displayedText.length < text.length && (
          <Text style={styles.cursor}>▊</Text>
        )}
      </Text>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  narrativeText: {
    fontFamily: 'System',
    letterSpacing: -0.2,
  },
  cursor: {
    color: TERMINAL.colors.primary,
  },
});
