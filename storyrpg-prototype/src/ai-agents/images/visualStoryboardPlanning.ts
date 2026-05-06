import type { VisualPlan } from '../agents/image-team/StoryboardAgent';
import type { EncounterImageSlot } from '../encounters/encounterSlotManifest';
import type { StoryletSlot } from '../encounters/storyletSlotManifest';

export type ImagePlanningMode = 'text' | 'visual-storyboard';

export type StoryboardSequenceRole =
  | 'establishing'
  | 'relationship'
  | 'insert'
  | 'reaction'
  | 'confrontation'
  | 'reversal'
  | 'outcome'
  | 'aftermath';

export interface SceneContinuityBible {
  locationLayout: string;
  lightingArc: string;
  characterBlocking: string;
  costumeState: string;
  importantProps: string[];
  branchStateRules?: string;
}

export interface SceneSequenceGrammar {
  sceneVisualArc: string;
  cameraProgression: string;
  shotRhythm: StoryboardSequenceRole[];
  motifProgression: string[];
  powerBlocking: string;
  silentReadabilityGoal: string;
  branchVisualLanguage?: Record<string, string>;
}

export interface StoryboardPanelMapping {
  slotId: string;
  beatId?: string;
  encounterPathId?: string;
  storyboardSheetId: string;
  panelIndex: number;
  cropBox: { x: number; y: number; width: number; height: number };
  sequenceRole: StoryboardSequenceRole;
  continuityFrom?: string;
  continuityTo?: string;
  contextOnly?: boolean;
}

export interface StoryboardSheetPlan {
  id: string;
  sceneId: string;
  branchPath?: string;
  shotIds: string[];
  contextPanelIds: string[];
  panelCount: number;
  canvas: { width: number; height: number; columns: number; rows: number };
}

export interface SceneVisualStoryboardPlan {
  sceneId: string;
  scopedSceneId: string;
  mode: 'visual-storyboard';
  continuityBible: SceneContinuityBible;
  sequenceGrammar: SceneSequenceGrammar;
  sheets: StoryboardSheetPlan[];
  panels: StoryboardPanelMapping[];
  coverage: {
    finalSlotCount: number;
    mappedFinalSlotCount: number;
    contextPanelCount: number;
    duplicateFinalSlotIds: string[];
    missingFinalSlotIds: string[];
  };
}

export interface StoryboardReferenceSummary {
  role: string;
  characterName?: string;
  viewType?: string;
  purpose: 'character' | 'style' | 'location' | 'continuity' | 'other';
  required?: boolean;
}

export interface StoryboardShotPacket {
  beatId: string;
  slotId: string;
  sequenceRole: StoryboardSequenceRole;
  shotSize: string;
  cameraAngle: string;
  cameraHeight: string;
  cameraSide: string;
  thirdPersonPov: 'observer' | 'over-shoulder' | 'environmental-insert';
  focalCharacterIds: string[];
  requiredVisibleCharacterIds: string[];
  optionalBackgroundCharacterIds: string[];
  offscreenCharacterIds: string[];
  continuityFrom?: string;
  dramaticReason: string;
  promptFields: {
    action: string;
    emotionalRead?: string;
    keyDetail?: string;
    composition?: string;
  };
  referencePack: {
    required: StoryboardReferenceSummary[];
    optional: StoryboardReferenceSummary[];
    missing: StoryboardReferenceSummary[];
  };
}

export interface VisualStoryboardPacket {
  version: 1;
  generatedAt: string;
  requestedMode: 'visual-storyboard';
  effectiveMode: ImagePlanningMode;
  sceneId: string;
  scopedSceneId: string;
  sceneName: string;
  chunkIndex: number;
  beatIds: string[];
  fallbackReason?: string;
  sceneMasterPrompt: {
    style: string;
    styleNegatives: string;
    location: string;
    lightingColor: string;
    castPolicy: string;
    thirdPersonCameraRule: string;
    referenceSummary: StoryboardReferenceSummary[];
  };
  continuityBible: SceneContinuityBible;
  sequenceGrammar: SceneSequenceGrammar;
  shots: StoryboardShotPacket[];
  validation: {
    passed: boolean;
    issues: string[];
  };
}

export interface StoryboardSlotInput {
  slotId: string;
  beatId?: string;
  encounterPathId?: string;
  branchPath?: string;
  description: string;
  tier?: 'success' | 'complicated' | 'failure';
  kind?: string;
}

