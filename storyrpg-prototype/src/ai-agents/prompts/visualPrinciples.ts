/**
 * Core Visual Storytelling Principles for AI Image Generation
 * Derived from the Visual Storytelling Best Practices Guide and Quick Reference.
 */

export const CORE_VISUAL_PRINCIPLE = `
## CORE PRINCIPLE: EVERY IMAGE IS A STORY BEAT, NOT A PORTRAIT.
Images must illustrate the STORY BEAT — physical action (what's happening), emotion (what they're feeling), and relationship dynamics (tension, intimacy, conflict, connection between characters).
They must convey all three: action, emotion, and relationship.

AVOID the "Single Character Portrait" trap:
❌ Only ONE character shown when multiple are in the scene
❌ Character standing center-frame with no clear action
❌ Character posing rather than DOING, FEELING, or RELATING
❌ Missing characters who are part of the scene
❌ No visible interaction between characters who are together
❌ Neutral/ambiguous body language
❌ Same composition as previous image

INSTEAD, every image MUST show:
✅ ALL characters present in the beat, visibly interacting
✅ A clear BEAT — physical action (what's happening), emotion (what they're feeling), and/or relationship dynamics (tension, intimacy, conflict between them)
✅ Characters' spatial and emotional relationship (close, distant, facing, turned away, connected, adversarial)
✅ Body language that conveys both action AND emotion (not just looks dynamic)
✅ The environment as a participant, not just a backdrop
`;

export const MOBILE_COMPOSITION_FRAMEWORK = `
## MOBILE COMPOSITION (9:19.5 Full-Bleed)
- **Primary Safe Zone**: 9:16 ratio, centered vertically.
- **Critical Content Zone (Upper 2/3 of 9:16)**: ALL narrative-critical elements (faces, key objects, focal action, important gestures).
- **UI Overlay Zone (Lower 1/3 of 9:16)**: Ground plane, shadows, feet, or ambient details only.
- **Atmospheric Extension (Outside 9:16)**: Sky, blur, textures—non-essential content only.
- **Rule of Thirds**: Position focal points slightly off-center in the upper power positions.
`;

export const SHOT_TYPE_SYSTEM = `
## SHOT TYPE SYSTEM
- **ELS (Extreme Long Shot)**: Environment dominant. Use for establishing scale, isolation, context.
- **LS (Long Shot)**: Full body. Use for arrival, distance confrontations, body language.
- **MLS (Medium Long Shot)**: Knees up. Workhorse for action + context.
- **MS (Medium Shot)**: Waist up. Primary for dialogue and interaction.
- **MCU (Medium Close-Up)**: Chest up. Intimate dialogue, emotional emphasis.
- **CU (Close-Up)**: Face fills frame. Peak emotion, revelations, decisions.
- **ECU (Extreme Close-Up)**: Detail focus. Moment of truth, crucial objects.
`;

export const CAMERA_ANGLE_SYSTEM = `
## CAMERA ANGLE SYSTEM
- **Bird's Eye**: Directly above. Tactical, detached, god-like perspective.
- **High Angle**: Looking down. Makes subject appear vulnerable, diminished, or judged.
- **Eye-Level**: Neutral, equal footing. Baseline (avoid repeating for 3+ images).
- **Low Angle**: Looking up. Makes subject appear powerful, imposing, or heroic.
- **Worm's Eye**: From ground level. Maximum power, monumental threat/drama.
- **Dutch Angle**: Tilted horizon. Use for unease, instability, crisis.
  - Subtle (5-15°): Something is off.
  - Moderate (15-30°): Clear tension.
  - Extreme (30-45°): Psychological break/crisis.
`;

export const BODY_LANGUAGE_VOCABULARY = `
## BODY LANGUAGE, LINE OF ACTION & STAGING
- **The Line of Action**: Every character MUST have a clear line of action (C-curve, S-curve, or strong diagonal). Avoid straight, static vertical spines.
- **Cinematic Staging**: 
  - **Front-On (0°)**: Direct engagement, confrontational.
  - **Three-Quarter (45°)**: Natural, dimensional, cinematic. Use for most scenes.
  - **Profile (90°)**: Stoic, thoughtful, distant.
  - **Over-the-Shoulder**: Relationship emphasis, dialogue staging.
- **Emotional Keywords**:
  - **Confident/Powerful**: Expanded posture, open chest, chin elevated, weight planted.
  - **Vulnerable/Defeated**: Contracted posture, hunched shoulders, lowered chin, protective gesture.
  - **Aggressive/Threatening**: Forward lean, squared shoulders, intense gaze, invading space.
  - **Fearful/Retreating**: Backward lean, body turned away, defensive arms, weight on back foot.
  - **Intimate/Connected**: Bodies angled toward each other, close proximity, soft posture.
`;

// ============================================
// POSE BEST PRACTICES SYSTEM
// ============================================

export const STORY_BEAT_DEFINITION = `
## STORY BEAT DEFINITION (MANDATORY FOR EVERY IMAGE)
Before specifying any visual, ALWAYS define:
1. **Story Purpose**: "[action] + [emotion] + [relationship dynamic]"
2. **One Clear Idea**: Only ONE primary beat per image (never "realizes betrayal while dodging explosion")
3. **Scene Context**: What happened just before? What happens just after? This informs the pose.
4. **Narrative Frame**: Treat as a film still, NOT a poster or pin-up.

**Prompt Pattern**:
"[who] in [moment], [action], showing [emotion], [relationship dynamic], cinematic story frame, not a poster"
`;

