import React from 'react';
import { View, Text, Pressable, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { TERMINAL, RADIUS, withAlpha } from '../../theme';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  testID?: string;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  testID?: string;
  ariaLabel?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  style,
  disabled,
  testID,
  ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <View
      style={[styles.container, style]}
      accessibilityRole="tablist"
      accessibilityLabel={ariaLabel}
      testID={testID}
    >
      {options.map(opt => {
        const selected = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => {
              if (!disabled) onChange(opt.value);
            }}
            disabled={disabled}
            accessibilityRole="tab"
            accessibilityState={{ selected, disabled: !!disabled }}
            accessibilityLabel={opt.label}
            testID={opt.testID}
            style={({ pressed }) => [
              styles.segment,
              selected && styles.segmentSelected,
              pressed && !disabled && !selected && styles.segmentPressed,
              disabled && styles.segmentDisabled,
            ]}
          >
            <Text style={[styles.label, selected && styles.labelSelected]}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderRadius: RADIUS.button,
    borderWidth: 1,
    borderColor: withAlpha('#ffffff', 0.15),
    backgroundColor: withAlpha('#ffffff', 0.04),
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: RADIUS.small,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
  },
  segmentSelected: {
    backgroundColor: withAlpha(TERMINAL.colors.primary, 0.25),
    borderWidth: 1,
    borderColor: withAlpha(TERMINAL.colors.primary, 0.45),
  },
  segmentPressed: {
    backgroundColor: withAlpha('#ffffff', 0.06),
  },
  segmentDisabled: {
    opacity: 0.4,
  },
  label: {
    color: TERMINAL.colors.textLight,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  labelSelected: {
    color: TERMINAL.colors.primaryLight,
  },
});
