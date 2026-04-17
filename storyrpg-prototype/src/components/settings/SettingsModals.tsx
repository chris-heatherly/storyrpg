import React from 'react';
import {
  Modal,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Edit2 } from 'lucide-react-native';
import type { StoryCatalogEntry } from '../../types';
import type { GenerationJob } from '../../stores/generationJobStore';
import { TERMINAL } from '../../theme';
import { ConfirmDialog } from '../ui';

type SettingsStyles = Record<string, any>;

interface RenameStoryModalProps {
  styles: SettingsStyles;
  story: StoryCatalogEntry | null;
  newTitle: string;
  onChangeTitle: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function RenameStoryModal({
  styles,
  story,
  newTitle,
  onChangeTitle,
  onCancel,
  onConfirm,
}: RenameStoryModalProps) {
  const trimmed = newTitle.trim();
  const currentTitle = (story?.title || '').trim();
  const isValid = trimmed.length > 0 && trimmed.length <= 120;
  const isUnchanged = trimmed === currentTitle;
  const disabled = !isValid || isUnchanged;
  const validationMessage = !trimmed
    ? 'Title cannot be empty.'
    : trimmed.length > 120
      ? 'Title is too long (max 120 characters).'
      : isUnchanged
        ? 'Enter a new title to save.'
        : null;

  return (
    <Modal
      visible={story !== null}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.confirmModal}>
          <View style={[styles.confirmHeaderIcon, { backgroundColor: 'rgba(59, 130, 246, 0.1)' }]}>
            <Edit2 size={32} color={TERMINAL.colors.primary} />
          </View>
          <Text style={styles.confirmTitle}>RENAME CHRONICLE</Text>

          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>NEW DESIGNATION</Text>
            <TextInput
              style={styles.renameInput}
              value={newTitle}
              onChangeText={onChangeTitle}
              placeholder="ENTER NEW TITLE"
              placeholderTextColor={TERMINAL.colors.muted}
              autoFocus
              selectTextOnFocus
              maxLength={120}
              onSubmitEditing={() => { if (!disabled) onConfirm(); }}
              accessibilityLabel="Story title"
            />
            {validationMessage ? (
              <Text
                style={{
                  marginTop: 6,
                  color: TERMINAL.colors.mutedLight,
                  fontSize: 11,
                  fontWeight: '700',
                  letterSpacing: 1,
                }}
              >
                {validationMessage}
              </Text>
            ) : null}
          </View>

          <View style={styles.confirmButtons}>
            <TouchableOpacity
              style={styles.confirmButtonCancel}
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="Cancel rename"
            >
              <Text style={styles.confirmButtonCancelText}>CANCEL</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.confirmButtonDelete,
                { backgroundColor: TERMINAL.colors.primary },
                disabled && { opacity: 0.4 },
              ]}
              onPress={onConfirm}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel="Save new title"
              accessibilityState={{ disabled }}
            >
              <Text style={styles.confirmButtonDeleteText}>UPDATE</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

interface CancelJobModalProps {
  styles?: SettingsStyles;
  job: GenerationJob | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function CancelJobModal({ job, onCancel, onConfirm }: CancelJobModalProps) {
  return (
    <ConfirmDialog
      visible={job !== null}
      title="Stop generation?"
      message={job
        ? `Are you sure you want to stop "${(job.storyTitle || 'Untitled')}"? Partial progress may be lost.`
        : 'Are you sure you want to stop this generation job? Partial progress may be lost.'}
      confirmLabel="Stop"
      cancelLabel="Continue"
      destructive
      onConfirm={onConfirm}
      onCancel={onCancel}
      testID="cancel-job-dialog"
    />
  );
}

interface DeleteStoryModalProps {
  styles?: SettingsStyles;
  story: StoryCatalogEntry | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteStoryModal({ story, onCancel, onConfirm }: DeleteStoryModalProps) {
  return (
    <ConfirmDialog
      visible={story !== null}
      title="Delete chronicle?"
      message={story
        ? `Are you sure you want to delete "${(story.title || 'Untitled')}"? This action is irreversible.`
        : 'Are you sure? This action is irreversible.'}
      confirmLabel="Delete"
      cancelLabel="Cancel"
      destructive
      onConfirm={onConfirm}
      onCancel={onCancel}
      testID="delete-story-dialog"
    />
  );
}
