import rateLimit from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { config } from '../config';
import { redis, KEYS } from '../redis/client';

// Once Redis has connected, fail fast during an outage instead of waiting
// in ioredis' offline queue, so passOnStoreError can let the request through
let redisWasReady = false;
redis.once('ready', () => { redisWasReady = true; });

const sendCommand = (command: string, ...args: string[]) => {
  if (redisWasReady && redis.status !== 'ready') {
    return Promise.reject(new Error('Redis unavailable'));
  }
  return redis.call(command, ...args) as Promise<RedisReply>;
};

// Counts live in Redis so every server instance shares them and they survive restarts
const redisStore = (name: string) =>
  new RedisStore({ sendCommand, prefix: KEYS.rateLimit(name) });

export const globalRateLimit = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore('global'),
  // If Redis is down, let requests through instead of failing every one
  passOnStoreError: true,
  message: { error: 'Too many requests, please slow down' },
});

export const bookingRateLimit = rateLimit({
  windowMs: config.rateLimit.bookingWindowMs,
  max: config.rateLimit.maxBookings,
  keyGenerator: (req) => req.user?.user_id ?? req.ip ?? 'unknown',
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore('booking'),
  passOnStoreError: true,
  message: { error: 'Booking rate limit exceeded' },
});
