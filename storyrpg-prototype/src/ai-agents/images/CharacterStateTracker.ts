import type { CharacterBible } from '../agents/CharacterDesigner';
import type { GeneratedBeat } from '../agents/SceneWriter';
import type { CharacterVisualState } from './beatPromptBuilder';

type MutableCharacterVisualState = {
  wardrobe?: string;
  injuries: string[];
  heldProps: string[];
  tags: string[];
};

type TrackerDiagnostics = {
  applied: number;
  ambiguous: number;
  skipped: number;
};

const MAX_ITEMS = 4;
const VISUAL_TAGS = [
  'rain-soaked',
  'limping',
  'exhausted',
  'ash on face',
  'blood on face',
  'mud-splattered',
  'tear-streaked',
  'soot-stained',
  'dust-covered',
];

const SENTENCE_SPLIT = /(?<=[.!?])\s+|\n+/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizePhrase(value: string | undefined): string {
  return (value || '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.;:!?-]+|[\s,.;:!?-]+$/g, '')
    .replace(/^(?:a|an|the|her|his|their|its|our|my|your)\s+/i, '')
    .replace(/\b(?:the|her|his|their|its|our|my|your)\s+/gi, '')
    .trim();
}

function normalizeKey(value: string): string {
  return normalizePhrase(value).toLowerCase();
}

function truncateCapture(value: string): string {
  return normalizePhrase(
    value
      .split(/\b(?:while|as|before|after|then|but|and then|with)\b/i)[0]
      .split(/[.;!?]/)[0],
  );
}

function pushUnique(items: string[], value: string | undefined): boolean {
  const normalized = normalizePhrase(value);
  if (!normalized) return false;
  const key = normalizeKey(normalized);
  if (!key) return false;
  if (items.some(item => normalizeKey(item) === key)) return false;
  items.push(normalized);
  if (items.length > MAX_ITEMS) items.splice(0, items.length - MAX_ITEMS);
  return true;
}

function removeMatching(items: string[], value: string | undefined): boolean {
  const key = normalizeKey(value || '');
  if (!key) return false;
  const before = items.length;
  const keyTokens = key.split(/\s+/).filter(token => token.length > 2);
  for (let i = items.length - 1; i >= 0; i--) {
    const itemKey = normalizeKey(items[i]);
    const tokenMatch = keyTokens.length > 0 && keyTokens.every(token => itemKey.includes(token));
    if (itemKey === key || itemKey.includes(key) || key.includes(itemKey) || tokenMatch) {
      items.splice(i, 1);
    }
  }
  return items.length !== before;
}

function cloneState(state: MutableCharacterVisualState): MutableCharacterVisualState {
  return {
    wardrobe: state.wardrobe,
    injuries: [...state.injuries],
    heldProps: [...state.heldProps],
    tags: [...state.tags],
  };
}

function toPublicState(state: MutableCharacterVisualState): CharacterVisualState | undefined {
  const publicState: CharacterVisualState = {};
  if (state.wardrobe) publicState.wardrobe = state.wardrobe;
  if (state.injuries.length > 0) publicState.injuries = [...state.injuries];
  if (state.heldProps.length > 0) publicState.heldProps = [...state.heldProps];
  if (state.tags.length > 0) publicState.tags = [...state.tags];
  return Object.keys(publicState).length > 0 ? publicState : undefined;
}

/**
 * Tracks story-justified visual continuity within a single scene. The tracker
 * intentionally favors precision over recall: ambiguous hints are skipped so
 * prompts do not assign wounds, props, or wardrobe changes to the wrong person.
 */
export class CharacterStateTracker {
  private readonly canonical = new Map<string, MutableCharacterVisualState>();
  private readonly states = new Map<string, MutableCharacterVisualState>();
  private readonly nameToCanonicalName = new Map<string, string>();
  private readonly escapedNames: Array<{ canonicalName: string; pattern: RegExp }> = [];
  private diagnostics: TrackerDiagnostics = { applied: 0, ambiguous: 0, skipped: 0 };

  constructor(characterBible: CharacterBible) {
    for (const character of characterBible.characters || []) {
      const canonicalName = character.name;
      const seed: MutableCharacterVisualState = {
        wardrobe: normalizePhrase(character.typicalAttire) || undefined,
        injuries: [],
        heldProps: [],
        tags: [],
      };
      this.canonical.set(canonicalName, cloneState(seed));
      this.states.set(canonicalName, cloneState(seed));
      this.nameToCanonicalName.set(canonicalName.toLowerCase(), canonicalName);
      if (character.id) this.nameToCanonicalName.set(character.id.toLowerCase(), canonicalName);
      this.escapedNames.push({
        canonicalName,
        pattern: new RegExp(`\\b${escapeRegExp(canonicalName)}\\b`, 'i'),
      });
    }
    this.escapedNames.sort((a, b) => b.canonicalName.length - a.canonicalName.length);
  }

  resetToCanonical(): void {
    this.states.clear();
    for (const [name, state] of this.canonical.entries()) {
      this.states.set(name, cloneState(state));
    }
    this.diagnostics = { applied: 0, ambiguous: 0, skipped: 0 };
  }

  getDiagnostics(): TrackerDiagnostics {
    return { ...this.diagnostics };
  }

  updateForBeat(
    beat: Pick<GeneratedBeat, 'text' | 'visualMoment' | 'primaryAction' | 'emotionalRead' | 'relationshipDynamic' | 'mustShowDetail'>,
    visibleCharacterNames: string[],
  ): Record<string, CharacterVisualState> {
    const combinedText = [
      beat.text,
      beat.visualMoment,
      beat.primaryAction,
      beat.emotionalRead,
      beat.relationshipDynamic,
      beat.mustShowDetail,
    ].filter(Boolean).join(' ');

    for (const sentence of combinedText.split(SENTENCE_SPLIT).map(s => s.trim()).filter(Boolean)) {
      this.applySentence(sentence);
    }

    const snapshot: Record<string, CharacterVisualState> = {};
    for (const visibleName of visibleCharacterNames) {
      const canonicalName = this.resolveName(visibleName);
      if (!canonicalName) continue;
      const state = this.states.get(canonicalName);
      if (!state) continue;
      const publicState = toPublicState(state);
      if (publicState) snapshot[canonicalName] = publicState;
    }
    return snapshot;
  }

  private resolveName(name: string): string | undefined {
    return this.nameToCanonicalName.get(String(name || '').toLowerCase());
  }

  private applySentence(sentence: string): void {
    const mentioned = this.escapedNames
      .filter(({ pattern }) => pattern.test(sentence))
      .map(({ canonicalName }) => canonicalName);
    const uniqueMentioned = Array.from(new Set(mentioned));
    if (uniqueMentioned.length === 0) {
      this.diagnostics.skipped++;
      return;
    }
    if (uniqueMentioned.length > 1) {
      this.diagnostics.ambiguous++;
      return;
    }

    const name = uniqueMentioned[0];
    const state = this.states.get(name);
    if (!state) return;

    const afterName = sentence.replace(new RegExp(`^.*?\\b${escapeRegExp(name)}\\b`, 'i'), '').trim();
    let changed = false;
    changed = this.applyWardrobe(afterName, state) || changed;
    changed = this.applyInjury(afterName, state) || changed;
    changed = this.applyProps(afterName, state) || changed;
    changed = this.applyTags(sentence, state) || changed;

    if (changed) this.diagnostics.applied++;
    else this.diagnostics.skipped++;
  }

  private applyWardrobe(afterName: string, state: MutableCharacterVisualState): boolean {
    const replaceMatch = afterName.match(/\b(?:changes into|changed into|now wears|wears|dressed in|is dressed in)\s+([^.!?;]+)/i);
    if (replaceMatch) {
      const wardrobe = truncateCapture(replaceMatch[1]);
      if (wardrobe) {
        state.wardrobe = wardrobe;
        return true;
      }
    }

    const layerMatch = afterName.match(/\b(?:puts on|put on|dons|donned|pulls on|pulled on|wraps in|wraps herself in|wraps himself in|wraps themself in)\s+([^.!?;]+)/i);
    if (layerMatch) {
      const layer = truncateCapture(layerMatch[1]);
      if (!layer) return false;
      state.wardrobe = state.wardrobe ? `${state.wardrobe}, with ${layer}` : layer;
      return true;
    }
    return false;
  }

  private applyInjury(afterName: string, state: MutableCharacterVisualState): boolean {
    const recoveryMatch = afterName.match(/\b(?:heals from|healed from|recovers from|recovered from|no longer bleeding from|wound healed on)\s+([^.!?;]+)/i);
    if (recoveryMatch) {
      return removeMatching(state.injuries, recoveryMatch[1]);
    }

    const bandageMatch = afterName.match(/\b(?:bandages|bandaged|wraps|wrapped)\s+(?:up\s+)?([^.!?;]+?)(?:\s+wound)?(?:$|[,.])/i);
    if (bandageMatch) {
      return pushUnique(state.injuries, `bandaged ${truncateCapture(bandageMatch[1])}`);
    }

    const bleedingMatch = afterName.match(/\b(?:bleeding from|bloodied|wounded|shot in|stabbed in|cut across|cut on|gash across|gash on|bruised)\s+([^.!?;]+)/i);
    if (bleedingMatch) {
      const injury = bleedingMatch[0].match(/\b(?:bloodied|wounded|bruised)\b/i)
        ? truncateCapture(bleedingMatch[0])
        : truncateCapture(`${bleedingMatch[0].split(/\s+/).slice(0, 2).join(' ')} ${bleedingMatch[1]}`);
      return pushUnique(state.injuries, injury);
    }

    const simpleMatch = afterName.match(/\b(?:bleeding|wounded|shot|stabbed|cut|gash|bruised)\b/i);
    if (simpleMatch) {
      return pushUnique(state.injuries, simpleMatch[0].toLowerCase());
    }
    return false;
  }

  private applyProps(afterName: string, state: MutableCharacterVisualState): boolean {
    const pickupMatch = afterName.match(/\b(?:picks up|picked up|grabs|grabbed|draws|drew|wields|wielded|clutches|clutched|carries|carried|holds|held)\s+([^.!?;]+)/i);
    if (pickupMatch) {
      return pushUnique(state.heldProps, truncateCapture(pickupMatch[1]));
    }

    const dropMatch = afterName.match(/\b(?:drops|dropped|throws|threw|abandons|abandoned|sets down|set down|lets go of|released|releases)\s+([^.!?;]+)/i);
    if (dropMatch) {
      return removeMatching(state.heldProps, truncateCapture(dropMatch[1]));
    }
    return false;
  }

  private applyTags(sentence: string, state: MutableCharacterVisualState): boolean {
    let changed = false;
    for (const tag of VISUAL_TAGS) {
      if (new RegExp(`\\b${escapeRegExp(tag)}\\b`, 'i').test(sentence)) {
        changed = pushUnique(state.tags, tag) || changed;
      }
    }
    return changed;
  }
}
