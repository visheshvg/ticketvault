import rateLimit from 'express-rate-limit';
import { config } from '../config';

export const globalRateLimit = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down' },
});

export const bookingRateLimit = rateLimit({
  windowMs: config.rateLimit.bookingWindowMs,
  max: config.rateLimit.maxBookings,
  keyGenerator: (req) => req.user?.user_id ?? req.ip ?? 'unknown',
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Booking rate limit exceeded' },
});
