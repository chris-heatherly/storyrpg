import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Modal,
  Platform,
  useWindowDimensions,
  Animated,
  ScrollView,
  TextInput,
  Alert,
} from 'react-native';
import {
  ImageIcon,
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ThumbsDown,
} from 'lucide-react-native';
import { TERMINAL } from '../theme/terminal';
import { useImageJobStore, ImageJob } from '../stores/imageJobStore';
import { useImageFeedbackStore } from '../stores/imageFeedbackStore';
import { PROXY_CONFIG } from '../config/endpoints';

const GRID_GAP = 10;
const GRID_PADDING = 16;

function useColumns(width: number): number {
  if (width < 400) return 2;
  if (width <= 800) return 3;
  return 4;
}

const PulseCard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: false }),
        Animated.timing(opacity, { toValue: 0.4, duration: 800, useNativeDriver: false }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
};

type ReferenceThumbnail = {
  id: string;
  uri: string;
  characterName?: string;
  viewType?: string;
  role?: string;
};

export const ImageJobPanel: React.FC = () => {
  const { jobs, activeJobId, setActiveJob, clearCompletedJobs, updateJob } = useImageJobStore();
  const { loadFeedback, addFeedback, updateFeedback: updateStoredFeedback } = useImageFeedbackStore();
  const jobList = useMemo(
    () => Object.values(jobs).sort((a, b) => a.startTime - b.startTime),
    [jobs]
  );
  const activeJob = activeJobId ? jobs[activeJobId] ?? null : null;
  const [brokenThumbs, setBrokenThumbs] = useState<Record<string, boolean>>({});
  const [detailsExpanded, setDetailsExpanded] = useState(true);
  const [promptText, setPromptText] = useState<string | null>(null);
  const [isLoadingPrompt, setIsLoadingPrompt] = useState(false);
  const [selectedReferenceId, setSelectedReferenceId] = useState<string | null>(null);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackNotes, setFeedbackNotes] = useState('');
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [regenerationNotice, setRegenerationNotice] = useState<string | null>(null);

  const activeJobIndex = useMemo(
    () => (activeJobId ? jobList.findIndex((job) => job.id === activeJobId) : -1),
    [activeJobId, jobList]
  );
  const hasPrev = activeJobIndex > 0;
  const hasNext = activeJobIndex >= 0 && activeJobIndex < jobList.length - 1;

  const { width: windowWidth } = useWindowDimensions();
  const columns = useColumns(windowWidth);
  const cardWidth = Math.floor((windowWidth - GRID_PADDING * 2 - GRID_GAP * (columns - 1)) / columns);

  const completedCount = useMemo(() => jobList.filter((j) => j.status === 'completed').length, [jobList]);
  const totalCount = jobList.length;

  useEffect(() => {
    loadFeedback().catch(() => {});
  }, [loadFeedback]);

  useEffect(() => {
    if (!activeJob) {
      setPromptText(null);
      setSelectedReferenceId(null);
      setRegenerationNotice(null);
      return;
    }

    setDetailsExpanded(true);
    setSelectedReferenceId(null);
    setRegenerationNotice(null);

    const promptUrl = typeof activeJob.metadata?.promptUrl === 'string' ? activeJob.metadata.promptUrl : undefined;
    if (!promptUrl) {
      setPromptText(activeJob.prompt || null);
      return;
    }

    let cancelled = false;
    const loadPrompt = async () => {
      setIsLoadingPrompt(true);
      try {
        const response = await fetch(promptUrl);
        if (!response.ok) throw new Error('Prompt file not found');
        const data = await response.json();
        const prompt = data?.prompt;
        const nextPrompt = typeof prompt === 'string'
          ? prompt
          : prompt && typeof prompt === 'object'
            ? JSON.stringify(prompt, null, 2)
            : JSON.stringify(data, null, 2);
        if (!cancelled) setPromptText(nextPrompt);
      } catch {
        if (!cancelled) setPromptText(activeJob.prompt || 'Failed to load full prompt.');
      } finally {
        if (!cancelled) setIsLoadingPrompt(false);
      }
    };

    loadPrompt();
    return () => {
      cancelled = true;
    };
  }, [activeJob]);

  if (totalCount === 0) return null;

  const activeReferences: ReferenceThumbnail[] = Array.isArray(activeJob?.metadata?.referenceThumbnails)
    ? (activeJob?.metadata?.referenceThumbnails as ReferenceThumbnail[]).filter((ref) => !!ref?.uri)
    : [];
  const selectedReference = activeReferences.find((ref) => ref.id === selectedReferenceId) || null;

  const submitThumbsDown = async () => {
    if (!activeJob?.imageUrl) return;
    setIsSubmittingFeedback(true);
    setRegenerationNotice(null);
    try {
      const feedback = await addFeedback({
        storyId: 'generator-screen',
        sceneId: typeof activeJob.metadata?.sceneId === 'string' ? activeJob.metadata.sceneId : undefined,
        beatId: typeof activeJob.metadata?.beatId === 'string' ? activeJob.metadata.beatId : undefined,
        imageUrl: activeJob.imageUrl,
        originalPrompt: promptText || activeJob.prompt,
        rating: 'negative',
        notes: feedbackNotes.trim() || undefined,
      });

      const response = await fetch(`${PROXY_CONFIG.getProxyUrl()}/regenerate-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: activeJob.imageUrl,
          identifier: activeJob.identifier,
          promptUrl: activeJob.metadata?.promptUrl,
          promptPath: activeJob.metadata?.promptPath,
          metadata: activeJob.metadata,
          feedback: {
            notes: feedbackNotes.trim(),
          },
        }),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.success === false) {
        throw new Error(result?.error || result?.message || 'Failed to rerender image.');
      }

      if (result?.newImageUrl) {
        updateJob(activeJob.id, {
          imageUrl: result.newImageUrl,
          status: 'completed',
          endTime: Date.now(),
        });
        await updateStoredFeedback(feedback.id, {
          regenerated: true,
          regeneratedImageUrl: result.newImageUrl,
        });
        setRegenerationNotice('Image rerendered with your notes.');
      } else {
        setRegenerationNotice(result?.message || 'Rerender request submitted.');
      }

      setShowFeedbackModal(false);
      setFeedbackNotes('');
    } catch (error) {
      Alert.alert('Rerender Failed', error instanceof Error ? error.message : 'Failed to rerender image.');
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

  const renderStatusIcon = (status: ImageJob['status'], size = 14) => {
    switch (status) {
      case 'processing':
        return <Activity size={size} color={TERMINAL.colors.amber} />;
      case 'completed':
        return <CheckCircle2 size={size} color={TERMINAL.colors.primary} />;
      case 'failed':
        return <XCircle size={size} color={TERMINAL.colors.error} />;
      default:
        return <Clock size={size} color={TERMINAL.colors.muted} />;
    }
  };

  const renderCard = (job: ImageJob) => {
    const isPending = job.status === 'pending';
    const isProcessing = job.status === 'processing';

    const cardContent = (
      <TouchableOpacity
        key={job.id}
        style={[
          styles.jobCard,
          { width: cardWidth },
          isPending && styles.jobCardPending,
          isProcessing && styles.jobCardProcessing,
          job.status === 'failed' && styles.jobCardFailed,
        ]}
        onPress={() => setActiveJob(job.id)}
        activeOpacity={0.7}
      >
        <View style={[styles.jobImageBox, isPending && styles.jobImageBoxPending]}>
          {job.imageUrl && !brokenThumbs[job.id] ? (
            <Image
              source={{ uri: job.imageUrl }}
              style={styles.jobThumb}
              onError={() => setBrokenThumbs((prev) => ({ ...prev, [job.id]: true }))}
            />
          ) : (
            <View style={[styles.jobThumbFallback, isPending && styles.jobThumbFallbackPending]}>
              {renderStatusIcon(job.status, isPending ? 20 : 14)}
              {isPending && <Text style={styles.pendingLabel}>PENDING</Text>}
            </View>
          )}
        </View>
        <View style={styles.jobInfo}>
          <Text style={[styles.jobId, isPending && styles.jobIdPending]} numberOfLines={1}>
            {job.identifier.toUpperCase()}
          </Text>
          <Text
            style={[
              styles.jobStatus,
              isProcessing && { color: TERMINAL.colors.amber },
              job.status === 'completed' && { color: TERMINAL.colors.primary },
              job.status === 'failed' && { color: TERMINAL.colors.error },
            ]}
          >
            {(job.status || 'unknown').toUpperCase()}
          </Text>
        </View>
      </TouchableOpacity>
    );

    if (isProcessing) {
      return <PulseCard key={job.id}>{cardContent}</PulseCard>;
    }
    return cardContent;
  };

  return (
    <View style={styles.container}>
      {/* Header + Summary */}
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <ImageIcon size={16} color={TERMINAL.colors.primary} />
          <Text style={styles.headerTitle}>IMAGE SYNTHESIS</Text>
        </View>
        <TouchableOpacity onPress={clearCompletedJobs}>
          <Text style={styles.clearText}>CLEAR</Text>
        </TouchableOpacity>
      </View>

      {/* Summary bar */}
      <View style={styles.summaryBar}>
        <View style={styles.summaryTrack}>
          <View style={[styles.summaryFill, { width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%` }]} />
        </View>
        <Text style={styles.summaryText}>
          {completedCount} OF {totalCount} IMAGES COMPLETE
        </Text>
      </View>

      {/* Responsive Grid */}
      <View style={[styles.grid, { paddingHorizontal: GRID_PADDING, gap: GRID_GAP }]}>
        {jobList.map(renderCard)}
      </View>

      {/* Fullscreen Lightbox */}
      <Modal
        visible={activeJob !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setActiveJob(null)}
      >
        <View style={styles.lightboxContainer}>
          {/* Close button */}
          <TouchableOpacity
            style={styles.lightboxClose}
            onPress={() => setActiveJob(null)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <X size={28} color="white" />
          </TouchableOpacity>

          {/* Image area */}
          {activeJob && (
            <View style={styles.lightboxImageArea}>
              {selectedReference && activeJob.imageUrl ? (
                <View style={styles.compareStage}>
                  <View style={styles.comparePane}>
                    <Image source={{ uri: selectedReference.uri }} style={styles.compareImage} resizeMode="contain" />
                    <Text style={styles.compareLabel}>
                      {(selectedReference.characterName || selectedReference.role || 'REFERENCE').toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.compareDivider} />
                  <View style={styles.comparePane}>
                    <Image source={{ uri: activeJob.imageUrl }} style={styles.compareImage} resizeMode="contain" />
                    <Text style={styles.compareLabel}>GENERATED STORY IMAGE</Text>
                  </View>
                </View>
              ) : activeJob.imageUrl ? (
                <Image
                  source={{ uri: activeJob.imageUrl }}
                  style={styles.lightboxImage}
                  resizeMode="contain"
                />
              ) : (
                <View style={styles.lightboxPlaceholder}>
                  {renderStatusIcon(activeJob.status, 48)}
                  <Text style={styles.lightboxPlaceholderText}>
                    {activeJob.status === 'pending' ? 'AWAITING GENERATION' : activeJob.status === 'processing' ? 'GENERATING...' : 'NO IMAGE'}
                  </Text>
                </View>
              )}

              {activeReferences.length > 0 && (
                <View style={styles.referenceTray}>
                  {activeReferences.map((ref) => (
                    <TouchableOpacity
                      key={ref.id}
                      style={[
                        styles.referenceThumbButton,
                        selectedReferenceId === ref.id && styles.referenceThumbButtonActive,
                      ]}
                      onPress={() => setSelectedReferenceId((current) => current === ref.id ? null : ref.id)}
                      activeOpacity={0.8}
                    >
                      <Image source={{ uri: ref.uri }} style={styles.referenceThumbImage} />
                      <Text style={styles.referenceThumbLabel} numberOfLines={1}>
                        {(ref.characterName || ref.viewType || 'REF').toUpperCase()}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Left arrow */}
              <TouchableOpacity
                style={[styles.lightboxArrow, styles.lightboxArrowLeft, !hasPrev && styles.lightboxArrowHidden]}
                onPress={() => { if (hasPrev) setActiveJob(jobList[activeJobIndex - 1].id); }}
                disabled={!hasPrev}
                activeOpacity={0.6}
              >
                <ChevronLeft size={36} color="white" />
              </TouchableOpacity>

              {/* Right arrow */}
              <TouchableOpacity
                style={[styles.lightboxArrow, styles.lightboxArrowRight, !hasNext && styles.lightboxArrowHidden]}
                onPress={() => { if (hasNext) setActiveJob(jobList[activeJobIndex + 1].id); }}
                disabled={!hasNext}
                activeOpacity={0.6}
              >
                <ChevronRight size={36} color="white" />
              </TouchableOpacity>
            </View>
          )}

          {/* Bottom info bar */}
          {activeJob && (
            <View style={styles.lightboxInfoBar}>
              <View style={styles.lightboxInfoHeader}>
                <View style={styles.lightboxInfoLeft}>
                  {renderStatusIcon(activeJob.status)}
                  <Text style={styles.lightboxIdentifier} numberOfLines={1}>
                    {activeJob.identifier.toUpperCase()}
                  </Text>
                  <Text style={styles.lightboxCounter}>
                    {activeJobIndex + 1} / {totalCount}
                  </Text>
                </View>
                <View style={styles.lightboxActions}>
                  <TouchableOpacity
                    style={styles.feedbackButton}
                    onPress={() => {
                      setShowFeedbackModal(true);
                      setFeedbackNotes('');
                    }}
                  >
                    <ThumbsDown size={16} color={TERMINAL.colors.error} />
                    <Text style={styles.feedbackButtonText}>RERENDER</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setDetailsExpanded(!detailsExpanded)}>
                    {detailsExpanded
                      ? <ChevronDown size={20} color={TERMINAL.colors.muted} />
                      : <ChevronUp size={20} color={TERMINAL.colors.muted} />}
                  </TouchableOpacity>
                </View>
              </View>

              {regenerationNotice ? (
                <View style={styles.noticeBox}>
                  <Text style={styles.noticeText}>{regenerationNotice}</Text>
                </View>
              ) : null}

              {detailsExpanded && (
                <ScrollView style={styles.lightboxDetails} showsVerticalScrollIndicator={false}>
                  {(promptText || isLoadingPrompt) ? (
                    <View style={styles.detailSection}>
                      <Text style={styles.detailLabel}>FULL PROMPT</Text>
                      <View style={styles.promptBox}>
                        <Text style={styles.promptText}>
                          {isLoadingPrompt ? 'Loading prompt...' : promptText}
                        </Text>
                      </View>
                    </View>
                  ) : null}

                  {activeJob.error && (
                    <View style={[styles.detailSection, styles.errorBox]}>
                      <Text style={[styles.detailLabel, { color: TERMINAL.colors.error }]}>ERROR</Text>
                      <Text style={styles.errorText}>{activeJob.error}</Text>
                    </View>
                  )}

                  <View style={styles.statsRow}>
                    <View style={styles.statBox}>
                      <Text style={styles.statLabel}>ATTEMPTS</Text>
                      <Text style={styles.statValue}>
                        {activeJob.attempts} / {activeJob.maxRetries}
                      </Text>
                    </View>
                    <View style={styles.statBox}>
                      <Text style={styles.statLabel}>LATENCY</Text>
                      <Text style={styles.statValue}>
                        {activeJob.endTime
                          ? `${((activeJob.endTime - activeJob.startTime) / 1000).toFixed(1)}s`
                          : 'PENDING'}
                      </Text>
                    </View>
                  </View>
                </ScrollView>
              )}
            </View>
          )}
        </View>
      </Modal>

      <Modal
        visible={showFeedbackModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowFeedbackModal(false)}
      >
        <View style={styles.feedbackModalBackdrop}>
          <View style={styles.feedbackModalCard}>
            <Text style={styles.feedbackModalTitle}>RERENDER WITH NOTES</Text>
            <Text style={styles.feedbackModalCopy}>
              Describe what should change. Nano Banana will use edit-style regeneration when available; other providers will fall back to a modified rerender prompt.
            </Text>
            <TextInput
              value={feedbackNotes}
              onChangeText={setFeedbackNotes}
              placeholder="What should be fixed in this image?"
              placeholderTextColor={TERMINAL.colors.muted}
              multiline
              style={styles.feedbackInput}
            />
            <View style={styles.feedbackModalActions}>
              <TouchableOpacity
                style={styles.feedbackCancelButton}
                onPress={() => setShowFeedbackModal(false)}
                disabled={isSubmittingFeedback}
              >
                <Text style={styles.feedbackCancelButtonText}>CANCEL</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.feedbackSubmitButton}
                onPress={submitThumbsDown}
                disabled={isSubmittingFeedback}
              >
                <Text style={styles.feedbackSubmitButtonText}>
                  {isSubmittingFeedback ? 'RERENDERING...' : 'THUMBS DOWN + RERENDER'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0f1115',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
    paddingVertical: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: GRID_PADDING,
    marginBottom: 8,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 10,
    fontWeight: '900',
    color: TERMINAL.colors.primary,
    letterSpacing: 1,
  },
  clearText: {
    fontSize: 9,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    letterSpacing: 0.5,
  },

  // Summary bar
  summaryBar: {
    marginHorizontal: GRID_PADDING,
    marginBottom: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 8,
    padding: 8,
  },
  summaryTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
    marginBottom: 6,
  },
  summaryFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: TERMINAL.colors.primary,
  },
  summaryText: {
    color: TERMINAL.colors.muted,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
    textAlign: 'center',
  },

  // Grid
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  jobCard: {
    backgroundColor: '#16191f',
    borderRadius: 10,
    padding: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  jobCardPending: {
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  jobCardProcessing: {
    borderColor: 'rgba(245, 158, 11, 0.3)',
    backgroundColor: 'rgba(245, 158, 11, 0.05)',
  },
  jobCardFailed: {
    borderColor: 'rgba(239, 68, 68, 0.3)',
    backgroundColor: 'rgba(239, 68, 68, 0.05)',
  },
  jobImageBox: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.03)',
    overflow: 'hidden',
    marginBottom: 6,
  },
  jobImageBoxPending: {
    backgroundColor: 'rgba(255,255,255,0.015)',
  },
  jobThumb: {
    width: '100%',
    height: '100%',
  },
  jobThumbFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  jobThumbFallbackPending: {
    opacity: 0.5,
  },
  pendingLabel: {
    fontSize: 7,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    letterSpacing: 1,
  },
  jobInfo: {
    minHeight: 24,
  },
  jobId: {
    fontSize: 8,
    fontWeight: '900',
    color: 'white',
    letterSpacing: 0.3,
  },
  jobIdPending: {
    color: TERMINAL.colors.muted,
  },
  jobStatus: {
    fontSize: 7,
    fontWeight: '700',
    color: TERMINAL.colors.muted,
    marginTop: 1,
  },

  // Fullscreen Lightbox
  lightboxContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  lightboxClose: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 54 : 16,
    right: 16,
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxImageArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  compareStage: {
    flex: 1,
    width: '100%',
    flexDirection: 'row',
  },
  comparePane: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 40,
    paddingBottom: 20,
  },
  compareDivider: {
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  compareImage: {
    width: '100%',
    height: '100%',
  },
  compareLabel: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    color: 'white',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  lightboxImage: {
    width: '100%',
    height: '100%',
  },
  referenceTray: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 54 : 16,
    left: 16,
    zIndex: 9,
    gap: 8,
    maxWidth: 96,
  },
  referenceThumbButton: {
    width: 86,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 12,
    padding: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  referenceThumbButtonActive: {
    borderColor: TERMINAL.colors.primary,
    backgroundColor: 'rgba(59,130,246,0.18)',
  },
  referenceThumbImage: {
    width: '100%',
    height: 70,
    borderRadius: 8,
    marginBottom: 4,
  },
  referenceThumbLabel: {
    color: 'white',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  lightboxPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  lightboxPlaceholderText: {
    color: TERMINAL.colors.muted,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
  },
  lightboxArrow: {
    position: 'absolute',
    top: '50%',
    marginTop: -28,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxArrowLeft: {
    left: 12,
  },
  lightboxArrowRight: {
    right: 12,
  },
  lightboxArrowHidden: {
    opacity: 0,
  },

  // Bottom info bar
  lightboxInfoBar: {
    backgroundColor: '#16191f',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: Platform.OS === 'ios' ? 34 : 16,
    maxHeight: '40%',
  },
  lightboxInfoHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lightboxActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  feedbackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(239,68,68,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.2)',
  },
  feedbackButtonText: {
    color: TERMINAL.colors.error,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  noticeBox: {
    marginTop: 12,
    backgroundColor: 'rgba(34,197,94,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.2)',
    borderRadius: 10,
    padding: 10,
  },
  noticeText: {
    color: TERMINAL.colors.primary,
    fontSize: 10,
    fontWeight: '700',
  },
  lightboxInfoLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  lightboxIdentifier: {
    color: 'white',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.5,
    flex: 1,
  },
  lightboxCounter: {
    color: TERMINAL.colors.muted,
    fontSize: 11,
    fontWeight: '700',
  },
  lightboxDetails: {
    marginTop: 12,
  },

  // Detail sections (shared with lightbox)
  detailSection: {
    marginBottom: 16,
  },
  detailLabel: {
    fontSize: 9,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    letterSpacing: 1,
    marginBottom: 6,
  },
  promptBox: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  promptText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 11,
    lineHeight: 16,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  errorBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.05)',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  errorText: {
    color: TERMINAL.colors.error,
    fontSize: 11,
    fontWeight: '600',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  statBox: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 8,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 13,
    fontWeight: '900',
    color: 'white',
  },
  feedbackModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  feedbackModalCard: {
    width: '100%',
    maxWidth: 560,
    backgroundColor: '#16191f',
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  feedbackModalTitle: {
    color: 'white',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 8,
  },
  feedbackModalCopy: {
    color: TERMINAL.colors.muted,
    fontSize: 11,
    lineHeight: 18,
    marginBottom: 14,
  },
  feedbackInput: {
    minHeight: 130,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    color: 'white',
    padding: 12,
    textAlignVertical: 'top',
    fontSize: 12,
    lineHeight: 18,
  },
  feedbackModalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 16,
  },
  feedbackCancelButton: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  feedbackCancelButtonText: {
    color: TERMINAL.colors.muted,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  feedbackSubmitButton: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(239,68,68,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.25)',
  },
  feedbackSubmitButtonText: {
    color: TERMINAL.colors.error,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
});
