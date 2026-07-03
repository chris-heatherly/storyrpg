# Quality Score Weights

This file is the human-tweakable QualityScore v4 weight sheet.

`storyrpg-prototype/src/ai-agents/utils/qualityScoring.ts` reads this file during Node/worker scoring and overrides matching weights by section/table label. Edit weights freely. Keep section and concept labels stable unless you also update the scorer labels/keywords.

Top-level category weights should total 100. Concept weights are normalized within each category, so they may be treated as relative weights. The Story Circle concept values below intentionally preserve the approved 110-point relative spread.

v4 maps the four product pillars: **well told** = Story Circle spine + Dramatic
structure (30); **well written** = Prose craft + Scene coherence (25);
**agency** = Choice agency + Mechanics + Encounters (25); **responsive world**
= Branching/consequence + Character/NPC (20). Prose craft is judge-fed
(ProseCraftJudge) and drops out of the average on runs where the judge never
ran; the same holds for the judge-only responsiveness concepts.

## Category Weights

| Category | Weight |
|---|---:|
| Story Circle spine | 15% |
| Dramatic structure / season story architecture | 15% |
| Prose craft | 15% |
| Scene coherence / prose continuity | 10% |
| Choice agency | 18% |
| Branching / consequence memory | 12% |
| Character / NPC / relationship quality | 8% |
| Gameplay mechanics as fiction | 5% |
| Encounters | 2% |

## Prose craft

| Concept | Weight |
|---|---:|
| Sentence craft | 20% |
| Specificity / show-don't-tell | 20% |
| Filler density | 18% |
| Rhythm and pacing | 14% |
| Dialogue naturalness | 14% |
| Narrative voice / style consistency | 14% |

## Story Circle spine

| Concept | Weight |
|---|---:|
| Complete you -> need -> go -> search -> find -> take -> return -> change loop | 16% |
| Beat order and causal progression | 14% |
| you: known-world pressure | 9% |
| need: active want/lack | 10% |
| go: threshold crossing | 10% |
| search: adaptation under pressure | 11% |
| find: wanted thing / answer / apparent victory | 10% |
| take: real price / loss / sacrifice | 12% |
| return: prize and wound carried back | 8% |
| change: transformation / new equilibrium | 10% |

## Dramatic structure / season story architecture

| Concept | Weight |
|---|---:|
| Season dramatic question / central promise | 18% |
| Stakes escalation | 16% |
| Scene-to-scene causal progression | 15% |
| Setup/payoff architecture | 14% |
| Arc pressure / reversals / turns | 12% |
| Climax and resolution payoff | 12% |
| Information/reveal control | 6% |
| Cold opens and cliffhangers | 5% |
| Theme pressure | 2% |

## Scene coherence / prose continuity

| Concept | Weight |
|---|---:|
| Scene has a clear dramatic turn | 20% |
| Scene reads naturally and coherently | 18% |
| No out-of-place story concepts | 14% |
| Clean transitions and continuity | 12% |
| POV clarity | 10% |
| Concrete on-page realization | 10% |
| Tone/voice consistency | 8% |
| No planning-register or mechanics leakage | 8% |

## Choice agency

| Concept | Weight |
|---|---:|
| Meaningful agency | 22% |
| Want / cost / identity | 18% |
| Choice affects outcome, process, information, relationship, or identity | 16% |
| Choice arises naturally from scene pressure | 14% |
| Dilemmas | 10% |
| Strategic choices | 7% |
| Relationship choices | 7% |
| Expression choices | 4% |
| Distribution percentages | 2% |

## Branching / consequence memory

| Concept | Weight |
|---|---:|
| Branch residue survives reconvergence | 20% |
| Choice consequences visible in downstream prose | 15% |
| Consequences are specific and remembered | 17% |
| Cross-episode payoffs | 15% |
| Branches create meaningfully different experiences | 14% |
| Convergent spine stays intact | 10% |
| Ending eligibility / route effects | 8% |
| Failure recovery | 6% |
| Branch graph correctness | 6% |
| Branch cap telemetry | 4% |

## Character / NPC / relationship quality

| Concept | Weight |
|---|---:|
| Protagonist want / need / lie / truth | 20% |
| NPCs react to player choices | 15% |
| Character change under pressure | 18% |
| NPCs have clear desire, pressure, and function | 14% |
| Relationship pacing is earned | 12% |
| Relationship payoffs are visible | 10% |
| Supporting characters create choice pressure | 9% |
| Antagonist/opposition pressure | 7% |
| Character introductions | 5% |
| Visual identity / flavor | 5% |

## Gameplay mechanics as fiction

| Concept | Weight |
|---|---:|
| Fiction-first presentation | 22% |
| Mechanics create story pressure | 18% |
| Hidden state produces visible residue | 16% |
| Skill/stat surfaces feel diegetic | 12% |
| Identity state matters | 10% |
| Relationship state matters | 10% |
| Flags/scores/tags are reliable | 7% |
| Inventory/items | 3% |
| Numeric balance | 2% |

## Encounters

| Concept | Weight |
|---|---:|
| Encounter as story pressure, not filler | 17% |
| Meaningful success / complicated / failure outcomes | 15% |
| Encounter Story Circle target | 12% |
| Cost and aftermath consequence | 11% |
| Branching outcome quality | 10% |
| Setup context from prior scenes | 9% |
| Skill/approach variety | 8% |
| Clocks/tactical structure | 6% |
| Environmental elements | 5% |
| NPC dispositions/tells | 4% |
| Visual encounter staging | 3% |
