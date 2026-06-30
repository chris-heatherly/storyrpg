import type {
  ArcPressureTreatmentContract,
  AuthoredTreatmentFieldContract,
  BranchConsequenceRealizationContract,
  CharacterTreatmentRealizationContract,
  ColdOpenProfile,
  EndingRealizationContract,
  FailureModeAuditContract,
  MechanicPressureContract,
  RelationshipPacingContract,
  RequiredBeat,
  SceneConstructionBeatBudget,
  SceneConstructionObligation,
  SceneConstructionPrimaryTurn,
  SceneConstructionProfile,
  SceneConstructionSlot,
  SceneConstructionSource,
  SceneTurnContract,
  SeasonPromiseRealizationContract,
  StakesArchitectureContract,
  StoryCircleBeatRealizationContract,
  WorldTreatmentRealizationContract,
} from '../../types/scenePlan';

export interface SceneConstructionChoicePoint {
  description?: string;
  stakes?: {
    want?: string;
    cost?: string;
    identity?: string;
  };
}

export interface SceneConstructionSceneLike {
  id?: string;
  episodeNumber?: number;
  order?: number;
  kind?: string;
  isEncounter?: boolean;
  name?: string;
  title?: string;
  description?: string;
  location?: string;
  locations?: string[];
  narrativeRole?: string;
  dramaticPurpose?: string;
  narrativeFunction?: string;
  dramaticQuestion?: string;
  wantVsNeed?: string;
  conflictEngine?: string;
  personalStake?: string;
  themePressure?: string;
  stakes?: string;
  npcsPresent?: string[];
  npcsInvolved?: string[];
  keyBeats?: string[];
  requiredBeats?: RequiredBeat[];
  signatureMoment?: string;
  turnContract?: SceneTurnContract;
  coldOpenProfile?: ColdOpenProfile;
  sceneConstructionProfile?: SceneConstructionProfile;
  relationshipPacing?: RelationshipPacingContract[];
  mechanicPressure?: MechanicPressureContract[];
  authoredTreatmentFields?: AuthoredTreatmentFieldContract[];
  seasonPromiseContracts?: SeasonPromiseRealizationContract[];
  stakesArchitectureContracts?: StakesArchitectureContract[];
  storyCircleBeatContracts?: StoryCircleBeatRealizationContract[];
  arcPressureContracts?: ArcPressureTreatmentContract[];
  branchConsequenceContracts?: BranchConsequenceRealizationContract[];
  endingRealizationContracts?: EndingRealizationContract[];
  failureModeAuditContracts?: FailureModeAuditContract[];
  characterTreatmentContracts?: CharacterTreatmentRealizationContract[];
  worldTreatmentContracts?: WorldTreatmentRealizationContract[];
  setsUp?: string[];
  paysOff?: string[];
  choicePoint?: SceneConstructionChoicePoint;
  hasChoice?: boolean;
  recommendedBeatCount?: number;
}

export interface SceneConstructionProfileOptions {
  episodeNumber?: number;
  sceneIndex?: number;
}

export interface SceneConstructionProfileDiagnostic {
  sceneId?: string;
  episodeNumber?: number;
  severity: 'error' | 'warning';
  message: string;
}

const ACTION_RE = /\b(?:accepts?|accuses?|arrives?|asks?|attacks?|breaks?|burns?|calls?|chooses?|claims?|closes?|confesses?|confronts?|cuts?|discovers?|enters?|escapes?|exposes?|finds?|follows?|forces?|forms?|gathers?|gives?|hands?|hides?|intervenes?|invites?|kills?|leaves?|learns?|loses?|moves?|names?|opens?|publishes?|reacts?|refuses?|reveals?|runs?|saves?|sees?|starts?|steals?|takes?|threatens?|turns?|walks?|warns?|writes?)\b/i;
const TIME_CUE_RE = /\b(?:night (?:one|two|three|four|\d+)|\d+\s*(?:am|pm)|morning|dawn|dusk|sunset|midnight|noon|afternoon|evening|later|earlier|next (?:day|morning|night)|previous (?:day|night))\b/gi;
const INTRO_RE = /\bintroduc(?:e|es|ed|ing)\b/i;
const PLAN_LEVEL_RE = /\b(?:season|series|arc|future|downstream|later episode|pay\s*off|payoff|ledger|metadata|possible ending|route math|ending state)\b/i;
const CONTRAST_RE = /\b(?:but|however|instead|until|unless|despite|while|against|opposes?|blocks?|prevents?|threatens?|costs?|forces?)\b/i;
const TEXTURE_PROMPT_LIMIT = 6;

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function clip(value: unknown, max = 260): string {
  const text = cleanText(value);
  if (text.length <= max) return text;
  const soft = text.slice(0, max).replace(/\s+\S*$/, '');
  return `${soft || text.slice(0, max)}...`;
}

function normalize(value: unknown): string {
  return cleanText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(?:char|character|npc|id)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value: unknown): string[] {
  return normalize(value).split(' ').filter((token) => token.length >= 4);
}

