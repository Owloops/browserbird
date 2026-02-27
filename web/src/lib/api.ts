/** @fileoverview Typed fetch wrapper and auth helpers. */

const AUTH_KEY = 'browserbird_auth_token';
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export { API_BASE as apiBase };

let unauthorizedCallback: (() => void) | null = null;

export function setUnauthorizedCallback(cb: () => void): void {
  unauthorizedCallback = cb;
}

export function getAuthToken(): string | null {
  return localStorage.getItem(AUTH_KEY);
}

export function setAuthToken(token: string): void {
  localStorage.setItem(AUTH_KEY, token);
}

export function clearAuthToken(): void {
  localStorage.removeItem(AUTH_KEY);
}

export async function api<T>(
  path: string,
  options?: { method?: string; body?: unknown },
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (options?.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method: options?.method ?? 'GET',
    headers,
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 401) {
    clearAuthToken();
    unauthorizedCallback?.();
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? `${res.status}`);
  }

  return res.json() as Promise<T>;
}

export async function checkAuth(): Promise<{
  setupRequired: boolean;
  authRequired: boolean;
  onboardingRequired: boolean;
}> {
  const res = await fetch(`${API_BASE}/api/auth/check`);
  return res.json() as Promise<{
    setupRequired: boolean;
    authRequired: boolean;
    onboardingRequired: boolean;
  }>;
}

export async function login(
  email: string,
  password: string,
): Promise<{ token: string; user: { id: number; email: string } }> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: 'Login failed' }))) as { error?: string };
    throw new Error(err.error ?? 'Login failed');
  }
  return res.json() as Promise<{ token: string; user: { id: number; email: string } }>;
}

export async function setup(
  email: string,
  password: string,
): Promise<{ token: string; user: { id: number; email: string } }> {
  const res = await fetch(`${API_BASE}/api/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: 'Setup failed' }))) as { error?: string };
    throw new Error(err.error ?? 'Setup failed');
  }
  return res.json() as Promise<{ token: string; user: { id: number; email: string } }>;
}

export async function verifyToken(): Promise<boolean> {
  try {
    await api<{ valid: boolean }>('/api/auth/verify', { method: 'POST' });
    return true;
  } catch {
    clearAuthToken();
    return false;
  }
}

export function getPageFromHash(): string {
  const hash = window.location.hash.slice(2);
  const qIndex = hash.indexOf('?');
  return (qIndex === -1 ? hash : hash.slice(0, qIndex)) || 'status';
}

export function getHashParams(): URLSearchParams {
  const hash = window.location.hash.slice(2);
  const qIndex = hash.indexOf('?');
  return new URLSearchParams(qIndex === -1 ? '' : hash.slice(qIndex + 1));
}

export async function getOnboardingDefaults(): Promise<import('./types.ts').OnboardingDefaults> {
  return api('/api/onboarding/defaults');
}

export async function validateSlackTokens(
  botToken: string,
  appToken: string,
): Promise<{ valid: boolean; team: string; botUser: string }> {
  return api('/api/onboarding/slack', {
    method: 'POST',
    body: { botToken, appToken },
  });
}

export async function saveAgentConfig(data: {
  name: string;
  provider: string;
  model: string;
  systemPrompt: string;
  maxTurns: number;
  channels: string[];
}): Promise<{ agents: unknown[] }> {
  return api('/api/onboarding/agent', { method: 'POST', body: data });
}

export async function saveAuthConfig(data: { apiKey: string }): Promise<{ valid: boolean }> {
  return api('/api/onboarding/auth', { method: 'POST', body: data });
}

export async function saveBrowserConfig(data: {
  enabled: boolean;
  mode: string;
}): Promise<{ browser: unknown }> {
  return api('/api/onboarding/browser', { method: 'POST', body: data });
}

export async function completeOnboarding(): Promise<{ success: boolean }> {
  return api('/api/onboarding/complete', { method: 'POST', body: {} });
}
