import type { Episode, Scene, Story } from '../../types';
import type { EpisodeBlueprint } from '../agents/StoryArchitect';
import type { GeneratedBeat, SceneContent } from '../agents/SceneWriter';
import { validateChoiceProducerOutput, validateEncounterProducerOutput, validateSceneProducerOutput } from '../pipeline/producerBlockerChecks';
import { FinalStoryContractValidator } from '../validators/FinalStoryContractValidator';
import { RelationshipArcLedgerValidator } from '../validators/RelationshipArcLedgerValidator';
import { RouteContinuityValidator } from '../validators/RouteContinuityValidator';
import { SceneGraphBranchValidator } from '../validators/SceneGraphBranchValidator';
import { SetupPayoffValidator } from '../validators/SetupPayoffValidator';
import { TwistQualityValidator } from '../validators/TwistQualityValidator';

export interface DeterministicQualityFinding {
  source: string;
  type: string;
  message: string;
}

export interface DeterministicTreatmentFixture {
  id: string;
  treatment: string;
  expectedPublishable: boolean;
  expectedFindingTypes: string[];
  build: () => Story;
  focusedChecks?: (story: Story) => DeterministicQualityFinding[];
}

export interface DeterministicSealResult {
  publishable: boolean;
  findings: DeterministicQualityFinding[];
}

function finding(source: string, type: string, message: string): DeterministicQualityFinding {
  return { source, type, message };
}

function baseStory(scenes: Scene[], title = 'Reliable Quality Fixture'): Story {
  return {
    id: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    title,
    genre: 'supernatural romance',
    synopsis: 'A deterministic treatment-derived sealing fixture.',
    coverImage: '',
    initialState: {
      attributes: {} as never,
      skills: { perception: 10, empathy: 10 } as never,
      tags: [],
      inventory: [],
    },
    npcs: [{ id: 'mika', name: 'Mika', description: 'A wary new acquaintance.', role: 'ally' }],
    episodes: [{
      id: 'episode-1',
      number: 1,
      title: 'Episode 1',
      synopsis: 'A compact deterministic episode.',
      coverImage: '',
      startingSceneId: scenes[0]?.id ?? '',
      scenes,
    }],
  } as Story;
}

function simpleScene(id: string, text: string, nextSceneId?: string): Scene {
  return {
    id,
    name: id,
    startingBeatId: `${id}-beat`,
    leadsTo: nextSceneId ? [nextSceneId] : [],
    beats: [{
      id: `${id}-beat`,
      text,
      ...(nextSceneId ? { nextSceneId } : {}),
    }],
  } as Scene;
}

function relationshipPacingFixture(premature: boolean): Story {
  const scene = simpleScene(
    'club-formation',
    premature
      ? 'You have only just met Mika, but she grins. The Dusk Club is official now, and you are trusted friends.'
      : 'You have only just met Mika. She raises her glass like an invitation and waits to see whether you accept.',
  );
  scene.relationshipPacing = [{
    id: 'dusk-club-pacing',
    source: 'treatment',
    npcId: 'mika',
    startStage: 'unmet',
    targetStage: 'spark',
    minScenesSinceIntroduction: 0,
    maxDeltaThisScene: 0,
    requiredEvidence: ['stage the first invitation'],
    allowedLabels: ['invitation', 'dare'],
    blockedLabels: ['official', 'trusted friends'],
    mechanicDimensions: [],
  }];
  return baseStory([scene], 'Bite Me Relationship Pacing');
}

function relationshipCheck(story: Story): DeterministicQualityFinding[] {
  const result = new RelationshipArcLedgerValidator().validate({ story, treatmentSourced: true });
  return result.issues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => finding('RelationshipArcLedgerValidator', 'premature_relationship_label', issue.message));
}

