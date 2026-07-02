/**
 * Scripted LLM fixtures for the full-run prompt-snapshot characterization test
 * (FullStoryPipeline.promptSnapshot.test.ts). Minimal-but-valid responses per
 * agent — just enough for parsers and post-parse validation to accept on the
 * first attempt, so the captured call sequence is stable.
 *
 * These are NOT story-quality examples. They exist so a 1-episode text-only
 * generate() run completes offline and the prompt sequence can be golden-filed.
 */

import type { LlmTransportRequest } from '../agents/BaseAgent';
import type { ScriptedFixtureMap } from './promptCapture';

// ---------------------------------------------------------------- helpers

export function requestText(request: LlmTransportRequest): string {
  return request.messages
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
    .join('\n');
}

// ---------------------------------------------------------------- world

export const worldBible = {
  worldRules: ['Iron disrupts the old magic'],
  taboos: ['Naming the drowned god aloud'],
  majorEvents: [
    {
      name: 'The Breaking',
      description: 'The ancient seal shattered, releasing old magic into the coastal towns.',
      yearsAgo: '500',
      impact: 'Magic became unpredictable near the sea.',
    },
  ],
  locations: [
    {
      id: 'loc-1',
      name: 'Greyharbor Manor',
      type: 'manor',
      overview: 'A salt-worn manor on the cliffs above the harbor town.',
      fullDescription:
        'Greyharbor Manor rises from white cliffs where the sea crashes against stone. Its corridors smell of salt and old paper, and half its rooms have been shut for a generation.',
      sensoryDetails: {
        sights: ['Dust motes in slanted light', 'Portraits with eyes gone dark'],
        sounds: ['Waves against the cliff base', 'Floorboards settling'],
        smells: ['Salt brine', 'Cold ash'],
        textures: ['Smooth banister worn by hands'],
        atmosphere: 'Held breath before a storm',
      },
      secrets: ['A passage behind the library portrait'],
      dangers: ['Rotten flooring in the east wing'],
      opportunities: ['The library holds the family ledgers'],
      connectedLocations: ['loc-2'],
      timeOfDayVariations: {
        day: 'Servants move through the lower halls',
        night: 'Only the wind keeps watch',
      },
    },
    {
      id: 'loc-2',
      name: 'East Garden',
      type: 'garden',
      overview: 'An overgrown walled garden behind the manor.',
      fullDescription:
        'The east garden has gone half-wild, its hedges swallowing the old paths. An iron gate at the far wall opens toward the village lights far below the cliffs.',
      sensoryDetails: {
        sights: ['Moonlight on wet leaves', 'The iron gate against the sky'],
        sounds: ['Wind through the hedges', 'Distant harbor bells'],
        smells: ['Wet earth', 'Roses gone feral'],
        textures: ['Cold iron of the gate latch'],
        atmosphere: 'Freedom within reach',
      },
      secrets: ['The gate key is hidden under the sundial'],
      dangers: ['The cliff path crumbles in the rain'],
      opportunities: ['A way out unseen by the household'],
      connectedLocations: ['loc-1'],
      timeOfDayVariations: {
        day: 'A gardener tends the near beds',
        night: 'Empty and silver under the moon',
      },
    },
  ],
  factions: [
    {
      id: 'faction-1',
      name: 'The Household',
      type: 'domestic',
      overview: 'The staff and family of Greyharbor Manor, loyal to its secrets.',
      goals: ['Keep the family name unstained'],
      methods: ['Silence', 'Watchfulness'],
      values: ['Loyalty', 'Discretion'],
      leaderDescription: 'The steward, an exact man with exact ledgers',
      memberProfile: 'Servants, groundskeepers, the family lawyer',
      hierarchy: 'Steward above all staff',
      allies: [],
      enemies: [],
      neutralRelations: [],
      territories: ['The manor and its grounds'],
      symbols: ['A grey gull on white'],
      recognition: 'Grey livery with bone buttons',
    },
  ],
  customs: ['Doors are locked at the tenth bell'],
  beliefs: ['The sea returns what it takes, changed'],
  tensions: ['The household whispers about the shut east wing'],
  doNotForget: ['The manor hides a passage behind the library portrait'],
};

// ---------------------------------------------------------------- characters