function tokenOverlap(left: unknown, right: unknown): number {
  const leftTokens = Array.from(new Set(tokens(left)));
  const rightTokens = Array.from(new Set(tokens(right)));
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;
  const rightSet = new Set(rightTokens);
  const hits = leftTokens.filter((token) =>
    rightSet.has(token) || rightTokens.some((candidate) => candidate.startsWith(token) || token.startsWith(candidate)),
  );
  return hits.length / leftTokens.length;
}

function substantiallyDuplicates(left: unknown, right: unknown): boolean {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  return tokenOverlap(a, b) >= 0.58 || tokenOverlap(b, a) >= 0.58;
}

function isConcreteEvent(text: unknown): boolean {
  const value = cleanText(text);
  if (!value) return false;
  if (PLAN_LEVEL_RE.test(value) && !ACTION_RE.test(value)) return false;
  return ACTION_RE.test(value) || CONTRAST_RE.test(value) || timeCues(value).length > 0;
}

function timeCues(value: unknown): string[] {
  return Array.from(new Set(cleanText(value).match(TIME_CUE_RE)?.map((cue) => cue.toLowerCase()) ?? []));
}

function locationCueCount(scene: SceneConstructionSceneLike, activeTexts: string[]): number {
  const declared = new Set([scene.location, ...(scene.locations ?? [])].map(normalize).filter(Boolean));
  const text = normalize(activeTexts.join(' '));
  let count = declared.size;
  const namedPlaceMatches = text.match(/\b(?:at|in|inside|outside|to|from)\s+[a-z0-9]+(?:\s+[a-z0-9]+){0,2}\b/g) ?? [];
  count += namedPlaceMatches.filter((match) => !declared.has(normalize(match))).length;
  return count;
}

function beatText(beat: RequiredBeat | undefined): string {
  return cleanText(beat?.mustDepict || beat?.sourceTurn);
}

function isHardRequiredBeat(beat: RequiredBeat | undefined): boolean {
  return Boolean(beat && (beat.tier === 'authored' || beat.tier === 'signature' || beat.tier === 'coldopen'));
}

function isStoryCircleDerivedId(id: string | undefined): boolean {
  return /\b(?:story-circle|episode-circle)\b/i.test(id ?? '');
}

function firstHardRequiredBeat(scene: SceneConstructionSceneLike): RequiredBeat | undefined {
  return (scene.requiredBeats ?? []).find(isHardRequiredBeat);
}

function firstText(values: unknown[]): string {
  return values.map(cleanText).find(Boolean) ?? '';
}

function primaryTurnFor(scene: SceneConstructionSceneLike): SceneConstructionPrimaryTurn {
  if (scene.turnContract && cleanText(scene.turnContract.centralTurn || scene.turnContract.turnEvent)) {
    const text = cleanText(scene.turnContract.centralTurn || scene.turnContract.turnEvent);
    return {
      id: scene.turnContract.turnId || `${scene.id ?? 'scene'}-turn`,
      source: 'sceneTurn',
      text,
      beforeState: cleanText(scene.turnContract.beforeState) || undefined,
      turnEvent: cleanText(scene.turnContract.turnEvent) || text,
      afterState: cleanText(scene.turnContract.afterState) || undefined,
      handoff: cleanText(scene.turnContract.handoff) || undefined,
      sourceContractIds: [scene.turnContract.turnId || `${scene.id ?? 'scene'}-turn`],
    };
  }

  if (scene.coldOpenProfile?.centralTurn) {
    return {
      id: scene.coldOpenProfile.id,
      source: 'coldOpenProfile',
      text: cleanText(scene.coldOpenProfile.centralTurn),
      turnEvent: cleanText(scene.coldOpenProfile.centralTurn),
      handoff: cleanText(scene.coldOpenProfile.exitHook) || undefined,
      sourceContractIds: scene.coldOpenProfile.sourceContractIds ?? [scene.coldOpenProfile.id],
    };
  }

  const hardBeat = firstHardRequiredBeat(scene);
  if (hardBeat) {
    return {
      id: hardBeat.id,
      source: 'requiredBeat',
      text: beatText(hardBeat),
      turnEvent: beatText(hardBeat),
      sourceContractIds: [hardBeat.id],
    };
  }

  const choiceText = firstText([
    scene.choicePoint?.description,
    scene.choicePoint?.stakes?.identity,
    scene.choicePoint?.stakes?.cost,
    scene.choicePoint?.stakes?.want,
  ]);
  if (choiceText) {
    return {
      id: `${scene.id ?? 'scene'}-choice-pressure`,
      source: 'choicePressure',
      text: choiceText,
      turnEvent: choiceText,
      sourceContractIds: [`${scene.id ?? 'scene'}-choice-pressure`],
    };
  }

  const fallback = firstText([
    scene.dramaticPurpose,
    scene.dramaticQuestion,
    scene.narrativeFunction,
    scene.description,
    scene.name,
    scene.title,
  ]) || 'The scene changes visible leverage, relationship, information, danger, or identity pressure.';

  return {
    id: `${scene.id ?? 'scene'}-construction-turn`,
    source: 'sceneTurn',
    text: clip(fallback),
    turnEvent: clip(fallback),
    sourceContractIds: [`${scene.id ?? 'scene'}-construction-turn`],
  };
}

