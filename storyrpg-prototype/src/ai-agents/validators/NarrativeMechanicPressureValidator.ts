import type { Beat, Choice, ConditionExpression, Consequence, Scene, Story } from '../../types';
import type {
  MechanicPressureContract,
  MechanicPressureDomain,
  PlannedScene,
  RelationshipPacingContract,
  SeasonScenePlan,
} from '../../types/scenePlan';
import { BaseValidator, ValidationIssue, ValidationResult } from './BaseValidator';

export interface NarrativeMechanicPressureInput {
  story: Story;
  scenePlan?: SeasonScenePlan;
  treatmentSourced?: boolean;
}

interface SceneRef {
  planned?: PlannedScene;
  episodeNumber: number;
  scene: Scene;
  ordinal: number;
}

interface ConsequenceRef {
  consequence: Consequence;
  choice?: Choice;
  beat?: Beat;
}

const LARGE_MAGNITUDE = 10;
const RELATIONSHIP_LARGE_MAGNITUDE = 6;
const MAJOR_EVIDENCE_RE = /\b(rescue|saved|sacrifice|confess|secret|risked|bled|wounded|protected|betray|public cost|exposed|gave up|lost|injured|vow|promise)\b/i;
const RESIDUE_RE = /\b(changed|remembers?|hesitates?|invites?|withholds?|opens?|blocks?|carries?|keeps?|notices?|owes?|debt|risk|cost|scar|clue|key|card|access|suspicion|warning|promise|secret|later|because)\b/i;

function plannedById(scenePlan?: SeasonScenePlan): Map<string, PlannedScene> {
  const out = new Map<string, PlannedScene>();
  for (const scene of scenePlan?.scenes ?? []) out.set(scene.id, scene);
  return out;
}

function collectScenes(input: NarrativeMechanicPressureInput): SceneRef[] {
  const planned = plannedById(input.scenePlan);
  const refs: SceneRef[] = [];
  let ordinal = 0;
  for (const episode of input.story.episodes ?? []) {
    for (const scene of episode.scenes ?? []) {
      refs.push({ episodeNumber: episode.number, scene, planned: planned.get(scene.id), ordinal });
      ordinal += 1;
    }
  }
  return refs.sort((a, b) => (a.episodeNumber - b.episodeNumber) || ((a.planned?.order ?? a.ordinal) - (b.planned?.order ?? b.ordinal)));
}

function relationshipPressure(contract: RelationshipPacingContract, sceneId: string): MechanicPressureContract {
  return {
    id: `${contract.id}-mechanic-pressure`,
    source: contract.source,
    domain: 'relationship',
    mechanicRef: {
      npcId: contract.npcId,
      relationshipDimension: contract.mechanicDimensions[0] ?? 'trust',
    },
    function: 'intensify',
    storyPressure: `Relationship can advance only to ${contract.targetStage}.`,
    evidenceRequired: contract.requiredEvidence,
    visibleResidue: ['changed distance, invitation, withholding, teasing, remembered detail, challenge, or refusal'],
    allowedPayoffs: contract.allowedLabels,
    blockedPayoffs: contract.blockedLabels,
    originatingSceneId: sceneId,
    maxMagnitudeThisScene: contract.maxDeltaThisScene,
  };
}

