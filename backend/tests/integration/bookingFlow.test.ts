import { pool } from '../../src/db';
import { redis, KEYS } from '../../src/redis/client';
import { bookingService } from '../../src/services/booking/bookingService';
import { eventService } from '../../src/services/event/eventService';
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
    total_seats: 5,
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
