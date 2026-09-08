import type { Role } from '@baimar/shared';
import { can, isRestrictedToAssigned, type Permission } from '@baimar/shared';
import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { forbidden, unauthorized } from '../lib/errors';
import { prisma } from '../lib/prisma';

/**
 * Authentication and role-based access control.
 *
 * The access token is a short-lived JWT; refresh tokens are opaque, hashed at rest and
 * revocable. Permission checks use the same matrix as the web app, so the UI never offers
 * a control the API will reject.
 */

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
}

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: Role;
  type: 'access';
}

/**
 * `@fastify/jwt` owns the `request.user` declaration, so the augmentation goes there —
 * declaring it on FastifyRequest as well would be overridden and leave `user` untyped.
 */
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AccessTokenPayload;
    user: AuthUser;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requirePermission: (
      ...permissions: Permission[]
    ) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export default fp(async function authPlugin(app: FastifyInstance) {
  app.decorate('authenticate', async function authenticate(req: FastifyRequest) {
    let payload: AccessTokenPayload;
    try {
      payload = (await req.jwtVerify()) as unknown as AccessTokenPayload;
    } catch {
      throw unauthorized('A valid access token is required');
    }
    if (payload.type !== 'access') throw unauthorized('Wrong token type');

    // Read the user on every request so a deactivation or role change takes effect
    // immediately rather than at the next token refresh.
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true, role: true, isActive: true },
    });
    if (!user) throw unauthorized('Account no longer exists');
    if (!user.isActive) throw forbidden('This account has been deactivated');

    req.user = user as AuthUser;
  });

  app.decorate('requirePermission', function requirePermission(...permissions: Permission[]) {
    return async function check(req: FastifyRequest, reply: FastifyReply) {
      if (!req.user) await app.authenticate(req, reply);
      const user = req.user;
      if (!user) throw unauthorized();
      const allowed = permissions.some((p) => can(user.role, p));
      if (!allowed) {
        throw forbidden(`This action requires one of: ${permissions.join(', ')}`);
      }
    };
  });
});

/** Restrict a lead query to what the current user is allowed to see. */
export function leadVisibilityFilter(user: AuthUser): { assignedToId?: string } {
  return isRestrictedToAssigned(user.role) ? { assignedToId: user.id } : {};
}

/** Throw unless the user may act on this specific lead. */
export async function assertLeadAccess(user: AuthUser, leadId: string): Promise<void> {
  if (!isRestrictedToAssigned(user.role)) return;
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { assignedToId: true } });
  if (!lead || lead.assignedToId !== user.id) {
    throw forbidden('This lead is not assigned to you');
  }
}
