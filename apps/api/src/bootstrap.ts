import { DEFAULT_SERVICES } from '@baimar/shared';
import type { Prisma } from '@prisma/client';
import { loadEnv } from './config/env';
import { hashPassword } from './lib/crypto';
import { prisma } from './lib/prisma';

/**
 * First-boot bootstrap.
 *
 * Idempotent: it creates the service catalogue and the initial administrator only when
 * they are missing, so it is safe to run on every start and inside the Docker entrypoint.
 */

export async function seedServices(): Promise<number> {
  let created = 0;
  for (const seed of DEFAULT_SERVICES) {
    const existing = await prisma.service.findUnique({ where: { key: seed.key } });
    if (existing) continue;
    await prisma.service.create({
      data: {
        key: seed.key,
        nameFa: seed.nameFa,
        nameEn: seed.nameEn,
        descriptionFa: seed.descriptionFa,
        basePriority: seed.basePriority,
        rules: seed.rules as unknown as Prisma.InputJsonValue,
        salesAngles: seed.salesAnglesFa,
        commonObjections: seed.commonObjectionsFa,
        objectionResponses: seed.objectionResponsesFa,
        discoveryQuestions: seed.discoveryQuestionsFa,
      },
    });
    created++;
  }
  return created;
}

export async function seedAdminUser(): Promise<{ created: boolean; email: string }> {
  const env = loadEnv();
  const email = env.SEED_ADMIN_EMAIL.trim().toLowerCase();

  const anyUser = await prisma.user.count();
  if (anyUser > 0) return { created: false, email };

  await prisma.user.create({
    data: {
      email,
      name: env.SEED_ADMIN_NAME,
      role: 'ADMIN',
      passwordHash: await hashPassword(env.SEED_ADMIN_PASSWORD),
    },
  });
  return { created: true, email };
}

/** Called at API start-up: makes an empty database usable without a manual seed step. */
export async function seedDefaultsIfEmpty(): Promise<void> {
  await seedServices();
  const admin = await seedAdminUser();
  if (admin.created) {
    // eslint-disable-next-line no-console
    console.log(
      `[bootstrap] created the initial administrator "${admin.email}". Change the password immediately (Settings → Users).`,
    );
  }
}
