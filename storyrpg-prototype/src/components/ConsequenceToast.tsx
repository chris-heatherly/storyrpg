import React, { useRef, useEffect } from 'react';
import { View, StyleSheet, Animated, Platform } from 'react-native';
import { AppliedConsequence } from '../types';
import { ConsequenceBadgeList } from './ConsequenceBadgeList';
import { TIMING } from '../theme';

interface ConsequenceToastProps {
  consequences: AppliedConsequence[];
  onDismiss?: () => void;
}

const DISPLAY_DURATION_MS = 3600;
const FADE_OUT_MS = TIMING.slow;
const useNative = Platform.OS !== 'web';

export const ConsequenceToast: React.FC<ConsequenceToastProps> = ({
  consequences,
  onDismiss,
}) => {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const timer = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: FADE_OUT_MS,
        useNativeDriver: useNative,
      }).start(() => onDismiss?.());
    }, DISPLAY_DURATION_MS);
    return () => clearTimeout(timer);
  }, []);

  const visible = consequences.filter(c => c.type !== 'flag');
  if (visible.length === 0) {
    onDismiss?.();
    return null;
  }

  return (
    <Animated.View style={[styles.container, { opacity }]}>
      <ConsequenceBadgeList consequences={visible} staggerDelay={80} />
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 8,
  },
});
