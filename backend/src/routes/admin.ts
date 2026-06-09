import { Router, Request, Response } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import { query } from '../db';
import { redis, KEYS } from '../redis/client';

const router = Router();
router.use(authenticate, requireAdmin);

// ─── Dashboard (read model — no write-side table scans) ───────────────────────
router.get('/dashboard', async (_req: Request, res: Response) => {
  const [bookingStats] = await query<{ total: string; confirmed: string; pending: string; expired: string; compensated: string }>(
    `SELECT
      COUNT(*)                                              AS total,
      COUNT(*) FILTER (WHERE status = 'confirmed')         AS confirmed,
      COUNT(*) FILTER (WHERE status = 'pending')           AS pending,
      COUNT(*) FILTER (WHERE status = 'expired')           AS expired,
      COUNT(*) FILTER (WHERE status = 'compensated')       AS compensated
     FROM bookings`
  );

  const [revenueRow] = await query<{ total: string }>(
    `SELECT COALESCE(SUM(amount_paid), 0) AS total FROM bookings WHERE status = 'confirmed'`
  );

  const events = await query<{
    event_id: string; event_name: string; venue: string; total_seats: number;
    booked_count: string; reserved_count: string; available_count: string; confirmed_revenue: string;
  }>(
    `SELECT
       e.id   AS event_id,
       e.name AS event_name,
       e.venue,
       e.total_seats,
       COUNT(*) FILTER (WHERE s.status = 'booked')     AS booked_count,
       COUNT(*) FILTER (WHERE s.status = 'reserved')   AS reserved_count,
       COUNT(*) FILTER (WHERE s.status = 'available')  AS available_count,
       COALESCE(SUM(b.amount_paid) FILTER (WHERE b.status = 'confirmed'), 0) AS confirmed_revenue
     FROM events e
     LEFT JOIN seats s    ON s.event_id = e.id
     LEFT JOIN bookings b ON b.event_id = e.id
     GROUP BY e.id, e.name, e.venue, e.total_seats
     ORDER BY e.starts_at DESC`
  );

  res.json({
    bookings: bookingStats,
    revenue: parseFloat(revenueRow.total),
    events,
  });
});

// ─── Per-booking audit trail ──────────────────────────────────────────────────
router.get('/audit/:bookingId', async (req: Request, res: Response) => {
  const logs = await query(
    `SELECT * FROM booking_audit_log WHERE booking_id = $1 ORDER BY changed_at ASC`,
    [req.params.bookingId]
  );
  res.json({ logs });
});

// ─── Waiting queue status ─────────────────────────────────────────────────────
router.get('/queue/:eventId', async (req: Request, res: Response) => {
  const { eventId } = req.params;
  const [queueDepth, inventory] = await Promise.all([
    redis.llen(KEYS.waitingQueue(eventId)),
    redis.get(KEYS.seatInventory(eventId)),
  ]);
  res.json({
    queue_depth: queueDepth,
    redis_inventory: inventory !== null ? parseInt(inventory, 10) : null,
  });
});

export default router;