const DEFAULT_PANEL_CAP = 6;
const PANEL_SIZE = 1024;

export function normalizeImagePlanningMode(raw: unknown): ImagePlanningMode {
  return raw === 'visual-storyboard' ? 'visual-storyboard' : 'text';
}

export function selectSequenceRole(index: number, total: number, slot?: StoryboardSlotInput): StoryboardSequenceRole {
  const kind = (slot?.kind || '').toLowerCase();
  if (kind.includes('storylet') || kind.includes('aftermath')) return 'aftermath';
  if (slot?.tier === 'success' || slot?.tier === 'complicated' || slot?.tier === 'failure') return 'outcome';
  if (index === 0) return 'establishing';
  if (index === total - 1) return 'aftermath';
  const rhythm: StoryboardSequenceRole[] = ['relationship', 'insert', 'reaction', 'confrontation', 'reversal', 'reaction'];
  return rhythm[(index - 1) % rhythm.length];
}

export function buildDefaultSequenceGrammar(
  sceneName: string,
  slots: StoryboardSlotInput[],
  branchAware = false,
): SceneSequenceGrammar {
  const roles = slots.map((slot, index) => selectSequenceRole(index, slots.length, slot));
  return {
    sceneVisualArc: `${sceneName}: readable geography gives way to staged dramatic escalation and visible consequence.`,
    cameraProgression: 'wide geography -> medium relationship staging -> close/detail pressure -> reaction/reversal -> aftermath reset',
    shotRhythm: roles,
    motifProgression: ['establish the scene motif', 'repeat it under pressure', 'pay it off in the outcome frame'],
    powerBlocking: 'Track who controls the frame: center/height/light imply power, edges/shadow/distance imply vulnerability.',
    silentReadabilityGoal: 'The ordered panels should communicate the scene turn and relationship shift without prose.',
    branchVisualLanguage: branchAware
      ? {
          success: 'clear forward motion, stronger posture, warmer or more resolved light',
          complicated: 'split blocking, crossed sightlines, mixed light, visible cost',
          failure: 'retreating posture, broken symmetry, colder or harsher light',
        }
      : undefined,
  };
}

export function buildDefaultContinuityBible(
  sceneName: string,
  sceneDescription?: string,
  branchAware = false,
): SceneContinuityBible {
  return {
    locationLayout: sceneDescription || `${sceneName}; preserve the established geography across all substoryboards.`,
    lightingArc: 'Preserve the scene color script while escalating contrast at reversals and softening only in aftermath panels.',
    characterBlocking: 'Carry character positions forward shot to shot; child branches inherit the parent setup before diverging.',
    costumeState: 'Do not redesign costumes, injuries, props, or character silhouettes between sheets unless the shot explicitly changes them.',
    importantProps: [],
    branchStateRules: branchAware
      ? 'Sibling branches start from the same parent state but must not inherit each other\'s injuries, props, or emotional aftermath.'
      : undefined,
  };
}

function chunkSlotsByPanelCap(slots: StoryboardSlotInput[], panelCap: number): StoryboardSlotInput[][] {
  const cap = Math.max(1, panelCap || DEFAULT_PANEL_CAP);
  const chunks: StoryboardSlotInput[][] = [];
  for (let index = 0; index < slots.length; index += cap) {
    chunks.push(slots.slice(index, index + cap));
  }
  return chunks;
}

function groupSlotsForSheets(slots: StoryboardSlotInput[], panelCap: number, branchAware: boolean): Array<{ branchPath?: string; slots: StoryboardSlotInput[] }> {
  if (!branchAware) {
    return chunkSlotsByPanelCap(slots, panelCap).map((chunk) => ({ slots: chunk }));
  }
  const groups = new Map<string, StoryboardSlotInput[]>();
  for (const slot of slots) {
    const key = slot.branchPath || 'root';
    const existing = groups.get(key) || [];
    existing.push(slot);
    groups.set(key, existing);
  }
  const split: Array<{ branchPath?: string; slots: StoryboardSlotInput[] }> = [];
  for (const [branchPath, group] of groups) {
    for (const chunk of chunkSlotsByPanelCap(group, panelCap)) {
      split.push({ branchPath: branchPath === 'root' ? undefined : branchPath, slots: chunk });
    }
  }
  return split;
}

function canvasForPanelCount(panelCount: number): StoryboardSheetPlan['canvas'] {
  const columns = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(panelCount))));
  const rows = Math.max(1, Math.ceil(panelCount / columns));
  return {
    width: columns * PANEL_SIZE,
    height: rows * PANEL_SIZE,
    columns,
    rows,
  };
}

