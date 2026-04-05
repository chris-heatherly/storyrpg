import React, { useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Animated, Platform } from 'react-native';
import { AppliedConsequence } from '../types';
import { TERMINAL, RADIUS, TIMING, withAlpha } from '../theme';

interface ConsequenceBadgeListProps {
  consequences: AppliedConsequence[];
  staggerDelay?: number;
  layout?: 'stack' | 'inline';
  animated?: boolean;
  maxVisible?: number;
}

const BADGE_STAGGER_MS = 150;
const useNative = Platform.OS !== 'web';

const ARROW_MAP: Record<string, string> = {
  up: '\u25B2',
  down: '\u25BC',
  neutral: '\u25C6',
};

const COLOR_MAP: Record<string, string> = {
  up: TERMINAL.colors.success,
  down: TERMINAL.colors.error,
  neutral: TERMINAL.colors.mutedLight,
};

const BORDER_MAP: Record<string, string> = {
  up: withAlpha(TERMINAL.colors.success, 0.4),
  down: withAlpha(TERMINAL.colors.error, 0.4),
  neutral: 'rgba(255, 255, 255, 0.2)',
};

const BadgeRow: React.FC<{
  item: AppliedConsequence;
  delay: number;
  animated: boolean;
  compact: boolean;
}> = ({ item, delay, animated, compact }) => {
  const opacity = useRef(new Animated.Value(animated ? 0 : 1)).current;
  const translateX = useRef(new Animated.Value(animated ? 20 : 0)).current;

  useEffect(() => {
    if (!animated) return;
    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: TIMING.normal, useNativeDriver: useNative }),
        Animated.timing(translateX, { toValue: 0, duration: TIMING.normal, useNativeDriver: useNative }),
      ]).start();
    }, delay);
    return () => clearTimeout(timer);
  }, [delay, animated]);

  return (
    <Animated.View style={[
      styles.row,
      { borderColor: BORDER_MAP[item.direction] },
      { opacity, transform: [{ translateX }] },
    ]}>
      <Text style={[styles.arrow, { color: COLOR_MAP[item.direction] }]}>
        {ARROW_MAP[item.direction]}
      </Text>
      {compact ? (
        <Text style={styles.label}>{item.narrativeHint || item.label}</Text>
      ) : (
        <>
          <Text style={styles.label}>{item.label}</Text>
          {item.narrativeHint && (
            <Text style={styles.hint} numberOfLines={1}>{item.narrativeHint}</Text>
          )}
        </>
      )}
    </Animated.View>
  );
};

export const ConsequenceBadgeList: React.FC<ConsequenceBadgeListProps> = ({
  consequences,
  staggerDelay = BADGE_STAGGER_MS,
  layout = 'stack',
  animated = true,
  maxVisible = 5,
}) => {
  const visible = consequences
    .filter(c => c.type !== 'flag')
    .sort((a, b) => Number(!!b.linger) - Number(!!a.linger));
  if (visible.length === 0) return null;

  const isInline = layout === 'inline';

  return (
    <View style={isInline ? styles.containerInline : styles.container}>
      {visible.slice(0, maxVisible).map((item, i) => (
        <BadgeRow
          key={`${item.type}-${item.label}-${i}`}
          item={item}
          delay={animated ? i * staggerDelay : 0}
          animated={animated}
          compact={isInline}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginTop: 12,
    gap: 8,
  },
  containerInline: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderRadius: RADIUS.button,
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 10,
  },
  arrow: {
    fontSize: 13,
    fontWeight: '900',
    width: 18,
    textAlign: 'center',
  },
  label: {
    color: TERMINAL.colors.textLight,
    fontSize: 14,
    fontWeight: '700',
  },
  hint: {
    color: 'rgba(255, 255, 255, 0.55)',
    fontSize: 13,
    fontStyle: 'italic',
    flex: 1,
  },
});
