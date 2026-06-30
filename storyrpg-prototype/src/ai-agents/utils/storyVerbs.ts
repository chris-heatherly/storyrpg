import type { ChoiceAffordanceSource, ConsequenceDomain } from '../../types';

export interface StoryVerb {
  verb: string;
  description: string;
  typicalSources: ChoiceAffordanceSource[];
  consequenceDomains: ConsequenceDomain[];
}

const GENERIC_VERBS: StoryVerb[] = [
  verb('press', 'Apply pressure to force a response.', ['skill', 'relationship'], ['information', 'relationship', 'leverage']),
  verb('reveal', 'Bring hidden truth into the open.', ['flag', 'callback'], ['information', 'reputation']),
  verb('bargain', 'Trade leverage, safety, or truth for progress.', ['item', 'relationship'], ['leverage', 'resource', 'relationship']),
  verb('protect', 'Shield someone or something from immediate harm.', ['identity', 'relationship'], ['relationship', 'identity', 'danger']),
  verb('risk', 'Accept danger for a cleaner chance at the goal.', ['identity', 'skill'], ['danger', 'identity']),
  verb('observe', 'Read the situation before acting.', ['skill', 'tag'], ['information', 'leverage']),
  verb('misdirect', 'Turn attention away from the real move.', ['skill', 'flag'], ['information', 'leverage', 'reputation']),
  verb('commit', 'Make a decision that cannot be cleanly walked back.', ['identity', 'callback'], ['identity', 'relationship']),
];

const GENRE_VERBS: Record<string, StoryVerb[]> = {
  heist: [
    verb('case', 'Study the target for exploitable weakness.', ['skill', 'flag'], ['information', 'leverage']),
    verb('forge', 'Create false proof or access.', ['skill', 'item'], ['leverage', 'reputation']),
    verb('tail', 'Follow someone without being noticed.', ['skill', 'flag'], ['information', 'danger']),
    verb('bribe', 'Buy cooperation at a social or resource cost.', ['item', 'relationship'], ['resource', 'relationship', 'leverage']),
    verb('distract', 'Split attention to open a path.', ['skill', 'relationship'], ['leverage', 'danger']),
    verb('crack', 'Break a lock, code, or system.', ['skill', 'item'], ['information', 'resource']),
    verb('plant', 'Place evidence or equipment for later leverage.', ['item', 'flag'], ['leverage', 'information']),
    verb('double-cross', 'Betray a pact to seize advantage.', ['relationship', 'callback'], ['relationship', 'reputation', 'leverage']),
  ],
  gothic: [
    verb('confess', 'Speak a buried truth aloud.', ['identity', 'callback'], ['identity', 'relationship']),
    verb('trespass', 'Cross a forbidden threshold.', ['identity', 'flag'], ['danger', 'information']),
    verb('invoke', 'Call on a power, oath, or name.', ['tag', 'item'], ['identity', 'danger', 'leverage']),
    verb('conceal', 'Hide guilt, evidence, or fear.', ['skill', 'flag'], ['information', 'reputation']),
    verb('commune', 'Reach toward the dead, divine, or uncanny.', ['tag', 'item'], ['information', 'identity']),
    verb('exhume', 'Unearth what was meant to stay buried.', ['skill', 'flag'], ['information', 'danger']),
    verb('absolve', 'Offer mercy or release from guilt.', ['identity', 'relationship'], ['relationship', 'identity']),
    verb('bind', 'Create an oath, ward, or obligation.', ['item', 'relationship'], ['relationship', 'identity']),
  ],
  fantasy: [
    verb('parley', 'Seek progress through formal speech or truce.', ['relationship', 'identity'], ['relationship', 'information']),
    verb('swear', 'Bind the self to an oath.', ['identity', 'callback'], ['identity', 'reputation']),
    verb('invoke', 'Call on magic, lineage, faith, or law.', ['tag', 'item'], ['leverage', 'identity']),
    verb('track', 'Follow signs through dangerous ground.', ['skill', 'tag'], ['information', 'danger']),
    verb('scout', 'Find the safer path before committing.', ['skill', 'flag'], ['information', 'leverage']),
    verb('duel', 'Settle the moment through direct challenge.', ['identity', 'skill'], ['reputation', 'danger']),
    verb('bargain', 'Trade favor, oath, or relic for aid.', ['item', 'relationship'], ['resource', 'relationship']),
    verb('sabotage', 'Undermine an enemy before the clash.', ['skill', 'flag'], ['leverage', 'danger']),
  ],
  thriller: [
    verb('tail', 'Follow a target through risk and uncertainty.', ['skill', 'flag'], ['information', 'danger']),
    verb('pressure', 'Force movement through urgency or threat.', ['skill', 'relationship'], ['information', 'relationship']),
    verb('expose', 'Reveal a secret before it can be controlled.', ['flag', 'callback'], ['information', 'reputation']),
    verb('misdirect', 'Make the wrong thing look important.', ['skill', 'flag'], ['leverage', 'information']),
    verb('surveil', 'Watch without being seen.', ['skill', 'item'], ['information', 'danger']),
    verb('leak', 'Release information through indirect channels.', ['flag', 'relationship'], ['reputation', 'information']),
    verb('coerce', 'Turn fear into compliance.', ['relationship', 'skill'], ['relationship', 'leverage']),
    verb('vanish', 'Drop out of sight at a cost.', ['skill', 'item'], ['danger', 'resource']),
  ],
  intrigue: [
    verb('flatter', 'Offer admiration as a tool.', ['relationship', 'skill'], ['relationship', 'leverage']),
    verb('blackmail', 'Use a secret as pressure.', ['flag', 'callback'], ['leverage', 'relationship']),
    verb('petition', 'Ask through formal authority or custom.', ['relationship', 'tag'], ['reputation', 'relationship']),
    verb('duel', 'Turn conflict into public ritual.', ['identity', 'skill'], ['reputation', 'danger']),
    verb('expose', 'Make hidden wrongdoing public.', ['flag', 'callback'], ['information', 'reputation']),
    verb('pledge', 'Trade future loyalty for present aid.', ['identity', 'relationship'], ['relationship', 'identity']),
    verb('betray', 'Break faith for advantage.', ['relationship', 'callback'], ['relationship', 'leverage']),
    verb('broker', 'Make yourself necessary between rivals.', ['relationship', 'skill'], ['leverage', 'reputation']),
  ],
};

