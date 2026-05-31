import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { bookingsApi } from '../services/api';
import { Skeleton } from '../components/common/Skeleton';
import { toast } from '../components/common/Toast';
import { format } from 'date-fns';
import { Ticket, MapPin, Calendar, Hash, DollarSign, XCircle, CheckCircle, Clock, AlertTriangle } from 'lucide-react';

interface Booking {
  id: string;
  event_name: string;
  venue: string;
  seat_number: string;
  section: string;
  row_label: string;
  status: 'pending' | 'confirmed' | 'cancelled' | 'expired' | 'compensated';
  amount_paid: number;
  starts_at: string;
  created_at: string;
}

const STATUS_CONFIG: Record<string, { label: string; badge: string; icon: typeof CheckCircle }> = {
  confirmed:   { label: 'Confirmed',   badge: 'badge-success', icon: CheckCircle },
  pending:     { label: 'Reserved',    badge: 'badge-warning', icon: Clock },
  cancelled:   { label: 'Cancelled',   badge: 'badge-muted',   icon: XCircle },
  expired:     { label: 'Expired',     badge: 'badge-error',   icon: AlertTriangle },
  compensated: { label: 'Refunded',    badge: 'badge-error',   icon: AlertTriangle },
};

export function BookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const fetchBookings = useCallback(() => {
    setLoading(true);
    bookingsApi.list()
      .then(setBookings)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchBookings(); }, [fetchBookings]);

  const handleCancel = async (id: string, eventName: string) => {
    const confirmed = window.confirm === undefined
      ? true
      : await new Promise<boolean>(resolve => {
          // Use a custom confirmation rather than the browser dialog
          resolve(window.confirm(`Cancel your booking for "${eventName}"?`));
        });
    if (!confirmed) return;

    setCancelling(id);
    try {
      await bookingsApi.cancel(id);
      toast.success('Booking cancelled', { description: 'Your seat has been released.' });
      fetchBookings();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? 'Cancellation failed';
      toast.error(msg);
    } finally {
      setCancelling(null);
    }
  };

  const activeBookings = bookings.filter(b => b.status === 'confirmed' || b.status === 'pending');
  const pastBookings   = bookings.filter(b => !['confirmed','pending'].includes(b.status));

  return (
    <div className="page-content">
      <div className="container page-section">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
          <h1 className="page-heading" style={{ marginBottom: 0 }}>My Tickets</h1>
          {!loading && (
            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              {bookings.length} booking{bookings.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[1, 2].map(i => (
              <div key={i} className="card" style={{ padding: 22 }}>
                <Skeleton height={18} width="50%" style={{ marginBottom: 12 }} />
                <Skeleton height={12} width="35%" style={{ marginBottom: 6 }} />
                <Skeleton height={12} width="45%" />
              </div>
            ))}
          </div>
        ) : !bookings.length ? (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="empty-state"
            style={{ minHeight: 360 }}
          >
            <div className="empty-state-icon"><Ticket size={28} /></div>
            <p className="empty-state-title">No bookings yet</p>
            <p className="empty-state-sub">Browse upcoming events and reserve your first seat.</p>
            <Link to="/" className="btn btn-primary" style={{ marginTop: 8 }}>
              Browse Events
            </Link>
          </motion.div>
        ) : (
          <>
            {activeBookings.length > 0 && (
              <section style={{ marginBottom: 36 }}>
                <p style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: 14 }}>
                  Active
                </p>
                <div className="bookings-list">
                  <AnimatePresence>
                    {activeBookings.map(b => (
                      <BookingCard
                        key={b.id}
                        booking={b}
                        onCancel={handleCancel}
                        isCancelling={cancelling === b.id}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              </section>
            )}

            {pastBookings.length > 0 && (
              <section>
                <p style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: 14 }}>
                  Past
                </p>
                <div className="bookings-list" style={{ opacity: 0.7 }}>
                  {pastBookings.map(b => (
                    <BookingCard
                      key={b.id}
                      booking={b}
                      onCancel={handleCancel}
                      isCancelling={cancelling === b.id}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function BookingCard({
  booking: b,
  onCancel,
  isCancelling,
}: {
  booking: Booking;
  onCancel: (id: string, name: string) => void;
  isCancelling: boolean;
}) {
  const cfg = STATUS_CONFIG[b.status] ?? STATUS_CONFIG.cancelled;
  const StatusIcon = cfg.icon;
  const canCancel = ['pending', 'confirmed'].includes(b.status);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.25 }}
      className="card booking-card"
    >
      <div className="booking-card-main">
        <p className="booking-event-name">{b.event_name}</p>
        <div className="booking-meta">
          <span className="booking-meta-item">
            <MapPin size={12} style={{ color: 'var(--accent-light)' }} />
            {b.venue}
          </span>
          <span className="booking-meta-item">
            <Calendar size={12} style={{ color: 'var(--accent-light)' }} />
            {format(new Date(b.starts_at), 'MMM d, yyyy · h:mm a')}
          </span>
          <span className="booking-meta-item">
            <Ticket size={12} style={{ color: 'var(--accent-light)' }} />
            {b.section} · Row {b.row_label} · Seat {b.seat_number}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className={`badge ${cfg.badge}`}>
            <StatusIcon size={10} />
            {cfg.label}
          </span>
          <span className="booking-id-tag">
            <Hash size={9} style={{ display: 'inline' }} />
            {b.id.slice(0, 8)}
          </span>
        </div>
      </div>

      <div className="booking-card-side">
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <DollarSign size={14} style={{ color: 'var(--text-muted)' }} />
          <span className="booking-amount">{Number(b.amount_paid).toFixed(2)}</span>
        </div>

        {canCancel && (
          <button
            className="btn btn-danger btn-sm"
            onClick={() => onCancel(b.id, b.event_name)}
            disabled={isCancelling}
          >
            {isCancelling ? 'Cancelling…' : <>
              <XCircle size={13} /> Cancel
            </>}
          </button>
        )}
      </div>
    </motion.div>
  );
}