export function buildSceneVisualStoryboardPlan(params: {
  sceneId: string;
  scopedSceneId: string;
  sceneName: string;
  sceneDescription?: string;
  slots: StoryboardSlotInput[];
  panelCap?: number;
  branchAware?: boolean;
  continuityBible?: Partial<SceneContinuityBible>;
  sequenceGrammar?: Partial<SceneSequenceGrammar>;
}): SceneVisualStoryboardPlan {
  const panelCap = params.panelCap || DEFAULT_PANEL_CAP;
  const branchAware = params.branchAware ?? params.slots.some((slot) => !!slot.branchPath);
  const continuityBible = {
    ...buildDefaultContinuityBible(params.sceneName, params.sceneDescription, branchAware),
    ...(params.continuityBible || {}),
  };
  const sequenceGrammar = {
    ...buildDefaultSequenceGrammar(params.sceneName, params.slots, branchAware),
    ...(params.sequenceGrammar || {}),
  };
  const sheets: StoryboardSheetPlan[] = [];
  const panels: StoryboardPanelMapping[] = [];
  const finalSlotIds = params.slots.map((slot) => slot.slotId);
  const seen = new Set<string>();
  const duplicateFinalSlotIds = new Set<string>();

  const groups = groupSlotsForSheets(params.slots, panelCap, branchAware);
  groups.forEach((group, sheetIndex) => {
    const sheetId = `${params.scopedSceneId}-storyboard-${sheetIndex + 1}`;
    const canvas = canvasForPanelCount(group.slots.length);
    sheets.push({
      id: sheetId,
      sceneId: params.sceneId,
      branchPath: group.branchPath,
      shotIds: group.slots.map((slot) => slot.slotId),
      contextPanelIds: [],
      panelCount: group.slots.length,
      canvas,
    });

    group.slots.forEach((slot, panelIndex) => {
      if (seen.has(slot.slotId)) duplicateFinalSlotIds.add(slot.slotId);
      seen.add(slot.slotId);
      const col = panelIndex % canvas.columns;
      const row = Math.floor(panelIndex / canvas.columns);
      const globalIndex = finalSlotIds.indexOf(slot.slotId);
      panels.push({
        slotId: slot.slotId,
        beatId: slot.beatId,
        encounterPathId: slot.encounterPathId,
        storyboardSheetId: sheetId,
        panelIndex,
        cropBox: { x: col * PANEL_SIZE, y: row * PANEL_SIZE, width: PANEL_SIZE, height: PANEL_SIZE },
        sequenceRole: selectSequenceRole(globalIndex >= 0 ? globalIndex : panelIndex, finalSlotIds.length, slot),
        continuityFrom: panelIndex > 0 ? group.slots[panelIndex - 1]?.slotId : undefined,
        continuityTo: panelIndex < group.slots.length - 1 ? group.slots[panelIndex + 1]?.slotId : undefined,
      });
    });
  });

  const mapped = new Set(panels.filter((panel) => !panel.contextOnly).map((panel) => panel.slotId));
  return {
    sceneId: params.sceneId,
    scopedSceneId: params.scopedSceneId,
    mode: 'visual-storyboard',
    continuityBible,
    sequenceGrammar,
    sheets,
    panels,
    coverage: {
      finalSlotCount: finalSlotIds.length,
      mappedFinalSlotCount: mapped.size,
      contextPanelCount: panels.filter((panel) => panel.contextOnly).length,
      duplicateFinalSlotIds: [...duplicateFinalSlotIds],
      missingFinalSlotIds: finalSlotIds.filter((slotId) => !mapped.has(slotId)),
    },
  };
}

export function chunkStoryboardBeats<T extends { id: string }>(beats: T[], chunkSize = DEFAULT_PANEL_CAP): T[][] {
  const size = Math.max(1, chunkSize || DEFAULT_PANEL_CAP);
  const chunks: T[][] = [];
  for (let index = 0; index < beats.length; index += size) {
    chunks.push(beats.slice(index, index + size));
  }
  return chunks;
}

