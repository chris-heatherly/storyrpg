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
  Clock,
  Image as ImageIcon,
} from 'lucide-react-native';
import { TERMINAL } from '../theme';

import type { PipelineEvent } from '../ai-agents/pipeline';
import type { GenerationPlan, EpisodeNode, SceneNode } from '../types/generationPlan';

interface PipelineProgressProps {
  events: PipelineEvent[];
  currentPhase?: string;
  isRunning: boolean;
  progress?: number;
  etaSeconds?: number | null;
  imageProgress?: { current: number; total: number } | null;
  runtime?: PipelineRuntimeSnapshot | null;
  /** Story title shown as the hero headline. */
  storyTitle?: string;
}

export interface PipelineRuntimeSnapshot {
  jobId?: string;
  friendlyName?: string;
  processTitle?: string;
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
    metadata?: {
      sceneId?: string;
      beatId?: string;
      type?: string;
      [key: string]: unknown;
    };
  }>;
  imageManifest?: Array<{
    identifier?: string;
    sceneId?: string;
    beatId?: string;
    description?: string;
  }>;
  resumeFromJobId?: string;
  outputDirectory?: string;
  generationPlan?: GenerationPlan;
}

/**
 * The five lifecycle steps shown in the horizontal phase rail. Each maps to the
 * set of pipeline sub-phase IDs (after normalizePhaseId) it rolls up. Adding a
 * new phase means deciding which step it belongs to, which keeps the UI stable.
 */
const STEPS = [
  { id: 'world', name: 'WORLD', subPhases: ['queued', 'initialization', 'source_analysis', 'season_plan', 'world'] },
  { id: 'characters', name: 'CHARACTERS', subPhases: ['characters', 'npc_validation'] },
  { id: 'episodes', name: 'EPISODES', subPhases: ['architecture', 'branch_analysis', 'content', 'scenes', 'choices', 'encounters', 'quick_validation', 'qa'] },
  { id: 'visuals', name: 'VISUALS', subPhases: ['master_images', 'images', 'video_generation'] },
  { id: 'package', name: 'PACKAGE', subPhases: ['assembly', 'saving', 'audio_generation', 'browser_qa'] },
] as const;

/** Human labels for normalized sub-phase IDs, used by the NOW panel. */
const PHASE_LABELS: Record<string, string> = {
  source_analysis: 'Source analysis',
  season_plan: 'Season planning',
  queued: 'Queued',
  initialization: 'Initializing',
  world: 'World building',
  characters: 'Character design',
  npc_validation: 'NPC validation',
  architecture: 'Episode blueprint',
  branch_analysis: 'Branch analysis',
  content: 'Scene writing',
  scenes: 'Scene writing',
  choices: 'Choice authoring',
  encounters: 'Encounter design',
  quick_validation: 'Quick validation',
  qa: 'Quality assurance',
  master_images: 'Reference art',
  images: 'Scene imagery',
  video_generation: 'Video generation',
  assembly: 'Final assembly',
  saving: 'Saving outputs',
  audio_generation: 'Audio narration',
  browser_qa: 'Browser QA',
};

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
  if (normalized && normalized in PHASE_LABELS) return PHASE_LABELS[normalized].toUpperCase();
  return (phase || 'initializing').replace(/[_-]+/g, ' ').toUpperCase();
};

type PhaseStatus = 'pending' | 'active' | 'complete' | 'error';

// Episode status is DERIVED from its scenes — an episode is only "complete" when
// every scene (regular, branch, encounter) is complete, never from a forced
// flag. Falls back to the stored status before scenes are known (pre-architect).
const deriveEpisodeStatus = (episode: EpisodeNode): PhaseStatus => {
  if (episode.scenes.length === 0) return episode.status;
  if (episode.scenes.some((s) => s.status === 'error')) return 'error';
  if (episode.scenes.every((s) => s.status === 'complete')) return 'complete';
  if (episode.scenes.some((s) => s.status !== 'pending')) return 'active';
  return 'pending';
};

