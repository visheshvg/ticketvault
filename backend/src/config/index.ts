import dotenv from 'dotenv';
dotenv.config();

function jwtSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'test') return 'test-secret';
  throw new Error('JWT_SECRET is not set');
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'ticketvault',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    max: parseInt(process.env.DB_POOL_MAX || '20', 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },

  jwt: {
    secret: jwtSecret(),
    expiresIn: '24h',
  },

  reservation: {
    ttlSeconds: parseInt(process.env.RESERVATION_TTL_SECONDS || '600', 10),
    idempotencyTtlSeconds: 86400,
    workerIntervalMs: 30000,
  },

  waitlist: {
    // Waiters get a short hold, so a seat doesn't sit unsold on someone who isn't there
    offerTtlSeconds: parseInt(process.env.WAITLIST_OFFER_TTL_SECONDS || '120', 10),
    // After this many unanswered offers the seat goes back on sale for everyone
    maxOffers: parseInt(process.env.WAITLIST_MAX_OFFERS || '3', 10),
  },

  rateLimit: {
    windowMs: 60_000,
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
    bookingWindowMs: 60_000,
    maxBookings: parseInt(process.env.BOOKING_RATE_LIMIT_MAX || '5', 10),
  },

  pricing: {
    tiers: [
      { threshold: 0.5, multiplier: 1.0 },
      { threshold: 0.2, multiplier: 1.3 },
      { threshold: 0.1, multiplier: 1.6 },
      { threshold: 0.0, multiplier: 2.0 },
    ],
  },
} as const;
