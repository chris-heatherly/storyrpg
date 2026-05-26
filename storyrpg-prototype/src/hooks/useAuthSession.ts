import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { fetchAuthMe, postAuthLogout, type AuthUser } from '../services/authSession';
import {
  clearSignedOutLatch,
  installWebAuthHistoryGuards,
  isSignedOutLatchActive,
  markSignedOutLatch,
  markWebHistoryAuthenticated,
  sealWebHistoryAfterLogout,
} from '../utils/webAuthHistory';

export type AuthSessionState = {
  /** undefined = checking session; null = signed out; AuthUser = signed in */
  authUser: AuthUser | null | undefined;
  signedOutLatch: boolean;
  isChecking: boolean;
  isSignedIn: boolean;
  refreshAuthSession: () => Promise<AuthUser | null>;
  handleAuthenticated: (user: AuthUser) => void;
  handleSignedOut: () => Promise<void>;
};

type UseAuthSessionOptions = {
  /** Called after OAuth redirect cleanup when a session is restored. */
  onSessionRestored?: (user: AuthUser) => void;
};

export function useAuthSession(options: UseAuthSessionOptions = {}): AuthSessionState {
  const { onSessionRestored } = options;
  const [authUser, setAuthUser] = useState<AuthUser | null | undefined>(() => {
    if (Platform.OS === 'web' && isSignedOutLatchActive()) return null;
    return undefined;
  });

  const refreshAuthSession = useCallback(async () => {
    if (Platform.OS === 'web' && isSignedOutLatchActive()) {
      setAuthUser(null);
      return null;
    }
    try {
      const me = await fetchAuthMe();
      if (me.user) {
        if (Platform.OS === 'web') {
          clearSignedOutLatch();
          markWebHistoryAuthenticated();
        }
        setAuthUser(me.user);
        return me.user;
      }
      setAuthUser(null);
      return null;
    } catch (err) {
      console.warn('[useAuthSession] Auth session check failed:', err);
      setAuthUser(null);
      return null;
    }
  }, []);

  const handleHistoryNavigation = useCallback(() => {
    if (Platform.OS === 'web' && isSignedOutLatchActive()) {
      setAuthUser(null);
      return;
    }
    setAuthUser(undefined);
    void refreshAuthSession();
  }, [refreshAuthSession]);

  useEffect(() => {
    void refreshAuthSession();
  }, [refreshAuthSession]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    return installWebAuthHistoryGuards({
      onNavigate: handleHistoryNavigation,
    });
  }, [handleHistoryNavigation]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const afterOAuth = url.searchParams.get('afterAuth') === 'home';
    const authError = url.searchParams.has('auth');
    if (!afterOAuth && !authError) return;
    url.searchParams.delete('afterAuth');
    url.searchParams.delete('auth');
    const qs = url.searchParams.toString();
    const next = `${url.pathname}${qs ? `?${qs}` : ''}${url.hash}`;
    window.history.replaceState({}, document.title, next);
    void refreshAuthSession().then((user) => {
      if (user) {
        onSessionRestored?.(user);
      }
    });
  }, [onSessionRestored, refreshAuthSession]);

  const handleAuthenticated = useCallback((user: AuthUser) => {
    if (Platform.OS === 'web') {
      clearSignedOutLatch();
      markWebHistoryAuthenticated();
    }
    setAuthUser(user);
  }, []);

  const handleSignedOut = useCallback(async () => {
    try {
      await postAuthLogout();
    } catch (err) {
      console.warn('[useAuthSession] Logout request failed:', err);
    }
    setAuthUser(null);
    if (Platform.OS === 'web') {
      markSignedOutLatch();
      sealWebHistoryAfterLogout();
    }
  }, []);

  const signedOutLatch = Platform.OS === 'web' && isSignedOutLatchActive();

  return {
    authUser,
    signedOutLatch,
    isChecking: !signedOutLatch && authUser === undefined,
    isSignedIn: !signedOutLatch && authUser != null,
    refreshAuthSession,
    handleAuthenticated,
    handleSignedOut,
  };
}
