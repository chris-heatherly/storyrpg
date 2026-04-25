/**
 * Pipeline Progress Component
 *
 * Shows real-time progress of the AI generation pipeline.
 *
 * Phases are rolled up into four user-facing lifecycle bands (WORLD & CHARACTERS,
 * PLOT & SCENES, VISUALS, PACKAGE) so the user gets a glanceable "what's
 * happening now" instead of a flat stream of ~15 raw phase events. The raw
 * event log sits behind a collapsible Debug Log toggle for QA triage.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import {
  CheckCircle2,
  Circle,
  Activity,
  AlertCircle,
  ChevronRight,
  Bot,
  Clock,
  Zap,
  Users,
  BookOpen,
  Image as ImageIcon,
  Package,
} from 'lucide-react-native';
import { TERMINAL } from '../theme';

import type { PipelineEvent } from '../ai-agents/pipeline';

interface PipelineProgressProps {
  events: PipelineEvent[];
  currentPhase?: string;
  isRunning: boolean;
  progress?: number;
  etaSeconds?: number | null;
  imageProgress?: { current: number; total: number } | null;
  runtime?: PipelineRuntimeSnapshot | null;
}

export interface PipelineRuntimeSnapshot {
  jobId?: string;
  status?: string;
  currentPhase?: string;
  progress?: number;
  phaseProgress?: number;
  startedAt?: string;
  updatedAt?: string;
  elapsedSeconds?: number;
  etaSeconds?: number | null;
  currentItem?: number;
  totalItems?: number;
  subphaseLabel?: string;
  imageProgress?: { current: number; total: number } | null;
  imageJobs?: Array<{
    id?: string;
    identifier?: string;
    status?: string;
    progress?: number;
    imageUrl?: string;
    metadata?: Record<string, unknown>;
  }>;
  resumeFromJobId?: string;
  outputDirectory?: string;
}

/**
 * Sub-phase IDs reported by the pipeline (after normalizePhaseId), grouped by
 * lifecycle band. The mapping is intentional — adding a new phase means
 * deciding which user-facing band it belongs to, which keeps the UI stable.
 */
const BANDS = [
  {
    id: 'world',
    name: 'WORLD & CHARACTERS',
    icon: Users,
    subPhases: ['queued', 'initialization', 'source_analysis', 'world', 'characters', 'npc_validation'],
    subLabels: {
      source_analysis: 'Source analysis',
      queued: 'Queued',
      initialization: 'Initializing',
      world: 'World building',
      characters: 'Character design',
      npc_validation: 'NPC validation',
    } as Record<string, string>,
  },
  {
    id: 'plot',
    name: 'PLOT & SCENES',
    icon: BookOpen,
    subPhases: ['architecture', 'branch_analysis', 'content', 'scenes', 'choices', 'encounters', 'quick_validation', 'qa'],
    subLabels: {
      architecture: 'Episode blueprint',
      branch_analysis: 'Branch analysis',
      content: 'Scene writing',
      scenes: 'Scene writing',
      choices: 'Choice authoring',
      encounters: 'Encounter design',
      quick_validation: 'Quick validation',
      qa: 'Quality assurance',
    } as Record<string, string>,
  },
  {
    id: 'visuals',
    name: 'VISUALS',
    icon: ImageIcon,
    subPhases: ['master_images', 'images', 'video_generation'],
    subLabels: {
      master_images: 'Reference art',
      images: 'Scene imagery',
      video_generation: 'Video generation',
    } as Record<string, string>,
  },
  {
    id: 'package',
    name: 'PACKAGE',
    icon: Package,
    subPhases: ['assembly', 'saving', 'audio_generation', 'browser_qa'],
    subLabels: {
      assembly: 'Final assembly',
      saving: 'Saving outputs',
      audio_generation: 'Audio narration',
      browser_qa: 'Browser QA',
    } as Record<string, string>,
  },
] as const;