function coldOpenFocusText(scene: SceneConstructionSceneLike): string {
  const profile = scene.coldOpenProfile;
  if (!profile) return '';
  return [
    profile.centralTurn,
    profile.microConflict,
    profile.openQuestion,
    profile.storyCircleFulfillment.baseline,
    profile.storyCircleFulfillment.need,
    profile.storyCircleFulfillment.collision,
    profile.exitHook,
  ].filter(Boolean).join(' ');
}

function supportsPrimaryOrColdOpen(text: unknown, primaryText: string, scene: SceneConstructionSceneLike): boolean {
  if (substantiallyDuplicates(text, primaryText)) return true;
  if (tokenOverlap(text, primaryText) >= 0.28 || tokenOverlap(primaryText, text) >= 0.28) return true;
  const coldOpenText = coldOpenFocusText(scene);
  return Boolean(coldOpenText)
    && (tokenOverlap(text, coldOpenText) >= 0.28 || tokenOverlap(coldOpenText, text) >= 0.28);
}

function makeObligation(
  source: SceneConstructionSource,
  id: string | undefined,
  text: unknown,
  slot: SceneConstructionSlot,
  reason: string,
  hardUnits = 0,
  softUnits = 0.5,
): SceneConstructionObligation | undefined {
  const clean = cleanText(text);
  if (!clean) return undefined;
  return {
    source,
    id: id || `${source}:${normalize(clean).slice(0, 48) || 'obligation'}`,
    slot,
    text: clean,
    reason,
    hardUnits,
    softUnits,
  };
}

function pushObligation(
  obligations: SceneConstructionObligation[],
  source: SceneConstructionSource,
  id: string | undefined,
  text: unknown,
  slot: SceneConstructionSlot,
  reason: string,
  hardUnits = 0,
  softUnits = 0.5,
): void {
  const obligation = makeObligation(source, id, text, slot, reason, hardUnits, softUnits);
  if (obligation) obligations.push(obligation);
}

