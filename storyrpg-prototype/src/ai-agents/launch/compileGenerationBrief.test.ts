import { describe, expect, it } from 'vitest';
import type { FullCreativeBrief } from '../pipeline/FullStoryPipeline';
import type { SeasonPlan } from '../../types/seasonPlan';
import type { SourceMaterialAnalysis } from '../../types/sourceAnalysis';
import { compileGenerationBrief, selectGenerationIdentityResolution } from './compileGenerationBrief';

function brief(name: string, pronouns: FullCreativeBrief['protagonist']['pronouns'] = 'he/him'): FullCreativeBrief {
  return {
    story: { title: 'Fixture', genre: 'Drama', synopsis: '', tone: '', themes: [] },
    world: { premise: '', timePeriod: '', technologyLevel: '', keyLocations: [] },
    protagonist: { id: 'protagonist', name, pronouns, description: '', role: 'protagonist' },
    npcs: [],
    episode: { number: 1, title: 'One', synopsis: '', startingLocation: '' },
  } as FullCreativeBrief;
}

function analysis(name = 'Mara Vale'): SourceMaterialAnalysis {
  return {
    sourceTitle: 'Fixture',
    protagonist: { id: 'char-mara', name, pronouns: 'she/her', description: 'A witness.', arc: '' },
  } as SourceMaterialAnalysis;
}

function plan(name = 'Mara Vale'): SeasonPlan {
  return {
    id: 'fixture-plan',
    protagonist: { id: 'char-mara', name, description: 'A witness.' },
    episodes: [],
  } as unknown as SeasonPlan;
}

describe('compileGenerationBrief', () => {
  it('uses the compiled receipt for archived resume payloads that predate identity receipts', () => {
    const compiled = compileGenerationBrief({
      draftBrief: brief('The Hero'), sourceAnalysis: analysis(), seasonPlan: plan(),
    }).identityResolution;
    expect(selectGenerationIdentityResolution(undefined, compiled)).toBe(compiled);
  });

  it.each(['The Hero', 'Hero', 'the protagonist', 'TBD', '']) (
    'replaces provisional identity %j with locked canonical identity',
    (placeholder) => {
      const result = compileGenerationBrief({
        draftBrief: brief(placeholder),
        sourceAnalysis: analysis(),
        seasonPlan: plan(),
      });

      expect(result.brief.protagonist).toMatchObject({
        id: 'char-mara', name: 'Mara Vale', pronouns: 'she/her',
      });
      expect(result.identityResolution).toMatchObject({
        action: 'normalized', canonicalSource: 'season_plan', canonicalName: 'Mara Vale',
      });
    },
  );

  it('accepts equivalent names and reconciles canonical id and pronouns', () => {
    const result = compileGenerationBrief({
      draftBrief: brief(' mara  vale '),
      sourceAnalysis: analysis(),
      seasonPlan: plan(),
    });

    expect(result.brief.protagonist).toMatchObject({ id: 'char-mara', name: 'Mara Vale', pronouns: 'she/her' });
    expect(result.identityResolution.action).toBe('normalized');
  });

  it('blocks a genuine name-vs-name contradiction before generation', () => {
    expect(() => compileGenerationBrief({
      draftBrief: brief('Jon Bell'),
      sourceAnalysis: analysis(),
      seasonPlan: plan(),
    })).toThrow(/Jon Bell.*conflicts with.*Mara Vale/i);
  });

  it('blocks disagreement between source analysis and the locked season plan', () => {
    expect(() => compileGenerationBrief({
      draftBrief: brief('Mara Vale', 'she/her'),
      sourceAnalysis: analysis('Mara Vale'),
      seasonPlan: plan('Jon Bell'),
    })).toThrow(/Mara Vale.*conflicts with.*Jon Bell/i);
  });

  it('keeps unresolved identity empty when no canonical source exists', () => {
    const result = compileGenerationBrief({ draftBrief: brief('The Hero') });
    expect(result.brief.protagonist).toMatchObject({ name: '', pronouns: 'they/them' });
    expect(result.identityResolution).toMatchObject({ action: 'missing', canonicalSource: 'missing' });
  });
});
