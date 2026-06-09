import { useEffect, useCallback, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useBookingStore } from '../store/bookingStore';
import { useCountdown } from '../hooks/useCountdown';
import { paymentsApi } from '../services/api';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { CountdownTimer } from '../components/common/CountdownTimer';
import { toast } from '../components/common/Toast';
import { CheckCircle, CreditCard, AlertCircle, Info, XCircle } from 'lucide-react';

type PaymentState = 'idle' | 'processing' | 'success' | 'failed';

export function CheckoutPage() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const navigate = useNavigate();
  const { reservationExpiresAt, clearActiveBooking } = useBookingStore();
  const { expired } = useCountdown(reservationExpiresAt);

  const [paymentState, setPaymentState] = useState<PaymentState>('idle');
  const [amount, setAmount] = useState<number | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!bookingId) return;
    paymentsApi.initiate(bookingId)
      .then(data => {
        setAmount(data.amount);
        setPaymentId(data.paymentId);
      })
      .catch(() => {
        toast.error('Could not load payment details');
        setPaymentState('failed');
      })
      .finally(() => setLoading(false));
  }, [bookingId]);

  const handleExpiry = useCallback(() => {
    clearActiveBooking();
    toast.error('Reservation expired', { description: 'Your seat hold timed out. Please try again.' });
    navigate('/');
  }, [clearActiveBooking, navigate]);

  useEffect(() => {
    if (expired) handleExpiry();
  }, [expired, handleExpiry]);

  const submit = async (success: boolean) => {
    if (!bookingId) return;
    setPaymentState('processing');
    try {
      await paymentsApi.simulate(bookingId, success);
      if (success) {
        setPaymentState('success');
        clearActiveBooking();
      } else {
        setPaymentState('failed');
        toast.error('Payment failed', { description: 'Your seat has been released.' });
        setTimeout(() => navigate('/'), 2000);
      }
    } catch {
      setPaymentState('failed');
      toast.error('Something went wrong');
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
            Your ticket is secured. A confirmation will be sent to your email.
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

        {loading ? (
          <div className="checkout-loading"><LoadingSpinner size="md" /></div>
        ) : (
          <>
            <div className="checkout-summary">
              <div className="checkout-row">
                <span className="label">Booking ID</span>
                <code style={{ fontSize: '0.78rem' }}>{bookingId?.slice(0, 8)}…</code>
              </div>
              {paymentId && (
                <div className="checkout-row">
                  <span className="label">Payment ID</span>
                  <code style={{ fontSize: '0.78rem' }}>{paymentId.slice(0, 12)}…</code>
                </div>
              )}
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
                <strong>Demo mode.</strong> Card collection via Stripe/Razorpay is out of scope
                for the public demo. Use the buttons below to simulate either outcome — both
                paths exercise the real reserve → confirm / release server flow.
              </span>
            </div>

            {paymentState === 'failed' && (
              <div className="alert alert-error" style={{ marginBottom: 14 }}>
                <AlertCircle size={14} className="alert-icon" />
                Payment failed — your seat has been released.
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                className="btn btn-primary btn-block btn-lg"
                onClick={() => submit(true)}
                disabled={paymentState === 'processing' || expired}
              >
                {paymentState === 'processing'
                  ? <><LoadingSpinner size="sm" /> Processing…</>
                  : <><CreditCard size={16} /> Simulate successful payment{amount ? ` · $${amount.toFixed(2)}` : ''}</>
                }
              </button>
              <button
                className="btn btn-secondary btn-block"
                onClick={() => submit(false)}
                disabled={paymentState === 'processing' || expired}
              >
                <XCircle size={16} /> Simulate failure
              </button>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}
