import Stripe from 'stripe';
import { config } from '../../config';
import { withTransaction, query } from '../../db';
import { redis, KEYS } from '../../redis/client';
import { bookingService } from '../booking/bookingService';
import { sagaCompensations, paymentSuccessTotal, paymentFailureTotal } from '../../utils/metrics';
import { paymentLogger } from '../../utils/logger';
import { notificationQueue } from '../../workers/queues';

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

    await notificationQueue.add('payment-success', {
      type: 'PAYMENT_CONFIRMED',
      userId,
      bookingId,
      amount: intent.amount / 100,
    });

    paymentLogger.info('Payment confirmed', { booking_id: bookingId });
  }

  private async _handlePaymentFailure(intent: Stripe.PaymentIntent): Promise<void> {
    const { bookingId, userId } = intent.metadata;
    paymentLogger.warn('Payment failed — triggering saga compensation', { booking_id: bookingId });
    paymentFailureTotal.inc();
    await this._compensateSaga(bookingId, userId, 'payment_failed');
    sagaCompensations.inc({ reason: 'payment_failed' });
  }

  private async _compensateSaga(bookingId: string, userId: string, reason: string): Promise<void> {
    const stepsCompleted = ['booking_created', 'payment_attempted'];
    const stepsCompensated: string[] = [];
    let eventId: string | null = null;

    try {
      await withTransaction(async (client) => {
        await client.query(`UPDATE bookings SET status = 'compensated' WHERE id = $1`, [bookingId]);
        stepsCompensated.push('booking_cancelled');

        const seatResult = await client.query<{ event_id: string }>(
          `UPDATE seats SET status = 'available', reserved_until = NULL
           WHERE id = (SELECT seat_id FROM bookings WHERE id = $1)
           RETURNING event_id`,
          [bookingId]
        );
        stepsCompensated.push('seat_released');
        eventId = seatResult.rows[0]?.event_id ?? null;

        await client.query(
          `INSERT INTO booking_audit_log (booking_id, old_status, new_status, reason)
           VALUES ($1, 'pending', 'compensated', $2)`,
          [bookingId, reason]
        );

        await client.query(
          `INSERT INTO saga_compensations (booking_id, reason, steps_completed, steps_compensated)
           VALUES ($1, $2, $3, $4)`,
          [bookingId, reason, JSON.stringify(stepsCompleted), JSON.stringify(stepsCompensated)]
        );
      });

      if (eventId) {
        const seatRows = await query<{ seat_id: string }>(
          `SELECT seat_id FROM bookings WHERE id = $1`,
          [bookingId]
        );
        if (seatRows.length) {
          await bookingService.offerSeatToNextWaiter(eventId, seatRows[0].seat_id);
        }
      }

      await redis.del(KEYS.reservation(bookingId));

      await notificationQueue.add('compensation-notify', {
        type: 'BOOKING_COMPENSATED',
        userId,
        bookingId,
        reason,
      });

      paymentLogger.info('Saga compensated', { booking_id: bookingId, steps: stepsCompensated });
    } catch (err) {
      paymentLogger.error('Saga compensation FAILED', { booking_id: bookingId, error: (err as Error).message });
      throw err;
    }
  }
}

export const paymentService = new PaymentService();
