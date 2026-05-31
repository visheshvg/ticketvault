import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useBooking } from '../../hooks/useBooking';
import { SurgeBadge } from '../common/SurgeBadge';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { toast } from '../common/Toast';
import { MousePointerClick, ShoppingCart, Clock, Bell, AlertCircle, X } from 'lucide-react';

interface Seat {
  id: string;
  seat_number: string;
  section: string;
  row_label: string;
}

interface Props {
  eventId: string;
  seat: Seat | null;
  basePrice: number;
  currentPrice: number;
  onDeselect: () => void;
}

export function BookingPanel({ eventId, seat, basePrice, currentPrice, onDeselect }: Props) {
  const { createBooking, loading, error } = useBooking();
  const navigate = useNavigate();
  const [queued, setQueued] = useState(false);

  const handleBook = async () => {
    if (!seat) return;
    try {
      const result = await createBooking(eventId, seat.id);
      if (result.status === 'queued') {
        setQueued(true);
        toast.success('Added to waitlist', {
          description: `You're #${result.queue_position} in line. We'll email you when a seat opens.`,
        });
      } else {
        toast.success('Seat reserved!', { description: '10 minutes to complete payment.' });
        navigate(`/checkout/${result.booking_id}`);
      }
    } catch {
      // error shown inline
    }
  };

  return (
    <div className="booking-panel">
      <AnimatePresence mode="wait">
        {!seat ? (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="booking-panel-empty"
          >
            <MousePointerClick size={36} />
            <p><strong>Select a seat</strong><br />Click any available seat on the map to begin.</p>
          </motion.div>
        ) : queued ? (
          <motion.div
            key="queued"
            initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
            className="queued-state"
          >
            <div className="queued-icon"><Bell size={22} /></div>
            <p className="queued-title">You're in the queue!</p>
            <p className="queued-desc">
              All seats are currently held. We'll send you an email the moment one becomes available.
            </p>
            <button
              className="btn btn-secondary btn-sm"
              style={{ marginTop: 16 }}
              onClick={() => { setQueued(false); onDeselect(); }}
            >
              Back to map
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1rem' }}>
                Selected Seat
              </h3>
              <button className="btn btn-icon btn-ghost" onClick={onDeselect} aria-label="Deselect seat">
                <X size={15} />
              </button>
            </div>

            <div className="panel-seat-grid">
              {[
                { label: 'Section', value: seat.section },
                { label: 'Row',     value: seat.row_label },
                { label: 'Seat',    value: seat.seat_number },
              ].map(({ label, value }) => (
                <div key={label} className="panel-seat-item">
                  <div className="panel-seat-item-label">{label}</div>
                  <div className="panel-seat-item-value">{value}</div>
                </div>
              ))}
            </div>

            <div className="panel-price-row">
              <span className="panel-price-label">Price</span>
              <SurgeBadge basePrice={basePrice} currentPrice={currentPrice} />
            </div>

            {error && (
              <div className="alert alert-error" style={{ marginBottom: 14 }}>
                <AlertCircle size={14} className="alert-icon" />
                <span>{error}</span>
              </div>
            )}

            <button
              className="btn btn-primary btn-block btn-lg"
              onClick={handleBook}
              disabled={loading}
            >
              {loading
                ? <><LoadingSpinner size="sm" /> Reserving…</>
                : <><ShoppingCart size={16} /> Reserve for ${currentPrice.toFixed(2)}</>
              }
            </button>

            <div className="panel-hint">
              <Clock size={11} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
              Seat held for 10 minutes. Complete payment to confirm.
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
