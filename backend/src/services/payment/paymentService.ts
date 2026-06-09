import { v4 as uuidv4 } from 'uuid';
import { withTransaction, query } from '../../db';
import { redis, KEYS } from '../../redis/client';
import { bookingService } from '../booking/bookingService';
import { paymentSuccessTotal, paymentFailureTotal } from '../../utils/metrics';
import { paymentLogger } from '../../utils/logger';

// Simulated payment service used for the public demo.
// In a production build this would call Stripe / Razorpay / Adyen — same
// internal effects, but triggered by webhooks instead of a direct API call.

export class PaymentService {

  async initiatePayment(bookingId: string, userId: string): Promise<{ paymentId: string; amount: number }> {
    const bookings = await query<{ amount_paid: number; status: string; user_id: string }>(
      `SELECT amount_paid, status, user_id FROM bookings WHERE id = $1`,
      [bookingId]
    );
    if (!bookings.length) throw new Error('Booking not found');
    const booking = bookings[0];
    if (booking.user_id !== userId) throw new Error('Forbidden');
    if (booking.status !== 'pending') throw new Error(`Booking status is ${booking.status}`);

    const paymentId = `sim_${uuidv4()}`;
    await query(
      `UPDATE bookings SET stripe_payment_intent_id = $1 WHERE id = $2`,
      [paymentId, bookingId]
    );

    paymentLogger.info('Payment initiated', { booking_id: bookingId, payment_id: paymentId });
    return { paymentId, amount: booking.amount_paid };
  }

  async simulatePayment(bookingId: string, userId: string, success: boolean): Promise<void> {
    const bookings = await query<{ stripe_payment_intent_id: string | null; user_id: string }>(
      `SELECT stripe_payment_intent_id, user_id FROM bookings WHERE id = $1`,
      [bookingId]
    );
    if (!bookings.length) throw new Error('Booking not found');
    if (bookings[0].user_id !== userId) throw new Error('Forbidden');

    const paymentId = bookings[0].stripe_payment_intent_id ?? `sim_${uuidv4()}`;

    if (success) {
      await bookingService.confirmBooking(bookingId, paymentId);
      paymentSuccessTotal.inc();
      paymentLogger.info('Payment confirmed (simulated)', { booking_id: bookingId, user_id: userId });
      return;
    }

    paymentFailureTotal.inc();
    paymentLogger.warn('Payment failed (simulated) — releasing seat', { booking_id: bookingId });

    let eventId: string | null = null;
    let seatId: string | null = null;

    try {
      await withTransaction(async (client) => {
        const result = await client.query<{ seat_id: string; event_id: string }>(
          `UPDATE bookings SET status = 'compensated'
            WHERE id = $1 AND status = 'pending'
            RETURNING seat_id, event_id`,
          [bookingId]
        );
        if (!result.rows.length) return;

        seatId = result.rows[0].seat_id;
        eventId = result.rows[0].event_id;

        await client.query(
          `UPDATE seats SET status = 'available', reserved_until = NULL WHERE id = $1`,
          [seatId]
        );

        await client.query(
          `INSERT INTO booking_audit_log (booking_id, old_status, new_status, reason)
           VALUES ($1, 'pending', 'compensated', 'payment_failed')`,
          [bookingId]
        );
      });

      if (eventId && seatId) {
        await bookingService.offerSeatToNextWaiter(eventId, seatId);
      }

      await redis.del(KEYS.reservation(bookingId));
      paymentLogger.info('Payment compensated', { booking_id: bookingId, user_id: userId });
    } catch (err) {
      paymentLogger.error('Payment compensation failed', { booking_id: bookingId, error: (err as Error).message });
      throw err;
    }
  }
}

export const paymentService = new PaymentService();
