import { describe, it, expect } from 'vitest';
import { createJobStore } from './createJobStore';

interface TestJob {
  id: string;
  status: 'pending' | 'done';
  label: string;
}

function makeStore() {
  return createJobStore<TestJob, { id: string; label: string }>({
    buildJob: (input) => ({
      id: input.id,
      label: input.label,
      status: 'pending',
    }),
    isCompleted: (j) => j.status === 'done',
  });
}

describe('createJobStore', () => {
  it('adds a job and stores it under its id', () => {
    const useStore = makeStore();
    useStore.getState().addJob({ id: 'a', label: 'Alpha' });
    const { jobs } = useStore.getState();
    expect(jobs.a.label).toBe('Alpha');
    expect(jobs.a.status).toBe('pending');
  });

  it('updateJob merges partial changes', () => {
    const useStore = makeStore();
    useStore.getState().addJob({ id: 'a', label: 'Alpha' });
    useStore.getState().updateJob('a', { status: 'done' });
    expect(useStore.getState().jobs.a.status).toBe('done');
  });

  it('updateJob is a no-op for unknown ids', () => {
    const useStore = makeStore();
    useStore.getState().updateJob('missing', { status: 'done' });
    expect(useStore.getState().jobs).toEqual({});
  });

  it('removeJob clears the entry and active id if it matched', () => {
    const useStore = makeStore();
    useStore.getState().addJob({ id: 'a', label: 'Alpha' });
    useStore.getState().setActiveJob('a');
    useStore.getState().removeJob('a');
    expect(useStore.getState().jobs).toEqual({});
    expect(useStore.getState().activeJobId).toBeNull();
  });

  it('clearCompletedJobs retains only jobs still in progress', () => {
    const useStore = makeStore();
    useStore.getState().addJob({ id: 'a', label: 'Alpha' });
    useStore.getState().addJob({ id: 'b', label: 'Beta' });
    useStore.getState().updateJob('a', { status: 'done' });
    useStore.getState().clearCompletedJobs();
    expect(Object.keys(useStore.getState().jobs)).toEqual(['b']);
  });

  it('clearJobs resets both jobs and active id', () => {
    const useStore = makeStore();
    useStore.getState().addJob({ id: 'a', label: 'Alpha' });
    useStore.getState().setActiveJob('a');
    useStore.getState().clearJobs();
    expect(useStore.getState().jobs).toEqual({});
    expect(useStore.getState().activeJobId).toBeNull();
  });
});