const normalizePhaseId = (phase?: string): string | undefined => {
  if (!phase) return undefined;
  if (phase === 'queued') return 'queued';
  if (phase === 'initialization' || phase === 'processing') return 'initialization';
  if (phase === 'multi_episode_init') return 'source_analysis';
  if (phase === 'foundation') return 'world';
  if (phase === 'world_bible') return 'world';
  if (phase === 'character_bible' || phase === 'character_design') return 'characters';
  if (phase === 'episode_parallelism') return 'content';
  if (phase.includes('architecture')) return 'architecture';
  if (phase.includes('branch')) return 'branch_analysis';
  if (phase.includes('scene')) return 'scenes';
  if (phase.includes('choice')) return 'choices';
  if (phase.includes('encounter') && !phase.includes('image')) return 'encounters';
  if (/^episode_\d+$/.test(phase)) return 'content';
  if (phase.startsWith('qa_ep_')) return 'qa';
  if (phase.startsWith('images_ep_')) return 'images';
  if (phase === 'encounter_images' || phase === 'image_manifest') return 'images';
  if (phase === 'final_story' || phase === 'final_story_package') return 'saving';
  return phase;
};

const labelForPhase = (phase?: string): string => {
  const normalized = normalizePhaseId(phase);
  for (const band of BANDS) {
    if (normalized && normalized in band.subLabels) return band.subLabels[normalized].toUpperCase();
  }
  return (phase || 'initializing').replace(/[_-]+/g, ' ').toUpperCase();
};

type PhaseStatus = 'pending' | 'active' | 'complete' | 'error';
type BandStatus = PhaseStatus;

