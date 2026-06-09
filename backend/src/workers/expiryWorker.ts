import { withTransaction, query } from '../db';
import { redis, KEYS } from '../redis/client';
import { config } from '../config';
import { workerLogger } from '../utils/logger';
import { bookingService } from '../services/booking/bookingService';

export class ExpiryWorker {
  private intervalId: ReturnType<typeof setInterval> | null = null;

  start(): void {
    workerLogger.info('Expiry worker started', { interval_ms: config.reservation.workerIntervalMs });
    this.processExpiredReservations();
    this.intervalId = setInterval(() => this.processExpiredReservations(), config.reservation.workerIntervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      workerLogger.info('Expiry worker stopped');
    }
  }

  async processExpiredReservations(): Promise<void> {
    try {
      const expired = await query<{ id: string; seat_id: string; event_id: string; user_id: string }>(
        `SELECT id, seat_id, event_id, user_id FROM bookings
         WHERE status = 'pending' AND expires_at < now()
         LIMIT 100`
      );

      if (!expired.length) return;

      workerLogger.info('Processing expired reservations', { count: expired.length });

      for (const booking of expired) {
        await this._expireSingleBooking(booking);
      }
    } catch (err) {
      workerLogger.error('Expiry worker scan failed', { error: (err as Error).message });
    }
  }

  private async _expireSingleBooking(booking: {
    id: string; seat_id: string; event_id: string; user_id: string;
  }): Promise<void> {
    try {
      await withTransaction(async (client) => {
        // Re-check status under lock to avoid racing with a concurrent payment webhook
        const check = await client.query(
          `SELECT status FROM bookings WHERE id = $1 FOR UPDATE`,
          [booking.id]
        );
        if (!check.rows.length || check.rows[0].status !== 'pending') return;

        await client.query(`UPDATE bookings SET status = 'expired' WHERE id = $1`, [booking.id]);
        await client.query(
          `UPDATE seats SET status = 'available', reserved_until = NULL WHERE id = $1`,
          [booking.seat_id]
        );
        await client.query(
          `INSERT INTO booking_audit_log (booking_id, old_status, new_status, reason)
           VALUES ($1, 'pending', 'expired', 'reservation_ttl_exceeded')`,
          [booking.id]
        );
      });

      await bookingService.offerSeatToNextWaiter(booking.event_id, booking.seat_id);

      await redis.del(KEYS.reservation(booking.id));

      workerLogger.info('Booking expired, seat released', { booking_id: booking.id });
    } catch (err) {
      workerLogger.error('Failed to expire booking', { booking_id: booking.id, error: (err as Error).message });
    }
  }
}

export const expiryWorker = new ExpiryWorker();
