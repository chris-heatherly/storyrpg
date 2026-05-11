import { describe, expect, it } from 'vitest';
import type { StoryboardPanelSlot } from './storyboardCompiler';
import {
  buildVisualGrammarDirective,
  formatVisualGrammarDirective,
  sanitizeVisualGrammarDirectiveText,
} from './visualGrammar';

function panel(overrides: Partial<StoryboardPanelSlot>): StoryboardPanelSlot {
  return {
    id: 'panel-1',
    family: 'story-beat',
    sceneId: 'scene-1',
    scopedSceneId: 'scene-1',
    beatId: 'b1',
    label: 'Beat 1',
    narrativeText: '',
    visibleCharacterIds: [],
    ...overrides,
  };
}

function directive(overrides: Partial<StoryboardPanelSlot>, index = 0, previousDirective?: ReturnType<typeof buildVisualGrammarDirective>) {
  return buildVisualGrammarDirective({
    panel: panel(overrides),
    rawArtStyle: 'messy risograph pulp fantasy',
    sceneMood: 'tense',
    index,
    panelCount: 3,
    previousDirective,
  });
}

describe('visual grammar directives', () => {
  it('maps revelation and object-detail beats to close dominant focal grammar', () => {
    const revelation = directive({
      narrativeText: 'Mara realizes the impossible truth, eyes widening.',
      emotionalRead: 'stunned realization',
      visibleCharacterIds: ['hero'],
    });
    expect(['CU', 'ECU']).toContain(revelation.shotDistance);
    expect(revelation.staging).toBe('reaction');
    expect(revelation.importanceScale).toContain('face and body expression');

    const clue = directive({
      narrativeText: 'Mara finds the hidden key in her hand.',
      mustShowDetail: 'the key and her shaking fingers',
      visibleCharacterIds: ['hero'],
    });
    expect(['CU', 'ECU']).toContain(clue.shotDistance);
    expect(clue.staging).toBe('insert');
    expect(clue.importanceScale).toContain('object or gesture');
  });

  it('maps establishing, action, defeat, and triumph beats deterministically', () => {
    const establishing = directive({
      narrativeText: 'The empty city street stretches to the horizon, leaving Mara alone.',
      visibleCharacterIds: [],
    });
    expect(['LS', 'ELS']).toContain(establishing.shotDistance);
    expect(establishing.staging).toBe('environment');
    expect(establishing.importanceScale).toContain('environment dominates');

    const action = directive({
      narrativeText: 'Mara runs, leaps, and pushes through the breaking gate.',
      primaryAction: 'leaps through the gate',
      visibleCharacterIds: ['hero'],
    });
    expect(['MLS', 'MS']).toContain(action.shotDistance);

    const defeat = directive({
      narrativeText: 'Mara collapses defeated and overwhelmed.',
      emotionalRead: 'failure and shame',
      visibleCharacterIds: ['hero'],
    });
    expect(defeat.cameraAngle).toBe('high');

    const triumph = directive({
      narrativeText: 'The divine champion rises in triumph before the temple.',
      emotionalRead: 'awe',
      visibleCharacterIds: ['hero'],
    });
    expect(['low', 'worm-eye']).toContain(triumph.cameraAngle);
  });

  it('varies adjacent repeated shot angle staging combinations', () => {
    const first = directive({
      narrativeText: 'Mara speaks quietly in the room.',
      speaker: 'Mara',
      visibleCharacterIds: ['hero'],
    });
    const second = directive({
      narrativeText: 'Mara answers quietly in the room.',
      speaker: 'Mara',
      visibleCharacterIds: ['hero'],
    }, 1, first);

    expect(`${second.shotDistance}/${second.cameraAngle}/${second.staging}`).not.toBe(`${first.shotDistance}/${first.cameraAngle}/${first.staging}`);
  });

  it('keeps color and lighting constrained to the style lock and sanitizes style overrides', () => {
    const result = directive({
      narrativeText: 'Mara studies the glowing clue beside the window.',
      mustShowDetail: 'glowing clue',
      visibleCharacterIds: ['hero'],
    });
    expect(result.colorRole.rule).toBe('60:30:10');
    expect(result.colorRole.base).toContain('60% base');
    expect(result.colorRole.support).toContain('30% support');
    expect(result.colorRole.accent).toContain('10% accent');
    expect(result.colorRole.constraint).toContain('master art style and episode style-lock');
    expect(result.lighting).toContain('style');

    const line = formatVisualGrammarDirective(result);
    expect(line).toContain('Lighting and color are variations inside the master art style, not new style instructions.');
    expect(line).not.toMatch(/\b(?:photoreal|cinematic|DSLR|film still|orange and teal|Hitchcock|Kubrick)\b/i);

    const sanitized = sanitizeVisualGrammarDirectiveText('cinematic photoreal DSLR noir Kubrick Hitchcock orange and teal', 'messy risograph');
    expect(sanitized).not.toMatch(/\b(?:photoreal|cinematic|DSLR|noir|Kubrick|Hitchcock|orange and teal)\b/i);
  });
});
