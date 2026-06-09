import Stripe from 'stripe';
import { config } from '../../config';
import { withTransaction, query } from '../../db';
import { redis, KEYS } from '../../redis/client';
import { bookingService } from '../booking/bookingService';
import { paymentSuccessTotal, paymentFailureTotal } from '../../utils/metrics';
import { paymentLogger } from '../../utils/logger';

const stripe = new Stripe(config.stripe.secretKey, { apiVersion: '2023-10-16' });

export class PaymentService {

  async createPaymentIntent(bookingId: string, userId: string): Promise<{ clientSecret: string; amount: number }> {
    const bookings = await query<{ amount_paid: number; status: string; user_id: string }>(
      `SELECT amount_paid, status, user_id FROM bookings WHERE id = $1`,
      [bookingId]
    );
    if (!bookings.length) throw new Error('Booking not found');
    const booking = bookings[0];
    if (booking.user_id !== userId) throw new Error('Forbidden');
    if (booking.status !== 'pending') throw new Error(`Booking status is ${booking.status}`);

    const intent = await stripe.paymentIntents.create({
      amount: Math.round(booking.amount_paid * 100),
      currency: 'usd',
      metadata: { bookingId, userId },
      automatic_payment_methods: { enabled: true },
    });

    // Store intent ID immediately so reconciliation worker can detect stuck pending bookings
    await query(
      `UPDATE bookings SET stripe_payment_intent_id = $1 WHERE id = $2`,
      [intent.id, bookingId]
    );

    paymentLogger.info('Payment intent created', { booking_id: bookingId, amount: booking.amount_paid });
    return { clientSecret: intent.client_secret!, amount: booking.amount_paid };
  }

  async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, config.stripe.webhookSecret);
    } catch {
      throw new Error('Webhook signature verification failed');
    }

    paymentLogger.info('Stripe webhook received', { type: event.type });

    switch (event.type) {
      case 'payment_intent.succeeded':
        await this._handlePaymentSuccess(event.data.object as Stripe.PaymentIntent);
        break;
      case 'payment_intent.payment_failed':
        await this._handlePaymentFailure(event.data.object as Stripe.PaymentIntent);
        break;
    }
  }

  private async _handlePaymentSuccess(intent: Stripe.PaymentIntent): Promise<void> {
    const { bookingId, userId } = intent.metadata;
    await bookingService.confirmBooking(bookingId, intent.id);
    paymentSuccessTotal.inc();

    paymentLogger.info('Payment confirmed', { booking_id: bookingId, user_id: userId });
  }

  private async _handlePaymentFailure(intent: Stripe.PaymentIntent): Promise<void> {
    const { bookingId, userId } = intent.metadata;
    paymentLogger.warn('Payment failed — releasing seat', { booking_id: bookingId });
    paymentFailureTotal.inc();

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
