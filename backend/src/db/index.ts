import { Pool, PoolClient } from 'pg';
import { config } from '../config';
import { logger } from '../utils/logger';

export const pool = new Pool(config.db);

pool.on('error', (err) => logger.error('Unexpected pg pool error', { error: err.message }));

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
