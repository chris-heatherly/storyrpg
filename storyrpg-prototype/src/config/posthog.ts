import { Platform } from 'react-native';

// PostHog native client for iOS/Android platforms.
// On web, posthog-js is used via analyticsService.ts instead.
// Configuration is loaded from app.config.js extras via expo-constants.

let posthogInstance: import('posthog-react-native').PostHog | null = null;

function createNativeClient(): import('posthog-react-native').PostHog | null {
  if (Platform.OS === 'web') return null;

  try {
    // expo-constants reads from app.config.js extras at build time
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Constants = require('expo-constants').default;
    const apiKey = Constants.expoConfig?.extra?.posthogProjectToken as string | undefined;
    const host = Constants.expoConfig?.extra?.posthogHost as string | undefined;

    const isConfigured = Boolean(apiKey) && apiKey !== 'phc_your_project_token_here';

    if (!isConfigured) {
      console.warn(
        '[PostHog] Project token not configured for native. Set POSTHOG_PROJECT_TOKEN in .env.'
      );
    }

    if (!host) {
      console.warn('[PostHog] Host not configured. Set POSTHOG_HOST in .env.');
    }

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const PostHog = require('posthog-react-native').PostHog;
    return new PostHog(apiKey || 'placeholder_key', {
      host: host || undefined,
      disabled: !isConfigured || !host,
      captureAppLifecycleEvents: true,
      debug: __DEV__,
      flushAt: 20,
      flushInterval: 10000,
      maxBatchSize: 100,
      maxQueueSize: 1000,
    });
  } catch (err) {
    console.warn('[PostHog] Failed to initialize native client:', err);
    return null;
  }
}

export function getNativePostHog(): import('posthog-react-native').PostHog | null {
  if (Platform.OS === 'web') return null;
  if (!posthogInstance) {
    posthogInstance = createNativeClient();
  }
  return posthogInstance;
}
