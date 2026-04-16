/**
 * Generation Settings Panel
 * 
 * Configurable settings for story generation including text constraints,
 * validation thresholds, and performance options.
 * 
 * Can be used inline (embedded) or in a modal.
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Switch,
} from 'react-native';
import {
  Activity,
  Shield,
  Clock,
  Target,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Save,
  Zap,
  FileText,
} from 'lucide-react-native';
import { TERMINAL } from '../theme';
import {
  SCENE_DEFAULTS,
  CONCURRENCY_DEFAULTS,
} from '../constants/pipeline';
import {
  PHASE_VALIDATION_DEFAULTS,
  CHOICE_DENSITY_DEFAULTS,
  PIXAR_VALIDATION_DEFAULTS,
  NPC_DEPTH_DEFAULTS,
} from '../constants/validation';
import {
  BEAT_TEXT_CONSTRAINTS,
  CHOICE_CONSTRAINTS,
  DIALOGUE_CONSTRAINTS,
} from '../constants/mobile';

// ========================================
// TYPES
// ========================================

export interface GenerationSettings {
  // Scene structure
  targetSceneCount: number;
  majorChoiceCount: number;
  minBeatsPerScene: number;
  maxBeatsPerScene: number;
  standardBeatCount: number;
  bottleneckBeatCount: number;
  encounterBeatCount: number;
  
  // Image generation
  generateImages: boolean;
  imageGenerationLimit: number;
  panelMode: 'single' | 'special-beats' | 'all-beats';
  
  // Validation
  blockingThreshold: number;
  warningThreshold: number;
  
  // Choice pacing
  firstChoiceMaxSeconds: number;
  averageGapMaxSeconds: number;
  minChoiceDensity: number;
  
  // Beat text constraints
  maxSentencesPerBeat: number;
  maxWordsPerBeat: number;
  
  // Encounter text constraints  
  encounterSetupMaxWords: number;
  encounterOutcomeMaxWords: number;
  
  // Choice constraints
  minChoices: number;
  maxChoices: number;
  maxChoiceWords: number;
  
  // Dialogue constraints
  maxDialogueWords: number;
  maxDialogueLines: number;
  
  // Resolution constraints
  resolutionSummaryMaxWords: number;
  
  // NPC depth
  minMajorDimensions: number;
  
  // Pixar
  pixarGoodThreshold: number;
  
  // Character references
  generateCharacterRefs: boolean;
  generateExpressionSheets: boolean;
  generateBodyVocabulary: boolean;
  
  // Audio
  preGenerateAudio: boolean;

  // Failure handling
  failFastMode: boolean;
  
  // === CHOICE DESIGN SETTINGS ===
  // Choice type distribution targets (percentages, should sum to 100)
  // Types describe player experience. Branching is a property, not a type.
  choiceDistExpression: number;    // ~35% - Personality/voice choices
  choiceDistRelationship: number;  // ~30% - NPC relationship shifts
  choiceDistStrategic: number;     // ~20% - Skill/stat-based choices
  choiceDistDilemma: number;       // ~15% - Value-testing choices
  
  // Branching cap: max choices per episode that route to different scenes
  maxBranchingChoicesPerEpisode: number;
  
  // Minimum encounters per episode by length
  minEncountersShort: number;   // 3-4 scenes
  minEncountersMedium: number;  // 5-7 scenes
  minEncountersLong: number;    // 8+ scenes
}

export const DEFAULT_GENERATION_SETTINGS: GenerationSettings = {
  // Scene structure
  targetSceneCount: SCENE_DEFAULTS.targetSceneCount,
  majorChoiceCount: SCENE_DEFAULTS.majorChoiceCount,
  minBeatsPerScene: SCENE_DEFAULTS.minBeatsPerScene,
  maxBeatsPerScene: SCENE_DEFAULTS.maxBeatsPerScene,
  standardBeatCount: SCENE_DEFAULTS.standardBeatCount,
  bottleneckBeatCount: SCENE_DEFAULTS.bottleneckBeatCount,
  encounterBeatCount: SCENE_DEFAULTS.encounterBeatCount,
  
  // Image generation
  generateImages: true,
  imageGenerationLimit: CONCURRENCY_DEFAULTS.imageGenerationLimit,
  panelMode: 'single' as const,
  
  // Validation
  blockingThreshold: PHASE_VALIDATION_DEFAULTS.blockingThreshold,
  warningThreshold: PHASE_VALIDATION_DEFAULTS.warningThreshold,
  
  // Choice pacing
  firstChoiceMaxSeconds: CHOICE_DENSITY_DEFAULTS.firstChoiceMaxSeconds,
  averageGapMaxSeconds: CHOICE_DENSITY_DEFAULTS.averageGapMaxSeconds,
  minChoiceDensity: CHOICE_DENSITY_DEFAULTS.minChoiceDensity * 100, // Convert to percentage
  
  // Beat text constraints
  maxSentencesPerBeat: BEAT_TEXT_CONSTRAINTS.maxSentences,
  maxWordsPerBeat: BEAT_TEXT_CONSTRAINTS.maxWords,
  
  // Encounter text constraints
  encounterSetupMaxWords: BEAT_TEXT_CONSTRAINTS.setupTextMaxWords,
  encounterOutcomeMaxWords: BEAT_TEXT_CONSTRAINTS.outcomeTextMaxWords,
  
  // Choice constraints
  minChoices: CHOICE_CONSTRAINTS.minChoices,
  maxChoices: CHOICE_CONSTRAINTS.maxChoices,
  maxChoiceWords: CHOICE_CONSTRAINTS.maxChoiceWords,
  
  // Dialogue constraints
  maxDialogueWords: DIALOGUE_CONSTRAINTS.maxWordsPerLine,
  maxDialogueLines: DIALOGUE_CONSTRAINTS.maxDialogueLines,
  
  // Resolution constraints
  resolutionSummaryMaxWords: 30, // Matches DEFAULT_LIMITS.resolutionSummary
  
  // NPC depth
  minMajorDimensions: NPC_DEPTH_DEFAULTS.minMajorDimensions,
  
  // Pixar
  pixarGoodThreshold: PIXAR_VALIDATION_DEFAULTS.scoreThresholds.good,
  
  // Character references
  generateCharacterRefs: true,
  generateExpressionSheets: true,
  generateBodyVocabulary: true,
  
  // Audio
  preGenerateAudio: false,

  // Failure handling
  failFastMode: true,
  
  // === CHOICE DESIGN SETTINGS ===
  // Choice type distribution targets (percentages, should sum to 100)
  // Types describe player experience. Branching is a separate cap, not a type.
  // Encounter outcomes provide additional tactical divergence (victory/defeat/escape).
  choiceDistExpression: 35,    // Personality/voice choices (safe, identity-building)
  choiceDistRelationship: 30,  // NPC relationship shifts (may branch)
  choiceDistStrategic: 20,     // Skill/stat-based choices (may branch)
  choiceDistDilemma: 15,       // Value-testing choices (may branch)
  
  // Max choices per episode that route to different scenes (branching cap)
  maxBranchingChoicesPerEpisode: 2,
  
  // Minimum encounters per episode by length
  minEncountersShort: 1,   // 3-4 scenes
  minEncountersMedium: 1,  // 5-7 scenes
  minEncountersLong: 2,    // 8+ scenes
};

// ========================================
// SETTING ROW COMPONENT
// ========================================

interface SettingRowProps {
  label: string;
  description: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  defaultValue: number;
}

const SettingRow: React.FC<SettingRowProps> = ({
  label,
  description,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  defaultValue,
}) => {
  const isDefault = value === defaultValue;
  
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingInfo}>
        <Text style={styles.settingLabel}>{label}</Text>
        <Text style={styles.settingDescription}>{description}</Text>
      </View>
      <View style={styles.settingControl}>
        {/* Reset button on the LEFT */}
        {!isDefault ? (
          <TouchableOpacity
            style={styles.resetButton}
            onPress={() => onChange(defaultValue)}
          >
            <RotateCcw size={12} color={TERMINAL.colors.amber} />
          </TouchableOpacity>
        ) : (
          <View style={styles.resetButtonPlaceholder} />
        )}
        <TouchableOpacity
          style={styles.adjustButton}
          onPress={() => onChange(Math.max(min, value - step))}
        >
          <Text style={styles.adjustButtonText}>−</Text>
        </TouchableOpacity>
        <View style={styles.valueContainer}>
          <TextInput
            style={styles.valueInput}
            value={String(value)}
            onChangeText={(text) => {
              const num = parseFloat(text) || min;
              onChange(Math.max(min, Math.min(max, num)));
            }}
            keyboardType="numeric"
          />
          {unit && <Text style={styles.unitText}>{unit}</Text>}
        </View>
        <TouchableOpacity
          style={styles.adjustButton}
          onPress={() => onChange(Math.min(max, value + step))}
        >
          <Text style={styles.adjustButtonText}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// ========================================
