import React from 'react';
import {
  ActivityIndicator,
  GestureResponderEvent,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  Bot,
  CheckCircle2,
  Clock,
  Code,
  Cpu,
  Edit2,
  Eye,
  Film,
  Info,
  Play,
  RefreshCw,
  StopCircle,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Type,
  XCircle,
} from 'lucide-react-native';
import type { StoryCatalogEntry } from '../../types';
import type { FontSize } from '../../stores/settingsStore';
import type { GenerationJob, JobStatus } from '../../stores/generationJobStore';
import { TERMINAL } from '../../theme';
import { APP_VERSION_LABEL } from '../../config/version';
import { SegmentedControl, Toggle } from '../ui';
import { PipelineProgress } from '../PipelineProgress';

type SettingsStyles = Record<string, any>;

interface SectionHeaderProps {
  styles: SettingsStyles;
  icon: React.ReactNode;
  title: string;
  description?: string;
  right?: React.ReactNode;
  titleColor?: string;
}

function SectionHeader({
  styles,
  icon,
  title,
  description,
  right,
  titleColor,
}: SectionHeaderProps) {
  return (
    <>
      <View style={styles.sectionHeaderRow}>
        {icon}
        <Text style={[styles.sectionTitle, titleColor ? { color: titleColor } : null]}>{title}</Text>
        {right}
      </View>
      {description ? <Text style={styles.sectionDesc}>{description}</Text> : null}
    </>
  );
}

interface DisplayPreferencesSectionProps {
  styles: SettingsStyles;
  fontSize: FontSize;
  fonts: { base: number };
  fontSizeOptions: Array<{ key: FontSize; label: string }>;
  preferVideo: boolean;
  onSetFontSize: (size: FontSize) => void;
  onTogglePreferVideo: () => void;
}

export function DisplayPreferencesSection({
  styles,
  fontSize,
  fonts,
  fontSizeOptions,
  preferVideo,
  onSetFontSize,
  onTogglePreferVideo,
}: DisplayPreferencesSectionProps) {
  return (
    <View style={styles.section}>
      <SectionHeader
        styles={styles}
        icon={<Type size={18} color={TERMINAL.colors.primary} />}
        title="DISPLAY SETTINGS"
        description="ADJUST TEXT SIZE FOR OPTIMAL CHRONICLE READABILITY"
      />

      <View style={styles.settingCard}>
        <SegmentedControl
          ariaLabel="Font size"
          options={fontSizeOptions.map((option) => ({ value: option.key, label: option.label }))}
          value={fontSize}
          onChange={onSetFontSize}
          testID="settings-font-size"
        />

        <View style={[styles.previewBox, { marginTop: 12 }]}>
          <View style={styles.previewHeader}>
            <Eye size={14} color={TERMINAL.colors.muted} />
            <Text style={styles.previewLabel}>LIVE PREVIEW</Text>
          </View>
          <Text style={[styles.previewText, { fontSize: fonts.base }]}>
            The quick brown fox jumps over the lazy dog.
          </Text>
          <Text style={styles.previewMeta}>
            BASE: {fonts.base}px • CURRENT: {fontSize.toUpperCase()}
          </Text>
        </View>

        <View style={styles.sectionCardDivider}>
          <Toggle
            value={preferVideo}
            onValueChange={() => onTogglePreferVideo()}
            label="PREFER VIDEO"
            helperText={preferVideo
              ? 'Show animated video clips when available'
              : 'Show still images even when video exists'}
            testID="settings-prefer-video"
          />
        </View>
      </View>
    </View>
  );
}

interface DeveloperToolsSectionProps {
  styles: SettingsStyles;
  developerMode: boolean;
  onToggleDeveloperMode: () => void;
}

