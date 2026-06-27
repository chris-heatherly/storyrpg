import type { Scene, Story } from '../../types';
import { BaseValidator, type ValidationIssue, type ValidationResult } from './BaseValidator';

export interface EncounterProseFinding {
  sceneId: string;
  location: string;
  excerpt: string;
  pattern: string;
}

const MALFORMED_YOU_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  {
    name: 'malformed-you-noun',
    pattern: /\byou\s+(rooftop|bar|stair|same|charcoal|flannel|hedge|music|dark|threshold|room|club|glass|curtain|willow|attacker|boulevard|first|velvet|key(?:\s+card)?|back-room|door|choice|candle|maze|lantern|inch|noticer|woman|night|pulse|watchfulness|grin|thing|catalogue)\b/i,
  },
  {
    name: 'malformed-you-fragment',
    pattern: /\byou\s+(freez|ly)\b/i,
  },
  {
    name: 'malformed-you-possessive',
    pattern: /\byou\s+[a-z]+['’]\s+[a-z]/i,
  },
  {
    name: 'malformed-kiss-verb',
    pattern: /\byou\s+kiss\s+takes\b/i,
  },
  {
    name: 'malformed-you-object',
    pattern: /\byou\s+(kiss|reach|answer|leave|take|hold|keep\s+kissing)\s+you\b/i,
  },
];

const STRING_KEYS = new Set([
  'text',
  'setupText',
  'escalationText',
  'narrativeText',
  'outcomeText',
  'visualMoment',
  'visualNarrative',
  'visibleCost',
  'visibleComplication',
  'immediateEffect',
  'lingeringEffect',
  'description',
  'victory',
  'defeat',
  'nextSituation',
  'choiceText',
]);

function excerptAround(text: string, index: number): string {
  const start = Math.max(0, index - 80);
  const end = Math.min(text.length, index + 120);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

function isGrammaticalYouObject(text: string, index: number): boolean {
  const prefix = text.slice(Math.max(0, index - 32), index).toLowerCase();
  return /\b(?:give|gives|gave|giving|allow|allows|allowed|leave|leaves|left|offer|offers|offered)\s+$/.test(prefix);
}

function collectEncounterStrings(scene: Scene): Array<{ location: string; text: string }> {
  const encounter = scene.encounter as unknown;
  const texts: Array<{ location: string; text: string }> = [];
  const seen = new Set<object>();

  const visit = (node: unknown, path: string): void => {
    if (!node || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }

    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const nextPath = `${path}.${key}`;
      if (typeof value === 'string') {
        if (STRING_KEYS.has(key)) texts.push({ location: nextPath, text: value });
      } else {
        visit(value, nextPath);
      }
    }
  };

  visit(encounter, `scene:${scene.id}.encounter`);
  return texts;
}

export class EncounterProseIntegrityValidator extends BaseValidator {
  constructor() {
    super('EncounterProseIntegrityValidator');
  }

  validate(input: { story: Story }): ValidationResult & { findings: EncounterProseFinding[] } {
    const findings: EncounterProseFinding[] = [];
    const issues: ValidationIssue[] = [];

    for (const episode of input.story.episodes || []) {
      for (const scene of episode.scenes || []) {
        if (!scene.encounter) continue;
        for (const item of collectEncounterStrings(scene)) {
          for (const { name, pattern } of MALFORMED_YOU_PATTERNS) {
            const match = pattern.exec(item.text);
            if (!match || match.index === undefined) continue;
            if (name === 'malformed-you-noun' && isGrammaticalYouObject(item.text, match.index)) continue;
            const excerpt = excerptAround(item.text, match.index);
            findings.push({
              sceneId: scene.id,
              location: item.location,
              excerpt,
              pattern: name,
            });
            issues.push(this.error(
              `Encounter prose has malformed second-person rewrite residue: "${excerpt}"`,
              item.location,
              'Regenerate or repair the encounter prose so second-person narration uses grammatical "you/your" phrasing.'
            ));
            break;
          }
        }
      }
    }

    return {
      valid: issues.length === 0,
      score: issues.length === 0 ? 100 : Math.max(0, 100 - issues.length * 20),
      issues,
      suggestions: issues.length === 0
        ? []
        : ['Repair malformed encounter prose before final packaging.'],
      findings,
    };
  }
}