// TOGGLE ROW COMPONENT
// ========================================

interface ToggleRowProps {
  label: string;
  description: string;
  value: boolean;
  onChange: (value: boolean) => void;
}

const ToggleRow: React.FC<ToggleRowProps> = ({
  label,
  description,
  value,
  onChange,
}) => {
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingInfo}>
        <Text style={styles.settingLabel}>{label}</Text>
        <Text style={styles.settingDescription}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: TERMINAL.colors.muted, true: TERMINAL.colors.cyan }}
        thumbColor={value ? TERMINAL.colors.bg : '#ffffff'}
      />
    </View>
  );
};

// ========================================
// SECTION COMPONENT
// ========================================

interface SectionProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultExpanded?: boolean;
}

const Section: React.FC<SectionProps> = ({ title, icon, children, defaultExpanded = false }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  
  return (
    <View style={styles.section}>
      <TouchableOpacity style={styles.sectionHeader} onPress={() => setExpanded(!expanded)}>
        {icon}
        <Text style={styles.sectionTitle}>{title}</Text>
        {expanded ? (
          <ChevronDown size={16} color={TERMINAL.colors.muted} />
        ) : (
          <ChevronRight size={16} color={TERMINAL.colors.muted} />
        )}
      </TouchableOpacity>
      {expanded && <View style={styles.sectionContent}>{children}</View>}
    </View>
  );
};

