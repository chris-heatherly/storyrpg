import React from 'react';
import {
  ActivityIndicator,
  GestureResponderEvent,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  Bot,
  ChevronRight,
  CheckCircle2,
  Clock,
  Code,
  Cpu,
  Edit2,
  Eye,
  Film,
  Image as ImageIcon,
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

function normalizeContinuationKey(value?: string | null) {
  if (!value) return null;
  return value.trim().toLowerCase().replace(/\/+$/, '');
}

function getStoryContinuation(
  story: StoryCatalogEntry,
  continuations: Record<string, { planId: string; nextEpisodeNumber: number; totalEpisodes: number }>,
) {
  const keys = [
    story.id,
    story.outputDir,
    story.outputDir?.split('/').filter(Boolean).pop(),
    story.fullStoryUrl,
    story.title,
  ];

  for (const key of keys) {
    const normalized = normalizeContinuationKey(key);
    if (normalized && continuations[normalized]) return continuations[normalized];
  }
  return undefined;
}

type StoryEpisodeRow = {
  key: string;
  story: StoryCatalogEntry;
  episodeNumber: number;
  episodeTitle: string;
  episodeSynopsis?: string;
};

type StorySeasonGroup = {
  key: string;
  title: string;
  genre: string;
  isBuiltIn: boolean;
  isGeneratedLocal: boolean;
  continuation?: { planId: string; nextEpisodeNumber: number; totalEpisodes: number };
  rows: StoryEpisodeRow[];
};

function buildStorySeasonGroups(
  stories: StoryCatalogEntry[],
  generatedStoryIds: string[],
  continuations: Record<string, { planId: string; nextEpisodeNumber: number; totalEpisodes: number }>,
): StorySeasonGroup[] {
  const groups = new Map<string, StorySeasonGroup>();

  for (const story of stories) {
    const isBuiltIn = story.isBuiltIn === true;
    const seasonKey = (story.id || story.title).trim().toLowerCase();
    const continuation = getStoryContinuation(story, continuations);
    const existing = groups.get(seasonKey);
    const group = existing || {
      key: seasonKey,
      title: story.title || 'Untitled',
      genre: story.genre || 'unknown',
      isBuiltIn,
      isGeneratedLocal: false,
      continuation,
      rows: [],
    };

    group.isGeneratedLocal = group.isGeneratedLocal || (generatedStoryIds.includes(story.id) && !isBuiltIn);
    group.continuation = group.continuation || continuation;

    const episodes = story.episodes.length > 0
      ? story.episodes
      : [{
          id: story.id,
          number: 1,
          title: story.title || 'Episode',
          synopsis: story.synopsis || '',
          coverImage: story.coverImage || '',
        }];

    for (const episode of episodes) {
      group.rows.push({
        key: `${story.outputDir || story.id}:${episode.id || episode.number}`,
        story,
        episodeNumber: episode.number || group.rows.length + 1,
        episodeTitle: episode.title || story.title || 'Episode',
        episodeSynopsis: episode.synopsis || story.synopsis,
      });
    }

    group.rows.sort((a, b) => a.episodeNumber - b.episodeNumber);
    groups.set(seasonKey, group);
  }

  return Array.from(groups.values());
}

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

function getJobImageStatsLabel(job: GenerationJob) {
  const generatedFiles = job.imageStats?.generatedFiles ?? job.generatedImageCount;
  const resolvedSlots = job.imageStats?.resolvedSlots ?? job.resolvedImageSlotCount;
  const totalSlots = job.imageStats?.totalSlots ?? job.totalImageSlotCount;
  const missingSlots = job.imageStats?.missingSlots ?? job.missingImageSlotCount;
  if (typeof generatedFiles !== 'number' && typeof resolvedSlots !== 'number') return null;
  const parts: string[] = [];
  if (typeof generatedFiles === 'number') {
    parts.push(`${generatedFiles} IMAGE FILE${generatedFiles === 1 ? '' : 'S'}`);
  }
  if (typeof resolvedSlots === 'number' && typeof totalSlots === 'number' && totalSlots > 0) {
    parts.push(`${resolvedSlots}/${totalSlots} SLOTS`);
  } else if (typeof resolvedSlots === 'number') {
    parts.push(`${resolvedSlots} RESOLVED SLOT${resolvedSlots === 1 ? '' : 'S'}`);
  }
  if (typeof missingSlots === 'number' && missingSlots > 0) {
    parts.push(`${missingSlots} LEFT`);
  }
  return parts.join(' • ');
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
              {getJobImageStatsLabel(job) ? (
                <View style={styles.jobImageStatsRow}>
                  <ImageIcon size={13} color={TERMINAL.colors.cyan} />
                  <Text style={styles.jobImageStatsText}>{getJobImageStatsLabel(job)}</Text>
                </View>
              ) : null}
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
                  {getJobImageStatsLabel(job) ? (
                    <View style={styles.jobImageStatsRow}>
                      <ImageIcon size={13} color={TERMINAL.colors.cyan} />
                      <Text style={styles.jobImageStatsText}>{getJobImageStatsLabel(job)}</Text>
                    </View>
                  ) : null}
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
  onGenerateImages?: (storyId: string) => void;
  onDeleteSeasonImageReferences?: (story: StoryCatalogEntry) => void;
  onDeleteEpisodeArt?: (story: StoryCatalogEntry) => void;
  onContinueSeasonPlan?: (planId: string) => void;
  seasonContinuations?: Record<string, { planId: string; nextEpisodeNumber: number; totalEpisodes: number }>;
  onRequestDeleteStory: (story: StoryCatalogEntry) => void;
  onRequestRenameStory: (story: StoryCatalogEntry) => void;
  onRefreshStories?: () => void;
  isRefreshing: boolean;
  videoGeneratingStoryId?: string | null;
  imageGeneratingStoryId?: string | null;
  isDeletingSeasonReferences?: (story: StoryCatalogEntry) => boolean;
  isDeletingEpisodeArt?: (story: StoryCatalogEntry) => boolean;
}

export function StoryLibrarySection({
  styles,
  stories,
  generatedStoryIds,
  onOpenVisualizer,
  onDeleteStory,
  onRenameStory,
  onGenerateVideos,
  onGenerateImages,
  onDeleteSeasonImageReferences,
  onDeleteEpisodeArt,
  onContinueSeasonPlan,
  seasonContinuations = {},
  onRequestDeleteStory,
  onRequestRenameStory,
  onRefreshStories,
  isRefreshing,
  videoGeneratingStoryId,
  imageGeneratingStoryId,
  isDeletingSeasonReferences,
  isDeletingEpisodeArt,
}: StoryLibrarySectionProps) {
  const { width } = useWindowDimensions();
  const isNarrow = width < 860;
  const isCompact = width < 1120;
  const seasonGroups = buildStorySeasonGroups(stories, generatedStoryIds, seasonContinuations);

  const renderStoryAction = (
    key: string,
    label: string,
    icon: React.ReactNode,
    color: string,
    onPress: () => void,
    options?: { disabled?: boolean; loading?: boolean; danger?: boolean; backgroundColor?: string },
  ) => {
    const disabled = options?.disabled === true;
    const actionColor = disabled ? TERMINAL.colors.muted : color;
    return (
      <TouchableOpacity
        key={key}
        style={[
          styles.storyActionButton,
          options?.danger ? styles.deleteIconButton : null,
          options?.backgroundColor ? { backgroundColor: options.backgroundColor } : null,
          disabled ? styles.storyActionButtonDisabled : null,
        ]}
        onPress={onPress}
        disabled={disabled}
      >
        {options?.loading ? (
          <ActivityIndicator size={16} color={TERMINAL.colors.amber} />
        ) : (
          <>
            {React.isValidElement(icon) ? React.cloneElement(icon as React.ReactElement<any>, { color: actionColor }) : icon}
            <Text style={[styles.storyActionText, { color: actionColor }]}>{label}</Text>
          </>
        )}
      </TouchableOpacity>
    );
  };

  const renderActionRows = (actions: React.ReactNode[]) => {
    const chunkSize = isCompact ? 3 : actions.length;
    const rows: React.ReactNode[] = [];
    for (let i = 0; i < actions.length; i += chunkSize) {
      rows.push(
        <View key={`row-${i}`} style={styles.storyActionRow}>
          {actions.slice(i, i + chunkSize)}
        </View>
      );
    }
    return <View style={[styles.storyManageActions, isNarrow ? styles.storyManageActionsNarrow : null]}>{rows}</View>;
  };

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

      {seasonGroups.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>NO CHRONICLES DETECTED</Text>
        </View>
      ) : (
        <View style={styles.storyManagementList}>
          {seasonGroups.map((group) => {
            const representativeStory = group.rows.find((row) => row.story.outputDir && row.story.isBuiltIn !== true)?.story || group.rows[0]?.story;
            const canDeleteSeasonRefs = Boolean(
              onDeleteSeasonImageReferences
              && representativeStory?.outputDir
              && representativeStory.isBuiltIn !== true
            );
            const seasonRefsAvailable = representativeStory?.imageArtifacts?.hasSeasonReferences === true;
            const seasonRefsDeleting = Boolean(representativeStory && isDeletingSeasonReferences?.(representativeStory));
            const headerActions: React.ReactNode[] = [];
            if (group.continuation && onContinueSeasonPlan) {
              headerActions.push(renderStoryAction(
                'continue',
                `NEXT EP ${group.continuation.nextEpisodeNumber}/${group.continuation.totalEpisodes}`,
                <ChevronRight size={14} color={TERMINAL.colors.amber} />,
                TERMINAL.colors.amber,
                () => onContinueSeasonPlan(group.continuation!.planId),
                { backgroundColor: 'rgba(245, 158, 11, 0.12)' },
              ));
            }
            if (canDeleteSeasonRefs && representativeStory) {
              headerActions.push(renderStoryAction(
                'clear-refs',
                'CLEAR REFS',
                <Trash2 size={14} color={TERMINAL.colors.amber} />,
                TERMINAL.colors.amber,
                () => onDeleteSeasonImageReferences?.(representativeStory),
                {
                  disabled: !seasonRefsAvailable || seasonRefsDeleting,
                  loading: seasonRefsDeleting,
                  backgroundColor: seasonRefsAvailable ? 'rgba(245, 158, 11, 0.1)' : undefined,
                },
              ));
            }
            return (
              <View key={group.key} style={styles.storySeasonGroup}>
                <View style={[styles.storySeasonHeader, isNarrow ? styles.storySeasonHeaderNarrow : null]}>
                  <View style={styles.storyManageInfo}>
                    <Text style={styles.storyManageTitle}>{group.title.toUpperCase()}</Text>
                    <View style={styles.storyManageMetaRow}>
                      <Text style={styles.storyManageMeta}>{group.genre.toUpperCase()}</Text>
                      <View style={styles.metaDot} />
                      <Text
                        style={[
                          styles.storyTypeBadge,
                          { color: group.isBuiltIn ? TERMINAL.colors.muted : TERMINAL.colors.amber },
                        ]}
                      >
                        {group.isBuiltIn ? 'SAMPLE' : 'GENERATED'}
                      </Text>
                      {group.isGeneratedLocal ? (
                        <>
                          <View style={styles.metaDot} />
                          <Text style={[styles.storyTypeBadge, { color: TERMINAL.colors.primary }]}>LOCAL</Text>
                        </>
                      ) : null}
                      <View style={styles.metaDot} />
                      <Text style={styles.storyManageMeta}>{group.rows.length} EPISODE{group.rows.length === 1 ? '' : 'S'}</Text>
                    </View>
                  </View>
                  {headerActions.length > 0 ? renderActionRows(headerActions) : null}
                </View>

                {group.rows.map((row) => {
                  const story = row.story;
                  const canGenerateVideo = Boolean(onGenerateVideos && story.outputDir);
                  const canGenerateImages = Boolean(
                    onGenerateImages
                    && story.outputDir
                    && story.isBuiltIn !== true
                  );
                  const canDeleteEpisodeArt = Boolean(
                    onDeleteEpisodeArt
                    && story.outputDir
                    && story.isBuiltIn !== true
                  );
                  const episodeArtAvailable = story.imageArtifacts?.hasEpisodeArt === true;
                  const episodeArtDeleting = Boolean(isDeletingEpisodeArt?.(story));
                  const canRename = Boolean(onRenameStory);
                  const canDelete = Boolean(onDeleteStory);
                  const rowActions: React.ReactNode[] = [];
                  if (canGenerateVideo) {
                    rowActions.push(renderStoryAction(
                      'animate',
                      'ANIMATE',
                      <Film size={14} color="rgb(168, 85, 247)" />,
                      'rgb(168, 85, 247)',
                      () => onGenerateVideos?.(story.id),
                      {
                        loading: videoGeneratingStoryId === story.id,
                        disabled: videoGeneratingStoryId !== null,
                        backgroundColor: videoGeneratingStoryId === story.id ? 'rgba(245, 158, 11, 0.15)' : 'rgba(168, 85, 247, 0.1)',
                      },
                    ));
                  }
                  if (canGenerateImages) {
                    rowActions.push(renderStoryAction(
                      'images',
                      'IMAGES',
                      <ImageIcon size={14} color={TERMINAL.colors.primary} />,
                      TERMINAL.colors.primary,
                      () => onGenerateImages?.(story.id),
                      {
                        loading: imageGeneratingStoryId === story.id,
                        disabled: imageGeneratingStoryId !== null,
                        backgroundColor: imageGeneratingStoryId === story.id ? 'rgba(245, 158, 11, 0.15)' : 'rgba(59, 130, 246, 0.12)',
                      },
                    ));
                  }
                  if (canDeleteEpisodeArt) {
                    rowActions.push(renderStoryAction(
                      'clear-art',
                      'CLEAR ART',
                      <Trash2 size={14} color={TERMINAL.colors.error} />,
                      TERMINAL.colors.error,
                      () => onDeleteEpisodeArt?.(story),
                      {
                        disabled: !episodeArtAvailable || episodeArtDeleting,
                        loading: episodeArtDeleting,
                        backgroundColor: episodeArtAvailable ? 'rgba(239, 68, 68, 0.1)' : undefined,
                      },
                    ));
                  }
                  rowActions.push(renderStoryAction(
                    'map',
                    'MAP',
                    <RefreshCw size={14} color={TERMINAL.colors.cyan} />,
                    TERMINAL.colors.cyan,
                    () => onOpenVisualizer(story.id),
                    { backgroundColor: 'rgba(6, 182, 212, 0.1)' },
                  ));
                  if (canRename) {
                    rowActions.push(renderStoryAction(
                      'rename',
                      'RENAME',
                      <Edit2 size={14} color={TERMINAL.colors.primary} />,
                      TERMINAL.colors.primary,
                      () => onRequestRenameStory(story),
                    ));
                  }
                  if (canDelete) {
                    rowActions.push(renderStoryAction(
                      'delete',
                      'DELETE',
                      <Trash2 size={14} color={TERMINAL.colors.error} />,
                      TERMINAL.colors.error,
                      () => onRequestDeleteStory(story),
                      { danger: true },
                    ));
                  }

                  return (
                    <View key={row.key} style={[styles.storyManageItem, isNarrow ? styles.storyManageItemNarrow : null]}>
                      <View style={styles.storyEpisodeNumber}>
                        <Text style={styles.storyEpisodeNumberText}>EP</Text>
                        <Text style={styles.storyEpisodeNumberValue}>{row.episodeNumber}</Text>
                      </View>
                      <View style={styles.storyManageInfo}>
                        <Text style={styles.storyEpisodeTitle}>{(row.episodeTitle || 'Untitled').toUpperCase()}</Text>
                        <View style={styles.storyManageMetaRow}>
                          <Text style={styles.storyManageMeta}>{story.imagesStatus ? `IMAGES ${story.imagesStatus.toUpperCase()}` : 'READY'}</Text>
                          {story.outputDir ? (
                            <>
                              <View style={styles.metaDot} />
                              <Text style={styles.storyManageMeta}>{story.outputDir.split('/').filter(Boolean).pop()}</Text>
                            </>
                          ) : null}
                        </View>
                      </View>
                      {renderActionRows(rowActions)}
                    </View>
                  );
                })}
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
