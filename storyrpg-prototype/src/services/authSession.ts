import { PROXY_CONFIG } from '../config/endpoints';

export type AuthUser = {
  provider: string;
  id: string;
  email: string | null;
  displayName: string | null;
  picture: string | null;
};

export async function fetchAuthProviders(): Promise<{ google: boolean; discord: boolean }> {
  const res = await fetch(PROXY_CONFIG.authProviders, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Auth providers request failed: ${res.status}`);
  }
  return res.json() as Promise<{ google: boolean; discord: boolean }>;
}

export async function fetchAuthMe(): Promise<{ user: AuthUser | null }> {
  const res = await fetch(PROXY_CONFIG.authMe, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (res.status === 401) {
    return { user: null };
  }
  if (!res.ok) {
    throw new Error(`Auth session request failed: ${res.status}`);
  }
  return res.json() as Promise<{ user: AuthUser | null }>;
}

export async function postAuthLogout(): Promise<void> {
  const res = await fetch(PROXY_CONFIG.authLogout, {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Auth logout failed: ${res.status}`);
  }
}