const voiceProfileBase = {
  vocabulary: 'educated',
  sentenceLength: 'average',
  formality: 'neutral',
  verbalTics: ['Pauses before answering'],
  favoriteExpressions: ['As it happens'],
  avoidedWords: ['Hope'],
  whenHappy: 'A brief, real smile',
  whenAngry: 'Voice drops, words slow down',
  whenNervous: 'Straightens things that are already straight',
  whenLying: 'Over-explains the harmless details',
  greetingExamples: ['You found me, then.', 'Evening. You look like a question.'],
  farewellExamples: ['Mind the stairs.', 'Until next bell.'],
  underStressExamples: ['Not here. Not with them listening.', 'Ask me tomorrow, if tomorrow comes.'],
  signatureLines: ['Houses keep what people bury.', 'Every locked door was locked by someone.'],
  writingGuidance: 'Direct, economical, watchful. Humor surfaces rarely and dry.',
};

export const characterBible = {
  characters: [
    {
      id: 'prot-1',
      name: 'Mara Voss',
      pronouns: 'she/her',
      role: 'protagonist',
      importance: 'major',
      tier: 'core',
      overview: 'A hired archivist who reads houses the way others read faces.',
      fullBackground:
        'Mara catalogues the libraries of old families and has learned that ledgers lie less than people. Greyharbor is her third commission this year and the first to lock its east wing.',
      want: 'To finish the catalogue and learn what the shut east wing hides',
      fear: 'That she will become complicit in whatever the household is concealing',
      flaw: 'She trusts documents over people, and people notice',
      need: 'To learn that some truths only people can give her',
      truth: 'Curiosity without courage is just trespass',
      wound: 'The last house she catalogued burned with its secrets',
      microLies: ['I only care about the books'],
      traits: ['Observant', 'Stubborn', 'Dry-witted'],
      values: ['Truth', 'Craft'],
      quirks: ['Squares the corners of any stack of paper', 'Counts doors in a new corridor'],
      physicalDescription:
        'Small and quick, ink-stained fingers, hair pinned with whatever was nearest that morning.',
      distinctiveFeatures: ['Ink stains on her right hand', 'A key ring with no labels'],
      typicalAttire: 'Practical wool dress with deep pockets, archivist gloves at her belt',
      voiceProfile: { ...voiceProfileBase },
      relationships: [
        {
          targetId: 'npc-1',
          targetName: 'Edric Hale',
          relationshipType: 'professional',
          currentDynamic: 'Wary courtesy: Edric watches her work too closely for a steward with nothing to hide',
          history: 'He hired her by letter and met her at the gate with the household rules',
          unresolvedIssues: ['Why the east wing is excluded from her catalogue'],
          potentialConflicts: ['If Mara enters the east wing, Edric must choose between her and the family'],
          couldBecome: ['Reluctant allies'],
        },
      ],
      arcPotential: {
        currentState: 'An outsider hired to handle the house\'s memory',
        possibleGrowth: 'Choosing people over paper when it costs her',
        possibleFall: 'Selling what she finds to the highest bidder',
        triggerEvents: ['Finding the passage', 'Edric\'s confession'],
      },
      secrets: ['She was sent a letter about this house before the commission arrived'],
      initialStats: { trust: 10, affection: 5, respect: 40, fear: 10 },
    },
    {
      id: 'npc-1',
      name: 'Edric Hale',
      pronouns: 'he/him',
      role: 'wildcard',
      importance: 'major',
      tier: 'core',
      overview: 'The manor\'s steward, exact in everything except his answers.',
      fullBackground:
        'Edric has served Greyharbor for thirty years and keeps its ledgers, its keys, and its silences. He hired Mara knowing what the library hides.',
      want: 'To control what the archivist finds and when',
      fear: 'That the family\'s buried debt will surface and ruin them all',
      flaw: 'He believes loyalty excuses anything done quietly',
      traits: ['Precise', 'Guarded', 'Loyal'],
      values: ['Duty', 'Order'],
      quirks: ['Polishes his keys while thinking', 'Never sits in the family\'s chairs'],
      physicalDescription: 'Tall, grey at the temples, dressed a decade out of fashion and immaculate.',
      distinctiveFeatures: ['A heavy ring of unlabeled keys', 'A scar across two knuckles'],
      typicalAttire: 'Grey steward\'s coat with bone buttons',
      voiceProfile: { ...voiceProfileBase },
      relationships: [
        {
          targetId: 'prot-1',
          targetName: 'Mara Voss',
          relationshipType: 'professional',
          currentDynamic: 'Employer\'s agent and hired specialist, each measuring the other',
          history: 'Three days of correct, careful coexistence',
          unresolvedIssues: ['What he is not telling her about the catalogue'],
          potentialConflicts: ['Her curiosity against his orders'],
          couldBecome: ['Confidant or adversary, depending on the east wing'],
        },
      ],
      arcPotential: {
        currentState: 'A keeper of other people\'s secrets',
        possibleGrowth: 'Deciding the truth serves the family better than silence',
        possibleFall: 'Destroying evidence and the archivist\'s trust with it',
        triggerEvents: ['Mara finding the passage', 'A letter from the family lawyer'],
      },
      secrets: ['He wrote the anonymous letter that brought Mara here'],
      initialStats: { trust: 20, affection: 0, respect: 50, fear: 5 },
    },
  ],
  relationshipSummary:
    'Mara and Edric circle the same locked rooms: she wants what the house knows, he wants to decide what it tells.',
  keyDynamics: [
    {
      characters: ['prot-1', 'npc-1'],
      dynamic: 'Archivist and steward: curiosity against custody',
      narrativePotential: 'Either becomes the other\'s key or the other\'s lock',
    },
  ],
  ensembleBalance:
    'Mara drives discovery; Edric controls access. Every scene can turn on what one of them withholds.',
  gaps: ['No outside authority figure yet'],
  voiceDistinctions:
    'Mara is dry, quick, and concrete. Edric is formal, exact, and evasive. Their cadences never blur.',
  doNotForget: ['The east wing is locked', 'Edric sent the anonymous letter'],
};

