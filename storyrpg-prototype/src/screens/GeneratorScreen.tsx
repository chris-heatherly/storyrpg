// @ts-nocheck — TODO(tech-debt): Phase 4 client/pipeline decoupling will replace
// direct FullStoryPipeline imports with PipelineClient facade and restore typecheck.
/**
 * Generator Screen
 *
 * Main screen for running the AI story generation pipeline.
 * Wired to the real FullStoryPipeline for actual AI generation.
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  SafeAreaView,
  TextInput,
  Platform,
  ActivityIndicator,
  Switch,
  Image,
  Modal,
  Pressable,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  ChevronRight,
  ChevronDown,
  Bot,
  FileText,
  Zap,
  Layers,
  Settings,
  AlertCircle,
  CheckCircle2,
  Cpu,
  RefreshCw,
  FolderOpen,
  Search,
  Sparkles,
  Download,
  Trash2,
  Volume2,
  StopCircle,
  Users,
  BookOpen,
  ImageIcon,
  Film,
  Play,
  Library,
  PauseCircle,
} from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { TERMINAL } from '../theme';
import { PipelineProgress } from '../components/PipelineProgress';
import type { PipelineRuntimeSnapshot } from '../components/PipelineProgress';
import { CheckpointReview } from '../components/CheckpointReview';
import { ImageJobPanel } from '../components/ImageJobPanel';
import { VideoJobPanel } from '../components/VideoJobPanel';
import { StepIndicator, deriveWizardStep } from './generator/StepIndicator';
import { AdvancedSettingsSheet } from './generator/AdvancedSettingsSheet';
import { ProgressStep } from './generator/steps/ProgressStep';
import { CompleteStep } from './generator/steps/CompleteStep';
import { GenerationSettingsPanel, GenerationSettings } from '../components/GenerationSettingsPanel';
import { useGeneratorSettingsStore } from '../stores/generatorSettingsStore';
import { seasonPlanStore } from '../stores/seasonPlanStore';
import { SeasonPlan, EpisodeRecommendation } from '../types/seasonPlan';
import { SeasonPlannerAgent } from '../ai-agents/agents/SeasonPlannerAgent';
import { useImageJobStore } from '../stores/imageJobStore';
import { useVideoJobStore } from '../stores/videoJobStore';
import { useGenerationJobStore, PipelineEventData } from '../stores/generationJobStore';
import { useGeneratorSettings } from '../hooks/useGeneratorSettings';
import { useAvailableModels } from '../hooks/useAvailableModels';
import { ModelDropdown } from '../components/ModelDropdown';
import { ModelTaskSheet } from '../components/ModelTaskSheet';
import { ConfirmDialog, SegmentedControl } from '../components/ui';
import {
  MODEL_FAMILY_PRESETS,
  PIPELINE_TASKS,
  modelLabel,
} from '../config/modelFamilies';
import type { GeneratorLlmProvider } from '../config/generatorLlmOptions';
import { useGeneratorRunner } from '../hooks/useGeneratorRunner';
import { buildPipelineConfig, PipelineConfigExtras } from '../ai-agents/config/buildPipelineConfig';
import { StyleArchitect } from '../ai-agents/agents/StyleArchitect';
import { ImageGenerationService } from '../ai-agents/services/imageGenerationService';
import { useStyleSetup, AnchorRole } from './generator/hooks/useStyleSetup';
import { StyleSetupSection } from './generator/StyleSetupSection';
import { CanonWizard } from './generator/CanonWizard';
import { runStoryAnalysis, runStoryGeneration } from '../ai-agents/services/storyGenerationService';
import { buildGeneratorCreativeBrief } from './generator/buildCreativeBrief';
import {
  applyCanonToSeasonPlan,
  applyCanonToSourceAnalysis,
  createCanonWizardState,
} from '../ai-agents/utils/sourceCanonEditor';

// Import the real pipeline
import {
  FullStoryPipeline,
  FullCreativeBrief,
  FullPipelineResult,
  CheckpointData as PipelineCheckpointData,
  OutputManifest,
  SourceAnalysisResult,
} from '../ai-agents/pipeline/FullStoryPipeline';
import { PipelineConfig, DEFAULT_MIDJOURNEY_SETTINGS, DEFAULT_GEMINI_SETTINGS, DEFAULT_OPENAI_SETTINGS, DEFAULT_STABLE_DIFFUSION_SETTINGS, DEFAULT_LORA_TRAINING_SETTINGS, CharacterReferenceMode } from '../ai-agents/config';
import { DEFAULT_LLM_MODELS, STABLE_DIFFUSION_UI_ENABLED } from '../config/generatorLlmOptions';
import { ART_STYLE_PRESETS } from '../ai-agents/config/artStylePresets';
import { composeCanonicalStyleString } from '../ai-agents/images/artStyleProfile';
import { EndingMode, SourceMaterialAnalysis, StoryEndingTarget } from '../types/sourceAnalysis';
import type {
  CanonEditRepairSuggestion,
  CanonEditValidationResult,
  CanonWizardState,
  LockedStoryCanon,
} from '../types/storyCanon';
import type { MediaSetupTarget, Story } from '../types';
import {
  storyToTypeScript,
  getStoryFileName,
  formatStoryStats,
} from '../ai-agents/utils/storyExporter';
import {
  parseDocument,
  parseDocumentFromPdf,
  ParsedDocument,
  DocumentParseResult,
  generateDocumentTemplate,
} from '../ai-agents/utils/documentParser';
import { PROXY_CONFIG } from '../config/endpoints';
import { applyEndingModeToAnalysis } from '../ai-agents/utils/endingResolver';
import { countVisibleImageJobs } from '../utils/imageJobDisplay';

// Import PipelineEvent from canonical source
import type { PipelineEvent } from '../ai-agents/pipeline';

const isSeasonEpisodeGenerated = (episode?: {
  status?: string;
  generatedEpisodeId?: string;
  generatedStoryId?: string;
  generatedJobId?: string;
  outputDir?: string;
}) => Boolean(
  episode
  && (
    episode.status === 'completed'
    || episode.generatedEpisodeId
    || episode.generatedStoryId
    || episode.generatedJobId
    || episode.outputDir
  )
);

const USE_SERVER_WORKER =
  Platform.OS === 'web' && process.env.EXPO_PUBLIC_USE_SERVER_WORKER !== 'false';

// Distinguish "the proxy/worker is unreachable" (transport/infra) from a
// worker-INTERNAL pipeline failure (a timeout, a validation abort, etc.). Only
// the former should tell the user to start the proxy; the latter must surface
// its real error so it isn't misdiagnosed as an infra problem.
const PROXY_UNREACHABLE_PATTERNS = [
  'failed to start worker job',
  'worker start response missing',
  'failed to fetch',
  'fetch failed',
  'network request failed',
  'econnrefused',
  'err_connection_reset',
  'connection reset',
  'worker job polling failed',
];
function isProxyUnreachableError(message: string): boolean {
  const m = (message || '').toLowerCase();
  return PROXY_UNREACHABLE_PATTERNS.some((p) => m.includes(p));
}

interface CheckpointData {
  phase: string;
  data: unknown;
  timestamp: Date;
  requiresApproval: boolean;
}

type GeneratorState = 'idle' | 'config' | 'analyzing' | 'analysis_complete' | 'running' | 'checkpoint' | 'complete' | 'cancelled' | 'error';
type GenerationMode = 'strict' | 'advisory' | 'disabled';

type AnalysisCharacterTarget = {
  id: string;
  name: string;
  role: string;
  description: string;
  isProtagonist: boolean;
};

type UploadedCharacterReference = {
  id: string;
  name: string;
  uri: string;
  mimeType: string;
  data: string;
};

type StyleReferenceStrength = 'subtle' | 'balanced' | 'strong';

type StyleReferenceUpload = {
  id: string;
  name: string;
  uri: string;
  mimeType: string;
  data: string;
  imagePath?: string;
};

type SavedArtStyle = {
  id: string;
  name: string;
  style: string;
};

const MAX_STYLE_REFERENCE_UPLOADS = 4;
const SAVED_ART_STYLES_KEY = '@storyrpg_saved_art_styles';
const RECENT_ART_STYLES_KEY = '@storyrpg_recent_art_styles';
const MAX_SAVED_ART_STYLES = 12;
const MAX_RECENT_ART_STYLES = 8;
const buildSavedArtStyleId = (): string => `style-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const normalizeSavedArtStyle = (item: unknown): SavedArtStyle | null => {
  if (typeof item === 'string') {
    const trimmed = item.trim();
    if (!trimmed) return null;
    return { id: trimmed, name: trimmed, style: trimmed };
  }
  if (!item || typeof item !== 'object') return null;
  const record = item as { id?: unknown; name?: unknown; style?: unknown };
  const style = typeof record.style === 'string' ? record.style.trim() : '';
  if (!style) return null;
  const name = typeof record.name === 'string' && record.name.trim()
    ? record.name.trim()
    : style;
  const id = typeof record.id === 'string' && record.id.trim()
    ? record.id.trim()
    : `${name}:${style}`;
  return { id, name, style };
};

const inferImageMimeType = (name?: string, mimeType?: string): string => {
  if (mimeType && mimeType.startsWith('image/')) return mimeType;
  const normalized = (name || '').toLowerCase();
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg';
  if (normalized.endsWith('.webp')) return 'image/webp';
  if (normalized.endsWith('.gif')) return 'image/gif';
  return 'image/png';
};

const buildStyleReferenceStoryId = (title: string): string => {
  const storyIdSeed = (title || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return storyIdSeed || 'untitled';
};

const getEndingConfidenceLabel = (ending: StoryEndingTarget): string => {
  if (ending.sourceConfidence === 'generated') return 'Generated by pipeline';
  if (ending.sourceConfidence === 'inferred') return 'Inferred from source';
  return 'Found in source';
};

const GENERATION_MODE_OPTIONS: Array<{
  value: GenerationMode;
  label: string;
  description: string;
}> = [
  { value: 'strict', label: 'STRICT', description: 'Block warnings and errors.' },
  { value: 'advisory', label: 'ADVISORY', description: 'Block errors, allow warnings.' },
  { value: 'disabled', label: 'OFF', description: 'Skip validation gates.' },
];

interface SetupStepCardProps {
  step: string;
  title: string;
  description: string;
  children: React.ReactNode;
}

const SetupStepCard: React.FC<SetupStepCardProps> = ({
  step,
  title,
  description,
  children,
}) => (
  <View style={styles.setupStepCard}>
    <View style={styles.setupStepHeader}>
      <View style={styles.setupStepBadge}>
        <Text style={styles.setupStepBadgeText}>{step}</Text>
      </View>
      <View style={styles.setupStepHeaderText}>
        <Text style={styles.setupStepTitle}>{title}</Text>
        <Text style={styles.setupStepDescription}>{description}</Text>
      </View>
    </View>
    <View style={styles.setupStepBody}>{children}</View>
  </View>
);

interface ConfigBucketCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  expanded: boolean;
  onToggleExpanded: () => void;
  summaryLines: string[];
  children: React.ReactNode;
  enabled?: boolean;
  onToggleEnabled?: (value: boolean) => void;
}

const ConfigBucketCard: React.FC<ConfigBucketCardProps> = ({
  title,
  description,
  icon,
  expanded,
  onToggleExpanded,
  summaryLines,
  children,
  enabled,
  onToggleEnabled,
}) => (
  <View style={styles.setupStepCard}>
    <View style={styles.bucketCardHeader}>
      <TouchableOpacity style={styles.bucketCardHeaderMain} onPress={onToggleExpanded} activeOpacity={0.85}>
        <View style={styles.bucketCardTitleRow}>
          <View style={styles.bucketCardIconWrap}>{icon}</View>
          <View style={styles.bucketCardTitleBlock}>
            <Text style={styles.setupStepTitle}>{title}</Text>
            <Text style={styles.setupStepDescription}>{description}</Text>
          </View>
        </View>
        {!expanded && summaryLines.length > 0 && (
          <View style={styles.bucketSummary}>
            {summaryLines.map((line) => (
              <Text key={line} style={styles.bucketSummaryText}>{line}</Text>
            ))}
          </View>
        )}
      </TouchableOpacity>
      <View style={styles.bucketCardControls}>
        {typeof enabled === 'boolean' && onToggleEnabled ? (
          <View style={styles.bucketToggleWrap}>
            <Text style={[styles.bucketToggleState, enabled ? styles.bucketToggleStateEnabled : null]}>
              {enabled ? 'ON' : 'OFF'}
            </Text>
            <Switch
              value={enabled}
              onValueChange={onToggleEnabled}
              trackColor={{ false: '#333', true: TERMINAL.colors.cyan }}
              thumbColor="#fff"
            />
          </View>
        ) : null}
        <ChevronRight
          size={16}
          color={TERMINAL.colors.muted}
          style={{ transform: [{ rotate: expanded ? '90deg' : '0deg' }] }}
        />
      </View>
    </View>
    {expanded && <View style={styles.setupStepBody}>{children}</View>}
  </View>
);

interface GeneratorScreenProps {
  onBack: () => void;
  onStoryGenerated?: (story: Story) => void;
  /**
   * Called when the user clicks "Play now" on the completion screen. The host
   * app should add the story to the library, initialize it in the game store,
   * and navigate to the reading surface.
   */
  onPlayStory?: (story: Story) => void | Promise<void>;
  /**
   * Called when the user clicks "View in library" on the completion screen.
   * The host app should navigate to the story library (usually Home).
   */
  onViewLibrary?: () => void;
  resumeJobId?: string; // If provided, resume viewing this job's progress
  initialSeasonPlanId?: string;
  initialSetupView?: 'story' | 'image' | 'video';
  mediaSetupTarget?: MediaSetupTarget;
  onGenerateTargetImages?: (target: MediaSetupTarget) => void | Promise<void>;
  onGenerateTargetVideos?: (target: MediaSetupTarget) => void | Promise<void>;
  onCancelExternalPipeline?: () => void;
}

type FailureWorkspaceState = {
  failureContext: Record<string, unknown> | null;
  checkpoint: Record<string, unknown> | null;
  resumePlan: Record<string, unknown> | null;
  tab: 'failure' | 'fix' | 'resume';
  payloadPatchJson: string;
  outputsPatchJson: string;
  loading: boolean;
  resuming: boolean;
  error: string | null;
};

const buildPipelineRuntimeSnapshot = (
  statusData: any,
  fallbackJobId?: string | null,
): PipelineRuntimeSnapshot => {
  const progress = Math.max(0, Math.min(100, Number(statusData?.progress ?? 0)));
  const currentPhase = typeof statusData?.currentPhase === 'string' ? statusData.currentPhase : undefined;
  const imageProgress =
    statusData?.imageProgress && typeof statusData.imageProgress.current === 'number'
      ? { current: statusData.imageProgress.current, total: statusData.imageProgress.total || 0 }
      : typeof statusData?.currentItem === 'number' && typeof statusData?.totalItems === 'number'
        ? { current: statusData.currentItem, total: statusData.totalItems || 0 }
        : null;

  return {
    jobId: statusData?.id || fallbackJobId || undefined,
    friendlyName: typeof statusData?.friendlyName === 'string' ? statusData.friendlyName : undefined,
    processTitle: typeof statusData?.processTitle === 'string' ? statusData.processTitle : undefined,
    status: statusData?.status,
    currentPhase,
    progress,
    phaseProgress: typeof statusData?.phaseProgress === 'number' ? statusData.phaseProgress : undefined,
    startedAt: statusData?.startedAt || statusData?.createdAt,
    updatedAt: statusData?.updatedAt,
    elapsedSeconds: typeof statusData?.elapsedSeconds === 'number' ? statusData.elapsedSeconds : undefined,
    etaSeconds: typeof statusData?.etaSeconds === 'number' || statusData?.etaSeconds === null ? statusData.etaSeconds : undefined,
    currentItem: typeof statusData?.currentItem === 'number' ? statusData.currentItem : undefined,
    totalItems: typeof statusData?.totalItems === 'number' ? statusData.totalItems : undefined,
    subphaseLabel: typeof statusData?.subphaseLabel === 'string' ? statusData.subphaseLabel : undefined,
    imageProgress,
    imageJobs: Array.isArray(statusData?.imageJobs) ? statusData.imageJobs : [],
    imageManifest: Array.isArray(statusData?.imageManifest) ? statusData.imageManifest : [],
    generationPlan:
      statusData?.generationPlan && Array.isArray(statusData.generationPlan.episodes)
        ? statusData.generationPlan
        : undefined,
    resumeFromJobId: statusData?.resumeFromJobId,
    outputDirectory:
      statusData?.checkpoint?.resumeContext?.outputDirectory ||
      statusData?.checkpoint?.outputs?.output_directory?.outputDirectory,
  };
};