export const POSE_LINE_OF_ACTION = `
## LINE OF ACTION (CHARACTER SPINE)
The Line of Action is the invisible curve running through the character's body that creates dynamic, living poses.

**REQUIRED**: Every character must have one of:
- **S-Curve**: Elegant, flowing, graceful movement (conversation, walking, thinking)
- **C-Curve**: Strong, dramatic arc (action, reaction, emotional moment)
- **Diagonal**: Dynamic tension, forward momentum (running, attacking, falling)

**FORBIDDEN**: 
- Straight vertical spine (rigid, lifeless, mannequin-like)
- Perfectly symmetrical poses
- "Standing at attention" default

**Prompt Pattern**:
"dynamic [S-curve/C-curve/diagonal] line of action through body"
`;

export const POSE_TILT_RHYTHM_TWIST = `
## TILT, RHYTHM, AND TWIST
These three principles prevent stiff, robotic poses:

**TILT** (No Parallel Lines):
- Head tilts opposite to shoulder line
- Shoulder line tilts opposite to hip line
- No horizontal alignments across body parts

**RHYTHM** (Straights vs Curves):
- Alternate straight and curved limbs
- One arm straight, one arm bent
- Tension side vs relaxation side

**TWIST** (Torso Rotation):
- Shoulders and hips face different directions
- Creates depth and dimensionality
- Avoids flat, square-on-to-camera poses

**Prompt Pattern**:
"twisted torso with tilted shoulders and hips, rhythmic alternating limb curves, dimensional pose"
`;

export const POSE_ASYMMETRY_RULES = `
## ASYMMETRY RULES
Symmetrical poses look artificial. Break symmetry intentionally:

**ARM POSITIONS**:
- One arm active (gesture, hold, reach), one arm passive
- Different bend angles in each arm
- Different hand positions (fist vs open, etc.)

**LEG POSITIONS**:
- One leg bearing weight, one leg relaxed or stepping
- In walks/motion: opposite arm and leg forward (contraposto)
- Different knee bend angles

**WEIGHT DISTRIBUTION**:
- Weight rarely 50/50 on both feet
- Clearly favor one leg for stability
- Let non-weight leg relax naturally

**Prompt Pattern**:
"asymmetric pose, [one arm description] while [other arm description], weight shifted to [side]"
`;

export const POSE_WEIGHT_AND_BALANCE = `
## WEIGHT AND BALANCE UNDER GRAVITY
Characters must look like they exist in physical space:

**STABLE POSES** (conversation, standing, waiting):
- Center of mass directly over support foot/feet
- Planted, grounded feeling
- Relaxed non-weight-bearing limbs

**ACTION POSES** (running, fighting, falling):
- Center of mass pushed PAST support base
- Obvious forward/backward momentum
- Body catching up to or recovering from motion

**SEATED/LEANING**:
- Weight clearly pressing into support surface
- Body conforming to chair/wall/ground
- Gravity pulling loose elements down

**Prompt Pattern**:
"[grounded/off-balance] pose, weight [planted on/shifting toward] [direction], center of gravity [stable/moving]"
`;

export const POSE_SILHOUETTE_CLARITY = `
## SILHOUETTE CLARITY
A good pose is readable as a solid black silhouette:

**SEPARATION**:
- Arms separated from torso (negative space between)
- Legs not overlapping each other
- Weapons/tools not hidden behind body
- Hair/clothing with clear edges

**READABILITY**:
- Key shapes (hands, head, props) clearly visible
- Action/gesture obvious without detail
- Emotion readable from shape alone

**COMMON MISTAKES**:
- Arms pressed against sides
- Legs perfectly parallel
- Important objects hidden by body
- Hair blending into back

**Prompt Pattern**:
"clear readable silhouette, limbs separated from body, negative space around gesture, distinctive outline"
`;

export const POSE_VOCABULARY = `
## POSE VOCABULARY BY STORY BEAT

**CONVERSATION/NEUTRAL**:
- hip-shot stance, weight on one leg, casual lean
- arms: one hand gesturing, other relaxed at side/in pocket/on hip
- S-curve spine, head tilted toward speaker

**THINKING/CONSIDERING**:
- weight shifted back, hand to chin/temple
- contracted posture, C-curve inward
- gaze directed away or downward

**ANNOUNCING/DECLARING**:
- expanded chest, weight forward
- arm gesture outward, other hand for emphasis
- diagonal line of action toward audience

**RECEIVING NEWS**:
- weight rocking back, hand to chest/mouth
- spine recoiling into C-curve
- wide eyes, pulled-back shoulders

**PREPARING FOR ACTION**:
- coiled stance, knees bent, weight on balls of feet
- arms ready position, shoulders tensed
- forward lean, compressed S-curve

**IN MOTION (walk/run)**:
- clear weight transfer mid-stride
- opposite arm/leg forward (contraposto)
- trailing elements (hair, coat, scarf) showing direction

**COMBAT/CONFRONTATION**:
- aggressive forward lean or defensive crouch
- arms in guard/attack position
- strong diagonal or C-curve for power

**EXHAUSTION/DEFEAT**:
- collapsed C-curve, drooping head
- weight sagging, slumped shoulders
- limp arms, bent knees, lowered gaze

**TRIUMPH/VICTORY**:
- fully expanded S-curve upward
- arms raised or spread wide
- chin up, chest out, solid stance

**INTIMACY/CONNECTION**:
- bodies angled toward each other
- mirrored subtle poses
- reaching/touching gestures, soft curves
`;

