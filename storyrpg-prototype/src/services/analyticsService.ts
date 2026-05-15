import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { isWebRuntime } from '../utils/runtimeEnv';

type AnalyticsValue = string | number | boolean | null | undefined;
type AnalyticsProperties = Record<string, AnalyticsValue | AnalyticsValue[]>;
type SafeAnalyticsProperties = Record<string, string | number | boolean | null | Array<string | number | boolean | null>>;

type AttributionProperties = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  ref?: string;
  ref_code?: string;
  campaign?: string;
  landing_path?: string;
  first_referrer?: string;
  latest_referrer?: string;
  first_seen_at?: string;
};

const ANALYTICS_PLAYER_ID_KEY = '@storyrpg_analytics_player_id';
const FIRST_TOUCH_ATTRIBUTION_KEY = '@storyrpg_first_touch_attribution';
const LATEST_TOUCH_ATTRIBUTION_KEY = '@storyrpg_latest_touch_attribution';
const PERSON_COUNTERS_KEY = '@storyrpg_analytics_person_counters';

const SENSITIVE_KEY_PARTS = [
  'text',
  'prose',
  'prompt',
  'name',
  'description',
  'synopsis',
  'summary',
  'dialogue',
  'character',
  'pronoun',
  'raw',
  'player',
];

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref', 'ref_code', 'campaign'] as const;

let posthogClient: typeof import('posthog-js').default | null = null;
let initPromise: Promise<void> | null = null;
let anonymousPlayerId: string | null = null;
let registeredProperties: SafeAnalyticsProperties = {};
const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

function analyticsEnabled(): boolean {
  const enabled = process.env.EXPO_PUBLIC_ANALYTICS_ENABLED;
  if (enabled && enabled.toLowerCase() === 'false') return false;
  const key = process.env.EXPO_PUBLIC_POSTHOG_KEY;
  const hasRealKey = Boolean(key) && key !== 'phc_your_project_key' && key !== 'phc_your_project_token_here';
  return hasRealKey && isWebRuntime() && Platform.OS === 'web';
}

function analyticsDebug(): boolean {
  return process.env.EXPO_PUBLIC_ANALYTICS_DEBUG === 'true';
}

function makeAnonymousPlayerId(): string {
  return `anon-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function sanitizeString(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, 256);
}

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_PARTS.some((part) => lower.includes(part));
}

function sanitizeProperties(properties?: AnalyticsProperties): SafeAnalyticsProperties {
  const sanitized: SafeAnalyticsProperties = {};
  for (const [key, value] of Object.entries(properties || {})) {
    if (isSensitiveKey(key)) continue;

    if (Array.isArray(value)) {
      const safeArray = value
        .map((item) => (typeof item === 'string' ? sanitizeString(item) : item))
        .filter((item): item is string | number | boolean | null => (
          item === null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'
        ));
      sanitized[key] = safeArray.slice(0, 25);
      continue;
    }

    if (typeof value === 'string') {
      const safe = sanitizeString(value);
      if (safe !== undefined) sanitized[key] = safe;
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

async function readJson<T extends Record<string, unknown>>(key: string): Promise<T | null> {
  try {
    const value = await AsyncStorage.getItem(key);
    return value ? JSON.parse(value) as T : null;
  } catch {
    return null;
  }
}

async function writeJson(key: string, value: Record<string, unknown>): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Analytics persistence must never interrupt gameplay.
  }
}

async function getAnonymousPlayerId(): Promise<string> {
  if (anonymousPlayerId) return anonymousPlayerId;
  try {
    const stored = await AsyncStorage.getItem(ANALYTICS_PLAYER_ID_KEY);
    if (stored) {
      anonymousPlayerId = stored;
      return stored;
    }
    const created = makeAnonymousPlayerId();
    await AsyncStorage.setItem(ANALYTICS_PLAYER_ID_KEY, created);
    anonymousPlayerId = created;
    return created;
  } catch {
    anonymousPlayerId = makeAnonymousPlayerId();
    return anonymousPlayerId;
  }
}

function readUrlAttribution(): Partial<AttributionProperties> {
  if (!isWebRuntime() || typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search || '');
  const attribution: Partial<AttributionProperties> = {};
  for (const key of UTM_KEYS) {
    const value = sanitizeString(params.get(key) || '');
    if (value) attribution[key] = value;
  }
  attribution.landing_path = `${window.location.pathname || '/'}${window.location.search || ''}`;
  if (typeof document !== 'undefined') {
    const referrer = sanitizeString(document.referrer || '');
    if (referrer) attribution.latest_referrer = referrer;
  }
  return attribution;
}

async function getAttributionSuperProperties(): Promise<Record<string, string | number | boolean | null>> {
  const first = await readJson<AttributionProperties>(FIRST_TOUCH_ATTRIBUTION_KEY);
  const latest = await readJson<AttributionProperties>(LATEST_TOUCH_ATTRIBUTION_KEY);
  const props: Record<string, string | number | boolean | null> = {};

  for (const [key, value] of Object.entries(first || {})) {
    if (typeof value === 'string') props[`first_${key}`] = value;
  }
  for (const [key, value] of Object.entries(latest || {})) {
    if (typeof value === 'string') props[`latest_${key}`] = value;
  }
  return props;
}

function mergeRegisteredProperties(properties: SafeAnalyticsProperties): void {
  registeredProperties = {
    ...registeredProperties,
    ...properties,
  };
}

async function captureViaPostHogApi(eventName: string, properties: SafeAnalyticsProperties): Promise<void> {
  const key = process.env.EXPO_PUBLIC_POSTHOG_KEY;
  if (!key) return;

  try {
    const host = (process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com').replace(/\/$/, '');
    const distinctId = await getAnonymousPlayerId();
    const payload = {
      api_key: key,
      event: eventName,
      distinct_id: distinctId,
      properties: {
        ...registeredProperties,
        ...properties,
      },
    };

    await fetch(`${host}/capture/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // Analytics must remain best-effort and never interrupt gameplay.
  }
}

