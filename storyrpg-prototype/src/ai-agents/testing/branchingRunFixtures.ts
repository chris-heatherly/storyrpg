/**
 * Scripted LLM fixtures for the BRANCHING + ENCOUNTER prompt-snapshot
 * characterization test (FullStoryPipeline.promptSnapshot.branching.test.ts).
 *
 * Extends the linear full-run coverage (fullRunFixtures.ts) with the two
 * content-generation shapes the ContentGeneration extraction must preserve:
 *   - a real branch point (choicePoint.branches + multi-target leadsTo) with
 *     per-target routed choices and a reconvergence scene that carries
 *     residue textVariants, and
 *   - an encounter scene (isEncounter + encounterType) that routes through
 *     EncounterArchitect instead of SceneWriter/ChoiceAuthor.
 *
 * Topology: scene-1 ──(branch)──> scene-2a (dialogue) ──> scene-3
 *                       └────────> scene-2b (encounter) ──> scene-3
 *
 * Like fullRunFixtures, these are NOT story-quality examples — they are
 * minimal-but-valid responses so the captured call sequence is stable.
 */

import type { LlmTransportRequest } from '../agents/BaseAgent';
import type { ScriptedFixtureMap } from './promptCapture';
import { requestText, worldBible, characterBible } from './fullRunFixtures';

// ---------------------------------------------------------------- blueprint

