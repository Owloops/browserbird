/** @fileoverview Output redaction: scrubs known secrets and token patterns from agent output. */

const REDACTED = '[redacted]';

const SENSITIVE_NAME_RE = /KEY|SECRET|TOKEN|PASSWORD/i;

/**
 * Token prefix patterns. Each entry is [prefix, minLength] where minLength
 * is the shortest plausible token including the prefix (avoids false positives
 * on short strings that happen to start with a prefix).
 */
const TOKEN_PATTERNS: Array<[string, number]> = [
  ['xoxb-', 20],
  ['xapp-', 20],
  ['sk-ant-api', 20],
  ['sk-ant-oat', 20],
  ['sk-or-', 20],
];

let knownSecrets: string[] | undefined;

function collectSecrets(): string[] {
  const secrets: string[] = [];
  for (const [name, value] of Object.entries(process.env)) {
    if (value && SENSITIVE_NAME_RE.test(name) && value.length >= 8) {
      secrets.push(value);
    }
  }
  secrets.sort((a, b) => b.length - a.length);
  return secrets;
}

function getSecrets(): string[] {
  if (!knownSecrets) {
    knownSecrets = collectSecrets();
  }
  return knownSecrets;
}

/** Re-collects secrets from process.env. Call after env changes (e.g. onboarding). */
export function refreshSecrets(): void {
  knownSecrets = collectSecrets();
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildPatternRegex(): RegExp {
  const parts = TOKEN_PATTERNS.map(([prefix, minLength]) => {
    const escaped = escapeForRegex(prefix);
    const remaining = minLength - prefix.length;
    return `${escaped}[A-Za-z0-9_\\-]{${remaining},}`;
  });
  return new RegExp(parts.join('|'), 'g');
}

const patternRegex = buildPatternRegex();

/** Replaces known secret values and token patterns in text with [redacted]. */
export function redact(text: string): string {
  if (!text) return text;

  let result = text;

  for (const secret of getSecrets()) {
    if (result.includes(secret)) {
      result = result.replaceAll(secret, REDACTED);
    }
  }

  result = result.replace(patternRegex, REDACTED);

  return result;
}
