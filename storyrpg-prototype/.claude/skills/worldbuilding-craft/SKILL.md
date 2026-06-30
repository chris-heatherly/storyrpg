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

## What WorldBuilder produces

A single `WorldBible` JSON object (`src/ai-agents/agents/WorldBuilder.ts`):

- `worldRules` (string[]) + `taboos` (string[]) — the internal logic; what's possible and what
  isn't.
- `majorEvents` — `{ name, description, yearsAgo, impact }[]`; history that shaped the present.
- `locations` — `LocationDetails[]` (see below).
- `factions` — `FactionDetails[]`: `goals`, `methods`, `values`, leader/member/hierarchy,
  `allies`/`enemies`/`neutralRelations`, `territories`, `symbols`, `recognition`.
- `customs`, `beliefs`, `tensions` (string[]) — culture and ongoing conflict.
- `doNotForget` (string[]) — critical facts later content must not contradict.

Each `LocationDetails`: `id`, `name`, `type`, `overview` (1 sentence), `fullDescription`
(2-3 sentences), `sensoryDetails` (`sights`/`sounds`/`smells`/`textures`/`atmosphere`),
`secrets`/`dangers`/`opportunities`, `connectedLocations`, optional `dominantFaction`,
`timeOfDayVariations`, `weatherVariations`.

## The four worldbuilding principles

- **Emergent worldbuilding.** History is revealed through play, not exposition dumps. Show
  culture through concrete details — what people eat, how they greet, what they fear (this is
  what `customs`/`beliefs`/`tensions` are for). Let players discover the world; don't tell them
  about it.
- **Environmental storytelling.** Every location tells a story through its details — the
  scratches on the doorframe, the worn path in the carpet, the missing portrait. Imply depth
  without explaining everything (`secrets` carries the unexplained layer).
- **Consistent rule systems.** Magic, technology, and society follow internal logic; players
  should be able to predict how the world works. If something breaks the rules, that break is
  significant. Encode the logic in `worldRules`/`taboos`.
- **Sensory immersion.** Engage all five senses in every location. Sound and smell are often
  more evocative than sight — fill `sounds` and `smells`, don't lean on `sights` alone.
  Atmosphere matters more than architecture: `sensoryDetails.atmosphere` is the emotional weight
  of the space, not its floor plan.

These align with the contract's "Is the world internally consistent?" check
(`storyQualityContract.ts`) and the REST-beat guidance that environmental/atmospheric detail sets
mood between dramatic peaks (`storytellingPrinciples.ts`).

## Location design checklist

For each location, author against all five:

| Axis | Question | Where it lands |
|---|---|---|
| **History** | What happened here? What traces remain? | `fullDescription`, `secrets`, `majorEvents` |
| **Function** | What is this place FOR? Who uses it? | `overview`, `dominantFaction` |
| **Atmosphere** | What FEELING should this evoke? | `sensoryDetails.atmosphere` |
| **Secrets** | What isn't immediately obvious? | `secrets` |
| **Connections** | How does this relate to other places? | `connectedLocations` |

## Quality bars the agent enforces

Structural (`validateWorldBible` — hard fail / abort): ≥1 location, every requested location id
present, each location has a non-empty `fullDescription` ≥50 chars and a `sensoryDetails` object,
≥1 `worldRule`, ≥1 faction. Missing requested locations trigger a targeted retry before failing.

Quality (`collectQualityIssues` — triggers a revision pass, not a fail): `fullDescription` should
reach ~80+ chars; ≥2 `sights`, ≥1 `sound`, ≥1 `smell`, and an `atmosphere` per location; ≥1
`secret` per location; each faction needs `goals`, `methods`, `symbols`; aim for 5+ `worldRules`
and 2+ `doNotForget` items.

**Consistency is load-bearing.** Once a fact is established it never changes — names, dates,
relationships, and `worldRules` stay stable across all later content. The `doNotForget` list is
the handoff: put anything future scenes must remember there.

**Fiction-first still applies.** Setting prose never exposes stats, dice, or system math; sensory
and atmospheric detail carries the world. See `docs/STORY_QUALITY_CONTRACT.md`.

## See also

- `story-structure-rules` — the story-architecture contract locations and factions get woven into.
- `pipeline-agent-development` — how `BaseAgent` agents like `WorldBuilder` are wired (prompting,
  JSON parsing, validation/revision loops).
- `src/ai-agents/agents/WorldBuilder.ts` — the source of truth: the prompt principles, the
  `WorldBible`/`LocationDetails`/`FactionDetails` types, and the validate/quality passes.
- The richer Cursor twin lives at `.cursor/skills/worldbuilding-craft/`; keep the two in sync.
