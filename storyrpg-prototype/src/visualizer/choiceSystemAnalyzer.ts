import type {
  Choice,
  ConditionExpression,
  Consequence,
  RelationshipChange,
  Story,
} from '../types';
import type {
  ChoiceSystemChoiceSummary,
  ChoiceSystemConditionSummary,
  ChoiceSystemEffectSummary,
  ChoiceSystemEdgeMetadata,
  ChoiceSystemFacet,
  ChoiceSystemFilterState,
  ChoiceSystemNodeMetadata,
  ChoiceSystemNpcSummary,
  ChoiceSystemRouteSummary,
  GraphEdge,
  GraphNode,
  StoryGraph,
} from './types';

const RELATIONSHIP_DIMENSIONS = ['trust', 'affection', 'respect', 'fear'] as const;

export const DEFAULT_CHOICE_SYSTEM_FILTERS: ChoiceSystemFilterState = {
  showRouting: true,
  showRelationships: true,
  showStats: true,
  showLockedPaths: true,
  showDelayedCallbacks: true,
  showOnlyMeaningfulBranches: false,
  showTints: true,
  showTintPayoffs: true,
  showBranchlets: true,
  showStorylets: true,
  showCallbacks: true,
};

export function enrichStoryGraphWithChoiceSystems(story: Story, graph: StoryGraph): StoryGraph {
  const nodes = graph.nodes.map((node) => ({ ...node }));
  const edges = graph.edges.map((edge) => ({ ...edge }));
  const nodeBySceneBeat = new Map<string, GraphNode>();
  const edgeByChoiceId = new Map<string, GraphEdge>();
  const npcAccumulator = new Map<string, ChoiceSystemNpcSummary>();

  for (const node of nodes) {
    const dataId = (node.data as { id?: string })?.id;
    if (node.sceneId && dataId) {
      nodeBySceneBeat.set(`${node.sceneId}:${dataId}`, node);
    }
  }

  for (const edge of edges) {
    const match = edge.id.match(/-choice-(.+?)-to-/);
    if (match?.[1]) {
      edgeByChoiceId.set(match[1], edge);
    }
  }

  for (const episode of story.episodes ?? []) {
    for (const scene of episode.scenes ?? []) {
      for (const beat of scene.beats ?? []) {
        const choices = beat.choices ?? [];
        if (choices.length === 0) continue;

        const node = nodeBySceneBeat.get(`${scene.id}:${beat.id}`);
        if (!node) continue;

        const summaries = choices.map((choice) => summarizeChoice(choice));
        node.choiceSystem = buildNodeMetadata(summaries);

        for (const summary of summaries) {
          for (const npcId of summary.relationshipNpcIds) {
            const npcSummary = getNpcSummary(npcAccumulator, npcId);
            for (const condition of summary.conditions) {
              if (condition.kind === 'relationship' && condition.npcId === npcId) {
                const dimension = normalizeRelationshipDimension(condition.dimension);
                if (dimension) npcSummary.dimensions[dimension].gates += 1;
              }
            }
            for (const effect of summary.effects) {
              if (effect.kind === 'relationship' && effect.npcId === npcId) {
                const dimension = normalizeRelationshipDimension(effect.dimension);
                if (dimension) npcSummary.dimensions[dimension].effects += 1;
              }
            }
          }

          const edge = edgeByChoiceId.get(summary.id);
          if (edge) {
            edge.choiceSystem = buildEdgeMetadata(summary);
            edge.conditioned = edge.conditioned || summary.hasLockedGate;
          }
        }
      }
    }
  }

  return {
    ...graph,
    nodes,
    edges,
    choiceSystem: {
      npcs: Array.from(npcAccumulator.values()).sort((a, b) => a.npcId.localeCompare(b.npcId)),
    },
  };
}

export function summarizeChoice(choice: Choice): ChoiceSystemChoiceSummary {
  const conditions = summarizeConditions(choice.conditions);
  const effects = summarizeEffects(choice);
  const check = summarizeCheck(choice);
  const route = summarizeRoute(choice);
  const relationshipNpcIds = collectRelationshipNpcIds(conditions, effects);
  const facets = collectFacets(choice, route, conditions, effects, check);
  const hasDelayedCallback =
    (choice.delayedConsequences?.length ?? 0) > 0 ||
    Boolean(choice.memorableMoment) ||
    (choice.residueHints?.length ?? 0) > 0;
  const hasLockedGate = conditions.length > 0;
  const choiceType = choice.choiceType ?? 'standard';

  return {
    id: choice.id,
    text: choice.text,
    choiceType,
    route,
    conditions,
    effects,
    check,
    hasDelayedCallback,
    hasLockedGate,
    relationshipNpcIds,
    facets,
    authorSummary: buildAuthorChoiceSummary(choice, route, conditions, effects, check),
    playerSummary: buildPlayerChoiceSummary(choice, route, conditions, effects, check),
  };
}

