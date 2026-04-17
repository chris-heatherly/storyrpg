/**
 * StyleSetupSection
 *
 * Inline section on the analysis_complete screen. Lets the user:
 *  1. Expand their raw art-style string into a full `ArtStyleProfile`
 *     (LLM via StyleArchitect, with heuristic fallback).
 *  2. Edit the resulting DNA fields directly.
 *  3. Preview, regenerate, and approve the three style-bible anchors
 *     (character portrait, arc color strip, environment vignette).
 *  4. Opt out entirely via the "Use defaults (skip preview)" toggle.
 *
 * The section is intentionally a thin view on top of `useStyleSetup` so
 * the hook can be tested headless and so GeneratorScreen stays focused
 * on orchestration rather than UI details.
 */

import React from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Switch,
  StyleSheet,
} from 'react-native';
import {
  Brush,
  Wand2,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Palette,
  MountainSnow,
  UserCircle2,
} from 'lucide-react-native';
import { TERMINAL } from '../../theme';
import type { ArtStyleProfile } from '../../ai-agents/images/artStyleProfile';
import type {
  AnchorRole,
  AnchorSlot,
  UseStyleSetupOptions,
} from './hooks/useStyleSetup';

export interface StyleSetupSectionProps {
  rawArtStyle: string;
  expanding: boolean;
  expansionError: string | null;
  profile: ArtStyleProfile | undefined;
  slots: Record<AnchorRole, AnchorSlot>;
  useDefaults: boolean;
  statusSummary: string;
  onExpand: () => void;
  onUpdateField: <K extends keyof ArtStyleProfile>(field: K, value: ArtStyleProfile[K]) => void;
  onGenerateAnchor: (role: AnchorRole) => void;
  onApproveAnchor: (role: AnchorRole) => void;
  onToggleUseDefaults: (value: boolean) => void;
  /** Injected prop for tests; leave undefined in production. */
  now?: () => number;
}

interface AnchorCardProps {
  role: AnchorRole;
  title: string;
  description: string;
  icon: React.ReactNode;
  slot: AnchorSlot;
  disabled: boolean;
  onGenerate: () => void;
  onApprove: () => void;
}

const ANCHOR_META: Record<
  AnchorRole,
  { title: string; description: string; icon: React.ReactNode }
> = {
  character: {
    title: 'CHARACTER ANCHOR',
    description:
      'A single character portrait in your chosen style. Locks the protagonist look for every later scene.',
    icon: <UserCircle2 size={14} color={TERMINAL.colors.cyan} />,
  },
  arcStrip: {
    title: 'ARC COLOR STRIP',
    description:
      'Abstract mood strip showing the episode tonal arc. No characters — just palette and light.',
    icon: <Palette size={14} color={TERMINAL.colors.amber} />,
  },
  environment: {
    title: 'ENVIRONMENT ANCHOR',
    description:
      'Locations-only vignette that locks in material palette and lighting for the primary setting.',
    icon: <MountainSnow size={14} color={TERMINAL.colors.primary} />,
  },
};