export const COMPOSITION_STORYTELLING = `
## COMPOSITION FOR STORYTELLING (Not Decoration)

**FOCAL POINT (The Beat)**:
- The focal point is the KEY MOMENT — action, emotion, or relationship — not necessarily a single character's face
- For multi-character scenes: the focal point is often the SPACE BETWEEN characters (a gesture, exchanged object, clasped hands, crossed swords, the gap of tension, a shared look)
- For single-character scenes: the focal point is what the character is DOING, FEELING, or REACTING to (reaching, grieving, discovering, hesitating)
- Highest contrast, detail, and sharpness on the focal action
- Everything else progressively simpler

**RULE OF THIRDS & ASYMMETRY**:
- Place focal point on thirds intersection
- NEVER dead center unless intentionally confrontational
- Use asymmetry to create visual tension

**GUIDING LINES**:
- Use environment as arrows to focal point
- Pose elements (arms, weapons, gaze) point inward
- Architecture, light beams, paths lead the eye

**NEGATIVE SPACE**:
- Clean area around focal point for breathing room
- Don't fill edge-to-edge with equal detail
- Use emptiness for emotional weight

**DEPTH LAYERS**:
- Explicit foreground, midground, background
- Subject in mid or foreground
- Background atmospheric/simplified
- Overlapping elements create depth

**Prompt Pattern**:
"cinematic composition, strong focal point on rule-of-thirds, leading lines toward [subject], clear foreground-midground-background, intentional negative space"
`;

export const LIGHTING_MOOD_VOCABULARY = `
## LIGHTING FOR STORY MOOD

**DIRECTION**:
- **Front-lit**: Flat, safe, neutral (documentary feel)
- **Side-lit**: Dramatic, sculptural, revealing texture
- **Back-lit**: Mysterious, silhouette, heroic rim
- **Top-lit**: Harsh, interrogation, overhead sun
- **Under-lit**: Creepy, unnatural, villain lighting

**QUALITY**:
- **Soft/Diffuse**: Tenderness, nostalgia, safety, romance
- **Hard/Harsh**: Conflict, danger, clarity, intensity
- **Dappled**: Nature, dreamlike, memory
- **Dramatic contrast**: High stakes, noir, confrontation

**COLOR TEMPERATURE**:
- **Warm (orange/gold)**: Safety, intimacy, hope, sunset, fire
- **Cool (blue/green)**: Isolation, sadness, night, unease, technology
- **Mixed warm/cool**: Visual tension, transition, conflict

**SHADOW TREATMENT**:
- **Soft shadows**: Comfort, daytime, peace
- **Hard shadows**: Threat, mystery, sharp contrast
- **No shadows**: Flat, dreamlike, flashback

**Prompt Pattern**:
"[side/back/rim] lighting, [soft/hard] shadows, [warm/cool] color temperature, [high/low] contrast, lighting emphasizes [emotion]"
`;

export const POSE_DIVERSITY_CHECKLIST = `
## POSE DIVERSITY CHECKLIST
When reviewing a sequence of images, verify:

**ACROSS CONSECUTIVE IMAGES**:
□ Different line of action (S-curve vs C-curve vs diagonal)
□ Different weight distribution (left vs right, stable vs moving)
□ Different arm positions (gesture type, height, extension)
□ Different camera angle (no 3+ same angles in a row)
□ Different shot distance (vary ELS/LS/MS/CU)
□ Different horizontal staging (front, 3/4, profile rotation)

**WITHIN EACH IMAGE**:
□ Clear line of action visible
□ Asymmetric limb positions
□ Tilt in head/shoulders/hips
□ Weight clearly distributed
□ Silhouette readable
□ Pose matches story beat emotion

**RED FLAGS (Regenerate if found)**:
⚠️ Standing straight with arms at sides
⚠️ Perfect symmetry in pose
⚠️ Square-on to camera without purpose
⚠️ Same pose as previous image in sequence
⚠️ Weight evenly distributed on both feet
⚠️ Rigid vertical spine
⚠️ Arms pressed against body
⚠️ Generic "model pose" unrelated to story
`;

export const PROMPT_ASSEMBLY_PATTERN = `
## PROMPT ASSEMBLY PATTERN FOR STORY ART
Structure every prompt with these components in order:

[SHOT_TYPE & CAMERA] + [ACTION, EMOTION & RELATIONSHIP] + [ALL CHARACTERS & SPATIAL RELATIONSHIP] + [BODY LANGUAGE & POSE] + [COMPOSITION_SPEC] + [LIGHTING_MOOD] + [STYLE]

**Complete Example (Multi-Character — action + emotion + relationship)**:
"medium long shot 3/4 view, low angle, a young knight kneeling to present a broken sword to her commander who stands over her with arms crossed and jaw clenched, the knight's head bowed in shame and guilt while the commander's rigid posture radiates disappointment and barely contained fury, the knight in a C-curve of defeat with weight collapsed forward while the commander towers in a rigid diagonal of authority, two figures facing each other at intimate distance — the tension between them palpable, power dynamic encoded in their poses and expressions, cinematic composition with the broken sword at the rule-of-thirds intersection between them, leading lines from throne room columns converging on the pair, foreground scattered debris midground the two figures background the empty throne, dramatic side lighting with cool blue from tall windows and warm amber from a dying hearth, high contrast"

**Complete Example (Single Character in Action)**:
"medium shot 3/4 view, low angle, a tired mech pilot slumping against hangar wall while reaching for fallen dog tags on the oil-stained floor, expression of quiet shock and guilt, dynamic S-curve body sliding down wall with weight collapsing, one arm limp and one stretching toward the tags, clear readable silhouette against the massive mech leg in background, cinematic composition with focal point on reaching hand at rule-of-thirds intersection, leading lines from cables pointing to pilot, clear foreground-midground-background depth, moody side lighting with cool overhead and warm rim from hangar door, high contrast"

**Abbreviated Example** (minimum viable):
"MLS 3/4 low, knight kneeling presenting broken sword to standing commander, shame vs disappointment, C-curve vs rigid diagonal, facing at tension distance, broken sword at thirds intersection, side-lit cool with warm rim"
`;

