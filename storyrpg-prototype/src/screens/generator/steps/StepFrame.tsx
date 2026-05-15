/**
 * StepFrame
 *
 * Shared frame used by all four wizard step components (Story, Style, Review,
 * Generate) plus the terminal Complete step. Keeps a single visual rhythm —
 * section heading, optional subtitle, and a content region — so step
 * components stay small and consistent.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { TERMINAL } from '../../../theme';

interface StepFrameProps {
  /** Step name shown in the header, e.g. "STORY" or "GENERATE". */
  stepLabel: string;
  /** One-line headline describing what the user is doing on this step. */
  title: string;
  /** Optional helper text beneath the title. */
  subtitle?: string;
  /** Right-aligned slot for a small meta element (e.g. step count). */
  meta?: React.ReactNode;
  children: React.ReactNode;
}

export const StepFrame: React.FC<StepFrameProps> = ({
  stepLabel,
  title,
  subtitle,
  meta,
  children,
}) => (
  <View style={styles.container}>
    <View style={styles.headerRow}>
      <Text style={styles.stepLabel}>{stepLabel.toUpperCase()}</Text>
      {meta ? <View style={styles.metaSlot}>{meta}</View> : null}
    </View>
    <Text style={styles.title}>{title}</Text>
    {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    <View style={styles.body}>{children}</View>
  </View>
);

const styles = StyleSheet.create({
  container: {
    gap: 6,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepLabel: {
    color: TERMINAL.colors.primary,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.6,
  },
  metaSlot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    color: 'white',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  subtitle: {
    color: TERMINAL.colors.muted,
    fontSize: 12,
    lineHeight: 17,
    letterSpacing: 0.2,
    marginBottom: 4,
  },
  body: {
    marginTop: 8,
    gap: 12,
  },
});