function malformedChoiceStory(): Story {
  const story = relationshipPacingFixture(false);
  story.episodes[0].scenes[0].beats[0].choices = [{
    id: 'join-club',
    text: 'Take the empty chair.',
    consequences: [{ type: 'relationship', npcId: 'dusk-club', flag: 'friends', value: true }] as never,
  }];
  return story;
}

function chronologyStory(inverted: boolean): Story {
  const arrival = simpleScene(
    'arrival',
    'You arrive in Bucharest with one suitcase and a cracked phone.',
    inverted ? 'walk-home' : 'rooftop',
  );
  const rooftop = simpleScene(
    'rooftop',
    'You meet the charcoal-suited stranger for the first time above the private club.',
    inverted ? undefined : 'walk-home',
  );
  const walkHome = simpleScene(
    'walk-home',
    'You cross the slick park paths while the stranger guides you home with one steady hand.',
    inverted ? 'rooftop' : undefined,
  );
  return baseStory(inverted ? [arrival, walkHome, rooftop] : [arrival, rooftop, walkHome], 'Bite Me Event Chronology');
}

function chronologyCheck(story: Story): DeterministicQualityFinding[] {
  return new RouteContinuityValidator().validate({ story }).issues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => finding('RouteContinuityValidator', issue.type, issue.message));
}

function sceneContent(sceneId: string, beats: GeneratedBeat[]): SceneContent {
  return {
    sceneId,
    sceneName: sceneId,
    startingBeatId: beats[0]?.id ?? '',
    beats,
    moodProgression: ['tense'],
    charactersInvolved: ['protagonist'],
    keyMoments: [],
    continuityNotes: [],
  };
}

function twistObligationCheck(): DeterministicQualityFinding[] {
  const sceneContents = [
    sceneContent('setup', [{ id: 'setup-beat', text: 'You notice the sealed envelope, but no clue marks it.' }]),
    sceneContent('reveal', [{
      id: 'reveal-beat',
      text: 'You open the envelope and discover the mentor signed the threat.',
      plotPointType: 'revelation',
      paysOffThreadId: 'mentor-letter',
    }]),
  ];
  const twist = new TwistQualityValidator().validate({ sceneContents });
  const payoff = new SetupPayoffValidator().validate({
    ledger: {
      threads: [{
        id: 'mentor-letter',
        kind: 'promise',
        priority: 'major',
        label: 'The mentor letter',
        description: 'The letter reveals the mentor authored the threat.',
        plants: [],
        payoffs: [],
        status: 'planned',
      }],
    },
    sceneContents,
  });
  return [
    ...twist.issues
      .filter((issue) => issue.severity === 'error')
      .map((issue) => finding('TwistQualityValidator', 'unforeshadowed_twist', issue.message)),
    ...payoff.issues
      .filter((issue) => issue.severity === 'error')
      .map((issue) => finding('SetupPayoffValidator', 'unplanted_obligation_payoff', issue.message)),
  ];
}

function reconvergenceFixture(): { episode: Episode; blueprint: EpisodeBlueprint } {
  const start = {
    ...simpleScene('start', 'You choose which truth to carry.'),
    leadsTo: ['trust-path', 'power-path'],
    beats: [{
      id: 'start-beat',
      text: 'You choose which truth to carry.',
      choices: [
        { id: 'trust', text: 'Trust Mika.', nextSceneId: 'trust-path', consequences: [] },
        { id: 'power', text: 'Take the key.', nextSceneId: 'power-path', consequences: [] },
      ],
    }],
  } as Scene;
  const trust = simpleScene('trust-path', 'You give Mika the truth.', 'merge');
  const power = simpleScene('power-path', 'You pocket the key.', 'merge');
  const merge = { ...simpleScene('merge', 'You enter the same room as if the choice never happened.'), isBottleneck: true };
  const episode = baseStory([start, trust, power, merge]).episodes[0];
  const blueprint = {
    episodeId: episode.id,
    title: episode.title,
    synopsis: episode.synopsis,
    scenes: [
      { id: 'start', name: 'start', description: 'start', leadsTo: ['trust-path', 'power-path'], choicePoint: { type: 'dilemma', branches: true } },
      { id: 'trust-path', name: 'trust-path', description: 'trust', leadsTo: ['merge'] },
      { id: 'power-path', name: 'power-path', description: 'power', leadsTo: ['merge'] },
      { id: 'merge', name: 'merge', description: 'merge', leadsTo: [] },
    ],
    startingSceneId: 'start',
  } as unknown as EpisodeBlueprint;
  return { episode, blueprint };
}