export async function initAnalytics(): Promise<void> {
  if (!analyticsEnabled()) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const posthogModule = await import('posthog-js');
    posthogClient = posthogModule.default;
    posthogClient.init(process.env.EXPO_PUBLIC_POSTHOG_KEY || '', {
      api_host: process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
      autocapture: false,
      capture_pageview: false,
      disable_session_recording: true,
      request_batching: false,
      loaded: (client) => {
        if (analyticsDebug()) client.debug();
      },
    });

    const id = await getAnonymousPlayerId();
    const attributionSuperProperties = await getAttributionSuperProperties();
    posthogClient.identify(id);
    const baseProperties = sanitizeProperties({
      analytics_player_id: id,
      analytics_session_id: sessionId,
      platform: Platform.OS,
      ...attributionSuperProperties,
    });
    mergeRegisteredProperties(baseProperties);
    posthogClient.register(baseProperties);
  })();

  return initPromise;
}

export async function identifyAnonymousPlayer(): Promise<string> {
  const id = await getAnonymousPlayerId();
  if (analyticsEnabled()) {
    await initAnalytics();
    posthogClient?.identify(id);
  }
  return id;
}

export async function captureAttributionFromUrl(): Promise<void> {
  if (!isWebRuntime()) return;
  const urlAttribution = readUrlAttribution();
  const hasCampaignParams = UTM_KEYS.some((key) => Boolean(urlAttribution[key]));
  if (!hasCampaignParams) return;

  const now = new Date().toISOString();
  const existingFirst = await readJson<AttributionProperties>(FIRST_TOUCH_ATTRIBUTION_KEY);
  const latest: AttributionProperties = {
    ...urlAttribution,
    first_seen_at: now,
  };

  if (!existingFirst) {
    await writeJson(FIRST_TOUCH_ATTRIBUTION_KEY, {
      ...latest,
      first_referrer: latest.latest_referrer,
    });
  }
  await writeJson(LATEST_TOUCH_ATTRIBUTION_KEY, latest);

  await initAnalytics();
  const superProperties = await getAttributionSuperProperties();
  mergeRegisteredProperties(superProperties);
  posthogClient?.register(superProperties);
  posthogClient?.people.set(superProperties);
  track('campaign attributed', {
    has_ref_code: Boolean(latest.ref_code),
    has_utm_campaign: Boolean(latest.utm_campaign),
  });
}

export function setSuperProperties(properties: AnalyticsProperties): void {
  if (!analyticsEnabled()) return;
  const safe = sanitizeProperties(properties);
  mergeRegisteredProperties(safe);
  void initAnalytics().then(() => {
    posthogClient?.register(safe);
  });
}

export function track(eventName: string, properties?: AnalyticsProperties): void {
  if (!analyticsEnabled()) return;
  const safe = sanitizeProperties({
    analytics_session_id: sessionId,
    platform: Platform.OS,
    ...properties,
  });
  void initAnalytics().then(() => {
    void captureViaPostHogApi(eventName, safe);
  });
}

export function screen(screenName: string, properties?: AnalyticsProperties): void {
  track('screen viewed', {
    screen: screenName,
    ...properties,
  });
}

export function incrementPersonProperty(property: string, amount = 1): void {
  if (!analyticsEnabled() || isSensitiveKey(property)) return;
  void (async () => {
    const counters = await readJson<Record<string, number>>(PERSON_COUNTERS_KEY) || {};
    const nextValue = Math.max(0, Number(counters[property] || 0) + amount);
    const nextCounters = { ...counters, [property]: nextValue };
    await writeJson(PERSON_COUNTERS_KEY, nextCounters);
    await initAnalytics();
    posthogClient?.people.set({ [property]: nextValue });
  })();
}
