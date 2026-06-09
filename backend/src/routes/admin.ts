import { Router, Request, Response } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import { query } from '../db';
import { redis, KEYS } from '../redis/client';
import { getAllEventSnapshots } from '../db/readModel/eventAnalytics';

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

  const snapshots = await getAllEventSnapshots();

  res.json({
    bookings: bookingStats,
    revenue: parseFloat(revenueRow.total),
    events: snapshots,
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

// ─── Saga compensations ───────────────────────────────────────────────────────
router.get('/compensations', async (_req: Request, res: Response) => {
  const compensations = await query(
    `SELECT sc.*, b.user_id, b.event_id
     FROM saga_compensations sc
     JOIN bookings b ON sc.booking_id = b.id
     ORDER BY sc.compensated_at DESC
     LIMIT 50`
  );
  res.json({ compensations });
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
