import { Request, Response, NextFunction } from 'express';
import { pool, query } from '../../db';
import { redis } from '../../redis/client';
import { logger } from '../../utils/logger';
import { abuseBlocked } from '../../utils/metrics';

const KEYS_ABUSE = {
  userEventAttempts: (userId: string, eventId: string) => `tv:abuse:ue:${userId}:${eventId}`,
  ipAttempts: (ip: string) => `tv:abuse:ip:${ip}`,
  userLock: (userId: string) => `tv:abuse:lock:${userId}`,
};

// Per-user-per-event: max 10 booking attempts per 10 minutes
const MAX_USER_EVENT_ATTEMPTS = 10;
const USER_EVENT_WINDOW = 600;

// Per-IP: max 30 booking attempts per minute (burst detection)
const MAX_IP_ATTEMPTS = 30;
const IP_WINDOW = 60;

// Records a booking attempt and checks thresholds.
// Returns an error string if the request should be blocked, null if allowed.
async function checkAbuseThresholds(
  userId: string,
  eventId: string,
  ip: string
): Promise<string | null> {
  // Check if user is locked (from repeated failed logins — set by auth route)
  const lockKey = KEYS_ABUSE.userLock(userId);
  const locked = await redis.get(lockKey);
  if (locked) return 'Account temporarily locked due to suspicious activity';

  const userEventKey = KEYS_ABUSE.userEventAttempts(userId, eventId);
  const ipKey = KEYS_ABUSE.ipAttempts(ip);

  const [ueCount, ipCount] = await Promise.all([
    redis.incr(userEventKey),
    redis.incr(ipKey),
  ]);

  // Set TTL on first increment
  if (ueCount === 1) await redis.expire(userEventKey, USER_EVENT_WINDOW);
  if (ipCount === 1) await redis.expire(ipKey, IP_WINDOW);

  if (ueCount > MAX_USER_EVENT_ATTEMPTS) {
    abuseBlocked.labels('user_event_rate').inc();
    return `Too many booking attempts for this event. Please wait before trying again.`;
  }

  if (ipCount > MAX_IP_ATTEMPTS) {
    abuseBlocked.labels('ip_rate').inc();
    return `Too many requests from your network. Please slow down.`;
  }

  return null;
}

export function abuseGuard(req: Request, res: Response, next: NextFunction): void {
  const userId = req.user?.user_id;
  const eventId = req.body?.event_id;
  const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';

  if (!userId || !eventId) {
    next();
    return;
  }

  checkAbuseThresholds(userId, eventId, ip)
    .then(async (errMsg) => {
      if (errMsg) {
        logger.warn('Booking attempt blocked by abuse guard', { user_id: userId, event_id: eventId, ip });

        // Log to PG for ops visibility
        await pool.query(
          `INSERT INTO booking_attempts (user_id, event_id, ip_address) VALUES ($1, $2, $3)`,
          [userId, eventId, ip]
        ).catch(() => {});

        res.status(429).json({ error: errMsg });
        return;
      }
      next();
    })
    .catch(() => next()); // Never block on abuse guard failure
}
