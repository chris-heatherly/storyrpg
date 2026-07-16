/**
 * Departure-contradiction audit (quality-gap plan A2, run 2026-07-16T14-50-23).
 *
 * s1-4's bridge beat announced "you decide to walk home and process the
 * night" and then routed to the ROOFTOP BAR — the reader teleports. The
 * departure machinery asks for a motivated exit toward the next location but
 * cannot stop the LLM's default instinct ("home") from contradicting the
 * route.
 *
 * Deterministic rule: when a scene's closing/bridge prose announces a
 * departure DESTINATION, that destination must match the next scene — its
 * location OR its name/description. The second clause matters: "the walk
 * home awaits" before the Cismigiu encounter is CORRECT because the next
 * scene is literally "Walking home through Cismigiu…"; the same phrase
 * before a rooftop bar is the defect. Advisory warnings only.
 */

import type { Story } from '../../types';
import { entityTokens } from '../utils/entityIdentity';

export interface DepartureContradictionFinding {
  sceneId: string;
  beatId?: string;
  nextSceneId: string;
  announced: string;
  nextLocation?: string;
  message: string;
}

const HOME_DEPARTURE_RE = /\b(?:walks?|walking|head(?:s|ed|ing)?|go(?:es|ing)?|make(?:s)? (?:your|her|his|their) way|set(?:s)? off|slip(?:s)? away|decide(?:s)? to (?:walk|go|head))\b[^.!?\n]{0,50}\bhome(?:ward)?\b/i;
const HOME_TOKENS = new Set(['home', 'apartment', 'flat', 'loft']);

type AnyScene = {
  id?: string;
  name?: string;
  description?: string;
  timeline?: { location?: string };
  location?: string;
  beats?: Array<{ id?: string; text?: string; nextSceneId?: string }>;
  encounter?: { description?: string };
};

function nextSceneMatchesHome(next: AnyScene): boolean {
  const surface = [next.timeline?.location, next.location, next.name, next.description, next.encounter?.description]
    .filter(Boolean).join(' ');
  const tokens = entityTokens(surface);
  for (const homeToken of HOME_TOKENS) {
    if (tokens.has(homeToken)) return true;
  }
  return false;
}

export function auditDepartureContradictions(story: Story): DepartureContradictionFinding[] {
  const findings: DepartureContradictionFinding[] = [];
  for (const episode of story.episodes ?? []) {
    const scenes = (episode.scenes ?? []) as AnyScene[];
    const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
    for (let index = 0; index < scenes.length; index += 1) {
      const scene = scenes[index];
      const beats = scene.beats ?? [];
      // Closing surface: the last prose beat plus every beat that carries the
      // scene handoff (bridge/payoff beats with nextSceneId).
      const lastProse = [...beats].reverse().find((beat) => beat.text?.trim());
      const closing = beats.filter((beat) =>
        beat.text?.trim() && (beat.nextSceneId || beat === lastProse));
      for (const beat of closing) {
        const routedNextId = beat.nextSceneId ?? scenes[index + 1]?.id;
        if (!routedNextId || routedNextId === 'episode-end') continue;
        const next = sceneById.get(routedNextId) ?? scenes[index + 1];
        if (!next || next.id === scene.id) continue;
        const match = HOME_DEPARTURE_RE.exec(beat.text ?? '');
        if (!match) continue;
        if (nextSceneMatchesHome(next)) continue;
        findings.push({
          sceneId: scene.id ?? `scene-${index}`,
          beatId: beat.id,
          nextSceneId: next.id ?? routedNextId,
          announced: match[0].slice(0, 80),
          nextLocation: next.timeline?.location ?? next.location,
          message: `Scene "${scene.id}" announces a departure home ("${match[0].slice(0, 60)}…") but routes to "${next.id}"${next.timeline?.location || next.location ? ` (${next.timeline?.location ?? next.location})` : ''} — the reader teleports. Rewrite the departure to point at the actual next location.`,
        });
      }
    }
  }
  return findings;
}
