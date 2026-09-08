/**
 * Database seed.
 *
 * Creates the service catalogue, the provider registry rows and the first administrator.
 * Run with: npm run db:seed
 */
import 'dotenv/config';
import { seedAdminUser, seedServices } from '../src/bootstrap';
import { prisma } from '../src/lib/prisma';
import { disconnectRedis } from '../src/lib/redis';
import { syncProviders } from '../src/providers/registry';

async function main() {
  const services = await seedServices();
  console.log(`✓ services: ${services} created (existing ones left untouched)`);

  await syncProviders();
  const providers = await prisma.provider.count();
  console.log(`✓ providers registered: ${providers}`);

  const admin = await seedAdminUser();
  if (admin.created) {
    console.log(`✓ administrator created: ${admin.email}`);
    console.log('  ⚠ change this password immediately — it comes from SEED_ADMIN_PASSWORD');
  } else {
    console.log('• users already exist, no administrator created');
  }
}

main()
  .catch((err) => {
    console.error('seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    // Both the database client and the Redis client hold the event loop open.
    await prisma.$disconnect();
    await disconnectRedis();
  });
