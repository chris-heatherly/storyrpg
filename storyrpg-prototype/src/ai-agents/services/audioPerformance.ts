import type { BeatAudioRequest } from './audioGenerationService';

export type AudioPerformanceTag =
  | 'whispering'
  | 'hushed'
  | 'urgent'
  | 'tense'
  | 'tender'
  | 'playful'
  | 'commanding'
  | 'bitter'
  | 'grief-held'
  | 'breathless'
  | 'triumphant'
  | 'ominous'
  | 'measured';

const AUDIO_TAG_RE = /\s*(?:\[(?:whispering|hushed|urgent|tense|tender|playful|commanding|bitter|grief-held|breathless|triumphant|ominous|measured|pause|beat|sigh|laughs?|crying|softly|loudly|angrily|sadly)[^\]]*\]|<\s*\/?\s*(?:voice|prosody|speak|break|emphasis)\b[^>]*>)/i;
const AUDIO_TAG_GLOBAL_RE = /\s*(?:\[(?:whispering|hushed|urgent|tense|tender|playful|commanding|bitter|grief-held|breathless|triumphant|ominous|measured|pause|beat|sigh|laughs?|crying|softly|loudly|angrily|sadly)[^\]]*\]|<\s*\/?\s*(?:voice|prosody|speak|break|emphasis)\b[^>]*>)/gi;

export function stripAudioPerformanceTags(text: string): string {
  return text.replace(AUDIO_TAG_GLOBAL_RE, ' ').replace(/\s{2,}/g, ' ').trim();
}

export function hasAudioPerformanceTagLeak(text: unknown): boolean {
  return typeof text === 'string' && AUDIO_TAG_RE.test(text);
}

function normalizeMood(value?: string): string {
  return (value || '').toLowerCase();
}

export function inferAudioPerformanceTags(beat: BeatAudioRequest): AudioPerformanceTag[] {
  const mood = normalizeMood(beat.speakerMood);
  const text = normalizeMood(beat.text);
  const tags = new Set<AudioPerformanceTag>();

  if (/\b(whisper|secret|barely|quiet|hushed|under breath)\b/.test(mood + ' ' + text)) tags.add('hushed');
  if (/\b(urgent|panic|frantic|rush|desperate|alarm)\b/.test(mood + ' ' + text)) tags.add('urgent');
  if (/\b(tense|afraid|fear|dread|nervous|threat|danger)\b/.test(mood + ' ' + text)) tags.add('tense');
  if (/\b(tender|gentle|soft|warm|fond|intimate)\b/.test(mood + ' ' + text)) tags.add('tender');
  if (/\b(playful|teasing|wry|mischief|laugh)\b/.test(mood + ' ' + text)) tags.add('playful');
  if (/\b(command|commanding|authoritative|order|hard|steel)\b/.test(mood + ' ' + text)) tags.add('commanding');
  if (/\b(bitter|cold|resent|contempt|venom)\b/.test(mood + ' ' + text)) tags.add('bitter');
  if (/\b(grief|grieving|mourning|loss|heartbroken)\b/.test(mood + ' ' + text)) tags.add('grief-held');
  if (/\b(breathless|running|gasp|pant|chase)\b/.test(mood + ' ' + text)) tags.add('breathless');
  if (/\b(triumph|victory|defiant|exultant)\b/.test(mood + ' ' + text)) tags.add('triumphant');
  if (/\b(ominous|eerie|menacing|haunt|shadow)\b/.test(mood + ' ' + text)) tags.add('ominous');
  if (tags.size === 0) tags.add('measured');

  return Array.from(tags).slice(0, 2);
}

export function buildAudioPerformanceScript(beat: BeatAudioRequest, enabled: boolean): string {
  const cleanText = stripAudioPerformanceTags(beat.text);
  if (!enabled) return cleanText;
  const tags = inferAudioPerformanceTags({ ...beat, text: cleanText });
  return `${tags.map((tag) => `[${tag}]`).join(' ')} ${cleanText}`;
}
