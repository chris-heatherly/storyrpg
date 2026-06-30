---
name: worldbuilding-craft
description: Use this skill for StoryRPG setting-and-lore craft — the rules the WorldBuilder agent authors against when it produces a WorldBible (locations, factions, world rules, lore). Reach for it when working on WorldBuilder, the LocationDetails/FactionDetails/WorldBible types, or any setting, location, sensory-detail, or environmental-storytelling content.
---

# Worldbuilding Craft

The craft contract the generation pipeline authors against. These are the rules the
`WorldBuilder` agent's prompt enforces and its `validateWorldBible` / `collectQualityIssues`
passes protect — change the rule here and the prompt move together, never one in isolation.
(This is the *what to author*; `pipeline-agent-development` is the *how to wire an agent*.)

This skill is intentionally compact — `WorldBuilder` is a single agent producing one structured
artifact, so the surface is smaller than its story-structure sibling. Kept honest, not padded.
It is still a richer superset of its `.claude` twin: it carries the exact TypeScript type blocks,
a worked `LocationDetails` example, and the precise thresholds spelled out from source.

## What WorldBuilder produces

A single `WorldBible` JSON object (`src/ai-agents/agents/WorldBuilder.ts`). The exact shape:

```typescript
interface WorldBible {
  // Core rules
  worldRules: string[];   // "Magic requires spoken words", "The dead don't stay dead", etc.
  taboos: string[];       // Things that don't exist or aren't done in this world

  // History
  majorEvents: Array<{
    name: string;
    description: string;
    yearsAgo: string;
    impact: string;
  }>;

  // Locations
  locations: LocationDetails[];

  // Factions
  factions: FactionDetails[];

  // Culture
  customs: string[];
  beliefs: string[];
  tensions: string[];     // Ongoing conflicts or controversies

  // Consistency notes
  doNotForget: string[];  // Critical details that must remain consistent
}
```

`worldRules`/`taboos` are the internal logic — what's possible and what isn't. `majorEvents` is the
history that shaped the present. `customs`/`beliefs`/`tensions` carry culture and ongoing conflict.
`doNotForget` is the handoff list: anything later content must not contradict.

### LocationDetails

```typescript
interface LocationDetails {
  id: string;
  name: string;
  type: string;

  // Descriptions at different detail levels
  overview: string;          // 1-2 sentences for quick reference
  fullDescription: string;   // 2-3 paragraphs for scene setting
  sensoryDetails: {
    sights: string[];
    sounds: string[];
    smells: string[];
    textures: string[];
    atmosphere: string;
  };

  // Narrative hooks
  secrets: string[];         // Hidden things players might discover
  dangers: string[];         // Potential threats
  opportunities: string[];   // Resources or advantages

  // Connections
  connectedLocations: string[];
  dominantFaction?: string;

  // State variations
  timeOfDayVariations?: {
    day: string;
    night: string;
    dawn?: string;
    dusk?: string;
  };
  weatherVariations?: {
    clear: string;
    rain: string;
    storm?: string;
  };
}

// Alias for backwards compatibility
type Location = LocationDetails;
```

### FactionDetails

```typescript
interface FactionDetails {
  id: string;
  name: string;
  type: string;              // 'political' | 'criminal' | 'religious' | 'commercial' | etc.

  // Core identity
  overview: string;
  goals: string[];
  methods: string[];
  values: string[];

  // Structure
  leaderDescription: string;
  memberProfile: string;
  hierarchy: string;

  // Relationships
  allies: string[];
  enemies: string[];
  neutralRelations: string[];

  // Player interaction
  howToJoin?: string;
  benefits?: string[];
  obligations?: string[];

  // Presence
  territories: string[];
  symbols: string[];
  recognition: string;       // How to identify members
}
```

## The four worldbuilding principles

These are the four headings in the agent's own prompt. The *why* matters as much as the rule —
each principle exists to keep the world discoverable and lived-in rather than catalogued at the
player.

- **Emergent worldbuilding.** History is revealed through play, not exposition dumps. Show
  culture through concrete details — what people eat, how they greet, what they fear (this is
  what `customs`/`beliefs`/`tensions` are for). *Why:* a player who is *told* the lore skims it;
  a player who *finds* it owns it. Let players discover the world; don't lecture them about it.
- **Environmental storytelling.** Every location tells a story through its details — the
  scratches on the doorframe, the worn path in the carpet, the missing portrait. Imply depth
  without explaining everything (`secrets` carries the unexplained layer). *Why:* an implied
  story the player completes is more vivid than one fully narrated, and it rewards re-reading.
- **Consistent rule systems.** Magic, technology, and society follow internal logic; players
  should be able to predict how the world works. If something breaks the rules, that break is
  *significant*, not sloppy. Encode the logic in `worldRules`/`taboos`. *Why:* predictability is
  what makes player strategy possible — and what makes a deliberate rule-break land as a shock.
- **Sensory immersion.** Engage all five senses in every location. Sound and smell are often
  more evocative than sight — fill `sounds` and `smells`, don't lean on `sights` alone.
  Atmosphere matters more than architecture: `sensoryDetails.atmosphere` is the *emotional
  weight* of the space, not its floor plan. *Why:* smell and sound bypass description and trigger
  memory directly, so they immerse faster and cheaper than another visual sentence.

These align with the contract's "Is the world internally consistent?" check
(`storytellingPrinciples.ts`, the quality-question list) and the REST-beat guidance that
environmental/atmospheric detail sets mood between dramatic peaks (`storytellingPrinciples.ts`:
"REST beats … more environmental/atmospheric, quieter tone"). Setting prose is where rest beats
breathe.

## Location design checklist

