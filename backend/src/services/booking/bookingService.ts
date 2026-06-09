import { PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { withTransaction, query } from '../../db';
import { redis, KEYS } from '../../redis/client';
import { atomicDecrement, releaseAndNotify, claimIdempotencyKey } from '../../redis/scripts';
import { config } from '../../config';
import { Booking, BookingResponse, CreateBookingRequest, Seat } from '../../types';
import { bookingLogger } from '../../utils/logger';
import {
  bookingTotal, bookingDuration, queueDepth, redisLuaConflicts, idempotencyHits,
} from '../../utils/metrics';
import { eventService } from '../event/eventService';
import { notificationQueue } from '../../workers/queues';
import { broadcastSeatUpdate, broadcastInventoryUpdate } from '../websocket/wsService';

const IDEMPOTENCY_PROCESSING_TTL = 30;

export class BookingService {

  async createBooking(
    userId: string,
    data: CreateBookingRequest,
    idempotencyKey: string
  ): Promise<BookingResponse> {
    const timer = bookingDuration.startTimer({ stage: 'total' });
    const idemKey = KEYS.idempotency(idempotencyKey);

    const claimed = await claimIdempotencyKey(idemKey, IDEMPOTENCY_PROCESSING_TTL);
    if (!claimed) {
      const cached = await this._waitForIdempotentResponse(idemKey);
      if (cached) {
        idempotencyHits.inc();
        timer();
        return cached;
      }
    }

    const event = await eventService.getEventById(data.event_id);
    if (!event) throw new Error('Event not found');
    if (event.status !== 'published') throw new Error('Event is not accepting bookings');

    const amount = eventService.calculatePrice(event.base_price, event.available_seats, event.total_seats);
    const inventoryKey = KEYS.seatInventory(data.event_id);

    const t2 = bookingDuration.startTimer({ stage: 'redis_decr' });
    const remaining = await atomicDecrement(inventoryKey);
    t2();

    if (remaining === -1) {
      redisLuaConflicts.inc();
      const queueKey = KEYS.waitingQueue(data.event_id);
      const position = await redis.lpush(
        queueKey,
        JSON.stringify({ userId, seatId: data.seat_id, timestamp: Date.now() })
      );
      queueDepth.labels(data.event_id).set(position);
      bookingTotal.inc({ status: 'queued' });

      const response: BookingResponse = {
        booking_id: '',
        status: 'queued',
        seat: { id: data.seat_id, seat_number: '', section: '', row_label: '' },
        amount,
        queue_position: position,
        message: `You are #${position} in the waiting list. We'll notify you when a seat opens.`,
      };
      await redis.setex(idemKey, config.reservation.idempotencyTtlSeconds, JSON.stringify(response));
      timer();
      return response;
    }

    if (remaining === -2) {
      await eventService.initRedisInventory(data.event_id);
      await redis.del(idemKey);
      timer();
      throw new Error('Inventory initializing, please retry in a moment');
    }

    const t3 = bookingDuration.startTimer({ stage: 'pg_transaction' });
    let response: BookingResponse;

    try {
      response = await withTransaction(async (client) => {
        return this._createBookingInTransaction(client, userId, data, idempotencyKey, amount);
      });
    } catch (err) {
      await redis.incr(inventoryKey);
      await redis.del(idemKey);
      bookingLogger.error('Booking transaction failed, inventory restored', { error: (err as Error).message });
      throw err;
    } finally {
      t3();
    }

    await redis.setex(
      KEYS.reservation(response.booking_id),
      config.reservation.ttlSeconds,
      JSON.stringify({ userId, seatId: data.seat_id, eventId: data.event_id })
    );
    await notificationQueue.add('booking-reserved', {
      type: 'RESERVATION_CREATED',
      userId,
      bookingId: response.booking_id,
      seatNumber: response.seat.seat_number,
      expiresAt: response.expires_at?.toISOString(),
    });

    await redis.setex(idemKey, config.reservation.idempotencyTtlSeconds, JSON.stringify(response));

    broadcastSeatUpdate({
      event_id: data.event_id,
      seat_id: data.seat_id,
      status: 'reserved',
      seat_number: response.seat.seat_number,
      section: response.seat.section,
    });
    broadcastInventoryUpdate(data.event_id, remaining, amount);

    bookingTotal.inc({ status: 'pending' });
    timer();
    return response;
  }

  private async _waitForIdempotentResponse(idemKey: string): Promise<BookingResponse | null> {
    const maxWaitMs = 10_000;
    const pollIntervalMs = 200;
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      const value = await redis.get(idemKey);
      if (value && value !== 'PROCESSING') return JSON.parse(value);
    }
    bookingLogger.warn('Idempotency key still PROCESSING after timeout', { key: idemKey });
    return null;
  }

  private async _createBookingInTransaction(
    client: PoolClient,
    userId: string,
    data: CreateBookingRequest,
    idempotencyKey: string,
    amount: number
  ): Promise<BookingResponse> {
    const seatRows = await client.query<Seat>(
      `SELECT * FROM seats WHERE id = $1 FOR UPDATE NOWAIT`,
      [data.seat_id]
    );
    if (!seatRows.rows.length) throw new Error('Seat not found');
    const seat = seatRows.rows[0];
    if (seat.status !== 'available') throw new Error(`Seat is ${seat.status}, cannot book`);

    const bookingId = uuidv4();
    const expiresAt = new Date(Date.now() + config.reservation.ttlSeconds * 1000);

    await client.query(
      `UPDATE seats SET status = 'reserved', reserved_until = $1, version = version + 1 WHERE id = $2`,
      [expiresAt, seat.id]
    );

    await client.query(
      `INSERT INTO bookings (id, user_id, seat_id, event_id, status, idempotency_key, amount_paid, expires_at)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7)`,
      [bookingId, userId, seat.id, data.event_id, idempotencyKey, amount, expiresAt]
    );

    await client.query(
      `INSERT INTO booking_audit_log (booking_id, old_status, new_status, reason, metadata)
       VALUES ($1, NULL, 'pending', 'booking_created', $2)`,
      [bookingId, JSON.stringify({ seat_id: seat.id, amount })]
    );

    bookingLogger.info('Booking created', { booking_id: bookingId, user_id: userId, seat_id: seat.id, amount });

    return {
      booking_id: bookingId,
      status: 'pending',
      seat: { id: seat.id, seat_number: seat.seat_number, section: seat.section, row_label: seat.row_label },
      expires_at: expiresAt,
      amount,
      message: `Seat reserved! Complete payment within ${config.reservation.ttlSeconds / 60} minutes.`,
    };
  }

  async getUserBookings(userId: string): Promise<Booking[]> {
    return query<Booking>(
      `SELECT b.*, s.seat_number, s.section, s.row_label, e.name AS event_name, e.venue, e.starts_at
       FROM bookings b
       JOIN seats s ON b.seat_id = s.id
       JOIN events e ON b.event_id = e.id
       WHERE b.user_id = $1
       ORDER BY b.created_at DESC`,
      [userId]
    );
  }

  async cancelBooking(bookingId: string, userId: string): Promise<void> {
    let eventId!: string;
    let seatId!: string;
    let seatNumber!: string;
    let section!: string;

    await withTransaction(async (client) => {
      const rows = await client.query<Booking>(
        `SELECT * FROM bookings WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [bookingId, userId]
      );
      if (!rows.rows.length) throw new Error('Booking not found');
      const booking = rows.rows[0];
      if (!['pending', 'confirmed'].includes(booking.status)) {
        throw new Error(`Cannot cancel booking with status: ${booking.status}`);
      }

      const oldStatus = booking.status;
      eventId = booking.event_id;
      seatId = booking.seat_id;

      await client.query(`UPDATE bookings SET status = 'cancelled' WHERE id = $1`, [bookingId]);

      const seatResult = await client.query<{ seat_number: string; section: string }>(
        `UPDATE seats SET status = 'available', reserved_until = NULL WHERE id = $1 RETURNING seat_number, section`,
        [seatId]
      );
      seatNumber = seatResult.rows[0].seat_number;
      section = seatResult.rows[0].section;

      await client.query(
        `INSERT INTO booking_audit_log (booking_id, old_status, new_status, reason)
         VALUES ($1, $2, 'cancelled', 'user_cancelled')`,
        [bookingId, oldStatus]
      );
    });

    await this._offerSeatToNextWaiter(eventId, seatId, seatNumber, section);
    await redis.del(KEYS.reservation(bookingId));
  }

  async confirmBooking(bookingId: string, stripePaymentIntentId: string): Promise<void> {
    let seatId!: string;
    let eventId!: string;
    let seatNumber!: string;
    let section!: string;
    let alreadyConfirmed = false;

    await withTransaction(async (client) => {
      const existing = await client.query<{ stripe_payment_intent_id: string }>(
        `SELECT stripe_payment_intent_id FROM bookings WHERE id = $1 AND status = 'confirmed'`,
        [bookingId]
      );
      if (existing.rows.length) {
        alreadyConfirmed = true;
        return;
      }

      const result = await client.query<{ seat_id: string; event_id: string; user_id: string; amount_paid: number }>(
        `UPDATE bookings
         SET status = 'confirmed', stripe_payment_intent_id = $1, confirmed_at = now()
         WHERE id = $2 AND status = 'pending'
         RETURNING seat_id, event_id, user_id, amount_paid`,
        [stripePaymentIntentId, bookingId]
      );
      if (!result.rows.length) throw new Error(`Booking ${bookingId} not found or non-confirmable`);

      seatId = result.rows[0].seat_id;
      eventId = result.rows[0].event_id;

      const seatResult = await client.query<{ seat_number: string; section: string }>(
        `UPDATE seats SET status = 'booked' WHERE id = $1 RETURNING seat_number, section`,
        [seatId]
      );
      seatNumber = seatResult.rows[0].seat_number;
      section = seatResult.rows[0].section;

      await client.query(
        `INSERT INTO booking_audit_log (booking_id, old_status, new_status, reason)
         VALUES ($1, 'pending', 'confirmed', 'payment_success')`,
        [bookingId]
      );
    });

    if (alreadyConfirmed) {
      bookingLogger.info('confirmBooking: already confirmed (Stripe retry)', { booking_id: bookingId });
      return;
    }

    await redis.del(KEYS.reservation(bookingId));
    broadcastSeatUpdate({ event_id: eventId, seat_id: seatId, status: 'booked', seat_number: seatNumber, section });
  }

  async offerSeatToNextWaiter(eventId: string, seatId: string): Promise<void> {
    const seatRows = await query<{ seat_number: string; section: string }>(
      `SELECT seat_number, section FROM seats WHERE id = $1`,
      [seatId]
    );
    if (!seatRows.length) {
      await redis.incr(KEYS.seatInventory(eventId));
      return;
    }
    await this._offerSeatToNextWaiter(eventId, seatId, seatRows[0].seat_number, seatRows[0].section);
  }

  async _offerSeatToNextWaiter(eventId: string, seatId: string, seatNumber: string, section: string): Promise<void> {
    const released = await releaseAndNotify(KEYS.seatInventory(eventId), KEYS.waitingQueue(eventId));

    if (!released) {
      broadcastSeatUpdate({ event_id: eventId, seat_id: seatId, status: 'available', seat_number: seatNumber, section });
      return;
    }

    const waiter = JSON.parse(released) as { userId: string; seatId: string; timestamp: number };

    try {
      const event = await eventService.getEventById(eventId);
      const amount = event
        ? eventService.calculatePrice(event.base_price, event.available_seats, event.total_seats)
        : 0;

      const idempotencyKey = `waitlist-${eventId}-${waiter.userId}-${Date.now()}`;
      const response = await withTransaction(async (client) => {
        return this._createBookingInTransaction(client, waiter.userId, { event_id: eventId, seat_id: seatId }, idempotencyKey, amount);
      });

      await redis.setex(
        KEYS.reservation(response.booking_id),
        config.reservation.ttlSeconds,
        JSON.stringify({ userId: waiter.userId, seatId, eventId })
      );
      await notificationQueue.add('waitlist-reserved', {
        type: 'RESERVATION_CREATED',
        userId: waiter.userId,
        bookingId: response.booking_id,
        seatNumber,
        expiresAt: response.expires_at?.toISOString(),
        fromWaitlist: true,
      });

      broadcastSeatUpdate({ event_id: eventId, seat_id: seatId, status: 'reserved', seat_number: seatNumber, section });
    } catch (err) {
      bookingLogger.warn('Failed to reserve for waiter, releasing seat', { user_id: waiter.userId, error: (err as Error).message });
      await redis.incr(KEYS.seatInventory(eventId));
      broadcastSeatUpdate({ event_id: eventId, seat_id: seatId, status: 'available', seat_number: seatNumber, section });
    }
  }
}

export const bookingService = new BookingService();