function contractsFor(ref: SceneRef): MechanicPressureContract[] {
  const contracts = ref.scene.mechanicPressure ?? ref.planned?.mechanicPressure ?? [];
  const pacing = ref.scene.relationshipPacing ?? ref.planned?.relationshipPacing ?? [];
  const branchPressure: MechanicPressureContract[] = (ref.scene.branchConsequenceContracts ?? ref.planned?.branchConsequenceContracts ?? []).map((contract) => ({
    id: `${contract.id}-mechanic-pressure`,
    source: contract.source === 'treatment' ? 'treatment' : 'planner',
    domain: contract.stateDomains[0] ?? 'flag',
    mechanicRef: { flag: contract.id, routeId: contract.branchId },
    function: contract.contractKind === 'branch_origin_choice' ? 'plant' : contract.contractKind === 'branch_later_payoff' || contract.contractKind === 'branch_reconvergence_residue' ? 'payoff' : 'intensify',
    storyPressure: contract.sourceText,
    evidenceRequired: ['Show the authored branch event or state as on-page pressure.'],
    visibleResidue: ['branch-specific access, resource, relationship, information, route, reputation, identity, or ending-eligibility residue'],
    allowedPayoffs: ['conditional prose, text variant, route permission, consequence chain, choice wording, callback, or ending condition'],
    blockedPayoffs: ['generic route label, cosmetic reconvergence, or payoff with no origin pressure'],
    originatingSceneId: ref.scene.id,
  }));
  const endingPressure: MechanicPressureContract[] = (ref.scene.endingRealizationContracts ?? ref.planned?.endingRealizationContracts ?? []).map((contract) => ({
    id: `${contract.id}-mechanic-pressure`,
    source: contract.source === 'treatment' ? 'treatment' : 'planner',
    domain: contract.stateDomains[0] ?? 'route',
    mechanicRef: { flag: contract.id, routeId: contract.endingId },
    function: contract.contractKind === 'ending_target_condition' ? 'gate' : 'payoff',
    storyPressure: contract.sourceText,
    evidenceRequired: ['Tie the ending state to prior choices, branch residue, target conditions, or finale agency.'],
    visibleResidue: ['route-specific final state, emotional register, theme payoff, or changed protagonist condition'],
    allowedPayoffs: ['finale choice, ending route condition, ending prose, route-specific state, or callback'],
    blockedPayoffs: ['unearned ending transformation or ending prose unsupported by route mechanics'],
    originatingSceneId: ref.scene.id,
  }));
  const failureModePressure: MechanicPressureContract[] = (ref.scene.failureModeAuditContracts ?? ref.planned?.failureModeAuditContracts ?? []).map((contract) => ({
    id: `${contract.id}-mechanic-pressure`,
    source: contract.source === 'treatment' ? 'treatment' : 'planner',
    domain: 'flag' as MechanicPressureDomain,
    mechanicRef: { flag: contract.id },
    function: contract.contractKind === 'mitigation' || contract.contractKind === 'causality_claim' ? 'plant' : 'payoff',
    storyPressure: contract.sourceText,
    evidenceRequired: ['Show the authored failure-mode mitigation as on-page cause, agency, setup/payoff, fair-play clue, or durable state change.'],
    visibleResidue: ['agency, causal setup, visible mitigation, fair-play clue, changed state, theme rhyme, or irreversible residue'],
    allowedPayoffs: ['scene turn, choice pressure, information movement, setup/payoff, route condition, or ending state'],
    blockedPayoffs: ['metadata-only avoidance claim, explanatory QA sentence, outside rescue, unplanted reveal, or reset to opening state'],
    originatingSceneId: ref.scene.id,
  }));
  return [
    ...contracts,
    ...branchPressure,
    ...endingPressure,
    ...failureModePressure,
    ...pacing.map((contract) => relationshipPressure(contract, ref.scene.id)),
  ];
}

function choiceText(choice: Choice): string {
  const anyChoice = choice as Choice & {
    outcomeTexts?: Record<string, unknown>;
    reactionText?: string;
    designNotes?: string;
  };
  return [
    choice.text,
    choice.lockedText,
    choice.feedbackCue?.echoSummary,
    choice.feedbackCue?.progressSummary,
    choice.reminderPlan?.immediate,
    choice.reminderPlan?.shortTerm,
    choice.reminderPlan?.later,
    choice.visualResidueHint,
    ...(choice.residueHints ?? []).map((hint) => hint.description),
    ...(choice.witnessReactions ?? []).map((reaction) => `${reaction.reactionText} ${reaction.residueHint ?? ''}`),
    choice.failureResidue?.description,
    anyChoice.reactionText,
    anyChoice.designNotes,
    ...Object.values(anyChoice.outcomeTexts ?? {}).map((value) => typeof value === 'string' ? value : ''),
  ].filter(Boolean).join(' ');
}

function beatText(beat: Beat): string {
  return [
    beat.text,
    beat.visualMoment,
    beat.primaryAction,
    beat.emotionalRead,
    beat.relationshipDynamic,
    beat.dramaticIntent?.statusBefore,
    beat.dramaticIntent?.visibleTurn,
    beat.dramaticIntent?.statusAfter,
    beat.sequenceIntent?.startState,
    beat.sequenceIntent?.turningPoint,
    beat.sequenceIntent?.endState,
    ...(beat.textVariants ?? []).map((variant) => variant.text),
    ...((beat.choices ?? []) as Choice[]).map(choiceText),
  ].filter(Boolean).join(' ');
}

