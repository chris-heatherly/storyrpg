import type { Beat, Choice, ConditionExpression, Consequence, Scene, Story } from '../../types';
import type { PlannedScene, RelationshipPacingContract, RelationshipPacingStage, SeasonScenePlan } from '../../types/scenePlan';
import { BaseValidator, ValidationIssue, ValidationResult } from './BaseValidator';

export interface RelationshipPacingInput {
  story: Story;
  scenePlan?: SeasonScenePlan;
  treatmentSourced?: boolean;
}

interface SceneRef {
  planned?: PlannedScene;
  episodeNumber: number;
  scene: Scene;
}

const STAGE_RANK: Record<RelationshipPacingStage, number> = {
  unmet: 0,
  noticed: 1,
  spark: 2,
  acquaintance: 3,
  tentative_ally: 4,
  friend: 5,
  trusted_ally: 6,
  intimate: 7,
};

const PROVISIONAL_RE = /\b(joke|jokes|teas\w*|dare|invites?|invitation|maybe|almost|not yet|for now|for tonight|provisional|fragile|beginning|test\w*|tries?|offers?|asks?|names? it|calls? it)\b/i;
const SETTLED_GROUP_RE = /\b(?:dusk club|club|crew|circle|group)\s+(?:is|are|becomes?|became)\s+(?:now\s+)?(?:three|complete|family|official|real|theirs?)\b|\b(?:one of us|inside the circle|inner circle|permanent member)\b/i;
const NEGATED_WINDOW_RE = /\b(?:not|not yet|no|never|almost|maybe|trying to become|could become|might become)\s+(?:a\s+)?$/i;
const VISIBLE_RELATIONSHIP_EVIDENCE_RE = /\b(rescue|saved|sacrifice|secret|confess|risked|protected|protects?|shielded|shields?|blocked|blocks?|covered|covers?|warned|warns?|bled|wounded)\b/i;
const COMPRESSED_FAMILIARITY_RE = /\b(?:only|just)\s+been\s+(?:\w+\s+){0,3}(?:hours?|days?|nights?|weeks?)\b[^.!?]{0,220}\b(?:comfortable\s+habit\s+of\s+years|known\s+(?:her|him|them|each\s+other)\s+for\s+years|known\s+(?:her|him|them|each\s+other)\s+forever|feels?\s+like\s+(?:years|home|family)|old\s+friend|every\s+easy\s+gesture|refills?\s+your\s+(?:wine|glass)|watches?\s+over\s+the\s+rim|what\s+you\s+do\s+with\s+kindness|let\s+yourself\s+belong|belonging)\b/i;

function plannedById(scenePlan?: SeasonScenePlan): Map<string, PlannedScene> {
  const out = new Map<string, PlannedScene>();
  for (const scene of scenePlan?.scenes ?? []) out.set(scene.id, scene);
  return out;
}

function collectScenes(input: RelationshipPacingInput): SceneRef[] {
  const planned = plannedById(input.scenePlan);
  const refs: SceneRef[] = [];
  for (const episode of input.story.episodes ?? []) {
    for (const scene of episode.scenes ?? []) {
      refs.push({ episodeNumber: episode.number, scene, planned: planned.get(scene.id) });
    }
  }
  return refs.sort((a, b) => (a.episodeNumber - b.episodeNumber) || ((a.planned?.order ?? 0) - (b.planned?.order ?? 0)));
}

function choiceText(choice: Choice): string {
  const anyChoice = choice as Choice & {
    outcomeTexts?: Record<string, unknown>;
    reactionText?: string;
  };
  return [
    choice.text,
    choice.lockedText,
    choice.feedbackCue?.echoSummary,
    ...(choice.residueHints ?? []).map((hint) => hint.description),
    ...(choice.witnessReactions ?? []).map((reaction) => `${reaction.reactionText} ${reaction.residueHint ?? ''}`),
    anyChoice.reactionText,
    ...Object.values(anyChoice.outcomeTexts ?? {}).map((value) => typeof value === 'string' ? value : ''),
  ].filter(Boolean).join(' ');
}

