import type { Beat, Choice, ConditionExpression, Consequence, Story } from '../../types';
import type { RelationshipPacingContract, RelationshipPacingStage, SeasonScenePlan } from '../../types/scenePlan';
import {
  beatVisibleText,
  buildNpcAliases,
  buildRelationshipArcLedger,
  canonicalNpcId,
  collectRelationshipScenes,
  displayAliasesForNpc,
  isFamilyRelationshipClaim,
  relationshipConsequencesForScene,
  relationshipSubjectKey,
  sceneVisibleText,
  stageRank,
  type RelationshipArcLedgerEntry,
} from '../utils/relationshipArcLedger';
import { getStoryLexicon } from '../config/storyLexicon';
import { BaseValidator, type ValidationIssue, type ValidationResult } from './BaseValidator';

export interface RelationshipArcLedgerInput {
  story: Story;
  scenePlan?: SeasonScenePlan;
  treatmentSourced?: boolean;
}

const HIGH_STAGE_LABEL_RE = /\b(?:friends?|friendship|best\s+friend|trusted\s+ally|trusts?\s+(?:you|her|him|them)\s+completely|intimate|inner\s+circle|one\s+of\s+us|family|soulmate)\b/ig;
// Negated / not-yet claims ("not friends yet", "could become family") are pacing-correct
// prose, not stage claims (ported from RelationshipPacingValidator in the merge).
// The optional determiner/possessive between the negation and the label keeps
// "We're not your friends" / "never her friend" negated (bite-me 2026-07-04:
// the ambusher's cold "We're not your friends" blocked the ep1 seal as an
// unearned friendship CLAIM — it is the opposite).
const NEGATED_WINDOW_RE = /\b(?:not|not yet|no|never|almost|maybe|trying to become|could become|might become)\s+(?:(?:a|an|the|your|my|our|his|her|their)\s+)?$/i;
// New-relationship prose narrated as years of established comfort (merge: was
// RelationshipPacingValidator's compressed-familiarity check; now gated on the
// deterministic ledger stage instead of the contract target).
const COMPRESSED_FAMILIARITY_RE = /\b(?:only|just)\s+been\s+(?:\w+\s+){0,3}(?:hours?|days?|nights?|weeks?)\b[^.!?]{0,220}\b(?:comfortable\s+habit\s+of\s+years|known\s+(?:her|him|them|each\s+other)\s+for\s+years|known\s+(?:her|him|them|each\s+other)\s+forever|feels?\s+like\s+(?:years|home|family)|old\s+friend|every\s+easy\s+gesture|refills?\s+your\s+(?:wine|glass)|watches?\s+over\s+the\s+rim|what\s+you\s+do\s+with\s+kindness|let\s+yourself\s+belong|belonging)\b/i;
// Settled-word class includes the numeral/possessive forms the deleted
// RelationshipPacingValidator's SETTLED_GROUP_RE covered ("the Dusk Club is
// now three", "the club is theirs") — ported at its deletion (2026-07-03).
// NOTE: do not treat bare "real" as membership — venue prose
// ("Valescu Club … is real") false-positive'd as settled membership
// (bite-me 2026-07-08T00-01-23). Keep "real" only as "real member(s)".
const GROUP_SETTLED_WORDS = String.raw`(?:now\s+)?(?:complete|official|inside|friends?|members?|settled|permanent|unbreakable|three|family|theirs?|real\s+members?)`;
const GROUP_IDENTITY_RE = new RegExp([
  String.raw`\b(?:crew|circle|group|[A-Z][A-Za-z0-9'’ -]{1,60}\s+club)\b[^.!?\n]{0,140}\b(?:belong(?:s|ed|ing)?|one\s+of\s+us|membership|(?:is|are|becomes?|became)\s+${GROUP_SETTLED_WORDS})\b`,
  String.raw`\b(?:is|are|becomes?|became)\s+${GROUP_SETTLED_WORDS}\b[^.!?\n]{0,80}\b(?:crew|circle|group|[A-Z][A-Za-z0-9'’ -]{1,60}\s+club)\b`,
  String.raw`\b(?:club|crew|circle|group)\b[^.!?\n]{0,80}\b(?:is|are|becomes?|became)\s+${GROUP_SETTLED_WORDS}\b`,
  // Explicit identity claims ("We are the Dusk Club.") remain settled regardless of adjective set.
  String.raw`\b(?:we|they|you)\s+(?:are|become|became)\s+(?:the\s+)?[A-Z][A-Za-z0-9'’ -]{1,60}\s+club\b`,
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
  return sentenceWindows(text).some((window) => {
    if (isVenueClubSentence(window)) return false;
    return GROUP_IDENTITY_RE.test(window) && !PROVISIONAL_GROUP_CONTEXT_RE.test(window);
  });
}

/** Named nightlife venues ("Valescu Club") are locations, not social groups. */
function isVenueClubSentence(window: string): boolean {
  const hay = window.toLowerCase();
  const venues = getStoryLexicon().namedVenues;
  if (venues.some((venue) => hay.includes(venue.toLowerCase()) && /\bclub\b/i.test(window))) {
    // Still treat explicit membership identity against a venue club as settled.
    if (/\b(?:we|they|you)\s+(?:are|become|became)\s+(?:the\s+)?/i.test(window) && /\bclub\b/i.test(window)) {
      return false;
    }
    if (/\b(?:belong|membership|member|one\s+of\s+us|friends?\s+now|now\s+three)\b/i.test(window)) {
      return false;
    }
    return true;
  }
  return false;
}

// A Titlecase-named group inside a settled-language sentence ("The Dusk Club
// is now three"). Requiring the proper name keeps generic venue prose ("the
// club is theirs tonight") from flagging as an unplanned group.
const NAMED_GROUP_RE = /\b([A-Z][A-Za-z0-9'’-]+(?:\s+[A-Z][A-Za-z0-9'’-]+){0,3}\s+(?:Club|Circle|Crew|Society))\b/;

