# Container egress resilience — root cause & runbook

_Last updated: 2026-06-01_

## TL;DR

Most of the "PIPELINE FAILURE" incidents we chased over the last week were not
bugs in any single agent or validator. They were **the symptom of one root
cause**: the generation worker runs inside the proxy's Docker container, and
that container's network path to external APIs (Gemini, Anthropic, OpenAI,
ElevenLabs, blob/image storage) is **intermittently flaky**. A single dropped
connection mid-generation surfaced as a dozen different-looking failures because
the code around the failed call wasn't built to tolerate it.

The fix is **defense in depth at the transport layer**, applied **once,
process-wide, for every provider** — not a per-provider patch. This doc explains
the root cause in plain English, the layers of defense now in place, and how to
diagnose a recurrence.

---

## Why it kept looking like different bugs

The worker is a short-lived Node process the proxy spawns per job (see
`proxy/workerLifecycle.js` → `src/ai-agents/server/worker-runner.ts`). Over the
course of one generation it makes **hundreds** of outbound HTTPS calls. Before
this work, each call:

1. **Cold-dialed a brand-new TLS connection.** No keep-alive, so every request
   paid the full connect cost — and the connect step is exactly what fails when
   container egress hiccups. More dials = more chances to hit a bad moment.
2. **Had no connection-level retry.** A transient `ECONNRESET` / `EAI_AGAIN` /
   connect-timeout bubbled straight up as `TypeError: fetch failed`.
3. **Couldn't be cancelled.** When an overall step timeout fired, the underlying
   fetch was *abandoned*, not aborted — it kept running (and retrying) in the
   background, burning tokens and keeping the worker "busy."
4. **Ran under timeouts tuned for the happy path.** One transient retry on a
   large source blew past a 10-minute budget mid-analysis.
5. **Left stragglers alive.** The worker didn't `process.exit()` on success, so
   an un-awaited background call could keep the process from exiting, which the
   proxy then flagged as "worker stale."

Because the failure landed in whatever call happened to be in flight, it
disguised itself as: a contract failure, a treatment-fidelity false negative, a
Gemini JSON parse error, a QA fail-closed-to-zero, "needs an Anthropic key on
Gemini," "worker stale for 3 minutes," or "Analysis server unavailable … timed
out after 600s." **Same root cause, different masks.** The user's key insight
was correct: the problem is the container's egress in general, not Google
specifically — so the fix must be provider-agnostic.

---

## The biggest masquerade: undici's 300s `headersTimeout`

The single highest-impact instance of "egress flake that wasn't" was undici's
**default 300-second `headersTimeout`/`bodyTimeout`**. Our provider calls are
**non-streaming** (`fetch` then `response.text()`), so the first response byte
only arrives **after the model finishes generating the entire response**. A
heavy planning call — e.g. `SourceMaterialAnalyzer` building a 10-episode
breakdown with `max_tokens: 16384` — generates close to the full cap.

Measured from inside the container: Claude Sonnet produced 8000 tokens in
**186.7s (~43 tok/s)**, which extrapolates to **~382s for 16384 tokens** — past
the 300s default. So undici aborted the still-healthy request as
`TypeError: fetch failed` (cause `UND_ERR_HEADERS_TIMEOUT`) at ~303s, the app
retried into the same wall five times, and the whole analysis died at the outer
1500s budget. A *tiny* POST to the same endpoint returned `200` in ~1.2s, which
is exactly why this looked like an intermittent egress problem rather than a
timeout cap: small calls always passed, big generations always failed.

**Fix:** `resilientHttp.ts` now sets `headersTimeout` and `bodyTimeout` to 16
minutes — comfortably past the heaviest legitimate generation, below the outer
pipeline budgets, and provider-agnostic (lifts the cap for Anthropic, Gemini,
OpenAI at once). App-level `withTimeoutAbort`/`AbortSignal` remain the real
"give up" authority. A future improvement is to **stream** large generations
(headers arrive immediately, so `headersTimeout` never applies and we get
progress), which would make the cap irrelevant.

## The layers of defense (all now in place)

### 1. Process-wide resilient HTTP — `src/ai-agents/server/resilientHttp.ts`

A single undici global dispatcher installed at worker startup
(`installResilientHttp()` called at the top of `worker-runner.ts`). It fixes
both halves cheaply, for **every** provider at once:

- **Keep-alive** (`keepAliveTimeout: 30s`, `keepAliveMaxTimeout: 10m`): reuse a
  warm connection across the many calls in one job, so we stop paying the
  cold-dial failure tax on every request.
- **Connection-level retry** (`maxRetries: 3`, fast exponential backoff): retry
  transient **connection** errors only — `ECONNRESET`, `ECONNREFUSED`,
  `ENOTFOUND`, `ENETDOWN/UNREACH`, `EHOSTDOWN/UNREACH`, `EPIPE`, `EAI_AGAIN`
  (transient DNS), `UND_ERR_CONNECT_TIMEOUT`, `UND_ERR_SOCKET`.

**Deliberately NOT retried here:** HTTP status codes (5xx/429) and
response-timeouts. `statusCodes: []` is intentional. The app's own
`BaseAgent.callLLM` retry loop owns those, and retrying a POST the server
*already received* would risk duplicate work / duplicate charges. We only retry
when the request never completed (no response yet), where a retry is safe even
for POST.

