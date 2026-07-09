import type { SeasonPlan } from '../../types/seasonPlan';
import type {
  CharacterArchitecture,
  NpcTreatmentGuidance,
  ProtagonistTreatmentGuidance,
  StoryEndingTarget,
} from '../../types/sourceAnalysis';
import type {
  CharacterTreatmentFieldKind,
  CharacterTreatmentRealizationContract,
  CharacterTreatmentRealizationTarget,
  MechanicPressureContract,
  MechanicPressureDomain,
  PlannedScene,
  RequiredBeat,
} from '../../types/scenePlan';
import {
  treatmentFieldCloseMatch,
  treatmentFieldTokens,
} from './treatmentFieldContracts';

const KIND_PREFIX: Record<CharacterTreatmentFieldKind, string> = {
  canonical_identity: 'canonical-identity',
  role_fact: 'role-fact',
  origin_pressure: 'origin-pressure',
  conscious_want: 'conscious-want',
  dramatic_need: 'dramatic-need',
  lie_pressure: 'lie-pressure',
  wound_pressure: 'wound-pressure',
  truth_target: 'truth-target',
  arc_mode: 'arc-mode',
  starting_identity: 'starting-identity',
  ending_state: 'ending-state',
  climax_choice: 'climax-choice',
  pressure_point: 'pressure-point',
  visual_identity: 'visual-identity',
};

const KIND_REALIZATION: Record<CharacterTreatmentFieldKind, CharacterTreatmentRealizationTarget[]> = {
  canonical_identity: ['character_bible'],
  role_fact: ['character_bible', 'scene_turn', 'mechanic_pressure', 'information_ledger', 'final_prose'],
  origin_pressure: ['character_bible', 'scene_turn', 'mechanic_pressure', 'final_prose'],
  conscious_want: ['season_arc', 'scene_turn', 'choice', 'final_prose'],
  dramatic_need: ['season_arc', 'mechanic_pressure', 'ending_target', 'final_prose'],
  lie_pressure: ['season_arc', 'choice', 'mechanic_pressure', 'final_prose'],
  wound_pressure: ['character_bible', 'scene_turn', 'mechanic_pressure', 'final_prose'],
  truth_target: ['season_arc', 'finale_choice', 'ending_target', 'final_prose'],
  arc_mode: ['season_arc', 'ending_target', 'final_prose'],
  starting_identity: ['scene_turn', 'choice', 'final_prose'],
  ending_state: ['ending_target', 'mechanic_pressure', 'final_prose'],
  climax_choice: ['finale_choice', 'choice', 'ending_target', 'mechanic_pressure', 'final_prose'],
  pressure_point: ['scene_turn', 'mechanic_pressure', 'information_ledger', 'final_prose'],
  visual_identity: ['character_bible', 'visual_profile'],
};

const LOAD_BEARING_ROLE_FACT_RE = /\b(?:writer|blogger|job|profession|career|romanian|grandmother|grandfather|mother|father|sister|brother|niece|nephew|address|apartment|escaped?|fled|flight|engagement|fianc|married|divorce|called off|betray|infidelity|scandal|public|magazine|new york|bucharest|boston|\b\d{4}\b|\b\d{2}\b)\b/i;

function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 54) || 'character-field';
}

