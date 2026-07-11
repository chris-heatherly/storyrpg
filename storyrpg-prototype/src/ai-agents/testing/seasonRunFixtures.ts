/**
 * Scripted LLM fixtures for the MULTI-EPISODE (season) prompt-snapshot
 * characterization test (FullStoryPipeline.promptSnapshot.season.test.ts).
 *
 * Extends the linear full-run coverage (fullRunFixtures.ts) to a 2-episode
 * `generateMultipleEpisodes` run so the season-scoped machinery the
 * ContentGeneration extraction must preserve is characterized:
 *   - shared world/character foundation built once, episodes generated
 *     sequentially against it,
 *   - season canon sealing + the established-canon prompt block flowing into
 *     episode 2,
 *   - the callback ledger carrying across episodes,
 *   - previousSummary handoff (episode 2's brief carries a summary of the
 *     generated episode 1), and
 *   - ThreadPlanner + TwistArchitect (enabled via
 *     generation.enableThreadAndTwistPlanning) authoring per-episode plans.
 *
 * Episode 1 reuses the linear blueprint/scenes (scene-1..3); episode 2 is a
 * fresh linear 3-scene episode (scene-4..6) in the same cast and world.
 */

import type { LlmTransportRequest } from '../agents/BaseAgent';
import type { ScriptedFixtureMap } from './promptCapture';
import { requestText, worldBible, characterBible, sceneFixture } from './fullRunFixtures';

// ---------------------------------------------------------------- analysis

/**
 * Minimal SourceMaterialAnalysis for a 2-episode season. Field choices mirror
 * what generateMultipleEpisodes and the brief-from-analysis helpers actually
 * read: setting/keyLocations (world brief), protagonist/majorCharacters
 * (character brief), episodeBreakdown + totalEstimatedEpisodes (episode loop),
 * anchors/storyCircle (season spine context).
 */
export function buildSeasonAnalysis(): Record<string, unknown> {
  return {
    sourceTitle: 'The Locked Wing',
    sourceFormat: 'prompt',
    genre: 'gothic mystery',
    tone: 'tense, literary',
    themes: ['trust', 'curiosity'],
    setting: {
      timePeriod: 'gaslamp era',
      location: 'Greyharbor, a cliffside harbor town',
      worldDetails: 'A salt-worn manor on the cliffs hides a sealed east wing.',
    },
    storyArcs: [
      {
        id: 'arc-1',
        name: 'The east wing\'s secret',
        description: 'Mara uncovers why Greyharbor\'s east wing was sealed and who profits from the silence.',
        estimatedEpisodeRange: { start: 1, end: 2 },
      },
    ],
    anchors: {
      stakes: 'Edric\'s loyalty and Mara\'s integrity against the family\'s buried debt.',
      goal: 'Learn what the sealed east wing hides and decide what to do with it.',
      incitingIncident: 'The catalogue commission excludes the east wing.',
      climax: 'Mara confronts the family\'s lawyer with the gallery ledger.',
    },
    storyCircle: {
      you: 'The catalogue commission excludes the east wing.',
      need: 'Mara needs to know what kind of silence she has been hired to preserve.',
      go: 'The portrait swings inward on a hidden passage.',
      search: 'Edric appears in the library doorway and forces Mara to improvise.',
      find: 'The ledger names the man who sealed the wing.',
      take: 'The lawyer arrives a day early.',
      return: 'Mara confronts the family\'s lawyer with the gallery ledger.',
      change: 'The gate, the cliff path, and the commission\'s true price.',
    },
    protagonist: {
      id: 'prot-1',
      name: 'Mara Voss',
      description: 'A hired archivist who reads houses the way others read faces.',
      arc: 'From a cataloguer of other people\'s secrets to someone who decides what a secret costs.',
    },
    majorCharacters: [
      {
        id: 'npc-1',
        name: 'Edric Hale',
        role: 'rival',
        description: 'The manor\'s steward, exact in everything except his answers.',
        importance: 'core',
        firstAppearance: 1,
      },
    ],
    keyLocations: [
      {
        id: 'loc-1',
        name: 'Greyharbor Manor',
        description: 'A salt-worn manor on the cliffs above the harbor town.',
        importance: 'major',
        firstAppearance: 1,
      },
      {
        id: 'loc-2',
        name: 'East Garden',
        description: 'An overgrown walled garden behind the manor.',
        importance: 'major',
        firstAppearance: 1,
      },
    ],
    episodeBreakdown: [
      {
        episodeNumber: 1,
        title: 'The Locked Wing',
        synopsis: 'Mara finds the passage behind the library portrait and must choose how to face Edric.',
        sourceChapters: [],
        sourceSummary: 'Discovery of the hidden passage and the standoff with the steward.',
        plotPoints: [
          {
            id: 'pp-1',
            description: 'Mara discovers the hidden passage behind the library portrait.',
            type: 'inciting_incident',
            importance: 'critical',
            targetEpisode: 1,
            charactersInvolved: ['prot-1', 'npc-1'],
          },
        ],
        mainCharacters: ['prot-1', 'npc-1'],
        supportingCharacters: [],
        locations: ['loc-1', 'loc-2'],
        estimatedSceneCount: 3,
        estimatedChoiceCount: 2,
        storyCircleRole: [
          { beat: 'you', roleKind: 'primary', source: 'distribution' },
          { beat: 'need', roleKind: 'primary', source: 'distribution' },
          { beat: 'go', roleKind: 'primary', source: 'distribution' },
          { beat: 'search', roleKind: 'primary', source: 'distribution' },
        ],
        narrativeFunction: {
          setup: 'The commission that forbids the one wing worth reading.',
          conflict: 'The hidden passage against the steward guarding it.',
          resolution: 'Mara reaches the east garden with the night\'s first answer.',
        },
      },
      {
        episodeNumber: 2,
        title: 'The Sealed Ledger',
        synopsis: 'The gallery ledger names the man who sealed the wing, and the family\'s lawyer arrives a day early to take it back.',
        sourceChapters: [],
        sourceSummary: 'The ledger\'s revelation and the lawyer\'s counter-move.',
        plotPoints: [
          {
            id: 'pp-2',
            description: 'The ledger names the outside authority who sealed the east wing.',
            type: 'revelation',
            importance: 'critical',
            targetEpisode: 2,
            charactersInvolved: ['prot-1', 'npc-1'],
          },
        ],
        mainCharacters: ['prot-1', 'npc-1'],
        supportingCharacters: [],
        locations: ['loc-1', 'loc-2'],
        estimatedSceneCount: 3,
        estimatedChoiceCount: 2,
        storyCircleRole: [
          { beat: 'find', roleKind: 'primary', source: 'distribution' },
          { beat: 'take', roleKind: 'primary', source: 'distribution' },
          { beat: 'return', roleKind: 'primary', source: 'distribution' },
          { beat: 'change', roleKind: 'primary', source: 'distribution' },
        ],
        narrativeFunction: {
          setup: 'The ledger Mara carried out of the gallery.',
          conflict: 'The lawyer\'s early arrival against Mara\'s half-finished reading of it.',
          resolution: 'Mara decides who gets the ledger — and at what price.',
        },
      },
    ],
    totalEstimatedEpisodes: 2,
    analysisTimestamp: new Date(0),
    confidenceScore: 90,
    warnings: [],
  };
}

