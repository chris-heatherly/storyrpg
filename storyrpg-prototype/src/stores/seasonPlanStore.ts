// @ts-nocheck — TODO(tech-debt): Phase 8 state-store consolidation will address
// SourceMaterialAnalysis type drift here.
/**
 * Season Plan Store
 *
 * Persists season plans to local storage so users can:
 * - Resume generation where they left off
 * - Select different episodes from the same source material
 * - Track progress across multiple sessions
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  SeasonPlan,
  SeasonEpisode,
  SavedSeasonPlan,
  SeasonPlanSummary,
  EpisodeStatus,
} from '../types/seasonPlan';
import { SourceMaterialAnalysis } from '../types/sourceAnalysis';

const STORAGE_KEY = 'season-plans';
const ACTIVE_PLAN_KEY = 'active-season-plan';

// ========================================
// STORE STATE
// ========================================

interface SeasonPlanStoreState {
  plans: Map<string, SavedSeasonPlan>;
  activePlanId: string | null;
  isLoaded: boolean;
}

const state: SeasonPlanStoreState = {
  plans: new Map(),
  activePlanId: null,
  isLoaded: false,
};

// Listeners for state changes
type Listener = () => void;
const listeners: Set<Listener> = new Set();

const notifyListeners = () => {
  listeners.forEach(listener => listener());
};

// ========================================
// MUTEX FOR ATOMIC OPERATIONS
// ========================================

class AsyncMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    } else {
      this.locked = false;
    }
  }

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

const storeMutex = new AsyncMutex();

// ========================================
// STORAGE OPERATIONS
// ========================================

async function loadFromStorage(): Promise<void> {
  if (state.isLoaded) return;

  try {
    const [plansJson, activePlanId] = await Promise.all([
      AsyncStorage.getItem(STORAGE_KEY),
      AsyncStorage.getItem(ACTIVE_PLAN_KEY),
    ]);

    if (plansJson) {
      const plansArray: SavedSeasonPlan[] = JSON.parse(plansJson);
      state.plans = new Map(plansArray.map(p => [p.plan.id, {
        ...p,
        plan: {
          ...p.plan,
          createdAt: new Date(p.plan.createdAt),
          updatedAt: new Date(p.plan.updatedAt),
        }
      }]));
    }

    state.activePlanId = activePlanId;
    state.isLoaded = true;
    
    console.log(`[SeasonPlanStore] Loaded ${state.plans.size} season plans`);
    
    // Proactively prune if over limit (cleans up previously accumulated bloat)
    if (state.plans.size > MAX_STORED_PLANS) {
      console.log(`[SeasonPlanStore] Pruning ${state.plans.size} plans down to ${MAX_STORED_PLANS}...`);
      await saveToStorage(); // saveToStorage handles the eviction logic
    }
  } catch (error) {
    console.error('[SeasonPlanStore] Failed to load from storage:', error);
    state.isLoaded = true;
  }
}

/** Max season plans to keep in storage. Oldest non-active plans are evicted first.
 *  Keep low to avoid filling localStorage (shared with encounter state, jobs, etc). */
const MAX_STORED_PLANS = 3;

/**
 * Prepare a plan for storage by stripping bulky fields from non-active plans.
 * The sourceAnalysis (extracted text, character analyses, etc.) is the biggest
 * payload — we only keep it for the active plan.
 */
function preparePlanForStorage(saved: SavedSeasonPlan, isActive: boolean): SavedSeasonPlan {
  if (isActive) return saved;
  // Strip sourceAnalysis from inactive plans — it can be 100s of KB
  return {
    plan: saved.plan,
    sourceAnalysis: {
      ...saved.sourceAnalysis,
      // Keep metadata but drop the heavy extracted text
      extractedText: saved.sourceAnalysis?.extractedText
        ? `[stripped — ${saved.sourceAnalysis.extractedText.length} chars]`
        : '',
    } as SourceMaterialAnalysis,
  };
}

