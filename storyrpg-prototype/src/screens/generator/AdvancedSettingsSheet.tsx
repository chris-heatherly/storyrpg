/**
 * AdvancedSettingsSheet
 *
 * Bottom-sheet modal that hosts the full `GenerationSettingsPanel`. Per the
 * generator-ux-improvements plan (Tranche B), advanced settings move out of
 * the nested inline disclosure inside the Story bucket into an explicit
 * on-demand sheet, reducing the disclosure depth from 3 levels to 2.
 *
 * This sheet is intentionally dumb — it accepts the current settings object
 * and an `onChange` callback. All mutation continues to happen in the
 * generator's `useGeneratorSettings` hook.
 */

import React from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView, Pressable } from 'react-native';
import { Settings, X } from 'lucide-react-native';
import { TERMINAL } from '../../theme';
import { GenerationSettingsPanel, GenerationSettings } from '../../components/GenerationSettingsPanel';

interface AdvancedSettingsSheetProps {
  visible: boolean;
  settings: GenerationSettings;
  onChange: (updates: Partial<GenerationSettings>) => void;
  onClose: () => void;
}

export const AdvancedSettingsSheet: React.FC<AdvancedSettingsSheetProps> = ({
  visible,
  settings,
  onChange,
  onClose,
}) => {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Dismiss advanced settings"
        />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Settings size={16} color={TERMINAL.colors.primary} />
              <Text style={styles.title}>ADVANCED STORY SETTINGS</Text>
            </View>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close advanced settings"
            >
              <X size={14} color={TERMINAL.colors.muted} />
            </TouchableOpacity>
          </View>
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.subtitle}>
              Performance tuning, story structure, pacing, text limits, and validation.
              These controls are optional — safe defaults ship with each preset.
            </Text>
            <GenerationSettingsPanel settings={settings} onChange={onChange} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    maxHeight: '90%',
    backgroundColor: TERMINAL.colors.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingTop: 8,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    color: 'white',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  body: {
    flexGrow: 0,
  },
  bodyContent: {
    padding: 16,
    paddingBottom: 40,
    gap: 12,
  },
  subtitle: {
    color: TERMINAL.colors.muted,
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 0.3,
    marginBottom: 4,
  },
});