function encounterText(scene: Scene): string {
  const encounter = (scene as Scene & {
    encounter?: {
      phases?: Array<{ beats?: Array<{ text?: string; setupText?: string; escalationText?: string }> }>;
      storylets?: Array<{ beats?: Array<{ text?: string; setupText?: string; escalationText?: string }> }>
        | Record<string, { beats?: Array<{ text?: string; setupText?: string; escalationText?: string }> }>;
    };
  }).encounter;
  if (!encounter) return '';
  const parts: string[] = [];
  const collect = (beats: Array<{ text?: string; setupText?: string; escalationText?: string }> | undefined): void => {
    for (const beat of beats ?? []) parts.push(beat.text ?? '', beat.setupText ?? '', beat.escalationText ?? '');
  };
  for (const phase of encounter.phases ?? []) collect(phase.beats);
  const storylets = Array.isArray(encounter.storylets) ? encounter.storylets : Object.values(encounter.storylets ?? {});
  for (const storylet of storylets) collect(storylet?.beats);
  return parts.filter(Boolean).join(' ');
}

function sceneText(scene: Scene): string {
  return [scene.name, ...(scene.beats ?? []).map(beatText), encounterText(scene)].filter(Boolean).join(' ');
}

function consequenceRefs(scene: Scene): ConsequenceRef[] {
  const out: ConsequenceRef[] = [];
  for (const beat of scene.beats ?? []) {
    for (const consequence of beat.onShow ?? []) out.push({ consequence, beat });
    for (const choice of (beat.choices ?? []) as Choice[]) {
      for (const consequence of choice.consequences ?? []) out.push({ consequence, choice, beat });
      for (const delayed of choice.delayedConsequences ?? []) out.push({ consequence: delayed.consequence, choice, beat });
    }
  }
  return out;
}

function choiceConditions(scene: Scene): Array<{ choice: Choice; condition: ConditionExpression }> {
  const out: Array<{ choice: Choice; condition: ConditionExpression }> = [];
  for (const beat of scene.beats ?? []) {
    for (const choice of (beat.choices ?? []) as Choice[]) {
      if (choice.conditions) out.push({ choice, condition: choice.conditions });
    }
  }
  return out;
}

function walkCondition(condition: ConditionExpression, visit: (raw: any) => void): void {
  const raw = condition as any;
  if (!raw || typeof raw !== 'object') return;
  visit(raw);
  for (const child of raw.conditions ?? []) walkCondition(child, visit);
  if (raw.condition) walkCondition(raw.condition, visit);
}

function consequenceDomain(consequence: Consequence): MechanicPressureDomain {
  switch (consequence.type) {
    case 'relationship': return 'relationship';
    case 'attribute':
    case 'addTag':
    case 'removeTag': return 'identity';
    case 'skill': return 'skill';
    case 'setFlag': return 'flag';
    case 'changeScore':
    case 'setScore': return 'score';
    case 'addItem':
    case 'removeItem': return 'item';
    default: return 'resource';
  }
}

function conditionDomain(raw: any): MechanicPressureDomain | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  if (raw.type === 'relationship' || raw.npcId) return 'relationship';
  if (raw.type === 'flag' || raw.flag) return 'flag';
  if (raw.type === 'skill' || raw.skill) return 'skill';
  if (raw.type === 'attribute' || raw.attribute) return 'identity';
  if (raw.type === 'score' || raw.score) return 'score';
  if (raw.type === 'item' || raw.itemId) return 'item';
  if (raw.type === 'tag' || raw.tag) return 'identity';
  return undefined;
}

function pressureKey(domain: MechanicPressureDomain, ref: Partial<Record<string, unknown>>): string {
  const value =
    ref.npcId || ref.relationshipDimension || ref.flag || ref.score || ref.skill || ref.itemId
    || ref.identityAxis || ref.routeId || ref.infoId || ref.encounterOutcome || '*';
  return `${domain}:${String(value)}`;
}

