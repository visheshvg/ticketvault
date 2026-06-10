import { Router, Request, Response } from 'express';
import { bookingService } from '../services/booking/bookingService';
import { authenticate } from '../middleware/auth';
import { bookingRateLimit } from '../middleware/rateLimiter';
import { z } from 'zod';

const router = Router();

const CreateBookingSchema = z.object({
  event_id: z.string().uuid(),
  seat_id: z.string().uuid(),
});

router.use(authenticate);

router.post('/', bookingRateLimit, async (req: Request, res: Response) => {
  const parsed = CreateBookingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const idempotencyKey = req.headers['idempotency-key'] as string;
  if (!idempotencyKey) return res.status(400).json({ error: 'Idempotency-Key header required' });

  const result = await bookingService.createBooking(req.user!.user_id, parsed.data, idempotencyKey);
  res.status(result.status === 'queued' ? 202 : 201).json(result);
});

router.get('/', async (req: Request, res: Response) => {
  const bookings = await bookingService.getUserBookings(req.user!.user_id);
  res.json({ bookings });
});

router.delete('/:id', async (req: Request, res: Response) => {
  await bookingService.cancelBooking(req.params.id, req.user!.user_id);
  res.json({ message: 'Booking cancelled successfully' });
});

export default router;
