/**
 * Pipeline Progress Component
 *
 * Shows real-time progress of the AI generation pipeline.
 */

import React from 'react';
import { View, Text, StyleSheet, ScrollView, Animated } from 'react-native';
import { 
  CheckCircle2, 
  Circle, 
  Activity, 
  AlertCircle, 
  ChevronRight, 
  Bot, 
  Clock,
  Zap,
  Globe,
  Users,
  BookOpen,
  Edit3,
  Sword,
  ShieldCheck,
  Image as ImageIcon,
  Package,
  Volume2
} from 'lucide-react-native';
import { TERMINAL } from '../theme';

// Import PipelineEvent from canonical source
import type { PipelineEvent } from '../ai-agents/pipeline';

interface PipelineProgressProps {
  events: PipelineEvent[];
  currentPhase?: string;
  isRunning: boolean;
  progress?: number;
  etaSeconds?: number | null;
  imageProgress?: { current: number; total: number } | null;
}

const PHASES = [
  { id: 'source_analysis', name: 'SOURCE ANALYSIS', icon: BookOpen },
  { id: 'world', name: 'WORLD BUILDING', icon: Globe },
  { id: 'characters', name: 'CHARACTER DESIGN', icon: Users },
  { id: 'architecture', name: 'EPISODE BLUEPRINT', icon: Activity },
  { id: 'content', name: 'CONTENT WRITING', icon: Edit3 },
  { id: 'encounters', name: 'ENCOUNTER DESIGN', icon: Sword },
  { id: 'qa', name: 'QUALITY ASSURANCE', icon: ShieldCheck },
  { id: 'master_images', name: 'REFERENCE GENERATION', icon: BookOpen },
  { id: 'images', name: 'IMAGE GENERATION', icon: ImageIcon },
  { id: 'video_generation', name: 'VIDEO GENERATION', icon: Activity },
  { id: 'audio_generation', name: 'AUDIO GENERATION', icon: Volume2 },
  { id: 'assembly', name: 'FINAL ASSEMBLY', icon: Package },
  { id: 'saving', name: 'SAVING OUTPUTS', icon: Package },
];

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

export const PipelineProgress: React.FC<PipelineProgressProps> = ({
  events,
  currentPhase,
  isRunning,
  progress,
  etaSeconds,
  imageProgress,
}) => {
  const normalizedCurrentPhase = normalizePhaseId(currentPhase);
  const activeAgent = events.filter(e => e.type === 'agent_start').pop();
  const lastCompleteAgent = events.filter(e => e.type === 'agent_complete').pop();
  const currentAgent = activeAgent && (!lastCompleteAgent || events.indexOf(activeAgent) > events.indexOf(lastCompleteAgent)) 
    ? activeAgent.agent 
    : undefined;

  const getPhaseStatus = (phaseId: string) => {
    const phaseEvents = events.filter(e => normalizePhaseId(e.phase) === phaseId);
    const hasStart = phaseEvents.some(e => e.type === 'phase_start');
    const hasComplete = phaseEvents.some(e => e.type === 'phase_complete');
    const hasError = phaseEvents.some(e => e.type === 'error');

    if (hasError) return 'error';
    if (hasComplete) return 'complete';
    if (hasStart || normalizedCurrentPhase === phaseId) return 'active';
    return 'pending';
  };

  const renderStatusIcon = (status: string) => {
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

      {/* Current Agent Status */}
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

      {/* Phase Progress */}
      <View style={styles.phaseList}>
        {PHASES.map((phase, index) => {
          const status = getPhaseStatus(phase.id);
          const Icon = phase.icon;
          return (
            <View key={phase.id} style={styles.phaseRow}>
              <View style={styles.phaseIconContainer}>
                {renderStatusIcon(status)}
                {index < PHASES.length - 1 && (
                  <View style={[
                    styles.connector,
                    status === 'complete' && { backgroundColor: TERMINAL.colors.primary }
                  ]} />
                )}
              </View>
              <View style={[
                styles.phaseContent,
                status === 'active' && styles.phaseContentActive
              ]}>
                <Icon size={14} color={status === 'active' ? TERMINAL.colors.amber : TERMINAL.colors.muted} />
                <Text style={[
                  styles.phaseName,
                  status === 'complete' && styles.phaseTextComplete,
                  status === 'active' && styles.phaseTextActive,
                  status === 'error' && styles.phaseTextError,
                ]}>
                  {phase.name}
                </Text>
              </View>
            </View>
          );
        })}
      </View>

      {/* Event Log */}
      <View style={styles.logSection}>
        <View style={styles.logHeader}>
          <Clock size={12} color={TERMINAL.colors.muted} />
          <Text style={styles.logTitle}>LOG OUTPUT</Text>
        </View>
        <ScrollView 
          style={styles.logScroll}
          contentContainerStyle={styles.logContent}
          showsVerticalScrollIndicator={false}
        >
          {events.slice(-8).reverse().map((event, i) => (
            <View key={i} style={styles.logEntry}>
              <Text style={styles.logTime}>
                {event.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </Text>
              <View style={styles.logMessageContainer}>
                {event.type === 'error' ? <AlertCircle size={10} color={TERMINAL.colors.error} /> : 
                 event.type === 'checkpoint' ? <Clock size={10} color={TERMINAL.colors.amber} /> :
                 <ChevronRight size={10} color={TERMINAL.colors.primary} />}
                <Text style={[
                  styles.logMessage,
                  event.type === 'error' && styles.logError,
                  event.type === 'checkpoint' && styles.logCheckpoint,
                ]}>
                  {event.message.toUpperCase()}
                </Text>
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    </View>
  );
};

const getEventIcon = (type: string): string => {
  return ''; // Replaced by components
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#16191f',
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
    backgroundColor: '#0f1115',
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.2)',
  },
  progressCard: {
    backgroundColor: '#0f1115',
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
  phaseList: {
    marginBottom: 24,
    paddingLeft: 4,
  },
  phaseRow: {
    flexDirection: 'row',
    height: 40,
    alignItems: 'center',
  },
  phaseIconContainer: {
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
  connector: {
    position: 'absolute',
    top: 24,
    bottom: -8,
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  phaseContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginLeft: 12,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  phaseContentActive: {
    backgroundColor: 'rgba(245, 158, 11, 0.05)',
  },
  phaseName: {
    fontSize: 10,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    letterSpacing: 1,
  },
  phaseTextComplete: {
    color: TERMINAL.colors.primary,
  },
  phaseTextActive: {
    color: TERMINAL.colors.amber,
  },
  phaseTextError: {
    color: TERMINAL.colors.error,
  },
  logSection: {
    backgroundColor: '#0f1115',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.03)',
  },
  logHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  logTitle: {
    color: TERMINAL.colors.muted,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1,
  },
  logScroll: {
    maxHeight: 120,
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
