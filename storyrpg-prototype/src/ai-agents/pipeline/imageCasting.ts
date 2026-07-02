/**
 * Image casting — who is in the shot (pure move from FullStoryPipeline).
 *
 * Deterministic character-resolution heuristics for image generation: which
 * characters are present in a scene, who is foreground vs background in a
 * beat, protagonist resolution from a brief, and establishing-shot detection.
 * Everything here is pure over its inputs; the monolith keeps one-line
 * delegating wrappers so the phase deps wiring stays byte-identical.
 */

import type { CharacterBible } from '../agents/CharacterDesigner';
import type { SceneContent } from '../agents/SceneWriter';
import type { CanonicalAppearance } from '../services/imageGenerationService';

/**
 * Minimal structural slice of FullCreativeBrief (declared in the monolith;
 * imported structurally here to avoid a module cycle).
 */
export interface ProtagonistBriefRef {
  protagonist?: { id?: string; name?: string };
}

/**
 * Get character IDs present in a scene based on speakers and mentions
 */
export function getCharacterIdsInScene(scene: SceneContent, characterBible: CharacterBible, protagonistId?: string): string[] {
  const characterIds = new Set<string>();

  // ALWAYS include the protagonist — they are in every scene even if not explicitly named.
  if (protagonistId) {
    const protagonistExists = characterBible.characters.some(c => c.id === protagonistId);
    if (protagonistExists) characterIds.add(protagonistId);
  }

  // Primary: use charactersInvolved from scene content (populated from blueprint.npcsPresent)
  if (scene.charactersInvolved && scene.charactersInvolved.length > 0) {
    for (const charId of scene.charactersInvolved) {
      // Verify character exists in bible
      const exists = characterBible.characters.some(c => c.id === charId);
      if (exists) {
        characterIds.add(charId);
      } else {
        // Try to match by name
        const char = characterBible.characters.find(
          c => c.name.toLowerCase() === charId.toLowerCase()
        );
        if (char) characterIds.add(char.id);
      }
    }
  }

  // Secondary: scan beat speakers for additional characters
  for (const beat of scene.beats) {
    if (beat.speaker) {
      // Try to find the character by name
      const char = characterBible.characters.find(
        c => c.name.toLowerCase() === beat.speaker?.toLowerCase() ||
             c.id.toLowerCase() === beat.speaker?.toLowerCase()
      );
      if (char) {
        characterIds.add(char.id);
      }
    }
  }

  // Tertiary: scan beat text + authored visualMoment for character mentions.
  // This is critical for scenes with limited/incorrect blueprint.npcsPresent and for image prompts
  // where we must include all named characters consistently.
  for (const beat of scene.beats) {
    const text = `${beat.text || ''} ${(beat as any).visualMoment || ''}`.toLowerCase();
    if (!text.trim()) continue;

    for (const c of characterBible.characters) {
      const name = c.name.trim();
      if (!name) continue;
      const [firstName] = name.split(/\s+/).map(t => t.trim()).filter(Boolean);
      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const escapedFirstName = firstName?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const mentioned = new RegExp(`\\b${escapedName}\\b`, 'i').test(text)
        || Boolean(firstName && firstName.length > 2 && escapedFirstName && new RegExp(`\\b${escapedFirstName}\\b`, 'i').test(text));
      if (mentioned) characterIds.add(c.id);
    }
  }

  return Array.from(characterIds);
}