export function validateVisualStoryboardPacket(packet: VisualStoryboardPacket): { passed: boolean; issues: string[] } {
  const issues: string[] = [];
  if (packet.requestedMode !== 'visual-storyboard') issues.push('requestedMode must be visual-storyboard');
  if (!packet.sceneMasterPrompt?.thirdPersonCameraRule) issues.push('missing third-person camera rule');
  if (!Array.isArray(packet.shots) || packet.shots.length === 0) issues.push('packet has no shots');
  const shotBeatIds = new Set<string>();
  let solitaryRun = 0;
  let lastAngle = '';
  for (const shot of packet.shots || []) {
    if (!shot.beatId) issues.push('shot missing beatId');
    if (shot.beatId) shotBeatIds.add(shot.beatId);
    if (!shot.thirdPersonPov || shot.thirdPersonPov === ('subjective' as never)) {
      issues.push(`${shot.beatId || 'unknown'} uses invalid POV`);
    }
    const visibleCount = (shot.requiredVisibleCharacterIds?.length || 0) + (shot.optionalBackgroundCharacterIds?.length || 0);
    const isSolitaryNeutral = visibleCount <= 1 && /^(ms|mcu|cu|medium|close)/i.test(shot.shotSize || '') && /eye/i.test(shot.cameraAngle || '');
    solitaryRun = isSolitaryNeutral ? solitaryRun + 1 : 0;
    if (solitaryRun > 2) issues.push(`${shot.beatId || 'unknown'} repeats solitary neutral composition more than twice`);
    const angleKey = `${shot.shotSize}|${shot.cameraAngle}|${shot.cameraHeight}|${shot.cameraSide}`;
    if (lastAngle && lastAngle === angleKey && !/locked micro/i.test(shot.dramaticReason || '')) {
      issues.push(`${shot.beatId || 'unknown'} repeats previous camera without locked micro-progression`);
    }
    lastAngle = angleKey;
  }
  for (const beatId of packet.beatIds || []) {
    if (!shotBeatIds.has(beatId)) issues.push(`missing shot for ${beatId}`);
  }
  return { passed: issues.length === 0, issues };
}

export function visualPlanSlotsFromBeats(scopedSceneId: string, beats: Array<{ id: string; text?: string }>): StoryboardSlotInput[] {
  return beats.map((beat) => ({
    slotId: `story-beat:${scopedSceneId}::${beat.id}`,
    beatId: beat.id,
    description: beat.text || beat.id,
    kind: 'story-beat',
  }));
}

export function visualPlanSlotsFromEncounterManifest(slots: EncounterImageSlot[]): StoryboardSlotInput[] {
  return slots.map((slot) => ({
    slotId: slot.kind === 'setup'
      ? `encounter-setup:${slot.scopedSceneId}::${slot.beatId}::root::setup`
      : slot.kind === 'situation'
        ? `encounter-situation:${slot.scopedSceneId}::${slot.beatId}::${slot.choiceMapKey}::${slot.tier}`
        : `encounter-outcome:${slot.scopedSceneId}::${slot.beatId}::${slot.choiceMapKey}::${slot.tier}`,
    beatId: slot.beatId,
    encounterPathId: slot.choiceMapKey || 'root',
    branchPath: slot.choiceMapKey || 'root',
    description: `${slot.kind}${slot.tier ? `:${slot.tier}` : ''}`,
    tier: slot.tier,
    kind: `encounter-${slot.kind}`,
  }));
}

export function visualPlanSlotsFromStoryletManifest(slots: StoryletSlot[]): StoryboardSlotInput[] {
  return slots.map((slot) => ({
    slotId: `storylet-aftermath:${slot.scopedSceneId}::${slot.outcomeName}::${slot.beatId}`,
    beatId: slot.beatId,
    encounterPathId: slot.outcomeName,
    branchPath: `storylet:${slot.outcomeName}`,
    description: slot.beat.text || `${slot.outcomeName}:${slot.beatId}`,
    kind: 'storylet-aftermath',
  }));
}

export function attachStoryboardPlanToVisualPlan<T extends VisualPlan>(
  visualPlan: T,
  storyboardPlan: SceneVisualStoryboardPlan,
): T {
  (visualPlan as any).imagePlanningMode = 'visual-storyboard';
  (visualPlan as any).continuityBible = storyboardPlan.continuityBible;
  (visualPlan as any).sequenceGrammar = storyboardPlan.sequenceGrammar;
  (visualPlan as any).storyboardSheets = storyboardPlan.sheets;
  (visualPlan as any).storyboardPanels = storyboardPlan.panels;
  (visualPlan as any).storyboardCoverage = storyboardPlan.coverage;
  return visualPlan;
}
