import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCb,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { loadEnv } from '../config/env';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const SCRYPT_KEYLEN = 64;

/**
 * Password hashing with scrypt from the Node standard library.
 * Chosen over a native bcrypt/argon2 addon so the image builds anywhere without a
 * compiler, while remaining a memory-hard KDF.
 *
 * Format: `scrypt$<saltHex>$<hashHex>`
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  let derived: Buffer;
  try {
    derived = await scrypt(password, salt, expected.length);
  } catch {
    return false;
  }
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/** Password policy enforced on registration and password change. */
export function validatePasswordStrength(password: string): string | null {
  if (password.length < 10) return 'Password must be at least 10 characters long';
  if (!/[a-z]/.test(password)) return 'Password must contain a lowercase letter';
  if (!/[A-Z]/.test(password)) return 'Password must contain an uppercase letter';
  if (!/[0-9]/.test(password)) return 'Password must contain a digit';
  return null;
}

function encryptionKey(): Buffer {
  const raw = loadEnv().APP_ENCRYPTION_KEY;
  // Accept a 64-char hex key directly, otherwise derive 32 bytes from the passphrase.
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  return createHash('sha256').update(raw).digest();
}

/**
 * AES-256-GCM encryption for provider credentials stored in the database.
 * Format: `v1:<ivB64>:<tagB64>:<cipherB64>`
 */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(payload: string): string | null {
  if (!payload?.startsWith('v1:')) return null;
  const [, ivB64, tagB64, dataB64] = payload.split(':');
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Stable hash of an arbitrary object — used to cache AI results by input. */
export function stableHash(value: unknown): string {
  return sha256(stableStringify(value));
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export function newToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}

export { randomUUID };

/** Mask a secret for display: keeps the shape, never the value. */
export function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 8) return '••••••••';
  return `${value.slice(0, 3)}••••••••${value.slice(-2)}`;
}
