/**
 * Centralized endpoint configuration
 * 
 * All URLs and service endpoints should be defined here to avoid
 * hardcoded values scattered throughout the codebase.
 */

import { isWebRuntime } from '../utils/runtimeEnv';

// ========================================
// PROXY SERVER CONFIGURATION
// ========================================

export const PROXY_CONFIG = {
  // Default proxy server settings
  DEFAULT_HOST: 'localhost',
  DEFAULT_PORT: 3001,
  
  // Get the dynamic proxy URL based on platform and environment
  getProxyUrl(): string {
    const explicitProxyUrl = process.env.EXPO_PUBLIC_PROXY_URL || process.env.PROXY_URL;
    if (explicitProxyUrl && explicitProxyUrl.trim().length > 0) {
      return explicitProxyUrl.replace(/\/+$/, '');
    }
    if (isWebRuntime() && typeof window !== 'undefined') {
      const hostname = window.location.hostname || this.DEFAULT_HOST;
      return `http://${hostname}:${this.DEFAULT_PORT}`;
    }
    return `http://${this.DEFAULT_HOST}:${this.DEFAULT_PORT}`;
  },
  
  // Specific proxy endpoints
  get writeFile() { return `${this.getProxyUrl()}/write-file`; },
  get atlasCloudApi() { return `${this.getProxyUrl()}/atlas-cloud-api`; },
  get midapi() { return `${this.getProxyUrl()}/midapi`; },
  get elevenLabs() { return `${this.getProxyUrl()}/elevenlabs`; },
  get generationJobs() { return `${this.getProxyUrl()}/generation-jobs`; },
  get workerJobs() { return `${this.getProxyUrl()}/worker-jobs`; },
  get modelsAvailable() { return `${this.getProxyUrl()}/models/available`; },
  get modelsScan() { return `${this.getProxyUrl()}/models/scan`; },
  get generatorSettings() { return `${this.getProxyUrl()}/generator-settings`; },
};

// ========================================
// EXTERNAL API CONFIGURATION
// ========================================

export const EXTERNAL_APIS = {
  // Gemini API
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    getGenerateUrl(model: string, apiKey: string): string {
      return `${this.baseUrl}/models/${model}:generateContent?key=${apiKey}`;
    },
  },
  
  // ElevenLabs API (via proxy)
  elevenLabs: {
    get tts() { return `${PROXY_CONFIG.elevenLabs}/tts`; },
    get voices() { return `${PROXY_CONFIG.elevenLabs}/voices`; },
    get batchGenerate() { return `${PROXY_CONFIG.elevenLabs}/batch-generate`; },
  },
  
  // Atlas Cloud API (via proxy)
  atlasCloud: {
    get generateImage() { return `${PROXY_CONFIG.atlasCloudApi}/generateImage`; },
    prediction(id: string) { return `${PROXY_CONFIG.atlasCloudApi}/prediction/${id}`; },
  },
  
  // Midjourney via MidAPI (via proxy)
  midjourney: {
    get generate() { return `${PROXY_CONFIG.midapi}/api/v1/mj/generate`; },
    getRecordInfo(taskId: string) { return `${PROXY_CONFIG.midapi}/api/v1/mj/record-info?taskId=${encodeURIComponent(taskId)}`; },
  },
};

// ========================================
// TIMING / RATE LIMITING DEFAULTS
// ========================================

export const TIMING_DEFAULTS = {
  // Rate limiting
  minRequestIntervalMs: 3000, // 3 seconds between requests
  rateLimitDelayMs: 5000,     // Base delay on rate limit hit
  
  // Retry settings
  maxRetries: 5,
  retryDelayMs: 5000,
  retryBackoffMultiplier: 2,
  
  // Polling intervals
  pollIntervalMs: 2000,
  maxPollAttempts: 60,
  
  // Animation durations
  fadeInDuration: 400,
  fadeOutDuration: 300,
  
  // UI debounce
  clickDebounceMs: 500,
  inputDebounceMs: 300,
};

// ========================================
// STORAGE KEYS
// ========================================

export const STORAGE_KEYS = {
  // API keys
  openRouterApiKey: '@storyrpg_openrouter_api_key',
  geminiApiKey: '@storyrpg_gemini_api_key',
  atlasCloudApiKey: '@storyrpg_atlas_cloud_api_key',
  atlasCloudModel: '@storyrpg_atlas_cloud_model',
  midapiToken: '@storyrpg_midapi_token',
  
  // User preferences
  settings: '@storyrpg_settings',
  
  // Game state
  gameState: 'gameStore_playerState',
  
  // Generation
  generationJobs: '@storyrpg_generation_jobs',
  seasonPlans: 'season-plans',
  activeSeasonPlan: 'active-season-plan',
  
  // Feedback
  imageFeedback: '@storyrpg_image_feedback',
};

// ========================================
// VERCEL BLOB CONFIGURATION
// ========================================

export const BLOB_CONFIG = {
  manifestUrl: process.env.EXPO_PUBLIC_BLOB_MANIFEST_URL || '',
};

/**
 * Detect whether we're running on a Vercel deployment (no local proxy available).
 */
export function isVercelDeployment(): boolean {
  if (!isWebRuntime() || typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host.endsWith('.vercel.app') || host.endsWith('.vercel-storage.com');
}

// ========================================
// HELPER FUNCTIONS
// ========================================

/**
 * Build a URL for serving generated images.
 * On Vercel deployments images are embedded as data URLs so no rewriting is needed.
 */
export function getImageServeUrl(imagePath: string): string {
  if (isWebRuntime() && imagePath.startsWith('generated-stories/')) {
    return `${PROXY_CONFIG.getProxyUrl()}/${imagePath}`;
  }
  return imagePath;
}

/**
 * Build a data URL from base64 image data
 */
export function buildDataUrl(base64Data: string, mimeType: string = 'image/png'): string {
  return `data:${mimeType};base64,${base64Data}`;
}
