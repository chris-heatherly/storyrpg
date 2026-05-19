import { PROXY_CONFIG } from '../config/endpoints';

export type AuthUser = {
  provider: string;
  id: string;
  email: string | null;
  displayName: string | null;
  picture: string | null;
  role: 'user' | 'admin';
};

export type AuthProviders = {
  google: boolean;
  discord: boolean;
  local: boolean;
  registration: boolean;
};

export async function fetchAuthProviders(): Promise<AuthProviders> {
  const res = await fetch(PROXY_CONFIG.authProviders, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Auth providers request failed: ${res.status}`);
  }
  return res.json() as Promise<AuthProviders>;
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

async function postAuthJson(
  url: string,
  body: Record<string, string>,
): Promise<{ user: AuthUser }> {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { user?: AuthUser; error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  if (!data.user) {
    throw new Error('No user in response');
  }
  return { user: data.user };
}

export async function postAuthLogin(email: string, password: string): Promise<{ user: AuthUser }> {
  return postAuthJson(PROXY_CONFIG.authLogin, { email, password });
}

export async function postAuthRegister(
  email: string,
  password: string,
  displayName?: string,
): Promise<{ user: AuthUser }> {
  const body: Record<string, string> = { email, password };
  if (displayName?.trim()) {
    body.displayName = displayName.trim();
  }
  return postAuthJson(PROXY_CONFIG.authRegister, body);
}
