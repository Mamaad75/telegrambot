import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, hashPassword, maskSecret, stableHash, validatePasswordStrength, verifyPassword } from './crypto';

describe('password hashing', () => {
  it('verifies a correct password and rejects a wrong one', async () => {
    const hash = await hashPassword('CorrectHorse1');
    expect(await verifyPassword('CorrectHorse1', hash)).toBe(true);
    expect(await verifyPassword('correcthorse1', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('salts, so the same password never produces the same hash', async () => {
    expect(await hashPassword('CorrectHorse1')).not.toBe(await hashPassword('CorrectHorse1'));
  });

  it('never stores the password in the hash', async () => {
    const hash = await hashPassword('CorrectHorse1');
    expect(hash).not.toContain('CorrectHorse1');
    expect(hash.startsWith('scrypt$')).toBe(true);
  });

  it('rejects a malformed stored hash instead of throwing', async () => {
    expect(await verifyPassword('x', 'garbage')).toBe(false);
    expect(await verifyPassword('x', 'bcrypt$aa$bb')).toBe(false);
  });

  it('enforces the password policy', () => {
    expect(validatePasswordStrength('short')).toContain('10 characters');
    expect(validatePasswordStrength('alllowercase1')).toContain('uppercase');
    expect(validatePasswordStrength('ALLUPPERCASE1')).toContain('lowercase');
    expect(validatePasswordStrength('NoDigitsHere')).toContain('digit');
    expect(validatePasswordStrength('ValidPass123')).toBeNull();
  });
});

describe('secret encryption at rest', () => {
  it('round-trips a secret', () => {
    const encrypted = encryptSecret('my-api-key-value');
    expect(encrypted).not.toContain('my-api-key-value');
    expect(decryptSecret(encrypted)).toBe('my-api-key-value');
  });

  it('produces a different ciphertext each time', () => {
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'));
  });

  it('rejects ciphertext whose bytes were altered — the GCM tag must fail', () => {
    const encrypted = encryptSecret('a-reasonably-long-secret-value');
    const [version, iv, tag, data] = encrypted.split(':');

    // Flip a character inside the ciphertext itself. (Appending after the base64
    // padding would be ignored by the decoder and is not a meaningful tamper.)
    const flipped = data[0] === 'A' ? `B${data.slice(1)}` : `A${data.slice(1)}`;
    expect(decryptSecret([version, iv, tag, flipped].join(':'))).toBeNull();

    // A wrong authentication tag must also fail.
    const badTag = tag[0] === 'A' ? `B${tag.slice(1)}` : `A${tag.slice(1)}`;
    expect(decryptSecret([version, iv, badTag, data].join(':'))).toBeNull();

    expect(decryptSecret('not-encrypted')).toBeNull();
    expect(decryptSecret('')).toBeNull();
  });

  it('masks secrets for display without revealing them', () => {
    expect(maskSecret('sk-abcdef123456')).toBe('sk-••••••••56');
    expect(maskSecret('short')).toBe('••••••••');
    expect(maskSecret(null)).toBeNull();
  });
});

describe('stable hashing', () => {
  it('is independent of key order, so an unchanged input is recognised as unchanged', () => {
    expect(stableHash({ a: 1, b: { c: 2, d: 3 } })).toBe(stableHash({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it('changes when the content changes', () => {
    expect(stableHash({ a: 1 })).not.toBe(stableHash({ a: 2 }));
  });
});
