import React, { useRef, useEffect } from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  View,
  Animated,
  Platform,
} from 'react-native';
import {
  Activity,
  Brain,
  ChevronRight,
  Clover,
  Compass,
  Drama,
  Eye,
  Flame,
  Footprints,
  HandHeart,
  Handshake,
  Heart,
  Lightbulb,
  Lock,
  MessageCircle,
  Move,
  Pickaxe,
  ScanEye,
  Search,
  Shield,
  Sparkles,
  Star,
  Sword,
  Target,
  Telescope,
  UserCheck,
  Users,
  VenetianMask,
  Zap,
  type LucideIcon,
} from 'lucide-react-native';
import { ProcessedChoice } from '../engine/storyEngine';
import { TERMINAL, RADIUS, TIMING, SPACING, withAlpha } from '../theme';
import { useSettingsStore } from '../stores/settingsStore';
import {
  getSkillIconName,
  shouldShowChoiceSkillReadout,
  type ChoiceSkillIconName,
} from '../utils/choiceSkillDisplay';

const SKILL_ICONS: Record<ChoiceSkillIconName, LucideIcon> = {
  activity: Activity,
  brain: Brain,
  clover: Clover,
  compass: Compass,
  drama: Drama,
  eye: Eye,
  flame: Flame,
  footprints: Footprints,
  'hand-heart': HandHeart,
  handshake: Handshake,
  heart: Heart,
  lightbulb: Lightbulb,
  'message-circle': MessageCircle,
  move: Move,
  pickaxe: Pickaxe,
  'scan-eye': ScanEye,
  search: Search,
  shield: Shield,
  sparkles: Sparkles,
  target: Target,
  telescope: Telescope,
  'user-check': UserCheck,
  users: Users,
  'venetian-mask': VenetianMask,
  zap: Zap,
};

interface ChoiceButtonProps {
  choice: ProcessedChoice;
  index: number;
  onPress: (choiceId: string) => void;
  disabled?: boolean;
  isSelected?: boolean;
  isDeselected?: boolean;
  /** 'standard' shows icon + chevron; 'minimal' is text-only centered */
  variant?: 'standard' | 'minimal';
}

