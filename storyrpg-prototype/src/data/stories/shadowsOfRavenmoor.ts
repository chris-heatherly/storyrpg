import { Story } from '../../types';

/**
 * Shadows of Ravenmoor
 * A gothic mystery story demonstrating the StoryRPG engine features:
 * - Branching choices with different outcomes
 * - Stat checks (fiction-first resolution)
 * - Relationship tracking
 * - Conditional content based on player state
 * - Flags and scores
 * - Items
 */

export const shadowsOfRavenmoor: Story = {
  id: 'shadows-of-ravenmoor',
  title: 'Shadows of Ravenmoor',
  genre: 'Gothic Mystery',
  synopsis:
    'You arrive at the remote village of Ravenmoor to claim your unexpected inheritance—a crumbling manor house from an aunt you never knew. But the locals speak in whispers, and something stirs in the darkness of Blackwood Manor.',
  coverImage: '',
  author: 'StoryRPG',
  tags: ['mystery', 'gothic', 'horror', 'drama'],

  // Initial player state
  initialState: {
    attributes: {
      charm: 50,
      wit: 55,
      courage: 45,
      empathy: 60,
      resolve: 50,
      resourcefulness: 50,
    },
    skills: {
      investigation: 10,
      occult: 0,
    },
    tags: ['newcomer'],
    inventory: [],
  },

  // NPCs
  npcs: [
    {
      id: 'eleanor',
      name: 'Eleanor Ashford',
      description:
        'The elderly housekeeper who has maintained Blackwood Manor for decades. She knows its secrets but guards them carefully.',
      initialRelationship: {
        trust: -10,
        affection: 0,
        respect: 20,
        fear: 0,
      },
    },
    {
      id: 'marcus',
      name: 'Marcus Thorne',
      description:
        'The charming but mysterious village doctor. He seems particularly interested in your arrival.',
      initialRelationship: {
        trust: 0,
        affection: 10,
        respect: 0,
        fear: 0,
      },
    },
    {
      id: 'ada',
      name: 'Ada Chen',
      description:
        'A young journalist investigating strange occurrences in the region. She might be an ally... or competition.',
      initialRelationship: {
        trust: 0,
        affection: 0,
        respect: 0,
        fear: 0,
      },
    },
  ],

  // Episodes
  episodes: [
    {
      id: 'ep1',
      number: 1,
      title: 'The Arrival',
      synopsis:
        'You arrive in Ravenmoor to claim your inheritance and meet the locals who will shape your fate.',
      coverImage: '',
      startingSceneId: 'scene1-arrival',

      scenes: [
        // Scene 1: Arrival in Ravenmoor
        {
          id: 'scene1-arrival',
          name: 'Arrival',
          startingBeatId: 'beat1',
          beats: [
            {
              id: 'beat1',
              text: "The train groans to a halt at Ravenmoor station, its ancient brakes screaming in protest. Through the rain-streaked window, you catch your first glimpse of the village—a cluster of grey stone buildings huddled together as if for warmth against the surrounding moors.\n\nYou are {{player.name}}, and you've traveled far to claim an inheritance you never expected. Your aunt Cordelia Blackwood—a woman you never knew existed—has left you everything. Her manor. Her fortune. Her secrets.",
              nextBeatId: 'beat2',
            },
            {
              id: 'beat2',
              text: "The station platform is deserted save for a single figure: an elderly woman in a severe black dress, holding an umbrella against the downpour. She watches you with sharp, calculating eyes as you step off the train.",
              nextBeatId: 'beat3',
            },
            {
              id: 'beat3',
              text: '"{{player.name}}?" The woman\'s voice cuts through the rain. "I am Eleanor Ashford. I was your aunt\'s housekeeper. I\'ve come to take you to the manor."',
              speaker: 'Eleanor',
              speakerMood: 'guarded',
              choices: [
                {
                  id: 'greet-warm',
                  text: 'Greet her warmly and express gratitude',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'eleanor', dimension: 'affection', change: 5 },
                    { type: 'addTag', tag: 'polite_first_impression' },
                  ],
                  nextBeatId: 'beat4-warm',
                },
                {
                  id: 'greet-curious',
                  text: 'Ask why she stayed if your aunt is gone',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'empathy',
                    difficulty: 40,
                  },
                  consequences: [
                    { type: 'relationship', npcId: 'eleanor', dimension: 'respect', change: 5 },
                  ],
                  nextBeatId: 'beat4-curious',
                },
                {
                  id: 'greet-suspicious',
                  text: 'Study her carefully before responding',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'wit',
                    difficulty: 35,
                  },
                  consequences: [
                    { type: 'changeScore', score: 'suspicion', change: 1 },
                    { type: 'skill', skill: 'investigation', change: 2 },
                  ],
                  nextBeatId: 'beat4-suspicious',
                },
              ],
            },
            {
              id: 'beat4-warm',
              text: '"Thank you so much for meeting me," you say, extending your hand. "This must be a difficult time—you\'ve lost someone you cared about, and now a stranger comes to take over."\n\nEleanor\'s expression softens almost imperceptibly. "Your aunt... she spoke of you sometimes. Wondered about you. I think she would have wanted to meet you properly, given time."',
              speaker: 'Eleanor',
              speakerMood: 'touched',
              nextBeatId: 'beat5',
              onShow: [
                { type: 'setFlag', flag: 'eleanor_softened', value: true },
              ],
            },
            {
              id: 'beat4-curious',
              text: '"If I may ask—why did you stay? After she passed, I mean."\n\nEleanor\'s eyes flicker with something—pain, perhaps, or memory. "Blackwood Manor has been my home for forty years. Where else would I go?" She pauses. "Besides, someone had to prepare for your arrival."',
              speaker: 'Eleanor',
              speakerMood: 'reflective',
              nextBeatId: 'beat5',
            },
            {
              id: 'beat4-suspicious',
              text: "You take a moment to observe her before speaking. The woman's posture is rigid, defensive. Her hands grip the umbrella handle tightly—not from cold, but from tension. She's nervous, though she hides it well.\n\n\"I appreciate you coming,\" you say carefully, watching her reaction.\n\nHer eyes narrow slightly. She knows she's being assessed. \"The car is this way.\"",
              nextBeatId: 'beat5',
              onShow: [
                { type: 'setFlag', flag: 'noticed_eleanor_nervous', value: true },
              ],
            },
            {
              id: 'beat5',
              text: "The drive through Ravenmoor takes you past ancient stone cottages with windows that seem to watch your passing. Villagers stop their conversations to stare as the car rumbles by.\n\n\"They're curious about the new owner of Blackwood Manor,\" Eleanor says, following your gaze. \"The Blackwood family has been... significant in this village's history.\"",
              nextBeatId: 'beat6',
            },
            {
              id: 'beat6',
              text: "\"Significant how?\" you ask.\n\nEleanor's grip on the steering wheel tightens. \"Your family helped found this village three hundred years ago. Some would say the fates of Ravenmoor and the Blackwoods are... intertwined.\"",
              speaker: 'Eleanor',
              speakerMood: 'careful',
              choices: [
                {
                  id: 'ask-aunt',
                  text: 'Ask about your aunt Cordelia',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'setFlag', flag: 'asked_about_cordelia', value: true },
                  ],
                  nextBeatId: 'beat7-aunt',
                },
                {
                  id: 'ask-history',
                  text: 'Ask about the family history',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'skill', skill: 'occult', change: 5 },
                    { type: 'setFlag', flag: 'learned_family_history', value: true },
                  ],
                  nextBeatId: 'beat7-history',
                },
                {
                  id: 'stay-silent',
                  text: 'Watch the village pass in silence',
                  choiceType: 'expression',
                  consequences: [
                    { type: 'attribute', attribute: 'resolve', change: 2 },
                  ],
                  nextBeatId: 'beat7-silent',
                },
              ],
            },
            {
              id: 'beat7-aunt',
              text: '"What was she like? My aunt Cordelia?"\n\nEleanor is quiet for a long moment. When she speaks, her voice is softer. "Brilliant. Stubborn. She spent her final years researching the family history—obsessed with it, some might say. She believed she was close to uncovering something important."\n\n"What kind of something?"\n\n"That," Eleanor says as the car crests a hill, "is a question for the manor itself."',
              nextBeatId: 'beat8-manor-reveal',
            },
            {
              id: 'beat7-history',
              text: '"The Blackwood family history—what makes it so significant?"\n\nEleanor glances at you in the rearview mirror. "Your ancestors were scholars. Collectors. They gathered... unusual artifacts from around the world. Books that most libraries would refuse to shelve. Objects that defied explanation."\n\nShe pauses. "There are those who say the Blackwoods attracted darkness to this place. Others say they were trying to understand it—perhaps even contain it."',
              nextBeatId: 'beat8-manor-reveal',
            },
            {
              id: 'beat7-silent',
              text: "You choose silence, watching the moors roll past—endless expanses of heather and gorse beneath a sky the color of bruises. There's a heaviness to this place, a weight you can almost feel pressing down.\n\nEleanor seems to appreciate the quiet. Or perhaps she's grateful not to have to explain more just yet.",
              nextBeatId: 'beat8-manor-reveal',
            },
            {
              id: 'beat8-manor-reveal',
              text: "And then you see it.\n\nBlackwood Manor rises from the moor like something grown rather than built—a sprawling Victorian edifice of dark stone and darker windows. Gargoyles crouch on its parapets. A tower at its eastern corner climbs toward the churning clouds.\n\nDespite the grey light and the rain, something in you responds to the sight. Recognition, perhaps. Or destiny.",
              nextBeatId: 'beat9',
            },
            {
              id: 'beat9',
              text: '"Welcome to your inheritance, {{player.name}}," Eleanor says as the car approaches the iron gates. They swing open at your approach, though you see no one to operate them.\n\n"The gates are automatic," Eleanor adds, noticing your look. "Your aunt had them modernized. She was practical about some things."',
              speaker: 'Eleanor',
              choices: [
                {
                  id: 'enter-eager',
                  text: '"It\'s magnificent. I can\'t wait to explore."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'courage', change: 3 },
                    { type: 'relationship', npcId: 'eleanor', dimension: 'affection', change: 5 },
                  ],
                  nextSceneId: 'scene2-manor-entrance',
                },
                {
                  id: 'enter-cautious',
                  text: '"What am I getting myself into?"',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'wit', change: 2 },
                  ],
                  nextSceneId: 'scene2-manor-entrance',
                },
                {
                  id: 'enter-determined',
                  text: '"Whatever secrets this place holds, I intend to find them."',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'resolve',
                    difficulty: 30,
                  },
                  consequences: [
                    { type: 'attribute', attribute: 'resolve', change: 5 },
                    { type: 'addTag', tag: 'determined_investigator' },
                  ],
                  nextSceneId: 'scene2-manor-entrance',
                },
              ],
            },
          ],
        },

        // Scene 2: Inside the Manor
        {
          id: 'scene2-manor-entrance',
          name: 'The Manor Entrance',
          startingBeatId: 'manor-beat1',
          beats: [
            {
              id: 'manor-beat1',
              text: "The entrance hall of Blackwood Manor is vast and shadowed, illuminated by a chandelier that casts fractured light across walls lined with portraits. Your ancestors watch from their frames—men and women with your same eyes, stretching back through centuries.\n\nThe air smells of old wood, older books, and something else. Something you can't quite identify.",
              nextBeatId: 'manor-beat2',
            },
            {
              id: 'manor-beat2',
              text: "Eleanor sets down your luggage by the grand staircase. \"I've prepared the master bedroom for you. Your aunt's study is in the east wing—I've left it untouched, as instructed in her will.\"\n\nShe hesitates. \"There are... rules about the manor you should know.\"",
              speaker: 'Eleanor',
              speakerMood: 'serious',
              nextBeatId: 'manor-beat3',
            },
            {
              id: 'manor-beat3',
              text: '"Rules?"',
              choices: [
                {
                  id: 'rules-listen',
                  text: 'Listen carefully to the rules',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'eleanor', dimension: 'trust', change: 10 },
                    { type: 'setFlag', flag: 'knows_manor_rules', value: true },
                  ],
                  nextBeatId: 'manor-beat4-rules',
                },
                {
                  id: 'rules-dismiss',
                  text: '"I appreciate the concern, but I\'m sure I can handle an old house."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'eleanor', dimension: 'trust', change: -10 },
                    { type: 'relationship', npcId: 'eleanor', dimension: 'fear', change: 5 },
                  ],
                  nextBeatId: 'manor-beat4-dismiss',
                },
                {
                  id: 'rules-question',
                  text: '"What happens if I break them?"',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'courage',
                    difficulty: 45,
                  },
                  consequences: [
                    { type: 'changeScore', score: 'boldness', change: 1 },
                  ],
                  nextBeatId: 'manor-beat4-question',
                },
              ],
            },
            {
              id: 'manor-beat4-rules',
              text: "Eleanor nods approvingly. \"First: never enter the tower after dark. The stairs are treacherous, and the wind plays tricks on the mind up there.\"\n\nShe counts on her fingers. \"Second: keep your bedroom door locked at night. The manor is old, and the floorboards creak—you'll sleep better.\"\n\n\"Third: if you hear music coming from the ballroom, do not investigate. The gramophone is... temperamental.\"",
              speaker: 'Eleanor',
              speakerMood: 'grave',
              nextBeatId: 'manor-beat5',
              onShow: [
                { type: 'setFlag', flag: 'rule_tower', value: true },
                { type: 'setFlag', flag: 'rule_lock_door', value: true },
                { type: 'setFlag', flag: 'rule_ballroom', value: true },
              ],
            },
            {
              id: 'manor-beat4-dismiss',
              text: "Something flickers in Eleanor's expression—disappointment? Fear?\n\n\"As you wish,\" she says, her voice cooling. \"I hope you'll find your confidence justified. Your aunt was also certain she could handle this house.\"\n\nShe turns toward the kitchen. \"I'll prepare dinner. I suggest you rest—you have a long night ahead of you.\"",
              speaker: 'Eleanor',
              speakerMood: 'cold',
              nextBeatId: 'manor-beat5',
            },
            {
              id: 'manor-beat4-question',
              text: "Eleanor's face goes pale. \"Your aunt asked the same question, near the end. She stopped sleeping. Stopped eating. She became convinced something in the house was watching her, waiting.\"\n\nShe steps closer, lowering her voice. \"The rules exist for a reason. Please—don't test them.\"",
              speaker: 'Eleanor',
              speakerMood: 'frightened',
              nextBeatId: 'manor-beat5',
            },
            {
              id: 'manor-beat5',
              text: "Before you can respond, the sound of a car engine draws your attention to the window. A sleek black vehicle is pulling up the drive.\n\n\"Ah,\" Eleanor says, tension in her voice. \"Dr. Thorne. He insisted on welcoming you personally.\"",
              nextBeatId: 'manor-beat6',
            },
            {
              id: 'manor-beat6',
              text: "The door opens before Eleanor can reach it, and a man steps inside—tall, dark-haired, with the kind of easy confidence that seems to fill a room. He's perhaps thirty-five, dressed casually but expensively, and his smile is warm as he approaches you.\n\n\"The new heir to Blackwood Manor,\" he says, extending his hand. \"I'm Marcus Thorne, the village doctor. I was a friend of your aunt's. Please accept my condolences—and my curiosity.\"",
              speaker: 'Marcus',
              speakerMood: 'charming',
              choices: [
                {
                  id: 'marcus-friendly',
                  text: 'Accept his hand warmly',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'marcus', dimension: 'affection', change: 10 },
                    { type: 'relationship', npcId: 'marcus', dimension: 'trust', change: 5 },
                  ],
                  nextBeatId: 'manor-beat7-friendly',
                },
                {
                  id: 'marcus-wary',
                  text: '"Curiosity about what, exactly?"',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'wit',
                    difficulty: 40,
                  },
                  consequences: [
                    { type: 'relationship', npcId: 'marcus', dimension: 'respect', change: 10 },
                  ],
                  nextBeatId: 'manor-beat7-wary',
                },
                {
                  id: 'marcus-formal',
                  text: 'Shake his hand but maintain distance',
                  choiceType: 'expression',
                  nextBeatId: 'manor-beat7-formal',
                },
              ],
            },
            {
              id: 'manor-beat7-friendly',
              text: "You take his hand—his grip is firm but not aggressive. Up close, you notice his eyes are a striking grey, sharp and intelligent.\n\n\"It's good to meet someone who doesn't look at me like I'm about to unleash something terrible,\" you say.\n\nMarcus laughs. \"Give it time. Ravenmoor has a way of making everyone suspicious eventually.\"",
              speaker: 'Marcus',
              speakerMood: 'amused',
              nextBeatId: 'manor-beat8',
            },
            {
              id: 'manor-beat7-wary',
              text: "Marcus's smile falters for just a moment before recovering. \"Sharp. Good—you'll need that here.\"\n\nHe withdraws his hand. \"I'm curious about who the Blackwood heir will be. This village has been waiting a long time for someone to take the reins of this manor. Your aunt's research was... incomplete. Perhaps you'll finish what she started.\"",
              speaker: 'Marcus',
              speakerMood: 'intrigued',
              nextBeatId: 'manor-beat8',
            },
            {
              id: 'manor-beat7-formal',
              text: "You shake his hand briefly, professionally. Marcus seems to note your reserve with interest rather than offense.\n\n\"The cautious type,\" he observes. \"Perhaps wise, given the circumstances. I'll try to earn your trust—though I warn you, it's a commodity in short supply around here.\"",
              speaker: 'Marcus',
              speakerMood: 'thoughtful',
              nextBeatId: 'manor-beat8',
            },
            {
              id: 'manor-beat8',
              text: "\"I should let you settle in,\" Marcus says, moving toward the door. \"But please—join me for dinner at the Raven's Rest tomorrow evening. The village pub. I can fill you in on local affairs, and perhaps...\"\n\nHe pauses at the threshold. \"Perhaps I can tell you what really happened to your aunt.\"",
              speaker: 'Marcus',
              speakerMood: 'mysterious',
              onShow: [
                {
                  type: 'addItem',
                  item: {
                    itemId: 'dinner-invitation',
                    name: "Marcus's Dinner Invitation",
                    description: 'An invitation to dinner at the Ravens Rest pub with Dr. Marcus Thorne.',
                  },
                  quantity: 1,
                },
              ],
              choices: [
                {
                  id: 'accept-dinner',
                  text: '"I\'ll be there."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'setFlag', flag: 'agreed_to_dinner', value: true },
                    { type: 'relationship', npcId: 'marcus', dimension: 'trust', change: 5 },
                  ],
                  nextBeatId: 'manor-beat9',
                },
                {
                  id: 'hesitate-dinner',
                  text: '"What do you mean, what really happened?"',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'skill', skill: 'investigation', change: 3 },
                  ],
                  nextBeatId: 'manor-beat9-question',
                },
                {
                  id: 'decline-dinner',
                  text: '"I think I\'d rather learn about this place on my own terms."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'marcus', dimension: 'respect', change: 5 },
                    { type: 'relationship', npcId: 'marcus', dimension: 'affection', change: -5 },
                    { type: 'addTag', tag: 'independent' },
                  ],
                  nextBeatId: 'manor-beat9-decline',
                },
              ],
            },
            {
              id: 'manor-beat9',
              text: "Marcus smiles—genuinely, this time, you think. \"Excellent. Seven o'clock. Don't be late—and don't wander the moors after dark. Even the locals avoid that.\"\n\nHe's gone before you can ask what he means.",
              nextBeatId: 'manor-beat-final',
            },
            {
              id: 'manor-beat9-question',
              text: "Marcus's expression grows serious. \"Your aunt didn't die of natural causes. That's the official story, but I was her doctor. I know better.\"\n\nHe glances at Eleanor, who has retreated to the shadows. \"This isn't the place. Tomorrow. Seven o'clock.\"\n\nHe leaves without waiting for an answer.",
              onShow: [
                { type: 'setFlag', flag: 'knows_suspicious_death', value: true },
                { type: 'setFlag', flag: 'agreed_to_dinner', value: true },
              ],
              nextBeatId: 'manor-beat-final',
            },
            {
              id: 'manor-beat9-decline',
              text: "\"Independent. I like that.\" Marcus tips an imaginary hat. \"The offer stands, if you change your mind. Some knowledge is safer shared than discovered alone.\"\n\nHe leaves you with that cryptic warning hanging in the air.",
              nextBeatId: 'manor-beat-final',
            },
            {
              id: 'manor-beat-final',
              text: "Night falls quickly in Ravenmoor. Eleanor serves a simple dinner—lamb stew, fresh bread, strong tea—and retires early, citing an early morning.\n\nYou're left alone in the manor's vast dining room, surrounded by portraits of your ancestors, listening to the old house settle around you.\n\nSomewhere above, a floorboard creaks. Then another. As if someone—or something—is pacing the hallway outside the tower.\n\nYour first night at Blackwood Manor has begun.",
              textVariants: [
                {
                  condition: {
                    type: 'flag',
                    flag: 'knows_manor_rules',
                    value: true,
                  },
                  text: "Night falls quickly in Ravenmoor. Eleanor serves a simple dinner—lamb stew, fresh bread, strong tea—and retires early, reminding you to lock your bedroom door.\n\nYou're left alone in the manor's vast dining room, surrounded by portraits of your ancestors, the weight of Eleanor's rules heavy on your mind.\n\nSomewhere above, a floorboard creaks. Then another. As if someone—or something—is pacing the hallway outside the tower.\n\nYou remember Eleanor's warning: never enter the tower after dark.\n\nYour first night at Blackwood Manor has begun.",
                },
              ],
            },
          ],
        },
      ],

      // Episode completion rewards
      onComplete: [
        { type: 'skill', skill: 'investigation', change: 5 },
        { type: 'attribute', attribute: 'resolve', change: 3 },
      ],
    },

    // ==========================================
    // EPISODE 2: THE FIRST NIGHT
    // ==========================================
    {
      id: 'ep2',
      number: 2,
      title: 'The First Night',
      synopsis:
        'Strange sounds echo through Blackwood Manor. Will you investigate, or heed Eleanor\'s warnings?',
      coverImage: '',
      startingSceneId: 'scene2-1-night',

      scenes: [
        {
          id: 'scene2-1-night',
          name: 'Midnight',
          startingBeatId: 'night-beat1',
          beats: [
            {
              id: 'night-beat1',
              text: "You wake to darkness. The room is cold—far colder than it should be. Your breath mists in the air.\n\nThe clock on the mantle reads 3:17 AM. And somewhere in the house, music is playing. Faint, distant, hauntingly beautiful.",
              nextBeatId: 'night-beat2',
            },
            {
              id: 'night-beat2',
              text: "The gramophone. Eleanor warned you about this. 'If you hear music coming from the ballroom, do not investigate.'",
              textVariants: [
                {
                  condition: {
                    type: 'flag',
                    flag: 'knows_manor_rules',
                    value: false,
                  },
                  text: "Music in the middle of the night. In a house where you're supposedly alone except for an elderly housekeeper. This seems... unusual.",
                },
              ],
              choices: [
                {
                  id: 'investigate-music',
                  text: 'Investigate the music',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'courage',
                    difficulty: 45,
                  },
                  consequences: [
                    { type: 'attribute', attribute: 'courage', change: 5 },
                    { type: 'setFlag', flag: 'investigated_music', value: true },
                  ],
                  nextBeatId: 'night-beat3-investigate',
                },
                {
                  id: 'stay-bed',
                  text: 'Stay in bed and wait for dawn',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'resolve', change: 3 },
                    { type: 'setFlag', flag: 'obeyed_rules', value: true },
                  ],
                  nextBeatId: 'night-beat3-stay',
                },
                {
                  id: 'check-window',
                  text: 'Look out the window first',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'wit',
                    difficulty: 35,
                  },
                  consequences: [
                    { type: 'attribute', attribute: 'wit', change: 2 },
                    { type: 'skill', skill: 'investigation', change: 2 },
                  ],
                  nextBeatId: 'night-beat3-window',
                },
              ],
            },
            {
              id: 'night-beat3-investigate',
              text: "You pull on a robe and step into the hallway. The manor is transformed by darkness—familiar shapes become threatening, shadows pool in corners like liquid night.\n\nThe music leads you down the grand staircase, past portraits whose eyes seem to follow your movement. The ballroom doors stand slightly ajar, golden light spilling through the gap.",
              nextBeatId: 'night-beat4-ballroom',
            },
            {
              id: 'night-beat3-stay',
              text: "You pull the covers tighter and try to ignore the music. It plays for what feels like hours—waltzes and mazurkas, the kind of music no one has danced to in decades.\n\nEventually, silence returns. But sleep doesn't come easily. When dawn finally breaks, you feel like you haven't rested at all.",
              nextSceneId: 'scene2-2-morning',
            },
            {
              id: 'night-beat3-window',
              text: "You move to the window and look out over the grounds. The moors stretch endlessly under a half-moon. And there—at the edge of the property—a figure. Someone is standing at the old cemetery, perfectly still, facing the house.\n\nWatching.",
              nextBeatId: 'night-beat4-figure',
            },
            {
              id: 'night-beat4-ballroom',
              text: "You push open the doors. The ballroom is vast, its chandeliers dark except for dozens of candles that shouldn't be lit. In the center of the room, a gramophone plays on its own, needle tracking across an ancient record.\n\nBut it's what you see in the mirror that stops your heart. A woman in a Victorian dress, dancing alone, her movements perfectly synchronized with the music. When she turns toward you, her face is your face—but older, sadder, and somehow wrong.",
              choices: [
                {
                  id: 'approach-figure',
                  text: 'Approach the mirror',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'courage',
                    difficulty: 55,
                  },
                  consequences: [
                    { type: 'attribute', attribute: 'courage', change: 5 },
                    { type: 'skill', skill: 'occult', change: 5 },
                    { type: 'setFlag', flag: 'saw_reflection', value: true },
                  ],
                  nextBeatId: 'night-beat5-approach',
                },
                {
                  id: 'flee-ballroom',
                  text: 'Flee back to your room',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'resolve', change: -3 },
                    { type: 'setFlag', flag: 'fled_ballroom', value: true },
                  ],
                  nextBeatId: 'night-beat5-flee',
                },
              ],
            },
            {
              id: 'night-beat4-figure',
              text: "You watch for several minutes, but the figure doesn't move. It's too far to see clearly, but something about its posture suggests patience. It has been waiting there for a long time.\n\nThe music continues to play somewhere below.",
              choices: [
                {
                  id: 'go-outside',
                  text: 'Go outside to confront the figure',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'courage',
                    difficulty: 60,
                  },
                  consequences: [
                    { type: 'attribute', attribute: 'courage', change: 7 },
                    { type: 'setFlag', flag: 'confronted_figure', value: true },
                  ],
                  nextBeatId: 'night-beat5-outside',
                },
                {
                  id: 'investigate-music-2',
                  text: 'Investigate the music instead',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'setFlag', flag: 'investigated_music', value: true },
                  ],
                  nextBeatId: 'night-beat4-ballroom',
                },
                {
                  id: 'return-bed',
                  text: 'Return to bed',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'resolve', change: 2 },
                  ],
                  nextSceneId: 'scene2-2-morning',
                },
              ],
            },
            {
              id: 'night-beat5-approach',
              text: "You step closer to the mirror. The dancing figure stops, turns fully toward you. Her mouth moves, forming words you cannot hear. Then the candles flicker and die, plunging the room into darkness.\n\nWhen you fumble for a light switch, the ballroom is empty. The gramophone is silent. But something has been left on the floor before the mirror—a key, old and iron, warm to the touch.",
              onShow: [
                {
                  type: 'addItem',
                  item: {
                    itemId: 'mysterious-key',
                    name: 'Mysterious Iron Key',
                    description: 'An old key found in the ballroom. It feels warm, even in the cold manor.',
                  },
                  quantity: 1,
                },
              ],
              nextSceneId: 'scene2-2-morning',
            },
            {
              id: 'night-beat5-flee',
              text: "You run. Behind you, the music swells, as if in pursuit. You don't stop until you're back in your room, door locked, chair wedged under the handle.\n\nThe music continues until dawn. You don't sleep again.",
              nextSceneId: 'scene2-2-morning',
            },
            {
              id: 'night-beat5-outside',
              text: "You dress quickly and slip out through the kitchen door. The night air is bitter cold. You make your way toward the cemetery, heart pounding.\n\nBut when you arrive, there's no one there. Only old gravestones, many bearing the Blackwood name. And fresh flowers on one grave—your aunt Cordelia's.",
              onShow: [
                { type: 'setFlag', flag: 'visited_cemetery', value: true },
                { type: 'skill', skill: 'investigation', change: 3 },
              ],
              nextSceneId: 'scene2-2-morning',
            },
          ],
        },

        {
          id: 'scene2-2-morning',
          name: 'Morning After',
          startingBeatId: 'morning-beat1',
          beats: [
            {
              id: 'morning-beat1',
              text: "Daylight transforms the manor. The shadows retreat, the creaks become just old wood settling. Eleanor is already in the kitchen when you come down, preparing breakfast.\n\nShe studies your face. \"Rough night?\"",
              speaker: 'Eleanor',
              textVariants: [
                {
                  condition: {
                    type: 'flag',
                    flag: 'obeyed_rules',
                    value: true,
                  },
                  text: "Daylight transforms the manor. Eleanor is already preparing breakfast when you come down. She nods approvingly at your appearance.\n\n\"You look rested. Good. Some people have trouble their first night here.\"",
                },
              ],
              nextBeatId: 'morning-beat2',
            },
            {
              id: 'morning-beat2',
              text: "The events of the night feel dreamlike now, almost unreal.",
              choices: [
                {
                  id: 'tell-eleanor',
                  text: 'Tell Eleanor what you experienced',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'empathy',
                    difficulty: 40,
                  },
                  consequences: [
                    { type: 'relationship', npcId: 'eleanor', dimension: 'trust', change: 10 },
                    { type: 'attribute', attribute: 'empathy', change: 3 },
                  ],
                  nextBeatId: 'morning-beat3-tell',
                },
                {
                  id: 'keep-secret',
                  text: 'Keep it to yourself',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'resolve', change: 2 },
                  ],
                  nextBeatId: 'morning-beat3-secret',
                },
                {
                  id: 'ask-aunt',
                  text: 'Ask about your aunt Cordelia',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'skill', skill: 'investigation', change: 2 },
                    { type: 'relationship', npcId: 'eleanor', dimension: 'respect', change: 5 },
                  ],
                  nextBeatId: 'morning-beat3-aunt',
                },
              ],
            },
            {
              id: 'morning-beat3-tell',
              text: "Eleanor listens without interrupting. When you finish, she's quiet for a long moment.\n\n\"Your aunt saw her too,\" she says finally. \"The woman in the mirror. She believed it was Eliza Blackwood—your great-great-grandmother. The one who built this house.\" She pauses. \"The one who died in it.\"",
              speaker: 'Eleanor',
              onShow: [
                { type: 'setFlag', flag: 'learned_about_eliza', value: true },
              ],
              nextBeatId: 'morning-beat4',
            },
            {
              id: 'morning-beat3-secret',
              text: "\"Just adjusting to the old house,\" you say. Eleanor nods, but her eyes are knowing.\n\n\"This manor keeps its secrets,\" she says. \"Until it decides to share them.\"",
              speaker: 'Eleanor',
              nextBeatId: 'morning-beat4',
            },
            {
              id: 'morning-beat3-aunt',
              text: "Eleanor's expression shifts—grief, mixed with something else. \"Cordelia was brilliant. Obsessed. She spent her last years trying to understand this house's history. The Blackwood legacy, she called it.\"\n\nShe hesitates. \"Her research is still in the east wing study. She left instructions that you should have access to everything.\"",
              speaker: 'Eleanor',
              onShow: [
                { type: 'setFlag', flag: 'knows_about_research', value: true },
              ],
              nextBeatId: 'morning-beat4',
            },
            {
              id: 'morning-beat4',
              text: "\"You have a visitor,\" Eleanor says, nodding toward the window. A car is pulling up the drive—Marcus Thorne's black sedan.\n\n\"He's early,\" she adds, and there's disapproval in her voice.",
              nextBeatId: 'morning-beat5',
            },
            {
              id: 'morning-beat5',
              text: "Marcus enters without waiting to be announced, bringing the cold morning air with him. His eyes find yours immediately.\n\n\"I couldn't wait for dinner,\" he says. \"There's something you need to see. In the village. Something that concerns your aunt's death.\"",
              speaker: 'Marcus',
              speakerMood: 'urgent',
              choices: [
                {
                  id: 'go-with-marcus',
                  text: 'Go with Marcus to the village',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'marcus', dimension: 'trust', change: 10 },
                    { type: 'relationship', npcId: 'eleanor', dimension: 'trust', change: -5 },
                    { type: 'setFlag', flag: 'went_to_village', value: true },
                  ],
                  nextSceneId: 'scene2-3-village',
                },
                {
                  id: 'explore-study',
                  text: 'Decline—you want to explore the study first',
                  choiceType: 'strategic',
                  conditions: {
                    type: 'flag',
                    flag: 'knows_about_research',
                    value: true,
                  },
                  consequences: [
                    { type: 'relationship', npcId: 'marcus', dimension: 'respect', change: 5 },
                    { type: 'relationship', npcId: 'eleanor', dimension: 'trust', change: 10 },
                    { type: 'attribute', attribute: 'wit', change: 3 },
                  ],
                  nextSceneId: 'scene2-3-study',
                },
                {
                  id: 'demand-answers',
                  text: '"Tell me here. What do you know?"',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'courage',
                    difficulty: 45,
                  },
                  consequences: [
                    { type: 'relationship', npcId: 'marcus', dimension: 'respect', change: 10 },
                    { type: 'attribute', attribute: 'courage', change: 3 },
                  ],
                  nextBeatId: 'morning-beat6-answers',
                },
              ],
            },
            {
              id: 'morning-beat6-answers',
              text: "Marcus glances at Eleanor, then back at you. \"Fine. Your aunt didn't die of heart failure. She was poisoned. I found traces of belladonna in her system—but the official autopsy missed it. Or was told to miss it.\"\n\nEleanor's face has gone pale. \"That's not possible,\" she whispers.\n\n\"I wish it weren't,\" Marcus says. \"Someone in this village killed Cordelia Blackwood. And I intend to find out who.\"",
              speaker: 'Marcus',
              onShow: [
                { type: 'setFlag', flag: 'knows_poison', value: true },
                { type: 'relationship', npcId: 'eleanor', dimension: 'fear', change: 10 },
              ],
              nextSceneId: 'scene2-3-village',
            },
          ],
        },

        {
          id: 'scene2-3-village',
          name: 'The Village',
          startingBeatId: 'village-beat1',
          beats: [
            {
              id: 'village-beat1',
              text: "Ravenmoor by daylight is no less strange than by rumor. The buildings lean toward each other as if sharing secrets. Villagers stop their conversations as Marcus's car passes.\n\n\"They don't trust outsiders,\" Marcus explains. \"And now you're the new Blackwood. That makes you... complicated.\"",
              speaker: 'Marcus',
              nextBeatId: 'village-beat2',
            },
            {
              id: 'village-beat2',
              text: "He parks outside a small pub—The Raven's Rest. Inside, it's dark and warm, smelling of old wood and older secrets.",
              choices: [
                {
                  id: 'talk-locals',
                  text: 'Try to talk to the locals',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'charm',
                    difficulty: 50,
                  },
                  consequences: [
                    { type: 'attribute', attribute: 'charm', change: 3 },
                    { type: 'skill', skill: 'investigation', change: 3 },
                  ],
                  nextBeatId: 'village-beat3-locals',
                },
                {
                  id: 'focus-marcus',
                  text: 'Focus on what Marcus has to show you',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'marcus', dimension: 'trust', change: 5 },
                  ],
                  nextBeatId: 'village-beat3-marcus',
                },
              ],
            },
            {
              id: 'village-beat3-locals',
              text: "You approach the bar. The old man behind it eyes you with unconcealed suspicion.\n\n\"You're the new one,\" he says. Not a question. \"Come to claim what's yours, have you? The Blackwoods always do.\" He leans closer. \"Just remember—this village has a long memory. We remember what your family did.\"",
              nextBeatId: 'village-beat4',
            },
            {
              id: 'village-beat3-marcus',
              text: "Marcus leads you to a back booth, away from curious ears. He pulls out a folder—medical records, photographs, newspaper clippings.\n\n\"Your aunt was investigating something,\" he says. \"Something that made her enemies. A month before she died, she came to me frightened. Said she'd found proof of an old crime. A very old crime.\"",
              speaker: 'Marcus',
              onShow: [
                { type: 'setFlag', flag: 'knows_old_crime', value: true },
              ],
              nextBeatId: 'village-beat4',
            },
            {
              id: 'village-beat4',
              text: "The pub door opens. A young woman enters—sharp-eyed, with a press badge visible on her jacket. She spots Marcus and heads straight for your table.\n\n\"Dr. Thorne. And the mysterious heir.\" She extends her hand. \"Ada Chen, journalist. I've been investigating your aunt's death for three months. I think it's time we compared notes.\"",
              speaker: 'Ada',
              choices: [
                {
                  id: 'trust-ada',
                  text: 'Agree to share information',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'ada', dimension: 'trust', change: 15 },
                    { type: 'relationship', npcId: 'ada', dimension: 'affection', change: 5 },
                    { type: 'attribute', attribute: 'empathy', change: 2 },
                  ],
                  nextBeatId: 'village-beat5-trust',
                },
                {
                  id: 'suspicious-ada',
                  text: '"Why are you investigating my aunt?"',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'wit',
                    difficulty: 40,
                  },
                  consequences: [
                    { type: 'relationship', npcId: 'ada', dimension: 'respect', change: 10 },
                    { type: 'attribute', attribute: 'wit', change: 2 },
                  ],
                  nextBeatId: 'village-beat5-suspicious',
                },
              ],
            },
            {
              id: 'village-beat5-trust',
              text: "Ada slides into the booth. \"Your aunt contacted me two weeks before she died. She said she had evidence of murders—plural—going back over a century. All connected to your family.\"\n\nShe pulls out her own folder. \"I didn't believe her at first. Then she died. And I started believing.\"",
              speaker: 'Ada',
              onShow: [
                { type: 'setFlag', flag: 'ada_ally', value: true },
              ],
              nextBeatId: 'village-beat-end',
            },
            {
              id: 'village-beat5-suspicious',
              text: "Ada doesn't flinch. \"Because she invited me. Cordelia Blackwood contacted me three weeks before her death. She claimed to have evidence of a cover-up going back generations. Said only an outsider could be trusted with the truth.\"\n\nShe meets your eyes. \"Then she died. Officially of natural causes. Unofficially... well. That's what I'm here to find out.\"",
              speaker: 'Ada',
              nextBeatId: 'village-beat-end',
            },
            {
              id: 'village-beat-end',
              text: "The three of you sit in the back of The Raven's Rest, surrounded by suspicious locals and decades of secrets. Your aunt died searching for truth. Now that search has become yours.\n\nOutside, the sun is already beginning to set. Another night at Blackwood Manor awaits.",
            },
          ],
        },

        {
          id: 'scene2-3-study',
          name: 'The Study',
          startingBeatId: 'study-beat1',
          conditions: {
            type: 'flag',
            flag: 'knows_about_research',
            value: true,
          },
          beats: [
            {
              id: 'study-beat1',
              text: "The east wing study is exactly as Cordelia left it. Papers cover every surface, books lie open on chairs, and a massive corkboard on one wall is covered in photographs, notes, and red string connecting them all.\n\nYour aunt was searching for something. Something big.",
              nextBeatId: 'study-beat2',
            },
            {
              id: 'study-beat2',
              text: "You begin to examine her work. Names jump out—Blackwood family members going back generations. Dates of deaths. Newspaper clippings about accidents and disappearances.",
              choices: [
                {
                  id: 'read-journal',
                  text: 'Look for her personal journal',
                  choiceType: 'strategic',
                  statCheck: {
                    skill: 'investigation',
                    difficulty: 40,
                  },
                  consequences: [
                    { type: 'skill', skill: 'investigation', change: 5 },
                    { type: 'setFlag', flag: 'found_journal', value: true },
                  ],
                  nextBeatId: 'study-beat3-journal',
                },
                {
                  id: 'study-board',
                  text: 'Study the corkboard connections',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'wit',
                    difficulty: 45,
                  },
                  consequences: [
                    { type: 'attribute', attribute: 'wit', change: 3 },
                    { type: 'skill', skill: 'occult', change: 3 },
                  ],
                  nextBeatId: 'study-beat3-board',
                },
              ],
            },
            {
              id: 'study-beat3-journal',
              text: "You find it hidden in a false bottom of the desk drawer—a leather journal, its pages filled with Cordelia's precise handwriting.\n\nThe last entry reads: 'I know what Eliza did. I know why the village fears us. And I know who has been protecting the secret. Tomorrow I confront them. If anything happens to me, the truth is in the tower. Where it all began.'",
              onShow: [
                {
                  type: 'addItem',
                  item: {
                    itemId: 'cordelia-journal',
                    name: 'Cordelia\'s Journal',
                    description: 'Your aunt\'s research journal, filled with disturbing discoveries.',
                  },
                  quantity: 1,
                },
              ],
              nextBeatId: 'study-beat4',
            },
            {
              id: 'study-beat3-board',
              text: "The pattern becomes clear as you study the board. Every twenty years, a Blackwood dies under mysterious circumstances. Every twenty years, something happens in the village—crops fail, children go missing, accidents multiply.\n\nAnd at the center of the web, one name appears again and again: Eliza Blackwood. Your great-great-grandmother. The one who built this house.",
              onShow: [
                { type: 'setFlag', flag: 'knows_pattern', value: true },
                { type: 'skill', skill: 'occult', change: 5 },
              ],
              nextBeatId: 'study-beat4',
            },
            {
              id: 'study-beat4',
              text: "A floorboard creaks behind you. Eleanor stands in the doorway, her face unreadable.\n\n\"I see you've found her work,\" she says quietly. \"I tried to warn her. Some truths are better left buried.\" She pauses. \"But I suppose you're a Blackwood. Blackwoods never leave well enough alone.\"",
              speaker: 'Eleanor',
              choices: [
                {
                  id: 'confront-eleanor',
                  text: '"What do you know about my aunt\'s death?"',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'courage',
                    difficulty: 50,
                  },
                  consequences: [
                    { type: 'relationship', npcId: 'eleanor', dimension: 'fear', change: 10 },
                    { type: 'relationship', npcId: 'eleanor', dimension: 'respect', change: 10 },
                    { type: 'attribute', attribute: 'courage', change: 3 },
                  ],
                  nextBeatId: 'study-beat5-confront',
                },
                {
                  id: 'gentle-approach',
                  text: '"Help me understand, Eleanor. Please."',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'empathy',
                    difficulty: 40,
                  },
                  consequences: [
                    { type: 'relationship', npcId: 'eleanor', dimension: 'trust', change: 15 },
                    { type: 'relationship', npcId: 'eleanor', dimension: 'affection', change: 10 },
                    { type: 'attribute', attribute: 'empathy', change: 3 },
                  ],
                  nextBeatId: 'study-beat5-gentle',
                },
              ],
            },
            {
              id: 'study-beat5-confront',
              text: "Eleanor's composure cracks. \"I know she was murdered,\" she says. \"I know because I found her that morning, before anyone else. And I know because I've seen this before.\"\n\nTears glisten in her eyes. \"Forty years I've served this house. I've watched three Blackwoods die. And I've been too afraid to do anything but clean up afterward.\"",
              speaker: 'Eleanor',
              onShow: [
                { type: 'setFlag', flag: 'eleanor_confession', value: true },
              ],
              nextBeatId: 'study-beat-end',
            },
            {
              id: 'study-beat5-gentle',
              text: "Eleanor sinks into a chair, suddenly looking every one of her years. \"I loved your aunt,\" she says quietly. \"She was kind to me. When she died, I wanted to tell someone. But who would believe me?\"\n\nShe looks at you with something like hope. \"Maybe you're the one who can finally end this. The curse. The killing. All of it.\"",
              speaker: 'Eleanor',
              onShow: [
                { type: 'setFlag', flag: 'eleanor_ally', value: true },
                { type: 'relationship', npcId: 'eleanor', dimension: 'trust', change: 20 },
              ],
              nextBeatId: 'study-beat-end',
            },
            {
              id: 'study-beat-end',
              text: "The sun has set while you were in the study. Through the window, you can see the tower rising against the darkening sky.\n\n'The truth is in the tower,' Cordelia wrote. 'Where it all began.'\n\nBut Eleanor's warning echoes in your mind: never enter the tower after dark.\n\nAnother night at Blackwood Manor has begun.",
            },
          ],
        },
      ],

      onComplete: [
        { type: 'skill', skill: 'investigation', change: 5 },
        { type: 'skill', skill: 'occult', change: 3 },
        { type: 'attribute', attribute: 'courage', change: 3 },
        { type: 'attribute', attribute: 'wit', change: 2 },
      ],
    },

    // ==========================================
    // EPISODE 3: THE TOWER
    // ==========================================
    {
      id: 'ep3',
      number: 3,
      title: 'The Tower',
      synopsis: 'The truth awaits in the tower. But so does danger.',
      coverImage: '',
      startingSceneId: 'scene3-1-decision',

      scenes: [
        {
          id: 'scene3-1-decision',
          name: 'The Decision',
          startingBeatId: 'decision-beat1',
          beats: [
            {
              id: 'decision-beat1',
              text: "Morning comes grey and cold. The tower dominates your view from every window, a constant reminder of Cordelia's final message.\n\nEleanor is unusually quiet at breakfast, glancing at you when she thinks you're not looking.",
              nextBeatId: 'decision-beat2',
            },
            {
              id: 'decision-beat2',
              text: '"The tower," you say finally. "I need to go up there."\n\nEleanor\'s hands still on the teapot. "I was afraid you\'d say that."',
              speaker: 'Eleanor',
              choices: [
                {
                  id: 'go-now',
                  text: '"I\'m going now. While it\'s daylight."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'courage', change: 5 },
                    { type: 'relationship', npcId: 'eleanor', dimension: 'respect', change: 5 },
                  ],
                  nextSceneId: 'scene3-2-tower',
                },
                {
                  id: 'ask-eleanor-tower',
                  text: '"What can you tell me about the tower?"',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'eleanor', dimension: 'trust', change: 5 },
                    { type: 'attribute', attribute: 'wit', change: 2 },
                  ],
                  nextBeatId: 'decision-beat3',
                },
                {
                  id: 'wait-marcus',
                  text: '"I should wait for Marcus or Ada."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'resolve', change: 3 },
                    { type: 'setFlag', flag: 'waited_for_help', value: true },
                  ],
                  nextBeatId: 'decision-beat4',
                },
              ],
            },
            {
              id: 'decision-beat3',
              text: "Eleanor hesitates, then speaks. \"The tower was Eliza's sanctuary. She spent her final years up there, alone. After her death, the family sealed it. Your aunt was the first to open it in over a century.\"\n\nShe meets your eyes. \"She found something up there. Something that changed her. Made her afraid.\"",
              speaker: 'Eleanor',
              onShow: [
                { type: 'setFlag', flag: 'knows_tower_history', value: true },
              ],
              nextSceneId: 'scene3-2-tower',
            },
            {
              id: 'decision-beat4',
              text: "You call Marcus. His phone goes to voicemail. You try Ada—same result.\n\nEleanor watches you. \"The village has a way of cutting off communication when it wants to. You might be waiting a long time.\"",
              speaker: 'Eleanor',
              nextSceneId: 'scene3-2-tower',
            },
          ],
        },

        {
          id: 'scene3-2-tower',
          name: 'The Tower',
          startingBeatId: 'tower-beat1',
          beats: [
            {
              id: 'tower-beat1',
              text: "The tower door is heavy oak, reinforced with iron bands. It's unlocked—Cordelia must have left it that way.\n\nThe staircase spirals upward into darkness. The air smells of dust and something else—something old and wrong.",
              choices: [
                {
                  id: 'use-key',
                  text: 'Try the mysterious key from the ballroom',
                  choiceType: 'strategic',
                  conditions: {
                    type: 'item',
                    itemId: 'mysterious-key',
                    hasItem: true,
                  },
                  consequences: [
                    { type: 'setFlag', flag: 'used_mysterious_key', value: true },
                    { type: 'skill', skill: 'occult', change: 5 },
                  ],
                  nextBeatId: 'tower-beat2-key',
                },
                {
                  id: 'climb-stairs',
                  text: 'Climb the stairs carefully',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'courage',
                    difficulty: 45,
                  },
                  consequences: [
                    { type: 'attribute', attribute: 'courage', change: 3 },
                  ],
                  nextBeatId: 'tower-beat2-climb',
                },
              ],
            },
            {
              id: 'tower-beat2-key',
              text: "The key fits a hidden lock you hadn't noticed—a small panel in the wall. It swings open to reveal a narrow passage, bypassing most of the stairs.\n\nYou emerge directly into Eliza's study, as if the house itself wanted to help you.",
              nextBeatId: 'tower-beat3',
            },
            {
              id: 'tower-beat2-climb',
              text: "Each step groans under your weight. The shadows seem to move at the edge of your vision. Twice, you could swear you hear breathing that isn't your own.\n\nBut you press on, and finally reach the top.",
              nextBeatId: 'tower-beat3',
            },
            {
              id: 'tower-beat3',
              text: "Eliza's study is a time capsule. Victorian furniture preserved in dust, books lining every wall, and in the center—a desk covered in papers, just as she left them a century ago.\n\nAnd on the wall, a portrait. Eliza Blackwood stares down at you with eyes that are too knowing, too alive. The same face you saw in the ballroom mirror.",
              choices: [
                {
                  id: 'search-desk',
                  text: 'Search the desk',
                  choiceType: 'strategic',
                  statCheck: {
                    skill: 'investigation',
                    difficulty: 40,
                  },
                  consequences: [
                    { type: 'skill', skill: 'investigation', change: 5 },
                  ],
                  nextBeatId: 'tower-beat4-desk',
                },
                {
                  id: 'examine-portrait',
                  text: 'Examine the portrait closely',
                  choiceType: 'strategic',
                  statCheck: {
                    skill: 'occult',
                    difficulty: 35,
                  },
                  consequences: [
                    { type: 'skill', skill: 'occult', change: 5 },
                    { type: 'attribute', attribute: 'wit', change: 2 },
                  ],
                  nextBeatId: 'tower-beat4-portrait',
                },
                {
                  id: 'search-books',
                  text: 'Search the bookshelves',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'skill', skill: 'occult', change: 3 },
                  ],
                  nextBeatId: 'tower-beat4-books',
                },
              ],
            },
            {
              id: 'tower-beat4-desk',
              text: "Among yellowed papers and faded ink, you find it—Eliza's private journal. The entries become increasingly disturbed as you read.\n\nShe writes of a bargain. A deal made with something that lived beneath the moors. Power and prosperity for the Blackwoods, in exchange for... tribute. Every twenty years.",
              onShow: [
                { type: 'setFlag', flag: 'found_eliza_journal', value: true },
                {
                  type: 'addItem',
                  item: {
                    itemId: 'eliza-journal',
                    name: 'Eliza\'s Journal',
                    description: 'The private journal of Eliza Blackwood, detailing a terrible bargain.',
                  },
                  quantity: 1,
                },
              ],
              nextBeatId: 'tower-beat5',
            },
            {
              id: 'tower-beat4-portrait',
              text: "The portrait's frame is loose. Behind it, you find a hidden compartment containing a leather-bound book and a vial of dark liquid.\n\nThe book is a ritual manual. The vial... the label reads 'Belladonna Extract.' The same poison that killed your aunt.",
              onShow: [
                { type: 'setFlag', flag: 'found_poison_evidence', value: true },
                {
                  type: 'addItem',
                  item: {
                    itemId: 'belladonna-vial',
                    name: 'Belladonna Vial',
                    description: 'A vial of deadly poison, found hidden behind Eliza\'s portrait.',
                  },
                  quantity: 1,
                },
              ],
              nextBeatId: 'tower-beat5',
            },
            {
              id: 'tower-beat4-books',
              text: "Most books are mundane Victorian texts, but one section is different. Occult volumes, handwritten grimoires, treatises on entities that dwell between worlds.\n\nOne book is bookmarked—'On the Summoning and Binding of Moor-Dwellers.' The marked passage describes a ritual to break an ancient bargain.",
              onShow: [
                { type: 'setFlag', flag: 'found_ritual_book', value: true },
                { type: 'skill', skill: 'occult', change: 5 },
              ],
              nextBeatId: 'tower-beat5',
            },
            {
              id: 'tower-beat5',
              text: "A sound from below—footsteps on the stairs. Someone is coming up.\n\nYou have seconds to decide what to do.",
              choices: [
                {
                  id: 'hide',
                  text: 'Hide and see who it is',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'wit',
                    difficulty: 40,
                  },
                  consequences: [
                    { type: 'attribute', attribute: 'wit', change: 2 },
                  ],
                  nextBeatId: 'tower-beat6-hide',
                },
                {
                  id: 'confront',
                  text: 'Stand your ground',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'courage',
                    difficulty: 50,
                  },
                  consequences: [
                    { type: 'attribute', attribute: 'courage', change: 5 },
                  ],
                  nextBeatId: 'tower-beat6-confront',
                },
                {
                  id: 'call-out',
                  text: 'Call out—it might be Eleanor',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'empathy', change: 2 },
                  ],
                  nextBeatId: 'tower-beat6-call',
                },
              ],
            },
            {
              id: 'tower-beat6-hide',
              text: "You duck behind a heavy curtain just as the door opens. Through a gap, you see... Marcus Thorne.\n\nHe moves directly to the desk, searching through papers with practiced efficiency. He's been here before. He knows exactly what he's looking for.",
              onShow: [
                { type: 'setFlag', flag: 'saw_marcus_tower', value: true },
                { type: 'relationship', npcId: 'marcus', dimension: 'trust', change: -20 },
              ],
              nextBeatId: 'tower-beat7',
            },
            {
              id: 'tower-beat6-confront',
              text: "The door opens to reveal Marcus Thorne. He stops when he sees you, something flickering across his face—surprise, then calculation.\n\n\"I see you found it,\" he says. \"I was hoping to get here first.\"",
              speaker: 'Marcus',
              onShow: [
                { type: 'relationship', npcId: 'marcus', dimension: 'trust', change: -15 },
              ],
              nextBeatId: 'tower-beat7',
            },
            {
              id: 'tower-beat6-call',
              text: "\"Who's there?\"\n\nMarcus Thorne appears in the doorway. He looks relieved to see you—or is it something else?\n\n\"Thank God,\" he says. \"Eleanor told me you'd come up here. It's not safe—you don't understand what you're dealing with.\"",
              speaker: 'Marcus',
              nextBeatId: 'tower-beat7',
            },
            {
              id: 'tower-beat7',
              text: "\"The bargain,\" Marcus says, his voice different now. Colder. \"Your aunt discovered it. She was going to expose everything—the Blackwood legacy, the village's complicity, all of it.\"\n\nHe takes a step closer. \"I couldn't let that happen. This village has survived for generations because of that bargain. I'm not the villain here—I'm the protector.\"",
              speaker: 'Marcus',
              speakerMood: 'threatening',
              choices: [
                {
                  id: 'reason-marcus',
                  text: '"There has to be another way. We can break the cycle."',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'empathy',
                    difficulty: 55,
                  },
                  consequences: [
                    { type: 'attribute', attribute: 'empathy', change: 5 },
                    { type: 'relationship', npcId: 'marcus', dimension: 'respect', change: 10 },
                  ],
                  nextBeatId: 'tower-beat8-reason',
                },
                {
                  id: 'threaten-marcus',
                  text: '"I have evidence. Hurt me and the truth comes out anyway."',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'courage',
                    difficulty: 50,
                  },
                  consequences: [
                    { type: 'attribute', attribute: 'courage', change: 5 },
                    { type: 'relationship', npcId: 'marcus', dimension: 'fear', change: 15 },
                  ],
                  nextBeatId: 'tower-beat8-threaten',
                },
                {
                  id: 'escape',
                  text: 'Try to get past him and escape',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'resourcefulness',
                    difficulty: 60,
                  },
                  consequences: [
                    { type: 'attribute', attribute: 'resourcefulness', change: 5 },
                  ],
                  nextBeatId: 'tower-beat8-escape',
                },
              ],
            },
            {
              id: 'tower-beat8-reason',
              text: "Marcus hesitates. For a moment, you see the man he might have been—a doctor who wanted to help, not harm.\n\n\"Your aunt said the same thing,\" he whispers. \"She found a ritual. A way to end it. But the cost...\" He shakes his head. \"The entity won't release us easily.\"",
              onShow: [
                { type: 'setFlag', flag: 'marcus_wavering', value: true },
              ],
              nextSceneId: 'scene3-3-revelation',
            },
            {
              id: 'tower-beat8-threaten',
              text: "Marcus's eyes narrow, but he stops advancing. \"You're more like Cordelia than I expected.\"\n\nHe raises his hands slowly. \"Fine. You want the truth? The whole truth? Then let me show you. But I warn you—once you see, you can't unsee.\"",
              onShow: [
                { type: 'setFlag', flag: 'marcus_backing_down', value: true },
              ],
              nextSceneId: 'scene3-3-revelation',
            },
            {
              id: 'tower-beat8-escape',
              text: "You grab a heavy candlestick and swing. Marcus stumbles back, and you're past him, flying down the stairs.\n\nBehind you, he shouts: \"You can't run from this! The bargain comes due at the next full moon! With or without you!\"",
              onShow: [
                { type: 'setFlag', flag: 'escaped_marcus', value: true },
                { type: 'relationship', npcId: 'marcus', dimension: 'trust', change: -30 },
              ],
              nextSceneId: 'scene3-3-revelation',
            },
          ],
        },

        {
          id: 'scene3-3-revelation',
          name: 'The Revelation',
          startingBeatId: 'reveal-beat1',
          beats: [
            {
              id: 'reveal-beat1',
              text: "The full picture becomes clear—from Marcus's confession, from your aunt's research, from Eliza's own words.\n\n150 years ago, Eliza Blackwood made a deal with something ancient that dwelt beneath the moors. Prosperity for Ravenmoor, power for the Blackwoods. In exchange, every twenty years, a sacrifice.",
              nextBeatId: 'reveal-beat2',
            },
            {
              id: 'reveal-beat2',
              text: "The Blackwood who discovered the truth always died. Always. Because the village couldn't risk exposure.\n\nYour aunt found a way to break the cycle—a counter-ritual. But she was killed before she could perform it.",
              textVariants: [
                {
                  condition: {
                    type: 'flag',
                    flag: 'found_ritual_book',
                    value: true,
                  },
                  text: "The Blackwood who discovered the truth always died. Always. Because the village couldn't risk exposure.\n\nBut the book you found—it contains a counter-ritual. A way to break the bargain forever. Your aunt died trying to perform it. The question is: will you?",
                },
              ],
              choices: [
                {
                  id: 'commit-ritual',
                  text: '"I\'ll finish what she started."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'courage', change: 5 },
                    { type: 'attribute', attribute: 'resolve', change: 5 },
                    { type: 'setFlag', flag: 'committed_to_ritual', value: true },
                  ],
                  nextBeatId: 'reveal-beat3-commit',
                },
                {
                  id: 'expose-truth',
                  text: '"I\'ll take this to the authorities. The world needs to know."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'wit', change: 3 },
                    { type: 'setFlag', flag: 'chose_exposure', value: true },
                  ],
                  nextBeatId: 'reveal-beat3-expose',
                },
                {
                  id: 'need-time',
                  text: '"I need time to think."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'resolve', change: 3 },
                  ],
                  nextBeatId: 'reveal-beat3-time',
                },
              ],
            },
            {
              id: 'reveal-beat3-commit',
              text: "The decision settles over you like armor. Whatever Eliza unleashed, you will end. Whatever it costs.\n\nThe full moon is in three days. You have that long to prepare.",
            },
            {
              id: 'reveal-beat3-expose',
              text: "Ada Chen would be your ally in this. A journalist with the resources to break the story wide open.\n\nBut as you think it, doubt creeps in. Who would believe a story about ancient rituals and supernatural bargains? You need proof. Undeniable proof.",
            },
            {
              id: 'reveal-beat3-time',
              text: "The weight of generations presses down on you. Your ancestors' sins, your aunt's sacrifice, your own impossible choice.\n\nBut time is a luxury you may not have. The full moon approaches, and with it, the next tribute.",
            },
          ],
        },
      ],

      onComplete: [
        { type: 'skill', skill: 'occult', change: 10 },
        { type: 'attribute', attribute: 'courage', change: 5 },
        { type: 'attribute', attribute: 'resolve', change: 3 },
      ],
    },

    // ==========================================
    // EPISODE 4: ALLIES AND ENEMIES
    // ==========================================
    {
      id: 'ep4',
      number: 4,
      title: 'Allies and Enemies',
      synopsis: 'The village reveals its true colors as the full moon approaches.',
      coverImage: '',
      startingSceneId: 'scene4-1-gathering',

      scenes: [
        {
          id: 'scene4-1-gathering',
          name: 'Gathering Allies',
          startingBeatId: 'gather-beat1',
          beats: [
            {
              id: 'gather-beat1',
              text: "Two days until the full moon. You can't do this alone.\n\nAda Chen answers on the first ring. \"I've been trying to reach you,\" she says. \"The village phone lines have been... unreliable. What have you found?\"",
              speaker: 'Ada',
              choices: [
                {
                  id: 'tell-ada-everything',
                  text: 'Tell her everything',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'ada', dimension: 'trust', change: 20 },
                    { type: 'attribute', attribute: 'empathy', change: 3 },
                  ],
                  nextBeatId: 'gather-beat2-truth',
                },
                {
                  id: 'partial-truth',
                  text: 'Give her the sanitized version',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'ada', dimension: 'trust', change: 5 },
                    { type: 'attribute', attribute: 'wit', change: 2 },
                  ],
                  nextBeatId: 'gather-beat2-partial',
                },
              ],
            },
            {
              id: 'gather-beat2-truth',
              text: "The silence on the line stretches as you finish. Then Ada laughs—not mockingly, but in disbelief.\n\n\"Supernatural bargains. Ancient entities. This is... this is insane.\" A pause. \"But your aunt believed it. And she was murdered for it. I'm in.\"",
              speaker: 'Ada',
              onShow: [
                { type: 'setFlag', flag: 'ada_knows_truth', value: true },
              ],
              nextBeatId: 'gather-beat3',
            },
            {
              id: 'gather-beat2-partial',
              text: "Ada listens carefully. \"There's more you're not telling me,\" she says finally. \"But I trust you have your reasons. I'll help however I can—but eventually, I want the full story.\"",
              speaker: 'Ada',
              nextBeatId: 'gather-beat3',
            },
            {
              id: 'gather-beat3',
              text: "Eleanor appears in the doorway as you hang up. Her face is pale.\n\n\"The village council has called a meeting,\" she says. \"They know you've been in the tower. They know you found Eliza's secrets.\" She wrings her hands. \"They're coming tonight.\"",
              speaker: 'Eleanor',
              choices: [
                {
                  id: 'prepare-defense',
                  text: '"Then we prepare. Help me barricade the manor."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'courage', change: 5 },
                    { type: 'relationship', npcId: 'eleanor', dimension: 'trust', change: 10 },
                  ],
                  nextSceneId: 'scene4-2-siege',
                },
                {
                  id: 'confront-council',
                  text: '"I\'ll meet them. It\'s time to face this."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'courage', change: 10 },
                    { type: 'attribute', attribute: 'resolve', change: 5 },
                  ],
                  nextSceneId: 'scene4-3-council',
                },
                {
                  id: 'flee',
                  text: '"We need to leave. Now."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'resourcefulness', change: 5 },
                    { type: 'relationship', npcId: 'eleanor', dimension: 'respect', change: -5 },
                  ],
                  nextSceneId: 'scene4-4-flight',
                },
              ],
            },
          ],
        },

        {
          id: 'scene4-2-siege',
          name: 'The Siege',
          startingBeatId: 'siege-beat1',
          beats: [
            {
              id: 'siege-beat1',
              text: "You and Eleanor work quickly—locking doors, boarding windows, gathering anything that might serve as a weapon.\n\n\"They won't attack outright,\" Eleanor says. \"They need it to look like an accident. That's how it's always been.\"",
              speaker: 'Eleanor',
              nextBeatId: 'siege-beat2',
            },
            {
              id: 'siege-beat2',
              text: "Night falls. Torches appear on the moor—a procession moving toward the manor. Dozens of villagers, led by the old man from the pub.\n\n\"Blackwood!\" he calls. \"Come out! Face the council!\"",
              choices: [
                {
                  id: 'negotiate',
                  text: 'Open a window and negotiate',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'charm',
                    difficulty: 55,
                  },
                  consequences: [
                    { type: 'attribute', attribute: 'charm', change: 5 },
                  ],
                  nextBeatId: 'siege-beat3-negotiate',
                },
                {
                  id: 'stand-firm',
                  text: 'Stay silent—let them make the first move',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'resolve',
                    difficulty: 50,
                  },
                  consequences: [
                    { type: 'attribute', attribute: 'resolve', change: 5 },
                  ],
                  nextBeatId: 'siege-beat3-silent',
                },
              ],
            },
            {
              id: 'siege-beat3-negotiate',
              text: "\"I know about the bargain!\" you shout. \"I know what Eliza did! And I know there's a way to end it!\"\n\nMurmurs ripple through the crowd. The old man raises his hand for silence.\n\n\"End it?\" He laughs bitterly. \"Child, we've been trying to end it for a hundred years. It can't be done. The only thing we can do is pay the price—and survive.\"",
              nextBeatId: 'siege-beat4',
            },
            {
              id: 'siege-beat3-silent',
              text: "Minutes pass. The crowd grows restless. Then torches begin to move—not toward the manor, but around it. They're surrounding you.\n\n\"Last chance, Blackwood,\" the old man calls. \"Come out, or we come in.\"",
              nextBeatId: 'siege-beat4',
            },
            {
              id: 'siege-beat4',
              text: "A car engine breaks the tension—Ada's sedan, headlights blazing, racing up the drive. She skids to a stop between the manor and the crowd.\n\n\"I've already filed a story with my editor,\" she announces, stepping out with her phone raised. \"Time-stamped, with all your names. Anything happens to the Blackwood heir, and the whole world knows what this village has been doing.\"",
              speaker: 'Ada',
              onShow: [
                { type: 'relationship', npcId: 'ada', dimension: 'trust', change: 10 },
                { type: 'relationship', npcId: 'ada', dimension: 'respect', change: 15 },
              ],
              nextBeatId: 'siege-beat5',
            },
            {
              id: 'siege-beat5',
              text: "The old man's face twists with fury. But the crowd is wavering. The modern world has arrived in Ravenmoor, and their old methods won't work anymore.\n\n\"This isn't over,\" he snarls. \"The full moon comes whether you're ready or not. And when it does, someone will pay the price. It always does.\"",
              nextBeatId: 'siege-beat-end',
            },
            {
              id: 'siege-beat-end',
              text: "The villagers retreat into the darkness. Ada joins you in the manor, shaking but determined.\n\n\"So,\" she says. \"Tell me about this ritual. We have one day to prepare.\"",
              speaker: 'Ada',
            },
          ],
        },

        {
          id: 'scene4-3-council',
          name: 'The Council',
          startingBeatId: 'council-beat1',
          beats: [
            {
              id: 'council-beat1',
              text: "You meet them on the manor steps—the village council, led by the old pub keeper. Marcus stands among them, avoiding your eyes.\n\n\"You've been in the tower,\" the old man says. Not an accusation—a statement. \"You know what sleeps beneath the moors.\"",
              nextBeatId: 'council-beat2',
            },
            {
              id: 'council-beat2',
              text: '"I know what you\'ve been doing,\" you reply. \"Murder, disguised as accidents. For a hundred and fifty years."',
              choices: [
                {
                  id: 'offer-alternative',
                  text: '"But I also know there\'s another way. A ritual to break the bargain."',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'charm',
                    difficulty: 50,
                  },
                  consequences: [
                    { type: 'attribute', attribute: 'charm', change: 5 },
                  ],
                  nextBeatId: 'council-beat3-offer',
                },
                {
                  id: 'condemn',
                  text: '"You\'re all murderers. Every single one of you."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'courage', change: 5 },
                    { type: 'attribute', attribute: 'empathy', change: -3 },
                  ],
                  nextBeatId: 'council-beat3-condemn',
                },
              ],
            },
            {
              id: 'council-beat3-offer',
              text: "The old man's eyes narrow. \"The counter-ritual. Cordelia spoke of it. But the price...\"\n\n\"What price?\" you demand.\n\nHe shakes his head. \"A Blackwood must offer themselves willingly. Not as sacrifice—as anchor. Your blood, your will, binding the entity forever. It might kill you. It probably will.\"",
              onShow: [
                { type: 'setFlag', flag: 'knows_ritual_cost', value: true },
              ],
              nextBeatId: 'council-beat4',
            },
            {
              id: 'council-beat3-condemn',
              text: "\"Murderers?\" The old man steps closer. \"We're survivors. Every family in this village has lost someone to that thing. We didn't start this—your family did. We just... found a way to live with it.\"\n\nHis voice cracks. \"My grandfather. My daughter. Both offered to the moors because the Blackwoods' debt came due. Don't lecture me about murder.\"",
              onShow: [
                { type: 'attribute', attribute: 'empathy', change: 3 },
              ],
              nextBeatId: 'council-beat4',
            },
            {
              id: 'council-beat4',
              text: "Marcus finally speaks. \"There might be another way. I've been researching—Eliza's original ritual had a flaw. But if we modify it, share the burden across multiple bloodlines...\"\n\nThe council stirs uneasily. This is new information.",
              speaker: 'Marcus',
              onShow: [
                { type: 'relationship', npcId: 'marcus', dimension: 'trust', change: 10 },
                { type: 'setFlag', flag: 'marcus_alternative', value: true },
              ],
              nextBeatId: 'council-beat-end',
            },
            {
              id: 'council-beat-end',
              text: "\"One day,\" the old man says finally. \"You have one day to prepare whatever you're planning. If it doesn't work...\" He doesn't finish the sentence. He doesn't need to.\n\nThe council disperses into the night, leaving you with impossible choices and dwindling time.",
            },
          ],
        },

        {
          id: 'scene4-4-flight',
          name: 'Flight',
          startingBeatId: 'flight-beat1',
          beats: [
            {
              id: 'flight-beat1',
              text: "You grab what you can—Eliza's journal, Cordelia's notes, the ritual book. Eleanor hesitates.\n\n\"I've never left Ravenmoor,\" she says quietly. \"In forty years, I've never left.\"",
              speaker: 'Eleanor',
              choices: [
                {
                  id: 'convince-eleanor',
                  text: '"Come with me. You\'ve served this house long enough."',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'empathy',
                    difficulty: 45,
                  },
                  consequences: [
                    { type: 'relationship', npcId: 'eleanor', dimension: 'affection', change: 20 },
                    { type: 'attribute', attribute: 'empathy', change: 5 },
                  ],
                  nextBeatId: 'flight-beat2-together',
                },
                {
                  id: 'leave-eleanor',
                  text: '"I understand. Stay if you must."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'eleanor', dimension: 'affection', change: -10 },
                  ],
                  nextBeatId: 'flight-beat2-alone',
                },
              ],
            },
            {
              id: 'flight-beat2-together',
              text: "Eleanor nods slowly. \"For Cordelia,\" she says. \"And for you. Someone should witness what happens next.\"\n\nTogether, you slip out through the servants' entrance as torches appear on the road.",
              onShow: [
                { type: 'setFlag', flag: 'eleanor_escaped', value: true },
              ],
              nextBeatId: 'flight-beat3',
            },
            {
              id: 'flight-beat2-alone',
              text: "\"Then this is goodbye,\" Eleanor says. \"Whatever happens—your aunt would be proud of you.\"\n\nYou leave her standing in the doorway as you slip into the night.",
              nextBeatId: 'flight-beat3',
            },
            {
              id: 'flight-beat3',
              text: "Ada is waiting at the edge of the property with her car. \"I saw the torches,\" she says. \"Get in. We need to regroup.\"\n\nAs you drive away from Blackwood Manor, you see it silhouetted against the sky—a house built on blood and secrets. A house you'll have to return to.",
              speaker: 'Ada',
              nextBeatId: 'flight-beat-end',
            },
            {
              id: 'flight-beat-end',
              text: "You spend the night at a motel three towns away, poring over the ritual texts. The full moon is tomorrow. You've fled the immediate danger—but the bargain doesn't care about distance.\n\nIf you don't stop this, someone will die. Maybe everyone will die.",
            },
          ],
        },
      ],

      onComplete: [
        { type: 'attribute', attribute: 'courage', change: 5 },
        { type: 'attribute', attribute: 'resolve', change: 5 },
        { type: 'skill', skill: 'investigation', change: 3 },
      ],
    },

    // ==========================================
    // EPISODE 5: THE RITUAL
    // ==========================================
    {
      id: 'ep5',
      number: 5,
      title: 'The Ritual',
      synopsis: 'The full moon rises. The bargain demands payment. You must act.',
      coverImage: '',
      startingSceneId: 'scene5-1-preparation',

      scenes: [
        {
          id: 'scene5-1-preparation',
          name: 'Preparation',
          startingBeatId: 'prep-beat1',
          beats: [
            {
              id: 'prep-beat1',
              text: "The full moon rises tonight. You've returned to Blackwood Manor—there's no other place where the ritual can be performed. The house where Eliza made her bargain is the only place it can be broken.\n\nAda helps you arrange the ritual components. Eleanor—if she came—watches from the doorway.",
              textVariants: [
                {
                  condition: {
                    type: 'flag',
                    flag: 'eleanor_escaped',
                    value: true,
                  },
                  text: "The full moon rises tonight. You've returned to Blackwood Manor with Eleanor at your side. She knows this house better than anyone living—and her presence feels right.\n\nAda helps you arrange the ritual components while Eleanor prepares the ballroom.",
                },
              ],
              nextBeatId: 'prep-beat2',
            },
            {
              id: 'prep-beat2',
              text: '"Are you sure about this?" Ada asks, her voice quiet. "The texts say a Blackwood must serve as anchor. That could mean..."',
              speaker: 'Ada',
              choices: [
                {
                  id: 'accept-risk',
                  text: '"I know the risks. My family started this. I\'ll end it."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'resolve', change: 10 },
                    { type: 'relationship', npcId: 'ada', dimension: 'respect', change: 15 },
                  ],
                  nextBeatId: 'prep-beat3-accept',
                },
                {
                  id: 'find-alternative',
                  text: '"There has to be another way. Help me find it."',
                  choiceType: 'strategic',
                  conditions: {
                    type: 'flag',
                    flag: 'marcus_alternative',
                    value: true,
                  },
                  consequences: [
                    { type: 'attribute', attribute: 'wit', change: 5 },
                  ],
                  nextBeatId: 'prep-beat3-alternative',
                },
                {
                  id: 'show-fear',
                  text: '"I\'m terrified. But I don\'t see another choice."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'ada', dimension: 'affection', change: 10 },
                    { type: 'attribute', attribute: 'empathy', change: 3 },
                  ],
                  nextBeatId: 'prep-beat3-fear',
                },
              ],
            },
            {
              id: 'prep-beat3-accept',
              text: "Ada nods slowly. \"Your aunt would be proud. She wanted to do this herself, you know. She just... ran out of time.\"\n\nThe sun begins to set. The shadows lengthen across Blackwood Manor.",
              nextBeatId: 'prep-beat4',
            },
            {
              id: 'prep-beat3-alternative',
              text: "\"Marcus mentioned something,\" you recall. \"Sharing the burden across bloodlines. If we can get the village elders to participate...\"\n\nAda's eyes widen. \"Split the cost. Dilute the anchor. It's risky—but it might work.\"",
              onShow: [
                { type: 'setFlag', flag: 'shared_ritual', value: true },
              ],
              nextBeatId: 'prep-beat4',
            },
            {
              id: 'prep-beat3-fear',
              text: "\"Being afraid doesn't make you weak,\" Ada says. \"It makes you human.\" She takes your hand briefly. \"Whatever happens tonight—you won't face it alone.\"\n\nThe sun begins to set. The shadows lengthen across Blackwood Manor.",
              onShow: [
                { type: 'relationship', npcId: 'ada', dimension: 'trust', change: 10 },
              ],
              nextBeatId: 'prep-beat4',
            },
            {
              id: 'prep-beat4',
              text: "A knock at the door. Marcus Thorne stands on the threshold, looking haggard.\n\n\"I know I have no right to be here,\" he says. \"But I want to help. I've spent my life protecting a terrible secret. Maybe it's time to end it instead.\"",
              speaker: 'Marcus',
              choices: [
                {
                  id: 'accept-marcus',
                  text: '"We need all the help we can get."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'marcus', dimension: 'trust', change: 15 },
                    { type: 'attribute', attribute: 'empathy', change: 5 },
                  ],
                  nextBeatId: 'prep-beat5-accept',
                },
                {
                  id: 'reject-marcus',
                  text: '"You killed my aunt. Get out."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'marcus', dimension: 'trust', change: -20 },
                    { type: 'attribute', attribute: 'resolve', change: 5 },
                  ],
                  nextBeatId: 'prep-beat5-reject',
                },
                {
                  id: 'conditional-marcus',
                  text: '"Prove your loyalty. Tell me everything you know."',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'wit',
                    difficulty: 45,
                  },
                  consequences: [
                    { type: 'attribute', attribute: 'wit', change: 3 },
                  ],
                  nextBeatId: 'prep-beat5-conditional',
                },
              ],
            },
            {
              id: 'prep-beat5-accept',
              text: "Marcus enters, his relief visible. \"I've been studying the entity for years. I know its weaknesses—or at least, I know what your aunt theorized.\"\n\nHe spreads papers across the table. \"The thing beneath the moors isn't evil. It's hungry. And it's been feeding on Blackwood blood for generations.\"",
              onShow: [
                { type: 'setFlag', flag: 'marcus_helping', value: true },
              ],
              nextSceneId: 'scene5-2-moonrise',
            },
            {
              id: 'prep-beat5-reject',
              text: "Marcus flinches as if struck. \"I understand,\" he says quietly. \"I'll be at my house if you change your mind. Some of my research might be useful.\"\n\nHe leaves. Ada watches him go. \"Are you sure? We might need him.\"",
              nextSceneId: 'scene5-2-moonrise',
            },
            {
              id: 'prep-beat5-conditional',
              text: "\"Everything?\" Marcus sighs. \"The entity was here before the Blackwoods. Eliza didn't summon it—she found it. It offered her a deal, and she was desperate enough to accept.\"\n\nHe meets your eyes. \"The tribute isn't random. It's always someone who knows the truth. That's why your aunt died. That's why you're in danger now.\"",
              onShow: [
                { type: 'setFlag', flag: 'knows_full_truth', value: true },
                { type: 'setFlag', flag: 'marcus_helping', value: true },
              ],
              nextSceneId: 'scene5-2-moonrise',
            },
          ],
        },

        {
          id: 'scene5-2-moonrise',
          name: 'Moonrise',
          startingBeatId: 'moon-beat1',
          beats: [
            {
              id: 'moon-beat1',
              text: "The moon crests the horizon, full and silver. The moors seem to shimmer beneath its light—and something stirs. You can feel it, deep in your blood.\n\nThe entity is waking.",
              nextBeatId: 'moon-beat2',
            },
            {
              id: 'moon-beat2',
              text: "The ritual must be performed in the ballroom—the same place Eliza made her original bargain. As you enter, the gramophone begins to play on its own. The same haunting waltz you heard your first night.\n\nIn the mirror, a figure waits. Eliza. But different now. Less human.",
              choices: [
                {
                  id: 'begin-ritual',
                  text: 'Begin the ritual',
                  choiceType: 'strategic',
                  statCheck: {
                    skill: 'occult',
                    difficulty: 50,
                  },
                  consequences: [
                    { type: 'skill', skill: 'occult', change: 10 },
                  ],
                  nextBeatId: 'moon-beat3-ritual',
                },
                {
                  id: 'speak-eliza',
                  text: 'Try to communicate with Eliza first',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'empathy',
                    difficulty: 55,
                  },
                  consequences: [
                    { type: 'attribute', attribute: 'empathy', change: 5 },
                  ],
                  nextBeatId: 'moon-beat3-speak',
                },
              ],
            },
            {
              id: 'moon-beat3-ritual',
              text: "You light the candles, speak the words, draw the symbols in salt and ash. The air grows cold. The mirror begins to ripple like water.\n\nAnd then the entity speaks. Not with words—with pressure, with weight, with hunger that spans centuries.",
              nextSceneId: 'scene5-3-confrontation',
            },
            {
              id: 'moon-beat3-speak',
              text: "\"Eliza,\" you say to the mirror. \"Great-great-grandmother. I know what you did. I know why.\"\n\nThe figure in the mirror tilts her head. When she speaks, her voice is like wind through dead leaves.\n\n\"I did what I had to. For the family. For the village. You'll understand soon. When you feel its hunger.\"",
              speaker: 'Eliza',
              onShow: [
                { type: 'setFlag', flag: 'spoke_to_eliza', value: true },
              ],
              nextSceneId: 'scene5-3-confrontation',
            },
          ],
        },

        {
          id: 'scene5-3-confrontation',
          name: 'Confrontation',
          startingBeatId: 'confront-beat1',
          beats: [
            {
              id: 'confront-beat1',
              text: "The ballroom transforms. Shadows deepen, stretch, become something more than absence of light. The candles flicker but don't go out—the ritual holds.\n\nAnd from the mirror, from beneath the floor, from everywhere and nowhere, the entity manifests. Not a form—a presence. Ancient. Vast. Hungry beyond measure.",
              nextBeatId: 'confront-beat2',
            },
            {
              id: 'confront-beat2',
              text: "YOU BEAR THE BLOOD. The voice isn't heard—it's felt. WE HAVE AN ARRANGEMENT. THE DEBT IS DUE.\n\nThe pressure is immense. You can feel it trying to claim you, to drag you down into the darkness beneath the moors.",
              choices: [
                {
                  id: 'resist',
                  text: 'Resist with everything you have',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'resolve',
                    difficulty: 60,
                  },
                  consequences: [
                    { type: 'attribute', attribute: 'resolve', change: 10 },
                  ],
                  nextBeatId: 'confront-beat3-resist',
                },
                {
                  id: 'invoke-ritual',
                  text: 'Invoke the counter-ritual',
                  choiceType: 'strategic',
                  statCheck: {
                    skill: 'occult',
                    difficulty: 55,
                  },
                  consequences: [
                    { type: 'skill', skill: 'occult', change: 10 },
                  ],
                  nextBeatId: 'confront-beat3-invoke',
                },
                {
                  id: 'bargain',
                  text: 'Try to negotiate a new bargain',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'charm',
                    difficulty: 65,
                  },
                  consequences: [
                    { type: 'attribute', attribute: 'charm', change: 5 },
                  ],
                  nextBeatId: 'confront-beat3-bargain',
                },
              ],
            },
            {
              id: 'confront-beat3-resist',
              text: "You plant your feet and push back with your will. The entity recoils—surprised, perhaps, that a mortal would dare.\n\n\"I am not my ancestors,\" you declare. \"I will not feed your hunger!\"",
              nextBeatId: 'confront-beat4',
            },
            {
              id: 'confront-beat3-invoke',
              text: "You speak the words of unbinding, the ritual Cordelia found and died for. Each syllable burns in your throat, but you force them out.\n\nThe entity screams—not in pain, but in rage. IT CANNOT BE UNDONE. WE ARE BOUND.",
              nextBeatId: 'confront-beat4',
            },
            {
              id: 'confront-beat3-bargain',
              text: "\"Every bargain can be renegotiated,\" you say. \"What if I offer something else? Something better than blood?\"\n\nThe entity pauses. Considers. IT LISTENS.",
              onShow: [
                { type: 'setFlag', flag: 'attempted_bargain', value: true },
              ],
              nextBeatId: 'confront-beat4',
            },
            {
              id: 'confront-beat4',
              text: "The ritual reaches its climax. You must make the final choice—the one that will determine the fate of Ravenmoor, of your family, of yourself.",
              choices: [
                {
                  id: 'sacrifice-self',
                  text: 'Offer yourself as the anchor—bind the entity forever',
                  choiceType: 'dilemma',
                  consequences: [
                    { type: 'attribute', attribute: 'resolve', change: 15 },
                    { type: 'setFlag', flag: 'self_sacrifice', value: true },
                  ],
                  nextSceneId: 'scene5-4-sacrifice',
                },
                {
                  id: 'break-bargain',
                  text: 'Complete the counter-ritual—destroy the bargain and risk the consequences',
                  choiceType: 'dilemma',
                  consequences: [
                    { type: 'attribute', attribute: 'courage', change: 15 },
                    { type: 'setFlag', flag: 'broke_bargain', value: true },
                  ],
                  nextSceneId: 'scene5-4-break',
                },
                {
                  id: 'new-deal',
                  text: 'Forge a new bargain—one with less terrible terms',
                  choiceType: 'dilemma',
                  conditions: {
                    type: 'flag',
                    flag: 'attempted_bargain',
                    value: true,
                  },
                  consequences: [
                    { type: 'attribute', attribute: 'charm', change: 10 },
                    { type: 'setFlag', flag: 'new_bargain', value: true },
                  ],
                  nextSceneId: 'scene5-4-deal',
                },
              ],
            },
          ],
        },

        {
          id: 'scene5-4-sacrifice',
          name: 'The Sacrifice',
          startingBeatId: 'sacrifice-beat1',
          beats: [
            {
              id: 'sacrifice-beat1',
              text: "You open yourself to the entity—not as prey, but as chain. Your blood, your will, your very soul becomes the anchor that binds it.\n\nThe pain is beyond description. You feel yourself stretching across dimensions, becoming something more than human and less than whole.",
              nextBeatId: 'sacrifice-beat2',
            },
            {
              id: 'sacrifice-beat2',
              text: "Ada screams your name. Marcus—if he's there—tries to pull you back. But it's too late. The binding takes hold.\n\nThe entity howls in fury as it's chained. Not destroyed—but trapped. Forever. In you.",
              textVariants: [
                {
                  condition: {
                    type: 'flag',
                    flag: 'marcus_helping',
                    value: true,
                  },
                  text: "Ada and Marcus both reach for you, trying to pull you back from the abyss. But it's too late. The binding takes hold.\n\nThe entity howls in fury as it's chained. Not destroyed—but trapped. Forever. In you.",
                },
              ],
              nextBeatId: 'sacrifice-beat3',
            },
            {
              id: 'sacrifice-beat3',
              text: "When it's over, you're still standing. But you're not the same. You can feel it inside you—ancient, hungry, bound by your will.\n\nThe ballroom is silent. The mirror shows only your reflection. But your eyes... your eyes have changed.",
              onShow: [
                { type: 'addTag', tag: 'entity_bound' },
                { type: 'removeTag', tag: 'newcomer' },
              ],
            },
          ],
        },

        {
          id: 'scene5-4-break',
          name: 'Breaking Free',
          startingBeatId: 'break-beat1',
          beats: [
            {
              id: 'break-beat1',
              text: "You speak the final words of unbinding. The ritual tears through the bargain like fire through paper.\n\nThe entity screams—a sound that shatters windows and stops hearts. It's being ripped from the world it's haunted for centuries.",
              nextBeatId: 'break-beat2',
            },
            {
              id: 'break-beat2',
              text: "But as it goes, it lashes out. The floor cracks. The walls shake. The manor itself seems to scream.\n\nYou're thrown across the room. When you rise, the ballroom is in ruins—but the presence is gone. The entity is destroyed.",
              nextBeatId: 'break-beat3',
            },
            {
              id: 'break-beat3',
              text: "Ada helps you to your feet. \"Is it... is it over?\"\n\nYou feel for the presence that's haunted Blackwood Manor for generations. There's nothing. Only silence. Only peace.",
              speaker: 'Ada',
              onShow: [
                { type: 'addTag', tag: 'freed_ravenmoor' },
                { type: 'removeTag', tag: 'newcomer' },
              ],
            },
          ],
        },

        {
          id: 'scene5-4-deal',
          name: 'The New Bargain',
          startingBeatId: 'deal-beat1',
          beats: [
            {
              id: 'deal-beat1',
              text: "\"A new arrangement,\" you propose. \"Not blood. Not death. What do you truly hunger for?\"\n\nThe entity considers. MEMORY. ATTENTION. TO BE KNOWN.\n\nYou understand. It's been hiding for so long, feeding in secret. What it wants... is acknowledgment.",
              nextBeatId: 'deal-beat2',
            },
            {
              id: 'deal-beat2',
              text: "\"Then I offer this,\" you say. \"The truth. Your story, told to the world. Not worship—but recognition. In exchange, you release Ravenmoor from the old bargain.\"\n\nThe silence stretches. Then: AGREED.",
              nextBeatId: 'deal-beat3',
            },
            {
              id: 'deal-beat3',
              text: "The pressure lifts. The entity withdraws—not destroyed, not bound, but satisfied. For now.\n\nAda stares at you. \"Did you just... make a deal with an ancient horror?\"\n\n\"A better deal,\" you say. \"One that doesn't require murder.\"",
              speaker: 'Ada',
              onShow: [
                { type: 'addTag', tag: 'dealmaker' },
                { type: 'removeTag', tag: 'newcomer' },
              ],
            },
          ],
        },
      ],

      onComplete: [
        { type: 'skill', skill: 'occult', change: 15 },
        { type: 'attribute', attribute: 'resolve', change: 10 },
        { type: 'attribute', attribute: 'courage', change: 10 },
      ],
    },

    // ==========================================
    // EPISODE 6: AFTERMATH
    // ==========================================
    {
      id: 'ep6',
      number: 6,
      title: 'Aftermath',
      synopsis: 'The ritual is complete. But every ending is also a beginning.',
      coverImage: '',
      startingSceneId: 'scene6-1-dawn',

      scenes: [
        {
          id: 'scene6-1-dawn',
          name: 'Dawn',
          startingBeatId: 'dawn-beat1',
          beats: [
            {
              id: 'dawn-beat1',
              text: "Dawn breaks over Ravenmoor—the first dawn in 150 years without the shadow of the bargain. The village stirs, and somehow, people know. Something has changed.\n\nYou stand on the manor steps, watching the sun rise over the moors. You're exhausted, transformed, but alive.",
              textVariants: [
                {
                  condition: {
                    type: 'flag',
                    flag: 'self_sacrifice',
                    value: true,
                  },
                  text: "Dawn breaks over Ravenmoor. You feel the entity stir within you—hungry, always hungry—but bound by your will.\n\nThis is your life now. Guardian. Jailer. You'll never be free. But neither will it.",
                },
                {
                  condition: {
                    type: 'flag',
                    flag: 'new_bargain',
                    value: true,
                  },
                  text: "Dawn breaks over Ravenmoor. Somewhere, you can feel the entity watching—waiting for you to fulfill your end of the bargain.\n\nYou have a story to tell. The world's strangest book deal awaits.",
                },
              ],
              nextBeatId: 'dawn-beat2',
            },
            {
              id: 'dawn-beat2',
              text: "Ada finds you there. She's been up all night, processing everything she witnessed.\n\n\"So,\" she says. \"What now?\"",
              speaker: 'Ada',
              choices: [
                {
                  id: 'stay-ravenmoor',
                  text: '"I\'m staying. This is my home now."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'resolve', change: 5 },
                    { type: 'relationship', npcId: 'ada', dimension: 'respect', change: 10 },
                  ],
                  nextBeatId: 'dawn-beat3-stay',
                },
                {
                  id: 'leave-ravenmoor',
                  text: '"I\'m leaving. There\'s nothing for me here but ghosts."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'courage', change: 5 },
                  ],
                  nextBeatId: 'dawn-beat3-leave',
                },
                {
                  id: 'undecided',
                  text: '"I don\'t know yet. I need time."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'empathy', change: 3 },
                  ],
                  nextBeatId: 'dawn-beat3-undecided',
                },
              ],
            },
            {
              id: 'dawn-beat3-stay',
              text: "\"Blackwood Manor needs a Blackwood,\" you say. \"And maybe... maybe I can make something good out of all this darkness.\"\n\nAda smiles. \"I'll write your story either way. The world deserves to know what happened here.\"",
              speaker: 'Ada',
              nextSceneId: 'scene6-2-village',
            },
            {
              id: 'dawn-beat3-leave',
              text: "\"I understand,\" Ada says. \"Some places hold too much pain to stay.\"\n\nYou look back at Blackwood Manor. Your inheritance. Your burden. Your choice to leave behind.",
              nextSceneId: 'scene6-2-village',
            },
            {
              id: 'dawn-beat3-undecided',
              text: "\"That's fair,\" Ada says. \"You've been through more in a few days than most people face in a lifetime.\"\n\nShe squeezes your shoulder. \"Whatever you decide, you won't be alone.\"",
              speaker: 'Ada',
              onShow: [
                { type: 'relationship', npcId: 'ada', dimension: 'affection', change: 10 },
              ],
              nextSceneId: 'scene6-2-village',
            },
          ],
        },

        {
          id: 'scene6-2-village',
          name: 'The Village',
          startingBeatId: 'village-beat1',
          beats: [
            {
              id: 'village-beat1',
              text: "The village is transformed. People stand in the streets, looking at the sky, at each other, as if seeing the world for the first time.\n\nThe old pub keeper approaches you. His hostility is gone, replaced by something like awe.",
              nextBeatId: 'village-beat2',
            },
            {
              id: 'village-beat2',
              text: "\"It's gone,\" he says. \"The weight we've carried all our lives. You did what generations couldn't.\"\n\nHe extends his hand. \"I owe you an apology. We all do.\"",
              choices: [
                {
                  id: 'forgive-village',
                  text: 'Accept his hand. "We were all victims of the bargain."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'empathy', change: 10 },
                    { type: 'addTag', tag: 'forgiver' },
                  ],
                  nextBeatId: 'village-beat3-forgive',
                },
                {
                  id: 'reject-village',
                  text: 'Refuse. "Apologies don\'t bring back the dead."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'resolve', change: 5 },
                  ],
                  nextBeatId: 'village-beat3-reject',
                },
                {
                  id: 'conditional-forgive',
                  text: '"Prove your remorse. Help me make this right."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'wit', change: 3 },
                    { type: 'attribute', attribute: 'charm', change: 3 },
                  ],
                  nextBeatId: 'village-beat3-conditional',
                },
              ],
            },
            {
              id: 'village-beat3-forgive',
              text: "You shake his hand. \"My aunt wanted this village to be free. Holding grudges won't honor her memory.\"\n\nTears stream down the old man's face. Around you, others begin to weep—not from sorrow, but from release.",
              nextBeatId: 'village-beat4',
            },
            {
              id: 'village-beat3-reject',
              text: "You walk past him without a word. Some wounds don't heal. Some sins can't be forgiven.\n\nThe villagers watch you go, shame heavy on their faces. Perhaps that's the penance they deserve.",
              nextBeatId: 'village-beat4',
            },
            {
              id: 'village-beat3-conditional',
              text: "\"How?\" he asks.\n\n\"Memorial. For every victim. Every name remembered.\" You meet his eyes. \"And scholarships. For the children. A future built on truth, not secrets.\"\n\nHe nods slowly. \"It will be done.\"",
              onShow: [
                { type: 'setFlag', flag: 'village_redemption', value: true },
              ],
              nextBeatId: 'village-beat4',
            },
            {
              id: 'village-beat4',
              text: "Marcus Thorne approaches. He looks smaller somehow, diminished.\n\n\"I'm turning myself in,\" he says. \"For Cordelia. For all of them. It's time to answer for what I've done.\"",
              speaker: 'Marcus',
              textVariants: [
                {
                  condition: {
                    type: 'flag',
                    flag: 'marcus_helping',
                    value: true,
                  },
                  text: "Marcus Thorne approaches. Despite everything, he helped you in the end.\n\n\"I'm turning myself in,\" he says. \"I helped last night, but it doesn't erase what I did. It's time to face justice.\"",
                },
              ],
              choices: [
                {
                  id: 'let-marcus-go',
                  text: '"Go. Make your peace."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'marcus', dimension: 'respect', change: 10 },
                  ],
                  nextBeatId: 'village-beat5',
                },
                {
                  id: 'speak-for-marcus',
                  text: '"I\'ll speak at your trial. Tell them you helped end this."',
                  choiceType: 'strategic',
                  conditions: {
                    type: 'flag',
                    flag: 'marcus_helping',
                    value: true,
                  },
                  consequences: [
                    { type: 'relationship', npcId: 'marcus', dimension: 'trust', change: 20 },
                    { type: 'attribute', attribute: 'empathy', change: 5 },
                  ],
                  nextBeatId: 'village-beat5',
                },
              ],
            },
            {
              id: 'village-beat5',
              text: "Marcus nods and walks away—toward justice, toward redemption, toward whatever awaits.\n\nEleanor appears at your side. \"The manor is yours now,\" she says. \"Whatever you decide to do with it.\"",
              speaker: 'Eleanor',
              textVariants: [
                {
                  condition: {
                    type: 'flag',
                    flag: 'eleanor_escaped',
                    value: true,
                  },
                  text: "Marcus nods and walks away—toward justice, toward redemption, toward whatever awaits.\n\nEleanor takes your arm. \"We did it,\" she says quietly. \"After all these years. We actually did it.\"",
                },
              ],
              nextSceneId: 'scene6-3-ending',
            },
          ],
        },

        {
          id: 'scene6-3-ending',
          name: 'Ending',
          startingBeatId: 'end-beat1',
          beats: [
            {
              id: 'end-beat1',
              text: "You return to Blackwood Manor one last time. The house feels different now—lighter, somehow. The shadows are just shadows. The creaks are just old wood.\n\nIn the ballroom, you find the mirror. Your reflection looks back at you—older than when you arrived, marked by what you've experienced.",
              textVariants: [
                {
                  condition: {
                    type: 'flag',
                    flag: 'self_sacrifice',
                    value: true,
                  },
                  text: "You return to Blackwood Manor—your prison, your purpose. The house feels different now, attuned to you in ways you're still learning to understand.\n\nIn the ballroom, you find the mirror. Your reflection looks back at you—but your eyes... your eyes hold something ancient.",
                },
              ],
              nextBeatId: 'end-beat2',
            },
            {
              id: 'end-beat2',
              text: "For a moment—just a moment—you see Cordelia in the glass. Your aunt smiles at you, and mouths two words: 'Thank you.'\n\nThen she's gone. And you're alone with your future.",
              nextBeatId: 'end-beat3',
            },
            {
              id: 'end-beat3',
              text: "Ada waits outside with her car, ready to take you wherever you want to go. Eleanor stands at the door, watching.\n\nThe moors stretch endlessly around you—no longer threatening, just wild and beautiful and free.\n\nThe shadows of Ravenmoor have lifted at last.",
              textVariants: [
                {
                  condition: {
                    type: 'tag',
                    tag: 'entity_bound',
                    hasTag: true,
                  },
                  text: "Ada waits outside, but you know you can't leave. Not really. You're bound to this place now, as surely as the entity is bound to you.\n\nBut as you look out over the moors, you feel something unexpected: peace. You have a purpose. A duty. A reason to exist.\n\nThe shadows of Ravenmoor will never fully lift. But perhaps that's fitting. Some legacies aren't meant to end—only to transform.",
                },
                {
                  condition: {
                    type: 'tag',
                    tag: 'dealmaker',
                    hasTag: true,
                  },
                  text: "Ada waits outside, notepad ready. You have a story to tell—the strangest, truest story ever written. The entity is watching, waiting for its acknowledgment.\n\nThe shadows of Ravenmoor have lifted. But your new bargain has just begun. Somewhere between horror and hope, you'll find your way.\n\nAfter all, every Blackwood makes their own deal with darkness. Yours might just be the first one worth making.",
                },
              ],
            },
          ],
        },
      ],

      onComplete: [
        { type: 'attribute', attribute: 'resolve', change: 10 },
        { type: 'attribute', attribute: 'empathy', change: 5 },
        { type: 'attribute', attribute: 'courage', change: 5 },
        { type: 'skill', skill: 'occult', change: 5 },
      ],
    },
  ],
};
