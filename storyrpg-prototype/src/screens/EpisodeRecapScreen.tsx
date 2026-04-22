import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';
import { ChevronRight, GitBranch, CheckCircle2, Circle } from 'lucide-react-native';
import { useGameActions, useGamePlayerState, useGameStoryState } from '../stores/gameStore';
import { useSettingsStore } from '../stores/settingsStore';
import { buildEpisodeGraph } from '../visualizer/episodeGraphBuilder';
import { TERMINAL } from '../theme';
import type { Beat, Choice, Scene, EpisodeCompletion } from '../types';

interface EpisodeRecapScreenProps {
  episodeId: string;
  onContinue: () => void;
  onRewindToBeat?: (target: { episodeId: string; sceneId: string; beatId: string }) => void;
}

/**
 * Plan 2 — Post-Episode Flowchart UI
 *
 * Shown after an episode completes. Surfaces three layers of branching
 * information the engine already tracks:
 *   1) The flowchart of scene/beat nodes for this episode, with visit
 *      state (taken / chosen / skipped) color-coding.
 *   2) A committed-choice list summarizing every choice the player made.
 *   3) Per-choice rewind buttons (when `onRewindToBeat` is supplied).
 *
 * This is a text-first flowchart (not a spatial graph) so it stays usable
 * on phones. The spatial story visualizer is a separate feature.
 */
