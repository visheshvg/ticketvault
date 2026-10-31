import { PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { withTransaction, query } from '../../db';
import { redis, KEYS } from '../../redis/client';
import { atomicDecrement, releaseAndNotify, claimIdempotencyKey, joinWaitlist } from '../../redis/scripts';
import { config } from '../../config';
import { Booking, BookingResponse, CreateBookingRequest, Seat } from '../../types';
import { bookingLogger } from '../../utils/logger';
import { HttpError } from '../../utils/httpErrors';
import { eventService } from '../event/eventService';
import {
  broadcastSeatUpdate, broadcastInventoryUpdate, notifyWaitlistOffer, notifySeatAvailable, isUserOnline,
} from '../websocket/wsService';

const IDEMPOTENCY_PROCESSING_TTL = 30;
const MAX_OFFLINE_SKIPS = 20;

export class BookingService {

  async createBooking(
    userId: string,
    data: CreateBookingRequest,
    idempotencyKey: string
  ): Promise<BookingResponse> {
    // Scoped per user, so two users sending the same key never see each other's response
    const scopedKey = `${userId}:${idempotencyKey}`;
    const idemKey = KEYS.idempotency(scopedKey);

    const claimed = await claimIdempotencyKey(idemKey, IDEMPOTENCY_PROCESSING_TTL);
    if (!claimed) {
      const cached = await this._waitForIdempotentResponse(idemKey);
      if (cached.seat.id !== data.seat_id) {
        throw new HttpError(422, 'Idempotency-Key was already used for a different seat');
      }
      return cached;
    }

    const event = await eventService.getEventCached(data.event_id);
    if (!event || event.status !== 'published') {
      await redis.del(idemKey);
      if (!event) throw new HttpError(404, 'Event not found');
      throw new HttpError(422, 'Event is not accepting bookings');
    }

    const amount = eventService.calculatePrice(event.base_price, event.available_seats, event.total_seats);
    const inventoryKey = KEYS.seatInventory(data.event_id);

    const remaining = await atomicDecrement(inventoryKey);

    if (remaining === -1) {
      const position = await joinWaitlist(KEYS.waitingQueue(data.event_id), userId);

      const response: BookingResponse = {
        booking_id: '',
        status: 'queued',
        seat: { id: data.seat_id, seat_number: '', section: '', row_label: '' },
        amount,
        queue_position: position,
        message: `You are #${position} in the waiting list. We'll notify you when a seat opens.`,
      };
      await redis.setex(idemKey, config.reservation.idempotencyTtlSeconds, JSON.stringify(response));
      return response;
    }

    if (remaining === -2) {
      await eventService.initRedisInventory(data.event_id);
      await redis.del(idemKey);
      throw new HttpError(503, 'Inventory initializing, please retry in a moment');
    }

    let response: BookingResponse;

    try {
      response = await withTransaction(async (client) => {
        return this._createBookingInTransaction(client, userId, data, scopedKey, amount);
      });
    } catch (err) {
      await redis.incr(inventoryKey);
      await redis.del(idemKey);
      bookingLogger.error('Booking transaction failed, inventory restored', { error: (err as Error).message });
      throw err;
    }

    await redis.setex(
      KEYS.reservation(response.booking_id),
      config.reservation.ttlSeconds,
      JSON.stringify({ userId, seatId: data.seat_id, eventId: data.event_id })
    );

    await redis.setex(idemKey, config.reservation.idempotencyTtlSeconds, JSON.stringify(response));
    // Got a seat, so they no longer need a spot in the waitlist
    await redis.zrem(KEYS.waitingQueue(data.event_id), userId);

    broadcastSeatUpdate({
      event_id: data.event_id,
      seat_id: data.seat_id,
      status: 'reserved',
      seat_number: response.seat.seat_number,
      section: response.seat.section,
    });
    broadcastInventoryUpdate(data.event_id, remaining, amount);

    return response;
  }

  private async _waitForIdempotentResponse(idemKey: string): Promise<BookingResponse> {
    const maxWaitMs = 10_000;
    const pollIntervalMs = 200;
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const value = await redis.get(idemKey);
      // Key gone means the first request failed, so this one can safely retry
      if (value === null) break;
      if (value !== 'PROCESSING') return JSON.parse(value);
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    // Never process the same key twice at once
    bookingLogger.warn('Idempotent request not finished, asking client to retry', { key: idemKey });
    throw new HttpError(409, 'A request with this Idempotency-Key is still processing, please retry');
  }

  private async _createBookingInTransaction(
    client: PoolClient,
    userId: string,
    data: CreateBookingRequest,
    idempotencyKey: string,
    amount: number,
    holdSeconds: number = config.reservation.ttlSeconds
  ): Promise<BookingResponse> {
    const seatRows = await client.query<Seat>(
      `SELECT * FROM seats WHERE id = $1 FOR UPDATE NOWAIT`,
      [data.seat_id]
    );
    if (!seatRows.rows.length) throw new HttpError(404, 'Seat not found');
    const seat = seatRows.rows[0];
    if (seat.status !== 'available') throw new HttpError(409, `Seat is ${seat.status}, cannot book`);

    const bookingId = uuidv4();
    const expiresAt = new Date(Date.now() + holdSeconds * 1000);

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
      message: `Seat reserved! Complete payment within ${Math.round(holdSeconds / 60)} minutes.`,
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
      if (!rows.rows.length) throw new HttpError(404, 'Booking not found');
      const booking = rows.rows[0];
      if (!['pending', 'confirmed'].includes(booking.status)) {
        throw new HttpError(409, `Cannot cancel booking with status: ${booking.status}`);
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
      if (!result.rows.length) throw new HttpError(409, `Booking ${bookingId} not found or non-confirmable`);

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
    await redis.del(KEYS.seatOffers(seatId));
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

  // A freed seat is offered to waiters one at a time, longest-waiting first, each
  // with a short hold. After a few unanswered offers it goes back on sale for
  // everyone, so a seat can't sit unsold while it cycles through the queue.
  async _offerSeatToNextWaiter(eventId: string, seatId: string, seatNumber: string, section: string): Promise<void> {
    const seat = { eventId, seatId, seatNumber, section };
    const queueKey = KEYS.waitingQueue(eventId);

    const offersKey = KEYS.seatOffers(seatId);
    const offers = await redis.incr(offersKey);
    await redis.expire(offersKey, 3600);
    if (offers > config.waitlist.maxOffers) return this._releaseToPublic(seat);

    // Waiters who aren't on the page are skipped but keep their place in line
    const skipped: { userId: string; joinedAt: number }[] = [];
    try {
      for (let i = 0; i < MAX_OFFLINE_SKIPS; i++) {
        const waiter = await releaseAndNotify(KEYS.seatInventory(eventId), queueKey);
        if (!waiter) {
          // Nobody waiting: the script already put the seat back on sale
          await redis.del(offersKey);
          broadcastSeatUpdate({ event_id: eventId, seat_id: seatId, status: 'available', seat_number: seatNumber, section });
          return;
        }

        if (!(await isUserOnline(waiter.userId))) {
          skipped.push(waiter);
          continue;
        }

        await this._offerToWaiter(waiter.userId, seat);
        return;
      }
      await this._releaseToPublic(seat);
    } finally {
      for (const w of skipped) await redis.zadd(queueKey, 'NX', w.joinedAt, w.userId);
    }
  }

  private async _offerToWaiter(userId: string, seat: FreedSeat): Promise<void> {
    const { eventId, seatId, seatNumber, section } = seat;
    try {
      const event = await eventService.getEventCached(eventId);
      const amount = event
        ? eventService.calculatePrice(event.base_price, event.available_seats, event.total_seats)
        : 0;

      const holdSeconds = config.waitlist.offerTtlSeconds;
      const idempotencyKey = `waitlist-${eventId}-${userId}-${Date.now()}`;
      const response = await withTransaction(async (client) => {
        return this._createBookingInTransaction(client, userId, { event_id: eventId, seat_id: seatId }, idempotencyKey, amount, holdSeconds);
      });

      await redis.setex(
        KEYS.reservation(response.booking_id),
        holdSeconds,
        JSON.stringify({ userId, seatId, eventId })
      );

      broadcastSeatUpdate({ event_id: eventId, seat_id: seatId, status: 'reserved', seat_number: seatNumber, section });
      notifyWaitlistOffer(userId, {
        booking_id: response.booking_id,
        event_id: eventId,
        seat_number: seatNumber,
        section,
        expires_at: response.expires_at!,
      });
    } catch (err) {
      bookingLogger.warn('Failed to reserve for waiter, releasing seat', { user_id: userId, error: (err as Error).message });
      await this._releaseToPublic(seat);
    }
  }

  // Puts the seat back on sale and tells everyone still waiting: first to book gets it
  private async _releaseToPublic({ eventId, seatId, seatNumber, section }: FreedSeat): Promise<void> {
    await redis.del(KEYS.seatOffers(seatId));
    await redis.incr(KEYS.seatInventory(eventId));
    broadcastSeatUpdate({ event_id: eventId, seat_id: seatId, status: 'available', seat_number: seatNumber, section });

    const waiters = await redis.zrange(KEYS.waitingQueue(eventId), 0, -1);
    notifySeatAvailable(waiters, { event_id: eventId, seat_id: seatId, seat_number: seatNumber, section });
    bookingLogger.info('Seat released to public', { event_id: eventId, seat_id: seatId, waiters: waiters.length });
  }
}

interface FreedSeat {
  eventId: string;
  seatId: string;
  seatNumber: string;
  section: string;
}

export const bookingService = new BookingService();
