import { pool } from './index';
import { logger } from '../utils/logger';

// Design invariants baked into this schema:
// 1. available_seats is NOT stored — always derived from seats.status or Redis.
// 2. Every state transition produces an immutable row in booking_audit_log.
// 3. Reconciliation worker writes mismatches to reconciliation_issues for ops visibility.
// 4. Refresh tokens are rotated on every use — theft detection via family invalidation.

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
  family      UUID NOT NULL,
  used        BOOLEAN DEFAULT false,
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

-- ─── Saga compensation log ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS saga_compensations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id          UUID REFERENCES bookings(id),
  reason              TEXT NOT NULL,
  steps_completed     JSONB NOT NULL DEFAULT '[]',
  steps_compensated   JSONB NOT NULL DEFAULT '[]',
  compensated_at      TIMESTAMPTZ DEFAULT now()
);

-- ─── Dead-letter queue ────────────────────────────────────────────────────────
-- Jobs that exhausted all retries land here for ops inspection and manual replay.

CREATE TABLE IF NOT EXISTS dead_letter_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source       TEXT NOT NULL,
  event_type   TEXT NOT NULL,
  payload      JSONB NOT NULL,
  error        TEXT,
  attempts     INT DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now(),
  last_failed  TIMESTAMPTZ DEFAULT now()
);

-- ─── Reconciliation issues ────────────────────────────────────────────────────
-- Written by the reconciliation worker when it detects drift between
-- booking status, seat status, Redis inventory, and payment state.

CREATE TABLE IF NOT EXISTS reconciliation_issues (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_type   TEXT NOT NULL,
  entity_id    UUID,
  description  TEXT NOT NULL,
  resolved     BOOLEAN DEFAULT false,
  detected_at  TIMESTAMPTZ DEFAULT now(),
  resolved_at  TIMESTAMPTZ
);

-- ─── CQRS read model ─────────────────────────────────────────────────────────
-- Materialised view kept in sync by the read-model updater.
-- Heavy analytics reads hit this table, not the write-side bookings table.

CREATE TABLE IF NOT EXISTS event_analytics_snapshot (
  event_id          UUID PRIMARY KEY,
  event_name        TEXT NOT NULL,
  venue             TEXT NOT NULL,
  total_seats       INT NOT NULL,
  booked_count      INT NOT NULL DEFAULT 0,
  reserved_count    INT NOT NULL DEFAULT 0,
  available_count   INT NOT NULL DEFAULT 0,
  confirmed_revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
  last_updated      TIMESTAMPTZ DEFAULT now()
);

-- ─── Abuse prevention ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS booking_attempts (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID,
  event_id   UUID,
  ip_address TEXT,
  attempted_at TIMESTAMPTZ DEFAULT now()
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
CREATE INDEX IF NOT EXISTS idx_dlq_source          ON dead_letter_events(source, created_at);
CREATE INDEX IF NOT EXISTS idx_recon_unresolved    ON reconciliation_issues(detected_at) WHERE resolved = false;
CREATE INDEX IF NOT EXISTS idx_refresh_user        ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_family      ON refresh_tokens(family);
CREATE INDEX IF NOT EXISTS idx_attempts_user_event ON booking_attempts(user_id, event_id, attempted_at);
CREATE INDEX IF NOT EXISTS idx_attempts_ip         ON booking_attempts(ip_address, attempted_at);
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
