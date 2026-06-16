import { Pool, PoolClient, types } from 'pg';
import { config } from '../config';
import { logger } from '../utils/logger';

// Postgres NUMERIC defaults to string in pg-node (preserves arbitrary precision).
// Our domain only stores money up to ~$10000, well inside JS Number range,
// so we parse NUMERIC as float for ergonomic frontend display.
types.setTypeParser(types.builtins.NUMERIC, (val) => parseFloat(val));

const usingDatabaseUrl = !!process.env.DATABASE_URL;
logger.info('Postgres pool init', {
  using_database_url: usingDatabaseUrl,
  host: usingDatabaseUrl ? '(from DATABASE_URL)' : config.db.host,
});

export const pool = usingDatabaseUrl
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })
  : new Pool(config.db);

pool.on('error', (err) => logger.error('Unexpected pg pool error', {
  error: err.message,
  stack: err.stack,
  code: (err as Error & { code?: string }).code,
}));

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function query<T extends Record<string, unknown>>(
  text: string,
  values?: unknown[]
): Promise<T[]> {
  const start = Date.now();
  const res = await pool.query<T>(text, values);
  logger.debug('Query executed', { sql: text.slice(0, 80), duration_ms: Date.now() - start, rows: res.rowCount });
  return res.rows;
}