const GENRE_ALIASES: Array<{ pattern: RegExp; key: keyof typeof GENRE_VERBS }> = [
  { pattern: /heist|crime|caper/i, key: 'heist' },
  { pattern: /gothic|horror|haunt|vampire/i, key: 'gothic' },
  { pattern: /fantasy|sword|magic|myth/i, key: 'fantasy' },
  { pattern: /thriller|spy|conspiracy|modern/i, key: 'thriller' },
  { pattern: /intrigue|court|politic|royal/i, key: 'intrigue' },
];

export function deriveStoryVerbs(input: {
  genre: string;
  tone?: string;
  sourceSummary?: string;
  worldContext?: string;
}): StoryVerb[] {
  const haystack = [
    input.genre,
    input.tone,
    input.sourceSummary,
    input.worldContext,
  ].filter(Boolean).join(' ');

  const matched = new Map<string, StoryVerb>();
  for (const alias of GENRE_ALIASES) {
    if (alias.pattern.test(haystack)) {
      for (const storyVerb of GENRE_VERBS[alias.key]) {
        matched.set(storyVerb.verb, storyVerb);
      }
    }
  }

  for (const storyVerb of GENERIC_VERBS) {
    matched.set(storyVerb.verb, storyVerb);
  }

  return Array.from(matched.values()).slice(0, 12);
}

function verb(
  name: string,
  description: string,
  typicalSources: ChoiceAffordanceSource[],
  consequenceDomains: ConsequenceDomain[],
): StoryVerb {
  return {
    verb: name,
    description,
    typicalSources,
    consequenceDomains,
  };
}
