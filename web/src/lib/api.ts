/** @fileoverview Typed fetch wrapper and auth helpers. */

const AUTH_KEY = 'browserbird_auth_token';

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

  const res = await fetch(path, {
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

export async function checkAuthRequired(): Promise<boolean> {
  const res = await fetch('/api/auth/check');
  const data = (await res.json()) as { authRequired: boolean };
  return data.authRequired;
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
  return (qIndex === -1 ? hash : hash.slice(0, qIndex)) || 'dashboard';
}

export function getHashParams(): URLSearchParams {
  const hash = window.location.hash.slice(2);
  const qIndex = hash.indexOf('?');
  return new URLSearchParams(qIndex === -1 ? '' : hash.slice(qIndex + 1));
}
