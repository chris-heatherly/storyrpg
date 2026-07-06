/**
 * Realized-context threading (SAR wave 2, R2 — plan-vs-realized drift).
 *
 * SceneWriter/EncounterArchitect for scene N historically received PLAN
 * artifacts: `sceneContents[i-1]` in generation order (a branch sibling, not
 * the narrative predecessor), keyMoments labels instead of the prose that was
 * actually written, and blueprint-array-order timeline handoffs. Drift
 * compounds scene over scene until the season-final fidelity validators kill
 * the run 24+ minutes in.
 *
 * These helpers resolve the narrative predecessor from the scene GRAPH
 * (branch-aware) and summarize what was actually WRITTEN — closing prose,
 * realized location/time anchors — so each scene is authored against realized
 * story state. Everything here is deterministic, LLM-free, and
 * generator-internal (prompt context, never reader-facing prose).
 */

import type { SceneContent } from '../agents/SceneWriter';
import type { SceneBlueprint } from '../agents/StoryArchitect';
import {
  buildSceneTimelineHandoff,
  buildSceneTimelineHandoffFrom,
  prettifyLocationLabel,
  type SceneTimelineHandoff,
  type TimelineScene,
} from '../utils/sceneTimeline';

export interface RealizedGraphPredecessor {
  blueprint: SceneBlueprint;
  content: SceneContent;
  /** Realized incoming branches (>1 = this scene is a reconvergence point). */
  incomingCount: number;
}

/**
 * Resolve the narrative predecessor of a scene from the scene GRAPH
 * (`leadsTo` edges), restricted to predecessors whose content has actually
 * been generated. Branch-aware: for a scene inside a branch this returns the
 * branch source, never the sibling branch that happened to be generated
 * immediately before it. For a reconvergence point with multiple realized
 * incoming scenes, the one closest before it in blueprint order is chosen
 * (deterministic; there is no single realized path at a reconvergence).
 * Returns undefined for opening scenes / scenes with no realized predecessor.
 */
export function resolveGraphPredecessor(
  scenes: SceneBlueprint[],
  sceneId: string,
  findContent: (sceneId: string) => SceneContent | undefined,
): RealizedGraphPredecessor | undefined {
  const realized = scenes
    .filter((scene) => scene.id !== sceneId && (scene.leadsTo ?? []).includes(sceneId))
    .map((scene) => ({ blueprint: scene, content: findContent(scene.id) }))
    .filter((entry): entry is { blueprint: SceneBlueprint; content: SceneContent } => Boolean(entry.content));
  if (realized.length === 0) return undefined;

  const orderIndex = new Map(scenes.map((scene, index) => [scene.id, index]));
  const targetIndex = orderIndex.get(sceneId) ?? scenes.length;
  const sorted = [...realized].sort(
    (a, b) => (orderIndex.get(a.blueprint.id) ?? 0) - (orderIndex.get(b.blueprint.id) ?? 0),
  );
  const before = sorted.filter((entry) => (orderIndex.get(entry.blueprint.id) ?? Infinity) < targetIndex);
  const chosen = before.length > 0 ? before[before.length - 1] : sorted[0];
  return { ...chosen, incomingCount: realized.length };
}

function beatProse(beat: SceneContent['beats'][number]): string {
  return String(beat.text || beat.content || '').trim();
}

/** Tail-truncate: the handoff cares about how the scene ENDED, so keep the end. */
function closingTail(text: string, maxLength: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLength) return collapsed;
  return `…${collapsed.slice(collapsed.length - (maxLength - 1))}`;
}

/** The last 1-2 written beats' prose, tail-truncated (closing state of the scene). */
export function realizedClosingExcerpt(content: SceneContent, maxLength = 320): string {
  const prose = (content.beats ?? []).map(beatProse).filter(Boolean);
  if (prose.length === 0) return '';
  return closingTail(prose.slice(-2).join(' '), maxLength);
}

function realizedLocationLabel(content: SceneContent, blueprint?: SceneBlueprint): string {
  return (
    content.settingContext?.locationName
    || prettifyLocationLabel(content.settingContext?.locationId ?? content.locationId)
    || prettifyLocationLabel(blueprint?.location)
  );
}

/**
 * Compact deterministic summary of the REALIZED predecessor scene for the
 * SceneWriter `previousSceneSummary` handoff: name + location/time anchors +
 * key moments + the closing prose excerpt (what the reader last saw), instead
 * of blueprint keyMoments labels alone.
 */
export function buildRealizedSceneSummary(
  content: SceneContent,
  blueprint?: SceneBlueprint,
): string {
  const anchors: string[] = [];
  const location = realizedLocationLabel(content, blueprint);
  if (location) anchors.push(location);
  if (blueprint?.timeOfDay) anchors.push(String(blueprint.timeOfDay));

  const parts: string[] = [
    `Previous scene (as written): ${content.sceneName}${anchors.length > 0 ? ` [${anchors.join(', ')}]` : ''}`,
  ];
  const keyMoments = (content.keyMoments ?? []).filter(Boolean).slice(0, 4);
  if (keyMoments.length > 0) parts.push(`Key moments: ${keyMoments.join(', ')}`);
  const excerpt = realizedClosingExcerpt(content);
  if (excerpt) parts.push(`Closing prose: "${excerpt}"`);
  return parts.join(' | ');
}

/**
 * Episode-so-far summary for EncounterArchitect built from what was actually
 * WRITTEN: each already-generated scene contributes its realized closing
 * excerpt on top of the blueprint blurb; scenes not yet generated (or that
 * produced no prose) fall back to the blueprint description alone.
 */
export function buildRealizedEpisodeSoFarSummary(
  scenesBefore: SceneBlueprint[],
  findContent: (sceneId: string) => SceneContent | undefined,
): string | undefined {
  if (scenesBefore.length === 0) return undefined;
  return scenesBefore
    .map((scene, index) => {
      const content = findContent(scene.id);
      const location = content
        ? realizedLocationLabel(content, scene)
        : prettifyLocationLabel(scene.location);
      const base = `${index + 1}. ${content?.sceneName ?? scene.name}${location ? ` [${location}]` : ''}: ${
        (scene.description || '').replace(/\s+/g, ' ').slice(0, 220)
      }`;
      const excerpt = content ? realizedClosingExcerpt(content, 200) : '';
      return excerpt ? `${base} — as written, it ends: "${excerpt}"` : base;
    })
    .join('\n');
}

/**
 * Timeline handoff against the GRAPH predecessor (R2.3): the transition block
 * reflects where/when the narrative predecessor actually left the protagonist
 * (the written scene's location/time is pinned to its blueprint entry via
 * `settingContext` at acceptance, so the predecessor blueprint IS the realized
 * anchor). Falls back to blueprint-array order only when no graph predecessor
 * is resolvable (first scene in a chain).
 */
export function buildRealizedTimelineHandoff(
  scenes: TimelineScene[],
  scene: TimelineScene,
  predecessor: TimelineScene | undefined,
): SceneTimelineHandoff | undefined {
  if (!predecessor || predecessor.id === scene.id) {
    return buildSceneTimelineHandoff(scenes, scene);
  }
  return buildSceneTimelineHandoffFrom(predecessor, scene);
}
