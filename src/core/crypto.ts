/** @fileoverview AES-256-GCM encryption for vault key values. */

import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { logger } from './logger.ts';
import { saveEnvFile } from '../config.ts';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const ENC_PREFIX = 'enc$';
const VAULT_KEY_ENV = 'BROWSERBIRD_VAULT_KEY';

export function encrypt(plaintext: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decrypt(encoded: string, keyHex: string): string {
  if (!encoded.startsWith(ENC_PREFIX)) return encoded;
  const parts = encoded.slice(ENC_PREFIX.length).split(':');
  if (parts.length !== 3) throw new Error('malformed encrypted value');
  const iv = Buffer.from(parts[0]!, 'base64');
  const tag = Buffer.from(parts[1]!, 'base64');
  const ciphertext = Buffer.from(parts[2]!, 'base64');
  const key = Buffer.from(keyHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(ENC_PREFIX);
}

export function generateVaultKey(): string {
  return randomBytes(32).toString('hex');
}

export function getVaultKey(): string {
  const key = process.env[VAULT_KEY_ENV];
  if (!key) {
    throw new Error(
      `${VAULT_KEY_ENV} not set. Run the daemon to auto-generate it, or set it manually.`,
    );
  }
  return key;
}

export function ensureVaultKey(envPath: string): void {
  if (process.env[VAULT_KEY_ENV]) return;
  const key = generateVaultKey();
  saveEnvFile(envPath, { [VAULT_KEY_ENV]: key });
  process.env[VAULT_KEY_ENV] = key;
  logger.info('generated vault encryption key');
}