function unplannedSettledGroupName(text: string): string | undefined {
  for (const window of sentenceWindows(text)) {
    if (isVenueClubSentence(window)) continue;
    if (!GROUP_IDENTITY_RE.test(window) || PROVISIONAL_GROUP_CONTEXT_RE.test(window)) continue;
    const named = NAMED_GROUP_RE.exec(window);
    if (named) return named[1];
  }
  return undefined;
}

function isNegated(text: string, index: number): boolean {
  const prefix = text.slice(Math.max(0, index - 40), index);
  return NEGATED_WINDOW_RE.test(prefix);
}

// "Intimate" as a felt quality ("feels strangely intimate", "almost intimate")
// is spark-register perception of a moment, not a claimed relationship stage.
const SENSATION_INTIMATE_PREFIX_RE = /\b(?:feels?|felt|seem(?:s|ed)?|strangely|oddly|almost|weirdly|unsettlingly|uncomfortably|disturbingly|unnervingly)\s+(?:\w+\s+)?$/i;

function isSensationIntimate(text: string, index: number): boolean {
  const prefix = text.slice(Math.max(0, index - 40), index);
  return SENSATION_INTIMATE_PREFIX_RE.test(prefix);
}

// "His friend" / "their friends" is a third-party descriptor of NPCs' own
// relationships, not a claim about the protagonist's bond. In second-person
// prose the protagonist is "you", so player-side claims read "your friend" /
// "we're friends" and still fire. (bite-me 2026-07-04: the Cismigiu ambush —
// "stumbling back into his friend", one attacker glancing at the other —
// blocked the ep1 seal as unearned dusk-club friendship.)
const THIRD_PARTY_POSSESSIVE_PREFIX_RE = /\b(?:his|her|their)\s+(?:\w+\s+)?$/i;

function isThirdPartyFriendLabel(matchText: string, text: string, index: number): boolean {
  if (!/^friend/i.test(matchText)) return false;
  const prefix = text.slice(Math.max(0, index - 40), index);
  return THIRD_PARTY_POSSESSIVE_PREFIX_RE.test(prefix);
}

