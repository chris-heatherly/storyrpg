import { Platform, Vibration } from 'react-native';

/**
 * Lightweight haptic feedback utility.
 * Uses the Web Vibration API when available, no-ops otherwise.
 * No native dependency required -- works on web browsers that support navigator.vibrate.
 */

const isWeb = Platform.OS === 'web';

function vibrate(pattern: number | number[]) {
  if (isWeb) {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(pattern);
    }
    return;
  }

  Vibration.vibrate(pattern);
}

export const haptics = {
  /** Medium impact -- choice selection */
  selection: () => vibrate(15),

  /** Light tap -- badge appearing, stat check pulse */
  light: () => vibrate(8),

  /** Success pattern */
  success: () => vibrate([10, 30, 10]),

  /** Warning/error pattern */
  warning: () => vibrate([20, 20, 40]),

  /** Heavy impact -- butterfly effect */
  heavy: () => vibrate([30, 20, 50]),
};
