# Visual Storytelling Quick Reference for AI Agents

## StoryRPG Image Generation Prompt Enhancement Guide

---

## CORE PRINCIPLE

**Every image is a STORY BEAT, not a portrait.**

Before generating, ask: What is the EMOTION? What is the DRAMATIC QUESTION? What should the viewer FEEL?

Images must illustrate the STORY BEAT — physical action (what's happening), emotion (what they're feeling), and relationship dynamics (tension, intimacy, conflict, connection between characters).

**AVOID the "Single Character Portrait" trap:**
❌ Only ONE character shown when multiple are in the scene
❌ Character standing center-frame with no clear action  
❌ Character posing rather than DOING, FEELING, or RELATING
❌ Missing characters who are part of the scene
❌ No visible interaction between characters who are together
❌ Neutral/ambiguous body language
❌ Same composition as previous image

**INSTEAD, every image MUST show:**
✅ ALL characters present in the beat, visibly interacting
✅ A clear BEAT — physical action, emotion, and/or relationship dynamics
✅ Characters' spatial and emotional relationship (close, distant, facing, turned away)
✅ Body language that conveys both action AND emotion
✅ The environment as a participant, not just a backdrop

---

## THE ANTI-DEFAULT CHECKLIST

When prompting for images, AVOID the default trap:

❌ Character standing center-frame
❌ Eye-level camera angle
❌ Medium shot distance
❌ Character facing directly at camera
❌ Neutral/ambiguous body language
❌ Same composition as previous image

✅ Character positioned off-center (rule of thirds)
✅ Camera angle matches emotional register
✅ Shot distance serves the narrative beat
✅ Character engaged with scene/action/other characters
✅ Body language SHOWS the emotion
✅ Visual variety from image to image

---

## MOBILE COMPOSITION TEMPLATE (9:19.5 FULL-BLEED)

Add to EVERY image prompt:

```
MOBILE COMPOSITION: Position all narrative-critical elements (faces, key objects, 
focal action) in the upper two-thirds of a 9:16 safe zone, centered within 9:19.5 
full-bleed canvas. Bottom third of safe zone contains only ground plane, shadows, 
or ambient details suitable for UI overlay. Edges outside 9:16 zone contain only 
atmospheric extension (sky, blur, environmental texture).
```

---

## SHOT TYPE QUICK SELECTOR

| Beat Type | Primary Shot | Alternate |
|-----------|--------------|-----------|
| Establishing scene | ELS/LS | MS with environment |
| Casual dialogue | MS | MCU |
| Emotional dialogue | MCU | CU |
| Revelation/Shock | CU | ECU on eyes |
| Intimacy/Romance | MCU two-shot | CU singles |
| Confrontation | MS | MLS |
| Victory | LS/MLS low angle | CU |
| Defeat | MS/CU high angle | LS isolation |
| Action/Combat | MLS | CU for impact |
| Decision moment | CU | ECU |
| Suspense | Varied | Partial frame |

---

## CAMERA ANGLE QUICK SELECTOR

| Emotion/Power Dynamic | Angle |
|-----------------------|-------|
| Neutral/Equal | Eye-level |
| Powerful/Heroic/Dominant | Low angle |
| Vulnerable/Weak/Judged | High angle |
| Unease/Tension/Wrong | Dutch angle |
| Overview/Tactical | Bird's eye |
| Maximum threat/Power | Worm's eye |

---

## BODY LANGUAGE KEYWORDS

### Confident/Powerful
- "expanded posture, open chest, chin elevated, weight planted, hands visible"

### Vulnerable/Defeated
- "contracted posture, hunched shoulders, lowered chin, unstable weight, protective gesture"

### Aggressive/Threatening
- "forward lean, squared shoulders, intense gaze, clenched hands, invading space"

### Fearful/Retreating
- "backward lean, body turned away, defensive arms, wide eyes, weight on back foot"

### Romantic/Intimate
- "bodies angled toward each other, close proximity, soft posture, reaching gesture"

---

## STORY BEAT PROMPT TEMPLATES

