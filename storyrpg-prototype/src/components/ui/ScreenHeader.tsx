import React from 'react';
import { View, Text, Pressable, StyleSheet, Platform, StyleProp, ViewStyle } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';
import { TERMINAL, withAlpha } from '../../theme';

interface ScreenHeaderProps {
  title: string;
  eyebrow?: string;
  onBack?: () => void;
  backLabel?: string;
  trailing?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({
  title,
  eyebrow,
  onBack,
  backLabel = 'Back',
  trailing,
  style,
}) => {
  return (
    <View style={[styles.container, style]}>
      <View style={styles.topRow}>
        {onBack ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel={backLabel}
            style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
          >
            <ArrowLeft size={16} color={TERMINAL.colors.textLight} />
            <Text style={styles.backText}>{backLabel.toUpperCase()}</Text>
          </Pressable>
        ) : <View style={{ width: 1 }} />}
        {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      </View>
      {!!eyebrow && <Text style={styles.eyebrow}>{eyebrow}</Text>}
      <Text style={styles.title} accessibilityRole="header">{title}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 8,
    paddingBottom: 16,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: withAlpha('#ffffff', 0.12),
    backgroundColor: withAlpha('#ffffff', 0.03),
    ...Platform.select({
      web: { cursor: 'pointer' as any },
      default: {},
    }),
  },
  backButtonPressed: {
    opacity: 0.6,
  },
  backText: {
    color: TERMINAL.colors.textLight,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  trailing: {
    alignItems: 'flex-end',
  },
  eyebrow: {
    color: TERMINAL.colors.primaryLight,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  title: {
    color: TERMINAL.colors.textStrong,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
});