function beatText(beat: Beat): string {
  return [
    beat.text,
    ...(beat.textVariants ?? []).map((variant) => variant.text),
    ...((beat.choices ?? []) as Choice[]).map(choiceText),
  ].filter(Boolean).join(' ');
}

function sceneText(scene: Scene): string {
  return [scene.name, ...(scene.beats ?? []).map(beatText)].filter(Boolean).join(' ');
}

function locationFor(ref: SceneRef, contract: RelationshipPacingContract): string {
  return `relationshipPacing:ep${ref.episodeNumber}:${ref.scene.id}:${contract.id}`;
}

function isNegated(text: string, index: number): boolean {
  const prefix = text.slice(Math.max(0, index - 40), index).toLowerCase();
  return NEGATED_WINDOW_RE.test(prefix);
}

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isFamilyRelationshipClaim(text: string, index: number): boolean {
  const start = Math.max(0, index - 48);
  const end = Math.min(text.length, index + 64);
  const window = text.slice(start, end).toLowerCase();
  return /\b(?:like|as|found|chosen)\s+family\b/.test(window)
    || /\bfamily\s+(?:now|already|forever|by choice|for tonight)\b/.test(window)
    || /\b(?:part|member)\s+of\s+(?:the|our|their|your|his|her)\s+family\b/.test(window);
}

function isBlockedLabelClaim(text: string, label: string, index: number): boolean {
  if (isNegated(text, index)) return false;
  if (label.toLowerCase() === 'family') return isFamilyRelationshipClaim(text, index);
  return true;
}

function blockedLabelHits(text: string, contract: RelationshipPacingContract): string[] {
  const hits: string[] = [];
  for (const label of contract.blockedLabels ?? []) {
    if (!label || label.length < 3) continue;
    const source = label.toLowerCase() === 'friend'
      ? `${escaped(label)}(?:ship|s)?`
      : escaped(label);
    const re = new RegExp(`\\b${source}\\b`, 'ig');
    for (const match of text.matchAll(re)) {
      if (isBlockedLabelClaim(text, label, match.index ?? 0)) hits.push(label);
    }
  }
  if (contract.groupId && SETTLED_GROUP_RE.test(text) && !PROVISIONAL_RE.test(text)) {
    hits.push('settled group membership');
  }
  return Array.from(new Set(hits));
}

function highStageClaimedInText(text: string, contract: RelationshipPacingContract): boolean {
  const claimLabels = new Set<string>();
  if (STAGE_RANK[contract.targetStage] >= STAGE_RANK.friend) claimLabels.add(contract.targetStage.replace(/_/g, ' '));
  for (const label of contract.allowedLabels ?? []) {
    if (/\b(friend|trusted|intimate|bond with history)\b/i.test(label)) claimLabels.add(label);
  }
  for (const label of claimLabels) {
    if (!label || label.length < 3) continue;
    const re = new RegExp(`\\b${escaped(label)}\\b`, 'i');
    if (re.test(text)) return true;
  }
  return false;
}

function compressedFamiliarityClaim(text: string, contract: RelationshipPacingContract): boolean {
  if (STAGE_RANK[contract.targetStage] >= STAGE_RANK.friend) return false;
  return COMPRESSED_FAMILIARITY_RE.test(text);
}

function relationshipConsequences(scene: Scene): Consequence[] {
  const out: Consequence[] = [];
  for (const beat of scene.beats ?? []) {
    out.push(...(beat.onShow ?? []));
    for (const choice of (beat.choices ?? []) as Choice[]) {
      out.push(...(choice.consequences ?? []));
    }
  }
  return out;
}

function normalizedKey(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function npcAliasMap(story: Story): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const npc of story.npcs ?? []) {
    const raw = npc as { id?: string; name?: string; aliases?: string[] };
    const canonical = raw.id || raw.name;
    const canonicalKey = normalizedKey(canonical);
    if (!canonical || !canonicalKey) continue;
    for (const value of [raw.id, raw.name, ...(raw.aliases ?? [])]) {
      const key = normalizedKey(value);
      if (key) aliases.set(key, canonicalKey);
    }
  }
  return aliases;
}

