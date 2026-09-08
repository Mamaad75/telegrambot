import type { Role } from '@baimar/shared';
import type { User } from '@prisma/client';
import { loadEnv } from '../config/env';
import { hashPassword, newToken, sha256, validatePasswordStrength, verifyPassword } from '../lib/crypto';
import { badRequest, unauthorized } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { recordAudit } from '../lib/audit-log';

/**
 * Authentication.
 *
 * Refresh tokens are opaque random strings stored only as SHA-256 hashes, so a database
 * leak does not hand out sessions. Repeated failed logins lock the account temporarily,
 * and the failure response never reveals whether the e-mail exists.
 */

const MAX_FAILED_LOGINS = 8;
const LOCK_MINUTES = 15;

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface LoginContext {
  ip?: string;
  userAgent?: string;
}

export async function login(
  email: string,
  password: string,
  signAccessToken: (payload: object, expiresIn: string | number) => string,
  ctx: LoginContext = {},
): Promise<{ user: User; tokens: IssuedTokens }> {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

  const genericFailure = unauthorized('Incorrect e-mail or password');

  if (!user) {
    // Spend comparable time on a missing account so timing does not leak existence.
    await verifyPassword(password, 'scrypt$00$00');
    throw genericFailure;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw unauthorized(`Too many failed attempts. Try again after ${user.lockedUntil.toISOString()}`);
  }
  if (!user.isActive) throw unauthorized('This account has been deactivated');

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    const failed = user.failedLogins + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLogins: failed,
        lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
      },
    });
    await recordAudit({
      userId: user.id,
      actorEmail: user.email,
      action: 'auth.login_failed',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    throw genericFailure;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  const tokens = await issueTokens(user, signAccessToken, ctx);
  await recordAudit({ userId: user.id, actorEmail: user.email, action: 'auth.login', ip: ctx.ip, userAgent: ctx.userAgent });
  return { user, tokens };
}

export async function issueTokens(
  user: User,
  signAccessToken: (payload: object, expiresIn: string | number) => string,
  ctx: LoginContext = {},
): Promise<IssuedTokens> {
  const env = loadEnv();
  const accessToken = signAccessToken(
    { sub: user.id, email: user.email, role: user.role as Role, type: 'access' },
    env.JWT_ACCESS_TTL,
  );

  const refreshToken = newToken(48);
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256(refreshToken),
      expiresAt: new Date(Date.now() + env.JWT_REFRESH_TTL * 1000),
      ip: ctx.ip,
      userAgent: ctx.userAgent?.slice(0, 300),
    },
  });

  return { accessToken, refreshToken, expiresIn: env.JWT_ACCESS_TTL };
}

export async function refresh(
  refreshToken: string,
  signAccessToken: (payload: object, expiresIn: string | number) => string,
  ctx: LoginContext = {},
): Promise<{ user: User; tokens: IssuedTokens }> {
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: sha256(refreshToken) },
    include: { user: true },
  });

  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw unauthorized('The refresh token is invalid or has expired');
  }
  if (!stored.user.isActive) throw unauthorized('This account has been deactivated');

  // Rotate: the old token is revoked as soon as it is used.
  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
  const tokens = await issueTokens(stored.user, signAccessToken, ctx);
  return { user: stored.user, tokens };
}

export async function logout(refreshToken: string): Promise<void> {
  await prisma.refreshToken
    .updateMany({ where: { tokenHash: sha256(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } })
    .catch(() => undefined);
}

export async function logoutEverywhere(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const ok = await verifyPassword(currentPassword, user.passwordHash);
  if (!ok) throw badRequest('The current password is incorrect');

  const problem = validatePasswordStrength(newPassword);
  if (problem) throw badRequest(problem);

  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(newPassword) } });
  // Changing a password ends every other session.
  await logoutEverywhere(userId);
  await recordAudit({ userId, actorEmail: user.email, action: 'auth.password_changed' });
}

/** Remove expired and revoked refresh tokens. Safe to call periodically. */
export async function pruneRefreshTokens(): Promise<number> {
  const result = await prisma.refreshToken.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: new Date(Date.now() - 7 * 24 * 3600 * 1000) } }],
    },
  });
  return result.count;
}
