import { Server as HttpServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { redis } from '../../redis/client';
import { logger } from '../../utils/logger';
import jwt from 'jsonwebtoken';
import { config } from '../../config';
import { AuthPayload, SeatStatusUpdate } from '../../types';

let io: SocketServer | null = null;

export function initWebSocketServer(httpServer: HttpServer): SocketServer {
  // Use a separate Redis connection for the adapter (pub/sub blocks the main connection)
  const pubClient = redis.duplicate();
  const subClient = redis.duplicate();

  io = new SocketServer(httpServer, {
    cors: { origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true },
    adapter: createAdapter(pubClient, subClient),
    transports: ['websocket', 'polling'],
  });

  io.use((socket: Socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      const payload = jwt.verify(token, config.jwt.secret) as AuthPayload;
      (socket as Socket & { user?: AuthPayload }).user = payload;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: Socket) => {
    logger.debug('WebSocket connected', { socket_id: socket.id });

    socket.on('subscribe:event', (eventId: string) => {
      socket.join(`event:${eventId}`);
      logger.debug('Socket subscribed to event', { event_id: eventId, socket_id: socket.id });
    });

    socket.on('unsubscribe:event', (eventId: string) => {
      socket.leave(`event:${eventId}`);
    });

    socket.on('disconnect', () => {
      logger.debug('WebSocket disconnected', { socket_id: socket.id });
    });
  });

  logger.info('WebSocket server initialized');
  return io;
}

export function broadcastSeatUpdate(update: SeatStatusUpdate): void {
  if (!io) return;
  io.to(`event:${update.event_id}`).emit('seat:updated', update);
}

export function broadcastInventoryUpdate(eventId: string, remaining: number, currentPrice: number): void {
  if (!io) return;
  io.to(`event:${eventId}`).emit('inventory:updated', { eventId, remaining, currentPrice });
}
