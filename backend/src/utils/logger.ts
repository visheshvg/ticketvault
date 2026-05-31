import winston from 'winston';
import { config } from '../config';

const { combine, timestamp, json, colorize, simple } = winston.format;

export const logger = winston.createLogger({
  level: config.env === 'production' ? 'info' : 'debug',
  format: combine(timestamp(), json()),
  defaultMeta: { service: 'ticketvault' },
  transports: [
    new winston.transports.Console({
      format: config.env === 'development' ? combine(colorize(), simple()) : combine(timestamp(), json()),
    }),
  ],
});

export const bookingLogger = logger.child({ component: 'booking' });
export const paymentLogger = logger.child({ component: 'payment' });
export const workerLogger  = logger.child({ component: 'worker' });
