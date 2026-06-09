import client from 'prom-client';

const register = new client.Registry();
client.collectDefaultMetrics({ register });

// ─── HTTP ─────────────────────────────────────────────────────────────────────
export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [register],
});

// ─── Booking ──────────────────────────────────────────────────────────────────
export const bookingTotal = new client.Counter({
  name: 'booking_requests_total',
  help: 'Total booking requests by outcome',
  labelNames: ['status'],
  registers: [register],
});

export const bookingDuration = new client.Histogram({
  name: 'booking_duration_seconds',
  help: 'Duration of booking request stages',
  labelNames: ['stage'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
  registers: [register],
});

// ─── Inventory ────────────────────────────────────────────────────────────────
export const seatInventoryGauge = new client.Gauge({
  name: 'seat_inventory_remaining',
  help: 'Remaining seat inventory per event (Redis)',
  labelNames: ['event_id'],
  registers: [register],
});

export const redisLuaConflicts = new client.Counter({
  name: 'redis_lua_conflicts_total',
  help: 'Count of sold-out hits at the Redis atomic gate',
  registers: [register],
});

export const queueDepth = new client.Gauge({
  name: 'waiting_queue_depth',
  help: 'Waiting queue depth per event',
  labelNames: ['event_id'],
  registers: [register],
});

// ─── Payment ──────────────────────────────────────────────────────────────────
export const paymentSuccessTotal = new client.Counter({
  name: 'payment_success_total',
  help: 'Total successful payments',
  registers: [register],
});

export const paymentFailureTotal = new client.Counter({
  name: 'payment_failure_total',
  help: 'Total failed payments',
  registers: [register],
});

// ─── Idempotency ──────────────────────────────────────────────────────────────
export const idempotencyHits = new client.Counter({
  name: 'idempotency_cache_hits_total',
  help: 'Count of requests served from idempotency cache (deduplication)',
  registers: [register],
});

// ─── Outbox ───────────────────────────────────────────────────────────────────
export const outboxPublished = new client.Counter({
  name: 'outbox_events_published_total',
  help: 'Total outbox events successfully published to Kafka',
  registers: [register],
});

export const outboxLag = new client.Gauge({
  name: 'outbox_unpublished_events',
  help: 'Count of unpublished outbox events (processing lag)',
  registers: [register],
});

// ─── DLQ ─────────────────────────────────────────────────────────────────────
export const dlqDepth = new client.Counter({
  name: 'dead_letter_events_total',
  help: 'Total events moved to dead-letter queue by source',
  labelNames: ['source'],
  registers: [register],
});

// ─── Reconciliation ───────────────────────────────────────────────────────────
export const reconciliationIssues = new client.Counter({
  name: 'reconciliation_issues_total',
  help: 'Drift issues detected by the reconciliation worker',
  labelNames: ['issue_type'],
  registers: [register],
});

// ─── Abuse prevention ─────────────────────────────────────────────────────────
export const abuseBlocked = new client.Counter({
  name: 'abuse_blocked_total',
  help: 'Requests blocked by the abuse guard',
  labelNames: ['reason'],
  registers: [register],
});

// ─── SLI gauges (updated periodically, read by alerting rules) ───────────────
export const bookingSuccessRate = new client.Gauge({
  name: 'booking_success_rate',
  help: 'Rolling booking success rate (confirmed / total non-queued)',
  registers: [register],
});

export const paymentFailureRate = new client.Gauge({
  name: 'payment_failure_rate',
  help: 'Rolling payment failure rate',
  registers: [register],
});

export { register };
