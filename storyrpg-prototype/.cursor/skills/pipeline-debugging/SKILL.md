---
name: pipeline-debugging
description: Debug StoryRPG generation pipeline failures — interpret checkpoints, diagnose worker issues, and drive error recovery. Use when investigating generation job crashes, pipeline errors, hung workers, failed LLM calls, 99-pipeline-errors.json, .worker-checkpoints.json, or any diagnostic output files.
---

# Pipeline Debugging

> **Scope:** failure-mode catalog and live debugging only. For pipeline *design* (phases, checkpoint contract, worker lifecycle, dependency graph), use the `pipeline-orchestration` skill instead.

## Diagnostic Files

Generation runs produce these files in the output directory:

| File | Contents |
|---|---|
| `09-checkpoints.json` | All checkpoint data for review/resume (`src/ai-agents/utils/pipelineOutputWriter.ts`, `writeCheckpoints`) |
| `99-pipeline-errors.json` | Episode failures with timestamps, phases, messages, stacks (`src/ai-agents/utils/pipelineOutputWriter.ts`, `writePipelineErrors`) |
| `_storyboard_diagnostics/` | Storyboard errors (sceneId, errorType, promptLength, stack) — written by `StoryboardAgent.ts:1035` |
| `prompts/${identifier}.json` | Raw LLM prompts for each image generation call (`imageGenerationService.ts:2453-2457`; also read by `qaRemediation.ts:102-103`) |
| `.worker-checkpoints.json` | Proxy-level worker checkpoint rows for resume (`proxy/workerLifecycle.js`) |

### Pipeline Telemetry

`pipelineReport` in the result includes:
- Phase durations (ms per phase)
- Provider call stats (count, success, failure per provider)
- Image coverage and cache hit rate
- Text artifact rejection count
- Retry count and failure count
- Dependency scheduler stats

## Checkpoint Interpretation

### CheckpointData Structure

```typescript
interface CheckpointData {
  phase: string;              // e.g., "World Bible", "Episode Blueprint"
  data: unknown;              // The actual output (blueprint, content, etc.)
  timestamp: Date;
  requiresApproval: boolean;
}
```

### Reading Checkpoints

Load `09-checkpoints.json` to see what the pipeline produced at each phase. Useful for:
- Identifying which phase produced bad data
- Comparing blueprint expectations vs generated content
- Finding where state diverged from intent

### Worker Checkpoint Format (`.worker-checkpoints.json`)

Real schema from `proxy/workerLifecycle.js:368-399`:

```typescript
{
  jobId: string;
  createdAt: string;            // ISO timestamp
  updatedAt: string;
  steps: Record<string, { status?: string; [k: string]: unknown }>;
  outputs: Record<string, unknown>;   // cached per-step outputs
  artifacts: Array<{                  // bounded ring buffer (WORKER_MAX_CHECKPOINT_ARTIFACTS)
    artifactKey: string;
    committedAt: string;
    [k: string]: unknown;
  }>;
  idempotencyKey?: string;
  lastEvent?: unknown;
  failureContext?: unknown;
  resumeContext?: unknown;
}
```

### Resuming from Checkpoint

Pass to worker-runner. **`steps`/`outputs` are keyed by the output artifact id (`world_bible`, `character_bible`, `episode_blueprint`, `scene_content`), NOT the phase name** — see `getResumeOutput()` at `pipeline/FullStoryPipeline.ts:1183-1188`:

```typescript
resumeCheckpoint: {
  steps: {
    world_bible: { status: 'completed' },
    character_bible: { status: 'completed' },
    // Steps after this will re-execute
  },
  outputs: {
    world_bible: { /* cached WorldBible */ },
    character_bible: { /* cached CharacterBible */ },
  }
}
```

## Common Failure Patterns

### 1. LLM Call Failures

**Symptoms**: `callLLM` throws after exhausting retries.

**Causes and fixes**:
| Error | Cause | Fix |
|---|---|---|
| 429 (rate limit) | Too many requests | Auto-retried with backoff. If persistent, reduce `maxPerProviderInFlight`. |
| 529 (overloaded) | Provider overloaded | Auto-retried. Wait and retry job. |
| 5xx (server error) | Provider outage | Auto-retried. Check provider status page. |
| Quota exhausted | API quota depleted | Not retryable. Check billing/quota. |
| Auth error | Invalid API key | Not retryable. Check `.env` keys. |
| Network failure | Connection issue | Auto-retried. Check connectivity. |

**Circuit breaker**: Trips after 5 consecutive failures across all agents. 60-second cooldown. All LLM calls fail-fast during cooldown.

### 2. JSON Parse Failures

**Symptoms**: `parseJSON` throws after repair attempts fail.