const AnchorCard: React.FC<AnchorCardProps> = ({
  title,
  description,
  icon,
  slot,
  disabled,
  onGenerate,
  onApprove,
}) => {
  const imageUri =
    slot.imageBase64 && slot.mimeType
      ? `data:${slot.mimeType};base64,${slot.imageBase64}`
      : undefined;
  return (
    <View style={styles.anchorCard}>
      <View style={styles.anchorHeader}>
        {icon}
        <Text style={styles.anchorTitle}>{title}</Text>
      </View>
      <Text style={styles.anchorDescription}>{description}</Text>
      <View style={styles.anchorPreview}>
        {slot.status === 'generating' ? (
          <ActivityIndicator color={TERMINAL.colors.cyan} />
        ) : imageUri ? (
          <Image source={{ uri: imageUri }} style={styles.anchorImage} />
        ) : (
          <Text style={styles.anchorPlaceholder}>
            {slot.status === 'error' ? `Failed — ${slot.error}` : 'Not generated yet.'}
          </Text>
        )}
      </View>
      {slot.status === 'stale' && (
        <View style={styles.anchorStaleBanner}>
          <AlertTriangle size={12} color={TERMINAL.colors.amber} />
          <Text style={styles.anchorStaleText}>
            Profile edited since approval — regenerate to refresh this anchor.
          </Text>
        </View>
      )}
      <View style={styles.anchorActions}>
        <TouchableOpacity
          style={[styles.anchorButton, disabled && styles.anchorButtonDisabled]}
          disabled={disabled || slot.status === 'generating'}
          onPress={onGenerate}
        >
          <RefreshCw size={12} color={TERMINAL.colors.cyan} />
          <Text style={styles.anchorButtonText}>
            {slot.status === 'idle' ? 'GENERATE' : 'REGENERATE'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.anchorApproveButton,
            slot.status !== 'ready' && styles.anchorButtonDisabled,
            slot.status === 'approved' && styles.anchorApproveButtonActive,
          ]}
          disabled={slot.status !== 'ready'}
          onPress={onApprove}
        >
          <CheckCircle2
            size={12}
            color={slot.status === 'approved' ? TERMINAL.colors.primary : TERMINAL.colors.muted}
          />
          <Text
            style={[
              styles.anchorApproveText,
              slot.status === 'approved' && styles.anchorApproveTextActive,
            ]}
          >
            {slot.status === 'approved' ? 'APPROVED' : 'APPROVE'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

interface FieldProps {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  multiline?: boolean;
}

const Field: React.FC<FieldProps> = ({ label, value, onChange, placeholder, multiline }) => (
  <View style={styles.fieldGroup}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <TextInput
      style={[styles.fieldInput, multiline && styles.fieldInputMultiline]}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={TERMINAL.colors.muted}
      multiline={multiline}
    />
  </View>
);

export const StyleSetupSection: React.FC<StyleSetupSectionProps> = ({
  rawArtStyle,
  expanding,
  expansionError,
  profile,
  slots,
  useDefaults,
  statusSummary,
  onExpand,
  onUpdateField,
  onGenerateAnchor,
  onApproveAnchor,
  onToggleUseDefaults,
}) => {
  const profileReady = !!profile && !useDefaults;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Brush size={14} color={TERMINAL.colors.cyan} />
        <Text style={styles.sectionTitle}>STYLE SETUP</Text>
      </View>

      <Text style={styles.sectionIntro}>
        Translate "{rawArtStyle || 'your art style'}" into a full profile the pipeline will enforce
        everywhere. Preview the style-bible anchors before you commit to generating the full story.
      </Text>

      <View style={styles.toggleRow}>
        <Switch
          value={useDefaults}
          onValueChange={onToggleUseDefaults}
          trackColor={{ false: '#333', true: TERMINAL.colors.amber }}
          thumbColor="#fff"
        />
        <Text style={styles.toggleLabel}>
          Use defaults (skip preview — pipeline builds the style bible from scratch)
        </Text>
      </View>

      {!useDefaults && (
        <>
          <View style={styles.expandRow}>
            <TouchableOpacity
              style={[styles.expandButton, expanding && styles.expandButtonDisabled]}
              onPress={onExpand}
              disabled={expanding || !rawArtStyle.trim()}
            >
              {expanding ? (
                <ActivityIndicator color={TERMINAL.colors.cyan} />
              ) : (
                <Wand2 size={14} color={TERMINAL.colors.cyan} />
              )}
              <Text style={styles.expandButtonText}>
                {profile ? 'RE-EXPAND STYLE' : 'EXPAND STYLE'}
              </Text>
            </TouchableOpacity>
            <Text style={styles.expandHint}>
              Runs the Style Architect LLM. You can edit any field afterward.
            </Text>
          </View>

          {expansionError && (
            <View style={styles.errorBanner}>
              <AlertTriangle size={12} color={TERMINAL.colors.error} />
              <Text style={styles.errorText}>{expansionError}</Text>
            </View>
          )}

          {profile && (
            <View style={styles.profileCard}>
              <Field
                label="NAME"
                value={profile.name}
                onChange={(v) => onUpdateField('name', v)}
                placeholder="e.g. gothic ink wash"
              />
              <Field
                label="RENDERING TECHNIQUE"
                value={profile.renderingTechnique}
                onChange={(v) => onUpdateField('renderingTechnique', v)}
                multiline
              />
              <Field
                label="COLOR PHILOSOPHY"
                value={profile.colorPhilosophy}
                onChange={(v) => onUpdateField('colorPhilosophy', v)}
                multiline
              />
              <Field
                label="LIGHTING APPROACH"
                value={profile.lightingApproach}
                onChange={(v) => onUpdateField('lightingApproach', v)}
                multiline
              />
              <Field
                label="LINE WEIGHT"
                value={profile.lineWeight}
                onChange={(v) => onUpdateField('lineWeight', v)}
                multiline
              />
              <Field
                label="COMPOSITION STYLE"
                value={profile.compositionStyle}
                onChange={(v) => onUpdateField('compositionStyle', v)}
                multiline
              />
              <Field
                label="MOOD RANGE"
                value={profile.moodRange}
                onChange={(v) => onUpdateField('moodRange', v)}
                multiline
              />
              <Field
                label="POSITIVE VOCABULARY (comma separated)"
                value={(profile.positiveVocabulary || []).join(', ')}
                onChange={(v) =>
                  onUpdateField(
                    'positiveVocabulary',
                    v
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  )
                }
              />
              <Field
                label="INAPPROPRIATE VOCABULARY (comma separated)"
                value={(profile.inappropriateVocabulary || []).join(', ')}
                onChange={(v) =>
                  onUpdateField(
                    'inappropriateVocabulary',
                    v
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  )
                }
              />
            </View>
          )}

          <Text style={styles.statusLine}>{statusSummary}</Text>

          <View style={styles.anchorGrid}>
            {(Object.keys(ANCHOR_META) as AnchorRole[]).map((role) => {
              const meta = ANCHOR_META[role];
              return (
                <AnchorCard
                  key={role}
                  role={role}
                  title={meta.title}
                  description={meta.description}
                  icon={meta.icon}
                  slot={slots[role]}
                  disabled={!profileReady}
                  onGenerate={() => onGenerateAnchor(role)}
                  onApprove={() => onApproveAnchor(role)}
                />
              );
            })}
          </View>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  section: {
    borderWidth: 1,
    borderColor: TERMINAL.colors.border,
    backgroundColor: TERMINAL.colors.bgLight,
    padding: 16,
    marginTop: 12,
    gap: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    color: TERMINAL.colors.cyan,
    fontFamily: TERMINAL.fonts.mono,
    fontSize: 13,
    letterSpacing: 2,
  },
  sectionIntro: {
    color: TERMINAL.colors.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  toggleLabel: {
    color: TERMINAL.colors.textBody,
    fontSize: 12,
    flex: 1,
  },
  expandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  expandButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: TERMINAL.colors.cyan,
  },
  expandButtonDisabled: {
    opacity: 0.5,
  },
  expandButtonText: {
    color: TERMINAL.colors.cyan,
    fontFamily: TERMINAL.fonts.mono,
    fontSize: 11,
    letterSpacing: 2,
  },
  expandHint: {
    color: TERMINAL.colors.muted,
    fontSize: 11,
    flex: 1,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 8,
    borderWidth: 1,
    borderColor: TERMINAL.colors.error,
    backgroundColor: 'rgba(255,0,0,0.05)',
  },
  errorText: {
    color: TERMINAL.colors.error,
    fontSize: 11,
    flex: 1,
  },
  profileCard: {
    gap: 10,
    paddingVertical: 8,
  },
  fieldGroup: {
    gap: 4,
  },
  fieldLabel: {
    color: TERMINAL.colors.muted,
    fontSize: 10,
    letterSpacing: 1.5,
  },
  fieldInput: {
    borderWidth: 1,
    borderColor: TERMINAL.colors.border,
    color: TERMINAL.colors.textBody,
    backgroundColor: TERMINAL.colors.bg,
    paddingVertical: 6,
    paddingHorizontal: 8,
    fontSize: 12,
    minHeight: 32,
  },
  fieldInputMultiline: {
    minHeight: 48,
    textAlignVertical: 'top',
  },
  statusLine: {
    color: TERMINAL.colors.amber,
    fontSize: 11,
    marginTop: 4,
  },
  anchorGrid: {
    gap: 12,
  },
  anchorCard: {
    borderWidth: 1,
    borderColor: TERMINAL.colors.border,
    padding: 12,
    gap: 8,
  },
  anchorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  anchorTitle: {
    color: TERMINAL.colors.textBody,
    fontFamily: TERMINAL.fonts.mono,
    fontSize: 11,
    letterSpacing: 2,
  },
  anchorDescription: {
    color: TERMINAL.colors.muted,
    fontSize: 11,
    lineHeight: 16,
  },
  anchorPreview: {
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: TERMINAL.colors.border,
    backgroundColor: TERMINAL.colors.bg,
  },
  anchorPlaceholder: {
    color: TERMINAL.colors.muted,
    fontSize: 11,
    padding: 12,
    textAlign: 'center',
  },
  anchorImage: {
    width: '100%',
    height: 220,
    resizeMode: 'cover',
  },
  anchorStaleBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  anchorStaleText: {
    color: TERMINAL.colors.amber,
    fontSize: 10,
  },
  anchorActions: {
    flexDirection: 'row',
    gap: 8,
  },
  anchorButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: TERMINAL.colors.cyan,
  },
  anchorButtonDisabled: {
    opacity: 0.4,
  },
  anchorButtonText: {
    color: TERMINAL.colors.cyan,
    fontSize: 10,
    letterSpacing: 1.5,
  },
  anchorApproveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: TERMINAL.colors.muted,
  },
  anchorApproveButtonActive: {
    borderColor: TERMINAL.colors.primary,
    backgroundColor: 'rgba(0,255,120,0.05)',
  },
  anchorApproveText: {
    color: TERMINAL.colors.muted,
    fontSize: 10,
    letterSpacing: 1.5,
  },
  anchorApproveTextActive: {
    color: TERMINAL.colors.primary,
  },
});

export type { UseStyleSetupOptions };
