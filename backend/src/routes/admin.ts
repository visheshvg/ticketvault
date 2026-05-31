import { Router, Request, Response } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import { query, pool } from '../db';
import { redis, KEYS } from '../redis/client';
import { getAllEventSnapshots } from '../db/readModel/eventAnalytics';
import { notificationQueue } from '../workers/queues';
import { replayDeadLetter } from '../workers/dlq/deadLetterQueue';
import { reconciliationWorker } from '../workers/reconciliation/reconciliationWorker';

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

// ─── Reconciliation issues ────────────────────────────────────────────────────
router.get('/reconciliation/issues', async (_req: Request, res: Response) => {
  const issues = await query(
    `SELECT * FROM reconciliation_issues
     WHERE resolved = false
     ORDER BY detected_at DESC
     LIMIT 100`
  );
  res.json({ issues });
});

router.post('/reconciliation/resolve/:issueId', async (req: Request, res: Response) => {
  await pool.query(
    `UPDATE reconciliation_issues SET resolved = true, resolved_at = now() WHERE id = $1`,
    [req.params.issueId]
  );
  res.json({ message: 'Issue marked resolved' });
});

router.post('/reconciliation/run', async (_req: Request, res: Response) => {
  // Trigger an immediate reconciliation run
  reconciliationWorker.runAll().catch(() => {});
  res.json({ message: 'Reconciliation run triggered' });
});

// ─── Dead-letter queue ────────────────────────────────────────────────────────
router.get('/dlq', async (_req: Request, res: Response) => {
  const events = await query(
    `SELECT * FROM dead_letter_events ORDER BY last_failed DESC LIMIT 100`
  );
  res.json({ events });
});

router.post('/dlq/replay/:id', async (req: Request, res: Response) => {
  await replayDeadLetter(req.params.id, notificationQueue);
  res.json({ message: 'Event re-queued for processing' });
});

router.delete('/dlq/:id', async (req: Request, res: Response) => {
  await pool.query(`DELETE FROM dead_letter_events WHERE id = $1`, [req.params.id]);
  res.json({ message: 'Dead-letter event deleted' });
});

// ─── Outbox status ────────────────────────────────────────────────────────────
router.get('/outbox/lag', async (_req: Request, res: Response) => {
  const [row] = await query<{ unpublished: string }>(
    `SELECT COUNT(*) AS unpublished FROM outbox_events WHERE published = false`
  );
  res.json({ unpublished_events: parseInt(row.unpublished, 10) });
});

export default router;