export function resolveCharacterId(idOrName: string, characterBible: CharacterBible): string | null {
  const raw = String(idOrName || '').trim();
  if (!raw) return null;
  const normalize = (value: string) => value
    .toLowerCase()
    .replace(/^char[-_]/, '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const rawNorm = normalize(raw);
  const direct = characterBible.characters.find((c) => c.id === raw || c.name === raw);
  if (direct) return direct.id;
  const fuzzy = characterBible.characters.find((c) =>
    normalize(c.id) === rawNorm ||
    normalize(c.name) === rawNorm ||
    normalize(c.name).includes(rawNorm) ||
    rawNorm.includes(normalize(c.name))
  );
  return fuzzy?.id || null;
}

export function resolveProtagonistCharacterId(characterBible: CharacterBible, brief: ProtagonistBriefRef): string | null {
  const byRole = characterBible.characters.find((c: any) =>
    /\b(protagonist|main character|player character)\b/i.test(String(c.role || c.archetype || ''))
  );
  if (byRole?.id) return byRole.id;

  const briefName = String(brief.protagonist?.name || '').trim();
  if (briefName && !/^hero$/i.test(briefName)) {
    const byBriefName = resolveCharacterId(briefName, characterBible);
    if (byBriefName) return byBriefName;
  }

  const briefId = String(brief.protagonist?.id || '').trim();
  if (briefId && !/^p(?:rotagonist)?[-_ ]?1$/i.test(briefId) && !/^hero$/i.test(briefId)) {
    const byBriefId = resolveCharacterId(briefId, characterBible);
    if (byBriefId) return byBriefId;
  }

  return characterBible.characters[0]?.id || null;
}

export function resolveCharacterIdWithBrief(idOrName: string, characterBible: CharacterBible, brief: ProtagonistBriefRef): string | null {
  const raw = String(idOrName || '').trim();
  if (!raw) return null;
  if (/^p(?:rotagonist)?[-_ ]?1$/i.test(raw) || /^player$/i.test(raw) || /^hero$/i.test(raw)) {
    return resolveProtagonistCharacterId(characterBible, brief)
      || resolveCharacterId(brief.protagonist?.name || brief.protagonist?.id || raw, characterBible);
  }
  return resolveCharacterId(raw, characterBible);
}

export function normalizeCharacterIds(ids: string[] | undefined, characterBible: CharacterBible): string[] {
  const normalized = new Set<string>();
  for (const value of ids || []) {
    const resolved = resolveCharacterId(value, characterBible);
    if (resolved) normalized.add(resolved);
  }
  return [...normalized];
}

/**
 * Get character ID(s) for a speaker name
 */
export function getCharacterIdBySpeaker(speakerName: string, characterBible: CharacterBible): string[] {
  const char = characterBible.characters.find(
    c => c.name.toLowerCase() === speakerName.toLowerCase() ||
         c.id.toLowerCase() === speakerName.toLowerCase()
  );
  return char ? [char.id] : [];
}

/**
 * Analyze which characters are relevant to a specific beat and classify their visual role.
 *
 * Returns:
 * - foreground: Characters who are the visual focus (speaking, performing action, being addressed)
 * - background: Characters present in the scene but not the focus of this beat
 * - sceneCharacterNames: Map of character ID → name for the prompt
 */
export function analyzeBeatCharacters(
  beatText: string,
  beatSpeaker: string | undefined,
  sceneCharacterIds: string[],
  characterBible: CharacterBible,
  protagonistId: string
): { foreground: string[]; background: string[]; foregroundNames: string[]; backgroundNames: string[] } {
  const foregroundIds = new Set<string>();
  const textLower = beatText.toLowerCase();

  // 1. Speaker is always foreground
  if (beatSpeaker) {
    const speakerChar = characterBible.characters.find(
      c => c.name.toLowerCase() === beatSpeaker.toLowerCase() || c.id.toLowerCase() === beatSpeaker.toLowerCase()
    );
    if (speakerChar) foregroundIds.add(speakerChar.id);
  }

  // 2. Scan beat text for character names — mentioned characters are foreground
  for (const charId of sceneCharacterIds) {
    const char = characterBible.characters.find(c => c.id === charId);
    if (!char) continue;

    const nameLower = char.name.toLowerCase();
    // Check for name mention (word boundary aware)
    // Also check for common name fragments (e.g., "Tyrell" matches "Eldon Tyrell")
    const nameWords = nameLower.split(/\s+/);
    const isMentioned = textLower.includes(nameLower) ||
      nameWords.some(word => word.length > 2 && textLower.includes(word));

    if (isMentioned) {
      foregroundIds.add(char.id);
    }
  }

  // 3. Check for second-person address ("you") — protagonist is foreground
  if (textLower.includes('you ') || textLower.includes('your ') || textLower.startsWith('you')) {
    foregroundIds.add(protagonistId);
  }

  // 4. If no one is explicitly foreground, protagonist is the default focus
  if (foregroundIds.size === 0) {
    foregroundIds.add(protagonistId);
  }

  // 5. All other scene characters are background
  const foreground = Array.from(foregroundIds);
  const background = sceneCharacterIds.filter(id => !foregroundIds.has(id));

  // Map IDs to names
  const getName = (id: string) => characterBible.characters.find(c => c.id === id)?.name || id;

  return {
    foreground,
    background,
    foregroundNames: foreground.map(getName),
    backgroundNames: background.map(getName),
  };
}

/**
 * Determine whether a beat is a pure establishing/atmospheric shot with no character action.
 * Used as a fallback when SceneWriter did not set an explicit shotType.
 * Returns true when the beat text describes environment/atmosphere without a character performing
 * a specific action — no speaker, no action verbs, protagonist only in foreground via "you/your".
 */
export function isEstablishingBeat(
  beatText: string,
  speaker: string | undefined,
  _primaryAction: string | undefined,
  beatCharContext: { foreground: string[]; foregroundNames: string[] }
): boolean {
  // A speaker means dialogue — definitely a character beat
  if (speaker) return false;

  const lowered = beatText.toLowerCase();

  // Strong action verbs signal a character beat
  const hasActionVerb = /\b(grabs?|reaches?|recoils?|steps?\s+forward|stumbles?|lunges?|pushes?|pulls?|raises?|strikes?|dodges?|fires?|shoots?|charges?|slams?|throws?|catches?|turns?\s+to|walks?|runs?|confronts?|advances?)\b/.test(lowered);
  if (hasActionVerb) return false;

  // Character dialogue markers (attributions)
  const hasDialogue = /["'"][^"']{3,}["'"]/g.test(beatText);
  if (hasDialogue) return false;

  // The protagonist only got into foreground because of "you/your" second-person address
  // (i.e., foreground has exactly one character and it's the protagonist)
  // If there are named NPCs in the foreground it's a character beat
  if (beatCharContext.foregroundNames.length > 1) return false;

  // Atmospheric environment keywords
  const hasAtmosphericEnv = /\b(rain|neon|window|street|city|sky|horizon|corridor|room|space|building|apartment|hall|fog|darkness|shadow|landscape|alley|crowd|distance|ceiling|floor|light|wall|door)\b/.test(lowered);

  // Passive/observational description — no action being performed by the viewpoint character
  const isPassiveDescription = !/\b(you\s+(turn|step|move|walk|run|reach|grab|look\s+at|face|stand\s+up|sit\s+down|rise|approach|back\s+away|push|pull|draw|aim|strike|throw|fire|shout|cry|say|ask|reply))\b/.test(lowered);

  return hasAtmosphericEnv && isPassiveDescription;
}

/**
 * Extract structured identity slots (hair, eyes, skin, build, height, face)
 * from free-form character description text. Each slot scans the merged
 * source text for phrases that match the slot's keyword set and captures the
 * surrounding words as the slot value.
 *
 * The extractor is deliberately conservative — it returns undefined for any
 * slot it can't confidently populate, leaving the fallback appearance prose
 * to cover the gap. distinctiveFeatures and typicalAttire are passed through
 * directly since they are already structured.
 */
export function extractCanonicalAppearance(
  sources: string[],
  distinctiveFeatures: string[] | undefined,
  typicalAttire: string | undefined,
): CanonicalAppearance | undefined {
  const text = sources.join('. ');
  if (!text && (!distinctiveFeatures || distinctiveFeatures.length === 0) && !typicalAttire) {
    return undefined;
  }

  const splitPhrases = (raw: string): string[] =>
    raw
      .split(/[.,;]|\s-\s|\s—\s/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

  const phrases = splitPhrases(text);

  const findPhrase = (keywords: RegExp): string | undefined => {
    for (const p of phrases) {
      if (keywords.test(p)) return p;
    }
    return undefined;
  };

  const ca: CanonicalAppearance = {};

  const hairPhrase = findPhrase(/\b(hair|hairstyle|braid|ponytail|locks|mane|curls|dreadlocks)\b/i);
  if (hairPhrase) ca.hair = hairPhrase;

  const eyesPhrase = findPhrase(/\b(eyes|eye|iris|gaze)\b/i);
  if (eyesPhrase) ca.eyes = eyesPhrase;

  const skinPhrase = findPhrase(/\b(skin|complexion|tan|pale|sunburn(?:t|ed)?|freckl(?:e|ed|es))\b/i);
  if (skinPhrase) ca.skinTone = skinPhrase;

  const buildPhrase = findPhrase(/\b(build|physique|stature|frame|muscled|slender|broad|lean|stocky|wiry|sinewy)\b/i);
  if (buildPhrase) ca.build = buildPhrase;

  const heightPhrase = findPhrase(/\b(tall|short|height|petite|towering|diminutive)\b/i);
  if (heightPhrase) ca.height = heightPhrase;

  const facePhrase = findPhrase(/\b(face|jaw|jawline|cheekbones?|nose|chin|brow|forehead)\b/i);
  if (facePhrase) ca.face = facePhrase;

  if (distinctiveFeatures && distinctiveFeatures.length > 0) {
    ca.distinguishingMarks = distinctiveFeatures.slice(0, 6);
  }
  if (typicalAttire) {
    ca.defaultAttire = typicalAttire;
  }

  const hasAny = Object.values(ca).some((v) =>
    Array.isArray(v) ? v.length > 0 : typeof v === 'string' && v.length > 0
  );
  return hasAny ? ca : undefined;
}

/**
 * Infer base posture from personality description
 */
export function inferBasePostureFromPersonality(personality: string): string {
  const lower = (personality || '').toLowerCase();
  if (lower.includes('confident') || lower.includes('bold') || lower.includes('brash')) {
    return 'upright, open chest, chin slightly raised, expansive';
  }
  if (lower.includes('shy') || lower.includes('reserved') || lower.includes('anxious')) {
    return 'slightly hunched, arms close to body, compact';
  }
  if (lower.includes('regal') || lower.includes('noble') || lower.includes('proud')) {
    return 'perfectly upright, formal, controlled movements';
  }
  if (lower.includes('relaxed') || lower.includes('laid-back') || lower.includes('casual')) {
    return 'loose, weight on one leg, relaxed shoulders';
  }
  return 'natural, comfortable standing posture';
}

/**
 * Infer gesture style from personality description
 */
export function inferGestureStyleFromPersonality(personality: string): string {
  const lower = (personality || '').toLowerCase();
  if (lower.includes('expressive') || lower.includes('dramatic') || lower.includes('theatrical')) {
    return 'large, sweeping gestures, uses whole arm';
  }
  if (lower.includes('reserved') || lower.includes('controlled') || lower.includes('formal')) {
    return 'minimal, precise gestures, hands often clasped or still';
  }
  if (lower.includes('nervous') || lower.includes('anxious') || lower.includes('fidgety')) {
    return 'small, quick gestures, self-touching, fidgeting';
  }
  return 'natural, moderate hand gestures when speaking';
}
