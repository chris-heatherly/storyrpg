import { Story } from '../../types';

/**
 * Blades of Valoria
 * A fantasy action story demonstrating the COMBAT encounter system.
 * Features a multi-phase sword duel with stat checks and consequences.
 */

export const bladesOfValoria: Story = {
  id: 'blades-of-valoria',
  title: 'Blades of Valoria',
  genre: 'Fantasy Action',
  synopsis:
    'As a wandering swordsman, you arrive in the city of Valoria seeking the tournament champion who murdered your mentor. Steel will clash, and only one will walk away.',
  coverImage: '',
  author: 'StoryRPG',
  tags: ['action', 'fantasy', 'combat', 'revenge'],

  initialState: {
    attributes: {
      charm: 40,
      wit: 50,
      courage: 65,
      empathy: 45,
      resolve: 60,
      resourcefulness: 50,
    },
    skills: {
      swordsmanship: 20,
      observation: 10,
    },
    tags: ['swordsman', 'seeking_revenge'],
    inventory: [
      {
        itemId: 'masters-blade',
        name: "Master's Blade",
        description: 'The sword of your fallen mentor. Its edge never dulls.',
        quantity: 1,
      },
    ],
  },

  npcs: [
    {
      id: 'kira',
      name: 'Kira Shadowmend',
      description:
        'The reigning tournament champion. Cold, calculating, and deadly with a blade.',
      initialRelationship: {
        trust: -50,
        affection: 0,
        respect: 30,
        fear: 20,
      },
    },
    {
      id: 'old-jin',
      name: 'Old Jin',
      description:
        'A retired swordmaster who runs a tea house near the arena. He knew your mentor.',
      initialRelationship: {
        trust: 20,
        affection: 30,
        respect: 10,
        fear: 0,
      },
    },
    {
      id: 'lord-varen',
      name: 'Lord Varen',
      description:
        'A powerful noble who controls much of Valoria from the shadows. His smile never reaches his eyes.',
      initialRelationship: {
        trust: 0,
        affection: 0,
        respect: 10,
        fear: 30,
      },
    },
    {
      id: 'mei',
      name: 'Mei Stormwind',
      description:
        'A wandering swordswoman from the eastern provinces. Quick-witted and quicker with a blade.',
      initialRelationship: {
        trust: 0,
        affection: 0,
        respect: 20,
        fear: 0,
      },
    },
    {
      id: 'arbiter-tao',
      name: 'Arbiter Tao',
      description:
        'The chief official of the Grand Tournament. A man of rigid honor who has seen too much corruption.',
      initialRelationship: {
        trust: 10,
        affection: 0,
        respect: 30,
        fear: 0,
      },
    },
  ],

  episodes: [
    {
      id: 'ep1-the-duel',
      number: 1,
      title: 'The Duel',
      synopsis:
        'You confront Kira Shadowmend in the arena. Only one will emerge victorious.',
      coverImage: '',
      startingSceneId: 'scene1-arena-entrance',

      scenes: [
        // Scene 1: Arena Entrance
        {
          id: 'scene1-arena-entrance',
          name: 'The Arena',
          startingBeatId: 'arena-beat1',
          beats: [
            {
              id: 'arena-beat1',
              text: "The roar of the crowd washes over you as you step into the Grand Arena of Valoria. Thousands of spectators fill the stone seats, their voices blending into a thunderous wall of sound.\n\nAcross the sand-covered floor stands your quarry: Kira Shadowmend, the tournament champion. The one who cut down your mentor three years ago.",
              nextBeatId: 'arena-beat2',
            },
            {
              id: 'arena-beat2',
              text: 'Kira\'s eyes find yours across the arena. A cold smile crosses her face.\n\n"So the student finally arrives," she calls out, her voice carrying easily over the crowd. "I wondered how long it would take you to find me."',
              speaker: 'Kira',
              speakerMood: 'mocking',
              nextBeatId: 'arena-beat3',
            },
            {
              id: 'arena-beat3',
              text: 'You draw your blade—your master\'s blade—and feel its familiar weight in your hand. The crowd falls silent, sensing what is about to unfold.',
              choices: [
                {
                  id: 'respond-calm',
                  text: '"Three years I\'ve trained for this moment. Let\'s end it."',
                  choiceType: 'strategic',
                  statCheck: {
                    attribute: 'resolve',
                    difficulty: 40,
                  },
                  consequences: [
                    { type: 'attribute', attribute: 'resolve', change: 3 },
                    { type: 'relationship', npcId: 'kira', dimension: 'respect', change: 10 },
                  ],
                  nextBeatId: 'arena-beat4',
                },
                {
                  id: 'respond-angry',
                  text: '"You\'ll pay for what you did to Master Hiro!"',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'courage', change: 5 },
                    { type: 'relationship', npcId: 'kira', dimension: 'fear', change: -5 },
                  ],
                  nextBeatId: 'arena-beat4',
                },
                {
                  id: 'respond-silent',
                  text: 'Say nothing. Let your blade speak for you.',
                  choiceType: 'expression',
                  statCheck: {
                    attribute: 'wit',
                    difficulty: 35,
                  },
                  consequences: [
                    { type: 'skill', skill: 'swordsmanship', change: 2 },
                    { type: 'relationship', npcId: 'kira', dimension: 'respect', change: 15 },
                  ],
                  nextBeatId: 'arena-beat4',
                },
              ],
            },
            {
              id: 'arena-beat4',
              text: "Kira draws her own weapon—a slender curved blade that gleams like moonlight. She takes her stance, and you take yours.\n\nThe arena master's voice booms: \"BEGIN!\"",
              nextSceneId: 'scene2-the-duel',
            },
          ],
        },

        // Scene 2: The Combat Encounter
        {
          id: 'scene2-the-duel',
          name: 'The Duel',
          startingBeatId: 'duel-start',
          beats: [], // Empty because this scene uses an encounter

          encounter: {
            id: 'kira-duel',
            type: 'combat',
            name: 'Duel with Kira Shadowmend',
            description: 'A deadly sword duel in the Grand Arena',

            phases: [
              // Phase 1: Opening Exchange
              {
                id: 'phase1-opening',
                name: 'Opening Exchange',
                description:
                  'You circle each other, testing defenses with probing strikes.',
                situationImage: '',
                successThreshold: 4,
                failureThreshold: -2,

                beats: [
                  {
                    id: 'p1-beat1',
                    text: "Kira moves first, her blade a silver blur. You barely deflect the strike, the impact jarring your arm. She's fast—faster than you expected.",
                    nextBeatId: 'p1-beat2',
                  },
                  {
                    id: 'p1-beat2',
                    text: 'She presses her advantage with a flurry of cuts. You need to respond.',
                    choices: [
                      {
                        id: 'p1-parry',
                        text: 'Focus on defense, looking for an opening',
                        choiceType: 'strategic',
                        statCheck: {
                          skill: 'swordsmanship',
                          difficulty: 45,
                        },
                        consequences: [
                          { type: 'skill', skill: 'observation', change: 2 },
                        ],
                        nextBeatId: 'p1-beat3',
                      },
                      {
                        id: 'p1-counter',
                        text: 'Meet her aggression with your own',
                        choiceType: 'strategic',
                        statCheck: {
                          attribute: 'courage',
                          difficulty: 50,
                        },
                        consequences: [
                          { type: 'attribute', attribute: 'courage', change: 2 },
                        ],
                        nextBeatId: 'p1-beat3',
                      },
                      {
                        id: 'p1-feint',
                        text: 'Use a feint to throw off her rhythm',
                        choiceType: 'strategic',
                        statCheck: {
                          attribute: 'wit',
                          difficulty: 40,
                        },
                        consequences: [
                          { type: 'skill', skill: 'swordsmanship', change: 3 },
                        ],
                        nextBeatId: 'p1-beat3',
                      },
                    ],
                  },
                  {
                    id: 'p1-beat3',
                    text: 'Steel rings against steel as you exchange a rapid series of blows. The crowd gasps at each near miss.',
                    choices: [
                      {
                        id: 'p1-press',
                        text: 'Press the attack while you have momentum',
                        choiceType: 'strategic',
                        statCheck: {
                          skill: 'swordsmanship',
                          difficulty: 50,
                        },
                        nextBeatId: 'p1-beat4',
                      },
                      {
                        id: 'p1-study',
                        text: 'Study her technique for weaknesses',
                        choiceType: 'strategic',
                        statCheck: {
                          skill: 'observation',
                          difficulty: 35,
                        },
                        consequences: [
                          { type: 'setFlag', flag: 'spotted_weakness', value: true },
                        ],
                        nextBeatId: 'p1-beat4',
                      },
                    ],
                  },
                  {
                    id: 'p1-beat4',
                    text: 'You both disengage, circling again. The first exchange is over.',
                  },
                ],

                onSuccess: {
                  nextPhaseId: 'phase2-turning',
                  outcomeText:
                    "You've matched her blow for blow. A flicker of surprise crosses Kira's face—she underestimated you.",
                  consequences: [
                    { type: 'relationship', npcId: 'kira', dimension: 'respect', change: 10 },
                  ],
                },
                onFailure: {
                  nextPhaseId: 'phase2-turning',
                  outcomeText:
                    "Blood runs from a cut on your arm. Kira smiles. \"Is that all you have?\"",
                  consequences: [
                    { type: 'attribute', attribute: 'resolve', change: -5 },
                  ],
                },
              },

              // Phase 2: The Turning Point
              {
                id: 'phase2-turning',
                name: 'The Turning Point',
                description:
                  'The duel intensifies. One mistake could be fatal.',
                situationImage: '',
                successThreshold: 5,
                failureThreshold: -3,

                beats: [
                  {
                    id: 'p2-beat1',
                    text: "Kira's attacks become more aggressive, more reckless. She's trying to end this quickly.",
                    textVariants: [
                      {
                        condition: {
                          type: 'flag',
                          flag: 'spotted_weakness',
                          value: true,
                        },
                        text: "Kira's attacks become more aggressive—and now you see it. A slight hesitation when she transitions from high guard to low. The weakness your master taught you to exploit.",
                      },
                    ],
                    nextBeatId: 'p2-beat2',
                  },
                  {
                    id: 'p2-beat2',
                    text: 'She launches into a devastating combination.',
                    choices: [
                      {
                        id: 'p2-exploit',
                        text: 'Exploit the weakness you spotted',
                        choiceType: 'strategic',
                        conditions: {
                          type: 'flag',
                          flag: 'spotted_weakness',
                          value: true,
                        },
                        statCheck: {
                          skill: 'swordsmanship',
                          difficulty: 35,
                        },
                        consequences: [
                          { type: 'changeScore', score: 'duel_advantage', change: 3 },
                        ],
                        nextBeatId: 'p2-beat3',
                      },
                      {
                        id: 'p2-endure',
                        text: 'Dig deep and endure the assault',
                        choiceType: 'strategic',
                        statCheck: {
                          attribute: 'resolve',
                          difficulty: 55,
                        },
                        nextBeatId: 'p2-beat3',
                      },
                      {
                        id: 'p2-risky',
                        text: 'Attempt a risky counter-strike',
                        choiceType: 'strategic',
                        statCheck: {
                          attribute: 'courage',
                          difficulty: 60,
                        },
                        consequences: [
                          { type: 'attribute', attribute: 'courage', change: 5 },
                        ],
                        nextBeatId: 'p2-beat3',
                      },
                    ],
                  },
                  {
                    id: 'p2-beat3',
                    text: "\"You fight like him,\" Kira hisses between strikes. \"Hiro taught you well. But he couldn't defeat me either.\"",
                    speaker: 'Kira',
                    speakerMood: 'taunting',
                    choices: [
                      {
                        id: 'p2-focus',
                        text: 'Block out her words. Stay focused.',
                        choiceType: 'strategic',
                        statCheck: {
                          attribute: 'resolve',
                          difficulty: 45,
                        },
                        consequences: [
                          { type: 'attribute', attribute: 'resolve', change: 3 },
                        ],
                        nextBeatId: 'p2-beat4',
                      },
                      {
                        id: 'p2-channel',
                        text: 'Channel your anger into your blade',
                        choiceType: 'strategic',
                        statCheck: {
                          attribute: 'courage',
                          difficulty: 50,
                        },
                        consequences: [
                          { type: 'skill', skill: 'swordsmanship', change: 3 },
                        ],
                        nextBeatId: 'p2-beat4',
                      },
                    ],
                  },
                  {
                    id: 'p2-beat4',
                    text: "Your blades lock. You're face to face with your mentor's killer.",
                  },
                ],

                onSuccess: {
                  nextPhaseId: 'phase3-finale',
                  outcomeText:
                    "You break the lock and drive Kira back. For the first time, you see fear in her eyes. The tide has turned.",
                  consequences: [
                    { type: 'relationship', npcId: 'kira', dimension: 'fear', change: 20 },
                    { type: 'setFlag', flag: 'has_advantage', value: true },
                  ],
                },
                onFailure: {
                  nextPhaseId: 'phase3-finale',
                  outcomeText:
                    "Kira's knee drives into your stomach. You stagger back, gasping. She's winning.",
                  consequences: [
                    { type: 'attribute', attribute: 'resolve', change: -5 },
                    { type: 'setFlag', flag: 'has_advantage', value: false },
                  ],
                },
              },

              // Phase 3: The Finale
              {
                id: 'phase3-finale',
                name: 'The Final Exchange',
                description: 'Everything comes down to this moment.',
                situationImage: '',
                successThreshold: 4,
                failureThreshold: -2,

                beats: [
                  {
                    id: 'p3-beat1',
                    text: "Both of you are breathing hard now. Sweat and blood mingle on the arena sand. This ends now.",
                    textVariants: [
                      {
                        condition: {
                          type: 'flag',
                          flag: 'has_advantage',
                          value: true,
                        },
                        text: "Both of you are breathing hard now, but Kira is flagging. Her movements are slower, her guard dropping. You have her.",
                      },
                    ],
                    nextBeatId: 'p3-beat2',
                  },
                  {
                    id: 'p3-beat2',
                    text: 'Kira raises her blade for one final assault.',
                    choices: [
                      {
                        id: 'p3-masters-technique',
                        text: "Use the technique your master taught you",
                        choiceType: 'strategic',
                        statCheck: {
                          skill: 'swordsmanship',
                          difficulty: 45,
                        },
                        consequences: [
                          { type: 'skill', skill: 'swordsmanship', change: 5 },
                        ],
                        nextBeatId: 'p3-beat3',
                      },
                      {
                        id: 'p3-everything',
                        text: 'Put everything into one decisive strike',
                        choiceType: 'strategic',
                        statCheck: {
                          attribute: 'courage',
                          difficulty: 55,
                        },
                        nextBeatId: 'p3-beat3',
                      },
                      {
                        id: 'p3-wait',
                        text: 'Wait for her to commit, then strike',
                        choiceType: 'strategic',
                        statCheck: {
                          attribute: 'wit',
                          difficulty: 50,
                        },
                        consequences: [
                          { type: 'skill', skill: 'observation', change: 3 },
                        ],
                        nextBeatId: 'p3-beat3',
                      },
                    ],
                  },
                  {
                    id: 'p3-beat3',
                    text: 'Time seems to slow as you both move. Steel flashes in the sunlight. The crowd holds its breath.',
                  },
                ],

                onSuccess: {
                  outcomeText:
                    "Your blade finds its mark. Kira's weapon clatters to the sand as she falls to her knees, defeated. The crowd erupts.",
                  consequences: [
                    { type: 'setFlag', flag: 'defeated_kira', value: true },
                    { type: 'addTag', tag: 'tournament_champion' },
                    { type: 'skill', skill: 'swordsmanship', change: 10 },
                  ],
                },
                onFailure: {
                  outcomeText:
                    "Pain explodes in your side. You fall to one knee, Kira's blade at your throat. \"Yield,\" she demands. You have no choice.",
                  consequences: [
                    { type: 'setFlag', flag: 'defeated_by_kira', value: true },
                    { type: 'attribute', attribute: 'resolve', change: -10 },
                  ],
                },
              },
            ],

            startingPhaseId: 'phase1-opening',

            outcomes: {
              victory: {
                nextSceneId: 'scene3-aftermath-victory',
                consequences: [
                  { type: 'relationship', npcId: 'kira', dimension: 'respect', change: 30 },
                ],
              },
              defeat: {
                nextSceneId: 'scene3-aftermath-defeat',
                consequences: [
                  { type: 'relationship', npcId: 'kira', dimension: 'fear', change: 10 },
                ],
              },
            },
          },
        },

        // Scene 3a: Victory Aftermath
        {
          id: 'scene3-aftermath-victory',
          name: 'Victory',
          startingBeatId: 'victory-beat1',
          conditions: {
            type: 'flag',
            flag: 'defeated_kira',
            value: true,
          },
          beats: [
            {
              id: 'victory-beat1',
              text: "Kira kneels in the sand, blood dripping from a wound on her shoulder. Your blade hovers at her neck. The crowd chants your name, but you barely hear them.\n\nThree years. Three years of training, of hunting, of waiting. And now it's over.",
              nextBeatId: 'victory-beat2',
            },
            {
              id: 'victory-beat2',
              text: '"Do it," Kira says quietly. "I killed your master. I deserve death."',
              speaker: 'Kira',
              speakerMood: 'resigned',
              choices: [
                {
                  id: 'spare-kira',
                  text: 'Lower your blade. "Killing you won\'t bring him back."',
                  choiceType: 'dilemma',
                  consequences: [
                    { type: 'attribute', attribute: 'empathy', change: 10 },
                    { type: 'relationship', npcId: 'kira', dimension: 'trust', change: 30 },
                    { type: 'setFlag', flag: 'spared_kira', value: true },
                    { type: 'removeTag', tag: 'seeking_revenge' },
                    { type: 'addTag', tag: 'merciful' },
                  ],
                  nextBeatId: 'victory-beat3-spare',
                },
                {
                  id: 'kill-kira',
                  text: 'End it. She showed your master no mercy.',
                  choiceType: 'dilemma',
                  consequences: [
                    { type: 'attribute', attribute: 'resolve', change: 5 },
                    { type: 'attribute', attribute: 'empathy', change: -10 },
                    { type: 'setFlag', flag: 'killed_kira', value: true },
                    { type: 'addTag', tag: 'killer' },
                  ],
                  nextBeatId: 'victory-beat3-kill',
                },
              ],
            },
            {
              id: 'victory-beat3-spare',
              text: "You step back, sheathing your blade. Kira looks up at you with something like wonder.\n\n\"Your master would be proud,\" she says. \"He always believed in mercy. I never understood why... until now.\"\n\nThe crowd's cheers wash over you. You've won more than just a duel today.",
            },
            {
              id: 'victory-beat3-kill',
              text: "Your blade falls. The crowd goes silent.\n\nIt's done. Your master is avenged. But as you look down at Kira's still form, you feel... empty. Is this what you trained three years for?\n\nYou sheathe your blade and walk away. The crowd parts before you in fearful silence.",
            },
          ],
        },

        // Scene 3b: Defeat Aftermath
        {
          id: 'scene3-aftermath-defeat',
          name: 'Defeat',
          startingBeatId: 'defeat-beat1',
          conditions: {
            type: 'flag',
            flag: 'defeated_by_kira',
            value: true,
          },
          beats: [
            {
              id: 'defeat-beat1',
              text: "Kira's blade presses against your throat. One twitch and it's over. The crowd watches in hushed anticipation.",
              nextBeatId: 'defeat-beat2',
            },
            {
              id: 'defeat-beat2',
              text: '"You fought well," Kira says. "Better than your master, in fact. He was too merciful. You have fire." She withdraws her blade.\n\n"Train harder. Come find me again when you\'re ready. Maybe next time will be different."',
              speaker: 'Kira',
              speakerMood: 'respectful',
              nextBeatId: 'defeat-beat3',
              onShow: [
                { type: 'relationship', npcId: 'kira', dimension: 'respect', change: 20 },
              ],
            },
            {
              id: 'defeat-beat3',
              text: "She turns and walks away, leaving you kneeling in the sand. The crowd disperses, murmuring.\n\nYou've lost this battle. But the war isn't over. Next time, you'll be ready.",
              onShow: [
                { type: 'addTag', tag: 'seeking_rematch' },
              ],
            },
          ],
        },
      ],

      onComplete: [
        { type: 'skill', skill: 'swordsmanship', change: 5 },
      ],
    },

    // Episode 2: The Truth
    {
      id: 'ep2-the-truth',
      number: 2,
      title: 'The Truth',
      synopsis: 'In the aftermath of the duel, secrets about your master\'s death begin to surface.',
      coverImage: '',
      startingSceneId: 'scene1-aftermath',

      scenes: [
        {
          id: 'scene1-aftermath',
          name: 'The Morning After',
          startingBeatId: 'aftermath-beat1',
          beats: [
            {
              id: 'aftermath-beat1',
              text: 'Dawn breaks over Valoria. You sit in Old Jin\'s tea house, your wounds bandaged, staring into a cup of cooling tea.',
              textVariants: [
                {
                  condition: { type: 'flag', flag: 'defeated_kira', value: true },
                  text: 'Dawn breaks over Valoria. You sit in Old Jin\'s tea house as the new tournament champion, your wounds bandaged, staring into a cup of cooling tea. The weight of yesterday\'s victory—and the choice you made—settles heavy on your shoulders.',
                },
              ],
              nextBeatId: 'aftermath-beat2',
            },
            {
              id: 'aftermath-beat2',
              text: 'Old Jin sets down a fresh pot. "You look troubled, young one. Is this not what you wanted?"',
              speaker: 'Old Jin',
              speakerMood: 'concerned',
              choices: [
                {
                  id: 'confide-jin',
                  text: '"I thought revenge would feel different. Now I just have questions."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'old-jin', dimension: 'trust', change: 10 },
                    { type: 'attribute', attribute: 'empathy', change: 3 },
                  ],
                  nextBeatId: 'aftermath-beat3',
                },
                {
                  id: 'deflect-jin',
                  text: '"I\'m fine. Just tired."',
                  choiceType: 'expression',
                  consequences: [
                    { type: 'attribute', attribute: 'resolve', change: 2 },
                  ],
                  nextBeatId: 'aftermath-beat3',
                },
              ],
            },
            {
              id: 'aftermath-beat3',
              text: 'Jin studies you for a long moment. "There\'s something I should have told you before the duel. About Hiro... and why he really died."',
              speaker: 'Old Jin',
              speakerMood: 'serious',
              onShow: [
                { type: 'setFlag', flag: 'jin_revelation', value: true },
              ],
              nextBeatId: 'aftermath-beat4',
            },
            {
              id: 'aftermath-beat4',
              text: '"Kira didn\'t kill your master for glory or rivalry. She was ordered to. By Lord Varen."',
              speaker: 'Old Jin',
              speakerMood: 'grim',
              nextBeatId: 'aftermath-beat5',
            },
            {
              id: 'aftermath-beat5',
              text: 'The name hits you like a physical blow. Lord Varen—one of the most powerful nobles in Valoria. A man who controls the tournament, the city guard, and half the merchants in the city.',
              choices: [
                {
                  id: 'demand-proof',
                  text: '"How do you know this? Do you have proof?"',
                  choiceType: 'strategic',
                  statCheck: { attribute: 'wit', difficulty: 35 },
                  consequences: [
                    { type: 'attribute', attribute: 'wit', change: 3 },
                    { type: 'setFlag', flag: 'asked_for_proof', value: true },
                  ],
                  nextBeatId: 'aftermath-beat6',
                },
                {
                  id: 'ask-why',
                  text: '"Why would Varen want my master dead?"',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'skill', skill: 'observation', change: 2 },
                  ],
                  nextBeatId: 'aftermath-beat6-why',
                },
                {
                  id: 'angry-response',
                  text: '"Why didn\'t you tell me this before I fought Kira?!"',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'old-jin', dimension: 'trust', change: -5 },
                    { type: 'attribute', attribute: 'courage', change: 3 },
                  ],
                  nextBeatId: 'aftermath-beat6-angry',
                },
              ],
            },
            {
              id: 'aftermath-beat6',
              text: '"I have letters. Hiro gave them to me before he died, in case..." Jin pauses. "In case something happened to him. He knew Varen was coming for him."',
              speaker: 'Old Jin',
              onShow: [
                { type: 'addItem', itemId: 'masters-letters', name: "Master's Letters", description: 'Correspondence between Hiro and an unknown ally, detailing Lord Varen\'s corruption.' },
              ],
              nextBeatId: 'aftermath-beat7',
            },
            {
              id: 'aftermath-beat6-why',
              text: '"Your master discovered something. A conspiracy involving Varen, the tournament, and something far darker. He was going to expose it all."',
              speaker: 'Old Jin',
              nextBeatId: 'aftermath-beat7',
            },
            {
              id: 'aftermath-beat6-angry',
              text: 'Jin bows his head. "Because you weren\'t ready to hear it. You needed to face Kira with a clear purpose, not divided loyalties. I am sorry."',
              speaker: 'Old Jin',
              nextBeatId: 'aftermath-beat7',
            },
            {
              id: 'aftermath-beat7',
              text: 'The tea house door slides open. A figure in travel-worn clothes steps inside—a woman with a curved blade at her hip and sharp, assessing eyes.',
              nextBeatId: 'aftermath-beat8',
            },
            {
              id: 'aftermath-beat8',
              text: '"Old Jin. I heard you might know where to find a certain swordsman." Her gaze falls on you. "Ah. Found them."',
              speaker: 'Mei',
              speakerMood: 'wry',
              choices: [
                {
                  id: 'greet-mei-friendly',
                  text: '"And who might you be?"',
                  choiceType: 'expression',
                  consequences: [
                    { type: 'relationship', npcId: 'mei', dimension: 'trust', change: 5 },
                    { type: 'attribute', attribute: 'charm', change: 2 },
                  ],
                  nextBeatId: 'meet-mei',
                },
                {
                  id: 'greet-mei-suspicious',
                  text: 'Rest your hand on your blade. "Choose your next words carefully."',
                  choiceType: 'expression',
                  consequences: [
                    { type: 'relationship', npcId: 'mei', dimension: 'respect', change: 5 },
                    { type: 'attribute', attribute: 'courage', change: 2 },
                  ],
                  nextBeatId: 'meet-mei',
                },
              ],
            },
            {
              id: 'meet-mei',
              text: '"Mei Stormwind. I\'ve been tracking Lord Varen\'s operations for two years. Your master was one of my informants." She pulls up a chair. "We have a common enemy."',
              speaker: 'Mei',
              onShow: [
                { type: 'relationship', npcId: 'mei', dimension: 'trust', change: 10 },
              ],
              nextSceneId: 'scene2-alliance',
            },
          ],
        },

        {
          id: 'scene2-alliance',
          name: 'An Unlikely Alliance',
          startingBeatId: 'alliance-beat1',
          beats: [
            {
              id: 'alliance-beat1',
              text: 'Mei spreads a worn map across the table, marking locations with practiced efficiency. "Varen runs a blood sport ring beneath the tournament. Fighters who lose are sold, or worse."',
              speaker: 'Mei',
              nextBeatId: 'alliance-beat2',
            },
            {
              id: 'alliance-beat2',
              text: '"Your master was close to exposing it all. That\'s why Varen had him killed."',
              speaker: 'Mei',
              speakerMood: 'serious',
              choices: [
                {
                  id: 'join-mei',
                  text: '"Then we finish what he started. I\'m in."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'mei', dimension: 'trust', change: 15 },
                    { type: 'attribute', attribute: 'courage', change: 5 },
                    { type: 'setFlag', flag: 'allied_with_mei', value: true },
                  ],
                  nextBeatId: 'alliance-beat3',
                },
                {
                  id: 'cautious-response',
                  text: '"I want Varen to pay, but I need to know more before I commit."',
                  choiceType: 'strategic',
                  statCheck: { attribute: 'wit', difficulty: 40 },
                  consequences: [
                    { type: 'attribute', attribute: 'wit', change: 3 },
                    { type: 'relationship', npcId: 'mei', dimension: 'respect', change: 5 },
                  ],
                  nextBeatId: 'alliance-beat3-cautious',
                },
              ],
            },
            {
              id: 'alliance-beat3',
              text: 'Mei nods approvingly. "Good. We\'ll need your sword—and your new reputation. The tournament champion can go places I cannot."',
              speaker: 'Mei',
              textVariants: [
                {
                  condition: { type: 'flag', flag: 'defeated_by_kira', value: true },
                  text: 'Mei nods approvingly. "Good. Even in defeat, you showed skill. Varen likes to recruit promising fighters. We can use that."',
                },
              ],
              nextBeatId: 'alliance-beat4',
            },
            {
              id: 'alliance-beat3-cautious',
              text: '"Fair enough. Ask your questions. But know that every day we wait, more fighters disappear into Varen\'s operation."',
              speaker: 'Mei',
              nextBeatId: 'alliance-beat4',
            },
            {
              id: 'alliance-beat4',
              text: 'Old Jin clears his throat. "There is another matter. Kira Shadowmend."',
              speaker: 'Old Jin',
              textVariants: [
                {
                  condition: { type: 'flag', flag: 'killed_kira', value: true },
                  text: 'Old Jin clears his throat. "There is another matter. Kira is dead, which means Varen has lost his best enforcer. He\'ll be looking for a replacement—or revenge."',
                },
              ],
              nextBeatId: 'alliance-beat5',
            },
            {
              id: 'alliance-beat5',
              text: '"She was Varen\'s weapon for years. But she was also his prisoner. Her family\'s debts bound her to his service."',
              speaker: 'Old Jin',
              speakerMood: 'sympathetic',
              conditions: { type: 'flag', flag: 'killed_kira', value: false },
              nextBeatId: 'alliance-beat6',
            },
            {
              id: 'alliance-beat6',
              text: 'Mei leans forward. "If Kira still lives, she could be an asset. She knows Varen\'s operations better than anyone."',
              speaker: 'Mei',
              conditions: { type: 'flag', flag: 'spared_kira', value: true },
              choices: [
                {
                  id: 'seek-kira',
                  text: '"I spared her life. Maybe she\'ll return the favor."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'setFlag', flag: 'will_recruit_kira', value: true },
                    { type: 'attribute', attribute: 'empathy', change: 3 },
                  ],
                  nextBeatId: 'alliance-beat7',
                },
                {
                  id: 'reject-kira',
                  text: '"She killed my master. I won\'t work with her."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'resolve', change: 5 },
                    { type: 'setFlag', flag: 'rejected_kira', value: true },
                  ],
                  nextBeatId: 'alliance-beat7-reject',
                },
              ],
            },
            {
              id: 'alliance-beat7',
              text: '"Then we have a plan. Find Kira, gather what allies we can, and bring Varen down." Mei extends her hand.',
              speaker: 'Mei',
              nextBeatId: 'alliance-beat8',
            },
            {
              id: 'alliance-beat7-reject',
              text: '"Your choice. But we\'ll need all the help we can get." Mei\'s expression is unreadable. "We should move. Varen will have heard about the duel by now."',
              speaker: 'Mei',
              nextBeatId: 'alliance-beat8',
            },
            {
              id: 'alliance-beat8',
              text: 'You clasp her hand. An alliance is formed—forged not in friendship, but in shared purpose. Somewhere in this city, Lord Varen sits in his manor, unaware that his reckoning is coming.',
              onShow: [
                { type: 'addTag', tag: 'conspiracy_hunter' },
              ],
            },
          ],
        },
      ],

      onComplete: [
        { type: 'attribute', attribute: 'resolve', change: 5 },
      ],
    },

    // Episode 3: Gathering Storm
    {
      id: 'ep3-gathering-storm',
      number: 3,
      title: 'Gathering Storm',
      synopsis: 'To challenge Varen, you must first build your strength. The underground tournament offers both opportunity and danger.',
      coverImage: '',
      startingSceneId: 'scene1-underground',

      scenes: [
        {
          id: 'scene1-underground',
          name: 'The Pit',
          startingBeatId: 'pit-beat1',
          beats: [
            {
              id: 'pit-beat1',
              text: 'Three days later, Mei leads you through winding streets to an unmarked door. "The Pit. Varen\'s underground fighting ring. This is where the disappeared fighters end up."',
              speaker: 'Mei',
              nextBeatId: 'pit-beat2',
            },
            {
              id: 'pit-beat2',
              text: 'The stench of blood and sweat hits you as you descend. A crowd surrounds a sand-covered ring where two fighters circle each other, both bearing fresh wounds.',
              nextBeatId: 'pit-beat3',
            },
            {
              id: 'pit-beat3',
              text: '"To get close to Varen, you need to fight here. Win enough matches, and you\'ll catch his attention."',
              speaker: 'Mei',
              choices: [
                {
                  id: 'accept-plan',
                  text: '"I didn\'t come this far to back down now."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'courage', change: 5 },
                    { type: 'setFlag', flag: 'entered_pit', value: true },
                  ],
                  nextBeatId: 'pit-beat4',
                },
                {
                  id: 'question-plan',
                  text: '"Isn\'t there another way? This feels like walking into a trap."',
                  choiceType: 'strategic',
                  statCheck: { attribute: 'wit', difficulty: 45 },
                  consequences: [
                    { type: 'attribute', attribute: 'wit', change: 3 },
                  ],
                  nextBeatId: 'pit-beat4-alt',
                },
              ],
            },
            {
              id: 'pit-beat4',
              text: 'A scarred man approaches—the Pitmaster. His eyes gleam with recognition. "The tournament champion, slumming it with us? Or is it the one who lost to Kira? Either way, fresh meat."',
              nextBeatId: 'pit-beat5',
            },
            {
              id: 'pit-beat4-alt',
              text: 'Mei shakes her head. "This is the fastest path to Varen. Trust me." Before you can respond, a scarred man approaches—the Pitmaster.',
              nextBeatId: 'pit-beat5',
            },
            {
              id: 'pit-beat5',
              text: '"You want to fight? Tonight\'s match is about to start. Opponent\'s already waiting."',
              choices: [
                {
                  id: 'fight-now',
                  text: '"I\'m ready."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'courage', change: 3 },
                  ],
                  nextSceneId: 'scene2-first-fight',
                },
                {
                  id: 'scout-first',
                  text: '"I want to see how things work here first."',
                  choiceType: 'strategic',
                  statCheck: { attribute: 'wit', difficulty: 35 },
                  consequences: [
                    { type: 'skill', skill: 'observation', change: 3 },
                    { type: 'setFlag', flag: 'scouted_pit', value: true },
                  ],
                  nextBeatId: 'pit-beat6',
                },
              ],
            },
            {
              id: 'pit-beat6',
              text: 'You watch the current match unfold. The fighters use dirty tricks—sand in the eyes, hidden blades. This isn\'t honorable combat. It\'s survival.',
              nextBeatId: 'pit-beat7',
            },
            {
              id: 'pit-beat7',
              text: 'One fighter falls, and guards drag them away. Not to a healer—deeper into the tunnels. The crowd cheers.',
              onShow: [
                { type: 'setFlag', flag: 'witnessed_pit_horrors', value: true },
              ],
              nextSceneId: 'scene2-first-fight',
            },
          ],
        },

        {
          id: 'scene2-first-fight',
          name: 'Trial by Combat',
          startingBeatId: 'fight-start',
          beats: [],
          encounter: {
            id: 'pit-fight',
            type: 'combat',
            name: 'Pit Fight',
            description: 'A brutal fight in the underground arena',
            phases: [
              {
                id: 'phase1-pit',
                name: 'The Opening',
                description: 'Your opponent wastes no time with formalities.',
                situationImage: '',
                successThreshold: 3,
                failureThreshold: -2,
                beats: [
                  {
                    id: 'pf-beat1',
                    text: 'Your opponent is a heavyset man with arms like tree trunks. He grins, revealing broken teeth. "Pretty sword you got there. I\'ll take it when you\'re done."',
                    nextBeatId: 'pf-beat2',
                  },
                  {
                    id: 'pf-beat2',
                    text: 'He charges without warning, swinging a brutal mace.',
                    choices: [
                      {
                        id: 'pf-dodge',
                        text: 'Sidestep and counter',
                        choiceType: 'strategic',
                        statCheck: { skill: 'swordsmanship', difficulty: 40 },
                        consequences: [
                          { type: 'skill', skill: 'swordsmanship', change: 2 },
                        ],
                        nextBeatId: 'pf-beat3',
                      },
                      {
                        id: 'pf-block',
                        text: 'Stand your ground and deflect',
                        choiceType: 'strategic',
                        statCheck: { attribute: 'resolve', difficulty: 45 },
                        consequences: [
                          { type: 'attribute', attribute: 'resolve', change: 2 },
                        ],
                        nextBeatId: 'pf-beat3',
                      },
                      {
                        id: 'pf-dirty',
                        text: 'Throw sand in his eyes first',
                        choiceType: 'strategic',
                        conditions: { type: 'flag', flag: 'scouted_pit', value: true },
                        statCheck: { attribute: 'wit', difficulty: 30 },
                        consequences: [
                          { type: 'attribute', attribute: 'resourcefulness', change: 3 },
                          { type: 'changeScore', score: 'pit_reputation', change: 5 },
                        ],
                        nextBeatId: 'pf-beat3',
                      },
                    ],
                  },
                  {
                    id: 'pf-beat3',
                    text: 'The crowd roars as you exchange blows. This is nothing like the tournament—no rules, no honor.',
                  },
                ],
                onSuccess: {
                  nextPhaseId: 'phase2-pit',
                  outcomeText: 'You land a solid hit, driving him back. Blood drips from a wound on his arm.',
                  consequences: [
                    { type: 'changeScore', score: 'pit_wins', change: 1 },
                  ],
                },
                onFailure: {
                  nextPhaseId: 'phase2-pit',
                  outcomeText: 'His mace clips your shoulder. Pain flares, but you stay on your feet.',
                  consequences: [
                    { type: 'attribute', attribute: 'resolve', change: -3 },
                  ],
                },
              },
              {
                id: 'phase2-pit',
                name: 'Desperate Measures',
                description: 'The fight grows more brutal.',
                situationImage: '',
                successThreshold: 4,
                failureThreshold: -3,
                beats: [
                  {
                    id: 'pf2-beat1',
                    text: 'He pulls a hidden knife from his boot. "Nothing personal. Just business."',
                    nextBeatId: 'pf2-beat2',
                  },
                  {
                    id: 'pf2-beat2',
                    text: 'He comes at you with both weapons, mace and knife weaving a deadly pattern.',
                    choices: [
                      {
                        id: 'pf2-skill',
                        text: 'Use your superior technique to disarm him',
                        choiceType: 'strategic',
                        statCheck: { skill: 'swordsmanship', difficulty: 50 },
                        consequences: [
                          { type: 'skill', skill: 'swordsmanship', change: 3 },
                        ],
                        nextBeatId: 'pf2-beat3',
                      },
                      {
                        id: 'pf2-endure',
                        text: 'Weather the assault and wait for an opening',
                        choiceType: 'strategic',
                        statCheck: { attribute: 'resolve', difficulty: 55 },
                        nextBeatId: 'pf2-beat3',
                      },
                    ],
                  },
                  {
                    id: 'pf2-beat3',
                    text: 'The crowd screams for blood. Your blood, his—they don\'t care which.',
                  },
                ],
                onSuccess: {
                  outcomeText: 'Your blade finds its mark. He falls to his knees, and the crowd erupts. Victory.',
                  consequences: [
                    { type: 'changeScore', score: 'pit_wins', change: 1 },
                    { type: 'attribute', attribute: 'courage', change: 5 },
                  ],
                },
                onFailure: {
                  outcomeText: 'A lucky strike sends your blade spinning away. You\'re at his mercy—but the bell rings. "Time! Draw!"',
                  consequences: [
                    { type: 'attribute', attribute: 'resolve', change: -5 },
                  ],
                },
              },
            ],
            startingPhaseId: 'phase1-pit',
            outcomes: {
              victory: {
                nextSceneId: 'scene3-recognition',
                consequences: [
                  { type: 'skill', skill: 'swordsmanship', change: 5 },
                  { type: 'addTag', tag: 'pit_fighter' },
                ],
              },
              defeat: {
                nextSceneId: 'scene3-recognition',
                consequences: [
                  { type: 'attribute', attribute: 'resolve', change: -5 },
                ],
              },
            },
          },
        },

        {
          id: 'scene3-recognition',
          name: 'Noticed',
          startingBeatId: 'rec-beat1',
          beats: [
            {
              id: 'rec-beat1',
              text: 'After the fight, Mei finds you in the back room. Her expression is tense.',
              textVariants: [
                {
                  condition: { type: 'tag', tag: 'pit_fighter', hasTag: true },
                  text: 'After your victory, Mei finds you in the back room. Her expression mixes approval with concern.',
                },
              ],
              nextBeatId: 'rec-beat2',
            },
            {
              id: 'rec-beat2',
              text: '"You\'ve been noticed. One of Varen\'s men was watching. They want to meet you."',
              speaker: 'Mei',
              choices: [
                {
                  id: 'eager-meeting',
                  text: '"Good. That\'s what we wanted."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'courage', change: 3 },
                  ],
                  nextBeatId: 'rec-beat3',
                },
                {
                  id: 'cautious-meeting',
                  text: '"Could be a trap. What do you know about them?"',
                  choiceType: 'strategic',
                  statCheck: { attribute: 'wit', difficulty: 40 },
                  consequences: [
                    { type: 'attribute', attribute: 'wit', change: 3 },
                    { type: 'skill', skill: 'observation', change: 2 },
                  ],
                  nextBeatId: 'rec-beat3-cautious',
                },
              ],
            },
            {
              id: 'rec-beat3',
              text: 'A figure emerges from the shadows—and your heart nearly stops. Kira Shadowmend.',
              conditions: { type: 'flag', flag: 'spared_kira', value: true },
              nextBeatId: 'rec-beat4-kira',
            },
            {
              id: 'rec-beat3-cautious',
              text: '"His name is—" Mei freezes as a figure emerges from the shadows. Kira Shadowmend.',
              conditions: { type: 'flag', flag: 'spared_kira', value: true },
              nextBeatId: 'rec-beat4-kira',
            },
            {
              id: 'rec-beat4-kira',
              text: '"You spared my life. Now I\'m going to help you end Varen\'s." Kira\'s eyes are hard but clear. "I know everything about his operation. Where the prisoners are held. When his guard rotates. Everything."',
              speaker: 'Kira',
              onShow: [
                { type: 'relationship', npcId: 'kira', dimension: 'trust', change: 30 },
                { type: 'setFlag', flag: 'kira_ally', value: true },
              ],
              nextBeatId: 'rec-beat5',
            },
            {
              id: 'rec-beat5',
              text: 'Mei studies Kira warily. "Can we trust her?"',
              speaker: 'Mei',
              choices: [
                {
                  id: 'vouch-kira',
                  text: '"She had the chance to kill me. She didn\'t. I\'ll take that bet."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'kira', dimension: 'trust', change: 15 },
                    { type: 'relationship', npcId: 'mei', dimension: 'trust', change: -5 },
                    { type: 'attribute', attribute: 'empathy', change: 5 },
                  ],
                  nextBeatId: 'rec-beat6',
                },
                {
                  id: 'conditional-trust',
                  text: '"For now. But I\'ll be watching."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'kira', dimension: 'respect', change: 5 },
                    { type: 'relationship', npcId: 'mei', dimension: 'trust', change: 5 },
                    { type: 'attribute', attribute: 'wit', change: 3 },
                  ],
                  nextBeatId: 'rec-beat6',
                },
              ],
            },
            {
              id: 'rec-beat6',
              text: 'Kira nods slowly. "Fair enough. There\'s something else you should know. Varen is hosting a private tournament at his estate in three days. Winners get recruited into his inner circle."',
              speaker: 'Kira',
              onShow: [
                { type: 'setFlag', flag: 'knows_private_tournament', value: true },
              ],
            },
          ],
        },
      ],

      onComplete: [
        { type: 'skill', skill: 'swordsmanship', change: 5 },
        { type: 'attribute', attribute: 'resourcefulness', change: 3 },
      ],
    },

    // Episode 4: The Private Tournament
    {
      id: 'ep4-private-tournament',
      number: 4,
      title: 'The Private Tournament',
      synopsis: 'Varen\'s estate hosts a deadly competition. Victory means access to his inner circle—and the truth about your master.',
      coverImage: '',
      startingSceneId: 'scene1-estate',

      scenes: [
        {
          id: 'scene1-estate',
          name: 'Varen\'s Estate',
          startingBeatId: 'estate-beat1',
          beats: [
            {
              id: 'estate-beat1',
              text: 'Varen\'s estate rises from the hills like a fortress. Torches line the approach, and armed guards patrol every entrance. You arrive with Mei at your side.',
              textVariants: [
                {
                  condition: { type: 'flag', flag: 'kira_ally', value: true },
                  text: 'Varen\'s estate rises from the hills like a fortress. You arrive with Mei and Kira, your unlikely alliance hidden beneath the guise of a fighter and their handlers.',
                },
              ],
              nextBeatId: 'estate-beat2',
            },
            {
              id: 'estate-beat2',
              text: 'A servant leads you to the fighting grounds—a marble courtyard surrounded by viewing galleries. Wealthy nobles sit above, sipping wine as they watch fighters warm up below.',
              nextBeatId: 'estate-beat3',
            },
            {
              id: 'estate-beat3',
              text: 'And there, in the central gallery, sits Lord Varen himself. Silver-haired and sharp-eyed, he radiates the casual confidence of a man who has never faced consequences.',
              onShow: [
                { type: 'relationship', npcId: 'lord-varen', dimension: 'fear', change: 5 },
              ],
              nextBeatId: 'estate-beat4',
            },
            {
              id: 'estate-beat4',
              text: '"Remember," Mei whispers, "we need to win his attention, not his suspicion. Play the role."',
              speaker: 'Mei',
              choices: [
                {
                  id: 'play-eager',
                  text: 'Nod and adopt the demeanor of an ambitious fighter',
                  choiceType: 'strategic',
                  statCheck: { attribute: 'charm', difficulty: 40 },
                  consequences: [
                    { type: 'attribute', attribute: 'charm', change: 3 },
                    { type: 'setFlag', flag: 'played_eager', value: true },
                  ],
                  nextBeatId: 'estate-beat5',
                },
                {
                  id: 'stay-guarded',
                  text: 'Keep your expression neutral. Let your blade speak.',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'resolve', change: 3 },
                  ],
                  nextBeatId: 'estate-beat5',
                },
              ],
            },
            {
              id: 'estate-beat5',
              text: 'A gong sounds. The tournament begins. Eight fighters. Four matches. Only the winners advance.',
              nextSceneId: 'scene2-tournament-fight',
            },
          ],
        },

        {
          id: 'scene2-tournament-fight',
          name: 'Tournament Round',
          startingBeatId: 'tourn-start',
          beats: [],
          encounter: {
            id: 'private-tournament',
            type: 'combat',
            name: 'Private Tournament',
            description: 'Fight your way through Varen\'s private tournament',
            phases: [
              {
                id: 'phase1-tourn',
                name: 'First Round',
                description: 'Your first opponent is a skilled duelist from the eastern provinces.',
                situationImage: '',
                successThreshold: 4,
                failureThreshold: -2,
                beats: [
                  {
                    id: 'tr-beat1',
                    text: 'Your opponent bows formally. "I am Renn. May the better blade win." He takes his stance—textbook perfect.',
                    nextBeatId: 'tr-beat2',
                  },
                  {
                    id: 'tr-beat2',
                    text: 'He attacks with precise, economical movements. No wasted motion.',
                    choices: [
                      {
                        id: 'tr-match-style',
                        text: 'Match his formal technique with your own training',
                        choiceType: 'strategic',
                        statCheck: { skill: 'swordsmanship', difficulty: 45 },
                        consequences: [
                          { type: 'skill', skill: 'swordsmanship', change: 3 },
                        ],
                        nextBeatId: 'tr-beat3',
                      },
                      {
                        id: 'tr-adapt',
                        text: 'Use unpredictable movements to throw him off',
                        choiceType: 'strategic',
                        statCheck: { attribute: 'wit', difficulty: 40 },
                        consequences: [
                          { type: 'attribute', attribute: 'resourcefulness', change: 3 },
                        ],
                        nextBeatId: 'tr-beat3',
                      },
                    ],
                  },
                  {
                    id: 'tr-beat3',
                    text: 'Steel rings in the courtyard. The nobles watch with hungry eyes.',
                  },
                ],
                onSuccess: {
                  nextPhaseId: 'phase2-tourn',
                  outcomeText: 'A clean strike to his wrist. Renn yields with a respectful nod. "Well fought."',
                  consequences: [
                    { type: 'changeScore', score: 'tournament_wins', change: 1 },
                  ],
                },
                onFailure: {
                  nextPhaseId: 'phase2-tourn',
                  outcomeText: 'His blade finds your guard again and again. The bell saves you—a draw, but you\'re on the back foot.',
                  consequences: [
                    { type: 'attribute', attribute: 'resolve', change: -3 },
                  ],
                },
              },
              {
                id: 'phase2-tourn',
                name: 'Final Round',
                description: 'Your final opponent fights with brutal efficiency.',
                situationImage: '',
                successThreshold: 5,
                failureThreshold: -3,
                beats: [
                  {
                    id: 'tf-beat1',
                    text: 'Your final opponent is a scarred woman with dead eyes. She doesn\'t bow. She doesn\'t speak. She just attacks.',
                    nextBeatId: 'tf-beat2',
                  },
                  {
                    id: 'tf-beat2',
                    text: 'Her style is savage, efficient—the style of someone who has killed many times.',
                    choices: [
                      {
                        id: 'tf-defense',
                        text: 'Focus on defense and look for patterns',
                        choiceType: 'strategic',
                        statCheck: { skill: 'observation', difficulty: 45 },
                        consequences: [
                          { type: 'skill', skill: 'observation', change: 3 },
                        ],
                        nextBeatId: 'tf-beat3',
                      },
                      {
                        id: 'tf-aggression',
                        text: 'Match her aggression—don\'t let her dictate the pace',
                        choiceType: 'strategic',
                        statCheck: { attribute: 'courage', difficulty: 50 },
                        consequences: [
                          { type: 'attribute', attribute: 'courage', change: 5 },
                        ],
                        nextBeatId: 'tf-beat3',
                      },
                    ],
                  },
                  {
                    id: 'tf-beat3',
                    text: 'Lord Varen leans forward in his seat, genuinely interested for the first time.',
                    nextBeatId: 'tf-beat4',
                  },
                  {
                    id: 'tf-beat4',
                    text: 'The woman presses harder, her blade a silver blur.',
                    choices: [
                      {
                        id: 'tf-master-move',
                        text: 'Use your master\'s signature technique',
                        choiceType: 'strategic',
                        statCheck: { skill: 'swordsmanship', difficulty: 50 },
                        consequences: [
                          { type: 'skill', skill: 'swordsmanship', change: 5 },
                          { type: 'setFlag', flag: 'used_masters_technique', value: true },
                        ],
                        nextBeatId: 'tf-beat5',
                      },
                      {
                        id: 'tf-endure',
                        text: 'Dig deep and outlast her',
                        choiceType: 'strategic',
                        statCheck: { attribute: 'resolve', difficulty: 55 },
                        consequences: [
                          { type: 'attribute', attribute: 'resolve', change: 5 },
                        ],
                        nextBeatId: 'tf-beat5',
                      },
                    ],
                  },
                  {
                    id: 'tf-beat5',
                    text: 'The crowd holds its breath.',
                  },
                ],
                onSuccess: {
                  outcomeText: 'Your blade stops at her throat. She yields—barely. The courtyard erupts in applause.',
                  consequences: [
                    { type: 'changeScore', score: 'tournament_wins', change: 1 },
                    { type: 'addTag', tag: 'tournament_victor' },
                  ],
                },
                onFailure: {
                  outcomeText: 'Her blade draws blood across your arm. You\'re forced to yield. Defeat—but survival.',
                  consequences: [
                    { type: 'attribute', attribute: 'resolve', change: -5 },
                  ],
                },
              },
            ],
            startingPhaseId: 'phase1-tourn',
            outcomes: {
              victory: {
                nextSceneId: 'scene3-audience',
                consequences: [
                  { type: 'skill', skill: 'swordsmanship', change: 5 },
                  { type: 'relationship', npcId: 'lord-varen', dimension: 'respect', change: 20 },
                ],
              },
              defeat: {
                nextSceneId: 'scene3-audience-defeat',
                consequences: [
                  { type: 'relationship', npcId: 'lord-varen', dimension: 'respect', change: 5 },
                ],
              },
            },
          },
        },

        {
          id: 'scene3-audience',
          name: 'Varen\'s Interest',
          startingBeatId: 'audience-beat1',
          beats: [
            {
              id: 'audience-beat1',
              text: 'After the tournament, a servant approaches. "Lord Varen requests your presence in his private study."',
              nextBeatId: 'audience-beat2',
            },
            {
              id: 'audience-beat2',
              text: 'Mei catches your eye. This is it—the opportunity you\'ve been working toward.',
              nextBeatId: 'audience-beat3',
            },
            {
              id: 'audience-beat3',
              text: 'Varen\'s study is opulent—silk tapestries, rare weapons on display, a fire crackling in a marble hearth. The lord himself pours wine.',
              nextBeatId: 'audience-beat4',
            },
            {
              id: 'audience-beat4',
              text: '"Impressive performance. That technique you used—I\'ve seen it before." His eyes are calculating. "Hiro taught it to you, didn\'t he?"',
              speaker: 'Lord Varen',
              textVariants: [
                {
                  condition: { type: 'flag', flag: 'used_masters_technique', value: true },
                  text: '"That technique in the final match—I know it well. Hiro\'s signature move. You\'re his student." Varen\'s smile doesn\'t reach his eyes.',
                },
              ],
              nextBeatId: 'audience-beat5',
            },
            {
              id: 'audience-beat5',
              text: 'Your hand tightens on your blade\'s hilt. He knows.',
              choices: [
                {
                  id: 'deny-connection',
                  text: '"I\'ve trained with many masters."',
                  choiceType: 'strategic',
                  statCheck: { attribute: 'charm', difficulty: 50 },
                  consequences: [
                    { type: 'attribute', attribute: 'charm', change: 3 },
                  ],
                  nextBeatId: 'audience-beat6-lie',
                },
                {
                  id: 'admit-truth',
                  text: '"Yes. And I know you had him killed."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'courage', change: 10 },
                    { type: 'relationship', npcId: 'lord-varen', dimension: 'fear', change: 10 },
                  ],
                  nextBeatId: 'audience-beat6-truth',
                },
              ],
            },
            {
              id: 'audience-beat6-lie',
              text: 'Varen laughs. "Of course. Though Hiro\'s style is... distinctive." He sips his wine. "No matter. I have a proposition for you."',
              speaker: 'Lord Varen',
              nextBeatId: 'audience-beat7',
            },
            {
              id: 'audience-beat6-truth',
              text: 'Varen sets down his wine, unruffled. "Bold. I respect that." He gestures to the weapons on the wall. "Yes, I ordered Hiro\'s death. He was investigating something that wasn\'t his concern. But you—you could be useful."',
              speaker: 'Lord Varen',
              nextBeatId: 'audience-beat7',
            },
            {
              id: 'audience-beat7',
              text: '"Join me. I can offer wealth, power, purpose. Your master wasted his talents on principles. Don\'t make the same mistake."',
              speaker: 'Lord Varen',
              speakerMood: 'persuasive',
              choices: [
                {
                  id: 'pretend-interest',
                  text: '"Tell me more." Play along to learn his secrets.',
                  choiceType: 'strategic',
                  statCheck: { attribute: 'wit', difficulty: 45 },
                  consequences: [
                    { type: 'attribute', attribute: 'wit', change: 5 },
                    { type: 'setFlag', flag: 'infiltrated_varen', value: true },
                    { type: 'relationship', npcId: 'lord-varen', dimension: 'trust', change: 20 },
                  ],
                  nextBeatId: 'audience-beat8-join',
                },
                {
                  id: 'refuse-varen',
                  text: '"I didn\'t come here for money. I came for justice."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'resolve', change: 10 },
                    { type: 'relationship', npcId: 'lord-varen', dimension: 'respect', change: 10 },
                    { type: 'relationship', npcId: 'lord-varen', dimension: 'trust', change: -30 },
                  ],
                  nextBeatId: 'audience-beat8-refuse',
                },
              ],
            },
            {
              id: 'audience-beat8-join',
              text: 'Varen smiles. "Excellent. Tomorrow, I\'ll show you my real operation. The tournament, the fighting rings—those are just the surface." He raises his glass. "To new partnerships."',
              speaker: 'Lord Varen',
              onShow: [
                { type: 'addTag', tag: 'varen_insider' },
              ],
            },
            {
              id: 'audience-beat8-refuse',
              text: 'Varen\'s expression hardens. "A pity. Guards!" Armed men pour into the room. "Take this one to the cells. We\'ll continue this conversation later."',
              speaker: 'Lord Varen',
              onShow: [
                { type: 'setFlag', flag: 'captured_by_varen', value: true },
                { type: 'addTag', tag: 'prisoner' },
              ],
            },
          ],
        },

        {
          id: 'scene3-audience-defeat',
          name: 'A Different Path',
          startingBeatId: 'alt-beat1',
          beats: [
            {
              id: 'alt-beat1',
              text: 'Despite your loss, a servant approaches. "Lord Varen wishes to speak with you. He... appreciates determination."',
              nextBeatId: 'alt-beat2',
            },
            {
              id: 'alt-beat2',
              text: 'Mei squeezes your arm. "This could still work. He collects broken fighters. Play the part."',
              speaker: 'Mei',
              nextSceneId: 'scene3-audience',
            },
          ],
        },
      ],

      onComplete: [
        { type: 'attribute', attribute: 'courage', change: 5 },
        { type: 'skill', skill: 'observation', change: 3 },
      ],
    },

    // Episode 5: The Conspiracy
    {
      id: 'ep5-conspiracy',
      number: 5,
      title: 'The Conspiracy',
      synopsis: 'Deep in Varen\'s web, you uncover the full scope of his operation—and must choose how to bring it down.',
      coverImage: '',
      startingSceneId: 'scene1-inside',

      scenes: [
        {
          id: 'scene1-inside',
          name: 'Behind the Curtain',
          startingBeatId: 'inside-beat1',
          beats: [
            {
              id: 'inside-beat1',
              text: 'The dungeons beneath Varen\'s estate are cold and dark. You sit in chains, waiting.',
              conditions: { type: 'flag', flag: 'captured_by_varen', value: true },
              nextBeatId: 'prison-beat1',
            },
            {
              id: 'prison-beat1',
              text: 'Footsteps echo in the corridor. A familiar face appears at the bars.',
              textVariants: [
                {
                  condition: { type: 'flag', flag: 'kira_ally', value: true },
                  text: 'Footsteps echo in the corridor. Kira appears at the bars, a ring of keys in her hand. "Did you really think I\'d abandon you?"',
                },
              ],
              nextBeatId: 'prison-beat2',
            },
            {
              id: 'prison-beat2',
              text: 'Mei slips a lockpick through the bars. "Varen is too confident. He left only two guards. They\'re... handled."',
              speaker: 'Mei',
              conditions: { type: 'flag', flag: 'kira_ally', value: false },
              onShow: [
                { type: 'relationship', npcId: 'mei', dimension: 'trust', change: 15 },
              ],
              nextBeatId: 'prison-beat3',
            },
            {
              id: 'prison-beat3',
              text: 'The cell door swings open. Your blade waits on a nearby table—Varen wanted you to see it, just out of reach.',
              choices: [
                {
                  id: 'thank-rescuer',
                  text: '"I owe you one."',
                  choiceType: 'expression',
                  consequences: [
                    { type: 'attribute', attribute: 'empathy', change: 3 },
                  ],
                  nextBeatId: 'prison-beat4',
                },
                {
                  id: 'focus-mission',
                  text: '"We need to move. Where\'s Varen?"',
                  choiceType: 'expression',
                  consequences: [
                    { type: 'attribute', attribute: 'resolve', change: 3 },
                  ],
                  nextBeatId: 'prison-beat4',
                },
              ],
            },
            {
              id: 'prison-beat4',
              text: '"His private vault. That\'s where he keeps his records—proof of everyone he\'s bribed, threatened, killed. We expose that, and his empire crumbles."',
              speaker: 'Mei',
              nextSceneId: 'scene2-vault',
            },
          ],
        },

        {
          id: 'scene1-inside-infiltrator',
          name: 'The Inner Circle',
          startingBeatId: 'infiltrator-beat1',
          conditions: { type: 'flag', flag: 'infiltrated_varen', value: true },
          beats: [
            {
              id: 'infiltrator-beat1',
              text: 'Two days inside Varen\'s organization have revealed the true scope of his operation. Slave trading. Blackmail. Assassination. All hidden behind a façade of noble respectability.',
              nextBeatId: 'infiltrator-beat2',
            },
            {
              id: 'infiltrator-beat2',
              text: 'Tonight, Varen hosts a gathering of his most trusted allies. You\'ve been invited.',
              onShow: [
                { type: 'addItem', itemId: 'varen-invitation', name: 'Varen\'s Invitation', description: 'An ornate invitation to Lord Varen\'s private gathering.' },
              ],
              nextBeatId: 'infiltrator-beat3',
            },
            {
              id: 'infiltrator-beat3',
              text: 'Mei finds you in the guest quarters. "The Arbiter is here. Tao. He\'s been investigating Varen for years but never had proof. If we can get him those records..."',
              speaker: 'Mei',
              onShow: [
                { type: 'relationship', npcId: 'arbiter-tao', dimension: 'trust', change: 10 },
              ],
              choices: [
                {
                  id: 'approach-tao',
                  text: '"I\'ll make contact with Tao. See if he\'ll help."',
                  choiceType: 'strategic',
                  statCheck: { attribute: 'charm', difficulty: 45 },
                  consequences: [
                    { type: 'relationship', npcId: 'arbiter-tao', dimension: 'trust', change: 15 },
                    { type: 'setFlag', flag: 'tao_ally', value: true },
                  ],
                  nextBeatId: 'infiltrator-beat4-tao',
                },
                {
                  id: 'solo-approach',
                  text: '"We don\'t need him. Tonight, I get the evidence myself."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'courage', change: 5 },
                  ],
                  nextBeatId: 'infiltrator-beat4-solo',
                },
              ],
            },
            {
              id: 'infiltrator-beat4-tao',
              text: 'Arbiter Tao listens to your story, his weathered face unreadable. "I knew Hiro. He died trying to do what was right. If you\'re willing to finish his work..." He hands you a key. "The vault. I obtained this years ago but never had the evidence to act."',
              speaker: 'Arbiter Tao',
              onShow: [
                { type: 'addItem', itemId: 'vault-key', name: 'Vault Key', description: 'A key to Varen\'s private vault.' },
              ],
              nextSceneId: 'scene2-vault',
            },
            {
              id: 'infiltrator-beat4-solo',
              text: 'Tonight\'s gathering is the perfect cover. While Varen entertains his guests, you\'ll slip away and find the evidence yourself.',
              nextSceneId: 'scene2-vault',
            },
          ],
        },

        {
          id: 'scene2-vault',
          name: 'The Vault',
          startingBeatId: 'vault-beat1',
          beats: [
            {
              id: 'vault-beat1',
              text: 'The vault door is heavy iron, hidden behind a tapestry in Varen\'s study. A single guard stands watch.',
              textVariants: [
                {
                  condition: { type: 'item', itemId: 'vault-key', has: true },
                  text: 'The vault door is heavy iron, hidden behind a tapestry in Varen\'s study. The key from Tao fits perfectly. Inside, shelves of ledgers and sealed documents await.',
                },
              ],
              nextBeatId: 'vault-beat2',
            },
            {
              id: 'vault-beat2',
              text: 'The guard sees you. His hand moves to his sword.',
              conditions: { type: 'item', itemId: 'vault-key', has: false },
              choices: [
                {
                  id: 'quick-strike',
                  text: 'Strike before he can raise the alarm',
                  choiceType: 'strategic',
                  statCheck: { skill: 'swordsmanship', difficulty: 45 },
                  consequences: [
                    { type: 'skill', skill: 'swordsmanship', change: 3 },
                  ],
                  nextBeatId: 'vault-beat3',
                },
                {
                  id: 'bluff-guard',
                  text: '"Lord Varen sent me to retrieve something."',
                  choiceType: 'strategic',
                  statCheck: { attribute: 'charm', difficulty: 50 },
                  consequences: [
                    { type: 'attribute', attribute: 'charm', change: 5 },
                  ],
                  nextBeatId: 'vault-beat3',
                },
              ],
            },
            {
              id: 'vault-beat3',
              text: 'Inside the vault, the evidence is damning. Ledgers detailing payments to corrupt officials. Lists of fighters sold to foreign lords. And a letter—signed by Varen—ordering your master\'s death.',
              onShow: [
                { type: 'addItem', itemId: 'varen-evidence', name: 'Varen\'s Records', description: 'Incriminating documents proving Varen\'s crimes.' },
                { type: 'setFlag', flag: 'has_evidence', value: true },
              ],
              nextBeatId: 'vault-beat4',
            },
            {
              id: 'vault-beat4',
              text: 'The door crashes open behind you. Varen stands in the doorway, blade drawn, his face twisted with rage.',
              nextBeatId: 'vault-beat5',
            },
            {
              id: 'vault-beat5',
              text: '"I should have killed you when I had the chance. Your master said the same thing, right before the end."',
              speaker: 'Lord Varen',
              speakerMood: 'furious',
              choices: [
                {
                  id: 'confront-varen',
                  text: '"Then let\'s finish this. Here and now."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'courage', change: 10 },
                    { type: 'relationship', npcId: 'lord-varen', dimension: 'fear', change: 15 },
                  ],
                  nextSceneId: 'scene3-confrontation',
                },
                {
                  id: 'escape-evidence',
                  text: 'Throw the documents to Mei. "Get these to Tao! I\'ll hold him off!"',
                  choiceType: 'strategic',
                  statCheck: { attribute: 'wit', difficulty: 45 },
                  consequences: [
                    { type: 'attribute', attribute: 'wit', change: 5 },
                    { type: 'setFlag', flag: 'evidence_escaped', value: true },
                  ],
                  nextSceneId: 'scene3-confrontation',
                },
              ],
            },
          ],
        },

        {
          id: 'scene3-confrontation',
          name: 'Face to Face',
          startingBeatId: 'confront-beat1',
          beats: [
            {
              id: 'confront-beat1',
              text: 'Varen\'s blade gleams in the lamplight. Despite his age, he moves with deadly grace—he was a champion once, before politics.',
              nextBeatId: 'confront-beat2',
            },
            {
              id: 'confront-beat2',
              text: '"Your master taught you well. But he couldn\'t defeat me. What makes you think you can?"',
              speaker: 'Lord Varen',
              choices: [
                {
                  id: 'honor-master',
                  text: '"Because I fight for something greater than myself."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'resolve', change: 5 },
                    { type: 'attribute', attribute: 'empathy', change: 3 },
                  ],
                  nextBeatId: 'confront-beat3',
                },
                {
                  id: 'silent-response',
                  text: 'No more words. Raise your blade.',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'courage', change: 5 },
                  ],
                  nextBeatId: 'confront-beat3',
                },
              ],
            },
            {
              id: 'confront-beat3',
              text: 'Steel meets steel. This is it—the moment you\'ve trained three years for.',
              nextSceneId: 'scene4-final-duel',
            },
          ],
        },

        {
          id: 'scene4-final-duel',
          name: 'The Final Duel',
          startingBeatId: 'duel-start',
          beats: [],
          encounter: {
            id: 'varen-duel',
            type: 'combat',
            name: 'Duel with Lord Varen',
            description: 'The final confrontation with your master\'s killer',
            phases: [
              {
                id: 'phase1-varen',
                name: 'Old Wolf',
                description: 'Varen fights with ruthless precision.',
                situationImage: '',
                successThreshold: 5,
                failureThreshold: -3,
                beats: [
                  {
                    id: 'vd-beat1',
                    text: 'Varen attacks with cold fury, each strike aimed to kill. This is no tournament bout.',
                    nextBeatId: 'vd-beat2',
                  },
                  {
                    id: 'vd-beat2',
                    text: 'His technique is flawless but predictable—the style of a man who hasn\'t faced a true challenge in years.',
                    choices: [
                      {
                        id: 'vd-exploit',
                        text: 'Exploit his overconfidence',
                        choiceType: 'strategic',
                        statCheck: { skill: 'observation', difficulty: 50 },
                        consequences: [
                          { type: 'skill', skill: 'observation', change: 5 },
                        ],
                        nextBeatId: 'vd-beat3',
                      },
                      {
                        id: 'vd-power',
                        text: 'Overwhelm him with aggressive strikes',
                        choiceType: 'strategic',
                        statCheck: { attribute: 'courage', difficulty: 55 },
                        consequences: [
                          { type: 'attribute', attribute: 'courage', change: 5 },
                        ],
                        nextBeatId: 'vd-beat3',
                      },
                    ],
                  },
                  {
                    id: 'vd-beat3',
                    text: '"I offered you everything!" Varen snarls, pressing harder.',
                    speaker: 'Lord Varen',
                  },
                ],
                onSuccess: {
                  nextPhaseId: 'phase2-varen',
                  outcomeText: 'You draw first blood—a cut across his cheek. Varen\'s eyes widen.',
                  consequences: [
                    { type: 'relationship', npcId: 'lord-varen', dimension: 'fear', change: 20 },
                  ],
                },
                onFailure: {
                  nextPhaseId: 'phase2-varen',
                  outcomeText: 'His blade bites into your arm. Pain flares, but you stay standing.',
                  consequences: [
                    { type: 'attribute', attribute: 'resolve', change: -5 },
                  ],
                },
              },
              {
                id: 'phase2-varen',
                name: 'Desperate',
                description: 'Varen fights without restraint.',
                situationImage: '',
                successThreshold: 6,
                failureThreshold: -4,
                beats: [
                  {
                    id: 'vd2-beat1',
                    text: 'Varen abandons all pretense of technique. He fights like a cornered animal.',
                    nextBeatId: 'vd2-beat2',
                  },
                  {
                    id: 'vd2-beat2',
                    text: '"I built an empire! I will not fall to some nobody with a grudge!"',
                    speaker: 'Lord Varen',
                    speakerMood: 'enraged',
                    choices: [
                      {
                        id: 'vd2-discipline',
                        text: 'Stay disciplined—let his rage be his undoing',
                        choiceType: 'strategic',
                        statCheck: { attribute: 'resolve', difficulty: 55 },
                        consequences: [
                          { type: 'attribute', attribute: 'resolve', change: 5 },
                        ],
                        nextBeatId: 'vd2-beat3',
                      },
                      {
                        id: 'vd2-masters-way',
                        text: 'End this with your master\'s technique',
                        choiceType: 'strategic',
                        statCheck: { skill: 'swordsmanship', difficulty: 55 },
                        consequences: [
                          { type: 'skill', skill: 'swordsmanship', change: 10 },
                        ],
                        nextBeatId: 'vd2-beat3',
                      },
                    ],
                  },
                  {
                    id: 'vd2-beat3',
                    text: 'Time slows. You see the opening—the same one your master taught you to find.',
                  },
                ],
                onSuccess: {
                  outcomeText: 'Your blade finds its mark. Varen\'s weapon clatters to the floor as he falls to his knees, defeated.',
                  consequences: [
                    { type: 'setFlag', flag: 'defeated_varen', value: true },
                    { type: 'addTag', tag: 'avenger' },
                  ],
                },
                onFailure: {
                  outcomeText: 'Varen\'s desperate strike catches you off guard. You fall, blade spinning away. But before he can finish you—',
                  consequences: [
                    { type: 'setFlag', flag: 'nearly_defeated', value: true },
                  ],
                },
              },
            ],
            startingPhaseId: 'phase1-varen',
            outcomes: {
              victory: {
                nextSceneId: 'scene5-judgment',
                consequences: [
                  { type: 'skill', skill: 'swordsmanship', change: 10 },
                  { type: 'attribute', attribute: 'resolve', change: 10 },
                ],
              },
              defeat: {
                nextSceneId: 'scene5-rescue',
                consequences: [
                  { type: 'attribute', attribute: 'resolve', change: -5 },
                ],
              },
            },
          },
        },

        {
          id: 'scene5-judgment',
          name: 'Judgment',
          startingBeatId: 'judgment-beat1',
          beats: [
            {
              id: 'judgment-beat1',
              text: 'Varen kneels before you, blood dripping from his wounds. The man who ordered your master\'s death. The spider at the center of the web.',
              nextBeatId: 'judgment-beat2',
            },
            {
              id: 'judgment-beat2',
              text: '"Do it then," he hisses. "But know this—kill me, and you become what I was. Another killer in a city full of them."',
              speaker: 'Lord Varen',
              choices: [
                {
                  id: 'execute-varen',
                  text: 'End it. He deserves no mercy.',
                  choiceType: 'dilemma',
                  consequences: [
                    { type: 'setFlag', flag: 'killed_varen', value: true },
                    { type: 'attribute', attribute: 'resolve', change: 5 },
                    { type: 'attribute', attribute: 'empathy', change: -10 },
                    { type: 'addTag', tag: 'executioner' },
                  ],
                  nextBeatId: 'judgment-beat3-kill',
                },
                {
                  id: 'spare-varen',
                  text: '"No. You\'ll face justice. Real justice."',
                  choiceType: 'dilemma',
                  consequences: [
                    { type: 'setFlag', flag: 'spared_varen', value: true },
                    { type: 'attribute', attribute: 'empathy', change: 10 },
                    { type: 'addTag', tag: 'just' },
                  ],
                  nextBeatId: 'judgment-beat3-spare',
                },
              ],
            },
            {
              id: 'judgment-beat3-kill',
              text: 'Your blade falls. It\'s over. The man who murdered your master lies still at your feet. But the satisfaction you expected... it doesn\'t come.',
            },
            {
              id: 'judgment-beat3-spare',
              text: 'Arbiter Tao appears in the doorway, guards behind him. "Lord Varen, you are under arrest for crimes against the people of Valoria." Your master would be proud.',
              onShow: [
                { type: 'relationship', npcId: 'arbiter-tao', dimension: 'respect', change: 20 },
              ],
            },
          ],
        },

        {
          id: 'scene5-rescue',
          name: 'Salvation',
          startingBeatId: 'rescue-beat1',
          beats: [
            {
              id: 'rescue-beat1',
              text: 'Varen raises his blade for the killing blow—and staggers as steel bursts through his chest.',
              textVariants: [
                {
                  condition: { type: 'flag', flag: 'kira_ally', value: true },
                  text: 'Varen raises his blade for the killing blow—and Kira\'s sword takes him through the back. "For everyone you ever hurt," she says as he falls.',
                },
              ],
              nextBeatId: 'rescue-beat2',
            },
            {
              id: 'rescue-beat2',
              text: 'Mei stands over Varen\'s body, her blade dripping. "You\'re welcome."',
              speaker: 'Mei',
              conditions: { type: 'flag', flag: 'kira_ally', value: false },
              onShow: [
                { type: 'relationship', npcId: 'mei', dimension: 'trust', change: 20 },
                { type: 'setFlag', flag: 'varen_killed_by_ally', value: true },
              ],
              nextBeatId: 'rescue-beat3',
            },
            {
              id: 'rescue-beat3',
              text: 'It\'s over. Not the victory you imagined, but victory nonetheless.',
            },
          ],
        },
      ],

      onComplete: [
        { type: 'attribute', attribute: 'resolve', change: 10 },
        { type: 'skill', skill: 'swordsmanship', change: 5 },
      ],
    },

    // Episode 6: The Path Forward
    {
      id: 'ep6-path-forward',
      number: 6,
      title: 'The Path Forward',
      synopsis: 'With Varen defeated, you must decide what kind of person you will become—and what legacy you will leave.',
      coverImage: '',
      startingSceneId: 'scene1-aftermath',

      scenes: [
        {
          id: 'scene1-aftermath',
          name: 'Dawn',
          startingBeatId: 'dawn-beat1',
          beats: [
            {
              id: 'dawn-beat1',
              text: 'Dawn breaks over Valoria. The city stirs, unaware of what transpired in the night. Varen\'s empire has crumbled, but the work is far from over.',
              textVariants: [
                {
                  condition: { type: 'flag', flag: 'killed_varen', value: true },
                  text: 'Dawn breaks over Valoria. Varen is dead by your hand. The city will celebrate his fall, but you feel only emptiness where satisfaction should be.',
                },
                {
                  condition: { type: 'flag', flag: 'spared_varen', value: true },
                  text: 'Dawn breaks over Valoria. In the city prison, Varen awaits trial. Your master\'s legacy lives on—not in vengeance, but in justice.',
                },
              ],
              nextBeatId: 'dawn-beat2',
            },
            {
              id: 'dawn-beat2',
              text: 'You stand at your master\'s grave outside the city walls. The morning light catches the simple stone marker.',
              nextBeatId: 'dawn-beat3',
            },
            {
              id: 'dawn-beat3',
              text: '"Master Hiro. I kept my promise." You place your hand on the cold stone. "I hope... I hope I did right by you."',
              choices: [
                {
                  id: 'speak-to-hiro',
                  text: 'Tell him everything that happened',
                  choiceType: 'expression',
                  consequences: [
                    { type: 'attribute', attribute: 'empathy', change: 5 },
                  ],
                  nextBeatId: 'dawn-beat4',
                },
                {
                  id: 'silent-vigil',
                  text: 'Kneel in silence. He knows.',
                  choiceType: 'expression',
                  consequences: [
                    { type: 'attribute', attribute: 'resolve', change: 5 },
                  ],
                  nextBeatId: 'dawn-beat4',
                },
              ],
            },
            {
              id: 'dawn-beat4',
              text: 'Footsteps approach. You\'re not alone.',
              nextSceneId: 'scene2-reunions',
            },
          ],
        },

        {
          id: 'scene2-reunions',
          name: 'Old Friends',
          startingBeatId: 'reunion-beat1',
          beats: [
            {
              id: 'reunion-beat1',
              text: 'Old Jin approaches, leaning on his walking stick. Behind him come others—Mei, her expression softer than you\'ve seen it.',
              textVariants: [
                {
                  condition: { type: 'flag', flag: 'kira_ally', value: true },
                  text: 'Old Jin approaches, leaning on his walking stick. Behind him come Mei and Kira—an unlikely trio united by the night\'s events.',
                },
              ],
              nextBeatId: 'reunion-beat2',
            },
            {
              id: 'reunion-beat2',
              text: '"Hiro would be proud," Jin says, his eyes glistening. "Not just of what you accomplished, but how you accomplished it."',
              speaker: 'Old Jin',
              textVariants: [
                {
                  condition: { type: 'tag', tag: 'executioner', hasTag: true },
                  text: '"It\'s done," Jin says quietly. "Whether Hiro would approve..." He trails off, leaving the question unanswered.',
                },
              ],
              onShow: [
                { type: 'relationship', npcId: 'old-jin', dimension: 'respect', change: 20 },
              ],
              nextBeatId: 'reunion-beat3',
            },
            {
              id: 'reunion-beat3',
              text: 'Mei steps forward. "The Pit fighters are free. Varen\'s records exposed dozens of corrupt officials. The city will be cleaning up this mess for years."',
              speaker: 'Mei',
              nextBeatId: 'reunion-beat4',
            },
            {
              id: 'reunion-beat4',
              text: '"But there are other cities. Other Varens." She meets your eyes. "I could use a partner. Someone who knows how to handle a blade—and when not to use it."',
              speaker: 'Mei',
              onShow: [
                { type: 'relationship', npcId: 'mei', dimension: 'trust', change: 15 },
              ],
              choices: [
                {
                  id: 'join-mei',
                  text: '"I\'ve spent three years chasing one enemy. Maybe it\'s time to do more."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'mei', dimension: 'trust', change: 20 },
                    { type: 'attribute', attribute: 'courage', change: 5 },
                    { type: 'setFlag', flag: 'joined_mei', value: true },
                  ],
                  nextBeatId: 'reunion-beat5-mei',
                },
                {
                  id: 'decline-mei',
                  text: '"I need time. To figure out who I am without revenge driving me."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'empathy', change: 5 },
                    { type: 'relationship', npcId: 'mei', dimension: 'respect', change: 10 },
                  ],
                  nextBeatId: 'reunion-beat5-alone',
                },
              ],
            },
            {
              id: 'reunion-beat5-mei',
              text: 'Mei grins—the first real smile you\'ve seen from her. "Good. We leave at noon. There\'s a noble in the western provinces who needs... correcting."',
              speaker: 'Mei',
              nextBeatId: 'reunion-beat6',
            },
            {
              id: 'reunion-beat5-alone',
              text: 'Mei nods slowly. "I understand. But if you ever change your mind..." She presses a small token into your hand—a jade pendant. "Find me."',
              speaker: 'Mei',
              onShow: [
                { type: 'addItem', itemId: 'mei-pendant', name: 'Jade Pendant', description: 'Mei\'s token—a promise that allies await when you\'re ready.' },
              ],
              nextBeatId: 'reunion-beat6',
            },
            {
              id: 'reunion-beat6',
              text: 'Kira hangs back, uncertain. The woman who killed your master. The woman who helped save your life.',
              conditions: { type: 'flag', flag: 'kira_ally', value: true },
              nextBeatId: 'kira-beat1',
            },
            {
              id: 'kira-beat1',
              text: '"I don\'t expect forgiveness," she says quietly. "I just wanted you to know—your master\'s last words were about you. He said you would be better than all of us."',
              speaker: 'Kira',
              choices: [
                {
                  id: 'forgive-kira',
                  text: '"You were a tool. Varen was the one who pulled the trigger. I... I forgive you."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'kira', dimension: 'trust', change: 30 },
                    { type: 'relationship', npcId: 'kira', dimension: 'affection', change: 20 },
                    { type: 'attribute', attribute: 'empathy', change: 10 },
                    { type: 'addTag', tag: 'forgiver' },
                  ],
                  nextBeatId: 'kira-beat2-forgive',
                },
                {
                  id: 'acknowledge-kira',
                  text: '"I can\'t forgive. Not yet. But I can move forward."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'relationship', npcId: 'kira', dimension: 'respect', change: 15 },
                    { type: 'attribute', attribute: 'resolve', change: 5 },
                  ],
                  nextBeatId: 'kira-beat2-acknowledge',
                },
              ],
            },
            {
              id: 'kira-beat2-forgive',
              text: 'Tears well in Kira\'s eyes—perhaps the first she\'s shed in years. "Thank you. I won\'t waste this second chance." She bows deeply, a student to a master.',
              speaker: 'Kira',
              nextSceneId: 'scene3-legacy',
            },
            {
              id: 'kira-beat2-acknowledge',
              text: 'Kira nods, accepting what you can offer. "That\'s more than I deserve. If you ever need a blade at your back..." She leaves the offer hanging.',
              speaker: 'Kira',
              nextSceneId: 'scene3-legacy',
            },
          ],
        },

        {
          id: 'scene3-legacy',
          name: 'Legacy',
          startingBeatId: 'legacy-beat1',
          beats: [
            {
              id: 'legacy-beat1',
              text: 'Old Jin clears his throat. "There is one more matter. Hiro left something for you. He asked me to give it to you only when you were ready."',
              speaker: 'Old Jin',
              nextBeatId: 'legacy-beat2',
            },
            {
              id: 'legacy-beat2',
              text: 'He produces a worn leather journal, its pages filled with your master\'s flowing script.',
              onShow: [
                { type: 'addItem', itemId: 'masters-journal', name: 'Master Hiro\'s Journal', description: 'Your master\'s teachings, wisdom, and final words—a lifetime distilled into ink and paper.' },
              ],
              nextBeatId: 'legacy-beat3',
            },
            {
              id: 'legacy-beat3',
              text: '"His techniques. His philosophy. Everything he wanted to pass on." Jin\'s voice catches. "He believed you would carry on his school."',
              speaker: 'Old Jin',
              choices: [
                {
                  id: 'accept-legacy',
                  text: '"I will. His teachings won\'t die with him."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'resolve', change: 10 },
                    { type: 'relationship', npcId: 'old-jin', dimension: 'trust', change: 20 },
                    { type: 'addTag', tag: 'successor' },
                  ],
                  nextBeatId: 'legacy-beat4-accept',
                },
                {
                  id: 'humble-legacy',
                  text: '"I\'m not sure I\'m worthy. But I\'ll try to honor his memory."',
                  choiceType: 'strategic',
                  consequences: [
                    { type: 'attribute', attribute: 'empathy', change: 5 },
                    { type: 'attribute', attribute: 'wit', change: 3 },
                  ],
                  nextBeatId: 'legacy-beat4-humble',
                },
              ],
            },
            {
              id: 'legacy-beat4-accept',
              text: 'Jin smiles through his tears. "Then Hiro\'s school lives on. When you\'re ready, I\'ll help you find students. Pass on what he taught you."',
              speaker: 'Old Jin',
              nextBeatId: 'legacy-beat5',
            },
            {
              id: 'legacy-beat4-humble',
              text: '"Worthy or not, you\'re all he has left," Jin says gently. "And that is enough."',
              speaker: 'Old Jin',
              nextBeatId: 'legacy-beat5',
            },
            {
              id: 'legacy-beat5',
              text: 'You open the journal to the final page. Your master\'s last entry.',
              nextSceneId: 'scene4-final',
            },
          ],
        },

        {
          id: 'scene4-final',
          name: 'The Final Lesson',
          startingBeatId: 'final-beat1',
          beats: [
            {
              id: 'final-beat1',
              text: '"To my student, if you\'re reading this, then I am gone, and you have survived. That is the first victory."',
              nextBeatId: 'final-beat2',
            },
            {
              id: 'final-beat2',
              text: '"The sword is not about killing. It is about protecting. About standing between the innocent and those who would harm them. Remember this, and you will never lose your way."',
              nextBeatId: 'final-beat3',
            },
            {
              id: 'final-beat3',
              text: '"I taught you to fight. Now you must learn when not to. That is the final lesson—and one you must discover for yourself."',
              nextBeatId: 'final-beat4',
            },
            {
              id: 'final-beat4',
              text: 'You close the journal, the words burning in your mind. Behind you, the sun rises over Valoria.',
              textVariants: [
                {
                  condition: { type: 'flag', flag: 'joined_mei', value: true },
                  text: 'You close the journal and turn to face your companions. The road ahead is long, but you don\'t walk it alone. A new chapter begins.',
                },
                {
                  condition: { type: 'tag', tag: 'successor', hasTag: true },
                  text: 'You close the journal, already planning your first lesson. Somewhere, future students wait—young swordsmen who will carry on the tradition. Your master\'s legacy—and yours—will endure.',
                },
              ],
              nextBeatId: 'final-beat5',
            },
            {
              id: 'final-beat5',
              text: 'You came to Valoria seeking revenge. You found something more: purpose, allies, and a path forward.',
              textVariants: [
                {
                  condition: { type: 'tag', tag: 'merciful', hasTag: true },
                  text: 'You came to Valoria seeking revenge. Instead, you found mercy—and in showing it, you became more than your master ever dreamed.',
                },
                {
                  condition: { type: 'tag', tag: 'executioner', hasTag: true },
                  text: 'You came to Valoria seeking revenge, and you found it. The cost... only time will tell. But the blade in your hand still feels right.',
                },
              ],
              nextBeatId: 'final-beat6',
            },
            {
              id: 'final-beat6',
              text: 'Whatever comes next, you\'re ready.',
              textVariants: [
                {
                  condition: { type: 'tag', tag: 'tournament_champion', hasTag: true },
                  text: 'Champion. Avenger. Successor. The titles no longer matter. What matters is what you do next.\n\nThe story of Valoria is over. Yours is just beginning.',
                },
              ],
              onShow: [
                { type: 'removeTag', tag: 'seeking_revenge' },
                { type: 'addTag', tag: 'master_swordsman' },
              ],
            },
          ],
        },
      ],

      onComplete: [
        { type: 'attribute', attribute: 'resolve', change: 10 },
        { type: 'attribute', attribute: 'empathy', change: 5 },
        { type: 'skill', skill: 'swordsmanship', change: 10 },
      ],
    },
  ],
};
