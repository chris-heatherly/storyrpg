import { describe, it, expect } from 'vitest';
import { snapEncounterSkill, CANONICAL_ENCOUNTER_SKILLS } from './EncounterArchitect';

const CANON = [...CANONICAL_ENCOUNTER_SKILLS];

describe('snapEncounterSkill (F1 — canonical skill normalization)', () => {
  it('keeps already-canonical skills (normalizing case)', () => {
    expect(snapEncounterSkill('athletics', CANON)).toBe('athletics');
    expect(snapEncounterSkill('PERSUASION', CANON)).toBe('persuasion');
    expect(snapEncounterSkill(' investigation ', CANON)).toBe('investigation');
  });

  it('maps the exact invented skills that broke the endsong run', () => {
    // empathy/insight/diplomacy/tactics/arcana were the real failures.
    expect(snapEncounterSkill('empathy', CANON)).toBe('persuasion');
    expect(snapEncounterSkill('insight', CANON)).toBe('perception');
    expect(snapEncounterSkill('diplomacy', CANON)).toBe('persuasion');
    expect(snapEncounterSkill('tactics', CANON)).toBe('investigation');
    expect(snapEncounterSkill('arcana', CANON)).toBe('investigation');
  });

  it('falls back to a valid skill for unknown names and empty/garbage input', () => {
    expect(snapEncounterSkill('totally_made_up_skill', CANON)).toBe('perception');
    expect(snapEncounterSkill(undefined, CANON)).toBe('perception');
    expect(snapEncounterSkill('', CANON)).toBe('perception');
  });

  it('only snaps to skills the story actually defines', () => {
    // arcana maps to investigation, but if the story lacks investigation it
    // falls back to a defined skill (no perception here → first skill).
    expect(snapEncounterSkill('arcana', ['athletics', 'stealth'])).toBe('athletics');
    // empathy maps to persuasion which IS in this set.
    expect(snapEncounterSkill('empathy', ['persuasion', 'stealth'])).toBe('persuasion');
  });

  it('uses the canonical set when no story skills are provided', () => {
    expect(snapEncounterSkill('empathy', [])).toBe('persuasion');
    expect(CANON).toContain('persuasion');
  });
});