function keyForConsequence(consequence: Consequence): string {
  switch (consequence.type) {
    case 'relationship':
      return pressureKey('relationship', { npcId: consequence.npcId, relationshipDimension: consequence.dimension });
    case 'skill':
      return pressureKey('skill', { skill: consequence.skill });
    case 'attribute':
      return pressureKey('identity', { identityAxis: consequence.attribute });
    case 'setFlag':
      return pressureKey('flag', { flag: consequence.flag });
    case 'changeScore':
    case 'setScore':
      return pressureKey('score', { score: consequence.score });
    case 'addItem':
      return pressureKey('item', { itemId: 'itemId' in consequence ? consequence.itemId : consequence.item.name });
    case 'removeItem':
      return pressureKey('item', { itemId: consequence.itemId });
    case 'addTag':
    case 'removeTag':
      return pressureKey('identity', { identityAxis: consequence.tag });
    default:
      return pressureKey(consequenceDomain(consequence), {});
  }
}

function keyForContract(contract: MechanicPressureContract): string {
  return pressureKey(contract.domain, { ...contract.mechanicRef });
}

function keyForCondition(domain: MechanicPressureDomain, raw: any): string {
  return pressureKey(domain, {
    npcId: raw.npcId,
    relationshipDimension: raw.dimension,
    flag: raw.flag,
    score: raw.score,
    skill: raw.skill,
    itemId: raw.itemId,
    identityAxis: raw.attribute || raw.tag,
  });
}

function isMeaningfulConsequence(consequence: Consequence): boolean {
  if (consequence.type === 'setFlag') {
    return Boolean(consequence.flag) && !/^(_|ui_|debug_|visited_|choice_seen_)/i.test(consequence.flag);
  }
  return true;
}

function consequenceMagnitude(consequence: Consequence): number | undefined {
  if ('change' in consequence && typeof consequence.change === 'number') return Math.abs(consequence.change);
  if (consequence.type === 'setScore' && typeof consequence.value === 'number') return Math.abs(consequence.value);
  return undefined;
}

function hasChoiceResidue(choice: Choice | undefined): boolean {
  if (!choice) return false;
  return Boolean(
    choice.mechanicPressure?.length
    || choice.residueHints?.length
    || choice.reminderPlan
    || choice.feedbackCue?.echoSummary
    || choice.feedbackCue?.progressSummary
    || choice.visualResidueHint
    || choice.witnessReactions?.length
    || choice.failureResidue
    || RESIDUE_RE.test(choiceText(choice)),
  );
}

function hasContractForConsequence(consequence: Consequence, contracts: MechanicPressureContract[]): boolean {
  const key = keyForConsequence(consequence);
  const domain = consequenceDomain(consequence);
  return contracts.some((contract) => contract.domain === domain && (keyForContract(contract) === key || keyForContract(contract).endsWith(':*')));
}

export class NarrativeMechanicPressureValidator extends BaseValidator {
  constructor() {
    super('NarrativeMechanicPressureValidator');
  }

