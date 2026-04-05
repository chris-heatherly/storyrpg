/**
 * Cinematic Beat Analyzer
 *
 * Analyzes story beats using film grammar to suggest cinematic techniques.
 * Maps narrative moments to proven visual storytelling approaches from cinema.
 *
 * Key principles:
 * - Asymmetry: Bodies twisted, weight shifted, not mirrored
 * - Moment of change: Mid-recoil, mid-reach, not static before/after
 * - Environmental interaction: Hands gripping tables, backs against walls
 */

// ============================================
// BEAT TYPE CLASSIFICATIONS
// ============================================

export type BeatType =
  | 'confrontation'       // Characters in conflict
  | 'revelation'          // Secret exposed, truth discovered
  | 'intimacy'            // Emotional closeness, vulnerability
  | 'action'              // Physical activity, movement
  | 'transition'          // Moving between emotional states
  | 'decision'            // Character making a choice
  | 'threat'              // Danger approaching
  | 'comfort'             // One character soothing another
  | 'betrayal'            // Trust broken
  | 'reunion'             // Characters coming together after separation
  | 'departure'           // Characters separating
  | 'realization'         // Internal moment of understanding
  | 'defiance'            // Standing against opposition
  | 'submission'          // Yielding to pressure
  | 'triumph'             // Victory achieved
  | 'defeat'              // Loss suffered
  | 'atmosphere';         // Environment-focused, no character action

// ============================================
// CINEMATIC ANALYSIS RESULT
// ============================================

export interface CinematicAnalysis {
  beatType: BeatType;
  filmReference: string;        // "Like the hospital scene in The Godfather"

  keyPrinciples: string[];      // ["asymmetry", "moment of change", "environmental interaction"]

  suggestedCamera: {
    angle: string;              // "Low angle on aggressor, eye-level on victim"
    shotType: string;           // "Medium two-shot", "Close-up", "Over-shoulder"
    movement: string;           // "Push in slowly", "Static", "Pull back to reveal"
    focus: string;              // "Rack focus from hands to face"
  };

  bodyLanguageDirectives: {
    asymmetry: string;          // "One character expanded, other contracted"
    momentOfChange: string;     // "Mid-recoil, not static reaction"
    environmentInteraction: string; // "Hand gripping table edge"
    spatialRelationship: string;    // "Aggressor closing distance, defender backed against wall"
  };

  lightingSuggestion: string;   // "High contrast, aggressor in light, victim in shadow"
  compositionNote: string;      // "Rule of thirds, space in direction of movement"
}

// ============================================
// BEAT TYPE DETECTION
// ============================================

/**
 * Analyze beat text to determine the type of dramatic moment
 */