// ---------------------------------------------------------------- blueprint

const episodeBlueprint = {
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

// ---------------------------------------------------------------- branches

const branchAnalysis = {
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

// ---------------------------------------------------------------- scenes

export function sceneFixture(sceneId: string): string {
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
          text: 'Neither of you speaks. The passage waits at your back, and Edric waits at the door, and the candle burns down between you.',
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
      sceneTakeaways: ['The hidden passage is real.', 'Edric knows about the door and now knows Mara found it.'],
      continuityNotes: ['The scene ends on the unresolved standoff at the passage.'],
    });
  }
  if (sceneId === 'scene-2') {
    return JSON.stringify({
      sceneId: 'scene-2',
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
      sceneTakeaways: ['The east wing was sealed by someone outside the family.', 'Edric withholds the name but gives Mara a direction.'],
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
        text: 'The passage climbs, turns twice, and lets you out through a door masked as garden wall. Moonlight floods the overgrown hedges.',
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
        text: 'Your hand closes on the cold latch. Whatever you carried out of that passage, the night is about to ask what you mean to do with it.',
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
    sceneTakeaways: ['The passage leads out into the garden.', 'Mara reaches the gate with the house waking behind her.'],
    continuityNotes: ['Carries the residue of how scene-1 ended.'],
  });
}

/**
 * Choice Author prompts identify the scene by NAME (`- **Scene**: ...`) and
 * dictate the beatId/choiceType in the required JSON structure — echo all
 * three back so the set passes incremental validation for whichever scene and
 * planner-assigned type this call is for.
 */
