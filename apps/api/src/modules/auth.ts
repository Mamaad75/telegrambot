import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { loadEnv } from '../config/env';
import { ROLE_PERMISSIONS, type Role } from '@baimar/shared';
import { prisma } from '../lib/prisma';
import { changePassword, login, logout, logoutEverywhere, refresh } from '../services/auth-service';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({ refreshToken: z.string().min(10) });

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10),
});

const profileSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  telegramChatId: z.string().max(64).nullable().optional(),
  locale: z.enum(['fa', 'en']).optional(),
  theme: z.enum(['dark', 'light', 'system']).optional(),
  phone: z.string().max(32).nullable().optional(),
});

export default async function authRoutes(app: FastifyInstance) {
  const sign = (payload: object, expiresIn: string | number) =>
    app.jwt.sign(payload as Parameters<typeof app.jwt.sign>[0], { expiresIn });

  /**
   * Credential-stuffing is a volume attack, so the edge limits are deliberately tight:
   * five login attempts a minute from one address is far more than a person needs and
   * far less than a script wants. Nginx applies a 1r/s bucket in front of this, and the
   * per-account lockout in auth-service sits behind it — three independent layers,
   * because any one of them can be bypassed by an attacker who controls enough addresses.
   */
  app.post('/login', {
    config: { rateLimit: { max: loadEnv().AUTH_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' } },
    handler: async (req) => {
      const body = loginSchema.parse(req.body);
      const { user, tokens } = await login(body.email, body.password, sign, {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
      return { user: publicUser(user), ...tokens };
    },
  });

  app.post('/refresh', {
    // Refresh is legitimate and frequent (every access-token expiry), so it is looser
    // than login — but still bounded, because a stolen refresh token is a credential.
    config: { rateLimit: { max: loadEnv().AUTH_REFRESH_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' } },
    handler: async (req) => {
      const body = refreshSchema.parse(req.body);
      const { user, tokens } = await refresh(body.refreshToken, sign, { ip: req.ip, userAgent: req.headers['user-agent'] });
      return { user: publicUser(user), ...tokens };
    },
  });

  app.post('/logout', async (req) => {
    const body = z.object({ refreshToken: z.string().optional() }).parse(req.body ?? {});
    if (body.refreshToken) await logout(body.refreshToken);
    return { ok: true };
  });

  app.post('/logout-all', { onRequest: [app.authenticate] }, async (req) => {
    await logoutEverywhere(req.user!.id);
    return { ok: true };
  });

  app.get('/me', { onRequest: [app.authenticate] }, async (req) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    return {
      user: publicUser(user),
      permissions: ROLE_PERMISSIONS[user.role as Role],
    };
  });

  app.patch('/me', { onRequest: [app.authenticate] }, async (req) => {
    const body = profileSchema.parse(req.body);
    const user = await prisma.user.update({ where: { id: req.user!.id }, data: body });
    return { user: publicUser(user) };
  });

  app.post('/change-password', {
    onRequest: [app.authenticate],
    // Guessing the *current* password is a credential attack too, even from a session
    // that is already authenticated — a borrowed laptop, a hijacked token.
    config: { rateLimit: { max: 5, timeWindow: '5 minutes' } },
    handler: async (req) => {
      const body = changePasswordSchema.parse(req.body);
      await changePassword(req.user!.id, body.currentPassword, body.newPassword);
      return { ok: true };
    },
  });
}

export function publicUser(user: {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  telegramChatId: string | null;
  locale: string;
  theme: string;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as Role,
    isActive: user.isActive,
    telegramChatId: user.telegramChatId,
    locale: user.locale,
    theme: user.theme,
  };
}
