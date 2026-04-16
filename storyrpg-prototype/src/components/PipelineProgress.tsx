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
    subPhases: ['source_analysis', 'world', 'characters', 'npc_validation'],
    subLabels: {
      source_analysis: 'Source analysis',
      world: 'World building',
      characters: 'Character design',
      npc_validation: 'NPC validation',
    } as Record<string, string>,
  },
  {
    id: 'plot',
    name: 'PLOT & SCENES',
    icon: BookOpen,
    subPhases: ['architecture', 'branch_analysis', 'content', 'quick_validation', 'qa'],
    subLabels: {
      architecture: 'Episode blueprint',
      branch_analysis: 'Branch analysis',
      content: 'Scene writing',
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
  if (phase === 'multi_episode_init') return 'source_analysis';
  if (phase === 'foundation') return 'world';
  if (phase === 'episode_parallelism') return 'content';
  if (/^episode_\d+$/.test(phase)) return 'content';
  if (phase.startsWith('qa_ep_')) return 'qa';
  if (phase.startsWith('images_ep_')) return 'images';
  if (phase === 'encounter_images' || phase === 'image_manifest') return 'images';
  return phase;
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
}) => {
  const [showDebugLog, setShowDebugLog] = useState(false);
  const normalizedCurrentPhase = normalizePhaseId(currentPhase);

  const activeAgent = events.filter((e) => e.type === 'agent_start').pop();
  const lastCompleteAgent = events.filter((e) => e.type === 'agent_complete').pop();
  const currentAgent =
    activeAgent && (!lastCompleteAgent || events.indexOf(activeAgent) > events.indexOf(lastCompleteAgent))
      ? activeAgent.agent
      : undefined;

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

  const normalizedProgress = Math.max(0, Math.min(100, Math.round(progress ?? 0)));
  const latestTelemetry = [...events].reverse().find((e) => !!e.telemetry)?.telemetry;
  const telemetryItemCurrent = latestTelemetry?.currentItem;
  const telemetryItemTotal = latestTelemetry?.totalItems;
  const telemetrySubphase = latestTelemetry?.subphaseLabel;
  const remainingPercent = Math.max(0, 100 - normalizedProgress);
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
            <Text style={styles.progressMeta}>ETA {formatEta(etaSeconds)}</Text>
          </View>
          {imageProgress && imageProgress.total > 0 && normalizedCurrentPhase === 'images' && (
            <View style={styles.imageProgressRow}>
              <ImageIcon size={12} color={TERMINAL.colors.amber} />
              <Text style={styles.imageProgressText}>
                GENERATING IMAGE {imageProgress.current} OF {imageProgress.total}
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

      {/* Active Agent Status */}
      {isRunning && (
        <View style={styles.agentCard}>
          <View style={styles.agentHeader}>
            <Bot size={18} color={TERMINAL.colors.primary} />
            <Text style={styles.agentLabel}>ACTIVE AGENT</Text>
          </View>
          <Text style={styles.agentName}>
            {currentAgent ? currentAgent.toUpperCase() : 'INITIALIZING...'}
          </Text>
          {activeAgent && (
            <Text style={styles.agentMessage} numberOfLines={1}>
              {activeAgent.message.toUpperCase()}
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
    padding: 16,
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
    letterSpacing: 0.5,
  },
  agentMessage: {
    color: TERMINAL.colors.muted,
    fontSize: 9,
    marginTop: 6,
    fontWeight: '700',
    letterSpacing: 0.5,
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
