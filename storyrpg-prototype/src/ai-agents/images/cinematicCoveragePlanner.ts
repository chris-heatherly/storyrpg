import type {
  BeatCoveragePlan,
  VisualCast,
  VisualStagingPattern,
} from '../../types/content';

export interface CoverageCharacter {
  id: string;
  name: string;
  role?: string;
}

export interface CoverageBeatInput {
  id: string;
  text: string;
  speaker?: string;
  speakerMood?: string;
  shotType?: 'establishing' | 'character' | 'action';
  isClimaxBeat?: boolean;
  isKeyStoryBeat?: boolean;
  isChoicePayoff?: boolean;
  visualMoment?: string;
  primaryAction?: string;
  emotionalRead?: string;
  relationshipDynamic?: string;
  mustShowDetail?: string;
  plantsThreadId?: string;
  paysOffThreadId?: string;
  plotPointType?: string;
  twistKind?: string;
}

export interface CoveragePlanBeat {
  beatId: string;
  visualCast: VisualCast;
  coveragePlan: BeatCoveragePlan;
}

export interface SceneCoveragePlan {
  sceneId: string;
  beats: CoveragePlanBeat[];
  diagnostics: {
    solitaryCompositionWarnings: string[];
    castWarnings: string[];
  };
}

export interface SceneCoverageInput {
  sceneId: string;
  beats: CoverageBeatInput[];
  sceneCharacterIds: string[];
  characters: CoverageCharacter[];
  protagonistId: string;
}

