/**
 * WorkerEventSchema — Zod shape for SSE/polling frames the worker
 * emits and the client consumes. Validating incoming frames means a
 * malformed JSON or unknown-type line surfaces loudly instead of
 * being dropped silently.
 */

import { z } from 'zod';

export const WorkerStatusSchema = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

export const WorkerTimelineEventSchema = z.object({
  type: z.string().min(1),
  timestamp: z.string().optional(),
  step: z.string().optional(),
  message: z.string().optional(),
  data: z.unknown().optional(),
  output: z.unknown().optional(),
  success: z.boolean().optional(),
}).passthrough();

export const WorkerJobSnapshotSchema = z.object({
  id: z.string(),
  status: WorkerStatusSchema,
  progress: z.number().optional(),
  timeline: z.array(z.unknown()).optional(),
  error: z.string().optional(),
  result: z.unknown().optional(),
  storyId: z.string().optional(),
  outputDir: z.string().optional(),
}).passthrough();

export type WorkerStatus = z.infer<typeof WorkerStatusSchema>;
export type WorkerTimelineEvent = z.infer<typeof WorkerTimelineEventSchema>;
export type WorkerJobSnapshot = z.infer<typeof WorkerJobSnapshotSchema>;

export function parseWorkerFrame(raw: string, kind: 'status' | 'timeline' | 'snapshot') {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `WorkerEventSchema: invalid JSON on "${kind}" frame: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (kind === 'timeline') {
    return WorkerTimelineEventSchema.parse(parsed);
  }
  return WorkerJobSnapshotSchema.parse(parsed);
}

export function safeParseWorkerFrame(raw: string, kind: 'status' | 'timeline' | 'snapshot') {
  try {
    return { ok: true as const, value: parseWorkerFrame(raw, kind) };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err : new Error(String(err)) };
  }
}