export const WALLY_WOOD_PANELS = `
## WALLY WOOD'S 22 PANELS (Visual Variety)
1. Large Head Close-Up, 2. Small Figure Large Environment, 3. Silhouette Against Light, 4. Figure From Behind, 5. Low Angle Looking Up, 6. High Angle Looking Down, 7. Extreme Close-Up on Detail, 8. Three-Quarter Back View, 9. Over-the-Shoulder, 10. Hand/Object in Foreground, 11. Partial Figure Cropped, 12. Reflection or Shadow, 13. Wide Shot with Negative Space, 14. Deep Background Focus, 15. Profile Silhouette, 16. Bird's Eye View, 17. Worm's Eye View, 18. Emerging from Darkness, 19. Split Focus, 20. Compressed Foreground/Background, 21. Framed by Environment, 22. Dutch Angle.
`;

export const SEQUENCE_VARIETY_RULES = `
## SEQUENCE VARIETY & RHYTHM
**Never generate consecutive images with the same**:
- Shot distance (e.g., MS -> MS)
- Camera angle (e.g., Eye-level -> Eye-level)
- Character staging (same pose twice)
- Compositional focal point (same power position)

**Standard 4-Shot Rhythm**:
1. Context (LS/MLS)
2. Engagement (MS/MCU)
3. Peak (CU/ECU)
4. Resolution (Varies)
`;

export const VISUAL_BEAT_MAPPING = `
## STORY BEAT VISUAL TREATMENTS

Each beat type should be rendered as a DRAMATIC MOMENT — not a summary but a frozen instant that shows the tension, action, and emotion.

- **Revelation**: CU/MCU, Eye-level, frozen reaction, side-lighting.
  *The moment*: "Marcus freezes, letter crumpling in his fist, as Elena's voice calls from the doorway"
  *The tension*: "The space between them — he knows, she doesn't know he knows"
  *The visual key*: "His white-knuckle grip on the letter, her unsuspecting smile in the background"

- **Romance**: MCU two-shot, Eye-level, close proximity, warm/soft light.
  *The moment*: "Their fingers brush reaching for the same cup, both startled, faces inches apart"
  *The tension*: "The held breath between them — neither pulling away"
  *The visual key*: "The touching hands, the surprise in both pairs of eyes, the steam rising between them"

- **Confrontation**: MS/MLS, Low/High angle split, squared off, high contrast.
  *The moment*: "Elena slams the evidence on the table, Marcus's jaw clenches but he doesn't look down"
  *The tension*: "The table between them is a battlefield — the papers scattered, her leaning in, him pulling back"
  *The visual key*: "Her rigid pointing finger, his averted gaze, the damning papers between them"

- **Victory**: LS/MLS, Low angle, expanded posture, bright/warm light.
  *The moment*: "She bursts through the doors into golden light, arms wide, the crowd rising behind her"
  *The tension*: "The release — weight lifted, lungs full, the world opening up"
  *The visual key*: "Open stance silhouetted against light, others mid-rise in background"

- **Defeat**: MS/CU, High angle, contracted posture, muted/flat light.
  *The moment*: "He sinks into the chair, the rejection letter sliding from limp fingers, rain streaking the window"
  *The tension*: "The collapse inward — shoulders folding, the last hope draining"
  *The visual key*: "The falling letter, the hunched shoulders, the rain outside mirroring the mood"

- **Suspense**: Varied shot, Dutch angle, tense/partial framing, deep shadows.
  *The moment*: "A shadow falls across the hallway as she reaches for the door handle, something moving behind her"
  *The tension*: "She doesn't see it — WE see it — the shape just beyond the light"
  *The visual key*: "Her hand on the handle, the menacing shadow stretching across the floor"

- **Decision**: CU/ECU, Eye-level/Low angle, focused/still, intense light.
  *The moment*: "He stares at the two paths — the safe road home, the dark forest — his hand tightening on his pack"
  *The tension*: "The weight of choosing — everything balanced on this breath"
  *The visual key*: "Eyes locked forward, grip on the pack strap, the diverging paths filling the frame"
`;

