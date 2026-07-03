/**
 * The house prose register — the craft rules every reader-facing prose author
 * follows. ONE source (encounter unification W3, 2026-07-03): SceneWriter has
 * always carried these; EncounterArchitect now consumes the same block so
 * encounter prose (setupText / narrativeText / escalationText) is authored to
 * the same craft bar instead of relying on downstream validators to catch a
 * lower register. The POV rules stay agent-specific (the encounter prompt has
 * its own ABSOLUTE pronoun block).
 */
export const PROSE_AND_DIALOGUE_CRAFT = `## Prose And Dialogue Craft
- Use sensory detail selectively and purposefully. Sensory description should establish place, mood, danger, intimacy, texture, or consequence. Do not force all five senses into every beat.
- Respect the active source style, genre, tone, user instructions, and style guide. Keep prose voice, dialogue rhythm, descriptive focus, and tonal register consistent across the scene.
- Use precise, concrete, genre-appropriate language. "Vivid" means specific story intent, sensory clarity, emotional legibility, and image-safe detail, not ornate prose or conflicting art direction.
- Make description dynamic. Descriptive details should carry pressure, mood, threat, desire, consequence, movement, or contrast.
- Keep dialogue spare, natural, character-specific, pressure-aware, and subtextual. Dialogue should reveal character, sharpen pressure, change leverage, or expose relationship dynamics.
- Vary sentence rhythm with scene pressure. Use shorter, sharper lines under danger, urgency, fear, or conflict. Use slightly longer rhythm for atmosphere, aftermath, tenderness, or dread while respecting mobile beat caps.
- Vary sentence OPENERS. The reader is "you", so second person is correct — but do not stack subject-first "You …"/"Your …" declaratives. Never let two consecutive sentences begin with "You". Open instead with the object, a dependent clause, a sensory detail, an NPC's name or action, dialogue, or the environment as subject; let "you" fall mid-sentence. Avoid the flat "You X. You Y. You Z." cadence.
- Avoid repeated ritual choreography. If a toast, glass-click, door-crossing, stare, hand touch, or reveal beat has already happened, do not restage it with the same line or action unless the repetition is an intentional callback with a new meaning.
- Open every beat inside the moment, not on its packaging. Cut throat-clearing setup ("The adrenaline hasn't faded yet. You sit down and…") and start with the core action, sensation, or pressure already in motion; establishing context earns its place only when it IS the pressure.
- Replace label-adjectives with the evidence for them. "Rougher, dressed for the mountains" tells; the scuffed boot heel, the rope-burned knuckles, the coat that has slept outdoors shows. When a description leans on a category word (elegant, dangerous, expensive, rough), swap in the one concrete detail that proves it.
- Reveal motivation, fear, desire, attraction, guilt, suspicion, and grief through action, choice, speech, silence, bodily response, facial expression, object handling, avoidance, proximity, risk, and what the character does next.
- Show emotion through physical response and facial expression rather than direct explanation.
- Use environmental elements to enhance mood. The setting should pressure, contrast, reveal, or complicate the scene.
- Build every scene toward its keyMoment using sceneTakeaways, moodProgression, intensityTier, and final beat pressure.
- End with resolution plus forward pressure: consequence, emotional shift, reveal, choice, handoff, danger, changed relationship, or unresolved cost. Use true cliffhangers only when appropriate.
- Avoid repetition. Do not repeat plot events, dialogue, scene shapes, descriptive phrasing, character phrasing, location phrasing, or action language unless the repetition is an intentional callback, refrain, contrast, or payoff.
- Maintain consistent tone across the scene while allowing intentional tonal turns caused by story events.
`;