/** Plain-language label + accent for a scene's current activity chip. */
const ACTIVITY_CHIP: Record<string, { label: string; color: string }> = {
  writing: { label: 'WRITING PROSE', color: TERMINAL.colors.amber },
  choices: { label: 'AUTHORING CHOICES', color: TERMINAL.colors.cyan },
  encounter: { label: 'DESIGNING ENCOUNTER', color: '#a78bfa' },
  art: { label: 'GENERATING ART', color: '#ec4899' },
  validating: { label: 'CHECKING CONTINUITY', color: TERMINAL.colors.cyan },
};

export const PipelineProgress: React.FC<PipelineProgressProps> = ({
  events,
  currentPhase,
  isRunning,
  progress,
  etaSeconds,
  imageProgress,
  runtime,
  storyTitle,
}) => {
  const [showDebugLog, setShowDebugLog] = useState(false);
  const [expandedEpisodes, setExpandedEpisodes] = useState<Record<number, boolean>>({});
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

  // Roll a step's status up from its sub-phases: error wins, then any active,
  // then all-complete, else pending.
  const getBandStatus = (subPhases: readonly string[]): PhaseStatus => {
    const statuses = subPhases.map(getPhaseStatus);
    if (statuses.includes('error')) return 'error';
    if (statuses.includes('active')) return 'active';
    if (statuses.every((s) => s === 'complete')) return 'complete';
    return 'pending';
  };

  const normalizedProgress = Math.max(0, Math.min(100, Math.round(runtime?.progress ?? progress ?? 0)));
  const latestTelemetry = [...events].reverse().find((e) => !!e.telemetry)?.telemetry;
  const telemetryItemCurrent = runtime?.currentItem ?? runtime?.imageProgress?.current ?? latestTelemetry?.currentItem;
  const telemetryItemTotal = runtime?.totalItems ?? runtime?.imageProgress?.total ?? latestTelemetry?.totalItems;
  const effectiveEta = runtime?.etaSeconds ?? etaSeconds;
  const effectiveImageProgress = runtime?.imageProgress || imageProgress;
  const imageJobs = runtime?.imageJobs || [];
  const imageManifest = runtime?.imageManifest || [];
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
  const getBeatKey = (item: {
    sceneId?: string;
    beatId?: string;
    identifier?: string;
    metadata?: { sceneId?: string; beatId?: string; [key: string]: unknown };
  }) => {
    const sceneId = item.sceneId || item.metadata?.sceneId;
    const beatId = item.beatId || item.metadata?.beatId;
    if (sceneId && beatId) return `${sceneId}:${beatId}`;
    return item.identifier;
  };
  const plannedBeatKeys = new Set<string>();
  for (const item of imageManifest) {
    const key = getBeatKey(item);
    if (key) plannedBeatKeys.add(key);
  }
  for (const job of imageJobs) {
    const key = getBeatKey(job);
    if (key) plannedBeatKeys.add(key);
  }
  const completedBeatKeys = new Set<string>();
  for (const job of imageJobs) {
    const key = getBeatKey(job);
    if (key && (job.status === 'completed' || !!job.imageUrl)) completedBeatKeys.add(key);
  }
  const plannedBeatCount = plannedBeatKeys.size;
  const completedBeatCount = completedBeatKeys.size;
  const slotTotal = Math.max(
    typeof telemetryItemTotal === 'number' ? telemetryItemTotal : 0,
    imageJobs.length,
  );
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

  const renderStatusIcon = (status: PhaseStatus, size = 16) => {
    switch (status) {
      case 'complete':
        return <CheckCircle2 size={size} color={TERMINAL.colors.primary} />;
      case 'active':
        return <Activity size={size} color={TERMINAL.colors.amber} />;
      case 'error':
        return <AlertCircle size={size} color={TERMINAL.colors.error} />;
      default:
        return <Circle size={size} color={TERMINAL.colors.muted} opacity={0.3} />;
    }
  };

  // Structure-driven progress tree (episodes -> scenes -> beats).
  const plan = runtime?.generationPlan;

  // The scene currently being worked on (drives the NOW headline + hero subline).
  let activeEpisode: EpisodeNode | undefined;
  let activeScene: SceneNode | undefined;
  let activeSceneIndex = 0;
  if (plan) {
    for (const ep of plan.episodes) {
      const idx = ep.scenes.findIndex((s) => s.status === 'active');
      if (idx >= 0) {
        activeEpisode = ep;
        activeScene = ep.scenes[idx];
        activeSceneIndex = idx + 1;
        break;
      }
    }
  }
  const completedEpisodes = plan ? plan.episodes.filter((e) => deriveEpisodeStatus(e) === 'complete').length : 0;
  const currentEpisodeNumber = activeEpisode?.number
    ?? (plan ? Math.min(plan.totalEpisodes, completedEpisodes + 1) : undefined);

  const sceneBeatLabel = (scene: SceneNode): string => {
    const realBeats = scene.beats.filter((b) => !b.estimated).length;
    let label: string;
    if (scene.status === 'complete' || realBeats > 0) {
      const n = realBeats || scene.beats.length;
      label = `${n} BEAT${n === 1 ? '' : 'S'}`;
    } else {
      const est = scene.expectedBeatCount ?? scene.beats.length;
      label = est > 0 ? `~${est} BEATS` : 'PENDING';
    }
    return scene.isEncounter ? `${label} · ENCOUNTER` : label;
  };

  // Activity chip text + accent for a scene row.
  const sceneChip = (scene: SceneNode): { label: string; color: string } => {
    if (scene.status === 'complete') return { label: 'DONE', color: TERMINAL.colors.primary };
    if (scene.status === 'error') return { label: 'FAILED', color: TERMINAL.colors.error };
    if (scene.status === 'active') {
      return scene.activity ? ACTIVITY_CHIP[scene.activity] : { label: 'WORKING', color: TERMINAL.colors.amber };
    }
    return { label: 'QUEUED', color: TERMINAL.colors.muted };
  };

  const episodeSceneSummary = (episode: EpisodeNode): string => {
    if (episode.scenes.length === 0) {
      const est = episode.expectedSceneCount ?? 0;
      return est > 0 ? `~${est} SCENES PLANNED` : 'PLANNING';
    }
    const done = episode.scenes.filter((s) => s.status === 'complete').length;
    return `${done} / ${episode.scenes.length} SCENES`;
  };

  const episodeProgressPct = (episode: EpisodeNode): number => {
    // Drive % from the same scene counts as the "N / M SCENES" summary so the
    // two can never disagree. Only fall back to status when scenes aren't known
    // yet (e.g. before the architect runs, or a no-scene episode).
    if (episode.scenes.length === 0) return episode.status === 'complete' ? 100 : 0;
    const done = episode.scenes.filter((s) => s.status === 'complete').length;
    return Math.round((done / episode.scenes.length) * 100);
  };

  const isEpisodeExpanded = (episode: EpisodeNode): boolean => {
    const override = expandedEpisodes[episode.number];
    if (override !== undefined) return override;
    return deriveEpisodeStatus(episode) === 'active'; // auto-expand the active episode
  };

  const toggleEpisode = (episode: EpisodeNode) => {
    setExpandedEpisodes((prev) => ({ ...prev, [episode.number]: !isEpisodeExpanded(episode) }));
  };

  const renderPlanTree = () => {
    if (!plan || plan.episodes.length === 0) return null;
    return (
      <View style={styles.episodeList}>
        {plan.episodes.map((episode) => {
          const epStatus = deriveEpisodeStatus(episode);
          const epPct = episodeProgressPct(episode);
          const expanded = isEpisodeExpanded(episode) && episode.scenes.length > 0;
          return (
            <View
              key={episode.number}
              style={[
                styles.epCard,
                epStatus === 'active' && styles.epCardActive,
                epStatus === 'complete' && styles.epCardDone,
              ]}
            >
              <TouchableOpacity
                style={styles.epHead}
                onPress={() => toggleEpisode(episode)}
                activeOpacity={0.7}
                accessibilityRole="button"
              >
                {renderStatusIcon(epStatus, 14)}
                <Text style={styles.epName}>EP {episode.number}</Text>
                {episode.title ? (
                  <Text style={styles.epTitle} numberOfLines={1}>{episode.title}</Text>
                ) : <View style={{ flex: 1 }} />}
                <Text style={styles.epMeta}>{episodeSceneSummary(episode)}</Text>
                <Text style={[styles.epPct, epStatus === 'pending' && styles.epPctMuted]}>{epPct}%</Text>
                {episode.scenes.length > 0 && (
                  <ChevronRight
                    size={11}
                    color={TERMINAL.colors.muted}
                    style={{ transform: [{ rotate: expanded ? '90deg' : '0deg' }] }}
                  />
                )}
              </TouchableOpacity>
              <View style={styles.epTrack}>
                <View
                  style={[
                    styles.epFill,
                    { width: `${epPct}%` },
                    epStatus === 'active' && styles.epFillActive,
                  ]}
                />
              </View>
              {expanded && (
                <View style={styles.sceneList}>
                  {episode.scenes.map((scene, i) => {
                    const chip = sceneChip(scene);
                    const beatsDone = scene.beats.filter((b) => b.status === 'complete').length;
                    const beatsTotal = Math.max(scene.expectedBeatCount ?? 0, scene.beats.length, 1);
                    const beatPct = scene.status === 'complete' ? 100 : Math.round((beatsDone / beatsTotal) * 100);
                    return (
                      <View key={scene.id} style={styles.sceneRow}>
                        {renderStatusIcon(scene.status, 11)}
                        <View style={styles.sceneBody}>
                          <Text style={[styles.sceneName, scene.status === 'pending' && styles.sceneNameMuted]} numberOfLines={1}>
                            {`SCENE ${i + 1} · ${(scene.title || scene.id).toUpperCase()}`}
                          </Text>
                          <View style={styles.sceneBeats}>
                            <View style={styles.beatBar}>
                              <View
                                style={[
                                  styles.beatFill,
                                  { width: `${beatPct}%` },
                                  scene.status !== 'complete' && styles.beatFillPending,
                                ]}
                              />
                            </View>
                            <Text style={[styles.beatCount, scene.status === 'complete' && styles.beatCountDone]}>
                              {sceneBeatLabel(scene)}
                            </Text>
                          </View>
                        </View>
                        <Text style={[styles.chip, { color: chip.color, backgroundColor: `${chip.color}22` }]}>
                          {chip.label}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          );
        })}
      </View>
    );
  };

  // NOW panel: one plain-language sentence about the current action.
  const activityVerb: Record<string, string> = {
    writing: 'Writing', choices: 'Authoring choices for', encounter: 'Designing encounter for',
    art: 'Illustrating', validating: 'Checking continuity in',
  };
  const nowHeadline = activeScene
    ? `${activeScene.activity ? activityVerb[activeScene.activity] : 'Working on'} “${activeScene.title || activeScene.id}” — Scene ${activeSceneIndex} of Episode ${activeEpisode?.number}`
    : activeImageJob?.identifier
      ? `Generating art — ${activeImageJob.identifier}`
      : labelForPhase(effectiveCurrentPhase);
  const heartbeatLabel = lastUpdateAgeSeconds === undefined ? 'LIVE' : `HEARTBEAT ${lastUpdateAgeSeconds}S AGO`;
  const workerHealthy = lastUpdateAgeSeconds === undefined || lastUpdateAgeSeconds < 90;

  return (
    <View style={styles.container}>
      {/* Hero — story title leads, then the headline progress bar */}
      <Text style={styles.storyTitle} numberOfLines={2}>{storyTitle || 'Generating story'}</Text>
      <View style={styles.heroTrack}>
        <View style={[styles.heroFill, { width: `${normalizedProgress}%` }]} />
      </View>
      <View style={styles.heroMeta}>
        <Text style={styles.heroPct}>{normalizedProgress}%</Text>
        <Text style={styles.heroEta}>ETA {formatEta(effectiveEta)}</Text>
      </View>
      <View style={styles.heroSubline}>
        {currentEpisodeNumber && plan ? (
          <>
            <Text style={styles.heroSublineText}>EPISODE {currentEpisodeNumber} / {plan.totalEpisodes}</Text>
            <Text style={styles.heroDot}>·</Text>
          </>
        ) : null}
        <Text style={styles.heroSublineText}>ELAPSED {formatDuration(elapsedSeconds)}</Text>
        <Text style={styles.heroDot}>·</Text>
        <Text style={[styles.heroSublineText, workerHealthy ? styles.heroOk : styles.heroStale]}>
          ● {workerHealthy ? 'WORKER HEALTHY' : 'WORKER STALE'}
        </Text>
      </View>
      {effectiveImageProgress && effectiveImageProgress.total > 0 && normalizedCurrentPhase === 'images' && (
        <View style={styles.imageProgressRow}>
          <ImageIcon size={12} color={TERMINAL.colors.amber} />
          <Text style={styles.imageProgressText}>
            GENERATING IMAGE {effectiveImageProgress.current} OF {effectiveImageProgress.total}
          </Text>
        </View>
      )}

      {/* Phase rail */}
      <View style={styles.stepper}>
        {STEPS.map((step) => {
          const status = getBandStatus(step.subPhases);
          return (
            <View key={step.id} style={styles.step}>
              <View style={styles.stepGlyph}>{renderStatusIcon(status, 13)}</View>
              <Text
                style={[
                  styles.stepLabel,
                  status === 'complete' && styles.stepLabelComplete,
                  status === 'active' && styles.stepLabelActive,
                  status === 'error' && styles.stepLabelError,
                ]}
                numberOfLines={1}
              >
                {step.name}
              </Text>
              <View
                style={[
                  styles.stepTrack,
                  status === 'complete' && styles.stepTrackComplete,
                  status === 'active' && styles.stepTrackActive,
                ]}
              />
            </View>
          );
        })}
      </View>

      {/* Episodes → scenes → beats */}
      {plan && plan.episodes.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>EPISODES</Text>
          {renderPlanTree()}
        </View>
      )}

      {/* NOW — one plain-language line about the current action */}
      {isRunning && (runtime || latestMeaningfulEvent) && (
        <View style={styles.now}>
          <Text style={styles.nowEyebrow}>NOW</Text>
          <Text style={styles.nowHeadline}>{nowHeadline}</Text>
          <Text style={styles.nowDetail} numberOfLines={2}>
            {activeImageJob?.identifier
              ? `${String(activeImageJob.status || 'processing').toUpperCase()}: ${activeImageJob.identifier}`
              : String(latestMeaningfulEvent?.message || runtime?.subphaseLabel || 'Worker is active')}
          </Text>
          <Text style={styles.nowAgent}>
            ▸ {currentAgent ? currentAgent.toUpperCase() : labelForPhase(effectiveCurrentPhase)} · {heartbeatLabel}
          </Text>

          <View style={styles.opsGrid}>
            <View style={styles.opsMetric}>
              <Text style={styles.opsMetricLabel}>JOB</Text>
              <Text style={styles.opsMetricValue} numberOfLines={1}>{runtime?.friendlyName || runtime?.jobId || 'LOCAL'}</Text>
            </View>
            <View style={styles.opsMetric}>
              <Text style={styles.opsMetricLabel}>ELAPSED</Text>
              <Text style={styles.opsMetricValue}>{formatDuration(elapsedSeconds)}</Text>
            </View>
            <View style={styles.opsMetric}>
              <View style={styles.opsMetricHeader}>
                <Text style={styles.opsMetricLabel}>ITEMS</Text>
                <Text style={styles.opsMetricValue}>
                  {typeof telemetryItemCurrent === 'number' && typeof telemetryItemTotal === 'number'
                    ? `${telemetryItemCurrent}/${telemetryItemTotal}`
                    : 'N/A'}
                </Text>
              </View>
              {typeof telemetryItemCurrent === 'number' &&
                typeof telemetryItemTotal === 'number' &&
                telemetryItemTotal > 0 && (
                  <View style={styles.opsMetricTrack}>
                    <View
                      style={[
                        styles.opsMetricFill,
                        {
                          width: `${Math.min(
                            100,
                            Math.round((telemetryItemCurrent / telemetryItemTotal) * 100),
                          )}%`,
                        },
                      ]}
                    />
                  </View>
                )}
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

          {(plannedBeatCount > 0 || slotTotal > 0) && (
            <View style={styles.workPlan}>
              <View style={styles.workPlanHeader}>
                <Text style={styles.workPlanTitle}>IMAGE WORK PLAN</Text>
                <Text style={styles.workPlanValue}>
                  {completedBeatCount}/{plannedBeatCount || completedBeatCount} BEATS IMAGED
                </Text>
              </View>
              {plannedBeatCount > 0 && (
                <View style={styles.workPlanTrack}>
                  <View
                    style={[
                      styles.workPlanFill,
                      { width: `${Math.min(100, Math.round((completedBeatCount / plannedBeatCount) * 100))}%` },
                    ]}
                  />
                </View>
              )}
              <Text style={styles.workPlanMeta}>
                {slotTotal > 0
                  ? `${imageCounts.completed}/${slotTotal} IMAGE SLOTS COMPLETE`
                  : `${imageManifest.length} PLANNED IMAGE SLOT${imageManifest.length === 1 ? '' : 'S'}`}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Collapsible Debug Log */}
      <TouchableOpacity
        style={styles.debugToggle}
        onPress={() => setShowDebugLog((prev) => !prev)}
        accessibilityRole="button"
        accessibilityLabel={showDebugLog ? 'Hide activity log' : 'Show activity log'}
      >
        <Clock size={12} color={TERMINAL.colors.muted} />
        <Text style={styles.debugToggleText}>
          {showDebugLog ? 'HIDE ACTIVITY LOG' : 'SHOW ACTIVITY LOG'}
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
  // Hero
  storyTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0,
    marginBottom: 12,
  },
  heroTrack: {
    height: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.07)',
    overflow: 'hidden',
  },
  heroFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: TERMINAL.colors.cyan,
  },
  heroMeta: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  heroPct: {
    color: 'white',
    fontSize: 22,
    fontWeight: '900',
  },
  heroEta: {
    color: TERMINAL.colors.cyan,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
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
  // Hero subline (episode / elapsed / worker health)
  heroSubline: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 7,
  },
  heroSublineText: {
    color: TERMINAL.colors.muted,
    fontSize: 8.5,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  heroDot: { color: 'rgba(255,255,255,0.2)', fontSize: 9 },
  heroOk: { color: '#34d399' },
  heroStale: { color: TERMINAL.colors.amber },

  // Horizontal phase rail
  stepper: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 18,
  },
  step: { flex: 1, alignItems: 'center', gap: 4 },
  stepGlyph: { height: 16, justifyContent: 'center' },
  stepLabel: {
    fontSize: 7.5,
    fontWeight: '900',
    letterSpacing: 0.5,
    color: TERMINAL.colors.muted,
    textAlign: 'center',
  },
  stepLabelComplete: { color: TERMINAL.colors.primary },
  stepLabelActive: { color: TERMINAL.colors.amber },
  stepLabelError: { color: TERMINAL.colors.error },
  stepTrack: {
    height: 2,
    alignSelf: 'stretch',
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  stepTrackComplete: { backgroundColor: TERMINAL.colors.primary },
  stepTrackActive: { backgroundColor: TERMINAL.colors.amber },

  // Section
  section: { marginBottom: 18 },
  sectionLabel: {
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: 1.6,
    color: TERMINAL.colors.cyan,
    marginBottom: 10,
  },

  // Episode cards
  episodeList: { gap: 10 },
  epCard: {
    backgroundColor: TERMINAL.colors.bg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    paddingBottom: 12,
    overflow: 'hidden',
  },
  epCardActive: {
    borderColor: 'rgba(245, 158, 11, 0.35)',
    backgroundColor: 'rgba(245, 158, 11, 0.03)',
  },
  epCardDone: { borderColor: 'rgba(59, 130, 246, 0.22)' },
  epHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 13,
  },
  epName: {
    fontSize: 11,
    fontWeight: '900',
    color: 'white',
    letterSpacing: 0.5,
  },
  epTitle: {
    flex: 1,
    fontSize: 10,
    fontWeight: '700',
    color: TERMINAL.colors.muted,
    letterSpacing: 0.3,
  },
  epMeta: {
    fontSize: 8,
    fontWeight: '900',
    color: TERMINAL.colors.cyan,
    letterSpacing: 0.5,
  },
  epPct: { fontSize: 10, fontWeight: '900', color: 'white', width: 34, textAlign: 'right' },
  epPctMuted: { color: TERMINAL.colors.muted },
  epTrack: {
    height: 3,
    marginHorizontal: 14,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  epFill: { height: '100%', borderRadius: 999, backgroundColor: TERMINAL.colors.primary },
  epFillActive: { backgroundColor: TERMINAL.colors.amber },

  // Scene rows
  sceneList: { paddingHorizontal: 14, paddingLeft: 30, marginTop: 8, gap: 7 },
  sceneRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sceneBody: { flex: 1, minWidth: 0 },
  sceneName: {
    fontSize: 9.5,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.75)',
    letterSpacing: 0.3,
  },
  sceneNameMuted: { color: TERMINAL.colors.muted },
  sceneBeats: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  beatBar: {
    flex: 1,
    maxWidth: 120,
    height: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  beatFill: { height: '100%', borderRadius: 999, backgroundColor: '#34d399' },
  beatFillPending: { backgroundColor: TERMINAL.colors.amber },
  beatCount: {
    fontSize: 7.5,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    letterSpacing: 0.4,
  },
  beatCountDone: { color: TERMINAL.colors.primary },
  chip: {
    fontSize: 7.5,
    fontWeight: '900',
    letterSpacing: 0.5,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },

  // NOW panel
  now: {
    backgroundColor: 'rgba(59, 130, 246, 0.06)',
    borderRadius: 16,
    padding: 14,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.2)',
  },
  nowEyebrow: {
    color: TERMINAL.colors.amber,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  nowHeadline: {
    color: 'white',
    fontSize: 13,
    fontWeight: '900',
    marginTop: 5,
    lineHeight: 18,
  },
  nowDetail: {
    color: TERMINAL.colors.muted,
    fontSize: 9.5,
    lineHeight: 14,
    marginTop: 5,
    fontWeight: '700',
  },
  nowAgent: {
    color: TERMINAL.colors.cyan,
    fontSize: 8.5,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginTop: 8,
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
  opsMetricHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 6,
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
  opsMetricTrack: {
    height: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
    marginTop: 6,
  },
  opsMetricFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: TERMINAL.colors.cyan,
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
  workPlan: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  workPlanHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  workPlanTitle: {
    color: TERMINAL.colors.primary,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1,
  },
  workPlanValue: {
    color: 'white',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0,
  },
  workPlanTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
    marginTop: 8,
  },
  workPlanFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: TERMINAL.colors.cyan,
  },
  workPlanMeta: {
    color: TERMINAL.colors.muted,
    fontSize: 9,
    lineHeight: 14,
    marginTop: 6,
    fontWeight: '800',
    letterSpacing: 0,
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