export function shouldShowEdge(
  edge: GraphEdge,
  filters: ChoiceSystemFilterState = DEFAULT_CHOICE_SYSTEM_FILTERS,
  _selectedNpcId: string | null = null,
): boolean {
  const metadata = edge.choiceSystem;

  if (!filters.showRouting && !metadata) return false;
  if (!metadata) return true;
  if (!filters.showRouting && metadata.facets.every((facet) => facet === 'routing' || facet === 'branching')) return false;
  if (!filters.showLockedPaths && metadata.hasLockedGate) return false;
  if (!filters.showDelayedCallbacks && metadata.hasDelayedCallback) return false;
  if (filters.showOnlyMeaningfulBranches && !metadata.route?.isMeaningfulBranch) return false;
  if (!filters.showRelationships && metadata.facets.includes('relationship')) return false;
  if (!filters.showStats && metadata.facets.includes('stat')) return false;

  return true;
}

function summarizeRoute(choice: Choice): ChoiceSystemRouteSummary {
  if (choice.nextSceneId) {
    return {
      kind: 'nextScene',
      authorLabel: `goes to ${humanizeId(choice.nextSceneId)}`,
      playerLabel: 'This choice opens a different scene.',
      isMeaningfulBranch: true,
    };
  }
  if (choice.nextBeatId) {
    return {
      kind: 'nextBeat',
      authorLabel: `goes to ${humanizeId(choice.nextBeatId)}`,
      playerLabel: 'This choice changes the immediate path.',
      isMeaningfulBranch: true,
    };
  }
  return {
    kind: 'implicit',
    authorLabel: 'implicit continuation',
    playerLabel: 'This choice colors what happens next.',
    isMeaningfulBranch: false,
  };
}

function summarizeConditions(condition?: ConditionExpression): ChoiceSystemConditionSummary[] {
  if (!condition) return [];

  switch (condition.type) {
    case 'relationship':
      return [{
        kind: 'relationship',
        authorLabel: `${humanizeId(condition.npcId)} ${humanizeId(condition.dimension)} ${condition.operator} ${condition.value}`,
        playerLabel: `This path opens if ${humanizeId(condition.npcId)} has been moved a certain way.`,
        npcId: condition.npcId,
        dimension: condition.dimension,
      }];
    case 'attribute':
      return [{
        kind: 'attribute',
        authorLabel: `${humanizeId(String(condition.attribute))} ${condition.operator} ${condition.value}`,
        playerLabel: 'This path depends on an established personal strength.',
      }];
    case 'skill':
      return [{
        kind: 'skill',
        authorLabel: `${humanizeId(condition.skill)} ${condition.operator} ${condition.value}`,
        playerLabel: 'This path depends on practiced competence.',
      }];
    case 'flag':
      return [{
        kind: 'flag',
        authorLabel: `${humanizeId(condition.flag)} is ${String(condition.value)}`,
        playerLabel: 'This path remembers an earlier story fact.',
      }];
    case 'score':
      return [{
        kind: 'score',
        authorLabel: `${humanizeId(condition.score)} ${condition.operator} ${condition.value}`,
        playerLabel: 'This path depends on accumulated momentum.',
      }];
    case 'tag':
      return [{
        kind: 'tag',
        authorLabel: `${condition.hasTag ? 'has' : 'does not have'} ${humanizeId(condition.tag)}`,
        playerLabel: 'This path depends on who the player has become.',
      }];
    case 'item':
      return [{
        kind: 'item',
        authorLabel: `${condition.hasItem ?? condition.has ?? true ? 'has' : 'does not have'} ${humanizeId(condition.itemId)}`,
        playerLabel: 'This path depends on something the player carries.',
      }];
    case 'identity':
      return [{
        kind: 'identity',
        authorLabel: `${humanizeId(String(condition.dimension))} ${condition.operator} ${condition.value}`,
        playerLabel: 'This path depends on the player character’s emerging identity.',
      }];
    case 'and':
    case 'or': {
      const nested = condition.conditions.flatMap((item) => summarizeConditions(item));
      return [
        {
          kind: 'compound',
          authorLabel: `${condition.type === 'and' ? 'all of' : 'any of'}: ${nested.map((item) => item.authorLabel).join(', ')}`,
          playerLabel: condition.type === 'and'
            ? 'This path requires several earlier truths to line up.'
            : 'This path can open through more than one earlier truth.',
        },
        ...nested,
      ];
    }
    case 'not': {
      const nested = summarizeConditions(condition.condition);
      return [
        {
          kind: 'compound',
          authorLabel: `not: ${nested.map((item) => item.authorLabel).join(', ')}`,
          playerLabel: 'This path opens when an earlier truth is absent.',
        },
        ...nested,
      ];
    }
    default:
      return [{
        kind: 'unknown',
        authorLabel: 'hidden condition',
        playerLabel: 'This path depends on hidden story state.',
      }];
  }
}