function hasHighStageRelationshipLabel(text: string): boolean {
  HIGH_STAGE_LABEL_RE.lastIndex = 0;
  for (const match of text.matchAll(HIGH_STAGE_LABEL_RE)) {
    if (isNegated(text, match.index ?? 0)) continue;
    if (match[0].toLowerCase() === 'family' && !isFamilyRelationshipClaim(text, match.index ?? 0)) {
      continue;
    }
    if (match[0].toLowerCase() === 'intimate' && isSensationIntimate(text, match.index ?? 0)) {
      continue;
    }
    if (isThirdPartyFriendLabel(match[0], text, match.index ?? 0)) continue;
    return true;
  }
  return false;
}

const HIGH_STAGE_LABEL_SINGLE_RE = new RegExp(HIGH_STAGE_LABEL_RE.source, 'i');

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * "Make it official" / "call ourselves …" is a provisional naming proposal, not
 * settled membership. Bare blocked-label "official" must not abort christening
 * choices that the repair handler and spark allowed-labels already treat as
 * invitation/dare language (bite-me 2026-07-08 s1-5).
 */
function isProvisionalOfficialNaming(text: string, matchIndex: number): boolean {
  const start = Math.max(0, matchIndex - 48);
  const end = Math.min(text.length, matchIndex + 72);
  const window = text.slice(start, end);
  if (/\bmake(?:s|ing)?\s+(?:it|this|ourselves)\s+official\b/i.test(window)) return true;
  if (/\bmade\s+(?:it|this)\s+official\b/i.test(window)) return true;
  if (/\bcall(?:s|ing|ed)?\s+(?:ourselves|it|this|the\s+group)\b/i.test(window)) return true;
  if (PROVISIONAL_GROUP_CONTEXT_RE.test(window)) return true;
  return false;
}

/**
 * Contract-authored blocked labels beyond the generic high-stage vocabulary
 * (merge: ported from RelationshipPacingValidator). Generic labels stay the
 * ledger label check's job; this only catches custom contract terms.
 */
function customBlockedLabelHits(text: string, contract: RelationshipPacingContract): string[] {
  const hits: string[] = [];
  for (const label of contract.blockedLabels ?? []) {
    if (!label || label.length < 3) continue;
    if (HIGH_STAGE_LABEL_SINGLE_RE.test(label)) continue;
    const source = label.toLowerCase() === 'friend' ? `${escaped(label)}(?:ship|s)?` : escaped(label);
    const re = new RegExp(`\\b${source}\\b`, 'ig');
    for (const match of text.matchAll(re)) {
      if (isNegated(text, match.index ?? 0)) continue;
      if (label.toLowerCase() === 'family' && !isFamilyRelationshipClaim(text, match.index ?? 0)) continue;
      if (label.toLowerCase() === 'official' && isProvisionalOfficialNaming(text, match.index ?? 0)) continue;
      hits.push(label);
      break;
    }
  }
  return Array.from(new Set(hits));
}

function aliasPattern(aliases: string[]): string | undefined {
  if (aliases.length === 0) return undefined;
  return aliases.map(escaped).join('|');
}

function hasDirectContactAccess(text: string, aliases: string[]): boolean {
  const alias = aliasPattern(aliases);
  if (!alias) return false;
  return new RegExp(`\\b(?:text(?:ed|s|ing)?|message(?:d|s|ing)?|dm(?:ed|s|ing)?|call(?:ed|s|ing)?|phone(?:s|d)?|reply|replies|buzz(?:es|ed)?|number|contact)\\b[^.!?]{0,120}\\b(?:${alias})\\b`, 'i').test(text)
    || new RegExp(`\\b(?:${alias})\\b[^.!?]{0,120}\\b(?:text(?:ed|s|ing)?|message(?:d|s|ing)?|dm(?:ed|s|ing)?|call(?:ed|s|ing)?\\s+(?:from|back|on\\s+the\\s+phone|your\\s+phone)|phone(?:s|d)?|repl(?:y|ies)|send(?:s|ing)?|sent|buzz(?:es|ed)?|knows a place|adds?\\b[^.!?]{0,32}\\bemoji)\\b`, 'i').test(text);
}

