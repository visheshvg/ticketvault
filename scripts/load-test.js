import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const bookingDuration = new Trend('booking_duration_ms');
const booked          = new Counter('status_201_booked');
const queued          = new Counter('status_202_queued');
const conflict        = new Counter('status_409_seat_taken');
const rateLimited     = new Counter('status_429_rate_limited');
const serverErrors    = new Counter('status_5xx');

// 4xx are expected business outcomes under contention, only 5xx count as failures
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 499 }));

const USERS = parseInt(__ENV.USERS || '50', 10);
const VUS   = parseInt(__ENV.VUS || '500', 10);

export const options = {
  setupTimeout: '120s',
  scenarios: {
    concurrency_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: VUS },
        { duration: '20s', target: VUS },
        { duration: '5s',  target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(99)<2000'],
    http_req_failed:   ['rate<0.01'],
    status_5xx:        ['count==0'],
  },
};

const BASE     = __ENV.BASE_URL || 'http://localhost:3000';
const EVENT_ID = __ENV.EVENT_ID || '';
const SEAT_IDS = (__ENV.SEAT_IDS || '').split(',').filter(Boolean);

export function setup() {
  if (!EVENT_ID || !SEAT_IDS.length) {
    throw new Error('Missing EVENT_ID or SEAT_IDS. Run scripts/seed-load-test.sh first.');
  }

  const health = http.get(`${BASE}/health`);
  if (health.status !== 200) throw new Error('Backend not healthy, aborting load test');

  // Register a pool of users so per-user rate limits are tested fairly
  const run = Date.now();
  const tokens = [];
  for (let i = 0; i < USERS; i++) {
    const res = http.post(
      `${BASE}/api/auth/register`,
      JSON.stringify({ email: `k6-${run}-${i}@test.com`, password: 'loadtest123', name: `k6 user ${i}` }),
      { headers: { 'Content-Type': 'application/json' } }
    );
    if (res.status !== 201) throw new Error(`Failed to register user ${i}: ${res.status} ${res.body}`);
    tokens.push(res.json('accessToken'));
  }
  return { tokens };
}

export default function ({ tokens }) {
  const token  = tokens[__VU % tokens.length];
  const seatId = SEAT_IDS[Math.floor(Math.random() * SEAT_IDS.length)];

  const start = Date.now();
  const res = http.post(
    `${BASE}/api/bookings`,
    JSON.stringify({ event_id: EVENT_ID, seat_id: seatId }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Idempotency-Key': `k6-vu${__VU}-iter${__ITER}-${Date.now()}`,
      },
    }
  );
  bookingDuration.add(Date.now() - start);

  check(res, { 'no server error': (r) => r.status < 500 });

  if (res.status === 201) booked.add(1);
  else if (res.status === 202) queued.add(1);
  else if (res.status === 409) conflict.add(1);
  else if (res.status === 429) rateLimited.add(1);
  else if (res.status >= 500) serverErrors.add(1);

  sleep(0.05);
}

export function teardown() {
  console.log('Check: status_201_booked must not exceed the number of seats in the event.');
}