type NumericFieldConfig = {
  type: 'number';
  key: keyof GenerationSettings;
  label: string;
  description: string;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  condition?: (settings: GenerationSettings) => boolean;
};

type ToggleFieldConfig = {
  type: 'toggle';
  key: keyof GenerationSettings;
  label: string;
  description: string;
  condition?: (settings: GenerationSettings) => boolean;
};

type SelectFieldConfig = {
  type: 'select';
  key: keyof GenerationSettings;
  label: string;
  description: string;
  options: { value: string; label: string }[];
  condition?: (settings: GenerationSettings) => boolean;
};

type SettingFieldConfig = NumericFieldConfig | ToggleFieldConfig | SelectFieldConfig;

interface SettingsSectionConfig {
  id: string;
  title: string;
  icon: React.ReactNode;
  defaultExpanded?: boolean;
  description?: string;
  fields: SettingFieldConfig[];
  footer?: (settings: GenerationSettings) => React.ReactNode;
}

const PERFORMANCE_FIELDS: SettingFieldConfig[] = [
  {
    type: 'toggle',
    key: 'generateImages',
    label: 'Generate Images',
    description: 'Enable AI image generation. Disable for faster text-only runs.',
  },
  {
    type: 'number',
    key: 'imageGenerationLimit',
    label: 'Concurrent Images',
    description: 'Max parallel image generations.',
    min: 1,
    max: 5,
    condition: (settings) => settings.generateImages,
  },
  {
    type: 'select',
    key: 'panelMode',
    label: 'Panel Mode',
    description: 'Single image per beat, panels for action/dramatic moments, or panels for every beat.',
    options: [
      { value: 'single', label: 'Single Image' },
      { value: 'special-beats', label: 'Special Beats' },
      { value: 'all-beats', label: 'All Beats' },
    ],
    condition: (settings) => settings.generateImages,
  },
  {
    type: 'toggle',
    key: 'failFastMode',
    label: 'Fail Fast Pipeline',
    description: 'Stop immediately on major generation failures instead of spending credits on fallback content.',
  },
];

const STORY_STRUCTURE_FIELDS: SettingFieldConfig[] = [
  { type: 'number', key: 'targetSceneCount', label: 'Scenes per Episode', description: 'Cap scenes per episode; the engine may use fewer.', min: 3, max: 12 },
  { type: 'number', key: 'majorChoiceCount', label: 'Major Choice Points', description: 'How many big decisions an episode should contain.', min: 1, max: 6 },
  { type: 'number', key: 'minBeatsPerScene', label: 'Min Beats per Scene', description: 'Minimum beats required for each scene.', min: 1, max: 6 },
  { type: 'number', key: 'maxBeatsPerScene', label: 'Max Beats per Scene', description: 'Upper cap before the engine merges excess beats.', min: 6, max: 20 },
  { type: 'number', key: 'standardBeatCount', label: 'Standard Scene Beats', description: 'Cap for standard scenes.', min: 4, max: 15 },
  { type: 'number', key: 'bottleneckBeatCount', label: 'Bottleneck Scene Beats', description: 'Cap for key bottleneck scenes.', min: 4, max: 15 },
  { type: 'number', key: 'encounterBeatCount', label: 'Encounter Beats', description: 'Target beats for encounter scenes.', min: 2, max: 8 },
];

