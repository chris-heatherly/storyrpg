import React from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { TERMINAL, RADIUS, SPACING, withAlpha } from '../../theme';

interface ToggleProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  label?: string;
  helperText?: string;
  disabled?: boolean;
  testID?: string;
}

export const Toggle: React.FC<ToggleProps> = ({
  value,
  onValueChange,
  label,
  helperText,
  disabled,
  testID,
}) => {
  const handlePress = () => {
    if (!disabled) onValueChange(!value);
  };

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: !!disabled }}
      accessibilityLabel={label}
      testID={testID}
      style={({ pressed }) => [
        styles.row,
        pressed && !disabled && styles.rowPressed,
        disabled && styles.rowDisabled,
      ]}
    >
      <View style={styles.labelCol}>
        {!!label && <Text style={styles.label}>{label}</Text>}
        {!!helperText && <Text style={styles.helperText}>{helperText}</Text>}
      </View>
      <View style={[styles.track, value && styles.trackOn]}>
        <View style={[styles.thumb, value && styles.thumbOn]} />
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACING.buttonV,
    paddingHorizontal: 4,
    gap: 12,
    minHeight: 44,
  },
  rowPressed: {
    opacity: 0.7,
  },
  rowDisabled: {
    opacity: 0.4,
  },
  labelCol: {
    flex: 1,
    gap: 2,
  },
  label: {
    color: TERMINAL.colors.textStrong,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  helperText: {
    color: TERMINAL.colors.mutedLight,
    fontSize: 11,
    lineHeight: 15,
  },
  track: {
    width: 44,
    height: 24,
    borderRadius: 12,
    backgroundColor: withAlpha('#ffffff', 0.12),
    borderWidth: 1,
    borderColor: withAlpha('#ffffff', 0.18),
    justifyContent: 'center',
    paddingHorizontal: 2,
    ...Platform.select({
      web: { transition: 'background-color 180ms ease, border-color 180ms ease' } as any,
      default: {},
    }),
  },
  trackOn: {
    backgroundColor: withAlpha(TERMINAL.colors.primary, 0.35),
    borderColor: withAlpha(TERMINAL.colors.primary, 0.55),
  },
  thumb: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: TERMINAL.colors.textLight,
    ...Platform.select({
      web: { transition: 'transform 180ms ease, background-color 180ms ease' } as any,
      default: {},
    }),
  },
  thumbOn: {
    transform: [{ translateX: 20 }],
    backgroundColor: TERMINAL.colors.primaryLight,
  },
});
