import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { HttpError } from '../utils/httpErrors';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    logger.info('HTTP request', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration_ms: Date.now() - start,
      user_id: req.user?.user_id,
    });
  });

  next();
}

export function errorHandler(err: Error & { code?: string }, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  // Postgres SELECT FOR UPDATE NOWAIT failed because another tx holds the lock
  if (err.code === '55P03') {
    res.status(423).json({ error: 'Resource is locked, please retry' });
    return;
  }

  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });
  res.status(500).json({ error: 'Internal server error' });
}