const TEXT_LIMIT_FIELDS: SettingFieldConfig[] = [
  { type: 'number', key: 'maxWordsPerBeat', label: 'Max Words per Beat', description: 'Maximum words in scene narrative beats.', min: 30, max: 150, step: 10 },
  { type: 'number', key: 'maxSentencesPerBeat', label: 'Max Sentences per Beat', description: 'Maximum sentences per beat for mobile readability.', min: 2, max: 8 },
  { type: 'number', key: 'maxChoiceWords', label: 'Max Choice Words', description: 'Word limit for choice option text.', min: 10, max: 60, step: 5 },
  { type: 'number', key: 'maxDialogueWords', label: 'Max Dialogue Words', description: 'Word limit per dialogue line.', min: 10, max: 50, step: 5 },
  { type: 'number', key: 'encounterSetupMaxWords', label: 'Encounter Setup Words', description: 'Max words for encounter setup text.', min: 20, max: 80, step: 5 },
  { type: 'number', key: 'encounterOutcomeMaxWords', label: 'Encounter Outcome Words', description: 'Max words for encounter outcomes.', min: 20, max: 80, step: 5 },
  { type: 'number', key: 'resolutionSummaryMaxWords', label: 'Resolution Summary Words', description: 'Max words for resolution summaries.', min: 15, max: 60, step: 5 },
];

const PACING_AND_VALIDATION_FIELDS: SettingFieldConfig[] = [
  { type: 'number', key: 'firstChoiceMaxSeconds', label: 'First Choice Max Time', description: 'Seconds before the first player choice.', min: 30, max: 180, step: 10, unit: 's' },
  { type: 'number', key: 'averageGapMaxSeconds', label: 'Average Gap Max', description: 'Max average seconds between choices.', min: 30, max: 180, step: 10, unit: 's' },
  { type: 'number', key: 'minChoiceDensity', label: 'Minimum Choice Density', description: 'Minimum percent of scenes with a choice point.', min: 20, max: 80, step: 5, unit: '%' },
  { type: 'number', key: 'minChoices', label: 'Min Choices', description: 'Minimum options per choice point.', min: 2, max: 4 },
  { type: 'number', key: 'maxChoices', label: 'Max Choices', description: 'Maximum options per choice point.', min: 2, max: 7 },
  { type: 'number', key: 'blockingThreshold', label: 'Blocking Threshold', description: 'Score below which generation halts.', min: 0, max: 70, step: 5 },
  { type: 'number', key: 'warningThreshold', label: 'Warning Threshold', description: 'Score below which warnings are shown.', min: 50, max: 90, step: 5 },
  { type: 'number', key: 'pixarGoodThreshold', label: 'Pixar Quality Threshold', description: 'Minimum score for Pixar principles.', min: 40, max: 80, step: 5 },
  { type: 'number', key: 'minMajorDimensions', label: 'NPC Relationship Depth', description: 'Minimum dimensions for major NPCs.', min: 1, max: 5 },
];

const CHOICE_AND_ENCOUNTER_FIELDS: SettingFieldConfig[] = [
  { type: 'number', key: 'choiceDistExpression', label: 'Expression', description: 'Personality and voice choices that never branch.', min: 0, max: 60, step: 5, unit: '%' },
  { type: 'number', key: 'choiceDistRelationship', label: 'Relationship', description: 'NPC bond shifts that may branch.', min: 0, max: 50, step: 5, unit: '%' },
  { type: 'number', key: 'choiceDistStrategic', label: 'Strategic', description: 'Skill and stat-based choices that may branch.', min: 0, max: 50, step: 5, unit: '%' },
  { type: 'number', key: 'choiceDistDilemma', label: 'Dilemma', description: 'High-stakes value tests that may branch.', min: 0, max: 30, step: 5, unit: '%' },
  { type: 'number', key: 'maxBranchingChoicesPerEpisode', label: 'Max Branching Choices', description: 'Any non-expression choice may route to a different scene.', min: 0, max: 4 },
  { type: 'number', key: 'minEncountersShort', label: 'Short Episode Encounters', description: 'Minimum encounters for 3-4 scene episodes.', min: 0, max: 3 },
  { type: 'number', key: 'minEncountersMedium', label: 'Medium Episode Encounters', description: 'Minimum encounters for 5-7 scene episodes.', min: 0, max: 4 },
  { type: 'number', key: 'minEncountersLong', label: 'Long Episode Encounters', description: 'Minimum encounters for 8+ scene episodes.', min: 0, max: 5 },
];