> Node-only (uses undici). **Never import this from web/native/reader code.**

### 2. Cooperative cancellation — `withTimeoutAbort` + `BaseAgent.activeAbortSignal`

`src/ai-agents/utils/withTimeout.ts` now exports `withTimeoutAbort(fn, ms,
label)`. Unlike the older `withTimeout` (which races a promise and *abandons*
the loser), `withTimeoutAbort` creates an `AbortController`, hands its signal to
the wrapped work, and **aborts that signal when the timeout fires** — so the
in-flight fetch is cancelled and the retry loop stops, instead of running on in
the background.

`callLLM` is abort-aware: it checks `signal.aborted` before each attempt and
passes the signal to `fetch`. To avoid threading a signal through every private
method of an agent, `BaseAgent` has a protected `activeAbortSignal` field that
`callLLM` falls back to when no per-call signal is passed. An agent sets it once
at the top of `execute(input, { signal })` and clears it in a `finally`.

**Wired so far:** `SourceMaterialAnalyzer.execute` (the agent that timed out at
600s — it makes several sequential calls, so cancellation matters most there).
The call site `FullStoryPipeline` source-analysis phase uses `withTimeoutAbort`.

**Concurrency caveat:** `activeAbortSignal` is an instance field, so it is only
safe when an agent instance runs **one** `execute()` at a time. Agents invoked
concurrently on a shared instance (e.g. parallel-episode `StoryArchitect`) must
thread a per-call `signal` explicitly instead of using the field. See
"Follow-ups" below.

### 3. Worker exits cleanly on success — `worker-runner.ts`

On `worker_complete`, `main().then()` now clears the heartbeat interval, flushes
stdout, and calls `process.exit(0)`. This kills any straggler background work and
lets the proxy finalize the job promptly instead of waiting for a stale timeout.

### 4. Realistic timeout budgets — `PIPELINE_TIMEOUTS`

`sourceAnalysis` is `25m` (it runs multiple sequential LLM calls; a single
transient retry on a large source otherwise blows past the single-call
`llmAgent` 10m budget mid-analysis). The worker stays alive across these via
60s heartbeats, and per-call timeouts bound each individual call — the overall
budget is just a backstop.

### 5. Honest error classification — `GeneratorScreen.tsx`

`isProxyUnreachableError(message)` distinguishes a genuinely-unreachable
proxy/worker from an LLM call that merely timed out. A 600s analysis timeout no
longer mislabels itself as "proxy unreachable."

---

## Runbook: diagnosing a recurrence

When a generation fails with a transport-flavored error, work down this list:

1. **Read the per-run diagnostics first.**
   `generated-stories/<run>/99-pipeline-errors.json` records the failing phase
   and message. Cross-run patterns live in
   `generated-stories/quality-ledger.jsonl`.

2. **Is it a connection error or an HTTP/parse error?**
   - `TypeError: fetch failed`, `ECONNRESET`, `EAI_AGAIN`, connect-timeout →
     **transport / egress.** Continue here.
   - 4xx/5xx, JSON parse, validator/contract → likely a real code/content issue,
     not egress. Different playbook.

3. **Confirm the proxy container is healthy and not stale.**
   - `npm run proxy:health` (expects `Proxy healthy`).
   - `npm run proxy:compose:logs` — look for repeated connect failures, DNS
     errors, or the worker being killed as "stale."

4. **Restart the proxy if it's been running a long time.** The proxy is a
   long-lived Node process that does **not** hot-reload source. After editing
   proxy or worker code (or if it's wedged): `npm run proxy:compose:down &&
   npm run proxy:compose:up`. (Stale-proxy was the original red herring in this
   saga.)

5. **Check the host's actual network.** Because the root cause is the container's
   egress, verify the host can reach the provider at all (curl the provider
   health endpoint from the host). If the host network is down, no amount of
   in-app retry helps — that's an infra problem, not a code problem.

6. **If a single agent times out repeatedly**, check whether its call site uses
   `withTimeoutAbort` (cancellable) vs the older `withTimeout` (abandons). Only
   `SourceMaterialAnalyzer`'s source-analysis call is cancellable today; the
   rest fall back to abandon-on-timeout (still correct, just less tidy).

---

## Follow-ups (deliberately deferred)

Layers 1, 3, 4, 5 are global and cover the whole pipeline. Layer 2 (cooperative
cancellation) is wired for the proven offender (`SourceMaterialAnalyzer`) as the
reference pattern. Extending true cancellation to the rest is **lower urgency**
now that resilient fetch (#1) attacks the trigger directly and the worker exits
cleanly (#3). Remaining work, if/when an agent proves to need it:

- Thread `{ signal }` through the other long-running agents (`StoryArchitect`,
  `SceneWriter`, encounter/image/audio agents) and switch their pipeline call
  sites to `withTimeoutAbort`.
- For agents that run **concurrently on a shared instance** (parallel-episode
  `StoryArchitect`), thread a per-call `signal` explicitly rather than using the
  `BaseAgent.activeAbortSignal` instance field (which assumes one `execute()` at
  a time).

These are mechanical but broad; do them per-agent as evidence warrants rather
than refactoring all ~8 agents at once.