export const ChoiceButton: React.FC<ChoiceButtonProps> = ({
  choice,
  index,
  onPress,
  disabled = false,
  isSelected = false,
  isDeselected = false,
  variant = 'standard',
}) => {
  const isMinimal = variant === 'minimal';
  const fonts = useSettingsStore((state) => state.getFontSizes());
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;

  const isDisabled = disabled || choice.isLocked;
  const useNative = Platform.OS !== 'web';
  const showSkillReadout = shouldShowChoiceSkillReadout(choice);
  const skillIconName = getSkillIconName(choice.primarySkillKey);
  const SkillIcon = SKILL_ICONS[skillIconName] ?? Activity;
  const accessibilityHint = choice.isLocked && choice.lockedReason
    ? `Locked: ${choice.lockedReason}`
    : showSkillReadout
      ? 'This option draws on what your character can read from the moment.'
      : undefined;

  useEffect(() => {
    if (isSelected) {
      Animated.parallel([
        Animated.timing(scaleAnim, { toValue: 1.03, duration: TIMING.fast, useNativeDriver: useNative }),
        Animated.timing(glowAnim, { toValue: 1, duration: TIMING.fast, useNativeDriver: false }),
      ]).start();
    } else if (isDeselected) {
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 0, duration: TIMING.normal, useNativeDriver: useNative }),
        Animated.timing(slideAnim, { toValue: 8, duration: TIMING.normal, useNativeDriver: useNative }),
      ]).start();
    }
  }, [isSelected, isDeselected]);

  const handlePressIn = () => {
    if (isSelected || isDeselected) return;
    Animated.timing(scaleAnim, { toValue: 0.97, duration: TIMING.instant, useNativeDriver: useNative }).start();
  };
  const handlePressOut = () => {
    if (isSelected || isDeselected) return;
    Animated.timing(scaleAnim, { toValue: 1, duration: TIMING.instant, useNativeDriver: useNative }).start();
  };

  const getIcon = () => {
    if (choice.isLocked) return <Lock size={14} color={TERMINAL.colors.muted} />;
    if (showSkillReadout) {
      return (
        <View style={styles.skillReadout}>
          <View style={styles.skillValueRow}>
            <SkillIcon size={26} color={TERMINAL.colors.primary} />
          </View>
        </View>
      );
    }
    return <Sword size={14} color={TERMINAL.colors.primary} />;
  };

  const selectedBorderColor = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(255, 255, 255, 0.05)', withAlpha(TERMINAL.colors.primary, 0.6)],
  });

  return (
    <Animated.View style={{
      transform: [{ scale: scaleAnim }, { translateY: slideAnim }],
      marginBottom: 8,
      opacity: fadeAnim,
    }}>
      <TouchableOpacity
        style={[
          styles.container,
          isMinimal && styles.containerMinimal,
          isDisabled && styles.containerDisabled,
        ]}
        onPress={() => !isDisabled && onPress(choice.id)}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={0.85}
        disabled={isDisabled || isSelected || isDeselected}
        accessibilityRole="button"
        accessibilityLabel={choice.text}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: isDisabled, selected: isSelected }}
        testID={`choice-${choice.id}`}
      >
        <Animated.View style={[
          StyleSheet.absoluteFill,
          styles.glowOverlay,
          { borderColor: selectedBorderColor },
          { pointerEvents: 'none' as const },
        ]} />

        {!isMinimal && (
          <View style={[styles.iconContainer, isDisabled && styles.iconContainerDisabled]}>
            {getIcon()}
          </View>
        )}

        <View style={isMinimal ? styles.textContainerMinimal : styles.textContainer}>
          <Text style={[
            styles.choiceText,
            isMinimal && styles.choiceTextMinimal,
            { fontSize: fonts.medium },
            isDisabled && styles.choiceTextDisabled
          ]}>
            {choice.text}
          </Text>
          {choice.isLocked && choice.lockedReason && (
            <Text style={[styles.lockedReason, { fontSize: fonts.small }]}>
              {choice.lockedReason.toUpperCase()}
            </Text>
          )}
          {!isMinimal && !isDisabled && choice.hasAdvantage && choice.advantageText && (
            <View style={styles.advantagePill}>
              <Star size={8} color={TERMINAL.colors.successLight} style={{ marginRight: 3 }} />
              <Text style={[styles.advantagePillText, { fontSize: fonts.small }]}>{choice.advantageText}</Text>
            </View>
          )}
        </View>

        {!isMinimal && !isDisabled && (
          <ChevronRight size={14} color={TERMINAL.colors.muted} />
        )}
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    paddingVertical: SPACING.buttonV,
    paddingHorizontal: SPACING.choiceH,
    borderRadius: RADIUS.choice,
    gap: 16,
    overflow: 'hidden',
    minHeight: 44,
  },
  glowOverlay: {
    borderWidth: 2,
    borderRadius: RADIUS.choice,
    borderColor: 'transparent',
  },
  containerMinimal: {
    justifyContent: 'center',
    gap: 0,
  },
  containerDisabled: {
    opacity: 0.5,
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  iconContainer: {
    width: 62,
    minHeight: 46,
    borderRadius: RADIUS.badge,
    backgroundColor: withAlpha(TERMINAL.colors.primary, 0.1),
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: withAlpha(TERMINAL.colors.primary, 0.2),
    paddingHorizontal: 4,
    paddingVertical: 5,
  },
  iconContainerDisabled: {
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  textContainer: {
    flex: 1,
  },
  textContainerMinimal: {
    flex: 1,
    alignItems: 'center',
  },
  choiceTextMinimal: {
    textAlign: 'center',
  },
  choiceText: {
    fontFamily: 'System',
    color: 'white',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  choiceTextDisabled: {
    color: TERMINAL.colors.muted,
  },
  lockedReason: {
    fontFamily: 'System',
    color: TERMINAL.colors.amber,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1,
    marginTop: 4,
  },
  skillReadout: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  skillValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  advantagePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: withAlpha(TERMINAL.colors.success, 0.12),
    borderWidth: 1,
    borderColor: withAlpha(TERMINAL.colors.success, 0.3),
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: RADIUS.pill,
    alignSelf: 'flex-start',
    marginTop: 3,
  },
  advantagePillText: {
    color: TERMINAL.colors.successLight,
    fontSize: 9,
    fontWeight: '600',
    fontStyle: 'italic',
  },
});
