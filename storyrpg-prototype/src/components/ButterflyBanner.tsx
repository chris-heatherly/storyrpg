import React, { useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Animated, Platform, TouchableOpacity } from 'react-native';
import { Consequence } from '../types';
import { haptics } from '../utils/haptics';
import { TERMINAL, TIMING, withAlpha } from '../theme';

interface ButterflyItem {
  description: string;
  consequence: Consequence;
}

interface ButterflyBannerProps {
  items: ButterflyItem[];
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 5500;
const useNative = Platform.OS !== 'web';

export const ButterflyBanner: React.FC<ButterflyBannerProps> = ({ items, onDismiss }) => {
  const slideAnim = useRef(new Animated.Value(-80)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    haptics.heavy();
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: 0, duration: TIMING.banner, useNativeDriver: useNative }),
      Animated.timing(opacityAnim, { toValue: 1, duration: TIMING.banner, useNativeDriver: useNative }),
    ]).start();

    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: -80, duration: TIMING.slow, useNativeDriver: useNative }),
        Animated.timing(opacityAnim, { toValue: 0, duration: TIMING.slow, useNativeDriver: useNative }),
      ]).start(() => onDismiss());
    }, AUTO_DISMISS_MS);

    return () => clearTimeout(timer);
  }, []);

  return (
    <Animated.View
      style={[
        styles.container,
        { opacity: opacityAnim, transform: [{ translateY: slideAnim }] },
        { pointerEvents: 'box-only' as const },
      ]}
    >
      <TouchableOpacity style={styles.inner} onPress={onDismiss} activeOpacity={0.8}>
        <View style={styles.accentLine} />
        <Text style={styles.header}>Your past choices echo forward...</Text>
        {items.map((item, i) => (
          <View key={i}>
            <Text style={styles.description}>{item.description}</Text>
          </View>
        ))}
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 70,
  },
  inner: {
    backgroundColor: 'rgba(20, 16, 8, 0.95)',
    borderBottomWidth: 1,
    borderBottomColor: withAlpha(TERMINAL.colors.amber, 0.4),
    paddingTop: 48,
    paddingBottom: 16,
    paddingHorizontal: 24,
  },
  accentLine: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: TERMINAL.colors.amber,
  },
  header: {
    color: TERMINAL.colors.amberLight,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.5,
    fontStyle: 'italic',
    marginBottom: 6,
  },
  description: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 13,
    fontStyle: 'italic',
    lineHeight: 18,
    marginTop: 2,
  },
});
