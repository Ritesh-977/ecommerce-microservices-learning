export interface AppConfig {
  host: string;
  port: number;
  logLevel: string;
  databaseUrl: string;
}

function parsePort(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid port: ${raw}`);
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = env.CATALOG_DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.trim() === '') {
    throw new Error('CATALOG_DATABASE_URL is required');
  }

  return {
    host: env.CATALOG_HOST ?? '0.0.0.0',
    port: parsePort(env.CATALOG_PORT, 3001),
    logLevel: env.LOG_LEVEL ?? 'info',
    databaseUrl,
  };
}
