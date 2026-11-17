import pg from 'pg';
import { buildApp } from './app.js';
import { HttpCatalogClient } from './clients/catalog-client.js';
import { loadConfig } from './config.js';
import { PgCartRepository } from './repositories/pg-cart-repository.js';

const { Pool } = pg;

const config = loadConfig();
const pool = new Pool({ connectionString: config.databaseUrl });
const repository = new PgCartRepository(pool);
const catalogClient = new HttpCatalogClient(config.catalogBaseUrl);
const app = buildApp({
  repository,
  catalogClient,
  logger: { level: config.logLevel },
});

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await pool.end();
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
  app.log.error(error, 'failed to start cart service');
  await pool.end();
  process.exit(1);
}