function initialObligations(scene: SceneConstructionSceneLike, primary: SceneConstructionPrimaryTurn): SceneConstructionObligation[] {
  const obligations: SceneConstructionObligation[] = [];

  pushObligation(obligations, primary.source, primary.id, primary.text, 'primary_turn', 'One scene, one dramatic turn.', 1, 0);

  for (const beat of scene.requiredBeats ?? []) {
    const hard = isHardRequiredBeat(beat);
    pushObligation(
      obligations,
      'requiredBeat',
      beat.id,
      beatText(beat),
      hard ? 'must_stage' : 'texture',
      hard ? 'Hard required beat must be dramatized if it belongs to this turn.' : 'Soft seed/connective beat may texture the turn.',
      hard ? 1 : 0,
      hard ? 0 : 0.5,
    );
  }
  if (scene.signatureMoment) {
    pushObligation(obligations, 'signatureMoment', 'signatureMoment', scene.signatureMoment, 'must_stage', 'Signature moment is binding when assigned to this scene.', 1, 0);
  }
  for (const contract of scene.storyCircleBeatContracts ?? []) {
    pushObligation(obligations, 'storyCircle', contract.id, contract.eventAtoms?.join(' | ') || contract.sourceText, 'must_support', 'Story Circle contract must be fulfilled through the scene turn.', 0.75, 0);
  }
  for (const contract of scene.authoredTreatmentFields ?? []) {
    const hard = contract.requiredRealization?.includes('final_prose') || contract.requiredRealization?.includes('scene_turn');
    pushObligation(obligations, 'treatmentField', contract.id, contract.sourceText, hard ? 'must_support' : 'metadata_only', hard ? 'Treatment field requires visible scene realization.' : 'Treatment field is planning metadata unless it sharpens this turn.', hard ? 0.5 : 0, hard ? 0 : 0.25);
  }
  for (const contract of scene.arcPressureContracts ?? []) {
    pushObligation(obligations, 'arcPressure', contract.id, contract.eventAtoms?.join(' | ') || contract.sourceText, 'texture', 'Arc pressure sharpens the turn when compatible.', 0, 0.5);
  }
  for (const contract of scene.seasonPromiseContracts ?? []) {
    pushObligation(obligations, 'seasonPromise', contract.id, contract.sourceText, 'metadata_only', 'Season promise guides the episode unless it serves this turn.', 0, 0.25);
  }
  for (const contract of scene.stakesArchitectureContracts ?? []) {
    pushObligation(obligations, 'stakesArchitecture', contract.id, contract.sourceText, 'texture', 'Stakes architecture should color this scene without becoming another turn.', 0, 0.25);
  }
  for (const pressure of scene.mechanicPressure ?? []) {
    pushObligation(obligations, 'mechanicPressure', pressure.id, [pressure.storyPressure, ...(pressure.evidenceRequired ?? [])].join(' | '), 'texture', 'Mechanic pressure is hidden story accounting unless it directly evidences the turn.', 0, 0.25);
  }
  for (const pacing of scene.relationshipPacing ?? []) {
    pushObligation(obligations, 'relationshipPacing', pacing.id, pacing.requiredEvidence?.join(' | ') || pacing.npcId || pacing.groupId, 'texture', 'Relationship pacing is behavioral evidence, not a separate scene turn.', 0, 0.25);
  }
  for (const contract of scene.branchConsequenceContracts ?? []) {
    pushObligation(obligations, 'branchConsequence', contract.id, contract.sourceText, 'metadata_only', 'Branch consequence remains metadata unless this scene stages the branch origin or residue.', 0, 0.25);
  }
  for (const contract of scene.endingRealizationContracts ?? []) {
    pushObligation(obligations, 'endingRealization', contract.id, contract.sourceText, 'metadata_only', 'Ending realization is route metadata until a finale/ending scene owns it.', 0, 0.25);
  }
  for (const contract of scene.failureModeAuditContracts ?? []) {
    pushObligation(obligations, 'failureModeAudit', contract.id, contract.sourceText, 'texture', 'Failure-mode mitigation should protect the turn without becoming a second event.', 0, 0.25);
  }
  for (const contract of scene.characterTreatmentContracts ?? []) {
    pushObligation(obligations, 'characterTreatment', contract.id, contract.sourceText, 'texture', 'Character treatment should appear as behavior inside the turn.', 0, 0.25);
  }
  for (const contract of scene.worldTreatmentContracts ?? []) {
    pushObligation(obligations, 'worldTreatment', contract.id, contract.sourceText, 'texture', 'World/location treatment should shape what the turn permits or costs.', 0, 0.25);
  }
  for (const setup of scene.setsUp ?? []) {
    pushObligation(obligations, 'setupPayoff', `setsUp:${setup}`, setup, 'metadata_only', 'Setup edge is ledger routing unless it is visible in this turn.', 0, 0.25);
  }
  for (const payoff of scene.paysOff ?? []) {
    pushObligation(obligations, 'setupPayoff', `paysOff:${payoff}`, payoff, 'metadata_only', 'Payoff edge is ledger routing unless it is visible in this turn.', 0, 0.25);
  }
  if (scene.choicePoint?.description || scene.hasChoice) {
    pushObligation(obligations, 'choicePressure', `${scene.id ?? 'scene'}-choice-pressure`, scene.choicePoint?.description || primary.text, 'must_support', 'Choice pressure should express or exit the same scene turn, not create another one.', 0.75, 0);
  }
  (scene.keyBeats ?? []).forEach((beat, index) => {
    pushObligation(obligations, 'keyBeat', `keyBeat:${index}`, beat, INTRO_RE.test(beat) ? 'must_support' : 'texture', INTRO_RE.test(beat) ? 'Introduction key beat is active only for active cast.' : 'Key beat should support the turn.', 0, INTRO_RE.test(beat) ? 0.5 : 0.25);
  });
  if (scene.coldOpenProfile) {
    pushObligation(obligations, 'coldOpenProfile', scene.coldOpenProfile.id, scene.coldOpenProfile.storyCircleFulfillment.collision || scene.coldOpenProfile.centralTurn, 'must_support', 'Cold-open profile focuses opening obligations into one collision.', 0.75, 0);
  }

  return obligations;
}

