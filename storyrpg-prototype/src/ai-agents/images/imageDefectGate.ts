import type { ImagePrompt } from '../images/imageTypes';

export type ImageDefectIssue =
  | 'visible_text'
  | 'extra_limbs'
  | 'duplicate_body'
  | 'floating_character'
  | 'panel_leakage'
  | 'reference_sheet_artifact'
  | 'photorealism'
  | 'environment_photorealism'
  | 'style_drift'
  | 'first_person_pov';

export interface ImageDefectReport {
  passed: boolean;
  issues: ImageDefectIssue[];
  reason?: string;
  rawResponse?: string;
  skipped?: boolean;
}

export interface ImageDefectRetryPatch {
  prompt: ImagePrompt;
  correctiveInstruction: string;
  negativeAdditions: string;
}

const FLOATING_ALLOWED_RE =
  /\b(levitat(?:e|es|ed|ing|ion)|floating|float(?:s|ed|ing)?|flying|flight|airborne|falling|jump(?:s|ed|ing)?|leap(?:s|ed|ing)?|suspended|weightless|zero gravity|dream|dreamlike|vision|magical suspension|supernatural suspension)\b/i;

const ISSUE_NEGATIVES: Record<ImageDefectIssue, string> = {
  visible_text: 'visible text, letters, words, numbers, captions, labels, annotations, watermarks, speech bubbles',
  extra_limbs: 'extra arms, extra hands, extra legs, duplicated limbs, malformed anatomy, too many fingers',
  duplicate_body: 'duplicate bodies, duplicate character, cloned person, repeated figure, second copy of same intended character, same character appears more than once',
  floating_character: 'floating, levitating, airborne, feet off ground, hovering, unsupported body',
  panel_leakage: 'panel borders, comic panels, collage, split screen, multi-panel layout, inset image, picture-in-picture',
  reference_sheet_artifact: 'turnaround sheet, model sheet, reference sheet layout, side-by-side views, annotations, labels',
  photorealism: 'photorealism, photorealistic, DSLR photo, live-action still, photographic lighting, lens blur, bokeh, depth of field, hyperreal skin',
  environment_photorealism: 'photorealistic architecture, real estate photo, architectural photography, HDR interior, documentary photo, live-action background, realistic building materials, camera bokeh',
  style_drift: 'generic cinematic concept art, realistic 3D render, architectural visualization, Unreal Engine, Octane render, Redshift render, gritty realism, oil painting texture, off-style rendering',
  first_person_pov: 'first-person POV, player-eye view, point-of-view shot, disembodied hands, your hand, your hands, you see',
};

const ISSUE_INSTRUCTIONS: Record<ImageDefectIssue, string> = {
  visible_text: 'Remove every visible letter, word, caption, label, watermark, speech bubble, and number. Replace readable screens, signs, labels, books, papers, badges, and device UI with blank, dark, reflective, glare-obscured, face-down, cropped, or too-small-to-read surfaces.',
  extra_limbs: 'Render normal human anatomy: exactly two arms, two hands, two legs, one head, natural fingers.',
  duplicate_body: 'Render each intended character exactly once; do not clone, repeat, mirror-copy, or duplicate any visible character.',
  floating_character: 'Keep standing characters grounded with feet visibly planted unless the story explicitly requests airborne motion.',
  panel_leakage: 'Return one continuous image only, with no panels, borders, inset frames, collage, or split-screen layout.',
  reference_sheet_artifact: 'Return one clean image only, not a model sheet, turnaround, labeled reference sheet, or multi-view layout.',
  photorealism: 'Remove renderer, lens, lighting, or material cues that contradict the active season style contract; the explicit style prompt remains authoritative.',
  environment_photorealism: 'Redraw the environment with the same renderer, material treatment, lighting language, and finish required by the active season style contract.',
  style_drift: 'Restore the exact season rendering style, linework, palette, lighting treatment, and finish required by the active style contract.',
  first_person_pov: 'Use a third-person observer camera outside the player character; do not use literal first-person POV, disembodied hands, or player-eye framing.',
};

export function promptAllowsFloating(prompt: ImagePrompt | string): boolean {
  const text = typeof prompt === 'string'
    ? prompt
    : [
        prompt.prompt,
        prompt.composition,
        prompt.visualNarrative,
        prompt.keyBodyLanguage,
        prompt.poseSpec,
      ].filter(Boolean).join('\n');
  return FLOATING_ALLOWED_RE.test(text);
}

