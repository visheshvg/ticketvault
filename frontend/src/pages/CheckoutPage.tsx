import { useEffect, useCallback, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useBookingStore } from '../store/bookingStore';
import { useCountdown } from '../hooks/useCountdown';
import { paymentsApi } from '../services/api';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { CountdownTimer } from '../components/common/CountdownTimer';
import { toast } from '../components/common/Toast';
import { CheckCircle, CreditCard, AlertCircle, Info, Lock } from 'lucide-react';

type PaymentState = 'idle' | 'processing' | 'success' | 'failed';

export function CheckoutPage() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const navigate = useNavigate();
  const { reservationExpiresAt, clearActiveBooking } = useBookingStore();
  const { expired } = useCountdown(reservationExpiresAt);

  const [paymentState, setPaymentState] = useState<PaymentState>('idle');
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [loadingIntent, setLoadingIntent] = useState(true);

  useEffect(() => {
    if (!bookingId) return;
    paymentsApi.createIntent(bookingId)
      .then(data => {
        setClientSecret(data.clientSecret);
        setAmount(data.amount);
      })
      .catch(() => {
        toast.error('Could not load payment details');
        setPaymentState('failed');
      })
      .finally(() => setLoadingIntent(false));
  }, [bookingId]);

  const handleExpiry = useCallback(() => {
    clearActiveBooking();
    toast.error('Reservation expired', { description: 'Your seat hold timed out. Please try again.' });
    navigate('/');
  }, [clearActiveBooking, navigate]);

  useEffect(() => {
    if (expired) handleExpiry();
  }, [expired, handleExpiry]);

  const handleDemoPayment = async () => {
    if (!bookingId || !clientSecret) return;
    setPaymentState('processing');
    try {
      // In production: stripe.confirmPayment({ elements, confirmParams })
      // The webhook handler at POST /api/payments/webhook confirms the booking.
      await new Promise(r => setTimeout(r, 1800));
      setPaymentState('success');
      clearActiveBooking();
    } catch {
      setPaymentState('failed');
      toast.error('Payment failed', { description: 'Your seat is still reserved. Try again.' });
    }
  };

  if (paymentState === 'success') {
    return (
      <div className="success-page">
        <motion.div
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 18 }}
          className="success-icon-wrap"
        >
          <CheckCircle size={36} />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <h2 className="success-title">Booking Confirmed!</h2>
          <p className="success-sub" style={{ marginBottom: 24 }}>
            Your ticket is secured. A confirmation has been sent to your email.
          </p>
          <button className="btn btn-primary" onClick={() => navigate('/bookings')}>
            View My Tickets
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="checkout-page">
      <motion.div
        className="checkout-card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        <h2 className="checkout-title">Complete Payment</h2>

        {reservationExpiresAt && !expired && (
          <div style={{ marginBottom: 18 }}>
            <CountdownTimer expiresAt={reservationExpiresAt} onExpire={handleExpiry} />
          </div>
        )}

        {loadingIntent ? (
          <div className="checkout-loading"><LoadingSpinner size="md" /></div>
        ) : (
          <>
            <div className="checkout-summary">
              <div className="checkout-row">
                <span className="label">Booking ID</span>
                <code style={{ fontSize: '0.78rem' }}>{bookingId?.slice(0, 8)}…</code>
              </div>
              {amount !== null && (
                <div className="checkout-row total">
                  <span className="label">Total due</span>
                  <span className="value">${amount.toFixed(2)}</span>
                </div>
              )}
            </div>

            <div className="alert alert-info" style={{ marginBottom: 16 }}>
              <Info size={14} className="alert-icon" style={{ flexShrink: 0, color: 'var(--accent-light)' }} />
              <span style={{ fontSize: '0.82rem', lineHeight: 1.5 }}>
                <strong>Demo mode.</strong> In production, Stripe Elements renders here using the
                PaymentIntent <code>clientSecret</code> returned from{' '}
                <code>/api/payments/create-intent</code>.
              </span>
            </div>

            <div style={{
              background: 'var(--bg-elevated)',
              border: '1px dashed var(--border)',
              borderRadius: 'var(--r-md)',
              padding: '20px',
              textAlign: 'center',
              marginBottom: 16,
              color: 'var(--text-muted)',
              fontSize: '0.82rem',
            }}>
              <Lock size={16} style={{ marginBottom: 6, opacity: 0.4 }} />
              <div>Stripe Elements card form</div>
              <div style={{ fontSize: '0.74rem', marginTop: 4, opacity: 0.6 }}>
                clientSecret: {clientSecret?.slice(0, 24)}…
              </div>
            </div>

            {paymentState === 'failed' && (
              <div className="alert alert-error" style={{ marginBottom: 14 }}>
                <AlertCircle size={14} className="alert-icon" />
                Payment failed. Your seat is still reserved — please try again.
              </div>
            )}

            <button
              className="btn btn-primary btn-block btn-lg"
              onClick={handleDemoPayment}
              disabled={paymentState === 'processing' || expired || !clientSecret}
            >
              {paymentState === 'processing'
                ? <><LoadingSpinner size="sm" /> Processing…</>
                : <><CreditCard size={16} /> Simulate Payment{amount ? ` · $${amount.toFixed(2)}` : ''}</>
              }
            </button>

            <p style={{ fontSize: '0.73rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: 12 }}>
              <Lock size={10} style={{ display: 'inline', marginRight: 3, verticalAlign: 'middle' }} />
              Secured by Stripe. Your card details are never stored on our servers.
            </p>
          </>
        )}
      </motion.div>
    </div>
  );
}