function mergeAndRouteObligations(scene: SceneConstructionSceneLike, primary: SceneConstructionPrimaryTurn, obligations: SceneConstructionObligation[]): SceneConstructionObligation[] {
  const primaryText = primary.text;
  const deduped: SceneConstructionObligation[] = [];
  const seen = new Map<string, SceneConstructionObligation>();

  for (const obligation of obligations) {
    const duplicateOfPrimary = obligation.id !== primary.id && substantiallyDuplicates(obligation.text, primaryText);
    const broad = !isConcreteEvent(obligation.text);
    const coldOpenProfile = scene.coldOpenProfile;
    const coldOpenKeepsStoryCircle = obligation.source === 'storyCircle'
      && Boolean(coldOpenProfile)
      && (
        Boolean(coldOpenProfile?.sourceContractIds?.includes(obligation.id))
        || Boolean(coldOpenProfile?.storyCircleFulfillment.sourceContractIds?.includes(obligation.id))
      )
      && supportsPrimaryOrColdOpen(obligation.text, primaryText, scene);
    const storyCircleRequiredBeat = obligation.source === 'requiredBeat' && isStoryCircleDerivedId(obligation.id);
    const storyCircleSupport = obligation.source === 'storyCircle' || storyCircleRequiredBeat;
    let next = { ...obligation };

    if (duplicateOfPrimary) {
      next = {
        ...next,
        slot: storyCircleSupport ? 'must_support' : obligation.source === 'requiredBeat' && obligation.hardUnits >= 1 ? 'must_stage' : 'must_support',
        reason: `${obligation.reason} Merged into the primary turn instead of becoming a second center.`,
        mergedInto: primary.id,
        hardUnits: 0,
        softUnits: 0,
      };
    } else if (scene.coldOpenProfile && storyCircleRequiredBeat) {
      if (supportsPrimaryOrColdOpen(obligation.text, primaryText, scene)) {
        next = {
          ...next,
          slot: 'must_support',
          reason: `${obligation.reason} Folded into the cold-open Story Circle collision instead of counted as a separate staged event.`,
          hardUnits: 0,
          softUnits: 0,
        };
      } else {
        next = {
          ...next,
          slot: 'route_later',
          reason: `${obligation.reason} Routed away because this Story Circle atom does not serve the cold-open collision's single dramatic turn.`,
          hardUnits: 0,
          softUnits: Math.min(obligation.softUnits || 0.25, 0.25),
        };
      }
    } else if (coldOpenKeepsStoryCircle) {
      next = {
        ...next,
        slot: 'must_support',
        reason: `${obligation.reason} Kept active because the cold-open profile combines this Story Circle role into the opening collision.`,
        hardUnits: 0,
        softUnits: 0,
      };
    } else if (storyCircleSupport && !supportsPrimaryOrColdOpen(obligation.text, primaryText, scene)) {
      next = {
        ...next,
        slot: obligation.source === 'requiredBeat' && obligation.hardUnits >= 1 ? 'route_later' : 'metadata_only',
        reason: `${obligation.reason} Routed away because this Story Circle obligation does not support the scene's primary turn.`,
        hardUnits: 0,
        softUnits: Math.min(obligation.softUnits || 0.25, 0.25),
      };
    } else if (storyCircleSupport) {
      next = {
        ...next,
        slot: 'must_support',
        reason: `${obligation.reason} Kept as support for the same scene turn, not as an independent staged event.`,
        hardUnits: 0,
        softUnits: 0,
      };
    } else if (broad && obligation.slot !== 'primary_turn' && obligation.source !== 'choicePressure') {
      if (obligation.source === 'requiredBeat' && obligation.hardUnits >= 1 && !PLAN_LEVEL_RE.test(obligation.text)) {
        next = {
          ...next,
          slot: 'must_stage',
          reason: `${obligation.reason} Kept active because hard required beats remain binding unless they are explicit plan-level metadata.`,
        };
      } else {
        next = {
          ...next,
          slot: obligation.hardUnits >= 1 && obligation.source === 'requiredBeat' ? 'route_later' : 'metadata_only',
          reason: `${obligation.reason} Routed away from prose because it is broad planning pressure, not a concrete scene event.`,
          hardUnits: 0,
          softUnits: Math.min(obligation.softUnits, 0.25),
        };
      }
    } else if ((obligation.slot === 'texture' || obligation.slot === 'metadata_only') && tokenOverlap(obligation.text, primaryText) >= 0.35) {
      next = {
        ...next,
        slot: 'must_support',
        reason: `${obligation.reason} It overlaps the primary turn and can sharpen the same collision.`,
        hardUnits: Math.max(obligation.hardUnits, 0.25),
        softUnits: 0,
      };
    }

    const key = normalize(next.text);
    const existing = seen.get(key);
    if (existing) {
      next = {
        ...next,
        mergedInto: existing.id,
        hardUnits: 0,
        softUnits: 0,
        reason: `${next.reason} Merged with ${existing.source}:${existing.id} so provenance is preserved without extra load.`,
      };
    } else {
      seen.set(key, next);
    }
    deduped.push(next);
  }

  const maxSupport = scene.coldOpenProfile ? 5 : 6;
  let supportCount = 0;
  return deduped.map((obligation) => {
    if (obligation.slot !== 'must_support') return obligation;
    supportCount += 1;
    if (supportCount <= maxSupport) return obligation;
    return {
      ...obligation,
      slot: 'texture',
      reason: `${obligation.reason} Demoted to texture because this scene already has enough active support obligations.`,
      hardUnits: 0,
      softUnits: Math.min(obligation.softUnits || 0.25, 0.25),
    };
  });
}

function isActiveSlot(slot: SceneConstructionSlot): boolean {
  return slot === 'primary_turn' || slot === 'must_stage' || slot === 'must_support';
}

function sourceIds(obligations: SceneConstructionObligation[]): string[] {
  return Array.from(new Set(obligations.map((item) => item.id).filter(Boolean)));
}

function maxHardUnits(scene: SceneConstructionSceneLike): number {
  if (scene.kind === 'encounter' || scene.isEncounter) return 5;
  if (scene.order === 0 || scene.coldOpenProfile || /s\d+-1$/i.test(scene.id ?? '')) return 5;
  return 4;
}