function reconvergenceCheck(): DeterministicQualityFinding[] {
  const { episode, blueprint } = reconvergenceFixture();
  return new SceneGraphBranchValidator().validateEpisode(episode, blueprint, { requireChoiceBridge: false }).issues
    .filter((issue) => issue.severity === 'error' && issue.type === 'missing_branch_residue')
    .map((issue) => finding('SceneGraphBranchValidator', issue.type, issue.message));
}

/**
 * Offline replay seam for the Bite Me ep1 seal, not a provider-quality sample.
 * The seed independently varies safe authored details and all state ids while
 * preserving the treatment's arrival → club → attack/rescue → publication order.
 */
export function biteMeEpisodeOneSealCandidate(seed: number): Story {
  const variants = [
    ['one rain-dark suitcase', 'a chipped blue glass', 'the post begins gathering replies'],
    ['two battered suitcases', 'a narrow copper cup', 'the essay begins drawing strangers'],
    ['a suitcase and a laptop bag', 'a smoke-grey tumbler', 'the story begins moving through the city'],
  ];
  const selected = variants[Math.abs(seed) % variants.length];
  const scenes = [
    simpleScene('arrival', `You arrive in Bucharest carrying ${selected[0]}.`, 'club'),
    simpleScene('club', `You meet Mika over ${selected[1]}, and the Dusk Club name lands as an invitation rather than a promise.`, 'attack'),
    simpleScene('attack', 'You cross Cișmigiu after midnight. Hands catch your coat; a stranger breaks their grip and walks you to your threshold.', 'aftermath'),
    simpleScene('aftermath', `You write what happened without replaying it, and ${selected[2]}.`),
  ];
  const choiceBeat = scenes[1].beats[0];
  choiceBeat.choices = [
    {
      id: `accept-${seed}`,
      text: 'Raise your glass to the invitation.',
      consequences: [{ type: 'relationship', npcId: 'mika', dimension: 'trust', change: 2 }],
      reactionText: 'Mika answers with a quick, measuring smile.',
      outcomeTexts: {
        success: 'The joke settles into the beginning of a pact.',
        partial: 'The invitation stays open, though nobody calls it settled.',
        failure: 'The glasses touch, but the room keeps its distance.',
      },
    },
    {
      id: `question-${seed}`,
      text: 'Ask what the name is supposed to cost.',
      consequences: [{ type: 'relationship', npcId: 'mika', dimension: 'respect', change: 2 }],
      reactionText: 'Mika turns the question over before answering.',
      outcomeTexts: {
        success: 'Her answer gives the joke an honest edge.',
        partial: 'She gives you half an answer and keeps the rest.',
        failure: 'The question lands harder than you intend.',
      },
    },
    {
      id: `wait-${seed}`,
      text: 'Let the name remain only a dare tonight.',
      consequences: [{ type: 'setFlag', flag: `dusk_club_dare_${seed}`, value: true }],
      reactionText: 'You leave the name balanced between the glasses.',
      outcomeTexts: {
        success: 'Nobody presses, and the restraint earns its own warmth.',
        partial: 'The moment passes without closing.',
        failure: 'Silence makes the unfinished invitation sharper.',
      },
    },
  ] as never;
  return baseStory(scenes, 'Bite Me');
}

