import { query } from '../db';
import { redis, KEYS } from '../redis/client';
import { withLock } from '../redis/scripts';
import { workerLogger } from '../utils/logger';

const INTERVAL_MS = 5 * 60_000;
const LOCK_TTL_SECONDS = 60;

// The Redis seat counter can drift from Postgres, e.g. if the process crashes
// between the Redis decrement and the Postgres commit. A counter that is too low
// makes seats look sold out when they aren't. This job puts it back in line.
export class InventoryReconciler {
  private intervalId: ReturnType<typeof setInterval> | null = null;

  start(): void {
    workerLogger.info('Inventory reconciler started', { interval_ms: INTERVAL_MS });
    this.intervalId = setInterval(() => this.reconcile(), INTERVAL_MS);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async reconcile(): Promise<void> {
    try {
      await withLock(KEYS.workerLock('reconciler'), LOCK_TTL_SECONDS, async () => {
        const events = await query<{ id: string; available: string }>(
          `SELECT e.id, COUNT(s.id) FILTER (WHERE s.status = 'available') AS available
           FROM events e
           LEFT JOIN seats s ON s.event_id = e.id
           WHERE e.status = 'published' AND e.ends_at > now()
           GROUP BY e.id`
        );

        for (const event of events) {
          const actual = parseInt(event.available, 10);
          const raw = await redis.get(KEYS.seatInventory(event.id));
          const mismatchKey = KEYS.inventoryMismatch(event.id);

          if (raw === null || parseInt(raw, 10) === actual) {
            await redis.del(mismatchKey);
            continue;
          }

          // A booking in flight can cause a brief mismatch, so only fix one
          // that is still there, unchanged, on the next run
          if (await redis.get(mismatchKey) === actual.toString()) {
            await redis.set(KEYS.seatInventory(event.id), actual.toString());
            await redis.del(mismatchKey);
            workerLogger.warn('Seat counter corrected', { event_id: event.id, redis: raw, postgres: actual });
          } else {
            await redis.setex(mismatchKey, (2 * INTERVAL_MS) / 1000, actual.toString());
          }
        }
      });
    } catch (err) {
      workerLogger.error('Inventory reconciliation failed', { error: (err as Error).message });
    }
  }
}

export const inventoryReconciler = new InventoryReconciler();
