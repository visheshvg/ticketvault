import { PoolClient } from 'pg';
import { pool, withTransaction } from '../../db';
import { kafkaProducer } from '../../kafka/producer';
import { workerLogger } from '../../utils/logger';
import { config } from '../../config';

// Outbox processor polls for unpublished events and publishes them to Kafka.
// This guarantees at-least-once delivery: if the server crashes after writing
// to the outbox but before publishing, the next poll will catch the row.
// Kafka consumers must be idempotent (dedup on event.id).

const BATCH_SIZE = 50;
const POLL_INTERVAL_MS = 2000;

export class OutboxProcessor {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private processing = false;

  start(): void {
    workerLogger.info('Outbox processor started', { interval_ms: POLL_INTERVAL_MS });
    this.processOutbox();
    this.intervalId = setInterval(() => this.processOutbox(), POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      workerLogger.info('Outbox processor stopped');
    }
  }

  async processOutbox(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      // Advisory lock prevents two outbox workers from racing on the same rows
      const client = await pool.connect();
      try {
        await client.query('SELECT pg_advisory_xact_lock(12345)');
        await client.query('BEGIN');

        const rows = await client.query<{
          id: string;
          aggregate_id: string;
          event_type: string;
          payload: Record<string, unknown>;
        }>(
          `SELECT id, aggregate_id, event_type, payload
           FROM outbox_events
           WHERE published = false
           ORDER BY created_at ASC
           LIMIT $1
           FOR UPDATE SKIP LOCKED`,
          [BATCH_SIZE]
        );

        if (!rows.rows.length) {
          await client.query('ROLLBACK');
          return;
        }

        const topic = 'booking-events';
        let published = 0;

        for (const row of rows.rows) {
          try {
            await kafkaProducer.publish(topic, {
              id: row.id,
              event_type: row.event_type,
              aggregate_id: row.aggregate_id,
              ...row.payload,
            });

            await client.query(
              `UPDATE outbox_events SET published = true, published_at = now() WHERE id = $1`,
              [row.id]
            );
            published++;
          } catch (err) {
            workerLogger.error('Failed to publish outbox event', {
              event_id: row.id,
              event_type: row.event_type,
              error: (err as Error).message,
            });
            // Leave unpublished — will retry next poll
          }
        }

        await client.query('COMMIT');
        if (published > 0) {
          workerLogger.info('Outbox batch published', { count: published });
        }
      } finally {
        client.release();
      }
    } catch (err) {
      workerLogger.error('Outbox processor error', { error: (err as Error).message });
    } finally {
      this.processing = false;
    }
  }
}

// Helper: write an event to the outbox inside an existing transaction.
// Call this from any service's withTransaction block alongside state changes.
export async function writeToOutbox(
  client: PoolClient,
  aggregateId: string,
  eventType: string,
  payload: Record<string, unknown>
): Promise<void> {
  await client.query(
    `INSERT INTO outbox_events (aggregate_id, event_type, payload)
     VALUES ($1, $2, $3)`,
    [aggregateId, eventType, JSON.stringify(payload)]
  );
}

export const outboxProcessor = new OutboxProcessor();
