/**
 * StepIndicator
 *
 * Wizard-style four-step indicator for the generator flow. Maps the existing
 * `GeneratorState` state machine onto the four user-facing wizard steps
 * (Story → Style → Review → Generate) so users get a sense of where they are
 * without us having to rewrite the underlying state machine.
 *
 * This is the StepIndicator component described in Tranche B of the
 * generator-ux-improvements plan.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Check } from 'lucide-react-native';
import { TERMINAL } from '../../theme';

export type GeneratorWizardStep = 'story' | 'style' | 'review' | 'generate';

// Maps the raw generator state to a wizard step. The config/idle states are
// treated as the Story step; analysis states map to Review; running/checkpoint
// map to Generate; complete also resolves to Generate so the last pip lights
// up and reads "Done" visually.
export const deriveWizardStep = (
  state:
    | 'idle'
    | 'config'
    | 'analyzing'
    | 'analysis_complete'
    | 'running'
    | 'checkpoint'
    | 'complete'
    | 'cancelled'
    | 'error',
  /**
   * Optional sub-step for the config phase. When the user is on the first
   * config screen the caller can pass 'style' to advance the indicator past
   * Story without a state-machine change.
   */
  configSubStep?: GeneratorWizardStep,
): GeneratorWizardStep => {
  switch (state) {
    case 'idle':
    case 'config':
      return configSubStep ?? 'story';
    case 'analyzing':
    case 'analysis_complete':
    case 'checkpoint':
      return 'review';
    case 'running':
    case 'complete':
    case 'cancelled':
    case 'error':
      return 'generate';
    default:
      return 'story';
  }
};

const STEPS: { id: GeneratorWizardStep; label: string }[] = [
  { id: 'story', label: 'STORY' },
  { id: 'style', label: 'STYLE' },
  { id: 'review', label: 'REVIEW' },
  { id: 'generate', label: 'GENERATE' },
];

interface StepIndicatorProps {
  currentStep: GeneratorWizardStep;
  /** When true, the last step renders in success styling instead of active. */
  completed?: boolean;
  /** When true, the last step renders in error styling. */
  errored?: boolean;
}

export const StepIndicator: React.FC<StepIndicatorProps> = ({
  currentStep,
  completed = false,
  errored = false,
}) => {
  const activeIndex = STEPS.findIndex((s) => s.id === currentStep);

  return (
    <View style={styles.container} accessibilityRole="tablist">
      {STEPS.map((step, i) => {
        const isActive = i === activeIndex;
        const isDone = i < activeIndex || (completed && i === STEPS.length - 1);
        const isError = errored && i === STEPS.length - 1;
        const isLast = i === STEPS.length - 1;
        return (
          <React.Fragment key={step.id}>
            <View
              style={styles.stepCell}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={`${step.label} step, ${isDone ? 'completed' : isActive ? 'current' : 'upcoming'}`}
            >
              <View
                style={[
                  styles.pip,
                  isActive && styles.pipActive,
                  isDone && styles.pipDone,
                  isError && styles.pipError,
                ]}
              >
                {isDone ? (
                  <Check size={10} color={TERMINAL.colors.bg} strokeWidth={3} />
                ) : (
                  <Text
                    style={[
                      styles.pipNumber,
                      isActive && styles.pipNumberActive,
                      isError && styles.pipNumberError,
                    ]}
                  >
                    {i + 1}
                  </Text>
                )}
              </View>
              <Text
                style={[
                  styles.stepLabel,
                  isActive && styles.stepLabelActive,
                  isDone && styles.stepLabelDone,
                  isError && styles.stepLabelError,
                ]}
                numberOfLines={1}
              >
                {step.label}
              </Text>
            </View>
            {!isLast && (
              <View
                style={[
                  styles.connector,
                  (isDone || i < activeIndex) && styles.connectorDone,
                ]}
              />
            )}
          </React.Fragment>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: TERMINAL.colors.bgLight,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
    gap: 6,
  },
  stepCell: {
    alignItems: 'center',
    gap: 4,
    minWidth: 64,
  },
  pip: {
    width: 22,
    height: 22,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: TERMINAL.colors.bg,
  },
  pipActive: {
    borderColor: TERMINAL.colors.primary,
    backgroundColor: 'rgba(59, 130, 246, 0.18)',
  },
  pipDone: {
    backgroundColor: TERMINAL.colors.primary,
    borderColor: TERMINAL.colors.primary,
  },
  pipError: {
    borderColor: TERMINAL.colors.error,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
  },
  pipNumber: {
    color: TERMINAL.colors.muted,
    fontSize: 10,
    fontWeight: '900',
  },
  pipNumberActive: {
    color: TERMINAL.colors.primary,
  },
  pipNumberError: {
    color: TERMINAL.colors.error,
  },
  stepLabel: {
    color: TERMINAL.colors.muted,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  stepLabelActive: {
    color: 'white',
  },
  stepLabelDone: {
    color: TERMINAL.colors.primary,
  },
  stepLabelError: {
    color: TERMINAL.colors.error,
  },
  connector: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginTop: 10,
  },
  connectorDone: {
    backgroundColor: TERMINAL.colors.primary,
  },
});