function summarizeEffects(choice: Choice): ChoiceSystemEffectSummary[] {
  const effects: ChoiceSystemEffectSummary[] = [];

  for (const consequence of choice.consequences ?? []) {
    effects.push(summarizeConsequence(consequence));
  }

  for (const delayed of choice.delayedConsequences ?? []) {
    effects.push({
      kind: 'delayed',
      authorLabel: `later: ${delayed.description}`,
      playerLabel: 'This choice echoes later.',
    });
    effects.push(summarizeConsequence(delayed.consequence));
  }

  if (choice.memorableMoment) {
    effects.push({
      kind: 'memory',
      authorLabel: `remembers: ${choice.memorableMoment.summary}`,
      playerLabel: 'The story remembers this moment.',
    });
  }

  for (const hint of choice.residueHints ?? []) {
    effects.push({
      kind: 'residue',
      authorLabel: `echo: ${hint.description}`,
      playerLabel: hint.targetNpcId
        ? `${humanizeId(hint.targetNpcId)} may carry this forward.`
        : 'This choice leaves a visible trace later.',
      npcId: hint.targetNpcId,
    });
  }

  if (choice.tintFlag || choice.impactFactors?.includes('identity')) {
    effects.push({
      kind: 'identity',
      authorLabel: choice.tintFlag ? `identity tone: ${humanizeId(choice.tintFlag)}` : 'identity impact',
      playerLabel: 'This choice shapes who the player is becoming.',
    });
  }

  return effects;
}

function summarizeConsequence(consequence: Consequence): ChoiceSystemEffectSummary {
  if (!consequence || typeof consequence !== 'object') {
    return {
      kind: 'unknown',
      authorLabel: 'hidden effect',
      playerLabel: 'This changes hidden story state.',
    };
  }
  switch (consequence.type) {
    case 'relationship': {
      const relationship = consequence as RelationshipChange;
      return {
        kind: 'relationship',
        authorLabel: `${humanizeId(relationship.npcId, 'Relationship')} ${humanizeId(relationship.dimension, 'Affinity')} ${formatChange(relationship.change)}`,
        playerLabel: `${humanizeId(relationship.npcId, 'Someone')} remembers this.`,
        npcId: relationship.npcId,
        dimension: relationship.dimension,
        direction: relationship.change > 0 ? 'up' : relationship.change < 0 ? 'down' : 'neutral',
      };
    }
    case 'attribute':
      return {
        kind: 'attribute',
        authorLabel: `${humanizeId(consequence.attribute, 'Attribute')} ${formatChange(consequence.change)}`,
        playerLabel: 'This nudges an inner strength.',
        direction: consequence.change > 0 ? 'up' : consequence.change < 0 ? 'down' : 'neutral',
      };
    case 'skill':
      return {
        kind: 'skill',
        authorLabel: `${humanizeId(consequence.skill, 'Skill')} ${formatChange(consequence.change)}`,
        playerLabel: 'This changes practiced competence.',
        direction: consequence.change > 0 ? 'up' : consequence.change < 0 ? 'down' : 'neutral',
      };
    case 'setFlag':
      return {
        kind: 'flag',
        authorLabel: `${humanizeId(consequence.flag, 'Story Flag')} ${consequence.value ? 'set' : 'cleared'}`,
        playerLabel: 'This records a new story fact.',
      };
    case 'changeScore':
      return {
        kind: 'score',
        authorLabel: `${humanizeId(consequence.score, 'Score')} ${formatChange(consequence.change)}`,
        playerLabel: 'This shifts story momentum.',
        direction: consequence.change > 0 ? 'up' : consequence.change < 0 ? 'down' : 'neutral',
      };
    case 'setScore':
      return {
        kind: 'score',
        authorLabel: `${humanizeId(consequence.score, 'Score')} becomes ${consequence.value ?? 'set'}`,
        playerLabel: 'This fixes a story momentum state.',
      };
    case 'addTag':
      return {
        kind: 'tag',
        authorLabel: `adds ${humanizeId(consequence.tag, 'Tag')}`,
        playerLabel: 'This adds to the player’s story identity.',
      };
    case 'removeTag':
      return {
        kind: 'tag',
        authorLabel: `removes ${humanizeId(consequence.tag, 'Tag')}`,
        playerLabel: 'This sheds part of the player’s story identity.',
      };
    case 'addItem':
      return {
        kind: 'item',
        authorLabel: `adds ${humanizeId(('itemId' in consequence ? consequence.itemId : consequence.item?.itemId) ?? 'item', 'Item')}`,
        playerLabel: 'This adds something useful to carry forward.',
      };
    case 'removeItem':
      return {
        kind: 'item',
        authorLabel: `removes ${humanizeId(consequence.itemId, 'Item')}${consequence.quantity ? ` x${consequence.quantity}` : ''}`,
        playerLabel: 'This spends or loses something carried.',
      };
    default:
      return {
        kind: 'unknown',
        authorLabel: 'hidden effect',
        playerLabel: 'This changes hidden story state.',
      };
  }
}

