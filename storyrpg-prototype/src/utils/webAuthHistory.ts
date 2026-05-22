/**
 * Web-only helpers so browser Back / bfcache cannot show the app shell after logout.
 */

const HISTORY_STATE_KEY = 'storyrpgAuth';
const SIGNED_OUT_STORAGE_KEY = 'storyrpg_signed_out';

export function isSignedOutLatchActive(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return sessionStorage.getItem(SIGNED_OUT_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function markSignedOutLatch(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(SIGNED_OUT_STORAGE_KEY, '1');
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearSignedOutLatch(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(SIGNED_OUT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function sealWebHistoryAfterLogout(): void {
  if (typeof window === 'undefined') return;
  markSignedOutLatch();
  const { pathname, search, hash } = window.location;
  const base = `${pathname}${search}${hash}`;
  const state = { [HISTORY_STATE_KEY]: 'signed-out' };
  window.history.replaceState(state, document.title, base);
  // Extra entry so Back triggers popstate on this shell instead of only bfcache restore.
  window.history.pushState(state, document.title, base);
}

export function markWebHistoryAuthenticated(): void {
  if (typeof window === 'undefined') return;
  clearSignedOutLatch();
  const { pathname, search, hash } = window.location;
  const base = `${pathname}${search}${hash}`;
  window.history.replaceState({ [HISTORY_STATE_KEY]: 'signed-in' }, document.title, base);
}

export type WebAuthHistoryHandlers = {
  /** Runs synchronously (clear UI); may call async revalidation after. */
  onNavigate: () => void;
};

export function installWebAuthHistoryGuards(handlers: WebAuthHistoryHandlers): () => void {
  if (typeof window === 'undefined') return () => {};

  const runCheck = () => {
    handlers.onNavigate();
  };

  const onPopState = () => {
    runCheck();
  };

  const onPageShow = (event: PageTransitionEvent) => {
    // bfcache restore, or any Back/forward navigation that revives the page
    if (event.persisted) {
      runCheck();
    }
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible' && isSignedOutLatchActive()) {
      runCheck();
    }
  };

  window.addEventListener('popstate', onPopState);
  window.addEventListener('pageshow', onPageShow);
  document.addEventListener('visibilitychange', onVisibilityChange);

  return () => {
    window.removeEventListener('popstate', onPopState);
    window.removeEventListener('pageshow', onPageShow);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
