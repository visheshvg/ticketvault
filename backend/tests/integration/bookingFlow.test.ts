import { pool } from '../../src/db';
import { redis, KEYS } from '../../src/redis/client';
import { bookingService } from '../../src/services/booking/bookingService';
import { eventService } from '../../src/services/event/eventService';
import { expiryWorker } from '../../src/workers/expiryWorker';
import { v4 as uuidv4 } from 'uuid';

jest.mock('../../src/services/websocket/wsService', () => ({
  broadcastSeatUpdate: jest.fn(),
  broadcastInventoryUpdate: jest.fn(),
}));

let testEventId: string;
let testSeatIds: string[];
let testUserId: string;

beforeAll(async () => {
  testUserId = uuidv4();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, $3, $4)`,
    [testUserId, `test-${testUserId}@test.com`, 'hashed', 'Test User']
  );

  const event = await eventService.createEvent({
    name: 'Integration Test Event',
    venue: 'Test Venue',
    total_seats: 7,
    base_price: 50,
    starts_at: new Date(Date.now() + 86400000).toISOString(),
    ends_at: new Date(Date.now() + 90000000).toISOString(),
  });
  testEventId = event.id;

  const seats = await eventService.getSeatsForEvent(testEventId) as Array<{ id: string }>;
  testSeatIds = seats.map((s) => s.id);
});

afterAll(async () => {
  await pool.query(`DELETE FROM booking_audit_log WHERE booking_id IN (SELECT id FROM bookings WHERE event_id = $1)`, [testEventId]);
  await pool.query(`DELETE FROM bookings WHERE event_id = $1`, [testEventId]);
  await pool.query(`DELETE FROM seats WHERE event_id = $1`, [testEventId]);
  await pool.query(`DELETE FROM events WHERE id = $1`, [testEventId]);
  await pool.query(`DELETE FROM users WHERE id = $1`, [testUserId]);
  await redis.del(KEYS.seatInventory(testEventId));
  await redis.del(KEYS.waitingQueue(testEventId));
  await pool.end();
  await redis.quit();
});

describe('Booking flow — happy path', () => {
  it('creates a pending booking and reserves the seat', async () => {
    const seatId = testSeatIds[0];
    const idempKey = `test-${uuidv4()}`;

    const result = await bookingService.createBooking(testUserId, {
      event_id: testEventId,
      seat_id: seatId,
    }, idempKey);

    expect(result.status).toBe('pending');
    expect(result.booking_id).toBeTruthy();
    expect(result.expires_at).toBeTruthy();

    const seatRows = await pool.query(`SELECT status FROM seats WHERE id = $1`, [seatId]);
    expect(seatRows.rows[0].status).toBe('reserved');

    const bookingRows = await pool.query(`SELECT status FROM bookings WHERE id = $1`, [result.booking_id]);
    expect(bookingRows.rows[0].status).toBe('pending');
  });

  it('idempotency: same key returns same booking_id', async () => {
    const seatId = testSeatIds[1];
    const idempKey = `test-idem-${uuidv4()}`;

    const first  = await bookingService.createBooking(testUserId, { event_id: testEventId, seat_id: seatId }, idempKey);
    const second = await bookingService.createBooking(testUserId, { event_id: testEventId, seat_id: seatId }, idempKey);

    expect(first.booking_id).toBe(second.booking_id);
  });

  it('cancelling a booking releases the seat and restores inventory', async () => {
    const seatId = testSeatIds[2];
    const idempKey = `test-cancel-${uuidv4()}`;

    const created = await bookingService.createBooking(testUserId, { event_id: testEventId, seat_id: seatId }, idempKey);
    const inventoryBefore = parseInt(await redis.get(KEYS.seatInventory(testEventId)) ?? '0', 10);

    await bookingService.cancelBooking(created.booking_id, testUserId);

    const seatRows = await pool.query(`SELECT status FROM seats WHERE id = $1`, [seatId]);
    expect(seatRows.rows[0].status).toBe('available');

    const inventoryAfter = parseInt(await redis.get(KEYS.seatInventory(testEventId)) ?? '0', 10);
    expect(inventoryAfter).toBe(inventoryBefore + 1);
  });
});

describe('Booking flow — concurrency: no double-booking', () => {
  it('50 concurrent requests for 1 seat produce exactly 1 booking', async () => {
    const seatId = testSeatIds[3];

    const results = await Promise.allSettled(
      Array.from({ length: 50 }, () =>
        bookingService.createBooking(testUserId, { event_id: testEventId, seat_id: seatId }, `conc-${uuidv4()}`)
      )
    );

    const confirmed = results.filter(
      (r) => r.status === 'fulfilled' && r.value.status === 'pending'
    );
    const queued = results.filter(
      (r) => r.status === 'fulfilled' && r.value.status === 'queued'
    );
    const errors = results.filter((r) => r.status === 'rejected');

    expect(confirmed.length).toBe(1);
    expect(queued.length + errors.length).toBe(49);

    const bookingCount = await pool.query(
      `SELECT COUNT(*) AS c FROM bookings WHERE seat_id = $1 AND status = 'pending'`,
      [seatId]
    );
    expect(parseInt(bookingCount.rows[0].c)).toBe(1);
  });
});

describe('Booking flow — database guard', () => {
  const insertBooking = (seatId: string, status: string) =>
    pool.query(
      `INSERT INTO bookings (user_id, seat_id, event_id, status, idempotency_key, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + interval '10 minutes')`,
      [testUserId, seatId, testEventId, status, `guard-${uuidv4()}`]
    );

  it('rejects a second active booking for the same seat, even bypassing app code', async () => {
    // testSeatIds[0] already has a pending booking from the happy path test
    await expect(insertBooking(testSeatIds[0], 'pending')).rejects.toMatchObject({
      code: '23505',
      constraint: 'uniq_active_booking_per_seat',
    });
    await expect(insertBooking(testSeatIds[0], 'confirmed')).rejects.toMatchObject({ code: '23505' });
  });

  it('allows inactive bookings alongside an active one', async () => {
    await expect(insertBooking(testSeatIds[0], 'expired')).resolves.toBeDefined();
    await expect(insertBooking(testSeatIds[0], 'cancelled')).resolves.toBeDefined();
  });
});

describe('Expiry worker — races', () => {
  const inventory = async () => parseInt(await redis.get(KEYS.seatInventory(testEventId)) ?? '0', 10);
  const expire = (b: { id: string; seat_id: string; event_id: string; user_id: string }) =>
    expiryWorker['_expireSingleBooking'](b);

  // The concurrency test leaves users on the waitlist
  beforeEach(() => redis.del(KEYS.waitingQueue(testEventId)));

  it('does not release a seat that was paid for after the worker picked it up', async () => {
    const seatId = testSeatIds[5];
    const created = await bookingService.createBooking(testUserId, { event_id: testEventId, seat_id: seatId }, `race-${uuidv4()}`);
    await bookingService.confirmBooking(created.booking_id, 'pay_test');

    const queueKey = KEYS.waitingQueue(testEventId);
    await redis.lpush(queueKey, JSON.stringify({ userId: testUserId, seatId, timestamp: Date.now() }));
    const inventoryBefore = await inventory();

    // Worker saw the booking as pending in its scan, but payment landed first
    await expire({ id: created.booking_id, seat_id: seatId, event_id: testEventId, user_id: testUserId });

    expect(await inventory()).toBe(inventoryBefore);
    expect(await redis.llen(queueKey)).toBe(1);
    const booking = await pool.query(`SELECT status FROM bookings WHERE id = $1`, [created.booking_id]);
    expect(booking.rows[0].status).toBe('confirmed');

    await redis.del(queueKey);
  });

  it('releases a seat only once when two workers expire the same booking', async () => {
    const seatId = testSeatIds[6];
    const created = await bookingService.createBooking(testUserId, { event_id: testEventId, seat_id: seatId }, `race-${uuidv4()}`);
    const inventoryBefore = await inventory();

    const booking = { id: created.booking_id, seat_id: seatId, event_id: testEventId, user_id: testUserId };
    await expire(booking);
    await expire(booking);

    expect(await inventory()).toBe(inventoryBefore + 1);
    const seat = await pool.query(`SELECT status FROM seats WHERE id = $1`, [seatId]);
    expect(seat.rows[0].status).toBe('available');
  });
});

describe('Booking flow — waitlist', () => {
  it('queues user when sold out', async () => {
    await redis.set(KEYS.seatInventory(testEventId), '0');

    const queuedResult = await bookingService.createBooking(testUserId, {
      event_id: testEventId,
      seat_id: testSeatIds[4],
    }, `waitlist-${uuidv4()}`);

    expect(queuedResult.status).toBe('queued');
    expect(queuedResult.queue_position).toBeGreaterThanOrEqual(1);
  });
});
