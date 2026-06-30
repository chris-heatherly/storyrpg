# Scope: streaming + more-digestible LLM calls

_Drafted 2026-06-01. Scoping only — not yet implemented._

## Why

We've been bumping timeouts to stop heavy generations dying ("timed out after
600s"): SourceMaterialAnalyzer → 25 min, StoryArchitect → 20 min, the shared
`llmAgent` → 15 min, undici transport → 22 min. That keeps unblocking the next
domino inward but never removes the failure *class*. Two complementary levers do:

- **Lever A — Streaming.** Stop reading provider responses as one buffered
  `response.text()`; consume `response.body` as it arrives. Eliminates the
  time-to-first-byte cliff AND, more importantly, lets us detect a **stalled**
  stream in ~60s and retry fast instead of waiting out a 15–20 min budget.
- **Lever B — Digestible calls.** Decompose the few monolithic single-call
  generations into smaller, bounded, parallel calls so no single call is ever
  big enough to be a timeout risk in the first place.

### Important framing (measured)

The heavy agents run at **`maxTokens: 4096`** (`config.ts:907`; StoryArchitect /
SceneWriter / SourceMaterialAnalyzer all inherit it) and emit ~2.5–3.5k tokens.
At the ~43 tok/s we measured from the container, a full 4096-token generation is
**~95s**, not 600s. So a call dying at the 600s budget was almost certainly
**stalled/hung**, not generating slowly. That's the key insight: the dominant
failure is an *intermittent stall on a long-lived request*, and the highest-value
fix is **fast stall detection** (Lever A's idle timeout) + **smaller blast radius**
(Lever B), not simply "allow more time."

> Action item before building either: add per-call instrumentation
> (start→first-byte→complete timestamps + output token count) so we can confirm
> stall-vs-slow empirically. Cheap; informs how aggressive the idle timeout should be.

---

## Does this regress quality? (read this first)

The two levers differ fundamentally on quality risk:

- **Lever A (streaming) — NO regression.** Same prompt/model/maxTokens/temperature
  → byte-identical response; same `parseJSON`; same retry/cache/usage. It only
  changes how bytes are read off the socket + adds a fast stall-abort. This is
  genuinely "same quality and information, just read differently." Nothing in the
  generation-quality work is touched.

- **Lever B (chunking) — NOT automatically free.** Splitting the architect's
  single whole-episode call into per-scene detail calls means each call no longer
  sees its sibling scenes' prose — only the skeleton + its own scene. That can
  regress cross-scene craft (callbacks, escalation pacing, thematic through-line,
  voice consistency) — exactly the work we invested in. It's containable (carry
  all cross-cutting decisions in the skeleton; keep validators on the merged
  result), but it is a real risk, not a free refactor.

**And likely unnecessary:** at `maxTokens: 4096` / ~43 tok/s, a full architect
generation is ~95s — the 600s death was a STALL, which Lever A fixes directly
with zero quality risk. So the architect split (B1) would take on
cross-scene-coherence risk to solve a problem streaming already solves. **Do B1
only if instrumentation shows the architect is generation-bound, not
stall-bound.** B2 (per-episode analysis) preserves — likely improves — info
(less truncation near the ceiling); B3 (beat cap) only trims pathologically long
scenes.

## Lever A — Streaming the worker's LLM calls

### What changes (worker / `node` runtime only)

All three providers are plain `fetch` + `await response.text()` in
`src/ai-agents/agents/BaseAgent.ts`:
- `callAnthropic` (~395–509), `callOpenAI` (~663–771), `callGemini` (~773–887).

For each, the change is: send the provider's streaming variant and **accumulate
the streamed deltas into the same final string** we already pass to `parseJSON`:
- **Anthropic:** `body.stream = true` → SSE; concat `content_block_delta.text`;
  read `message_delta.usage` / `message_start` for tokens + cache metrics.
- **OpenAI:** `body.stream = true` (+ `stream_options.include_usage`) → SSE;
  concat `choices[].delta.content`.
- **Gemini:** `:streamGenerateContent?alt=sse` → SSE; concat `candidates[].content.parts[].text`;
  `usageMetadata` on the final chunk.

Consume via `response.body` (undici ReadableStream, already available — we pin
`undici@6.21`) with a tiny SSE line reader (~30 lines, shared across providers).

### What stays the same (de-risks it)

- **`parseJSON` is unchanged.** It needs the complete text (markdown strip,
  bracket repair, truncation recovery), so we accumulate fully, then call it
  exactly as today. `callLLM` still returns a `string`. **Callers don't change.**
- **Retry/circuit-breaker (`callLLM`), usage observer, prompt cache
  (`cache_control` on the system field) all stay** — usage + cache_read/创建
  tokens still arrive in the stream's final event; we capture them there.

### The real win: an idle (inter-chunk) timeout

