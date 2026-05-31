import { Router, Request, Response } from 'express';
import { paymentService } from '../services/payment/paymentService';
import { authenticate } from '../middleware/auth';

const router = Router();

router.post('/create-intent/:bookingId', authenticate, async (req: Request, res: Response) => {
  const result = await paymentService.createPaymentIntent(req.params.bookingId, req.user!.user_id);
  res.json(result);
});

// express.raw() applied in server.ts for this path — raw body required for Stripe signature check
router.post('/webhook', async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'] as string;
  if (!sig) return res.status(400).json({ error: 'Missing stripe-signature header' });

  try {
    await paymentService.handleWebhook(req.body as Buffer, sig);
    res.json({ received: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

export default router;