// ---------------------------------------------------------------- blueprints

const episode1Blueprint = {
  episodeId: 'episode-1',
  title: 'The Locked Wing',
  synopsis: 'Mara finds the passage behind the library portrait and must choose how to face Edric.',
  arc: {
    hook: 'The catalogue commission excludes the east wing.',
    plotTurn1: 'The portrait swings inward on a hidden passage.',
    pinch1: 'Edric appears in the library doorway.',
    midpoint: 'Mara chooses how to face him.',
    pinch2: 'The passage must be taken tonight or never.',
    climax: 'Mara crosses into the dark with what she has chosen.',
    resolution: 'The garden, the gate, and what comes next.',
  },
  themes: ['trust', 'curiosity'],
  startingSceneId: 'scene-1',
  bottleneckScenes: ['scene-1', 'scene-3'],
  scenes: [
    {
      id: 'scene-1',
      name: 'The Hidden Door',
      description:
        'Mara discovers a secret passage behind a portrait in the library while Edric watches from the doorway.',
      location: 'loc-1',
      mood: 'tense',
      purpose: 'bottleneck',
      dramaticQuestion: 'Can Mara learn what the portrait hides without losing Edric\'s tolerance?',
      wantVsNeed: 'Open the passage now vs. understand the man guarding it.',
      conflictEngine: 'Edric stands between Mara and the house\'s buried memory.',
      npcsPresent: ['npc-1'],
      narrativeFunction: 'Discovery and pressure.',
      keyBeats: [
        'The portrait swings inward, revealing darkness.',
        'Edric steps forward with a knowing look.',
      ],
      dramaticStructure: {
        question: 'Will Mara open the passage with Edric watching?',
        turn: 'The portrait swings open and Edric steps out of the dark doorway.',
        pressurePeak: 'The silent standoff over the open passage.',
        changedState: 'The passage is no longer secret between them.',
      },
      leadsTo: ['scene-2'],
      choicePoint: {
        type: 'relationship',
        branches: false,
        stakes: {
          want: 'Enter the passage and learn the truth',
          cost: 'Defy Edric openly or deceive him',
          identity: 'Scholar or trespasser',
        },
        description: 'Slip into the dark passage, or face Edric and ask him outright.',
        optionHints: [
          'Step through the hidden door before he can object.',
          'Confront Edric about what the household is hiding.',
        ],
        consequenceDomain: 'relationship',
        reminderPlan: {
          immediate: 'Edric reacts to her choice before the candle gutters.',
          shortTerm: 'The next scenes carry the residue of how she treated him.',
        },
      },
    },
    {
      id: 'scene-2',
      name: 'The Steward\'s Answer',
      description:
        'In the passage mouth, Edric gives Mara as much truth as he dares, and she decides what to make of it.',
      location: 'loc-1',
      mood: 'charged',
      purpose: 'transition',
      dramaticQuestion: 'How much of Edric\'s account does Mara accept?',
      wantVsNeed: 'A clean answer vs. an honest one.',
      conflictEngine: 'Every answer Edric gives opens a costlier question.',
      npcsPresent: ['npc-1'],
      narrativeFunction: 'Revelation under pressure.',
      keyBeats: [
        'Edric admits the east wing was sealed for a reason he will not name.',
        'The tenth bell begins to toll below.',
      ],
      dramaticStructure: {
        question: 'How much truth will Edric surrender?',
        turn: 'He admits the east wing was sealed by someone outside the family.',
        pressurePeak: 'The tenth bell tolls while the one name stays unsaid.',
        changedState: 'Mara knows the sealing was imposed, and Edric knows she knows.',
      },
      leadsTo: ['scene-3'],
      choicePoint: {
        type: 'expression',
        branches: false,
        stakes: {
          want: 'Hold the thread of his confession without breaking it',
          cost: 'Showing him how much she already knows',
          identity: 'Interrogator or confidant',
        },
        description: 'Choose how Mara receives the steward\'s half-truth.',
        optionHints: [
          'Press him on the part he is leaving out.',
          'Accept the half-truth and let him keep his dignity.',
        ],
        consequenceDomain: 'relationship',
        reminderPlan: {
          immediate: 'Edric\'s posture answers her tone.',
          shortTerm: 'The garden scene reflects what passed between them.',
        },
      },
    },
    {
      id: 'scene-3',
      name: 'The East Garden',
      description:
        'The passage lets out into the walled garden. Whatever Mara chose, she is alone now with the gate and the night.',
      location: 'loc-2',
      mood: 'mysterious',
      purpose: 'bottleneck',
      dramaticQuestion: 'What will Mara do with what the passage gave her?',
      wantVsNeed: 'Escape with the ledger vs. go back and finish what she started.',
      conflictEngine: 'The iron gate is locked and the household will wake at the tenth bell.',
      npcsPresent: [],
      narrativeFunction: 'Aftermath and opening outward.',
      keyBeats: [
        'The passage opens into moonlight.',
        'The iron gate stands between Mara and the cliff path.',
      ],
      dramaticStructure: {
        question: 'What will Mara do with what the passage gave her?',
        turn: 'The hidden door opens onto the garden and an unlocked night.',
        pressurePeak: 'Her hand on the gate latch as the house wakes.',
        changedState: 'Mara is outside the house\'s control for the first time.',
      },
      leadsTo: [],
    },
  ],
  suggestedFlags: [
    {
      name: 'found_passage',
      description: 'Set when Mara discovers the passage behind the portrait.',
    },
  ],
  suggestedScores: [],
  suggestedTags: [],
  narrativePromises: [
    {
      description: 'Edric knows more about the passage than he admits.',
      setupScene: 'scene-1',
      importance: 'major',
    },
  ],
};

