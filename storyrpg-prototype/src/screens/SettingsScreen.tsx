import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
} from 'react-native';
import {
  ChevronRight,
} from 'lucide-react-native';
import { StoryCatalogEntry } from '../types';
import { TERMINAL } from '../theme';
import { useSettingsStore, FontSize } from '../stores/settingsStore';
import { useGenerationJobStore, GenerationJob } from '../stores/generationJobStore';
import {
  DeveloperToolsSection,
  DisplayPreferencesSection,
  GenerationJobsSection,
  GeneratorLauncherSection,
  StoryLibrarySection,
  SystemInfoSection,
} from '../components/settings/SettingsSections';
import {
  CancelJobModal,
  DeleteStoryModal,
  RenameStoryModal,
} from '../components/settings/SettingsModals';

interface SettingsScreenProps {
  stories: StoryCatalogEntry[];
  onBack: () => void;
  onOpenVisualizer: (storyId: string) => void;
  onOpenGenerator: (jobId?: string) => void; // Optional jobId to resume viewing
  onDeleteStory?: (storyId: string) => void;
  onRenameStory?: (storyId: string, newTitle: string) => void;
  onGenerateVideos?: (storyId: string) => void;
  generatedStoryIds?: string[]; // IDs of stories that can be deleted
  onRefreshStories?: () => void;
  isRefreshing?: boolean;
  videoGeneratingStoryId?: string | null;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  stories,
  onBack,
  onOpenVisualizer,
  onOpenGenerator,
  onDeleteStory,
  onRenameStory,
  onGenerateVideos,
  generatedStoryIds = [],
  onRefreshStories,
  isRefreshing = false,
  videoGeneratingStoryId = null,
}) => {
  const fontSize = useSettingsStore((state) => state.fontSize);
  const setFontSize = useSettingsStore((state) => state.setFontSize);
  const developerMode = useSettingsStore((state) => state.developerMode);
  const setDeveloperMode = useSettingsStore((state) => state.setDeveloperMode);
  const preferVideo = useSettingsStore((state) => state.preferVideo);
  const setPreferVideo = useSettingsStore((state) => state.setPreferVideo);
  const fonts = useSettingsStore((state) => state.getFontSizes());
  const [confirmDeleteStory, setConfirmDeleteStory] = useState<StoryCatalogEntry | null>(null);
  const [renamingStory, setRenamingStory] = useState<StoryCatalogEntry | null>(null);
  const [newStoryTitle, setNewStoryTitle] = useState('');
  const [confirmCancelJob, setConfirmCancelJob] = useState<GenerationJob | null>(null);

  // Generation job tracking
  const { jobs, isLoaded: jobsLoaded, loadJobs, cancelJob, removeJob, clearCompletedJobs } = useGenerationJobStore();

  // Load jobs on mount and poll for updates
  useEffect(() => {
    loadJobs();
    const interval = setInterval(() => {
      loadJobs();
    }, 5000); // Poll every 5 seconds
    return () => clearInterval(interval);
  }, [loadJobs]);

  const formatJobTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'JUST NOW';
    if (diffMins < 60) return `${diffMins}M AGO`;
    if (diffHours < 24) return `${diffHours}H AGO`;
    return `${diffDays}D AGO`;
  };

  const formatEta = (seconds?: number | null) => {
    if (seconds === null || seconds === undefined || seconds < 0) return null;
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    if (mins > 0) return `${mins}M ${secs.toString().padStart(2, '0')}S`;
    return `${secs}S`;
  };

  const handleCancelJob = (job: GenerationJob) => {
    setConfirmCancelJob(job);
  };

  const confirmJobCancel = async () => {
    if (confirmCancelJob) {
      await cancelJob(confirmCancelJob.id);
    }
    setConfirmCancelJob(null);
  };

  const cancelJobCancel = () => {
    setConfirmCancelJob(null);
  };

  const activeJobs = jobs.filter(j => j.status === 'running' || j.status === 'pending');
  const recentJobs = jobs.filter(j => j.status !== 'running' && j.status !== 'pending').slice(0, 5);

  const handleDeleteStory = (story: StoryCatalogEntry) => {
    setConfirmDeleteStory(story);
  };

  const handleStartRename = (story: StoryCatalogEntry) => {
    setRenamingStory(story);
    setNewStoryTitle(story.title);
  };

  const confirmRename = () => {
    if (renamingStory && onRenameStory && newStoryTitle.trim()) {
      onRenameStory(renamingStory.id, newStoryTitle.trim());
    }
    setRenamingStory(null);
    setNewStoryTitle('');
  };

  const cancelRename = () => {
    setRenamingStory(null);
    setNewStoryTitle('');
  };

  const confirmDelete = () => {
    if (confirmDeleteStory && onDeleteStory) {
      onDeleteStory(confirmDeleteStory.id);
    }
    setConfirmDeleteStory(null);
  };

  const cancelDelete = () => {
    setConfirmDeleteStory(null);
  };

  const fontSizeOptions: { key: FontSize; label: string }[] = [
    { key: 'small', label: 'SMALL' },
    { key: 'medium', label: 'MEDIUM' },
    { key: 'large', label: 'LARGE' },
  ];

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerIconButton}
          onPress={onBack}
        >
          <ChevronRight
            size={20}
            color={TERMINAL.colors.muted}
            style={{ transform: [{ rotate: '180deg' }] }}
          />
          <Text style={styles.headerButtonText}>BACK</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>SYSTEM CONFIG</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView 
        style={styles.content} 
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.contentPadding}
      >
        <Text style={styles.systemStatus}>OPTIMIZING INTERFACE PARAMETERS</Text>

        <DisplayPreferencesSection
          styles={styles}
          fontSize={fontSize}
          fonts={fonts}
          fontSizeOptions={fontSizeOptions}
          preferVideo={preferVideo}
          onSetFontSize={setFontSize}
          onTogglePreferVideo={() => setPreferVideo(!preferVideo)}
        />

        <DeveloperToolsSection
          styles={styles}
          developerMode={developerMode}
          onToggleDeveloperMode={() => setDeveloperMode(!developerMode)}
        />

        <GeneratorLauncherSection
          styles={styles}
          onOpenGenerator={() => onOpenGenerator()}
        />

        <GenerationJobsSection
          styles={styles}
          jobs={jobs}
          jobsLoaded={jobsLoaded}
          activeJobs={activeJobs}
          recentJobs={recentJobs}
          onOpenGenerator={onOpenGenerator}
          onCancelJob={handleCancelJob}
          onRemoveJob={removeJob}
          onClearCompletedJobs={clearCompletedJobs}
          formatJobTime={formatJobTime}
          formatEta={formatEta}
        />

        <StoryLibrarySection
          styles={styles}
          stories={stories}
          generatedStoryIds={generatedStoryIds}
          onOpenVisualizer={onOpenVisualizer}
          onDeleteStory={onDeleteStory}
          onRenameStory={onRenameStory}
          onGenerateVideos={onGenerateVideos}
          onRequestDeleteStory={handleDeleteStory}
          onRequestRenameStory={handleStartRename}
          onRefreshStories={onRefreshStories}
          isRefreshing={isRefreshing}
          videoGeneratingStoryId={videoGeneratingStoryId}
        />

        <SystemInfoSection styles={styles} />

        <Text style={styles.footerText}>
          STORYRPG SYSTEMS • CORE VER 1.0.0{'\n'}
          © 2024 ALL RIGHTS RESERVED
        </Text>
      </ScrollView>

      <RenameStoryModal
        styles={styles}
        story={renamingStory}
        newTitle={newStoryTitle}
        onChangeTitle={setNewStoryTitle}
        onCancel={cancelRename}
        onConfirm={confirmRename}
      />

      <CancelJobModal
        styles={styles}
        job={confirmCancelJob}
        onCancel={cancelJobCancel}
        onConfirm={confirmJobCancel}
      />

      <DeleteStoryModal
        styles={styles}
        story={confirmDeleteStory}
        onCancel={cancelDelete}
        onConfirm={confirmDelete}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: TERMINAL.colors.bg,
  },
  header: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: 'white',
    letterSpacing: 2,
  },
  headerIconButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 8,
  },
  headerButtonText: {
    fontSize: 10,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    letterSpacing: 1,
  },
  content: {
    flex: 1,
  },
  contentPadding: {
    padding: 20,
    paddingBottom: 40,
  },
  systemStatus: {
    fontSize: 9,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    letterSpacing: 2,
    marginBottom: 30,
    textAlign: 'center',
  },
  section: {
    marginBottom: 32,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: TERMINAL.colors.primary,
    letterSpacing: 1,
  },
  sectionDesc: {
    fontSize: 10,
    color: TERMINAL.colors.muted,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 16,
    paddingLeft: 28,
  },
  settingCard: {
    backgroundColor: '#16191f',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    marginLeft: 28,
  },
  optionsGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  optionButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    backgroundColor: 'rgba(255,255,255,0.02)',
    alignItems: 'center',
  },
  optionButtonSelected: {
    borderColor: TERMINAL.colors.primary,
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
  },
  optionText: {
    fontSize: 10,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    letterSpacing: 1,
  },
  optionTextSelected: {
    color: TERMINAL.colors.primary,
  },
  previewBox: {
    backgroundColor: '#0f1115',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.03)',
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  previewLabel: {
    fontSize: 8,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    letterSpacing: 1,
  },
  previewText: {
    color: 'white',
    lineHeight: 24,
    marginBottom: 12,
  },
  previewMeta: {
    fontSize: 8,
    color: TERMINAL.colors.muted,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  sectionCardDivider: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
  },
  modeList: {
    gap: 10,
  },
  modeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  modeItemSelected: {
    borderColor: TERMINAL.colors.primary,
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
  },
  modeInfo: {
    flex: 1,
  },
  modeName: {
    fontSize: 11,
    fontWeight: '900',
    color: 'white',
    letterSpacing: 1,
    marginBottom: 2,
  },
  modeNameSelected: {
    color: TERMINAL.colors.primary,
  },
  modeDesc: {
    fontSize: 9,
    color: TERMINAL.colors.muted,
    fontWeight: '600',
  },
  activeIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: TERMINAL.colors.primary,
  },
  generatorActionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#1e2229',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.2)',
    marginLeft: 28,
    gap: 16,
  },
  generatorIconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: TERMINAL.colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  generatorActionInfo: {
    flex: 1,
  },
  generatorActionTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: 'white',
    letterSpacing: 1,
    marginBottom: 2,
  },
  generatorActionMeta: {
    fontSize: 9,
    color: TERMINAL.colors.amber,
    fontWeight: '700',
    opacity: 0.8,
  },
  storyManagementList: {
    marginLeft: 28,
    backgroundColor: '#16191f',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  storyManageItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.03)',
  },
  storyManageInfo: {
    flex: 1,
  },
  storyManageTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: 'white',
    marginBottom: 4,
  },
  storyManageMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  storyManageMeta: {
    fontSize: 9,
    color: TERMINAL.colors.muted,
    fontWeight: '700',
  },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: TERMINAL.colors.muted,
    opacity: 0.3,
  },
  storyTypeBadge: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1,
  },
  deleteIconButton: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  storyManageActions: {
    flexDirection: 'column',
    gap: 8,
    alignItems: 'flex-end',
  },
  storyActionButton: {
    minWidth: 92,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  storyActionText: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1,
  },
  renameIconButton: {
    padding: 10,
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderRadius: 10,
  },
  inputContainer: {
    width: '100%',
    marginBottom: 24,
  },
  inputLabel: {
    fontSize: 9,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    letterSpacing: 1,
    marginBottom: 8,
  },
  renameInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    padding: 16,
    color: 'white',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  miniRefreshButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(6, 182, 212, 0.1)',
    borderRadius: 6,
    marginLeft: 'auto',
  },
  miniRefreshText: {
    fontSize: 8,
    fontWeight: '900',
    color: TERMINAL.colors.cyan,
    letterSpacing: 1,
  },
  infoCard: {
    backgroundColor: '#16191f',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    marginLeft: 28,
    gap: 12,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  infoLabel: {
    fontSize: 10,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    letterSpacing: 1,
  },
  infoValue: {
    fontSize: 10,
    fontWeight: '900',
    color: 'white',
    letterSpacing: 1,
  },
  emptyCard: {
    marginLeft: 28,
    padding: 30,
    alignItems: 'center',
    backgroundColor: '#16191f',
    borderRadius: 20,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.05)',
  },
  emptyText: {
    fontSize: 10,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    letterSpacing: 2,
  },
  footerText: {
    fontSize: 9,
    color: TERMINAL.colors.muted,
    textAlign: 'center',
    marginTop: 40,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 1,
  },
  // Job tracking styles
  activeJobsBadge: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 'auto',
  },
  activeJobsBadgeText: {
    fontSize: 8,
    fontWeight: '900',
    color: TERMINAL.colors.amber,
    letterSpacing: 1,
  },
  jobsList: {
    marginLeft: 28,
    backgroundColor: '#16191f',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  jobItem: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.03)',
    position: 'relative',
  },
  jobItemActive: {
    backgroundColor: 'rgba(245, 158, 11, 0.05)',
    borderLeftWidth: 3,
    borderLeftColor: TERMINAL.colors.amber,
  },
  jobHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  jobStatusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  jobStatus: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  jobTime: {
    fontSize: 8,
    fontWeight: '700',
    color: TERMINAL.colors.muted,
    letterSpacing: 0.5,
  },
  jobTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: 'white',
    marginBottom: 4,
  },
  jobMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  jobPhase: {
    fontSize: 9,
    fontWeight: '700',
    color: TERMINAL.colors.muted,
  },
  jobEpisodes: {
    fontSize: 9,
    fontWeight: '700',
    color: TERMINAL.colors.muted,
  },
  jobError: {
    fontSize: 9,
    fontWeight: '600',
    color: TERMINAL.colors.error,
    marginTop: 4,
    opacity: 0.8,
  },
  jobTelemetryText: {
    fontSize: 9,
    fontWeight: '700',
    color: TERMINAL.colors.cyan,
    marginTop: 6,
    marginBottom: 4,
    letterSpacing: 0.4,
  },
  progressBarContainer: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 12,
  },
  progressBar: {
    height: '100%',
    backgroundColor: TERMINAL.colors.amber,
    borderRadius: 2,
  },
  jobActions: {
    flexDirection: 'row',
    gap: 8,
  },
  viewProgressButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.2)',
  },
  viewProgressButtonText: {
    fontSize: 10,
    fontWeight: '900',
    color: TERMINAL.colors.primary,
    letterSpacing: 1,
  },
  cancelJobButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  cancelJobButtonText: {
    fontSize: 10,
    fontWeight: '900',
    color: TERMINAL.colors.error,
    letterSpacing: 1,
  },
  removeJobButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    padding: 6,
  },
  removeJobButtonInline: {
    padding: 10,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 10,
  },
  viewDetailsButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    backgroundColor: 'rgba(6, 182, 212, 0.08)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(6, 182, 212, 0.15)',
  },
  viewDetailsButtonText: {
    fontSize: 10,
    fontWeight: '900',
    color: TERMINAL.colors.cyan,
    letterSpacing: 1,
  },
  jobEvents: {
    fontSize: 9,
    fontWeight: '700',
    color: TERMINAL.colors.muted,
  },
  jobsDivider: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  jobsDividerText: {
    fontSize: 8,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    letterSpacing: 2,
  },
  clearJobsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  clearJobsButtonText: {
    fontSize: 9,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    letterSpacing: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  confirmModal: {
    backgroundColor: '#16191f',
    padding: 30,
    borderRadius: 32,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  confirmHeaderIcon: {
    width: 64,
    height: 64,
    borderRadius: 24,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  confirmTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: 'white',
    letterSpacing: 1,
    marginBottom: 16,
  },
  confirmMessage: {
    fontSize: 12,
    color: TERMINAL.colors.muted,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 30,
    fontWeight: '600',
  },
  confirmStoryName: {
    color: TERMINAL.colors.error,
    fontWeight: '900',
  },
  confirmButtons: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  confirmButtonCancel: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
  },
  confirmButtonCancelText: {
    fontSize: 12,
    fontWeight: '900',
    color: 'white',
    letterSpacing: 1,
  },
  confirmButtonDelete: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: TERMINAL.colors.error,
    alignItems: 'center',
  },
  confirmButtonDeleteText: {
    fontSize: 12,
    fontWeight: '900',
    color: 'white',
    letterSpacing: 1,
  },
  // Developer Mode styles
  devModeBadge: {
    backgroundColor: 'rgba(6, 182, 212, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 'auto',
  },
  devModeBadgeText: {
    fontSize: 8,
    fontWeight: '900',
    color: TERMINAL.colors.cyan,
    letterSpacing: 1,
  },
  devModeToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  devModeInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flex: 1,
  },
  devModeIcons: {
    flexDirection: 'row',
    gap: 4,
  },
  devModeText: {
    flex: 1,
  },
  devModeTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  devModeTitleActive: {
    color: 'white',
  },
  devModeDesc: {
    fontSize: 10,
    color: TERMINAL.colors.muted,
    fontWeight: '600',
  },
  toggleSwitch: {
    width: 48,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.1)',
    padding: 3,
    justifyContent: 'center',
  },
  toggleSwitchActive: {
    backgroundColor: TERMINAL.colors.cyan,
  },
  toggleKnob: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  toggleKnobActive: {
    backgroundColor: 'white',
    alignSelf: 'flex-end',
  },
  devModeFeatures: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
    gap: 10,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  featureText: {
    fontSize: 10,
    color: TERMINAL.colors.muted,
    fontWeight: '600',
  },
});

export default SettingsScreen;
