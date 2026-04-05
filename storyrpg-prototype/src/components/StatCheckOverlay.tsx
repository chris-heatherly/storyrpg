import React, { useRef, useEffect, useState } from 'react';
import { Text, StyleSheet, Animated, Platform } from 'react-native';
import { TERMINAL, TIMING, TIER_COLORS, type OutcomeTier } from '../theme';
import { haptics } from '../utils/haptics';

interface StatCheckOverlayProps {
  skillName: string;
  tier: OutcomeTier;
  onComplete: () => void;
}

const useNative = Platform.OS !== 'web';

export const StatCheckOverlay: React.FC<StatCheckOverlayProps> = ({
  skillName,
  tier,
  onComplete,
}) => {
  const skillOpacity = useRef(new Animated.Value(0)).current;
  const tintOpacity = useRef(new Animated.Value(0)).current;
  const [phase, setPhase] = useState<'skill' | 'tint' | null>('skill');

  useEffect(() => {
    haptics.light();

    Animated.timing(skillOpacity, {
      toValue: 1, duration: TIMING.normal, useNativeDriver: useNative,
    }).start(() => {
      setTimeout(() => {
        Animated.timing(skillOpacity, {
          toValue: 0, duration: TIMING.fast, useNativeDriver: useNative,
        }).start(() => {
          setPhase('tint');
          if (tier === 'success') haptics.success();
          else if (tier === 'failure') haptics.warning();

          Animated.sequence([
            Animated.timing(tintOpacity, {
              toValue: 0.35, duration: TIMING.fast, useNativeDriver: useNative,
            }),
            Animated.timing(tintOpacity, {
              toValue: 0, duration: TIMING.slow, useNativeDriver: useNative,
            }),
          ]).start(() => {
            setPhase(null);
            onComplete();
          });
        });
      }, 500);
    });
  }, []);

  return (
    <>
      {phase === 'skill' && (
        <Animated.View style={[styles.overlay, { opacity: skillOpacity }, { pointerEvents: 'none' as const }]}>
          <Text style={styles.skillText}>
            {skillName.split('').join(' ')}
          </Text>
        </Animated.View>
      )}
      {phase === 'tint' && (
        <Animated.View
          style={[
            styles.tint,
            { opacity: tintOpacity, backgroundColor: TIER_COLORS[tier] },
            { pointerEvents: 'none' as const },
          ]}
        />
      )}
    </>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 60,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  skillText: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 8,
  },
  tint: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 55,
  },
});
