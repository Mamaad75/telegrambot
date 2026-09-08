import { PrismaClient } from '@prisma/client';
import { loadEnv } from '../config/env';

const globalRef = globalThis as unknown as { __baimarPrisma?: PrismaClient };

export const prisma =
  globalRef.__baimarPrisma ??
  new PrismaClient({
    log: loadEnv().NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (loadEnv().NODE_ENV !== 'production') globalRef.__baimarPrisma = prisma;

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}

/** JSON-safe conversion: Prisma returns BigInt for cost columns, JSON.stringify cannot. */
export function jsonSafe<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)),
  ) as T;
}