export const DRAMATIC_ILLUSTRATION_PRINCIPLES = `
## DRAMATIC IMAGE QUALITY (Style-Agnostic — Applies to ALL Art Styles)

These principles define image QUALITY, not aesthetic style. They apply whether the chosen style is watercolor, digital painting, ink wash, anime, or anything else.

### EXPRESSIONS
- Emotions must be READABLE at thumbnail size. Push expressions — if a character is angry, the viewer should feel it from the face and body alone, before reading any text.
- Eyebrows, eyes, and mouth are the emotional engine. They deserve precision and emphasis in every image.
- Subtle emotions are fine, but they must be INTENTIONALLY subtle — a tightened jaw, averted eyes, a half-suppressed smile. Not vague or blank.

### POSES & BODY LANGUAGE
- Every pose tells the story at a glance. The silhouette alone should communicate what is happening and how the character feels.
- Lean INTO the action. Characters in tense moments should have tension in their bodies — clenched fists, forward weight, coiled energy.
- Gesture over stiffness. Even a calm conversation should have one character gesturing, leaning, turning — bodies in motion, not mannequins.

### ENERGY & DYNAMISM
- These are dramatic story art, not photographs. Favor dynamic over static, tension over calm, gesture over neutral pose.
- Even quiet moments have visual energy — the energy of restraint, of held breath, of eyes meeting across a room.
- Camera angles should SERVE the drama: low angles for power, high angles for vulnerability, Dutch angles for instability.

### FACES & HANDS
- Faces and hands carry the emotion — they deserve the most attention and detail in every image.
- Hands reveal intent: clenched for anger, open for honesty, fidgeting for anxiety, reaching for connection.
- Close-ups should show emotional micro-detail. Wide shots should still have readable faces.

### VISUAL STORYTELLING
- Each image should tell a complete story beat at a glance. A viewer who sees only the image — no text — should understand the emotional state of the scene.
- Character RELATIONSHIPS should be visible in the composition: distance, orientation, body language, eye contact (or lack of it).
- The environment is not just a backdrop — it participates in the storytelling through lighting, weather, clutter, emptiness, color.
`;

export const FORBIDDEN_DEFAULTS = `
## THE "NEVER DO" LIST
1. NEVER show only ONE character when the beat involves MULTIPLE characters interacting.
2. NEVER reduce a scene to a character portrait — show the BEAT (action, emotion, relationship).
3. NEVER dead-center facing camera without reason.
4. NEVER eye-level for 3+ consecutive images.
5. NEVER repeat shot type in consecutive images.
6. NEVER neutral symmetrical "standing" pose for emotional beats.
7. NEVER critical content in lower third of 9:16.
8. NEVER Dutch angle without justification.
9. NEVER lose character's face in shadow during emotional peaks — EXCEPTION: at deliberate dramatic peaks (climax, revelation), intentional shadow on face for mood is acceptable when clearly intended.
10. NEVER ECU for mundane moments.
11. NEVER flatten depth (always maintain foreground/background).
12. NEVER include unwanted text, words, or AI signatures/watermarks in the art. (Text is only allowed if it's part of a diegetic environmental sign or clothing logo).
13. NEVER forget: Every image is a story beat, not a portrait. Show what is HAPPENING — action, emotion, and relationship.
14. NEVER repeat the same staging or pose in consecutive images. If the last image had a character seated, the next must NOT. Vary environments and body language across the sequence — mix sitting, standing, walking, leaning, crouching, gesturing. A desk scene is fine when the beat calls for it; three desk scenes in a row is a failure.
15. NEVER show characters in passive, observational poses when the story beat involves action, confrontation, or emotional intensity. The body should REFLECT the drama.
`;

export const VISUAL_STORYTELLING_PROMPT = `
${DRAMATIC_ILLUSTRATION_PRINCIPLES}
${CORE_VISUAL_PRINCIPLE}
${STORY_BEAT_DEFINITION}
${MOBILE_COMPOSITION_FRAMEWORK}
${SHOT_TYPE_SYSTEM}
${CAMERA_ANGLE_SYSTEM}
${BODY_LANGUAGE_VOCABULARY}
${POSE_LINE_OF_ACTION}
${POSE_TILT_RHYTHM_TWIST}
${POSE_ASYMMETRY_RULES}
${POSE_WEIGHT_AND_BALANCE}
${POSE_SILHOUETTE_CLARITY}
${COMPOSITION_STORYTELLING}
${LIGHTING_MOOD_VOCABULARY}
${SEQUENCE_VARIETY_RULES}
${VISUAL_BEAT_MAPPING}
${FORBIDDEN_DEFAULTS}
`;

// Compact visual storytelling principles for encounter images.
// The full VISUAL_STORYTELLING_PROMPT is ~8000 chars and causes Gemini to
// generate text instead of images. This condenses the highest-value
// principles for encounter-specific image generation into ~800 chars.
export const ENCOUNTER_VISUAL_PRINCIPLES_COMPACT = `
VISUAL STORYTELLING RULES:
- This is a STORY BEAT, not a portrait. Show action, emotion, and relationship between characters.
- ALL characters present in the beat must be visible and interacting.
- Expressions must be READABLE at thumbnail size. Push emotions — anger, fear, triumph should register from face alone.
- Faces and hands carry the emotion and deserve the most detail.
- POSE: S-curve or C-curve through spine, NEVER straight vertical. Arms separated from body, weight on one foot, asymmetric stance. Readable as a black silhouette.
- COMPOSITION: Focal point on the action/tension at rule-of-thirds intersection, not dead center. Clear foreground-midground-background depth.
- MOBILE FRAMING: All narrative-critical elements (faces, key objects, focal action) in the upper 2/3 of the frame. Lower 1/3 is ground plane only.
- Body language must be ASYMMETRIC between characters — one advancing while the other retreats, one open while the other is guarded.
`;

