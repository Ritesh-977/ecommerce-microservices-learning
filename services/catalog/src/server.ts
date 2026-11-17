import { PrismaClient } from '@prisma/client';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { PrismaProductRepository } from './repositories/prisma-product-repository.js';

const config = loadConfig();
const prisma = new PrismaClient();
const repository = new PrismaProductRepository(prisma);
const app = buildApp({
  repository,
  logger: { level: config.logLevel },
});

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await prisma.$disconnect();
}

process.on('SIGINT', () => {
  void shutdown('SIGINT').then(() => process.exit(0));
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM').then(() => process.exit(0));
});

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error, 'failed to start catalog service');
  await prisma.$disconnect();
  process.exit(1);
}
