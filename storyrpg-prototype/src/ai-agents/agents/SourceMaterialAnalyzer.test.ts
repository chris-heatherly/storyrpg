import { describe, expect, it } from 'vitest';

import {
  containsSchemaPlaceholder,
  normalizeSchemaAbstraction,
  normalizeSchemaVariableName,
} from './SourceMaterialAnalyzer';
import type { StoryAnchors, StorySchemaAbstraction } from '../../types/sourceAnalysis';

const anchors: StoryAnchors = {
  stakes: 'The mountain village and the protagonist dignity.',
  goal: 'Find a cure before winter closes the pass.',
  incitingIncident: 'The village well turns black overnight.',
  climax: 'The protagonist confronts the keeper of the pass during the storm.',
};

describe('SourceMaterialAnalyzer schema abstraction helpers', () => {
  it('normalizes schema variable names to PascalCase without braces', () => {
    expect(normalizeSchemaVariableName('{emotional anchor location}')).toBe('EmotionalAnchorLocation');
    expect(normalizeSchemaVariableName('false-victory')).toBe('FalseVictory');
    expect(normalizeSchemaVariableName('')).toBe('StoryVariable');
  });

  it('detects external-style placeholders so they can be kept out of player prose', () => {
    expect(containsSchemaPlaceholder('{Goal}')).toBe(true);
    expect(containsSchemaPlaceholder('The Goal is named without braces.')).toBe(false);
  });

  it('adds required anchor variables and strips placeholder braces from metadata text', () => {
    const abstraction: StorySchemaAbstraction = {
      archetype: 'Temptation and Moral Cost',
      adaptationMode: 'inspired_by',
      schemaVariables: [
        {
          name: '{protagonist role}',
          description: 'The person chasing {Goal}.',
          examples: ['{Protagonist}'],
        },
      ],
      generalizationGuidance: ['Preserve {Temptation}, not the original setting.'],
      reusablePatternSummary: 'A pressured hero risks their {CoreValue}.',
    };

    const normalized = normalizeSchemaAbstraction(abstraction, anchors)!;

    expect(normalized.schemaVariables.map((variable) => variable.name)).toEqual(
      expect.arrayContaining(['ProtagonistRole', 'Stakes', 'Goal', 'IncitingIncident', 'Climax']),
    );
    expect(normalized.schemaVariables[0].description).toBe('The person chasing Goal.');
    expect(normalized.schemaVariables[0].examples).toEqual(['Protagonist']);
    expect(normalized.generalizationGuidance[0]).toBe('Preserve Temptation, not the original setting.');
  });

  it('falls back to inspired_by when the mode is outside StoryRPG values', () => {
    const normalized = normalizeSchemaAbstraction(
      {
        archetype: 'Unknown',
        adaptationMode: 'schema_chapters' as any,
        schemaVariables: [],
        generalizationGuidance: [],
        reusablePatternSummary: '',
      },
      anchors,
    )!;

    expect(normalized.adaptationMode).toBe('inspired_by');
  });
});

