import 'express-async-errors';
import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { globalRateLimit } from './middleware/rateLimiter';
import { requestLogger, errorHandler } from './middleware/requestLogger';
import { logger } from './utils/logger';
import { expiryWorker } from './workers/expiryWorker';
import { inventoryReconciler } from './workers/inventoryReconciler';
import { initWebSocketServer, closeWebSocketServer } from './services/websocket/wsService';
import { pool } from './db';
import { redis } from './redis/client';
import authRoutes from './routes/auth';
import eventRoutes from './routes/events';
import bookingRoutes from './routes/bookings';
import paymentRoutes from './routes/payments';
import adminRoutes from './routes/admin';
import { config } from './config';

const app = express();
const httpServer = http.createServer(app);

// Behind Render's proxy: use the client IP from X-Forwarded-For, not the proxy's
if (config.env === 'production') app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true }));
app.use(compression());

app.use(express.json({ limit: '1mb' }));

app.use(requestLogger);
app.use(globalRateLimit);

app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.use('/api/auth', authRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);

app.use(errorHandler);

async function start() {
  initWebSocketServer(httpServer);

  expiryWorker.start();
  inventoryReconciler.start();

  httpServer.listen(config.port, () => {
    logger.info('TicketVault backend running', { port: config.port, env: config.env });
  });
}

async function shutdown(signal: string) {
  logger.info(`${signal} received — shutting down gracefully`);

  setTimeout(() => {
    logger.warn('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();

  expiryWorker.stop();
  inventoryReconciler.stop();

  // io.close() disconnects all sockets and also closes the underlying HTTP server
  await closeWebSocketServer();
  httpServer.closeAllConnections();
  logger.info('HTTP server closed');

  await Promise.allSettled([pool.end(), redis.quit()]);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', {
    error: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

start().catch((err) => {
  logger.error('Fatal startup error', { error: err });
  process.exit(1);
});
