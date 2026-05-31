import dotenv from 'dotenv';
dotenv.config();

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

  kafka: {
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
    clientId: 'ticketvault',
    groupId: 'ticketvault-consumers',
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'change-me-in-production',
    expiresIn: '24h',
  },

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || 'whsec_placeholder',
  },

  reservation: {
    ttlSeconds: parseInt(process.env.RESERVATION_TTL_SECONDS || '600', 10),
    idempotencyTtlSeconds: 86400,
    workerIntervalMs: 30000,
  },

  rateLimit: {
    windowMs: 60_000,
    maxRequests: 100,
    bookingWindowMs: 60_000,
    maxBookings: 5,
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