const branchingEpisodeBlueprint = {
  episodeId: 'episode-1',
  title: 'The Locked Wing',
  synopsis:
    'Mara finds the passage behind the library portrait and chooses between taking it alone or facing Edric — both roads end at the east garden.',
  arc: {
    hook: 'The catalogue commission excludes the east wing.',
    plotTurn1: 'The portrait swings inward on a hidden passage.',
    pinch1: 'Edric appears in the library doorway.',
    midpoint: 'Mara chooses the passage or the man.',
    pinch2: 'The household begins to wake at the tenth bell.',
    climax: 'Mara reaches the garden with what her choice cost her.',
    resolution: 'The garden, the gate, and what comes next.',
  },
  themes: ['trust', 'curiosity'],
  startingSceneId: 'scene-1',
  bottleneckScenes: ['scene-3'],
  scenes: [
    {
      id: 'scene-1',
      name: 'The Hidden Door',
      description:
        'Mara discovers a secret passage behind a portrait in the library while Edric watches from the doorway.',
      location: 'loc-1',
      mood: 'tense',
      purpose: 'transition',
      dramaticQuestion: 'Will Mara take the passage or face the man guarding it?',
      wantVsNeed: 'Open the passage now vs. understand the man guarding it.',
      conflictEngine: 'Edric stands between Mara and the house\'s buried memory.',
      npcsPresent: ['npc-1'],
      narrativeFunction: 'Discovery and the branching decision.',
      keyBeats: [
        'The portrait swings inward, revealing darkness.',
        'Edric steps forward with a knowing look.',
      ],
      dramaticStructure: {
        question: 'Will Mara open the passage with Edric watching?',
        turn: 'The portrait swings open and Edric steps out of the dark doorway.',
        pressurePeak: 'The silent standoff over the open passage.',
        changedState: 'Mara has committed to the passage or to the man.',
      },
      leadsTo: ['scene-2a', 'scene-2b'],
      choicePoint: {
        type: 'relationship',
        branches: true,
        stakes: {
          want: 'Enter the passage and learn the truth',
          cost: 'Defy Edric openly or deceive him',
          identity: 'Scholar or trespasser',
        },
        description: 'Slip into the dark passage alone, or face Edric and ask him outright.',
        optionHints: [
          'Step through the hidden door before he can object.',
          'Confront Edric about what the household is hiding.',
        ],
        consequenceDomain: 'relationship',
        reminderPlan: {
          immediate: 'Edric reacts to her choice before the candle gutters.',
          shortTerm: 'The east garden carries the residue of which road she took.',
        },
      },
    },
    {
      id: 'scene-2a',
      name: 'The Steward\'s Answer',
      description:
        'Mara turns from the passage to face Edric, who gives her as much truth as he dares.',
      location: 'loc-1',
      mood: 'charged',
      purpose: 'branch',
      dramaticQuestion: 'How much of Edric\'s account does Mara accept?',
      wantVsNeed: 'A clean answer vs. an honest one.',
      conflictEngine: 'Every answer Edric gives opens a costlier question.',
      npcsPresent: ['npc-1'],
      narrativeFunction: 'Revelation under pressure on the confrontation path.',
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
      id: 'scene-2b',
      name: 'The Rotten Gallery',
      description:
        'The passage runs above the shut east wing through a gallery of rotten boards, and the house is not as empty as it should be.',
      location: 'loc-1',
      mood: 'dangerous',
      purpose: 'branch',
      dramaticQuestion: 'Can Mara cross the gallery without waking the house?',
      wantVsNeed: 'Reach the garden door unseen vs. learn what the gallery overlooks.',
      conflictEngine: 'Rotten flooring, a patrolling steward, and the dark itself.',
      npcsPresent: ['npc-1'],
      narrativeFunction: 'The cost of taking the passage alone.',
      keyBeats: [
        'The first board groans under her weight.',
        'Lantern light sweeps the gallery from below.',
        'The garden door is in reach but the floor between is gone.',
      ],
      dramaticStructure: {
        question: 'Can Mara cross the rotten gallery without waking the house?',
        turn: 'Edric\'s lantern light sweeps the gallery while she is halfway across.',
        pressurePeak: 'The gap in the floor with the light climbing the stairs behind her.',
        changedState: 'Mara is through to the garden door — or caught in the forbidden wing.',
      },
      leadsTo: ['scene-3'],
      isEncounter: true,
      encounterType: 'stealth',
      encounterBuildup:
        'Scene 1 established the sealed east wing, Edric\'s watchfulness, and Mara\'s choice to trespass — the gallery is where that choice gets a price.',
      encounterRelevantSkills: ['stealth', 'athletics', 'perception'],
      encounterPartialVictoryCost: {
        visibleComplication: 'A torn palm and a limp she cannot hide in the morning',
        immediateEffect: 'The garden crossing is slow and loud where it most needs to be quick',
      },
      encounterDescription:
        'Mara must cross the rotten gallery above the sealed east wing without bringing Edric\'s lantern — or the floor — down on her.',
      encounterStakes:
        'Reach the garden door unseen, or be caught trespassing in the one wing her contract forbids.',
      encounterDifficulty: 'moderate',
      encounterBeatPlan: [
        'The first span: test the boards while the lantern light is far away.',
        'The crossing: Edric\'s light sweeps the gallery and Mara must freeze, hide, or move.',
        'The gap: the last stretch of floor is gone and the garden door waits beyond it.',
      ],
    },
    {
      id: 'scene-3',
      name: 'The East Garden',
      description:
        'Both roads end in the walled garden. Whatever Mara chose, she is alone now with the gate and the night.',
      location: 'loc-2',
      mood: 'mysterious',
      purpose: 'bottleneck',
      dramaticQuestion: 'What will Mara do with what the night gave her?',
      wantVsNeed: 'Escape with what she learned vs. go back and finish what she started.',
      conflictEngine: 'The iron gate is locked and the household will wake at the tenth bell.',
      npcsPresent: [],
      narrativeFunction: 'Reconvergence and opening outward.',
      keyBeats: [
        'The garden opens in moonlight.',
        'The iron gate stands between Mara and the cliff path.',
      ],
      dramaticStructure: {
        question: 'What will Mara do with what the night gave her?',
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
    {
      name: 'took_passage',
      description: 'Set when Mara enters the passage alone instead of facing Edric.',
    },
    {
      name: 'asked_edric',
      description: 'Set when Mara turns from the passage and confronts Edric.',
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

// ---------------------------------------------------------------- branches

const branchingBranchAnalysis = {
  episodeId: 'episode-1',
  branchPaths: [
    {
      id: 'branch-edric',
      name: 'The steward\'s answer',
      description: 'Mara turns from the passage, confronts Edric, and reaches the garden with his half-truth.',
      startSceneId: 'scene-1',
      endSceneId: 'scene-3',
      sceneSequence: ['scene-1', 'scene-2a', 'scene-3'],
      stateChanges: [
        {
          type: 'flag',
          name: 'asked_edric',
          change: true,
          sceneId: 'scene-1',
          significance: 'major',
        },
        {
          type: 'relationship',
          name: 'npc-1.trust',
          change: 5,
          sceneId: 'scene-1',
          significance: 'moderate',
        },
      ],
      narrativeTheme: 'Trust offered before truth taken',
    },
    {
      id: 'branch-passage',
      name: 'The rotten gallery',
      description: 'Mara takes the passage alone and crosses the rotten gallery above the sealed wing.',
      startSceneId: 'scene-1',
      endSceneId: 'scene-3',
      sceneSequence: ['scene-1', 'scene-2b', 'scene-3'],
      stateChanges: [
        {
          type: 'flag',
          name: 'took_passage',
          change: true,
          sceneId: 'scene-1',
          significance: 'major',
        },
        {
          type: 'relationship',
          name: 'npc-1.trust',
          change: -10,
          sceneId: 'scene-1',
          significance: 'moderate',
        },
      ],
      narrativeTheme: 'Curiosity that pays in the dark',
    },
  ],
  reconvergencePoints: [
    {
      sceneId: 'scene-3',
      incomingBranches: ['branch-edric', 'branch-passage'],
      stateReconciliation: [
        {
          stateVariable: 'took_passage',
          possibleValues: ['true', 'false'],
          howToHandle:
            'Open the garden scene with conditional residue: dust and splinters if she crossed the gallery, Edric\'s half-truth ringing if she stayed.',
        },
        {
          stateVariable: 'npc-1.trust',
          possibleValues: ['-10', '5'],
          howToHandle: 'Let later Edric scenes read the trust delta; the garden is alone-time either way.',
        },
      ],
      narrativeAcknowledgment:
        'The garden receives whichever Mara arrives: the trespasser brushing off the gallery\'s dust, or the questioner still hearing the steward\'s unsaid name.',
    },
  ],
  stateTrackingMap: [
    {
      variable: 'found_passage',
      type: 'flag',
      setInScenes: ['scene-1'],
      usedInScenes: ['scene-3'],
      possibleValues: ['true', 'false'],
    },
    {
      variable: 'took_passage',
      type: 'flag',
      setInScenes: ['scene-1'],
      usedInScenes: ['scene-3'],
      possibleValues: ['true', 'false'],
    },
    {
      variable: 'asked_edric',
      type: 'flag',
      setInScenes: ['scene-1'],
      usedInScenes: ['scene-3'],
      possibleValues: ['true', 'false'],
    },
    {
      variable: 'npc-1.trust',
      type: 'relationship',
      setInScenes: ['scene-1'],
      usedInScenes: ['scene-3'],
      possibleValues: ['-10', '5'],
    },
  ],
  validationIssues: [],
  recommendations: [
    'Open scene-3 with path-conditional residue so the reconvergence does not erase the choice.',
  ],
};

// ---------------------------------------------------------------- scenes

function branchingSceneFixture(sceneId: string): string {
  if (sceneId === 'scene-1') {
    return JSON.stringify({
      sceneId: 'scene-1',
      sceneName: 'The Hidden Door',
      startingBeatId: 'beat-1',
      beats: [
        {
          id: 'beat-1',
          text: 'You ease the portrait away from the wall, and the frame swings on a hinge no catalogue ever mentioned. Cold air breathes out of the dark behind it.',
          nextBeatId: 'beat-2',
          shotType: 'character',
          visualMoment: 'The portrait swings inward on darkness.',
          primaryAction: 'opens the hidden door',
          emotionalRead: 'watchful',
          relationshipDynamic: 'alone with the house',
          mustShowDetail: 'the hinge behind the frame',
          intensityTier: 'supporting',
        },
        {
          id: 'beat-2',
          text: 'A floorboard answers from the doorway. Edric stands there with a candle, and his face says he has known about this door longer than you have been alive.',
          nextBeatId: 'beat-3',
          shotType: 'character',
          visualMoment: 'Edric in the doorway with a candle.',
          primaryAction: 'turns toward the steward',
          emotionalRead: 'tense',
          relationshipDynamic: 'confrontation',
          mustShowDetail: 'the candle flame steady in his hand',
          intensityTier: 'supporting',
        },
        {
          id: 'beat-3',
          text: 'Neither of you speaks. The passage waits at your back, and Edric waits at the door, and the candle burns down between you. One of them gets you tonight; the other keeps the rest of the house.',
          shotType: 'action',
          visualMoment: 'The standoff between Mara and Edric.',
          primaryAction: 'weighs the passage against the man',
          emotionalRead: 'resolve',
          relationshipDynamic: 'mutual measurement',
          mustShowDetail: 'the open passage behind her',
          intensityTier: 'dominant',
          isChoicePoint: true,
        },
      ],
      moodProgression: ['quiet', 'tense', 'taut'],
      charactersInvolved: ['prot-1', 'npc-1'],
      keyMoments: ['the portrait opens', 'Edric appears'],
      continuityNotes: ['The scene ends on the branching standoff at the passage.'],
    });
  }
  if (sceneId === 'scene-2a') {
    return JSON.stringify({
      sceneId: 'scene-2a',
      sceneName: 'The Steward\'s Answer',
      startingBeatId: 'beat-1',
      beats: [
        {
          id: 'beat-1',
          text: 'Edric sets the candle on the shelf between you, deliberate as a man laying down a card. The east wing was sealed before the old master died, he says, and not by the family.',
          nextBeatId: 'beat-2',
          shotType: 'character',
          visualMoment: 'Edric setting the candle down between them.',
          primaryAction: 'listens without moving',
          emotionalRead: 'guarded attention',
          relationshipDynamic: 'fragile truce',
          mustShowDetail: 'the candle between them',
          intensityTier: 'supporting',
        },
        {
          id: 'beat-2',
          text: 'He stops short of the one name you need. Below, the tenth bell begins to toll, and his eyes go to the passage at your back.',
          nextBeatId: 'beat-3',
          shotType: 'character',
          visualMoment: 'His eyes flicking to the dark passage.',
          primaryAction: 'marks what he leaves unsaid',
          emotionalRead: 'sharpened focus',
          relationshipDynamic: 'negotiation',
          mustShowDetail: 'his hand stilling on the key ring',
          intensityTier: 'supporting',
        },
        {
          id: 'beat-3',
          text: 'The bell counts down the silence between you. Whatever you say next will decide what kind of ally he can afford to be.',
          shotType: 'character',
          visualMoment: 'The two of them framed by the open passage.',
          primaryAction: 'weighs her answer',
          emotionalRead: 'resolve',
          relationshipDynamic: 'balance point',
          mustShowDetail: 'the last of the candle',
          intensityTier: 'dominant',
          isChoicePoint: true,
        },
      ],
      moodProgression: ['guarded', 'charged', 'poised'],
      charactersInvolved: ['prot-1', 'npc-1'],
      keyMoments: ['the half-confession', 'the tenth bell'],
      continuityNotes: ['Ends on Mara deciding how to receive the half-truth.'],
    });
  }
  return JSON.stringify({
    sceneId: 'scene-3',
    sceneName: 'The East Garden',
    startingBeatId: 'beat-1',
    beats: [
      {
        id: 'beat-1',
        text: 'The night lets you out at last into the walled garden, and moonlight floods the overgrown hedges.',
        textVariants: [
          {
            condition: { type: 'flag', flag: 'took_passage', value: true },
            text: 'The hidden door gives onto the garden at last, and you step into moonlight with the gallery\'s dust still on your sleeves and a splinter riding in your palm.',
          },
          {
            condition: { type: 'flag', flag: 'asked_edric', value: true },
            text: 'Edric walks you as far as the garden door and no farther. You step into moonlight with his half-answer still tolling in your head like the tenth bell.',
          },
        ],
        nextBeatId: 'beat-2',
        shotType: 'establishing',
        visualMoment: 'Mara steps out into the moonlit garden.',
        primaryAction: 'emerges into the garden',
        emotionalRead: 'relief edged with dread',
        relationshipDynamic: 'alone',
        mustShowDetail: 'the hidden door in the wall',
        intensityTier: 'supporting',
      },
      {
        id: 'beat-2',
        text: 'The iron gate stands at the far wall, and beyond it the cliff path drops toward the village lights. Somewhere behind you, the house begins to wake.',
        textVariants: [
          {
            condition: { type: 'flag', flag: 'treatment_branch_scene_2b', value: true },
            text: 'The iron gate stands at the far wall, and your gallery-bruised hands already know how its latch will fight you. Somewhere behind, the house begins to wake to what you crossed.',
          },
          {
            condition: { type: 'flag', flag: 'treatment_branch_scene_2a', value: true },
            text: 'The iron gate stands at the far wall, and Edric\'s unsaid name keeps pace with you across the wet grass. Somewhere behind you, the house begins to wake.',
          },
        ],
        nextBeatId: 'beat-3',
        shotType: 'environment',
        visualMoment: 'The iron gate against the night sky.',
        primaryAction: 'crosses to the gate',
        emotionalRead: 'urgency',
        relationshipDynamic: 'pursued by the house',
        mustShowDetail: 'the gate latch under her hand',
        intensityTier: 'supporting',
      },
      {
        id: 'beat-3',
        text: 'Your hand closes on the cold latch. Whatever you carried out of the library tonight, the night is about to ask what you mean to do with it.',
        shotType: 'character',
        visualMoment: 'Her hand on the gate latch.',
        primaryAction: 'grips the latch',
        emotionalRead: 'resolve',
        relationshipDynamic: 'alone with the choice',
        mustShowDetail: 'ink-stained fingers on iron',
        intensityTier: 'dominant',
      },
    ],
    moodProgression: ['release', 'urgency', 'resolve'],
    charactersInvolved: ['prot-1'],
    keyMoments: ['the garden opens', 'the gate'],
    continuityNotes: ['Opens on path-conditional residue from scene-1\'s branch.'],
  });
}

// ---------------------------------------------------------------- choices

/**
 * Branch-point choice set for scene-1: one routed choice per leadsTo target
 * (nextSceneId), each setting the flag the reconvergence residue keys on.
 * Echoes the requested beatId/choiceType like the linear fixtures do.
 */
function branchChoiceSetFixture(): Record<string, unknown> {
  return {
    beatId: 'beat-3',
    sceneId: 'scene-1',
    choiceType: 'relationship',
    choices: [
      {
        id: 'choice-1',
        text: 'Step through the hidden door before he can object',
        choiceType: 'relationship',
        nextSceneId: 'scene-2b',
        consequences: [
          {
            type: 'relationship',
            target: 'npc-1',
            dimension: 'trust',
            change: -10,
            description: 'Edric watches you choose the house over him.',
          },
        ],
        setsFlags: ['found_passage', 'took_passage'],
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
        nextSceneId: 'scene-2a',
        consequences: [
          {
            type: 'relationship',
            target: 'npc-1',
            dimension: 'trust',
            change: 5,
            description: 'Edric registers that you chose him over the door.',
          },
        ],
        setsFlags: ['found_passage', 'asked_edric'],
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
    designNotes: 'Branch point: each choice routes to its own scene and sets the residue flag.',
  };
}

function expressionChoiceSetFixture(): Record<string, unknown> {
  return {
    beatId: 'beat-3',
    sceneId: 'scene-2a',
    choiceType: 'expression',
    choices: [
      {
        id: 'choice-1',
        text: 'Press him on the part he is leaving out',
        choiceType: 'expression',
        consequences: [],
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
        consequences: [],
        stakes: {
          want: 'An ally tomorrow rather than an answer tonight',
          cost: 'Leaving the one name unspoken',
          identity: 'The archivist who knows what not to ask',
        },
        tintFlag: 'tint:patient',
        reactionText: 'You let the unsaid name stay where he buried it.',
        outcomeTexts: {
          success: 'Something unknots in his shoulders, and he holds the garden door wider for you.',
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

function ensureThreeChoiceSurface(base: Record<string, unknown>): void {
  const choices = base.choices as Array<Record<string, unknown>> | undefined;
  if (!choices || choices.length >= 3) return;
  const routedTarget =
    choices.find((choice) => typeof choice.nextSceneId === 'string')?.nextSceneId ?? undefined;
  choices.push({
    id: `choice-${choices.length + 1}`,
    text: 'Name the cost before you move',
    choiceType: base.choiceType ?? 'expression',
    ...(typeof routedTarget === 'string' ? { nextSceneId: routedTarget } : {}),
    consequences: [],
    setsFlags: typeof routedTarget === 'string' ? ['found_passage'] : undefined,
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
 * three back. The branch-point set keeps its routed nextSceneIds regardless
 * of the planner-assigned type so the branch is realized on the first pass.
 */
function branchingChoiceSetFixtureFor(request: LlmTransportRequest): string {
  const text = requestText(request);
  const requestedType = text.match(/"choiceType":\s*"(\w+)"/)?.[1];
  const requestedBeatId = text.match(/"beatId":\s*"([^"]+)"/)?.[1];

  const base = text.includes('scene-2a') || text.includes('The Steward')
    ? expressionChoiceSetFixture()
    : branchChoiceSetFixture();

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

// ---------------------------------------------------------------- encounter

/**
 * EncounterArchitect runs its PHASED flow (executePhased): Phase 1 (opening
 * beat) → Phase 2 (one branch-situation call per opening choice) → Phase 3
 * (prior-state enrichment, when priorStateContext exists) → Phase 4
 * (storylets). Each phase is a separate LLM call with its own JSON shape, so
 * the fixture is request-aware on each phase prompt's distinctive header.
 */

function encounterPhase1Fixture(): string {
  return JSON.stringify({
    sceneId: 'scene-2b',
    encounterType: 'stealth',
    goalClock: {
      name: 'The Garden Door',
      segments: 6,
      description: 'Progress across the gallery toward the hidden garden door.',
    },
    threatClock: {
      name: 'The Waking House',
      segments: 4,
      description: 'How close the household comes to discovering the trespass.',
    },
    stakes: {
      victory: 'Mara reaches the garden door unseen, with the gallery\'s secret hers alone.',
      defeat: 'Edric finds her trespassing in the one wing her contract forbids.',
    },
    openingBeat: {
      setupText:
        'The gallery stretches ahead over the sealed wing, every third board grey with rot. Far below, a lantern moves through the east corridor at a steward\'s patient pace.',
      choices: [
        {
          id: 'c1',
          text: 'Cross fast while the light is distant',
          approach: 'aggressive',
          primarySkill: 'athletics',
          impliedApproach: 'aggressive',
          consequenceDomain: 'relationship',
          reminderPlan: {
            immediate: 'You traded quiet for speed before the light could turn.',
            shortTerm: 'The gallery is behind you faster, however loudly it remembers you.',
          },
          feedbackCue: {
            echoSummary: 'You chose speed over silence.',
            progressSummary: 'The far joist is suddenly close, and so is the noise you made.',
            checkClass: 'dramatic',
          },
          outcomes: {
            success: {
              narrativeText: 'You take the span in four long strides, weight rolling heel to toe, and the boards hold their tongue.',
              goalTicks: 2,
              threatTicks: 0,
            },
            complicated: {
              narrativeText: 'You make the far joist, but a board sighs behind you and the lantern below pauses mid-swing.',
              goalTicks: 1,
              threatTicks: 1,
            },
            failure: {
              narrativeText: 'A plank cracks like a knuckle under your heel. The lantern stops, then starts toward the stairs.',
              goalTicks: 0,
              threatTicks: 2,
            },
          },
        },
        {
          id: 'c2',
          text: 'Test each board before trusting it',
          approach: 'cautious',
          primarySkill: 'stealth',
          impliedApproach: 'cautious',
          consequenceDomain: 'relationship',
          reminderPlan: {
            immediate: 'You gave the floor your patience and asked for silence back.',
            shortTerm: 'The house stays asleep, but the night keeps spending itself.',
          },
          feedbackCue: {
            echoSummary: 'You chose patience over haste.',
            progressSummary: 'Every safe step costs a little more of the bell-counted night.',
            checkClass: 'dramatic',
          },
          outcomes: {
            success: {
              narrativeText: 'Toe, then weight, then the next: you read the floor the way you read a damaged ledger, and it gives you nothing but silence.',
              goalTicks: 2,
              threatTicks: 0,
            },
            complicated: {
              narrativeText: 'The slow way is the quiet way, but it costs time you do not have; the lantern below is a corridor closer when you look again.',
              goalTicks: 1,
              threatTicks: 1,
            },
            failure: {
              narrativeText: 'A sound board lies: it holds your toe and betrays your heel, and the report rolls down the empty wing.',
              goalTicks: 0,
              threatTicks: 2,
            },
          },
        },
        {
          id: 'c3',
          text: 'Read the dust for the servants\' old path',
          approach: 'clever',
          primarySkill: 'perception',
          impliedApproach: 'clever',
          consequenceDomain: 'relationship',
          reminderPlan: {
            immediate: 'You let the house itself tell you where it is safe to stand.',
            shortTerm: 'The old path holds, and the gallery starts giving up its habits.',
          },
          feedbackCue: {
            echoSummary: 'You chose to read the room before crossing it.',
            progressSummary: 'The floor stops being a stranger and starts being a map.',
            checkClass: 'dramatic',
          },
          outcomes: {
            success: {
              narrativeText: 'The dust remembers feet that crossed here for years: a scuffed line hugs the wall where the joists are doubled, and you follow it.',
              goalTicks: 2,
              threatTicks: 0,
            },
            complicated: {
              narrativeText: 'You find the old path, but kneeling to read the floor leaves you exposed when the lantern light climbs the far wall.',
              goalTicks: 1,
              threatTicks: 1,
            },
            failure: {
              narrativeText: 'The trail you trust is a rat-run, not a footpath; it walks you onto the worst of the rot before you know it.',
              goalTicks: 0,
              threatTicks: 2,
            },
          },
        },
      ],
    },
  });
}

/** One terminal branch-choice for a Phase 2 situation. */
function phase2Choice(
  id: string,
  text: string,
  approach: string,
  primarySkill: string,
  prose: { success: string; complicated: string; failure: string },
  outcomes: { success: string; complicated: string; failure: string },
): Record<string, unknown> {
  const tickFor = (o: string) => (o === 'victory' ? 3 : o === 'partialVictory' ? 2 : o === 'escape' ? 1 : 0);
  const threatFor = (o: string) => (o === 'defeat' ? 3 : o === 'partialVictory' ? 1 : 0);
  const build = (tier: 'success' | 'complicated' | 'failure') => {
    const encounterOutcome = outcomes[tier];
    const out: Record<string, unknown> = {
      narrativeText: prose[tier],
      goalTicks: tickFor(encounterOutcome),
      threatTicks: threatFor(encounterOutcome),
      isTerminal: true,
      encounterOutcome,
    };
    if (tier === 'failure' && encounterOutcome === 'defeat') {
      out.relationshipConsequences = [
        { npcId: 'npc-1', dimension: 'trust', change: -5, reason: 'Caught trespassing in the forbidden wing.' },
      ];
    }
    return out;
  };
  return {
    id,
    text,
    approach,
    primarySkill,
    consequenceDomain: 'relationship',
    reminderPlan: {
      immediate: 'You committed to the crossing on your own terms.',
      shortTerm: 'The gallery answers the way you treated it.',
    },
    feedbackCue: {
      echoSummary: `You chose: ${text.toLowerCase()}.`,
      progressSummary: 'The night narrows to the gap and what you do with it.',
      checkClass: 'dramatic',
    },
    outcomes: {
      success: build('success'),
      complicated: build('complicated'),
      failure: build('failure'),
    },
  };
}

function encounterPhase2Fixture(choiceId: string): string {
  const fixture = {
    choiceId,
    afterSuccess: {
      setupText:
        'The far half of the gallery opens ahead, quieter underfoot, and the garden door shows its outline in the wall. Only a body-length gap in the floor still argues.',
      choices: [
        phase2Choice(
          `${choiceId}-s-c1`,
          'Leap the gap to the garden door',
          'bold',
          'athletics',
          {
            success: 'You land on the far lip with both hands on the door frame, and the house keeps your secret. The key turns like it was oiled yesterday.',
            complicated: 'You make the jump but the landing takes your ankle sideways, and a splinter rips your palm open on the frame. The door opens; the price walks out with you.',
            failure: 'The lip crumbles under your lead foot and the gallery drops you into the sealed wing with a noise the whole house hears.',
          },
          { success: 'victory', complicated: 'partialVictory', failure: 'defeat' },
        ),
        phase2Choice(
          `${choiceId}-s-c2`,
          'Edge around on the surviving joist',
          'cautious',
          'stealth',
          {
            success: 'Back to the wall, heels on the one honest joist, you trade the gap an inch at a time and it lets you pass.',
            complicated: 'The joist holds; your nerve nearly does not. You reach the door with the lantern light already on the stairs and slip through with seconds to spare.',
            failure: 'Halfway across, the joist rolls. You catch the rail, but the clatter brings the light straight up the stairs.',
          },
          { success: 'victory', complicated: 'escape', failure: 'defeat' },
        ),
      ],
    },
    afterComplicated: {
      setupText:
        'You are across the worst of it, but the house below has gone from asleep to listening. The gap in the floor waits ahead, and somewhere behind you a door opens.',
      choices: [
        phase2Choice(
          `${choiceId}-p-c1`,
          'Take the gap at a run before the light arrives',
          'bold',
          'athletics',
          {
            success: 'You hit the far side a heartbeat before the lantern crests the stairs, and the garden door swallows you whole.',
            complicated: 'You clear the gap but land badly, and the bench you clip on the way through will tell its own story by morning. The door still opens.',
            failure: 'The run is loud and the landing louder; the light is on you before your hand finds the key.',
          },
          { success: 'victory', complicated: 'partialVictory', failure: 'defeat' },
        ),
        phase2Choice(
          `${choiceId}-p-c2`,
          'Go back the way you came while you still can',
          'cautious',
          'stealth',
          {
            success: 'You retrace the safe boards while the search climbs the wrong stair, and the library takes you back like nothing happened.',
            complicated: 'You make the portrait door with the light a corridor behind, out of the wing but no closer to the garden.',
            failure: 'The retreat meets the lantern coming up; there is no story that puts you on this landing innocently.',
          },
          { success: 'escape', complicated: 'escape', failure: 'defeat' },
        ),
      ],
    },
    afterFailure: {
      setupText:
        'The noise has a direction now and it is yours. The lantern is climbing, the gap is still ahead, and the gallery has stopped pretending to be empty.',
      choices: [
        phase2Choice(
          `${choiceId}-f-c1`,
          'Gamble everything on the jump',
          'desperate',
          'athletics',
          {
            success: 'Fear is a kind of wings: you clear the gap, palm the key, and are garden-side before the light tops the stairs.',
            complicated: 'You land short and haul yourself over the lip with the last of your grip; the door opens on a torn palm and a night gone loud.',
            failure: 'The jump dies at the rotten lip and the fall is short, loud, and final. The lantern finds you among the lath.',
          },
          { success: 'victory', complicated: 'partialVictory', failure: 'defeat' },
        ),
        phase2Choice(
          `${choiceId}-f-c2`,
          'Hide in the window bay and let the search pass',
          'cautious',
          'stealth',
          {
            success: 'The bay curtain is moth-eaten but honest. The light walks past you twice and goes back down, unsatisfied.',
            complicated: 'The search passes, but it leaves a man on the landing; the only way out now is the gap, later, colder.',
            failure: 'The curtain moves when you breathe. It is Edric who draws it back.',
          },
          { success: 'escape', complicated: 'escape', failure: 'defeat' },
        ),
      ],
    },
  };
  for (const [key, text] of [
    ['afterSuccess', 'Read the hinge scars before crossing'],
    ['afterComplicated', 'Use the old nailheads as a map'],
    ['afterFailure', 'Risk the servants\' forgotten crawlspace'],
  ] as const) {
    const section = fixture[key];
    section.choices.push(phase2Choice(
      `${choiceId}-${key === 'afterSuccess' ? 's' : key === 'afterComplicated' ? 'p' : 'f'}-c3`,
      text,
      'clever',
      'perception',
      {
        success: 'The house leaves a practical history in its scars, and you follow it where the boards still remember weight.',
        complicated: 'The marks guide you forward, but reading them takes long enough for the lantern to find the stair.',
        failure: 'You trust the wrong scar and the floor tells everyone exactly where you are.',
      },
      { success: 'victory', complicated: 'partialVictory', failure: 'defeat' },
    ));
  }
  return JSON.stringify(fixture);
}

function encounterPhase3Fixture(): string {
  return JSON.stringify({
    setupTextVariants: [
      {
        condition: { type: 'flag', flag: 'took_passage', value: true },
        text: 'The passage spits you out at the gallery\'s mouth still carrying the dark of the stair in your eyes. Every third board ahead is grey with rot, and below, a lantern keeps a steward\'s patient pace.',
      },
    ],
    statBonuses: [
      {
        choiceRef: 'c3',
        condition: { type: 'flag', flag: 'found_passage', value: true },
        difficultyReduction: 10,
        flavorText: 'The hinge behind the portrait taught you how this house hides its workings.',
      },
    ],
    conditionalChoices: [],
  });
}

function encounterPhase4Fixture(outcome: string): string {
  if (outcome === 'partialVictory') {
    return JSON.stringify({
      cost: {
        domain: 'mixed',
        severity: 'moderate',
        whoPays: 'protagonist',
        immediateEffect: 'The garden crossing is slow and loud where it most needs to be quick.',
        visibleComplication: 'Your palm is torn and your ankle will not take weight cleanly.',
      },
      beats: [
        {
          text: 'The garden door closes behind you, but the gallery keeps a toll: your palm throbs around the splinter and your ankle argues every step.',
        },
        {
          text: 'By morning the household will read tonight in your hands whether you confess it or not. You are through, and you are not unmarked.',
        },
      ],
    });
  }
  if (outcome === 'defeat') {
    return JSON.stringify({
      beats: [
        {
          text: 'The lantern crests the stairs and stops, and Edric\'s face above it is worse than anger: it is arithmetic.',
        },
        {
          text: 'He does not call the house down. He waits until you understand how useful your trespass has made you.',
        },
        {
          text: 'You square your composure like a stack of paper and decide the east wing was worth the price.',
        },
      ],
    });
  }
  if (outcome === 'escape') {
    return JSON.stringify({
      beats: [
        {
          text: 'You pull the garden door to as the light reaches the top stair and stand in the night with your heart counting seconds.',
        },
        {
          text: 'No footsteps follow. The gallery keeps what it saw, and you keep your commission tonight.',
        },
      ],
    });
  }
  return JSON.stringify({
    beats: [
      {
        text: 'You ease the garden door shut behind you and the house exhales on the other side, none the wiser.',
      },
    ],
  });
}

/**
 * Route an Encounter Architect call to the right phase fixture by each phase
 * prompt's distinctive opening line. Phase 2 echoes the prompt-dictated
 * choiceId so the branch situations attach to the correct opening choice.
 */
function encounterArchitectFixtureFor(request: LlmTransportRequest): string {
  const text = requestText(request);
  if (text.includes('Generate the OPENING BEAT')) return encounterPhase1Fixture();
  if (text.includes('Generate the NEXT MOMENT after the player chose')) {
    const choiceId = text.match(/"choiceId":\s*"([^"]+)"/)?.[1] ?? 'c1';
    return encounterPhase2Fixture(choiceId);
  }
  if (text.includes('Generate ENRICHMENT')) return encounterPhase3Fixture();
  if (text.includes('Generate encounter STORYLETS') || text.includes('## STORYLETS')) {
    const outcome = text.match(/encounter_phase_4_([A-Za-z]+)_draft/)?.[1] ?? 'victory';
    return encounterPhase4Fixture(outcome);
  }
  // Lean-path fallback (only reached if the phased flow throws).
  return encounterLeanStructureFixture();
}

/**
 * Minimal-but-valid lean-path EncounterStructure (legacy fallback shape).
 * Kept for the lean retry path; the phased fixtures above are the primary
 * coverage.
 */
function encounterLeanStructureFixture(): string {
  return JSON.stringify({
    sceneId: 'scene-2b',
    encounterType: 'stealth',
    encounterStyle: 'stealth',
    goalClock: {
      name: 'The Garden Door',
      segments: 6,
      description: 'Progress across the gallery toward the hidden garden door.',
    },
    threatClock: {
      name: 'The Waking House',
      segments: 4,
      description: 'How close the household comes to discovering the trespass.',
    },
    stakes: {
      victory: 'Mara reaches the garden door unseen, with the gallery\'s secret hers alone.',
      defeat: 'Edric finds her trespassing in the one wing her contract forbids.',
    },
    startingBeatId: 'beat-1',
    beats: [
      {
        id: 'beat-1',
        phase: 'setup',
        name: 'The First Span',
        description: 'Testing the rotten boards while the lantern light is far away.',
        setupText:
          'The gallery stretches ahead over the sealed wing, every third board gone grey with rot. Far below, a lantern moves through the east corridor at a steward\'s patient pace.',
        choices: [
          {
            id: 'b1-c1',
            text: 'Cross fast while the light is distant',
            approach: 'aggressive',
            primarySkill: 'athletics',
            outcomes: {
              success: {
                tier: 'success',
                narrativeText: 'You take the span in four long strides, weight rolling heel to toe, and the boards hold their tongue.',
                goalTicks: 2,
                threatTicks: 0,
                nextBeatId: 'beat-2',
              },
              complicated: {
                tier: 'complicated',
                narrativeText: 'You make the far joist, but a board sighs behind you and the lantern below pauses mid-swing.',
                goalTicks: 1,
                threatTicks: 1,
                nextBeatId: 'beat-2',
              },
              failure: {
                tier: 'failure',
                narrativeText: 'A plank cracks like a knuckle under your heel. The lantern stops, then starts toward the stairs.',
                goalTicks: 0,
                threatTicks: 2,
                nextBeatId: 'beat-2',
              },
            },
          },
          {
            id: 'b1-c2',
            text: 'Test each board before trusting it',
            approach: 'cautious',
            primarySkill: 'stealth',
            outcomes: {
              success: {
                tier: 'success',
                narrativeText: 'Toe, then weight, then the next: you read the floor the way you read a damaged ledger, and it gives you nothing but silence.',
                goalTicks: 2,
                threatTicks: 0,
                nextBeatId: 'beat-2',
              },
              complicated: {
                tier: 'complicated',
                narrativeText: 'The slow way is the quiet way, but it costs time you do not have; the lantern below is a corridor closer when you look again.',
                goalTicks: 1,
                threatTicks: 1,
                nextBeatId: 'beat-2',
              },
              failure: {
                tier: 'failure',
                narrativeText: 'A sound board lies: it holds your toe and betrays your heel, and the report rolls down the empty wing.',
                goalTicks: 0,
                threatTicks: 2,
                nextBeatId: 'beat-2',
              },
            },
          },
          {
            id: 'b1-c3',
            text: 'Read the dust for the servants\' old path',
            approach: 'clever',
            primarySkill: 'perception',
            outcomes: {
              success: {
                tier: 'success',
                narrativeText: 'The dust remembers feet that crossed here for years: a scuffed line hugs the wall where the joists are doubled, and you follow it.',
                goalTicks: 2,
                threatTicks: 0,
                nextBeatId: 'beat-2',
              },
              complicated: {
                tier: 'complicated',
                narrativeText: 'You find the old path, but kneeling to read the floor leaves you exposed when the lantern light climbs the far wall.',
                goalTicks: 1,
                threatTicks: 1,
                nextBeatId: 'beat-2',
              },
              failure: {
                tier: 'failure',
                narrativeText: 'The trail you trust is a rat-run, not a footpath; it walks you onto the worst of the rot before you know it.',
                goalTicks: 0,
                threatTicks: 2,
                nextBeatId: 'beat-2',
              },
            },
          },
        ],
      },
      {
        id: 'beat-2',
        phase: 'rising',
        name: 'The Lantern Sweep',
        description: 'Edric\'s light sweeps the gallery and Mara must freeze, hide, or move.',
        setupText:
          'Light blooms up the stairwell at the gallery\'s midpoint and lays a slow yellow stripe along the boards. Somewhere under it, keys shift on a ring you would know anywhere.',
        choices: [
          {
            id: 'b2-c1',
            text: 'Move through the dark between sweeps',
            approach: 'aggressive',
            primarySkill: 'athletics',
            outcomes: {
              success: {
                tier: 'success',
                narrativeText: 'You move when the light does, two beats behind it, and gain the gallery\'s far turn while the stripe slides the other way.',
                goalTicks: 2,
                threatTicks: 0,
                nextBeatId: 'beat-3',
              },
              complicated: {
                tier: 'complicated',
                narrativeText: 'You cross with the sweep, but your shadow crosses it back; below, the keys go quiet in a listening way.',
                goalTicks: 1,
                threatTicks: 1,
                nextBeatId: 'beat-3',
              },
              failure: {
                tier: 'failure',
                narrativeText: 'You misjudge the rhythm and the light catches your hem; the lantern swings up toward the gallery rail.',
                goalTicks: 0,
                threatTicks: 2,
                nextBeatId: 'beat-3',
              },
            },
          },
          {
            id: 'b2-c2',
            text: 'Freeze against the panelling until it passes',
            approach: 'cautious',
            primarySkill: 'stealth',
            outcomes: {
              success: {
                tier: 'success',
                narrativeText: 'You become one more shadow among the portraits, and the light walks over you without recognition.',
                goalTicks: 1,
                threatTicks: 0,
                nextBeatId: 'beat-3',
              },
              complicated: {
                tier: 'complicated',
                narrativeText: 'The light passes, but waiting pinned to the panelling costs the night minutes it will not give back.',
                goalTicks: 0,
                threatTicks: 1,
                nextBeatId: 'beat-3',
              },
              failure: {
                tier: 'failure',
                narrativeText: 'Your held breath breaks on the dust; the cough is small and the gallery makes it enormous.',
                goalTicks: 0,
                threatTicks: 2,
                nextBeatId: 'beat-3',
              },
            },
          },
          {
            id: 'b2-c3',
            text: 'Drop a coin down the far stairwell',
            approach: 'clever',
            primarySkill: 'deception',
            outcomes: {
              success: {
                tier: 'success',
                narrativeText: 'The coin rings twice on stone two corridors away, and the lantern goes hunting the sound with the whole house behind it.',
                goalTicks: 2,
                threatTicks: 0,
                nextBeatId: 'beat-3',
              },
              complicated: {
                tier: 'complicated',
                narrativeText: 'The light turns toward the sound, but a steward who has kept this house thirty years does not chase coins for long.',
                goalTicks: 1,
                threatTicks: 1,
                nextBeatId: 'beat-3',
              },
              failure: {
                tier: 'failure',
                narrativeText: 'The coin skips wrong and dies a yard from the stairwell, ringing not like a ghost but like a thing thrown.',
                goalTicks: 0,
                threatTicks: 2,
                nextBeatId: 'beat-3',
              },
            },
          },
        ],
      },
      {
        id: 'beat-3',
        phase: 'resolution',
        name: 'The Gap',
        description: 'The last stretch of floor is gone and the garden door waits beyond it.',
        setupText:
          'The gallery ends in honesty: a body-length of floor has simply gone, lath and all, and the garden door stands on the far side with its key in the lock.',
        isTerminal: true,
        choices: [
          {
            id: 'b3-c1',
            text: 'Leap the gap to the garden door',
            approach: 'aggressive',
            primarySkill: 'athletics',
            outcomes: {
              success: {
                tier: 'success',
                narrativeText: 'You land on the far lip with both hands on the door frame, and the house keeps your secret. The key turns like it was oiled yesterday.',
                goalTicks: 3,
                threatTicks: 0,
                isTerminal: true,
                encounterOutcome: 'victory',
              },
              complicated: {
                tier: 'complicated',
                narrativeText: 'You make the jump but the landing takes your ankle sideways, and a splinter rips your palm open on the frame. The door opens; the price walks out with you.',
                goalTicks: 2,
                threatTicks: 1,
                isTerminal: true,
                encounterOutcome: 'partialVictory',
                cost: {
                  visibleComplication: 'A torn palm and a limp she cannot hide in the morning',
                  immediateEffect: 'The garden crossing is slow and loud where it most needs to be quick',
                },
              },
              failure: {
                tier: 'failure',
                narrativeText: 'The lip crumbles under your lead foot and the gallery drops you into the sealed wing with a noise the whole house hears. The lantern is there before the dust settles.',
                goalTicks: 0,
                threatTicks: 3,
                isTerminal: true,
                encounterOutcome: 'defeat',
              },
            },
          },
          {
            id: 'b3-c2',
            text: 'Edge around on the surviving joist',
            approach: 'cautious',
            primarySkill: 'stealth',
            outcomes: {
              success: {
                tier: 'success',
                narrativeText: 'Back to the wall, heels on the one honest joist, you trade the gap an inch at a time and it lets you pass. The garden door takes your weight like a friend.',
                goalTicks: 2,
                threatTicks: 0,
                isTerminal: true,
                encounterOutcome: 'victory',
              },
              complicated: {
                tier: 'complicated',
                narrativeText: 'The joist holds; your nerve nearly does not. You reach the door with the lantern light already climbing the stairwell behind you, and slip through with seconds to spare.',
                goalTicks: 1,
                threatTicks: 1,
                isTerminal: true,
                encounterOutcome: 'escape',
              },
              failure: {
                tier: 'failure',
                narrativeText: 'Halfway across, the joist rolls. You catch the rail, but the clatter brings the light straight up the stairs, and there is nowhere on a beam to hide.',
                goalTicks: 0,
                threatTicks: 2,
                isTerminal: true,
                encounterOutcome: 'defeat',
              },
            },
          },
          {
            id: 'b3-c3',
            text: 'Bridge the gap with the gallery bench',
            approach: 'clever',
            primarySkill: 'investigation',
            outcomes: {
              success: {
                tier: 'success',
                narrativeText: 'The dust sheet comes off a long oak bench built when furniture meant it. Laid across the gap it makes a bridge your weight barely interests, and you cross at a walk.',
                goalTicks: 3,
                threatTicks: 0,
                isTerminal: true,
                encounterOutcome: 'victory',
              },
              complicated: {
                tier: 'complicated',
                narrativeText: 'The bench spans the gap but grates against the lip as you cross, loud as a drawn bolt. You leave it lying there — by morning, someone will know exactly how the gallery was crossed.',
                goalTicks: 2,
                threatTicks: 1,
                isTerminal: true,
                encounterOutcome: 'partialVictory',
                cost: {
                  visibleComplication: 'The bench left bridging the gap is a signed confession',
                  immediateEffect: 'The household will know the gallery was crossed tonight',
                },
              },
              failure: {
                tier: 'failure',
                narrativeText: 'The bench is lighter than it looks and older than it admits; it tips into the gap and takes a yard of lath with it. The crash empties every bell in the house.',
                goalTicks: 0,
                threatTicks: 3,
                isTerminal: true,
                encounterOutcome: 'defeat',
              },
            },
          },
        ],
      },
    ],
    tensionCurve: [
      { beatId: 'beat-1', tensionLevel: 4, description: 'Testing the floor while the light is far away' },
      { beatId: 'beat-2', tensionLevel: 7, description: 'The sweep: discovery a held breath away' },
      { beatId: 'beat-3', tensionLevel: 9, description: 'The gap: commit or be caught' },
    ],
    storylets: {
      victory: {
        id: 'scene-2b-storylet-victory',
        name: 'The Door Unwatched',
        triggerOutcome: 'victory',
        tone: 'quiet triumph',
        narrativeFunction: 'Land the clean crossing and hand the night to the garden.',
        beats: [
          {
            id: 'scene-2b-sv-1',
            text: 'You ease the garden door shut behind you and the house exhales on the other side, none the wiser. Whatever the gallery overlooks, you are the only one who knows you saw it.',
            isTerminal: true,
          },
        ],
        startingBeatId: 'scene-2b-sv-1',
        consequences: [],
        nextSceneId: 'scene-3',
      },
      partialVictory: {
        id: 'scene-2b-storylet-partial',
        name: 'Through, and Marked',
        triggerOutcome: 'partialVictory',
        tone: 'costly relief',
        narrativeFunction: 'The crossing succeeds but its price follows her out.',
        beats: [
          {
            id: 'scene-2b-sp-1',
            text: 'The garden door closes behind you, but the gallery kept a toll: your palm throbs around the splinter and the night\'s evidence will read plainly by daylight. You are through. You are not unseen by the house itself.',
            isTerminal: true,
          },
        ],
        startingBeatId: 'scene-2b-sp-1',
        consequences: [],
        nextSceneId: 'scene-3',
      },
      defeat: {
        id: 'scene-2b-storylet-defeat',
        name: 'The Lantern Finds You',
        triggerOutcome: 'defeat',
        tone: 'cold exposure',
        narrativeFunction: 'Caught in the forbidden wing, with everything that costs.',
        beats: [
          {
            id: 'scene-2b-sd-1',
            text: 'The lantern crests the stairs and stops, and Edric\'s face above it is worse than anger: it is arithmetic. He looks at where you stand, in the one wing your contract forbids, and begins to count what it makes you.',
            isTerminal: true,
          },
        ],
        startingBeatId: 'scene-2b-sd-1',
        consequences: [],
        nextSceneId: 'scene-3',
      },
      escape: {
        id: 'scene-2b-storylet-escape',
        name: 'Out by a Breath',
        triggerOutcome: 'escape',
        tone: 'ragged relief',
        narrativeFunction: 'Tension release: out of the gallery with nothing to spare.',
        beats: [
          {
            id: 'scene-2b-se-1',
            text: 'You pull the garden door to as the light reaches the top stair, and stand in the night with your heart hammering the seconds. No footsteps follow. Tonight, that has to be enough.',
            isTerminal: true,
          },
        ],
        startingBeatId: 'scene-2b-se-1',
        consequences: [],
        nextSceneId: 'scene-3',
      },
    },
    environmentalElements: [],
    npcStates: [],
    escalationTriggers: [],
    informationVisibility: {
      threatClockVisible: true,
      npcTellsRevealAt: 'encounter_50_percent',
      environmentElementsHidden: [],
      choiceOutcomesUnknown: true,
    },
    estimatedDuration: 'medium',
    replayability: 'medium',
    designNotes: 'Stealth crossing with three approach lanes per beat and a committed terminal beat.',
  });
}

// ---------------------------------------------------------------- map

/**
 * Fixture map for one generate() run of the branching brief. Single
 * (non-array) entries repeat for every call from that agent, so retry/repair
 * loops stay covered; request-aware functions answer for the right scene by
 * the prompt's `**Scene ID**:` / `**Scene**:` markers regardless of call
 * order.
 */
export function buildBranchingRunFixtureMap(): ScriptedFixtureMap {
  return {
    'World Builder': JSON.stringify(worldBible),
    'Character Designer': JSON.stringify(characterBible),
    'Story Architect': JSON.stringify(branchingEpisodeBlueprint),
    'Branch Manager': JSON.stringify(branchingBranchAnalysis),
    'Scene Writer': (request) => {
      const text = requestText(request);
      if (text.includes('**Scene ID**: scene-2a')) return branchingSceneFixture('scene-2a');
      if (text.includes('**Scene ID**: scene-3')) return branchingSceneFixture('scene-3');
      if (text.includes('**Scene ID**: scene-1')) return branchingSceneFixture('scene-1');
      // Fallback for prompts that don't carry the Scene ID marker (e.g.
      // targeted rewrites quote the scene name instead).
      if (text.includes('The Steward')) return branchingSceneFixture('scene-2a');
      if (text.includes('East Garden')) return branchingSceneFixture('scene-3');
      return branchingSceneFixture('scene-1');
    },
    'Choice Author': (request) => branchingChoiceSetFixtureFor(request),
    'Encounter Architect': (request) => encounterArchitectFixtureFor(request),
  };
}