export function normalizeImageDefectReport(raw: unknown, prompt?: ImagePrompt | string): ImageDefectReport {
  const parsed = typeof raw === 'string' ? parseJsonish(raw) : raw;
  const obj = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  const rawIssues = Array.isArray(obj.issues) ? obj.issues.map(String) : [];
  const issues = new Set<ImageDefectIssue>();
  const flags = [
    ...rawIssues,
    obj.reason,
    obj.summary,
    obj.description,
  ].filter(Boolean).join(' ').toLowerCase();

  const addIf = (issue: ImageDefectIssue, value: unknown, re: RegExp) => {
    if (value === true || re.test(flags)) issues.add(issue);
  };

  addIf('visible_text', obj.visible_text ?? obj.hasText ?? obj.text, /\b(text|letters?|words?|captions?|labels?|watermark|speech bubble|numbers?)\b/);
  addIf('extra_limbs', obj.extra_limbs ?? obj.extraLimbs, /\b(extra|duplicated|too many|malformed)\s+(arms?|hands?|legs?|limbs?|fingers?)\b/);
  addIf(
    'duplicate_body',
    obj.duplicate_body ?? obj.duplicateBodies ?? obj.duplicate_character ?? obj.duplicateCharacter,
    /\b(?:(duplicate|duplicated|clone|cloned|repeated)\s+(body|bodies|character|figure|person)|same\s+(?:intended\s+)?character\s+(?:appears|shown|is visible|rendered)\s+(?:more than once|twice|multiple times)|second copy of (?:the )?same (?:character|person)|mirror[- ]copy)\b/,
  );
  addIf('floating_character', obj.floating_character ?? obj.floating, /\b(floating|levitating|hovering|airborne|feet off ground|unsupported)\b/);
  addIf('panel_leakage', obj.panel_leakage ?? obj.panelLeakage, /\b(panel|comic panel|split[- ]screen|collage|inset|picture-in-picture|multi[- ]panel)\b/);
  addIf('reference_sheet_artifact', obj.reference_sheet_artifact ?? obj.referenceSheetArtifact, /\b(reference sheet|model sheet|turnaround|multi[- ]view|side-by-side|annotations?)\b/);
  addIf('photorealism', obj.photorealism ?? obj.photorealistic ?? obj.photoRealism, /\b(photoreal(?:istic|ism)?|photographic|photo|dslr|live[- ]action|lens blur|bokeh|depth of field|hyperreal)\b/);
  addIf('environment_photorealism', obj.environment_photorealism ?? obj.environmentPhotorealism ?? obj.photorealEnvironment, /\b(photoreal(?:istic)? (?:architecture|environment|background)|real estate photo|architectural photography|hdr interior|documentary photo|live[- ]action background|realistic building materials|camera bokeh)\b/);
  addIf('style_drift', obj.style_drift ?? obj.styleDrift ?? obj.offStyle, /\b(style drift|off[- ]style|generic cinematic|concept art|3d render|architectural visualization|unreal|octane|redshift|gritty realism|oil painting)\b/);
  addIf('first_person_pov', obj.first_person_pov ?? obj.firstPersonPov ?? obj.pov, /\b(first[- ]person|player[- ]eye|point[- ]of[- ]view|pov shot|disembodied hands?|your hands?|you see|from your view)\b/);

  if (issues.has('floating_character') && prompt && promptAllowsFloating(prompt)) {
    issues.delete('floating_character');
  }

  const finalIssues = Array.from(issues);
  const explicitPassed = obj.passed === true || obj.pass === true;
  const passed = explicitPassed && finalIssues.length === 0;
  const rawReason = typeof obj.reason === 'string' ? obj.reason : undefined;
  return {
    passed,
    issues: finalIssues,
    reason: finalIssues.length > 0
      ? [
          `Detected issue(s): ${finalIssues.join(', ')}.`,
          finalIssues.map(issue => ISSUE_INSTRUCTIONS[issue]).join(' '),
          rawReason ? `Raw assessment: ${rawReason}` : '',
        ].filter(Boolean).join(' ')
      : rawReason || (explicitPassed ? 'defect gate passed' : 'defect gate returned no pass signal'),
    rawResponse: typeof raw === 'string' ? raw : undefined,
  };
}

export function buildDefectRetryPrompt(prompt: ImagePrompt, issues: ImageDefectIssue[]): ImageDefectRetryPatch {
  const uniqueIssues = Array.from(new Set(issues));
  const correctiveInstruction = [
    'IMAGE QA CORRECTION:',
    ...uniqueIssues.map(issue => ISSUE_INSTRUCTIONS[issue]),
    'Regenerate the image from scratch while preserving the requested style, subject, identity, and story moment.',
  ].join(' ');
  const negativeAdditions = uniqueIssues.map(issue => ISSUE_NEGATIVES[issue]).join(', ');
  return {
    prompt: {
      ...prompt,
      prompt: [prompt.prompt, correctiveInstruction].filter(Boolean).join('\n\n'),
      negativePrompt: [prompt.negativePrompt, negativeAdditions].filter(Boolean).join(', '),
    },
    correctiveInstruction,
    negativeAdditions,
  };
}

function parseJsonish(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}
