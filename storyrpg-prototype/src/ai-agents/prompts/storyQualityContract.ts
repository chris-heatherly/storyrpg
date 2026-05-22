/**
 * Compact Story Quality Contract
 *
 * Durable rules distilled from the old pipeline. Keep these sections short:
 * callers should include only the fragments relevant to the agent's job.
 */

export const STORY_QUALITY_FICTION_FIRST = `
## Fiction-First Contract
- Rules follow fiction; player-facing prose never exposes stats, dice, percentages, thresholds, or system math.
- Mechanics may change flags, scores, relationships, routes, callbacks, and variants, but the player experiences them as story pressure.
- Growth, failure, locks, and advantage must be legible through action, dialogue, risk, leverage, or consequence.
`;

export const STORY_QUALITY_CHOICE_AGENCY = `
## Choice Agency Contract
- Every non-flavor choice must affect at least one factor: outcome, process, information, relationship, or identity.
- Meaningful choices should communicate want, cost, and identity.
- Use consequence tiers intentionally: callback and scene tint by default, branchlet for important moments, structural branch rarely.
- Flavor/expression choices may personalize voice, but must not branch or pretend to carry hidden weight.
`;

export const STORY_QUALITY_BRANCHING = `
## Branching Contract
- Branches create different experiences between bottlenecks and reconverge at planned anchors.
- No dead ends, unreachable scenes, backward self-routes, or arbitrary targets outside the parent scene's leadsTo.
- Reconvergence may merge plot position, but it must preserve residue through tone, knowledge, relationship, identity, or callbacks.
`;

export const STORY_QUALITY_CALLBACKS = `
## Callback Contract
- Important choices should echo later through conditional text, NPC recognition, altered descriptions, relationship tone, visual state, or later choice wording.
- Use callback hooks sparingly and naturally. A callback should feel remembered, not mechanically inserted.
- Prior-episode callbacks must only reference events the player could have experienced on that path.
`;

export const STORY_QUALITY_MECHANICAL_REACTIVITY = `
## Mechanical Storytelling Reactivity
- A meaningful choice should change what the world permits, what an NPC believes, how future choices read, or what failure creates.
- Prefer micro-reactivity over extra branches: callbacks, residue, scene tints, witness comments, altered prose, relationship tone, locked/unlocked options, and visual staging.
- Hidden state should surface as affordance: prior mercy, trust, items, tags, skills, promises, lies, and callback hooks should open, color, or close options.
- Failure should create playable story material: debt, suspicion, injury, lost leverage, exposure, obligation, damaged trust, or changed position.
- Use genre-specific story verbs so choices feel native to the world, not generic.
`;

export const STORY_QUALITY_PIXAR_CRAFT = `
## Pixar-Style Craft Rubric
- Give the protagonist a clear desire under escalating pressure.
- Trouble may arrive by coincidence; escape should be earned by choice, cost, preparation, or character change.
- Surprise should feel both unexpected and inevitable after setup.
- Characters need opinions, friction, and pressure that forces change.
- Payoffs should satisfy emotionally for the story's genre; not every payoff is happy, but it must feel earned.
`;

export const STORY_QUALITY_PACING = `
## Interactive Pacing Contract
- The first meaningful choice should arrive early enough for the player to feel like a co-author.
- Long prose runs need interactive turns unless they are carrying a major reveal, climax, or aftermath.
- Choice density is a cap, not a metronome: do not force fake choices where the story needs breath.
`;

export const VISUAL_QUALITY_CONTRACT = `
## Visual Quality Contract
- Storyboard sheets and panel metadata are the continuity authority.
- Previous-panel references are same-path helpers only; they never cross sibling branches and never override the storyboard sheet.
- Universal invariants: one readable story beat, named-character identity, no duplicate intended character, no accidental text/watermarks, no default first-person/disembodied POV, mobile-safe focal content.
- Style-specific judgment comes from ArtStyleProfile. Cinematic depth/contrast/asymmetry are not universal requirements.
- Provider reference packs must respect active provider capabilities and reserve space for character, style, location, and storyboard continuity anchors.
`;

export function buildStoryQualityContractSection(parts: Array<
  | 'fictionFirst'
  | 'choiceAgency'
  | 'branching'
  | 'callbacks'
  | 'mechanicalReactivity'
  | 'pixarCraft'
  | 'pacing'
  | 'visual'
>): string {
  const map = {
    fictionFirst: STORY_QUALITY_FICTION_FIRST,
    choiceAgency: STORY_QUALITY_CHOICE_AGENCY,
    branching: STORY_QUALITY_BRANCHING,
    callbacks: STORY_QUALITY_CALLBACKS,
    mechanicalReactivity: STORY_QUALITY_MECHANICAL_REACTIVITY,
    pixarCraft: STORY_QUALITY_PIXAR_CRAFT,
    pacing: STORY_QUALITY_PACING,
    visual: VISUAL_QUALITY_CONTRACT,
  };
  return parts.map((part) => map[part].trim()).join('\n\n');
}