function summarizeCheck(choice: Choice) {
  const check = choice.statCheck;
  if (!check) return undefined;
  if (check.skillWeights && Object.keys(check.skillWeights).length > 0) {
    return {
      kind: 'weighted' as const,
      authorLabel: `tests ${Object.keys(check.skillWeights).map((id) => humanizeId(id)).join(', ')} (${humanizeId(String(check.difficulty))})`,
      playerLabel: 'This tests a blend of practiced strengths under pressure.',
    };
  }
  if (check.skill) {
    return {
      kind: 'skill' as const,
      authorLabel: `tests ${humanizeId(check.skill)} (${humanizeId(String(check.difficulty))})`,
      playerLabel: 'This tests practiced competence under pressure.',
    };
  }
  return {
    kind: 'attribute' as const,
    authorLabel: `tests ${humanizeId(String(check.attribute ?? 'unknown'))} (${humanizeId(String(check.difficulty))})`,
    playerLabel: 'This tests an inner strength under pressure.',
  };
}

function collectFacets(
  choice: Choice,
  route: ChoiceSystemRouteSummary,
  conditions: ChoiceSystemConditionSummary[],
  effects: ChoiceSystemEffectSummary[],
  check?: ReturnType<typeof summarizeCheck>,
): ChoiceSystemFacet[] {
  const facets = new Set<ChoiceSystemFacet>();
  facets.add('routing');
  if (route.isMeaningfulBranch) facets.add('branching');
  if (choice.choiceType === 'relationship') facets.add('relationship');
  if (choice.choiceType === 'strategic') facets.add('stat');
  if (conditions.some((item) => item.kind === 'relationship') || effects.some((item) => item.kind === 'relationship')) facets.add('relationship');
  if (conditions.some((item) => item.kind === 'attribute' || item.kind === 'skill') || effects.some((item) => item.kind === 'attribute' || item.kind === 'skill') || check) facets.add('stat');
  if (conditions.some((item) => item.kind === 'identity') || effects.some((item) => item.kind === 'identity')) facets.add('identity');
  if (effects.some((item) => item.kind === 'delayed' || item.kind === 'memory' || item.kind === 'residue')) facets.add('delayed');
  return Array.from(facets);
}

function buildNodeMetadata(choices: ChoiceSystemChoiceSummary[]): ChoiceSystemNodeMetadata {
  const facets = Array.from(new Set(choices.flatMap((choice) => choice.facets)));
  const npcIds = Array.from(new Set(choices.flatMap((choice) => choice.relationshipNpcIds))).sort();
  const badges = buildBadges(facets, choices);

  return { choices, npcIds, facets, badges };
}

function buildEdgeMetadata(choice: ChoiceSystemChoiceSummary): ChoiceSystemEdgeMetadata {
  return {
    choiceId: choice.id,
    choiceType: choice.choiceType,
    facets: choice.facets,
    route: choice.route,
    conditions: choice.conditions,
    effects: choice.effects,
    check: choice.check,
    hasDelayedCallback: choice.hasDelayedCallback,
    hasLockedGate: choice.hasLockedGate,
    relationshipNpcIds: choice.relationshipNpcIds,
    authorLabel: buildConciseEdgeLabel(choice),
    playerLabel: choice.playerSummary,
  };
}

