import { Story } from '../../types';

/**
 * The Velvet Job
 * A modern heist story demonstrating the NON-COMBAT encounter system.
 * Features a multi-phase museum heist with stealth, social engineering, and puzzle elements.
 */

export const theVelvetJob: Story = {
  id: 'the-velvet-job',
  title: 'The Velvet Job',
  genre: 'Heist Thriller',
  synopsis:
    'The Celestine Diamond sits in the Hartwell Museum, protected by state-of-the-art security. Your crew has one night to pull off the impossible heist—and walk away legends.',
  coverImage: '',
  author: 'StoryRPG',
  tags: ['heist', 'thriller', 'modern', 'crime'],

  initialState: {
    attributes: {
      charm: 60,
      wit: 65,
      courage: 50,
      empathy: 45,
      resolve: 55,
      resourcefulness: 70,
    },
    skills: {
      lockpicking: 15,
      hacking: 10,
      disguise: 20,
      stealth: 15,
    },
    tags: ['thief', 'crew_leader'],
    inventory: [
      {
        itemId: 'earpiece',
        name: 'Encrypted Earpiece',
        description: 'Stay in contact with your crew.',
        quantity: 1,
      },
      {
        itemId: 'lockpicks',
        name: 'Professional Lockpick Set',
        description: 'For when doors need convincing.',
        quantity: 1,
      },
    ],
  },

  npcs: [
    {
      id: 'jules',
      name: 'Jules Chen',
      description:
        'Your tech specialist. Can hack anything with a processor and has a dry sense of humor.',
      initialRelationship: {
        trust: 60,
        affection: 40,
        respect: 50,
        fear: 0,
      },
    },
    {
      id: 'marcus',
      name: 'Marcus Webb',
      description:
        'The muscle. Former military, now handles security and extraction.',
      initialRelationship: {
        trust: 50,
        affection: 30,
        respect: 40,
        fear: 0,
      },
    },
    {
      id: 'victoria',
      name: 'Victoria Ashworth',
      description:
        'Your inside contact. A museum curator with expensive tastes and expensive debts.',
      initialRelationship: {
        trust: 20,
        affection: 10,
        respect: 30,
        fear: 10,
      },
    },
    {
      id: 'detective-shaw',
      name: 'Detective Rachel Shaw',
      description:
        'Major Crimes Unit. Smart, relentless, and uncomfortably close to the truth.',
      initialRelationship: {
        trust: 0,
        affection: 0,
        respect: 40,
        fear: 30,
      },
    },
    {
      id: 'mr-solomon',
      name: 'Mr. Solomon',
      description:
        'The most connected fence in the city. Old school, dangerous, and never forgets a debt.',
      initialRelationship: {
        trust: 10,
        affection: 0,
        respect: 50,
        fear: 40,
      },
    },
    {
      id: 'raven',
      name: 'Raven',
      description:
        'A rival thief with a grudge. You stole her score once. She hasn\'t forgotten.',
      initialRelationship: {
        trust: -20,
        affection: 0,
        respect: 30,
        fear: 10,
      },
    },
  ],

  episodes: [
    {
      id: 'ep1-the-heist',
      number: 1,
      title: 'The Heist',
      synopsis:
        'The night of the job has arrived. Infiltrate the museum, bypass security, and steal the Celestine Diamond.',
      coverImage: '',
      startingSceneId: 'scene1-briefing',

      scenes: [
        // Scene 1: Final Briefing
        {
          id: 'scene1-briefing',
          name: 'Final Briefing',
          startingBeatId: 'brief-beat1',
          beats: [
            {
              id: 'brief-beat1',
              text: "The van is parked three blocks from the Hartwell Museum. Rain streaks the windows as you go over the plan one last time with your crew.\n\n\"Security shift change is in twenty minutes,\" Jules says, tapping away at a laptop. \"That's our window.\"",
              speaker: 'Jules',
              nextBeatId: 'brief-beat2',
            },
            {
              id: 'brief-beat2',
              text: "Marcus checks his equipment. \"Victoria confirmed the service entrance code. Once you're in, you've got twelve minutes before the motion sensors reset.\"\n\n\"Twelve minutes,\" you repeat. \"To cross three galleries, bypass the laser grid, and crack a vault that's never been opened by anyone but the museum director.\"",
              nextBeatId: 'brief-beat3',
            },
            {
              id: 'brief-beat3',
              text: '"No pressure," Jules says with a grin.\n\nYou take a breath. The Celestine Diamond. Forty million dollars of perfectly cut carbon. After tonight, you\'ll never have to work again.',
              choices: [
                {
                  id: 'confident',
                  text: '"We\'ve planned this for six months. We\'re ready."',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'resolve',
                    difficulty: 35,
                  },
                  consequences: [
                    { type: 'relationship', npcId: 'jules', dimension: 'trust', change: 5 },
                    { type: 'relationship', npcId: 'marcus', dimension: 'respect', change: 5 },
                  ],
                  nextBeatId: 'brief-beat4',
                },
                {
                  id: 'review-plan',
                  text: '"Run me through the security one more time."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'skill', skill: 'stealth', change: 3 },
                    { type: 'setFlag', flag: 'reviewed_security', value: true },
                  ],
                  nextBeatId: 'brief-beat4-review',
                },
                {
                  id: 'trust-gut',
                  text: '"Something feels off. Stay sharp."',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'wit',
                    difficulty: 40,
                  },
                  consequences: [
                    { type: 'setFlag', flag: 'heightened_awareness', value: true },
                  ],
                  nextBeatId: 'brief-beat4',
                },
              ],
            },
            {
              id: 'brief-beat4-review',
              text: "Jules pulls up the blueprints. \"Three layers. Outer perimeter is guards and cameras—I'll loop the feeds. Inner perimeter is motion sensors and pressure plates. The vault itself has biometric locks and a time-delay mechanism.\"\n\nShe looks at you. \"The biometrics are the tricky part. You'll need Victoria's access card and her fingerprint.\"",
              speaker: 'Jules',
              nextBeatId: 'brief-beat4',
            },
            {
              id: 'brief-beat4',
              text: '"It\'s time," Marcus says, handing you a small bag. Inside: a guard uniform, a cloned access card, and a tiny vial.\n\n"The fingerprint gel," Jules explains. "It\'ll work once. Make it count."\n\nYou step out into the rain. The museum looms ahead, its marble facade gleaming under the streetlights. Let the heist begin.',
              onShow: [
                {
                  type: 'addItem',
                  item: {
                    itemId: 'guard-uniform',
                    name: 'Guard Uniform',
                    description: 'A perfect replica of Hartwell security uniforms.',
                  },
                  quantity: 1,
                },
                {
                  type: 'addItem',
                  item: {
                    itemId: 'fingerprint-gel',
                    name: 'Fingerprint Gel',
                    description: "A replica of Victoria's fingerprint. One use only.",
                  },
                  quantity: 1,
                },
              ],
              nextSceneId: 'scene2-the-heist',
            },
          ],
        },

        // Scene 2: The Heist Encounter
        {
          id: 'scene2-the-heist',
          name: 'Inside the Museum',
          startingBeatId: 'heist-start',
          beats: [],

          encounter: {
            id: 'museum-heist',
            type: 'heist',
            name: 'The Hartwell Museum Job',
            description: 'Infiltrate, bypass, extract. Simple in theory.',

            phases: [
              // Phase 1: Infiltration
              {
                id: 'phase1-infiltration',
                name: 'Infiltration',
                description:
                  'Get inside the museum without raising any alarms.',
                situationImage: '',
                successThreshold: 4,
                failureThreshold: -2,

                beats: [
                  {
                    id: 'inf-beat1',
                    text: "You approach the service entrance in your guard uniform. Two actual guards are smoking near the door, their backs to you.\n\n\"Camera loop is active,\" Jules whispers in your ear. \"You're invisible to the system. But those guards are very real.\"",
                    nextBeatId: 'inf-beat2',
                  },
                  {
                    id: 'inf-beat2',
                    text: 'You need to get past them to reach the door.',
                    choices: [
                      {
                        id: 'inf-bluff',
                        text: 'Walk up confidently like you belong there',
                        choiceType: 'strategic',
                        statCheck: {
                          attribute: 'charm',
                          difficulty: 45,
                        },
                        consequences: [
                          { type: 'skill', skill: 'disguise', change: 2 },
                        ],
                        nextBeatId: 'inf-beat3',
                      },
                      {
                        id: 'inf-distract',
                        text: 'Have Jules create a distraction',
                        choiceType: 'strategic',
                        statCheck: {
                          attribute: 'wit',
                          difficulty: 40,
                        },
                        nextBeatId: 'inf-beat3',
                      },
                      {
                        id: 'inf-wait',
                        text: 'Wait for them to finish and leave',
                        choiceType: 'strategic',
                        statCheck: {
                          attribute: 'resolve',
                          difficulty: 35,
                        },
                        consequences: [
                          { type: 'changeScore', score: 'time_pressure', change: 1 },
                        ],
                        nextBeatId: 'inf-beat3',
                      },
                    ],
                  },
                  {
                    id: 'inf-beat3',
                    text: "You're through the door. The service corridor stretches ahead, fluorescent lights humming overhead.",
                    nextBeatId: 'inf-beat4',
                  },
                  {
                    id: 'inf-beat4',
                    text: "\"First checkpoint coming up,\" Jules warns. \"Card reader on the left. If the card doesn't work, the whole building goes into lockdown.\"",
                    choices: [
                      {
                        id: 'inf-card',
                        text: 'Use the cloned access card',
                        choiceType: 'strategic',
                        statCheck: {
                          skill: 'hacking',
                          difficulty: 40,
                        },
                        nextBeatId: 'inf-beat5',
                      },
                      {
                        id: 'inf-picks',
                        text: 'Bypass the reader with your lockpicks',
                        choiceType: 'strategic',
                        statCheck: {
                          skill: 'lockpicking',
                          difficulty: 50,
                        },
                        consequences: [
                          { type: 'skill', skill: 'lockpicking', change: 3 },
                        ],
                        nextBeatId: 'inf-beat5',
                      },
                    ],
                  },
                  {
                    id: 'inf-beat5',
                    text: 'The door clicks open. You\'re in.',
                  },
                ],

                onSuccess: {
                  nextPhaseId: 'phase2-galleries',
                  outcomeText:
                    "Clean entry. No alarms, no witnesses. \"You're doing great,\" Jules says. \"Gallery approach next.\"",
                  consequences: [
                    { type: 'relationship', npcId: 'jules', dimension: 'trust', change: 5 },
                  ],
                },
                onFailure: {
                  nextPhaseId: 'phase2-galleries',
                  outcomeText:
                    "You made it in, but not cleanly. A guard saw you—played it off, but now they're paying attention. \"Be extra careful,\" Jules warns.",
                  consequences: [
                    { type: 'setFlag', flag: 'guard_suspicious', value: true },
                    { type: 'changeScore', score: 'heat', change: 2 },
                  ],
                },
              },

              // Phase 2: The Galleries
              {
                id: 'phase2-galleries',
                name: 'The Galleries',
                description:
                  'Navigate through the museum galleries to reach the diamond vault.',
                situationImage: '',
                successThreshold: 5,
                failureThreshold: -3,

                beats: [
                  {
                    id: 'gal-beat1',
                    text: "The Egyptian Gallery stretches before you, ancient artifacts casting long shadows in the dim security lighting. Motion sensors blink red in the corners.\n\n\"I can't disable those remotely,\" Jules says. \"You'll have to move carefully.\"",
                    textVariants: [
                      {
                        condition: {
                          type: 'flag',
                          flag: 'reviewed_security',
                          value: true,
                        },
                        text: "The Egyptian Gallery stretches before you. Thanks to the security review, you know exactly where the motion sensor blind spots are.\n\n\"Ready when you are,\" Jules says.",
                      },
                    ],
                    nextBeatId: 'gal-beat2',
                  },
                  {
                    id: 'gal-beat2',
                    text: 'The motion sensors have a predictable sweep pattern.',
                    choices: [
                      {
                        id: 'gal-stealth',
                        text: 'Move slowly, timing your steps to the sensor sweeps',
                        choiceType: 'strategic',
                        statCheck: {
                          skill: 'stealth',
                          difficulty: 45,
                        },
                        consequences: [
                          { type: 'skill', skill: 'stealth', change: 3 },
                        ],
                        nextBeatId: 'gal-beat3',
                      },
                      {
                        id: 'gal-blind-spots',
                        text: 'Use your knowledge of the blind spots',
                        choiceType: 'strategic',
                        conditions: {
                          type: 'flag',
                          flag: 'reviewed_security',
                          value: true,
                        },
                        statCheck: {
                          attribute: 'wit',
                          difficulty: 30,
                        },
                        nextBeatId: 'gal-beat3',
                      },
                      {
                        id: 'gal-fast',
                        text: 'Move quickly between cover points',
                        choiceType: 'strategic',
                        statCheck: {
                          attribute: 'courage',
                          difficulty: 55,
                        },
                        nextBeatId: 'gal-beat3',
                      },
                    ],
                  },
                  {
                    id: 'gal-beat3',
                    text: "You're halfway through when you hear footsteps. A guard patrol—not in the schedule.\n\n\"Unscheduled sweep,\" Jules hisses. \"Find cover!\"",
                    textVariants: [
                      {
                        condition: {
                          type: 'flag',
                          flag: 'heightened_awareness',
                          value: true,
                        },
                        text: "Your instincts were right—an unscheduled patrol. But you anticipated this. You spotted the alcove before the footsteps even registered.\n\n\"Guard incoming,\" Jules warns. But you're already moving.",
                      },
                    ],
                    choices: [
                      {
                        id: 'gal-hide-sarcophagus',
                        text: 'Duck behind the sarcophagus display',
                        choiceType: 'strategic',
                        statCheck: {
                          skill: 'stealth',
                          difficulty: 40,
                        },
                        nextBeatId: 'gal-beat4',
                      },
                      {
                        id: 'gal-hide-alcove',
                        text: 'Slip into the maintenance alcove',
                        choiceType: 'strategic',
                        conditions: {
                          type: 'flag',
                          flag: 'heightened_awareness',
                          value: true,
                        },
                        statCheck: {
                          attribute: 'wit',
                          difficulty: 25,
                        },
                        nextBeatId: 'gal-beat4',
                      },
                      {
                        id: 'gal-bluff-guard',
                        text: 'Stay in character—you\'re a guard, remember?',
                        choiceType: 'strategic',
                        statCheck: {
                          attribute: 'charm',
                          difficulty: 50,
                        },
                        consequences: [
                          { type: 'skill', skill: 'disguise', change: 5 },
                        ],
                        nextBeatId: 'gal-beat4',
                      },
                    ],
                  },
                  {
                    id: 'gal-beat4',
                    text: 'The guard passes. You wait until his footsteps fade, then continue to the Renaissance Gallery.',
                    nextBeatId: 'gal-beat5',
                  },
                  {
                    id: 'gal-beat5',
                    text: "The laser grid protecting the vault entrance is ahead. Red beams crisscross the corridor like a deadly web.\n\n\"The good news: I can disable it for exactly eight seconds,\" Jules says. \"The bad news: the gap is forty feet.\"",
                    choices: [
                      {
                        id: 'gal-sprint',
                        text: 'Sprint through when the lasers drop',
                        choiceType: 'strategic',
                        statCheck: {
                          attribute: 'courage',
                          difficulty: 50,
                        },
                        nextBeatId: 'gal-beat6',
                      },
                      {
                        id: 'gal-calculate',
                        text: 'Calculate the optimal path first',
                        choiceType: 'strategic',
                        statCheck: {
                          attribute: 'wit',
                          difficulty: 45,
                        },
                        consequences: [
                          { type: 'skill', skill: 'stealth', change: 2 },
                        ],
                        nextBeatId: 'gal-beat6',
                      },
                    ],
                  },
                  {
                    id: 'gal-beat6',
                    text: '"Ready... NOW!"',
                    speaker: 'Jules',
                  },
                ],

                onSuccess: {
                  nextPhaseId: 'phase3-vault',
                  outcomeText:
                    "You slide through just as the lasers reactivate behind you. \"That was beautiful,\" Jules breathes. \"Vault's right ahead.\"",
                  consequences: [
                    { type: 'relationship', npcId: 'jules', dimension: 'respect', change: 10 },
                  ],
                },
                onFailure: {
                  nextPhaseId: 'phase3-vault',
                  outcomeText:
                    "You made it through, but your sleeve caught a beam. An alarm chirps somewhere. \"Move fast,\" Jules urges. \"They're checking it out.\"",
                  consequences: [
                    { type: 'changeScore', score: 'heat', change: 3 },
                    { type: 'setFlag', flag: 'alarm_triggered', value: true },
                  ],
                },
              },

              // Phase 3: The Vault
              {
                id: 'phase3-vault',
                name: 'The Vault',
                description:
                  "Crack the vault and claim the diamond. You're running out of time.",
                situationImage: '',
                successThreshold: 4,
                failureThreshold: -2,

                beats: [
                  {
                    id: 'vault-beat1',
                    text: "The vault door is a masterpiece of engineering—three feet of titanium-reinforced steel, biometric locks, and a time-delay mechanism.\n\n\"This is it,\" Jules says. \"Use Victoria's fingerprint on the scanner. I'll handle the time-lock.\"",
                    textVariants: [
                      {
                        condition: {
                          type: 'flag',
                          flag: 'alarm_triggered',
                          value: true,
                        },
                        text: "The vault door looms before you. Somewhere behind, you can hear security mobilizing.\n\n\"Work fast,\" Jules says. \"We've got maybe three minutes before they're on top of you.\"",
                      },
                    ],
                    nextBeatId: 'vault-beat2',
                  },
                  {
                    id: 'vault-beat2',
                    text: 'You press the fingerprint gel to the scanner.',
                    choices: [
                      {
                        id: 'vault-steady',
                        text: 'Keep your hand perfectly steady',
                        choiceType: 'strategic',
                        statCheck: {
                          attribute: 'resolve',
                          difficulty: 45,
                        },
                        nextBeatId: 'vault-beat3',
                      },
                      {
                        id: 'vault-trust-tech',
                        text: 'Trust the tech—Jules knows what she\'s doing',
                        choiceType: 'strategic',
                        statCheck: {
                          skill: 'hacking',
                          difficulty: 40,
                        },
                        consequences: [
                          { type: 'relationship', npcId: 'jules', dimension: 'trust', change: 5 },
                        ],
                        nextBeatId: 'vault-beat3',
                      },
                    ],
                  },
                  {
                    id: 'vault-beat3',
                    text: "The scanner beeps green. The vault door begins to open with a low hum.\n\nAnd there it is. The Celestine Diamond, sitting on a velvet pedestal under a glass case. Even in the dim light, it seems to glow from within.",
                    nextBeatId: 'vault-beat4',
                  },
                  {
                    id: 'vault-beat4',
                    text: '"The case has a pressure sensor," Jules warns. "You need to replace the diamond\'s weight with something identical. Classic move."',
                    choices: [
                      {
                        id: 'vault-swap',
                        text: 'Make the swap with practiced precision',
                        choiceType: 'strategic',
                        statCheck: {
                          skill: 'lockpicking',
                          difficulty: 50,
                        },
                        consequences: [
                          { type: 'skill', skill: 'lockpicking', change: 5 },
                        ],
                        nextBeatId: 'vault-beat5',
                      },
                      {
                        id: 'vault-clever',
                        text: 'Use a clever technique to fool the sensor',
                        choiceType: 'strategic',
                        statCheck: {
                          attribute: 'resourcefulness',
                          difficulty: 45,
                        },
                        nextBeatId: 'vault-beat5',
                      },
                    ],
                  },
                  {
                    id: 'vault-beat5',
                    text: 'Your fingers close around the diamond. Forty million dollars in the palm of your hand.',
                  },
                ],

                onSuccess: {
                  outcomeText:
                    "Clean extraction. The diamond is yours, and no one knows it's gone yet.\n\n\"Get out of there,\" Jules says, and you can hear the smile in her voice. \"Drinks are on you tonight.\"",
                  consequences: [
                    { type: 'setFlag', flag: 'heist_clean', value: true },
                    {
                      type: 'addItem',
                      item: {
                        itemId: 'celestine-diamond',
                        name: 'Celestine Diamond',
                        description: 'Forty million dollars of perfectly cut carbon.',
                      },
                      quantity: 1,
                    },
                  ],
                },
                onFailure: {
                  outcomeText:
                    "You have the diamond, but alarms are blaring throughout the building.\n\n\"RUN!\" Jules shouts. \"Marcus is bringing the van around—GO!\"",
                  consequences: [
                    { type: 'setFlag', flag: 'heist_messy', value: true },
                    {
                      type: 'addItem',
                      item: {
                        itemId: 'celestine-diamond',
                        name: 'Celestine Diamond',
                        description: 'Forty million dollars of perfectly cut carbon.',
                      },
                      quantity: 1,
                    },
                  ],
                },
              },
            ],

            startingPhaseId: 'phase1-infiltration',

            outcomes: {
              victory: {
                nextSceneId: 'scene3-getaway',
                consequences: [
                  { type: 'relationship', npcId: 'jules', dimension: 'trust', change: 20 },
                  { type: 'relationship', npcId: 'marcus', dimension: 'respect', change: 20 },
                ],
              },
              defeat: {
                nextSceneId: 'scene3-getaway-messy',
                consequences: [
                  { type: 'changeScore', score: 'notoriety', change: 5 },
                ],
              },
            },
          },
        },

        // Scene 3a: Clean Getaway
        {
          id: 'scene3-getaway',
          name: 'The Getaway',
          startingBeatId: 'getaway-beat1',
          conditions: {
            type: 'flag',
            flag: 'heist_clean',
            value: true,
          },
          beats: [
            {
              id: 'getaway-beat1',
              text: "The van pulls away from the museum at exactly the speed limit. Behind you, the building sits dark and quiet—they won't discover the theft until morning.\n\nMarcus drives while Jules counts the seconds until you're clear of the security perimeter.",
              nextBeatId: 'getaway-beat2',
            },
            {
              id: 'getaway-beat2',
              text: '"We did it," Jules says, a rare grin spreading across her face. "A perfect heist. They\'ll be talking about this one for years."\n\nYou look at the diamond in your hand. Forty million dollars. Three ways. More than enough for the rest of your life.',
              speaker: 'Jules',
              nextBeatId: 'getaway-beat3',
            },
            {
              id: 'getaway-beat3',
              text: '"So," Marcus says, glancing in the rearview mirror. "What\'s next? Retirement?"',
              speaker: 'Marcus',
              choices: [
                {
                  id: 'retire',
                  text: '"This was the last job. I\'m out."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'addTag', tag: 'retired' },
                    { type: 'removeTag', tag: 'thief' },
                  ],
                  nextBeatId: 'getaway-beat4-retire',
                },
                {
                  id: 'continue',
                  text: '"Are you kidding? This is just the beginning."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'addTag', tag: 'master_thief' },
                    { type: 'relationship', npcId: 'jules', dimension: 'affection', change: 10 },
                  ],
                  nextBeatId: 'getaway-beat4-continue',
                },
              ],
            },
            {
              id: 'getaway-beat4-retire',
              text: "Jules nods slowly. \"It's a good note to end on. The Velvet Job. The one nobody thought was possible.\"\n\nThe city lights blur past as you drive into the night, leaving your old life behind. Whatever comes next, at least you'll face it as a legend.",
            },
            {
              id: 'getaway-beat4-continue',
              text: "Jules laughs. \"I was hoping you'd say that. I've got my eye on a private collection in Monaco. Interested?\"\n\nYou look at the diamond one more time, then slip it into your pocket. The Velvet Job was just the warm-up. The best is yet to come.",
            },
          ],
        },

        // Scene 3b: Messy Getaway
        {
          id: 'scene3-getaway-messy',
          name: 'The Escape',
          startingBeatId: 'escape-beat1',
          conditions: {
            type: 'flag',
            flag: 'heist_messy',
            value: true,
          },
          beats: [
            {
              id: 'escape-beat1',
              text: "Sirens wail behind you as Marcus floors the accelerator. The van screeches around corners, narrowly avoiding police cars.\n\n\"We're blown,\" Jules says, frantically working her laptop. \"I'm killing our digital trail, but they got a partial plate.\"",
              speaker: 'Jules',
              speakerMood: 'stressed',
              nextBeatId: 'escape-beat2',
            },
            {
              id: 'escape-beat2',
              text: "The diamond sits heavy in your pocket. You got what you came for—but at what cost?\n\n\"Safe house in fifteen minutes,\" Marcus says through gritted teeth. \"If we make it.\"",
              speaker: 'Marcus',
              nextBeatId: 'escape-beat3',
            },
            {
              id: 'escape-beat3',
              text: 'A police helicopter\'s spotlight sweeps the streets behind you.',
              choices: [
                {
                  id: 'escape-tunnel',
                  text: '"The old subway tunnel—it\'ll hide us from the chopper."',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'resourcefulness',
                    difficulty: 45,
                  },
                  nextBeatId: 'escape-beat4',
                },
                {
                  id: 'escape-trust',
                  text: '"Marcus, you\'ve got this. Lose them."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'marcus', dimension: 'trust', change: 10 },
                  ],
                  nextBeatId: 'escape-beat4',
                },
              ],
            },
            {
              id: 'escape-beat4',
              text: "Thirty tense minutes later, you're in the safe house. The sirens have faded. You made it.\n\nJules collapses onto a couch. \"That was too close. We need to lay low for a while.\"\n\nYou pull out the diamond. Despite everything, you can't help but smile. You did it. The Velvet Job—messy, but successful.",
              onShow: [
                { type: 'addTag', tag: 'notorious' },
              ],
            },
          ],
        },
      ],

      onComplete: [
        { type: 'skill', skill: 'stealth', change: 5 },
        { type: 'skill', skill: 'lockpicking', change: 5 },
      ],
    },

    // Episode 2: The Heat
    {
      id: 'ep2-the-heat',
      number: 2,
      title: 'The Heat',
      synopsis: 'The city is looking for the Celestine thieves. Lay low, find a buyer, and watch your back.',
      coverImage: '',
      startingSceneId: 'scene1-morning-after',

      scenes: [
        {
          id: 'scene1-morning-after',
          name: 'The Morning After',
          startingBeatId: 'morning-beat1',
          beats: [
            {
              id: 'morning-beat1',
              text: 'Forty-eight hours after the heist. The news is full of it—"Celestine Diamond Stolen in Daring Museum Heist." They\'re calling you "The Velvet Thieves."',
              textVariants: [
                {
                  condition: { type: 'flag', flag: 'heist_messy', value: true },
                  text: 'Forty-eight hours after the heist. Every news channel leads with it—"Brazen Diamond Theft Leaves Police Scrambling." They have partial descriptions. Witness statements. You\'re in more trouble than you planned.',
                },
              ],
              nextBeatId: 'morning-beat2',
            },
            {
              id: 'morning-beat2',
              text: 'The safe house is cramped—a converted warehouse loft. Jules is glued to her laptop, monitoring police frequencies. Marcus paces by the window.',
              nextBeatId: 'morning-beat3',
            },
            {
              id: 'morning-beat3',
              text: '"We need to move the diamond," Jules says without looking up. "The longer we hold it, the more dangerous it gets."',
              speaker: 'Jules',
              choices: [
                {
                  id: 'agree-quickly',
                  text: '"Agreed. Who do we know who can move something this hot?"',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'wit', change: 3 },
                    { type: 'relationship', npcId: 'jules', dimension: 'trust', change: 5 },
                  ],
                  nextBeatId: 'morning-beat4',
                },
                {
                  id: 'caution',
                  text: '"Let\'s not rush. We need the right buyer—not just any buyer."',
                  choiceType: 'strategic',
                  statCheck: { attribute: 'resolve', difficulty: 40 },
                  consequences: [
                    { type: 'attribute', attribute: 'resolve', change: 5 },
                    { type: 'setFlag', flag: 'careful_approach', value: true },
                  ],
                  nextBeatId: 'morning-beat4',
                },
              ],
            },
            {
              id: 'morning-beat4',
              text: 'Marcus stops pacing. "There\'s only one fence in the city who can move a forty-million-dollar diamond. Mr. Solomon."',
              speaker: 'Marcus',
              nextBeatId: 'morning-beat5',
            },
            {
              id: 'morning-beat5',
              text: 'Jules grimaces. "Solomon takes a thirty percent cut. And he has... connections. Some people say he\'s more dangerous than the cops."',
              speaker: 'Jules',
              choices: [
                {
                  id: 'accept-solomon',
                  text: '"We don\'t have a choice. Set up a meeting."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'courage', change: 3 },
                    { type: 'setFlag', flag: 'meeting_solomon', value: true },
                  ],
                  nextBeatId: 'morning-beat6',
                },
                {
                  id: 'look-elsewhere',
                  text: '"There has to be another way. What about private collectors?"',
                  choiceType: 'strategic',
                  statCheck: { attribute: 'resourcefulness', difficulty: 45 },
                  consequences: [
                    { type: 'attribute', attribute: 'resourcefulness', change: 5 },
                    { type: 'setFlag', flag: 'seeking_collector', value: true },
                  ],
                  nextBeatId: 'morning-beat6-alt',
                },
              ],
            },
            {
              id: 'morning-beat6',
              text: 'Jules nods. "I\'ll reach out. He\'ll want to meet tonight. And he\'ll want to see the diamond."',
              speaker: 'Jules',
              onShow: [
                { type: 'relationship', npcId: 'mr-solomon', dimension: 'trust', change: 5 },
              ],
              nextSceneId: 'scene2-visitor',
            },
            {
              id: 'morning-beat6-alt',
              text: '"I might know someone," Marcus says slowly. "Old army contact. Married into money—the dirty kind. But it\'s risky. These people don\'t play games."',
              speaker: 'Marcus',
              onShow: [
                { type: 'relationship', npcId: 'marcus', dimension: 'trust', change: 10 },
              ],
              nextSceneId: 'scene2-visitor',
            },
          ],
        },

        {
          id: 'scene2-visitor',
          name: 'An Unexpected Visitor',
          startingBeatId: 'visitor-beat1',
          beats: [
            {
              id: 'visitor-beat1',
              text: 'Before anyone can make a call, there\'s a knock at the door. Three sharp raps. Marcus reaches for his gun.',
              nextBeatId: 'visitor-beat2',
            },
            {
              id: 'visitor-beat2',
              text: '"It\'s me." Victoria\'s voice, muffled through the steel door. "Let me in. Now. Please."',
              speaker: 'Victoria',
              speakerMood: 'frightened',
              choices: [
                {
                  id: 'let-victoria-in',
                  text: 'Signal Marcus to open the door',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'victoria', dimension: 'trust', change: 10 },
                  ],
                  nextBeatId: 'visitor-beat3',
                },
                {
                  id: 'be-cautious',
                  text: '"How did you find us? You weren\'t supposed to know this location."',
                  choiceType: 'strategic',
                  statCheck: { attribute: 'wit', difficulty: 35 },
                  consequences: [
                    { type: 'attribute', attribute: 'wit', change: 3 },
                  ],
                  nextBeatId: 'visitor-beat3-cautious',
                },
              ],
            },
            {
              id: 'visitor-beat3',
              text: 'Victoria stumbles in, looking like she hasn\'t slept. "The police came to my apartment. A detective—Shaw. She asked about my finances. About my debts."',
              speaker: 'Victoria',
              onShow: [
                { type: 'relationship', npcId: 'detective-shaw', dimension: 'fear', change: 10 },
              ],
              nextBeatId: 'visitor-beat4',
            },
            {
              id: 'visitor-beat3-cautious',
              text: '"I followed Jules from her apartment yesterday. I had to know where you were." Victoria pushes past you, eyes wild. "Listen to me—a detective came to my door. Shaw. Major Crimes. She knows something."',
              speaker: 'Victoria',
              onShow: [
                { type: 'relationship', npcId: 'victoria', dimension: 'trust', change: -5 },
                { type: 'relationship', npcId: 'detective-shaw', dimension: 'fear', change: 10 },
              ],
              nextBeatId: 'visitor-beat4',
            },
            {
              id: 'visitor-beat4',
              text: '"Did she arrest you?" Jules asks, already typing. "Did she mention any of us?"',
              speaker: 'Jules',
              nextBeatId: 'visitor-beat5',
            },
            {
              id: 'visitor-beat5',
              text: '"No. She was... testing me. Watching my reactions." Victoria grabs your arm. "You have to get rid of that diamond. If she connects me to you—"',
              speaker: 'Victoria',
              choices: [
                {
                  id: 'reassure-victoria',
                  text: '"Victoria. Breathe. We planned for this. You\'re protected."',
                  choiceType: 'strategic',
                  statCheck: { attribute: 'charm', difficulty: 40 },
                  consequences: [
                    { type: 'relationship', npcId: 'victoria', dimension: 'trust', change: 15 },
                    { type: 'attribute', attribute: 'charm', change: 3 },
                  ],
                  nextBeatId: 'visitor-beat6',
                },
                {
                  id: 'hard-truth',
                  text: '"If you led them here, we have bigger problems than your nerves."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'victoria', dimension: 'fear', change: 10 },
                    { type: 'attribute', attribute: 'resolve', change: 3 },
                  ],
                  nextBeatId: 'visitor-beat6-hard',
                },
              ],
            },
            {
              id: 'visitor-beat6',
              text: 'Victoria takes a shaky breath. "Okay. Okay. But move fast. Shaw isn\'t going to stop."',
              speaker: 'Victoria',
              nextBeatId: 'visitor-beat7',
            },
            {
              id: 'visitor-beat6-hard',
              text: 'Victoria flinches but straightens. "I wasn\'t followed. I\'m careful. I just... I needed to warn you."',
              speaker: 'Victoria',
              nextBeatId: 'visitor-beat7',
            },
            {
              id: 'visitor-beat7',
              text: 'Outside the window, a dark sedan rolls slowly down the street. It could be nothing. It could be everything.',
              onShow: [
                { type: 'setFlag', flag: 'shaw_closing_in', value: true },
              ],
            },
          ],
        },
      ],

      onComplete: [
        { type: 'attribute', attribute: 'wit', change: 5 },
        { type: 'skill', skill: 'stealth', change: 3 },
      ],
    },

    // Episode 3: The Fence
    {
      id: 'ep3-the-fence',
      number: 3,
      title: 'The Fence',
      synopsis: 'Mr. Solomon can move the diamond—for a price. But in his world, nothing is ever simple.',
      coverImage: '',
      startingSceneId: 'scene1-solomon-meeting',

      scenes: [
        {
          id: 'scene1-solomon-meeting',
          name: 'Solomon\'s Domain',
          startingBeatId: 'solomon-beat1',
          beats: [
            {
              id: 'solomon-beat1',
              text: 'Mr. Solomon operates out of an antique shop in the old quarter. The kind of place where everything has a story—and half those stories end with someone missing.',
              nextBeatId: 'solomon-beat2',
            },
            {
              id: 'solomon-beat2',
              text: 'He receives you in a back room lined with clocks. Dozens of them, all ticking at different speeds. The man himself is silver-haired, impeccably dressed, with hands like a pianist.',
              nextBeatId: 'solomon-beat3',
            },
            {
              id: 'solomon-beat3',
              text: '"The Celestine." Solomon\'s eyes gleam as he examines the diamond. "I remember when the Hartwells acquired this. 1987. A different world."',
              speaker: 'Mr. Solomon',
              onShow: [
                { type: 'relationship', npcId: 'mr-solomon', dimension: 'respect', change: 10 },
              ],
              nextBeatId: 'solomon-beat4',
            },
            {
              id: 'solomon-beat4',
              text: '"Thirty-five percent," he says, setting the diamond down. "And I choose the buyer."',
              speaker: 'Mr. Solomon',
              choices: [
                {
                  id: 'negotiate-hard',
                  text: '"Twenty-five. We took all the risk."',
                  choiceType: 'strategic',
                  statCheck: { attribute: 'charm', difficulty: 50 },
                  consequences: [
                    { type: 'attribute', attribute: 'charm', change: 5 },
                    { type: 'relationship', npcId: 'mr-solomon', dimension: 'respect', change: 10 },
                  ],
                  nextBeatId: 'solomon-beat5-negotiated',
                },
                {
                  id: 'accept-terms',
                  text: '"Thirty-five is fair for a stone this hot."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'mr-solomon', dimension: 'trust', change: 10 },
                    { type: 'attribute', attribute: 'empathy', change: 3 },
                  ],
                  nextBeatId: 'solomon-beat5',
                },
                {
                  id: 'walk-away-threat',
                  text: '"Maybe we should shop around. You\'re not the only game in town."',
                  choiceType: 'strategic',
                  statCheck: { attribute: 'courage', difficulty: 55 },
                  consequences: [
                    { type: 'attribute', attribute: 'courage', change: 5 },
                    { type: 'relationship', npcId: 'mr-solomon', dimension: 'fear', change: 5 },
                  ],
                  nextBeatId: 'solomon-beat5-bluff',
                },
              ],
            },
            {
              id: 'solomon-beat5-negotiated',
              text: 'Solomon\'s lips twitch—almost a smile. "Twenty-eight. And you owe me a favor. To be collected at my discretion."',
              speaker: 'Mr. Solomon',
              onShow: [
                { type: 'setFlag', flag: 'owes_solomon_favor', value: true },
              ],
              nextBeatId: 'solomon-beat6',
            },
            {
              id: 'solomon-beat5',
              text: '"Sensible." Solomon nods. "The buyer is a collector. European. Very private. The exchange happens in three days."',
              speaker: 'Mr. Solomon',
              nextBeatId: 'solomon-beat6',
            },
            {
              id: 'solomon-beat5-bluff',
              text: 'Solomon\'s eyes harden. "I am the only game that matters. But I respect ambition." He sets down his teacup. "Thirty percent. Final offer."',
              speaker: 'Mr. Solomon',
              onShow: [
                { type: 'relationship', npcId: 'mr-solomon', dimension: 'respect', change: 5 },
              ],
              nextBeatId: 'solomon-beat6',
            },
            {
              id: 'solomon-beat6',
              text: '"There is one complication." Solomon produces a photograph. A woman with dark hair and sharp eyes. "Raven. She\'s been asking about the Celestine job. She seems to think it should have been hers."',
              speaker: 'Mr. Solomon',
              onShow: [
                { type: 'setFlag', flag: 'raven_knows', value: true },
              ],
              nextBeatId: 'solomon-beat7',
            },
            {
              id: 'solomon-beat7',
              text: 'You know Raven. You burned her two years ago—stole a score she\'d been planning for months. She swore she\'d make you pay.',
              choices: [
                {
                  id: 'concern-raven',
                  text: '"Raven is dangerous. Can you keep her off our backs?"',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'mr-solomon', dimension: 'trust', change: 5 },
                    { type: 'attribute', attribute: 'wit', change: 3 },
                  ],
                  nextBeatId: 'solomon-beat8',
                },
                {
                  id: 'dismiss-raven',
                  text: '"I can handle Raven. She\'s not my problem."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'courage', change: 5 },
                    { type: 'relationship', npcId: 'raven', dimension: 'fear', change: -10 },
                  ],
                  nextBeatId: 'solomon-beat8-dismiss',
                },
              ],
            },
            {
              id: 'solomon-beat8',
              text: '"I can delay her. But she has resources of her own. Be careful." Solomon stands. "Three days. Have the diamond ready."',
              speaker: 'Mr. Solomon',
              nextSceneId: 'scene2-raven-arrives',
            },
            {
              id: 'solomon-beat8-dismiss',
              text: 'Solomon shrugs. "Your funeral. Three days. Don\'t be late."',
              speaker: 'Mr. Solomon',
              nextSceneId: 'scene2-raven-arrives',
            },
          ],
        },

        {
          id: 'scene2-raven-arrives',
          name: 'Old Debts',
          startingBeatId: 'raven-beat1',
          beats: [
            {
              id: 'raven-beat1',
              text: 'You\'re walking back to the safe house when a figure steps out of an alley. Black leather jacket, silver rings, a smile that doesn\'t reach her eyes.',
              nextBeatId: 'raven-beat2',
            },
            {
              id: 'raven-beat2',
              text: '"Long time." Raven\'s voice is silk over steel. "I heard about the Hartwell job. Very impressive. Very familiar."',
              speaker: 'Raven',
              speakerMood: 'threatening',
              onShow: [
                { type: 'relationship', npcId: 'raven', dimension: 'trust', change: -10 },
              ],
              nextBeatId: 'raven-beat3',
            },
            {
              id: 'raven-beat3',
              text: '"That was my score. My plan. My contacts." She takes a step closer. "You stole it. Just like you stole the Geneva job two years ago."',
              speaker: 'Raven',
              choices: [
                {
                  id: 'apologize-raven',
                  text: '"Look, about Geneva—that was business. Nothing personal."',
                  choiceType: 'strategic',
                  statCheck: { attribute: 'charm', difficulty: 45 },
                  consequences: [
                    { type: 'relationship', npcId: 'raven', dimension: 'trust', change: 10 },
                    { type: 'attribute', attribute: 'charm', change: 3 },
                  ],
                  nextBeatId: 'raven-beat4-peace',
                },
                {
                  id: 'stand-ground',
                  text: '"You lost the job because you hesitated. I didn\'t."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'raven', dimension: 'fear', change: 10 },
                    { type: 'attribute', attribute: 'resolve', change: 5 },
                  ],
                  nextBeatId: 'raven-beat4-conflict',
                },
                {
                  id: 'offer-cut',
                  text: '"What if I cut you in? A piece of the Celestine deal."',
                  choiceType: 'strategic',
                  statCheck: { attribute: 'wit', difficulty: 40 },
                  consequences: [
                    { type: 'relationship', npcId: 'raven', dimension: 'trust', change: 15 },
                    { type: 'setFlag', flag: 'raven_partnership', value: true },
                  ],
                  nextBeatId: 'raven-beat4-deal',
                },
              ],
            },
            {
              id: 'raven-beat4-peace',
              text: 'Raven\'s expression flickers. "Business. Right." She pulls back slightly. "I don\'t forgive easy. But I don\'t forget either. Watch your back."',
              speaker: 'Raven',
              nextBeatId: 'raven-beat5',
            },
            {
              id: 'raven-beat4-conflict',
              text: '"Careful." Raven\'s hand moves to her jacket—where you know she keeps a blade. "I\'m not the woman you burned two years ago. I\'ve learned a few things."',
              speaker: 'Raven',
              onShow: [
                { type: 'setFlag', flag: 'raven_hostile', value: true },
              ],
              nextBeatId: 'raven-beat5',
            },
            {
              id: 'raven-beat4-deal',
              text: 'Raven tilts her head, calculating. "Ten percent. And I get first pick on your next three jobs." She extends her hand. "Deal?"',
              speaker: 'Raven',
              choices: [
                {
                  id: 'accept-raven-deal',
                  text: 'Shake her hand',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'raven', dimension: 'trust', change: 20 },
                    { type: 'addTag', tag: 'raven_ally' },
                  ],
                  nextBeatId: 'raven-beat5-ally',
                },
                {
                  id: 'reject-raven-deal',
                  text: '"Five percent. And one job. Take it or leave it."',
                  choiceType: 'strategic',
                  statCheck: { attribute: 'resolve', difficulty: 45 },
                  consequences: [
                    { type: 'relationship', npcId: 'raven', dimension: 'respect', change: 10 },
                  ],
                  nextBeatId: 'raven-beat5-counter',
                },
              ],
            },
            {
              id: 'raven-beat5',
              text: 'She melts back into the shadows, leaving you with the distinct feeling that this isn\'t over. Not by a long shot.',
            },
            {
              id: 'raven-beat5-ally',
              text: 'Her grip is firm. "Partners it is. For now." She smiles—genuinely, this time. "I\'ll be in touch before the exchange."',
              speaker: 'Raven',
            },
            {
              id: 'raven-beat5-counter',
              text: 'Raven considers. "Seven. And one job." She shakes your hand before you can argue. "You\'re a pain, but you\'re good. I respect that."',
              speaker: 'Raven',
              onShow: [
                { type: 'addTag', tag: 'raven_ally' },
              ],
            },
          ],
        },
      ],

      onComplete: [
        { type: 'attribute', attribute: 'charm', change: 5 },
        { type: 'skill', skill: 'disguise', change: 3 },
      ],
    },

    // Episode 4: The Double Cross
    {
      id: 'ep4-double-cross',
      number: 4,
      title: 'The Double Cross',
      synopsis: 'Someone is playing both sides. Trust is a luxury you can no longer afford.',
      coverImage: '',
      startingSceneId: 'scene1-bad-news',

      scenes: [
        {
          id: 'scene1-bad-news',
          name: 'Bad News',
          startingBeatId: 'bad-beat1',
          beats: [
            {
              id: 'bad-beat1',
              text: 'The night before the exchange. Jules bursts into the safe house, face pale.',
              nextBeatId: 'bad-beat2',
            },
            {
              id: 'bad-beat2',
              text: '"We\'re burned. Shaw just issued arrest warrants. For all of us."',
              speaker: 'Jules',
              speakerMood: 'panicked',
              onShow: [
                { type: 'relationship', npcId: 'detective-shaw', dimension: 'fear', change: 20 },
              ],
              nextBeatId: 'bad-beat3',
            },
            {
              id: 'bad-beat3',
              text: 'Marcus curses. "How? We were careful. Nobody knew—" He stops. Everyone is thinking the same thing.',
              speaker: 'Marcus',
              nextBeatId: 'bad-beat4',
            },
            {
              id: 'bad-beat4',
              text: 'Someone talked. The question is: who?',
              choices: [
                {
                  id: 'suspect-victoria',
                  text: '"Victoria. She was questioned by Shaw. Maybe she made a deal."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'victoria', dimension: 'trust', change: -20 },
                    { type: 'attribute', attribute: 'wit', change: 3 },
                  ],
                  nextBeatId: 'bad-beat5-victoria',
                },
                {
                  id: 'suspect-solomon',
                  text: '"Solomon. He could sell us out for the right price."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'mr-solomon', dimension: 'trust', change: -15 },
                    { type: 'attribute', attribute: 'resourcefulness', change: 3 },
                  ],
                  nextBeatId: 'bad-beat5-solomon',
                },
                {
                  id: 'stay-calm',
                  text: '"We don\'t point fingers until we know. Jules, dig deeper."',
                  choiceType: 'strategic',
                  statCheck: { attribute: 'resolve', difficulty: 45 },
                  consequences: [
                    { type: 'relationship', npcId: 'jules', dimension: 'respect', change: 10 },
                    { type: 'attribute', attribute: 'resolve', change: 5 },
                  ],
                  nextBeatId: 'bad-beat5-investigate',
                },
              ],
            },
            {
              id: 'bad-beat5-victoria',
              text: '"I\'ll find her." Marcus checks his weapon. "If she sold us out—"',
              speaker: 'Marcus',
              nextBeatId: 'bad-beat6',
            },
            {
              id: 'bad-beat5-solomon',
              text: '"Solomon wouldn\'t burn his own deal." Jules shakes her head. "Unless someone offered him more. Or threatened him."',
              speaker: 'Jules',
              nextBeatId: 'bad-beat6',
            },
            {
              id: 'bad-beat5-investigate',
              text: 'Jules works her laptop furiously. Ten minutes later, she has something. "Shaw received an anonymous tip. Encrypted. But I can trace the routing..."',
              speaker: 'Jules',
              onShow: [
                { type: 'setFlag', flag: 'traced_leak', value: true },
              ],
              nextBeatId: 'bad-beat6-traced',
            },
            {
              id: 'bad-beat6',
              text: 'Your phone buzzes. A text from an unknown number: "Meet me at the old pier. Come alone. I know who talked. —R"',
              onShow: [
                { type: 'setFlag', flag: 'raven_message', value: true },
              ],
              nextSceneId: 'scene2-the-truth',
            },
            {
              id: 'bad-beat6-traced',
              text: 'Jules looks up, face grim. "The tip came from inside Solomon\'s network. Someone close to him." Your phone buzzes. A text: "Meet me at the old pier. Come alone. —R"',
              onShow: [
                { type: 'setFlag', flag: 'raven_message', value: true },
              ],
              nextSceneId: 'scene2-the-truth',
            },
          ],
        },

        {
          id: 'scene2-the-truth',
          name: 'The Truth',
          startingBeatId: 'pier-beat1',
          beats: [
            {
              id: 'pier-beat1',
              text: 'The pier is abandoned, rotting wood creaking under your feet. Raven waits at the end, silhouetted against the moonlit water.',
              textVariants: [
                {
                  condition: { type: 'tag', tag: 'raven_ally', hasTag: true },
                  text: 'The pier is abandoned. Raven waits at the end, and for once, she doesn\'t look like she wants to kill you.',
                },
              ],
              nextBeatId: 'pier-beat2',
            },
            {
              id: 'pier-beat2',
              text: '"You came alone. Smart." She tosses you a phone. "Recording. Listen."',
              speaker: 'Raven',
              nextBeatId: 'pier-beat3',
            },
            {
              id: 'pier-beat3',
              text: 'Victoria\'s voice, clear and unmistakable: "—full immunity. I give you the crew, the diamond, everything. In exchange, my debts disappear."',
              nextBeatId: 'pier-beat4',
            },
            {
              id: 'pier-beat4',
              text: 'Shaw\'s response: "We have a deal, Ms. Ashworth. Lead them to the exchange point. We\'ll handle the rest."',
              onShow: [
                { type: 'setFlag', flag: 'victoria_betrayed', value: true },
                { type: 'relationship', npcId: 'victoria', dimension: 'trust', change: -50 },
              ],
              nextBeatId: 'pier-beat5',
            },
            {
              id: 'pier-beat5',
              text: '"She sold you out," Raven says flatly. "And she\'s been wearing a wire for two days."',
              speaker: 'Raven',
              choices: [
                {
                  id: 'rage-victoria',
                  text: '"I\'ll kill her."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'courage', change: 5 },
                    { type: 'attribute', attribute: 'empathy', change: -5 },
                  ],
                  nextBeatId: 'pier-beat6-rage',
                },
                {
                  id: 'think-clearly',
                  text: '"We can use this. If we know she\'s compromised..."',
                  choiceType: 'strategic',
                  statCheck: { attribute: 'wit', difficulty: 45 },
                  consequences: [
                    { type: 'attribute', attribute: 'wit', change: 5 },
                    { type: 'setFlag', flag: 'counter_plan', value: true },
                  ],
                  nextBeatId: 'pier-beat6-plan',
                },
                {
                  id: 'ask-raven-why',
                  text: '"Why are you helping me? What\'s your angle?"',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'raven', dimension: 'trust', change: 10 },
                  ],
                  nextBeatId: 'pier-beat6-raven',
                },
              ],
            },
            {
              id: 'pier-beat6-rage',
              text: '"Tempting. But stupid." Raven holds up a hand. "Kill her and Shaw gets everything she needs. We need a better play."',
              speaker: 'Raven',
              nextBeatId: 'pier-beat7',
            },
            {
              id: 'pier-beat6-plan',
              text: 'Raven\'s smile returns. "Now you\'re thinking like a professional. What did you have in mind?"',
              speaker: 'Raven',
              nextBeatId: 'pier-beat7',
            },
            {
              id: 'pier-beat6-raven',
              text: '"I told you—I learned a few things. One of them is that grudges are expensive." She shrugs. "Besides. Shaw\'s been after me too. Enemy of my enemy."',
              speaker: 'Raven',
              onShow: [
                { type: 'relationship', npcId: 'raven', dimension: 'affection', change: 10 },
              ],
              nextBeatId: 'pier-beat7',
            },
            {
              id: 'pier-beat7',
              text: '"The exchange is still happening," Raven says. "But now it\'s a trap—for both sides. Question is: who\'s the hunter, and who\'s the prey?"',
              speaker: 'Raven',
              choices: [
                {
                  id: 'new-plan-deception',
                  text: '"We feed Victoria bad information. Lead Shaw\'s team somewhere else."',
                  choiceType: 'strategic',
                  statCheck: { attribute: 'wit', difficulty: 50 },
                  consequences: [
                    { type: 'attribute', attribute: 'wit', change: 5 },
                    { type: 'setFlag', flag: 'misdirection_plan', value: true },
                  ],
                  nextBeatId: 'pier-beat8',
                },
                {
                  id: 'new-plan-direct',
                  text: '"We go through with the exchange. But we\'re ready for Shaw when she comes."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'courage', change: 5 },
                    { type: 'setFlag', flag: 'direct_confrontation', value: true },
                  ],
                  nextBeatId: 'pier-beat8',
                },
              ],
            },
            {
              id: 'pier-beat8',
              text: 'Raven nods. "It\'s risky. But risky is what we do." She offers her hand. "Partners?"',
              speaker: 'Raven',
              onShow: [
                { type: 'relationship', npcId: 'raven', dimension: 'trust', change: 15 },
                { type: 'addTag', tag: 'raven_ally' },
              ],
            },
          ],
        },
      ],

      onComplete: [
        { type: 'attribute', attribute: 'wit', change: 5 },
        { type: 'attribute', attribute: 'resolve', change: 5 },
      ],
    },

    // Episode 5: The Exchange
    {
      id: 'ep5-the-exchange',
      number: 5,
      title: 'The Exchange',
      synopsis: 'The final play. Outmaneuver Shaw, close the deal, and escape with your freedom—and your life.',
      coverImage: '',
      startingSceneId: 'scene1-final-prep',

      scenes: [
        {
          id: 'scene1-final-prep',
          name: 'Final Preparations',
          startingBeatId: 'prep-beat1',
          beats: [
            {
              id: 'prep-beat1',
              text: 'The warehouse district. Midnight. Your crew gathers for final preparations.',
              textVariants: [
                {
                  condition: { type: 'flag', flag: 'misdirection_plan', value: true },
                  text: 'The warehouse district. Midnight. Victoria thinks the exchange is happening at the docks—she\'s already fed that information to Shaw. The real meeting is here.',
                },
              ],
              nextBeatId: 'prep-beat2',
            },
            {
              id: 'prep-beat2',
              text: 'Jules hands out earpieces. "Comms are encrypted. Solomon\'s buyer arrives in thirty minutes. We do this clean, we walk away rich and free."',
              speaker: 'Jules',
              nextBeatId: 'prep-beat3',
            },
            {
              id: 'prep-beat3',
              text: 'Marcus checks his equipment. "And if Shaw shows up?"',
              speaker: 'Marcus',
              choices: [
                {
                  id: 'confident-response',
                  text: '"Then we improvise. That\'s what we\'re good at."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'marcus', dimension: 'trust', change: 10 },
                    { type: 'attribute', attribute: 'courage', change: 3 },
                  ],
                  nextBeatId: 'prep-beat4',
                },
                {
                  id: 'realistic-response',
                  text: '"Then we run. The diamond isn\'t worth dying for."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'jules', dimension: 'trust', change: 10 },
                    { type: 'attribute', attribute: 'wit', change: 3 },
                  ],
                  nextBeatId: 'prep-beat4',
                },
              ],
            },
            {
              id: 'prep-beat4',
              text: 'Raven arrives, slipping out of the shadows. "Solomon\'s buyer is here. Black car, north entrance. This is it."',
              speaker: 'Raven',
              conditions: { type: 'tag', tag: 'raven_ally', hasTag: true },
              onShow: [
                { type: 'relationship', npcId: 'raven', dimension: 'trust', change: 5 },
              ],
              nextSceneId: 'scene2-exchange',
            },
          ],
        },

        {
          id: 'scene2-exchange',
          name: 'The Exchange',
          startingBeatId: 'exchange-start',
          beats: [],
          encounter: {
            id: 'final-exchange',
            type: 'heist',
            name: 'The Exchange',
            description: 'Complete the diamond sale while avoiding capture.',
            phases: [
              {
                id: 'phase1-meeting',
                name: 'The Buyer',
                description: 'Meet with Solomon\'s buyer and verify the payment.',
                situationImage: '',
                successThreshold: 4,
                failureThreshold: -2,
                beats: [
                  {
                    id: 'ex-beat1',
                    text: 'The buyer is a woman in an expensive coat, flanked by two bodyguards. She examines the diamond with a jeweler\'s loupe while you try not to look at the briefcase.',
                    nextBeatId: 'ex-beat2',
                  },
                  {
                    id: 'ex-beat2',
                    text: '"Authentic," she says. "Mr. Solomon has impeccable taste in... acquisitions."',
                    choices: [
                      {
                        id: 'ex-professional',
                        text: 'Keep it professional. "The payment?"',
                        choiceType: 'strategic',
                        statCheck: { attribute: 'resolve', difficulty: 40 },
                        consequences: [
                          { type: 'attribute', attribute: 'resolve', change: 3 },
                        ],
                        nextBeatId: 'ex-beat3',
                      },
                      {
                        id: 'ex-charming',
                        text: 'Turn on the charm. "A pleasure doing business with a connoisseur."',
                        choiceType: 'strategic',
                        statCheck: { attribute: 'charm', difficulty: 45 },
                        consequences: [
                          { type: 'attribute', attribute: 'charm', change: 3 },
                        ],
                        nextBeatId: 'ex-beat3',
                      },
                    ],
                  },
                  {
                    id: 'ex-beat3',
                    text: 'She gestures to a bodyguard who opens the briefcase. Stacks of bearer bonds. Untraceable. Twenty-six million dollars after Solomon\'s cut.',
                    nextBeatId: 'ex-beat4',
                  },
                  {
                    id: 'ex-beat4',
                    text: '"Jules, verify," you murmur into your earpiece.',
                    choices: [
                      {
                        id: 'ex-verify',
                        text: 'Wait for Jules to confirm the bonds are real',
                        choiceType: 'strategic',
                        statCheck: { skill: 'hacking', difficulty: 40 },
                        consequences: [
                          { type: 'skill', skill: 'hacking', change: 3 },
                        ],
                        nextBeatId: 'ex-beat5',
                      },
                      {
                        id: 'ex-trust',
                        text: 'Trust your instincts—the buyer seems legitimate',
                        choiceType: 'strategic',
                        statCheck: { attribute: 'wit', difficulty: 45 },
                        nextBeatId: 'ex-beat5',
                      },
                    ],
                  },
                  {
                    id: 'ex-beat5',
                    text: '"Bonds are good," Jules confirms. "Make the trade."',
                    speaker: 'Jules',
                  },
                ],
                onSuccess: {
                  nextPhaseId: 'phase2-complication',
                  outcomeText: 'The exchange goes smoothly. Diamond for bonds. Both parties satisfied.',
                  consequences: [
                    { type: 'setFlag', flag: 'exchange_clean', value: true },
                  ],
                },
                onFailure: {
                  nextPhaseId: 'phase2-complication',
                  outcomeText: 'The buyer hesitates—she spotted something. "We have company," she hisses.',
                  consequences: [
                    { type: 'setFlag', flag: 'buyer_spooked', value: true },
                  ],
                },
              },
              {
                id: 'phase2-complication',
                name: 'Complications',
                description: 'Nothing ever goes according to plan.',
                situationImage: '',
                successThreshold: 5,
                failureThreshold: -3,
                beats: [
                  {
                    id: 'comp-beat1',
                    text: 'Headlights sweep across the warehouse windows. Multiple vehicles. Moving fast.',
                    textVariants: [
                      {
                        condition: { type: 'flag', flag: 'misdirection_plan', value: true },
                        text: 'Headlights sweep across the warehouse. "That\'s impossible," Jules says. "Shaw should be at the docks—"',
                      },
                    ],
                    nextBeatId: 'comp-beat2',
                  },
                  {
                    id: 'comp-beat2',
                    text: '"POLICE! NOBODY MOVE!" Shaw\'s voice, amplified by megaphone. Somehow, she found you.',
                    onShow: [
                      { type: 'relationship', npcId: 'detective-shaw', dimension: 'fear', change: 15 },
                    ],
                    nextBeatId: 'comp-beat3',
                  },
                  {
                    id: 'comp-beat3',
                    text: 'The buyer\'s bodyguards draw weapons. This is about to get ugly.',
                    choices: [
                      {
                        id: 'comp-escape-route',
                        text: '"Back exit—now! Jules, kill the lights!"',
                        choiceType: 'strategic',
                        statCheck: { attribute: 'resourcefulness', difficulty: 50 },
                        consequences: [
                          { type: 'attribute', attribute: 'resourcefulness', change: 5 },
                        ],
                        nextBeatId: 'comp-beat4',
                      },
                      {
                        id: 'comp-stand-ground',
                        text: '"Hold your positions. We negotiate our way out."',
                        choiceType: 'strategic',
                        statCheck: { attribute: 'courage', difficulty: 55 },
                        consequences: [
                          { type: 'attribute', attribute: 'courage', change: 5 },
                        ],
                        nextBeatId: 'comp-beat4-stand',
                      },
                    ],
                  },
                  {
                    id: 'comp-beat4',
                    text: 'The lights die. In the darkness, you grab the briefcase and run. Marcus covers the retreat.',
                    nextBeatId: 'comp-beat5',
                  },
                  {
                    id: 'comp-beat4-stand',
                    text: '"Shaw!" you call out. "You want the diamond? You\'ll never find it without us!"',
                    nextBeatId: 'comp-beat5-negotiate',
                  },
                  {
                    id: 'comp-beat5',
                    text: 'Gunfire erupts behind you. The buyer\'s people aren\'t going quietly.',
                    choices: [
                      {
                        id: 'comp-keep-running',
                        text: 'Don\'t look back—keep moving',
                        choiceType: 'strategic',
                        statCheck: { skill: 'stealth', difficulty: 50 },
                        consequences: [
                          { type: 'skill', skill: 'stealth', change: 5 },
                        ],
                        nextBeatId: 'comp-beat6',
                      },
                      {
                        id: 'comp-help-marcus',
                        text: 'Turn back for Marcus',
                        choiceType: 'strategic',
                        statCheck: { attribute: 'courage', difficulty: 55 },
                        consequences: [
                          { type: 'relationship', npcId: 'marcus', dimension: 'trust', change: 20 },
                          { type: 'attribute', attribute: 'courage', change: 5 },
                        ],
                        nextBeatId: 'comp-beat6-hero',
                      },
                    ],
                  },
                  {
                    id: 'comp-beat5-negotiate',
                    text: 'There\'s a long pause. Then Shaw\'s voice: "You\'ve got two minutes. Talk fast."',
                    nextBeatId: 'comp-beat6-negotiate',
                  },
                  {
                    id: 'comp-beat6',
                    text: 'You reach the back exit. Jules and Raven are waiting with the getaway car.',
                  },
                  {
                    id: 'comp-beat6-hero',
                    text: 'You grab Marcus and pull him toward the exit. "Move, soldier! That\'s an order!"',
                    onShow: [
                      { type: 'relationship', npcId: 'marcus', dimension: 'affection', change: 15 },
                    ],
                  },
                  {
                    id: 'comp-beat6-negotiate',
                    text: '"Let us walk. The diamond\'s already been sold—you\'ll never recover it. But I can give you something better."',
                  },
                ],
                onSuccess: {
                  outcomeText: 'You make it to the car. Tires screech as you pull away, leaving chaos behind.',
                  consequences: [
                    { type: 'setFlag', flag: 'escaped_shaw', value: true },
                  ],
                },
                onFailure: {
                  outcomeText: 'A bullet catches your arm. You stumble—but Marcus is there, dragging you to the car.',
                  consequences: [
                    { type: 'attribute', attribute: 'resolve', change: -5 },
                    { type: 'relationship', npcId: 'marcus', dimension: 'trust', change: 15 },
                  ],
                },
              },
            ],
            startingPhaseId: 'phase1-meeting',
            outcomes: {
              victory: {
                nextSceneId: 'scene3-aftermath',
                consequences: [
                  { type: 'skill', skill: 'stealth', change: 10 },
                  { type: 'addTag', tag: 'escaped' },
                ],
              },
              defeat: {
                nextSceneId: 'scene3-aftermath-caught',
                consequences: [
                  { type: 'addTag', tag: 'caught' },
                ],
              },
            },
          },
        },

        {
          id: 'scene3-aftermath',
          name: 'Clean Getaway',
          startingBeatId: 'after-beat1',
          beats: [
            {
              id: 'after-beat1',
              text: 'Three hours later. A motel on the edge of the city. You count the bonds while Jules patches up your wounds.',
              nextBeatId: 'after-beat2',
            },
            {
              id: 'after-beat2',
              text: '"We did it," Marcus says, disbelief in his voice. "We actually did it."',
              speaker: 'Marcus',
              onShow: [
                { type: 'relationship', npcId: 'marcus', dimension: 'trust', change: 10 },
              ],
              nextBeatId: 'after-beat3',
            },
            {
              id: 'after-beat3',
              text: 'Twenty-six million. Split four ways—five, if Raven\'s getting her cut. Enough to disappear forever.',
              textVariants: [
                {
                  condition: { type: 'tag', tag: 'raven_ally', hasTag: true },
                  text: 'Twenty-six million. Split five ways with Raven\'s cut. Still enough to disappear forever.',
                },
              ],
              choices: [
                {
                  id: 'celebrate',
                  text: '"We earned this. Every dollar."',
                  choiceType: 'expression',
                  consequences: [
                    { type: 'attribute', attribute: 'resolve', change: 5 },
                  ],
                  nextBeatId: 'after-beat4',
                },
                {
                  id: 'cautious-still',
                  text: '"Don\'t celebrate yet. Shaw is still out there."',
                  choiceType: 'expression',
                  consequences: [
                    { type: 'attribute', attribute: 'wit', change: 5 },
                  ],
                  nextBeatId: 'after-beat4',
                },
              ],
            },
            {
              id: 'after-beat4',
              text: 'Tomorrow you scatter. New identities. New lives. The Velvet Thieves—legends who vanished into the night.',
              onShow: [
                { type: 'addTag', tag: 'legend' },
              ],
            },
          ],
        },

        {
          id: 'scene3-aftermath-caught',
          name: 'End of the Line',
          startingBeatId: 'caught-beat1',
          beats: [
            {
              id: 'caught-beat1',
              text: 'Shaw\'s handcuffs are cold on your wrists. The warehouse is swarming with police.',
              nextBeatId: 'caught-beat2',
            },
            {
              id: 'caught-beat2',
              text: '"The Velvet Thieves." Shaw looks almost disappointed. "I expected more."',
              speaker: 'Detective Shaw',
              nextBeatId: 'caught-beat3',
            },
            {
              id: 'caught-beat3',
              text: 'But you still have one card to play. The bonds are hidden—Shaw has nothing.',
              choices: [
                {
                  id: 'deal-with-shaw',
                  text: '"Let\'s talk, Detective. I can give you bigger fish than me."',
                  choiceType: 'strategic',
                  statCheck: { attribute: 'charm', difficulty: 55 },
                  consequences: [
                    { type: 'attribute', attribute: 'charm', change: 5 },
                    { type: 'setFlag', flag: 'made_deal', value: true },
                  ],
                  nextBeatId: 'caught-beat4-deal',
                },
                {
                  id: 'stay-silent',
                  text: 'Say nothing. Lawyer up.',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'resolve', change: 10 },
                  ],
                  nextBeatId: 'caught-beat4-silent',
                },
              ],
            },
            {
              id: 'caught-beat4-deal',
              text: 'Shaw\'s eyes narrow. "I\'m listening."',
              speaker: 'Detective Shaw',
              onShow: [
                { type: 'relationship', npcId: 'detective-shaw', dimension: 'respect', change: 10 },
              ],
            },
            {
              id: 'caught-beat4-silent',
              text: 'You smile and say nothing. The game isn\'t over yet.',
            },
          ],
        },
      ],

      onComplete: [
        { type: 'attribute', attribute: 'resourcefulness', change: 10 },
        { type: 'skill', skill: 'stealth', change: 5 },
      ],
    },

    // Episode 6: The Score
    {
      id: 'ep6-the-score',
      number: 6,
      title: 'The Score',
      synopsis: 'The job is done. Now comes the hardest part: deciding what kind of thief—and what kind of person—you want to be.',
      coverImage: '',
      startingSceneId: 'scene1-new-dawn',

      scenes: [
        {
          id: 'scene1-new-dawn',
          name: 'A New Dawn',
          startingBeatId: 'dawn-beat1',
          beats: [
            {
              id: 'dawn-beat1',
              text: 'One week later. A beach house on the coast, far from the city. The news has moved on to other stories. The Velvet Thieves are already becoming legend.',
              textVariants: [
                {
                  condition: { type: 'tag', tag: 'caught', hasTag: true },
                  text: 'One week later. A holding cell. Your lawyer visits daily, but Shaw has nothing concrete. The diamond is gone. The bonds are hidden. Stalemate.',
                },
              ],
              nextBeatId: 'dawn-beat2',
            },
            {
              id: 'dawn-beat2',
              text: 'Jules finds you on the deck, watching the sunrise. "Wire transfer cleared. Your share is in the Cayman account."',
              speaker: 'Jules',
              conditions: { type: 'tag', tag: 'escaped', hasTag: true },
              onShow: [
                { type: 'relationship', npcId: 'jules', dimension: 'trust', change: 10 },
              ],
              nextBeatId: 'dawn-beat3',
            },
            {
              id: 'dawn-beat3',
              text: 'Six million dollars. Enough to disappear. Enough to start over. Enough for anything.',
              choices: [
                {
                  id: 'content',
                  text: '"We pulled it off. Against all odds."',
                  choiceType: 'expression',
                  consequences: [
                    { type: 'attribute', attribute: 'empathy', change: 3 },
                  ],
                  nextBeatId: 'dawn-beat4',
                },
                {
                  id: 'restless',
                  text: '"Already thinking about the next one?"',
                  choiceType: 'expression',
                  consequences: [
                    { type: 'attribute', attribute: 'courage', change: 3 },
                  ],
                  nextBeatId: 'dawn-beat4-next',
                },
              ],
            },
            {
              id: 'dawn-beat4',
              text: 'Jules smiles. "The others are inside. Marcus made breakfast. Even Raven showed up." She pauses. "It\'s nice. Having a crew that actually trusts each other."',
              speaker: 'Jules',
              nextBeatId: 'dawn-beat5',
            },
            {
              id: 'dawn-beat4-next',
              text: 'Jules laughs. "You never stop, do you?" She produces a newspaper clipping. "There\'s a collector in Monaco. Private gallery. Supposedly impenetrable."',
              speaker: 'Jules',
              nextBeatId: 'dawn-beat5-next',
            },
            {
              id: 'dawn-beat5',
              text: 'You head inside. Marcus is at the stove, Raven is nursing coffee, and for a moment, it feels like family.',
              textVariants: [
                {
                  condition: { type: 'tag', tag: 'raven_ally', hasTag: true },
                  text: 'You head inside. Marcus is at the stove, Raven is arguing with him about how to make eggs, and for a moment, it feels like family.',
                },
              ],
              nextSceneId: 'scene2-choices',
            },
            {
              id: 'dawn-beat5-next',
              text: '"Impenetrable." You smile. "That\'s what they said about Hartwell."',
              onShow: [
                { type: 'setFlag', flag: 'considering_monaco', value: true },
              ],
              nextSceneId: 'scene2-choices',
            },
          ],
        },

        {
          id: 'scene2-choices',
          name: 'What Comes Next',
          startingBeatId: 'choice-beat1',
          beats: [
            {
              id: 'choice-beat1',
              text: 'After breakfast, the crew gathers on the deck. The future hangs unspoken between you.',
              nextBeatId: 'choice-beat2',
            },
            {
              id: 'choice-beat2',
              text: '"So." Marcus sets down his coffee. "What now? We scatter? Or..."',
              speaker: 'Marcus',
              nextBeatId: 'choice-beat3',
            },
            {
              id: 'choice-beat3',
              text: 'Everyone looks at you. This was always your crew. Your call.',
              choices: [
                {
                  id: 'retire-choice',
                  text: '"We got lucky. Really lucky. I say we take the win and disappear."',
                  choiceType: 'dilemma',
                  consequences: [
                    { type: 'attribute', attribute: 'wit', change: 5 },
                    { type: 'setFlag', flag: 'chose_retirement', value: true },
                  ],
                  nextBeatId: 'choice-beat4-retire',
                },
                {
                  id: 'continue-choice',
                  text: '"This crew is too good to break up. There are other scores out there."',
                  choiceType: 'dilemma',
                  consequences: [
                    { type: 'attribute', attribute: 'courage', change: 5 },
                    { type: 'relationship', npcId: 'jules', dimension: 'affection', change: 10 },
                    { type: 'setFlag', flag: 'chose_continue', value: true },
                  ],
                  nextBeatId: 'choice-beat4-continue',
                },
                {
                  id: 'give-back-choice',
                  text: '"I\'ve been thinking. Maybe it\'s time to use these skills for something... better."',
                  choiceType: 'dilemma',
                  conditions: { type: 'tag', tag: 'merciful', hasTag: false },
                  consequences: [
                    { type: 'attribute', attribute: 'empathy', change: 10 },
                    { type: 'setFlag', flag: 'chose_redemption', value: true },
                  ],
                  nextBeatId: 'choice-beat4-redemption',
                },
              ],
            },
            {
              id: 'choice-beat4-retire',
              text: 'Jules nods slowly. "I can respect that. We all got what we came for." She raises her coffee cup. "To the Velvet Thieves. The best crew I ever worked with."',
              speaker: 'Jules',
              onShow: [
                { type: 'addTag', tag: 'retired_thief' },
                { type: 'removeTag', tag: 'thief' },
              ],
              nextBeatId: 'choice-beat5',
            },
            {
              id: 'choice-beat4-continue',
              text: 'Raven grins. "Now you\'re talking." Jules pulls out the Monaco file. Marcus cracks his knuckles. The crew is back in business.',
              speaker: 'Raven',
              conditions: { type: 'tag', tag: 'raven_ally', hasTag: true },
              onShow: [
                { type: 'addTag', tag: 'master_thief' },
              ],
              nextBeatId: 'choice-beat5',
            },
            {
              id: 'choice-beat4-redemption',
              text: 'The crew exchanges glances. "What do you mean?" Marcus asks carefully.',
              speaker: 'Marcus',
              nextBeatId: 'choice-beat4b-redemption',
            },
            {
              id: 'choice-beat4b-redemption',
              text: '"There are people out there who use their wealth to hurt others. People who hide behind lawyers and offshore accounts." You lean forward. "What if we took from them? And gave to people who actually need it?"',
              choices: [
                {
                  id: 'robin-hood',
                  text: '"Think about it. We\'d still be thieves. But we\'d be the good kind."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'jules', dimension: 'respect', change: 15 },
                    { type: 'relationship', npcId: 'marcus', dimension: 'trust', change: 10 },
                    { type: 'addTag', tag: 'robin_hood' },
                  ],
                  nextBeatId: 'choice-beat5-robin',
                },
              ],
            },
            {
              id: 'choice-beat5-robin',
              text: 'Jules smiles. "I always wanted to be a folk hero." Marcus nods slowly. "I\'m in. Time to steal from the right people."',
              speaker: 'Jules',
              nextBeatId: 'choice-beat5',
            },
            {
              id: 'choice-beat5',
              text: 'Whatever path you choose, one thing is certain: the Velvet Job changed everything. You came for a diamond. You left with something more.',
              nextSceneId: 'scene3-epilogue',
            },
          ],
        },

        {
          id: 'scene3-epilogue',
          name: 'Epilogue',
          startingBeatId: 'epilogue-beat1',
          beats: [
            {
              id: 'epilogue-beat1',
              text: 'Months later. The Celestine Diamond sits in a private collection in Geneva, its new owner none the wiser about its journey.',
              textVariants: [
                {
                  condition: { type: 'flag', flag: 'chose_retirement', value: true },
                  text: 'Months later. You\'re on a beach somewhere warm, a drink in hand, watching the sunset. The Celestine Diamond is just a memory now—a perfect, impossible memory.',
                },
                {
                  condition: { type: 'flag', flag: 'chose_continue', value: true },
                  text: 'Months later. Monaco. The crew watches a private gallery through binoculars. Jules runs the numbers. Marcus checks escape routes. The next score awaits.',
                },
                {
                  condition: { type: 'tag', tag: 'robin_hood', hasTag: true },
                  text: 'Months later. A pharmaceutical CEO discovers his offshore accounts have been emptied. The money reappears in a dozen free clinics across the city. No one knows who to thank.',
                },
              ],
              nextBeatId: 'epilogue-beat2',
            },
            {
              id: 'epilogue-beat2',
              text: 'Detective Shaw still hunts the Velvet Thieves. But legends are hard to catch.',
              textVariants: [
                {
                  condition: { type: 'flag', flag: 'made_deal', value: true },
                  text: 'Detective Shaw got her bigger fish. In exchange, certain charges were... quietly dropped. A fair trade. For now.',
                },
              ],
              nextBeatId: 'epilogue-beat3',
            },
            {
              id: 'epilogue-beat3',
              text: 'Victoria Ashworth serves three years for her role in the heist. She never talks. Some loyalties, it turns out, run deeper than fear.',
              textVariants: [
                {
                  condition: { type: 'flag', flag: 'victoria_betrayed', value: true },
                  text: 'Victoria Ashworth\'s deal with Shaw fell through when the crew vanished. She serves seven years. Sometimes, betrayal has consequences.',
                },
              ],
              nextBeatId: 'epilogue-beat4',
            },
            {
              id: 'epilogue-beat4',
              text: 'And you? You became exactly what you chose to be.',
              textVariants: [
                {
                  condition: { type: 'tag', tag: 'retired_thief', hasTag: true },
                  text: 'And you? You became a ghost. A legend whispered in underground circles. The one who pulled off the impossible—and walked away clean.',
                },
                {
                  condition: { type: 'tag', tag: 'master_thief', hasTag: true },
                  text: 'And you? You became the best in the world. Every heist impossible, until you made it look easy. The Velvet Thieves—a name that opens doors and empties vaults.',
                },
                {
                  condition: { type: 'tag', tag: 'robin_hood', hasTag: true },
                  text: 'And you? You became something new. A thief, yes—but one who steals only from those who deserve to lose. A modern-day Robin Hood with better tech.',
                },
              ],
              nextBeatId: 'epilogue-beat5',
            },
            {
              id: 'epilogue-beat5',
              text: 'The Velvet Job. The score of a lifetime.\n\nBut in this business, there\'s always another score.',
              onShow: [
                { type: 'addTag', tag: 'velvet_legend' },
                { type: 'removeTag', tag: 'crew_leader' },
              ],
            },
          ],
        },
      ],

      onComplete: [
        { type: 'attribute', attribute: 'resolve', change: 10 },
        { type: 'attribute', attribute: 'charm', change: 5 },
        { type: 'skill', skill: 'lockpicking', change: 5 },
        { type: 'skill', skill: 'stealth', change: 5 },
      ],
    },
  ],
};