async function saveToStorage(): Promise<void> {
  try {
    let plansArray = Array.from(state.plans.values());
    
    // Evict oldest plans if over the cap (keep active plan)
    if (plansArray.length > MAX_STORED_PLANS) {
      // Sort by updatedAt ascending (oldest first), but never evict the active plan
      plansArray.sort((a, b) => 
        new Date(a.plan.updatedAt).getTime() - new Date(b.plan.updatedAt).getTime()
      );
      const evictable = plansArray.filter(p => p.plan.id !== state.activePlanId);
      const keep = plansArray.filter(p => p.plan.id === state.activePlanId);
      const toKeep = evictable.slice(evictable.length - (MAX_STORED_PLANS - keep.length));
      plansArray = [...keep, ...toKeep];
      
      // Update in-memory state to match
      const keepIds = new Set(plansArray.map(p => p.plan.id));
      for (const id of state.plans.keys()) {
        if (!keepIds.has(id)) {
          state.plans.delete(id);
          console.log(`[SeasonPlanStore] Evicted old plan: ${id}`);
        }
      }
    }

    // Strip bulky data from non-active plans before serializing
    const storable = plansArray.map(p =>
      preparePlanForStorage(p, p.plan.id === state.activePlanId)
    );

    const json = JSON.stringify(storable);
    
    try {
      await AsyncStorage.setItem(STORAGE_KEY, json);
    } catch (quotaError: any) {
      if (isQuotaError(quotaError)) {
        console.warn(`[SeasonPlanStore] Storage quota exceeded (${json.length} chars), progressive pruning...`);
        await progressivePrune(plansArray);
      } else {
        throw quotaError;
      }
    }
    
    if (state.activePlanId) {
      await AsyncStorage.setItem(ACTIVE_PLAN_KEY, state.activePlanId);
    } else {
      await AsyncStorage.removeItem(ACTIVE_PLAN_KEY);
    }
  } catch (error) {
    console.error('[SeasonPlanStore] Failed to save to storage:', error);
  }
}

function isQuotaError(err: any): boolean {
  return err?.name === 'QuotaExceededError' || err?.message?.includes('quota') || err?.message?.includes('QuotaExceeded');
}

/**
 * Progressively prune data until it fits in storage.
 * Strategy: reduce plan count step-by-step, then strip even the active plan's source analysis.
 */
async function progressivePrune(allPlans: SavedSeasonPlan[]): Promise<void> {
  const activePlan = state.activePlanId ? state.plans.get(state.activePlanId) : undefined;
  const others = allPlans
    .filter(p => p.plan.id !== state.activePlanId)
    .sort((a, b) => new Date(b.plan.updatedAt).getTime() - new Date(a.plan.updatedAt).getTime());

  // Try progressively smaller sets: active + 2, active + 1, active only, active stripped
  const attempts = [
    () => {
      const set = activePlan ? [activePlan, ...others.slice(0, 2)] : others.slice(0, 3);
      return set.map(p => preparePlanForStorage(p, p.plan.id === state.activePlanId));
    },
    () => {
      const set = activePlan ? [activePlan, ...others.slice(0, 1)] : others.slice(0, 2);
      return set.map(p => preparePlanForStorage(p, p.plan.id === state.activePlanId));
    },
    () => {
      const set = activePlan ? [activePlan] : others.slice(0, 1);
      return set.map(p => preparePlanForStorage(p, p.plan.id === state.activePlanId));
    },
    () => {
      // Last resort: strip even the active plan's source analysis
      const set = activePlan ? [activePlan] : others.slice(0, 1);
      return set.map(p => preparePlanForStorage(p, false));
    },
  ];

  for (const attempt of attempts) {
    const minimal = attempt();
    const json = JSON.stringify(minimal);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, json);
      // Success — sync in-memory state to match what was persisted
      state.plans.clear();
      for (const p of allPlans.filter(orig => minimal.some(m => m.plan.id === orig.plan.id))) {
        state.plans.set(p.plan.id, p); // keep full in-memory, only storage is trimmed
      }
      console.log(`[SeasonPlanStore] Pruned to ${minimal.length} plans (${json.length} chars)`);
      return;
    } catch (e: any) {
      if (!isQuotaError(e)) throw e;
      // Continue to next more-aggressive attempt
    }
  }

  // All attempts failed — clear storage entirely
  console.error('[SeasonPlanStore] All pruning attempts failed, clearing season plan storage');
  await AsyncStorage.removeItem(STORAGE_KEY);
}

