import { query, pool } from '../index';
import { workerLogger } from '../../utils/logger';

// Read model: event_analytics_snapshot is kept in sync by this module.
// Admin analytics reads hit this table, not the write-side tables.
// This separates read load from booking write contention.

export async function refreshEventSnapshot(eventId: string): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO event_analytics_snapshot
         (event_id, event_name, venue, total_seats, booked_count, reserved_count, available_count, confirmed_revenue, last_updated)
       SELECT
         e.id,
         e.name,
         e.venue,
         e.total_seats,
         COUNT(s.id) FILTER (WHERE s.status = 'booked')     AS booked_count,
         COUNT(s.id) FILTER (WHERE s.status = 'reserved')   AS reserved_count,
         COUNT(s.id) FILTER (WHERE s.status = 'available')  AS available_count,
         COALESCE(SUM(b.amount_paid) FILTER (WHERE b.status = 'confirmed'), 0) AS confirmed_revenue,
         now()
       FROM events e
       LEFT JOIN seats s ON s.event_id = e.id
       LEFT JOIN bookings b ON b.event_id = e.id
       WHERE e.id = $1
       GROUP BY e.id, e.name, e.venue, e.total_seats
       ON CONFLICT (event_id) DO UPDATE SET
         booked_count       = EXCLUDED.booked_count,
         reserved_count     = EXCLUDED.reserved_count,
         available_count    = EXCLUDED.available_count,
         confirmed_revenue  = EXCLUDED.confirmed_revenue,
         event_name         = EXCLUDED.event_name,
         venue              = EXCLUDED.venue,
         total_seats        = EXCLUDED.total_seats,
         last_updated       = now()`,
      [eventId]
    );
  } catch (err) {
    workerLogger.error('Failed to refresh event snapshot', { event_id: eventId, error: (err as Error).message });
  }
}

export async function refreshAllEventSnapshots(): Promise<void> {
  const events = await query<{ id: string }>(
    `SELECT id FROM events WHERE status IN ('published','completed')`
  );
  for (const event of events) {
    await refreshEventSnapshot(event.id);
  }
}

export async function getEventSnapshot(eventId: string) {
  const rows = await query(
    `SELECT * FROM event_analytics_snapshot WHERE event_id = $1`,
    [eventId]
  );
  return rows[0] ?? null;
}

export async function getAllEventSnapshots() {
  return query(`SELECT * FROM event_analytics_snapshot ORDER BY last_updated DESC`);
}