// NOTE: Character asset toggles (generateCharacterRefs, generateExpressionSheets,
// generateBodyVocabulary) are owned by the IMAGES bucket in GeneratorScreen, and
// preGenerateAudio is owned by the NARRATION bucket. They were previously
// duplicated here under an "ASSETS AND CHARACTER SUPPORT" section and have been
// removed to keep a single source of truth.

const SETTINGS_SECTIONS: SettingsSectionConfig[] = [
  {
    id: 'performance',
    title: 'PERFORMANCE',
    icon: <Zap size={16} color={TERMINAL.colors.amber} />,
    defaultExpanded: true,
    description: 'High-impact toggles that change speed and asset generation cost.',
    fields: PERFORMANCE_FIELDS,
  },
  {
    id: 'structure',
    title: 'STORY STRUCTURE',
    icon: <Activity size={16} color={TERMINAL.colors.cyan} />,
    defaultExpanded: true,
    description: 'Core pacing and episode shape.',
    fields: STORY_STRUCTURE_FIELDS,
  },
  {
    id: 'text',
    title: 'DIALOGUE AND TEXT LIMITS',
    icon: <FileText size={16} color={TERMINAL.colors.primary} />,
    defaultExpanded: true,
    description: 'Keep story output readable on mobile and within target length.',
    fields: TEXT_LIMIT_FIELDS,
  },
  {
    id: 'pacing',
    title: 'PACING AND VALIDATION',
    icon: <Clock size={16} color={TERMINAL.colors.amber} />,
    description: 'Balance reader pacing with quality guardrails.',
    fields: PACING_AND_VALIDATION_FIELDS,
  },
  {
    id: 'choices',
    title: 'CHOICES AND ENCOUNTERS',
    icon: <Target size={16} color={TERMINAL.colors.cyan} />,
    description: 'Guide choice distribution, branching, and encounter density.',
    fields: CHOICE_AND_ENCOUNTER_FIELDS,
    footer: (settings) => {
      const choiceTotal = settings.choiceDistExpression
        + settings.choiceDistRelationship
        + settings.choiceDistStrategic
        + settings.choiceDistDilemma;

      return (
        <View style={styles.totalRow}>
          <Text
            style={[
              styles.totalLabel,
              { color: choiceTotal === 100 ? TERMINAL.colors.success : TERMINAL.colors.amber },
            ]}
          >
            Choice Mix Total: {choiceTotal}%
          </Text>
        </View>
      );
    },
  },
];

function areSettingsEqual(left: GenerationSettings, right: GenerationSettings): boolean {
  return (Object.keys(right) as Array<keyof GenerationSettings>).every((key) => left[key] === right[key]);
}

// ========================================
// MAIN COMPONENT (INLINE PANEL)
// ========================================

interface GenerationSettingsPanelProps {
  settings: GenerationSettings;
  onChange: (settings: GenerationSettings) => void;
  /** If true, shows save/reset footer buttons */
  showFooter?: boolean;
  /** Callback when save is clicked (only if showFooter=true) */
  onSave?: () => void;
}

