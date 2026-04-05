import React from 'react';
import {
  Modal,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  AlertCircle,
  Edit2,
  StopCircle,
} from 'lucide-react-native';
import type { StoryCatalogEntry } from '../../types';
import type { GenerationJob } from '../../stores/generationJobStore';
import { TERMINAL } from '../../theme';

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
            />
          </View>

          <View style={styles.confirmButtons}>
            <TouchableOpacity
              style={styles.confirmButtonCancel}
              onPress={onCancel}
            >
              <Text style={styles.confirmButtonCancelText}>CANCEL</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.confirmButtonDelete, { backgroundColor: TERMINAL.colors.primary }]}
              onPress={onConfirm}
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
  styles: SettingsStyles;
  job: GenerationJob | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function CancelJobModal({
  styles,
  job,
  onCancel,
  onConfirm,
}: CancelJobModalProps) {
  return (
    <Modal
      visible={job !== null}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.confirmModal, { borderColor: 'rgba(245, 158, 11, 0.2)' }]}>
          <View style={[styles.confirmHeaderIcon, { backgroundColor: 'rgba(245, 158, 11, 0.1)' }]}>
            <StopCircle size={32} color={TERMINAL.colors.amber} />
          </View>
          <Text style={styles.confirmTitle}>STOP GENERATION?</Text>

          {job ? (
            <Text style={styles.confirmMessage}>
              ARE YOU SURE YOU WANT TO STOP{'\n'}
              <Text style={[styles.confirmStoryName, { color: TERMINAL.colors.amber }]}>
                "{(job.storyTitle || 'Untitled').toUpperCase()}"
              </Text>?{'\n\n'}
              PARTIAL PROGRESS MAY BE LOST.
            </Text>
          ) : null}

          <View style={styles.confirmButtons}>
            <TouchableOpacity
              style={styles.confirmButtonCancel}
              onPress={onCancel}
            >
              <Text style={styles.confirmButtonCancelText}>CONTINUE</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.confirmButtonDelete, { backgroundColor: TERMINAL.colors.amber }]}
              onPress={onConfirm}
            >
              <Text style={styles.confirmButtonDeleteText}>STOP</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

interface DeleteStoryModalProps {
  styles: SettingsStyles;
  story: StoryCatalogEntry | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteStoryModal({
  styles,
  story,
  onCancel,
  onConfirm,
}: DeleteStoryModalProps) {
  return (
    <Modal
      visible={story !== null}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.confirmModal}>
          <View style={styles.confirmHeaderIcon}>
            <AlertCircle size={32} color={TERMINAL.colors.error} />
          </View>
          <Text style={styles.confirmTitle}>CONFIRM DELETION</Text>

          {story ? (
            <Text style={styles.confirmMessage}>
              ARE YOU SURE YOU WANT TO PURGE{'\n'}
              <Text style={styles.confirmStoryName}>"{(story.title || 'Untitled').toUpperCase()}"</Text>?{'\n\n'}
              THIS ACTION IS IRREVERSIBLE.
            </Text>
          ) : null}

          <View style={styles.confirmButtons}>
            <TouchableOpacity
              style={styles.confirmButtonCancel}
              onPress={onCancel}
            >
              <Text style={styles.confirmButtonCancelText}>CANCEL</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.confirmButtonDelete}
              onPress={onConfirm}
            >
              <Text style={styles.confirmButtonDeleteText}>DELETE</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
