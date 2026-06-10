import { pool } from './index';
import { logger } from '../utils/logger';

// Design invariants baked into this schema:
// 1. available_seats is NOT stored — always derived from seats.status or Redis.
// 2. Every state transition produces an immutable row in booking_audit_log.
// 3. Refresh tokens are single-use and consumed atomically on rotation.

const migrations = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Core domain tables ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  name            TEXT NOT NULL,
  role            TEXT CHECK (role IN ('user','admin')) DEFAULT 'user',
  failed_logins   INT DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT UNIQUE NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT,
  venue       TEXT NOT NULL,
  total_seats INT NOT NULL,
  base_price  NUMERIC(10,2) NOT NULL,
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ NOT NULL,
  status      TEXT CHECK (status IN ('draft','published','cancelled','completed')) DEFAULT 'draft',
  version     INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seats (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       UUID REFERENCES events(id) ON DELETE CASCADE,
  seat_number    TEXT NOT NULL,
  section        TEXT NOT NULL DEFAULT 'General',
  row_label      TEXT NOT NULL DEFAULT 'A',
  status         TEXT CHECK (status IN ('available','reserved','booked')) DEFAULT 'available',
  reserved_until TIMESTAMPTZ,
  version        INT DEFAULT 0,
  UNIQUE(event_id, seat_number)
);

CREATE TABLE IF NOT EXISTS bookings (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID REFERENCES users(id),
  seat_id                  UUID REFERENCES seats(id),
  event_id                 UUID REFERENCES events(id),
  status                   TEXT CHECK (status IN ('pending','confirmed','cancelled','expired','compensated')) DEFAULT 'pending',
  idempotency_key          TEXT UNIQUE NOT NULL,
  amount_paid              NUMERIC(10,2) NOT NULL DEFAULT 0,
  stripe_payment_intent_id TEXT,
  created_at               TIMESTAMPTZ DEFAULT now(),
  expires_at               TIMESTAMPTZ NOT NULL,
  confirmed_at             TIMESTAMPTZ
);

-- ─── Immutable audit trail ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS booking_audit_log (
  id         BIGSERIAL PRIMARY KEY,
  booking_id UUID,
  old_status TEXT,
  new_status TEXT NOT NULL,
  changed_at TIMESTAMPTZ DEFAULT now(),
  reason     TEXT,
  actor      TEXT DEFAULT 'system',
  metadata   JSONB DEFAULT '{}'
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_bookings_user       ON bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_event      ON bookings(event_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status     ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_expires    ON bookings(expires_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_seats_event         ON seats(event_id);
CREATE INDEX IF NOT EXISTS idx_seats_event_status  ON seats(event_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_booking       ON booking_audit_log(booking_id);
CREATE INDEX IF NOT EXISTS idx_audit_changed       ON booking_audit_log(changed_at);
CREATE INDEX IF NOT EXISTS idx_refresh_user        ON refresh_tokens(user_id);
`;

async function migrate() {
  logger.info('Running database migrations...');
  try {
    await pool.query(migrations);
    logger.info('Migrations complete');
  } catch (err) {
    logger.error('Migration failed', { error: err });
    throw err;
  } finally {
    await pool.end();
  }
}

migrate();