export const GenerationSettingsPanel: React.FC<GenerationSettingsPanelProps> = ({
  settings,
  onChange,
  showFooter = false,
  onSave,
}) => {
  const updateSetting = <K extends keyof GenerationSettings>(
    key: K,
    value: GenerationSettings[K]
  ) => {
    onChange({ ...settings, [key]: value });
  };
  
  const resetAll = () => {
    onChange(DEFAULT_GENERATION_SETTINGS);
  };
  
  const isDefault = areSettingsEqual(settings, DEFAULT_GENERATION_SETTINGS);

  const renderField = (field: SettingFieldConfig) => {
    if (field.condition && !field.condition(settings)) {
      return null;
    }

    if (field.type === 'toggle') {
      return (
        <ToggleRow
          key={String(field.key)}
          label={field.label}
          description={field.description}
          value={Boolean(settings[field.key])}
          onChange={(value) => updateSetting(field.key, value as GenerationSettings[typeof field.key])}
        />
      );
    }

    if (field.type === 'select') {
      const currentValue = String(settings[field.key]);
      return (
        <View key={String(field.key)} style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>{field.label}</Text>
            <Text style={styles.settingDescription}>{field.description}</Text>
          </View>
          <View style={styles.selectRow}>
            {field.options.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.selectOption, currentValue === opt.value && styles.selectOptionActive]}
                onPress={() => updateSetting(field.key, opt.value as GenerationSettings[typeof field.key])}
              >
                <Text style={[styles.selectOptionText, currentValue === opt.value && styles.selectOptionTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      );
    }

    return (
      <SettingRow
        key={String(field.key)}
        label={field.label}
        description={field.description}
        value={Number(settings[field.key])}
        onChange={(value) => updateSetting(field.key, value as GenerationSettings[typeof field.key])}
        min={field.min}
        max={field.max}
        step={field.step}
        unit={field.unit}
        defaultValue={Number(DEFAULT_GENERATION_SETTINGS[field.key])}
      />
    );
  };
  
  return (
    <View style={styles.container}>
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {SETTINGS_SECTIONS.map((section) => (
          <Section
            key={section.id}
            title={section.title}
            icon={section.icon}
            defaultExpanded={section.defaultExpanded}
          >
            {section.description ? (
              <Text style={styles.sectionDescription}>{section.description}</Text>
            ) : null}
            {section.fields.map(renderField)}
            {section.footer ? section.footer(settings) : null}
          </Section>
        ))}
      </ScrollView>
      
      {/* Footer (optional) */}
      {showFooter && (
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.footerButton, styles.resetAllButton]}
            onPress={resetAll}
            disabled={isDefault}
          >
            <RotateCcw size={14} color={isDefault ? TERMINAL.colors.muted : TERMINAL.colors.amber} />
            <Text style={[styles.footerButtonText, isDefault && styles.footerButtonTextDisabled]}>
              RESET ALL
            </Text>
          </TouchableOpacity>
          {onSave && (
            <TouchableOpacity
              style={[styles.footerButton, styles.saveButton]}
              onPress={onSave}
            >
              <Save size={14} color="white" />
              <Text style={styles.saveButtonText}>SAVE</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
};

// ========================================
// STYLES
// ========================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  section: {
    marginBottom: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderRadius: 12,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
  sectionTitle: {
    flex: 1,
    color: 'white',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  sectionContent: {
    padding: 12,
    paddingTop: 4,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.03)',
  },
  settingInfo: {
    flex: 1,
    marginRight: 12,
  },
  settingLabel: {
    color: 'white',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 2,
  },
  settingDescription: {
    color: TERMINAL.colors.muted,
    fontSize: 10,
    lineHeight: 14,
  },
  settingControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  adjustButton: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  adjustButtonText: {
    color: TERMINAL.colors.primary,
    fontSize: 16,
    fontWeight: '700',
  },
  valueContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: 6,
    paddingHorizontal: 8,
    minWidth: 50,
  },
  valueInput: {
    color: 'white',
    fontSize: 13,
    fontWeight: '700',
    fontFamily: 'monospace',
    textAlign: 'center',
    paddingVertical: 4,
    minWidth: 30,
  },
  unitText: {
    color: TERMINAL.colors.muted,
    fontSize: 10,
    marginLeft: 2,
  },
  resetButton: {
    padding: 6,
    marginRight: 4,
  },
  resetButtonPlaceholder: {
    width: 24, // Same as resetButton with padding
    marginRight: 4,
  },
  footer: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
  },
  footerButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 10,
  },
  resetAllButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  saveButton: {
    backgroundColor: TERMINAL.colors.primary,
  },
  footerButtonText: {
    color: TERMINAL.colors.amber,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  footerButtonTextDisabled: {
    color: TERMINAL.colors.muted,
  },
  saveButtonText: {
    color: 'white',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  sectionDescription: {
    color: TERMINAL.colors.muted,
    fontSize: 10,
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingTop: 8,
    paddingBottom: 4,
  },
  totalLabel: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  selectRow: {
    flexDirection: 'row',
    gap: 4,
  },
  selectOption: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  selectOptionActive: {
    backgroundColor: TERMINAL.colors.primary,
  },
  selectOptionText: {
    color: TERMINAL.colors.muted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  selectOptionTextActive: {
    color: 'white',
  },
});

// Re-export for backwards compatibility
export { GenerationSettingsPanel as AdvancedSettingsModal };
export default GenerationSettingsPanel;
