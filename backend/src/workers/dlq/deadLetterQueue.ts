import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import { pool } from '../../db';
import { workerLogger } from '../../utils/logger';
import { config } from '../../config';
import { dlqDepth } from '../../utils/metrics';

const connection = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
};

const MAX_ATTEMPTS = 5;

// Exponential backoff: 5s, 25s, 125s, 625s, 3125s
function backoffMs(attempt: number): number {
  return Math.min(5000 * Math.pow(5, attempt - 1), 3_600_000);
}

// All retriable queues — each has its own retry config but shares the DLQ sink
export function createRetryableQueue(name: string) {
  return new Queue(name, {
    connection,
    defaultJobOptions: {
      attempts: MAX_ATTEMPTS,
      backoff: { type: 'custom' },
      removeOnComplete: { count: 1000 },
      removeOnFail: false, // Keep in Bull failed set for inspection
    },
  });
}

// When a job exhausts retries, move it to the dead_letter_events PG table
// for ops inspection and manual replay. BullMQ's failed jobs are also kept.
export async function handleDeadLetter(job: Job, err: Error, source: string): Promise<void> {
  workerLogger.error('Job moved to dead-letter queue', {
    queue: source,
    job_id: job.id,
    job_name: job.name,
    attempts: job.attemptsMade,
    error: err.message,
  });

  try {
    await pool.query(
      `INSERT INTO dead_letter_events (source, event_type, payload, error, attempts)
       VALUES ($1, $2, $3, $4, $5)`,
      [source, job.name, JSON.stringify(job.data), err.message, job.attemptsMade]
    );
    dlqDepth.labels(source).inc();
  } catch (pgErr) {
    workerLogger.error('Failed to write to dead_letter_events', { error: (pgErr as Error).message });
  }
}

// Replay a dead-letter event by re-enqueuing it
export async function replayDeadLetter(deadLetterId: string, targetQueue: Queue): Promise<void> {
  const rows = await pool.query<{ event_type: string; payload: Record<string, unknown> }>(
    `SELECT event_type, payload FROM dead_letter_events WHERE id = $1`,
    [deadLetterId]
  );
  if (!rows.rows.length) throw new Error('Dead-letter event not found');

  const { event_type, payload } = rows.rows[0];
  await targetQueue.add(event_type, payload);
  await pool.query(
    `DELETE FROM dead_letter_events WHERE id = $1`,
    [deadLetterId]
  );
  workerLogger.info('Dead-letter event replayed', { id: deadLetterId, event_type });
}

export { backoffMs, MAX_ATTEMPTS };