export const EpisodeRecapScreen: React.FC<EpisodeRecapScreenProps> = ({
  episodeId,
  onContinue,
  onRewindToBeat,
}) => {
  const { currentStory } = useGameStoryState();
  const { player } = useGamePlayerState();
  const { getVisitLog, getEpisodeCompletions } = useGameActions();
  const fonts = useSettingsStore((s) => s.getFontSizes());

  const [tab, setTab] = useState<'flowchart' | 'choices'>('flowchart');

  const visitLog = getVisitLog();
  const completions = getEpisodeCompletions();

  const episode = useMemo(
    () => currentStory?.episodes.find((e) => e.id === episodeId) ?? null,
    [currentStory, episodeId],
  );

  const completion = useMemo(
    () => completions.find((c: EpisodeCompletion) => c.episodeId === episodeId) ?? null,
    [completions, episodeId],
  );

  const graph = useMemo(() => {
    if (!currentStory) return null;
    return buildEpisodeGraph(currentStory, episodeId, visitLog);
  }, [currentStory, episodeId, visitLog]);

  // Build a per-scene view: list of beats in visit order, decorated by visit state.
  const sceneSummaries = useMemo(() => {
    if (!episode || !graph) return [];
    const visitedByScene = new Map<string, Set<string>>();
    for (const v of visitLog) {
      if (v.episodeId !== episodeId) continue;
      const set = visitedByScene.get(v.sceneId) ?? new Set<string>();
      set.add(v.beatId);
      visitedByScene.set(v.sceneId, set);
    }
    const choicesMadeByBeat = new Map<string, string>();
    for (const v of visitLog) {
      if (v.episodeId === episodeId && v.choiceId) {
        choicesMadeByBeat.set(v.beatId, v.choiceId);
      }
    }

    return episode.scenes.map((scene: Scene) => {
      const visitedBeats = visitedByScene.get(scene.id) ?? new Set<string>();
      const beats = (scene.beats ?? []).map((beat: Beat) => ({
        id: beat.id,
        visited: visitedBeats.has(beat.id),
        chosenChoiceId: choicesMadeByBeat.get(beat.id),
        chosenChoice: (beat.choices ?? []).find(
          (c: Choice) => c.id === choicesMadeByBeat.get(beat.id),
        ),
        choiceCount: (beat.choices ?? []).length,
      }));
      const visitedAny = beats.some((b) => b.visited);
      return {
        sceneId: scene.id,
        sceneTitle: (scene as any).name || (scene as any).title || scene.id,
        visited: visitedAny,
        beats,
      };
    });
  }, [episode, graph, visitLog, episodeId]);

  if (!currentStory || !episode) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>NO EPISODE TO RECAP</Text>
        </View>
      </SafeAreaView>
    );
  }

  const committedChoicesCount = completion?.committedChoiceIds.length ?? 0;
  const scenesVisited = completion?.scenesVisited ?? sceneSummaries.filter((s) => s.visited).length;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerLabel}>EPISODE COMPLETE</Text>
        <Text style={styles.headerTitle}>{(episode.title || 'Untitled').toUpperCase()}</Text>
        <Text style={styles.headerCharacter}>{(player.characterName || 'Player').toUpperCase()}</Text>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{scenesVisited}</Text>
          <Text style={styles.statLabel}>SCENES</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{committedChoicesCount}</Text>
          <Text style={styles.statLabel}>CHOICES</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>
            {graph
              ? Math.round((graph.metrics.visitedNodes / Math.max(graph.metrics.totalNodes, 1)) * 100)
              : 0}
            %
          </Text>
          <Text style={styles.statLabel}>COVERAGE</Text>
        </View>
      </View>

      <View style={styles.tabBar}>
        <TabButton label="FLOWCHART" active={tab === 'flowchart'} onPress={() => setTab('flowchart')} />
        <TabButton label="CHOICES" active={tab === 'choices'} onPress={() => setTab('choices')} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
        {tab === 'flowchart' && (
          <View style={styles.flowchart}>
            {sceneSummaries.map((scene, idx) => (
              <View key={scene.sceneId} style={styles.sceneBlock}>
                <View style={styles.sceneHeader}>
                  <View
                    style={[
                      styles.sceneMarker,
                      scene.visited ? styles.sceneMarkerTaken : styles.sceneMarkerSkipped,
                    ]}
                  >
                    <Text style={styles.sceneMarkerText}>{(idx + 1).toString().padStart(2, '0')}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.sceneTitle, { fontSize: fonts.base + 1 }]}>
                      {scene.sceneTitle.toUpperCase()}
                    </Text>
                    <Text style={styles.sceneMeta}>
                      {scene.visited
                        ? `${scene.beats.filter((b) => b.visited).length} / ${scene.beats.length} BEATS`
                        : 'NOT VISITED'}
                    </Text>
                  </View>
                </View>

                {scene.visited && scene.beats.length > 0 && (
                  <View style={styles.beatChain}>
                    {scene.beats.map((beat, bi) => (
                      <View key={beat.id} style={styles.beatRow}>
                        <View
                          style={[
                            styles.beatDot,
                            beat.chosenChoice
                              ? styles.beatDotChosen
                              : beat.visited
                              ? styles.beatDotTaken
                              : styles.beatDotSkipped,
                          ]}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.beatId}>
                            BEAT {(bi + 1).toString().padStart(2, '0')} · {beat.id}
                          </Text>
                          {beat.chosenChoice && (
                            <Text style={styles.beatChoice} numberOfLines={2}>
                              → {beat.chosenChoice.text}
                            </Text>
                          )}
                          {!beat.chosenChoice && beat.choiceCount > 0 && beat.visited && (
                            <Text style={styles.beatChoiceMuted}>
                              {beat.choiceCount} options · no choice committed
                            </Text>
                          )}
                        </View>
                        {onRewindToBeat && beat.visited && (
                          <TouchableOpacity
                            onPress={() =>
                              onRewindToBeat({
                                episodeId,
                                sceneId: scene.sceneId,
                                beatId: beat.id,
                              })
                            }
                            style={styles.rewindButton}
                          >
                            <GitBranch size={12} color={TERMINAL.colors.amber} />
                            <Text style={styles.rewindText}>REWIND</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    ))}
                  </View>
                )}
              </View>
            ))}
          </View>
        )}

        {tab === 'choices' && (
          <View style={styles.choicesList}>
            {sceneSummaries
              .flatMap((scene) =>
                scene.beats
                  .filter((b) => !!b.chosenChoice)
                  .map((beat) => ({
                    sceneId: scene.sceneId,
                    sceneTitle: scene.sceneTitle,
                    beatId: beat.id,
                    choice: beat.chosenChoice!,
                  })),
              )
              .map((entry, i) => (
                <View key={`${entry.beatId}-${entry.choice.id}`} style={styles.choiceCard}>
                  <View style={styles.choiceIndex}>
                    <Text style={styles.choiceIndexText}>
                      {(i + 1).toString().padStart(2, '0')}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.choiceScene}>{entry.sceneTitle.toUpperCase()}</Text>
                    <Text style={styles.choiceText} numberOfLines={3}>
                      {entry.choice.text}
                    </Text>
                    {entry.choice.memorableMoment?.summary && (
                      <View style={styles.memorableBadge}>
                        <Text style={styles.memorableText}>
                          MEMORABLE · {entry.choice.memorableMoment.summary}
                        </Text>
                      </View>
                    )}
                  </View>
                  {onRewindToBeat && (
                    <TouchableOpacity
                      onPress={() =>
                        onRewindToBeat({
                          episodeId,
                          sceneId: entry.sceneId,
                          beatId: entry.beatId,
                        })
                      }
                      style={styles.rewindButton}
                    >
                      <GitBranch size={12} color={TERMINAL.colors.amber} />
                      <Text style={styles.rewindText}>REWIND</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            {sceneSummaries.every((s) => s.beats.every((b) => !b.chosenChoice)) && (
              <View style={styles.emptyState}>
                <Circle size={24} color={TERMINAL.colors.muted} />
                <Text style={styles.emptyText}>NO CHOICES COMMITTED THIS EPISODE</Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      <TouchableOpacity style={styles.continueButton} onPress={onContinue} activeOpacity={0.8}>
        <CheckCircle2 size={16} color="white" />
        <Text style={styles.continueText}>CONTINUE</Text>
        <ChevronRight size={16} color="white" />
      </TouchableOpacity>
    </SafeAreaView>
  );
};

const TabButton: React.FC<{ label: string; active: boolean; onPress: () => void }> = ({
  label,
  active,
  onPress,
}) => (
  <TouchableOpacity
    onPress={onPress}
    style={[styles.tab, active && styles.tabActive]}
    activeOpacity={0.7}
  >
    <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: TERMINAL.colors.bg,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  headerLabel: {
    color: TERMINAL.colors.amber,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
    marginBottom: 6,
  },
  headerTitle: {
    color: 'white',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  headerCharacter: {
    color: TERMINAL.colors.muted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: 10,
  },
  statCard: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '900',
    color: 'white',
  },
  statLabel: {
    fontSize: 8,
    fontWeight: '900',
    color: TERMINAL.colors.muted,
    letterSpacing: 1,
    marginTop: 4,
  },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: 8,
  },
  tab: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.03)',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  tabActive: {
    backgroundColor: TERMINAL.colors.primary,
    borderColor: TERMINAL.colors.primary,
  },
  tabText: {
    color: TERMINAL.colors.muted,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  tabTextActive: {
    color: 'white',
  },
  content: {
    flex: 1,
    marginTop: 16,
  },
  contentInner: {
    paddingHorizontal: 20,
    paddingBottom: 100,
  },
  flowchart: {
    gap: 12,
  },
  sceneBlock: {
    backgroundColor: '#1e2229',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  sceneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sceneMarker: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sceneMarkerTaken: {
    backgroundColor: TERMINAL.colors.primary,
  },
  sceneMarkerSkipped: {
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  sceneMarkerText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '900',
  },
  sceneTitle: {
    color: 'white',
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  sceneMeta: {
    color: TERMINAL.colors.muted,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: 2,
  },
  beatChain: {
    marginTop: 12,
    paddingLeft: 8,
    borderLeftWidth: 2,
    borderLeftColor: 'rgba(59,130,246,0.2)',
    gap: 10,
  },
  beatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 8,
  },
  beatDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  beatDotTaken: {
    backgroundColor: TERMINAL.colors.primary,
  },
  beatDotChosen: {
    backgroundColor: TERMINAL.colors.amber,
  },
  beatDotSkipped: {
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  beatId: {
    color: TERMINAL.colors.muted,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
  },
  beatChoice: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  beatChoiceMuted: {
    color: TERMINAL.colors.muted,
    fontSize: 10,
    fontStyle: 'italic',
    marginTop: 2,
  },
  rewindButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(245,158,11,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.3)',
  },
  rewindText: {
    color: TERMINAL.colors.amber,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  choicesList: {
    gap: 12,
  },
  choiceCard: {
    flexDirection: 'row',
    backgroundColor: '#1e2229',
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  choiceIndex: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(59,130,246,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceIndexText: {
    color: TERMINAL.colors.primary,
    fontSize: 12,
    fontWeight: '900',
  },
  choiceScene: {
    color: TERMINAL.colors.muted,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 4,
  },
  choiceText: {
    color: 'white',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  memorableBadge: {
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(245,158,11,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.3)',
  },
  memorableText: {
    color: TERMINAL.colors.amber,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 12,
  },
  emptyText: {
    color: TERMINAL.colors.muted,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
  },
  continueButton: {
    position: 'absolute',
    bottom: 24,
    left: 20,
    right: 20,
    backgroundColor: TERMINAL.colors.primary,
    paddingVertical: 16,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  continueText: {
    color: 'white',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 2,
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    color: TERMINAL.colors.amber,
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 2,
  },
});
