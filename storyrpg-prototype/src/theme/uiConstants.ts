import { StyleSheet, Platform } from 'react-native';
import { TERMINAL } from './terminal';

// --- Helpers ---

export function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// --- Design Tokens ---

export const RADIUS = {
  panel: 24,
  button: 12,
  choice: 16,
  badge: 10,
  small: 8,
  pill: 10,
} as const;

export const TIMING = {
  instant: 80,
  fast: 200,
  normal: 300,
  slow: 400,
  dramatic: 600,
  banner: 500,
} as const;

export const SPACING = {
  panel: 24,
  content: 24,
  contentBottom: 40,
  buttonV: 14,
  buttonH: 24,
  choiceH: 16,
} as const;

// --- Tier Label Config ---

export type OutcomeTier = 'success' | 'complicated' | 'failure';

export const TIER_COLORS: Record<OutcomeTier, string> = {
  success: TERMINAL.colors.success,
  complicated: TERMINAL.colors.amber,
  failure: TERMINAL.colors.error,
};

export const TIER_LABELS = {
  story: {
    success: 'Well Played',
    complicated: 'Not Without Cost',
    failure: 'A Costly Misstep',
  } as Record<OutcomeTier, string>,
  encounter: {
    success: 'Seizing the Moment',
    complicated: 'At a Price',
    failure: 'A Turn for the Worse',
  } as Record<OutcomeTier, string>,
};

// --- Shared Styles ---

export const sharedStyles = StyleSheet.create({
  textPanel: {
    backgroundColor: 'rgba(15, 17, 21, 0.85)',
    borderRadius: RADIUS.panel,
    padding: SPACING.panel,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
  },
  resolutionPanel: {
    backgroundColor: withAlpha(TERMINAL.colors.primary, 0.15),
    borderRadius: 16,
    padding: 16,
    borderLeftWidth: 4,
    borderLeftColor: TERMINAL.colors.primary,
    marginBottom: 16,
  },
  resolutionText: {
    color: TERMINAL.colors.primaryLight,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '500',
    fontStyle: 'italic',
  },
  continueButton: {
    backgroundColor: withAlpha(TERMINAL.colors.primary, 0.2),
    borderWidth: 1,
    borderColor: withAlpha(TERMINAL.colors.primary, 0.3),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.buttonV,
    paddingHorizontal: SPACING.buttonH,
    borderRadius: RADIUS.button,
    gap: 10,
    marginTop: 8,
    alignSelf: 'center',
  },
  continueText: {
    color: TERMINAL.colors.primaryLight,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 2,
  },
  // Interstitial screen components (recap, growth summary, cost panels)
  sectionEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.8,
    marginBottom: 8,
  },
  sectionTitle: {
    color: TERMINAL.colors.textStrong,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '800',
    marginBottom: 18,
  },
  sectionGroup: {
    marginTop: 14,
    gap: 10,
  },
  sectionGroupTitle: {
    color: TERMINAL.colors.amber,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  sectionCard: {
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: RADIUS.button,
    padding: 12,
    gap: 6,
  },
  sectionCardTitle: {
    color: TERMINAL.colors.textStrong,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
  },
  sectionCardBody: {
    color: TERMINAL.colors.textBody,
    fontSize: 14,
    lineHeight: 20,
  },
  sectionCardMeta: {
    color: TERMINAL.colors.mutedLight,
    fontSize: 13,
    lineHeight: 18,
    fontStyle: 'italic',
  },
  sectionAltRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  sectionAltBullet: {
    color: TERMINAL.colors.amber,
    marginTop: 2,
  },
  sectionAltText: {
    flex: 1,
    color: TERMINAL.colors.textBody,
    fontSize: 14,
    lineHeight: 20,
  },
  outcomeHeader: {
    fontSize: 20,
    fontWeight: '800',
    fontStyle: 'italic',
    letterSpacing: 0.5,
    marginBottom: 12,
    textAlign: 'left',
  },
  gradientOverlay: {
    ...StyleSheet.absoluteFillObject,
    ...(Platform.OS === 'web' ? {
      backgroundImage: `linear-gradient(to bottom, transparent 0%, transparent 40%, rgba(15, 17, 21, 0.7) 70%, rgba(15, 17, 21, 0.95) 100%)`,
    } as any : {
      backgroundColor: 'transparent',
    }),
  },
  uiOverlay: {
    flex: 1,
    zIndex: 10,
    justifyContent: 'flex-end',
    position: 'relative' as const,
  },
  contentScrollView: {
    flex: 1,
  },
  contentContainer: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    padding: SPACING.content,
    paddingBottom: SPACING.contentBottom,
  },
});
