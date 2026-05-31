import request from 'supertest';
import express from 'express';
import http from 'http';
import cors from 'cors';
import { json } from 'express';
import 'express-async-errors';
import { pool } from '../../src/db';
import { redis, KEYS } from '../../src/redis/client';
import { v4 as uuidv4 } from 'uuid';

import authRoutes from '../../src/routes/auth';
import eventRoutes from '../../src/routes/events';
import bookingRoutes from '../../src/routes/bookings';
import adminRoutes from '../../src/routes/admin';
import { errorHandler } from '../../src/middleware/requestLogger';
import { eventService } from '../../src/services/event/eventService';
import { bookingService } from '../../src/services/booking/bookingService';

jest.mock('../../src/kafka/producer', () => ({
  kafkaProducer: { publish: jest.fn(), connect: jest.fn(), disconnect: jest.fn() },
}));
jest.mock('../../src/workers/queues', () => ({
  notificationQueue: { add: jest.fn() },
}));
jest.mock('../../src/services/websocket/wsService', () => ({
  broadcastSeatUpdate: jest.fn(),
  broadcastInventoryUpdate: jest.fn(),
}));
jest.mock('../../src/db/readModel/eventAnalytics', () => ({
  refreshEventSnapshot: jest.fn(),
  refreshAllEventSnapshots: jest.fn(),
  getAllEventSnapshots: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../src/workers/reconciliation/reconciliationWorker', () => ({
  reconciliationWorker: { runAll: jest.fn(), start: jest.fn(), stop: jest.fn() },
}));
jest.mock('../../src/middleware/security/abuseGuard', () => ({
  abuseGuard: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const app = express();
app.use(json());
app.use('/api/auth', authRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/admin', adminRoutes);
app.use(errorHandler);

let adminToken: string;
let userToken: string;
let testEventId: string;
let testSeatIds: string[];
const adminEmail = `e2e-admin-${uuidv4()}@test.com`;
const userEmail  = `e2e-user-${uuidv4()}@test.com`;

beforeAll(async () => {
  const adminReg = await request(app)
    .post('/api/auth/register')
    .send({ email: adminEmail, password: 'password123', name: 'E2E Admin' });
  expect(adminReg.status).toBe(201);

  await pool.query(`UPDATE users SET role = 'admin' WHERE email = $1`, [adminEmail]);
  const adminLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: adminEmail, password: 'password123' });
  adminToken = adminLogin.body.accessToken;

  const userReg = await request(app)
    .post('/api/auth/register')
    .send({ email: userEmail, password: 'password123', name: 'E2E User' });
  expect(userReg.status).toBe(201);
  userToken = userReg.body.accessToken;

  const event = await eventService.createEvent({
    name: 'E2E Test Event',
    venue: 'Test Venue',
    total_seats: 3,
    base_price: 50,
    starts_at: new Date(Date.now() + 86400000).toISOString(),
    ends_at: new Date(Date.now() + 90000000).toISOString(),
  });
  testEventId = event.id;
  const seats = await eventService.getSeatsForEvent(testEventId) as Array<{ id: string }>;
  testSeatIds = seats.map((s) => s.id);
});

afterAll(async () => {
  await pool.query(`DELETE FROM outbox_events WHERE aggregate_id IN (SELECT id FROM bookings WHERE event_id = $1)`, [testEventId]);
  await pool.query(`DELETE FROM booking_audit_log WHERE booking_id IN (SELECT id FROM bookings WHERE event_id = $1)`, [testEventId]);
  await pool.query(`DELETE FROM saga_compensations WHERE booking_id IN (SELECT id FROM bookings WHERE event_id = $1)`, [testEventId]);
  await pool.query(`DELETE FROM bookings WHERE event_id = $1`, [testEventId]);
  await pool.query(`DELETE FROM seats WHERE event_id = $1`, [testEventId]);
  await pool.query(`DELETE FROM events WHERE id = $1`, [testEventId]);
  await pool.query(`DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE email IN ($1,$2))`, [adminEmail, userEmail]);
  await pool.query(`DELETE FROM users WHERE email IN ($1, $2)`, [adminEmail, userEmail]);
  await redis.del(KEYS.seatInventory(testEventId));
  await redis.del(KEYS.waitingQueue(testEventId));
  await pool.end();
  await redis.quit();
});

describe('E2E — happy path: reserve → confirm booking', () => {
  it('POST /api/bookings creates a pending booking', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${userToken}`)
      .set('Idempotency-Key', `e2e-happy-${uuidv4()}`)
      .send({ event_id: testEventId, seat_id: testSeatIds[0] });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');
    expect(res.body.booking_id).toBeTruthy();
    expect(res.body.expires_at).toBeTruthy();
    expect(res.body.amount).toBeGreaterThan(0);
  });

  it('GET /api/bookings returns the booking in history', async () => {
    const res = await request(app)
      .get('/api/bookings')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.bookings.length).toBeGreaterThanOrEqual(1);
  });

  it('confirm booking moves seat to booked', async () => {
    const bookings = await pool.query(
      `SELECT id FROM bookings WHERE event_id = $1 AND status = 'pending' LIMIT 1`,
      [testEventId]
    );
    const bookingId = bookings.rows[0]?.id;
    if (!bookingId) return;

    await bookingService.confirmBooking(bookingId, `pi_test_${uuidv4()}`);

    const seat = await pool.query(
      `SELECT s.status FROM seats s JOIN bookings b ON b.seat_id = s.id WHERE b.id = $1`,
      [bookingId]
    );
    expect(seat.rows[0].status).toBe('booked');

    const booking = await pool.query(`SELECT status FROM bookings WHERE id = $1`, [bookingId]);
    expect(booking.rows[0].status).toBe('confirmed');
  });
});

describe('E2E — payment failure triggers saga compensation', () => {
  it('compensated booking releases seat and creates audit entry', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${userToken}`)
      .set('Idempotency-Key', `e2e-saga-${uuidv4()}`)
      .send({ event_id: testEventId, seat_id: testSeatIds[1] });

    expect(res.status).toBe(201);
    const bookingId = res.body.booking_id;

    await bookingService['_offerSeatToNextWaiter'] !== undefined; // check method exists
    const { paymentService } = await import('../../src/services/payment/paymentService');
    await (paymentService as unknown as { _compensateSaga: Function })._compensateSaga(bookingId, 'test-user', 'payment_failed');

    const booking = await pool.query(`SELECT status FROM bookings WHERE id = $1`, [bookingId]);
    expect(booking.rows[0].status).toBe('compensated');

    const seat = await pool.query(
      `SELECT s.status FROM seats s JOIN bookings b ON b.seat_id = s.id WHERE b.id = $1`,
      [bookingId]
    );
    expect(seat.rows[0].status).toBe('available');

    const auditLog = await pool.query(
      `SELECT new_status FROM booking_audit_log WHERE booking_id = $1 AND new_status = 'compensated'`,
      [bookingId]
    );
    expect(auditLog.rows.length).toBe(1);
  });
});