export function detectBeatType(
  beatText: string,
  emotionalRead?: string,
  relationshipDynamic?: string
): BeatType {
  const text = (beatText + ' ' + (emotionalRead || '') + ' ' + (relationshipDynamic || '')).toLowerCase();

  // Check for specific patterns
  if (/\b(confront|accus|demand|challeng|argue|fight|clash|attack|defend)\b/.test(text)) {
    return 'confrontation';
  }
  if (/\b(reveal|discover|secret|truth|realize|learn|find out|uncover|expose)\b/.test(text)) {
    if (/\b(betray|lied|deceive|trick|manipulate)\b/.test(text)) {
      return 'betrayal';
    }
    return 'revelation';
  }
  if (/\b(kiss|embrace|hold|touch|caress|tender|gentle|intimate|close)\b/.test(text)) {
    return 'intimacy';
  }
  if (/\b(run|fight|dodge|strike|chase|escape|pursue|leap|climb)\b/.test(text)) {
    return 'action';
  }
  if (/\b(choose|decide|must|option|path|door|way)\b/.test(text)) {
    return 'decision';
  }
  if (/\b(threat|danger|menace|warning|risk|fear|afraid|terrif)\b/.test(text)) {
    return 'threat';
  }
  if (/\b(comfort|sooth|reassure|calm|gentle|there there|it\'s okay)\b/.test(text)) {
    return 'comfort';
  }
  if (/\b(reunite|return|finally|again|back together|missed)\b/.test(text)) {
    return 'reunion';
  }
  if (/\b(leave|go|goodbye|farewell|part|depart|walk away)\b/.test(text)) {
    return 'departure';
  }
  if (/\b(understand|see now|finally get|dawn|click|realize)\b/.test(text)) {
    return 'realization';
  }
  if (/\b(defy|refuse|never|won\'t|stand against|resist)\b/.test(text)) {
    return 'defiance';
  }
  if (/\b(surrender|yield|give up|submit|accept|bow)\b/.test(text)) {
    return 'submission';
  }
  if (/\b(win|victory|triumph|succeed|overcome)\b/.test(text)) {
    return 'triumph';
  }
  if (/\b(lose|fail|defeat|fall|broken)\b/.test(text)) {
    return 'defeat';
  }

  // Atmosphere: high environmental language, low action-verb density
  const envPatterns = /\b(the room|silence|empty|quiet|still|rain|wind|shadow|moonlight|dust|darkness|fog|mist|fading light|echoes?|distant|horizon|clouds?|sky|sunset|dawn|dusk)\b/;
  const actionPatterns = /\b(grabs?|reaches?|recoils?|steps?|stumbles?|lunges?|turns?|pushes?|pulls?|raises?|strikes?|dodges?|embraces?|confronts?|retreats?|advances?|runs?|walks?|leans?)\b/;
  if (envPatterns.test(text) && !actionPatterns.test(text)) {
    return 'atmosphere';
  }

  return 'transition';
}

// ============================================
// CINEMATIC TEMPLATES BY BEAT TYPE
// ============================================

const CINEMATIC_TEMPLATES: Record<BeatType, Omit<CinematicAnalysis, 'beatType'>> = {
  confrontation: {
    filmReference: 'Like the baptism scene in The Godfather - power and violence in tension',
    keyPrinciples: ['asymmetry', 'power through position', 'environmental dominance'],
    suggestedCamera: {
      angle: 'Low angle on aggressor to emphasize power, eye-level or high on defender',
      shotType: 'Medium two-shot with space for body language',
      movement: 'Slow push in as tension builds',
      focus: 'Sharp on faces, hands secondary focus'
    },
    bodyLanguageDirectives: {
      asymmetry: 'Aggressor expanded and advancing, defender contracted and yielding',
      momentOfChange: 'Captured mid-advance or mid-retreat, not static face-off',
      environmentInteraction: 'Aggressor taking space, defender using furniture as barrier',
      spatialRelationship: 'Aggressor closing distance, defender creating or losing distance'
    },
    lightingSuggestion: 'High contrast - aggressor may be lit, defender in shadow',
    compositionNote: 'Aggressor larger in frame through position, not symbolic scaling'
  },

  revelation: {
    filmReference: 'Like "I am your father" in Empire Strikes Back - frozen moment of impact',
    keyPrinciples: ['freeze frame moment', 'emotional impact visible', 'isolation of reactor'],
    suggestedCamera: {
      angle: 'Level, intimate, focused on face of person receiving revelation',
      shotType: 'Close-up on reactor, or two-shot showing contrast',
      movement: 'Static in the moment of impact, let face do the work',
      focus: 'Razor sharp on eyes, everything else can soften'
    },
    bodyLanguageDirectives: {
      asymmetry: 'Revealer controlled, reactor mid-transformation',
      momentOfChange: 'Exact instant of comprehension dawning - face transforming',
      environmentInteraction: 'Reactor may grip nearby object for support',
      spatialRelationship: 'Revealer may lean forward, reactor may lean back in shock'
    },
    lightingSuggestion: 'Light on face of reactor to show every micro-expression',
    compositionNote: 'Space around reactor to emphasize isolation in new understanding'
  },

  intimacy: {
    filmReference: 'Like the pottery scene in Ghost - vulnerability and connection',
    keyPrinciples: ['softness', 'closeness', 'mutual vulnerability'],
    suggestedCamera: {
      angle: 'Slightly low to create sense of looking up at something precious',
      shotType: 'Close two-shot, faces near each other',
      movement: 'Gentle, drifting, breathing',
      focus: 'Soft overall, sharp on point of connection'
    },
    bodyLanguageDirectives: {
      asymmetry: 'Slight lean differences - who is giving, who receiving',
      momentOfChange: 'Hand reaching, about to touch, or just having touched',
      environmentInteraction: 'Soft surfaces, warm lighting, cocooned space',
      spatialRelationship: 'Drawn together, minimal distance, gravitating'
    },
    lightingSuggestion: 'Warm, soft, flattering - golden hour or candlelight quality',
    compositionNote: 'Characters fill frame together, creating private world'
  },

  action: {
    filmReference: 'Like Mad Max Fury Road - clear motion, readable action, dynamic energy',
    keyPrinciples: ['motion blur readable', 'clear cause and effect', 'dynamic diagonal'],
    suggestedCamera: {
      angle: 'Low for power, Dutch for instability, track with motion',
      shotType: 'Wide enough to see full action, but close enough for impact',
      movement: 'Track with action or let action sweep through frame',
      focus: 'Sharp on agent of action, motion blur acceptable on periphery'
    },
    bodyLanguageDirectives: {
      asymmetry: 'Actor and reactor in different phases of motion',
      momentOfChange: 'Peak of action - fist at point of impact, body mid-leap',
      environmentInteraction: 'Feet pushing off ground, hands grabbing surfaces',
      spatialRelationship: 'Clear vectors of motion, one pursuing/one evading'
    },
    lightingSuggestion: 'High contrast, dramatic, emphasizing dimension and motion',
    compositionNote: 'Leading space in direction of movement, diagonals for energy'
  },

  transition: {
    filmReference: 'Like Michael thinking on the porch in The Godfather - internal processing',
    keyPrinciples: ['interiority', 'stillness with tension', 'environmental reflection'],
    suggestedCamera: {
      angle: 'Profile or three-quarter to show contemplation',
      shotType: 'Medium or medium-close, room to breathe',
      movement: 'Static or very slow drift',
      focus: 'Sharp on face, environment provides context'
    },
    bodyLanguageDirectives: {
      asymmetry: 'N/A for single character; for two, one processing, one waiting',
      momentOfChange: 'Visible shift in posture as decision crystallizes',
      environmentInteraction: 'Looking out window, hands on railing, seated with drink',
      spatialRelationship: 'Character occupying liminal space - doorway, window, edge'
    },
    lightingSuggestion: 'Mixed lighting reflecting internal conflict',
    compositionNote: 'Character smaller in frame, environment looming'
  },

  decision: {
    filmReference: 'Like Sophie\'s Choice - weight of impossible decision visible',
    keyPrinciples: ['weight visible', 'split between options', 'moment before'],
    suggestedCamera: {
      angle: 'Straight on or slight low angle to dignify decision-maker',
      shotType: 'Medium close, focus on face and hands',
      movement: 'Static, holding breath with character',
      focus: 'Sharp on eyes, hands show tension'
    },
    bodyLanguageDirectives: {
      asymmetry: 'Body caught between two directions, torn',
      momentOfChange: 'Moment of choosing, not before or after',
      environmentInteraction: 'Gripping something for grounding',
      spatialRelationship: 'Positioned between two options if literal; otherwise centered'
    },
    lightingSuggestion: 'Neither fully lit nor shadowed - in between',
    compositionNote: 'Character centered, weighted by options on either side'
  },

  threat: {
    filmReference: 'Like the T-Rex approach in Jurassic Park - dread building',
    keyPrinciples: ['scale of threat', 'vulnerability of target', 'impending doom'],
    suggestedCamera: {
      angle: 'Low angle on threat, high on victim to emphasize vulnerability',
      shotType: 'Wide to show relationship, or close on victim\'s fear',
      movement: 'Threat advancing through frame, victim static or retreating',
      focus: 'Threat may be partially obscured; victim\'s reaction sharp'
    },
    bodyLanguageDirectives: {
      asymmetry: 'Threat looming, victim shrinking or preparing',
      momentOfChange: 'Threat mid-approach, not static menace',
      environmentInteraction: 'Victim backed into corner, seeking escape route',
      spatialRelationship: 'Threat closing distance, victim running out of space'
    },
    lightingSuggestion: 'Threat in shadow or harsh light, victim exposed',
    compositionNote: 'Threat taking up frame, victim diminished'
  },

  comfort: {
    filmReference: 'Like Forrest holding Jenny - unconditional support',
    keyPrinciples: ['protection', 'shelter', 'asymmetric care'],
    suggestedCamera: {
      angle: 'Level or slightly high, looking down on vulnerable moment',
      shotType: 'Medium two-shot showing protective embrace',
      movement: 'Still, holding space',
      focus: 'Soft overall, warmth'
    },
    bodyLanguageDirectives: {
      asymmetry: 'Comforter open and surrounding, comforted curled and receiving',
      momentOfChange: 'Arms closing around, or just having enveloped',
      environmentInteraction: 'Seated together, comforter\'s back to world',
      spatialRelationship: 'Comforter creating shelter around comforted'
    },
    lightingSuggestion: 'Warm, soft, protective - like firelight',
    compositionNote: 'Two figures creating one shape, united against world'
  },

  betrayal: {
    filmReference: 'Like the kiss of Judas - trust breaking in real time',
    keyPrinciples: ['trust breaking visible', 'betrayer\'s mask slipping', 'victim\'s realization'],
    suggestedCamera: {
      angle: 'Level to capture the shift in dynamic',
      shotType: 'Two-shot capturing both faces',
      movement: 'Static in the moment, might push in slightly',
      focus: 'Sharp on both faces, capturing the divergence'
    },
    bodyLanguageDirectives: {
      asymmetry: 'Betrayer revealing true nature, victim transforming from trust to horror',
      momentOfChange: 'Exact moment of realization dawning',
      environmentInteraction: 'Victim may reach for support as ground shifts',
      spatialRelationship: 'Former closeness now feeling like trap'
    },
    lightingSuggestion: 'Betrayer\'s face in shadow, victim exposed',
    compositionNote: 'Space opening between them as trust shatters'
  },

  reunion: {
    filmReference: 'Like the airport scene in Love Actually - joy of reconnection',
    keyPrinciples: ['momentum', 'joy', 'closing distance'],
    suggestedCamera: {
      angle: 'Level or slightly low, celebratory',
      shotType: 'Wide enough to show approach, then close for embrace',
      movement: 'Track with running figure, or static as they collide',
      focus: 'Sharp on approaching figures, blur background'
    },
    bodyLanguageDirectives: {
      asymmetry: 'Both reaching, but one arrives first into the other\'s arms',
      momentOfChange: 'Moment of impact, arms closing, not static embrace',
      environmentInteraction: 'Others fading into background, only these two matter',
      spatialRelationship: 'Distance closing rapidly, bodies merging'
    },
    lightingSuggestion: 'Bright, hopeful, golden',
    compositionNote: 'Clear path between them, converging lines'
  },

  departure: {
    filmReference: 'Like Casablanca\'s airport - necessary separation',
    keyPrinciples: ['growing distance', 'last looks', 'finality'],
    suggestedCamera: {
      angle: 'Level, dignified',
      shotType: 'Wide to show growing distance, or close on the one left behind',
      movement: 'Static as figure recedes, or track briefly then stop',
      focus: 'Sharp on nearer figure, departing one softening with distance'
    },
    bodyLanguageDirectives: {
      asymmetry: 'One turning away, one watching; different stages of processing',
      momentOfChange: 'Turn away, last look back, or moment of letting go',
      environmentInteraction: 'Departing through doorway, threshold',
      spatialRelationship: 'Distance opening, connection stretching'
    },
    lightingSuggestion: 'Fading light, or harsh light on reality of separation',
    compositionNote: 'Growing negative space between figures'
  },

  realization: {
    filmReference: 'Like the puzzle solving in A Beautiful Mind - internal click visible',
    keyPrinciples: ['internal transformation visible externally', 'stillness of insight'],
    suggestedCamera: {
      angle: 'Close on face, level',
      shotType: 'Close-up or medium close',
      movement: 'Very slow push in as understanding dawns',
      focus: 'Razor sharp on eyes'
    },
    bodyLanguageDirectives: {
      asymmetry: 'N/A for single character',
      momentOfChange: 'Eyes widening, face transforming with understanding',
      environmentInteraction: 'May freeze mid-action as insight strikes',
      spatialRelationship: 'Character alone with the truth'
    },
    lightingSuggestion: 'Light growing, or sudden clarity',
    compositionNote: 'Tight on face, world falls away'
  },

  defiance: {
    filmReference: 'Like "I\'m Spartacus" - standing against the odds',
    keyPrinciples: ['courage visible', 'small vs. large', 'refusal to yield'],
    suggestedCamera: {
      angle: 'Low angle on defiant character to show courage',
      shotType: 'Medium or wide to show what they stand against',
      movement: 'Static, unflinching like the character',
      focus: 'Sharp on defiant face'
    },
    bodyLanguageDirectives: {
      asymmetry: 'Defiant one upright and solid, opposition looming',
      momentOfChange: 'Chin lifting, spine straightening, eyes locking',
      environmentInteraction: 'Standing ground, feet planted',
      spatialRelationship: 'Refusing to retreat despite pressure'
    },
    lightingSuggestion: 'Defiant character may be lit heroically',
    compositionNote: 'Defiant one smaller in frame but central, eye-catching'
  },

  submission: {
    filmReference: 'Like Theon bowing to Ramsay - spirit breaking',
    keyPrinciples: ['collapse visible', 'power transfer', 'loss of self'],
    suggestedCamera: {
      angle: 'High angle on submitting character, low on victor',
      shotType: 'Wide to show relationship, or close on broken expression',
      movement: 'Static, letting moment land',
      focus: 'Both in focus to show dynamic'
    },
    bodyLanguageDirectives: {
      asymmetry: 'Victor expanded, submitting one collapsed',
      momentOfChange: 'Knees buckling, head bowing, shoulders falling',
      environmentInteraction: 'Falling to knees, hand reaching for support',
      spatialRelationship: 'Victor looming, submitting one diminished'
    },
    lightingSuggestion: 'Victor in light, submitting one in shadow',
    compositionNote: 'Victor dominant in frame, submitting one low'
  },

  triumph: {
    filmReference: 'Like Rocky at the top of the stairs - victory earned',
    keyPrinciples: ['elevation', 'expansion', 'earned joy'],
    suggestedCamera: {
      angle: 'Low angle looking up at triumphant character',
      shotType: 'Wide enough to see full celebration, or close on joy',
      movement: 'May track up with raised arms',
      focus: 'Sharp on triumphant figure'
    },
    bodyLanguageDirectives: {
      asymmetry: 'Victor expanded maximally, others smaller/lower',
      momentOfChange: 'Arms rising, body expanding, face transforming',
      environmentInteraction: 'Standing on height, arms spread, taking in world',
      spatialRelationship: 'Victor elevated literally or figuratively'
    },
    lightingSuggestion: 'Bright, golden, heroic lighting',
    compositionNote: 'Victor central, elevated, world beneath'
  },

  defeat: {
    filmReference: 'Like Michael at the end of Godfather II - having won but lost',
    keyPrinciples: ['collapse', 'isolation', 'weight of loss'],
    suggestedCamera: {
      angle: 'Level or slightly high, looking down on fallen',
      shotType: 'Medium or wide to show isolation',
      movement: 'Slow pull back to reveal emptiness',
      focus: 'Sharp on face, emptiness around'
    },
    bodyLanguageDirectives: {
      asymmetry: 'N/A for single character in defeat',
      momentOfChange: 'Falling, crumbling, or already still in aftermath',
      environmentInteraction: 'Slumped against wall, fallen to floor',
      spatialRelationship: 'Alone in frame, surrounded by emptiness or wreckage'
    },
    lightingSuggestion: 'Low, shadowed, drained of warmth',
    compositionNote: 'Figure small in frame, overwhelmed by space'
  },

  atmosphere: {
    filmReference: 'Like the aspect-to-aspect sequences in manga — mood through environment, not action',
    keyPrinciples: ['environmental storytelling', 'mood through detail', 'stillness with weight'],
    suggestedCamera: {
      angle: 'Varies — eye-level for grounded, high for overview, low for looming',
      shotType: 'Wide or detail shot — no character-centric framing',
      movement: 'Static or very slow drift, contemplative',
      focus: 'Sharp on environmental details, soft periphery'
    },
    bodyLanguageDirectives: {
      asymmetry: 'N/A — no characters in focus',
      momentOfChange: 'The environment holds the aftermath or anticipation',
      environmentInteraction: 'Objects left behind, spaces recently vacated, weather against surfaces',
      spatialRelationship: 'The world speaking for absent or diminished characters'
    },
    lightingSuggestion: 'Mood-driven — match the emotional residue of surrounding beats',
    compositionNote: 'Environmental details fill the frame, negative space carries emotional weight'
  }
};

// ============================================
// LIGHTING ENRICHMENT (from LIGHTING_MOOD_VOCABULARY principles)
// ============================================

interface LightingProfile {
  direction: string;
  quality: string;
  temperature: string;
  shadows: string;
}

const BEAT_LIGHTING_PROFILES: Record<BeatType, LightingProfile> = {
  confrontation:  { direction: 'side-lit',  quality: 'hard/harsh',    temperature: 'mixed warm/cool', shadows: 'hard shadows' },
  revelation:     { direction: 'side-lit',  quality: 'dramatic contrast', temperature: 'cool blue',   shadows: 'hard shadows' },
  intimacy:       { direction: 'front-lit', quality: 'soft/diffuse',  temperature: 'warm gold',       shadows: 'soft shadows' },
  action:         { direction: 'side-lit',  quality: 'hard/harsh',    temperature: 'mixed warm/cool', shadows: 'hard shadows' },
  transition:     { direction: 'side-lit',  quality: 'dappled',       temperature: 'mixed warm/cool', shadows: 'soft shadows' },
  decision:       { direction: 'front-lit', quality: 'dramatic contrast', temperature: 'mixed warm/cool', shadows: 'hard shadows' },
  threat:         { direction: 'back-lit',  quality: 'hard/harsh',    temperature: 'cool blue',       shadows: 'hard shadows' },
  comfort:        { direction: 'front-lit', quality: 'soft/diffuse',  temperature: 'warm gold',       shadows: 'soft shadows' },
  betrayal:       { direction: 'side-lit',  quality: 'dramatic contrast', temperature: 'cool blue',   shadows: 'hard shadows' },
  reunion:        { direction: 'back-lit',  quality: 'soft/diffuse',  temperature: 'warm gold',       shadows: 'soft shadows' },
  departure:      { direction: 'back-lit',  quality: 'hard/harsh',    temperature: 'cool blue',       shadows: 'soft shadows' },
  realization:    { direction: 'front-lit', quality: 'dramatic contrast', temperature: 'mixed warm/cool', shadows: 'soft shadows' },
  defiance:       { direction: 'back-lit',  quality: 'dramatic contrast', temperature: 'warm gold',   shadows: 'hard shadows' },
  submission:     { direction: 'top-lit',   quality: 'hard/harsh',    temperature: 'cool blue',       shadows: 'hard shadows' },
  triumph:        { direction: 'back-lit',  quality: 'soft/diffuse',  temperature: 'warm gold',       shadows: 'soft shadows' },
  defeat:         { direction: 'top-lit',   quality: 'hard/harsh',    temperature: 'cool blue',       shadows: 'hard shadows' },
  atmosphere:     { direction: 'side-lit',  quality: 'dappled',       temperature: 'mixed warm/cool', shadows: 'soft shadows' },
};

function enrichLightingSuggestion(beatType: BeatType, baseSuggestion: string): string {
  const profile = BEAT_LIGHTING_PROFILES[beatType];
  return `${baseSuggestion}, ${profile.direction}, ${profile.quality}, ${profile.temperature} temperature, ${profile.shadows}`;
}

// ============================================
// MAIN ANALYSIS FUNCTION
// ============================================

/**
 * Analyze a story beat and return cinematic direction
 */
export function analyzeBeatCinematically(
  beatText: string,
  emotionalRead?: string,
  relationshipDynamic?: string
): CinematicAnalysis {
  const beatType = detectBeatType(beatText, emotionalRead, relationshipDynamic);
  const template = CINEMATIC_TEMPLATES[beatType];

  return {
    beatType,
    ...template,
    lightingSuggestion: enrichLightingSuggestion(beatType, template.lightingSuggestion),
  };
}

/**
 * Get body language directives for a specific beat type
 */
export function getBodyLanguageForBeatType(beatType: BeatType): CinematicAnalysis['bodyLanguageDirectives'] {
  return CINEMATIC_TEMPLATES[beatType].bodyLanguageDirectives;
}

/**
 * Get camera suggestions for a specific beat type
 */
export function getCameraForBeatType(beatType: BeatType): CinematicAnalysis['suggestedCamera'] {
  return CINEMATIC_TEMPLATES[beatType].suggestedCamera;
}
