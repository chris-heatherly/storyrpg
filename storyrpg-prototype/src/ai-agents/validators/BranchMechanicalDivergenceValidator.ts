import type { Choice, Consequence, Scene } from '../../types';
import { BaseValidator, type ValidationIssue, type ValidationResult } from './BaseValidator';
import type { BranchConsequenceRealizationContract } from '../../types/scenePlan';
import { treatmentFieldCloseMatch } from '../utils/treatmentFieldContracts';

export interface BranchMechanicalScene extends Pick<Scene, 'id' | 'name' | 'beats' | 'leadsTo' | 'branchConsequenceContracts'> {}

export interface BranchMechanicalDivergenceInput {
  scenes: BranchMechanicalScene[];
}

export interface BranchMechanicalDivergenceResult extends ValidationResult {
  metrics: {
    branchChoices: number;
    branchesWithResidue: number;
    branchesWithoutResidue: number;
  };
}

export class BranchMechanicalDivergenceValidator extends BaseValidator {
  constructor() {
    super('BranchMechanicalDivergenceValidator');
  }

  validate(input: BranchMechanicalDivergenceInput): BranchMechanicalDivergenceResult {
    const issues: ValidationIssue[] = [];
    let branchChoices = 0;
    let branchesWithResidue = 0;
    let branchesWithoutResidue = 0;

    for (const scene of input.scenes) {
      const choices = scene.beats.flatMap((beat) =>
        (beat.choices ?? []).map((choice) => ({ choice, beatId: beat.id }))
      );
      // D3: a scene whose leadsTo forks to >1 onward target IS a routing branch even
      // when its choices carry no per-choice nextSceneId (they route via a flag). Such
      // choices were invisible to isBranchingChoice → branchChoices stuck at 0.
      const routingFork = new Set(
        (scene.leadsTo ?? []).filter((t) => t && !t.startsWith('episode-')),
      ).size > 1;
      const branching = choices.filter(({ choice }) => isBranchingChoice(choice) || routingFork);
      if (branching.length === 0) continue;

      for (const { choice, beatId } of branching) {
        branchChoices++;
        const residue = collectResidue(choice);
        if (residue.size > 0) {
          branchesWithResidue++;
          const authoredContracts = scene.branchConsequenceContracts ?? [];
          if (authoredContracts.length > 0 && !choiceResidueMatchesAuthoredBranch(choice, authoredContracts)) {
            issues.push(this.warning(
              `Branch choice "${choice.id}" has residue, but it does not match the authored branch pressure assigned to scene "${scene.id}".`,
              `${scene.id}:${beatId}:${choice.id}`,
              'Align the choice consequences, residue hints, route flags, or reminder plan with the authored branch origin/path/payoff/residue contract.',
            ));
          }
        } else {
          branchesWithoutResidue++;
          issues.push(this.warning(
            `Branch choice "${choice.id}" reconverges with no obvious mechanical residue.`,
            `${scene.id}:${beatId}:${choice.id}`,
            'Add a flag, relationship shift, item, tag, delayed consequence, callback, prepared modifier, passive insight hook, or altered route access.',
          ));
        }
      }

      if (branching.length > 1) {
        const signatures = branching.map(({ choice }) => signatureFor(choice));
        const unique = new Set(signatures);
        if (unique.size === 1) {
          issues.push(this.warning(
            `Scene "${scene.name ?? scene.id}" has multiple branch choices with identical mechanical residue.`,
            `scene:${scene.id}`,
            'Give each branch a distinct future state, callback, relationship posture, clue, cost, or modifier.',
          ));
        }
      }
    }

    const warnings = issues.filter((issue) => issue.severity === 'warning').length;
    return {
      valid: true,
      score: Math.max(0, 100 - warnings * 8),
      issues,
      suggestions: issues.map((issue) => issue.suggestion).filter((value): value is string => Boolean(value)),
      metrics: { branchChoices, branchesWithResidue, branchesWithoutResidue },
    };
  }
}

