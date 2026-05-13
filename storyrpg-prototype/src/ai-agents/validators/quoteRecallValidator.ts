import type { Beat, Story } from '../../types';

export interface QuoteRecallIssue {
  episodeNumber: number;
  sceneId: string;
  beatId?: string;
  quote: string;
  detail: string;
}

const RECALL_CONTEXT = /\b(recall|recalled|remember|remembered|echo|echoed|said|asked|told|words?|line)\b/i;

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasEnoughWords(text: string): boolean {
  return normalizeText(text).split(/\s+/).filter(Boolean).length >= 4;
}

function extractQuotedPhrases(text: string): Array<{ quote: string; index: number }> {
  const phrases: Array<{ quote: string; index: number }> = [];
  const patterns = [
    /"([^"\n]{12,180})"/g,
    /\*([^*\n]{12,180})\*/g,
    /“([^”\n]{12,180})”/g,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const quote = match[1].trim();
      if (hasEnoughWords(quote)) {
        phrases.push({ quote, index: match.index });
      }
    }
  }

  return phrases;
}

function hasRecallContext(text: string, index: number): boolean {
  const start = Math.max(0, index - 120);
  const end = Math.min(text.length, index + 220);
  return RECALL_CONTEXT.test(text.slice(start, end));
}

function appendBeatText(parts: string[], beat: Partial<Beat> | Record<string, unknown>): void {
  const record = beat as Record<string, unknown>;
  for (const key of ['text', 'setupText', 'escalationText', 'description', 'narrativeText']) {
    if (typeof record[key] === 'string') {
      parts.push(record[key] as string);
    }
  }

  const choices = Array.isArray(record.choices) ? record.choices as Array<Record<string, unknown>> : [];
  for (const choice of choices) {
    if (typeof choice.text === 'string') parts.push(choice.text);
    const outcomes = choice.outcomes && typeof choice.outcomes === 'object'
      ? choice.outcomes as Record<string, Record<string, unknown>>
      : {};
    for (const outcome of Object.values(outcomes)) {
      appendBeatText(parts, outcome);
      const nextSituation = outcome.nextSituation;
      if (nextSituation && typeof nextSituation === 'object') {
        appendBeatText(parts, nextSituation as Record<string, unknown>);
      }
    }
  }
}

function collectSceneText(scene: Story['episodes'][number]['scenes'][number]): string {
  const parts: string[] = [scene.name];
  for (const beat of scene.beats || []) {
    appendBeatText(parts, beat);
  }

  for (const phase of scene.encounter?.phases || []) {
    parts.push(phase.name, phase.description);
    for (const beat of phase.beats || []) {
      appendBeatText(parts, beat as unknown as Record<string, unknown>);
    }
    if (phase.onSuccess?.outcomeText) parts.push(phase.onSuccess.outcomeText);
    if (phase.onFailure?.outcomeText) parts.push(phase.onFailure.outcomeText);
  }

  for (const outcome of Object.values(scene.encounter?.outcomes || {})) {
    if (outcome?.outcomeText) parts.push(outcome.outcomeText);
    if ('complication' in outcome && typeof outcome.complication === 'string') {
      parts.push(outcome.complication);
    }
  }

  return parts.filter(Boolean).join('\n');
}

export function findUnsupportedQuotedRecallIssues(story: Pick<Story, 'episodes'>): QuoteRecallIssue[] {
  const issues: QuoteRecallIssue[] = [];
  let priorText = '';

  for (const episode of story.episodes || []) {
    for (const scene of episode.scenes || []) {
      const priorNormalized = normalizeText(priorText);
      for (const beat of scene.beats || []) {
        const text = beat.text || '';
        for (const phrase of extractQuotedPhrases(text)) {
          const normalizedQuote = normalizeText(phrase.quote);
          if (!hasRecallContext(text, phrase.index) || priorNormalized.includes(normalizedQuote)) {
            continue;
          }
          issues.push({
            episodeNumber: episode.number,
            sceneId: scene.id,
            beatId: beat.id,
            quote: phrase.quote,
            detail: `Scene ${scene.id}${beat.id ? ` beat ${beat.id}` : ''} recalls quoted dialogue that is not present earlier in the story: "${phrase.quote}"`,
          });
        }
      }

      priorText = `${priorText}\n${collectSceneText(scene)}`;
    }
  }

  return issues;
}