**Debugging**:
1. Check `prompts/${identifier}.json` for the raw prompt sent (image pipeline saves these; text agents write via the same logger)
2. Look at first 500 chars of raw response in error log
3. Common causes:
   - Response truncated (hit `maxTokens`) - increase `maxTokens`
   - LLM returned prose instead of JSON - strengthen prompt instructions
   - Nested quotes not escaped - `repairJSON` handles most cases

**Auto-repair handles**: trailing commas, unbalanced brackets, missing opening braces, orphan values, markdown code fences.

### 3. Insufficient Choice Points

**Symptoms**: `ChoiceDensityValidator` fails with "No choices found" or "Choice gap too large".

**Fix**: Pipeline auto-retries content generation with explicit choice density instructions. If persistent, check the `StoryArchitect` blueprint - `choicePoint` may be missing from scene blueprints.

### 4. Invalid Scene References

**Symptoms**: `StructuralValidator` reports broken `leadsTo` references or unreachable scenes.

**Fix**: `StructuralValidator.autoFix()` repairs most cases. If persistent, check `StoryArchitect` blueprint for invalid scene IDs in `leadsTo` arrays or `bottleneckScenes`.

### 5. Missing Required Fields

**Symptoms**: Agent validation throws "Missing required field: X".

**Fix**: Check normalization code in the agent. LLMs commonly return:
- Alternative key names (`sceneGraph` vs `scenes` vs `episode.scenes`)
- Single objects where arrays expected
- Undefined for optional fields that have downstream consumers

### 6. Encounter Generation Failures

**Symptoms**: `EncounterArchitect` produces too few beats or broken branching tree.

**Fix**: Pipeline retries with simplified 2-beat prompt. Check that encounter scene has `isEncounter: true` and `encounterType` set in blueprint.

## Worker Diagnostics

### Heartbeat Monitoring

Workers emit heartbeat every 60 seconds:
```typescript
{ type: 'heartbeat', rssBytes, heapUsedBytes, heapTotalBytes }
```

**Hung worker detection**: If no heartbeat for > 2 intervals (120s), worker is likely hung. Common causes:
- Infinite retry loop on permanent error (check error classification)
- Deadlock in concurrent LLM calls (check semaphore state)
- Memory exhaustion (check `heapUsedBytes` trend in heartbeats)

### Graceful Shutdown

`SIGTERM`/`SIGINT` → emit `worker_error` → clear heartbeat → exit 130.

If worker doesn't exit after SIGTERM, it's stuck in an async operation. Force kill with SIGKILL.

### Memory Issues

Watch heartbeat `rssBytes` for steady growth. Common causes:
- Large story accumulating in memory (multi-episode)
- Image data buffers not released
- Prompt cache growing unbounded

## Job Tracking Diagnostics

### Check Job Status

```typescript
GET /generation-jobs/:id/status
// Returns: { status: 'pending'|'running'|'completed'|'failed'|'cancelled' }
```

### Job State Flow

```
pending → running → completed
                  → failed (error recorded)
           ↓
         cancelled (via isJobCancelled check)
```

### Cancellation

Pipeline checks `isJobCancelled(jobId)` before each phase. If cancelled:
- Throws `JobCancelledError`
- Worker catches and exits cleanly
- Job marked as cancelled in tracker

## Error Handling Patterns

### PipelineError

```typescript
class PipelineError extends Error {
  phase: string;          // Which pipeline phase failed
  agent?: string;         // Which agent failed (if applicable)
  context?: Record<string, unknown>;  // Additional debug context
  originalError?: Error;  // Underlying error
}
```

### Error Modes

| Mode | Behavior |
|---|---|
| `strict` | Any error throws and stops pipeline |
| `advisory` | Errors recorded, pipeline continues with degraded output |

In advisory mode, failed episodes are logged to `pipeline-error-log.json` with:
- Timestamp
- Phase where failure occurred
- Error message and stack trace
- Episode/scene context

## Debugging Workflow

1. **Check job status**: `GET /generation-jobs/:id/status` - is it running, failed, or hung?
2. **Read error log**: `99-pipeline-errors.json` for the specific failure
3. **Read checkpoints**: `09-checkpoints.json` to see last successful output
4. **Check prompts**: `prompts/${identifier}.json` for what was sent to the LLM
5. **Check heartbeats**: Are they still arriving? Memory growing?
6. **Check worker checkpoint**: `.worker-checkpoints.json` — inspect `lastEvent`, `failureContext`, `resumeContext`
7. **Resume or retry**: Build a `resumeCheckpoint` keyed by output artifact id (`world_bible`, `character_bible`, `episode_blueprint`, `scene_content`) to skip completed steps
