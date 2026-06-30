/**
 * `createJobStore<TJob>` — shared Zustand factory for in-memory job tracking.
 *
 * Both `imageJobStore` and `videoJobStore` had nearly-identical implementations
 * (add / update / remove / clear / setActive) with only the job shape and
 * initial-fields differing. This factory consolidates the CRUD surface so
 * bug fixes land once.
 *
 * Intentionally keeps persistence & server sync out of scope — those are
 * specific to `generationJobStore` and would dilute the abstraction here.
 */
import { create, type StoreApi, type UseBoundStore } from 'zustand';

export interface JobLike {
  id: string;
}

export interface JobStoreState<TJob extends JobLike, TAddInput> {
  jobs: Record<string, TJob>;
  activeJobId: string | null;

  addJob: (input: TAddInput) => void;
  updateJob: (id: string, updates: Partial<TJob>) => void;
  removeJob: (id: string) => void;
  clearJobs: () => void;
  clearCompletedJobs: () => void;
  setActiveJob: (id: string | null) => void;
}

export interface CreateJobStoreOptions<TJob extends JobLike, TAddInput> {
  /**
   * Build a full job record from the caller's add input. Typically stamps
   * `status`, `progress`, `startTime`, etc.
   */
  buildJob: (input: TAddInput) => TJob;
  /**
   * Predicate that identifies a "completed" job for `clearCompletedJobs`.
   * Defaults to matching `status === 'completed'`.
   */
  isCompleted?: (job: TJob) => boolean;
}

const defaultIsCompleted = (job: JobLike): boolean =>
  (job as JobLike & { status?: string }).status === 'completed';

export function createJobStore<TJob extends JobLike, TAddInput>(
  options: CreateJobStoreOptions<TJob, TAddInput>,
): UseBoundStore<StoreApi<JobStoreState<TJob, TAddInput>>> {
  const isCompleted = options.isCompleted ?? (defaultIsCompleted as (job: TJob) => boolean);

  return create<JobStoreState<TJob, TAddInput>>((set) => ({
    jobs: {},
    activeJobId: null,

    addJob: (input) =>
      set((state) => {
        const job = options.buildJob(input);
        return {
          jobs: {
            ...state.jobs,
            [job.id]: job,
          },
        };
      }),

    updateJob: (id, updates) =>
      set((state) => {
        const existing = state.jobs[id];
        if (!existing) return state;
        return {
          jobs: {
            ...state.jobs,
            [id]: { ...existing, ...updates },
          },
        };
      }),

    removeJob: (id) =>
      set((state) => {
        if (!state.jobs[id]) return state;
        const next = { ...state.jobs };
        delete next[id];
        const nextActive = state.activeJobId === id ? null : state.activeJobId;
        return { jobs: next, activeJobId: nextActive };
      }),

    clearJobs: () => set({ jobs: {}, activeJobId: null }),

    clearCompletedJobs: () =>
      set((state) => {
        const next: Record<string, TJob> = {};
        for (const [id, job] of Object.entries(state.jobs)) {
          if (!isCompleted(job)) next[id] = job;
        }
        return { jobs: next };
      }),

    setActiveJob: (id) => set({ activeJobId: id }),
  }));
}
