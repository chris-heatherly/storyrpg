import { describe, expect, it } from 'vitest';
import {
  parseConditionalArtStyle,
  resolveSceneSettingContext,
  selectStyleAdaptation,
} from './styleAdaptation';

describe('styleAdaptation', () => {
  it('parses shared and conditional art-style sections without hardcoded labels', () => {
    const parsed = parseConditionalArtStyle(
      'Painterly romantic illustration with elegant faces. For MODERN/REAL WORLD settings: Use contemporary architecture, steel, glass, and modern tailoring. For OLYMPUS/FANTASTICAL settings: Use celestial marble, divine scale, and mythic opulence. General Conditional Rules: Keep palette harmony and preserve the same rendering language.'
    );

    expect(parsed.baseStyleText).toContain('Painterly romantic illustration');
    expect(parsed.branches).toHaveLength(2);
    expect(parsed.branches[0]?.semanticTargets).toContain('modern_real_world');
    expect(parsed.branches[1]?.semanticTargets).toContain('fantastical_divine');
    expect(parsed.sharedRules[0]).toContain('preserve the same rendering language');
  });

  it('resolves a modern scene-setting context from world and location metadata', () => {
    const context = resolveSceneSettingContext({
      sceneName: 'Rooftop Bar Confession',
      sceneDescription: 'A tense private conversation above the city skyline.',
      authoredLocationName: 'Downtown Rooftop Lounge',
      authoredLocationType: 'urban nightlife venue',
      authoredLocationDescription: 'Glass railings, steel beams, city lights, refined cocktails.',
      worldPremise: 'A contemporary romance in present-day New York.',
      worldTimePeriod: 'present day',
      worldTechnologyLevel: 'modern',
    });

    expect(context.worldMode).toBe('modern_real_world');
    expect(context.architectureAndMaterialCue).toContain('contemporary architecture');
  });

  it('selects the fantastical branch while preserving same-style continuity instructions', () => {
    const settingContext = resolveSceneSettingContext({
      sceneName: 'Council on Olympus',
      sceneDescription: 'Gods argue beneath a celestial vault.',
      worldPremise: 'A mythic divine romance unfolding between gods and mortals.',
      worldTimePeriod: 'timeless mythic age',
      worldTechnologyLevel: 'divine antiquity',
      worldMagicSystem: 'divine power and celestial transformation',
    });

    const selection = selectStyleAdaptation(
      'Painterly dramatic illustration. For city-night settings: emphasize reflective glass and tailored modern fashion. For divine mythic settings: emphasize celestial marble, luminous atmosphere, and ceremonial drapery.',
      settingContext
    );

    expect(selection.branchLabel.toLowerCase()).toContain('divine');
    expect(selection.notes.join(' ')).toContain('SAME overall style');
    expect(selection.notes.join(' ')).toContain('ceremonial drapery');
  });

  it('falls back to shared guidance when no confident branch matches', () => {
    const ambiguousContext = resolveSceneSettingContext({
      sceneName: 'Threshold Dream',
      sceneDescription: 'A liminal dream corridor with sparse detail.',
      worldPremise: 'A surreal emotional drama.',
      worldTimePeriod: 'ambiguous',
      worldTechnologyLevel: 'unclear',
    });

    const selection = selectStyleAdaptation(
      'Soft illustrated drama. General Rules: Preserve character silhouettes and consistent palette logic scene to scene.',
      ambiguousContext
    );

    expect(selection.branchLabel).toBe('shared');
    expect(selection.notes.join(' ')).toContain('Preserve character silhouettes');
  });
});