function buildConciseEdgeLabel(choice: ChoiceSystemChoiceSummary): string {
  const primaryEffect = choice.effects.find((effect) => (
    effect.kind !== 'delayed' &&
    effect.kind !== 'memory' &&
    effect.kind !== 'residue'
  ));
  if (primaryEffect) return stripEffectStatus(primaryEffect.authorLabel);
  if (choice.check) return choice.check.authorLabel;
  if (choice.route.kind === 'nextBeat') return '';
  return choice.route.authorLabel;
}

function stripEffectStatus(label: string): string {
  return label
    .replace(/\s+(set|cleared)$/i, '')
    .replace(/\s+becomes\s+set$/i, '')
    .replace(/^(adds|removes)\s+/i, '')
    .trim();
}

function buildBadges(facets: ChoiceSystemFacet[], choices: ChoiceSystemChoiceSummary[]) {
  const badges: ChoiceSystemNodeMetadata['badges'] = [];
  if (facets.includes('relationship')) {
    badges.push({ facet: 'relationship', authorLabel: 'REL', playerLabel: 'BONDS' });
  }
  if (facets.includes('stat')) {
    badges.push({ facet: 'stat', authorLabel: 'STAT', playerLabel: 'TEST' });
  }
  if (facets.includes('identity')) {
    badges.push({ facet: 'identity', authorLabel: 'ID', playerLabel: 'SELF' });
  }
  if (facets.includes('delayed')) {
    badges.push({ facet: 'delayed', authorLabel: 'ECHO', playerLabel: 'ECHO' });
  }
  if (choices.some((choice) => choice.route.isMeaningfulBranch)) {
    badges.push({ facet: 'branching', authorLabel: 'BRANCH', playerLabel: 'PATH' });
  }
  return badges;
}

function collectRelationshipNpcIds(
  conditions: ChoiceSystemConditionSummary[],
  effects: ChoiceSystemEffectSummary[],
): string[] {
  const ids = new Set<string>();
  for (const condition of conditions) {
    if (condition.npcId) ids.add(condition.npcId);
  }
  for (const effect of effects) {
    if (effect.npcId) ids.add(effect.npcId);
  }
  return Array.from(ids).sort();
}

function getNpcSummary(map: Map<string, ChoiceSystemNpcSummary>, npcId: string): ChoiceSystemNpcSummary {
  const existing = map.get(npcId);
  if (existing) return existing;
  const summary: ChoiceSystemNpcSummary = {
    npcId,
    dimensions: {
      trust: { gates: 0, effects: 0 },
      affection: { gates: 0, effects: 0 },
      respect: { gates: 0, effects: 0 },
      fear: { gates: 0, effects: 0 },
    },
  };
  map.set(npcId, summary);
  return summary;
}

function normalizeRelationshipDimension(value?: string) {
  return RELATIONSHIP_DIMENSIONS.find((dimension) => dimension === value);
}

function buildAuthorChoiceSummary(
  choice: Choice,
  route: ChoiceSystemRouteSummary,
  conditions: ChoiceSystemConditionSummary[],
  effects: ChoiceSystemEffectSummary[],
  check?: ReturnType<typeof summarizeCheck>,
): string {
  const parts = [route.authorLabel];
  if (conditions.length > 0) parts.push(`requires ${conditions.map((item) => item.authorLabel).join(' or ')}`);
  if (check) parts.push(check.authorLabel);
  if (effects.length > 0) parts.push(effects.map((item) => item.authorLabel).join(', '));
  return parts.join('. ');
}

function buildPlayerChoiceSummary(
  choice: Choice,
  route: ChoiceSystemRouteSummary,
  conditions: ChoiceSystemConditionSummary[],
  effects: ChoiceSystemEffectSummary[],
  check?: ReturnType<typeof summarizeCheck>,
): string {
  const parts = [route.playerLabel];
  const relationshipEffect = effects.find((item) => item.kind === 'relationship');
  const relationshipGate = conditions.find((item) => item.kind === 'relationship');
  if (relationshipEffect) parts.push(relationshipEffect.playerLabel);
  if (relationshipGate) parts.push(relationshipGate.playerLabel);
  if (check) parts.push(check.playerLabel);
  if (effects.some((item) => item.kind === 'delayed' || item.kind === 'memory' || item.kind === 'residue')) {
    parts.push('It may echo later.');
  }
  if (choice.choiceType === 'dilemma') {
    parts.push('This tests what matters most.');
  }
  return parts.join(' ');
}

function formatChange(change: unknown): string {
  if (typeof change !== 'number' || !Number.isFinite(change)) return 'changes';
  return change > 0 ? `+${change}` : `${change}`;
}

function humanizeId(id: unknown, fallback = 'Unknown'): string {
  const value = typeof id === 'string' || typeof id === 'number' ? String(id) : fallback;
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