function choiceSetFixtureFor(request: LlmTransportRequest): string {
  const text = requestText(request);
  const requestedType = text.match(/"choiceType":\s*"(\w+)"/)?.[1] ?? 'expression';
  const requestedBeatId = text.match(/"beatId":\s*"([^"]+)"/)?.[1] ?? 'beat-3';
  let sceneId = 'scene-1';
  if (text.includes('scene-2') || text.includes('The Steward')) sceneId = 'scene-2';
  else if (text.includes('scene-3') || text.includes('The East Garden')) sceneId = 'scene-3';

  const base = sceneId === 'scene-2' ? JSON.parse(expressionChoiceSetFixture()) : JSON.parse(relationshipChoiceSetFixture());
  if (sceneId === 'scene-3') {
    base.choices = [
      {
        ...base.choices[0],
        text: 'Lift the latch and take the cliff path tonight',
        reactionText: 'The gate gives with a low iron groan.',
        outcomeTexts: {
          success: 'The path holds under your feet, and the village lights rise to meet you.',
          partial: 'The gate opens, but a lamp kindles in the house behind you.',
          failure: 'The latch shrieks, and somewhere above a window scrapes open.',
        },
      },
      {
        ...base.choices[1],
        text: 'Turn back and finish what you started inside',
        reactionText: 'You let the latch settle back into its cradle.',
        outcomeTexts: {
          success: 'The passage takes you back the way you came, and the house pretends not to notice.',
          partial: 'You slip back inside, though the garden door no longer sits quite true.',
          failure: 'The hidden door has swung shut behind you, and the garden keeps you.',
        },
      },
    ];
  }
  ensureThreeChoiceSurface(base);
  base.sceneId = sceneId;
  base.beatId = requestedBeatId;
  base.choiceType = requestedType;
  for (const choice of base.choices) {
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
  return JSON.stringify(base);
}

function ensureThreeChoiceSurface(base: { choices: Array<Record<string, unknown>>; choiceType?: string }): void {
  if (base.choices.length >= 3) return;
  base.choices.push({
    id: `choice-${base.choices.length + 1}`,
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

function expressionChoiceSetFixture(): string {
  return JSON.stringify({
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
  });
}

function relationshipChoiceSetFixture(): string {
  return JSON.stringify({
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
            target: 'npc-1',
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
        moralContract: {
          valueA: 'Truth',
          valueB: 'Trust',
          unavoidableCost: 'One of them tonight',
          whoBenefits: 'Mara and whoever the truth serves',
          whoIsHarmed: 'Edric, left holding the door she would not share',
          whatRemainsUncertain: 'Whether the passage was a test he set',
        },
      },
      {
        id: 'choice-2',
        text: 'Turn from the passage and ask Edric for the truth',
        choiceType: 'relationship',
        consequences: [
          {
            type: 'relationship',
            target: 'npc-1',
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
        moralContract: {
          valueA: 'Trust',
          valueB: 'Truth',
          unavoidableCost: 'The passage may close forever',
          whoBenefits: 'Edric, and perhaps the family',
          whoIsHarmed: 'Whoever needed what the passage hides',
          whatRemainsUncertain: 'Whether he will answer honestly',
        },
      },
    ],
    overallStakes: {
      want: 'The truth about the east wing',
      cost: 'Either the passage or the man who guards it',
      identity: 'What kind of archivist Mara is when no one can stop her',
    },
    designNotes: 'Dilemma between stolen truth and offered trust.',
  });
}

// ---------------------------------------------------------------- map

/**
 * Fixture map for one generate() run of the snapshot brief. Single (non-array)
 * entries repeat for every call from that agent, so retry/repair loops and
 * per-scene fan-out stay covered; request-aware functions answer for the right
 * scene regardless of call order.
 */
export function buildFullRunFixtureMap(): ScriptedFixtureMap {
  return {
    'World Builder': JSON.stringify(worldBible),
    'Character Designer': JSON.stringify(characterBible),
    'Story Architect': JSON.stringify(episodeBlueprint),
    'Branch Manager': JSON.stringify(branchAnalysis),
    'Scene Writer': (request) => {
      const text = requestText(request);
      // Match the blueprint's own Scene ID marker, not any mention of a scene
      // id — turn-contract handoff lines ("Hand forward to scene-3 …") name
      // neighboring scenes inside another scene's prompt.
      if (text.includes('**Scene ID**: scene-3')) return sceneFixture('scene-3');
      if (text.includes('**Scene ID**: scene-2')) return sceneFixture('scene-2');
      if (text.includes('**Scene ID**: scene-1')) return sceneFixture('scene-1');
      // Fallback for prompts without the Scene ID marker (targeted rewrites
      // quote the scene name instead).
      if (text.includes('East Garden')) return sceneFixture('scene-3');
      if (text.includes('The Steward')) return sceneFixture('scene-2');
      return sceneFixture('scene-1');
    },
    'Choice Author': (request) => choiceSetFixtureFor(request),
  };
}
