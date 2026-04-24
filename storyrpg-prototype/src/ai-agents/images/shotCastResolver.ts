export interface ShotCastCharacter {
  id: string;
  name: string;
}

export interface ShotCastBeat {
  text?: string;
  speaker?: string;
  visualMoment?: string;
  primaryAction?: string;
  emotionalRead?: string;
  relationshipDynamic?: string;
  mustShowDetail?: string;
  shotType?: 'establishing' | 'character' | 'action';
}

export interface ShotCastResult {
  requiredForegroundCharacterIds: string[];
  optionalBackgroundCharacterIds: string[];
  offscreenCharacterIds: string[];
  shotCastReason: string;
}

interface ResolveShotCastInput {
  beat: ShotCastBeat;
  sceneCharacterIds: string[];
  characters: ShotCastCharacter[];
  protagonistId?: string;
}

const VISIBLE_SECOND_PERSON = /\b(you|your)\s+(?:stand|stands|step|steps|move|moves|walk|walks|run|runs|reach|reaches|grab|grabs|hold|holds|face|faces|turn|turns|look|looks|watch|watches|stare|stares|recoil|recoils|flinch|flinches|raise|raises|lower|lowers|kneel|kneels|sit|sits|collapse|collapses|fall|falls|push|pushes|pull|pulls|strike|strikes|aim|aims|draw|draws|shout|shouts|whisper|whispers|cry|cries|smile|smiles|frown|frowns|tremble|trembles|freeze|freezes)\b/i;

const OBSERVER_CONTEXT = /\b(watches?|observes?|witnesses?|sees?|notices?|listens?|overhears?|studies|stares?|peers?|glimpses|reacts?|flinches|gasps|from the doorway|from the threshold|from behind|in the background|at the edge|off to the side|over .* shoulder)\b/i;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeIdList(ids: string[]): string[] {
  return Array.from(new Set(ids.filter(Boolean)));
}

function matchCharacterBySpeaker(
  speaker: string | undefined,
  characters: ShotCastCharacter[],
): ShotCastCharacter | undefined {
  if (!speaker) return undefined;
  const lowered = speaker.toLowerCase();
  return characters.find(c => c.id.toLowerCase() === lowered || c.name.toLowerCase() === lowered);
}

function characterMentionedInText(character: ShotCastCharacter, text: string): boolean {
  if (!text.trim()) return false;
  const name = character.name.trim();
  if (!name) return false;
  if (new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i').test(text)) return true;
  return name
    .split(/\s+/)
    .map(part => part.trim())
    .filter(part => part.length > 2)
    .some(part => new RegExp(`\\b${escapeRegExp(part)}\\b`, 'i').test(text));
}

function contextAroundName(character: ShotCastCharacter, text: string): string {
  const tokens = [
    character.name,
    ...character.name.split(/\s+/).filter(part => part.length > 2),
  ];
  for (const token of tokens) {
    const match = new RegExp(`.{0,48}\\b${escapeRegExp(token)}\\b.{0,64}`, 'i').exec(text);
    if (match) return match[0];
  }
  return '';
}

function characterHasObserverContext(character: ShotCastCharacter, text: string): boolean {
  const ctx = contextAroundName(character, text);
  return OBSERVER_CONTEXT.test(ctx);
}

function idsToNames(ids: string[], characters: ShotCastCharacter[]): string[] {
  return ids.map(id => characters.find(c => c.id === id)?.name || id);
}

export function resolveShotCast(input: ResolveShotCastInput): ShotCastResult {
  const sceneCharacterIds = normalizeIdList(input.sceneCharacterIds);
  const sceneCharacterSet = new Set(sceneCharacterIds);
  const characters = input.characters.filter(c => sceneCharacterSet.has(c.id));

  if (input.beat.shotType === 'establishing') {
    return {
      requiredForegroundCharacterIds: [],
      optionalBackgroundCharacterIds: [],
      offscreenCharacterIds: sceneCharacterIds,
      shotCastReason: 'establishing shot: no character references or visible cast required',
    };
  }

  const foreground = new Set<string>();
  const background = new Set<string>();
  const reasons: string[] = [];
  const visualContractText = [
    input.beat.visualMoment,
    input.beat.primaryAction,
    input.beat.emotionalRead,
    input.beat.relationshipDynamic,
    input.beat.mustShowDetail,
  ].filter(Boolean).join(' ');
  const materialText = [visualContractText, input.beat.text].filter(Boolean).join(' ');

  const speaker = matchCharacterBySpeaker(input.beat.speaker, characters);
  if (speaker) {
    foreground.add(speaker.id);
    reasons.push(`speaker ${speaker.name}`);
  }

  for (const character of characters) {
    if (characterMentionedInText(character, visualContractText)) {
      foreground.add(character.id);
      reasons.push(`${character.name} named in visual contract`);
    }
  }

  for (const character of characters) {
    if (foreground.has(character.id)) continue;
    if (!characterMentionedInText(character, input.beat.text || '')) continue;
    if (characterHasObserverContext(character, input.beat.text || '')) {
      background.add(character.id);
      reasons.push(`${character.name} visibly observes/reacts`);
    } else {
      foreground.add(character.id);
      reasons.push(`${character.name} materially named in beat text`);
    }
  }

  if (
    input.protagonistId &&
    sceneCharacterSet.has(input.protagonistId) &&
    !foreground.has(input.protagonistId) &&
    !background.has(input.protagonistId) &&
    VISIBLE_SECOND_PERSON.test(materialText)
  ) {
    foreground.add(input.protagonistId);
    const protagonistName = characters.find(c => c.id === input.protagonistId)?.name || 'protagonist';
    reasons.push(`${protagonistName} included by visible second-person action`);
  }

  if (foreground.size === 0) {
    if (speaker) {
      foreground.add(speaker.id);
      reasons.push(`fallback to speaker ${speaker.name}`);
    } else if (input.protagonistId && sceneCharacterSet.has(input.protagonistId)) {
      foreground.add(input.protagonistId);
      const protagonistName = characters.find(c => c.id === input.protagonistId)?.name || 'protagonist';
      reasons.push(`last-resort visual anchor ${protagonistName}`);
    }
  }

  for (const id of foreground) {
    background.delete(id);
  }

  const requiredForegroundCharacterIds = normalizeIdList(Array.from(foreground));
  const optionalBackgroundCharacterIds = normalizeIdList(Array.from(background));
  const visible = new Set([...requiredForegroundCharacterIds, ...optionalBackgroundCharacterIds]);
  const offscreenCharacterIds = sceneCharacterIds.filter(id => !visible.has(id));
  const foregroundNames = idsToNames(requiredForegroundCharacterIds, characters).join(', ') || 'none';
  const backgroundNames = idsToNames(optionalBackgroundCharacterIds, characters).join(', ') || 'none';

  return {
    requiredForegroundCharacterIds,
    optionalBackgroundCharacterIds,
    offscreenCharacterIds,
    shotCastReason: `${reasons.join('; ') || 'no explicit cast signal'}; foreground: ${foregroundNames}; background: ${backgroundNames}`,
  };
}