const episode2Blueprint = {
  episodeId: 'episode-2',
  title: 'The Sealed Ledger',
  synopsis:
    'The gallery ledger names the man who sealed the wing, and the family\'s lawyer arrives a day early to take it back.',
  arc: {
    hook: 'The ledger Mara carried out of the gallery will not stay closed.',
    plotTurn1: 'The ledger names the outside authority who sealed the wing.',
    pinch1: 'The lawyer\'s coach is on the cliff road a day early.',
    midpoint: 'Mara chooses what the ledger is for.',
    pinch2: 'Edric must declare whose side his keys are on.',
    climax: 'Mara faces the lawyer with the ledger between them.',
    resolution: 'The cliff path, and the commission\'s true price.',
  },
  themes: ['trust', 'curiosity'],
  startingSceneId: 'scene-4',
  bottleneckScenes: ['scene-4', 'scene-6'],
  scenes: [
    {
      id: 'scene-4',
      name: 'The Salt Cellar',
      description:
        'By lamplight among the manor\'s stores, Mara reads the gallery ledger and finds the name that sealed the east wing.',
      location: 'loc-1',
      mood: 'hushed',
      purpose: 'bottleneck',
      dramaticQuestion: 'What does the ledger actually prove, and to whom?',
      wantVsNeed: 'The name behind the seal vs. understanding what knowing it makes her.',
      conflictEngine: 'Every page read is a page the household could catch her reading.',
      npcsPresent: ['npc-1'],
      narrativeFunction: 'Revelation that resets the season\'s stakes.',
      keyBeats: [
        'The ledger\'s middle pages are written in a second hand.',
        'The name at the bottom of the column is not the family\'s.',
      ],
      dramaticStructure: {
        question: 'Will the ledger give up its name before the house notices it is gone?',
        turn: 'The second hand in the margins resolves into a lawyer\'s signature.',
        pressurePeak: 'Footsteps on the cellar stairs as she reaches the final column.',
        changedState: 'Mara knows who sealed the wing — and that he is still paid to keep it sealed.',
      },
      leadsTo: ['scene-5'],
      choicePoint: {
        type: 'relationship',
        branches: false,
        stakes: {
          want: 'Make sense of the name before anyone knows she has it',
          cost: 'Trusting Edric with what the ledger says about his employer',
          identity: 'A cataloguer of secrets or a keeper of them',
        },
        description: 'Edric finds her with the open ledger — decide what to tell him.',
        optionHints: [
          'Show him the lawyer\'s signature and watch his face.',
          'Close the ledger and claim she found it filed wrong.',
        ],
        consequenceDomain: 'relationship',
        reminderPlan: {
          immediate: 'Edric answers what she shares — or what she hides.',
          shortTerm: 'The lawyer\'s visit lands differently depending on what Edric knows.',
        },
      },
    },
    {
      id: 'scene-5',
      name: 'The Lawyer\'s Visit',
      description:
        'The family\'s lawyer arrives a day early, all courtesy, and asks to see how the catalogue is coming along.',
      location: 'loc-1',
      mood: 'coiled',
      purpose: 'transition',
      dramaticQuestion: 'Does the lawyer know the ledger has been found?',
      wantVsNeed: 'Survive the interview vs. learn why he came early.',
      conflictEngine: 'A polite interrogation where every honest answer is a confession.',
      npcsPresent: ['npc-1'],
      narrativeFunction: 'Pressure made flesh; the antagonist\'s counter-move.',
      keyBeats: [
        'The lawyer praises the catalogue\'s thoroughness with a list of rooms she never reported entering.',
        'Edric pours the tea a half-second too slowly.',
      ],
      dramaticStructure: {
        question: 'Can Mara read the lawyer faster than he reads her?',
        turn: 'His list of rooms includes the gallery — a day before anyone could have told him.',
        pressurePeak: 'The pause after he asks, smiling, whether old houses keep their own accounts.',
        changedState: 'Mara knows the lawyer is the name in the ledger, and he suspects she knows.',
      },
      leadsTo: ['scene-6'],
      choicePoint: {
        type: 'expression',
        branches: false,
        stakes: {
          want: 'Give him nothing while taking his measure',
          cost: 'Every evasion he catalogues against her',
          identity: 'The archivist who cannot be read',
        },
        description: 'Choose the face Mara shows the man who sealed the wing.',
        optionHints: [
          'Answer his list with cheerful, exact inventory talk.',
          'Let one true thing slip and watch where it lands.',
        ],
        consequenceDomain: 'relationship',
        reminderPlan: {
          immediate: 'The lawyer\'s smile recalibrates around her answer.',
          shortTerm: 'The cliff path scene carries whether she gave him anything.',
        },
      },
    },
    {
      id: 'scene-6',
      name: 'The Cliff Path',
      description:
        'Above the harbor at dusk, Mara weighs the ledger, the lawyer\'s offer, and the gate key Edric left in her door.',
      location: 'loc-2',
      mood: 'resolute',
      purpose: 'bottleneck',
      dramaticQuestion: 'Who gets the ledger?',
      wantVsNeed: 'Leave with proof vs. stay and finish the catalogue honestly.',
      conflictEngine: 'The cliff path goes to the village, the manor, or the lawyer\'s coach — not all three.',
      npcsPresent: [],
      narrativeFunction: 'Season climax and the cost of the answer.',
      keyBeats: [
        'The gate key turns out to be Edric\'s own ring key.',
        'The lawyer\'s coach lamps come up the cliff road.',
      ],
      dramaticStructure: {
        question: 'What is the ledger for, now that she could use it?',
        turn: 'Edric\'s own key in her door — the steward chose her over the house.',
        pressurePeak: 'Coach lamps rising as her hand closes on the ledger\'s spine.',
        changedState: 'Mara has decided what kind of archivist she is, and the season knows it.',
      },
      leadsTo: [],
    },
  ],
  suggestedFlags: [
    {
      name: 'read_ledger',
      description: 'Set when Mara reads the gallery ledger to its final column.',
    },
  ],
  suggestedScores: [],
  suggestedTags: [],
  narrativePromises: [
    {
      description: 'The lawyer\'s early arrival is answered before the season ends.',
      setupScene: 'scene-5',
      importance: 'major',
    },
  ],
};