const SHOT_DISTANCE_PUSH_IN = ['MS', 'MCU', 'CU', 'ECU'] as const;
const SOLITARY_PATTERNS = new Set<VisualStagingPattern>(['single', 'solo-reaction', 'environment', 'environmental-aftermath']);
const DIALOGUE_RE = /["“][^"”]{2,}["”]|'\S[^']{2,}'|\b(says?|asks?|replies?|answers?|whispers?|shouts?|murmurs?|calls?|tells?)\b/i;
const OBSERVER_RE = /\b(watches?|listens?|overhears?|notices?|observes?|witnesses?|sees?|reacts?|glances?|stares?)\b/i;
const WINDOW_DISTANCE_RE = /\b(window|distance|horizon|outside|balcony|railing|doorway|threshold)\b/i;
const FEMALE_ALIAS_RE = /\b(the girl|girl|she|her|hers)\b/i;
const MALE_ALIAS_RE = /\b(the boy|boy|he|him|his)\b/i;

function normalizeIdList(ids: Array<string | undefined>): string[] {
  return Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchCharacterBySpeaker(speaker: string | undefined, characters: CoverageCharacter[]): CoverageCharacter | undefined {
  if (!speaker) return undefined;
  const lowered = speaker.toLowerCase();
  return characters.find(c => c.id.toLowerCase() === lowered || c.name.toLowerCase() === lowered);
}

function characterMentioned(character: CoverageCharacter, text: string): boolean {
  const name = character.name.trim();
  if (!name) return false;
  if (new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i').test(text)) return true;
  return name
    .split(/\s+/)
    .filter(part => part.length > 2)
    .some(part => new RegExp(`\\b${escapeRegExp(part)}\\b`, 'i').test(text));
}

function characterContext(character: CoverageCharacter, text: string): string {
  const tokens = [character.name, ...character.name.split(/\s+/).filter(part => part.length > 2)];
  for (const token of tokens) {
    const match = new RegExp(`.{0,64}\\b${escapeRegExp(token)}\\b.{0,80}`, 'i').exec(text);
    if (match) return match[0];
  }
  return '';
}

function includesSecondPerson(text: string): boolean {
  return /\b(you|your|{{player\.(?:name|they|their|them)}})\b/i.test(text);
}

function inferAliasCharacterIds(
  text: string,
  sceneCharacters: CoverageCharacter[],
  explicitIds: Set<string>,
): string[] {
  const remaining = sceneCharacters.filter(c => !explicitIds.has(c.id));
  const aliases: string[] = [];
  if (FEMALE_ALIAS_RE.test(text)) {
    const match = [...remaining].reverse().find(c => /\bshe\/her\b/i.test(c.role || '') || /a$|i$|e$/i.test(c.name.split(/\s+/)[0] || ''));
    if (match) aliases.push(match.id);
  }
  if (MALE_ALIAS_RE.test(text)) {
    const match = remaining.find(c => /\bhe\/him\b/i.test(c.role || '') || !aliases.includes(c.id));
    if (match) aliases.push(match.id);
  }
  return aliases;
}

function futurePayoffIds(
  beatIndex: number,
  beats: CoverageBeatInput[],
  sceneCharacters: CoverageCharacter[],
  currentVisible: Set<string>,
): string[] {
  const future = beats.slice(beatIndex + 1, Math.min(beats.length, beatIndex + 5));
  const payoffIds = new Set<string>();
  for (const futureBeat of future) {
    const futureText = [
      futureBeat.text,
      futureBeat.visualMoment,
      futureBeat.primaryAction,
      futureBeat.relationshipDynamic,
      futureBeat.mustShowDetail,
    ].filter(Boolean).join(' ');
    const isPayoffBeat = Boolean(
      futureBeat.isChoicePayoff ||
      futureBeat.isClimaxBeat ||
      futureBeat.isKeyStoryBeat ||
      futureBeat.paysOffThreadId ||
      futureBeat.plotPointType === 'payoff' ||
      futureBeat.plotPointType === 'twist' ||
      futureBeat.plotPointType === 'revelation',
    );
    for (const character of sceneCharacters) {
      if (currentVisible.has(character.id)) continue;
      if (characterMentioned(character, futureText) && (isPayoffBeat || OBSERVER_RE.test(futureText))) {
        payoffIds.add(character.id);
      }
    }
  }
  return Array.from(payoffIds);
}

function isDialogueBeat(beat: CoverageBeatInput): boolean {
  return Boolean(beat.speaker || DIALOGUE_RE.test(beat.text));
}

function intensityScore(beat: CoverageBeatInput, dialogueRunIndex: number): number {
  const text = `${beat.text} ${beat.speakerMood || ''} ${beat.emotionalRead || ''}`.toLowerCase();
  let score = dialogueRunIndex;
  if (beat.isClimaxBeat || beat.isKeyStoryBeat || beat.isChoicePayoff) score += 2;
  if (/\b(angry|furious|devastated|desperate|terrified|betray|accuse|challenge|ruin|truth|confess|cry|shout|whisper)\b/.test(text)) score += 1;
  return score;
}

function chooseShotDistance(pattern: VisualStagingPattern, beat: CoverageBeatInput, dialogueRunIndex: number): BeatCoveragePlan['shotDistance'] {
  if (pattern === 'environment') return 'LS';
  if (pattern === 'environmental-aftermath') return 'MLS';
  if (pattern === 'insert') return 'CU';
  if (pattern === 'ensemble') return 'MLS';
  if (pattern === 'triangle') return dialogueRunIndex >= 2 ? 'MS' : 'MLS';
  if (pattern === 'solo-reaction') return beat.isClimaxBeat || beat.isKeyStoryBeat ? 'CU' : 'MCU';
  const idx = Math.min(intensityScore(beat, dialogueRunIndex), SHOT_DISTANCE_PUSH_IN.length - 1);
  return SHOT_DISTANCE_PUSH_IN[idx];
}

function chooseStagingPattern(params: {
  isEstablishing: boolean;
  foregroundIds: string[];
  backgroundIds: string[];
  payoffIds: string[];
  dialogue: boolean;
  beat: CoverageBeatInput;
}): VisualStagingPattern {
  if (params.isEstablishing) return 'environment';
  if ((params.beat.mustShowDetail || params.beat.primaryAction || '').match(/\b(letter|phone|key|hand|watch|glass|photo|note|object|detail)\b/i)) return 'insert';
  if (params.payoffIds.length > 0 || params.backgroundIds.length > 0 && params.dialogue) return 'triangle';
  if (params.foregroundIds.length >= 4) return 'ensemble';
  if (params.dialogue && params.foregroundIds.length >= 2) return params.beat.speaker ? 'ots-speaker' : 'two-shot';
  if (params.foregroundIds.length === 2) return 'two-shot';
  if (params.dialogue && params.foregroundIds.length === 1) return 'solo-reaction';
  if (params.foregroundIds.length === 1) return 'single';
  return 'environmental-aftermath';
}

function relationshipBlocking(pattern: VisualStagingPattern, requiredNames: string[], optionalNames: string[]): string {
  if (pattern === 'ots-speaker') return `Over-the-shoulder dialogue coverage: ${requiredNames[0] || 'speaker'} foregrounded, listener shoulder or reaction anchoring the other side of the frame.`;
  if (pattern === 'ots-listener') return `Over-the-shoulder listener coverage: listener reaction is primary while the speaker remains physically present.`;
  if (pattern === 'two-shot') return `${requiredNames.join(' and ')} share the frame; their distance, eye-lines, and posture carry the relationship pressure.`;
  if (pattern === 'triangle') return `${requiredNames.join(' and ')} carry the exchange while ${optionalNames.join(', ') || 'the observer'} remains visibly placed as a dramatic witness.`;
  if (pattern === 'ensemble') return `Ensemble blocking with all required characters separated in depth and position.`;
  if (pattern === 'solo-reaction') return `${requiredNames[0] || 'the focal character'} isolated only as an earned reaction to the conversation.`;
  if (pattern === 'insert') return `Insert shot keeps the key detail readable while preserving character presence if required.`;
  if (pattern === 'environment') return 'Environment-only establishing shot; no characters are required in frame.';
  return 'Environmental aftermath; the space carries emotional residue after the beat.';
}

export function planSceneCoverage(input: SceneCoverageInput): SceneCoveragePlan {
  const sceneCharacterIds = normalizeIdList(input.sceneCharacterIds);
  const sceneCharacterSet = new Set(sceneCharacterIds);
  const sceneCharacters = input.characters.filter(c => sceneCharacterSet.has(c.id));
  const characterById = new Map(sceneCharacters.map(c => [c.id, c]));
  const beats: CoveragePlanBeat[] = [];
  const castWarnings: string[] = [];
  const solitaryCompositionWarnings: string[] = [];
  let dialogueRunIndex = 0;
  let solitaryRun = 0;

  for (let index = 0; index < input.beats.length; index += 1) {
    const beat = input.beats[index];
    const materialText = [
      beat.text,
      beat.visualMoment,
      beat.primaryAction,
      beat.relationshipDynamic,
      beat.mustShowDetail,
    ].filter(Boolean).join(' ');
    const speaker = matchCharacterBySpeaker(beat.speaker, sceneCharacters);
    const mentionedIds = new Set<string>();
    for (const character of sceneCharacters) {
      if (characterMentioned(character, materialText)) mentionedIds.add(character.id);
    }
    if (includesSecondPerson(materialText) && sceneCharacterSet.has(input.protagonistId)) {
      mentionedIds.add(input.protagonistId);
    }
    for (const id of inferAliasCharacterIds(materialText, sceneCharacters, mentionedIds)) {
      mentionedIds.add(id);
    }
    if (speaker) mentionedIds.add(speaker.id);

    const dialogue = isDialogueBeat(beat);
    dialogueRunIndex = dialogue ? dialogueRunIndex + 1 : 0;
    const isEstablishing = beat.shotType === 'establishing' && !dialogue && mentionedIds.size === 0;

    const foreground = new Set<string>();
    const background = new Set<string>();
    const addressed = new Set<string>();
    const listeners = new Set<string>();
    const observers = new Set<string>();
    const reasons: string[] = [];

    if (!isEstablishing) {
      if (speaker) {
        foreground.add(speaker.id);
        reasons.push(`speaker ${speaker.name}`);
      }
      for (const id of mentionedIds) {
        const character = characterById.get(id);
        if (!character) continue;
        const ctx = characterContext(character, materialText);
        if (OBSERVER_RE.test(ctx) && speaker?.id !== id) {
          background.add(id);
          observers.add(id);
          reasons.push(`${character.name} has observer/listener context`);
        } else {
          foreground.add(id);
          reasons.push(`${character.name} is active or named`);
        }
      }

      if (dialogue) {
        const nonSpeaker = sceneCharacterIds.filter(id => id !== speaker?.id);
        const visibleNonSpeaker = nonSpeaker.filter(id => foreground.has(id) || background.has(id));
        const fallbackListener = visibleNonSpeaker[0] || nonSpeaker[0];
        if (fallbackListener) {
          foreground.add(fallbackListener);
          listeners.add(fallbackListener);
          addressed.add(fallbackListener);
          reasons.push(`${characterById.get(fallbackListener)?.name || fallbackListener} included as dialogue listener`);
        }
      }

      if (foreground.size === 0 && sceneCharacterSet.has(input.protagonistId)) {
        foreground.add(input.protagonistId);
        reasons.push('protagonist used as last-resort focal participant');
      }
    }

    const currentVisible = new Set([...foreground, ...background]);
    const payoffRelevant = dialogue
      ? futurePayoffIds(index, input.beats, sceneCharacters, currentVisible)
      : [];
    for (const id of payoffRelevant) {
      background.add(id);
      observers.add(id);
      reasons.push(`${characterById.get(id)?.name || id} kept visible for future payoff`);
    }

    for (const id of foreground) background.delete(id);
    const foregroundIds = normalizeIdList(Array.from(foreground));
    const backgroundIds = normalizeIdList(Array.from(background));
    const activeIds = normalizeIdList([...foregroundIds, ...backgroundIds]);
    const offscreenIds = sceneCharacterIds.filter(id => !activeIds.includes(id));
    const pattern = chooseStagingPattern({
      isEstablishing,
      foregroundIds,
      backgroundIds,
      payoffIds: payoffRelevant,
      dialogue,
      beat,
    });
    const shotDistance = chooseShotDistance(pattern, beat, dialogueRunIndex);
    const requiredIds = pattern === 'triangle'
      ? activeIds
      : activeIds.filter(id => foregroundIds.includes(id));
    const optionalIds = pattern === 'triangle' ? [] : backgroundIds;
    const requiredNames = requiredIds.map(id => characterById.get(id)?.name || id);
    const optionalNames = optionalIds.map(id => characterById.get(id)?.name || id);
    const blocking = relationshipBlocking(pattern, requiredNames, optionalNames);

    if (dialogue && activeIds.length === 0) {
      castWarnings.push(`${beat.id}: dialogue beat has no visible dramatic participant`);
    }
    if (SOLITARY_PATTERNS.has(pattern) || WINDOW_DISTANCE_RE.test(materialText) && activeIds.length <= 1) {
      solitaryRun += 1;
      if (solitaryRun >= 3) {
        solitaryCompositionWarnings.push(`${beat.id}: repeated solitary/window/distance composition (${solitaryRun} in a row)`);
      }
    } else {
      solitaryRun = 0;
    }

    beats.push({
      beatId: beat.id,
      visualCast: {
        sceneCharacterIds,
        activeCharacterIds: activeIds,
        foregroundCharacterIds: foregroundIds,
        backgroundCharacterIds: backgroundIds,
        offscreenCharacterIds: offscreenIds,
        speakerCharacterId: speaker?.id,
        addressedCharacterIds: normalizeIdList(Array.from(addressed)),
        listenerCharacterIds: normalizeIdList(Array.from(listeners)),
        observerCharacterIds: normalizeIdList(Array.from(observers)),
        payoffRelevantCharacterIds: normalizeIdList(payoffRelevant),
        castReason: reasons.join('; ') || (isEstablishing ? 'establishing/environment beat' : 'coverage fallback'),
      },
      coveragePlan: {
        stagingPattern: pattern,
        shotDistance,
        cameraAngle: pattern === 'solo-reaction' || pattern === 'two-shot' ? 'eye-level' : pattern === 'triangle' ? 'three-quarter eye-level' : 'eye-level',
        cameraSide: dialogueRunIndex % 2 === 0 ? 'reverse' : 'primary',
        focalCharacterIds: foregroundIds,
        requiredVisibleCharacterIds: requiredIds,
        optionalVisibleCharacterIds: optionalIds,
        offscreenCharacterIds: offscreenIds,
        relationshipBlocking: blocking,
        coverageReason: [
          dialogue ? `dialogue coverage run ${dialogueRunIndex}` : 'non-dialogue coverage',
          payoffRelevant.length > 0 ? `future payoff observer(s): ${optionalNames.join(', ')}` : '',
          `pattern=${pattern}`,
          `shot=${shotDistance}`,
        ].filter(Boolean).join('; '),
        visualContinuity: {
          mode: 'fresh_composition',
          reason: 'Default story-beat coverage favors varied staging; locked-off micro-progression requires an explicit beat-level override.',
        },
      },
    });
  }

  return {
    sceneId: input.sceneId,
    beats,
    diagnostics: {
      solitaryCompositionWarnings,
      castWarnings,
    },
  };
}
