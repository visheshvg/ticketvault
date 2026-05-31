import { query, pool } from '../../db';
import { redis, KEYS } from '../../redis/client';
import { workerLogger } from '../../utils/logger';
import { reconciliationIssues } from '../../utils/metrics';

// Reconciliation worker runs periodically and checks for drift between:
// 1. Seat status vs booking status (a confirmed booking should mean a booked seat)
// 2. Redis inventory vs live seat count (cache should match reality)
// 3. Pending bookings that expired but whose seats were not released
// 4. Payments confirmed in Stripe but booking still showing pending
//
// Any mismatch is written to reconciliation_issues for ops visibility and alerting.
// The worker self-heals where safe to do so (e.g. releasing stale reservations).

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export class ReconciliationWorker {
  private intervalId: ReturnType<typeof setInterval> | null = null;

  start(): void {
    workerLogger.info('Reconciliation worker started', { interval_ms: INTERVAL_MS });
    this.runAll();
    this.intervalId = setInterval(() => this.runAll(), INTERVAL_MS);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async runAll(): Promise<void> {
    await Promise.allSettled([
      this.checkSeatBookingDrift(),
      this.checkRedisInventoryDrift(),
      this.checkStaleReservations(),
      this.checkConfirmedPaymentsWithPendingBookings(),
    ]);
  }

  // Check 1: Seats marked 'booked' but no confirmed booking exists for them
  private async checkSeatBookingDrift(): Promise<void> {
    try {
      const drifted = await query<{ seat_id: string; event_id: string }>(
        `SELECT s.id AS seat_id, s.event_id
         FROM seats s
         WHERE s.status = 'booked'
           AND NOT EXISTS (
             SELECT 1 FROM bookings b
             WHERE b.seat_id = s.id AND b.status = 'confirmed'
           )`
      );

      for (const row of drifted) {
        await this._logIssue(
          'seat_booking_drift',
          row.seat_id,
          `Seat ${row.seat_id} is 'booked' but has no confirmed booking`
        );
      }

      if (drifted.length) {
        workerLogger.warn('Seat/booking drift detected', { count: drifted.length });
      }
    } catch (err) {
      workerLogger.error('checkSeatBookingDrift failed', { error: (err as Error).message });
    }
  }

  // Check 2: Redis inventory count differs from live seat count
  private async checkRedisInventoryDrift(): Promise<void> {
    try {
      const events = await query<{ id: string; name: string }>(
        `SELECT id, name FROM events WHERE status = 'published'`
      );

      for (const event of events) {
        const redisCountStr = await redis.get(KEYS.seatInventory(event.id));
        if (redisCountStr === null) continue; // Not cached yet, skip

        const redisCount = parseInt(redisCountStr, 10);
        const pgRows = await query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM seats WHERE event_id = $1 AND status = 'available'`,
          [event.id]
        );
        const pgCount = parseInt(pgRows[0].count, 10);

        const drift = Math.abs(redisCount - pgCount);
        if (drift > 2) {
          // Tolerance of 2 — tiny transient drift during concurrent writes is expected
          await this._logIssue(
            'redis_inventory_drift',
            event.id,
            `Redis inventory=${redisCount} vs PG count=${pgCount} for event ${event.name} (drift=${drift})`
          );
          reconciliationIssues.labels('redis_inventory_drift').inc();

          // Self-heal: reset Redis to authoritative PG count
          await redis.set(KEYS.seatInventory(event.id), pgCount.toString());
          workerLogger.warn('Redis inventory corrected', { event_id: event.id, was: redisCount, corrected_to: pgCount });
        }
      }
    } catch (err) {
      workerLogger.error('checkRedisInventoryDrift failed', { error: (err as Error).message });
    }
  }

  // Check 3: Reserved seats whose booking expired but seat wasn't released
  // (should be caught by expiry worker, but this is the safety net)
  private async checkStaleReservations(): Promise<void> {
    try {
      const stale = await query<{ id: string; seat_id: string; event_id: string }>(
        `SELECT b.id, b.seat_id, b.event_id
         FROM bookings b
         JOIN seats s ON b.seat_id = s.id
         WHERE b.expires_at < now() - interval '5 minutes'
           AND b.status = 'pending'
           AND s.status = 'reserved'`
      );

      for (const row of stale) {
        await this._logIssue(
          'stale_reservation',
          row.id,
          `Booking ${row.id} expired >5 min ago but seat ${row.seat_id} is still reserved`
        );

        // Self-heal: force expiry
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(`UPDATE bookings SET status = 'expired' WHERE id = $1 AND status = 'pending'`, [row.id]);
          await client.query(`UPDATE seats SET status = 'available', reserved_until = NULL WHERE id = $1`, [row.seat_id]);
          await client.query(
            `INSERT INTO booking_audit_log (booking_id, old_status, new_status, reason, actor)
             VALUES ($1, 'pending', 'expired', 'stale_reservation_cleanup', 'reconciliation_worker')`,
            [row.id]
          );
          await client.query('COMMIT');
          await redis.incr(KEYS.seatInventory(row.event_id));
          workerLogger.info('Stale reservation self-healed', { booking_id: row.id });
        } catch (healErr) {
          await client.query('ROLLBACK');
          workerLogger.error('Failed to self-heal stale reservation', { booking_id: row.id, error: (healErr as Error).message });
        } finally {
          client.release();
        }
      }
    } catch (err) {
      workerLogger.error('checkStaleReservations failed', { error: (err as Error).message });
    }
  }

  // Check 4: Bookings with a Stripe payment intent ID but still status='pending'
  private async checkConfirmedPaymentsWithPendingBookings(): Promise<void> {
    try {
      const suspicious = await query<{ id: string; stripe_payment_intent_id: string }>(
        `SELECT id, stripe_payment_intent_id
         FROM bookings
         WHERE status = 'pending'
           AND stripe_payment_intent_id IS NOT NULL
           AND created_at < now() - interval '30 minutes'`
      );

      for (const row of suspicious) {
        await this._logIssue(
          'payment_intent_with_pending_booking',
          row.id,
          `Booking ${row.id} has stripe_payment_intent_id=${row.stripe_payment_intent_id} but is still pending >30min`
        );
        reconciliationIssues.labels('payment_intent_with_pending_booking').inc();
      }
    } catch (err) {
      workerLogger.error('checkConfirmedPaymentsWithPendingBookings failed', { error: (err as Error).message });
    }
  }

  private async _logIssue(issueType: string, entityId: string, description: string): Promise<void> {
    try {
      // Deduplicate: don't re-insert the same unresolved issue
      const existing = await query<{ id: string }>(
        `SELECT id FROM reconciliation_issues
         WHERE issue_type = $1 AND entity_id = $2 AND resolved = false`,
        [issueType, entityId]
      );
      if (existing.length) return;

      await pool.query(
        `INSERT INTO reconciliation_issues (issue_type, entity_id, description)
         VALUES ($1, $2, $3)`,
        [issueType, entityId, description]
      );
      workerLogger.warn('Reconciliation issue logged', { issue_type: issueType, entity_id: entityId });
    } catch (err) {
      workerLogger.error('Failed to log reconciliation issue', { error: (err as Error).message });
    }
  }
}

export const reconciliationWorker = new ReconciliationWorker();
