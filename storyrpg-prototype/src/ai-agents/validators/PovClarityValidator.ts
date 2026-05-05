import type { SceneContent } from '../agents/SceneWriter';

export interface PovClarityIssue {
  beatId: string;
  issue: string;
  severity: 'error' | 'warning';
  suggestion: string;
}

export interface PovClarityResult {
  passed: boolean;
  score: number;
  issues: PovClarityIssue[];
  shouldRegenerate: boolean;
  checkedBeatId?: string;
}

export interface PovClarityContext {
  protagonistName?: string;
  characterNames?: string[];
}

const PLAYER_TEMPLATE_RE = /\{\{\s*player\.(?:name|they|them|their|theirs|themselves|are|were|have)\s*\}\}/i;
const SECOND_PERSON_RE = /\b(?:you|your|yours|yourself)\b/i;

export function hasPlayerReference(text: string | undefined | null): boolean {
  if (!text) return false;
  return PLAYER_TEMPLATE_RE.test(text) || SECOND_PERSON_RE.test(text);
}

export class PovClarityValidator {
  validateScene(sceneContent: SceneContent, context: PovClarityContext = {}): PovClarityResult {
    const issues: PovClarityIssue[] = [];
    const firstBeat = (sceneContent.beats || []).find(beat => {
      const text = typeof beat.text === 'string' ? beat.text.trim() : String(beat.text || '').trim();
      return text.length > 0;
    });

    if (!firstBeat) {
      return {
        passed: false,
        score: 0,
        issues: [{
          beatId: sceneContent.startingBeatId || 'unknown',
          issue: 'Scene has no player-facing opening prose beat to anchor POV.',
          severity: 'error',
          suggestion: 'Add an opening beat that places the player character in the scene using you/your or {{player.name}}.',
        }],
        shouldRegenerate: true,
      };
    }

    const openingText = String(firstBeat.text || '');
    const variantTexts = Array.isArray(firstBeat.textVariants)
      ? firstBeat.textVariants.map((variant: { text?: unknown }) => String(variant.text || ''))
      : [];
    const textToCheck = [openingText, ...variantTexts].join('\n');

    if (!hasPlayerReference(textToCheck)) {
      issues.push({
        beatId: firstBeat.id,
        issue: 'Opening beat does not establish the player character as the POV/focal character.',
        severity: 'error',
        suggestion: 'Rewrite the first beat so it anchors the player with you/your or {{player.name}} before focusing on NPCs, setting, or exposition.',
      });
    }

    const characterNames = (context.characterNames || []).filter(Boolean);
    if (characterNames.length >= 2 && this.hasAmbiguousPronounChain(openingText, characterNames, context.protagonistName)) {
      issues.push({
        beatId: firstBeat.id,
        issue: 'Opening beat relies on pronouns while multiple characters are present, making the focal character ambiguous.',
        severity: 'warning',
        suggestion: 'Use {{player.name}} or exact NPC names in the opening beat before using pronouns.',
      });
    }

    const errorCount = issues.filter(i => i.severity === 'error').length;
    const warningCount = issues.filter(i => i.severity === 'warning').length;
    const score = Math.max(0, 100 - errorCount * 70 - warningCount * 20);

    return {
      passed: errorCount === 0,
      score,
      issues,
      shouldRegenerate: errorCount > 0,
      checkedBeatId: firstBeat.id,
    };
  }

  private hasAmbiguousPronounChain(text: string, characterNames: string[], protagonistName?: string): boolean {
    if (hasPlayerReference(text)) return false;

    const pronounHits = text.match(/\b(?:he|him|his|she|her|hers|they|them|their|theirs)\b/gi) || [];
    if (pronounHits.length < 2) return false;

    const lowered = text.toLowerCase();
    const hasNamedCharacter = characterNames.some(name => lowered.includes(name.toLowerCase()));
    const hasProtagonistName = protagonistName ? lowered.includes(protagonistName.toLowerCase()) : false;

    return !hasNamedCharacter && !hasProtagonistName;
  }
}