export function DeveloperToolsSection({
  styles,
  developerMode,
  onToggleDeveloperMode,
}: DeveloperToolsSectionProps) {
  return (
    <View style={styles.section}>
      <SectionHeader
        styles={styles}
        icon={<Code size={18} color={developerMode ? TERMINAL.colors.cyan : TERMINAL.colors.muted} />}
        title="DEV MODE"
        titleColor={developerMode ? TERMINAL.colors.cyan : TERMINAL.colors.muted}
        description="DIAGNOSTIC AND FEEDBACK TOOLS FOR STORY READER"
        right={developerMode ? (
          <View style={styles.devModeBadge}>
            <Text style={styles.devModeBadgeText}>ACTIVE</Text>
          </View>
        ) : null}
      />

      <View style={styles.settingCard}>
        <Toggle
          value={developerMode}
          onValueChange={() => onToggleDeveloperMode()}
          label="DEV MODE"
          helperText="Image prompts, feedback, and regeneration"
          testID="settings-developer-mode"
        />

        {developerMode ? (
          <View style={styles.devModeFeatures}>
            <View style={styles.featureItem}>
              <Code size={12} color={TERMINAL.colors.cyan} />
              <Text style={styles.featureText}>View image generation prompts</Text>
            </View>
            <View style={styles.featureItem}>
              <ThumbsUp size={12} color={TERMINAL.colors.primary} />
              <Text style={styles.featureText}>Thumbs up to mark good images</Text>
            </View>
            <View style={styles.featureItem}>
              <ThumbsDown size={12} color={TERMINAL.colors.error} />
              <Text style={styles.featureText}>Thumbs down with feedback reasons</Text>
            </View>
            <View style={styles.featureItem}>
              <RefreshCw size={12} color={TERMINAL.colors.cyan} />
              <Text style={styles.featureText}>Regenerate rejected images</Text>
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

interface GeneratorLauncherSectionProps {
  styles: SettingsStyles;
  onOpenGenerator: () => void;
}

export function GeneratorLauncherSection({
  styles,
  onOpenGenerator,
}: GeneratorLauncherSectionProps) {
  return (
    <View style={styles.section}>
      <SectionHeader
        styles={styles}
        icon={<Bot size={18} color={TERMINAL.colors.amber} />}
        title="AI STORY GENERATOR"
        titleColor={TERMINAL.colors.amber}
        description="INITIATE NEURAL PIPELINE TO CREATE NEW NARRATIVES"
      />

      <TouchableOpacity
        style={styles.generatorActionCard}
        onPress={onOpenGenerator}
        activeOpacity={0.8}
      >
        <View style={styles.generatorIconBox}>
          <Bot size={24} color="white" />
        </View>
        <View style={styles.generatorActionInfo}>
          <Text style={styles.generatorActionTitle}>LAUNCH GENERATOR</Text>
          <Text style={styles.generatorActionMeta}>
            CREATE NEW EPISODES • REQUIRES API KEY
          </Text>
        </View>
      </TouchableOpacity>
    </View>
  );
}

function getJobStatusIcon(status: JobStatus) {
  switch (status) {
    case 'running':
      return <Play size={14} color={TERMINAL.colors.amber} />;
    case 'completed':
      return <CheckCircle2 size={14} color={TERMINAL.colors.primary} />;
    case 'failed':
      return <XCircle size={14} color={TERMINAL.colors.error} />;
    case 'cancelled':
      return <StopCircle size={14} color={TERMINAL.colors.muted} />;
    default:
      return <Clock size={14} color={TERMINAL.colors.muted} />;
  }
}

function getJobStatusColor(status: JobStatus) {
  switch (status) {
    case 'running':
      return TERMINAL.colors.amber;
    case 'completed':
      return TERMINAL.colors.primary;
    case 'failed':
      return TERMINAL.colors.error;
    case 'cancelled':
      return TERMINAL.colors.muted;
    default:
      return TERMINAL.colors.muted;
  }
}

interface GenerationJobsSectionProps {
  styles: SettingsStyles;
  jobs: GenerationJob[];
  jobsLoaded: boolean;
  activeJobs: GenerationJob[];
  recentJobs: GenerationJob[];
  onOpenGenerator: (jobId?: string) => void;
  onCancelJob: (job: GenerationJob) => void;
  onRemoveJob: (jobId: string) => void;
  onClearCompletedJobs: () => void;
  formatJobTime: (dateString: string) => string;
  formatEta: (seconds?: number | null) => string | null;
}

export function GenerationJobsSection({
  styles,
  jobs,
  jobsLoaded,
  activeJobs,
  recentJobs,
  onOpenGenerator,
  onCancelJob,
  onRemoveJob,
  onClearCompletedJobs,
  formatJobTime,
  formatEta,
}: GenerationJobsSectionProps) {
  return (
    <View style={styles.section}>
      <SectionHeader
        styles={styles}
        icon={<Cpu size={18} color={activeJobs.length > 0 ? TERMINAL.colors.amber : TERMINAL.colors.muted} />}
        title="GENERATION JOBS"
        titleColor={activeJobs.length > 0 ? TERMINAL.colors.amber : TERMINAL.colors.muted}
        description="MONITOR AND CONTROL STORY GENERATION PROCESSES"
        right={activeJobs.length > 0 ? (
          <View style={styles.activeJobsBadge}>
            <Text style={styles.activeJobsBadgeText}>{activeJobs.length} ACTIVE</Text>
          </View>
        ) : null}
      />

      {!jobsLoaded ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>LOADING JOBS...</Text>
        </View>
      ) : jobs.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>NO GENERATION JOBS</Text>
        </View>
      ) : (
        <View style={styles.jobsList}>
          {activeJobs.map((job) => (
            <View key={job.id} style={[styles.jobItem, styles.jobItemActive]}>
              <View style={styles.jobHeader}>
                <View style={styles.jobStatusIndicator}>
                  {getJobStatusIcon(job.status)}
                  <Text style={[styles.jobStatus, { color: getJobStatusColor(job.status) }]}>
                    {(job.status || 'unknown').toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.jobTime}>{formatJobTime(job.updatedAt)}</Text>
              </View>
              <Text style={styles.jobTitle}>{(job.storyTitle || 'Untitled').toUpperCase()}</Text>
              <View style={styles.jobMeta}>
                <Text style={styles.jobPhase}>{(job.currentPhase || 'unknown').toUpperCase()}</Text>
                <View style={styles.metaDot} />
                <Text style={styles.jobEpisodes}>
                  EP {job.currentEpisode}/{job.episodeCount}
                </Text>
              </View>
              {job.progress > 0 ? (
                <View style={styles.progressBarContainer}>
                  <View style={[styles.progressBar, { width: `${job.progress}%` }]} />
                </View>
              ) : null}
              {(job.subphaseLabel || typeof job.phaseProgress === 'number' || typeof job.etaSeconds === 'number') ? (
                <Text style={styles.jobTelemetryText}>
                  {job.subphaseLabel ? `${job.subphaseLabel.toUpperCase()} • ` : ''}
                  {typeof job.phaseProgress === 'number' ? `${Math.round(job.phaseProgress)}% PHASE • ` : ''}
                  {formatEta(job.etaSeconds) ? `ETA ${formatEta(job.etaSeconds)}` : ''}
                </Text>
              ) : null}
              {Array.isArray(job.events) && job.events.length > 0 ? (
                <View style={{ marginTop: 10 }}>
                  <PipelineProgress
                    events={job.events as any}
                    currentPhase={job.currentPhase}
                    isRunning={job.status === 'running'}
                    progress={job.progress}
                    etaSeconds={job.etaSeconds ?? null}
                  />
                </View>
              ) : null}
              <View style={styles.jobActions}>
                <TouchableOpacity
                  style={styles.viewProgressButton}
                  onPress={() => onOpenGenerator(job.id)}
                >
                  <Eye size={14} color={TERMINAL.colors.primary} />
                  <Text style={styles.viewProgressButtonText}>VIEW PROGRESS</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.cancelJobButton}
                  onPress={() => onCancelJob(job)}
                >
                  <StopCircle size={14} color={TERMINAL.colors.error} />
                  <Text style={styles.cancelJobButtonText}>STOP</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}

          {recentJobs.length > 0 ? (
            <>
              {activeJobs.length > 0 ? (
                <View style={styles.jobsDivider}>
                  <Text style={styles.jobsDividerText}>RECENT</Text>
                </View>
              ) : null}
              {recentJobs.map((job) => (
                <TouchableOpacity
                  key={job.id}
                  style={styles.jobItem}
                  onPress={() => onOpenGenerator(job.id)}
                  activeOpacity={0.7}
                >
                  <View style={styles.jobHeader}>
                    <View style={styles.jobStatusIndicator}>
                      {getJobStatusIcon(job.status)}
                      <Text style={[styles.jobStatus, { color: getJobStatusColor(job.status) }]}>
                        {(job.status || 'unknown').toUpperCase()}
                      </Text>
                    </View>
                    <Text style={styles.jobTime}>{formatJobTime(job.updatedAt)}</Text>
                  </View>
                  <Text style={styles.jobTitle}>{(job.storyTitle || 'Untitled').toUpperCase()}</Text>
                  <View style={styles.jobMeta}>
                    <Text style={styles.jobPhase}>{(job.currentPhase || 'unknown').toUpperCase()}</Text>
                    <View style={styles.metaDot} />
                    <Text style={styles.jobEpisodes}>
                      EP {job.currentEpisode}/{job.episodeCount}
                    </Text>
                    <View style={styles.metaDot} />
                    <Text style={styles.jobEvents}>{job.events?.length || 0} EVENTS</Text>
                  </View>
                  {job.error ? (
                    <Text style={styles.jobError} numberOfLines={2}>{job.error}</Text>
                  ) : null}
                  {(job.subphaseLabel || typeof job.phaseProgress === 'number' || typeof job.etaSeconds === 'number') ? (
                    <Text style={styles.jobTelemetryText}>
                      {job.subphaseLabel ? `${job.subphaseLabel.toUpperCase()} • ` : ''}
                      {typeof job.phaseProgress === 'number' ? `${Math.round(job.phaseProgress)}% PHASE • ` : ''}
                      {formatEta(job.etaSeconds) ? `ETA ${formatEta(job.etaSeconds)}` : ''}
                    </Text>
                  ) : null}
                  <View style={styles.jobActions}>
                    <View style={styles.viewDetailsButton}>
                      <Eye size={14} color={TERMINAL.colors.cyan} />
                      <Text style={styles.viewDetailsButtonText}>VIEW DETAILS</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.removeJobButtonInline}
                      onPress={(event: GestureResponderEvent) => {
                        event.stopPropagation();
                        onRemoveJob(job.id);
                      }}
                    >
                      <Trash2 size={14} color={TERMINAL.colors.muted} />
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
              ))}
            </>
          ) : null}

          {recentJobs.length > 0 ? (
            <TouchableOpacity
              style={styles.clearJobsButton}
              onPress={onClearCompletedJobs}
            >
              <Trash2 size={12} color={TERMINAL.colors.muted} />
              <Text style={styles.clearJobsButtonText}>CLEAR COMPLETED</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}
    </View>
  );
}

interface StoryLibrarySectionProps {
  styles: SettingsStyles;
  stories: StoryCatalogEntry[];
  generatedStoryIds: string[];
  onOpenVisualizer: (storyId: string) => void;
  onDeleteStory?: (storyId: string) => void;
  onRenameStory?: (storyId: string, newTitle: string) => void;
  onGenerateVideos?: (storyId: string) => void;
  onRequestDeleteStory: (story: StoryCatalogEntry) => void;
  onRequestRenameStory: (story: StoryCatalogEntry) => void;
  onRefreshStories?: () => void;
  isRefreshing: boolean;
  videoGeneratingStoryId?: string | null;
}

export function StoryLibrarySection({
  styles,
  stories,
  generatedStoryIds,
  onOpenVisualizer,
  onDeleteStory,
  onRenameStory,
  onGenerateVideos,
  onRequestDeleteStory,
  onRequestRenameStory,
  onRefreshStories,
  isRefreshing,
  videoGeneratingStoryId,
}: StoryLibrarySectionProps) {
  return (
    <View style={styles.section}>
      <SectionHeader
        styles={styles}
        icon={<RefreshCw size={18} color={TERMINAL.colors.cyan} />}
        title="STORY DATABASE"
        titleColor={TERMINAL.colors.cyan}
        description="VIEW ARCHITECTURE, RENAME CHRONICLES, OR PURGE DATA"
        right={onRefreshStories ? (
          <TouchableOpacity
            onPress={onRefreshStories}
            disabled={isRefreshing}
            style={styles.miniRefreshButton}
          >
            <RefreshCw
              size={12}
              color={TERMINAL.colors.cyan}
              style={isRefreshing ? { opacity: 0.5 } : null}
            />
            <Text style={styles.miniRefreshText}>{isRefreshing ? 'SCANNING' : 'REFRESH'}</Text>
          </TouchableOpacity>
        ) : null}
      />

      {stories.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>NO CHRONICLES DETECTED</Text>
        </View>
      ) : (
        <View style={styles.storyManagementList}>
          {stories.map((story) => {
            const isBuiltIn = story.isBuiltIn === true;
            const canGenerateVideo = Boolean(onGenerateVideos && story.outputDir);
            const canRename = Boolean(onRenameStory);
            const canDelete = Boolean(onDeleteStory);
            const showGeneratedBadge = generatedStoryIds.includes(story.id) && !isBuiltIn;

            return (
              <View key={story.id} style={styles.storyManageItem}>
                <View style={styles.storyManageInfo}>
                  <Text style={styles.storyManageTitle}>{(story.title || 'Untitled').toUpperCase()}</Text>
                  <View style={styles.storyManageMetaRow}>
                    <Text style={styles.storyManageMeta}>{(story.genre || 'unknown').toUpperCase()}</Text>
                    <View style={styles.metaDot} />
                    <Text
                      style={[
                        styles.storyTypeBadge,
                        { color: isBuiltIn ? TERMINAL.colors.muted : TERMINAL.colors.amber },
                      ]}
                    >
                      {isBuiltIn ? 'SAMPLE' : 'GENERATED'}
                    </Text>
                    {showGeneratedBadge ? (
                      <>
                        <View style={styles.metaDot} />
                        <Text style={[styles.storyTypeBadge, { color: TERMINAL.colors.primary }]}>LOCAL</Text>
                      </>
                    ) : null}
                  </View>
                </View>
                <View style={styles.storyManageActions}>
                  {canGenerateVideo ? (
                    <TouchableOpacity
                      style={[
                        styles.storyActionButton,
                        {
                          backgroundColor: videoGeneratingStoryId === story.id
                            ? 'rgba(245, 158, 11, 0.15)'
                            : 'rgba(168, 85, 247, 0.1)',
                        },
                      ]}
                      onPress={() => onGenerateVideos?.(story.id)}
                      disabled={videoGeneratingStoryId !== null}
                    >
                      {videoGeneratingStoryId === story.id ? (
                        <ActivityIndicator size={16} color={TERMINAL.colors.amber} />
                      ) : (
                        <>
                          <Film size={14} color="rgb(168, 85, 247)" />
                          <Text style={[styles.storyActionText, { color: 'rgb(168, 85, 247)' }]}>ANIMATE</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity
                    style={[styles.storyActionButton, { backgroundColor: 'rgba(6, 182, 212, 0.1)' }]}
                    onPress={() => onOpenVisualizer(story.id)}
                  >
                    <RefreshCw size={14} color={TERMINAL.colors.cyan} />
                    <Text style={[styles.storyActionText, { color: TERMINAL.colors.cyan }]}>MAP</Text>
                  </TouchableOpacity>
                  {canRename ? (
                    <TouchableOpacity
                      style={styles.storyActionButton}
                      onPress={() => onRequestRenameStory(story)}
                    >
                      <Edit2 size={14} color={TERMINAL.colors.primary} />
                      <Text style={[styles.storyActionText, { color: TERMINAL.colors.primary }]}>RENAME</Text>
                    </TouchableOpacity>
                  ) : null}
                  {canDelete ? (
                    <TouchableOpacity
                      style={[styles.storyActionButton, styles.deleteIconButton]}
                      onPress={() => onRequestDeleteStory(story)}
                    >
                      <Trash2 size={14} color={TERMINAL.colors.error} />
                      <Text style={[styles.storyActionText, { color: TERMINAL.colors.error }]}>DELETE</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

interface SystemInfoSectionProps {
  styles: SettingsStyles;
}

export function SystemInfoSection({ styles }: SystemInfoSectionProps) {
  return (
    <View style={styles.section}>
      <SectionHeader
        styles={styles}
        icon={<Info size={18} color={TERMINAL.colors.muted} />}
        title="SYSTEM INFO"
        titleColor={TERMINAL.colors.muted}
      />

      <View style={styles.infoCard}>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>APPLICATION</Text>
          <Text style={styles.infoValue}>STORYRPG ENGINE</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>VERSION</Text>
          <Text style={styles.infoValue}>{APP_VERSION_LABEL}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>STATUS</Text>
          <Text style={[styles.infoValue, { color: TERMINAL.colors.primary }]}>OPERATIONAL</Text>
        </View>
      </View>
    </View>
  );
}
