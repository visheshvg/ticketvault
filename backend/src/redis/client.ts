import Redis from 'ioredis';
import { config } from '../config';
import { logger } from '../utils/logger';

// No keyPrefix on the client — KEYS functions include the prefix explicitly.
// ioredis does NOT apply keyPrefix to eval() KEYS arguments, so using it
// would cause Lua scripts to read different keys than normal commands.
export const redis = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, {
      retryStrategy: (times) => Math.min(times * 200, 5000),
      enableOfflineQueue: true,
      maxRetriesPerRequest: 20,
      lazyConnect: false,
      tls: process.env.REDIS_URL.startsWith('rediss://') ? {} : undefined,
    })
  : new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      retryStrategy: (times) => Math.min(times * 50, 2000),
      enableOfflineQueue: true,
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });

redis.on('error', (err) => logger.error('Redis error', { error: err.message }));
redis.on('connect', () => logger.info('Redis connected'));
redis.on('reconnecting', () => logger.warn('Redis reconnecting'));

const PREFIX = 'tv:';

export const KEYS = {
  seatInventory: (eventId: string) => `${PREFIX}seat_inventory:${eventId}`,
  waitingQueue:  (eventId: string) => `${PREFIX}waiting_queue:${eventId}`,
  reservation:   (bookingId: string) => `${PREFIX}reservation:${bookingId}`,
  idempotency:   (key: string) => `${PREFIX}idempotency:${key}`,
  rateLimit:     (userId: string) => `${PREFIX}rate_limit:${userId}`,
  seatLock:      (seatId: string) => `${PREFIX}seat_lock:${seatId}`,
};