function choiceResidueMatchesAuthoredBranch(choice: Choice, contracts: BranchConsequenceRealizationContract[]): boolean {
  const text = [
    choice.text,
    choice.lockedText,
    choice.reactionText,
    choice.visualResidueHint,
    choice.tintFlag,
    choice.feedbackCue?.echoSummary,
    choice.feedbackCue?.progressSummary,
    choice.reminderPlan?.immediate,
    choice.reminderPlan?.shortTerm,
    choice.reminderPlan?.later,
    ...(choice.residueHints ?? []).map((hint) => hint.description),
    ...(choice.consequences ?? []).map((consequence) => JSON.stringify(consequence)),
    ...(choice.delayedConsequences ?? []).map((delayed) => `${delayed.description} ${JSON.stringify(delayed.consequence)}`),
  ].filter(Boolean).join(' ');
  return contracts.some((contract) =>
    treatmentFieldCloseMatch(contract.sourceText, text, 0.2)
    || contract.stateDomains.some((domain) => new RegExp(`\\b${domain}\\b`, 'i').test(text))
  );
}

function isBranchingChoice(choice: Choice): boolean {
  return Boolean(
    choice.nextSceneId
      || choice.choiceIntent === 'branching'
      || choice.consequenceTier === 'branchlet'
      || choice.consequenceTier === 'structuralBranch'
  );
}

function signatureFor(choice: Choice): string {
  return [...collectResidue(choice)].sort().join('|');
}

function collectResidue(choice: Choice): Set<string> {
  const residue = new Set<string>();
  for (const consequence of choice.consequences ?? []) {
    addConsequenceResidue(residue, consequence);
  }
  for (const delayed of choice.delayedConsequences ?? []) {
    residue.add(`delayed:${delayed.description || delayed.consequence.type}`);
    addConsequenceResidue(residue, delayed.consequence);
  }
  for (const modifier of choice.statCheck?.modifiers ?? []) {
    residue.add(`modifier:${modifier.id}`);
  }
  for (const hint of choice.residueHints ?? []) {
    residue.add(`hint:${hint.kind}:${hint.callbackHookId ?? hint.targetEpisode ?? hint.targetNpcId ?? hint.description}`);
  }
  if (choice.memorableMoment?.id) residue.add(`memorable:${choice.memorableMoment.id}`);
  if (choice.failureResidue?.kind) residue.add(`failure:${choice.failureResidue.kind}`);
  if (choice.tintFlag) residue.add(`tint:${choice.tintFlag}`);
  if (choice.nextSceneId) residue.add(`route:${choice.nextSceneId}`);
  if (choice.nextBeatId) residue.add(`beat:${choice.nextBeatId}`);
  return residue;
}

function addConsequenceResidue(residue: Set<string>, consequence: Consequence): void {
  switch (consequence.type) {
    case 'setFlag':
      residue.add(`flag:${consequence.flag}:${String(consequence.value)}`);
      break;
    case 'relationship':
      residue.add(`relationship:${consequence.npcId}:${(consequence as any).dimension ?? (consequence as any).relationshipType ?? (consequence as any).aspect}:${consequence.change}`);
      break;
    case 'attribute':
      residue.add(`attribute:${consequence.attribute}:${consequence.change}`);
      break;
    case 'skill':
      residue.add(`skill:${consequence.skill}:${consequence.change}`);
      break;
    case 'addItem':
      residue.add(`item:${(consequence as any).item?.id ?? (consequence as any).item?.name ?? (consequence as any).itemId ?? 'unknown'}`);
      break;
    case 'addTag':
      residue.add(`tag:${consequence.tag}`);
      break;
    case 'changeScore':
      residue.add(`score:${(consequence as any).name ?? (consequence as any).score}:${consequence.change}`);
      break;
    default:
      residue.add(`consequence:${consequence.type}`);
      break;
  }
}
