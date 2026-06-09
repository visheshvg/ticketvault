import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { paymentService } from '../services/payment/paymentService';
import { authenticate } from '../middleware/auth';

const router = Router();

router.post('/initiate/:bookingId', authenticate, async (req: Request, res: Response) => {
  const result = await paymentService.initiatePayment(req.params.bookingId, req.user!.user_id);
  res.json(result);
});

const SimulateSchema = z.object({ success: z.boolean() });

router.post('/simulate/:bookingId', authenticate, async (req: Request, res: Response) => {
  const parsed = SimulateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  await paymentService.simulatePayment(req.params.bookingId, req.user!.user_id, parsed.data.success);
  res.json({ ok: true });
});

export default router;
