/**
 * Blocking gate: treatment NPC visual_identity contracts must appear in the
 * character bible (and first on-page appearance when story prose is available).
 */

import type { Story } from '../../types';
import type { CharacterTreatmentRealizationContract } from '../../types/scenePlan';
import type { CharacterBible } from '../agents/CharacterDesigner';
import { treatmentFieldTokens } from '../utils/treatmentFieldContracts';
import { BaseValidator, ValidationIssue, ValidationResult } from './BaseValidator';

export interface NpcVisualIdentityInput {
  contracts: CharacterTreatmentRealizationContract[];
  characterBible?: CharacterBible;
  story?: Story;
}

const CONTRADICT_HAIR: Array<[RegExp, RegExp]> = [
  [/\b(?:dark|black|brown|brunette)\b/i, /\b(?:silver|white|blonde|blond|platinum)\b/i],
  [/\b(?:silver|white|blonde|blond|platinum)\b/i, /\b(?:dark|black|brown|brunette)\b/i],
];

function bibleTextForCharacter(
  bible: CharacterBible | undefined,
  characterName: string,
  characterId?: string,
): string {
  const match = (bible?.characters ?? []).find((character) =>
    character.name.toLowerCase() === characterName.toLowerCase()
    || (characterId && character.id === characterId)
    || character.name.toLowerCase().includes(characterName.toLowerCase().split(/\s+/)[0]),
  );
  if (!match) return '';
  return [
    match.physicalDescription,
    ...(match.distinctiveFeatures ?? []),
    match.typicalAttire,
    match.fashionStyle?.styleSummary,
    ...(match.fashionStyle?.styleTags ?? []),
    ...(match.fashionStyle?.accessories ?? []),
    ...(match.fashionStyle?.colorPalette ?? []),
  ].filter(Boolean).join(' ');
}

function storyTextForCharacter(story: Story | undefined, characterName: string): string {
  if (!story) return '';
  const needle = characterName.split(/\s+/)[0]?.toLowerCase();
  if (!needle) return '';
  const chunks: string[] = [];
  for (const episode of story.episodes ?? []) {
    for (const scene of episode.scenes ?? []) {
      for (const beat of scene.beats ?? []) {
        const text = beat.text || '';
        if (text.toLowerCase().includes(needle)) chunks.push(text);
      }
    }
  }
  return chunks.join(' ');
}

function hasContradictingHair(contractText: string, realizedText: string): boolean {
  for (const [required, forbidden] of CONTRADICT_HAIR) {
    if (required.test(contractText) && forbidden.test(realizedText) && !required.test(realizedText)) {
      return true;
    }
  }
  return false;
}

export class NpcVisualIdentityValidator extends BaseValidator {
  constructor() {
    super('NpcVisualIdentityValidator');
  }

  validate(input: NpcVisualIdentityInput): ValidationResult {
    const issues: ValidationIssue[] = [];
    const npcVisuals = (input.contracts ?? []).filter(
      (contract) => contract.contractKind === 'visual_identity'
        && contract.blockingLevel === 'structural'
        && contract.characterName
        && !/protagonist/i.test(contract.characterName),
    );

    for (const contract of npcVisuals) {
      const name = contract.characterName!;
      const bibleText = bibleTextForCharacter(input.characterBible, name, contract.characterId);
      const tokens = treatmentFieldTokens(contract.sourceText).filter((token) => token.length >= 4);
      const missing = tokens.filter((token) => !bibleText.toLowerCase().includes(token.toLowerCase()));
      // Require at least half of distinctive tokens (hair/skin/jewelry) in bible.
      if (!bibleText.trim()) {
        issues.push(this.error(
          `NPC "${name}" has treatment visual_identity but no character bible entry.`,
          `npc-visual:${name}`,
          'Carry treatment visual tokens into CharacterDesigner physicalDescription.',
        ));
        continue;
      }
      if (tokens.length > 0 && missing.length > tokens.length / 2) {
        issues.push(this.error(
          `NPC "${name}" bible is missing treatment visual tokens: ${missing.slice(0, 6).join(', ')}.`,
          `npc-visual:${name}`,
          `Prefix physicalDescription / distinctiveFeatures with: ${contract.sourceText}`,
        ));
      }
      if (hasContradictingHair(contract.sourceText, bibleText)) {
        issues.push(this.error(
          `NPC "${name}" bible contradicts treatment visual_identity hair/color tokens.`,
          `npc-visual:${name}`,
          'Treatment visual tokens are immutable; do not invent conflicting hair color.',
        ));
      }

      const onPage = storyTextForCharacter(input.story, name);
      if (onPage && hasContradictingHair(contract.sourceText, onPage)) {
        issues.push(this.error(
          `NPC "${name}" first on-page prose contradicts treatment visual_identity.`,
          `npc-visual:${name}:prose`,
        ));
      }
    }

    const errors = issues.filter((issue) => issue.severity === 'error').length;
    return {
      valid: errors === 0,
      score: errors === 0 ? 100 : Math.max(0, 100 - errors * 25),
      issues,
      suggestions: issues.map((issue) => issue.suggestion).filter((value): value is string => Boolean(value)),
    };
  }
}