function maxTotalUnits(scene: SceneConstructionSceneLike): number {
  if (scene.kind === 'encounter' || scene.isEncounter) return 7;
  if (scene.order === 0 || scene.coldOpenProfile || /s\d+-1$/i.test(scene.id ?? '')) return 7.5;
  return 6;
}

function beatBudgetFor(scene: SceneConstructionSceneLike, totalUnits: number): SceneConstructionBeatBudget {
  const recommended = Math.max(scene.coldOpenProfile ? 6 : 4, Math.min(12, scene.recommendedBeatCount ?? Math.ceil(totalUnits) + 1));
  return {
    min: scene.coldOpenProfile ? 6 : 4,
    recommended,
    max: Math.max(recommended, scene.coldOpenProfile ? 12 : 10),
  };
}

function castKey(value: string): string {
  const parts = normalize(value).split(' ').filter((part) => part && part !== 'char' && part !== 'character' && part !== 'npc');
  return parts.join(' ');
}

function activeCastFor(scene: SceneConstructionSceneLike, activeTexts: string[]): { activeCast: string[]; passiveCast: string[]; activeCastCount: number; maxActiveCast: number } {
  const cast = [...(scene.npcsPresent ?? []), ...(scene.npcsInvolved ?? [])].map(cleanText).filter(Boolean);
  const groups = new Map<string, string[]>();
  for (const item of cast) {
    const key = castKey(item);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  const activeText = normalize(activeTexts.join(' '));
  const scored = Array.from(groups.entries()).map(([key, aliases], index) => {
    const mentioned = aliases.some((alias) => {
      const aliasText = normalize(alias);
      return aliasText && (activeText.includes(aliasText) || tokenOverlap(aliasText, activeText) >= 0.6);
    });
    return { key, aliases, index, score: mentioned ? 2 : 0 };
  });

  const maxActiveCast = scene.coldOpenProfile ? scene.coldOpenProfile.activeCastLimit : (scene.kind === 'encounter' || scene.isEncounter ? 4 : 3);
  const ordered = scored.sort((a, b) => b.score - a.score || a.index - b.index);
  const activeKeys = new Set(ordered.slice(0, maxActiveCast).map((item) => item.key));
  const activeCast = ordered.filter((item) => activeKeys.has(item.key)).flatMap((item) => item.aliases);
  const passiveCast = ordered.filter((item) => !activeKeys.has(item.key)).flatMap((item) => item.aliases);
  return { activeCast, passiveCast, activeCastCount: activeKeys.size, maxActiveCast };
}

function conflictDiagnostics(
  scene: SceneConstructionSceneLike,
  obligations: SceneConstructionObligation[],
  hardUnits: number,
  totalUnits: number,
  maxHard: number,
  maxTotal: number,
): string[] {
  const diagnostics: string[] = [];
  const activeHardWithCues = obligations
    .filter((item) => isActiveSlot(item.slot) && item.hardUnits > 0)
    .map((item) => ({ text: item.text, cues: timeCues(item.text) }))
    .filter((item) => item.cues.length > 0);
  const uniqueTimeCues = Array.from(new Set(activeHardWithCues.flatMap((item) => item.cues)));
  if (activeHardWithCues.length >= 2 && uniqueTimeCues.length >= 2 && !(scene.kind === 'encounter' || scene.isEncounter)) {
    diagnostics.push(`Scene "${scene.id ?? 'unknown'}" has hard active obligations with multiple time cues (${uniqueTimeCues.join(', ')}); split or route them before prose.`);
  }
  if (hardUnits > maxHard && !(scene.kind === 'encounter' || scene.isEncounter)) {
    diagnostics.push(`Scene "${scene.id ?? 'unknown'}" has ${hardUnits} active hard construction units, above ${maxHard}.`);
  }
  if (totalUnits > maxTotal && !(scene.kind === 'encounter' || scene.isEncounter) && (scene.recommendedBeatCount ?? 0) < Math.ceil(totalUnits) + 1) {
    diagnostics.push(`Scene "${scene.id ?? 'unknown'}" has ${totalUnits} active construction units, above ${maxTotal}, without enough beat budget.`);
  }
  const activePrimaryLike = obligations.filter((item) => item.slot === 'primary_turn' || item.slot === 'must_stage');
  const nonDuplicateStageTexts = activePrimaryLike
    .map((item) => item.text)
    .filter((text, index, arr) => arr.findIndex((candidate) => substantiallyDuplicates(candidate, text)) === index);
  if (nonDuplicateStageTexts.length >= 4 && !(scene.kind === 'encounter' || scene.isEncounter)) {
    diagnostics.push(`Scene "${scene.id ?? 'unknown'}" has ${nonDuplicateStageTexts.length} independent staged obligations; compile or split to one primary turn plus support.`);
  }
  return diagnostics;
}

export function compileSceneConstructionProfile(
  scene: SceneConstructionSceneLike,
  options: SceneConstructionProfileOptions = {},
): SceneConstructionProfile {
  const primaryTurn = primaryTurnFor(scene);
  const obligations = mergeAndRouteObligations(scene, primaryTurn, initialObligations(scene, primaryTurn));
  const activeObligations = obligations.filter((item) => isActiveSlot(item.slot));
  const activeTexts = activeObligations.map((item) => item.text);
  const hardUnits = Number(activeObligations.reduce((sum, item) => sum + item.hardUnits, 0).toFixed(2));
  const softUnits = Number(obligations
    .filter((item) => item.slot === 'texture')
    .slice(0, TEXTURE_PROMPT_LIMIT)
    .reduce((sum, item) => sum + item.softUnits, 0)
    .toFixed(2));
  const totalUnits = Number((hardUnits + softUnits).toFixed(2));
  const cast = activeCastFor(scene, activeTexts);
  const maxHard = maxHardUnits(scene);
  const maxTotal = maxTotalUnits(scene);
  const beatBudget = beatBudgetFor(scene, totalUnits);
  const explicitTimeCueCount = Array.from(new Set(activeTexts.flatMap(timeCues))).length;
  const explicitLocationCueCount = locationCueCount(scene, activeTexts);
  const introductionCount = activeObligations.filter((item) => INTRO_RE.test(item.text)).length;
  const activeConflictCount = activeObligations.filter((item) => CONTRAST_RE.test(item.text) || item.slot === 'must_stage').length;
  const conflictDiagnosticsList = conflictDiagnostics(scene, obligations, hardUnits, totalUnits, maxHard, maxTotal);

  return {
    id: `scene-construction:${options.episodeNumber ?? scene.episodeNumber ?? 'episode'}:${scene.id ?? 'scene'}`,
    episodeNumber: options.episodeNumber ?? scene.episodeNumber,
    sceneId: scene.id ?? 'scene',
    primaryTurn,
    obligations,
    sourceContractIds: sourceIds(obligations.filter((item) => item.slot !== 'metadata_only')),
    activeCast: cast.activeCast,
    passiveCast: cast.passiveCast,
    capacity: {
      hardUnits,
      softUnits,
      totalUnits,
      maxHardUnits: maxHard,
      maxTotalUnits: maxTotal,
      activeCastCount: cast.activeCastCount,
      maxActiveCast: cast.maxActiveCast,
      activeConflictCount,
      introductionCount,
      explicitTimeCueCount,
      explicitLocationCueCount,
      beatBudget,
    },
    routedObligationIds: obligations.filter((item) => item.slot === 'route_later' || item.slot === 'metadata_only').map((item) => item.id),
    conflictDiagnostics: conflictDiagnosticsList,
    promptGuidance: [
      'Write one scene around the primary turn; do not service routed concepts as separate events.',
      'Use supporting obligations only when they sharpen the same collision, decision, reveal, or changed state.',
      'Keep passive cast offscreen or incidental unless a hard staged obligation requires them.',
    ],
  };
}

export function attachSceneConstructionProfiles<T extends SceneConstructionSceneLike>(
  scenes: T[],
  options: SceneConstructionProfileOptions = {},
): SceneConstructionProfileDiagnostic[] {
  const diagnostics: SceneConstructionProfileDiagnostic[] = [];
  scenes.forEach((scene, index) => {
    const profile = compileSceneConstructionProfile(scene, {
      ...options,
      sceneIndex: index,
      episodeNumber: options.episodeNumber ?? scene.episodeNumber,
    });
    scene.sceneConstructionProfile = profile;
    for (const message of profile.conflictDiagnostics) {
      diagnostics.push({
        sceneId: scene.id,
        episodeNumber: profile.episodeNumber,
        severity: 'error',
        message,
      });
    }
  });
  return diagnostics;
}

export function collectSceneConstructionProfileIssues<T extends SceneConstructionSceneLike>(
  scenes: T[],
  options: SceneConstructionProfileOptions = {},
): string[] {
  return attachSceneConstructionProfiles(scenes, options)
    .filter((diagnostic) => diagnostic.severity === 'error')
    .map((diagnostic) => diagnostic.message);
}

function activeIdsFor(profile: SceneConstructionProfile | undefined, source: SceneConstructionSource): Set<string> | undefined {
  if (!profile) return undefined;
  return new Set(profile.obligations
    .filter((item) => item.source === source && isActiveSlot(item.slot))
    .map((item) => item.id));
}

function keepByProfile<T extends { id?: string }>(
  profile: SceneConstructionProfile | undefined,
  source: SceneConstructionSource,
  items: T[] | undefined,
): T[] | undefined {
  if (!items) return items;
  const ids = activeIdsFor(profile, source);
  if (!ids) return items;
  return items.filter((item) => item.id && ids.has(item.id));
}

export function buildSceneConstructionPromptView<T extends SceneConstructionSceneLike>(scene: T): T {
  const profile = scene.sceneConstructionProfile;
  if (!profile) return scene;
  const keyBeatIds = activeIdsFor(profile, 'keyBeat');
  const requiredBeatIds = activeIdsFor(profile, 'requiredBeat');
  const choiceActive = Boolean(activeIdsFor(profile, 'choicePressure')?.size);
  const signatureActive = Boolean(activeIdsFor(profile, 'signatureMoment')?.size)
    || Boolean(requiredBeatIds && (scene.requiredBeats ?? []).some((beat) => requiredBeatIds.has(beat.id) && beat.tier === 'signature'));

  return {
    ...scene,
    npcsPresent: profile.activeCast.length > 0 ? profile.activeCast : scene.npcsPresent,
    npcsInvolved: profile.activeCast.length > 0 ? profile.activeCast : scene.npcsInvolved,
    requiredBeats: scene.requiredBeats && requiredBeatIds
      ? scene.requiredBeats.filter((beat) => requiredBeatIds.has(beat.id))
      : scene.requiredBeats,
    signatureMoment: signatureActive ? scene.signatureMoment : undefined,
    storyCircleBeatContracts: keepByProfile(profile, 'storyCircle', scene.storyCircleBeatContracts),
    relationshipPacing: keepByProfile(profile, 'relationshipPacing', scene.relationshipPacing),
    mechanicPressure: keepByProfile(profile, 'mechanicPressure', scene.mechanicPressure),
    authoredTreatmentFields: keepByProfile(profile, 'treatmentField', scene.authoredTreatmentFields),
    seasonPromiseContracts: keepByProfile(profile, 'seasonPromise', scene.seasonPromiseContracts),
    stakesArchitectureContracts: keepByProfile(profile, 'stakesArchitecture', scene.stakesArchitectureContracts),
    arcPressureContracts: keepByProfile(profile, 'arcPressure', scene.arcPressureContracts),
    branchConsequenceContracts: keepByProfile(profile, 'branchConsequence', scene.branchConsequenceContracts),
    endingRealizationContracts: keepByProfile(profile, 'endingRealization', scene.endingRealizationContracts),
    failureModeAuditContracts: keepByProfile(profile, 'failureModeAudit', scene.failureModeAuditContracts),
    characterTreatmentContracts: keepByProfile(profile, 'characterTreatment', scene.characterTreatmentContracts),
    worldTreatmentContracts: keepByProfile(profile, 'worldTreatment', scene.worldTreatmentContracts),
    keyBeats: scene.keyBeats && keyBeatIds
      ? scene.keyBeats.filter((_, index) => keyBeatIds.has(`keyBeat:${index}`))
      : scene.keyBeats,
    choicePoint: choiceActive ? scene.choicePoint : undefined,
  };
}

export function buildSceneConstructionProfileSection(scene: SceneConstructionSceneLike | undefined): string {
  const profile = scene?.sceneConstructionProfile;
  if (!profile) return '';
  const active = profile.obligations.filter((item) => item.slot === 'must_stage' || item.slot === 'must_support').slice(0, 8);
  const texture = profile.obligations.filter((item) => item.slot === 'texture').slice(0, 6);
  const routed = profile.obligations.filter((item) => item.slot === 'route_later' || item.slot === 'metadata_only').slice(0, 6);
  const conflicts = profile.conflictDiagnostics;

  return `
### SCENE CONSTRUCTION CONTRACT - one turn, bounded load
This scene has one dramatic center. Treat every active obligation as evidence,
pressure, or residue for that same turn. Do not turn supporting or routed
concepts into separate events, locations, timelines, or ensemble introductions.

- Primary turn: ${profile.primaryTurn.text}
${profile.primaryTurn.beforeState ? `- Before state: ${profile.primaryTurn.beforeState}\n` : ''}${profile.primaryTurn.turnEvent ? `- Turn event: ${profile.primaryTurn.turnEvent}\n` : ''}${profile.primaryTurn.afterState ? `- After state: ${profile.primaryTurn.afterState}\n` : ''}${profile.primaryTurn.handoff ? `- Handoff: ${profile.primaryTurn.handoff}\n` : ''}- Active cast budget: ${profile.capacity.activeCastCount}/${profile.capacity.maxActiveCast}${profile.activeCast.length ? ` (${profile.activeCast.join(', ')})` : ''}
- Beat budget: aim for ${profile.capacity.beatBudget.recommended} beats (${profile.capacity.beatBudget.min}-${profile.capacity.beatBudget.max} allowed)
${active.length ? `- Active obligations serving this turn:\n${active.map((item) => `  - [${item.source}] ${item.text}`).join('\n')}\n` : ''}${texture.length ? `- Texture only, not extra scene turns:\n${texture.map((item) => `  - [${item.source}] ${item.text}`).join('\n')}\n` : ''}${routed.length ? `- Routed/metadata concepts to avoid staging here:\n${routed.map((item) => `  - [${item.source}] ${item.text}`).join('\n')}\n` : ''}${conflicts.length ? `- Planning conflicts: ${conflicts.join(' ')}\n` : ''}
`.trimEnd() + '\n';
}
