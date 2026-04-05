import React from 'react';
import { Text, Animated, Platform } from 'react-native';
import { sharedStyles, TIER_COLORS, TIER_LABELS, TIMING, type OutcomeTier } from '../theme';

interface OutcomeHeaderProps {
  tier: OutcomeTier;
  context?: 'story' | 'encounter';
  /** Override the default label text for this tier/context */
  text?: string;
  /** Animated.Value controlling entrance (0 -> 1). Omit for static rendering. */
  animValue?: Animated.Value;
  /** Override fontSize for terminal/large outcome screens */
  fontSize?: number;
}

const useNative = Platform.OS !== 'web';

export const OutcomeHeader: React.FC<OutcomeHeaderProps> = ({
  tier,
  context = 'story',
  text,
  animValue,
  fontSize,
}) => {
  const label = text ?? TIER_LABELS[context][tier];
  const color = TIER_COLORS[tier];
  const style = [sharedStyles.outcomeHeader, { color }, fontSize ? { fontSize } : undefined];

  if (animValue) {
    return (
      <Animated.View style={{
        opacity: animValue,
        transform: [{
          translateY: animValue.interpolate({
            inputRange: [0, 1],
            outputRange: [12, 0],
          }),
        }],
      }}>
        <Text style={style}>{label}</Text>
      </Animated.View>
    );
  }

  return <Text style={style}>{label}</Text>;
};
