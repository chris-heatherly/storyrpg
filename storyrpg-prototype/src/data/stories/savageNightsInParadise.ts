import { Story } from '../../types';

/**
 * Savage Nights in Paradise
 * A gonzo journalism adventure inspired by the spirit of counterculture road trips.
 *
 * Features all game mechanics:
 * - Branching narrative with consequences
 * - Social encounters (hotel check-ins, interviews)
 * - Survival encounters (navigating chaos)
 * - Investigation encounters (searching for truth)
 * - Relationship tracking
 * - State management (sanity, credibility, etc.)
 * - Conditional content based on player choices
 */

export const savageNightsInParadise: Story = {
  id: 'savage-nights-paradise',
  title: 'Savage Nights in Paradise',
  genre: 'Gonzo Adventure',
  synopsis:
    "You're a journalist sent to cover a desert motorcycle race in Las Vegas. Your attorney insists on coming along. What begins as a simple assignment becomes a hallucinatory odyssey into the dark heart of the American Dream. The question isn't whether you'll survive—it's whether you'll remember any of it.",
  coverImage: '',
  author: 'StoryRPG',
  tags: ['gonzo', 'comedy', 'dark', 'psychedelic', 'road-trip'],

  initialState: {
    attributes: {
      charm: 55,
      wit: 70,
      courage: 60,
      empathy: 45,
      resolve: 50,
      resourcefulness: 65,
    },
    skills: {
      journalism: 25,
      deception: 15,
      driving: 10,
      survival: 5,
    },
    tags: ['journalist', 'counterculture'],
    inventory: [
      {
        itemId: 'press-credentials',
        name: 'Press Credentials',
        description: 'Official documentation identifying you as a legitimate journalist.',
        quantity: 1,
      },
      {
        itemId: 'tape-recorder',
        name: 'Portable Tape Recorder',
        description: 'For capturing interviews and... personal observations.',
        quantity: 1,
      },
      {
        itemId: 'notebook',
        name: 'Leather Notebook',
        description: 'Filled with illegible scrawlings that might be notes.',
        quantity: 1,
      },
    ],
  },

  npcs: [
    {
      id: 'doc',
      name: 'Dr. Gonzo',
      description:
        'Your attorney. A 300-pound Samoan with a law degree and an appetite for chaos. He claims to be your legal counsel, but his counsel rarely involves anything legal.',
      initialRelationship: {
        trust: 70,
        affection: 60,
        respect: 40,
        fear: 30,
      },
    },
    {
      id: 'lacerda',
      name: 'Lacerda',
      description:
        'A photographer from the magazine. Professional, talented, and increasingly concerned about your methods.',
      initialRelationship: {
        trust: 40,
        affection: 20,
        respect: 50,
        fear: 0,
      },
    },
    {
      id: 'clerk',
      name: 'Hotel Clerk',
      description:
        'Various hotel staff who must deal with your presence. Their patience varies.',
      initialRelationship: {
        trust: 0,
        affection: 0,
        respect: 0,
        fear: 0,
      },
    },
    {
      id: 'hitchhiker',
      name: 'The Hitchhiker',
      description:
        'A young man you picked up outside of Barstow. He seems to regret his decision.',
      initialRelationship: {
        trust: 10,
        affection: 0,
        respect: 0,
        fear: 50,
      },
    },
    {
      id: 'waitress',
      name: 'Alice',
      description:
        'A waitress at the North Star Coffee Lounge. She knows something about the American Dream.',
      initialRelationship: {
        trust: 0,
        affection: 0,
        respect: 0,
        fear: 0,
      },
    },
  ],

  episodes: [
    // ==========================================
    // EPISODE 1: THE ASSIGNMENT
    // ==========================================
    {
      id: 'ep1-assignment',
      number: 1,
      title: 'The Assignment',
      synopsis:
        'A simple magazine assignment: cover a motorcycle race in the desert. But nothing is ever simple when Dr. Gonzo is involved.',
      coverImage: '',
      startingSceneId: 'scene1-1-call',

      scenes: [
        {
          id: 'scene1-1-call',
          name: 'The Phone Call',
          startingBeatId: 'call-beat1',
          beats: [
            {
              id: 'call-beat1',
              text: "The phone rings at 3 AM. Nothing good ever comes from a phone call at 3 AM, but you answer anyway. It's your editor.\n\n\"We need someone in Vegas. Tomorrow. The Mint 400—biggest off-road race in the country. Motorcycles, dune buggies, madness in the desert. You interested?\"",
              nextBeatId: 'call-beat2',
            },
            {
              id: 'call-beat2',
              text: "You're already interested. Vegas. The desert. A legitimate excuse to leave Los Angeles and all its festering problems behind.",
              choices: [
                {
                  id: 'accept-eager',
                  text: '"I\'ll take it. What\'s the budget?"',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'setFlag', flag: 'eager_assignment', value: true },
                    { type: 'changeScore', score: 'editor_trust', change: 5 },
                    { type: 'attribute', attribute: 'courage', change: 3 },
                  ],
                  nextBeatId: 'call-beat3',
                },
                {
                  id: 'accept-negotiate',
                  text: '"Depends. What kind of resources are we talking?"',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'charm',
                    difficulty: 40,
                  },
                  consequences: [
                    { type: 'changeScore', score: 'expense_account', change: 500 },
                    { type: 'attribute', attribute: 'charm', change: 2 },
                    { type: 'attribute', attribute: 'resourcefulness', change: 3 },
                  ],
                  nextBeatId: 'call-beat3',
                },
                {
                  id: 'accept-reluctant',
                  text: '"Vegas? In this heat? ...Fine. But I need a convertible."',
                  choiceType: 'expression',
                  consequences: [
                    { type: 'setFlag', flag: 'has_convertible', value: true },
                    { type: 'attribute', attribute: 'wit', change: 2 },
                  ],
                  nextBeatId: 'call-beat3',
                },
              ],
            },
            {
              id: 'call-beat3',
              text: "\"Full expense account,\" the editor says. \"Rent a car, get a hotel, do whatever you need to do. Just get me something printable by Monday.\"\n\nYou hang up. A legitimate assignment. Expenses paid. This calls for celebration—or at least consultation with your attorney.",
              nextBeatId: 'call-beat4',
            },
            {
              id: 'call-beat4',
              text: "Dr. Gonzo answers on the first ring. He never sleeps. You explain the situation.\n\n\"Vegas,\" he says, and you can hear the grin in his voice. \"I'll bring the supplies. You bring the car. We leave at dawn.\"",
              speaker: 'Dr. Gonzo',
              speakerMood: 'excited',
              choices: [
                {
                  id: 'supplies-question',
                  text: '"What kind of supplies?"',
                  choiceType: 'expression',
                  nextBeatId: 'call-beat5-supplies',
                },
                {
                  id: 'supplies-accept',
                  text: '"I trust your judgment."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'doc', dimension: 'trust', change: 10 },
                    { type: 'relationship', npcId: 'doc', dimension: 'affection', change: 5 },
                    { type: 'setFlag', flag: 'trusted_doc_supplies', value: true },
                    { type: 'attribute', attribute: 'courage', change: 3 },
                  ],
                  nextBeatId: 'call-beat5-trust',
                },
                {
                  id: 'supplies-limit',
                  text: '"Keep it reasonable. This is a professional assignment."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'doc', dimension: 'respect', change: -5 },
                    { type: 'relationship', npcId: 'doc', dimension: 'affection', change: -3 },
                    { type: 'setFlag', flag: 'limited_supplies', value: true },
                    { type: 'attribute', attribute: 'resolve', change: 3 },
                  ],
                  nextBeatId: 'call-beat5-limit',
                },
              ],
            },
            {
              id: 'call-beat5-supplies',
              text: "\"Legal supplies,\" he says. \"Mostly. Don't worry about it. Just have the car ready.\"\n\nThe line goes dead. You stare at the phone. This is either going to be the story of a lifetime or the end of your career. Possibly both.",
              nextSceneId: 'scene1-2-departure',
            },
            {
              id: 'call-beat5-trust',
              text: "\"That's what I like about you,\" he says. \"You understand the importance of proper preparation. See you at dawn.\"\n\nThe line goes dead. You've just given Dr. Gonzo carte blanche. History suggests this will have consequences.",
              nextSceneId: 'scene1-2-departure',
            },
            {
              id: 'call-beat5-limit',
              text: "\"Professional,\" he repeats, and laughs. \"Of course. Very professional. Dawn. Don't be late.\"\n\nThe line goes dead. You have a feeling he's not going to follow your advice.",
              nextSceneId: 'scene1-2-departure',
            },
          ],
        },

        {
          id: 'scene1-2-departure',
          name: 'Departure',
          startingBeatId: 'depart-beat1',
          beats: [
            {
              id: 'depart-beat1',
              text: "The sun is barely up when you arrive at the rental lot. The attendant looks at your press credentials and hands you the keys to a red convertible. \"Treat her nice,\" he says.\n\nDr. Gonzo is waiting by the curb with two large leather bags. He's wearing a Hawaiian shirt and mirrored sunglasses. He looks like a very dangerous man on vacation.",
              nextBeatId: 'depart-beat2',
              onShow: [
                {
                  type: 'addItem',
                  item: {
                    itemId: 'car-keys',
                    name: 'Convertible Keys',
                    description: 'Keys to a rented red convertible. Try not to destroy it.',
                  },
                  quantity: 1,
                },
              ],
            },
            {
              id: 'depart-beat2',
              text: "\"I took the liberty of preparing a survival kit,\" he says, loading the bags into the trunk. \"Everything we need for a weekend of serious journalism.\"\n\nYou don't ask what's in the bags. Some questions are better left unasked.",
              speaker: 'Dr. Gonzo',
              choices: [
                {
                  id: 'drive-yourself',
                  text: 'Take the wheel yourself',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'skill', skill: 'driving', change: 2 },
                    { type: 'setFlag', flag: 'started_driving', value: true },
                  ],
                  nextBeatId: 'depart-beat3',
                },
                {
                  id: 'doc-drives',
                  text: 'Let Dr. Gonzo drive',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'doc', dimension: 'trust', change: 5 },
                    { type: 'setFlag', flag: 'doc_driving', value: true },
                  ],
                  nextBeatId: 'depart-beat3',
                },
              ],
            },
            {
              id: 'depart-beat3',
              text: "The car roars to life. Los Angeles shrinks in the rearview mirror as you hit the highway heading east. The desert opens up before you—miles of nothing but sand, scrub, and possibilities.\n\nDr. Gonzo is already rummaging through one of his bags. \"We should prepare ourselves,\" he says. \"Journalism is a dangerous profession. Especially in Vegas.\"",
              speaker: 'Dr. Gonzo',
              nextBeatId: 'depart-beat4',
            },
            {
              id: 'depart-beat4',
              text: "By the time you pass Barstow, the world has begun to shift. The desert heat creates mirages on the highway—lakes of silver water that vanish as you approach. Or maybe it's not the heat.",
              textVariants: [
                {
                  condition: {
                    type: 'flag',
                    flag: 'limited_supplies',
                    value: true,
                  },
                  text: "By the time you pass Barstow, you're grateful you told Dr. Gonzo to keep things reasonable. He's only slightly more energetic than usual, which is still terrifying but manageable.",
                },
              ],
              nextBeatId: 'depart-beat5',
            },
            {
              id: 'depart-beat5',
              text: "That's when you see him—a young man standing by the side of the road, thumb extended. He looks normal. Clean-cut. Probably a student.\n\n\"We should pick him up,\" Dr. Gonzo says. \"It's the humanitarian thing to do.\"",
              speaker: 'Dr. Gonzo',
              choices: [
                {
                  id: 'pick-up-hitchhiker',
                  text: 'Pull over for the hitchhiker',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'setFlag', flag: 'picked_up_hitchhiker', value: true },
                    { type: 'attribute', attribute: 'empathy', change: 3 },
                  ],
                  nextBeatId: 'hitchhiker-beat1',
                },
                {
                  id: 'ignore-hitchhiker',
                  text: 'Keep driving',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'setFlag', flag: 'ignored_hitchhiker', value: true },
                  ],
                  nextSceneId: 'scene1-3-desert',
                },
              ],
            },
            {
              id: 'hitchhiker-beat1',
              text: "The kid climbs into the back seat, grateful for the ride. \"Thanks, man. I'm heading to Vegas. Job interview.\"\n\nDr. Gonzo turns around slowly, sunglasses reflecting the kid's nervous face. \"Job interview,\" he repeats. \"In Vegas. How... wholesome.\"",
              speaker: 'Dr. Gonzo',
              speakerMood: 'amused',
              nextBeatId: 'hitchhiker-beat2',
            },
            {
              id: 'hitchhiker-beat2',
              text: "The kid's eyes widen as he takes in the scene—the empty bottles, Dr. Gonzo's manic energy, the general atmosphere of impending chaos.\n\n\"What... what do you guys do?\" he asks.",
              choices: [
                {
                  id: 'tell-truth',
                  text: '"We\'re journalists. On assignment."',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'charm',
                    difficulty: 35,
                  },
                  consequences: [
                    { type: 'relationship', npcId: 'hitchhiker', dimension: 'trust', change: 10 },
                    { type: 'relationship', npcId: 'hitchhiker', dimension: 'respect', change: 5 },
                    { type: 'attribute', attribute: 'charm', change: 2 },
                    { type: 'attribute', attribute: 'empathy', change: 2 },
                  ],
                  nextBeatId: 'hitchhiker-beat3',
                },
                {
                  id: 'tell-lie',
                  text: '"We\'re with the District Attorney\'s office."',
                  choiceType: 'strategic',
                  statCheck: {
                    skill: 'deception',
                    difficulty: 40,
                  },
                  consequences: [
                    { type: 'relationship', npcId: 'hitchhiker', dimension: 'fear', change: 20 },
                    { type: 'skill', skill: 'deception', change: 2 },
                    { type: 'attribute', attribute: 'wit', change: 2 },
                    { type: 'attribute', attribute: 'empathy', change: -2 },
                  ],
                  nextBeatId: 'hitchhiker-beat3',
                },
                {
                  id: 'stay-silent',
                  text: 'Say nothing. Let Dr. Gonzo handle it.',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'hitchhiker', dimension: 'fear', change: 30 },
                    { type: 'relationship', npcId: 'doc', dimension: 'trust', change: 5 },
                    { type: 'attribute', attribute: 'resolve', change: 2 },
                  ],
                  nextBeatId: 'hitchhiker-beat3-gonzo',
                },
              ],
            },
            {
              id: 'hitchhiker-beat3',
              text: "The kid nods slowly, clearly not believing a word. Smart kid. He spends the rest of the drive pressed against the door, ready to jump at any moment.\n\nYou drop him at a gas station outside Vegas. He runs—actually runs—toward the bathroom.",
              nextSceneId: 'scene1-3-desert',
            },
            {
              id: 'hitchhiker-beat3-gonzo',
              text: "Dr. Gonzo leans over the seat, grinning. \"We're doctors,\" he says. \"Doctors of journalism. Here to diagnose America's sickness.\"\n\nThe kid doesn't say another word for the rest of the drive. You drop him at a gas station. He doesn't look back.",
              speaker: 'Dr. Gonzo',
              nextSceneId: 'scene1-3-desert',
            },
          ],
        },

        {
          id: 'scene1-3-desert',
          name: 'The Desert',
          startingBeatId: 'desert-beat1',
          beats: [
            {
              id: 'desert-beat1',
              text: "The desert highway stretches endlessly ahead. The sun is a hammer, the air a furnace. Dr. Gonzo has been talking for the last hour about his theory that Las Vegas is the physical manifestation of America's id.\n\n\"Think about it,\" he says. \"Everything America secretly wants, openly displayed. Greed. Lust. The desperate hope that luck will save you from your own bad decisions.\"",
              speaker: 'Dr. Gonzo',
              nextBeatId: 'desert-beat2',
            },
            {
              id: 'desert-beat2',
              text: "You're approaching the city now. You can see it shimmering on the horizon—a mirage that someone decided to make real. The first casino signs begin to appear, garish and hopeful.",
              choices: [
                {
                  id: 'agree-gonzo',
                  text: '"You might be onto something."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'doc', dimension: 'affection', change: 5 },
                    { type: 'relationship', npcId: 'doc', dimension: 'respect', change: 3 },
                    { type: 'addTag', tag: 'philosophical' },
                    { type: 'attribute', attribute: 'empathy', change: 2 },
                    { type: 'attribute', attribute: 'wit', change: 2 },
                  ],
                  nextBeatId: 'desert-beat3',
                },
                {
                  id: 'disagree-gonzo',
                  text: '"Or it\'s just a city that figured out how to separate fools from their money."',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'wit',
                    difficulty: 35,
                  },
                  consequences: [
                    { type: 'relationship', npcId: 'doc', dimension: 'respect', change: 5 },
                    { type: 'attribute', attribute: 'wit', change: 3 },
                    { type: 'attribute', attribute: 'resourcefulness', change: 2 },
                  ],
                  nextBeatId: 'desert-beat3',
                },
                {
                  id: 'focus-assignment',
                  text: '"Let\'s focus on the assignment."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'skill', skill: 'journalism', change: 2 },
                    { type: 'addTag', tag: 'professional' },
                    { type: 'attribute', attribute: 'resolve', change: 3 },
                    { type: 'relationship', npcId: 'doc', dimension: 'affection', change: -2 },
                  ],
                  nextBeatId: 'desert-beat3',
                },
              ],
            },
            {
              id: 'desert-beat3',
              text: "Las Vegas rises from the desert like a fever dream. Neon lights blink even in the afternoon sun. Massive hotels tower over the strip, each one trying to outdo the others in gaudy excess.\n\nThe Mint Hotel—your destination—appears on the right. A giant sign promises \"HOME OF THE MINT 400.\"\n\n\"We're here,\" Dr. Gonzo announces unnecessarily. \"Let the games begin.\"",
              speaker: 'Dr. Gonzo',
              nextSceneId: 'scene1-4-checkin',
            },
          ],
        },

        {
          id: 'scene1-4-checkin',
          name: 'Check-In',
          startingBeatId: 'checkin-beat1',
          beats: [],

          encounter: {
            id: 'hotel-checkin-1',
            type: 'social',
            name: 'Hotel Check-In',
            description: 'Navigate the hotel check-in process while maintaining the appearance of legitimate journalists.',

            phases: [
              {
                id: 'phase1-lobby',
                name: 'The Lobby',
                description: 'Cross the lobby without drawing too much attention.',
                situationImage: '',
                successThreshold: 3,
                failureThreshold: -2,

                beats: [
                  {
                    id: 'lobby-beat1',
                    text: "The Mint Hotel lobby is chaos. Race enthusiasts mill about in dusty gear, high rollers in expensive suits eye the casino floor, and somewhere a slot machine is singing its siren song.\n\nDr. Gonzo is already drawing looks. His Hawaiian shirt is too loud, his sunglasses too dark, his presence too... large.",
                    nextBeatId: 'lobby-beat2',
                  },
                  {
                    id: 'lobby-beat2',
                    text: "The check-in desk is ahead. A clerk watches your approach with professional suspicion.",
                    choices: [
                      {
                        id: 'approach-confident',
                        text: 'Stride up confidently with press credentials ready',
                        choiceType: 'strategic',
                        statCheck: {
                          attribute: 'charm',
                          difficulty: 40,
                        },
                        consequences: [
                          { type: 'skill', skill: 'journalism', change: 2 },
                        ],
                        nextBeatId: 'lobby-beat3',
                      },
                      {
                        id: 'approach-humble',
                        text: 'Approach quietly, trying not to draw attention',
                        choiceType: 'strategic',
                        statCheck: {
                          skill: 'deception',
                          difficulty: 35,
                        },
                        nextBeatId: 'lobby-beat3',
                      },
                      {
                        id: 'send-gonzo',
                        text: 'Let Dr. Gonzo handle the check-in',
                        choiceType: 'strategic',
                        statCheck: {
                          attribute: 'courage',
                          difficulty: 50,
                        },
                        consequences: [
                          { type: 'relationship', npcId: 'doc', dimension: 'trust', change: 10 },
                        ],
                        nextBeatId: 'lobby-beat3-gonzo',
                      },
                    ],
                  },
                  {
                    id: 'lobby-beat3',
                    text: "You reach the desk. The clerk's name tag reads \"SANDRA.\" She's seen things in this hotel. Terrible things. But nothing has prepared her for this.",
                    nextBeatId: 'lobby-beat4',
                  },
                  {
                    id: 'lobby-beat3-gonzo',
                    text: "Dr. Gonzo approaches the desk like a man with important business. \"We have a reservation,\" he announces to the clerk. \"Under the name of... journalism. Doctor Journalism.\"\n\nThe clerk—Sandra—blinks several times.",
                    speaker: 'Dr. Gonzo',
                    nextBeatId: 'lobby-beat4',
                  },
                  {
                    id: 'lobby-beat4',
                    text: '"Name?" Sandra asks, fingers hovering over her keyboard.',
                    speaker: 'Hotel Clerk',
                    choices: [
                      {
                        id: 'real-name',
                        text: 'Give your real name and press affiliation',
                        choiceType: 'strategic',
                        statCheck: {
                          skill: 'journalism',
                          difficulty: 30,
                        },
                        consequences: [
                          { type: 'setFlag', flag: 'used_real_identity', value: true },
                        ],
                      },
                      {
                        id: 'fake-name',
                        text: 'Invent a name that sounds more impressive',
                        choiceType: 'strategic',
                        statCheck: {
                          skill: 'deception',
                          difficulty: 45,
                        },
                        consequences: [
                          { type: 'setFlag', flag: 'used_fake_identity', value: true },
                          { type: 'skill', skill: 'deception', change: 3 },
                        ],
                      },
                    ],
                  },
                ],

                onSuccess: {
                  nextPhaseId: 'phase2-room',
                  outcomeText: "Sandra finds your reservation. She hands over two room keys with only minimal suspicion in her eyes. So far, so good.",
                  consequences: [
                    { type: 'relationship', npcId: 'clerk', dimension: 'trust', change: 5 },
                  ],
                },
                onFailure: {
                  nextPhaseId: 'phase2-room',
                  outcomeText: "Sandra hands over the keys, but she's already reaching for the phone. You have a feeling security will be keeping an eye on you.",
                  consequences: [
                    { type: 'setFlag', flag: 'security_alerted', value: true },
                    { type: 'relationship', npcId: 'clerk', dimension: 'fear', change: 10 },
                  ],
                },
              },

              {
                id: 'phase2-room',
                name: 'The Room',
                description: 'Get to your room without incident.',
                situationImage: '',
                successThreshold: 2,
                failureThreshold: -2,

                beats: [
                  {
                    id: 'room-beat1',
                    text: "The elevator ride is tense. A middle-aged couple eyes Dr. Gonzo nervously. He waves at them. They do not wave back.",
                    nextBeatId: 'room-beat2',
                  },
                  {
                    id: 'room-beat2',
                    text: "Your floor. The room is at the end of a long hallway that seems to stretch and contract as you walk.",
                    textVariants: [
                      {
                        condition: {
                          type: 'flag',
                          flag: 'limited_supplies',
                          value: true,
                        },
                        text: "Your floor. The hallway is mercifully stable. Whatever Dr. Gonzo's supplies included, they were apparently mild enough to leave your perception intact.",
                      },
                    ],
                    choices: [
                      {
                        id: 'walk-normal',
                        text: 'Walk normally to the room',
                        choiceType: 'strategic',
                        statCheck: {
                          attribute: 'resolve',
                          difficulty: 35,
                        },
                      },
                      {
                        id: 'walk-wall',
                        text: 'Use the wall for support, just in case',
                        choiceType: 'expression',
                        consequences: [
                          { type: 'attribute', attribute: 'resolve', change: -2 },
                        ],
                      },
                    ],
                  },
                ],

                onSuccess: {
                  outcomeText: "You make it to the room. The door opens. Inside: two beds, a television, a bathroom, and a view of the strip that would be beautiful if you could focus on it.\n\n\"Home sweet home,\" Dr. Gonzo declares, immediately unpacking his bags onto every available surface.",
                  consequences: [
                    {
                      type: 'addItem',
                      item: {
                        itemId: 'room-key',
                        name: 'Room Key',
                        description: 'Key to Room 1850 at the Mint Hotel.',
                      },
                      quantity: 1,
                    },
                  ],
                },
                onFailure: {
                  outcomeText: "You make it to the room, but not before knocking over a room service cart. A waiter shouts something in Spanish. Dr. Gonzo shouts back. By the time you're inside, you've definitely made an impression.\n\n\"Smooth,\" Dr. Gonzo observes.",
                  consequences: [
                    { type: 'changeScore', score: 'hotel_incidents', change: 1 },
                    {
                      type: 'addItem',
                      item: {
                        itemId: 'room-key',
                        name: 'Room Key',
                        description: 'Key to Room 1850 at the Mint Hotel.',
                      },
                      quantity: 1,
                    },
                  ],
                },
              },
            ],

            startingPhaseId: 'phase1-lobby',

            outcomes: {
              victory: {
                nextSceneId: 'scene1-5-settling',
                consequences: [
                  { type: 'changeScore', score: 'credibility', change: 5 },
                  { type: 'attribute', attribute: 'charm', change: 3 },
                  { type: 'relationship', npcId: 'clerk', dimension: 'respect', change: 10 },
                ],
              },
              defeat: {
                nextSceneId: 'scene1-5-settling',
                consequences: [
                  { type: 'changeScore', score: 'credibility', change: -5 },
                  { type: 'setFlag', flag: 'rough_start', value: true },
                  { type: 'attribute', attribute: 'resolve', change: -2 },
                  { type: 'relationship', npcId: 'clerk', dimension: 'fear', change: 15 },
                ],
              },
            },
          },
        },

        {
          id: 'scene1-5-settling',
          name: 'Settling In',
          startingBeatId: 'settle-beat1',
          beats: [
            {
              id: 'settle-beat1',
              text: "The room looks like a bomb went off. Dr. Gonzo has spread his \"supplies\" across every surface—bottles, bags, strange devices you don't want to examine too closely.\n\n\"We should get to work,\" he says. \"The race starts tomorrow. We need to scout the competition. Understand the terrain. Prepare ourselves mentally.\"",
              speaker: 'Dr. Gonzo',
              textVariants: [
                {
                  condition: {
                    type: 'flag',
                    flag: 'rough_start',
                    value: true,
                  },
                  text: "The room looks like a bomb went off. Dr. Gonzo has spread his supplies everywhere, seemingly unconcerned about the scene you caused downstairs.\n\n\"Minor setback,\" he says. \"The important thing is we're here. Now we can begin the real work.\"",
                },
              ],
              nextBeatId: 'settle-beat2',
            },
            {
              id: 'settle-beat2',
              text: "Through the window, Vegas glitters like a promise. Somewhere out there, the desert waits—and with it, the Mint 400. The biggest off-road race in the country. Your assignment.\n\nBut first, you have to survive the night.",
              choices: [
                {
                  id: 'rest',
                  text: 'Suggest getting some rest before tomorrow',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'resolve',
                    difficulty: 50,
                  },
                  consequences: [
                    { type: 'attribute', attribute: 'resolve', change: 5 },
                    { type: 'setFlag', flag: 'rested_first_night', value: true },
                  ],
                  nextBeatId: 'settle-beat3-rest',
                },
                {
                  id: 'explore',
                  text: 'Hit the casino floor to get a feel for the place',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'changeScore', score: 'vegas_knowledge', change: 5 },
                    { type: 'setFlag', flag: 'explored_casino', value: true },
                  ],
                  nextBeatId: 'settle-beat3-casino',
                },
                {
                  id: 'work',
                  text: 'Start working on background for the article',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'skill', skill: 'journalism', change: 3 },
                    { type: 'addTag', tag: 'dedicated_journalist' },
                  ],
                  nextBeatId: 'settle-beat3-work',
                },
              ],
            },
            {
              id: 'settle-beat3-rest',
              text: "Dr. Gonzo looks at you like you've suggested surrender. \"Rest? We're in Vegas. Rest is for the dead.\"\n\nBut you hold firm. Tomorrow will be chaos. Tonight, you sleep.\n\nYou dream of motorcycles screaming across an endless desert, chasing something they can never catch.",
            },
            {
              id: 'settle-beat3-casino',
              text: "The casino floor is a sensory assault—lights, sounds, the desperate hope of a thousand gamblers. Dr. Gonzo immediately gravitates toward the craps table.\n\n\"Research,\" he explains. \"We need to understand the psychology of the people who come here.\"\n\nYou lose $47 and gain an education in human desperation.",
              onShow: [
                { type: 'changeScore', score: 'expense_account', change: -47 },
              ],
            },
            {
              id: 'settle-beat3-work',
              text: "You spread your notes across the bed and start outlining the article. The Mint 400: history, participants, the culture of off-road racing.\n\nDr. Gonzo watches with something like respect. \"A professional,\" he says. \"I admire that. Misguided, but admirable.\"\n\nBy midnight, you have a rough structure. By morning, everything will change.",
            },
          ],
        },
      ],

      onComplete: [
        { type: 'skill', skill: 'journalism', change: 5 },
        { type: 'attribute', attribute: 'resolve', change: 2 },
      ],
    },

    // ==========================================
    // EPISODE 2: THE MINT 400
    // ==========================================
    {
      id: 'ep2-mint400',
      number: 2,
      title: 'The Mint 400',
      synopsis:
        'The race begins. Hundreds of motorcycles tear across the desert. Your job is to cover it. Your challenge is to survive it.',
      coverImage: '',
      startingSceneId: 'scene2-1-morning',

      scenes: [
        {
          id: 'scene2-1-morning',
          name: 'Race Morning',
          startingBeatId: 'morning-beat1',
          beats: [
            {
              id: 'morning-beat1',
              text: "The alarm screams at 6 AM. The race starts at nine. You have three hours to become a credible motorsports journalist.\n\nDr. Gonzo is already awake, standing at the window with binoculars pointed at... something. You don't ask.",
              textVariants: [
                {
                  condition: {
                    type: 'flag',
                    flag: 'rested_first_night',
                    value: true,
                  },
                  text: "You wake feeling almost human. The rest was a good call. Dr. Gonzo, who apparently didn't sleep at all, is standing at the window muttering about \"the nature of competition.\"",
                },
              ],
              nextBeatId: 'morning-beat2',
            },
            {
              id: 'morning-beat2',
              text: "\"We need a plan,\" you say. \"I have to actually cover this race.\"\n\n\"Naturally,\" Dr. Gonzo says. \"I've already arranged press access to the VIP area. Also, I may have told them you're a famous writer from New York.\"\n\n\"I'm from California.\"\n\n\"Details.\"",
              speaker: 'Dr. Gonzo',
              choices: [
                {
                  id: 'accept-lie',
                  text: '"Fine. I can work with that."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'skill', skill: 'deception', change: 2 },
                    { type: 'setFlag', flag: 'pretending_famous', value: true },
                    { type: 'attribute', attribute: 'charm', change: 2 },
                    { type: 'relationship', npcId: 'doc', dimension: 'affection', change: 5 },
                  ],
                  nextBeatId: 'morning-beat3',
                },
                {
                  id: 'correct-lie',
                  text: '"I\'ll use my real credentials, thanks."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'skill', skill: 'journalism', change: 2 },
                    { type: 'relationship', npcId: 'doc', dimension: 'respect', change: -5 },
                    { type: 'attribute', attribute: 'resolve', change: 3 },
                    { type: 'attribute', attribute: 'courage', change: 2 },
                  ],
                  nextBeatId: 'morning-beat3',
                },
              ],
            },
            {
              id: 'morning-beat3',
              text: "You grab your tape recorder and notebook. Outside, the desert sun is already brutal. The parking lot is filling with trucks and trailers, motorcycles and dune buggies.\n\nThe Mint 400. The most savage event in motorsports. And you're supposed to make sense of it.",
              nextSceneId: 'scene2-2-race',
            },
          ],
        },

        {
          id: 'scene2-2-race',
          name: 'The Race',
          startingBeatId: 'race-start',
          beats: [],

          encounter: {
            id: 'mint400-race',
            type: 'survival',
            name: 'Covering the Mint 400',
            description: 'Navigate the chaos of the race while attempting actual journalism.',

            phases: [
              {
                id: 'phase1-start',
                name: 'The Starting Line',
                description: 'The race begins in a cloud of dust and madness.',
                situationImage: '',
                successThreshold: 4,
                failureThreshold: -2,

                beats: [
                  {
                    id: 'start-beat1',
                    text: "The starting line is pandemonium. Hundreds of vehicles line up, engines roaring. Dust clouds rise like prayers to an indifferent god. The noise is physical—a wall of sound that makes thinking impossible.\n\nLacerda, the photographer from the magazine, finds you in the crowd. \"This is insane,\" he shouts over the engines. \"How are we supposed to cover this?\"",
                    speaker: 'Lacerda',
                    nextBeatId: 'start-beat2',
                  },
                  {
                    id: 'start-beat2',
                    text: "A good question. The race covers a hundred miles of open desert. No clear route. No rules worth mentioning. Just machines and humans testing each other's limits.",
                    choices: [
                      {
                        id: 'follow-leaders',
                        text: '"We follow the leaders. Get the action shots."',
                        choiceType: 'strategic',
                        statCheck: {
                          skill: 'journalism',
                          difficulty: 40,
                        },
                        consequences: [
                          { type: 'relationship', npcId: 'lacerda', dimension: 'respect', change: 10 },
                        ],
                        nextBeatId: 'start-beat3',
                      },
                      {
                        id: 'find-angle',
                        text: '"We find a human angle. Talk to the people."',
                        choiceType: 'strategic',
                        statCheck: {
                          attribute: 'empathy',
                          difficulty: 35,
                        },
                        consequences: [
                          { type: 'skill', skill: 'journalism', change: 3 },
                        ],
                        nextBeatId: 'start-beat3',
                      },
                      {
                        id: 'improvise',
                        text: '"We improvise. Let the story come to us."',
                        choiceType: 'strategic',
                        statCheck: {
                          attribute: 'resourcefulness',
                          difficulty: 45,
                        },
                        consequences: [
                          { type: 'addTag', tag: 'gonzo_method' },
                        ],
                        nextBeatId: 'start-beat3',
                      },
                    ],
                  },
                  {
                    id: 'start-beat3',
                    text: "The flag drops. The world explodes into motion. Motorcycles surge forward, dune buggies roar to life, and a tidal wave of dust swallows everything.\n\nYou can't see. You can barely breathe. This is journalism.",
                    choices: [
                      {
                        id: 'push-forward',
                        text: 'Push forward into the chaos',
                        choiceType: 'strategic',
                        statCheck: {
                          attribute: 'courage',
                          difficulty: 50,
                        },
                        consequences: [
                          { type: 'attribute', attribute: 'courage', change: 3 },
                        ],
                      },
                      {
                        id: 'find-vantage',
                        text: 'Find a vantage point above the dust',
                        choiceType: 'strategic',
                        statCheck: {
                          attribute: 'wit',
                          difficulty: 40,
                        },
                        consequences: [
                          { type: 'skill', skill: 'journalism', change: 2 },
                        ],
                      },
                    ],
                  },
                ],

                onSuccess: {
                  nextPhaseId: 'phase2-desert',
                  outcomeText: "You emerge from the dust cloud with usable notes and Lacerda has incredible shots. The first wave of racers is already disappearing into the desert.",
                  consequences: [
                    { type: 'relationship', npcId: 'lacerda', dimension: 'trust', change: 10 },
                  ],
                },
                onFailure: {
                  nextPhaseId: 'phase2-desert',
                  outcomeText: "When the dust clears, you've lost Lacerda and your notebook is filled with illegible scrawls. Dr. Gonzo is laughing somewhere behind you.",
                  consequences: [
                    { type: 'relationship', npcId: 'lacerda', dimension: 'trust', change: -10 },
                    { type: 'setFlag', flag: 'lost_lacerda', value: true },
                  ],
                },
              },

              {
                id: 'phase2-desert',
                name: 'The Desert',
                description: 'Chase the race across miles of unforgiving terrain.',
                situationImage: '',
                successThreshold: 4,
                failureThreshold: -3,

                beats: [
                  {
                    id: 'desert-beat1',
                    text: "You commandeer a press jeep and chase the race into the desert. The landscape is alien—rocks and sand and distant mountains that never seem to get closer.\n\nDr. Gonzo is driving. This may have been a mistake.",
                    textVariants: [
                      {
                        condition: {
                          type: 'flag',
                          flag: 'lost_lacerda',
                          value: true,
                        },
                        text: "You commandeer a press jeep, hoping to find Lacerda somewhere in the chaos. Dr. Gonzo is driving. His interpretation of 'road' is... liberal.",
                      },
                    ],
                    nextBeatId: 'desert-beat2',
                  },
                  {
                    id: 'desert-beat2',
                    text: "A motorcycle appears from nowhere, missing your jeep by inches. The rider doesn't even look back.\n\n\"These people are insane,\" Dr. Gonzo observes approvingly. \"I love them.\"",
                    speaker: 'Dr. Gonzo',
                    choices: [
                      {
                        id: 'chase-leader',
                        text: 'Try to catch up to the race leaders',
                        choiceType: 'strategic',
                        statCheck: {
                          skill: 'driving',
                          difficulty: 50,
                        },
                        consequences: [
                          { type: 'skill', skill: 'driving', change: 5 },
                        ],
                        nextBeatId: 'desert-beat3',
                      },
                      {
                        id: 'interview-pit',
                        text: 'Stop at a pit station for interviews',
                        choiceType: 'strategic',
                        statCheck: {
                          skill: 'journalism',
                          difficulty: 40,
                        },
                        consequences: [
                          { type: 'skill', skill: 'journalism', change: 3 },
                        ],
                        nextBeatId: 'desert-beat3',
                      },
                      {
                        id: 'observe',
                        text: 'Find a hill and observe the madness from above',
                        choiceType: 'strategic',
                        statCheck: {
                          attribute: 'wit',
                          difficulty: 35,
                        },
                        consequences: [
                          { type: 'addTag', tag: 'observer' },
                        ],
                        nextBeatId: 'desert-beat3',
                      },
                    ],
                  },
                  {
                    id: 'desert-beat3',
                    text: "The race stretches for hours. Machines break down. Riders crash and get back up. The desert claims its toll in blood and metal and broken dreams.\n\nYou're filling your notebook with observations that might be brilliant or might be nonsense. It's hard to tell in this heat.",
                    nextBeatId: 'desert-beat4',
                  },
                  {
                    id: 'desert-beat4',
                    text: "Dr. Gonzo taps your shoulder. \"Look.\"\n\nA racer is down ahead—motorcycle twisted, rider not moving. Other vehicles swerve around without stopping. This is the dark side of the race.",
                    choices: [
                      {
                        id: 'help-rider',
                        text: 'Stop to help the fallen rider',
                        choiceType: 'dilemma',
                        statCheck: {
                          attribute: 'empathy',
                          difficulty: 30,
                        },
                        consequences: [
                          { type: 'attribute', attribute: 'empathy', change: 5 },
                          { type: 'setFlag', flag: 'helped_rider', value: true },
                        ],
                        nextBeatId: 'desert-beat5-help',
                      },
                      {
                        id: 'document',
                        text: 'Document the scene—this is the real story',
                        choiceType: 'dilemma',
                        statCheck: {
                          skill: 'journalism',
                          difficulty: 45,
                        },
                        consequences: [
                          { type: 'skill', skill: 'journalism', change: 5 },
                          { type: 'attribute', attribute: 'empathy', change: -3 },
                        ],
                        nextBeatId: 'desert-beat5-doc',
                      },
                    ],
                  },
                  {
                    id: 'desert-beat5-help',
                    text: "You pull over. The rider is conscious but hurt—broken collarbone, definitely. You radio for medical support and stay until help arrives.\n\n\"Thank you,\" the rider says through gritted teeth. \"Most people just keep going.\"\n\nYou've lost time, but gained something else. Something harder to define.",
                  },
                  {
                    id: 'desert-beat5-doc',
                    text: "You capture the moment—the twisted metal, the empty desert, the indifference of the other racers. It's a powerful image. It's also deeply uncomfortable.\n\nSomeone else stops to help eventually. You drive on with your notes and your guilt.",
                  },
                ],

                onSuccess: {
                  outcomeText: "By the time the race ends, you have pages of material. Real observations about competition, desperation, and the American need to prove something through speed and danger.",
                  consequences: [
                    { type: 'skill', skill: 'journalism', change: 5 },
                    { type: 'changeScore', score: 'article_quality', change: 10 },
                  ],
                },
                onFailure: {
                  outcomeText: "The race ends and you're not entirely sure what you saw. Your notes are fragments. Impressions. Maybe that's enough. Maybe it isn't.",
                  consequences: [
                    { type: 'changeScore', score: 'article_quality', change: -5 },
                  ],
                },
              },
            ],

            startingPhaseId: 'phase1-start',

            outcomes: {
              victory: {
                nextSceneId: 'scene2-3-aftermath',
                consequences: [
                  { type: 'changeScore', score: 'editor_trust', change: 10 },
                ],
              },
              defeat: {
                nextSceneId: 'scene2-3-aftermath',
                consequences: [
                  { type: 'changeScore', score: 'editor_trust', change: -5 },
                ],
              },
            },
          },
        },

        {
          id: 'scene2-3-aftermath',
          name: 'Aftermath',
          startingBeatId: 'aftermath-beat1',
          beats: [
            {
              id: 'aftermath-beat1',
              text: "Back at the hotel, covered in dust and exhaustion. The race is over. Someone won—you have the name written down somewhere. The real story, as always, was in the margins.\n\nDr. Gonzo is on the phone with someone, speaking in urgent whispers.",
              textVariants: [
                {
                  condition: {
                    type: 'flag',
                    flag: 'helped_rider',
                    value: true,
                  },
                  text: "Back at the hotel, the dust of the desert still in your lungs. You keep thinking about the fallen rider. He'll live—you checked. But the image stays with you.\n\nDr. Gonzo is on the phone with someone, seemingly planning something.",
                },
              ],
              nextBeatId: 'aftermath-beat2',
            },
            {
              id: 'aftermath-beat2',
              text: "He hangs up, grinning. \"Good news. I've secured us another assignment.\"\n\n\"Another assignment? We haven't finished this one.\"\n\n\"Details. This is bigger. A conference. Here in Vegas. The National District Attorneys' Association is meeting to discuss the drug problem in America.\"\n\nHe pauses for effect. \"They want press coverage.\"",
              speaker: 'Dr. Gonzo',
              speakerMood: 'manic',
              choices: [
                {
                  id: 'refuse-assignment',
                  text: '"Absolutely not. We finish the race story first."',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'resolve',
                    difficulty: 55,
                  },
                  consequences: [
                    { type: 'relationship', npcId: 'doc', dimension: 'affection', change: -10 },
                    { type: 'addTag', tag: 'focused' },
                  ],
                  nextBeatId: 'aftermath-beat3-refuse',
                },
                {
                  id: 'accept-curious',
                  text: '"District attorneys... talking about drugs? This could be interesting."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'doc', dimension: 'trust', change: 10 },
                    { type: 'setFlag', flag: 'accepted_convention', value: true },
                  ],
                  nextBeatId: 'aftermath-beat3-accept',
                },
                {
                  id: 'accept-reluctant',
                  text: '"This is a terrible idea. Let\'s do it."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'doc', dimension: 'affection', change: 5 },
                    { type: 'setFlag', flag: 'accepted_convention', value: true },
                    { type: 'addTag', tag: 'reckless' },
                  ],
                  nextBeatId: 'aftermath-beat3-accept',
                },
              ],
            },
            {
              id: 'aftermath-beat3-refuse',
              text: "Dr. Gonzo shrugs. \"Your loss. I'm going anyway. They're expecting Dr. Gonzo, attorney at law, to provide expert testimony.\"\n\n\"That's fraud.\"\n\n\"That's journalism.\"\n\nYou spend the night working on the race article while Dr. Gonzo disappears into the Vegas night. Somehow, you know this isn't over.",
            },
            {
              id: 'aftermath-beat3-accept',
              text: "\"Excellent,\" Dr. Gonzo says. \"We check out tomorrow, move to the Flamingo—they're hosting the conference—and immerse ourselves in the enemy camp.\"\n\n\"We're not at war with district attorneys.\"\n\nHe looks at you with something like pity. \"Everyone is at war with district attorneys. They just don't know it yet.\"\n\nThe night stretches ahead, full of terrible promise.",
            },
          ],
        },
      ],

      onComplete: [
        { type: 'skill', skill: 'journalism', change: 5 },
        { type: 'skill', skill: 'survival', change: 5 },
      ],
    },

    // ==========================================
    // EPISODE 3: THE CONVENTION
    // ==========================================
    {
      id: 'ep3-convention',
      number: 3,
      title: 'The Convention',
      synopsis:
        'The National District Attorneys\' Conference on Drug Abuse. You are not supposed to be here. Neither is Dr. Gonzo. This will not end well.',
      coverImage: '',
      startingSceneId: 'scene3-1-flamingo',

      scenes: [
        {
          id: 'scene3-1-flamingo',
          name: 'The Flamingo',
          startingBeatId: 'flamingo-beat1',
          beats: [
            {
              id: 'flamingo-beat1',
              text: "The Flamingo Hotel is older Vegas—pink and gaudy, a reminder of the city's mobster past. It's also crawling with district attorneys, which gives it a different kind of menace.\n\nDr. Gonzo has acquired matching suits somewhere. \"We need to blend in,\" he explains. \"These are our people now.\"",
              speaker: 'Dr. Gonzo',
              nextBeatId: 'flamingo-beat2',
              onShow: [
                {
                  type: 'addItem',
                  item: {
                    itemId: 'fake-badge',
                    name: 'Conference Badge',
                    description: 'A badge identifying you as an attendee. The name is spelled wrong.',
                  },
                  quantity: 1,
                },
              ],
            },
            {
              id: 'flamingo-beat2',
              text: "The lobby is full of men in suits discussing mandatory minimums and civil forfeiture. They all look like they've never had fun in their lives.\n\n\"The enemy,\" Dr. Gonzo whispers. \"In their natural habitat.\"",
              speaker: 'Dr. Gonzo',
              speakerMood: 'conspiratorial',
              choices: [
                {
                  id: 'embrace-role',
                  text: 'Embrace your cover identity',
                  choiceType: 'strategic',
                  statCheck: {
                    skill: 'deception',
                    difficulty: 45,
                  },
                  consequences: [
                    { type: 'skill', skill: 'deception', change: 5 },
                    { type: 'setFlag', flag: 'deep_cover', value: true },
                  ],
                  nextBeatId: 'flamingo-beat3',
                },
                {
                  id: 'stay-quiet',
                  text: 'Stay quiet and observe',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'wit',
                    difficulty: 35,
                  },
                  consequences: [
                    { type: 'skill', skill: 'journalism', change: 3 },
                  ],
                  nextBeatId: 'flamingo-beat3',
                },
                {
                  id: 'provoke',
                  text: 'Start asking uncomfortable questions',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'courage',
                    difficulty: 55,
                  },
                  consequences: [
                    { type: 'setFlag', flag: 'drew_attention', value: true },
                    { type: 'relationship', npcId: 'doc', dimension: 'respect', change: 10 },
                  ],
                  nextBeatId: 'flamingo-beat3',
                },
              ],
            },
            {
              id: 'flamingo-beat3',
              text: "You check into your room—another suite, courtesy of Dr. Gonzo's creative accounting. The conference materials wait on the bed: schedules, pamphlets, a name tag.\n\nThe keynote speech starts in two hours. 'The Marijuana Menace: A Law Enforcement Perspective.'",
              textVariants: [
                {
                  condition: {
                    type: 'flag',
                    flag: 'drew_attention',
                    value: true,
                  },
                  text: "You check into your room, already aware of the suspicious looks following you. Your questions in the lobby attracted attention—not all of it friendly.\n\nThe keynote speech starts in two hours. If you're going to be exposed, it'll probably be there.",
                },
              ],
              nextSceneId: 'scene3-2-keynote',
            },
          ],
        },

        {
          id: 'scene3-2-keynote',
          name: 'The Keynote',
          startingBeatId: 'keynote-beat1',
          beats: [],

          encounter: {
            id: 'convention-keynote',
            type: 'social',
            name: 'The Keynote Speech',
            description: 'Survive the conference keynote without being exposed as frauds.',

            phases: [
              {
                id: 'phase1-arrival',
                name: 'Taking Your Seats',
                description: 'Find seats without attracting attention.',
                situationImage: '',
                successThreshold: 3,
                failureThreshold: -2,

                beats: [
                  {
                    id: 'arrive-beat1',
                    text: "The conference room is packed. Hundreds of district attorneys sit in neat rows, notebooks ready, faces serious. The banner reads: 'WINNING THE WAR ON DRUGS.'\n\nDr. Gonzo is vibrating with barely contained energy. \"Look at them,\" he whispers. \"They have no idea.\"",
                    speaker: 'Dr. Gonzo',
                    nextBeatId: 'arrive-beat2',
                  },
                  {
                    id: 'arrive-beat2',
                    text: "Finding seats near the back seems wise. But the back is full of what look like federal agents scanning the crowd.",
                    choices: [
                      {
                        id: 'front-seats',
                        text: 'Take seats near the front—hide in plain sight',
                        choiceType: 'strategic',
                        statCheck: {
                          attribute: 'courage',
                          difficulty: 50,
                        },
                        consequences: [
                          { type: 'setFlag', flag: 'sat_front', value: true },
                        ],
                        nextBeatId: 'arrive-beat3',
                      },
                      {
                        id: 'middle-seats',
                        text: 'Find seats in the anonymous middle',
                        choiceType: 'strategic',
                        statCheck: {
                          skill: 'deception',
                          difficulty: 40,
                        },
                        nextBeatId: 'arrive-beat3',
                      },
                      {
                        id: 'stand-back',
                        text: 'Stand in the back—easier to escape if needed',
                        choiceType: 'strategic',
                        statCheck: {
                          attribute: 'wit',
                          difficulty: 35,
                        },
                        consequences: [
                          { type: 'setFlag', flag: 'near_exit', value: true },
                        ],
                        nextBeatId: 'arrive-beat3',
                      },
                    ],
                  },
                  {
                    id: 'arrive-beat3',
                    text: "The lights dim. A man in an expensive suit takes the podium. His smile is practiced. His eyes are cold.\n\n\"Ladies and gentlemen, welcome to the front lines of America's most important battle...\"",
                  },
                ],

                onSuccess: {
                  nextPhaseId: 'phase2-speech',
                  outcomeText: "You settle in without incident. The agents in the back don't give you a second look. So far, so good.",
                  consequences: [
                    { type: 'changeScore', score: 'cover_intact', change: 5 },
                  ],
                },
                onFailure: {
                  nextPhaseId: 'phase2-speech',
                  outcomeText: "As you take your seats, a man in a grey suit watches you a little too long. He makes a note. This could be a problem.",
                  consequences: [
                    { type: 'setFlag', flag: 'being_watched', value: true },
                  ],
                },
              },

              {
                id: 'phase2-speech',
                name: 'The Speech',
                description: 'Endure the keynote while maintaining your composure.',
                situationImage: '',
                successThreshold: 4,
                failureThreshold: -3,

                beats: [
                  {
                    id: 'speech-beat1',
                    text: "The speaker drones on about the \"drug epidemic\" with statistics that feel designed to frighten rather than inform. Dr. Gonzo is taking notes—or pretending to.\n\n\"We must think of the children,\" the speaker says. \"The innocent victims of this chemical warfare.\"",
                    nextBeatId: 'speech-beat2',
                  },
                  {
                    id: 'speech-beat2',
                    text: "Dr. Gonzo leans over. \"This is extraordinary,\" he whispers. \"They actually believe this. It's not cynicism—it's faith.\"",
                    speaker: 'Dr. Gonzo',
                    speakerMood: 'fascinated',
                    choices: [
                      {
                        id: 'take-notes',
                        text: 'Take detailed notes for the article',
                        choiceType: 'strategic',
                        statCheck: {
                          skill: 'journalism',
                          difficulty: 35,
                        },
                        consequences: [
                          { type: 'skill', skill: 'journalism', change: 3 },
                          { type: 'changeScore', score: 'article_quality', change: 5 },
                        ],
                        nextBeatId: 'speech-beat3',
                      },
                      {
                        id: 'observe-crowd',
                        text: 'Study the audience reactions instead',
                        choiceType: 'strategic',
                        statCheck: {
                          attribute: 'empathy',
                          difficulty: 40,
                        },
                        consequences: [
                          { type: 'skill', skill: 'journalism', change: 2 },
                        ],
                        nextBeatId: 'speech-beat3',
                      },
                      {
                        id: 'resist-urge',
                        text: 'Resist the urge to laugh or scream',
                        choiceType: 'strategic',
                        statCheck: {
                          attribute: 'resolve',
                          difficulty: 50,
                        },
                        consequences: [
                          { type: 'attribute', attribute: 'resolve', change: 3 },
                        ],
                        nextBeatId: 'speech-beat3',
                      },
                    ],
                  },
                  {
                    id: 'speech-beat3',
                    text: "The speech reaches its climax. The speaker calls for \"zero tolerance\" and \"maximum sentencing.\" The crowd applauds. Some stand.\n\nDr. Gonzo remains seated. His sunglasses hide his eyes, but you can feel his contempt radiating outward.",
                    choices: [
                      {
                        id: 'applaud-blend',
                        text: 'Applaud to blend in',
                        choiceType: 'strategic',
                        statCheck: {
                          skill: 'deception',
                          difficulty: 30,
                        },
                        nextBeatId: 'speech-beat4',
                      },
                      {
                        id: 'stay-seated',
                        text: 'Stay seated—some principles matter',
                        choiceType: 'dilemma',
                        consequences: [
                          { type: 'addTag', tag: 'principled' },
                          { type: 'changeScore', score: 'cover_intact', change: -5 },
                        ],
                        nextBeatId: 'speech-beat4',
                      },
                    ],
                  },
                  {
                    id: 'speech-beat4',
                    text: "The lights come up. Q&A time. This is either an opportunity or a minefield.",
                  },
                ],

                onSuccess: {
                  outcomeText: "The speech ends. You've survived without incident and gathered enough material for a scathing article about institutional delusion.",
                  consequences: [
                    { type: 'changeScore', score: 'article_quality', change: 10 },
                  ],
                },
                onFailure: {
                  outcomeText: "The speech ends, but you're rattled. The gap between what these people believe and reality is wider than you imagined. Dr. Gonzo is muttering about \"the death of reason.\"",
                  consequences: [
                    { type: 'attribute', attribute: 'resolve', change: -3 },
                  ],
                },
              },
            ],

            startingPhaseId: 'phase1-arrival',

            outcomes: {
              victory: {
                nextSceneId: 'scene3-3-reception',
                consequences: [
                  { type: 'skill', skill: 'journalism', change: 5 },
                ],
              },
              defeat: {
                nextSceneId: 'scene3-3-reception',
                consequences: [
                  { type: 'setFlag', flag: 'shaken_by_conference', value: true },
                ],
              },
            },
          },
        },

        {
          id: 'scene3-3-reception',
          name: 'The Reception',
          startingBeatId: 'reception-beat1',
          beats: [
            {
              id: 'reception-beat1',
              text: "The post-keynote reception features an open bar and a room full of prosecutors getting progressively looser. Dr. Gonzo sees opportunity.\n\n\"Time for some real journalism,\" he says, heading straight for the bar. \"Follow my lead.\"",
              speaker: 'Dr. Gonzo',
              nextBeatId: 'reception-beat2',
            },
            {
              id: 'reception-beat2',
              text: "Within an hour, Dr. Gonzo has convinced a district attorney from Oklahoma that he's an expert on \"chemical mind control.\" The man is taking notes.",
              textVariants: [
                {
                  condition: {
                    type: 'flag',
                    flag: 'being_watched',
                    value: true,
                  },
                  text: "You notice the grey-suited man from earlier watching from across the room. But Dr. Gonzo is already deep in conversation with a district attorney, spinning elaborate theories about \"reverse psychology in drug enforcement.\"",
                },
              ],
              choices: [
                {
                  id: 'join-gonzo',
                  text: 'Join Dr. Gonzo\'s performance',
                  choiceType: 'strategic',
                  statCheck: {
                    skill: 'deception',
                    difficulty: 50,
                  },
                  consequences: [
                    { type: 'skill', skill: 'deception', change: 5 },
                    { type: 'relationship', npcId: 'doc', dimension: 'trust', change: 10 },
                  ],
                  nextBeatId: 'reception-beat3-join',
                },
                {
                  id: 'observe-solo',
                  text: 'Work the room on your own',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'charm',
                    difficulty: 45,
                  },
                  consequences: [
                    { type: 'skill', skill: 'journalism', change: 5 },
                  ],
                  nextBeatId: 'reception-beat3-solo',
                },
                {
                  id: 'escape-early',
                  text: 'Make an excuse and escape before something goes wrong',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'resolve', change: -2 },
                    { type: 'setFlag', flag: 'escaped_reception', value: true },
                  ],
                  nextBeatId: 'reception-beat3-escape',
                },
              ],
            },
            {
              id: 'reception-beat3-join',
              text: "You insert yourself into the conversation, building on Dr. Gonzo's nonsense with your own improvised expertise. The attorneys eat it up.\n\nBy the end of the night, you've been invited to address a regional conference on \"innovative approaches to narcotics interdiction.\"\n\n\"We're in too deep,\" you realize. Dr. Gonzo just laughs.",
              speaker: 'Dr. Gonzo',
            },
            {
              id: 'reception-beat3-solo',
              text: "You work the room alone, asking careful questions, letting the prosecutors reveal themselves. The stories they tell—about plea deals, about asset seizures, about the people whose lives they've destroyed—paint a picture darker than any keynote.\n\nThis is the real story. The one they don't put in the pamphlets.",
            },
            {
              id: 'reception-beat3-escape',
              text: "You slip out early, leaving Dr. Gonzo to his games. Back in the hotel room, you try to make sense of what you've witnessed.\n\nThese are the people who decide fates. Who draw the lines between legal and illegal, between freedom and prison. And they're... ordinary. That's the terrifying part.",
            },
          ],
        },
      ],

      onComplete: [
        { type: 'skill', skill: 'deception', change: 5 },
        { type: 'skill', skill: 'journalism', change: 5 },
      ],
    },

    // ==========================================
    // EPISODE 4: THE AMERICAN DREAM
    // ==========================================
    {
      id: 'ep4-dream',
      number: 4,
      title: 'The American Dream',
      synopsis:
        'The search for meaning leads to a diner, a waitress, and the question that has haunted this entire journey: What happened to the American Dream?',
      coverImage: '',
      startingSceneId: 'scene4-1-search',

      scenes: [
        {
          id: 'scene4-1-search',
          name: 'The Search',
          startingBeatId: 'search-beat1',
          beats: [
            {
              id: 'search-beat1',
              text: "Three in the morning. The convention is over—or at least, you're done with it. Dr. Gonzo wants to find something.\n\n\"The American Dream,\" he says. \"Someone told me it's a place. An actual place. Somewhere in this city.\"",
              speaker: 'Dr. Gonzo',
              nextBeatId: 'search-beat2',
            },
            {
              id: 'search-beat2',
              text: "You're driving through the neon wasteland of late-night Vegas. Every casino promises fortune. Every billboard promises escape. None of them mention dreams.\n\n\"It's supposed to be a club or something,\" Dr. Gonzo insists. \"The American Dream. It's real.\"",
              speaker: 'Dr. Gonzo',
              choices: [
                {
                  id: 'indulge-search',
                  text: 'Indulge the search—it might make a good ending to the article',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'doc', dimension: 'affection', change: 10 },
                    { type: 'setFlag', flag: 'searching_dream', value: true },
                  ],
                  nextBeatId: 'search-beat3',
                },
                {
                  id: 'reality-check',
                  text: '"It\'s probably just a bar. Or doesn\'t exist at all."',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'wit',
                    difficulty: 35,
                  },
                  consequences: [
                    { type: 'relationship', npcId: 'doc', dimension: 'affection', change: -5 },
                  ],
                  nextBeatId: 'search-beat3-reality',
                },
              ],
            },
            {
              id: 'search-beat3',
              text: "The search takes you to the edge of the strip, past the tourist traps and into the real Vegas—pawn shops, bail bondsmen, twenty-four-hour diners clinging to existence.\n\nA neon sign flickers: NORTH STAR COFFEE LOUNGE - OPEN 24 HOURS.\n\n\"Here,\" Dr. Gonzo says. \"Someone in there will know.\"",
              nextSceneId: 'scene4-2-diner',
            },
            {
              id: 'search-beat3-reality',
              text: "\"You don't understand,\" Dr. Gonzo says. \"It has to exist. If it doesn't, what's the point of any of this?\"\n\nHis voice is different now. Serious. You realize this search means something to him—something beyond the usual chaos.\n\nA neon sign appears: NORTH STAR COFFEE LOUNGE. \"Let's try here,\" you suggest.",
              nextSceneId: 'scene4-2-diner',
            },
          ],
        },

        {
          id: 'scene4-2-diner',
          name: 'The Diner',
          startingBeatId: 'diner-beat1',
          beats: [],

          encounter: {
            id: 'diner-investigation',
            type: 'investigation',
            name: 'The North Star Coffee Lounge',
            description: 'Search for answers in a late-night diner at the edge of the American Dream.',

            phases: [
              {
                id: 'phase1-entering',
                name: 'Entering the Diner',
                description: 'Get a sense of the place and its inhabitants.',
                situationImage: '',
                successThreshold: 3,
                failureThreshold: -2,

                beats: [
                  {
                    id: 'enter-beat1',
                    text: "The North Star is a time capsule—chrome stools, formica counters, a jukebox playing something from a better decade. A few customers sit in isolated pools of light.\n\nThe waitress behind the counter eyes your approach. Her name tag reads ALICE.",
                    nextBeatId: 'enter-beat2',
                  },
                  {
                    id: 'enter-beat2',
                    text: "Alice looks like she's seen everything this city has to offer and decided none of it impressed her. She's maybe fifty, with sharp eyes and a tired smile.\n\n\"Coffee?\" she asks.",
                    speaker: 'Alice',
                    choices: [
                      {
                        id: 'yes-coffee',
                        text: '"Yes. And some answers, if you\'ve got them."',
                        choiceType: 'strategic',
                        statCheck: {
                          attribute: 'charm',
                          difficulty: 40,
                        },
                        consequences: [
                          { type: 'relationship', npcId: 'waitress', dimension: 'trust', change: 5 },
                        ],
                        nextBeatId: 'enter-beat3',
                      },
                      {
                        id: 'coffee-first',
                        text: '"Coffee first. Then we talk."',
                        choiceType: 'strategic',
                        consequences: [
                          { type: 'relationship', npcId: 'waitress', dimension: 'respect', change: 5 },
                        ],
                        nextBeatId: 'enter-beat3',
                      },
                    ],
                  },
                  {
                    id: 'enter-beat3',
                    text: "She pours two cups without being asked—she's already counted your companion as part of the order. Dr. Gonzo slides onto a stool like he owns the place.\n\n\"We're looking for something,\" he announces.",
                    speaker: 'Dr. Gonzo',
                  },
                ],

                onSuccess: {
                  nextPhaseId: 'phase2-conversation',
                  outcomeText: "Alice doesn't seem surprised by much. She leans against the counter, waiting.",
                  consequences: [
                    { type: 'relationship', npcId: 'waitress', dimension: 'trust', change: 5 },
                  ],
                },
                onFailure: {
                  nextPhaseId: 'phase2-conversation',
                  outcomeText: "Alice's expression doesn't change, but you sense you're being evaluated. She's not hostile—just cautious.",
                  consequences: [
                    { type: 'relationship', npcId: 'waitress', dimension: 'trust', change: -5 },
                  ],
                },
              },

              {
                id: 'phase2-conversation',
                name: 'The Question',
                description: 'Ask about the American Dream.',
                situationImage: '',
                successThreshold: 4,
                failureThreshold: -2,

                beats: [
                  {
                    id: 'conv-beat1',
                    text: "\"The American Dream,\" Dr. Gonzo says. \"We heard it's a place. Somewhere around here. Do you know it?\"\n\nAlice pauses, coffee pot in hand. Something flickers across her face—recognition? Memory?",
                    speaker: 'Dr. Gonzo',
                    nextBeatId: 'conv-beat2',
                  },
                  {
                    id: 'conv-beat2',
                    text: "\"Used to be,\" she says finally. \"It was a disco. Few blocks from here. Burned down years ago.\"\n\nDr. Gonzo stares at her. \"Burned down?\"\n\n\"Electrical fire. Nothing left but the foundation.\"",
                    speaker: 'Alice',
                    choices: [
                      {
                        id: 'ask-more',
                        text: '"What was it like? Before it burned?"',
                        choiceType: 'strategic',
                        statCheck: {
                          attribute: 'empathy',
                          difficulty: 40,
                        },
                        consequences: [
                          { type: 'relationship', npcId: 'waitress', dimension: 'affection', change: 10 },
                        ],
                        nextBeatId: 'conv-beat3-remember',
                      },
                      {
                        id: 'ask-meaning',
                        text: '"Why was it called that? The American Dream?"',
                        choiceType: 'strategic',
                        statCheck: {
                          skill: 'journalism',
                          difficulty: 35,
                        },
                        consequences: [
                          { type: 'skill', skill: 'journalism', change: 3 },
                        ],
                        nextBeatId: 'conv-beat3-meaning',
                      },
                      {
                        id: 'philosophical',
                        text: '"So the American Dream burned down. That feels... appropriate."',
                        choiceType: 'strategic',
                        statCheck: {
                          attribute: 'wit',
                          difficulty: 45,
                        },
                        consequences: [
                          { type: 'addTag', tag: 'cynic' },
                        ],
                        nextBeatId: 'conv-beat3-phil',
                      },
                    ],
                  },
                  {
                    id: 'conv-beat3-remember',
                    text: "Alice's eyes go distant. \"It was... something. In the seventies. All these beautiful people thinking they were going to change the world. Thought the party would never end.\"\n\nShe refills your coffee.\n\n\"The fire was in seventy-nine. Most people had already moved on by then. The dream died before the building did.\"",
                    speaker: 'Alice',
                    speakerMood: 'nostalgic',
                  },
                  {
                    id: 'conv-beat3-meaning',
                    text: "\"Some developer's idea of a joke, probably,\" Alice says. \"Or maybe they meant it. This city's full of people who came here thinking they'd strike it rich. Make it big. Live the dream.\"\n\nShe gestures at the nearly empty diner.\n\n\"Most of them end up here. Drinking coffee at four AM. Wondering where it all went wrong.\"",
                    speaker: 'Alice',
                  },
                  {
                    id: 'conv-beat3-phil',
                    text: "Alice almost smiles. \"You're not the first person to say that. Some reporter came through here years ago, said the same thing. Wrote a whole article about it.\"\n\n\"Did anyone read it?\"\n\n\"Does anyone ever read anything that matters?\"",
                    speaker: 'Alice',
                  },
                ],

                onSuccess: {
                  outcomeText: "Alice looks at you both with something like understanding. \"You're not really looking for a building, are you? You're looking for... something else.\"\n\nShe's right. And you still haven't found it.",
                  consequences: [
                    { type: 'relationship', npcId: 'waitress', dimension: 'trust', change: 15 },
                    { type: 'setFlag', flag: 'understood_by_alice', value: true },
                  ],
                },
                onFailure: {
                  outcomeText: "Alice shrugs. \"Sorry I can't help more. The place is gone. Whatever you're looking for, it's not in Vegas.\"\n\nMaybe it never was.",
                  consequences: [
                    { type: 'setFlag', flag: 'dream_not_found', value: true },
                  ],
                },
              },
            ],

            startingPhaseId: 'phase1-entering',

            outcomes: {
              victory: {
                nextSceneId: 'scene4-3-reflection',
                consequences: [
                  { type: 'skill', skill: 'journalism', change: 10 },
                  { type: 'addTag', tag: 'seeker' },
                ],
              },
              defeat: {
                nextSceneId: 'scene4-3-reflection',
                consequences: [
                  { type: 'attribute', attribute: 'resolve', change: -5 },
                ],
              },
            },
          },
        },

        {
          id: 'scene4-3-reflection',
          name: 'Reflection',
          startingBeatId: 'reflect-beat1',
          beats: [
            {
              id: 'reflect-beat1',
              text: "You leave the diner as the first light of dawn touches the desert. Dr. Gonzo is quiet—unusual for him.\n\n\"It burned down,\" he finally says. \"The American Dream burned down.\"",
              speaker: 'Dr. Gonzo',
              speakerMood: 'contemplative',
              nextBeatId: 'reflect-beat2',
            },
            {
              id: 'reflect-beat2',
              text: "The sun rises over Vegas, painting the casinos in shades of gold and pink. Beautiful, in a toxic sort of way.",
              choices: [
                {
                  id: 'comfort-gonzo',
                  text: '"Maybe the dream was never a place. Maybe it\'s what we make it."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'doc', dimension: 'affection', change: 15 },
                    { type: 'addTag', tag: 'optimist' },
                  ],
                  nextBeatId: 'reflect-beat3',
                },
                {
                  id: 'agree-death',
                  text: '"Maybe it\'s better this way. Dreams should die before they disappoint."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'doc', dimension: 'respect', change: 10 },
                    { type: 'addTag', tag: 'realist' },
                  ],
                  nextBeatId: 'reflect-beat3',
                },
                {
                  id: 'journalist-answer',
                  text: '"At least we have our answer. That\'s something to write about."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'skill', skill: 'journalism', change: 5 },
                  ],
                  nextBeatId: 'reflect-beat3',
                },
              ],
            },
            {
              id: 'reflect-beat3',
              text: "Dr. Gonzo nods slowly. \"We should get out of this city. While we still remember who we are.\"\n\nHe's right. Vegas has a way of dissolving identity, of making everything feel like a fever dream. It's time to go.\n\nBut first, there's the small matter of two trashed hotel rooms, several unpaid bills, and an editor expecting an article.",
              speaker: 'Dr. Gonzo',
            },
          ],
        },
      ],

      onComplete: [
        { type: 'attribute', attribute: 'empathy', change: 5 },
        { type: 'skill', skill: 'journalism', change: 5 },
      ],
    },

    // ==========================================
    // EPISODE 5: THE SPIRAL
    // ==========================================
    {
      id: 'ep5-spiral',
      number: 5,
      title: 'The Spiral',
      synopsis:
        'Everything is catching up. The bills. The lies. The consequences. The question is no longer whether you\'ll escape—it\'s how much you\'ll lose in the process.',
      coverImage: '',
      startingSceneId: 'scene5-1-morning',

      scenes: [
        {
          id: 'scene5-1-morning',
          name: 'Morning After',
          startingBeatId: 'morning5-beat1',
          beats: [
            {
              id: 'morning5-beat1',
              text: "The Flamingo room looks like a war zone. Furniture overturned. Bottles everywhere. A television somehow ended up in the bathroom.\n\nDr. Gonzo is packing—if you can call throwing things randomly into bags packing.\n\n\"We need to move fast,\" he says. \"I may have said some things last night that could be misinterpreted as... federal crimes.\"",
              speaker: 'Dr. Gonzo',
              speakerMood: 'urgent',
              nextBeatId: 'morning5-beat2',
            },
            {
              id: 'morning5-beat2',
              text: "The phone rings. You both stare at it.\n\n\"Don't answer that,\" Dr. Gonzo advises.",
              speaker: 'Dr. Gonzo',
              choices: [
                {
                  id: 'answer-phone',
                  text: 'Answer the phone',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'courage',
                    difficulty: 40,
                  },
                  consequences: [
                    { type: 'setFlag', flag: 'answered_phone', value: true },
                  ],
                  nextBeatId: 'morning5-beat3-answer',
                },
                {
                  id: 'ignore-phone',
                  text: 'Let it ring',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'setFlag', flag: 'ignored_phone', value: true },
                  ],
                  nextBeatId: 'morning5-beat3-ignore',
                },
              ],
            },
            {
              id: 'morning5-beat3-answer',
              text: "It's the front desk. Your credit card has been declined. The one the magazine provided. They want to speak to you in person.\n\n\"Immediately,\" the voice says. It's not a request.",
              nextBeatId: 'morning5-beat4',
            },
            {
              id: 'morning5-beat3-ignore',
              text: "The phone stops ringing. Then starts again. Then stops. A few minutes later, there's a knock at the door.\n\n\"Housekeeping!\" a voice calls. Neither of you believes that for a second.",
              nextBeatId: 'morning5-beat4',
            },
            {
              id: 'morning5-beat4',
              text: "Dr. Gonzo peeks through the curtains at the parking lot below. \"There's a man by our car. He looks official.\"\n\n\"Official how?\"\n\n\"Like he enjoys asking questions people don't want to answer.\"",
              speaker: 'Dr. Gonzo',
              choices: [
                {
                  id: 'face-music',
                  text: 'Face the situation head-on',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'courage', change: 5 },
                    { type: 'setFlag', flag: 'confronted_problems', value: true },
                  ],
                  nextSceneId: 'scene5-2-confrontation',
                },
                {
                  id: 'escape-plan',
                  text: 'Find another way out',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'resourcefulness',
                    difficulty: 45,
                  },
                  consequences: [
                    { type: 'skill', skill: 'survival', change: 5 },
                    { type: 'setFlag', flag: 'escaped_hotel', value: true },
                  ],
                  nextSceneId: 'scene5-2-escape',
                },
              ],
            },
          ],
        },

        {
          id: 'scene5-2-confrontation',
          name: 'Confrontation',
          startingBeatId: 'confront-beat1',
          conditions: {
            type: 'flag',
            flag: 'confronted_problems',
            value: true,
          },
          beats: [
            {
              id: 'confront-beat1',
              text: "The hotel manager's office is small and tense. He's not alone—a security officer stands by the door, and the man from the parking lot turns out to be a representative from the rental car company.\n\n\"Gentlemen,\" the manager begins, \"we have some... concerns.\"",
              nextBeatId: 'confront-beat2',
            },
            {
              id: 'confront-beat2',
              text: "The list is impressive: property damage, noise complaints, unpaid bar tabs, and—apparently—Dr. Gonzo's attempt to order a live tiger through room service.",
              textVariants: [
                {
                  condition: {
                    type: 'flag',
                    flag: 'security_alerted',
                    value: true,
                  },
                  text: "The list is longer than expected. They've been watching you since day one. Every complaint, every incident, meticulously documented.",
                },
              ],
              choices: [
                {
                  id: 'charm-way-out',
                  text: 'Try to charm your way out',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'charm',
                    difficulty: 55,
                  },
                  consequences: [
                    { type: 'skill', skill: 'deception', change: 3 },
                  ],
                  nextBeatId: 'confront-beat3-charm',
                },
                {
                  id: 'press-card',
                  text: 'Play the press credentials card',
                  choiceType: 'strategic',
                  statCheck: {
                    skill: 'journalism',
                    difficulty: 50,
                  },
                  consequences: [
                    { type: 'skill', skill: 'journalism', change: 3 },
                  ],
                  nextBeatId: 'confront-beat3-press',
                },
                {
                  id: 'accept-responsibility',
                  text: 'Accept responsibility and negotiate',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'empathy',
                    difficulty: 45,
                  },
                  consequences: [
                    { type: 'addTag', tag: 'responsible' },
                  ],
                  nextBeatId: 'confront-beat3-accept',
                },
              ],
            },
            {
              id: 'confront-beat3-charm',
              text: "You turn on every ounce of charm you possess. By the end, the manager is almost smiling. He agrees to let you settle the bill later—much later—in exchange for a promise to leave immediately.\n\n\"And never come back,\" he adds. Fair enough.",
            },
            {
              id: 'confront-beat3-press',
              text: "\"Do you really want this story?\" you ask. \"Journalist harassed by hotel staff while covering major convention? The readers love that kind of thing.\"\n\nThe manager pales. The security officer shifts uncomfortably. They let you go with a \"strongly worded\" warning.",
            },
            {
              id: 'confront-beat3-accept',
              text: "You apologize. Sincerely. You promise to cover the damages—eventually. You explain that the tiger was a misunderstanding.\n\nThe manager sighs. \"Just... leave. Please. Before anything else happens.\"",
            },
          ],
          fallbackSceneId: 'scene5-2-escape',
        },

        {
          id: 'scene5-2-escape',
          name: 'The Escape',
          startingBeatId: 'escape-beat1',
          conditions: {
            type: 'flag',
            flag: 'escaped_hotel',
            value: true,
          },
          beats: [
            {
              id: 'escape-beat1',
              text: "The service elevator. Dr. Gonzo's discovery from an earlier reconnaissance mission. It goes directly to the parking garage.\n\n\"Act like we belong here,\" he advises, pushing a laundry cart loaded with your bags—and an alarming number of hotel towels.",
              speaker: 'Dr. Gonzo',
              nextBeatId: 'escape-beat2',
            },
            {
              id: 'escape-beat2',
              text: "You make it to the car without incident. The official-looking man is still by the front entrance, oblivious.\n\nDr. Gonzo peels out of the garage like the building is on fire. It might be, for all you know.",
              choices: [
                {
                  id: 'relief',
                  text: 'Laugh with relief at the escape',
                  choiceType: 'expression',
                  consequences: [
                    { type: 'relationship', npcId: 'doc', dimension: 'affection', change: 5 },
                  ],
                  nextBeatId: 'escape-beat3',
                },
                {
                  id: 'concern',
                  text: 'Wonder if this will catch up to you',
                  choiceType: 'expression',
                  consequences: [
                    { type: 'attribute', attribute: 'wit', change: 2 },
                  ],
                  nextBeatId: 'escape-beat3',
                },
              ],
            },
            {
              id: 'escape-beat3',
              text: "Vegas shrinks in the rearview mirror. The desert opens up ahead. You've escaped—for now.\n\nBut something has changed. The city took something from you. Or maybe it showed you something you didn't want to see.",
            },
          ],
          fallbackSceneId: 'scene5-3-road',
        },

        {
          id: 'scene5-3-road',
          name: 'The Road Home',
          startingBeatId: 'road-beat1',
          beats: [
            {
              id: 'road-beat1',
              text: "The highway stretches westward toward Los Angeles. The same desert that felt full of possibility on the way here now feels empty. Used up.\n\nDr. Gonzo is driving too fast, as always.",
              nextBeatId: 'road-beat2',
            },
            {
              id: 'road-beat2',
              text: "\"Was it worth it?\" you ask. The race, the convention, the search for the American Dream. All of it.\n\nDr. Gonzo considers the question seriously—maybe for the first time this whole trip.\n\n\"Worth is a strange concept. Did we find what we were looking for? No. But we found something.\"",
              speaker: 'Dr. Gonzo',
              speakerMood: 'philosophical',
              choices: [
                {
                  id: 'ask-what',
                  text: '"What did we find?"',
                  choiceType: 'strategic',
                  nextBeatId: 'road-beat3-what',
                },
                {
                  id: 'agree-something',
                  text: '"Something. That\'s more than most people get."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'doc', dimension: 'affection', change: 10 },
                  ],
                  nextBeatId: 'road-beat3-agree',
                },
                {
                  id: 'focus-article',
                  text: '"I found an article, at least."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'skill', skill: 'journalism', change: 2 },
                  ],
                  nextBeatId: 'road-beat3-article',
                },
              ],
            },
            {
              id: 'road-beat3-what',
              text: "\"The edge,\" Dr. Gonzo says. \"The place where the myth meets the reality. Vegas is that edge. The American Dream wasn't a disco—it was what the disco represented. And it did burn down. Not in seventy-nine. In sixty-eight. In seventy-two. Every time we got close to something real, we watched it burn.\"\n\nThe desert slides past in silence.",
              speaker: 'Dr. Gonzo',
              speakerMood: 'profound',
            },
            {
              id: 'road-beat3-agree',
              text: "Dr. Gonzo nods. \"The search matters. Even when the thing you're searching for doesn't exist. Maybe especially then.\"\n\nYou think about the waitress at the North Star. About the prosecutors who believe they're saving the world. About all the people who came to Vegas looking for something and found something else instead.",
              speaker: 'Dr. Gonzo',
            },
            {
              id: 'road-beat3-article',
              text: "\"An article,\" Dr. Gonzo repeats. \"About what? The race? That's not what this was about, and you know it.\"\n\nHe's right. The race was just the excuse. The real story is something harder to define—and much harder to sell to an editor.",
              speaker: 'Dr. Gonzo',
            },
          ],
        },
      ],

      onComplete: [
        { type: 'skill', skill: 'survival', change: 5 },
        { type: 'attribute', attribute: 'resolve', change: 5 },
      ],
    },

    // ==========================================
    // EPISODE 6: THE DEPARTURE
    // ==========================================
    {
      id: 'ep6-departure',
      number: 6,
      title: 'The Departure',
      synopsis:
        'Los Angeles waits ahead. The article must be written. But first, there\'s one more thing to understand about this whole savage journey.',
      coverImage: '',
      startingSceneId: 'scene6-1-border',

      scenes: [
        {
          id: 'scene6-1-border',
          name: 'California Border',
          startingBeatId: 'border-beat1',
          beats: [
            {
              id: 'border-beat1',
              text: "The \"Welcome to California\" sign appears like a mirage. You've made it out of Nevada. Behind you, Vegas shimmers on the horizon—already unreal, already a memory.\n\nDr. Gonzo pulls over at a rest stop just past the border.",
              nextBeatId: 'border-beat2',
            },
            {
              id: 'border-beat2',
              text: "\"This is where I leave you,\" he says. \"I've got business in LA. Different kind of business.\"\n\nHe doesn't elaborate. With Dr. Gonzo, you've learned not to ask.",
              speaker: 'Dr. Gonzo',
              choices: [
                {
                  id: 'thank-gonzo',
                  text: '"Thanks for... whatever this was."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'doc', dimension: 'affection', change: 10 },
                  ],
                  nextBeatId: 'border-beat3-thanks',
                },
                {
                  id: 'warn-gonzo',
                  text: '"Try not to get arrested before I finish the article."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'doc', dimension: 'trust', change: 5 },
                  ],
                  nextBeatId: 'border-beat3-warn',
                },
                {
                  id: 'ask-again',
                  text: '"Will we do this again sometime?"',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'doc', dimension: 'affection', change: 15 },
                    { type: 'setFlag', flag: 'wants_more_adventures', value: true },
                  ],
                  nextBeatId: 'border-beat3-again',
                },
              ],
            },
            {
              id: 'border-beat3-thanks',
              text: "\"Don't thank me,\" Dr. Gonzo says. \"I was there for my own reasons. You just happened to be pointing in the right direction.\"\n\nHe grabs his bags from the trunk. \"Write something true. That's all that matters.\"",
              speaker: 'Dr. Gonzo',
            },
            {
              id: 'border-beat3-warn',
              text: "Dr. Gonzo laughs. \"No promises. But I'll try to keep the damage local.\"\n\nHe grabs his bags. \"Make the article count. We didn't go through all that for nothing.\"",
              speaker: 'Dr. Gonzo',
            },
            {
              id: 'border-beat3-again',
              text: "Dr. Gonzo pauses. For a moment, his usual manic energy fades, replaced by something almost gentle.\n\n\"Probably. There's always another edge to find. Another dream to chase down.\"\n\nHe grabs his bags. \"Call me when you're ready to get weird again.\"",
              speaker: 'Dr. Gonzo',
              speakerMood: 'sincere',
            },
          ],
        },

        {
          id: 'scene6-2-alone',
          name: 'Alone',
          startingBeatId: 'alone-beat1',
          beats: [
            {
              id: 'alone-beat1',
              text: "You watch Dr. Gonzo walk toward a waiting taxi—where it came from, you have no idea. Classic Gonzo. Then you're alone with the car, the desert, and your thoughts.",
              nextBeatId: 'alone-beat2',
            },
            {
              id: 'alone-beat2',
              text: "You pull out your notebook. Pages and pages of observations, quotes, fragments of conversation. Somewhere in here is an article. Maybe even something more.\n\nThe question is: what's the story?",
              choices: [
                {
                  id: 'story-race',
                  text: 'The story is the race—exciting, dangerous, quintessentially American',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'changeScore', score: 'article_angle', change: 1 },
                    { type: 'setFlag', flag: 'chose_race_angle', value: true },
                  ],
                  nextBeatId: 'alone-beat3',
                },
                {
                  id: 'story-dream',
                  text: 'The story is the search for the American Dream—and not finding it',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'changeScore', score: 'article_angle', change: 2 },
                    { type: 'setFlag', flag: 'chose_dream_angle', value: true },
                  ],
                  nextBeatId: 'alone-beat3',
                },
                {
                  id: 'story-both',
                  text: 'The story is both—the race as a metaphor for chasing something you can never catch',
                  choiceType: 'strategic',
                  statCheck: {
                    skill: 'journalism',
                    difficulty: 50,
                  },
                  consequences: [
                    { type: 'changeScore', score: 'article_angle', change: 3 },
                    { type: 'setFlag', flag: 'chose_both_angle', value: true },
                    { type: 'skill', skill: 'journalism', change: 10 },
                  ],
                  nextBeatId: 'alone-beat3',
                },
                {
                  id: 'story-gonzo',
                  text: 'The story is the experience itself—pure, unfiltered, gonzo',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'changeScore', score: 'article_angle', change: 4 },
                    { type: 'setFlag', flag: 'chose_gonzo_angle', value: true },
                    { type: 'addTag', tag: 'gonzo_journalist' },
                  ],
                  nextBeatId: 'alone-beat3',
                },
              ],
            },
            {
              id: 'alone-beat3',
              text: "The sun is setting over the California desert. Los Angeles waits ahead—your editor, your deadline, your life.\n\nBut for now, you sit in a rest stop parking lot, watching the sky turn colors that shouldn't exist, thinking about everything you've seen.\n\nVegas is behind you. But it'll never really leave.",
              nextSceneId: 'scene6-3-epilogue',
            },
          ],
        },

        {
          id: 'scene6-3-epilogue',
          name: 'Epilogue',
          startingBeatId: 'epilogue-beat1',
          beats: [
            {
              id: 'epilogue-beat1',
              text: "You make it back to Los Angeles as the city lights flicker to life. The familiar smog, the familiar traffic, the familiar sense of being exactly where you don't want to be.\n\nThe article has to be written. The rent has to be paid. Life has to go on.",
              textVariants: [
                {
                  condition: {
                    type: 'tag',
                    tag: 'gonzo_journalist',
                    hasTag: true,
                  },
                  text: "You make it back to Los Angeles with something new burning in your chest. The article won't be what they expect. It'll be better. It'll be true.\n\nGonzo journalism. That's what this is. Not objective. Not balanced. But honest in a way that objectivity never allows.",
                },
              ],
              nextBeatId: 'epilogue-beat2',
            },
            {
              id: 'epilogue-beat2',
              text: "You sit at your typewriter. The blank page waits.",
              textVariants: [
                {
                  condition: {
                    type: 'flag',
                    flag: 'chose_race_angle',
                    value: true,
                  },
                  text: "You sit at your typewriter. The blank page waits. You begin:\n\n\"The Mint 400 is not a race. It is a ritual—a yearly sacrifice of metal and flesh to the gods of American excess...\"",
                },
                {
                  condition: {
                    type: 'flag',
                    flag: 'chose_dream_angle',
                    value: true,
                  },
                  text: "You sit at your typewriter. The blank page waits. You begin:\n\n\"The American Dream used to be a disco in Las Vegas. It burned down in 1979. But it was already dead long before that...\"",
                },
                {
                  condition: {
                    type: 'flag',
                    flag: 'chose_both_angle',
                    value: true,
                  },
                  text: "You sit at your typewriter. The blank page waits. You begin:\n\n\"We were somewhere around Barstow on the edge of the desert when the assignment began to take hold...\"",
                },
                {
                  condition: {
                    type: 'flag',
                    flag: 'chose_gonzo_angle',
                    value: true,
                  },
                  text: "You sit at your typewriter. The blank page waits. You begin:\n\n\"This is a story about the death of the American Dream. It's also a story about motorcycles, madness, and the savage journey to the heart of the beast...\"",
                },
              ],
              nextBeatId: 'epilogue-beat3',
            },
            {
              id: 'epilogue-beat3',
              text: "The words start to flow. Hours pass. The article takes shape—not the article your editor expected, but the article Vegas demanded.\n\nSomewhere in the night, the phone rings. You don't answer. There will be time for consequences later.\n\nRight now, there's only the story.",
              nextBeatId: 'epilogue-beat-final',
            },
            {
              id: 'epilogue-beat-final',
              text: "Dawn breaks over Los Angeles. The article is finished—or at least, the first draft. It's raw. Unfiltered. Possibly unpublishable.\n\nBut it's true. As true as anything can be when it comes to a place like Vegas, a search like yours, a dream that burned down before anyone could reach it.\n\nYou lean back in your chair and close your eyes. The savage nights in paradise are over.\n\nBut the words remain. And that, in the end, is all a writer can hope for.",
            },
          ],
        },
      ],

      onComplete: [
        { type: 'skill', skill: 'journalism', change: 15 },
        { type: 'addTag', tag: 'survived_vegas' },
      ],
    },
  ],
};