// ---------------------------------------------------------------- branches

const episode1BranchAnalysis = {
  episodeId: 'episode-1',
  branchPaths: [
    {
      id: 'branch-1',
      name: 'The night of the passage',
      description: 'Mara finds the passage, hears Edric out, and reaches the garden.',
      startSceneId: 'scene-1',
      endSceneId: 'scene-3',
      sceneSequence: ['scene-1', 'scene-2', 'scene-3'],
      stateChanges: [
        {
          type: 'flag',
          name: 'found_passage',
          change: true,
          sceneId: 'scene-1',
          significance: 'major',
        },
        {
          type: 'relationship',
          name: 'npc-1.trust',
          change: 5,
          sceneId: 'scene-2',
          significance: 'moderate',
        },
      ],
      narrativeTheme: 'Curiosity negotiating with custody',
    },
  ],
  reconvergencePoints: [],
  stateTrackingMap: [
    {
      variable: 'found_passage',
      type: 'flag',
      setInScenes: ['scene-1'],
      usedInScenes: ['scene-3'],
      possibleValues: ['true', 'false'],
    },
    {
      variable: 'npc-1.trust',
      type: 'relationship',
      setInScenes: ['scene-2'],
      usedInScenes: ['scene-3'],
      possibleValues: ['-10', '5'],
    },
  ],
  validationIssues: [],
  recommendations: ['Let scene-2 acknowledge the choice through what Mara carries with her.'],
};

const episode2BranchAnalysis = {
  episodeId: 'episode-2',
  branchPaths: [
    {
      id: 'branch-2',
      name: 'The ledger\'s day',
      description: 'Mara reads the ledger, survives the lawyer, and chooses on the cliff path.',
      startSceneId: 'scene-4',
      endSceneId: 'scene-6',
      sceneSequence: ['scene-4', 'scene-5', 'scene-6'],
      stateChanges: [
        {
          type: 'flag',
          name: 'read_ledger',
          change: true,
          sceneId: 'scene-4',
          significance: 'major',
        },
        {
          type: 'relationship',
          name: 'npc-1.trust',
          change: 5,
          sceneId: 'scene-4',
          significance: 'moderate',
        },
      ],
      narrativeTheme: 'Proof against the price of using it',
    },
  ],
  reconvergencePoints: [],
  stateTrackingMap: [
    {
      variable: 'read_ledger',
      type: 'flag',
      setInScenes: ['scene-4'],
      usedInScenes: ['scene-6'],
      possibleValues: ['true', 'false'],
    },
    {
      variable: 'npc-1.trust',
      type: 'relationship',
      setInScenes: ['scene-4'],
      usedInScenes: ['scene-6'],
      possibleValues: ['-10', '5'],
    },
  ],
  validationIssues: [],
  recommendations: ['Let scene-6 acknowledge what Mara gave or withheld in the interview.'],
};

// ---------------------------------------------------------------- ep2 scenes