Wrap the stream read so that if **no bytes arrive for `STREAM_IDLE_MS` (~60s)**
we abort and let `callLLM` retry — instead of waiting the 15–20 min overall
budget on a hung socket. This converts a "stall = multi-minute dead wait" into
"stall = ~60s then a fresh attempt," which is the actual reliability gain. The
existing per-call `AbortController`/`withTimeoutAbort` overall budget stays as
the backstop; the idle timer is the fast path. (Bonus: emit a lightweight
progress/heartbeat per chunk so the worker's liveness is obvious mid-call.)

### Risks / caveats

- **`callAnthropicWithMemory` (tool loop, ~511–661): skip streaming.** Multi-turn
  tool_use needs the complete response each round; streaming adds complexity for
  little gain. Leave it buffered.
- **Web/proxy path stays buffered.** `proxy/anthropicProxyRoutes.js` buffers +
  re-serializes; the generator UI uses it, but the **worker (generation) path is
  direct**, so streaming the worker needs **no proxy change**. (A future
  nicety: stream the proxy too for live UI token display — separate, optional.)
- **Abort mid-stream** must discard the partial accumulator (don't parse a
  half-response); treat as a normal retryable failure. Usage/cache metrics on an
  aborted stream are simply not recorded.
- **Truncation detection** already exists in `parseJSON` (max_tokens recovery);
  streaming doesn't change it since we parse the full accumulated text.

### Effort

~1–1.5 days. New shared `streamLLM` SSE reader + idle-timeout helper; refactor
the three `call*` methods to use it behind a `config.stream !== false` flag (so
we can A/B and fall back to buffered instantly). Unit-test the SSE reader
(chunk reassembly, idle-abort, usage extraction) with mocked `response.body`.
No caller changes, no proxy changes, no parseJSON changes.

---

## Lever B — Make the heavy calls digestible (decomposition)

Risk-ranked from the audit:

### B1. StoryArchitect — the one true monolith (HIGH, do first)
One call builds the entire episode scene-graph (`StoryArchitect.ts:1793`;
EpisodeBlueprint shape ~431–492: scenes + per-scene choicePoint/encounter/audit +
arc + dramaticAudit). Decompose along the natural scene boundary:
- **Pass A — skeleton (1 call):** scene IDs, names, purposes (bottleneck/branch/
  transition), `leadsTo`, `startingSceneId`, bottleneck list, arc, and the
  **full choicePoint contract per scene** (type, `branches`, stakes) — small,
  fast, and the thing that must stay globally consistent.
- **Pass B — per-scene detail (parallel, `mapWithConcurrency` limit 2–4):** flesh
  each scene (location, mood, dramaticQuestion, npcsPresent, keyBeats, encounter
  setup, residue) constrained by the skeleton's choicePoint.
- **Consistency guard:** branching/leadsTo + choice taxonomy are fixed in Pass A,
  so detail passes can't invent incompatible branches; the existing
  `validateBlueprint` + StructuralValidator still run on the merged result.
- **Reuse:** `mapWithConcurrency` + `runPhaseWithRetry` already exist in
  EncounterArchitect — this is literally the EncounterArchitect phased pattern
  applied to the architect. Wall-clock ~330s worst vs the current single-call
  stall risk; +~4–5 calls; minor input-context duplication.
- **Effort:** ~2–3 days (prompt split + merge + tests). Biggest behavior change;
  do behind a config flag and diff blueprints against the monolith on the corpus
  before defaulting on.

### B2. SourceMaterialAnalyzer episode breakdown — per-episode (MEDIUM)
`createEpisodeBreakdown` (~795) asks for **all N episodes in one call**; for a
10-episode treatment that's near the 4096 ceiling (truncation risk + one slow
call). Split to per-episode via `mapWithConcurrency` (limit 2–3), passing the
structure summary once + per-episode context. Smaller calls, parallel, and one
episode stalling no longer kills the whole breakdown. ~0.5–1 day; +~7 calls for a
10-ep treatment (acceptable, analysis is one-time per story).

### B3. SceneWriter beat cap (LOW, easy win)
Already per-scene (`SceneWriter.ts:675`), but a 12+-beat scene is a large single
call. Enforce `targetBeatCount ≤ 8–10` at the blueprint/`getTargetBeatCountForScene`
level (no architectural change, no extra calls). Already has a JSON-repair re-call
for truncation. ~2 hours.

### B4. EncounterArchitect — already done
Phased (1→2/3/4), Phase 2 parallel at bounded concurrency, per-phase timeout +
retry. This is the **template** B1/B2 should follow; no change needed.

### Cross-cutting: cap maxTokens deliberately
Most heavy agents inherit 4096 with no per-agent reasoning. After decomposition,
each call's output is smaller — set per-agent `maxTokens` to a tight,
appropriate value so a runaway generation can't silently balloon. Quick config
pass once B1/B2 land.

---

## Recommended sequencing

1. **Instrument** per-call first-byte/complete timing + token counts (½ day) →
   confirm stall-vs-slow, set the idle-timeout threshold from data.
2. **Lever A streaming + idle timeout** (~1–1.5 days) — broad, **zero quality
   regression**, no caller/parse/proxy changes, behind a flag. Biggest
   reliability win for the actual failure mode (stalls); benefits every agent.
3. **B3 beat cap** (~2h) + **B2 per-episode breakdown** (~1 day) — easy,
   contained, no/positive quality impact.
4. **B1 architect skeleton+detail** — **gated on evidence, not default.** Only
   pursue if step-1 instrumentation shows the architect is genuinely
   generation-bound (not stall-bound). It carries real cross-scene-coherence
   risk, so if we do it: flag-gated, validators on the merged result, and a
   blueprint diff against the monolith on the corpus before default-on. If
   stalls are the whole story, **skip B1** — streaming already covers it.

Streaming (A) and chunking (B) compose: smaller calls that also stream and
self-abort on stall make the "heavy generation timed out" class essentially
disappear, and let us pull the inflated 15–25 min budgets back down to sane
values once stalls are caught in ~60s.

## Open questions for the user

- Default streaming **on** once stable, or keep it flag-gated per provider?
- Acceptable to **increase total LLM call count** (B1 +~5/episode, B2 +~7/analysis)
  for reliability + parallbrush latency? (More calls = more requests, similar
  total tokens, modest cost increase.)
- Do we also want **streaming on the proxy/web path** for a live token display in
  the generator UI, or is the worker-only scope enough for now?