export const PipelineProgress: React.FC<PipelineProgressProps> = ({
  events,
  currentPhase,
  isRunning,
  progress,
  etaSeconds,
  imageProgress,
  runtime,
}) => {
  const [showDebugLog, setShowDebugLog] = useState(false);
  const effectiveCurrentPhase = runtime?.currentPhase || currentPhase;
  const normalizedCurrentPhase = normalizePhaseId(effectiveCurrentPhase);

  const activeAgent = events.filter((e) => e.type === 'agent_start').pop();
  const lastCompleteAgent = events.filter((e) => e.type === 'agent_complete').pop();
  const currentAgent =
    activeAgent && (!lastCompleteAgent || events.indexOf(activeAgent) > events.indexOf(lastCompleteAgent))
      ? activeAgent.agent
      : undefined;
  const latestMeaningfulEvent = [...events]
    .reverse()
    .find((event) => String(event.message || '').trim().length > 0);

  const getPhaseStatus = (phaseId: string): PhaseStatus => {
    const phaseEvents = events.filter((e) => normalizePhaseId(e.phase) === phaseId);
    const hasStart = phaseEvents.some((e) => e.type === 'phase_start');
    const hasComplete = phaseEvents.some((e) => e.type === 'phase_complete');
    const hasError = phaseEvents.some((e) => e.type === 'error');

    if (hasError) return 'error';
    if (hasComplete) return 'complete';
    if (hasStart || normalizedCurrentPhase === phaseId) return 'active';
    return 'pending';
  };

  // Roll a band's status up from its sub-phases: error wins, then any active,
  // then all-complete, else pending.
  const getBandStatus = (subPhases: readonly string[]): BandStatus => {
    const statuses = subPhases.map(getPhaseStatus);
    if (statuses.includes('error')) return 'error';
    if (statuses.includes('active')) return 'active';
    if (statuses.every((s) => s === 'complete')) return 'complete';
    return 'pending';
  };

  // Progress share per band (0-100) reflects how many sub-phases have
  // completed or started. This gives a glanceable bar per band even before
  // the pipeline reports overallProgress.
  const getBandProgress = (subPhases: readonly string[]): number => {
    if (subPhases.length === 0) return 0;
    let score = 0;
    for (const id of subPhases) {
      const status = getPhaseStatus(id);
      if (status === 'complete') score += 1;
      else if (status === 'active') score += 0.5;
    }
    return Math.round((score / subPhases.length) * 100);
  };

  const getActiveSubLabel = (band: (typeof BANDS)[number]): string | undefined => {
    for (const id of band.subPhases) {
      const status = getPhaseStatus(id);
      if (status === 'active') return band.subLabels[id];
    }
    return undefined;
  };

  const normalizedProgress = Math.max(0, Math.min(100, Math.round(runtime?.progress ?? progress ?? 0)));
  const latestTelemetry = [...events].reverse().find((e) => !!e.telemetry)?.telemetry;
  const telemetryItemCurrent = runtime?.currentItem ?? runtime?.imageProgress?.current ?? latestTelemetry?.currentItem;
  const telemetryItemTotal = runtime?.totalItems ?? runtime?.imageProgress?.total ?? latestTelemetry?.totalItems;
  const telemetrySubphase = runtime?.subphaseLabel ?? latestTelemetry?.subphaseLabel;
  const remainingPercent = Math.max(0, 100 - normalizedProgress);
  const effectiveEta = runtime?.etaSeconds ?? etaSeconds;
  const effectiveImageProgress = runtime?.imageProgress || imageProgress;
  const imageJobs = runtime?.imageJobs || [];
  const imageCounts = imageJobs.reduce(
    (acc, job) => {
      const status = job.status || 'unknown';
      if (status === 'completed') acc.completed += 1;
      else if (status === 'failed') acc.failed += 1;
      else if (status === 'processing') acc.processing += 1;
      else acc.pending += 1;
      return acc;
    },
    { completed: 0, processing: 0, failed: 0, pending: 0 }
  );
  const activeImageJob = [...imageJobs].reverse().find((job) => job.status === 'processing')
    || [...imageJobs].reverse().find((job) => job.status === 'pending');
  const cacheHits = events.filter((event) => /cache HIT/i.test(String(event.message || ''))).length;
  const lastUpdateAgeSeconds = runtime?.updatedAt
    ? Math.max(0, Math.round((Date.now() - new Date(runtime.updatedAt).getTime()) / 1000))
    : undefined;
  const elapsedSeconds = runtime?.elapsedSeconds
    ?? (runtime?.startedAt ? Math.max(0, Math.round((Date.now() - new Date(runtime.startedAt).getTime()) / 1000)) : undefined);
  const formatEta = (seconds?: number | null) => {
    if (!seconds || seconds <= 0) return 'CALCULATING...';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    if (mins >= 60) {
      const hrs = Math.floor(mins / 60);
      const remMins = mins % 60;
      return `${hrs}H ${remMins}M`;
    }
    return `${mins}M ${secs.toString().padStart(2, '0')}S`;
  };
  const formatDuration = (seconds?: number | null) => {
    if (seconds === undefined || seconds === null) return 'UNKNOWN';
    const safe = Math.max(0, Math.round(seconds));
    const hrs = Math.floor(safe / 3600);
    const mins = Math.floor((safe % 3600) / 60);
    const secs = safe % 60;
    if (hrs > 0) return `${hrs}H ${mins}M`;
    if (mins > 0) return `${mins}M ${secs.toString().padStart(2, '0')}S`;
    return `${secs}S`;
  };

  const renderStatusIcon = (status: PhaseStatus) => {
    switch (status) {
      case 'complete':
        return <CheckCircle2 size={16} color={TERMINAL.colors.primary} />;
      case 'active':
        return <Activity size={16} color={TERMINAL.colors.amber} />;
      case 'error':
        return <AlertCircle size={16} color={TERMINAL.colors.error} />;
      default:
        return <Circle size={16} color={TERMINAL.colors.muted} opacity={0.3} />;
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Zap size={14} color={TERMINAL.colors.cyan} />
        <Text style={styles.headerTitle}>ACTIVE NEURAL PIPELINE</Text>
      </View>

      {(isRunning || normalizedProgress > 0) && (
        <View style={styles.progressCard}>
          <View style={styles.progressHeader}>
            <Text style={styles.progressLabel}>COMPLETION</Text>
            <Text style={styles.progressValue}>{normalizedProgress}%</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${normalizedProgress}%` }]} />
          </View>
          <View style={styles.progressMetaRow}>
            <Text style={styles.progressMeta}>{remainingPercent}% REMAINING</Text>
            <Text style={styles.progressMeta}>ETA {formatEta(effectiveEta)}</Text>
          </View>
          {effectiveImageProgress && effectiveImageProgress.total > 0 && normalizedCurrentPhase === 'images' && (
            <View style={styles.imageProgressRow}>
              <ImageIcon size={12} color={TERMINAL.colors.amber} />
              <Text style={styles.imageProgressText}>
                GENERATING IMAGE {effectiveImageProgress.current} OF {effectiveImageProgress.total}
              </Text>
            </View>
          )}
          {typeof telemetryItemCurrent === 'number' && typeof telemetryItemTotal === 'number' && telemetryItemTotal > 0 && (
            <View style={styles.imageProgressRow}>
              <Clock size={12} color={TERMINAL.colors.cyan} />
              <Text style={styles.imageProgressText}>
                {`${(telemetrySubphase || normalizedCurrentPhase || 'TASK').toUpperCase()} ${telemetryItemCurrent}/${telemetryItemTotal}`}
              </Text>
            </View>
          )}
        </View>
      )}

      {(runtime || latestMeaningfulEvent) && (
        <View style={styles.opsPanel}>
          <Text style={styles.opsEyebrow}>NOW</Text>
          <Text style={styles.opsTitle}>{labelForPhase(effectiveCurrentPhase)}</Text>
          <Text style={styles.opsMessage} numberOfLines={2}>
            {activeImageJob?.identifier
              ? `${String(activeImageJob.status || 'processing').toUpperCase()}: ${activeImageJob.identifier}`
              : String(latestMeaningfulEvent?.message || runtime?.subphaseLabel || 'Worker is active')}
          </Text>

          <View style={styles.opsGrid}>
            <View style={styles.opsMetric}>
              <Text style={styles.opsMetricLabel}>JOB</Text>
              <Text style={styles.opsMetricValue} numberOfLines={1}>{runtime?.jobId || 'LOCAL'}</Text>
            </View>
            <View style={styles.opsMetric}>
              <Text style={styles.opsMetricLabel}>HEARTBEAT</Text>
              <Text style={styles.opsMetricValue}>{lastUpdateAgeSeconds === undefined ? 'UNKNOWN' : `${lastUpdateAgeSeconds}S AGO`}</Text>
            </View>
            <View style={styles.opsMetric}>
              <Text style={styles.opsMetricLabel}>ELAPSED</Text>
              <Text style={styles.opsMetricValue}>{formatDuration(elapsedSeconds)}</Text>
            </View>
            <View style={styles.opsMetric}>
              <Text style={styles.opsMetricLabel}>ITEMS</Text>
              <Text style={styles.opsMetricValue}>
                {typeof telemetryItemCurrent === 'number' && typeof telemetryItemTotal === 'number'
                  ? `${telemetryItemCurrent}/${telemetryItemTotal}`
                  : 'N/A'}
              </Text>
            </View>
          </View>

          {(imageJobs.length > 0 || cacheHits > 0) && (
            <View style={styles.opsQueue}>
              <Text style={styles.opsQueueTitle}>IMAGE QUEUE</Text>
              <Text style={styles.opsQueueText}>
                {imageCounts.completed} done / {imageCounts.processing} active / {imageCounts.pending} queued / {imageCounts.failed} failed
                {cacheHits > 0 ? ` / ${cacheHits} cache hit event(s)` : ''}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Active Agent Status */}
      {isRunning && (
        <View style={styles.agentCard}>
          <View style={styles.agentHeader}>
            <Bot size={18} color={TERMINAL.colors.primary} />
            <Text style={styles.agentLabel}>ACTIVE AGENT</Text>
          </View>
          <Text style={styles.agentName}>
            {currentAgent ? currentAgent.toUpperCase() : labelForPhase(effectiveCurrentPhase)}
          </Text>
          {(activeAgent || latestMeaningfulEvent) && (
            <Text style={styles.agentMessage}>
              {String((activeAgent || latestMeaningfulEvent)?.message || '').toUpperCase()}
            </Text>
          )}
        </View>
      )}

      {/* Lifecycle Bands */}
      <View style={styles.bandList}>
        {BANDS.map((band) => {
          const status = getBandStatus(band.subPhases);
          const pct = getBandProgress(band.subPhases);
          const activeSubLabel = getActiveSubLabel(band);
          const Icon = band.icon;
          return (
            <View
              key={band.id}
              style={[
                styles.bandRow,
                status === 'active' && styles.bandRowActive,
                status === 'complete' && styles.bandRowComplete,
                status === 'error' && styles.bandRowError,
              ]}
            >
              <View style={styles.bandHeader}>
                <View style={styles.bandIconWrap}>{renderStatusIcon(status)}</View>
                <Icon
                  size={14}
                  color={
                    status === 'active'
                      ? TERMINAL.colors.amber
                      : status === 'complete'
                        ? TERMINAL.colors.primary
                        : status === 'error'
                          ? TERMINAL.colors.error
                          : TERMINAL.colors.muted
                  }
                />
                <Text
                  style={[
                    styles.bandName,
                    status === 'complete' && styles.bandNameComplete,
                    status === 'active' && styles.bandNameActive,
                    status === 'error' && styles.bandNameError,
                  ]}
                >
                  {band.name}
                </Text>
                <Text style={styles.bandPct}>{pct}%</Text>
              </View>
              <View style={styles.bandTrack}>
                <View
                  style={[
                    styles.bandFill,
                    { width: `${pct}%` },
                    status === 'active' && styles.bandFillActive,
                    status === 'complete' && styles.bandFillComplete,
                    status === 'error' && styles.bandFillError,
                  ]}
                />
              </View>
              {activeSubLabel && (
                <Text style={styles.bandSubLabel}>{activeSubLabel.toUpperCase()}</Text>
              )}
            </View>
          );
        })}
      </View>

      {/* Collapsible Debug Log */}
      <TouchableOpacity
        style={styles.debugToggle}
        onPress={() => setShowDebugLog((prev) => !prev)}
        accessibilityRole="button"
        accessibilityLabel={showDebugLog ? 'Hide debug log' : 'Show debug log'}
      >
        <Clock size={12} color={TERMINAL.colors.muted} />
        <Text style={styles.debugToggleText}>
          {showDebugLog ? 'HIDE DEBUG LOG' : 'SHOW DEBUG LOG'}
        </Text>
        <ChevronRight
          size={12}
          color={TERMINAL.colors.muted}
          style={{ marginLeft: 'auto', transform: [{ rotate: showDebugLog ? '90deg' : '0deg' }] }}
        />
      </TouchableOpacity>

      {showDebugLog && (
        <View style={styles.logSection}>
          <ScrollView
            style={styles.logScroll}
            contentContainerStyle={styles.logContent}
            showsVerticalScrollIndicator={false}
          >
            {events.slice(-20).reverse().map((event, i) => (
              <View key={i} style={styles.logEntry}>
                <Text style={styles.logTime}>
                  {event.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </Text>
                <View style={styles.logMessageContainer}>
                  {event.type === 'error' ? (
                    <AlertCircle size={10} color={TERMINAL.colors.error} />
                  ) : event.type === 'checkpoint' ? (
                    <Clock size={10} color={TERMINAL.colors.amber} />
                  ) : (
                    <ChevronRight size={10} color={TERMINAL.colors.primary} />
                  )}
                  <Text
                    style={[
                      styles.logMessage,
                      event.type === 'error' && styles.logError,
                      event.type === 'checkpoint' && styles.logCheckpoint,
                    ]}
                  >
                    {event.message.toUpperCase()}
                  </Text>
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: TERMINAL.colors.bgLight,
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 20,
  },
  headerTitle: {
    color: TERMINAL.colors.cyan,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
  },
  agentCard: {
    backgroundColor: TERMINAL.colors.bg,
    borderRadius: 16,
    padding: 18,
    minHeight: 118,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.2)',
  },
  progressCard: {
    backgroundColor: TERMINAL.colors.bg,
    borderRadius: 16,
    padding: 14,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.2)',
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  progressLabel: {
    color: TERMINAL.colors.cyan,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1,
  },
  progressValue: {
    color: 'white',
    fontSize: 12,
    fontWeight: '900',
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: TERMINAL.colors.primary,
  },
  progressMetaRow: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  imageProgressRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 4,
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    borderRadius: 8,
  },
  imageProgressText: {
    color: TERMINAL.colors.amber,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  opsPanel: {
    backgroundColor: 'rgba(59, 130, 246, 0.06)',
    borderRadius: 16,
    padding: 14,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.2)',
  },
  opsEyebrow: {
    color: TERMINAL.colors.cyan,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  opsTitle: {
    color: 'white',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0,
  },
  opsMessage: {
    color: TERMINAL.colors.muted,
    fontSize: 10,
    lineHeight: 15,
    marginTop: 6,
    fontWeight: '700',
  },
  opsGrid: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  opsMetric: {
    flexGrow: 1,
    flexBasis: '46%',
    backgroundColor: 'rgba(0,0,0,0.22)',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  opsMetricLabel: {
    color: TERMINAL.colors.muted,
    fontSize: 7,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 3,
  },
  opsMetricValue: {
    color: TERMINAL.colors.cyan,
    fontSize: 10,
    fontWeight: '900',
  },
  opsQueue: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  opsQueueTitle: {
    color: TERMINAL.colors.amber,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1,
  },
  opsQueueText: {
    color: TERMINAL.colors.muted,
    fontSize: 9,
    marginTop: 4,
    fontWeight: '800',
    letterSpacing: 0,
  },
  progressMeta: {
    color: TERMINAL.colors.muted,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  agentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  agentLabel: {
    color: TERMINAL.colors.primary,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1,
  },
  agentName: {
    color: 'white',
    fontSize: 16,
    fontWeight: '900',
    lineHeight: 21,
    letterSpacing: 0,
  },
  agentMessage: {
    color: TERMINAL.colors.muted,
    fontSize: 10,
    lineHeight: 15,
    marginTop: 8,
    fontWeight: '700',
    letterSpacing: 0,
    flexShrink: 1,
  },
  bandList: {
    gap: 12,
    marginBottom: 16,
  },
  bandRow: {
    backgroundColor: TERMINAL.colors.bg,
    borderRadius: 16,
    padding: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  bandRowActive: {
    borderColor: 'rgba(245, 158, 11, 0.35)',
    backgroundColor: 'rgba(245, 158, 11, 0.04)',
  },
  bandRowComplete: {
    borderColor: 'rgba(59, 130, 246, 0.25)',
  },
  bandRowError: {
    borderColor: 'rgba(239, 68, 68, 0.35)',
    backgroundColor: 'rgba(239, 68, 68, 0.04)',
  },
  bandHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  bandIconWrap: {
    width: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bandName: {
    flex: 1,
    fontSize: 11,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    letterSpacing: 1,
  },
  bandNameComplete: {
    color: TERMINAL.colors.primary,
  },
  bandNameActive: {
    color: TERMINAL.colors.amber,
  },
  bandNameError: {
    color: TERMINAL.colors.error,
  },
  bandPct: {
    fontSize: 10,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    letterSpacing: 0.5,
  },
  bandTrack: {
    height: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  bandFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: TERMINAL.colors.muted,
  },
  bandFillActive: {
    backgroundColor: TERMINAL.colors.amber,
  },
  bandFillComplete: {
    backgroundColor: TERMINAL.colors.primary,
  },
  bandFillError: {
    backgroundColor: TERMINAL.colors.error,
  },
  bandSubLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: TERMINAL.colors.amber,
    letterSpacing: 0.8,
    marginLeft: 30,
  },
  debugToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  debugToggleText: {
    color: TERMINAL.colors.muted,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  logSection: {
    backgroundColor: TERMINAL.colors.bg,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.03)',
  },
  logScroll: {
    maxHeight: 200,
  },
  logContent: {
    gap: 8,
  },
  logEntry: {
    flexDirection: 'row',
    gap: 10,
  },
  logTime: {
    color: TERMINAL.colors.muted,
    fontSize: 8,
    fontWeight: '600',
    width: 50,
  },
  logMessageContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  logMessage: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 8,
    fontWeight: '700',
    flex: 1,
    letterSpacing: 0.3,
  },
  logError: {
    color: TERMINAL.colors.error,
  },
  logCheckpoint: {
    color: TERMINAL.colors.amber,
  },
});

export default PipelineProgress;