function hasOnPageIntroductionEvidence(text: string, aliases: string[]): boolean {
  const alias = aliasPattern(aliases);
  if (!alias) return false;
  return new RegExp(`\\b(?:meet|meets|met|introduce(?:s|d)?|appears?|arrives?|stands?|waits?|press(?:es|ed)?|hands?|offers?|raises?|smiles?|leans?|looks?|touch(?:es|ed)?|places?|says?|asks?|murmurs?|laughs?|waves?|opens?|holds?)\\b[^.!?]{0,120}\\b(?:${alias})\\b`, 'i').test(text)
    || new RegExp(`\\b(?:${alias})\\b[^.!?]{0,120}\\b(?:meet|meets|met|introduce(?:s|d)?|appears?|arrives?|stands?|waits?|press(?:es|ed)?|hands?|offers?|raises?|smiles?|leans?|looks?|touch(?:es|ed)?|places?|says?|asks?|murmurs?|laughs?|waves?|opens?|holds?)\\b`, 'i').test(text);
}

function normalizedAliasKey(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function valueMatchesNpcAlias(value: string | undefined, aliases: string[]): boolean {
  const key = normalizedAliasKey(value);
  if (!key) return false;
  return aliases.some((alias) => normalizedAliasKey(alias) === key);
}

function beatHasOnPageSpeaker(beat: Beat, aliases: string[]): boolean {
  const raw = beat as Beat & { speaker?: string; speakerName?: string; speakerId?: string; characterId?: string };
  return valueMatchesNpcAlias(raw.speaker, aliases)
    || valueMatchesNpcAlias(raw.speakerName, aliases)
    || valueMatchesNpcAlias(raw.speakerId, aliases)
    || valueMatchesNpcAlias(raw.characterId, aliases);
}

function consequenceDelta(consequence: Consequence): number | undefined {
  const raw = consequence as Consequence & { change?: unknown; delta?: unknown; value?: unknown };
  if (typeof raw.change === 'number') return raw.change;
  if (typeof raw.delta === 'number') return raw.delta;
  if (typeof raw.value === 'number') return raw.value;
  if (typeof raw.value === 'boolean') return raw.value ? 1 : -1;
  return undefined;
}

function consequenceDimension(consequence: Consequence): string | undefined {
  const raw = consequence as Consequence & { dimension?: unknown; score?: unknown };
  return typeof raw.dimension === 'string'
    ? raw.dimension
    : typeof raw.score === 'string'
      ? raw.score
      : undefined;
}

function relationshipConditionsForScene(scene: RelationshipSceneRefLike): Array<{ choiceId?: string; condition: ConditionExpression }> {
  const out: Array<{ choiceId?: string; condition: ConditionExpression }> = [];
  for (const beat of scene.beats ?? []) {
    for (const choice of (beat.choices ?? []) as Choice[]) {
      if (choice.conditions) out.push({ choiceId: choice.id, condition: choice.conditions });
    }
  }
  return out;
}

type RelationshipSceneRefLike = { beats?: Beat[] };

function walkRelationshipConditions(condition: ConditionExpression, visit: (condition: any) => void): void {
  const raw = condition as any;
  if (!raw || typeof raw !== 'object') return;
  if (raw.type === 'relationship' || (raw.npcId && raw.dimension && raw.operator)) visit(raw);
  for (const child of raw.conditions ?? []) walkRelationshipConditions(child, visit);
  if (raw.condition) walkRelationshipConditions(raw.condition, visit);
}

function effectiveTargetStage(contract: RelationshipPacingContract, entry: RelationshipArcLedgerEntry): RelationshipPacingStage {
  // Forgive stale planner/encounter targets down to what plan-time normalization
  // would have allowed. Treatment- and choice-sourced contracts keep their authored
  // intent unless the ledger head proves they overshoot what was earned on-page.
  let target = contract.targetStage;
  if (contract.source === 'planner' || contract.source === 'encounter') {
    if (contract.groupId) {
      if (entry.relationshipChoiceSceneIds.length === 0) target = 'spark';
      else if (stageRank(contract.startStage) <= stageRank('spark') && stageRank(target) > stageRank('acquaintance')) {
        target = 'acquaintance';
      }
    } else if (stageRank(contract.startStage) <= stageRank('unmet') && stageRank(target) > stageRank('spark')) {
      target = 'spark';
    }
  }
  // Never validate a contract target above the deterministic ledger head — spurious
  // choice detection or duplicate plan/story contracts must not inflate the target
  // (bite-me 2026-07-04: s1-3 targeted acquaintance while ledger only permitted spark).
  if (stageRank(target) > stageRank(entry.currentStage)) {
    target = entry.currentStage;
  }
  return target;
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

    const refs = collectRelationshipScenes(input.story, input.scenePlan);
    const sceneOrder = new Map(refs.map((ref, index) => [ref.scene.id, index]));
    const aliases = buildNpcAliases(input.story);
    // Order-aware accumulation of authored relationship gains, seeded from
    // initial relationships — powers the gated-choice reachability check
    // (merge: ported from RelationshipPacingValidator).
    const accumulated = new Map<string, number>();
    for (const npc of input.story.npcs ?? []) {
      const initial = (npc as { initialRelationship?: Partial<Record<'trust' | 'affection' | 'respect' | 'fear', number>> }).initialRelationship;
      const npcKey = canonicalNpcId(npc.id, aliases) ?? npc.id;
      for (const dim of ['trust', 'affection', 'respect', 'fear'] as const) {
        const value = Number(initial?.[dim] ?? 0);
        if (value <= 0) continue;
        accumulated.set(`npc:${npcKey}:${dim}`, (accumulated.get(`npc:${npcKey}:${dim}`) ?? 0) + value);
      }
    }
    const introducedBeforeScene = (entry: RelationshipArcLedgerEntry, sceneId: string): boolean => {
      if (!entry.introducedSceneId) return false;
      const introIndex = sceneOrder.get(entry.introducedSceneId);
      const hereIndex = sceneOrder.get(sceneId);
      return introIndex !== undefined && hereIndex !== undefined && introIndex < hereIndex;
    };

    for (const ref of refs) {
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

        // Contact access before any introduction (merge: ported from
        // RelationshipPacingValidator). Order-aware and alias-anchored: an
        // introduction in a prior scene — or an earlier beat of this scene —
        // earns contact, replacing the whole-scene exchange-verb check that
        // false-positived on prose like "promises to text you the address".
        if (contract.npcId && !introducedBeforeScene(entry, ref.scene.id)) {
          const npcAliases = displayAliasesForNpc(input.story, contract.npcId);
          let introducedInScene = false;
          for (const beat of ref.scene.beats ?? []) {
            const localText = beatVisibleText(beat);
            if (!introducedInScene && hasDirectContactAccess(localText, npcAliases)) {
              pushIssue(this.error(
                `Scene "${ref.scene.id}" gives ${contract.npcId} direct phone/contact access before an on-page introduction earns it.`,
                loc,
                'Introduce the NPC in person, show how numbers/contact access are exchanged, or rewrite the beat as public venue discovery rather than texting/calling an unmet character.',
              ), `contract:private-contact:${ref.episodeNumber}:${ref.scene.id}:${key}`);
            }
            if (beatHasOnPageSpeaker(beat, npcAliases) || hasOnPageIntroductionEvidence(localText, npcAliases)) {
              introducedInScene = true;
            }
          }
        }

        // Ledger-gated pacing residuals (merge: ported from
        // RelationshipPacingValidator, but gated on the deterministic ledger
        // stage instead of the contract target so an earned bond can never be
        // forced into cold rewrites).
        if (stageRank(entry.currentStage) < stageRank('friend')) {
          if (COMPRESSED_FAMILIARITY_RE.test(text)) {
            const compressed = `Scene "${ref.scene.id}" compresses a new relationship into old-friend familiarity before the ledger earns it.`;
            pushIssue(
              input.treatmentSourced
                ? this.error(compressed, loc, 'Keep the chemistry immediate, but express it as a test, invitation, guarded warmth, or fragile beginning rather than years of comfort.')
                : this.warning(compressed, loc, 'Keep the chemistry immediate, but express it as a test, invitation, guarded warmth, or fragile beginning rather than years of comfort.'),
              `compressed:${ref.episodeNumber}:${ref.scene.id}`,
            );
          }
          const customBlocked = customBlockedLabelHits(text, contract);
          if (customBlocked.length > 0) {
            pushIssue(this.error(
              `Scene "${ref.scene.id}" uses unearned relationship label(s): ${customBlocked.join(', ')}.`,
              loc,
              `Rewrite as ${(contract.allowedLabels ?? []).join(', ') || entry.currentStage} until relationship choices and evidence earn the stronger label.`,
            ), `custom-labels:${ref.episodeNumber}:${ref.scene.id}:${key}`);
          }
        }
      }

      // Reachability of relationship-gated choices against gains authored so
      // far (merge: ported from RelationshipPacingValidator). Checked before
      // this scene's own consequences accumulate: a gate cannot be satisfied
      // by the choice it guards.
      for (const { choiceId, condition } of relationshipConditionsForScene(ref.scene)) {
        walkRelationshipConditions(condition, (raw) => {
          const npcKey = canonicalNpcId(raw.npcId, aliases);
          const dimKey = npcKey && raw.dimension ? `npc:${npcKey}:${raw.dimension}` : undefined;
          if (!dimKey || typeof raw.value !== 'number') return;
          const available = accumulated.get(dimKey) ?? 0;
          if ((raw.operator === '>' || raw.operator === '>=') && available < raw.value) {
            pushIssue(this.error(
              `Relationship-gated choice requires ${raw.npcId}.${raw.dimension} ${raw.operator} ${raw.value}, but prior authored relationship gains only reach ${available}.`,
              `relationshipArc:ep${ref.episodeNumber}:${ref.scene.id}:${choiceId ?? 'condition'}`,
              'Lower the gate, add prior relationship consequences, or move the gated option later.',
            ), `condition:${ref.episodeNumber}:${ref.scene.id}:${choiceId ?? 'condition'}:${dimKey}:${raw.value}`);
          }
        });
      }
      for (const { consequence } of relationshipConsequencesForScene(ref.scene)) {
        if (consequence.type !== 'relationship') continue;
        const delta = consequenceDelta(consequence);
        const npcKey = canonicalNpcId((consequence as Consequence & { npcId?: string }).npcId, aliases);
        const dim = consequenceDimension(consequence);
        if (typeof delta !== 'number' || delta <= 0 || !npcKey || !dim) continue;
        accumulated.set(`npc:${npcKey}:${dim}`, (accumulated.get(`npc:${npcKey}:${dim}`) ?? 0) + delta);
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
        // Non-vacuous guard: settled language about a NAMED group with no group
        // ledger entry at all means the group was never planned — the checks
        // above have nothing to audit against and previously passed silently
        // (bite-me 2026-07-03: Dusk Club founded on first hangout with
        // relationshipPacing: [] everywhere).
        if (groupEntries.length === 0) {
          const unplannedGroup = unplannedSettledGroupName(text);
          if (unplannedGroup) {
            pushIssue(this.error(
              `Scene "${ref.scene.id}" treats group "${unplannedGroup}" as settled membership but no relationship pacing contract or ledger entry exists for any group — the milestone was never planned or earned.`,
              `relationshipArc:ep${ref.episodeNumber}:${ref.scene.id}:group-unplanned`,
              'Plan the group arc (relationshipPacing contracts on the founding and earlier scenes) and keep the name provisional — a joke, dare, or fragile invitation — until choices earn membership.',
            ), `group:unplanned:${ref.episodeNumber}:${ref.scene.id}:${slug(unplannedGroup)}`);
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
