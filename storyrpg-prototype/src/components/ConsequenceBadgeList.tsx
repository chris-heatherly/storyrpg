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
  /** `badge` = bordered chip (default). `plain` = text only, for panels that already have a frame. */
  variant?: 'badge' | 'plain';
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

// Two-line, left-aligned badge: line 1 is the fiction-first consequence
// (narrativeHint), line 2 is the succinct game impact (direction + label).
// The story text tells the story; this is compact gameplay feedback.
const BadgeRow: React.FC<{
  item: AppliedConsequence;
  delay: number;
  animated: boolean;
  variant: 'badge' | 'plain';
}> = ({ item, delay, animated, variant }) => {
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
      variant === 'badge' ? styles.row : styles.rowPlain,
      variant === 'badge' && { borderColor: BORDER_MAP[item.direction] },
      { opacity, transform: [{ translateX }] },
    ]}>
      {!!item.narrativeHint && (
        <Text style={styles.hint} numberOfLines={1}>{item.narrativeHint}</Text>
      )}
      <View style={styles.impactLine}>
        <Text style={[styles.arrow, { color: COLOR_MAP[item.direction] }]}>
          {ARROW_MAP[item.direction]}
        </Text>
        <Text style={styles.label} numberOfLines={1}>{item.label}</Text>
      </View>
    </Animated.View>
  );
};

export const ConsequenceBadgeList: React.FC<ConsequenceBadgeListProps> = ({
  consequences,
  staggerDelay = BADGE_STAGGER_MS,
  layout = 'stack',
  animated = true,
  maxVisible = 5,
  variant = 'badge',
}) => {
  const visible = consequences
    .filter(c => c.type !== 'flag')
    .sort((a, b) => Number(!!b.linger) - Number(!!a.linger));
  if (visible.length === 0) return null;

  const isInline = layout === 'inline';
  const containerStyle = variant === 'plain'
    ? (isInline ? styles.containerInlinePlain : styles.containerPlain)
    : (isInline ? styles.containerInline : styles.container);

  return (
    <View style={containerStyle}>
      {visible.slice(0, maxVisible).map((item, i) => (
        <BadgeRow
          key={`${item.type}-${item.label}-${i}`}
          item={item}
          delay={animated ? i * staggerDelay : 0}
          animated={animated}
          variant={variant}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginTop: 12,
    gap: 6,
    alignItems: 'flex-start',
  },
  containerInline: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 12,
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
  },
  containerPlain: {
    gap: 4,
    alignItems: 'flex-start',
  },
  containerInlinePlain: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 4,
  },
  row: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderRadius: RADIUS.button,
    paddingVertical: 6,
    paddingHorizontal: 10,
    gap: 2,
  },
  rowPlain: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 4,
  },
  impactLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  arrow: {
    fontSize: 11,
    fontWeight: '900',
    textAlign: 'left',
  },
  label: {
    color: TERMINAL.colors.textLight,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'left',
  },
  hint: {
    color: 'rgba(255, 255, 255, 0.72)',
    fontSize: 13,
    fontStyle: 'italic',
    textAlign: 'left',
  },
});