function episode2SceneFixture(sceneId: string): string {
  if (sceneId === 'scene-4') {
    return JSON.stringify({
      sceneId: 'scene-4',
      sceneName: 'The Salt Cellar',
      startingBeatId: 'beat-1',
      beats: [
        {
          id: 'beat-1',
          text: 'The salt cellar keeps the manor\'s stores and its quiet. You spread the gallery ledger under the lamp, and the middle pages answer in a second hand that never belonged to this house.',
          nextBeatId: 'beat-2',
          shotType: 'character',
          visualMoment: 'The ledger open under lamplight among the stores.',
          primaryAction: 'reads the second hand in the margins',
          emotionalRead: 'taut focus',
          relationshipDynamic: 'alone with the proof',
          mustShowDetail: 'the second handwriting in the margins',
          intensityTier: 'supporting',
        },
        {
          id: 'beat-2',
          text: 'The final column carries a signature where a sum should be. It is not the family\'s name, and the seal pressed beside it has spent thirty years pretending to be theirs.',
          nextBeatId: 'beat-3',
          shotType: 'detail',
          visualMoment: 'The signature at the bottom of the final column.',
          primaryAction: 'matches the signature to the seal',
          emotionalRead: 'cold certainty',
          relationshipDynamic: 'the house\'s secret made legible',
          mustShowDetail: 'the lawyer\'s signature beside the seal',
          intensityTier: 'supporting',
        },
        {
          id: 'beat-3',
          text: 'Boots on the cellar stairs, unhurried, counting their owner\'s thoughts. Edric\'s lamp rounds the last turn and finds you with the ledger open to the page that names his employer.',
          shotType: 'character',
          visualMoment: 'Edric\'s lamp finding her over the open ledger.',
          primaryAction: 'decides what to show him',
          emotionalRead: 'resolve',
          relationshipDynamic: 'trust on the scale',
          mustShowDetail: 'the open ledger between them',
          intensityTier: 'dominant',
          isChoicePoint: true,
        },
      ],
      moodProgression: ['hushed', 'cold', 'charged'],
      charactersInvolved: ['prot-1', 'npc-1'],
      keyMoments: ['the second hand', 'the signature', 'Edric on the stairs'],
      sceneTakeaways: ['The gallery ledger names an outside hand.', 'Edric finds Mara with proof in front of her.'],
      continuityNotes: ['Carries the ledger out of episode 1\'s garden ending.'],
    });
  }
  if (sceneId === 'scene-5') {
    return JSON.stringify({
      sceneId: 'scene-5',
      sceneName: 'The Lawyer\'s Visit',
      startingBeatId: 'beat-1',
      beats: [
        {
          id: 'beat-1',
          text: 'The lawyer takes the good chair without being offered it and praises the catalogue\'s thoroughness — room by room, in an order you never reported to anyone.',
          nextBeatId: 'beat-2',
          shotType: 'character',
          visualMoment: 'The lawyer settled in the good chair, list in hand.',
          primaryAction: 'keeps her inventory face on',
          emotionalRead: 'guarded',
          relationshipDynamic: 'a polite interrogation',
          mustShowDetail: 'the list of rooms in his hand',
          intensityTier: 'supporting',
        },
        {
          id: 'beat-2',
          text: 'His list arrives at the gallery and waits there. Edric pours the tea a half-second too slowly, and the lawyer watches you notice it.',
          nextBeatId: 'beat-3',
          shotType: 'character',
          visualMoment: 'The teapot hesitating over the cup.',
          primaryAction: 'reads the steward\'s warning',
          emotionalRead: 'sharpened',
          relationshipDynamic: 'three players, two conversations',
          mustShowDetail: 'Edric\'s hands on the teapot',
          intensityTier: 'supporting',
        },
        {
          id: 'beat-3',
          text: 'Old houses, the lawyer says, smiling at the shelves, keep their own accounts — wouldn\'t the archivist agree? The question sits between you like a held coin, and your answer will tell him exactly how much you have read.',
          shotType: 'character',
          visualMoment: 'The lawyer\'s smile across the tea things.',
          primaryAction: 'chooses the face to show him',
          emotionalRead: 'poised',
          relationshipDynamic: 'measure for measure',
          mustShowDetail: 'his eyes on her over the cup',
          intensityTier: 'dominant',
          isChoicePoint: true,
        },
      ],
      moodProgression: ['courteous', 'coiled', 'taut'],
      charactersInvolved: ['prot-1', 'npc-1'],
      keyMoments: ['the unreported rooms', 'the slow tea', 'the held question'],
      sceneTakeaways: ['The lawyer knows more about the house than Mara reported.', 'Edric signals danger through the tea service.'],
      continuityNotes: ['The lawyer\'s knowledge implies a watcher inside the house.'],
    });
  }
  return JSON.stringify({
    sceneId: 'scene-6',
    sceneName: 'The Cliff Path',
    startingBeatId: 'beat-1',
    beats: [
      {
        id: 'beat-1',
        text: 'Dusk takes the harbor a roof at a time. On the cliff path above it you weigh the ledger\'s spine in both hands, and the key that opened your door tonight hangs warm in your pocket — Edric\'s own ring key, left without a word.',
        nextBeatId: 'beat-2',
        shotType: 'establishing',
        visualMoment: 'Mara on the cliff path with the harbor lights below.',
        primaryAction: 'weighs the ledger and the key',
        emotionalRead: 'clear-eyed',
        relationshipDynamic: 'trusted, at last, by the steward',
        mustShowDetail: 'the ring key in her pocket',
        intensityTier: 'supporting',
      },
      {
        id: 'beat-2',
        text: 'Coach lamps come up the cliff road in no hurry at all. The lawyer travels like a man who has already bought the ending he is riding toward.',
        nextBeatId: 'beat-3',
        shotType: 'environment',
        visualMoment: 'Coach lamps rising on the cliff road.',
        primaryAction: 'counts the lamps\' approach',
        emotionalRead: 'steady',
        relationshipDynamic: 'the antagonist arriving on schedule',
        mustShowDetail: 'the twin coach lamps in the dusk',
        intensityTier: 'supporting',
      },
      {
        id: 'beat-3',
        text: 'You open the ledger to the signed column one last time and read it the way you read every house: for what it costs the people inside. Then you close it, and start down the path to meet the coach.',
        shotType: 'character',
        visualMoment: 'The ledger closing in her hands.',
        primaryAction: 'closes the ledger and walks to meet the coach',
        emotionalRead: 'resolve',
        relationshipDynamic: 'alone with the decision made',
        mustShowDetail: 'ink-stained fingers on the ledger\'s spine',
        intensityTier: 'dominant',
      },
    ],
    moodProgression: ['weighing', 'steady', 'resolved'],
    charactersInvolved: ['prot-1'],
    keyMoments: ['Edric\'s key', 'the coach lamps', 'the ledger closed'],
    sceneTakeaways: ['Edric left Mara the ring key.', 'Mara closes the ledger and goes to meet the lawyer on her own terms.'],
    continuityNotes: ['Pays off the season\'s ledger promise and the lawyer\'s early arrival.'],
  });
}

// ---------------------------------------------------------------- choices

function ep1RelationshipChoiceSet(): Record<string, unknown> {
  return {
    beatId: 'beat-3',
    sceneId: 'scene-1',
    choiceType: 'relationship',
    choices: [
      {
        id: 'choice-1',
        text: 'Step through the hidden door before he can object',
        choiceType: 'relationship',
        consequences: [
          {
            type: 'relationship',
            npcId: 'npc-1',
            dimension: 'trust',
            change: -10,
            description: 'Edric watches you choose the house over him.',
          },
        ],
        setsFlags: ['found_passage'],
        stakes: {
          want: 'Learn what the house hides tonight',
          cost: 'Whatever fragile tolerance Edric extended',
          identity: 'The scholar who walks through locked doors',
        },
        tintFlag: 'tint:reckless',
        reactionText: 'The dark takes you before his protest can.',
        outcomeTexts: {
          success: 'The passage swallows the candlelight behind you, and the house\'s held breath becomes yours.',
          partial: 'You make the dark, but his footsteps follow as far as the threshold and stop there, waiting.',
          failure: 'Your sleeve catches the frame; by the time you are through, he has seen everything you carried.',
        },
      },
      {
        id: 'choice-2',
        text: 'Turn from the passage and ask Edric for the truth',
        choiceType: 'relationship',
        consequences: [
          {
            type: 'relationship',
            npcId: 'npc-1',
            dimension: 'trust',
            change: 5,
            description: 'Edric registers that you chose him over the door.',
          },
        ],
        setsFlags: ['found_passage'],
        stakes: {
          want: 'The truth, given rather than stolen',
          cost: 'The passage may be sealed by morning',
          identity: 'The scholar who asks before she takes',
        },
        tintFlag: 'tint:principled',
        reactionText: 'You let the portrait swing shut at your back.',
        outcomeTexts: {
          success: 'Something in his shoulders gives, and the candle steadies; he was waiting to be asked.',
          partial: 'He answers one question in three, but he does not call the household down on you.',
          failure: 'His face closes like the door at your back, and the keys on his ring stay still.',
        },
      },
    ],
    overallStakes: {
      want: 'The truth about the east wing',
      cost: 'Either the passage or the man who guards it',
      identity: 'What kind of archivist Mara is when no one can stop her',
    },
    designNotes: 'Relationship choice between stolen truth and offered trust.',
  };
}