For each location, author against all five (these are the five "For Each Location, Consider"
points in the agent prompt):

| Axis | Question | Where it lands |
|---|---|---|
| **History** | What happened here? What traces remain? | `fullDescription`, `secrets`, `majorEvents` |
| **Function** | What is this place FOR? Who uses it? | `overview`, `dominantFaction` |
| **Atmosphere** | What FEELING should this evoke? | `sensoryDetails.atmosphere` |
| **Secrets** | What isn't immediately obvious? | `secrets` |
| **Connections** | How does this relate to other places? | `connectedLocations` |

The agent's sensory sub-guidance for filling `sensoryDetails`: SIGHTS = lighting, colors,
movement, notable objects; SOUNDS = background noise, silence, echoes, voices; SMELLS = pleasant,
unpleasant, distinctive, the memories they evoke; TEXTURES = what you'd feel if you touched
things; ATMOSPHERE = the emotional weight of the space.

### Worked example: a well-formed LocationDetails

Note how every axis above is filled, sound/smell/texture are not afterthoughts, `secrets` carries
the unexplained layer, and `connectedLocations` ties it into the graph:

```json
{
  "id": "drowned-chapel",
  "name": "The Drowned Chapel",
  "type": "ruin",
  "overview": "A half-submerged shrine on the tidal flats, abandoned after the levee broke.",
  "fullDescription": "The chapel sits knee-deep in brackish water that rises and falls with the tide, its pews long since floated free and wedged against the altar rail. Salt has eaten the gilt from the icons, leaving pale ghosts of saints on the warped plaster. Locals say the bell still rings on storm nights, though the tower has been empty for forty years.",
  "sensoryDetails": {
    "sights": ["greenish light filtering through silt-clouded windows", "a tide-line of dried salt crusting the walls at chest height", "a single intact icon, its eyes scratched out"],
    "sounds": ["water slapping against stone columns", "the slow drip of seepage from the vaulted ceiling", "gulls arguing on the roofless tower"],
    "smells": ["wet stone and rotting wood", "the iodine tang of the flats at low tide"],
    "textures": ["slick algae underfoot", "the cold grit of salt on every surface"],
    "atmosphere": "reverent abandonment — a holy place the sea has quietly reclaimed"
  },
  "secrets": ["A waterproofed strongbox is wedged beneath the altar, left by whoever scratched out the icon's eyes."],
  "dangers": ["rising tide can trap visitors in the nave", "rotten flooring over a flooded crypt"],
  "opportunities": ["a defensible vantage over the flats", "the strongbox, for anyone who reads the tide right"],
  "connectedLocations": ["tidal-flats", "levee-road", "fisher-village"],
  "dominantFaction": "salt-wardens",
  "timeOfDayVariations": {
    "day": "Green underwater light; the flats stink at low tide.",
    "night": "Utter dark but for phosphorescence on the water; the bell legend feels true."
  },
  "weatherVariations": {
    "clear": "The tide is readable and the flats passable.",
    "rain": "The nave floods fast; the only dry footing is the altar steps."
  }
}
```

## Quality bars the agent enforces

Two tiers, with the exact numeric thresholds from `validateWorldBible` and `collectQualityIssues`:

**Structural — `validateWorldBible` (hard fail / throws and aborts):**

- `locations` is non-empty (`length >= 1`).
- If specific locations were requested (`input.locationsToCreate`), every requested `id` is
  present — a missing one throws by name. Missing requested locations trigger a *targeted retry*
  (`executeRetryForMissingLocations`) before the run fails.
- Every location has an `id`.
- Every location's `fullDescription` is present and **>= 50 chars** (below this throws).
- Every location has a `sensoryDetails` object (presence only at this tier).
- `worldRules` is non-empty (`length >= 1`); throws at 0. Fewer than 3 logs a warning but does
  **not** fail.
- `factions` has `length >= 1`; throws otherwise.

**Quality — `collectQualityIssues` (triggers a single revision pass, never a fail):**
Issues are collected; if the revision reduces the count it is accepted, then re-validated
structurally. The checks:

- Per location: `fullDescription` **>= 80 chars** (below flags "brief"); **>= 2 `sights`**;
  **>= 1 `sound`**; **>= 1 `smell`**; a non-empty `atmosphere`; **>= 1 `secret`**.
- Per faction: at least one `goals`, one `methods`, and one `symbols` entry.
- `worldRules.length >= 5` (fewer is flagged).
- `doNotForget.length >= 2` (fewer is flagged).

So the practical authoring target above the hard floor: ~80+ char descriptions, 2+ sights and at
least one sound/smell/atmosphere/secret per location, every faction carrying goals + methods +
symbols, 5+ world rules, and 2+ doNotForget items.

**Consistency is load-bearing.** Once a fact is established it never changes — names, dates,
relationships, and `worldRules` stay stable across all later content. ("If the sun sets in the
west in Scene 1, it sets in the west forever.") The `doNotForget` list is the handoff: put
anything future scenes must remember there.

**Fiction-first still applies.** Setting prose never exposes stats, dice, or system math; sensory
and atmospheric detail carries the world. See `docs/STORY_QUALITY_CONTRACT.md`.

## See also

- `story-structure-rules` — the story-architecture contract locations and factions get woven into.
- `pipeline-agent-development` — how `BaseAgent` agents like `WorldBuilder` are wired (prompting,
  JSON parsing, validation/revision loops).
- `src/ai-agents/agents/WorldBuilder.ts` — the source of truth: the prompt principles, the
  `WorldBible`/`LocationDetails`/`FactionDetails` types, and the validate/quality passes.
- The Claude-targeted twin lives at `.claude/skills/worldbuilding-craft/`; keep the two in sync.