export const GeneratorScreen: React.FC<GeneratorScreenProps> = ({
  onBack,
  onStoryGenerated,
  onPlayStory,
  onViewLibrary,
  resumeJobId,
  initialSeasonPlanId,
  initialSetupView = 'story',
  mediaSetupTarget,
  onGenerateTargetImages,
  onGenerateTargetVideos,
  onCancelExternalPipeline,
}) => {
  const [state, setState] = useState<GeneratorState>('config');
  const [setupView, setSetupView] = useState<'story' | 'image' | 'video'>(initialSetupView);
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [currentPhase, setCurrentPhase] = useState<string | undefined>();
  const [currentCheckpoint, setCurrentCheckpoint] = useState<CheckpointData | null>(null);
  const [generatedStory, setGeneratedStory] = useState<Story | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [outputManifest, setOutputManifest] = useState<OutputManifest | null>(null);
  const [outputDirectory, setOutputDirectory] = useState<string | null>(null);
  
  // Current generation job ID
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [liveProgress, setLiveProgress] = useState(0);
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
  const [imageProgress, setImageProgress] = useState<{ current: number; total: number } | null>(null);
  const [pipelineRuntime, setPipelineRuntime] = useState<PipelineRuntimeSnapshot | null>(null);
  const seenManifestIdsRef = useRef<Set<string>>(new Set());
  const seenImageJobIdsRef = useRef<Set<string>>(new Set());
  const generationStartedAtRef = useRef<number>(Date.now());
  const resumePlanUnavailableRef = useRef(false);

  // Pipeline reference for checkpoint continuation
  const pipelineRef = useRef<FullStoryPipeline | null>(null);
  const checkpointResolverRef = useRef<((approved: boolean) => void) | null>(null);
  
  // Track completed phases for checkpoint/resume
  const completedPhasesRef = useRef<string[]>([]);
  const lastSuccessfulPhaseRef = useRef<string | null>(null);
  const currentBriefRef = useRef<FullCreativeBrief | null>(null);

  const {
    llmProvider,
    llmModel,
    imageLlmProvider,
    imageLlmModel,
    videoLlmProvider,
    videoLlmModel,
    apiKey,
    openaiApiKey,
    openRouterApiKey,
    geminiApiKey,
    elevenLabsApiKey,
    atlasCloudApiKey,
    atlasCloudModel,
    midapiToken,
    midjourneySettings,
    geminiSettings,
    openaiSettings,
    stableDiffusionSettings,
    loraTrainingSettings,
    imageProvider,
    artStyle,
    imageStrategy,
    generationSettings,
    generationMode,
    narrationSettings,
    videoSettings,
    modelFamily,
    taskModelOverrides,
    effectiveTaskAssignments,
    handleModelFamilyChange,
    handleTaskModelChange,
    handleTaskProviderChange,
    resetTaskModel,
    handleImageLlmProviderChange,
    handleImageLlmModelChange,
    handleVideoLlmProviderChange,
    handleVideoLlmModelChange,
    handleGenerationModeChange,
    handleAtlasCloudModelChange,
    handleGeminiSettingsChange,
    handleOpenaiSettingsChange,
    handleMidjourneySettingsChange,
    handleStableDiffusionSettingsChange,
    handleLoraTrainingSettingsChange,
    handleImageProviderChange,
    handleArtStyleChange,
    handleGenerationSettingsChange,
    updateNarrationSetting,
    updateVideoSetting,
  } = useGeneratorSettings();
  const { models: availableModels, atlasCloudModels, scannedAt: modelsScanDate, loading: modelsScanLoading, refresh: refreshModels } = useAvailableModels();
  const [showMjSettings, setShowMjSettings] = useState(false);
  const [showGeminiSettings, setShowGeminiSettings] = useState(false);
  const [showSdSettings, setShowSdSettings] = useState(false);
  const [showLoraSettings, setShowLoraSettings] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [showModelTaskSheet, setShowModelTaskSheet] = useState(false);
  // Keep STORY open by default (the required prompt/doc lives inside); start
  // all other optional buckets collapsed so the primary CTA is reachable
  // without a long scroll. The full wizard refactor (Tranche B) replaces this
  // with an explicit step indicator.
  const [showStoryPanel, setShowStoryPanel] = useState(true);
  const [assetGenerationMode] = useState<'story-only' | 'story-and-images'>('story-and-images');
  const [showImagesPanel, setShowImagesPanel] = useState(false);
  const [styleReferenceUploads, setStyleReferenceUploads] = useState<StyleReferenceUpload[]>([]);
  const [styleReferenceStrength, setStyleReferenceStrength] = useState<StyleReferenceStrength>('balanced');
  const [savedArtStyles, setSavedArtStyles] = useState<SavedArtStyle[]>([]);
  const [recentArtStyles, setRecentArtStyles] = useState<string[]>([]);
  const [showArtStyleSheet, setShowArtStyleSheet] = useState(false);
  const [artStyleEditorVisible, setArtStyleEditorVisible] = useState(false);
  const [editingArtStyleOriginal, setEditingArtStyleOriginal] = useState<SavedArtStyle | null>(null);
  const [editingArtStyleName, setEditingArtStyleName] = useState('');
  const [editingArtStyleDraft, setEditingArtStyleDraft] = useState('');
  const [showNarrationPanel, setShowNarrationPanel] = useState(false);
  const [showVideoPanel, setShowVideoPanel] = useState(false);
  const [runGenerateImages, setRunGenerateImages] = useState(generationSettings.generateImages);
  const [runGenerateVideo, setRunGenerateVideo] = useState(videoSettings.enabled);
  const [confirmCancelGeneration, setConfirmCancelGeneration] = useState(false);
  const [showJobsSheet, setShowJobsSheet] = useState(false);

  // Surface background image/video jobs in a header pill + bottom sheet rather
  // than mounting the full panels at the bottom of the generator scroll. The
  // pill is only rendered when jobs exist.
  const imageJobCount = useImageJobStore((s) => countVisibleImageJobs(s.jobs));
  const videoJobCount = useVideoJobStore((s) => Object.keys(s.jobs).length);
  const totalBackgroundJobs = imageJobCount + videoJobCount;
  const hasBackgroundJobs = totalBackgroundJobs > 0;

  useEffect(() => {
    setSetupView(initialSetupView || 'story');
  }, [initialSetupView, mediaSetupTarget?.storyId, mediaSetupTarget?.episodeNumber]);

  useEffect(() => {
    setRunGenerateImages(generationSettings.generateImages);
  }, [generationSettings.generateImages]);

  useEffect(() => {
    setRunGenerateVideo(videoSettings.enabled);
  }, [videoSettings.enabled]);

  // Document mode state
  const [documentPath, setDocumentPath] = useState('');
  const [documentContent, setDocumentContent] = useState('');
  const [parsedDocument, setParsedDocument] = useState<ParsedDocument | null>(null);
  const [documentBrief, setDocumentBrief] = useState<FullCreativeBrief | null>(null);
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [isLoadingDocument, setIsLoadingDocument] = useState(false);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [userPrompt, setUserPrompt] = useState('');

  // Source analysis state
  const [sourceAnalysis, setSourceAnalysis] = useState<SourceMaterialAnalysis | null>(null);
  const [analysisResult, setAnalysisResult] = useState<SourceAnalysisResult | null>(null);
  const [canonWizardState, setCanonWizardState] = useState<CanonWizardState | null>(null);
  const [selectedEpisodeCount, setSelectedEpisodeCount] = useState<number>(1);
  const [customStoryTitle, setCustomStoryTitle] = useState('');
  const [characterReferenceUploads, setCharacterReferenceUploads] = useState<Record<string, UploadedCharacterReference[]>>({});
  const [characterReferenceModes, setCharacterReferenceModes] = useState<Record<string, CharacterReferenceMode>>({});
  
  // Season Plan state
  const [seasonPlan, setSeasonPlan] = useState<SeasonPlan | null>(null);
  const [selectedEpisodes, setSelectedEpisodes] = useState<number[]>([]);
  const [episodeRecommendations, setEpisodeRecommendations] = useState<EpisodeRecommendation[]>([]);
  const [selectionWarnings, setSelectionWarnings] = useState<string[]>([]);
  const [isCreatingSeasonPlan, setIsCreatingSeasonPlan] = useState(false);
  const activeEndingMode: EndingMode = sourceAnalysis?.resolvedEndingMode || sourceAnalysis?.detectedEndingMode || 'single';
  const activeEndings = sourceAnalysis?.resolvedEndings || [];
  const nextSeasonEpisode = seasonPlan?.episodes
    ?.filter((episode) => !isSeasonEpisodeGenerated(episode))
    .sort((a, b) => a.episodeNumber - b.episodeNumber)[0] || null;

  const fonts = useGeneratorSettingsStore((state) => state.getFontSizes());

  const presetStyleOptions = useMemo(() => ART_STYLE_PRESETS.slice(0, 9), []);
  const selectedPresetId = useMemo(() => {
    const normalized = artStyle.trim();
    if (!normalized) return null;
    return ART_STYLE_PRESETS.find((preset) => composeCanonicalStyleString(preset.profile) === normalized)?.id || null;
  }, [artStyle]);
  const currentArtStyleLabel = useMemo(() => {
    if (selectedPresetId) {
      return ART_STYLE_PRESETS.find((preset) => preset.id === selectedPresetId)?.displayName || 'Preset style';
    }
    const trimmed = artStyle.trim();
    if (!trimmed) return '';
    return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
  }, [artStyle, selectedPresetId]);

  const applyArtStyle = useCallback((style: string) => {
    const trimmed = style.trim();
    handleArtStyleChange(trimmed);
    if (!trimmed) return;
    setRecentArtStyles((prev) => {
      const next = [trimmed, ...prev.filter((item) => item !== trimmed)].slice(0, MAX_RECENT_ART_STYLES);
      AsyncStorage.setItem(RECENT_ART_STYLES_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, [handleArtStyleChange]);

  const applyPresetArtStyle = useCallback((presetId: string) => {
    const preset = ART_STYLE_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    applyArtStyle(composeCanonicalStyleString(preset.profile) || preset.profile.name);
  }, [applyArtStyle]);

  const openNewArtStyleEditor = useCallback(() => {
    setEditingArtStyleOriginal(null);
    setEditingArtStyleName('');
    setEditingArtStyleDraft('');
    setArtStyleEditorVisible(true);
  }, []);

  const openEditArtStyleEditor = useCallback((style: SavedArtStyle) => {
    setEditingArtStyleOriginal(style);
    setEditingArtStyleName(style.name);
    setEditingArtStyleDraft(style.style);
    setArtStyleEditorVisible(true);
  }, []);

  const openEditCurrentArtStyleEditor = useCallback(() => {
    const current = artStyle.trim();
    if (!current) return;
    const savedMatch = savedArtStyles.find((item) => item.style === current);
    if (savedMatch) {
      openEditArtStyleEditor(savedMatch);
      return;
    }
    setEditingArtStyleOriginal(null);
    setEditingArtStyleName(currentArtStyleLabel || 'Custom style');
    setEditingArtStyleDraft(current);
    setArtStyleEditorVisible(true);
  }, [artStyle, currentArtStyleLabel, openEditArtStyleEditor, savedArtStyles]);

  const saveEditedArtStyle = useCallback(() => {
    const name = editingArtStyleName.trim();
    const trimmed = editingArtStyleDraft.trim();
    if (!name) {
      Alert.alert('No Style Name', 'Give this art style a name before saving it.');
      return;
    }
    if (!trimmed) {
      Alert.alert('No Art Style', 'Describe the visual style before saving it.');
      return;
    }

    setSavedArtStyles((prev) => {
      const id = editingArtStyleOriginal?.id || buildSavedArtStyleId();
      const saved = { id, name, style: trimmed };
      const next = [
        saved,
        ...prev.filter((item) => item.id !== id && item.name !== name),
      ].slice(0, MAX_SAVED_ART_STYLES);
      AsyncStorage.setItem(SAVED_ART_STYLES_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
    applyArtStyle(trimmed);
    setArtStyleEditorVisible(false);
    setEditingArtStyleOriginal(null);
    setEditingArtStyleName('');
    setEditingArtStyleDraft('');
  }, [applyArtStyle, editingArtStyleDraft, editingArtStyleName, editingArtStyleOriginal]);

  const removeSavedArtStyle = useCallback((styleId: string) => {
    setSavedArtStyles((prev) => {
      const next = prev.filter((item) => item.id !== styleId);
      AsyncStorage.setItem(SAVED_ART_STYLES_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  useEffect(() => {
    let mounted = true;
    const loadArtStyleLists = async () => {
      try {
        const [savedRaw, recentRaw] = await Promise.all([
          AsyncStorage.getItem(SAVED_ART_STYLES_KEY),
          AsyncStorage.getItem(RECENT_ART_STYLES_KEY),
        ]);
        if (!mounted) return;
        if (savedRaw) {
          const parsed = JSON.parse(savedRaw);
          if (Array.isArray(parsed)) {
            setSavedArtStyles(
              parsed
                .map(normalizeSavedArtStyle)
                .filter((item): item is SavedArtStyle => Boolean(item))
                .slice(0, MAX_SAVED_ART_STYLES),
            );
          }
        }
        if (recentRaw) {
          const parsed = JSON.parse(recentRaw);
          if (Array.isArray(parsed)) setRecentArtStyles(parsed.filter((item) => typeof item === 'string').slice(0, MAX_RECENT_ART_STYLES));
        }
      } catch {
        // Art style shortcuts are convenience-only; ignore bad persisted data.
      }
    };
    loadArtStyleLists();
    return () => {
      mounted = false;
    };
  }, []);

  const analysisCharacters: AnalysisCharacterTarget[] = sourceAnalysis
    ? [
        {
          id: sourceAnalysis.protagonist.id,
          name: sourceAnalysis.protagonist.name,
          role: 'protagonist',
          description: sourceAnalysis.protagonist.description,
          isProtagonist: true,
        },
        ...sourceAnalysis.majorCharacters.map((char) => ({
          id: char.id,
          name: char.name,
          role: char.role.replace(/_/g, ' '),
          description: char.description,
          isProtagonist: false,
        })),
      ]
    : [];

  const {
    addJob: addImageJob,
    updateJob: updateImageJob,
    clearCompletedJobs,
  } = useImageJobStore();
  const { attachPipelineJobListeners, ensureProxyAvailable, runWorkerJob } = useGeneratorRunner();
  
  // Generation job tracking
  const { 
    registerJob: registerGenJob, 
    updateJob: updateGenJob, 
    addJobEvent,
    setActiveJobId,
    getJob,
    isJobCancelled: checkJobCancelled,
    cancelJob: cancelGenJob,
  } = useGenerationJobStore();

  const hydrateImageJobsFromWorkerStatus = useCallback((statusData: any) => {
    if (Array.isArray(statusData?.imageManifest)) {
      for (const shot of statusData.imageManifest) {
        if (!shot?.identifier || seenManifestIdsRef.current.has(shot.identifier)) continue;
        seenManifestIdsRef.current.add(shot.identifier);
        addImageJob({
          id: `manifest-${shot.identifier}`,
          identifier: shot.identifier,
          prompt: shot.description || '',
          maxRetries: 3,
          metadata: { sceneId: shot.sceneId, beatId: shot.beatId, type: 'beat' as const },
        });
      }
    }

    if (!Array.isArray(statusData?.imageJobs)) return;
    for (const imageJob of statusData.imageJobs) {
      if (!imageJob?.id) continue;
      const identifier = imageJob.identifier || imageJob.id;
      const manifestKey = `manifest-${identifier}`;
      const targetId = seenManifestIdsRef.current.has(identifier) ? manifestKey : imageJob.id;
      const progress = imageJob.status === 'completed'
        ? 100
        : imageJob.status === 'processing'
          ? 50
          : 0;
      const updates: Record<string, unknown> = {};
      if (imageJob.status !== undefined) updates.status = imageJob.status;
      if (imageJob.imageUrl !== undefined) updates.imageUrl = imageJob.imageUrl;
      if (imageJob.imagePath !== undefined) updates.imagePath = imageJob.imagePath;
      if (imageJob.localPath !== undefined) updates.localPath = imageJob.localPath;
      if (imageJob.error !== undefined) updates.error = imageJob.error;
      if (imageJob.status !== undefined) updates.progress = progress;

      if (seenImageJobIdsRef.current.has(imageJob.id)) {
        updateImageJob(targetId, updates);
        continue;
      }

      seenImageJobIdsRef.current.add(imageJob.id);
      if (seenManifestIdsRef.current.has(identifier)) {
        updateImageJob(manifestKey, updates);
      } else {
        addImageJob({
          id: imageJob.id,
          identifier,
          prompt: imageJob.prompt || '',
          maxRetries: imageJob.maxRetries || 3,
          metadata: imageJob.metadata,
        });
        if (imageJob.status !== 'pending') {
          updateImageJob(imageJob.id, updates);
        }
      }
    }
  }, [addImageJob, updateImageJob]);

  const getEpisodesToGenerate = useCallback((): number[] => {
    if (selectedEpisodes.length > 0) {
      return [...new Set(selectedEpisodes)].sort((a, b) => a - b);
    }
    return Array.from({ length: Math.max(1, selectedEpisodeCount) }, (_, i) => i + 1);
  }, [selectedEpisodeCount, selectedEpisodes]);

  const getLatestCompletedSeasonEpisode = useCallback(() => {
    if (!seasonPlan) return null;
    return [...seasonPlan.episodes]
      .filter((episode) => isSeasonEpisodeGenerated(episode) && (episode.generatedJobId || episode.outputDir))
      .sort((a, b) => (b.episodeNumber || 0) - (a.episodeNumber || 0))[0] || null;
  }, [seasonPlan]);

  const getContinuationJobId = useCallback((): string | undefined => (
    getLatestCompletedSeasonEpisode()?.generatedJobId || undefined
  ), [getLatestCompletedSeasonEpisode]);

  const getContinuationOutputDir = useCallback((): string | undefined => (
    getLatestCompletedSeasonEpisode()?.outputDir || undefined
  ), [getLatestCompletedSeasonEpisode]);

  const markSelectedEpisodesCompleted = useCallback(async (
    story: Story,
    jobId: string,
    completedOutputDir?: string,
  ) => {
    if (!seasonPlan) return;
    for (const episodeNumber of getEpisodesToGenerate()) {
      const episode = story.episodes.find((candidate) => candidate.number === episodeNumber);
      if (!episode) continue;
      await seasonPlanStore.updateEpisodeStatus(
        seasonPlan.id,
        episodeNumber,
        'completed',
        episode.id,
        story.id,
        jobId,
        completedOutputDir || story.outputDir,
      );
    }
    const updated = seasonPlanStore.getPlan(seasonPlan.id);
    if (updated) setSeasonPlan(updated.plan);
  }, [getEpisodesToGenerate, seasonPlan]);
  
  // Track if we're viewing a historical job (not actively running)
  const [isViewingHistory, setIsViewingHistory] = useState(false);
  const [historyJob, setHistoryJob] = useState<ReturnType<typeof getJob>>(undefined);
  const [failureWorkspace, setFailureWorkspace] = useState<FailureWorkspaceState>({
    failureContext: null,
    checkpoint: null,
    resumePlan: null,
    tab: 'failure',
    payloadPatchJson: '{}',
    outputsPatchJson: '{}',
    loading: false,
    resuming: false,
    error: null,
  });

  const buildAnalysisPreferences = () => ({
    targetScenesPerEpisode: 6,
    targetChoicesPerEpisode: 4,
    pacing: 'moderate' as const,
  });
  const isRecoverableHistoryJob = (job?: GenerationJob) => job?.status === 'failed' || job?.status === 'cancelled';

  // Resume viewing a job if resumeJobId is provided
  useEffect(() => {
    if (resumeJobId) {
      const job = getJob(resumeJobId);
      if (job) {
        setCurrentJobId(resumeJobId);
        setActiveJobId(resumeJobId);
        setCustomStoryTitle(job.storyTitle);
        setHistoryJob(job);
        setLiveProgress(Number(job.progress || 0));
        setEtaSeconds(null);
        
        // Restore events from job
        if (job.events && job.events.length > 0) {
          const restoredEvents: PipelineEvent[] = job.events.map(e => ({
            type: e.type,
            phase: e.phase,
            agent: e.agent,
            message: e.message,
            timestamp: new Date(e.timestamp),
          }));
          setEvents(restoredEvents);
          
          // Find current phase from events
          const lastPhaseEvent = [...job.events].reverse().find(e => e.type === 'phase_start');
          if (lastPhaseEvent?.phase) {
            setCurrentPhase(lastPhaseEvent.phase);
          }
        }
        
        // Restore state based on job status
        if (job.status === 'running' || job.status === 'pending') {
          setState('running');
          setIsViewingHistory(false);
        } else {
          // For completed/failed/cancelled jobs, show history view
          setIsViewingHistory(true);
          if (job.status === 'completed') {
            setState('complete');
          } else if (job.status === 'failed') {
            setState('error');
            setError(job.error || 'Generation failed');
          } else if (job.status === 'cancelled') {
            setState('error');
            setError('Generation was cancelled');
          }
        }
      }
    }
    
    return () => {
      // Clear active job when leaving
      setActiveJobId(null);
    };
  }, [resumeJobId, getJob, setActiveJobId]);

  useEffect(() => {
    if (!initialSeasonPlanId || resumeJobId || seasonPlan || sourceAnalysis || (state !== 'idle' && state !== 'config')) return;
    let cancelled = false;
    seasonPlanStore.initialize()
      .then(async () => {
        if (cancelled) return;
        const saved = seasonPlanStore.getPlan(initialSeasonPlanId);
        if (!saved) return;
        await seasonPlanStore.setActivePlan(initialSeasonPlanId);
        if (cancelled) return;
        const nextEpisode = saved.plan.episodes
          .filter((episode) => !isSeasonEpisodeGenerated(episode))
          .sort((a, b) => a.episodeNumber - b.episodeNumber)[0];
        setSeasonPlan(saved.plan);
        setSourceAnalysis(saved.sourceAnalysis);
        setCanonWizardState(saved.canonWizardState || (
          saved.sourceAnalysis.sourceCanon
            ? createCanonWizardState(saved.sourceAnalysis.sourceCanon, nextEpisode ? [nextEpisode.episodeNumber] : [])
            : null
        ));
        setAnalysisResult({
          analysis: saved.sourceAnalysis,
          totalEpisodes: saved.sourceAnalysis.totalEstimatedEpisodes || saved.plan.totalEpisodes,
          episodeOutlines: saved.sourceAnalysis.episodeBreakdown || saved.plan.episodes,
          suggestedOptions: [],
        });
        setCustomStoryTitle(saved.sourceAnalysis.sourceTitle || saved.plan.seasonTitle);
        if (nextEpisode) {
          setSelectedEpisodes([nextEpisode.episodeNumber]);
          setSelectedEpisodeCount(1);
        }
        setState('analysis_complete');
      })
      .catch((err) => {
        console.warn('[GeneratorScreen] Failed to load requested season plan:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [initialSeasonPlanId, resumeJobId, seasonPlan, sourceAnalysis, state]);

  const loadFailureWorkspace = useCallback(async (jobId: string) => {
    setFailureWorkspace((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const response = await fetch(`${PROXY_CONFIG.workerJobs}/${jobId}/failure-context`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to load failure context.');
      }
      let resumePlan: Record<string, unknown> | null = null;
      if (!resumePlanUnavailableRef.current) {
        try {
          const resumePlanResponse = await fetch(`${PROXY_CONFIG.workerJobs}/${jobId}/resume-plan`);
          if (resumePlanResponse.ok) {
            resumePlan = await resumePlanResponse.json().catch(() => null);
          } else if (resumePlanResponse.status === 404) {
            resumePlanUnavailableRef.current = true;
          }
        } catch {
          resumePlanUnavailableRef.current = true;
        }
      }
      setFailureWorkspace((prev) => ({
        ...prev,
        loading: false,
        failureContext: (data?.failureContext || null) as Record<string, unknown> | null,
        checkpoint: (data?.checkpoint || null) as Record<string, unknown> | null,
        resumePlan: (resumePlan || null) as Record<string, unknown> | null,
        tab: 'failure',
        error: null,
      }));
      await updateGenJob(jobId, {
        checkpoint: {
          ...(getJob(jobId)?.checkpoint || {}),
          failureContext: data?.failureContext || undefined,
          resumeContext: data?.checkpoint?.resumeContext || undefined,
          outputs: data?.checkpoint?.outputs || undefined,
        },
      });
    } catch (workspaceErr) {
      setFailureWorkspace((prev) => ({
        ...prev,
        loading: false,
        error: workspaceErr instanceof Error ? workspaceErr.message : 'Failed to load failure context.',
      }));
    }
  }, [getJob, updateGenJob]);

  useEffect(() => {
    const jobId = isRecoverableHistoryJob(historyJob) ? historyJob!.id : (state === 'error' ? currentJobId : null);
    if (!jobId) return;
    void loadFailureWorkspace(jobId);
  }, [currentJobId, historyJob?.id, historyJob?.status, loadFailureWorkspace, state]);

  useEffect(() => {
    if (!USE_SERVER_WORKER || state !== 'running' || !currentJobId) return;
    let cancelled = false;

    const applyWorkerStatus = async () => {
      try {
        const response = await fetch(`${PROXY_CONFIG.workerJobs}/${currentJobId}`);
        const statusData = await response.json().catch(() => null);
        if (cancelled || !response.ok || !statusData) return;

        const progress = Math.max(0, Math.min(100, Number(statusData.progress ?? 0)));
        const phase = typeof statusData.currentPhase === 'string' ? statusData.currentPhase : undefined;
        setPipelineRuntime(buildPipelineRuntimeSnapshot(statusData, currentJobId));
        if (phase) setCurrentPhase(phase);
        setLiveProgress(progress);

        if (typeof statusData.etaSeconds === 'number' || statusData.etaSeconds === null) {
          setEtaSeconds(statusData.etaSeconds);
        }
        if (typeof statusData.currentItem === 'number' && typeof statusData.totalItems === 'number') {
          setImageProgress({ current: statusData.currentItem, total: statusData.totalItems || 0 });
        }
        hydrateImageJobsFromWorkerStatus(statusData);

        if (Array.isArray(statusData.timeline) && statusData.timeline.length > 0) {
          const mappedEvents = statusData.timeline.slice(-80).map((entry: any): PipelineEvent => ({
            type: entry.type === 'pipeline_event'
              ? (entry.eventType || 'debug')
              : entry.type === 'image_job_event'
                ? 'debug'
                : entry.type === 'stderr'
                  ? 'warning'
                  : 'debug',
            phase: entry.phase || phase,
            agent: entry.agent,
            message: entry.message || entry.data?.identifier || entry.eventType || entry.type || 'worker update',
            timestamp: entry.timestamp ? new Date(entry.timestamp) : new Date(),
            telemetry: entry.telemetry,
          }));
          setEvents(mappedEvents);
        }

        await updateGenJob(currentJobId, {
          status: (statusData.status as any) || 'running',
          friendlyName: typeof statusData.friendlyName === 'string' ? statusData.friendlyName : undefined,
          processTitle: typeof statusData.processTitle === 'string' ? statusData.processTitle : undefined,
          currentPhase: phase || 'processing',
          progress,
          etaSeconds: typeof statusData.etaSeconds === 'number' || statusData.etaSeconds === null ? statusData.etaSeconds : undefined,
          currentItem: typeof statusData.currentItem === 'number' ? statusData.currentItem : undefined,
          totalItems: typeof statusData.totalItems === 'number' ? statusData.totalItems : undefined,
          subphaseLabel: typeof statusData.subphaseLabel === 'string' ? statusData.subphaseLabel : undefined,
        });

        if (statusData.status === 'failed') {
          setError(statusData.error || 'Generation failed');
          setState('error');
          void loadFailureWorkspace(currentJobId);
        } else if (statusData.status === 'completed') {
          setLiveProgress(100);
          setState('complete');
        }
      } catch (pollErr) {
        console.warn('[GeneratorScreen] Failed to poll worker status:', pollErr);
      }
    };

    void applyWorkerStatus();
    const interval = setInterval(() => { void applyWorkerStatus(); }, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [currentJobId, hydrateImageJobsFromWorkerStatus, loadFailureWorkspace, state, updateGenJob]);

  useEffect(() => {
    if (analysisCharacters.length === 0) {
      setCharacterReferenceUploads({});
      setCharacterReferenceModes({});
      return;
    }

    const validIds = new Set(analysisCharacters.map((character) => character.id));
    setCharacterReferenceUploads((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([characterId]) => validIds.has(characterId)))
    );
    setCharacterReferenceModes((prev) => {
      const next: Record<string, CharacterReferenceMode> = {};
      for (const character of analysisCharacters) {
        next[character.id] = prev[character.id] || 'face-only';
      }
      return next;
    });
  }, [sourceAnalysis]);

  // Document pickers and handlers
  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/plain', 'text/markdown', 'application/json', 'application/pdf', '*/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      setIsLoadingDocument(true);
      setDocumentError(null);
      setParsedDocument(null);
      setDocumentBrief(null);
      setSelectedFileName(asset.name);
      setDocumentPath(asset.uri);
      const isPdf = asset.name?.toLowerCase().endsWith('.pdf') || asset.mimeType === 'application/pdf';
      let parseResult: DocumentParseResult;
      if (isPdf) {
        let pdfData: ArrayBuffer;
        if (Platform.OS === 'web') {
          const response = await fetch(asset.uri);
          pdfData = await response.arrayBuffer();
        } else {
          const base64Content = await FileSystem.readAsStringAsync(asset.uri, { encoding: 'base64' });
          const binaryString = atob(base64Content);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
          pdfData = bytes.buffer;
        }
        parseResult = await parseDocumentFromPdf(pdfData, asset.name);
        if (parseResult.success && parseResult.document) setDocumentContent(parseResult.document.rawContent);
      } else {
        let content: string;
        if (Platform.OS === 'web') {
          const response = await fetch(asset.uri);
          content = await response.text();
        } else {
          content = await FileSystem.readAsStringAsync(asset.uri);
        }
        setDocumentContent(content);
        parseResult = parseDocument(content, asset.name);
      }
      if (parseResult.success && parseResult.document && parseResult.brief) {
        setParsedDocument(parseResult.document);
        setDocumentBrief(parseResult.brief);
        setParseWarnings(parseResult.warnings);
      } else {
        setDocumentError(parseResult.error || 'Failed to parse document');
      }
    } catch (err) {
      setDocumentError(`Failed to pick file: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsLoadingDocument(false);
    }
  };

  const clearDocument = () => {
    setDocumentPath(''); setDocumentContent(''); setParsedDocument(null); setDocumentBrief(null);
    setParseWarnings([]); setDocumentError(null); setSelectedFileName(null);
    setSourceAnalysis(null); setAnalysisResult(null); setCanonWizardState(null); setSelectedEpisodeCount(1);
    setCharacterReferenceUploads({}); setCharacterReferenceModes({});
  };

  const pickCharacterReference = async (character: AnalysisCharacterTarget) => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/*'],
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (result.canceled || !result.assets?.length) return;

      const newUploads: UploadedCharacterReference[] = [];
      for (const asset of result.assets) {
        if (!asset?.uri) continue;

        let data = '';
        let mimeType = inferImageMimeType(asset.name, asset.mimeType);

        if (Platform.OS === 'web') {
          const response = await fetch(asset.uri);
          const blob = await response.blob();
          mimeType = blob.type || mimeType;
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('Failed to read image file.'));
            reader.readAsDataURL(blob);
          });
          data = dataUrl.replace(/^data:[^;]+;base64,/, '');
        } else {
          data = await FileSystem.readAsStringAsync(asset.uri, { encoding: 'base64' as any });
        }

        if (!data) continue;

        newUploads.push({
          id: `${character.id}-${Date.now()}-${newUploads.length}`,
          name: asset.name || `${character.name} reference`,
          uri: asset.uri,
          mimeType,
          data,
        });
      }

      if (newUploads.length === 0) {
        Alert.alert('Upload Failed', 'Could not read the selected image(s). Please try other files.');
        return;
      }

      setCharacterReferenceUploads((prev) => ({
        ...prev,
        [character.id]: [...(prev[character.id] || []), ...newUploads],
      }));
      setCharacterReferenceModes((prev) => ({
        ...prev,
        [character.id]: prev[character.id] || 'face-only',
      }));
    } catch (err) {
      Alert.alert('Upload Failed', err instanceof Error ? err.message : 'Failed to load reference image(s).');
    }
  };

  const removeCharacterReference = (characterId: string, uploadId: string) => {
    setCharacterReferenceUploads((prev) => {
      const remaining = (prev[characterId] || []).filter((upload) => upload.id !== uploadId);
      if (remaining.length === 0) {
        const next = { ...prev };
        delete next[characterId];
        return next;
      }
      return { ...prev, [characterId]: remaining };
    });
  };

  const pickStyleReferences = async () => {
    const remainingSlots = MAX_STYLE_REFERENCE_UPLOADS - styleReferenceUploads.length;
    if (remainingSlots <= 0) {
      Alert.alert('Style References Full', `Remove a style reference before adding another. You can upload up to ${MAX_STYLE_REFERENCE_UPLOADS}.`);
      return;
    }

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/*'],
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (result.canceled || !result.assets?.length) return;

      const assets = result.assets.slice(0, remainingSlots);
      if (result.assets.length > remainingSlots) {
        Alert.alert('Upload Limit', `Only the first ${remainingSlots} image(s) were added. Style references are limited to ${MAX_STYLE_REFERENCE_UPLOADS}.`);
      }

      const newUploads: StyleReferenceUpload[] = [];
      for (const asset of assets) {
        if (!asset?.uri) continue;

        let data = '';
        let mimeType = inferImageMimeType(asset.name, asset.mimeType);

        if (Platform.OS === 'web') {
          const response = await fetch(asset.uri);
          const blob = await response.blob();
          mimeType = blob.type || mimeType;
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('Failed to read image file.'));
            reader.readAsDataURL(blob);
          });
          data = dataUrl.replace(/^data:[^;]+;base64,/, '');
        } else {
          data = await FileSystem.readAsStringAsync(asset.uri, { encoding: 'base64' as any });
        }

        if (!data) continue;

        const id = `style-ref-${Date.now()}-${newUploads.length}`;
        let imagePath: string | undefined;
        try {
          const saveRes = await fetch(`${PROXY_CONFIG.getProxyUrl()}/style-reference/save`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              storyId: buildStyleReferenceStoryId(customStoryTitle || 'untitled'),
              id,
              data,
              mimeType,
            }),
          });
          if (saveRes.ok) {
            const payload = await saveRes.json();
            imagePath = typeof payload.imagePath === 'string' ? payload.imagePath : undefined;
          }
        } catch (saveErr) {
          console.warn('[GeneratorScreen] Could not persist style reference; keeping inline fallback:', saveErr);
        }

        newUploads.push({
          id,
          name: asset.name || `Style reference ${styleReferenceUploads.length + newUploads.length + 1}`,
          uri: asset.uri,
          mimeType,
          data,
          imagePath,
        });
      }

      if (newUploads.length === 0) {
        Alert.alert('Upload Failed', 'Could not read the selected image(s). Please try other files.');
        return;
      }

      setStyleReferenceUploads((prev) => [...prev, ...newUploads].slice(0, MAX_STYLE_REFERENCE_UPLOADS));
    } catch (err) {
      Alert.alert('Upload Failed', err instanceof Error ? err.message : 'Failed to load style reference image(s).');
    }
  };

  const removeStyleReference = (uploadId: string) => {
    setStyleReferenceUploads((prev) => prev.filter((upload) => upload.id !== uploadId));
  };

  const updateCharacterReferenceMode = (characterId: string, mode: CharacterReferenceMode) => {
    setCharacterReferenceModes((prev) => ({
      ...prev,
      [characterId]: mode,
    }));
  };

  const showDocumentTemplate = () => {
    const template = generateDocumentTemplate();
    Alert.alert('Document Template', 'Save a file with this format:\n\n' + template.substring(0, 600) + '...\n\nSee full template in console.', [{ text: 'OK' }]);
    console.log('=== DOCUMENT TEMPLATE ===\n' + template);
  };

  const handleEvent = useCallback((event: PipelineEvent) => {
    setEvents(prev => [...prev, event]);
    if (event.telemetry) {
      if (typeof event.telemetry.overallProgress === 'number') {
        setLiveProgress(prev => Math.max(prev, Math.min(100, event.telemetry!.overallProgress!)));
      }
      if (event.telemetry.etaSeconds !== undefined) {
        setEtaSeconds(event.telemetry.etaSeconds ?? null);
      }
      if (
        typeof event.telemetry.currentItem === 'number' &&
        typeof event.telemetry.totalItems === 'number' &&
        event.telemetry.totalItems > 0
      ) {
        setImageProgress({ current: event.telemetry.currentItem, total: event.telemetry.totalItems });
      }
    }
    if (event.type === 'phase_start') {
      setCurrentPhase(event.phase);
      setImageProgress(null);
    }
    // Don't set error state from emitted events — pipeline errors throw exceptions
    // which are caught by the try/catch in startGeneration. Emitted 'error' events
    // are informational and logged, while actual failures surface via the catch block.
    
    // Track phase completion for checkpointing
    if (event.type === 'phase_complete' && event.phase) {
      if (!completedPhasesRef.current.includes(event.phase)) {
        completedPhasesRef.current.push(event.phase);
      }
      lastSuccessfulPhaseRef.current = event.phase;
    }
    
    // Also add event to the job store
    if (currentJobId) {
      const eventData: PipelineEventData = {
        type: event.type,
        phase: event.phase,
        agent: event.agent,
        message: event.message,
        timestamp: event.timestamp.toISOString(),
        telemetry: event.telemetry,
      };
      addJobEvent(currentJobId, eventData);

      if (event.telemetry) {
        updateGenJob(currentJobId, {
          progress: typeof event.telemetry.overallProgress === 'number' ? event.telemetry.overallProgress : undefined,
          etaSeconds: event.telemetry.etaSeconds,
          phaseProgress: typeof event.telemetry.phaseProgress === 'number' ? event.telemetry.phaseProgress : undefined,
          currentItem: typeof event.telemetry.currentItem === 'number' ? event.telemetry.currentItem : undefined,
          totalItems: typeof event.telemetry.totalItems === 'number' ? event.telemetry.totalItems : undefined,
          subphaseLabel: typeof event.telemetry.subphaseLabel === 'string' ? event.telemetry.subphaseLabel : undefined,
        });
      }
      
      // Update job progress based on phase
      if (event.type === 'phase_start' && event.phase) {
        updateGenJob(currentJobId, { currentPhase: event.phase });
      }
      
      // Save checkpoint state on phase completion
      if (event.type === 'phase_complete' && event.phase) {
        updateGenJob(currentJobId, {
          checkpoint: {
            briefJson: currentBriefRef.current ? JSON.stringify(currentBriefRef.current) : undefined,
            completedPhases: [...completedPhasesRef.current],
            lastSuccessfulPhase: event.phase,
            sourceAnalysisJson: sourceAnalysis ? JSON.stringify(sourceAnalysis) : undefined,
            isResumable: true,
            resumeHint: `Completed ${event.phase}. You can restart from the beginning or try again.`,
          },
        });
      }
    }
  }, [currentJobId, addJobEvent, updateGenJob, sourceAnalysis]);

  const selectedLlmApiKey = (
    llmProvider === 'gemini'
      ? geminiApiKey.trim()
      : llmProvider === 'openai'
        ? openaiApiKey.trim()
      : llmProvider === 'openrouter'
        ? openRouterApiKey.trim()
      : apiKey.trim()
  );
  const resolveLlmProviderKey = useCallback((provider: GeneratorLlmProvider) => {
    if (provider === 'gemini') return geminiApiKey.trim();
    if (provider === 'openai') return openaiApiKey.trim();
    if (provider === 'openrouter') return openRouterApiKey.trim();
    return apiKey.trim();
  }, [apiKey, geminiApiKey, openaiApiKey, openRouterApiKey]);
  const isOpenAiQuotaError = useCallback((err: unknown): boolean => {
    const msg = err instanceof Error ? err.message : String(err ?? '');
    const lower = msg.toLowerCase();
    return (
      lower.includes('openai api error: 429') ||
      lower.includes('insufficient_quota') ||
      lower.includes('exceeded your current quota')
    );
  }, []);

  const selectedLlmModel = (
    llmModel.trim() || availableModels[llmProvider][0]?.value || ''
  );

  const syncCanonReviewState = useCallback(async (
    nextCanon: LockedStoryCanon,
    nextWizardState: CanonWizardState,
    options: { persist?: boolean } = {},
  ) => {
    if (!sourceAnalysis) return;
    const nextAnalysis = applyCanonToSourceAnalysis(sourceAnalysis, nextCanon);
    const nextPlan = seasonPlan ? applyCanonToSeasonPlan(seasonPlan, nextCanon) : null;
    setSourceAnalysis(nextAnalysis);
    setCanonWizardState(nextWizardState);
    if (nextPlan) setSeasonPlan(nextPlan);
    if (options.persist && nextPlan) {
      await seasonPlanStore.updateSavedPlan(nextPlan.id, {
        plan: nextPlan,
        sourceAnalysis: nextAnalysis,
        canonWizardState: nextWizardState,
      });
    }
  }, [seasonPlan, sourceAnalysis]);

  const requestCanonRepairSuggestion = useCallback(async (
    validation: CanonEditValidationResult,
    canon: LockedStoryCanon,
  ): Promise<CanonEditRepairSuggestion | null> => {
    const fallback = validation.suggestion || null;
    if (!selectedLlmApiKey || llmProvider !== 'anthropic') return fallback;
    try {
      const response = await fetch(`${PROXY_CONFIG.getProxyUrl()}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': selectedLlmApiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: selectedLlmModel || llmModel || 'claude-sonnet-4-20250514',
          max_tokens: 1200,
          temperature: 0.2,
          system: 'You propose minimal StoryRPG canon repair patches. Return JSON only.',
          messages: [{
            role: 'user',
            content: `Canon conflicts:\n${validation.blockingConflicts.map((issue) => `- ${issue.factId}.${issue.fieldPath}: ${issue.message}`).join('\n')}\n\nLocked canon facts:\n${JSON.stringify(canon.facts, null, 2).slice(0, 12000)}\n\nReturn {"summary": string, "proposedPatches": [{"factId": string, "fieldPath": string, "nextValue": any, "reason": string}]}. Prefer preserving prior locked facts and repairing dependent wording.`,
          }],
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Repair suggestion failed');
      const rawText = Array.isArray(data?.content)
        ? data.content.map((part: any) => part?.text || '').join('\n')
        : '';
      const parsed = JSON.parse(rawText);
      if (!parsed?.summary || !Array.isArray(parsed.proposedPatches)) return fallback;
      return {
        source: 'llm',
        summary: String(parsed.summary),
        proposedPatches: parsed.proposedPatches
          .filter((patch: any) => patch?.factId && patch?.fieldPath)
          .map((patch: any) => ({
            factId: String(patch.factId),
            fieldPath: String(patch.fieldPath),
            nextValue: patch.nextValue,
            reason: String(patch.reason || 'Model-proposed canon repair.'),
          })),
      };
    } catch (error) {
      console.warn('[GeneratorScreen] LLM canon repair suggestion failed:', error);
      return fallback;
    }
  }, [llmModel, llmProvider, selectedLlmApiKey, selectedLlmModel]);

  const buildCreativeBrief = (sourceAnalysisOverride: SourceMaterialAnalysis | null = sourceAnalysis): FullCreativeBrief | null => {
    const brief = buildGeneratorCreativeBrief({
      documentBrief,
      sourceAnalysis: sourceAnalysisOverride,
      seasonPlan,
      customStoryTitle,
      userPrompt,
    });

    if (brief && Object.keys(characterReferenceUploads).length > 0) {
      brief.characterReferenceImages = Object.fromEntries(
        Object.entries(characterReferenceUploads).map(([characterId, uploads]) => [
          characterId,
          uploads.map((upload) => ({ data: upload.data, mimeType: upload.mimeType })),
        ])
      );
      brief.characterReferenceSettings = Object.fromEntries(
        Object.entries(characterReferenceUploads).map(([characterId]) => [
          characterId,
          { referenceMode: characterReferenceModes[characterId] || 'face-only' },
        ])
      );
    }
    
    return brief;
  };

  const buildPipelineConfigInput = () => ({
    llmProvider,
    llmModel,
    taskAssignments: effectiveTaskAssignments,
    imageLlmProvider,
    imageLlmModel,
    videoLlmProvider,
    videoLlmModel,
    apiKey,
    openaiApiKey,
    openRouterApiKey,
    geminiApiKey,
    elevenLabsApiKey,
    atlasCloudApiKey,
    atlasCloudModel,
    midapiToken,
    imageProvider,
    imageStrategy,
    panelMode: generationSettings.panelMode || 'single',
    artStyle,
    geminiSettings,
    openaiSettings,
    midjourneySettings,
    stableDiffusionSettings,
    loraTrainingSettings,
    generationSettings: {
      ...generationSettings,
      generateImages: runGenerateImages,
    },
    generationMode,
    narrationSettings,
    videoSettings: {
      ...videoSettings,
      enabled: runGenerateVideo,
    },
  });

  // ----- Style Setup (inline on analysis_complete) -----------------------
  // The section lets the user expand the raw style string into an editable
  // profile, preview the three style-bible anchors, and approve them before
  // we kick off generation. When they approve, the handoff payload here is
  // merged into `createPipelineConfig` as `extras` so the pipeline skips
  // re-building anchors that the UI already locked in.
  const primaryProtagonistName =
    sourceAnalysis?.protagonist?.name?.trim() || customStoryTitle || 'Hero';
  const primaryLocationName =
    sourceAnalysis?.keyLocations?.[0]?.name?.trim() || undefined;
  const colorScriptTerms = (sourceAnalysis?.themes || [])
    .slice(0, 3)
    .map((t) => t.trim())
    .filter(Boolean);

  const styleSetup = useStyleSetup({
    rawArtStyle: artStyle,
    storyTitle: customStoryTitle || 'Untitled Story',
    protagonistName: primaryProtagonistName,
    colorTerms: colorScriptTerms,
    primaryLocation: primaryLocationName,
    expandStyleFn: async (raw: string) => {
      const architect = new StyleArchitect({
        provider: effectiveTaskAssignments.architect.provider,
        model: effectiveTaskAssignments.architect.model,
        apiKey: selectedLlmApiKey,
        maxTokens: 1024,
        temperature: 0.4,
      });
      return architect.expand({ artStyle: raw, genreHint: sourceAnalysis?.genre });
    },
    generateAnchorImageFn: async (_role, prompt) => {
      const service = new ImageGenerationService({
        enabled: true,
        provider: (imageProvider === 'useapi' ? 'midapi' : imageProvider) as any,
        geminiApiKey: geminiApiKey.trim(),
        openaiApiKey: openaiApiKey.trim() || undefined,
        openaiImageModel: openaiSettings.imageModel || DEFAULT_OPENAI_SETTINGS.imageModel,
        openaiModeration: openaiSettings.imageModeration || DEFAULT_OPENAI_SETTINGS.imageModeration,
        atlasCloudApiKey: atlasCloudApiKey.trim() || undefined,
        atlasCloudModel: atlasCloudModel.trim() || undefined,
        midapiToken: midapiToken.trim() || undefined,
        geminiSettings,
        midjourneySettings,
        stableDiffusionSettings,
        savePrompts: false,
      });
      const identifier = `style-preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const result = await service.generateImage(prompt, identifier, { type: 'style-reference' as any });
      const imageUrl = result.imageUrl || '';
      if (result.imageData && result.mimeType) {
        return { data: result.imageData, mimeType: result.mimeType };
      }
      if (imageUrl.startsWith('data:')) {
        const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          return { data: match[2], mimeType: match[1] };
        }
      }
      if (imageUrl) {
        const fetched = await fetch(imageUrl);
        const blob = await fetched.blob();
        const buffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
        const base64 = typeof btoa !== 'undefined'
          ? btoa(binary)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          : (global as any).Buffer?.from(bytes).toString('base64') || '';
        return { data: base64, mimeType: blob.type || 'image/png' };
      }
      throw new Error('Concept image returned no data');
    },
    saveAnchorFn: async (role: AnchorRole, data: string, mimeType: string) => {
      const storyId = buildStyleReferenceStoryId(customStoryTitle || 'untitled');
      const res = await fetch(`${PROXY_CONFIG.getProxyUrl()}/style-anchor/save`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyId, role, data, mimeType }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`save failed (${res.status}): ${body}`);
      }
      const payload = await res.json();
      return { imagePath: payload.imagePath as string };
    },
  });

  const createPipelineConfig = (extraOverrides?: PipelineConfigExtras): PipelineConfig => {
    const handoff = styleSetup.handoff;
    const uploadedStyleReferences = runGenerateImages
      ? styleReferenceUploads.map((upload) => {
          if (USE_SERVER_WORKER && upload.imagePath) {
            return { imagePath: upload.imagePath };
          }
          return {
            data: upload.data,
            mimeType: upload.mimeType,
            imagePath: upload.imagePath,
          };
        })
      : [];
    const extras: PipelineConfigExtras = {
      artStyleProfileOverride: extraOverrides?.artStyleProfileOverride || handoff.profile,
      preapprovedStyleAnchors:
        extraOverrides?.preapprovedStyleAnchors || handoff.preapprovedStyleAnchors,
      uploadedStyleReferences:
        extraOverrides?.uploadedStyleReferences || uploadedStyleReferences,
      styleReferenceStrength:
        extraOverrides?.styleReferenceStrength || styleReferenceStrength,
    };
    const config = buildPipelineConfig(buildPipelineConfigInput(), extras);
    config.generation = {
      ...(config.generation || {}),
      assetGenerationMode: runGenerateImages ? 'story-and-images' : 'story-only',
    };
    return config;
  };

  const startAnalysis = async () => {
    if (!selectedLlmApiKey) {
      Alert.alert(
        'API Key Required',
        llmProvider === 'gemini'
          ? 'Please enter your Gemini LLM API key to continue.'
          : llmProvider === 'openai'
            ? 'Please enter your OpenAI API key to continue.'
            : 'Please enter your Anthropic API key to continue.'
      );
      return;
    }
    if (!documentContent && !userPrompt.trim()) { Alert.alert('Source Required', 'Please select a document or enter a prompt.'); return; }
    const proxyAvailable = await ensureProxyAvailable();
    if (!proxyAvailable) {
      Alert.alert(
        'Backend Unavailable',
        'Proxy server is not reachable at http://localhost:3001.\n\nStart it with Docker Compose:\n\ndocker compose -f docker-compose.proxy.yml up -d'
      );
      return;
    }
    
    // Source analysis ALWAYS runs - it works with either document content OR a prompt
    // For prompt-only, the LLM will generate analysis from the story concept
    const hasDocument = documentContent && documentContent.trim().length > 0;
    const sourceText = hasDocument ? documentContent : '';
    const prompt = userPrompt.trim() || undefined;
    
    console.log(`[GeneratorScreen] Starting analysis - hasDocument: ${hasDocument}, hasPrompt: ${!!prompt}`);
    
    setState('analyzing'); setEvents([]); setError(null); clearCompletedJobs();
    try {
      if (USE_SERVER_WORKER) {
        try {
          const config = createPipelineConfig();
          const title = customStoryTitle || parsedDocument?.title || documentBrief?.story.title || 'Untitled Story';
          const worker = await runWorkerJob<{
            success: boolean;
            analysisResult: SourceAnalysisResult;
            sourceAnalysis: SourceMaterialAnalysis;
            seasonPlan?: SeasonPlan;
            seasonPlanError?: string;
          }>({
            mode: 'analysis',
            payload: {
              config,
              analysisInput: {
                sourceText,
                title,
                prompt,
                preferences: buildAnalysisPreferences(),
              },
            },
            idempotencyKey: `analysis:${title}:${sourceText.length}:${prompt || ''}`,
            storyTitle: title,
            episodeCount: 1,
          }, (evt) => handleEvent(evt));

          const result = worker.result.analysisResult;
          const normalizedAnalysis = applyEndingModeToAnalysis(worker.result.sourceAnalysis);
          setAnalysisResult(result);
          setSourceAnalysis(normalizedAnalysis);
          setCanonWizardState(normalizedAnalysis.sourceCanon ? createCanonWizardState(normalizedAnalysis.sourceCanon) : null);
          setCustomStoryTitle(normalizedAnalysis.sourceTitle || title);
          const episodeCount = Math.min(result.totalEpisodes || 1, 3);
          setSelectedEpisodeCount(episodeCount);
          if (worker.result.seasonPlan) {
            setSeasonPlan(worker.result.seasonPlan);
            await seasonPlanStore.savePlan(
              worker.result.seasonPlan,
              normalizedAnalysis,
              normalizedAnalysis.sourceCanon ? createCanonWizardState(normalizedAnalysis.sourceCanon) : undefined,
            );
            setSelectedEpisodes(Array.from({ length: episodeCount }, (_, idx) => idx + 1));
          } else if (worker.result.seasonPlanError) {
            handleEvent({
              type: 'warning',
              phase: 'season_planning',
              message: `Season planning failed: ${worker.result.seasonPlanError}`,
              timestamp: new Date(),
            });
          }
          setState('analysis_complete');
          return;
        } catch (workerErr) {
          // Analysis runs exclusively through the server worker/proxy on web —
          // no silent fallback to the in-browser path (see generation catch).
          const errMsg = workerErr instanceof Error ? workerErr.message : String(workerErr);
          console.error('[GeneratorScreen] Worker analysis failed:', errMsg);
          setError(
            isProxyUnreachableError(errMsg)
              ? `Analysis server unavailable — the proxy/worker isn't reachable (${errMsg}). Start it with "docker compose -f docker-compose.proxy.yml up -d" (or "npm run proxy"), wait for it to report healthy, then try again.`
              : `Source analysis failed: ${errMsg}`,
          );
          setState('error');
          return;
        }
      }

      const config = createPipelineConfig();
      const title = customStoryTitle || parsedDocument?.title || documentBrief?.story.title || 'Untitled Story';
      let analysisResponse;
      const runAnalysisWithConfig = async (cfg: PipelineConfig) => runStoryAnalysis({
        config: cfg,
        sourceText,
        title,
        prompt,
        preferences: buildAnalysisPreferences(),
        onPipelineCreated: (pipeline) => {
          pipelineRef.current = pipeline;
          attachPipelineJobListeners(pipeline);
        },
        onEvent: (event) => handleEvent({
          type: event.type,
          phase: event.phase,
          agent: event.agent,
          message: event.message,
          data: event.data,
          telemetry: event.telemetry,
          timestamp: event.timestamp,
        }),
      });

      try {
        analysisResponse = await runAnalysisWithConfig(config);
      } catch (analysisErr) {
        const fallbackProvider =
          llmProvider === 'openai' && isOpenAiQuotaError(analysisErr)
            ? (apiKey.trim()
                ? 'anthropic'
                : (geminiApiKey.trim() ? 'gemini' : null))
            : null;
        if (!fallbackProvider) throw analysisErr;

        handleEvent({
          type: 'warning',
          phase: 'source_analysis',
          message: `OpenAI quota exceeded; retrying source analysis with ${fallbackProvider.toUpperCase()}.`,
          timestamp: new Date(),
        });

        const input = buildPipelineConfigInput();
        const fallbackInput = {
          ...input,
          llmProvider: fallbackProvider,
          llmModel: DEFAULT_LLM_MODELS[fallbackProvider],
          // Drop per-task assignments so the legacy provider-swap takes effect;
          // the quota-exhausted OpenAI assignments must not override the fallback.
          taskAssignments: undefined,
        };
        const fallbackConfig = buildPipelineConfig(fallbackInput, {
          artStyleProfileOverride: styleSetup.handoff.profile,
          preapprovedStyleAnchors: styleSetup.handoff.preapprovedStyleAnchors,
        });
        analysisResponse = await runAnalysisWithConfig(fallbackConfig);
      }
      const normalizedAnalysis = applyEndingModeToAnalysis(analysisResponse.sourceAnalysis);
      setAnalysisResult(analysisResponse.analysisResult);
      setSourceAnalysis(normalizedAnalysis);
      setCanonWizardState(normalizedAnalysis.sourceCanon ? createCanonWizardState(normalizedAnalysis.sourceCanon) : null);
      setCustomStoryTitle(normalizedAnalysis.sourceTitle || title);
      const episodeCount = Math.min(analysisResponse.analysisResult.totalEpisodes || 1, 3);
      setSelectedEpisodeCount(episodeCount);

      setIsCreatingSeasonPlan(true);
      try {
        if (analysisResponse.seasonPlan) {
          setSeasonPlan(analysisResponse.seasonPlan);
          await seasonPlanStore.savePlan(
            analysisResponse.seasonPlan,
            normalizedAnalysis,
            normalizedAnalysis.sourceCanon ? createCanonWizardState(normalizedAnalysis.sourceCanon) : undefined,
          );
          setSelectedEpisodes(Array.from({ length: episodeCount }, (_, idx) => idx + 1));
          const encounterCount = analysisResponse.seasonPlan.encounterPlan?.totalEncounters || 0;
          const branchCount = analysisResponse.seasonPlan.crossEpisodeBranches?.length || 0;
          handleEvent({
            type: 'phase_complete',
            phase: 'season_planning',
            message: `Season blueprint created: ${analysisResponse.seasonPlan.totalEpisodes} episodes, ${encounterCount} encounters, ${branchCount} cross-episode branches`,
            timestamp: new Date(),
          });
        } else if (analysisResponse.seasonPlanError) {
          handleEvent({
            type: 'warning',
            phase: 'season_planning',
            message: `Season planning failed: ${analysisResponse.seasonPlanError}`,
            timestamp: new Date(),
          });
        }
      } finally {
        setIsCreatingSeasonPlan(false);
      }
      setState('analysis_complete');
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); setState('error'); }
  };

  const canonSetupApproved = Boolean(
    sourceAnalysis?.sourceCanon?.lockStatus === 'locked'
    && sourceAnalysis?.canonLockManifest?.requiredConceptsSatisfied === true
    && canonWizardState?.stepStatus.story === 'approved'
    && canonWizardState?.stepStatus.peopleWorld === 'approved'
    && canonWizardState?.stepStatus.episodesEndings === 'approved'
  );

  const handleCanonEpisodeSelectionChange = useCallback((episodes: number[]) => {
    setSelectedEpisodes(episodes);
    setSelectedEpisodeCount(episodes.length);

    const nextCanonState = sourceAnalysis?.sourceCanon
      ? {
          ...(canonWizardState || createCanonWizardState(sourceAnalysis.sourceCanon, episodes)),
          selectedEpisodes: episodes,
        }
      : null;
    if (nextCanonState) {
      setCanonWizardState(nextCanonState);
      if (seasonPlan) {
        void seasonPlanStore.updateSavedPlan(seasonPlan.id, { canonWizardState: nextCanonState });
      }
    }

    if (seasonPlan) {
      const seasonPlanner = new SeasonPlannerAgent({ provider: 'anthropic', model: 'claude-sonnet-4-20250514', apiKey: '', maxTokens: 8000, temperature: 0.7 });
      const validation = seasonPlanner.validateSelection(seasonPlan, episodes);
      setSelectionWarnings(validation.warnings);
      setEpisodeRecommendations(seasonPlanner.getEpisodeRecommendations(seasonPlan, episodes));
    }
  }, [canonWizardState, seasonPlan, sourceAnalysis?.sourceCanon]);

  const startGeneration = async () => {
    if (!selectedLlmApiKey) {
      Alert.alert(
        'API Key Required',
        llmProvider === 'gemini'
          ? 'Please enter your Gemini LLM API key to continue.'
          : llmProvider === 'openai'
            ? 'Please enter your OpenAI API key to continue.'
            : 'Please enter your Anthropic API key to continue.'
      );
      return;
    }
    if (sourceAnalysis?.sourceCanon && !canonSetupApproved) {
      Alert.alert('Canon Review Required', 'Approve all three story setup screens before generation.');
      return;
    }
    if (runGenerateVideo && !runGenerateImages) {
      Alert.alert(
        'Images Required',
        'Video generation needs still images. Enable Images for this run or generate video later from an episode row after images exist.',
      );
      return;
    }
    const missingScopedKeys: string[] = [];
    if (runGenerateImages && !resolveLlmProviderKey(imageLlmProvider)) {
      missingScopedKeys.push(`Image planner (${imageLlmProvider.toUpperCase()})`);
    }
    if (runGenerateVideo && !resolveLlmProviderKey(videoLlmProvider)) {
      missingScopedKeys.push(`Video planner (${videoLlmProvider.toUpperCase()})`);
    }
    if (missingScopedKeys.length > 0) {
      Alert.alert(
        'Missing Provider Key',
        `Configure API keys for: ${missingScopedKeys.join(', ')}.`,
      );
      return;
    }
    const updatedSourceAnalysis = sourceAnalysis ? { ...sourceAnalysis, sourceTitle: customStoryTitle || sourceAnalysis.sourceTitle } : null;
    const brief = buildCreativeBrief(updatedSourceAnalysis);
    if (!brief) { Alert.alert('Error', 'Failed to build story brief.'); return; }
    const proxyAvailable = await ensureProxyAvailable();
    if (!proxyAvailable) {
      Alert.alert(
        'Backend Unavailable',
        'Proxy server is not reachable at http://localhost:3001.\n\nStart it with Docker Compose:\n\ndocker compose -f docker-compose.proxy.yml up -d'
      );
      return;
    }
    
    // Reset phase tracking for new generation
    completedPhasesRef.current = [];
    lastSuccessfulPhaseRef.current = null;
    currentBriefRef.current = brief;
    
    setState('running'); setEvents([]); setError(null); setGeneratedStory(null); setGeneratedCode(null); clearCompletedJobs();
    setLiveProgress(0);
    setEtaSeconds(null);
    setImageProgress(null);
    setPipelineRuntime(null);
    seenManifestIdsRef.current.clear();
    seenImageJobIdsRef.current.clear();
    generationStartedAtRef.current = Date.now();
    if (USE_SERVER_WORKER) {
      try {
        const config = createPipelineConfig();
        const episodesToGenerate = getEpisodesToGenerate();
        const workerEpisodeCount = episodesToGenerate.length;
        let workerJobIdForUpdates: string | null = null;
        const continuationJobId = getContinuationJobId();
        const episodeRange = updatedSourceAnalysis && (selectedEpisodes.length > 0 || selectedEpisodeCount > 0)
          ? (selectedEpisodes.length > 0
            ? { start: Math.min(...selectedEpisodes), end: Math.max(...selectedEpisodes), specific: selectedEpisodes }
            : { start: 1, end: selectedEpisodeCount })
          : undefined;

        const worker = await runWorkerJob<FullPipelineResult>({
          mode: 'generation',
          payload: {
            config,
            generationInput: {
              brief,
              sourceAnalysis: updatedSourceAnalysis || undefined,
              episodeRange,
            },
          },
          idempotencyKey: `generation:${brief.story.title}:${JSON.stringify(episodeRange || {})}`,
          storyTitle: brief.story.title || 'Untitled Story',
          episodeCount: workerEpisodeCount,
          resumeFromJobId: continuationJobId,
        },
        (evt) => handleEvent(evt),
        (statusData) => {
          const progress = Math.max(0, Math.min(100, Number(statusData?.progress ?? 0)));
          const currentPhaseFromStatus = statusData?.currentPhase;
          setPipelineRuntime(buildPipelineRuntimeSnapshot(statusData, workerJobIdForUpdates));
          if (typeof currentPhaseFromStatus === 'string' && currentPhaseFromStatus.length > 0) {
            setCurrentPhase(currentPhaseFromStatus);
          }
          setLiveProgress(progress);

          const etaFromStatus = statusData?.etaSeconds;
          if (typeof etaFromStatus === 'number' || etaFromStatus === null) {
            setEtaSeconds(etaFromStatus);
          } else {
            const startedAtMs = new Date(statusData?.startedAt || generationStartedAtRef.current).getTime();
            const updatedAtMs = new Date(statusData?.updatedAt || Date.now()).getTime();
            const elapsedSec = Math.max(1, (updatedAtMs - startedAtMs) / 1000);
            if (progress > 1 && progress < 100) {
              const pctPerSec = progress / elapsedSec;
              setEtaSeconds(pctPerSec > 0 ? Math.round((100 - progress) / pctPerSec) : null);
            } else {
              setEtaSeconds(null);
            }
          }

          if (statusData?.imageProgress && typeof statusData.imageProgress.current === 'number') {
            setImageProgress({ current: statusData.imageProgress.current, total: statusData.imageProgress.total || 0 });
          } else if (typeof statusData?.currentItem === 'number' && typeof statusData?.totalItems === 'number') {
            setImageProgress({ current: statusData.currentItem, total: statusData.totalItems || 0 });
          }

          hydrateImageJobsFromWorkerStatus(statusData);

          if (workerJobIdForUpdates) {
            void updateGenJob(workerJobIdForUpdates, {
              status: (statusData?.status as any) || 'running',
              friendlyName: typeof statusData?.friendlyName === 'string' ? statusData.friendlyName : undefined,
              processTitle: typeof statusData?.processTitle === 'string' ? statusData.processTitle : undefined,
              currentPhase: currentPhaseFromStatus || 'processing',
              progress,
              currentEpisode: Number(statusData?.currentEpisode || 1),
              episodeCount: Number(statusData?.episodeCount || workerEpisodeCount),
              etaSeconds: typeof statusData?.etaSeconds === 'number' || statusData?.etaSeconds === null ? statusData.etaSeconds : undefined,
              phaseProgress: typeof statusData?.phaseProgress === 'number' ? statusData.phaseProgress : undefined,
              currentItem: typeof statusData?.currentItem === 'number' ? statusData.currentItem : undefined,
              totalItems: typeof statusData?.totalItems === 'number' ? statusData.totalItems : undefined,
              subphaseLabel: typeof statusData?.subphaseLabel === 'string' ? statusData.subphaseLabel : undefined,
            });
          }
        },
        async (jobId, startData) => {
          workerJobIdForUpdates = jobId;
          setCurrentJobId(jobId);
          setActiveJobId(jobId);
          await registerGenJob({
            id: jobId,
            storyTitle: brief.story.title || 'Untitled Story',
            friendlyName: startData.friendlyName,
            processTitle: startData.processTitle,
            startedAt: new Date().toISOString(),
            status: 'running',
            currentPhase: 'queued',
            progress: 0,
            episodeCount: workerEpisodeCount,
            currentEpisode: 1,
            events: [],
          });
        });

        const result = worker.result;
        if (!result || !result.success) {
          throw new Error(result?.error || 'Generation failed');
        }
        if ('story' in result && result.story) {
          setGeneratedStory(result.story);
          setGeneratedCode(storyToTypeScript(result.story));
          if (onStoryGenerated) onStoryGenerated(result.story);
          if (result.outputManifest) setOutputManifest(result.outputManifest);
          if (result.outputDirectory) setOutputDirectory(result.outputDirectory);
          if (workerJobIdForUpdates) {
            await updateGenJob(workerJobIdForUpdates, {
              outputDir: result.outputDirectory,
            });
            await markSelectedEpisodesCompleted(result.story, workerJobIdForUpdates, result.outputDirectory);
          }
        }
        setLiveProgress(100);
        setEtaSeconds(null);
        setState('complete');
        return;
      } catch (err) {
        // Generation runs exclusively through the server worker/proxy on web.
        // We deliberately do NOT fall back to the fragile in-browser pipeline:
        // a silent downgrade hides proxy outages and produces a degraded run
        // (no episode plan, dies when the tab closes, no durable checkpoints).
        // Surface a clear, actionable error instead.
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error('[GeneratorScreen] Worker generation pipeline failed:', errMsg);
        setError(
          isProxyUnreachableError(errMsg)
            ? `Generation server unavailable — the proxy/worker isn't reachable (${errMsg}). Start it with "docker compose -f docker-compose.proxy.yml up -d" (or "npm run proxy"), wait for it to report healthy, then try again.`
            : errMsg,
        );
        setState('error');
        return;
      }
    }
    
    // Register a new generation job
    const jobId = `gen-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    setCurrentJobId(jobId);
    setActiveJobId(jobId);
    await registerGenJob({
      id: jobId,
      storyTitle: brief.story.title || 'Untitled Story',
      startedAt: new Date().toISOString(),
      status: 'running',
      currentPhase: 'initialization',
      progress: 0,
      episodeCount: getEpisodesToGenerate().length,
      currentEpisode: 1,
      events: [],
    });
    try {
      const config = createPipelineConfig();
      let result: FullPipelineResult;
      if (updatedSourceAnalysis && (selectedEpisodes.length > 0 || selectedEpisodeCount > 0)) {
        // Use selected episodes from season plan if available, otherwise fall back to count
        const episodesToGenerate = getEpisodesToGenerate();
        const episodeRange = selectedEpisodes.length > 0 
          ? { start: Math.min(...selectedEpisodes), end: Math.max(...selectedEpisodes), specific: selectedEpisodes }
          : { start: 1, end: selectedEpisodeCount };
        const continuationOutputDir = getContinuationOutputDir();
        const resumeCheckpoint = continuationOutputDir
          ? {
              steps: { output_directory: { status: 'completed' } },
              outputs: { output_directory: { outputDirectory: continuationOutputDir } },
            }
          : undefined;
        
        handleEvent({ type: 'phase_start', phase: 'initialization', message: `Starting generation of episode(s) ${episodesToGenerate.join(', ')} for "${brief.story.title}"...`, timestamp: new Date() });
        
        // Mark selected episodes as in_progress in season plan
        if (seasonPlan) {
          for (const epNum of episodesToGenerate) {
            await seasonPlanStore.updateEpisodeStatus(seasonPlan.id, epNum, 'in_progress');
          }
        }

        const generationResponse = await runStoryGeneration({
          config,
          brief,
          sourceAnalysis: updatedSourceAnalysis,
          episodeRange,
          resumeCheckpoint,
          onPipelineCreated: (pipeline) => {
            pipeline.setExternalJobId(jobId);
            pipelineRef.current = pipeline;
            attachPipelineJobListeners(pipeline);
          },
          onEvent: (event) => {
            handleEvent({
              type: event.type,
              phase: event.phase,
              agent: event.agent,
              message: event.message,
              data: event.data,
              telemetry: event.telemetry,
              timestamp: event.timestamp,
            });
            if (event.type === 'checkpoint') {
              const checkpointData = event.data as PipelineCheckpointData;
              if (checkpointData?.requiresApproval) {
                setState('checkpoint');
                setCurrentCheckpoint({
                  phase: event.phase || checkpointData.phase,
                  data: checkpointData.data,
                  timestamp: event.timestamp,
                  requiresApproval: true,
                });
              }
            }
          },
        });
        result = generationResponse.result;
      } else {
        handleEvent({ type: 'phase_start', phase: 'initialization', message: `Starting generation for "${brief.story.title}"...`, timestamp: new Date() });
        const generationResponse = await runStoryGeneration({
          config,
          brief,
          onPipelineCreated: (pipeline) => {
            pipeline.setExternalJobId(jobId);
            pipelineRef.current = pipeline;
            attachPipelineJobListeners(pipeline);
          },
          onEvent: (event) => {
            handleEvent({
              type: event.type,
              phase: event.phase,
              agent: event.agent,
              message: event.message,
              data: event.data,
              telemetry: event.telemetry,
              timestamp: event.timestamp,
            });
            if (event.type === 'checkpoint') {
              const checkpointData = event.data as PipelineCheckpointData;
              if (checkpointData?.requiresApproval) {
                setState('checkpoint');
                setCurrentCheckpoint({
                  phase: event.phase || checkpointData.phase,
                  data: checkpointData.data,
                  timestamp: event.timestamp,
                  requiresApproval: true,
                });
              }
            }
          },
        });
        result = generationResponse.result;
      }
      if (result.success) {
        if ('story' in result && result.story) {
          const sr = result as FullPipelineResult; setGeneratedStory(sr.story!); setGeneratedCode(storyToTypeScript(sr.story!));
          if (onStoryGenerated) onStoryGenerated(sr.story!);
          if (sr.outputManifest) setOutputManifest(sr.outputManifest);
          if (sr.outputDirectory) setOutputDirectory(sr.outputDirectory);
          await markSelectedEpisodesCompleted(sr.story!, jobId, sr.outputDirectory);
        }
        setState('complete');
        setLiveProgress(100);
        setEtaSeconds(null);
        // Update job as completed
        if (jobId) {
          await updateGenJob(jobId, { status: 'completed', progress: 100 });
        }
      } else { throw new Error(('error' in result ? result.error : 'Generation failed') || 'Unknown error'); }
    } catch (err) { 
      const errorMsg = err instanceof Error ? err.message : String(err);
      const structuredFailure = (err as any)?.failureContext;
      const structuredCheckpoint = (err as any)?.checkpoint;
      setError(errorMsg); 
      setState('error');
      setEtaSeconds(null);
      // Update job as failed with checkpoint data
      if (jobId) {
        await updateGenJob(jobId, { 
          status: 'failed', 
          error: errorMsg,
          checkpoint: {
            briefJson: currentBriefRef.current ? JSON.stringify(currentBriefRef.current) : undefined,
            completedPhases: [...completedPhasesRef.current],
            lastSuccessfulPhase: lastSuccessfulPhaseRef.current || undefined,
            sourceAnalysisJson: sourceAnalysis ? JSON.stringify(sourceAnalysis) : undefined,
            isResumable: completedPhasesRef.current.length > 0,
            resumeHint: completedPhasesRef.current.length > 0 
              ? `Failed after completing: ${completedPhasesRef.current.join(', ')}. Error: ${errorMsg}`
              : `Failed early. Error: ${errorMsg}`,
            failureContext: structuredFailure || structuredCheckpoint?.failureContext,
            resumeContext: structuredCheckpoint?.resumeContext,
            outputs: structuredCheckpoint?.outputs,
          },
        });
      }
    }
  };

  const startImageGenerationForDraft = useCallback(async () => {
    const draftOutputDir = outputDirectory || generatedStory?.outputDir;
    if (!draftOutputDir) {
      Alert.alert('Missing Draft Output', 'The story draft does not have an output directory for the image batch.');
      return;
    }
    const proxyAvailable = await ensureProxyAvailable();
    if (!proxyAvailable) {
      Alert.alert('Backend Unavailable', 'Proxy server is not reachable at http://localhost:3001.');
      return;
    }

    try {
      const config = createPipelineConfig();
      config.generation = {
        ...(config.generation || {}),
        assetGenerationMode: 'image-only',
      };
      const title = generatedStory?.title || customStoryTitle || 'Image Batch';
      let workerJobIdForUpdates: string | null = null;
      setState('running');
      setError(null);
      setLiveProgress(0);
      setImageProgress(null);
      generationStartedAtRef.current = Date.now();

      const worker = await runWorkerJob<FullPipelineResult>({
        mode: 'image-generation',
        payload: {
          config,
          imageGenerationInput: {
            outputDirectory: draftOutputDir,
          },
        },
        idempotencyKey: `image-generation:${draftOutputDir}`,
        storyTitle: `${title} Images`,
        episodeCount: generatedStory?.episodes?.length || 1,
      },
      (evt) => handleEvent(evt),
      (statusData) => {
        const progress = Math.max(0, Math.min(100, Number(statusData?.progress ?? 0)));
        const currentPhaseFromStatus = statusData?.currentPhase;
        setPipelineRuntime(buildPipelineRuntimeSnapshot(statusData, workerJobIdForUpdates));
        if (typeof currentPhaseFromStatus === 'string' && currentPhaseFromStatus.length > 0) {
          setCurrentPhase(currentPhaseFromStatus);
        }
        setLiveProgress(progress);
        hydrateImageJobsFromWorkerStatus(statusData);
        if (statusData?.imageProgress && typeof statusData.imageProgress.current === 'number') {
          setImageProgress({ current: statusData.imageProgress.current, total: statusData.imageProgress.total || 0 });
        }
        if (workerJobIdForUpdates) {
          void updateGenJob(workerJobIdForUpdates, {
            status: (statusData?.status as any) || 'running',
            friendlyName: typeof statusData?.friendlyName === 'string' ? statusData.friendlyName : undefined,
            processTitle: typeof statusData?.processTitle === 'string' ? statusData.processTitle : undefined,
            currentPhase: currentPhaseFromStatus || 'images',
            progress,
            currentEpisode: Number(statusData?.currentEpisode || 1),
            episodeCount: Number(statusData?.episodeCount || generatedStory?.episodes?.length || 1),
          });
        }
      },
      async (jobId, startData) => {
        workerJobIdForUpdates = jobId;
        setCurrentJobId(jobId);
        setActiveJobId(jobId);
        await registerGenJob({
          id: jobId,
          storyTitle: `${title} Images`,
          friendlyName: startData.friendlyName,
          processTitle: startData.processTitle,
          startedAt: new Date().toISOString(),
          status: 'running',
          currentPhase: 'queued',
          progress: 0,
          episodeCount: generatedStory?.episodes?.length || 1,
          currentEpisode: 1,
          outputDir: draftOutputDir,
          events: [],
        });
      });

      const result = worker.result;
      if (!result || !result.success) {
        throw new Error(result?.error || 'Image generation failed');
      }
      if ('story' in result && result.story) {
        setGeneratedStory(result.story);
        setGeneratedCode(storyToTypeScript(result.story));
        if (onStoryGenerated) onStoryGenerated(result.story);
        if (result.outputManifest) setOutputManifest(result.outputManifest);
        if (result.outputDirectory) setOutputDirectory(result.outputDirectory);
        if (workerJobIdForUpdates) {
          await updateGenJob(workerJobIdForUpdates, {
            outputDir: result.outputDirectory,
          });
        }
      }
      setLiveProgress(100);
      setState('complete');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setError(errMsg);
      setState('error');
      if (currentJobId) {
        await updateGenJob(currentJobId, {
          status: 'failed',
          error: errMsg,
          progress: liveProgress,
        });
      }
    }
  }, [
    outputDirectory,
    generatedStory,
    ensureProxyAvailable,
    createPipelineConfig,
    customStoryTitle,
    runWorkerJob,
    handleEvent,
    updateGenJob,
    registerGenJob,
    setActiveJobId,
    onStoryGenerated,
    currentJobId,
    liveProgress,
  ]);

  const handleCheckpointApprove = () => { setCurrentCheckpoint(null); setState('running'); };
  const handleCheckpointReject = (reason: string) => { Alert.alert('Checkpoint Rejected', 'Rejection logged, continuing generation.'); setCurrentCheckpoint(null); setState('running'); };

  const resumeFailedJob = async () => {
    const jobId = isRecoverableHistoryJob(historyJob) ? historyJob!.id : currentJobId;
    if (!jobId) return;

    let payloadPatch: Record<string, unknown> = {};
    let outputsPatch: Record<string, unknown> = {};
    try {
      payloadPatch = JSON.parse(failureWorkspace.payloadPatchJson || '{}');
      outputsPatch = JSON.parse(failureWorkspace.outputsPatchJson || '{}');
    } catch (parseErr) {
      Alert.alert('Invalid JSON', parseErr instanceof Error ? parseErr.message : 'Failed to parse repair JSON.');
      return;
    }

    setFailureWorkspace((prev) => ({ ...prev, resuming: true, error: null }));
    try {
      const configPatch = createPipelineConfig();
      const response = await fetch(`${PROXY_CONFIG.workerJobs}/${jobId}/resume`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payloadPatch: {
            ...payloadPatch,
            config: configPatch,
          },
          outputsPatch,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.success || !result?.jobId) {
        throw new Error(result?.error || 'Failed to resume generation.');
      }

      await registerGenJob({
        id: result.jobId,
        projectId: typeof result.projectId === 'string' ? result.projectId : jobId,
        resumeFromJobId: jobId,
        storyTitle: historyJob?.storyTitle || customStoryTitle || 'Untitled Story',
        friendlyName: typeof result.friendlyName === 'string' ? result.friendlyName : undefined,
        processTitle: typeof result.processTitle === 'string' ? result.processTitle : undefined,
        startedAt: new Date().toISOString(),
        status: 'running',
        currentPhase: 'queued',
        progress: 0,
        episodeCount: historyJob?.episodeCount || 1,
        currentEpisode: historyJob?.currentEpisode || 1,
        events: [],
      });
      setFailureWorkspace((prev) => ({ ...prev, resuming: false, tab: 'resume' }));
      setIsViewingHistory(false);
      setHistoryJob(undefined);
      setCurrentJobId(result.jobId);
      setActiveJobId(result.jobId);
      setEvents([]);
      setCurrentPhase(undefined);
      setLiveProgress(0);
      setEtaSeconds(null);
      setImageProgress(null);
      setPipelineRuntime(null);
      setError(null);
      setState('running');
    } catch (resumeErr) {
      const message = resumeErr instanceof Error ? resumeErr.message : 'Failed to resume generation.';
      setFailureWorkspace((prev) => ({ ...prev, resuming: false, error: message }));
      Alert.alert('Resume Failed', message);
    }
  };
  
  const exportStory = () => {
    if (!generatedStory || !generatedCode) return;
    const code = generatedCode;
    const copyToClipboard = async () => {
      try {
        await Clipboard.setStringAsync(code);
        Alert.alert('Copied', 'Story TypeScript code copied to clipboard.');
      } catch (copyErr) {
        console.warn('[GeneratorScreen] Failed to copy story code:', copyErr);
        Alert.alert('Copy Failed', 'Could not copy to clipboard. Try again or export manually.');
      }
    };
    Alert.alert(
      'Export Ready',
      `Story: ${generatedStory.title}\n\n${formatStoryStats(generatedStory)}\n\nFile: ${getStoryFileName(generatedStory)}`,
      [
        { text: 'Copy Code', onPress: () => { void copyToClipboard(); } },
        { text: 'OK' },
      ],
    );
  };

  const resetGenerator = () => {
    setState('config'); setEvents([]); setCurrentCheckpoint(null); setGeneratedStory(null); setGeneratedCode(null); setError(null);
    setOutputManifest(null); setOutputDirectory(null); pipelineRef.current = null; clearDocument();
    setCurrentJobId(null); setActiveJobId(null);
    setSeasonPlan(null); setSourceAnalysis(null); setAnalysisResult(null); setCanonWizardState(null); setSelectedEpisodes([]); setSelectedEpisodeCount(1);
    setLiveProgress(0); setEtaSeconds(null); setImageProgress(null); setPipelineRuntime(null);
    setIsViewingHistory(false); setHistoryJob(undefined);
  };

  const continueSeasonGeneration = useCallback(async () => {
    let plan = seasonPlan;
    let analysis = sourceAnalysis;

    if (!plan || !analysis) {
      await seasonPlanStore.initialize();
      const active = seasonPlanStore.getActivePlan();
      plan = active?.plan || null;
      analysis = active?.sourceAnalysis || null;
    }

    if (!plan || !analysis) {
      Alert.alert('Season Plan Missing', 'No saved season plan was found to continue.');
      return;
    }

    const nextEpisode = plan.episodes
      .filter((episode) => !isSeasonEpisodeGenerated(episode))
      .sort((a, b) => a.episodeNumber - b.episodeNumber)[0];

    if (!nextEpisode) {
      Alert.alert('Season Complete', 'All planned episodes have already been generated.');
      return;
    }

    setSeasonPlan(plan);
    setSourceAnalysis(analysis);
    setAnalysisResult({
      analysis,
      totalEpisodes: analysis.totalEstimatedEpisodes || plan.totalEpisodes,
      episodeOutlines: analysis.episodeBreakdown || plan.episodes,
      suggestedOptions: [],
    });
    setCustomStoryTitle(analysis.sourceTitle || plan.seasonTitle);
    setSelectedEpisodes([nextEpisode.episodeNumber]);
    setSelectedEpisodeCount(1);
    setEpisodeRecommendations([]);
    setSelectionWarnings([]);
    setGeneratedStory(null);
    setGeneratedCode(null);
    setOutputManifest(null);
    setOutputDirectory(null);
    setEvents([]);
    setCurrentCheckpoint(null);
    setError(null);
    setIsViewingHistory(false);
    setHistoryJob(undefined);
    setLiveProgress(0);
    setEtaSeconds(null);
    setImageProgress(null);
    setPipelineRuntime(null);
    setState('analysis_complete');
  }, [seasonPlan, sourceAnalysis]);

  const cancelGeneration = () => {
    setConfirmCancelGeneration(true);
  };

  const performCancelGeneration = async () => {
    setConfirmCancelGeneration(false);
    if (pipelineRef.current) {
      pipelineRef.current.cancel();
    } else if (onCancelExternalPipeline) {
      onCancelExternalPipeline();
    }
    if (currentJobId) {
      if (USE_SERVER_WORKER) {
        try {
          await fetch(`${PROXY_CONFIG.workerJobs}/${currentJobId}/cancel`, { method: 'POST', credentials: 'include' });
        } catch (cancelErr) {
          console.warn('[GeneratorScreen] Failed to cancel worker job:', cancelErr);
        }
      }
      await cancelGenJob(currentJobId);
      await updateGenJob(currentJobId, {
        status: 'cancelled',
        error: 'Cancelled by user',
        currentPhase: currentPhase || 'unknown',
        checkpoint: {
          briefJson: currentBriefRef.current ? JSON.stringify(currentBriefRef.current) : undefined,
          completedPhases: [...completedPhasesRef.current],
          lastSuccessfulPhase: lastSuccessfulPhaseRef.current || undefined,
          sourceAnalysisJson: sourceAnalysis ? JSON.stringify(sourceAnalysis) : undefined,
          isResumable: completedPhasesRef.current.length > 0,
          resumeHint: completedPhasesRef.current.length > 0
            ? `Completed phases: ${completedPhasesRef.current.join(', ')}. Restart to regenerate.`
            : 'No phases completed. Restart to try again.',
        },
      });
    }
    // Route intentional cancels to a dedicated 'cancelled' state so the UI
    // doesn't conflate user stops with actual pipeline failures (which would
    // surface the failure-workspace triage UI). The error string is cleared to
    // prevent any stale failure messaging.
    setState('cancelled');
    setError(null);
    pipelineRef.current = null;
  };

  const hasSourceInput = Boolean(documentBrief || userPrompt.trim() || sourceAnalysis);
  const updateGenerationSetting = useCallback(<K extends keyof GenerationSettings>(
    key: K,
    value: GenerationSettings[K],
  ) => {
    handleGenerationSettingsChange({
      ...generationSettings,
      [key]: value,
    });
  }, [generationSettings, handleGenerationSettingsChange]);

  const renderFailureWorkspace = () => {
    if (failureWorkspace.loading) {
      return (
        <View style={styles.failureWorkspaceCard}>
          <Text style={styles.failureWorkspaceTitle}>INSPECTING FAILURE...</Text>
        </View>
      );
    }

    const resumePlan = failureWorkspace.resumePlan;
    const failure = failureWorkspace.failureContext || (
      resumePlan
        ? {
            failurePhase: historyJob?.currentPhase || 'cancelled',
            failureStepId: resumePlan.resumeFromUnit || 'last durable checkpoint',
            failureKind: historyJob?.status || 'recoverable',
            message: historyJob?.error || 'Job stopped before a detailed failure context was recorded.',
            resumePatchableInputs: ['settings'],
          }
        : null
    );
    if (!failure) return null;

    const resumeFrom = typeof failure.resumeFromStepId === 'string' ? failure.resumeFromStepId : 'last durable checkpoint';
    const blockedAction = typeof failure.failureArtifactKey === 'string' ? failure.failureArtifactKey : 'credit-spending recovery';
    const resumeUnavailable = resumePlan?.canResume === false;

    return (
      <View style={styles.failureWorkspaceCard}>
        <View style={styles.failureWorkspaceHeader}>
          <Text style={styles.failureWorkspaceTitle}>FAILURE WORKSPACE</Text>
          <TouchableOpacity style={styles.textButton} onPress={() => {
            const jobId = isRecoverableHistoryJob(historyJob) ? historyJob!.id : currentJobId;
            if (jobId) void loadFailureWorkspace(jobId);
          }}>
            <Text style={styles.textButtonText}>REFRESH</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.failureTabs}>
          {(['failure', 'fix', 'resume'] as const).map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[styles.failureTab, failureWorkspace.tab === tab && styles.failureTabActive]}
              onPress={() => setFailureWorkspace((prev) => ({ ...prev, tab }))}
            >
              <Text style={[styles.failureTabText, failureWorkspace.tab === tab && styles.failureTabTextActive]}>
                {tab.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {failureWorkspace.tab === 'failure' && (
          <View style={styles.failurePanel}>
            <Text style={styles.failureLabel}>PHASE</Text>
            <Text style={styles.failureValue}>{String(failure.failurePhase || 'unknown').toUpperCase()}</Text>
            <Text style={styles.failureLabel}>STEP</Text>
            <Text style={styles.failureValue}>{String(failure.failureStepId || 'unknown')}</Text>
            <Text style={styles.failureLabel}>KIND</Text>
            <Text style={styles.failureValue}>{String(failure.failureKind || 'unknown')}</Text>
            <Text style={styles.failureLabel}>BLOCKED ACTION</Text>
            <Text style={styles.failureValue}>{blockedAction}</Text>
            <Text style={styles.failureLabel}>ERROR</Text>
            <Text style={styles.failureMessage}>{String(failure.message || historyJob?.error || error || 'Unknown failure')}</Text>
            {(failure.failureKind === 'image_completeness' || failure.failureKind === 'image_generation') && failure.context?.byCategory && (
              <View style={{ marginTop: 12 }}>
                <Text style={styles.failureLabel}>MISSING IMAGES BY CATEGORY</Text>
                {Object.entries(failure.context.byCategory as Record<string, string[]>).map(([category, keys]) => (
                  <View key={category} style={{ marginTop: 6, marginLeft: 8 }}>
                    <Text style={[styles.failureValue, { marginBottom: 2 }]}>
                      {category.toUpperCase()} ({keys.length})
                    </Text>
                    {keys.slice(0, 10).map((key: string) => (
                      <Text key={key} style={[styles.failureMessage, { fontSize: 11, marginLeft: 8, marginTop: 1 }]}>
                        {key}
                      </Text>
                    ))}
                    {keys.length > 10 && (
                      <Text style={[styles.failureMessage, { fontSize: 11, marginLeft: 8, fontStyle: 'italic' }]}>
                        ...and {keys.length - 10} more
                      </Text>
                    )}
                  </View>
                ))}
                <Text style={[styles.failureMessage, { marginTop: 8 }]}>
                  Resume will re-generate only the {failure.context.totalMissing || 'missing'} images.
                </Text>
              </View>
            )}
          </View>
        )}

        {failureWorkspace.tab === 'fix' && (
          <View style={styles.failurePanel}>
            <Text style={styles.failureLabel}>SETTINGS / PAYLOAD PATCH JSON</Text>
            <TextInput
              style={styles.failureEditor}
              multiline
              value={failureWorkspace.payloadPatchJson}
              onChangeText={(value) => setFailureWorkspace((prev) => ({ ...prev, payloadPatchJson: value }))}
              placeholder='{}'
              placeholderTextColor={TERMINAL.colors.muted}
            />
            <Text style={styles.failureLabel}>CHECKPOINT / PROMPT PATCH JSON</Text>
            <TextInput
              style={styles.failureEditor}
              multiline
              value={failureWorkspace.outputsPatchJson}
              onChangeText={(value) => setFailureWorkspace((prev) => ({ ...prev, outputsPatchJson: value }))}
              placeholder='{}'
              placeholderTextColor={TERMINAL.colors.muted}
            />
            {failureWorkspace.error && <Text style={styles.failureInlineError}>{failureWorkspace.error}</Text>}
          </View>
        )}

        {failureWorkspace.tab === 'resume' && (
          <View style={styles.failurePanel}>
            {resumePlan && (
              <>
                <Text style={styles.failureLabel}>RESUME STRATEGY</Text>
                <Text style={styles.failureValue}>{String(resumePlan.strategy || 'generation').toUpperCase()}</Text>
                <Text style={styles.failureLabel}>REUSABLE WORK</Text>
                <Text style={styles.failureMessage}>
                  {String(resumePlan.reusableUnitCount ?? 0)} checkpoint unit(s)
                </Text>
                {typeof resumePlan.humanSummary === 'string' && (
                  <Text style={styles.failureMessage}>{resumePlan.humanSummary}</Text>
                )}
              </>
            )}
            <Text style={styles.failureLabel}>RESUME FROM</Text>
            <Text style={styles.failureValue}>{String(resumePlan?.resumeFromUnit || resumeFrom)}</Text>
            <Text style={styles.failureLabel}>CURRENT FAILURE POLICY</Text>
            <Text style={styles.failureValue}>{generationSettings.failFastMode ? 'FAIL FAST' : 'RECOVER'}</Text>
            <Text style={styles.failureLabel}>PATCHABLE INPUTS</Text>
            <Text style={styles.failureMessage}>
              {Array.isArray(failure.resumePatchableInputs) && failure.resumePatchableInputs.length > 0
                ? failure.resumePatchableInputs.join(', ')
                : 'settings'}
            </Text>
          </View>
        )}

        <View style={styles.failureActions}>
          <TouchableOpacity
            style={[styles.executeButton, (failureWorkspace.resuming || resumeUnavailable) && { opacity: 0.6 }]}
            onPress={resumeFailedJob}
            disabled={failureWorkspace.resuming || resumeUnavailable}
          >
            <Text style={styles.executeButtonText}>
              {resumeUnavailable
                ? 'RESUME UNAVAILABLE'
                : failureWorkspace.resuming
                ? 'RESUMING...'
                : failureWorkspace.resumePlan?.strategy === 'scene'
                  ? `RESUME AT ${String(failureWorkspace.resumePlan.resumeFromUnit || 'FAILED SCENE').toUpperCase()}`
                  : failureWorkspace.resumePlan?.strategy === 'images'
                    ? 'RESUME MISSING IMAGES'
                    : failureWorkspace.resumePlan?.strategy === 'save'
                      ? 'RETRY FINAL SAVE'
                      : 'RESUME FROM FAILURE'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const imageProviderLabel = imageProvider === 'nano-banana'
    ? 'Gemini'
    : imageProvider === 'dall-e'
      ? 'OpenAI'
    : imageProvider === 'midapi'
      ? 'MidAPI'
      : imageProvider === 'stable-diffusion'
        ? 'Stable Diffusion'
        : 'Atlas Cloud';
  const narrativeStructureLabel = 'standard episodes';
  const narrativeSceneLabel = `${generationSettings.targetSceneCount} scenes`;
  const storySummaryLines = [
    `Source: ${hasSourceInput ? 'ready' : 'missing'}${customStoryTitle.trim() ? ` • title "${customStoryTitle.trim()}"` : ''}`,
    `Writing: ${llmProvider.toUpperCase()} • ${llmModel}`,
    `Narrative: ${narrativeStructureLabel} • ${narrativeSceneLabel}`,
    `Run media: images ${runGenerateImages ? 'on' : 'off'} • video ${runGenerateVideo ? 'on' : 'off'}`,
  ];
  const imageSummaryLines = [
    `${generationSettings.generateImages ? 'Generate story art after text' : 'Story art disabled'} • ${imageProviderLabel} renderer`,
    `Prompting: ${imageLlmProvider.toUpperCase()} • ${imageLlmModel}`,
    `Style: ${currentArtStyleLabel || '⚠ empty — will fall back to default (expressive illustrated)'} • refs ${generationSettings.generateCharacterRefs ? 'on' : 'off'} • style refs ${styleReferenceUploads.length}`,
  ];
  const videoSummaryLines = [
    `${videoSettings.enabled ? 'Experimental video enabled' : 'Experimental video disabled'} • ${videoLlmProvider.toUpperCase()} • ${videoLlmModel}`,
    `${videoSettings.model} • ${videoSettings.durationSeconds}s • ${videoSettings.resolution} • ${videoSettings.aspectRatio}`,
    `Strategy: ${videoSettings.strategy}${!runGenerateImages ? ' • images required for story runs' : ''}`,
  ];
  const narrationSummaryLines = [
    `${narrationSettings.enabled ? 'Optional narration enabled' : 'Optional narration disabled'} • ${(narrationSettings.provider || 'elevenlabs').toUpperCase()} ${(narrationSettings.provider || 'elevenlabs') === 'gemini' ? (geminiApiKey.trim() ? 'ready' : 'missing') : (elevenLabsApiKey.trim() ? 'ready' : 'missing')}`,
    `${narrationSettings.preGenerateAudio ? 'Pre-generate on' : 'Pre-generate off'} • ${narrationSettings.autoPlay ? 'Auto-play on' : 'Auto-play off'}`,
    `Highlight: ${narrationSettings.highlightMode.toUpperCase()} • Tags ${narrationSettings.performanceTagsEnabled ? 'on' : 'off'} • Casting ${narrationSettings.voiceCastingEnabled === false ? 'off' : 'on'}`,
  ];

	  const renderImageSetupControls = () => (
    <SetupStepCard
      step="2"
      title="IMAGE SETUP"
      description="Choose the planning model, renderer, image model, and art style before opening detailed image options."
    >
      <View style={styles.configItem}>
        <Text style={styles.configLabel}>IMAGE PLANNING LLM</Text>
        <Text style={styles.configHint}>Controls the model that storyboards scenes and writes image prompts before rendering.</Text>
        <View style={styles.segmentedControl}>
          <TouchableOpacity style={[styles.segment, imageLlmProvider === 'anthropic' && styles.segmentActive]} onPress={() => handleImageLlmProviderChange('anthropic')}>
            <Text style={[styles.segmentText, imageLlmProvider === 'anthropic' && styles.segmentTextActive]}>ANTHROPIC</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.segment, imageLlmProvider === 'openai' && styles.segmentActive]} onPress={() => handleImageLlmProviderChange('openai')}>
            <Text style={[styles.segmentText, imageLlmProvider === 'openai' && styles.segmentTextActive]}>OPENAI</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.segment, imageLlmProvider === 'gemini' && styles.segmentActive]} onPress={() => handleImageLlmProviderChange('gemini')}>
            <Text style={[styles.segmentText, imageLlmProvider === 'gemini' && styles.segmentTextActive]}>GEMINI</Text>
          </TouchableOpacity>
        </View>
        <ModelDropdown
          options={availableModels[imageLlmProvider].map(o => ({ value: o.value, label: o.label, subtitle: o.value }))}
          value={imageLlmModel}
          onSelect={handleImageLlmModelChange}
          placeholder="Select model…"
        />
      </View>

      <View style={styles.configItem}>
        <Text style={styles.configLabel}>IMAGE PROVIDER</Text>
        <View style={styles.segmentedControl}>
          <TouchableOpacity style={[styles.segment, imageProvider === 'nano-banana' && styles.segmentActive]} onPress={() => handleImageProviderChange('nano-banana')}>
            <Text style={[styles.segmentText, imageProvider === 'nano-banana' && styles.segmentTextActive]}>GEMINI</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.segment, imageProvider === 'dall-e' && styles.segmentActive]} onPress={() => handleImageProviderChange('dall-e')}>
            <Text style={[styles.segmentText, imageProvider === 'dall-e' && styles.segmentTextActive]}>OPENAI</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.segment, imageProvider === 'midapi' && styles.segmentActive]} onPress={() => handleImageProviderChange('midapi')}>
            <Text style={[styles.segmentText, imageProvider === 'midapi' && styles.segmentTextActive]}>MIDAPI</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.segment, imageProvider === 'atlas-cloud' && styles.segmentActive]} onPress={() => handleImageProviderChange('atlas-cloud')}>
            <Text style={[styles.segmentText, imageProvider === 'atlas-cloud' && styles.segmentTextActive]}>ATLAS</Text>
          </TouchableOpacity>
          {STABLE_DIFFUSION_UI_ENABLED && (
            <TouchableOpacity style={[styles.segment, imageProvider === 'stable-diffusion' && styles.segmentActive]} onPress={() => handleImageProviderChange('stable-diffusion')}>
              <Text style={[styles.segmentText, imageProvider === 'stable-diffusion' && styles.segmentTextActive]}>SD</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {imageProvider === 'nano-banana' && (
        <View style={styles.configItem}>
          <Text style={styles.configLabel}>IMAGE MODEL</Text>
          <ModelDropdown
            options={[
              { value: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash', description: 'Original Nano Banana. Stable, cost-effective.' },
              { value: 'gemini-3-pro-image-preview', label: 'Gemini 3 Pro', description: 'Nano Banana Pro. Highest quality, supports thinking.' },
              { value: 'gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash', description: 'Nano Banana 2. Pro quality at Flash speed. Recommended.' },
            ]}
            value={geminiSettings.model || DEFAULT_GEMINI_SETTINGS.model}
            onSelect={(v) => handleGeminiSettingsChange({ model: v })}
          />
        </View>
      )}

      {imageProvider === 'dall-e' && (
        <View style={styles.configItem}>
          <Text style={styles.configLabel}>IMAGE MODEL</Text>
          <ModelDropdown
            options={[
              { value: 'gpt-image-1', label: 'GPT Image 1', description: 'General-purpose high quality fallback, no org verification required.' },
              { value: 'gpt-image-1-mini', label: 'GPT Image 1 Mini', description: 'Fastest and lowest cost. No verification required.' },
              { value: 'gpt-image-1.5', label: 'GPT Image 1.5 (verified org only)', description: 'Requires OpenAI organization verification.' },
              { value: 'gpt-image-2', label: 'GPT Image 2 (verified org only)', description: 'Default for storyboard pipeline. Strongest consistency + multi-ref editing.' },
            ]}
            value={openaiSettings.imageModel || DEFAULT_OPENAI_SETTINGS.imageModel}
            onSelect={(v) => handleOpenaiSettingsChange({ imageModel: v as any, imageModeration: 'low' })}
          />
          <Text style={styles.configHint}>OpenAI image moderation is fixed to low for generated story art.</Text>
        </View>
      )}

      {imageProvider === 'atlas-cloud' && (
        <View style={styles.configItem}>
          <Text style={styles.configLabel}>IMAGE MODEL</Text>
          <ModelDropdown
            options={atlasCloudModels.map(m => ({
              value: m.value,
              label: m.label,
              description: m.description || undefined,
            }))}
            value={atlasCloudModel}
            onSelect={handleAtlasCloudModelChange}
            placeholder="Select Atlas Cloud model…"
          />
        </View>
      )}

      {STABLE_DIFFUSION_UI_ENABLED && imageProvider === 'stable-diffusion' && (
        <View style={styles.configItem}>
          <Text style={styles.configLabel}>IMAGE MODEL</Text>
          <View style={styles.inputWrapper}>
            <TextInput
              style={styles.input}
              value={stableDiffusionSettings.defaultModel || ''}
              onChangeText={(v) => handleStableDiffusionSettingsChange({ defaultModel: v })}
              placeholder="e.g. sdxl-base-1.0 or checkpoint filename"
              placeholderTextColor={TERMINAL.colors.muted}
              autoCapitalize="none"
            />
          </View>
        </View>
      )}

      <View style={styles.configItem}>
        <Text style={styles.configLabel}>ART STYLE</Text>
        <TouchableOpacity
          style={styles.styleDropdownButton}
          onPress={() => setShowArtStyleSheet(true)}
          accessibilityRole="button"
          accessibilityLabel="Choose art style"
        >
          <View style={styles.styleDropdownTextBlock}>
            <Text style={styles.styleDropdownValue} numberOfLines={1}>
              {currentArtStyleLabel || 'Choose an art style'}
            </Text>
            <Text style={styles.styleDropdownHint} numberOfLines={1}>
              Presets, saved styles, recents, and custom styles
            </Text>
          </View>
          <ChevronDown size={16} color={TERMINAL.colors.muted} />
        </TouchableOpacity>
        {artStyle.trim().length === 0 ? (
          <Text style={[styles.configHint, { marginTop: 4, color: TERMINAL.colors.warning || TERMINAL.colors.muted }]}>
            ⚠ No art style set — images will fall back to &quot;dramatic cinematic story art&quot;.
          </Text>
        ) : null}
      </View>
    </SetupStepCard>
	  );

  const renderMediaTargetCard = (kind: 'images' | 'video') => (
    <SetupStepCard
      step="1"
      title={kind === 'images' ? 'TARGET EPISODE' : 'TARGET EPISODE'}
      description={mediaSetupTarget
        ? `This job is scoped to episode ${mediaSetupTarget.episodeNumber}.`
        : 'Choose an episode from the story database before running a media-only job.'}
    >
      <View style={styles.setupChecklist}>
        <View style={styles.setupChecklistItem}>
          <Text style={styles.setupChecklistLabel}>STORY</Text>
          <Text style={styles.setupChecklistValue}>{mediaSetupTarget?.storyId || 'MISSING'}</Text>
        </View>
        <View style={styles.setupChecklistItem}>
          <Text style={styles.setupChecklistLabel}>EPISODE</Text>
          <Text style={[styles.setupChecklistValue, mediaSetupTarget ? styles.setupChecklistValueReady : null]}>
            {mediaSetupTarget ? `${mediaSetupTarget.episodeNumber}` : 'MISSING'}
          </Text>
        </View>
        <View style={styles.setupChecklistItem}>
          <Text style={styles.setupChecklistLabel}>TITLE</Text>
          <Text style={styles.setupChecklistValue}>{mediaSetupTarget?.episodeTitle || 'MISSING'}</Text>
        </View>
      </View>
    </SetupStepCard>
  );

  const runTargetImageGeneration = () => {
    if (!mediaSetupTarget) return;
    void onGenerateTargetImages?.({ ...mediaSetupTarget, kind: 'images' });
  };

  const runTargetVideoGeneration = () => {
    if (!mediaSetupTarget) return;
    void onGenerateTargetVideos?.({ ...mediaSetupTarget, kind: 'video' });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerIconButton} onPress={onBack}>
          <ChevronRight size={20} color={TERMINAL.colors.muted} style={{ transform: [{ rotate: '180deg' }] }} />
          <Text style={styles.headerButtonText}>BACK</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {setupView === 'image'
            ? 'IMAGE SETUP'
            : setupView === 'video'
              ? 'VIDEO SETUP'
              : (state === 'running' || state === 'checkpoint') && !isViewingHistory
                ? 'GENERATING STORY'
                : 'AI GENERATOR'}
        </Text>
        {hasBackgroundJobs ? (
          <TouchableOpacity
            style={styles.jobsPill}
            onPress={() => setShowJobsSheet(true)}
            accessibilityRole="button"
            accessibilityLabel={`Open background jobs (${totalBackgroundJobs})`}
          >
            <Layers size={12} color={TERMINAL.colors.amber} />
            <Text style={styles.jobsPillText}>JOBS</Text>
            <View style={styles.jobsPillBadge}>
              <Text style={styles.jobsPillBadgeText}>{totalBackgroundJobs}</Text>
            </View>
          </TouchableOpacity>
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>
      {/*
        Wizard-style step indicator. The generator now opens directly on the
        configuration step, and the indicator reads the existing `state`
        machine directly so we don't introduce a new source of truth.
      */}
      {state !== 'idle' && !isViewingHistory && state !== 'running' && state !== 'checkpoint' && (
        <StepIndicator
          currentStep={deriveWizardStep(state)}
          completed={state === 'complete'}
          errored={state === 'error'}
        />
      )}
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false} contentContainerStyle={styles.contentPadding}>
        {/* The status bar is redundant with the in-progress hero's worker/phase
            state, so hide it while a generation is actively running. */}
        {!((state === 'running' || state === 'checkpoint') && !isViewingHistory) && (
          <View style={styles.statusBar}>
            <Cpu size={14} color={TERMINAL.colors.muted} />
            <Text style={styles.statusLabel}>PIPELINE STATUS:</Text>
            <Text style={[styles.statusValue, isViewingHistory ? styles.status_history : styles[`status_${state}`]]}>
              {isViewingHistory ? 'JOB HISTORY' : state.toUpperCase().replace('_', ' ')}
            </Text>
          </View>
        )}
        {state === 'config' && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Settings size={18} color={TERMINAL.colors.primary} />
              <Text style={styles.sectionTitle}>
                {setupView === 'image' ? 'IMAGE SETUP' : setupView === 'video' ? 'VIDEO SETUP' : 'PIPELINE CONFIGURATION'}
              </Text>
            </View>
            <Text style={styles.configIntro}>
              {setupView === 'image'
                ? 'Tune image settings for the selected episode, then generate only that episode art.'
                : setupView === 'video'
                  ? 'Tune video settings for the selected episode, then animate only that episode.'
	                  : 'Configure the story setup once, then toggle images, video, and narration on or off at a glance.'}
            </Text>
            <View style={styles.configGroup}>
              {setupView === 'story' ? (
              <ConfigBucketCard
                title="STORY"
	                description="Source material, writing model, and advanced story controls."
                icon={<BookOpen size={16} color={TERMINAL.colors.primary} />}
                expanded={showStoryPanel}
                onToggleExpanded={() => setShowStoryPanel(!showStoryPanel)}
                summaryLines={storySummaryLines}
              >
                <View style={styles.configItem}>
                  <Text style={styles.configLabel}>STORY DESIGNATION (TITLE)</Text>
                  <View style={styles.inputWrapper}><TextInput style={styles.input} value={customStoryTitle} onChangeText={setCustomStoryTitle} placeholder="E.G. THE VORTEX AWAKENS" placeholderTextColor={TERMINAL.colors.muted} /></View>
                </View>

                <View style={styles.configItem}>
                  <Text style={styles.configLabel}>SOURCE MATERIAL</Text>
                  <TouchableOpacity style={[styles.filePicker, selectedFileName ? styles.filePickerActive : null]} onPress={pickDocument}><View style={styles.fileIconBox}>{selectedFileName ? <CheckCircle2 size={20} color="white" /> : <FolderOpen size={20} color={TERMINAL.colors.muted} />}</View><View style={styles.fileInfo}><Text style={styles.fileName}>{selectedFileName || 'SELECT SOURCE DOCUMENT'}</Text><Text style={styles.fileMeta}>MD, TXT, PDF, JSON</Text></View>{selectedFileName && <TouchableOpacity onPress={clearDocument} style={styles.clearBtn}><Trash2 size={16} color={TERMINAL.colors.muted} /></TouchableOpacity>}</TouchableOpacity>
                  {parsedDocument && <View style={styles.parsedCard}><View style={styles.parsedHeader}><CheckCircle2 size={12} color={TERMINAL.colors.primary} /><Text style={styles.parsedTitle}>SOURCE ANALYZED</Text></View><Text style={styles.parsedInfo}>{parsedDocument.title || 'UNTITLED'}</Text><Text style={styles.parsedMeta}>{parsedDocument.genre?.toUpperCase()} • {parsedDocument.npcs?.length || 0} NPCs</Text></View>}
                </View>

                <View style={styles.configItem}>
                  <Text style={styles.configLabel}>CREATIVE PROMPT / INSTRUCTIONS</Text>
                  <View style={[styles.inputWrapper, { height: 100, paddingVertical: 10 }]}><TextInput style={[styles.input, { height: '100%', textAlignVertical: 'top' }]} value={userPrompt} onChangeText={setUserPrompt} placeholder="ENTER STORY IDEAS OR ADAPTATION INSTRUCTIONS..." placeholderTextColor={TERMINAL.colors.muted} multiline numberOfLines={4} /></View>
                </View>

                <View style={styles.configItem}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <Text style={styles.configLabel}>MODEL FAMILY</Text>
                    <TouchableOpacity
                      onPress={() => refreshModels({ anthropicApiKey: apiKey, openaiApiKey, geminiApiKey, atlasCloudApiKey: atlasCloudApiKey, ...(modelFamily === 'openrouter' ? { openRouterApiKey } : {}) })}
                      disabled={modelsScanLoading}
                      style={{ flexDirection: 'row', alignItems: 'center', opacity: modelsScanLoading ? 0.5 : 1 }}
                    >
                      <RefreshCw size={12} color={TERMINAL.colors.cyan} style={modelsScanLoading ? { opacity: 0.5 } : undefined} />
                      <Text style={{ color: TERMINAL.colors.muted, fontSize: 10, marginLeft: 4 }}>
                        {modelsScanLoading ? 'SCANNING...' : modelsScanDate ? `SCANNED ${new Date(modelsScanDate).toLocaleDateString()}` : 'SCAN MODELS'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <SegmentedControl<GeneratorLlmProvider>
                    options={[
                      { value: 'anthropic', label: 'Claude' },
                      { value: 'openai', label: 'OpenAI' },
                      { value: 'gemini', label: 'Gemini' },
                      { value: 'openrouter', label: 'OpenRouter' },
                    ]}
                    value={modelFamily}
                    onChange={handleModelFamilyChange}
                    ariaLabel="Model family"
                  />
                  <Text style={[styles.toggleActionHint, { marginTop: 8 }]}>
                    {MODEL_FAMILY_PRESETS[modelFamily].tagline}
                  </Text>

                  <View style={styles.presetSummary}>
                    {PIPELINE_TASKS.map((task) => {
                      const a = effectiveTaskAssignments[task.id];
                      const customized = !task.crossProvider && Boolean(taskModelOverrides[task.id]);
                      return (
                        <View key={task.id} style={styles.presetRow}>
                          <Text style={styles.presetTask}>{task.label}</Text>
                          <View style={styles.presetModelWrap}>
                            <Text style={styles.presetModel} numberOfLines={1}>
                              {task.crossProvider ? `${a.provider} · ` : ''}{modelLabel(a.provider, a.model)}
                            </Text>
                            {customized ? <Text style={styles.presetCustom}>CUSTOM</Text> : null}
                          </View>
                        </View>
                      );
                    })}
                  </View>

                  <TouchableOpacity
                    style={styles.inlineDisclosure}
                    onPress={() => setShowModelTaskSheet(true)}
                    accessibilityRole="button"
                    accessibilityLabel="Customize models per task"
                  >
                    <Settings size={16} color={TERMINAL.colors.primary} style={{ marginRight: 8 }} />
                    <Text style={styles.configLabel}>CUSTOMIZE PER TASK</Text>
                    <Text style={styles.advancedSettingsHint}>OPEN</Text>
                    <ChevronRight size={16} color={TERMINAL.colors.muted} style={{ marginLeft: 8 }} />
                  </TouchableOpacity>
                </View>

                <View style={styles.configItem}>
                  <Text style={styles.configLabel}>RUN OUTPUTS</Text>
                  <TouchableOpacity style={styles.toggleActionRow} onPress={() => setRunGenerateImages(!runGenerateImages)}>
                    <View>
                      <Text style={styles.configLabel}>IMAGES</Text>
                      <Text style={styles.toggleActionHint}>Include image generation in this story run only.</Text>
                    </View>
                    <View style={[styles.booleanToggle, runGenerateImages && styles.booleanToggleActive]}><View style={[styles.booleanToggleKnob, runGenerateImages && styles.booleanToggleKnobActive]} /></View>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.toggleActionRow} onPress={() => setRunGenerateVideo(!runGenerateVideo)}>
                    <View>
                      <Text style={styles.configLabel}>VIDEO</Text>
                      <Text style={styles.toggleActionHint}>Include video generation in this story run only.</Text>
                    </View>
                    <View style={[styles.booleanToggle, runGenerateVideo && styles.booleanToggleActive]}><View style={[styles.booleanToggleKnob, runGenerateVideo && styles.booleanToggleKnobActive]} /></View>
                  </TouchableOpacity>
                  {!runGenerateImages && runGenerateVideo ? (
                    <View style={styles.warningCallout}>
                      <Text style={styles.warningCalloutText}>Video requires still images. Enable images for this run or generate video later from an episode row.</Text>
                    </View>
                  ) : null}
                </View>

                <View style={styles.configItem}>
                  <Text style={styles.configLabel}>NARRATIVE SETTINGS</Text>
                  <TouchableOpacity
                    style={styles.inlineDisclosure}
                    onPress={() => setShowAdvancedSettings(true)}
                    accessibilityRole="button"
                    accessibilityLabel="Open narrative generation settings"
                  >
                    <Settings size={16} color={TERMINAL.colors.primary} style={{ marginRight: 8 }} />
                    <Text style={styles.configLabel}>STRUCTURE, PACING, CHOICES, VALIDATION</Text>
                    <Text style={styles.advancedSettingsHint}>OPEN</Text>
                    <ChevronRight size={16} color={TERMINAL.colors.muted} style={{ marginLeft: 8 }} />
                  </TouchableOpacity>
                </View>
              </ConfigBucketCard>
              ) : null}

              {setupView === 'image' ? renderMediaTargetCard('images') : null}
              {setupView === 'image' ? renderImageSetupControls() : null}

              {setupView === 'image' ? (
              <ConfigBucketCard
                title="IMAGES"
                description="Generate story art after text: renderer choice, model, style, and still-image outputs."
                icon={<ImageIcon size={16} color={generationSettings.generateImages ? TERMINAL.colors.cyan : TERMINAL.colors.muted} />}
                expanded={showImagesPanel}
                onToggleExpanded={() => setShowImagesPanel(!showImagesPanel)}
                summaryLines={imageSummaryLines}
                enabled={generationSettings.generateImages}
                onToggleEnabled={(value) => updateGenerationSetting('generateImages', value)}
              >
                <View style={styles.configItem}>
                  <View style={styles.styleReferenceHeader}>
                    <View style={styles.styleReferenceTitleBlock}>
                      <Text style={styles.configLabel}>STYLE REFERENCE IMAGES</Text>
                      <Text style={styles.configHint}>
                        Upload up to {MAX_STYLE_REFERENCE_UPLOADS} images to seed the style bible. They influence palette, texture, lighting, finish, and mood, not characters or scene composition.
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={[
                        styles.referenceUploadButton,
                        (!generationSettings.generateImages || styleReferenceUploads.length >= MAX_STYLE_REFERENCE_UPLOADS) && styles.referenceUploadButtonDisabled,
                      ]}
                      onPress={pickStyleReferences}
                      disabled={!generationSettings.generateImages || styleReferenceUploads.length >= MAX_STYLE_REFERENCE_UPLOADS}
                    >
                      <ImageIcon size={14} color={generationSettings.generateImages ? TERMINAL.colors.primary : TERMINAL.colors.muted} />
                      <Text style={[
                        styles.referenceUploadButtonText,
                        !generationSettings.generateImages && styles.referenceUploadButtonTextDisabled,
                      ]}>
                        {styleReferenceUploads.length > 0 ? 'ADD STYLE IMAGE' : 'UPLOAD STYLE IMAGE'}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {!generationSettings.generateImages ? (
                    <Text style={styles.referenceModeHint}>Enable images to pass style references into generation.</Text>
                  ) : (
                    <>
                      <View style={styles.referenceModeSection}>
                        <Text style={styles.referenceModeLabel}>REFERENCE STRENGTH</Text>
                        <View style={styles.referenceModeControl}>
                          {(['subtle', 'balanced', 'strong'] as StyleReferenceStrength[]).map((strength) => (
                            <TouchableOpacity
                              key={strength}
                              style={[styles.referenceModeOption, styleReferenceStrength === strength && styles.referenceModeOptionActive]}
                              onPress={() => setStyleReferenceStrength(strength)}
                            >
                              <Text style={[styles.referenceModeOptionText, styleReferenceStrength === strength && styles.referenceModeOptionTextActive]}>
                                {strength.toUpperCase()}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>

                      {styleReferenceUploads.length > 0 ? (
                        <View style={styles.referencePreviewGrid}>
                          {styleReferenceUploads.map((upload) => (
                            <View key={upload.id} style={styles.referencePreviewCard}>
                              <Image source={{ uri: upload.uri }} style={styles.referencePreviewImage} />
                              <TouchableOpacity
                                style={styles.referencePreviewRemove}
                                onPress={() => removeStyleReference(upload.id)}
                              >
                                <Trash2 size={12} color="white" />
                              </TouchableOpacity>
                              <Text style={styles.referencePreviewName} numberOfLines={1}>
                                {upload.name}
                              </Text>
                            </View>
                          ))}
                        </View>
                      ) : (
                        <Text style={styles.characterReferenceEmpty}>
                          No uploaded style reference yet. The pipeline will build the style bible from the art style text.
                        </Text>
                      )}
                    </>
                  )}
                </View>

                <View style={styles.configItem}>
                  <Text style={styles.configLabel}>IMAGE OUTPUTS</Text>
                  <TouchableOpacity style={styles.toggleActionRow} onPress={() => updateGenerationSetting('generateCharacterRefs', !generationSettings.generateCharacterRefs)}>
                    <View><Text style={styles.configLabel}>CHARACTER SHEETS</Text><Text style={styles.toggleActionHint}>Create baseline character reference sheets.</Text></View>
                    <View style={[styles.booleanToggle, generationSettings.generateCharacterRefs && styles.booleanToggleActive]}><View style={[styles.booleanToggleKnob, generationSettings.generateCharacterRefs && styles.booleanToggleKnobActive]} /></View>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.toggleActionRow} onPress={() => updateGenerationSetting('generateExpressionSheets', !generationSettings.generateExpressionSheets)}>
                    <View><Text style={styles.configLabel}>EXPRESSION SHEETS</Text><Text style={styles.toggleActionHint}>Create alternate emotion references.{imageProvider === 'dall-e' ? ' Ignored when provider is DALL-E (gpt-image-2).' : ''}</Text></View>
                    <View style={[styles.booleanToggle, generationSettings.generateExpressionSheets && styles.booleanToggleActive]}><View style={[styles.booleanToggleKnob, generationSettings.generateExpressionSheets && styles.booleanToggleKnobActive]} /></View>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.toggleActionRow} onPress={() => updateGenerationSetting('generateBodyVocabulary', !generationSettings.generateBodyVocabulary)}>
                    <View><Text style={styles.configLabel}>BODY VOCABULARY</Text><Text style={styles.toggleActionHint}>Generate pose and silhouette references.{imageProvider === 'dall-e' ? ' Ignored when provider is DALL-E (gpt-image-2).' : ''}</Text></View>
                    <View style={[styles.booleanToggle, generationSettings.generateBodyVocabulary && styles.booleanToggleActive]}><View style={[styles.booleanToggleKnob, generationSettings.generateBodyVocabulary && styles.booleanToggleKnobActive]} /></View>
                  </TouchableOpacity>
                </View>

                {imageProvider === 'nano-banana' && (
                  <>
                    <View style={styles.configItem}>
                      <TouchableOpacity
                        style={styles.inlineDisclosure}
                        onPress={() => setShowGeminiSettings(!showGeminiSettings)}
                      >
                        <Settings size={16} color={TERMINAL.colors.cyan} style={{ marginRight: 8 }} />
                        <Text style={[styles.configLabel, { color: TERMINAL.colors.cyan }]}>GEMINI PARAMETERS</Text>
                        <ChevronRight size={16} color={TERMINAL.colors.muted} style={{ marginLeft: 'auto', transform: [{ rotate: showGeminiSettings ? '90deg' : '0deg' }] }} />
                      </TouchableOpacity>
                      {showGeminiSettings && (
                        <View style={styles.disclosureBody}>
                          <View style={styles.toggleConfigRow}>
                            <View style={styles.toggleConfigInfo}>
                              <Text style={styles.configLabel}>CONSISTENCY INSTRUCTION</Text>
                              <Text style={styles.configHint}>Prime Gemini to maintain character appearance from reference images.</Text>
                            </View>
                            <Switch
                              value={geminiSettings.includeConsistencyInstruction !== false}
                              onValueChange={(v) => handleGeminiSettingsChange({ includeConsistencyInstruction: v })}
                              trackColor={{ false: '#333', true: TERMINAL.colors.cyan }}
                              thumbColor="#fff"
                            />
                          </View>

                          <View style={styles.toggleConfigRow}>
                            <View style={styles.toggleConfigInfo}>
                              <Text style={styles.configLabel}>PREVIOUS SCENE CONTINUITY</Text>
                              <Text style={styles.configHint}>Pass the previous scene image to Gemini for visual continuity.</Text>
                            </View>
                            <Switch
                              value={geminiSettings.includePreviousScene !== false}
                              onValueChange={(v) => handleGeminiSettingsChange({ includePreviousScene: v })}
                              trackColor={{ false: '#333', true: TERMINAL.colors.cyan }}
                              thumbColor="#fff"
                            />
                          </View>

                          <View style={styles.toggleConfigRow}>
                            <View style={styles.toggleConfigInfo}>
                              <Text style={styles.configLabel}>STYLE REFERENCE IMAGE</Text>
                              <Text style={styles.configHint}>Use the first generated scene as a style anchor for consistency.</Text>
                            </View>
                            <Switch
                              value={geminiSettings.includeStyleReference !== false}
                              onValueChange={(v) => handleGeminiSettingsChange({ includeStyleReference: v })}
                              trackColor={{ false: '#333', true: TERMINAL.colors.cyan }}
                              thumbColor="#fff"
                            />
                          </View>

                          <View style={{ marginBottom: 16 }}>
                            <Text style={styles.configLabel}>MAX REF IMAGES PER CHARACTER: {geminiSettings.maxRefImagesPerCharacter ?? DEFAULT_GEMINI_SETTINGS.maxRefImagesPerCharacter}</Text>
                            <View style={styles.segmentedControl}>
                              {[1, 2, 3].map(n => (
                                <TouchableOpacity
                                  key={n}
                                  style={[styles.segment, (geminiSettings.maxRefImagesPerCharacter ?? DEFAULT_GEMINI_SETTINGS.maxRefImagesPerCharacter) === n && styles.segmentActive]}
                                  onPress={() => handleGeminiSettingsChange({ maxRefImagesPerCharacter: n })}
                                >
                                  <Text style={[styles.segmentText, (geminiSettings.maxRefImagesPerCharacter ?? DEFAULT_GEMINI_SETTINGS.maxRefImagesPerCharacter) === n && styles.segmentTextActive]}>{n}</Text>
                                </TouchableOpacity>
                              ))}
                            </View>
                            <Text style={styles.configHint}>Fewer = faster + cheaper. More = better character coverage.</Text>
                          </View>

                          <View style={styles.toggleConfigRow}>
                            <View style={styles.toggleConfigInfo}>
                              <Text style={styles.configLabel}>EDIT MODE (EXPERIMENTAL)</Text>
                              <Text style={styles.configHint}>Modify the previous beat image instead of regenerating from scratch.</Text>
                            </View>
                            <Switch
                              value={geminiSettings.useEditMode === true}
                              onValueChange={(v) => handleGeminiSettingsChange({ useEditMode: v, useChatMode: v ? false : geminiSettings.useChatMode })}
                              trackColor={{ false: '#333', true: TERMINAL.colors.cyan }}
                              thumbColor="#fff"
                            />
                          </View>

                          <View style={styles.toggleConfigRow}>
                            <View style={styles.toggleConfigInfo}>
                              <Text style={styles.configLabel}>CHAT MODE (EXPERIMENTAL)</Text>
                              <Text style={styles.configHint}>Use multi-turn context per scene. Mutually exclusive with Edit Mode.</Text>
                            </View>
                            <Switch
                              value={geminiSettings.useChatMode === true}
                              onValueChange={(v) => handleGeminiSettingsChange({ useChatMode: v, useEditMode: v ? false : geminiSettings.useEditMode })}
                              trackColor={{ false: '#333', true: TERMINAL.colors.cyan }}
                              thumbColor="#fff"
                            />
                          </View>

                          <TouchableOpacity
                            style={styles.inlineResetButton}
                            onPress={() => handleGeminiSettingsChange({ ...DEFAULT_GEMINI_SETTINGS })}
                          >
                            <RefreshCw size={14} color={TERMINAL.colors.muted} style={{ marginRight: 6 }} />
                            <Text style={styles.inlineResetButtonText}>RESET TO DEFAULTS</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  </>
                )}

                {imageProvider === 'midapi' && (
                  <>
                    <View style={styles.configItem}>
                      <TouchableOpacity
                        style={styles.inlineDisclosure}
                        onPress={() => setShowMjSettings(!showMjSettings)}
                      >
                        <Settings size={16} color={TERMINAL.colors.cyan} style={{ marginRight: 8 }} />
                        <Text style={[styles.configLabel, { color: TERMINAL.colors.cyan }]}>MIDJOURNEY PARAMETERS</Text>
                        <ChevronRight size={16} color={TERMINAL.colors.muted} style={{ marginLeft: 'auto', transform: [{ rotate: showMjSettings ? '90deg' : '0deg' }] }} />
                      </TouchableOpacity>
                      {showMjSettings && (
                        <View style={styles.disclosureBody}>
                          <View style={{ marginBottom: 16 }}>
                            <Text style={styles.configLabel}>STYLE REFERENCE CODE (--sref)</Text>
                            <View style={styles.inputWrapper}>
                              <TextInput
                                style={styles.input}
                                value={midjourneySettings.srefCode || ''}
                                onChangeText={(text) => handleMidjourneySettingsChange({ srefCode: text.trim() })}
                                placeholder="e.g. 14094475"
                                placeholderTextColor={TERMINAL.colors.muted}
                                autoCapitalize="none"
                              />
                            </View>
                            <Text style={styles.configHint}>Consistent art style across all generations.</Text>
                          </View>

                          <View style={{ marginBottom: 16 }}>
                            <Text style={styles.configLabel}>GENERATION SPEED</Text>
                            <View style={styles.segmentedControl}>
                              <TouchableOpacity style={[styles.segment, midjourneySettings.speed === 'fast' && styles.segmentActive]} onPress={() => handleMidjourneySettingsChange({ speed: 'fast' })}>
                                <Text style={[styles.segmentText, midjourneySettings.speed === 'fast' && styles.segmentTextActive]}>FAST</Text>
                              </TouchableOpacity>
                              <TouchableOpacity style={[styles.segment, midjourneySettings.speed === 'relaxed' && styles.segmentActive]} onPress={() => handleMidjourneySettingsChange({ speed: 'relaxed' })}>
                                <Text style={[styles.segmentText, midjourneySettings.speed === 'relaxed' && styles.segmentTextActive]}>RELAXED</Text>
                              </TouchableOpacity>
                            </View>
                            <Text style={styles.configHint}>Fast uses GPU hours. Relaxed is free but slower.</Text>
                          </View>

                          <View style={{ marginBottom: 16 }}>
                            <Text style={styles.configLabel}>REF SHEET STYLIZATION: {midjourneySettings.refSheetStylization ?? DEFAULT_MIDJOURNEY_SETTINGS.refSheetStylization}</Text>
                            <View style={styles.numericRangeRow}>
                              <Text style={styles.numericRangeLabel}>0</Text>
                              <View style={styles.numericRangeInputWrap}>
                                <TextInput
                                  style={[styles.input, styles.numericRangeInput]}
                                  value={String(midjourneySettings.refSheetStylization ?? DEFAULT_MIDJOURNEY_SETTINGS.refSheetStylization)}
                                  onChangeText={(text) => {
                                    const val = parseInt(text) || 0;
                                    handleMidjourneySettingsChange({ refSheetStylization: Math.max(0, Math.min(1000, val)) });
                                  }}
                                  keyboardType="numeric"
                                />
                              </View>
                              <Text style={[styles.numericRangeLabel, styles.numericRangeLabelMax]}>1000</Text>
                            </View>
                          </View>

                          <View style={{ marginBottom: 16 }}>
                            <Text style={styles.configLabel}>SCENE STYLIZATION: {midjourneySettings.sceneStylization ?? DEFAULT_MIDJOURNEY_SETTINGS.sceneStylization}</Text>
                            <View style={styles.numericRangeRow}>
                              <Text style={styles.numericRangeLabel}>0</Text>
                              <View style={styles.numericRangeInputWrap}>
                                <TextInput
                                  style={[styles.input, styles.numericRangeInput]}
                                  value={String(midjourneySettings.sceneStylization ?? DEFAULT_MIDJOURNEY_SETTINGS.sceneStylization)}
                                  onChangeText={(text) => {
                                    const val = parseInt(text) || 0;
                                    handleMidjourneySettingsChange({ sceneStylization: Math.max(0, Math.min(1000, val)) });
                                  }}
                                  keyboardType="numeric"
                                />
                              </View>
                              <Text style={[styles.numericRangeLabel, styles.numericRangeLabelMax]}>1000</Text>
                            </View>
                          </View>

                          <View style={{ marginBottom: 16 }}>
                            <Text style={styles.configLabel}>REF SHEET OMNI WEIGHT (--ow): {midjourneySettings.refSheetOmniWeight ?? DEFAULT_MIDJOURNEY_SETTINGS.refSheetOmniWeight}</Text>
                            <View style={styles.numericRangeRow}>
                              <Text style={styles.numericRangeLabel}>0</Text>
                              <View style={styles.numericRangeInputWrap}>
                                <TextInput
                                  style={[styles.input, styles.numericRangeInput]}
                                  value={String(midjourneySettings.refSheetOmniWeight ?? DEFAULT_MIDJOURNEY_SETTINGS.refSheetOmniWeight)}
                                  onChangeText={(text) => {
                                    const val = parseInt(text) || 0;
                                    handleMidjourneySettingsChange({ refSheetOmniWeight: Math.max(0, Math.min(1000, val)) });
                                  }}
                                  keyboardType="numeric"
                                />
                              </View>
                              <Text style={[styles.numericRangeLabel, styles.numericRangeLabelMax]}>1000</Text>
                            </View>
                          </View>

                          <View style={{ marginBottom: 16 }}>
                            <Text style={styles.configLabel}>SCENE OMNI WEIGHT (--ow): {midjourneySettings.sceneOmniWeight ?? DEFAULT_MIDJOURNEY_SETTINGS.sceneOmniWeight}</Text>
                            <View style={styles.numericRangeRow}>
                              <Text style={styles.numericRangeLabel}>0</Text>
                              <View style={styles.numericRangeInputWrap}>
                                <TextInput
                                  style={[styles.input, styles.numericRangeInput]}
                                  value={String(midjourneySettings.sceneOmniWeight ?? DEFAULT_MIDJOURNEY_SETTINGS.sceneOmniWeight)}
                                  onChangeText={(text) => {
                                    const val = parseInt(text) || 0;
                                    handleMidjourneySettingsChange({ sceneOmniWeight: Math.max(0, Math.min(1000, val)) });
                                  }}
                                  keyboardType="numeric"
                                />
                              </View>
                              <Text style={[styles.numericRangeLabel, styles.numericRangeLabelMax]}>1000</Text>
                            </View>
                          </View>

                          <View style={{ marginBottom: 16 }}>
                            <Text style={styles.configLabel}>MAX REF IMAGES PER CHARACTER: {midjourneySettings.maxRefImagesPerCharacter ?? DEFAULT_MIDJOURNEY_SETTINGS.maxRefImagesPerCharacter}</Text>
                            <View style={styles.segmentedControl}>
                              {[1, 2, 3].map(n => (
                                <TouchableOpacity key={n} style={[styles.segment, (midjourneySettings.maxRefImagesPerCharacter ?? DEFAULT_MIDJOURNEY_SETTINGS.maxRefImagesPerCharacter) === n && styles.segmentActive]} onPress={() => handleMidjourneySettingsChange({ maxRefImagesPerCharacter: n })}>
                                  <Text style={[styles.segmentText, (midjourneySettings.maxRefImagesPerCharacter ?? DEFAULT_MIDJOURNEY_SETTINGS.maxRefImagesPerCharacter) === n && styles.segmentTextActive]}>{n}</Text>
                                </TouchableOpacity>
                              ))}
                            </View>
                          </View>

                          <View style={{ marginBottom: 8 }}>
                            <Text style={styles.configLabel}>MIDJOURNEY VERSION</Text>
                            <View style={styles.segmentedControl}>
                              {['6.1', '7'].map(v => (
                                <TouchableOpacity key={v} style={[styles.segment, (midjourneySettings.version ?? DEFAULT_MIDJOURNEY_SETTINGS.version) === v && styles.segmentActive]} onPress={() => handleMidjourneySettingsChange({ version: v })}>
                                  <Text style={[styles.segmentText, (midjourneySettings.version ?? DEFAULT_MIDJOURNEY_SETTINGS.version) === v && styles.segmentTextActive]}>V{v}</Text>
                                </TouchableOpacity>
                              ))}
                            </View>
                          </View>

                          <TouchableOpacity style={styles.inlineResetButton} onPress={() => handleMidjourneySettingsChange({ ...DEFAULT_MIDJOURNEY_SETTINGS })}>
                            <RefreshCw size={14} color={TERMINAL.colors.muted} style={{ marginRight: 6 }} />
                            <Text style={styles.inlineResetButtonText}>RESET TO DEFAULTS</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  </>
                )}

                {STABLE_DIFFUSION_UI_ENABLED && imageProvider === 'stable-diffusion' && (
                  <View style={styles.configItem}>
                    <TouchableOpacity
                      style={styles.inlineDisclosure}
                      onPress={() => setShowSdSettings(!showSdSettings)}
                    >
                      <Settings size={16} color={TERMINAL.colors.cyan} style={{ marginRight: 8 }} />
                      <Text style={[styles.configLabel, { color: TERMINAL.colors.cyan }]}>STABLE DIFFUSION PARAMETERS</Text>
                      <ChevronRight size={16} color={TERMINAL.colors.muted} style={{ marginLeft: 'auto', transform: [{ rotate: showSdSettings ? '90deg' : '0deg' }] }} />
                    </TouchableOpacity>
                    {showSdSettings && (
                      <View style={styles.disclosureBody}>
                        <View style={{ marginBottom: 16 }}>
                          <Text style={[styles.configLabel, { marginBottom: 8 }]}>BASE URL</Text>
                          <View style={styles.inputWrapper}>
                            <TextInput
                              style={styles.input}
                              value={stableDiffusionSettings.baseUrl || ''}
                              onChangeText={(v) => handleStableDiffusionSettingsChange({ baseUrl: v })}
                              placeholder="http://localhost:7860 or proxy /sd-api"
                              placeholderTextColor={TERMINAL.colors.muted}
                              autoCapitalize="none"
                            />
                          </View>
                          <Text style={styles.configHint}>Points at Automatic1111/Forge WebUI (or the proxy mount).</Text>
                        </View>

                        <View style={{ marginBottom: 16 }}>
                          <Text style={[styles.configLabel, { marginBottom: 8 }]}>SAMPLER</Text>
                          <View style={styles.inputWrapper}>
                            <TextInput
                              style={styles.input}
                              value={stableDiffusionSettings.defaultSampler || ''}
                              onChangeText={(v) => handleStableDiffusionSettingsChange({ defaultSampler: v })}
                              placeholder={DEFAULT_STABLE_DIFFUSION_SETTINGS.defaultSampler}
                              placeholderTextColor={TERMINAL.colors.muted}
                              autoCapitalize="none"
                            />
                          </View>
                        </View>

                        <View style={{ marginBottom: 16, flexDirection: 'row', gap: 12 }}>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.configLabel, { marginBottom: 8 }]}>STEPS</Text>
                            <View style={styles.inputWrapper}>
                              <TextInput
                                style={styles.input}
                                value={String(stableDiffusionSettings.defaultSteps ?? '')}
                                onChangeText={(v) => {
                                  const n = parseInt(v, 10);
                                  handleStableDiffusionSettingsChange({ defaultSteps: Number.isFinite(n) ? n : undefined });
                                }}
                                keyboardType="number-pad"
                                placeholder={String(DEFAULT_STABLE_DIFFUSION_SETTINGS.defaultSteps)}
                                placeholderTextColor={TERMINAL.colors.muted}
                              />
                            </View>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.configLabel, { marginBottom: 8 }]}>CFG</Text>
                            <View style={styles.inputWrapper}>
                              <TextInput
                                style={styles.input}
                                value={String(stableDiffusionSettings.defaultCfg ?? '')}
                                onChangeText={(v) => {
                                  const n = parseFloat(v);
                                  handleStableDiffusionSettingsChange({ defaultCfg: Number.isFinite(n) ? n : undefined });
                                }}
                                keyboardType="decimal-pad"
                                placeholder={String(DEFAULT_STABLE_DIFFUSION_SETTINGS.defaultCfg)}
                                placeholderTextColor={TERMINAL.colors.muted}
                              />
                            </View>
                          </View>
                        </View>

                        <View style={{ marginBottom: 16 }}>
                          <Text style={[styles.configLabel, { marginBottom: 8 }]}>NEGATIVE PROMPT</Text>
                          <View style={styles.inputWrapper}>
                            <TextInput
                              style={[styles.input, { height: 80 }]}
                              multiline
                              value={stableDiffusionSettings.defaultNegativePrompt || ''}
                              onChangeText={(v) => handleStableDiffusionSettingsChange({ defaultNegativePrompt: v })}
                              placeholder={DEFAULT_STABLE_DIFFUSION_SETTINGS.defaultNegativePrompt}
                              placeholderTextColor={TERMINAL.colors.muted}
                            />
                          </View>
                        </View>

                        <TouchableOpacity
                          style={styles.inlineResetButton}
                          onPress={() => handleStableDiffusionSettingsChange({ ...DEFAULT_STABLE_DIFFUSION_SETTINGS })}
                        >
                          <RefreshCw size={14} color={TERMINAL.colors.muted} style={{ marginRight: 6 }} />
                          <Text style={styles.inlineResetButtonText}>RESET TO DEFAULTS</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                )}

                {STABLE_DIFFUSION_UI_ENABLED && imageProvider === 'stable-diffusion' && (
                  <View style={styles.configItem}>
                    <TouchableOpacity
                      style={styles.inlineDisclosure}
                      onPress={() => setShowLoraSettings(!showLoraSettings)}
                    >
                      <Cpu size={16} color={TERMINAL.colors.cyan} style={{ marginRight: 8 }} />
                      <Text style={[styles.configLabel, { color: TERMINAL.colors.cyan }]}>LORA AUTO-TRAINING</Text>
                      <View style={{ marginLeft: 8 }}>
                        <Text style={[styles.configHint, { color: loraTrainingSettings.enabled ? TERMINAL.colors.success : TERMINAL.colors.muted }]}>
                          {loraTrainingSettings.enabled ? 'ON' : 'OFF'}
                        </Text>
                      </View>
                      <ChevronRight size={16} color={TERMINAL.colors.muted} style={{ marginLeft: 'auto', transform: [{ rotate: showLoraSettings ? '90deg' : '0deg' }] }} />
                    </TouchableOpacity>
                    {showLoraSettings && (
                      <View style={styles.disclosureBody}>
                        <Text style={styles.configHint}>
                          Automatically train per-character and per-episode style LoRAs against the configured
                          Stable Diffusion model. Training runs alongside scene generation and is cached by
                          fingerprint so unchanged inputs never re-train. Only active for the Stable Diffusion
                          provider; the pipeline silently skips this step on every other backend.
                        </Text>

                        <View style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <View style={{ flex: 1, paddingRight: 12 }}>
                            <Text style={styles.configLabel}>ENABLE AUTO-TRAIN</Text>
                            <Text style={styles.configHint}>
                              Master switch. When disabled, every training call no-ops regardless of backend.
                            </Text>
                          </View>
                          <Switch
                            value={!!loraTrainingSettings.enabled}
                            onValueChange={(value) => handleLoraTrainingSettingsChange({ enabled: value })}
                            trackColor={{ false: TERMINAL.colors.muted, true: TERMINAL.colors.cyan }}
                          />
                        </View>

                        <View style={{ marginTop: 16 }}>
                          <Text style={[styles.configLabel, { marginBottom: 8 }]}>TRAINER BACKEND</Text>
                          <View style={styles.segmentedControl}>
                            {(['disabled', 'kohya', 'diffusers', 'replicate'] as const).map((opt) => (
                              <TouchableOpacity
                                key={opt}
                                style={[styles.segment, loraTrainingSettings.backend === opt && styles.segmentActive]}
                                onPress={() => handleLoraTrainingSettingsChange({ backend: opt })}
                              >
                                <Text style={[styles.segmentText, loraTrainingSettings.backend === opt && styles.segmentTextActive]}>{opt.toUpperCase()}</Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                          <Text style={styles.configHint}>
                            Only "kohya" is implemented today. The proxy forwards jobs to
                            LORA_TRAINER_BASE_URL; leave empty to use whatever the proxy env provides.
                          </Text>
                        </View>

                        <View style={{ marginTop: 16 }}>
                          <Text style={[styles.configLabel, { marginBottom: 8 }]}>TRAINER BASE URL (OPTIONAL)</Text>
                          <View style={styles.inputWrapper}>
                            <TextInput
                              style={styles.input}
                              value={loraTrainingSettings.baseUrl || ''}
                              onChangeText={(v) => handleLoraTrainingSettingsChange({ baseUrl: v })}
                              placeholder="http://localhost:7861 (overrides LORA_TRAINER_BASE_URL)"
                              placeholderTextColor={TERMINAL.colors.muted}
                              autoCapitalize="none"
                            />
                          </View>
                        </View>

                        <View style={{ marginTop: 20 }}>
                          <Text style={[styles.configLabel, { marginBottom: 8 }]}>CHARACTER ELIGIBILITY</Text>
                          <View style={{ flexDirection: 'row', gap: 12 }}>
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.configLabel, { marginBottom: 8 }]}>MIN REFS</Text>
                              <View style={styles.inputWrapper}>
                                <TextInput
                                  style={styles.input}
                                  value={String(loraTrainingSettings.characterThresholds.minRefs ?? '')}
                                  onChangeText={(v) => {
                                    const n = parseInt(v, 10);
                                    handleLoraTrainingSettingsChange({
                                      characterThresholds: { minRefs: Number.isFinite(n) ? n : DEFAULT_LORA_TRAINING_SETTINGS.characterThresholds.minRefs },
                                    });
                                  }}
                                  keyboardType="number-pad"
                                  placeholder={String(DEFAULT_LORA_TRAINING_SETTINGS.characterThresholds.minRefs)}
                                  placeholderTextColor={TERMINAL.colors.muted}
                                />
                              </View>
                            </View>
                          </View>
                          <Text style={styles.configHint}>
                            Characters need at least this many distinct reference images before they become
                            training candidates. Tiers: {loraTrainingSettings.characterThresholds.tiers.join(', ')}.
                          </Text>
                          <View style={{ marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                            {(['core', 'major', 'supporting', 'minor'] as const).map((tier) => {
                              const active = loraTrainingSettings.characterThresholds.tiers.includes(tier);
                              return (
                                <TouchableOpacity
                                  key={tier}
                                  style={[styles.segment, active && styles.segmentActive, { paddingHorizontal: 12 }]}
                                  onPress={() => {
                                    const current = new Set(loraTrainingSettings.characterThresholds.tiers);
                                    if (active) current.delete(tier); else current.add(tier);
                                    handleLoraTrainingSettingsChange({
                                      characterThresholds: { tiers: Array.from(current) as typeof loraTrainingSettings.characterThresholds.tiers },
                                    });
                                  }}
                                >
                                  <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{tier.toUpperCase()}</Text>
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                          <View style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center' }}>
                            <Switch
                              value={!!loraTrainingSettings.characterThresholds.blockScenes}
                              onValueChange={(value) => handleLoraTrainingSettingsChange({ characterThresholds: { blockScenes: value } })}
                              trackColor={{ false: TERMINAL.colors.muted, true: TERMINAL.colors.cyan }}
                            />
                            <Text style={[styles.configLabel, { marginLeft: 8 }]}>BLOCK SCENES UNTIL TRAINED</Text>
                          </View>
                          <Text style={styles.configHint}>
                            When enabled, episode scene generation waits for character LoRA jobs to finish so
                            they can be applied from beat #1. Disable for a faster-but-less-consistent pass.
                          </Text>
                        </View>

                        <View style={{ marginTop: 20 }}>
                          <Text style={[styles.configLabel, { marginBottom: 8 }]}>STYLE ELIGIBILITY</Text>
                          <View style={{ flexDirection: 'row', gap: 12 }}>
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.configLabel, { marginBottom: 8 }]}>MIN EPISODES</Text>
                              <View style={styles.inputWrapper}>
                                <TextInput
                                  style={styles.input}
                                  value={String(loraTrainingSettings.styleThresholds.minEpisodes ?? '')}
                                  onChangeText={(v) => {
                                    const n = parseInt(v, 10);
                                    handleLoraTrainingSettingsChange({
                                      styleThresholds: { minEpisodes: Number.isFinite(n) ? n : DEFAULT_LORA_TRAINING_SETTINGS.styleThresholds.minEpisodes },
                                    });
                                  }}
                                  keyboardType="number-pad"
                                  placeholder={String(DEFAULT_LORA_TRAINING_SETTINGS.styleThresholds.minEpisodes)}
                                  placeholderTextColor={TERMINAL.colors.muted}
                                />
                              </View>
                            </View>
                          </View>
                          <View style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center' }}>
                            <Switch
                              value={!!loraTrainingSettings.styleThresholds.forceStyle}
                              onValueChange={(value) => handleLoraTrainingSettingsChange({ styleThresholds: { forceStyle: value } })}
                              trackColor={{ false: TERMINAL.colors.muted, true: TERMINAL.colors.cyan }}
                            />
                            <Text style={[styles.configLabel, { marginLeft: 8 }]}>FORCE STYLE LORA</Text>
                          </View>
                          <Text style={styles.configHint}>
                            Force a style LoRA even if the series is shorter than MIN EPISODES. Useful when a
                            single episode has a very specific, unique style bible.
                          </Text>
                        </View>

                        <View style={{ marginTop: 20 }}>
                          <Text style={[styles.configLabel, { marginBottom: 8 }]}>HYPERPARAMETERS</Text>
                          <View style={{ flexDirection: 'row', gap: 12 }}>
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.configLabel, { marginBottom: 8 }]}>STEPS</Text>
                              <View style={styles.inputWrapper}>
                                <TextInput
                                  style={styles.input}
                                  value={String(loraTrainingSettings.training.steps ?? '')}
                                  onChangeText={(v) => {
                                    const n = parseInt(v, 10);
                                    handleLoraTrainingSettingsChange({ training: { steps: Number.isFinite(n) ? n : undefined } });
                                  }}
                                  keyboardType="number-pad"
                                  placeholder={String(DEFAULT_LORA_TRAINING_SETTINGS.training.steps)}
                                  placeholderTextColor={TERMINAL.colors.muted}
                                />
                              </View>
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.configLabel, { marginBottom: 8 }]}>RANK</Text>
                              <View style={styles.inputWrapper}>
                                <TextInput
                                  style={styles.input}
                                  value={String(loraTrainingSettings.training.rank ?? '')}
                                  onChangeText={(v) => {
                                    const n = parseInt(v, 10);
                                    handleLoraTrainingSettingsChange({ training: { rank: Number.isFinite(n) ? n : undefined } });
                                  }}
                                  keyboardType="number-pad"
                                  placeholder={String(DEFAULT_LORA_TRAINING_SETTINGS.training.rank)}
                                  placeholderTextColor={TERMINAL.colors.muted}
                                />
                              </View>
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.configLabel, { marginBottom: 8 }]}>LR</Text>
                              <View style={styles.inputWrapper}>
                                <TextInput
                                  style={styles.input}
                                  value={String(loraTrainingSettings.training.learningRate ?? '')}
                                  onChangeText={(v) => {
                                    const n = parseFloat(v);
                                    handleLoraTrainingSettingsChange({ training: { learningRate: Number.isFinite(n) ? n : undefined } });
                                  }}
                                  keyboardType="decimal-pad"
                                  placeholder={String(DEFAULT_LORA_TRAINING_SETTINGS.training.learningRate)}
                                  placeholderTextColor={TERMINAL.colors.muted}
                                />
                              </View>
                            </View>
                          </View>
                          <View style={{ marginTop: 12, flexDirection: 'row', gap: 12 }}>
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.configLabel, { marginBottom: 8 }]}>RESOLUTION</Text>
                              <View style={styles.inputWrapper}>
                                <TextInput
                                  style={styles.input}
                                  value={String(loraTrainingSettings.training.resolution ?? '')}
                                  onChangeText={(v) => {
                                    const n = parseInt(v, 10);
                                    handleLoraTrainingSettingsChange({ training: { resolution: Number.isFinite(n) ? n : undefined } });
                                  }}
                                  keyboardType="number-pad"
                                  placeholder={String(DEFAULT_LORA_TRAINING_SETTINGS.training.resolution)}
                                  placeholderTextColor={TERMINAL.colors.muted}
                                />
                              </View>
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.configLabel, { marginBottom: 8 }]}>BATCH SIZE</Text>
                              <View style={styles.inputWrapper}>
                                <TextInput
                                  style={styles.input}
                                  value={String(loraTrainingSettings.training.batchSize ?? '')}
                                  onChangeText={(v) => {
                                    const n = parseInt(v, 10);
                                    handleLoraTrainingSettingsChange({ training: { batchSize: Number.isFinite(n) ? n : undefined } });
                                  }}
                                  keyboardType="number-pad"
                                  placeholder={String(DEFAULT_LORA_TRAINING_SETTINGS.training.batchSize)}
                                  placeholderTextColor={TERMINAL.colors.muted}
                                />
                              </View>
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.configLabel, { marginBottom: 8 }]}>REPEATS</Text>
                              <View style={styles.inputWrapper}>
                                <TextInput
                                  style={styles.input}
                                  value={String(loraTrainingSettings.training.repeats ?? '')}
                                  onChangeText={(v) => {
                                    const n = parseInt(v, 10);
                                    handleLoraTrainingSettingsChange({ training: { repeats: Number.isFinite(n) ? n : undefined } });
                                  }}
                                  keyboardType="number-pad"
                                  placeholder={String(DEFAULT_LORA_TRAINING_SETTINGS.training.repeats)}
                                  placeholderTextColor={TERMINAL.colors.muted}
                                />
                              </View>
                            </View>
                          </View>
                          <View style={{ marginTop: 12 }}>
                            <Text style={[styles.configLabel, { marginBottom: 8 }]}>BASE MODEL (OPTIONAL)</Text>
                            <View style={styles.inputWrapper}>
                              <TextInput
                                style={styles.input}
                                value={loraTrainingSettings.training.baseModel || ''}
                                onChangeText={(v) => handleLoraTrainingSettingsChange({ training: { baseModel: v } })}
                                placeholder="Checkpoint the LoRA is fine-tuned on (defaults to SD default model)"
                                placeholderTextColor={TERMINAL.colors.muted}
                                autoCapitalize="none"
                              />
                            </View>
                          </View>
                        </View>

                        <TouchableOpacity
                          style={[styles.inlineResetButton, { marginTop: 20 }]}
                          onPress={() => handleLoraTrainingSettingsChange({ ...DEFAULT_LORA_TRAINING_SETTINGS })}
                        >
                          <RefreshCw size={14} color={TERMINAL.colors.muted} style={{ marginRight: 6 }} />
                          <Text style={styles.inlineResetButtonText}>RESET TO DEFAULTS</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                )}

              </ConfigBucketCard>
              ) : null}

              {setupView === 'video' ? renderMediaTargetCard('video') : null}
              {setupView === 'video' ? (
              <ConfigBucketCard
                title="VIDEO"
                description="Optional experimental beat animation using a direction LLM plus Veo rendering."
                icon={<Film size={16} color={videoSettings.enabled ? TERMINAL.colors.cyan : TERMINAL.colors.muted} />}
                expanded={showVideoPanel}
                onToggleExpanded={() => setShowVideoPanel(!showVideoPanel)}
                summaryLines={videoSummaryLines}
                enabled={videoSettings.enabled}
                onToggleEnabled={(value) => updateVideoSetting('enabled', value)}
              >
                <View style={styles.configItem}>
                  <Text style={styles.configGroupIntro}>ANIMATE STILL IMAGES INTO VIDEO CLIPS VIA GOOGLE VEO</Text>
                  <View style={{ paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' }}>
                    <Text style={styles.configLabel}>VIDEO DIRECTION LLM</Text>
                    <Text style={styles.configHint}>Controls the model that turns each beat into a motion prompt before Veo renders it.</Text>
                    <View style={styles.segmentedControl}>
                      <TouchableOpacity style={[styles.segment, videoLlmProvider === 'anthropic' && styles.segmentActive]} onPress={() => handleVideoLlmProviderChange('anthropic')}>
                        <Text style={[styles.segmentText, videoLlmProvider === 'anthropic' && styles.segmentTextActive]}>ANTHROPIC</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.segment, videoLlmProvider === 'openai' && styles.segmentActive]} onPress={() => handleVideoLlmProviderChange('openai')}>
                        <Text style={[styles.segmentText, videoLlmProvider === 'openai' && styles.segmentTextActive]}>OPENAI</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.segment, videoLlmProvider === 'gemini' && styles.segmentActive]} onPress={() => handleVideoLlmProviderChange('gemini')}>
                        <Text style={[styles.segmentText, videoLlmProvider === 'gemini' && styles.segmentTextActive]}>GEMINI</Text>
                      </TouchableOpacity>
                    </View>
                    <ModelDropdown
                      options={availableModels[videoLlmProvider].map(o => ({ value: o.value, label: o.label, subtitle: o.value }))}
                      value={videoLlmModel}
                      onSelect={handleVideoLlmModelChange}
                      placeholder="Select model…"
                    />
                  </View>
                  {!generationSettings.generateImages && videoSettings.enabled && (
                    <View style={styles.warningCallout}>
                      <Text style={styles.warningCalloutText}>Warning: video requires image generation. Enable images or video will be skipped.</Text>
                    </View>
                  )}
                  <View style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' }}>
                    <Text style={styles.configLabel}>MODEL</Text>
                    <View style={styles.segmentedControl}>
                      <TouchableOpacity style={[styles.segment, videoSettings.model === 'veo-3.1-generate-preview' && styles.segmentActive]} onPress={() => updateVideoSetting('model', 'veo-3.1-generate-preview')}>
                        <Text style={[styles.segmentText, videoSettings.model === 'veo-3.1-generate-preview' && styles.segmentTextActive]}>VEO 3.1</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.segment, videoSettings.model === 'veo-3.1-fast-generate-preview' && styles.segmentActive]} onPress={() => updateVideoSetting('model', 'veo-3.1-fast-generate-preview')}>
                        <Text style={[styles.segmentText, videoSettings.model === 'veo-3.1-fast-generate-preview' && styles.segmentTextActive]}>VEO 3.1 FAST</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <View style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' }}>
                    <Text style={styles.configLabel}>CLIP DURATION</Text>
                    <View style={styles.segmentedControl}>
                      <TouchableOpacity style={[styles.segment, videoSettings.durationSeconds === 6 && styles.segmentActive]} onPress={() => updateVideoSetting('durationSeconds', 6)}>
                        <Text style={[styles.segmentText, videoSettings.durationSeconds === 6 && styles.segmentTextActive]}>6 SEC</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.segment, videoSettings.durationSeconds === 8 && styles.segmentActive]} onPress={() => updateVideoSetting('durationSeconds', 8)}>
                        <Text style={[styles.segmentText, videoSettings.durationSeconds === 8 && styles.segmentTextActive]}>8 SEC</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <View style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' }}>
                    <Text style={styles.configLabel}>RESOLUTION</Text>
                    <View style={styles.segmentedControl}>
                      <TouchableOpacity style={[styles.segment, videoSettings.resolution === '720p' && styles.segmentActive]} onPress={() => updateVideoSetting('resolution', '720p')}>
                        <Text style={[styles.segmentText, videoSettings.resolution === '720p' && styles.segmentTextActive]}>720P</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.segment, videoSettings.resolution === '1080p' && styles.segmentActive]} onPress={() => updateVideoSetting('resolution', '1080p')}>
                        <Text style={[styles.segmentText, videoSettings.resolution === '1080p' && styles.segmentTextActive]}>1080P</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <View style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' }}>
                    <Text style={styles.configLabel}>ASPECT RATIO</Text>
                    <View style={styles.segmentedControl}>
                      <TouchableOpacity style={[styles.segment, videoSettings.aspectRatio === '9:16' && styles.segmentActive]} onPress={() => updateVideoSetting('aspectRatio', '9:16')}>
                        <Text style={[styles.segmentText, videoSettings.aspectRatio === '9:16' && styles.segmentTextActive]}>9:16 PORTRAIT</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.segment, videoSettings.aspectRatio === '16:9' && styles.segmentActive]} onPress={() => updateVideoSetting('aspectRatio', '16:9')}>
                        <Text style={[styles.segmentText, videoSettings.aspectRatio === '16:9' && styles.segmentTextActive]}>16:9 LANDSCAPE</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <View style={{ paddingVertical: 12 }}>
                    <Text style={styles.configLabel}>ANIMATION STRATEGY</Text>
                    <View style={styles.segmentedControl}>
                      <TouchableOpacity style={[styles.segment, videoSettings.strategy === 'selective' && styles.segmentActive]} onPress={() => updateVideoSetting('strategy', 'selective')}>
                        <Text style={[styles.segmentText, videoSettings.strategy === 'selective' && styles.segmentTextActive]}>SELECTIVE</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.segment, videoSettings.strategy === 'all-beats' && styles.segmentActive]} onPress={() => updateVideoSetting('strategy', 'all-beats')}>
                        <Text style={[styles.segmentText, videoSettings.strategy === 'all-beats' && styles.segmentTextActive]}>ALL BEATS</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              </ConfigBucketCard>
              ) : null}

              {setupView === 'story' ? (
              <ConfigBucketCard
                title="NARRATION"
                description="Optional experimental voice playback settings for generated stories."
                icon={<Volume2 size={16} color={narrationSettings.enabled ? TERMINAL.colors.cyan : TERMINAL.colors.muted} />}
                expanded={showNarrationPanel}
                onToggleExpanded={() => setShowNarrationPanel(!showNarrationPanel)}
                summaryLines={narrationSummaryLines}
                enabled={narrationSettings.enabled}
                onToggleEnabled={(value) => updateNarrationSetting('enabled', value)}
              >
                <View style={styles.configItem}>
                  <Text style={styles.configGroupIntro}>AI VOICE NARRATION</Text>
                  <View style={{ paddingVertical: 12 }}>
                    <Text style={styles.configLabel}>VOICE PROVIDER</Text>
                    <Text style={styles.configHint}>Gemini reuses the same Gemini key as story/image generation.</Text>
                    <View style={styles.segmentedControl}>
                      <TouchableOpacity style={[styles.segment, (narrationSettings.provider || 'elevenlabs') === 'elevenlabs' && styles.segmentActive]} onPress={() => updateNarrationSetting('provider', 'elevenlabs')}>
                        <Text style={[styles.segmentText, (narrationSettings.provider || 'elevenlabs') === 'elevenlabs' && styles.segmentTextActive]}>ELEVENLABS</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.segment, narrationSettings.provider === 'gemini' && styles.segmentActive]} onPress={() => updateNarrationSetting('provider', 'gemini')}>
                        <Text style={[styles.segmentText, narrationSettings.provider === 'gemini' && styles.segmentTextActive]}>GEMINI</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  {(narrationSettings.provider || 'elevenlabs') === 'elevenlabs' && !elevenLabsApiKey.trim() && (
                    <View style={styles.warningCallout}>
                      <Text style={styles.warningCalloutText}>Add an ElevenLabs key in the Story panel to generate narration.</Text>
                    </View>
                  )}
                  {narrationSettings.provider === 'gemini' && !geminiApiKey.trim() && (
                    <View style={styles.warningCallout}>
                      <Text style={styles.warningCalloutText}>Add a Gemini key in the Story panel to generate Gemini narration.</Text>
                    </View>
                  )}
                  <TouchableOpacity style={styles.toggleActionRow} onPress={() => updateNarrationSetting('preGenerateAudio', !narrationSettings.preGenerateAudio)}>
                    <View><Text style={styles.configLabel}>PRE-GENERATE AUDIO</Text><Text style={styles.toggleActionHint}>Generate narration during story creation.</Text></View>
                    <View style={[styles.booleanToggle, narrationSettings.preGenerateAudio && styles.booleanToggleActive]}><View style={[styles.booleanToggleKnob, narrationSettings.preGenerateAudio && styles.booleanToggleKnobActive]} /></View>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.toggleActionRow} onPress={() => updateNarrationSetting('voiceCastingEnabled', narrationSettings.voiceCastingEnabled === false)}>
                    <View><Text style={styles.configLabel}>AUTO VOICE CASTING</Text><Text style={styles.toggleActionHint}>Match narrator and character voices to cast personality.</Text></View>
                    <View style={[styles.booleanToggle, narrationSettings.voiceCastingEnabled !== false && styles.booleanToggleActive]}><View style={[styles.booleanToggleKnob, narrationSettings.voiceCastingEnabled !== false && styles.booleanToggleKnobActive]} /></View>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.toggleActionRow} onPress={() => updateNarrationSetting('performanceTagsEnabled', !narrationSettings.performanceTagsEnabled)}>
                    <View><Text style={styles.configLabel}>PERFORMANCE TAGS</Text><Text style={styles.toggleActionHint}>Add internal dramatic delivery tags to TTS prompts only.</Text></View>
                    <View style={[styles.booleanToggle, narrationSettings.performanceTagsEnabled && styles.booleanToggleActive]}><View style={[styles.booleanToggleKnob, narrationSettings.performanceTagsEnabled && styles.booleanToggleKnobActive]} /></View>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.toggleActionRow} onPress={() => updateNarrationSetting('autoPlay', !narrationSettings.autoPlay)}>
                    <View><Text style={styles.configLabel}>AUTO-PLAY</Text><Text style={styles.toggleActionHint}>Play narration automatically on each beat.</Text></View>
                    <View style={[styles.booleanToggle, narrationSettings.autoPlay && styles.booleanToggleActive]}><View style={[styles.booleanToggleKnob, narrationSettings.autoPlay && styles.booleanToggleKnobActive]} /></View>
                  </TouchableOpacity>
                  <View style={{ paddingVertical: 12 }}>
                    <Text style={styles.configLabel}>HIGHLIGHT MODE</Text>
                    <Text style={styles.configHint}>How text is highlighted during narration.</Text>
                    <View style={styles.segmentedControl}>
                      <TouchableOpacity style={[styles.segment, narrationSettings.highlightMode === 'none' && styles.segmentActive]} onPress={() => updateNarrationSetting('highlightMode', 'none')}>
                        <Text style={[styles.segmentText, narrationSettings.highlightMode === 'none' && styles.segmentTextActive]}>NONE</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.segment, narrationSettings.highlightMode === 'word' && styles.segmentActive]} onPress={() => updateNarrationSetting('highlightMode', 'word')}>
                        <Text style={[styles.segmentText, narrationSettings.highlightMode === 'word' && styles.segmentTextActive]}>WORD</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.segment, narrationSettings.highlightMode === 'sentence' && styles.segmentActive]} onPress={() => updateNarrationSetting('highlightMode', 'sentence')}>
                        <Text style={[styles.segmentText, narrationSettings.highlightMode === 'sentence' && styles.segmentTextActive]}>SENTENCE</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              </ConfigBucketCard>
              ) : null}

              {setupView === 'image' ? (
                <SetupStepCard
                  step="3"
                  title="GENERATE IMAGES"
                  description="Run a media-only image job for the selected episode."
                >
                  <View style={styles.configActions}>
                    {mediaSetupTarget ? (
                      <TouchableOpacity style={styles.executeButton} onPress={runTargetImageGeneration}>
                        <ImageIcon size={18} color="white" />
                        <Text style={styles.executeButtonText}>GENERATE IMAGES FOR EPISODE</Text>
                      </TouchableOpacity>
                    ) : (
                      <View style={[styles.executeButton, { opacity: 0.5 }]}>
                        <Text style={styles.executeButtonText}>SELECT EPISODE TO CONTINUE</Text>
                      </View>
                    )}
                    <TouchableOpacity style={styles.textButton} onPress={onBack}>
                      <Text style={styles.textButtonText}>CANCEL</Text>
                    </TouchableOpacity>
                  </View>
                </SetupStepCard>
              ) : null}

              {setupView === 'video' ? (
                <SetupStepCard
                  step="3"
                  title="GENERATE VIDEO"
                  description="Run a media-only animation job for the selected episode."
                >
                  <View style={styles.configActions}>
                    {mediaSetupTarget ? (
                      <TouchableOpacity style={styles.executeButton} onPress={runTargetVideoGeneration}>
                        <Film size={18} color="white" />
                        <Text style={styles.executeButtonText}>GENERATE VIDEO FOR EPISODE</Text>
                      </TouchableOpacity>
                    ) : (
                      <View style={[styles.executeButton, { opacity: 0.5 }]}>
                        <Text style={styles.executeButtonText}>SELECT EPISODE TO CONTINUE</Text>
                      </View>
                    )}
                    <TouchableOpacity style={styles.textButton} onPress={onBack}>
                      <Text style={styles.textButtonText}>CANCEL</Text>
                    </TouchableOpacity>
                  </View>
                </SetupStepCard>
              ) : null}

              {setupView === 'story' ? (
              <SetupStepCard
                step="5"
                title="ANALYZE AND CONTINUE"
                description="Review your setup, then analyze the source so episode planning and generation can proceed."
              >
                <View style={styles.setupChecklist}>
                  <View style={styles.setupChecklistItem}>
                    <Text style={styles.setupChecklistLabel}>SOURCE</Text>
                    <Text style={[styles.setupChecklistValue, hasSourceInput ? styles.setupChecklistValueReady : null]}>
                      {hasSourceInput ? 'READY' : 'MISSING'}
                    </Text>
                  </View>
                  <View style={styles.setupChecklistItem}>
                    <Text style={styles.setupChecklistLabel}>TEXT MODEL</Text>
                    <Text style={styles.setupChecklistValue}>{llmProvider.toUpperCase()}</Text>
                  </View>
	                  <View style={styles.setupChecklistItem}>
	                    <Text style={styles.setupChecklistLabel}>VISUALS</Text>
	                    <Text style={styles.setupChecklistValue}>{runGenerateImages ? imageProvider.toUpperCase() : 'OFF'}</Text>
	                  </View>
	                  <View style={styles.setupChecklistItem}>
	                    <Text style={styles.setupChecklistLabel}>OUTPUT</Text>
	                    <Text style={styles.setupChecklistValue}>
	                      {runGenerateVideo ? 'VIDEO' : narrationSettings.enabled ? 'AUDIO' : 'TEXT'}
	                    </Text>
	                  </View>
                </View>

                <View style={styles.configActions}>
                  {!hasSourceInput ? (
                    <View style={[styles.executeButton, { opacity: 0.5 }]}>
                      <Text style={styles.executeButtonText}>LOAD SOURCE TO CONTINUE</Text>
                    </View>
                  ) : (
                    <TouchableOpacity style={styles.executeButton} onPress={startAnalysis}>
                      <Search size={18} color="white" />
                      <Text style={styles.executeButtonText}>ANALYZE SOURCE MATERIAL</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={styles.textButton} onPress={onBack}>
                    <Text style={styles.textButtonText}>CANCEL</Text>
                  </TouchableOpacity>
                </View>
              </SetupStepCard>
              ) : null}
            </View>
          </View>
        )}
        {state === 'analyzing' && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}><Search size={18} color={TERMINAL.colors.amber} /><Text style={[styles.sectionTitle, { color: TERMINAL.colors.amber }]}>SOURCE ANALYSIS IN PROGRESS</Text></View>
            <View style={styles.progressPlaceholder}><PipelineProgress events={events} currentPhase="source_analysis" isRunning={true} progress={liveProgress} etaSeconds={etaSeconds} runtime={pipelineRuntime} storyTitle={pipelineRuntime?.friendlyName || customStoryTitle || undefined} /></View>
          </View>
        )}
        {state === 'analysis_complete' && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}><CheckCircle2 size={18} color={TERMINAL.colors.cyan} /><Text style={[styles.sectionTitle, { color: TERMINAL.colors.cyan }]}>ANALYSIS COMPLETE</Text></View>
            {!analysisResult ? <View style={styles.errorCard}><Text style={styles.errorText}>ANALYSIS FAILED. PLEASE RETRY.</Text><TouchableOpacity style={styles.executeButton} onPress={startAnalysis}><Text style={styles.executeButtonText}>RETRY ANALYSIS</Text></TouchableOpacity></View> : (
              <View style={styles.analysisGroup}>
	                {sourceAnalysis?.sourceCanon ? (
	                  <CanonWizard
	                    canon={sourceAnalysis.sourceCanon}
	                    wizardState={canonWizardState}
	                    seasonPlan={seasonPlan}
	                    selectedEpisodes={selectedEpisodes}
	                    recommendations={episodeRecommendations}
	                    warnings={selectionWarnings}
	                    onCanonChange={(nextCanon, nextWizardState) => {
	                      void syncCanonReviewState(nextCanon, nextWizardState);
	                    }}
	                    onStepApproved={(nextCanon, nextWizardState) => {
	                      void syncCanonReviewState(nextCanon, nextWizardState, { persist: true });
	                    }}
	                    onEpisodeSelectionChange={handleCanonEpisodeSelectionChange}
	                    onRequestRepairSuggestion={requestCanonRepairSuggestion}
	                  />
	                ) : isCreatingSeasonPlan ? (
	                  <View style={styles.loadingContainer}>
	                    <ActivityIndicator size="small" color={TERMINAL.colors.cyan} />
	                    <Text style={styles.loadingText}>Creating season plan...</Text>
	                  </View>
	                ) : (
	                  <View style={styles.errorCard}>
	                    <Text style={styles.errorText}>LOCKED SOURCE CANON WAS NOT CREATED. RE-RUN ANALYSIS.</Text>
	                    <TouchableOpacity style={styles.executeButton} onPress={startAnalysis}>
	                      <Text style={styles.executeButtonText}>RETRY ANALYSIS</Text>
	                    </TouchableOpacity>
	                  </View>
	                )}
                {analysisCharacters.length > 0 && (
                  <View style={styles.analysisCard}>
                    <View style={styles.analysisCardHeader}>
                      <Users size={14} color={TERMINAL.colors.primary} />
                      <Text style={styles.analysisCardTitle}>CHARACTER REFERENCES FOR SELECTED RUN</Text>
                    </View>
                    <Text style={styles.characterReferenceIntro}>
                      Add reference photos or concept art here before choosing episodes. The generator will turn these into stylized canonical character sheets and use them throughout the selected episode run.
                    </Text>
                    <View style={styles.characterReferenceList}>
                      {analysisCharacters.map((character) => {
                        const uploads = characterReferenceUploads[character.id] || [];
                        const selectedMode = characterReferenceModes[character.id] || 'face-only';
                        return (
                          <View
                            key={character.id}
                            style={[
                              styles.characterReferenceCard,
                              character.isProtagonist && styles.characterReferenceCardPrimary,
                            ]}
                          >
                            <View style={styles.characterReferenceHeader}>
                              <View style={styles.characterReferenceIdentity}>
                                <Text style={styles.characterReferenceName}>{character.name.toUpperCase()}</Text>
                                <Text style={styles.characterReferenceRole}>
                                  {character.isProtagonist ? 'PROTAGONIST' : character.role.toUpperCase()}
                                </Text>
                              </View>
                              <TouchableOpacity
                                style={styles.referenceUploadButton}
                                onPress={() => pickCharacterReference(character)}
                              >
                                <ImageIcon size={14} color={TERMINAL.colors.primary} />
                                <Text style={styles.referenceUploadButtonText}>
                                  {uploads.length > 0 ? 'ADD REFERENCE' : 'UPLOAD REFERENCE'}
                                </Text>
                              </TouchableOpacity>
                            </View>

                            <Text style={styles.characterReferenceDescription} numberOfLines={3}>
                              {character.description || 'No analyzer description available yet.'}
                            </Text>

                            <View style={styles.referenceModeSection}>
                              <Text style={styles.referenceModeLabel}>REFERENCE MODE</Text>
                              <View style={styles.referenceModeControl}>
                                <TouchableOpacity
                                  style={[styles.referenceModeOption, selectedMode === 'face-only' && styles.referenceModeOptionActive]}
                                  onPress={() => updateCharacterReferenceMode(character.id, 'face-only')}
                                >
                                  <Text style={[styles.referenceModeOptionText, selectedMode === 'face-only' && styles.referenceModeOptionTextActive]}>
                                    FACE ONLY
                                  </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                  style={[styles.referenceModeOption, selectedMode === 'full-appearance' && styles.referenceModeOptionActive]}
                                  onPress={() => updateCharacterReferenceMode(character.id, 'full-appearance')}
                                >
                                  <Text style={[styles.referenceModeOptionText, selectedMode === 'full-appearance' && styles.referenceModeOptionTextActive]}>
                                    FULL LOOK
                                  </Text>
                                </TouchableOpacity>
                              </View>
                              <Text style={styles.referenceModeHint}>
                                {selectedMode === 'full-appearance'
                                  ? 'Use face, body, and outfit details from the upload when building the canonical sheet.'
                                  : 'Use the upload for face and physical identity while keeping wardrobe from story context.'}
                              </Text>
                            </View>

                            {uploads.length > 0 ? (
                              <View style={styles.referencePreviewGrid}>
                                {uploads.map((upload) => (
                                  <View key={upload.id} style={styles.referencePreviewCard}>
                                    <Image source={{ uri: upload.uri }} style={styles.referencePreviewImage} />
                                    <TouchableOpacity
                                      style={styles.referencePreviewRemove}
                                      onPress={() => removeCharacterReference(character.id, upload.id)}
                                    >
                                      <Trash2 size={12} color="white" />
                                    </TouchableOpacity>
                                    <Text style={styles.referencePreviewName} numberOfLines={1}>
                                      {upload.name}
                                    </Text>
                                  </View>
                                ))}
                              </View>
                            ) : (
                              <Text style={styles.characterReferenceEmpty}>
                                No uploaded reference yet. The pipeline will still generate a sheet from text-only analysis if you leave this blank.
                              </Text>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  </View>
                )}
                {activeEndings.length > 0 && (
                  <View style={styles.analysisCard}>
                    <View style={styles.analysisCardHeader}>
                      <Sparkles size={14} color={TERMINAL.colors.amber} />
                      <Text style={styles.analysisCardTitle}>
                        {activeEndingMode === 'multiple' ? 'ALTERNATE ENDINGS' : 'PRIMARY ENDING'}
                      </Text>
                    </View>
                    <Text style={styles.characterReferenceIntro}>
                      {activeEndingMode === 'multiple'
                        ? 'These are the ending routes the current season plan will preserve.'
                        : 'All major branches will bend back toward this ending target.'}
                    </Text>
                    <View style={styles.endingPreviewList}>
                      {activeEndings.map((ending) => (
                        <View key={ending.id} style={styles.endingPreviewCard}>
                          <View style={styles.endingPreviewHeader}>
                            <Text style={styles.endingPreviewTitle}>{ending.name.toUpperCase()}</Text>
                            <View style={styles.endingSourceBadge}>
                              <Text style={styles.endingSourceBadgeText}>{getEndingConfidenceLabel(ending).toUpperCase()}</Text>
                            </View>
                          </View>
                          <Text style={styles.endingPreviewSummary}>{ending.summary}</Text>
                          <Text style={styles.endingPreviewMeta}>{ending.emotionalRegister} • {ending.themePayoff}</Text>
                          {ending.stateDrivers.length > 0 && (
                            <Text style={styles.endingPreviewDrivers}>
                              Route drivers: {ending.stateDrivers.slice(0, 3).map((driver) => driver.label).join(' + ')}
                            </Text>
                          )}
                        </View>
                      ))}
                    </View>
                  </View>
                )}
                {!seasonPlan && (
                  <View style={styles.generationConfig}>
                    <Text style={styles.configLabel}>EPISODES TO GENERATE</Text>
                    <View style={styles.counter}><TouchableOpacity style={styles.counterBtn} onPress={() => setSelectedEpisodeCount(Math.max(1, selectedEpisodeCount - 1))}><Text style={styles.counterBtnText}>−</Text></TouchableOpacity><Text style={styles.counterVal}>{selectedEpisodeCount}</Text><TouchableOpacity style={styles.counterBtn} onPress={() => setSelectedEpisodeCount(Math.min(analysisResult.totalEpisodes, selectedEpisodeCount + 1))}><Text style={styles.counterBtnText}>+</Text></TouchableOpacity></View>
                  </View>
                )}
              </View>
            )}
            <StyleSetupSection
              rawArtStyle={artStyle}
              expanding={styleSetup.expanding}
              expansionError={styleSetup.expansionError}
              profile={styleSetup.profile}
              slots={styleSetup.slots}
              useDefaults={styleSetup.useDefaults}
              statusSummary={styleSetup.statusSummary}
              onExpand={styleSetup.expand}
              onUpdateField={styleSetup.updateField}
              onGenerateAnchor={styleSetup.generateAnchor}
              onApproveAnchor={styleSetup.approveAnchor}
              onToggleUseDefaults={styleSetup.setUseDefaults}
            />
	            <View style={styles.configActions}>{!hasSourceInput ? <View style={[styles.executeButton, { opacity: 0.5 }]}><Text style={styles.executeButtonText}>LOAD SOURCE TO CONTINUE</Text></View> : <TouchableOpacity style={[styles.executeButton, sourceAnalysis?.sourceCanon && !canonSetupApproved ? { opacity: 0.5 } : null]} onPress={startGeneration}><Zap size={18} color="white" /><Text style={styles.executeButtonText}>{sourceAnalysis?.sourceCanon && !canonSetupApproved ? 'APPROVE CANON TO CONTINUE' : 'INITIATE GENERATION'}</Text></TouchableOpacity>}<TouchableOpacity style={styles.textButton} onPress={() => setState('config')}><Text style={styles.textButtonText}>BACK TO CONFIG</Text></TouchableOpacity></View>
          </View>
        )}
        {(state === 'running' || state === 'checkpoint') && (
          <View style={styles.runningSection}>
            <ProgressStep>
              <PipelineProgress events={events} currentPhase={currentPhase} isRunning={state === 'running'} progress={liveProgress} etaSeconds={etaSeconds} imageProgress={imageProgress} runtime={pipelineRuntime} storyTitle={pipelineRuntime?.friendlyName || customStoryTitle || undefined} />
              <View style={styles.runningActions}>
                <TouchableOpacity style={styles.cancelButton} onPress={cancelGeneration}>
                  <StopCircle size={18} color={TERMINAL.colors.error} />
                  <Text style={styles.cancelButtonText}>STOP GENERATION</Text>
                </TouchableOpacity>
              </View>
            </ProgressStep>
          </View>
        )}
        {state === 'checkpoint' && currentCheckpoint && (<View style={styles.checkpointSection}><CheckpointReview checkpoint={currentCheckpoint} onApprove={handleCheckpointApprove} onReject={handleCheckpointReject} /></View>)}
        {state === 'complete' && generatedStory && !isViewingHistory && (
          <View style={styles.completeSection}>
            <CompleteStep>
              <View style={styles.successHeader}>
                <CheckCircle2 size={48} color={TERMINAL.colors.primary} />
                <Text style={styles.completeTitle}>SYNTHESIS COMPLETE</Text>
                <Text style={styles.completeSubtitle}>NARRATIVE READY FOR DEPLOYMENT</Text>
              </View>
              <View style={styles.storySummaryCard}>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>TITLE</Text>
                <Text style={styles.summaryValue}>{(generatedStory.title || 'Untitled').toUpperCase()}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>EPISODES</Text>
                <Text style={styles.summaryValue}>{generatedStory.episodes.length}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>SCENES</Text>
                <Text style={styles.summaryValue}>{generatedStory.episodes.reduce((acc, ep) => acc + ep.scenes.length, 0)}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>IMAGES</Text>
                <Text style={styles.summaryValue}>{(generatedStory.imagesStatus || 'complete').toUpperCase()}</Text>
              </View>
            </View>
            <View style={styles.completeActions}>
              {generatedStory.imagesStatus === 'pending' && (
                <TouchableOpacity style={styles.executeButton} onPress={() => { void startImageGenerationForDraft(); }}>
                  <ImageIcon size={18} color="white" />
                  <Text style={styles.executeButtonText}>GENERATE IMAGES</Text>
                </TouchableOpacity>
              )}
              {onPlayStory && (
                <TouchableOpacity
                  style={[
                    generatedStory.imagesStatus === 'pending' ? styles.secondaryActionButton : styles.executeButton,
                  ]}
                  onPress={() => { void onPlayStory(generatedStory); }}
                >
                  <Play size={18} color={generatedStory.imagesStatus === 'pending' ? TERMINAL.colors.primary : 'white'} />
                  <Text style={generatedStory.imagesStatus === 'pending' ? styles.secondaryActionButtonText : styles.executeButtonText}>PLAY NOW</Text>
                </TouchableOpacity>
              )}
              {onViewLibrary && (
                <TouchableOpacity style={styles.secondaryActionButton} onPress={onViewLibrary}>
                  <Library size={18} color={TERMINAL.colors.primary} />
                  <Text style={styles.secondaryActionButtonText}>VIEW IN LIBRARY</Text>
                </TouchableOpacity>
              )}
              {nextSeasonEpisode && (
                <TouchableOpacity style={styles.executeButton} onPress={() => { void continueSeasonGeneration(); }}>
                  <ChevronRight size={18} color="white" />
                  <Text style={styles.executeButtonText}>CONTINUE WITH EPISODE {nextSeasonEpisode.episodeNumber}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.secondaryActionButton} onPress={resetGenerator}>
                <RefreshCw size={18} color={TERMINAL.colors.primary} />
                <Text style={styles.secondaryActionButtonText}>GENERATE ANOTHER</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.textButton} onPress={exportStory}>
                <Text style={styles.textButtonText}>EXPORT STORY DATA</Text>
              </TouchableOpacity>
            </View>
            </CompleteStep>
          </View>
        )}
        {state === 'cancelled' && !isViewingHistory && (
          <View style={styles.cancelledSection}>
            <View style={styles.cancelledHeader}>
              <PauseCircle size={40} color={TERMINAL.colors.amber} />
              <Text style={styles.cancelledTitle}>GENERATION CANCELLED</Text>
              <Text style={styles.cancelledSubtitle}>Pipeline stopped cleanly. Your inputs are preserved.</Text>
            </View>
            <View style={styles.cancelledActions}>
              <TouchableOpacity style={styles.executeButton} onPress={() => setState('config')}>
                <Settings size={18} color="white" />
                <Text style={styles.executeButtonText}>BACK TO CONFIG</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryActionButton} onPress={resetGenerator}>
                <RefreshCw size={18} color={TERMINAL.colors.primary} />
                <Text style={styles.secondaryActionButtonText}>START OVER</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        {state === 'error' && !isViewingHistory && (
          <View style={styles.errorSection}><View style={styles.errorHeader}><AlertCircle size={48} color={TERMINAL.colors.error} /><Text style={styles.errorTitle}>PIPELINE FAILURE</Text></View><Text style={styles.errorDetail}>{error}</Text>{renderFailureWorkspace()}<View style={styles.errorActions}><TouchableOpacity style={styles.executeButton} onPress={() => setState('config')}><Text style={styles.executeButtonText}>ADJUST PARAMETERS</Text></TouchableOpacity><TouchableOpacity style={styles.textButton} onPress={resetGenerator}><Text style={styles.textButtonText}>RESTART PIPELINE</Text></TouchableOpacity></View></View>
        )}
        {/* History View - shows details of completed/failed/cancelled jobs */}
        {isViewingHistory && historyJob && (
          <View style={styles.historySection}>
            <View style={styles.historyHeader}>
              <View style={[
                styles.historyStatusBadge,
                historyJob.status === 'completed' && styles.historyStatusCompleted,
                historyJob.status === 'failed' && styles.historyStatusFailed,
                historyJob.status === 'cancelled' && styles.historyStatusCancelled,
              ]}>
                {historyJob.status === 'completed' && <CheckCircle2 size={16} color={TERMINAL.colors.primary} />}
                {historyJob.status === 'failed' && <AlertCircle size={16} color={TERMINAL.colors.error} />}
                {historyJob.status === 'cancelled' && <AlertCircle size={16} color={TERMINAL.colors.amber} />}
                <Text style={[
                  styles.historyStatusText,
                  historyJob.status === 'completed' && { color: TERMINAL.colors.primary },
                  historyJob.status === 'failed' && { color: TERMINAL.colors.error },
                  historyJob.status === 'cancelled' && { color: TERMINAL.colors.amber },
                ]}>
                  {(historyJob.status || 'unknown').toUpperCase()}
                </Text>
              </View>
              <Text style={styles.historyTitle}>{(historyJob.friendlyName || historyJob.storyTitle || 'Untitled').toUpperCase()}</Text>
              <Text style={styles.historyMeta}>
                STARTED {new Date(historyJob.startedAt).toLocaleString().toUpperCase()}
              </Text>
            </View>

            {/* Job Stats */}
            <View style={styles.historyStats}>
              <View style={styles.historyStatItem}>
                <Text style={styles.historyStatLabel}>EPISODES</Text>
                <Text style={styles.historyStatValue}>{historyJob.currentEpisode}/{historyJob.episodeCount}</Text>
              </View>
              <View style={styles.historyStatItem}>
                <Text style={styles.historyStatLabel}>PROGRESS</Text>
                <Text style={styles.historyStatValue}>{historyJob.progress}%</Text>
              </View>
              <View style={styles.historyStatItem}>
                <Text style={styles.historyStatLabel}>EVENTS</Text>
                <Text style={styles.historyStatValue}>{events.length}</Text>
              </View>
            </View>

            {/* Error message if failed */}
            {historyJob.status === 'failed' && historyJob.error && (
              <View style={styles.historyErrorBox}>
                <AlertCircle size={14} color={TERMINAL.colors.error} />
                <Text style={styles.historyErrorText}>{historyJob.error}</Text>
              </View>
            )}

            {isRecoverableHistoryJob(historyJob) && renderFailureWorkspace()}

            {/* Pipeline Progress / Event Log */}
            {events.length > 0 && (
              <View style={styles.historyProgressSection}>
                <PipelineProgress events={events} currentPhase={currentPhase} isRunning={false} progress={historyJob.progress} etaSeconds={null} runtime={pipelineRuntime} storyTitle={historyJob.friendlyName || historyJob.storyTitle} />
              </View>
            )}

            {/* Actions */}
            <View style={styles.historyActions}>
              <TouchableOpacity style={styles.secondaryActionButton} onPress={resetGenerator}>
                <RefreshCw size={18} color={TERMINAL.colors.primary} />
                <Text style={styles.secondaryActionButtonText}>NEW GENERATION</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.textButton} onPress={onBack}>
                <Text style={styles.textButtonText}>BACK TO JOBS</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>

      <ConfirmDialog
        visible={confirmCancelGeneration}
        title="Stop generation?"
        message="Progress will be saved and you may be able to resume later."
        confirmLabel="Stop"
        cancelLabel="Keep running"
        destructive
        onConfirm={performCancelGeneration}
        onCancel={() => setConfirmCancelGeneration(false)}
        testID="generator-cancel-dialog"
      />

      <Modal
        visible={showArtStyleSheet}
        animationType="slide"
        transparent
        onRequestClose={() => setShowArtStyleSheet(false)}
      >
        <View style={styles.jobsSheetOverlay}>
          <Pressable
            style={styles.jobsSheetBackdrop}
            onPress={() => setShowArtStyleSheet(false)}
            accessibilityRole="button"
            accessibilityLabel="Close art style picker"
          />
          <View style={styles.jobsSheet}>
            <View style={styles.jobsSheetHandle} />
            <View style={styles.jobsSheetHeader}>
              <View style={styles.jobsSheetTitleRow}>
                <ImageIcon size={16} color={TERMINAL.colors.primary} />
                <Text style={styles.jobsSheetTitle}>ART STYLE</Text>
              </View>
              <TouchableOpacity
                style={styles.jobsSheetClose}
                onPress={() => setShowArtStyleSheet(false)}
                accessibilityRole="button"
                accessibilityLabel="Close art style picker"
              >
                <Text style={styles.jobsSheetCloseText}>CLOSE</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              style={styles.jobsSheetBody}
              contentContainerStyle={styles.artStyleSheetContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.styleSheetActions}>
                <TouchableOpacity style={styles.secondaryInlineButton} onPress={openNewArtStyleEditor}>
                  <Text style={styles.secondaryInlineButtonText}>CREATE NEW STYLE</Text>
                </TouchableOpacity>
                {artStyle.trim().length > 0 && (
                  <TouchableOpacity style={styles.secondaryInlineButton} onPress={openEditCurrentArtStyleEditor}>
                    <Text style={styles.secondaryInlineButtonText}>EDIT CURRENT STYLE</Text>
                  </TouchableOpacity>
                )}
              </View>

              {presetStyleOptions.length > 0 ? (
                <>
                  <Text style={styles.styleSheetSectionTitle}>CURATED PRESETS</Text>
                  <View style={styles.stylePresetGrid}>
                    {presetStyleOptions.map((preset) => (
                      <TouchableOpacity
                        key={preset.id}
                        style={[styles.stylePresetTile, selectedPresetId === preset.id && styles.stylePresetTileActive]}
                        onPress={() => {
                          applyPresetArtStyle(preset.id);
                          setShowArtStyleSheet(false);
                        }}
                      >
                        <Text style={[styles.stylePresetName, selectedPresetId === preset.id && styles.stylePresetNameActive]} numberOfLines={1}>
                          {preset.displayName}
                        </Text>
                        <Text style={styles.stylePresetDescription} numberOfLines={2}>
                          {preset.description}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              ) : null}

              <Text style={styles.styleSheetSectionTitle}>SAVED STYLES</Text>
              {savedArtStyles.length > 0 ? (
                <View style={styles.styleList}>
                  {savedArtStyles.map((style) => (
                    <View key={style.id} style={styles.styleListRow}>
                      <TouchableOpacity
                        style={styles.styleListSelect}
                        onPress={() => {
                          applyArtStyle(style.style);
                          setShowArtStyleSheet(false);
                        }}
                      >
                        <Text style={styles.styleListName} numberOfLines={1}>{style.name}</Text>
                        <Text style={styles.styleListText} numberOfLines={2}>{style.style}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.styleListIconButton} onPress={() => openEditArtStyleEditor(style)}>
                        <Text style={styles.styleListIconButtonText}>EDIT</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.styleListIconButton} onPress={() => removeSavedArtStyle(style.id)}>
                        <Trash2 size={13} color={TERMINAL.colors.muted} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.referenceModeHint}>No saved custom styles yet.</Text>
              )}

              {recentArtStyles.length > 0 && (
                <>
                  <Text style={styles.styleSheetSectionTitle}>RECENT</Text>
                  <View style={styles.styleChipRow}>
                    {recentArtStyles.map((style) => (
                      <TouchableOpacity
                        key={style}
                        style={styles.styleChip}
                        onPress={() => {
                          applyArtStyle(style);
                          setShowArtStyleSheet(false);
                        }}
                      >
                        <Text style={styles.styleChipText} numberOfLines={1}>{style}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={artStyleEditorVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setArtStyleEditorVisible(false)}
      >
        <View style={styles.centerModalOverlay}>
          <Pressable
            style={styles.centerModalBackdrop}
            onPress={() => setArtStyleEditorVisible(false)}
            accessibilityRole="button"
            accessibilityLabel="Close art style editor"
          />
          <View style={styles.centerModalCard}>
            <Text style={styles.centerModalTitle}>
              {editingArtStyleOriginal ? 'EDIT ART STYLE' : 'CREATE ART STYLE'}
            </Text>
            <Text style={styles.centerModalHint}>
              Describe the exact visual look. This text becomes the style directive used by the image pipeline.
            </Text>
            <View style={styles.inputWrapper}>
              <TextInput
                style={styles.input}
                value={editingArtStyleName}
                onChangeText={setEditingArtStyleName}
                placeholder="Style name, e.g. Gothic Wash"
                placeholderTextColor={TERMINAL.colors.muted}
              />
            </View>
            <View style={[styles.inputWrapper, styles.artStyleEditorInputWrap]}>
              <TextInput
                style={[styles.input, styles.artStyleEditorInput]}
                value={editingArtStyleDraft}
                onChangeText={setEditingArtStyleDraft}
                placeholder="e.g. gothic ink wash with muted crimson accents and heavy silhouette design"
                placeholderTextColor={TERMINAL.colors.muted}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
            </View>
            <View style={styles.centerModalActions}>
              <TouchableOpacity style={styles.centerModalSecondary} onPress={() => setArtStyleEditorVisible(false)}>
                <Text style={styles.centerModalSecondaryText}>CANCEL</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.centerModalPrimary} onPress={saveEditedArtStyle}>
                <Text style={styles.centerModalPrimaryText}>SAVE STYLE</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <AdvancedSettingsSheet
        visible={showAdvancedSettings}
        settings={generationSettings}
        onChange={handleGenerationSettingsChange}
        onClose={() => setShowAdvancedSettings(false)}
      />

      <ModelTaskSheet
        visible={showModelTaskSheet}
        onClose={() => setShowModelTaskSheet(false)}
        modelFamily={modelFamily}
        assignments={effectiveTaskAssignments}
        overrides={taskModelOverrides}
        availableModels={availableModels}
        onTaskModelChange={handleTaskModelChange}
        onTaskProviderChange={handleTaskProviderChange}
        onResetTask={resetTaskModel}
      />

      {/*
        Background jobs bottom sheet. Surfaces the full ImageJobPanel /
        VideoJobPanel UIs on demand without forcing them to live at the
        bottom of the generator scroll. Modal is unmounted when the sheet
        is closed, so the panels do not render (and their internal
        animations / polling don't run) unless requested.
      */}
      <Modal
        visible={showJobsSheet}
        animationType="slide"
        transparent
        onRequestClose={() => setShowJobsSheet(false)}
      >
        <View style={styles.jobsSheetOverlay}>
          <Pressable
            style={styles.jobsSheetBackdrop}
            onPress={() => setShowJobsSheet(false)}
            accessibilityRole="button"
            accessibilityLabel="Close background jobs sheet"
          />
          <View style={styles.jobsSheet}>
            <View style={styles.jobsSheetHandle} />
            <View style={styles.jobsSheetHeader}>
              <View style={styles.jobsSheetTitleRow}>
                <Layers size={16} color={TERMINAL.colors.amber} />
                <Text style={styles.jobsSheetTitle}>BACKGROUND JOBS</Text>
                <View style={styles.jobsPillBadge}>
                  <Text style={styles.jobsPillBadgeText}>{totalBackgroundJobs}</Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.jobsSheetClose}
                onPress={() => setShowJobsSheet(false)}
                accessibilityRole="button"
                accessibilityLabel="Close background jobs"
              >
                <Text style={styles.jobsSheetCloseText}>CLOSE</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              style={styles.jobsSheetBody}
              contentContainerStyle={styles.jobsSheetBodyContent}
              showsVerticalScrollIndicator={false}
            >
              {imageJobCount > 0 && <ImageJobPanel />}
              {videoJobCount > 0 && <VideoJobPanel />}
              {!hasBackgroundJobs && (
                <Text style={styles.jobsSheetEmpty}>NO ACTIVE JOBS</Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: TERMINAL.colors.bg },
  header: { height: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  headerTitle: { fontSize: 14, fontWeight: '900', color: 'white', letterSpacing: 2 },
  headerSpacer: { width: 60 },
  jobsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.35)',
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
  },
  jobsPillText: {
    color: TERMINAL.colors.amber,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  jobsPillBadge: {
    minWidth: 18,
    paddingHorizontal: 6,
    height: 18,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: TERMINAL.colors.amber,
  },
  jobsPillBadgeText: {
    color: TERMINAL.colors.bg,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  jobsSheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  jobsSheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  jobsSheet: {
    maxHeight: '85%',
    backgroundColor: TERMINAL.colors.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingTop: 8,
  },
  jobsSheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginBottom: 8,
  },
  jobsSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  jobsSheetTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  jobsSheetTitle: {
    color: 'white',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  jobsSheetClose: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  jobsSheetCloseText: {
    color: TERMINAL.colors.muted,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  jobsSheetBody: {
    flexGrow: 0,
  },
  jobsSheetBodyContent: {
    padding: 16,
    gap: 12,
    paddingBottom: 32,
  },
  jobsSheetEmpty: {
    textAlign: 'center',
    color: TERMINAL.colors.muted,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
    paddingVertical: 40,
  },
  headerIconButton: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8 },
  headerButtonText: { fontSize: 10, fontWeight: '900', color: TERMINAL.colors.muted, letterSpacing: 1 },
  content: { flex: 1 },
  contentPadding: { padding: 20, paddingBottom: 40 },
  statusBar: { flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: TERMINAL.colors.bgLight, borderRadius: 12, marginBottom: 24, gap: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  statusLabel: { fontSize: 10, fontWeight: '900', color: TERMINAL.colors.muted, letterSpacing: 1 },
  statusValue: { fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  status_idle: { color: TERMINAL.colors.muted }, status_config: { color: TERMINAL.colors.cyan }, status_analyzing: { color: TERMINAL.colors.amber }, status_analysis_complete: { color: TERMINAL.colors.primary }, status_running: { color: TERMINAL.colors.amber }, status_checkpoint: { color: TERMINAL.colors.cyan }, status_complete: { color: TERMINAL.colors.primary }, status_cancelled: { color: TERMINAL.colors.amber }, status_error: { color: TERMINAL.colors.error }, status_history: { color: TERMINAL.colors.cyan },
  section: { marginBottom: 32 }, sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 }, sectionTitle: { fontSize: 12, fontWeight: '900', color: TERMINAL.colors.primary, letterSpacing: 1 },
  configIntro: { fontSize: 11, color: TERMINAL.colors.muted, lineHeight: 18, marginTop: -4, marginBottom: 18, fontWeight: '600' },
  configGroup: { gap: 18, marginBottom: 30 },
  setupStepCard: { backgroundColor: TERMINAL.colors.bgLight, borderRadius: 22, padding: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', gap: 16 },
  setupStepHeader: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  bucketCardHeader: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  bucketCardHeaderMain: { flex: 1, gap: 10 },
  bucketCardTitleRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  bucketCardIconWrap: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  bucketCardTitleBlock: { flex: 1, gap: 4 },
  bucketCardControls: { alignItems: 'flex-end', gap: 8 },
  bucketToggleWrap: { alignItems: 'center', gap: 6 },
  bucketToggleState: { fontSize: 9, fontWeight: '900', color: TERMINAL.colors.muted, letterSpacing: 1 },
  bucketToggleStateEnabled: { color: TERMINAL.colors.cyan },
  bucketSummary: { gap: 4, paddingLeft: 40 },
  bucketSummaryText: { fontSize: 9, color: TERMINAL.colors.muted, fontWeight: '700', lineHeight: 14 },
  setupStepBadge: { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(59,130,246,0.14)', borderWidth: 1, borderColor: 'rgba(59,130,246,0.25)', alignItems: 'center', justifyContent: 'center' },
  setupStepBadgeText: { fontSize: 12, fontWeight: '900', color: TERMINAL.colors.primary, letterSpacing: 0.5 },
  setupStepHeaderText: { flex: 1, gap: 4 },
  setupStepTitle: { fontSize: 12, fontWeight: '900', color: 'white', letterSpacing: 1 },
  setupStepDescription: { fontSize: 10, color: TERMINAL.colors.muted, lineHeight: 16, fontWeight: '600' },
  setupStepBody: { gap: 16 },
  configItem: { gap: 8 },
  configLabel: { fontSize: 10, fontWeight: '900', color: TERMINAL.colors.amber, letterSpacing: 1, marginLeft: 4 },
  configHint: { fontSize: 9, color: TERMINAL.colors.muted, marginLeft: 4, marginTop: 4, fontWeight: '600' },
  styleDropdownButton: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: TERMINAL.colors.bgLight, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 16, paddingVertical: 10 },
  styleDropdownTextBlock: { flex: 1, gap: 4 },
  styleDropdownValue: { color: 'white', fontSize: 13, fontWeight: '900', letterSpacing: 0.3 },
  styleDropdownHint: { color: TERMINAL.colors.muted, fontSize: 9, fontWeight: '700' },
  inlineDisclosure: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  presetSummary: {
    marginTop: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  presetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  presetTask: {
    fontSize: 11,
    fontWeight: '700',
    color: TERMINAL.colors.muted,
    letterSpacing: 0.3,
    flex: 1,
    marginRight: 8,
  },
  presetModelWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
  },
  presetModel: {
    fontSize: 11,
    fontWeight: '800',
    color: 'white',
    letterSpacing: 0.2,
    flexShrink: 1,
  },
  presetCustom: {
    fontSize: 8,
    fontWeight: '800',
    color: TERMINAL.colors.cyan,
    letterSpacing: 0.5,
    marginLeft: 6,
  },
  advancedSettingsHint: {
    marginLeft: 'auto',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
    color: TERMINAL.colors.primary,
  },
  disclosureBody: { marginTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', paddingTop: 12 },
  disclosureScroll: { marginTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', paddingTop: 12, maxHeight: 420 },
  configGroupIntro: { color: TERMINAL.colors.muted, fontSize: 10, marginBottom: 16, letterSpacing: 1 },
  toggleConfigRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16, paddingVertical: 8 },
  toggleConfigInfo: { flex: 1, marginRight: 12 },
  inlineResetButton: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, marginTop: 4 },
  inlineResetButtonText: { color: TERMINAL.colors.muted, fontSize: 11, letterSpacing: 1 },
  numericRangeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  numericRangeLabel: { color: TERMINAL.colors.muted, fontSize: 10, width: 30 },
  numericRangeLabelMax: { width: 40, textAlign: 'right' },
  numericRangeInputWrap: { flex: 1, height: 32, justifyContent: 'center' },
  numericRangeInput: { textAlign: 'center', fontSize: 14 },
  providerModelOption: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 10, marginVertical: 2, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  providerModelOptionActive: { borderColor: TERMINAL.colors.primary, backgroundColor: 'rgba(59,130,246,0.1)' },
  providerModelName: { color: 'white', fontSize: 12, fontWeight: '800' },
  providerModelPrice: { color: TERMINAL.colors.muted, fontSize: 10, fontWeight: '700' },
  providerModelDescription: { color: TERMINAL.colors.muted, fontSize: 10, marginTop: 2, fontWeight: '600' },
  providerModelCheck: { color: TERMINAL.colors.primary, fontSize: 14, fontWeight: '900' },
  toggleActionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  toggleActionTextBlock: { flex: 1, paddingRight: 12 },
  toggleActionHint: { color: TERMINAL.colors.muted, fontSize: 10, marginTop: 2, fontWeight: '600' },
  booleanToggle: { width: 44, height: 24, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', padding: 2 },
  booleanToggleActive: { backgroundColor: TERMINAL.colors.cyan },
  booleanToggleKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: 'white' },
  booleanToggleKnobActive: { marginLeft: 20 },
  warningCallout: { backgroundColor: 'rgba(255,180,0,0.1)', borderRadius: 6, padding: 10, marginTop: 8 },
  warningCalloutText: { color: TERMINAL.colors.amber, fontSize: 10, fontWeight: '700' },
  setupChecklist: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  setupChecklistItem: { minWidth: '47%', flex: 1, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  setupChecklistLabel: { fontSize: 8, fontWeight: '900', color: TERMINAL.colors.muted, letterSpacing: 1, marginBottom: 6 },
  setupChecklistValue: { fontSize: 11, fontWeight: '900', color: 'white', letterSpacing: 0.5 },
  setupChecklistValueReady: { color: TERMINAL.colors.primary },
  inputWrapper: { backgroundColor: TERMINAL.colors.bgLight, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 16 },
  input: { height: 50, color: 'white', fontSize: 14, fontWeight: '700' },
  segmentedControl: { flexDirection: 'row', backgroundColor: TERMINAL.colors.bgLight, borderRadius: 14, padding: 4, gap: 4 },
  segment: { flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 10 },
  segmentActive: { backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  segmentText: { fontSize: 10, fontWeight: '900', color: TERMINAL.colors.muted, letterSpacing: 1 }, segmentTextActive: { color: 'white' },
  stylePresetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stylePresetTile: { width: '31.8%', minHeight: 78, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', backgroundColor: 'rgba(255,255,255,0.03)', padding: 10, gap: 5 },
  stylePresetTileActive: { borderColor: TERMINAL.colors.primary, backgroundColor: 'rgba(59,130,246,0.12)' },
  stylePresetName: { color: 'white', fontSize: 10, fontWeight: '900', letterSpacing: 0.4 },
  stylePresetNameActive: { color: TERMINAL.colors.primary },
  stylePresetDescription: { color: TERMINAL.colors.muted, fontSize: 8, lineHeight: 12, fontWeight: '600' },
  artStyleSheetContent: { padding: 16, gap: 14, paddingBottom: 40 },
  styleSheetActions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  styleSheetSectionTitle: { color: TERMINAL.colors.amber, fontSize: 10, fontWeight: '900', letterSpacing: 1, marginLeft: 4, marginTop: 4 },
  styleList: { gap: 8 },
  styleListRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', padding: 8 },
  styleListSelect: { flex: 1, paddingVertical: 4, paddingHorizontal: 4 },
  styleListName: { color: 'white', fontSize: 11, fontWeight: '900', letterSpacing: 0.4, marginBottom: 3 },
  styleListText: { color: TERMINAL.colors.muted, fontSize: 9, lineHeight: 14, fontWeight: '700' },
  styleListIconButton: { minWidth: 42, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.05)' },
  styleListIconButtonText: { color: TERMINAL.colors.primary, fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  centerModalOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: 'rgba(0,0,0,0.62)' },
  centerModalBackdrop: { ...StyleSheet.absoluteFillObject },
  centerModalCard: { width: '100%', maxWidth: 560, borderRadius: 20, backgroundColor: TERMINAL.colors.bg, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', padding: 18, gap: 12 },
  centerModalTitle: { color: 'white', fontSize: 13, fontWeight: '900', letterSpacing: 1.2 },
  centerModalHint: { color: TERMINAL.colors.muted, fontSize: 10, lineHeight: 16, fontWeight: '600' },
  centerModalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 4 },
  centerModalSecondary: { paddingVertical: 11, paddingHorizontal: 14, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)' },
  centerModalPrimary: { paddingVertical: 11, paddingHorizontal: 14, borderRadius: 10, backgroundColor: TERMINAL.colors.primary },
  centerModalSecondaryText: { color: TERMINAL.colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  centerModalPrimaryText: { color: 'white', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  artStyleEditorInputWrap: { paddingVertical: 10 },
  artStyleEditorInput: { height: 110, textAlignVertical: 'top' },
  styleChipSection: { gap: 8 },
  styleChipSectionLabel: { color: TERMINAL.colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 1, marginLeft: 4 },
  styleChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  styleChip: { maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 7, paddingHorizontal: 10, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  styleChipText: { color: 'white', fontSize: 9, fontWeight: '800', maxWidth: 260 },
  styleChipRemove: { padding: 2 },
  styleActionRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  secondaryInlineButton: { paddingVertical: 9, paddingHorizontal: 12, borderRadius: 10, backgroundColor: 'rgba(59,130,246,0.08)', borderWidth: 1, borderColor: 'rgba(59,130,246,0.2)' },
  secondaryInlineButtonText: { color: TERMINAL.colors.primary, fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  modelPickerContainer: { backgroundColor: TERMINAL.colors.bgLight, borderRadius: 14, padding: 4, gap: 2 },
  modelPickerOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10 },
  modelPickerOptionActive: { backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  modelPickerLabel: { fontSize: 11, fontWeight: '900', color: TERMINAL.colors.muted, letterSpacing: 0.5 },
  modelPickerLabelActive: { color: 'white' },
  modelPickerValue: { fontSize: 9, fontWeight: '700', color: 'rgba(255,255,255,0.15)', letterSpacing: 0.3 },
  modelPickerValueActive: { color: TERMINAL.colors.muted },
  filePicker: { flexDirection: 'row', alignItems: 'center', backgroundColor: TERMINAL.colors.bgLight, borderRadius: 20, padding: 16, borderWidth: 2, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.1)', gap: 16 },
  filePickerActive: { borderStyle: 'solid', borderColor: TERMINAL.colors.primary, backgroundColor: 'rgba(59, 130, 246, 0.05)' },
  fileIconBox: { width: 44, height: 44, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
  fileInfo: { flex: 1 }, fileName: { fontSize: 12, fontWeight: '900', color: 'white', marginBottom: 4 }, fileMeta: { fontSize: 9, color: TERMINAL.colors.muted, fontWeight: '700' },
  clearBtn: { padding: 8 },
  parsedCard: { marginTop: 12, backgroundColor: 'rgba(59, 130, 246, 0.08)', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: 'rgba(59, 130, 246, 0.2)' },
  parsedHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }, parsedTitle: { fontSize: 9, fontWeight: '900', color: TERMINAL.colors.primary, letterSpacing: 1 },
  parsedInfo: { fontSize: 14, fontWeight: '900', color: 'white', marginBottom: 4 }, parsedMeta: { fontSize: 10, color: TERMINAL.colors.muted, fontWeight: '700' },
  executeButton: { backgroundColor: TERMINAL.colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 18, borderRadius: 20, gap: 12 },
  executeButtonText: { fontSize: 12, fontWeight: '900', color: 'white', letterSpacing: 1 },
  textButton: { paddingVertical: 12, alignItems: 'center' }, textButtonText: { fontSize: 11, fontWeight: '900', color: TERMINAL.colors.muted, letterSpacing: 1 },
  configActions: { gap: 12 },
  analysisGroup: { gap: 20, marginBottom: 30 }, titleCard: { backgroundColor: TERMINAL.colors.bgLight, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  analysisMeta: { fontSize: 10, color: TERMINAL.colors.muted, fontWeight: '700', marginTop: 10 }, statsGrid: { flexDirection: 'row', gap: 12 },
  statItem: { flex: 1, backgroundColor: TERMINAL.colors.bgLight, borderRadius: 16, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  statLabel: { fontSize: 8, fontWeight: '900', color: TERMINAL.colors.muted, letterSpacing: 1, marginBottom: 4 }, statValue: { fontSize: 18, fontWeight: '900', color: 'white' },
  subHeader: { fontSize: 10, fontWeight: '900', color: TERMINAL.colors.muted, letterSpacing: 2, marginTop: 10 },
  // Analysis card styles
  analysisCard: { backgroundColor: TERMINAL.colors.bgLight, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  analysisCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  analysisCardTitle: { fontSize: 10, fontWeight: '900', color: TERMINAL.colors.muted, letterSpacing: 1 },
  // Themes
  tagList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  themeTag: { backgroundColor: 'rgba(0, 255, 255, 0.1)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(0, 255, 255, 0.2)' },
  themeTagText: { fontSize: 9, fontWeight: '700', color: TERMINAL.colors.cyan, letterSpacing: 0.5 },
  // Story arcs
  arcItem: { marginBottom: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  arcName: { fontSize: 11, fontWeight: '900', color: TERMINAL.colors.amber, letterSpacing: 0.5, marginBottom: 4 },
  arcDescription: { fontSize: 10, color: TERMINAL.colors.muted, lineHeight: 16 },
  arcEpisodes: { fontSize: 9, color: TERMINAL.colors.muted, marginTop: 4, fontWeight: '600' },
  // Character references
  characterReferenceIntro: { fontSize: 10, color: TERMINAL.colors.muted, lineHeight: 16, marginBottom: 16, fontWeight: '600' },
  endingModeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 },
  endingModeLabel: { flex: 1, fontSize: 9, fontWeight: '900', color: TERMINAL.colors.muted, letterSpacing: 0.8, textAlign: 'center' },
  endingModeLabelActive: { color: 'white' },
  endingPreviewList: { gap: 12 },
  endingPreviewCard: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', gap: 8 },
  endingPreviewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  endingPreviewTitle: { flex: 1, fontSize: 11, fontWeight: '900', color: 'white', letterSpacing: 0.6 },
  endingSourceBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(245, 158, 11, 0.12)', borderWidth: 1, borderColor: 'rgba(245, 158, 11, 0.24)' },
  endingSourceBadgeText: { fontSize: 8, fontWeight: '900', color: TERMINAL.colors.amber, letterSpacing: 0.7 },
  endingPreviewSummary: { fontSize: 10, color: TERMINAL.colors.muted, lineHeight: 16, fontWeight: '600' },
  endingPreviewMeta: { fontSize: 9, color: TERMINAL.colors.primary, lineHeight: 14, fontWeight: '700' },
  endingPreviewDrivers: { fontSize: 9, color: TERMINAL.colors.muted, lineHeight: 15, fontWeight: '600' },
  characterReferenceList: { gap: 12 },
  characterReferenceCard: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', gap: 12 },
  characterReferenceCardPrimary: { borderColor: 'rgba(34, 211, 238, 0.25)', backgroundColor: 'rgba(34, 211, 238, 0.05)' },
  characterReferenceHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  characterReferenceIdentity: { flex: 1, gap: 4 },
  characterReferenceName: { fontSize: 11, fontWeight: '900', color: 'white', letterSpacing: 0.6 },
  characterReferenceRole: { fontSize: 8, fontWeight: '800', color: TERMINAL.colors.muted, letterSpacing: 1 },
  characterReferenceDescription: { fontSize: 10, color: TERMINAL.colors.muted, lineHeight: 16, fontWeight: '600' },
  styleReferenceHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 },
  styleReferenceTitleBlock: { flex: 1, gap: 4 },
  referenceUploadButton: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, backgroundColor: 'rgba(59, 130, 246, 0.08)', borderWidth: 1, borderColor: 'rgba(59, 130, 246, 0.2)' },
  referenceUploadButtonDisabled: { opacity: 0.55, backgroundColor: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)' },
  referenceUploadButtonText: { fontSize: 9, fontWeight: '900', color: TERMINAL.colors.primary, letterSpacing: 0.8 },
  referenceUploadButtonTextDisabled: { color: TERMINAL.colors.muted },
  referenceModeSection: { gap: 8 },
  referenceModeLabel: { fontSize: 8, fontWeight: '900', color: TERMINAL.colors.muted, letterSpacing: 1 },
  referenceModeControl: { flexDirection: 'row', gap: 8 },
  referenceModeOption: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  referenceModeOptionActive: { backgroundColor: 'rgba(59, 130, 246, 0.12)', borderColor: 'rgba(59, 130, 246, 0.3)' },
  referenceModeOptionText: { fontSize: 9, fontWeight: '900', color: TERMINAL.colors.muted, letterSpacing: 0.7 },
  referenceModeOptionTextActive: { color: 'white' },
  referenceModeHint: { fontSize: 9, color: TERMINAL.colors.muted, lineHeight: 15, fontWeight: '600' },
  referencePreviewGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  referencePreviewCard: { width: 88, gap: 6, position: 'relative' },
  referencePreviewImage: { width: 88, height: 88, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)' },
  referencePreviewRemove: { position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center' },
  referencePreviewName: { fontSize: 8, color: TERMINAL.colors.muted, fontWeight: '700' },
  characterReferenceEmpty: { fontSize: 9, color: TERMINAL.colors.muted, lineHeight: 15, fontWeight: '600' },
  // Characters
  characterList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  characterItem: { backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  protagonistItem: { backgroundColor: 'rgba(34, 211, 238, 0.1)', borderWidth: 1, borderColor: 'rgba(34, 211, 238, 0.3)' },
  characterName: { fontSize: 10, fontWeight: '900', color: 'white', letterSpacing: 0.5 },
  characterRole: { fontSize: 8, color: TERMINAL.colors.muted, marginTop: 2 },
  // Locations
  locationList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  locationItem: { backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  locationName: { fontSize: 9, fontWeight: '700', color: TERMINAL.colors.muted, letterSpacing: 0.5 },
  outlineList: { maxHeight: 250, backgroundColor: TERMINAL.colors.bgLight, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', overflow: 'hidden' },
  outlineItem: { flexDirection: 'row', padding: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.03)', gap: 16 },
  outlineNumber: { width: 28, height: 28, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
  outlineNumberText: { fontSize: 12, fontWeight: '900', color: TERMINAL.colors.cyan }, outlineInfo: { flex: 1 },
  outlineTitle: { fontSize: 12, fontWeight: '900', color: 'white', marginBottom: 4, letterSpacing: 0.5 }, outlineSynopsis: { fontSize: 10, color: TERMINAL.colors.muted, lineHeight: 16, fontWeight: '600' },
  generationConfig: { backgroundColor: TERMINAL.colors.bgLight, borderRadius: 20, padding: 20, alignItems: 'center', borderWidth: 1, borderColor: TERMINAL.colors.primary },
  counter: { flexDirection: 'row', alignItems: 'center', marginTop: 16, gap: 30 },
  counterBtn: { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
  counterBtnText: { fontSize: 24, color: 'white', fontWeight: '300' }, counterVal: { fontSize: 32, fontWeight: '900', color: TERMINAL.colors.primary },
  completeSection: { alignItems: 'center', paddingVertical: 20 }, successHeader: { alignItems: 'center', marginBottom: 30 },
  completeTitle: { fontSize: 20, fontWeight: '900', color: 'white', letterSpacing: 2, marginTop: 20, marginBottom: 8 }, completeSubtitle: { fontSize: 11, fontWeight: '700', color: TERMINAL.colors.primary, letterSpacing: 1 },
  cancelledSection: { alignItems: 'center', paddingVertical: 40, gap: 24 },
  cancelledHeader: { alignItems: 'center', gap: 12 },
  cancelledTitle: { fontSize: 16, fontWeight: '900', color: TERMINAL.colors.amber, letterSpacing: 2, marginTop: 12 },
  cancelledSubtitle: { fontSize: 12, color: TERMINAL.colors.muted, textAlign: 'center', lineHeight: 18, fontWeight: '600', paddingHorizontal: 20 },
  cancelledActions: { width: '100%', gap: 12 },
  storySummaryCard: { width: '100%', backgroundColor: TERMINAL.colors.bgLight, borderRadius: 24, padding: 24, gap: 16, marginBottom: 30, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, summaryLabel: { fontSize: 10, fontWeight: '900', color: TERMINAL.colors.muted, letterSpacing: 1 }, summaryValue: { fontSize: 12, fontWeight: '900', color: 'white', letterSpacing: 0.5 },
  completeActions: { width: '100%', gap: 12 }, secondaryActionButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 18, borderRadius: 20, borderWidth: 1, borderColor: TERMINAL.colors.primary, gap: 12 },
  secondaryActionButtonText: { fontSize: 12, fontWeight: '900', color: TERMINAL.colors.primary, letterSpacing: 1 },
  errorSection: { alignItems: 'center', paddingVertical: 40 }, errorHeader: { alignItems: 'center', marginBottom: 20 },
  errorTitle: { fontSize: 18, fontWeight: '900', color: TERMINAL.colors.error, letterSpacing: 2, marginTop: 16 },
  errorDetail: { fontSize: 12, color: TERMINAL.colors.muted, textAlign: 'center', lineHeight: 20, paddingHorizontal: 20, marginBottom: 30, fontWeight: '600' },
  errorActions: { width: '100%', gap: 12 },
  progressPlaceholder: { backgroundColor: TERMINAL.colors.bgLight, borderRadius: 24, padding: 4, marginTop: 10 },
  errorCard: { backgroundColor: 'rgba(239, 68, 68, 0.05)', borderRadius: 20, padding: 24, borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.2)', alignItems: 'center', gap: 16 },
  errorText: { fontSize: 12, color: TERMINAL.colors.error, fontWeight: '700', textAlign: 'center', letterSpacing: 0.5 },
  runningSection: { paddingVertical: 10, gap: 16 }, checkpointSection: { paddingVertical: 10 },
  runningActions: { alignItems: 'center', marginTop: 16 },
  cancelButton: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12, borderWidth: 1, borderColor: TERMINAL.colors.error, backgroundColor: 'rgba(239, 68, 68, 0.1)' },
  cancelButtonText: { fontSize: 11, fontWeight: '900', color: TERMINAL.colors.error, letterSpacing: 1 },
  // History view styles
  historySection: {
    gap: 20,
  },
  historyHeader: {
    alignItems: 'center',
    marginBottom: 10,
  },
  historyStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
    marginBottom: 16,
  },
  historyStatusCompleted: {
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.2)',
  },
  historyStatusFailed: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  historyStatusCancelled: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.2)',
  },
  historyStatusText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
  },
  historyTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: 'white',
    letterSpacing: 1,
    textAlign: 'center',
    marginBottom: 8,
  },
  historyMeta: {
    fontSize: 10,
    fontWeight: '700',
    color: TERMINAL.colors.muted,
    letterSpacing: 0.5,
  },
  historyStats: {
    flexDirection: 'row',
    gap: 12,
  },
  historyStatItem: {
    flex: 1,
    backgroundColor: TERMINAL.colors.bgLight,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  historyStatLabel: {
    fontSize: 8,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    letterSpacing: 1,
    marginBottom: 4,
  },
  historyStatValue: {
    fontSize: 18,
    fontWeight: '900',
    color: 'white',
  },
  historyErrorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  historyErrorText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '600',
    color: TERMINAL.colors.error,
    lineHeight: 18,
  },
  historyProgressSection: {
    backgroundColor: TERMINAL.colors.bgLight,
    borderRadius: 24,
    padding: 4,
  },
  historyActions: {
    gap: 12,
    marginTop: 10,
  },
  // Config error style
  configError: { fontSize: 9, color: TERMINAL.colors.error, marginLeft: 4, marginTop: 4, fontWeight: '600' },
  // Model picker button
  modelPickerButton: {
    backgroundColor: TERMINAL.colors.bgLight,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  modelPickerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modelPickerText: {
    flex: 1,
    color: 'white',
    fontSize: 14,
    fontWeight: '700',
  },
  modelPickerArrow: {
    color: TERMINAL.colors.muted,
    fontSize: 12,
    marginLeft: 10,
  },
  // Loading state (used by the season plan loading indicator). Modal-specific
  // styles (modelPickerModal, modalHeader, modalTitle, etc.) previously lived
  // here but were dead code tied to an earlier inline model-picker
  // implementation; they have been removed along with the Modal import.
  loadingContainer: {
    padding: 60,
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 11,
    fontWeight: '700',
    color: TERMINAL.colors.muted,
    letterSpacing: 1,
  },
  failureWorkspaceCard: {
    marginTop: 16,
    backgroundColor: TERMINAL.colors.bgLight,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.22)',
    padding: 16,
    gap: 12,
  },
  failureWorkspaceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  failureWorkspaceTitle: {
    fontSize: 11,
    fontWeight: '900',
    color: TERMINAL.colors.error,
    letterSpacing: 1,
  },
  failureTabs: {
    flexDirection: 'row',
    gap: 8,
  },
  failureTab: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingVertical: 10,
    alignItems: 'center',
  },
  failureTabActive: {
    borderColor: 'rgba(56,189,248,0.35)',
    backgroundColor: 'rgba(56,189,248,0.08)',
  },
  failureTabText: {
    fontSize: 9,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    letterSpacing: 1,
  },
  failureTabTextActive: {
    color: TERMINAL.colors.cyan,
  },
  failurePanel: {
    gap: 8,
  },
  failureLabel: {
    fontSize: 9,
    fontWeight: '900',
    color: TERMINAL.colors.amber,
    letterSpacing: 1,
  },
  failureValue: {
    fontSize: 11,
    fontWeight: '800',
    color: 'white',
  },
  failureMessage: {
    fontSize: 10,
    lineHeight: 16,
    color: TERMINAL.colors.muted,
    fontWeight: '600',
  },
  failureEditor: {
    minHeight: 120,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.02)',
    padding: 12,
    color: 'white',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    textAlignVertical: 'top',
  },
  failureInlineError: {
    color: TERMINAL.colors.error,
    fontSize: 10,
    fontWeight: '700',
  },
  failureActions: {
    marginTop: 4,
  },
});

export default GeneratorScreen;