function ep1ExpressionChoiceSet(): Record<string, unknown> {
  return {
    beatId: 'beat-3',
    sceneId: 'scene-2',
    choiceType: 'expression',
    choices: [
      {
        id: 'choice-1',
        text: 'Press him on the part he is leaving out',
        choiceType: 'expression',
        consequences: [{ type: 'setFlag', flag: 'pressed_edric_for_name', value: true }],
        stakes: {
          want: 'The missing name behind the sealed wing',
          cost: 'Showing him how much you already know',
          identity: 'The archivist who keeps pulling the thread',
        },
        tintFlag: 'tint:relentless',
        reactionText: 'His jaw tightens around the word he will not give you.',
        outcomeTexts: {
          success: 'He gives you a direction if not a name, and the silence after it costs him visibly.',
          partial: 'He parries the question, but the parry itself tells you where the wound is.',
          failure: 'The shutters come down behind his eyes, and the bell finishes tolling alone.',
        },
      },
      {
        id: 'choice-2',
        text: 'Accept the half-truth and let him keep his dignity',
        choiceType: 'expression',
        consequences: [{ type: 'setFlag', flag: 'protected_edric_dignity', value: true }],
        stakes: {
          want: 'An ally tomorrow rather than an answer tonight',
          cost: 'Leaving the one name unspoken',
          identity: 'The archivist who knows what not to ask',
        },
        tintFlag: 'tint:patient',
        reactionText: 'You let the unsaid name stay where he buried it.',
        outcomeTexts: {
          success: 'Something unknots in his shoulders, and he holds the passage door wider for you.',
          partial: 'He nods once, grateful and unreadable, and the moment closes without mending anything.',
          failure: 'Your restraint reads as indifference, and he mistakes mercy for dismissal.',
        },
      },
    ],
    overallStakes: {
      want: 'Keep the steward talking without breaking him',
      cost: 'Either the name or the man',
      identity: 'How Mara treats a person who is half a door',
    },
    designNotes: 'Expression choice colouring the relationship without branching.',
  };
}

function ep2RelationshipChoiceSet(): Record<string, unknown> {
  return {
    beatId: 'beat-3',
    sceneId: 'scene-4',
    choiceType: 'relationship',
    choices: [
      {
        id: 'choice-1',
        text: 'Show Edric the signature and watch his face',
        choiceType: 'relationship',
        consequences: [
          {
            type: 'relationship',
            npcId: 'npc-1',
            dimension: 'trust',
            change: 10,
            description: 'You hand the steward the one page that could ruin his employer.',
          },
        ],
        setsFlags: ['read_ledger'],
        stakes: {
          want: 'An ally who knows the house from the inside',
          cost: 'If his loyalty holds to the family, the ledger is gone by morning',
          identity: 'The archivist who trusts a person over a lock',
        },
        tintFlag: 'tint:candid',
        reactionText: 'You turn the ledger so the lamplight finds the signature.',
        outcomeTexts: {
          success: 'He reads the name twice, and something thirty years deep shifts behind his face. He sets his lamp down beside yours.',
          partial: 'He looks, says nothing, and leaves — but the cellar door stays unlocked behind him.',
          failure: 'His face goes to household-perfect blankness, and you understand the page is no longer only yours.',
        },
      },
      {
        id: 'choice-2',
        text: 'Close the ledger and claim it was filed wrong',
        choiceType: 'relationship',
        consequences: [
          {
            type: 'relationship',
            npcId: 'npc-1',
            dimension: 'trust',
            change: -5,
            description: 'Edric watches you lie to him with a steward\'s practiced eye.',
          },
        ],
        setsFlags: ['read_ledger'],
        stakes: {
          want: 'Keep the name hers alone until she knows its price',
          cost: 'Edric has heard every lie this house tells',
          identity: 'The archivist who keeps the last page for herself',
        },
        tintFlag: 'tint:guarded',
        reactionText: 'The ledger closes on the signature like a door.',
        outcomeTexts: {
          success: 'He accepts the filing story with a nod that costs him nothing and you nothing — yet.',
          partial: 'He doesn\'t believe you, and lets you see that he doesn\'t, and pours the lamp oil anyway.',
          failure: 'The lie lands wrong, and the next morning the cellar inventory has been moved by careful hands.',
        },
      },
    ],
    overallStakes: {
      want: 'The name behind the seal, made usable',
      cost: 'The steward\'s trust, spent or banked',
      identity: 'Whether proof is for sharing or for keeping',
    },
    designNotes: 'Relationship choice: the ledger\'s first witness.',
  };
}

