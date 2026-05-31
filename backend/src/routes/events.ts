import { Router, Request, Response } from 'express';
import { eventService } from '../services/event/eventService';
import { authenticate, requireAdmin } from '../middleware/auth';
import { z } from 'zod';

const router = Router();

const CreateEventSchema = z.object({
  name: z.string().min(3),
  description: z.string().optional(),
  venue: z.string().min(3),
  total_seats: z.number().int().min(1).max(100000),
  base_price: z.number().positive(),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime(),
});

router.get('/', async (_req: Request, res: Response) => {
  const events = await eventService.getEvents();
  res.json({ events });
});

router.get('/:id', async (req: Request, res: Response) => {
  const event = await eventService.getEventById(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  res.json({ event });
});

router.get('/:id/seats', async (req: Request, res: Response) => {
  const seats = await eventService.getSeatsForEvent(req.params.id);
  res.json({ seats });
});

router.post('/', authenticate, requireAdmin, async (req: Request, res: Response) => {
  const parsed = CreateEventSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const event = await eventService.createEvent(parsed.data);
  res.status(201).json({ event });
});

export default router;
