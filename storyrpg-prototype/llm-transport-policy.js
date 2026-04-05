/**
 * Centralized LLM transport policy (backend).
 * Keeps timeout/retry budgets in one place so proxy + worker stay consistent.
 */

const RETRY_DELAYS_MS = [5000, 15000, 30000];
const LARGE_BODY_THRESHOLD_BYTES = 80000;
const MEDIUM_BODY_THRESHOLD_BYTES = 18000;
const LARGE_TOKENS_THRESHOLD = 32000;
const CRITICAL_STEPS = new Set([
  'world builder',
  'story architect',
  'season planner',
  'source material analyzer',
  'character developer',
  'storyboard agent',
  'storyboard agent planpass',
  'storyboard agent expandpass',
  'storyboard agent repairpass',
]);

const RETRY_TIMEOUT_MULTIPLIERS = [1, 1.5, 2];

function parsePositiveInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.floor(n);
}

function classifyRequestScale(reqBody, bodySize) {
  const maxTokens = parsePositiveInt(reqBody?.max_tokens);
  const stepRaw = String(reqBody?.step || '').trim();
  return {
    isLarge:
      (typeof maxTokens === 'number' && maxTokens >= LARGE_TOKENS_THRESHOLD) ||
      bodySize >= LARGE_BODY_THRESHOLD_BYTES,
    isMedium:
      bodySize >= MEDIUM_BODY_THRESHOLD_BYTES,
    stepRaw,
    maxTokens,
  };
}

function getBudgets(req, reqBody, bodySize) {
  const hintedResponseMs = parsePositiveInt(req.headers['x-llm-timeout-ms']);
  const hintedConnectMs = parsePositiveInt(req.headers['x-llm-connect-timeout-ms']);
  const stepHeader = String(req.headers['x-llm-step'] || '').trim().toLowerCase();
  const { isLarge, isMedium, maxTokens } = classifyRequestScale(reqBody, bodySize);
  const isCriticalStep = CRITICAL_STEPS.has(stepHeader);
  const isStoryboardExpand = stepHeader === 'storyboard agent expandpass';

  const baseConnectTimeoutMs = hintedConnectMs
    ? Math.max(10000, Math.min(hintedConnectMs, 300000))
    : (isStoryboardExpand ? 180000 : (isLarge || isCriticalStep ? 180000 : (isMedium ? 120000 : 90000)));

  const responseTimeoutMs = hintedResponseMs
    ? Math.max(60000, Math.min(hintedResponseMs, 900000))
    : (isLarge ? 900000 : (isCriticalStep ? 300000 : 180000));

  const connectTimeoutsPerAttempt = RETRY_TIMEOUT_MULTIPLIERS.map(
    (m) => Math.round(baseConnectTimeoutMs * m)
  );

  return {
    retries: 3,
    retryDelaysMs: RETRY_DELAYS_MS,
    connectTimeoutMs: baseConnectTimeoutMs,
    connectTimeoutsPerAttempt,
    responseTimeoutMs,
    maxTokens,
    isLarge,
    isCriticalStep,
    step: stepHeader || undefined,
  };
}

module.exports = {
  getBudgets,
};