function ep2ExpressionChoiceSet(): Record<string, unknown> {
  return {
    beatId: 'beat-3',
    sceneId: 'scene-5',
    choiceType: 'expression',
    choices: [
      {
        id: 'choice-1',
        text: 'Answer with cheerful, exact inventory talk',
        choiceType: 'expression',
        consequences: [{ type: 'setFlag', flag: 'answered_with_inventory', value: true }],
        stakes: {
          want: 'Bore the question to death before it lands',
          cost: 'He learns she can perform under pressure — and remembers it',
          identity: 'The archivist as harmless catalogue, nothing more',
        },
        tintFlag: 'tint:opaque',
        reactionText: 'You give him shelf feet and foxing percentages until the tea goes cold.',
        outcomeTexts: {
          success: 'His smile glazes politely somewhere around the binding inventory, and the gallery question dies unasked.',
          partial: 'He lets the recital run, then sets one room\'s name down between you like a card he isn\'t playing yet.',
          failure: 'The performance is a half-note too bright, and his pen makes a small, satisfied mark.',
        },
      },
      {
        id: 'choice-2',
        text: 'Let one true thing slip and watch where it lands',
        choiceType: 'expression',
        consequences: [{ type: 'setFlag', flag: 'let_truth_slip', value: true }],
        stakes: {
          want: 'Trade a pawn to see how he takes pieces',
          cost: 'A true thing, once given, cannot be refiled',
          identity: 'The archivist who reads men by what they reach for',
        },
        tintFlag: 'tint:probing',
        reactionText: 'You mention, idly, that the gallery dust lies thicker than thirty years.',
        outcomeTexts: {
          success: 'His hand stills on the cup a half-second too long, and now you both know which of you sealed that wing.',
          partial: 'He files your true thing without expression, but he leaves a quarter-hour earlier than his coach was ordered.',
          failure: 'He receives it like a gift he expected, and you realize the slip was budgeted into his visit.',
        },
      },
    ],
    overallStakes: {
      want: 'His measure, taken without giving hers',
      cost: 'Whatever the interview catalogues against her',
      identity: 'The face the archivist shows the house\'s true owner',
    },
    designNotes: 'Expression choice: the interview as fencing match.',
  };
}

function ensureThreeChoiceSurface(base: Record<string, unknown>): void {
  const choices = base.choices as Array<Record<string, unknown>> | undefined;
  if (!choices || choices.length >= 3) return;
  choices.push({
    id: `choice-${choices.length + 1}`,
    text: 'Name the cost before you move',
    choiceType: base.choiceType ?? 'expression',
    consequences: [{ type: 'setFlag', flag: 'named_the_cost', value: true }],
    stakes: {
      want: 'A clean choice made with open eyes',
      cost: 'The moment narrows while you measure it',
      identity: 'The archivist who names a price before paying it',
    },
    tintFlag: 'tint:measured',
    reactionText: 'You let the silence hold long enough to show what the choice costs.',
    outcomeTexts: {
      success: 'The named cost steadies you, and the next step lands with intent.',
      partial: 'Naming the cost clarifies the choice without making it easier.',
      failure: 'The cost grows teeth once spoken, and the room hears it too.',
    },
  });
}

/**
 * Choice Author prompts identify the scene by NAME (`- **Scene**: ...`) and
 * dictate the beatId/choiceType in the required JSON structure — echo all
 * three back (same convention as the linear fixtures).
 */
function seasonChoiceSetFixtureFor(request: LlmTransportRequest): string {
  const text = requestText(request);
  const requestedType = text.match(/"choiceType":\s*"(\w+)"/)?.[1];
  const requestedBeatId = text.match(/"beatId":\s*"([^"]+)"/)?.[1];

  let base: Record<string, unknown>;
  if (text.includes('scene-4') || text.includes('The Salt Cellar')) base = ep2RelationshipChoiceSet();
  else if (text.includes('scene-5') || text.includes('The Lawyer')) base = ep2ExpressionChoiceSet();
  else if (text.includes('scene-2') || text.includes('The Steward')) base = ep1ExpressionChoiceSet();
  else base = ep1RelationshipChoiceSet();

  ensureThreeChoiceSurface(base);
  if (requestedBeatId) base.beatId = requestedBeatId;
  if (requestedType) {
    base.choiceType = requestedType;
    for (const choice of base.choices as Array<Record<string, unknown>>) {
      choice.choiceType = requestedType;
      if (requestedType === 'expression') {
        delete choice.statCheck;
        delete choice.residueHints;
        if (!choice.setsFlags) choice.setsFlags = [`expressed_${choice.id}`];
      } else {
        if (!choice.statCheck) {
          choice.statCheck = { difficulty: 'moderate', skillWeights: { empathy: 1, perception: 1 } };
        }
        if (!choice.residueHints) {
          choice.residueHints = [{
            kind: 'relationship_behavior',
            description: 'Let the next scene show how this choice changes the room between Mara and Edric.',
          }];
        }
      }
      if (requestedType !== 'dilemma') delete choice.moralContract;
    }
  }
  return JSON.stringify(base);
}

// ---------------------------------------------------------------- threads/twists

/**
 * Per-episode thread ledgers. Threads plant AND pay off within their own
 * episode so the season-canon promise-due gate (blocking by default) has no
 * dangling cross-episode promise to abort on.
 */
function threadLedgerFixtureFor(episode: 1 | 2): string {
  if (episode === 1) {
    return JSON.stringify({
      threads: [
        {
          id: 'passage-secret',
          kind: 'seed',
          priority: 'major',
          label: 'The hidden passage behind the portrait',
          description: 'The library portrait conceals a passage Edric has known about for years.',
          introducedInEpisode: 1,
          expectedPaidOffByEpisode: 1,
          plants: [{ sceneId: 'scene-1', beatId: 'beat-1', note: 'The portrait swings inward on darkness.' }],
          payoffs: [{ sceneId: 'scene-3', beatId: 'beat-1', note: 'The passage delivers Mara to the garden.' }],
          status: 'planned',
          tags: ['mystery'],
        },
      ],
      designNotes: 'Episode 1 carries one self-contained seed: the passage found, used, and survived.',
    });
  }
  return JSON.stringify({
    threads: [
      {
        id: 'ledger-name',
        kind: 'reveal',
        priority: 'major',
        label: 'The name in the gallery ledger',
        description: 'The ledger names the lawyer as the outside authority who sealed the east wing.',
        introducedInEpisode: 2,
        expectedPaidOffByEpisode: 2,
        plants: [{ sceneId: 'scene-4', beatId: 'beat-2', note: 'The signature at the bottom of the final column.' }],
        payoffs: [
          {
            sceneId: 'scene-6',
            beatId: 'beat-3',
            note: 'Mara closes the ledger and goes to meet the coach.',
            reframe: 'The catalogue commission was always about controlling what the archivist would find.',
          },
        ],
        status: 'planned',
        tags: ['mystery', 'reveal'],
      },
    ],
    designNotes: 'Episode 2 resolves the season question: who sealed the wing, and what the proof is for.',
  });
}

