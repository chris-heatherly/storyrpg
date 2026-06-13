import React, { useCallback } from 'react';
import {
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { RotateCcw, X } from 'lucide-react-native';
import { TERMINAL } from '../theme';
import { ModelDropdown } from './ModelDropdown';
import { SegmentedControl } from './ui/SegmentedControl';
import type { ModelOption, GeneratorLlmProvider } from '../config/generatorLlmOptions';
import {
  MODEL_FAMILY_PRESETS,
  PIPELINE_TASKS,
  PipelineTask,
  TaskModelAssignment,
  TaskModelOverrides,
  modelLabel,
} from '../config/modelFamilies';

interface Props {
  visible: boolean;
  onClose: () => void;
  modelFamily: GeneratorLlmProvider;
  assignments: Record<PipelineTask, TaskModelAssignment>;
  overrides: TaskModelOverrides;
  availableModels: Record<GeneratorLlmProvider, ModelOption[]>;
  onTaskModelChange: (task: PipelineTask, model: string) => void;
  onTaskProviderChange: (task: PipelineTask, provider: GeneratorLlmProvider) => void;
  onResetTask: (task: PipelineTask) => void;
}

const PROVIDER_OPTIONS: { value: GeneratorLlmProvider; label: string }[] = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'openrouter', label: 'OpenRouter' },
];

export function ModelTaskSheet({
  visible,
  onClose,
  modelFamily,
  assignments,
  overrides,
  availableModels,
  onTaskModelChange,
  onTaskProviderChange,
  onResetTask,
}: Props) {
  const toOptions = useCallback(
    (provider: GeneratorLlmProvider): ModelOption[] => availableModels[provider] ?? [],
    [availableModels],
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>MODELS BY TASK</Text>
              <Text style={styles.subtitle}>
                {MODEL_FAMILY_PRESETS[modelFamily].label} family · narrative tasks locked to family · image/video can use any provider
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} accessibilityLabel="Close model task sheet" style={styles.closeBtn}>
              <X size={18} color={TERMINAL.colors.muted} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
            {PIPELINE_TASKS.map((task) => {
              const assignment = assignments[task.id];
              const provider = assignment.provider;
              const isCustom = task.crossProvider
                ? false
                : Boolean(overrides[task.id]);
              const options = toOptions(provider).map((o) => ({
                value: o.value,
                label: o.label,
                subtitle: o.value,
                description: o.description ?? undefined,
              }));
              // Ensure the current value is selectable even if the scan list misses it.
              if (!options.some((o) => o.value === assignment.model) && assignment.model) {
                options.unshift({
                  value: assignment.model,
                  label: modelLabel(provider, assignment.model),
                  subtitle: assignment.model,
                  description: undefined,
                });
              }
              return (
                <View key={task.id} style={styles.taskRow}>
                  <View style={styles.taskHeader}>
                    <Text style={styles.taskLabel}>{task.label}</Text>
                    {isCustom ? <Text style={styles.customBadge}>CUSTOM</Text> : null}
                    <TouchableOpacity
                      onPress={() => onResetTask(task.id)}
                      accessibilityLabel={`Reset ${task.label} to preset`}
                      style={styles.resetBtn}
                    >
                      <RotateCcw size={12} color={TERMINAL.colors.muted} />
                      <Text style={styles.resetText}>PRESET</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.taskDescription}>{task.description}</Text>

                  {task.crossProvider ? (
                    <SegmentedControl<GeneratorLlmProvider>
                      options={PROVIDER_OPTIONS}
                      value={provider}
                      onChange={(p) => onTaskProviderChange(task.id, p)}
                      style={styles.providerControl}
                      ariaLabel={`${task.label} provider`}
                    />
                  ) : null}

                  <ModelDropdown
                    options={options}
                    value={assignment.model}
                    onSelect={(model) => onTaskModelChange(task.id, model)}
                    placeholder="Select model…"
                  />
                </View>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: TERMINAL.colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: Platform.OS === 'ios' ? 34 : 16,
    maxHeight: '85%',
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  title: {
    fontSize: 14,
    fontWeight: '800',
    color: 'white',
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 10,
    fontWeight: '600',
    color: TERMINAL.colors.muted,
    marginTop: 4,
    lineHeight: 14,
  },
  closeBtn: {
    padding: 6,
    marginLeft: 8,
  },
  scroll: {
    paddingHorizontal: 18,
  },
  taskRow: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  taskHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  taskLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: 'white',
    letterSpacing: 0.4,
    flex: 1,
  },
  customBadge: {
    fontSize: 9,
    fontWeight: '800',
    color: TERMINAL.colors.cyan,
    letterSpacing: 0.5,
    marginRight: 8,
  },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  resetText: {
    fontSize: 9,
    fontWeight: '700',
    color: TERMINAL.colors.muted,
    letterSpacing: 0.5,
    marginLeft: 4,
  },
  taskDescription: {
    fontSize: 10,
    fontWeight: '600',
    color: TERMINAL.colors.muted,
    lineHeight: 14,
    marginBottom: 10,
  },
  providerControl: {
    marginBottom: 8,
  },
});
