/**
 * Web-only helpers so browser Back / bfcache cannot show the app shell after logout.
 */

const HISTORY_STATE_KEY = 'storyrpgAuth';

export function sealWebHistoryAfterLogout(): void {
  if (typeof window === 'undefined') return;
  const { pathname, search, hash } = window.location;
  const base = `${pathname}${search}${hash}`;
  window.history.replaceState({ [HISTORY_STATE_KEY]: 'signed-out' }, document.title, base);
}

export function markWebHistoryAuthenticated(): void {
  if (typeof window === 'undefined') return;
  const { pathname, search, hash } = window.location;
  const base = `${pathname}${search}${hash}`;
  window.history.replaceState({ [HISTORY_STATE_KEY]: 'signed-in' }, document.title, base);
}

export type WebAuthHistoryHandlers = {
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
    if (event.persisted) {
      runCheck();
    }
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
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
