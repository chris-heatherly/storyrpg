// ========================================
// REQUIRED BEATS PROMPT SECTION
// ========================================
//
// Builds the SceneWriter prompt fragment that turns a scene's structured
// `requiredBeats` (and its `signatureMoment`) into an explicit, ordered
// "depict each, in order" checklist — the downstream CONSUMER of the
// "expand, do not rewrite" contract (plan §5.4 / GAP-B).
//
// Producer: authored treatment turns / signature moments are bound to
// `PlannedScene.requiredBeats` + `PlannedScene.signatureMoment` upstream
// (authorScenePlan.ts / seasonScenePlanBuilder.ts) and carried onto the
// `SceneBlueprint` in StoryArchitect.buildBlueprintFromPlannedScenes.
//
// Design goals:
//   - Optional: when a scene has NO required beats and no signature moment
//     (from-scratch runs, or scenes the treatment is silent on), this returns
//     the empty string so the prompt is byte-for-byte unchanged. Non-treatment
//     runs MUST NOT regress.
//   - Fiction-first: the rendered text is authoring guidance (what must be
//     DEPICTED in prose), never stats/dice/DCs. It steers prose, it is not
//     leaked into prose.
//   - Ordered + tier-framed: signature beats are "MUST be depicted, never
//     inverted"; authored beats "must occur, in order"; connective beats are
//     soft tissue the model may freely author around.

import type { ColdOpenProfile, RequiredBeat } from '../../types/scenePlan';

/**
 * Subset of a scene a required-beats section needs. Structurally loose on
 * purpose: both the SceneBlueprint (full RequiredBeat[]) and a SceneContent
 * tagged with its realization contract (loose `{tier?, mustDepict?}` copies)
 * satisfy it — the builder runtime-filters empty mustDepict and falls back to
 * 'authored' framing for unknown tiers.
 */
export interface RequiredBeatsSource {
  /** Authored units the scene must depict (ordered). */
  requiredBeats?: Array<Partial<RequiredBeat> | { tier?: string; mustDepict?: string }>;
  /** A single staged signature device/image the prose MUST show. */
  signatureMoment?: string;
  /** Generator-only compiled cold-open brief. */
  coldOpenProfile?: ColdOpenProfile;
}

const TIER_FRAMING: Record<RequiredBeat['tier'], string> = {
  signature: 'MUST be depicted on-page, exactly as staged — never invert, soften, or omit it',
  authored: 'is the dramatic center of its scene — build setup before it and aftermath/handoff after it; do not drop, re-order, or re-interpret it',
  seed: 'plant this detail on-page if the scene can carry it (a small recurring object, a quiet tell) — advisory, not a fixed turn',
  coldopen: 'OPEN the episode on this as a tight single-scene hook — fulfill the Story Circle cold-open profile if present, dramatize one immediate conflict and open question, limit active cast, move quickly, and end on a reveal, reversal, charged line, or silence',
  connective: 'tie the fixed beats together; you may freely author this connective tissue',
};

function formatStoryCircleBeats(profile: ColdOpenProfile): string {
  const beats = profile.storyCircleFulfillment.combinedBeats?.length
    ? `${profile.storyCircleFulfillment.combinedBeats.join(' + ')} combined`
    : profile.storyCircleBeats.join(' + ');
  return beats || 'assigned Story Circle role';
}

export function buildColdOpenProfileSection(scene: RequiredBeatsSource | undefined): string {
  const profile = scene?.coldOpenProfile;
  if (!profile) return '';
  const supportingConcepts = profile.selectedConcepts
    .filter((concept) => concept.role === 'pressure' || concept.role === 'texture' || concept.role === 'open_question')
    .slice(0, 6);
  const resolutions = profile.conflictResolutions ?? [];

  return `
### COLD OPEN CONTRACT — single scene, fast hook
This opening must fulfill its Story Circle role on-page through drama, not labels.
Keep it one scene with one central collision. Use supporting concepts only when
they sharpen that collision; do not turn them into an ensemble tour or setup
checklist. Authoring guidance only — never expose these labels in prose.

- Story Circle role: ${formatStoryCircleBeats(profile)}
- Mode / archetype: ${profile.mode} / ${profile.archetype}
- Central turn: ${profile.centralTurn}
- Story Circle collision: ${profile.storyCircleFulfillment.collision}
- Micro-conflict: ${profile.microConflict}
- Open question: ${profile.openQuestion}
- Active cast target: ${profile.activeCastLimit} active character(s), unless a hard required beat truly demands more
- Beat budget: aim for ${profile.beatBudget.recommended} quick beats (${profile.beatBudget.min}-${profile.beatBudget.max} allowed)
- Exit: ${profile.exitHook}
${supportingConcepts.length ? `- Supporting pressure, not extra scene turns: ${supportingConcepts.map((concept) => concept.text).join(' | ')}\n` : ''}${resolutions.length ? `- Conflict resolution: ${resolutions.join(' ')}\n` : ''}
`.trimEnd() + '\n';
}

/**
 * Build the SceneWriter-facing "Required Beats" section. Returns '' when the
 * scene carries no signature moment and no non-empty requiredBeats, leaving
 * non-treatment prompts unchanged.
 *
 * The checklist is rendered in authored order. Each beat is a numbered item
 * carrying its `mustDepict` text plus tier-based framing. The signature moment
 * (if present) leads with a hard "never inverted" line so the most important
 * staged image cannot be authored away.
 */
export function buildRequiredBeatsSection(scene: RequiredBeatsSource | undefined): string {
  if (!scene) return '';
  const beats = (scene.requiredBeats ?? []).filter((b) => b && typeof b.mustDepict === 'string' && b.mustDepict.trim().length > 0);
  const signatureMoment = typeof scene.signatureMoment === 'string' ? scene.signatureMoment.trim() : '';

  if (beats.length === 0 && signatureMoment.length === 0) return '';

  const signatureLine = signatureMoment
    ? `**Signature moment (MUST be depicted, never inverted):** ${signatureMoment}\n\n`
    : '';

  const checklist = beats.length
    ? beats
        .map((beat, idx) => {
          const tier = (beat.tier ?? 'authored') as RequiredBeat['tier'];
          const framing = TIER_FRAMING[tier] ?? TIER_FRAMING.authored;
          return `${idx + 1}. [${tier}] ${beat.mustDepict!.trim()} — ${framing}`;
        })
        .join('\n')
    : '';

  return `
### REQUIRED BEATS — depict each, in order; do not drop, re-order, or invert
This scene dramatizes an already-authored episode. The beats below are FIXED.
Depict every required beat in the order given, inventing only the connective
tissue, transitions, sensory texture, and prose around them. An authored turn
is the scene's dramatic center: establish why it happens, dramatize it on-page,
then show its immediate aftermath or handoff before routing onward. Do NOT add, drop,
re-order, or re-interpret a required beat. (Authoring guidance only — never
expose this list, its labels, or any system framing in player-facing prose.)

${signatureLine}${checklist}
`.trimEnd() + '\n';
}
