/**
 * Compact few-shot examples for StoryRPG-native prompt contracts.
 *
 * These examples teach shape and taste. They deliberately use original,
 * non-IP-specific material and the existing TypeScript contracts rather than
 * importing an external schema_chapters format.
 */

export const SOURCE_ANALYSIS_ABSTRACTION_EXAMPLE = `
## Example: StoryRPG Source Abstraction
Use this scale and shape when inferring reusable structure:

"schemaAbstraction": {
  "archetype": "Temptation and Moral Cost",
  "adaptationMode": "inspired_by",
  "schemaVariables": [
    {"name": "ProtagonistRole", "description": "The everyday identity the protagonist starts from."},
    {"name": "Stakes", "description": "The person, place, community, or value the protagonist most wants to protect."},
    {"name": "Goal", "description": "The concrete outcome the protagonist pursues because the Stakes are threatened."},
    {"name": "IncitingIncident", "description": "The disruption that endangers the Stakes and makes inaction impossible."},
    {"name": "AntagonizingForce", "description": "A stronger pressure system with clear motives."},
    {"name": "CoreValue", "description": "The belief the protagonist must test under pressure."},
    {"name": "Temptation", "description": "The easier path that promises the Goal while corroding the CoreValue."},
    {"name": "FalseVictory", "description": "A win that appears to solve the problem while deepening the cost."},
    {"name": "Climax", "description": "The decisive confrontation where the protagonist faces the greatest threat to the Stakes."},
    {"name": "Legacy", "description": "What remains changed after the climax."}
  ],
  "generalizationGuidance": [
    "Preserve the moral pressure pattern, not the original time or place.",
    "Translate combat into genre-appropriate pressure when needed.",
    "Do not emit placeholder variables in player-facing prose."
  ],
  "reusablePatternSummary": "A vulnerable protagonist pursues a saving goal, accepts a tempting shortcut, wins ground at moral cost, then must choose what kind of person survives the victory."
}
`;

export const SEASON_PLANNER_CRAFT_EXAMPLE = `
## Example: StoryRPG Season Planning Craft
- Hook episode: establish ordinary world, core value, and what the protagonist cannot bear to lose.
- Plot Turn 1 episode: make the Goal unavoidable; the AntagonizingForce should be stronger and motivated.
- Pinch episodes: pressure the Stakes directly. Pressure may be social, romantic, investigative, environmental, moral, or physical.
- Midpoint episode: reveal a path to victory that changes the protagonist from reactive to proactive.
- Pinch 2 episode: make the old strategy fail; transformation must become necessary, not decorative.
- Climax episode: land the same event promised by the Climax anchor.
- Resolution episode: first show what was saved or changed, then show future cost, legacy, or identity change.
`;

export const STORY_ARCHITECT_BLUEPRINT_EXAMPLE = `
## Example: StoryRPG Scene Blueprint Craft
Good keyBeats are decisive, consequential, and playable:
[
  "REST: Mara repairs the cracked signal lantern while Vale refuses to admit the pass is closing.",
  "A messenger arrives with proof that the safe route was sold to the enemy.",
  "PEAK: Mara chooses whether to expose Vale publicly or keep his secret for leverage.",
  "The chosen pressure leaves visible residue: trust, danger, or information changes before the next scene."
]
Use genre-appropriate pressure instead of defaulting to combat: social cost, lost evidence, romantic vulnerability, environmental danger, resource loss, moral compromise, or identity pressure.
Plans should often go partly wrong, forcing improvisation. Do not require every conversation to become an argument.
`;

export const SCENE_WRITER_BEAT_EXAMPLE = `
## Example: StoryRPG SceneWriter Beat Scale
Good beats are short, concrete, visual, and playable:
{
  "id": "beat-2",
  "text": "Mara tightens the wire around the cracked lantern. The light steadies, but the smoke turns blue.",
  "speaker": "Mara",
  "speakerMood": "controlled",
  "visualMoment": "Mara crouches over the repaired signal lantern as blue smoke leaks through her fingers.",
  "primaryAction": "Mara tightens the lantern wire",
  "emotionalRead": "Mara keeps her face still while Vale notices the smoke and stiffens.",
  "relationshipDynamic": "Mara works low to the ground while Vale stands over her, suspicious and dependent.",
  "mustShowDetail": "blue smoke leaking from the cracked lantern",
  "intensityTier": "supporting"
}
Scene-level craft: name the scene takeaway, build toward one key moment, use concise dialogue, and end with forward pressure.
`;

export const CHOICE_AUTHOR_RESIDUE_EXAMPLE = `
## Example: StoryRPG Choice Residue
Good choices name want, cost, identity, and future residue without exposing stats:
{
  "text": "Expose Vale in front of the scouts",
  "choiceType": "dilemma",
  "consequenceDomain": "reputation",
  "reminderPlan": {
    "immediate": "Vale stops defending Mara in the same breath.",
    "shortTerm": "The scouts follow Mara's orders but watch for cruelty.",
    "later": "Vale names the betrayal during the pass encounter."
  },
  "feedbackCue": {
    "echoSummary": "You chose public truth over private loyalty.",
    "progressSummary": "The group moves, but trust thins around you.",
    "checkClass": "dramatic"
  },
  "residueHints": [
    {"kind": "relationship_behavior", "description": "Vale keeps physical distance in the next shared scene.", "targetNpcId": "vale"}
  ],
  "stakesAnnotation": {
    "want": "Move the scouts before the pass closes.",
    "cost": "Break Vale's trust in public.",
    "identity": "Truth matters more than loyalty under pressure."
  }
}
`;