  validate(input: NarrativeMechanicPressureInput): ValidationResult {
    const issues: ValidationIssue[] = [];
    const planted = new Set<string>();
    const plantedDomains = new Set<MechanicPressureDomain>();
    const spentContracts = new Set<string>();

    for (const ref of collectScenes(input)) {
      const contracts = contractsFor(ref);
      const text = sceneText(ref.scene);
      const loc = `mechanicPressure:ep${ref.episodeNumber}:${ref.scene.id}`;
      const treatmentScene = input.treatmentSourced || contracts.some((contract) => contract.source === 'treatment');

      for (const contract of contracts) {
        const key = keyForContract(contract);
        if (contract.function === 'plant' || contract.function === 'intensify' || contract.function === 'complicate' || contract.function === 'resolve') {
          planted.add(key);
          plantedDomains.add(contract.domain);
        }
        if ((contract.function === 'spend' || contract.function === 'payoff' || contract.function === 'gate') && !planted.has(key) && !plantedDomains.has(contract.domain) && contract.requiredBeforeSpend?.length) {
          issues.push({
            severity: treatmentScene ? 'error' : 'warning',
            location: `${loc}:${contract.id}`,
            message: `Scene "${ref.scene.id}" spends ${contract.domain} pressure before it has been planted on-page.`,
            suggestion: 'Insert or expand setup pressure before this payoff, or lower this contract to a plant/intensify scene.',
          });
        }
        if (!contract.evidenceRequired?.length || !contract.visibleResidue?.length || !contract.allowedPayoffs?.length) {
          issues.push({
            severity: treatmentScene ? 'error' : 'warning',
            location: `${loc}:${contract.id}`,
            message: `Mechanic pressure contract "${contract.id}" is missing evidence, residue, or payoff permissions.`,
            suggestion: 'State what event earns the pressure, how it is visible now, and what future payoff it permits.',
          });
        }
      }

      for (const refConsequence of consequenceRefs(ref.scene)) {
        const { consequence, choice } = refConsequence;
        if (!isMeaningfulConsequence(consequence)) continue;
        const domain = consequenceDomain(consequence);
        const hasPressure = hasContractForConsequence(consequence, contracts) || Boolean(choice?.mechanicPressure?.some((contract) => contract.domain === domain));
        const hasResidue = hasChoiceResidue(choice) || RESIDUE_RE.test(text);
        if (!hasPressure && !hasResidue) {
          issues.push({
            severity: treatmentScene ? 'error' : 'warning',
            location: `${loc}:${choice?.id ?? refConsequence.beat?.id ?? consequence.type}`,
            message: `Meaningful ${consequence.type} consequence has no narrative pressure contract or visible residue.`,
            suggestion: 'Attach mechanicPressure and show the fictional evidence/residue that makes the state change meaningful.',
          });
        }

        const magnitude = consequenceMagnitude(consequence);
        const contractCap = [...contracts, ...(choice?.mechanicPressure ?? [])]
          .filter((contract) => contract.domain === domain)
          .map((contract) => contract.maxMagnitudeThisScene)
          .find((value): value is number => typeof value === 'number' && value > 0);
        const max = contractCap ?? (domain === 'relationship' ? RELATIONSHIP_LARGE_MAGNITUDE : LARGE_MAGNITUDE);
        if (magnitude !== undefined && magnitude > max && !MAJOR_EVIDENCE_RE.test(text)) {
          issues.push({
            severity: 'error',
            location: `${loc}:${choice?.id ?? consequence.type}`,
            message: `${consequence.type} consequence magnitude ${magnitude} is too large for the visible evidence in scene "${ref.scene.id}".`,
            suggestion: 'Reduce the magnitude or stage a major rescue, sacrifice, confession, betrayal, public cost, risk, discovery, or repeated practice.',
          });
        }

        planted.add(keyForConsequence(consequence));
        plantedDomains.add(domain);
      }

      for (const { choice, condition } of choiceConditions(ref.scene)) {
        walkCondition(condition, (raw) => {
          const domain = conditionDomain(raw);
          if (!domain) return;
          const key = keyForCondition(domain, raw);
          const supportedByContract = contracts.some((contract) => contract.domain === domain && (keyForContract(contract) === key || keyForContract(contract).endsWith(':*')));
          if (!planted.has(key) && !plantedDomains.has(domain) && !supportedByContract) {
            issues.push({
              severity: 'error',
              location: `${loc}:${choice.id}:condition`,
              message: `Choice "${choice.id}" gates on ${domain} pressure that was never planted or made reachable.`,
              suggestion: 'Plant the pressure in an earlier scene/choice, lower or move the gate, or rewrite the option as fail-forward rather than locked.',
            });
          } else {
            spentContracts.add(key);
          }
        });
      }

      for (const contract of contracts) {
        const key = keyForContract(contract);
        if (
          (contract.function === 'plant' || contract.function === 'intensify')
          && contract.source === 'treatment'
          && !spentContracts.has(key)
          && !RESIDUE_RE.test(text)
        ) {
          issues.push({
            severity: 'error',
            location: `${loc}:${contract.id}`,
            message: `Treatment-authored ${contract.domain} pressure "${contract.storyPressure}" is planted but has no visible payoff, callback, gate, or residue in the final story slice.`,
            suggestion: 'Add a later callback/variant/choice/route payoff, or show residue strongly enough that the mechanic is not dead state.',
          });
        }
      }
    }

    return {
      valid: !issues.some((issue) => issue.severity === 'error'),
      score: issues.length === 0 ? 100 : Math.max(0, 100 - issues.length * 12),
      issues,
      suggestions: issues.map((issue) => issue.suggestion).filter((value): value is string => Boolean(value)),
    };
  }
}