export async function evaluateDeterministicSeal(
  story: Story,
  focusedChecks?: (story: Story) => DeterministicQualityFinding[],
): Promise<DeterministicSealResult> {
  const findings: DeterministicQualityFinding[] = [];
  for (const episode of story.episodes) {
    for (const scene of episode.scenes) {
      findings.push(...validateSceneProducerOutput(scene.id, scene).map((issue) =>
        finding('ProducerPhaseBlockerValidator', issue.type, `${issue.fieldPath}: ${issue.message}`)));
      const choiceSet = { choices: scene.beats.flatMap((beat) => beat.choices ?? []) };
      findings.push(...validateChoiceProducerOutput(scene.id, choiceSet).map((issue) =>
        finding('ProducerPhaseBlockerValidator', issue.type, `${issue.fieldPath}: ${issue.message}`)));
      if (scene.encounter) {
        findings.push(...validateEncounterProducerOutput(scene.id, scene.encounter).map((issue) =>
          finding('ProducerPhaseBlockerValidator', issue.type, `${issue.fieldPath}: ${issue.message}`)));
      }
    }
  }
  findings.push(...(focusedChecks?.(story) ?? []));
  const report = await new FinalStoryContractValidator().validate({
    story,
    treatmentSourced: true,
    mode: 'strict',
  });
  findings.push(...report.blockingIssues.map((issue) =>
    finding(issue.validator ?? 'FinalStoryContractValidator', issue.type, issue.message)));
  return { publishable: findings.length === 0, findings };
}

export const CROSS_TREATMENT_FIXTURES: readonly DeterministicTreatmentFixture[] = [
  {
    id: 'earned-relationship-language',
    treatment: 'Urban first-meeting romance',
    expectedPublishable: true,
    expectedFindingTypes: [],
    build: () => relationshipPacingFixture(false),
    focusedChecks: relationshipCheck,
  },
  {
    id: 'malformed-relationship-consequence',
    treatment: 'Found-family club invitation',
    expectedPublishable: false,
    expectedFindingTypes: ['malformed_relationship_consequence'],
    build: malformedChoiceStory,
  },
  {
    id: 'premature-relationship-label',
    treatment: 'Slow-burn first meeting',
    expectedPublishable: false,
    expectedFindingTypes: ['premature_relationship_label'],
    build: () => relationshipPacingFixture(true),
    focusedChecks: relationshipCheck,
  },
  {
    id: 'encounter-provenance-leak',
    treatment: 'Authored danger encounter',
    expectedPublishable: false,
    expectedFindingTypes: ['unsafe_fallback_prose'],
    build: () => {
      const story = baseStory([simpleScene('encounter', 'You hold the stair while the lock gives way.')], 'Siege Encounter');
      story.episodes[0].scenes[0].encounter = {
        description: 'You face this pressure: survive the authored encounter synopsis.',
        sourceSynopsis: 'Author-only treatment text remains provenance, never reader prose.',
      } as never;
      return story;
    },
  },
  {
    id: 'causal-event-ordering',
    treatment: 'Rescue-after-first-meeting chronology',
    expectedPublishable: false,
    expectedFindingTypes: ['route_chronology_violation'],
    build: () => chronologyStory(true),
    focusedChecks: chronologyCheck,
  },
  {
    id: 'unplanted-twist-obligation',
    treatment: 'Mystery reveal with a promised clue',
    expectedPublishable: false,
    expectedFindingTypes: ['unforeshadowed_twist', 'unplanted_obligation_payoff'],
    build: () => baseStory([simpleScene('reveal', 'You open the letter and find the mentor signed the threat.')], 'Mystery Twist'),
    focusedChecks: () => twistObligationCheck(),
  },
  {
    id: 'cosmetic-reconvergence',
    treatment: 'Branch-and-bottleneck dilemma',
    expectedPublishable: false,
    expectedFindingTypes: ['missing_branch_residue'],
    build: () => baseStory(reconvergenceFixture().episode.scenes, 'Reconvergence'),
    focusedChecks: () => reconvergenceCheck(),
  },
] as const;
