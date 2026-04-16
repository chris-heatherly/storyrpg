import React from 'react';
import { TouchableOpacity, Text, StyleProp, ViewStyle, Platform } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { sharedStyles } from '../theme';
import { CONTINUE_COPY } from '../theme/copy';

type CopyKey = keyof typeof CONTINUE_COPY;

interface ContinueButtonProps {
  onPress: () => void;
  /** Pick one of the canonical copy keys. Defaults to 'default' ("CONTINUE"). */
  copyKey?: CopyKey;
  /** Override the canonical copy with an explicit label. */
  label?: string;
  /** Hide the chevron icon (e.g. for storylet-style continue). */
  hideChevron?: boolean;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  testID?: string;
}

export const ContinueButton: React.FC<ContinueButtonProps> = ({
  onPress,
  copyKey = 'default',
  label,
  hideChevron,
  style,
  disabled,
  testID,
}) => {
  const text = label ?? CONTINUE_COPY[copyKey];
  return (
    <TouchableOpacity
      style={[sharedStyles.continueButton, style, disabled && { opacity: 0.5 }]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityState={{ disabled: !!disabled }}
      testID={testID}
      {...(Platform.OS === 'web' ? ({ onClick: disabled ? undefined : onPress } as any) : {})}
    >
      <Text style={sharedStyles.continueText}>{text}</Text>
      {!hideChevron && <ChevronRight size={16} color="white" />}
    </TouchableOpacity>
  );
};