### REVELATION
```
Medium close-up, eye-level. [CHARACTER] face showing shock, eyes widened, frozen mid-gesture.
Face in upper-left power position. Dramatic side-lighting. Background softened.
```

### ROMANTIC TENSION
```
Two-shot medium close-up, eye-level intimate. [CHAR A] and [CHAR B] close, bodies angled
toward each other. Space between faces creates tension. Warm soft lighting with backlight glow.
```

### CONFRONTATION
```
Medium shot, low angle on dominant [CHARACTER], high angle on challenged character.
Squared-off staging, distance indicating tension. Dutch angle 15°. High contrast lighting.
```

### TRIUMPH/VICTORY
```
Full shot, low angle looking up at [CHARACTER]. Triumphant pose, expanded body language,
arms raised or confident stance. Bright warm lighting. Background shows conquered challenge.
```

### DEFEAT/DESPAIR
```
Medium close-up, high angle looking down at [CHARACTER]. Contracted posture, collapsed,
protective positioning. Muted flat lighting. Weight of loss visible in body language.
```

### SUSPENSE/DREAD
```
[Varied shot], Dutch angle 20°. [CHARACTER] tense, alert, partially cropped at frame edge.
Negative space where threat may emerge. Deep shadows, high contrast, uncertain light source.
```

### DECISION MOMENT
```
Close-up or ECU, eye-level or slight low angle. [CHARACTER] still, focused, deliberating.
Emphasis on eyes. Dramatic single-source lighting for intensity.
```

### INTIMATE CONVERSATION
```
Medium close-up, eye-level. [CHAR A] and [CHAR B] close proximity, open body language,
leaning slightly toward each other. Soft warm natural lighting. Focus on faces, especially eyes.
```

---

## SEQUENCE VARIETY RULES

**Never consecutive images with:**
- Same shot type
- Same camera angle  
- Same character pose
- Same compositional focal point

**Rhythm pattern for 4-image sequence:**
1. Context (LS/MLS)
2. Engagement (MS/MCU)
3. Peak (CU/ECU)
4. Resolution (varies)

---

## WALLY WOOD'S 22 PANELS - PROMPT KEYWORDS

Use these as alternatives to break monotony:

1. "Tight close-up on face filling frame"
2. "Small figure, vast environment showing scale"
3. "Silhouette backlit against bright source"
4. "Character from behind, entering scene"
5. "Low angle looking up, powerful presence"
6. "High angle looking down, vulnerable"
7. "Extreme close-up on single detail (eye, hand, object)"
8. "Three-quarter back view, looking into distance"
9. "Over-the-shoulder view to second character"
10. "Foreground object large, character behind"
11. "Figure partially cropped by frame edge"
12. "Reflection or shadow showing character"
13. "Wide shot with dramatic negative space"
14. "Deep background, character small"
15. "Profile silhouette, strong contour"
16. "Bird's eye view looking straight down"
17. "Worm's eye view from ground level"
18. "Character emerging from darkness/shadows"
19. "Two focal points at different depths"
20. "Compressed space, character feels close"
21. "Character framed by archway/doorway/window"
22. "Dutch angle tilted horizon for unease"

---

## QUALITY CHECK BEFORE APPROVAL

### Composition
- [ ] NOT dead-center
- [ ] Critical content in upper 2/3 of 9:16
- [ ] Lower third OK for UI

### Camera
- [ ] Shot type matches beat
- [ ] Angle supports emotion
- [ ] NOT defaulting to eye-level

### Character
- [ ] Clear line of action
- [ ] Body language matches beat
- [ ] NOT static "standing at camera"

### Sequence (if applicable)
- [ ] Different from previous image
- [ ] Variety in shot/angle/pose

---

## FORBIDDEN DEFAULTS

1. Dead-center facing camera without reason
2. Eye-level for 3+ consecutive images
3. Repeated shot type consecutively
4. Neutral symmetric "standing" pose for emotional beats
5. Critical content in lower third
6. Dutch angle without justification
7. Face lost in shadow during emotional peaks
8. ECU for mundane moments
9. Flat depth (no foreground/background)
10. Portrait instead of story beat

---

*Use this reference for every image generation prompt to ensure visual storytelling excellence.*