function hasText(value: string | undefined): value is string {
  return Boolean(value?.trim());
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function splitRoleFacts(value: string | undefined): Array<{ text: string; loadBearing: boolean }> {
  if (!value?.trim()) return [];
  const parts = value
    .split(/;\s+|(?<=\.)\s+(?=[A-Z0-9])/)
    .map((part) => part.trim().replace(/\.$/, ''))
    .filter((part) => part.length >= 12)
    .slice(0, 10);
  return (parts.length > 0 ? parts : [value.trim()]).map((text) => ({
    text,
    loadBearing: LOAD_BEARING_ROLE_FACT_RE.test(text),
  }));
}

function splitPressurePoints(value: string[] | undefined): string[] {
  return dedupe((value ?? []).flatMap((item) => item.split(/;\s+/)));
}

function targetEpisodesFor(kind: CharacterTreatmentFieldKind, totalEpisodes: number): number[] {
  const max = Math.max(1, totalEpisodes || 1);
  const first = 1;
  const midpoint = Math.max(1, Math.ceil(max / 2));
  const finale = max;
  switch (kind) {
    case 'canonical_identity':
    case 'role_fact':
    case 'origin_pressure':
    case 'starting_identity':
    case 'visual_identity':
      return [first];
    case 'conscious_want':
    case 'wound_pressure':
      return Array.from(new Set([first, midpoint].filter((n) => n <= max)));
    case 'dramatic_need':
    case 'lie_pressure':
      return Array.from(new Set([first, midpoint, finale].filter((n) => n <= max)));
    case 'truth_target':
    case 'arc_mode':
    case 'ending_state':
    case 'climax_choice':
      return Array.from(new Set([midpoint, finale].filter((n) => n <= max)));
    case 'pressure_point':
      return Array.from(new Set([first, midpoint, finale].filter((n) => n <= max)));
    default:
      return [first];
  }
}

function makeContract(input: {
  source: CharacterTreatmentRealizationContract['source'];
  characterId?: string;
  characterName: string;
  fieldName: string;
  sourceText: string | undefined;
  contractKind: CharacterTreatmentFieldKind;
  totalEpisodes: number;
  index: number;
  blockingLevel: CharacterTreatmentRealizationContract['blockingLevel'];
}): CharacterTreatmentRealizationContract | undefined {
  const text = input.sourceText?.trim();
  if (!text) return undefined;
  return {
    id: `character-${input.characterId || slug(input.characterName)}-${KIND_PREFIX[input.contractKind]}-${input.index + 1}-${slug(text)}`,
    source: input.source,
    subject: 'protagonist',
    characterId: input.characterId,
    characterName: input.characterName,
    fieldName: input.fieldName,
    sourceText: text,
    contractKind: input.contractKind,
    requiredRealization: KIND_REALIZATION[input.contractKind],
    targetEpisodeNumbers: targetEpisodesFor(input.contractKind, input.totalEpisodes),
    targetSceneIds: [],
    targetEndingIds: [],
    blockingLevel: input.blockingLevel,
  };
}

function push(
  out: CharacterTreatmentRealizationContract[],
  base: Omit<Parameters<typeof makeContract>[0], 'index'>,
): void {
  const contract = makeContract({ ...base, index: out.length });
  if (contract) out.push(contract);
}

function explicitContracts(input: {
  guidance?: ProtagonistTreatmentGuidance;
  protagonist?: { id?: string; name?: string; description?: string; fashionStyle?: unknown };
  totalEpisodes: number;
  treatmentSourced?: boolean;
}): CharacterTreatmentRealizationContract[] {
  const guidance = input.guidance;
  if (!guidance) return [];
  const out: CharacterTreatmentRealizationContract[] = [];
  const characterId = input.protagonist?.id;
  const characterName = input.protagonist?.name || 'protagonist';
  const level: CharacterTreatmentRealizationContract['blockingLevel'] = input.treatmentSourced ? 'treatment' : 'warning';
  const base = { source: 'treatment' as const, characterId, characterName, totalEpisodes: input.totalEpisodes };

  push(out, { ...base, fieldName: 'Name and pronouns', sourceText: guidance.nameAndPronouns, contractKind: 'canonical_identity', blockingLevel: level });
  for (const fact of splitRoleFacts(guidance.roleInWorld)) {
    push(out, {
      ...base,
      fieldName: 'Role in the world',
      sourceText: fact.text,
      contractKind: 'role_fact',
      blockingLevel: fact.loadBearing ? level : 'warning',
    });
  }
  push(out, { ...base, fieldName: 'Want', sourceText: guidance.want, contractKind: 'conscious_want', blockingLevel: level });
  push(out, { ...base, fieldName: 'Need', sourceText: guidance.need, contractKind: 'dramatic_need', blockingLevel: level });
  push(out, { ...base, fieldName: 'Lie', sourceText: guidance.lie, contractKind: 'lie_pressure', blockingLevel: level });
  push(out, { ...base, fieldName: 'Wound', sourceText: guidance.wound, contractKind: 'wound_pressure', blockingLevel: level });
  push(out, { ...base, fieldName: 'Truth', sourceText: guidance.truth, contractKind: 'truth_target', blockingLevel: level });
  push(out, { ...base, fieldName: 'Arc mode', sourceText: guidance.arcMode, contractKind: 'arc_mode', blockingLevel: level });
  push(out, { ...base, fieldName: 'Starting identity', sourceText: guidance.startingIdentity, contractKind: 'starting_identity', blockingLevel: level });
  for (const ending of guidance.possibleEndStates ?? []) {
    push(out, { ...base, fieldName: 'Possible end states', sourceText: ending, contractKind: 'ending_state', blockingLevel: level });
  }
  push(out, { ...base, fieldName: 'Climax choice', sourceText: guidance.climaxChoice, contractKind: 'climax_choice', blockingLevel: level });
  for (const pressure of splitPressurePoints(guidance.pressurePoints)) {
    push(out, { ...base, fieldName: 'Pressure points', sourceText: pressure, contractKind: 'pressure_point', blockingLevel: LOAD_BEARING_ROLE_FACT_RE.test(pressure) ? level : 'warning' });
  }
  push(out, { ...base, fieldName: 'Visual identity', sourceText: guidance.visualIdentity, contractKind: 'visual_identity', blockingLevel: 'structural' });
  return out;
}

function fallbackContracts(input: {
  characterArchitecture?: Partial<CharacterArchitecture>;
  protagonist?: { id?: string; name?: string; description?: string; fashionStyle?: unknown };
  endings?: StoryEndingTarget[];
  totalEpisodes: number;
}): CharacterTreatmentRealizationContract[] {
  const out: CharacterTreatmentRealizationContract[] = [];
  const characterId = input.protagonist?.id;
  const characterName = input.protagonist?.name || 'protagonist';
  const base = {
    source: 'analysis_fallback' as const,
    characterId,
    characterName,
    totalEpisodes: input.totalEpisodes,
    blockingLevel: 'warning' as const,
  };
  const p = input.characterArchitecture?.protagonist;
  push(out, { ...base, fieldName: 'Role in the world', sourceText: input.protagonist?.description, contractKind: 'role_fact' });
  push(out, { ...base, fieldName: 'Want', sourceText: p?.want, contractKind: 'conscious_want' });
  push(out, { ...base, fieldName: 'Need', sourceText: p?.need, contractKind: 'dramatic_need' });
  push(out, { ...base, fieldName: 'Lie', sourceText: p?.lie, contractKind: 'lie_pressure' });
  push(out, { ...base, fieldName: 'Wound', sourceText: p?.originPressure, contractKind: 'wound_pressure' });
  push(out, { ...base, fieldName: 'Truth', sourceText: p?.truth, contractKind: 'truth_target' });
  push(out, { ...base, fieldName: 'Arc mode', sourceText: p?.arcMode, contractKind: 'arc_mode' });
  push(out, { ...base, fieldName: 'Climax choice', sourceText: p?.climaxChoice?.choiceQuestion, contractKind: 'climax_choice' });
  for (const ending of input.endings ?? []) {
    push(out, { ...base, fieldName: 'Possible end states', sourceText: `${ending.name}: ${ending.summary}`, contractKind: 'ending_state' });
  }
  if (input.protagonist?.fashionStyle) {
    push(out, { ...base, fieldName: 'Visual identity', sourceText: JSON.stringify(input.protagonist.fashionStyle), contractKind: 'visual_identity' });
  }
  return out;
}

export function buildNpcVisualIdentityContracts(input: {
  npcGuidance?: NpcTreatmentGuidance[];
  totalEpisodes: number;
}): CharacterTreatmentRealizationContract[] {
  const out: CharacterTreatmentRealizationContract[] = [];
  for (const npc of input.npcGuidance ?? []) {
    if (!npc.visualIdentity?.trim()) continue;
    push(out, {
      source: 'treatment',
      characterId: npc.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      characterName: npc.name,
      totalEpisodes: input.totalEpisodes,
      fieldName: `${npc.name} visual identity`,
      sourceText: npc.visualIdentity,
      contractKind: 'visual_identity',
      blockingLevel: 'structural',
    });
  }
  return out;
}

export function buildCharacterTreatmentContracts(input: {
  guidance?: ProtagonistTreatmentGuidance;
  npcGuidance?: NpcTreatmentGuidance[];
  characterArchitecture?: Parameters<typeof fallbackContracts>[0]['characterArchitecture'];
  protagonist?: { id?: string; name?: string; description?: string; fashionStyle?: unknown };
  endings?: StoryEndingTarget[];
  totalEpisodes: number;
  treatmentSourced?: boolean;
}): CharacterTreatmentRealizationContract[] {
  const explicit = explicitContracts(input);
  const npcVisual = buildNpcVisualIdentityContracts({
    npcGuidance: input.npcGuidance,
    totalEpisodes: input.totalEpisodes,
  });
  if (explicit.length > 0) return [...explicit, ...npcVisual];
  return [...fallbackContracts(input), ...npcVisual];
}

export function buildCharacterTreatmentContractsForPlan(
  plan: Pick<SeasonPlan, 'characterTreatmentContracts' | 'characterArchitecture' | 'protagonist' | 'resolvedEndings' | 'totalEpisodes'> & {
    treatmentSeasonGuidance?: {
      protagonistGuidance?: ProtagonistTreatmentGuidance;
      npcGuidance?: NpcTreatmentGuidance[];
    };
  },
): CharacterTreatmentRealizationContract[] {
  if ((plan.characterTreatmentContracts ?? []).length > 0) return plan.characterTreatmentContracts ?? [];
  return buildCharacterTreatmentContracts({
    guidance: plan.treatmentSeasonGuidance?.protagonistGuidance,
    npcGuidance: plan.treatmentSeasonGuidance?.npcGuidance,
    characterArchitecture: plan.characterArchitecture,
    protagonist: plan.protagonist,
    endings: plan.resolvedEndings,
    totalEpisodes: plan.totalEpisodes,
    treatmentSourced: Boolean(plan.treatmentSeasonGuidance?.protagonistGuidance),
  });
}

function sceneText(scene: PlannedScene): string {
  return [
    scene.title,
    scene.dramaticPurpose,
    scene.stakes,
    scene.turnContract?.centralTurn,
    scene.turnContract?.beforeState,
    scene.turnContract?.turnEvent,
    scene.turnContract?.afterState,
    scene.turnContract?.handoff,
    scene.encounter?.description,
    scene.encounter?.centralConflict,
    ...(scene.requiredBeats ?? []).map((beat) => `${beat.sourceTurn} ${beat.mustDepict}`),
    ...(scene.mechanicPressure ?? []).map((pressure) => [
      pressure.storyPressure,
      ...(pressure.evidenceRequired ?? []),
      ...(pressure.visibleResidue ?? []),
    ].join(' ')),
  ].filter(Boolean).join(' ');
}

function scoreScene(contract: CharacterTreatmentRealizationContract, scene: PlannedScene): number {
  let score = treatmentFieldCloseMatch(contract.sourceText, sceneText(scene), characterTreatmentMatchThreshold(contract)) ? 1 : 0;
  if (contract.contractKind === 'starting_identity' && scene.episodeNumber === 1 && scene.order === 0) score += 0.45;
  if ((contract.contractKind === 'conscious_want' || contract.contractKind === 'lie_pressure' || contract.contractKind === 'wound_pressure') && scene.hasChoice) score += 0.25;
  if ((contract.contractKind === 'dramatic_need' || contract.contractKind === 'truth_target') && (scene.hasChoice || scene.narrativeRole === 'turn')) score += 0.25;
  if ((contract.contractKind === 'ending_state' || contract.contractKind === 'climax_choice' || contract.contractKind === 'arc_mode') && scene.narrativeRole === 'release') score += 0.45;
  if (contract.contractKind === 'pressure_point' && (scene.hasChoice || scene.kind === 'encounter' || (scene.mechanicPressure ?? []).length > 0)) score += 0.25;
  if (contract.contractKind === 'visual_identity' && scene.order === 0) score += 0.2;
  return score;
}

function bestSceneFor(contract: CharacterTreatmentRealizationContract, scenes: PlannedScene[]): PlannedScene | undefined {
  if (scenes.length === 0) return undefined;
  const sorted = [...scenes].sort((a, b) => a.order - b.order);
  const scored = sorted.map((scene) => ({ scene, score: scoreScene(contract, scene) })).sort((a, b) => b.score - a.score);
  if (scored[0]?.score > 0) return scored[0].scene;
  const choice = sorted.find((scene) => scene.hasChoice);
  const release = [...sorted].reverse().find((scene) => scene.narrativeRole === 'release') ?? sorted[sorted.length - 1];
  const turn = sorted.find((scene) => scene.narrativeRole === 'turn');
  switch (contract.contractKind) {
    case 'canonical_identity':
    case 'role_fact':
    case 'origin_pressure':
    case 'starting_identity':
    case 'visual_identity':
      return sorted[0];
    case 'conscious_want':
    case 'lie_pressure':
    case 'wound_pressure':
    case 'dramatic_need':
    case 'truth_target':
      return choice ?? turn ?? sorted[0];
    case 'ending_state':
    case 'climax_choice':
    case 'arc_mode':
      return release;
    case 'pressure_point':
      return choice ?? turn ?? sorted[0];
    default:
      return sorted[0];
  }
}

function domainForContract(contract: CharacterTreatmentRealizationContract): MechanicPressureDomain {
  if (contract.contractKind === 'role_fact' || contract.contractKind === 'pressure_point') {
    if (/\b(secret|learn|know|reveal|memoir|letter|photo|history|grandmother|truth|clue|information)\b/i.test(contract.sourceText)) return 'information';
    if (/\b(blog|byline|career|public|reputation|magazine|readership)\b/i.test(contract.sourceText)) return 'reputation';
    if (/\b(address|apartment|chain|phone|glasses|key|resource|access|sanctuary)\b/i.test(contract.sourceText)) return 'resource';
  }
  if (contract.contractKind === 'ending_state' || contract.contractKind === 'climax_choice') return 'route';
  return 'identity';
}

function functionForContract(contract: CharacterTreatmentRealizationContract): MechanicPressureContract['function'] {
  if (contract.contractKind === 'ending_state' || contract.contractKind === 'truth_target' || contract.contractKind === 'arc_mode') return 'resolve';
  if (contract.contractKind === 'climax_choice') return 'gate';
  if (contract.contractKind === 'role_fact' || contract.contractKind === 'starting_identity' || contract.contractKind === 'pressure_point') return 'plant';
  return 'intensify';
}

function addMechanicPressure(scene: PlannedScene, contract: CharacterTreatmentRealizationContract): void {
  if (!contract.requiredRealization.includes('mechanic_pressure')) return;
  const domain = domainForContract(contract);
  const pressure: MechanicPressureContract = {
    id: `${contract.id}-mechanic-pressure`,
    source: contract.source === 'treatment' ? 'treatment' : 'planner',
    domain,
    mechanicRef: domain === 'identity'
      ? { identityAxis: contract.contractKind }
      : domain === 'route'
      ? { routeId: contract.id }
      : domain === 'information'
      ? { infoId: contract.id }
      : { flag: contract.id },
    function: functionForContract(contract),
    storyPressure: contract.sourceText,
    evidenceRequired: [`Dramatize protagonist field: ${contract.fieldName}`],
    visibleResidue: ['show changed behavior, choice pressure, information, posture, vulnerability, access, or consequence'],
    allowedPayoffs: contract.requiredRealization,
    blockedPayoffs: ['metadata-only transformation', 'ending state or payoff unsupported by protagonist pressure'],
    originatingSceneId: scene.id,
  };
  const existing = scene.mechanicPressure ?? [];
  if (!existing.some((candidate) => candidate.id === pressure.id)) {
    scene.mechanicPressure = [...existing, pressure];
  }
}

function assignEndingTargets(
  contract: CharacterTreatmentRealizationContract,
  endings: StoryEndingTarget[] | undefined,
): void {
  if (contract.contractKind !== 'ending_state' && contract.contractKind !== 'climax_choice' && contract.contractKind !== 'truth_target') return;
  const matches = (endings ?? []).filter((ending) =>
    treatmentFieldCloseMatch(contract.sourceText, `${ending.name} ${ending.summary} ${ending.themePayoff} ${ending.targetConditions.join(' ')} ${ending.stateDrivers.map((driver) => `${driver.label} ${driver.details ?? ''}`).join(' ')}`, 0.18)
  );
  contract.targetEndingIds = matches.map((ending) => ending.id);
}

export function assignCharacterTreatmentContractsToScenes(
  plan: Pick<SeasonPlan, 'characterTreatmentContracts' | 'resolvedEndings' | 'totalEpisodes'>,
  scenes: PlannedScene[],
): CharacterTreatmentRealizationContract[] {
  const contracts = plan.characterTreatmentContracts ?? [];
  for (const contract of contracts) {
    assignEndingTargets(contract, plan.resolvedEndings);
    const targetSceneIds = new Set(contract.targetSceneIds ?? []);
    for (const episodeNumber of contract.targetEpisodeNumbers ?? []) {
      const episodeScenes = scenes.filter((scene) => scene.episodeNumber === episodeNumber);
      const target = bestSceneFor(contract, episodeScenes);
      if (!target) continue;
      targetSceneIds.add(target.id);
      const existing = target.characterTreatmentContracts ?? [];
      if (!existing.some((candidate) => candidate.id === contract.id)) {
        target.characterTreatmentContracts = [...existing, contract];
      }
      addMechanicPressure(target, contract);
    }
    contract.targetSceneIds = Array.from(targetSceneIds);
  }
  return contracts;
}

export function characterTreatmentMatchThreshold(contract: CharacterTreatmentRealizationContract): number {
  const tokenCount = treatmentFieldTokens(contract.sourceText).length;
  if (contract.contractKind === 'canonical_identity') return 0.45;
  if (contract.contractKind === 'arc_mode' && tokenCount <= 2) return 0.8;
  if (contract.contractKind === 'visual_identity') return 0.25;
  if (tokenCount <= 2) return 0.55;
  if (
    contract.contractKind === 'role_fact'
    || contract.contractKind === 'pressure_point'
    || contract.contractKind === 'ending_state'
    || contract.contractKind === 'climax_choice'
    || contract.contractKind === 'truth_target'
  ) return 0.2;
  return 0.25;
}

/** Protagonist-brief fields that must appear in each episode's opening scene when authored. */
export const OPENING_EPISODE_CHARACTER_KINDS = new Set<CharacterTreatmentFieldKind>([
  'role_fact',
  'origin_pressure',
  'wound_pressure',
  'starting_identity',
  'visual_identity',
]);

/** Load-bearing opening identity kinds that must stage named atoms on Ep1 cold open. */
const OPENING_IDENTITY_ATOM_KINDS = new Set<CharacterTreatmentFieldKind>([
  'role_fact',
  'wound_pressure',
  'origin_pressure',
]);

/**
 * Extract concrete identity atoms (occupation, ex name, origin city, cancelled
 * engagement) from protagonist-brief prose so SceneWriter stages them instead
 * of a generic arrival.
 */
export function extractOpeningIdentityAtoms(sourceText: string): string[] {
  const text = sourceText.trim();
  if (!text) return [];
  const atoms: string[] = [];
  const occupation = text.match(
    /\b((?:American\s+)?(?:food\s+)?(?:writer|blogger|journalist|editor|photographer|chef|restaurateur)(?:\s+turned\s+\w+)?)\b/i,
  );
  if (occupation?.[1]) atoms.push(occupation[1]);
  const originCity = text.match(
    /\b(?:from|in|of|fleeing|arrives?\s+from|left)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/,
  );
  if (originCity?.[1] && !/Bucharest|Romania/i.test(originCity[1])) {
    atoms.push(originCity[1]);
  }
  if (/\bNew York\b/i.test(text)) atoms.push('New York');
  const engagement = text.match(
    /\b((?:publicly\s+)?(?:cancelled|called[\s-]off)\s+engagement(?:\s+to\s+[^.]+)?|(?:engagement\s+to\s+[^.]+?(?:imploded|cancelled|called[\s-]off)[^.]*))/i,
  );
  if (engagement?.[1]) atoms.push(engagement[1].replace(/\s+/g, ' ').trim());
  else if (/\bengagement\b/i.test(text) && /\b(?:imploded|cancelled|called[\s-]off|public)\b/i.test(text)) {
    atoms.push('cancelled engagement');
  }
  // Proper-name ex / partner: "engagement to New York restaurateur Daniel Hayes"
  const partner = text.match(
    /\b(?:engagement|fianc[eé]|ex|boyfriend|girlfriend|husband|wife|partner)\s+to\s+(?:(?:a|an|the)\s+)?(?:[\w-]+\s+){0,4}([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/,
  );
  if (partner?.[1] && !/New York|Bucharest/i.test(partner[1])) atoms.push(partner[1]);
  const namedPerson = text.match(/\b([A-Z][a-z]+\s+[A-Z][a-z]+)\b/g) ?? [];
  for (const name of namedPerson) {
    if (/New York|Bucharest|Casa |Valescu|Lumina/i.test(name)) continue;
    if (atoms.some((atom) => atom.includes(name))) continue;
    // Keep partner-like names that appear near engagement/restaurateur cues.
    if (/\b(?:engagement|restaurateur|fianc|ex)\b/i.test(text)) atoms.push(name);
  }
  return Array.from(new Set(atoms.map((atom) => atom.trim()).filter((atom) => atom.length >= 3))).slice(0, 6);
}

function openingIdentityMustDepict(contract: CharacterTreatmentRealizationContract): string {
  const atoms = extractOpeningIdentityAtoms(contract.sourceText);
  if (atoms.length === 0) {
    return `Establish the protagonist's ${contract.fieldName.toLowerCase()} through concrete behavior or detail (fiction-first): ${contract.sourceText}`;
  }
  return (
    `On the opening page, stage these protagonist identity facts in second-person fiction `
    + `(name or clearly imply each; do not paste this checklist): ${atoms.join('; ')}. `
    + `Source: ${contract.sourceText}`
  );
}

/**
 * Seed early protagonist-brief contracts onto the first scene of each episode.
 * Use advisory `seed` (not hard `coldopen`): hard cold-open stacking with the
 * arrival turn blew SceneConstructionGate past max hard units
 * (bite-me 2026-07-08: 6.25/5 on s1-1). CharacterTreatmentRealizationValidator
 * still owns final-contract evidence for these contracts.
 *
 * Role/wound/origin contracts get atomized mustDepict so Ep1 cannot ship a
 * generic arrival that omits food-writer / cancelled-engagement / New York /
 * named ex facts present in the protagonist brief.
 */
export function appendOpeningCharacterTreatmentRequiredBeats(scenes: PlannedScene[]): void {
  const byEpisode = new Map<number, PlannedScene[]>();
  for (const scene of scenes) {
    const episodeNumber = scene.episodeNumber ?? 1;
    byEpisode.set(episodeNumber, [...(byEpisode.get(episodeNumber) ?? []), scene]);
  }

  for (const [episodeNumber, episodeScenes] of byEpisode) {
    const opening = [...episodeScenes].sort((a, b) => a.order - b.order)[0];
    if (!opening) continue;

    for (const contract of opening.characterTreatmentContracts ?? []) {
      if (!OPENING_EPISODE_CHARACTER_KINDS.has(contract.contractKind)) continue;
      if (!(contract.targetEpisodeNumbers ?? [episodeNumber]).includes(episodeNumber)) continue;

      const beatId = `${opening.id}-char-${contract.id}`;
      if ((opening.requiredBeats ?? []).some((beat) => beat.id === beatId)) continue;

      const beat: RequiredBeat = {
        id: beatId,
        sourceTurn: contract.sourceText,
        mustDepict: OPENING_IDENTITY_ATOM_KINDS.has(contract.contractKind)
          ? openingIdentityMustDepict(contract)
          : `Establish the protagonist's ${contract.fieldName.toLowerCase()} through concrete behavior or detail (fiction-first): ${contract.sourceText}`,
        tier: 'seed',
      };
      opening.requiredBeats = [...(opening.requiredBeats ?? []), beat];
    }
  }
}