function twistPlanFixtureFor(episode: 1 | 2): string {
  if (episode === 1) {
    return JSON.stringify({
      episodeId: 'episode-1',
      headline: 'Edric has known about the passage all along',
      kind: 'revelation',
      twistSceneId: 'scene-2',
      twistBeatId: 'beat-1',
      foreshadowSceneId: 'scene-1',
      foreshadowBeatId: 'beat-1',
      rationale:
        'The hinge no catalogue mentioned plants the question of who maintained it; Edric arriving without surprise answers it — surprising, then inevitable.',
      threadId: 'passage-secret',
      directives: [
        {
          sceneId: 'scene-1',
          beatId: 'beat-1',
          beatRole: 'foreshadow',
          twistKind: 'revelation',
          hint: 'The hinge is oiled and silent — someone has kept this door working.',
        },
        {
          sceneId: 'scene-2',
          beatId: 'beat-1',
          beatRole: 'reveal',
          twistKind: 'revelation',
          hint: 'Edric admits he maintained the passage and waited for someone willing to ask why.',
        },
        {
          sceneId: 'scene-2',
          beatId: 'beat-1',
          beatRole: 'aftermath',
          twistKind: 'revelation',
          hint: 'His candor about the sealing trades on the fact that the door is no longer his secret.',
        },
      ],
    });
  }
  return JSON.stringify({
    episodeId: 'episode-2',
    headline: 'The family\'s lawyer is the man who sealed the wing',
    kind: 'reframe',
    twistSceneId: 'scene-5',
    twistBeatId: 'beat-1',
    foreshadowSceneId: 'scene-4',
    foreshadowBeatId: 'beat-1',
    rationale:
      'The second hand in the margins is visible before the signature resolves it; the reveal reframes the lawyer\'s coming visit from formality to counter-move.',
    threadId: 'ledger-name',
    directives: [
      {
        sceneId: 'scene-4',
        beatId: 'beat-1',
        beatRole: 'foreshadow',
        twistKind: 'reframe',
        hint: 'The second hand in the margins is a professional\'s — precise, paid, not family.',
      },
      {
        sceneId: 'scene-5',
        beatId: 'beat-1',
        beatRole: 'reveal',
        twistKind: 'reframe',
        hint: 'The lawyer arrives carrying the same precise hand and seal named in the ledger.',
      },
      {
        sceneId: 'scene-5',
        beatId: 'beat-3',
        beatRole: 'aftermath',
        twistKind: 'reframe',
        hint: 'His held-coin question only menaces because of what the cellar page proved.',
      },
    ],
  });
}

// ---------------------------------------------------------------- map

/** True when the request text belongs to episode 2 (by id or scene name). */
function isEpisode2Request(text: string): boolean {
  return (
    text.includes('The Sealed Ledger') ||
    text.includes('scene-4') ||
    text.includes('episode-2') ||
    text.includes('The Salt Cellar')
  );
}

/**
 * Fixture map for one generateMultipleEpisodes() run (episodes 1-2). Single
 * (non-array) entries repeat for every call from that agent; request-aware
 * functions answer per episode/scene by stable prompt markers (`**Scene ID**:`
 * for SceneWriter, `**Scene**:` for ChoiceAuthor, episode title/scene ids for
 * the planners).
 */
export function buildSeasonRunFixtureMap(): ScriptedFixtureMap {
  return {
    'World Builder': JSON.stringify(worldBible),
    'Character Designer': JSON.stringify(characterBible),
    'Story Architect': (request) => {
      const text = requestText(request);
      return isEpisode2Request(text)
        ? JSON.stringify(episode2Blueprint)
        : JSON.stringify(episode1Blueprint);
    },
    'Branch Manager': (request) => {
      const text = requestText(request);
      return isEpisode2Request(text)
        ? JSON.stringify(episode2BranchAnalysis)
        : JSON.stringify(episode1BranchAnalysis);
    },
    'Thread Planner': (request) => threadLedgerFixtureFor(isEpisode2Request(requestText(request)) ? 2 : 1),
    'Twist Architect': (request) => twistPlanFixtureFor(isEpisode2Request(requestText(request)) ? 2 : 1),
    'Scene Writer': (request) => {
      const text = requestText(request);
      for (const id of ['scene-4', 'scene-5', 'scene-6'] as const) {
        if (text.includes(`**Scene ID**: ${id}`)) return episode2SceneFixture(id);
      }
      if (text.includes('**Scene ID**: scene-3')) return sceneFixture('scene-3');
      if (text.includes('**Scene ID**: scene-2')) return sceneFixture('scene-2');
      if (text.includes('**Scene ID**: scene-1')) return sceneFixture('scene-1');
      // Fallback for prompts without the Scene ID marker (targeted rewrites
      // quote the scene name instead).
      if (text.includes('Salt Cellar')) return episode2SceneFixture('scene-4');
      if (text.includes('Lawyer')) return episode2SceneFixture('scene-5');
      if (text.includes('Cliff Path')) return episode2SceneFixture('scene-6');
      if (text.includes('East Garden')) return sceneFixture('scene-3');
      if (text.includes('The Steward')) return sceneFixture('scene-2');
      return sceneFixture('scene-1');
    },
    'Choice Author': (request) => seasonChoiceSetFixtureFor(request),
    // No-op critic: echo the scene's own beats back as the "rewrite" so the
    // critique pass is exercised without changing prose. Keyed by the
    // `# Scene: <id>` header SceneCritic.buildPrompt emits.
    'Scene Critic': (request) => {
      const text = requestText(request);
      const id = /#\s*Scene:\s*(scene-\d+)/.exec(text)?.[1] ?? 'scene-1';
      const source = ['scene-4', 'scene-5', 'scene-6'].includes(id)
        ? episode2SceneFixture(id)
        : sceneFixture(id);
      const parsed = JSON.parse(source) as { beats?: unknown[] };
      return JSON.stringify({
        sceneId: id,
        rewrittenBeats: parsed.beats ?? [],
        critiqueNotes: [],
        overallCommentary: 'Prose holds; no rewrite needed.',
      });
    },
  };
}