function resolveNpcKey(value: string | undefined, aliases: Map<string, string>): string | undefined {
  const key = normalizedKey(value);
  if (!key) return undefined;
  return aliases.get(key) ?? key;
}

function valueMatchesNpcAlias(value: string | undefined, aliases: string[]): boolean {
  const key = normalizedKey(value);
  if (!key) return false;
  return aliases.some((alias) => normalizedKey(alias) === key);
}

function npcAliasesForContract(story: Story, contract: RelationshipPacingContract, aliases: Map<string, string>): string[] {
  const contractNpcKey = resolveNpcKey(contract.npcId, aliases);
  if (!contractNpcKey) return [];
  const values = new Set<string>();
  const add = (value: unknown): void => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (trimmed.length >= 3) values.add(trimmed);
  };

  add(contract.npcId);
  for (const npc of story.npcs ?? []) {
    const raw = npc as { id?: string; name?: string; aliases?: string[] };
    const npcKey = resolveNpcKey(raw.id, aliases) ?? resolveNpcKey(raw.name, aliases);
    if (npcKey !== contractNpcKey) continue;
    add(raw.id);
    add(raw.name);
    for (const alias of raw.aliases ?? []) add(alias);
    const first = raw.name?.match(/[A-Za-zÀ-ž'’-]{3,}/)?.[0];
    add(first);
  }

  return Array.from(values)
    .filter((value) => !/^char-|^npc-/i.test(value))
    .sort((a, b) => b.length - a.length);
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

function beatHasOnPageSpeaker(beat: Beat, aliases: string[]): boolean {
  const raw = beat as Beat & { speaker?: string; speakerName?: string; speakerId?: string; characterId?: string };
  return valueMatchesNpcAlias(raw.speaker, aliases)
    || valueMatchesNpcAlias(raw.speakerName, aliases)
    || valueMatchesNpcAlias(raw.speakerId, aliases)
    || valueMatchesNpcAlias(raw.characterId, aliases);
}

function contractKey(contract: RelationshipPacingContract, aliases?: Map<string, string>): string | undefined {
  if (contract.npcId) {
    const key = aliases ? resolveNpcKey(contract.npcId, aliases) : contract.npcId;
    return key ? `npc:${key}` : undefined;
  }
  return contract.groupId ? `group:${contract.groupId}` : undefined;
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

function relationshipConditions(scene: Scene): Array<{ choiceId?: string; condition: ConditionExpression }> {
  const out: Array<{ choiceId?: string; condition: ConditionExpression }> = [];
  const collect = (condition: ConditionExpression | undefined, choiceId?: string): void => {
    if (!condition) return;
    out.push({ choiceId, condition });
  };
  for (const beat of scene.beats ?? []) {
    for (const choice of (beat.choices ?? []) as Choice[]) collect(choice.conditions, choice.id);
  }
  return out;
}

function walkRelationshipConditions(condition: ConditionExpression, visit: (condition: any) => void): void {
  const raw = condition as any;
  if (!raw || typeof raw !== 'object') return;
  if (raw.type === 'relationship' || (raw.npcId && raw.dimension && raw.operator)) visit(raw);
  for (const child of raw.conditions ?? []) walkRelationshipConditions(child, visit);
  if (raw.condition) walkRelationshipConditions(raw.condition, visit);
}

export class RelationshipPacingValidator extends BaseValidator {
  constructor() {
    super('RelationshipPacingValidator');
  }

  validate(input: RelationshipPacingInput): ValidationResult {
    const issues: ValidationIssue[] = [];
    const seenScenes = new Map<string, number>();
    const introducedScenes = new Map<string, number>();
    const accumulated = new Map<string, number>();
    const aliases = npcAliasMap(input.story);

    for (const npc of input.story.npcs ?? []) {
      const initial = (npc as { initialRelationship?: Partial<Record<'trust' | 'affection' | 'respect' | 'fear', number>> }).initialRelationship;
      for (const dim of ['trust', 'affection', 'respect', 'fear'] as const) {
        const value = Number(initial?.[dim] ?? 0);
        if (value <= 0) continue;
        const key = resolveNpcKey(npc.id, aliases) ?? npc.id;
        accumulated.set(`npc:${key}:${dim}`, value);
        accumulated.set(`npc:${key}`, (accumulated.get(`npc:${key}`) ?? 0) + value);
      }
    }

    for (const ref of collectScenes(input)) {
      const contracts = ref.scene.relationshipPacing ?? ref.planned?.relationshipPacing ?? [];
      const text = sceneText(ref.scene);
      const consequences = relationshipConsequences(ref.scene);

      for (const contract of contracts) {
        const key = contractKey(contract, aliases);
        const loc = locationFor(ref, contract);
        const priorScenes = key ? (seenScenes.get(key) ?? 0) : 0;
        const priorIntroductions = key ? (introducedScenes.get(key) ?? 0) : 0;
        const priorPositive = key ? (accumulated.get(key) ?? 0) : 0;
        const highTarget = STAGE_RANK[contract.targetStage] >= STAGE_RANK.friend;
        const treatmentBlocking = input.treatmentSourced || contract.source === 'treatment';
        const npcAliases = npcAliasesForContract(input.story, contract, aliases);

        if (key && contract.npcId && priorIntroductions === 0) {
          let introducedInScene = false;
          for (const beat of ref.scene.beats ?? []) {
            const localText = beatText(beat);
            if (!introducedInScene && hasDirectContactAccess(localText, npcAliases)) {
              issues.push({
                severity: treatmentBlocking ? 'error' : 'warning',
                location: loc,
                message: `Scene "${ref.scene.id}" gives ${contract.npcId} direct phone/contact access before an on-page introduction earns it.`,
                suggestion: 'Introduce the NPC in person, show how numbers/contact access are exchanged, or rewrite the beat as public venue discovery rather than texting/calling an unmet character.',
              });
            }
            if (beatHasOnPageSpeaker(beat, npcAliases) || hasOnPageIntroductionEvidence(localText, npcAliases)) {
              introducedInScene = true;
            }
          }
        }

        const blocked = blockedLabelHits(text, contract);
        if (blocked.length > 0) {
          issues.push({
            severity: treatmentBlocking || highTarget ? 'error' : 'warning',
            location: loc,
            message: `Scene "${ref.scene.id}" uses unearned relationship label(s): ${blocked.join(', ')}.`,
            suggestion: `Rewrite as ${contract.allowedLabels.join(', ') || contract.targetStage} unless prior scenes and relationship consequences have earned the stronger label.`,
          });
        }

        if (compressedFamiliarityClaim(text, contract)) {
          issues.push({
            severity: treatmentBlocking ? 'error' : 'warning',
            location: loc,
            message: `Scene "${ref.scene.id}" compresses a new relationship into old-friend familiarity before the pacing contract earns it.`,
            suggestion: 'Keep the chemistry immediate, but express it as a test, invitation, guarded warmth, or fragile beginning rather than years of comfort.',
          });
        }

        if (highTarget && priorScenes < Math.max(1, contract.minScenesSinceIntroduction)) {
          issues.push({
            severity: treatmentBlocking ? 'error' : 'warning',
            location: loc,
            message: `Scene "${ref.scene.id}" targets ${contract.targetStage} before enough on-page relationship history exists.`,
            suggestion: 'Add earlier relationship turns, or lower this scene to spark/acquaintance/tentative_ally.',
          });
        }

        for (const consequence of consequences) {
          if (consequence.type !== 'relationship') continue;
          const consequenceNpcKey = resolveNpcKey(consequence.npcId, aliases);
          const contractNpcKey = resolveNpcKey(contract.npcId, aliases);
          if (contractNpcKey && consequenceNpcKey !== contractNpcKey) continue;
          const delta = consequenceDelta(consequence);
          if (typeof delta !== 'number') continue;
          const max = Math.abs(contract.maxDeltaThisScene);
          if (max > 0 && Math.abs(delta) > max) {
            issues.push({
              severity: 'error',
              location: loc,
              message: `Relationship consequence for ${consequence.npcId}.${consequenceDimension(consequence) ?? 'relationship'} changes by ${delta}, above this scene's pacing cap of ${max}.`,
              suggestion: 'Reduce the delta or add a major visible sacrifice, rescue, secret, or prior relationship scene that earns a larger shift.',
            });
          }
        }

        if (highTarget && highStageClaimedInText(text, contract) && priorPositive < 12 && !VISIBLE_RELATIONSHIP_EVIDENCE_RE.test(text)) {
          issues.push({
            severity: treatmentBlocking ? 'error' : 'warning',
            location: loc,
            message: `Scene "${ref.scene.id}" claims a high relationship stage without enough visible evidence or accumulated relationship movement.`,
            suggestion: 'Show concrete reciprocity, vulnerability, protection, remembered detail, or challenge before naming the bond.',
          });
        }
      }

      for (const { choiceId, condition } of relationshipConditions(ref.scene)) {
        walkRelationshipConditions(condition, (raw) => {
          const key = raw.npcId && raw.dimension ? `npc:${raw.npcId}:${raw.dimension}` : undefined;
          if (!key || typeof raw.value !== 'number') return;
          const available = accumulated.get(key) ?? 0;
          if ((raw.operator === '>' || raw.operator === '>=') && available < raw.value) {
            issues.push({
              severity: 'error',
              location: `relationshipPacing:ep${ref.episodeNumber}:${ref.scene.id}:${choiceId ?? 'condition'}`,
              message: `Relationship-gated choice requires ${raw.npcId}.${raw.dimension} ${raw.operator} ${raw.value}, but prior authored relationship gains only reach ${available}.`,
              suggestion: 'Lower the gate, add prior relationship consequences, or move the gated option later.',
            });
          }
        });
      }

      const contractedKeys = new Set<string>();
      for (const contract of contracts) {
        const key = contractKey(contract, aliases);
        if (key) contractedKeys.add(key);
        if (key) seenScenes.set(key, (seenScenes.get(key) ?? 0) + 1);
        if (key && contract.npcId) {
          const npcAliases = npcAliasesForContract(input.story, contract, aliases);
          if ((ref.scene.beats ?? []).some((beat) => beatHasOnPageSpeaker(beat, npcAliases) || hasOnPageIntroductionEvidence(beatText(beat), npcAliases))) {
            introducedScenes.set(key, (introducedScenes.get(key) ?? 0) + 1);
          }
        }
      }
      const consequenceNpcIds = new Set<string>();
      for (const consequence of consequences) {
        const delta = consequenceDelta(consequence);
        const npcId = (consequence as Consequence & { npcId?: string }).npcId;
        const npcKey = resolveNpcKey(npcId, aliases);
        const dimension = consequenceDimension(consequence);
        if (consequence.type !== 'relationship' || typeof delta !== 'number' || !npcKey) continue;
        consequenceNpcIds.add(npcKey);
        const key = dimension ? `npc:${npcKey}:${dimension}` : undefined;
        if (key && delta > 0) accumulated.set(key, (accumulated.get(key) ?? 0) + delta);
        const broadKey = `npc:${npcKey}`;
        if (delta > 0) accumulated.set(broadKey, (accumulated.get(broadKey) ?? 0) + delta);
      }
      for (const npcId of consequenceNpcIds) {
        const key = `npc:${npcId}`;
        if (!contractedKeys.has(key)) seenScenes.set(key, (seenScenes.get(key) ?? 0) + 1);
      }
    }

    return {
      valid: !issues.some((issue) => issue.severity === 'error'),
      score: issues.length === 0 ? 100 : Math.max(0, 100 - issues.length * 15),
      issues,
      suggestions: issues.map((issue) => issue.suggestion).filter((value): value is string => Boolean(value)),
    };
  }
}