// Compact visual storytelling principles for story beat images.
// Parallel to ENCOUNTER_VISUAL_PRINCIPLES_COMPACT but tuned for regular
// narrative beats where the image model needs positive storytelling guidance,
// not just defensive rules. ~600 chars to avoid tipping Gemini into text mode.
export const STORY_BEAT_VISUAL_PRINCIPLES_COMPACT = `
VISUAL STORYTELLING RULES:
- This is a STORY BEAT — show action, emotion, and relationship, not a portrait or pose.
- Focal point on the action or tension, placed at a rule-of-thirds intersection — never dead center.
- Clear foreground-midground-background depth. Environment participates in the story, not just backdrop.
- Lighting serves the mood: warm for safety/intimacy, cool for isolation/danger, high contrast for conflict.
- Faces and hands carry the emotion and deserve the most detail. Expressions must read at thumbnail size.
- All narrative-critical content (faces, key objects, focal action) in the UPPER 2/3 of the frame.
- Body language is ASYMMETRIC — one character advancing while the other retreats, one open while the other is guarded.
- Capture the FROZEN MOMENT of change — mid-reach, mid-recoil, mid-turn — not the static before or after.
`;

// Beat-type-specific staging directions. Each entry replaces the generic
// "DRAMATIC STAGING" paragraph in buildNarrativePrompt when beatType is known,
// giving the image model concrete visual direction for the type of moment.
export const BEAT_STAGING_MAP: Record<string, string> = {
  confrontation:
    'Two characters squared off, tension visible in the space between them. ' +
    'One advancing or leaning in, the other bracing or pulling back. High contrast lighting. ' +
    'Hands gripping objects, table edges, or clenched at sides. Jaw set, eyes locked. ' +
    'Capture the moment of escalation — mid-accusation, mid-recoil — not the static standoff.',
  revelation:
    'Freeze on the REACTION — the recoiling body, the widening eyes, the hand that stops mid-gesture. ' +
    'Light falls on the face of the one receiving the truth, showing every micro-expression. ' +
    'The revealer may be composed; the reactor is mid-transformation. ' +
    'Space around the reactor to emphasize the isolation of new understanding.',
  intimacy:
    'Close framing, soft warm light, bodies angled toward each other. ' +
    'The space between them is charged — fingers almost touching, faces inches apart. ' +
    'One leaning slightly forward, the other receiving. Gentle asymmetry in their postures. ' +
    'Capture a private moment — the held breath, the tentative reach, the softening of guards.',
  action:
    'Peak of motion frozen in time — fist at point of impact, body mid-leap, feet pushing off ground. ' +
    'Strong diagonal composition following the vector of movement. High contrast, dynamic energy. ' +
    'Actor and reactor in different phases of motion. Leading space in direction of movement. ' +
    'Cause and effect visible in a single frame.',
  transition:
    'A character in a liminal moment — processing, deciding, shifting between emotional states. ' +
    'Profile or three-quarter view, looking away or inward. Mixed lighting reflecting internal conflict. ' +
    'Smaller in frame, environment pressing in. Posture mid-shift as a new resolve crystallizes. ' +
    'Hands resting on a surface, eyes distant.',
  decision:
    'The weight of choosing visible in the body — torn between two directions. ' +
    'Eyes locked forward, grip tight on something for grounding. ' +
    'Neither fully lit nor fully shadowed — caught in between. ' +
    'The moment BEFORE the choice, not after. Tension held, breath suspended.',
  threat:
    'Danger approaching or looming — the threat large in frame, the target smaller and exposed. ' +
    'Low angle on the threat, high angle on the vulnerable character. Deep shadows. ' +
    'The victim backed against a surface, seeking escape. The threat mid-advance, not static menace. ' +
    'Dread made physical through scale, shadow, and closing distance.',
  comfort:
    'One character sheltering the other — arms closing around, body creating a protective space. ' +
    'Warm soft light like firelight. The comforter open and surrounding, the comforted curled and receiving. ' +
    'Two figures forming one united shape against the world. Gentle, quiet, intimate framing.',
  betrayal:
    'The exact instant trust shatters — the betrayer\'s mask slipping, the victim\'s face transforming from trust to horror. ' +
    'Both faces sharp and in focus, capturing the divergence. Former closeness now feeling like a trap. ' +
    'The betrayer in shadow, the victim exposed. Space cracking open between them.',
  reunion:
    'Joy of reconnection — distance closing rapidly, arms reaching. ' +
    'Bright hopeful golden light. Clear path between the two figures, converging lines. ' +
    'One arriving first into the other\'s arms, both mid-motion. ' +
    'Background fading to blur — only these two matter in this moment.',
  departure:
    'Growing distance between two figures — one turning away, one watching. ' +
    'The departing figure crossing a threshold, the remaining one rooted. ' +
    'Fading light or harsh light on the reality of separation. ' +
    'Negative space opening between them, connection stretching and fraying.',
  realization:
    'Internal understanding made visible — eyes widening, face transforming. ' +
    'Tight on the face, world falling away to soft focus. Light growing as clarity arrives. ' +
    'The character may freeze mid-action as insight strikes. Razor-sharp on the eyes. ' +
    'A moment of absolute stillness amid change.',
  defiance:
    'Standing against the odds — chin lifting, spine straightening, eyes locking on the opposition. ' +
    'Low angle on the defiant character to show courage. Feet planted, refusing to retreat. ' +
    'The defiant figure smaller in frame but central and magnetic, lit heroically. ' +
    'The opposition looming but unable to break the resolve.',
  submission:
    'Spirit breaking visible in the body — knees buckling, head bowing, shoulders falling. ' +
    'High angle looking down on the one submitting, low on the victor. ' +
    'The victor expanded and dominant in frame, the submitting one diminished and in shadow. ' +
    'A hand reaching for support as the ground shifts.',
  triumph:
    'Victory earned and visible — body expanding maximally, arms rising, face transforming with release. ' +
    'Low angle looking up, bright golden heroic light. The victor elevated literally or figuratively. ' +
    'Others smaller or lower in frame, the world opening up around the triumphant figure. ' +
    'The energy of release — lungs full, weight lifted, fists raised or arms spread wide.',
  defeat:
    'The weight of loss collapsing the body — slumped against a wall, fallen to the floor. ' +
    'Low shadowed light drained of warmth. The figure small in frame, overwhelmed by empty space. ' +
    'Hands limp, gaze lowered, shoulders caved inward. ' +
    'Isolation visible in the composition — surrounded by wreckage or emptiness.',
  atmosphere:
    'No characters in focus. The camera lingers on environmental details — ' +
    'light falling through a window, objects left behind, weather against glass, ' +
    'an empty chair, a cooling cup. The mood speaks through the world itself. ' +
    'Wide or detail shots. Quiet, contemplative, atmospheric.',
};

