import pg from 'pg';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { PgInventoryRepository } from './repositories/pg-inventory-repository.js';

const { Pool } = pg;

const config = loadConfig();
const pool = new Pool({ connectionString: config.databaseUrl });
const repository = new PgInventoryRepository(pool);
const app = buildApp({
  repository,
  logger: { level: config.logLevel },
});

let expiryTimer: NodeJS.Timeout | undefined;
let sweeping = false;

function startExpirySweeper(): void {
  expiryTimer = setInterval(() => {
    if (sweeping) {
      return;
    }
    sweeping = true;
    void repository
      .expireReservations()
      .then((count) => {
        if (count > 0) {
          app.log.info({ count }, 'expired reservations');
        }
      })
      .catch((error: unknown) => {
        app.log.error({ err: error }, 'failed to expire reservations');
      })
      .finally(() => {
        sweeping = false;
      });
  }, config.expiryIntervalMs);
  expiryTimer.unref();
  app.log.info(
    { intervalMs: config.expiryIntervalMs },
    'reservation expiry sweeper started',
  );
}

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  if (expiryTimer !== undefined) {
    clearInterval(expiryTimer);
    expiryTimer = undefined;
  }
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
  startExpirySweeper();
} catch (error) {
  app.log.error(error, 'failed to start inventory service');
  await pool.end();
  process.exit(1);
}