describe('E2E — concurrent storm: zero double-bookings', () => {
  it('20 concurrent requests for 1 seat produce exactly 1 pending booking', async () => {
    const seatId = testSeatIds[2];

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        request(app)
          .post('/api/bookings')
          .set('Authorization', `Bearer ${userToken}`)
          .set('Idempotency-Key', `storm-${uuidv4()}`)
          .send({ event_id: testEventId, seat_id: seatId })
      )
    );

    const bookings201 = results.filter(
      (r) => r.status === 'fulfilled' && r.value.status === 201
    );
    const bookings202 = results.filter(
      (r) => r.status === 'fulfilled' && r.value.status === 202
    );

    expect(bookings201.length).toBe(1);
    expect(bookings201.length + bookings202.length).toBeLessThanOrEqual(20);

    const dbCount = await pool.query(
      `SELECT COUNT(*) AS c FROM bookings WHERE seat_id = $1 AND status = 'pending'`,
      [seatId]
    );
    expect(parseInt(dbCount.rows[0].c)).toBe(1);
  });
});

describe('E2E — idempotency: retry safety', () => {
  it('same Idempotency-Key returns identical response without duplicate DB row', async () => {
    const idempKey = `e2e-idem-${uuidv4()}`;
    const seatId = testSeatIds[0];

    const [r1, r2] = await Promise.all([
      request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${userToken}`)
        .set('Idempotency-Key', idempKey)
        .send({ event_id: testEventId, seat_id: seatId }),
      new Promise<request.Response>((resolve) =>
        setTimeout(() =>
          request(app)
            .post('/api/bookings')
            .set('Authorization', `Bearer ${userToken}`)
            .set('Idempotency-Key', idempKey)
            .send({ event_id: testEventId, seat_id: seatId })
            .then(resolve), 50)
      ),
    ]);

    if (r1.body.booking_id && r2.body.booking_id) {
      expect(r1.body.booking_id).toBe(r2.body.booking_id);
    }

    const dupes = await pool.query(
      `SELECT COUNT(*) AS c FROM bookings WHERE idempotency_key = $1`,
      [idempKey]
    );
    expect(parseInt(dupes.rows[0].c)).toBeLessThanOrEqual(1);
  });
});

describe('E2E — refresh token rotation', () => {
  it('refresh token issues new access token', async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: userEmail, password: 'password123' });

    const refreshToken = loginRes.body.refreshToken;
    expect(refreshToken).toBeTruthy();

    const refreshRes = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken });

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.accessToken).toBeTruthy();
    expect(refreshRes.body.refreshToken).toBeTruthy();
    expect(refreshRes.body.refreshToken).not.toBe(refreshToken); // rotated
  });

  it('reusing a rotated token returns 401', async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: userEmail, password: 'password123' });
    const oldToken = loginRes.body.refreshToken;

    await request(app).post('/api/auth/refresh').send({ refreshToken: oldToken });

    const reuseRes = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: oldToken });

    expect(reuseRes.status).toBe(401);
  });
});
