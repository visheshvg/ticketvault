import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const bookingDuration  = new Trend('booking_duration_ms');
const soldOutResponses = new Counter('sold_out_responses');
const successBookings  = new Counter('successful_bookings');

export const options = {
  scenarios: {
    concurrency_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 500 },
        { duration: '20s', target: 500 },
        { duration: '5s',  target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(99)<2000'],
    http_req_failed:   ['rate<0.01'],
  },
};

const BASE       = __ENV.BASE_URL   || 'http://localhost:3000';
const EVENT_ID   = __ENV.EVENT_ID   || '';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || '';
const SEAT_IDS   = (__ENV.SEAT_IDS  || '').split(',').filter(Boolean);

export function setup() {
  const res = http.get(`${BASE}/health`);
  if (res.status !== 200) throw new Error('Backend not healthy — aborting load test');
}

export default function () {
  if (!EVENT_ID || !AUTH_TOKEN) {
    console.error('Missing EVENT_ID or AUTH_TOKEN env vars. Run scripts/seed-load-test.sh first.');
    return;
  }

  const seatId = SEAT_IDS.length
    ? SEAT_IDS[Math.floor(Math.random() * SEAT_IDS.length)]
    : null;

  if (!seatId) {
    console.error('No SEAT_IDS provided.');
    return;
  }

  const idempotencyKey = `load-test-vu${__VU}-iter${__ITER}-${Date.now()}`;
  const start = Date.now();

  const res = http.post(
    `${BASE}/api/bookings`,
    JSON.stringify({ event_id: EVENT_ID, seat_id: seatId }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AUTH_TOKEN}`,
        'Idempotency-Key': idempotencyKey,
      },
    }
  );

  bookingDuration.add(Date.now() - start);

  const ok = check(res, {
    'no server error': (r) => r.status < 500,
    'response is json': (r) => r.headers['Content-Type']?.includes('application/json') ?? false,
  });

  if (res.status === 201) successBookings.add(1);
  if (res.status === 202) soldOutResponses.add(1);

  sleep(0.05);
}

export function teardown() {
  console.log('Load test complete.');
  console.log('Check: successful_bookings should not exceed total seats in the event.');
  console.log('Check: sold_out_responses confirms the Redis gate is working.');
}