/**
 * Get beat-specific staging direction for buildNarrativePrompt.
 * Returns null for unknown beat types, letting the caller fall back to
 * the generic DRAMATIC STAGING paragraph.
 */
export function getBeatStagingDirection(beatType: string): string | null {
  return BEAT_STAGING_MAP[beatType] || null;
}

// Compact version for agents that need pose info without full context
export const POSE_PRINCIPLES_COMPACT = `
## POSE PRINCIPLES (Mandatory)
1. LINE OF ACTION: S-curve, C-curve, or diagonal through spine. NEVER straight vertical.
2. TILT: Head, shoulders, hips all at different angles. No parallel lines.
3. TWIST: Torso rotated vs hips. No square-on poses without purpose.
4. ASYMMETRY: Arms different, legs different, weight shifted. No mirror poses.
5. WEIGHT: Clearly planted OR clearly off-balance. Never ambiguous 50/50.
6. SILHOUETTE: Limbs separated from body, readable as black shape.
`;

// ============================================
// PANEL TRANSITION SYSTEM (McCloud-inspired)
// ============================================

export const TRANSITION_TYPES = `
## PANEL TRANSITION TYPES (Based on Scott McCloud)

Each transition between images requires the player's brain to fill in gaps. Choose the transition type based on narrative intent and closure load.

### 1. MOMENT_TO_MOMENT (Micro-Progression)
**Closure Load**: Very Low
**What Changes**: Tiny details only (eye movement, tear forming, hand tightening, light flicker)
**What Stays Same**: Character(s), location, framing, camera angle, environment
**Player Experience**: Time slows down, lingering on emotional weight
**Use For**: 
- Key emotional beats: revelation, shock, fear, guilt
- Building suspense before choices
- Making outcomes feel weighty
**Prompt Rule**: "SAME angle, SAME environment, SAME framing, TINY change in [specific detail]"

### 2. ACTION_TO_ACTION (Keyframe Motion)
**Closure Load**: Moderate
**What Changes**: Character pose/position through action sequence (key poses)
**What Stays Same**: Same character, same broad scene/location
**Player Experience**: Satisfying mental animation between poses
**Use For**:
- Physical actions: combat, stunts, travel, item use
- Cause and effect: opening door → revealing contents
- Keeping action sequences brisk
**Prompt Rule**: "SAME subject, SAME setting, DIFFERENT body pose showing [action phase]"

### 3. SUBJECT_TO_SUBJECT (Same Moment, Different Focus)
**Closure Load**: Moderate to High
**What Changes**: Camera focus jumps between subjects (character A → B, person → object)
**What Stays Same**: Same time, same location, same lighting/palette
**Player Experience**: Inferring relationships between subjects in one moment
**Use For**:
- Conversations and confrontations (cut between faces)
- Cause-reaction (instigator → witness)
- Multiple perspectives on same beat
- Moral/relationship choices (your hand → companion's worried face)
**Prompt Rule**: "SAME place, SAME time, SAME lighting, NOW focus on [different subject]"

### 4. SCENE_TO_SCENE (Time/Space Jump)
**Closure Load**: High
**What Changes**: Location, time, often character state (clothes, injuries, mood)
**What Stays Same**: May share character or thematic elements
**Player Experience**: Must infer what happened between scenes
**Use For**:
- Act breaks and time skips
- Branch divergence (choice → jump to different future)
- Parallel plotlines
- Off-screen events
**Prompt Rule**: "NEW time/space, DIFFERENT environment, character state shows [time passage/consequence]"

### 5. ASPECT_TO_ASPECT (Mood & Worldbuilding)
**Closure Load**: Moderate
**What Changes**: Focus wanders across different details/facets of one place
**What Stays Same**: Same general time, same location, consistent mood/palette
**Player Experience**: Soaking in atmosphere, time feels frozen
**Use For**:
- Atmosphere beats before big decisions
- Internal states via symbolic imagery
- Pace reset after heavy action
- Differentiating branch tone (hopeful vs grim)
**Prompt Rule**: "SAME time, SAME general location, CONSISTENT palette/mood, focus on [different detail/aspect]"

### 6. NON_SEQUITUR (Surreal/Symbolic Jump)
**Closure Load**: Very High / Intentionally Disorienting
**What Changes**: Everything - subject, setting, time may all change drastically
**What Stays Same**: Only metaphorical/symbolic links (repeating motif, color, shape)
**Player Experience**: Deliberate disorientation or symbolic meaning
**Use For**:
- Dreams, visions, hallucinations
- Psychological breaks, trauma flashes
- Meta/puzzle storytelling
- Secret endings
**Prompt Rule**: "INTENTIONAL surreal jump, NO obvious narrative link, but visual motif [X] repeats"
`;

