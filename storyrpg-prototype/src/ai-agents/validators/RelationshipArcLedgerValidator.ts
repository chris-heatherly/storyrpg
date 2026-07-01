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

const HIGH_STAGE_LABEL_RE = /\b(?:friends?|friendship|best\s+friend|trusted\s+ally|trusts?\s+(?:you|her|him|them)\s+completely|intimate|inner\s+circle|one\s+of\s+us|family|soulmate)\b/ig;
const PRIVATE_ACCESS_RE = /\b(?:text(?:ed|s|ing)?|message(?:d|s|ing)?|dm(?:ed|s|ing)?|call(?:ed|s|ing)?|phone(?:s|d)?|number|contact|reply|replies|buzz(?:es|ed)?)\b/i;
const GROUP_IDENTITY_RE = new RegExp([
  String.raw`\b(?:crew|circle|group|[A-Z][A-Za-z0-9'’ -]{1,60}\s+club)\b[^.!?\n]{0,140}\b(?:complete|official|real|inside|belong(?:s|ed|ing)?|one\s+of\s+us|friends?|members?|membership|settled|permanent|unbreakable)\b`,
  String.raw`\b(?:is|are|becomes?|became)\s+(?:complete|official|real|inside|friends?|members?|settled|permanent|unbreakable)\b[^.!?\n]{0,80}\b(?:crew|circle|group|[A-Z][A-Za-z0-9'’ -]{1,60}\s+club)\b`,
  String.raw`\b(?:club|crew|circle|group)\b[^.!?\n]{0,80}\b(?:is|are|becomes?|became)\s+(?:complete|official|real|inside|friends?|members?|settled|permanent|unbreakable)\b`,
].join('|'), 'i');
const PROVISIONAL_GROUP_CONTEXT_RE = /\b(?:joke|dare|fragile|provisional|not\s+official|not\s+real\s+yet|invitation|almost|maybe|promise|becoming|could\s+become|whatever\s+(?:this|it)\s+becomes)\b/i;
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

function sentenceWindows(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function hasSettledGroupLanguage(text: string): boolean {
  return sentenceWindows(text).some((window) =>
    GROUP_IDENTITY_RE.test(window) && !PROVISIONAL_GROUP_CONTEXT_RE.test(window)
  );
}

function isFamilyRelationshipClaim(text: string, index: number): boolean {
  const start = Math.max(0, index - 56);
  const end = Math.min(text.length, index + 80);
  const window = text.slice(start, end).toLowerCase();
  return /\b(?:like|as|found|chosen|feels?\s+like)\s+family\b/.test(window)
    || /\bfamily\s+(?:now|already|forever|by choice|for tonight)\b/.test(window)
    || /\b(?:part|member)\s+of\s+(?:the|our|their|your|his|her)\s+family\b/.test(window);
}

function hasHighStageRelationshipLabel(text: string): boolean {
  HIGH_STAGE_LABEL_RE.lastIndex = 0;
  for (const match of text.matchAll(HIGH_STAGE_LABEL_RE)) {
    if (match[0].toLowerCase() === 'family' && !isFamilyRelationshipClaim(text, match.index ?? 0)) {
      continue;
    }
    return true;
  }
  return false;
}

function effectiveTargetStage(contract: RelationshipPacingContract, entry: RelationshipArcLedgerEntry): RelationshipPacingStage {
  if (contract.groupId) {
    if (entry.relationshipChoiceSceneIds.length === 0) return 'spark';
    if (stageRank(contract.startStage) <= stageRank('spark') && stageRank(contract.targetStage) > stageRank('acquaintance')) {
      return 'acquaintance';
    }
  } else if (stageRank(contract.startStage) <= stageRank('unmet') && stageRank(contract.targetStage) > stageRank('spark')) {
    return 'spark';
  }
  return contract.targetStage;
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

        const targetStage = effectiveTargetStage(contract, entry);

        if (stageRank(targetStage) > stageRank(entry.currentStage)) {
          pushIssue(this.error(
            `Scene "${ref.scene.id}" targets ${targetStage} for ${contract.npcId ?? contract.groupId}, but the deterministic relationship ledger only permits ${entry.currentStage}.`,
            loc,
            'Lower the scene target stage or add prior full scenes, relationship choices, stat movement, and evidence tags that earn the higher stage.',
          ), `contract:target:${ref.episodeNumber}:${ref.scene.id}:${key}:${targetStage}:${entry.currentStage}`);
        }

        if (stageRank(targetStage) > stageRank('acquaintance') && entry.relationshipChoiceSceneIds.length === 0) {
          pushIssue(this.error(
            `Scene "${ref.scene.id}" advances ${contract.npcId ?? contract.groupId} beyond acquaintance before any player relationship choice targets them.`,
            loc,
            'Insert a relationship choice before claiming ally/friend/trusted/intimate movement.',
          ), `contract:choice:${ref.episodeNumber}:${ref.scene.id}:${key}:${targetStage}`);
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

      if (hasHighStageRelationshipLabel(text)) {
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

      if (hasSettledGroupLanguage(text)) {
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
