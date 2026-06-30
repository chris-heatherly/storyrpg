import type { Choice, Story } from '../../types';
import type { RelationshipPacingContract, RelationshipPacingStage, SeasonScenePlan } from '../../types/scenePlan';
import {
  buildRelationshipArcLedger,
  collectRelationshipScenes,
  relationshipConsequencesForScene,
  relationshipSubjectKey,
  sceneVisibleText,
  stageRank,
  type RelationshipArcLedgerEntry,
} from '../utils/relationshipArcLedger';
import { BaseValidator, type ValidationIssue, type ValidationResult } from './BaseValidator';

export interface RelationshipArcLedgerInput {
  story: Story;
  scenePlan?: SeasonScenePlan;
  treatmentSourced?: boolean;
}

const HIGH_STAGE_LABEL_RE = /\b(?:friends?|friendship|best\s+friend|trusted\s+ally|trusts?\s+(?:you|her|him|them)\s+completely|intimate|inner\s+circle|one\s+of\s+us|family|soulmate)\b/i;
const PRIVATE_ACCESS_RE = /\b(?:text(?:ed|s|ing)?|message(?:d|s|ing)?|dm(?:ed|s|ing)?|call(?:ed|s|ing)?|phone(?:s|d)?|number|contact|reply|replies|buzz(?:es|ed)?)\b/i;
const GROUP_IDENTITY_RE = /\b(?:dusk\s+club|club|crew|circle|group)\b[^.!?]{0,180}\b(?:is|are|becomes?|complete|official|real|inside|belong|one\s+of\s+us|friends?)\b/i;
const VISIBLE_CALLBACK_RE = /\b(?:remember|remembers|remembered|last\s+time|because\s+you|after\s+what\s+you|the\s+promise|the\s+warning|the\s+favor|what\s+happened|again|still)\b/i;

function contractSubjectKey(contract: RelationshipPacingContract): string | undefined {
  if (contract.npcId) return `npc:${slug(contract.npcId)}`;
  if (contract.groupId) return `group:${slug(contract.groupId)}`;
  return undefined;
}

function slug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function choiceHasRelationshipMovement(choice: Choice, npcId?: string): boolean {
  return (choice.consequences ?? []).some((consequence) =>
    consequence.type === 'relationship' && (!npcId || slug(consequence.npcId) === slug(npcId))
  ) || (choice.relationshipValueEvidence ?? []).some((evidence) => !npcId || slug(evidence.npcId) === slug(npcId));
}

function positiveCore(entry: RelationshipArcLedgerEntry): number {
  return entry.deltasByDimension.trust.positive
    + entry.deltasByDimension.affection.positive
    + entry.deltasByDimension.respect.positive;
}

function hasMajorPositiveEvidence(entry: RelationshipArcLedgerEntry): boolean {
  return entry.evidenceTags.some((tag) =>
    tag === 'sacrificed_without_control'
    || tag === 'repaired_harm'
    || tag === 'protected_player'
    || tag === 'respected_agency'
  );
}

export class RelationshipArcLedgerValidator extends BaseValidator {
  constructor() {
    super('RelationshipArcLedgerValidator');
  }

