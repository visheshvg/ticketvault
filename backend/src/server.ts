// Tracing must be first — patches Express, pg, ioredis before they are imported
import { initTracing, shutdownTracing } from './utils/tracing';
initTracing();

import 'express-async-errors';
import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { globalRateLimit } from './middleware/rateLimiter';
import { requestLogger, errorHandler } from './middleware/requestLogger';
import { register } from './utils/metrics';
import { logger } from './utils/logger';
import { expiryWorker } from './workers/expiryWorker';
import { initWebSocketServer } from './services/websocket/wsService';
import authRoutes from './routes/auth';
import eventRoutes from './routes/events';
import bookingRoutes from './routes/bookings';
import paymentRoutes from './routes/payments';
import adminRoutes from './routes/admin';
import { config } from './config';

const app = express();
const httpServer = http.createServer(app);

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true }));
app.use(compression());

app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '1mb' }));

app.use(requestLogger);
app.use(globalRateLimit);

app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.send(await register.metrics());
});

app.use('/api/auth', authRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);

app.use(errorHandler);

async function start() {
  initWebSocketServer(httpServer);

  expiryWorker.start();

  httpServer.listen(config.port, () => {
    logger.info('TicketVault backend running', { port: config.port, env: config.env });
  });
}

async function shutdown(signal: string) {
  logger.info(`${signal} received — shutting down gracefully`);

  expiryWorker.stop();

  await shutdownTracing();

  httpServer.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });

  setTimeout(() => {
    logger.warn('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

start().catch((err) => {
  logger.error('Fatal startup error', { error: err });
  process.exit(1);
});