export const TRANSITION_SELECTION_RULES = `
## TRANSITION SELECTION RULES

### Based on Story Beat Type:
| Beat Type | Recommended Transition |
|-----------|----------------------|
| Emotional revelation | MOMENT_TO_MOMENT |
| Before critical choice | MOMENT_TO_MOMENT or SUBJECT_TO_SUBJECT |
| Physical action | ACTION_TO_ACTION |
| Dialogue exchange | SUBJECT_TO_SUBJECT |
| After major choice | SCENE_TO_SCENE |
| Atmosphere/mood setting | ASPECT_TO_ASPECT |
| Dream/vision sequence | NON_SEQUITUR |
| Time skip | SCENE_TO_SCENE |
| Building tension | MOMENT_TO_MOMENT → ACTION_TO_ACTION |
| Character reaction | SUBJECT_TO_SUBJECT |

### Sequence Rhythm Patterns:
**Tension Build**: ASPECT → MOMENT → MOMENT → (choice) → ACTION
**Confrontation**: SUBJECT ↔ SUBJECT → MOMENT → (choice) → ACTION/SCENE
**Discovery**: ASPECT → ACTION → MOMENT → SUBJECT
**Climax Resolution**: ACTION → ACTION → MOMENT → SCENE

### Branching Considerations:
- **Before Choice**: Use MOMENT_TO_MOMENT for weight, SUBJECT_TO_SUBJECT for empathy
- **After Choice**: Use SCENE_TO_SCENE for major divergence, ACTION_TO_ACTION for immediate consequence
- **Branch Tone Differentiation**: Use ASPECT_TO_ASPECT with different details per branch
`;

export const TRANSITION_CONTINUITY_RULES = `
## VISUAL CONTINUITY RULES BY TRANSITION TYPE

### MOMENT_TO_MOMENT Continuity:
- Camera angle: IDENTICAL
- Environment: IDENTICAL
- Character position: IDENTICAL (minor adjustment only)
- Lighting: IDENTICAL
- Color palette: IDENTICAL
- Change allowed: ONE specific detail (expression, hand, eye, tear, etc.)

### ACTION_TO_ACTION Continuity:
- Camera angle: Same or motivated follow (track with action)
- Environment: IDENTICAL background
- Character: Same person, different KEY POSE in action sequence
- Lighting: IDENTICAL
- Color palette: IDENTICAL
- Show clear progression: setup → action → impact → aftermath

### SUBJECT_TO_SUBJECT Continuity:
- Camera angle: Can change (cuts between subjects)
- Environment: IDENTICAL location visible
- Lighting: IDENTICAL direction, quality, temperature
- Color palette: IDENTICAL
- Time cues: IDENTICAL (same moment)
- Eye-line match: Subjects should be looking at each other/same thing

### SCENE_TO_SCENE Continuity:
- Camera angle: Can change completely
- Environment: DIFFERENT location
- Character state: Show time passage (clothes, injuries, age, mood)
- Lighting: Can change (new location)
- Color palette: Can shift but maintain story thread
- Bridge elements: Shared character, motif, or thematic link

### ASPECT_TO_ASPECT Continuity:
- Camera angle: Varies across details
- Environment: SAME general location, different focus points
- Lighting: IDENTICAL mood lighting throughout
- Color palette: IDENTICAL - this is what unifies the sequence
- Time: FROZEN - all aspects exist simultaneously
- Mood: CONSISTENT emotional tone across all aspects

### NON_SEQUITUR Continuity:
- Camera angle: Deliberately different
- Environment: Deliberately different
- Character: May be absent or transformed
- Lighting: Can be surreal/impossible
- MOTIF THREAD: ONE repeating visual element (color, shape, symbol)
- Purpose: Disorientation OR symbolic meaning
`;

export const TRANSITION_PROMPT_TEMPLATES = `
## PROMPT TEMPLATES BY TRANSITION TYPE

### MOMENT_TO_MOMENT Template:
"[IDENTICAL camera/angle from previous], [IDENTICAL environment], [SAME character in SAME position], 
ONLY CHANGE: [specific micro-detail: eye movement/tear forming/hand tightening/light flicker], 
maintaining exact same lighting and palette, time barely moves"

### ACTION_TO_ACTION Template:
"[Camera following action], [SAME environment as previous], [SAME character], 
NOW IN: [key pose phase: setup/action/impact/aftermath], 
showing [specific action progression], same lighting, clear motion implication"

### SUBJECT_TO_SUBJECT Template:
"[New angle focused on different subject], [SAME location visible], [SAME time/moment], 
NOW FOCUS ON: [new subject: character B/object/detail], 
[relationship to previous subject], IDENTICAL lighting direction and palette"

### SCENE_TO_SCENE Template:
"[New composition], [DIFFERENT location: describe], [TIME CHANGE: describe], 
[Character state changes: clothes/injuries/mood], 
[Bridge element connecting to previous: character/motif/theme], 
lighting appropriate to new setting"

### ASPECT_TO_ASPECT Template:
"[Wandering focus], [SAME general location], [SAME frozen moment], 
NOW SHOWING: [specific detail/facet: weather/object/face/symbol], 
building [mood: tense/peaceful/ominous/hopeful], 
IDENTICAL palette and lighting to maintain unity"

### NON_SEQUITUR Template:
"[Intentionally jarring composition], [DIFFERENT/surreal setting], 
[Symbolic or dreamlike imagery], NO obvious narrative connection, 
BUT REPEATING MOTIF: [color/shape/symbol from story], 
disorienting yet thematically linked"
`;
