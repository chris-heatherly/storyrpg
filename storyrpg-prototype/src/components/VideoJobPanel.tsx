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
} from 'react-native';
import {
  Film,
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
} from 'lucide-react-native';
import { TERMINAL } from '../theme';
import { useVideoJobStore, VideoJob } from '../stores/videoJobStore';

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

export const VideoJobPanel: React.FC = () => {
  const { jobs, activeJobId, setActiveJob, clearJobs } = useVideoJobStore();
  const jobList = useMemo(
    () => Object.values(jobs).sort((a, b) => a.startTime - b.startTime),
    [jobs]
  );
  const activeJob = activeJobId ? jobs[activeJobId] ?? null : null;
  const [detailsExpanded, setDetailsExpanded] = useState(false);

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

  if (totalCount === 0) return null;

  const renderStatusIcon = (status: VideoJob['status'], size = 14) => {
    switch (status) {
      case 'generating':
      case 'polling':
        return <Activity size={size} color={TERMINAL.colors.amber} />;
      case 'completed':
        return <CheckCircle2 size={size} color="rgb(168, 85, 247)" />;
      case 'failed':
        return <XCircle size={size} color={TERMINAL.colors.error} />;
      default:
        return <Clock size={size} color={TERMINAL.colors.muted} />;
    }
  };

  const isActive = (status: VideoJob['status']) => status === 'generating' || status === 'polling';

  const renderCard = (job: VideoJob) => {
    const isPending = job.status === 'pending';
    const isProcessing = isActive(job.status);

    const thumbContent = job.videoUrl && Platform.OS === 'web' ? (
      <video
        src={job.videoUrl}
        autoPlay
        loop
        muted
        playsInline
        style={{ width: '100%', height: '100%', objectFit: 'cover' } as any}
      />
    ) : job.sourceImageUrl ? (
      <Image source={{ uri: job.sourceImageUrl }} style={styles.jobThumb} />
    ) : null;

    const cardContent = (
      <TouchableOpacity
        key={job.id}
        style={[
          styles.jobCard,
          { width: cardWidth },
          isPending && styles.jobCardPending,
          isProcessing && styles.jobCardProcessing,
          job.status === 'failed' && styles.jobCardFailed,
          job.status === 'completed' && styles.jobCardCompleted,
        ]}
        onPress={() => setActiveJob(job.id)}
        activeOpacity={0.7}
      >
        <View style={[styles.jobImageBox, isPending && styles.jobImageBoxPending]}>
          {thumbContent ? thumbContent : (
            <View style={[styles.jobThumbFallback, isPending && styles.jobThumbFallbackPending]}>
              {renderStatusIcon(job.status, isPending ? 20 : 14)}
              {isPending && <Text style={styles.pendingLabel}>PENDING</Text>}
            </View>
          )}
          {isProcessing && !job.videoUrl && (
            <View style={styles.processingOverlay}>
              <Activity size={18} color={TERMINAL.colors.amber} />
              <Text style={styles.processingText}>
                {(job.progress || job.status).toUpperCase()}
              </Text>
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
              job.status === 'completed' && { color: 'rgb(168, 85, 247)' },
              job.status === 'failed' && { color: TERMINAL.colors.error },
            ]}
          >
            {(job.progress || job.status || 'unknown').toUpperCase()}
          </Text>
        </View>
      </TouchableOpacity>
    );

    if (isProcessing) {
      return <PulseCard key={job.id}>{cardContent}</PulseCard>;
    }
    return cardContent;
  };

  const renderLightboxMedia = () => {
    if (!activeJob) return null;
    if (activeJob.videoUrl && Platform.OS === 'web') {
      return (
        <video
          src={activeJob.videoUrl}
          autoPlay
          loop
          muted
          playsInline
          controls
          style={{ width: '100%', height: '100%', objectFit: 'contain' } as any}
        />
      );
    }
    if (activeJob.sourceImageUrl) {
      return (
        <Image
          source={{ uri: activeJob.sourceImageUrl }}
          style={styles.lightboxImage}
          resizeMode="contain"
        />
      );
    }
    return (
      <View style={styles.lightboxPlaceholder}>
        {renderStatusIcon(activeJob.status, 48)}
        <Text style={styles.lightboxPlaceholderText}>
          {activeJob.status === 'pending' ? 'AWAITING GENERATION' : isActive(activeJob.status) ? 'GENERATING VIDEO...' : 'NO VIDEO'}
        </Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Film size={16} color="rgb(168, 85, 247)" />
          <Text style={styles.headerTitle}>VIDEO SYNTHESIS</Text>
        </View>
        <TouchableOpacity onPress={clearJobs}>
          <Text style={styles.clearText}>CLEAR</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.summaryBar}>
        <View style={styles.summaryTrack}>
          <View style={[styles.summaryFill, { width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%` }]} />
        </View>
        <Text style={styles.summaryText}>
          {completedCount} OF {totalCount} VIDEOS COMPLETE
        </Text>
      </View>

      <View style={[styles.grid, { paddingHorizontal: GRID_PADDING, gap: GRID_GAP }]}>
        {jobList.map(renderCard)}
      </View>

      <Modal
        visible={activeJob !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setActiveJob(null)}
      >
        <View style={styles.lightboxContainer}>
          <TouchableOpacity
            style={styles.lightboxClose}
            onPress={() => setActiveJob(null)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <X size={28} color="white" />
          </TouchableOpacity>

          {activeJob && (
            <View style={styles.lightboxMediaArea}>
              {renderLightboxMedia()}

              <TouchableOpacity
                style={[styles.lightboxArrow, styles.lightboxArrowLeft, !hasPrev && styles.lightboxArrowHidden]}
                onPress={() => { if (hasPrev) setActiveJob(jobList[activeJobIndex - 1].id); }}
                disabled={!hasPrev}
                activeOpacity={0.6}
              >
                <ChevronLeft size={36} color="white" />
              </TouchableOpacity>

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
                <TouchableOpacity onPress={() => setDetailsExpanded(!detailsExpanded)}>
                  {detailsExpanded
                    ? <ChevronDown size={20} color={TERMINAL.colors.muted} />
                    : <ChevronUp size={20} color={TERMINAL.colors.muted} />}
                </TouchableOpacity>
              </View>

              {detailsExpanded && (
                <ScrollView style={styles.lightboxDetails} showsVerticalScrollIndicator={false}>
                  <View style={styles.statsRow}>
                    <View style={styles.statBox}>
                      <Text style={styles.statLabel}>STATUS</Text>
                      <Text style={styles.statValue}>
                        {(activeJob.status || 'UNKNOWN').toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.statBox}>
                      <Text style={styles.statLabel}>LATENCY</Text>
                      <Text style={styles.statValue}>
                        {activeJob.endTime
                          ? `${((activeJob.endTime - activeJob.startTime) / 1000).toFixed(1)}s`
                          : isActive(activeJob.status) ? `${((Date.now() - activeJob.startTime) / 1000).toFixed(0)}s...` : 'PENDING'}
                      </Text>
                    </View>
                  </View>
                  {activeJob.progress && (
                    <View style={styles.detailSection}>
                      <Text style={styles.detailLabel}>PROGRESS</Text>
                      <Text style={styles.progressText}>{activeJob.progress}</Text>
                    </View>
                  )}
                </ScrollView>
              )}
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0f1115',
    borderTopWidth: 1,
    borderTopColor: 'rgba(168, 85, 247, 0.15)',
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
    color: 'rgb(168, 85, 247)',
    letterSpacing: 1,
  },
  clearText: {
    fontSize: 9,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    letterSpacing: 0.5,
  },
  summaryBar: {
    marginHorizontal: GRID_PADDING,
    marginBottom: 12,
    backgroundColor: 'rgba(168, 85, 247, 0.06)',
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
    backgroundColor: 'rgb(168, 85, 247)',
  },
  summaryText: {
    color: TERMINAL.colors.muted,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
    textAlign: 'center',
  },
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
  jobCardCompleted: {
    borderColor: 'rgba(168, 85, 247, 0.3)',
    backgroundColor: 'rgba(168, 85, 247, 0.05)',
  },
  jobImageBox: {
    width: '100%',
    aspectRatio: 9 / 16,
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
  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  processingText: {
    fontSize: 8,
    fontWeight: '900',
    color: TERMINAL.colors.amber,
    letterSpacing: 0.5,
    textAlign: 'center',
    paddingHorizontal: 4,
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
  lightboxMediaArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lightboxImage: {
    width: '100%',
    height: '100%',
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
  progressText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 11,
    lineHeight: 16,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
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
});