  validate(input: RelationshipArcLedgerInput): ValidationResult {
    const issues: ValidationIssue[] = [];
    const seenIssues = new Set<string>();
    const pushIssue = (issue: ValidationIssue, fingerprint?: string): void => {
      const key = fingerprint ?? `${issue.severity}:${issue.location ?? ''}:${issue.message}`;
      if (seenIssues.has(key)) return;
      seenIssues.add(key);
      issues.push(issue);
    };
    const ledger = buildRelationshipArcLedger(input.story, input.scenePlan);

    for (const entry of ledger.entries) {
      if (entry.subject.subjectType === 'npc') {
        if (stageRank(entry.currentStage) >= stageRank('tentative_ally') && entry.relationshipChoiceSceneIds.length === 0) {
          pushIssue(this.error(
            `Relationship with "${entry.subject.subjectId}" reaches ${entry.currentStage} without a player relationship choice.`,
            `relationshipArc:${relationshipSubjectKey(entry.subject)}`,
            'Add a prior relationship choice with relationship consequences/evidence, or keep the bond at spark/acquaintance.',
          ), `entry:npc-choice:${relationshipSubjectKey(entry.subject)}:${entry.currentStage}`);
        }
        if (stageRank(entry.currentStage) >= stageRank('friend') && !hasMajorPositiveEvidence(entry)) {
          pushIssue(this.error(
            `Relationship with "${entry.subject.subjectId}" reaches ${entry.currentStage} without major positive relationship evidence.`,
            `relationshipArc:${relationshipSubjectKey(entry.subject)}`,
            'Require mutual aid, agency-respecting protection, sacrifice, repaired harm, or a visible callback before friend/trusted/intimate labels.',
          ), `entry:npc-evidence:${relationshipSubjectKey(entry.subject)}:${entry.currentStage}`);
        }
      }
      if (entry.subject.subjectType === 'group' && stageRank(entry.currentStage) > stageRank('spark') && entry.relationshipChoiceSceneIds.length === 0) {
        pushIssue(this.error(
          `Group relationship "${entry.subject.subjectId}" advances past provisional spark without a group-defining player choice.`,
          `relationshipArc:${relationshipSubjectKey(entry.subject)}`,
          'Keep the group as a joke, dare, or invitation until a choice or repeated relationship evidence earns membership.',
        ), `entry:group-choice:${relationshipSubjectKey(entry.subject)}:${entry.currentStage}`);
      }
    }

    for (const ref of collectRelationshipScenes(input.story, input.scenePlan)) {
      const text = sceneVisibleText(ref.scene);
      const contracts = [...(ref.planned?.relationshipPacing ?? []), ...(ref.scene.relationshipPacing ?? [])];

      for (const contract of contracts) {
        const key = contractSubjectKey(contract);
        const entry = key ? ledger.byKey.get(key) : undefined;
        const loc = `relationshipArc:ep${ref.episodeNumber}:${ref.scene.id}:${contract.id}`;
        if (!entry) continue;

        if (stageRank(contract.targetStage) > stageRank(entry.currentStage)) {
          pushIssue(this.error(
            `Scene "${ref.scene.id}" targets ${contract.targetStage} for ${contract.npcId ?? contract.groupId}, but the deterministic relationship ledger only permits ${entry.currentStage}.`,
            loc,
            'Lower the scene target stage or add prior full scenes, relationship choices, stat movement, and evidence tags that earn the higher stage.',
          ), `contract:target:${ref.episodeNumber}:${ref.scene.id}:${key}:${contract.targetStage}:${entry.currentStage}`);
        }

        if (stageRank(contract.targetStage) > stageRank('acquaintance') && entry.relationshipChoiceSceneIds.length === 0) {
          pushIssue(this.error(
            `Scene "${ref.scene.id}" advances ${contract.npcId ?? contract.groupId} beyond acquaintance before any player relationship choice targets them.`,
            loc,
            'Insert a relationship choice before claiming ally/friend/trusted/intimate movement.',
          ), `contract:choice:${ref.episodeNumber}:${ref.scene.id}:${key}:${contract.targetStage}`);
        }

        const consequences = relationshipConsequencesForScene(ref.scene).filter(({ consequence }) =>
          consequence.type === 'relationship' && (!contract.npcId || slug(consequence.npcId) === slug(contract.npcId))
        );
        for (const { consequence } of consequences) {
          if (consequence.type !== 'relationship') continue;
          const delta = Number(consequence.change ?? 0);
          const cap = Math.abs(contract.maxDeltaThisScene || 0);
          if (cap > 0 && Math.abs(delta) > cap && !hasMajorPositiveEvidence(entry)) {
            pushIssue(this.error(
              `Scene "${ref.scene.id}" changes ${consequence.npcId}.${consequence.dimension} by ${delta}, above the ledger cap ${cap} without major evidence.`,
              loc,
              'Reduce the relationship delta or add a genuine on-page sacrifice, repair, agency-respecting protection, or mutual-aid choice.',
            ), `contract:delta:${ref.episodeNumber}:${ref.scene.id}:${key}:${consequence.npcId}:${consequence.dimension}:${delta}:${cap}`);
          }
        }

        if (contract.npcId && !entry.privateContactEarned && PRIVATE_ACCESS_RE.test(text)) {
          pushIssue(this.error(
            `Scene "${ref.scene.id}" gives ${contract.npcId} private contact access before the ledger has earned a contact exchange.`,
            loc,
            'Show the introduction and contact exchange on-page before texting/calling/DMs/replies become available.',
          ), `contract:private-contact:${ref.episodeNumber}:${ref.scene.id}:${key}`);
        }
      }

      if (HIGH_STAGE_LABEL_RE.test(text)) {
        for (const contract of contracts) {
          const key = contractSubjectKey(contract);
          const entry = key ? ledger.byKey.get(key) : undefined;
          if (!entry) continue;
          if (stageRank(entry.currentStage) < stageRank('friend')) {
            pushIssue(this.error(
              `Scene "${ref.scene.id}" uses friend/trusted/intimate relationship language before "${contract.npcId ?? contract.groupId}" is ledger-earned past ${entry.currentStage}.`,
              `relationshipArc:ep${ref.episodeNumber}:${ref.scene.id}:${relationshipSubjectKey(entry.subject)}:label`,
              'Rewrite the language as spark, guarded warmth, invitation, or testing until relationship choices and evidence earn a stronger label.',
            ), `label:high-stage:${ref.episodeNumber}:${ref.scene.id}:${relationshipSubjectKey(entry.subject)}:${entry.currentStage}`);
          } else if (!VISIBLE_CALLBACK_RE.test(text) && stageRank(entry.currentStage) >= stageRank('friend') && positiveCore(entry) < 12) {
            pushIssue(this.warning(
              `Scene "${ref.scene.id}" claims an earned bond for "${contract.npcId ?? contract.groupId}" without visible callback/payoff language.`,
              `relationshipArc:ep${ref.episodeNumber}:${ref.scene.id}:${relationshipSubjectKey(entry.subject)}:payoff`,
              'Show the remembered choice, favor, warning, repair, or cost that makes the bond feel earned.',
            ), `label:payoff:${ref.episodeNumber}:${ref.scene.id}:${relationshipSubjectKey(entry.subject)}`);
          }
        }
      }

      if (GROUP_IDENTITY_RE.test(text)) {
        const groupEntries = ledger.entries.filter((entry) => entry.subject.subjectType === 'group');
        for (const entry of groupEntries) {
          if (stageRank(entry.currentStage) <= stageRank('spark')) {
            pushIssue(this.error(
              `Scene "${ref.scene.id}" treats group "${entry.subject.subjectId}" as settled membership while the ledger only permits a provisional spark.`,
              `relationshipArc:ep${ref.episodeNumber}:${ref.scene.id}:${relationshipSubjectKey(entry.subject)}:group`,
              'Keep the group name as a joke, dare, or fragile invitation until individual relationships and a group-defining choice earn membership.',
            ), `group:settled:${ref.episodeNumber}:${ref.scene.id}:${relationshipSubjectKey(entry.subject)}:${entry.currentStage}`);
          }
        }
      }

      for (const beat of ref.scene.beats ?? []) {
        for (const choice of beat.choices ?? []) {
          if (choice.choiceType !== 'relationship') continue;
          if (!choiceHasRelationshipMovement(choice)) {
            pushIssue(this.error(
              `Relationship choice "${choice.id}" in scene "${ref.scene.id}" has no relationship stat movement or thematic-square evidence.`,
              `relationshipArc:ep${ref.episodeNumber}:${ref.scene.id}:${beat.id}:${choice.id}`,
              'Relationship choices must emit a relationship consequence and, when claiming dramatic meaning, relationshipValueEvidence.',
            ), `choice:missing-movement:${ref.episodeNumber}:${ref.scene.id}:${beat.id}:${choice.id}`);
          }
        }
      }
    }

    const errors = issues.filter((issue) => issue.severity === 'error').length;
    const warnings = issues.filter((issue) => issue.severity === 'warning').length;
    return {
      valid: errors === 0,
      score: issues.length === 0 ? 100 : Math.max(0, 100 - errors * 15 - warnings * 5),
      issues,
      suggestions: issues.map((issue) => issue.suggestion).filter((value): value is string => Boolean(value)),
    };
  }
}
