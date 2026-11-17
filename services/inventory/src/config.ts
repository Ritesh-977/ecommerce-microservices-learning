export interface AppConfig {
  host: string;
  port: number;
  logLevel: string;
  databaseUrl: string;
  expiryIntervalMs: number;
}

function parseInteger(
  raw: string | undefined,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `Invalid ${name}: ${raw} (expected integer ${minimum}..${maximum})`,
    );
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = env.INVENTORY_DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.trim() === '') {
    throw new Error('INVENTORY_DATABASE_URL is required');
  }

  return {
    host: env.INVENTORY_HOST ?? '0.0.0.0',
    port: parseInteger(env.INVENTORY_PORT, 3003, 'INVENTORY_PORT', 1, 65535),
    logLevel: env.LOG_LEVEL ?? 'info',
    databaseUrl,
    expiryIntervalMs: parseInteger(
      env.INVENTORY_EXPIRY_INTERVAL_MS,
      5000,
      'INVENTORY_EXPIRY_INTERVAL_MS',
      100,
      3_600_000,
    ),
  };
}