// ========================================
// PUBLIC API
// ========================================

export const seasonPlanStore = {
  /**
   * Initialize the store (call on app start)
   */
  async initialize(): Promise<void> {
    await loadFromStorage();
    notifyListeners();
  },

  /**
   * Subscribe to state changes
   */
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /**
   * Get all season plans as summaries
   */
  getPlanSummaries(): SeasonPlanSummary[] {
    return Array.from(state.plans.values()).map(({ plan }) => ({
      id: plan.id,
      sourceTitle: plan.sourceTitle,
      seasonTitle: plan.seasonTitle,
      totalEpisodes: plan.totalEpisodes,
      completedEpisodes: plan.progress.completedCount,
      lastUpdated: plan.updatedAt,
      status: plan.progress.completedCount === 0 
        ? 'new' 
        : plan.progress.completedCount === plan.totalEpisodes 
          ? 'completed' 
          : 'in_progress',
    }));
  },

  /**
   * Get a specific season plan
   */
  getPlan(planId: string): SavedSeasonPlan | undefined {
    return state.plans.get(planId);
  },

  /**
   * Get the currently active plan
   */
  getActivePlan(): SavedSeasonPlan | undefined {
    if (!state.activePlanId) return undefined;
    return state.plans.get(state.activePlanId);
  },

  /**
   * Save a new season plan (atomic)
   */
  async savePlan(plan: SeasonPlan, sourceAnalysis: SourceMaterialAnalysis): Promise<void> {
    await storeMutex.withLock(async () => {
      state.plans.set(plan.id, { plan, sourceAnalysis });
      state.activePlanId = plan.id;
      await saveToStorage();
      notifyListeners();
      console.log(`[SeasonPlanStore] Saved plan: ${plan.id}`);
    });
  },

  /**
   * Update an existing season plan (atomic)
   */
  async updatePlan(planId: string, updates: Partial<SeasonPlan>): Promise<void> {
    await storeMutex.withLock(async () => {
      const existing = state.plans.get(planId);
      if (!existing) {
        console.warn(`[SeasonPlanStore] Plan not found: ${planId}`);
        return;
      }

      const updatedPlan: SeasonPlan = {
        ...existing.plan,
        ...updates,
        updatedAt: new Date(),
      };

      state.plans.set(planId, { ...existing, plan: updatedPlan });
      await saveToStorage();
      notifyListeners();
    });
  },

  /**
   * Set the active plan (atomic)
   */
  async setActivePlan(planId: string | null): Promise<void> {
    await storeMutex.withLock(async () => {
      state.activePlanId = planId;
      await saveToStorage();
      notifyListeners();
    });
  },

  /**
   * Update episode status (atomic - performs read-modify-write safely)
   */
  async updateEpisodeStatus(
    planId: string,
    episodeNumber: number,
    status: EpisodeStatus,
    generatedEpisodeId?: string,
    generatedStoryId?: string
  ): Promise<void> {
    await storeMutex.withLock(async () => {
      const existing = state.plans.get(planId);
      if (!existing) return;

      const episodes = existing.plan.episodes.map(ep => {
        if (ep.episodeNumber !== episodeNumber) return ep;
        return {
          ...ep,
          status,
          generatedEpisodeId,
          generatedStoryId,
          generatedAt: status === 'completed' ? new Date() : ep.generatedAt,
        };
      });

      // Recalculate progress
      const completedCount = episodes.filter(e => e.status === 'completed').length;
      const inProgressCount = episodes.filter(e => e.status === 'in_progress').length;
      const selectedCount = episodes.filter(e => e.status === 'selected').length;
      
      // Find next recommended episode
      const nextRecommended = episodes.find(e => 
        e.status === 'planned' && 
        e.dependsOn.every(dep => 
          episodes.find(d => d.episodeNumber === dep)?.status === 'completed'
        )
      );

      const progress = {
        selectedCount,
        completedCount,
        inProgressCount,
        percentComplete: Math.round((completedCount / episodes.length) * 100),
        lastGeneratedEpisode: episodeNumber,
        nextRecommendedEpisode: nextRecommended?.episodeNumber,
      };

      // Update in place (already holding lock)
      const updatedPlan: SeasonPlan = {
        ...existing.plan,
        episodes,
        progress,
        updatedAt: new Date(),
      };
      state.plans.set(planId, { ...existing, plan: updatedPlan });
      await saveToStorage();
      notifyListeners();
    });
  },

  /**
   * Select episodes for generation (atomic)
   */
  async selectEpisodes(planId: string, episodeNumbers: number[]): Promise<void> {
    await storeMutex.withLock(async () => {
      const existing = state.plans.get(planId);
      if (!existing) return;

      const episodes = existing.plan.episodes.map(ep => ({
        ...ep,
        status: episodeNumbers.includes(ep.episodeNumber) && ep.status === 'planned'
          ? 'selected' as EpisodeStatus
          : ep.status,
        selectedAt: episodeNumbers.includes(ep.episodeNumber) ? new Date() : ep.selectedAt,
        selectedBy: episodeNumbers.includes(ep.episodeNumber) ? 'user' as const : ep.selectedBy,
      }));

      const selectedCount = episodes.filter(e => e.status === 'selected').length;
      
      // Update in place (already holding lock)
      const updatedPlan: SeasonPlan = {
        ...existing.plan,
        episodes,
        progress: { ...existing.plan.progress, selectedCount },
        updatedAt: new Date(),
      };
      state.plans.set(planId, { ...existing, plan: updatedPlan });
      await saveToStorage();
      notifyListeners();
    });
  },

  /**
   * Clear selection (reset to planned) (atomic)
   */
  async clearSelection(planId: string): Promise<void> {
    await storeMutex.withLock(async () => {
      const existing = state.plans.get(planId);
      if (!existing) return;

      const episodes = existing.plan.episodes.map(ep => ({
        ...ep,
        status: ep.status === 'selected' ? 'planned' as EpisodeStatus : ep.status,
      }));

      // Update in place (already holding lock)
      const updatedPlan: SeasonPlan = {
        ...existing.plan,
        episodes,
        progress: { ...existing.plan.progress, selectedCount: 0 },
        updatedAt: new Date(),
      };
      state.plans.set(planId, { ...existing, plan: updatedPlan });
      await saveToStorage();
      notifyListeners();
    });
  },

  /**
   * Delete a season plan (atomic)
   */
  async deletePlan(planId: string): Promise<void> {
    await storeMutex.withLock(async () => {
      state.plans.delete(planId);
      if (state.activePlanId === planId) {
        state.activePlanId = null;
      }
      await saveToStorage();
      notifyListeners();
    });
  },

  /**
   * Find existing plan for source material
   */
  findPlanBySource(sourceTitle: string): SavedSeasonPlan | undefined {
    return Array.from(state.plans.values()).find(
      ({ plan }) => plan.sourceTitle.toLowerCase() === sourceTitle.toLowerCase()
    );
  },

  /**
   * Get selected episodes for a plan
   */
  getSelectedEpisodes(planId: string): number[] {
    const plan = state.plans.get(planId)?.plan;
    if (!plan) return [];
    return plan.episodes
      .filter(e => e.status === 'selected')
      .map(e => e.episodeNumber);
  },

  /**
   * Get episodes ready for generation (selected + dependencies met)
   */
  getEpisodesReadyForGeneration(planId: string): number[] {
    const plan = state.plans.get(planId)?.plan;
    if (!plan) return [];

    const completed = new Set(
      plan.episodes.filter(e => e.status === 'completed').map(e => e.episodeNumber)
    );

    return plan.episodes
      .filter(e => e.status === 'selected')
      .filter(e => e.dependsOn.every(dep => completed.has(dep)))
      .map(e => e.episodeNumber);
  },

  /**
   * Check if store is loaded
   */
  isLoaded(): boolean {
    return state.isLoaded;
  },
};
