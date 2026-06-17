import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { eventsApi } from '../services/api';
import { SurgeBadge } from '../components/common/SurgeBadge';
import { EventCardSkeleton } from '../components/common/Skeleton';
import { Calendar, MapPin, Users, Zap, Clock, Shield } from 'lucide-react';
import { format } from 'date-fns';

interface Event {
  id: string;
  name: string;
  description: string;
  venue: string;
  total_seats: number;
  available_seats: number;
  base_price: number;
  current_price: number;
  starts_at: string;
}

const STAGGER = { animate: { transition: { staggerChildren: 0.07 } } };
const FADE_UP = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
};

export function HomePage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    eventsApi.list().then(setEvents).finally(() => setLoading(false));
  }, []);

  return (
    <div className="page-content">
      {/* Hero */}
      <div className="hero">
        <div className="container">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <div className="hero-eyebrow">
              <Zap size={11} /> Concurrency-safe booking
            </div>
            <h1 className="hero-title">
              Find Your Next<br />Live Experience
            </h1>
            <p className="hero-sub">
              Atomic seat reservations. Zero double-bookings.<br />
              Real-time seat maps powered by WebSocket.
            </p>
          </motion.div>

          <motion.div
            className="hero-stats"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3, duration: 0.5 }}
          >
            {[
              { value: '155ms', label: 'p99 booking latency' },
              { value: '0', label: 'double-bookings' },
              { value: '500', label: 'concurrent users tested' },
              { value: '550/s', label: 'sustained throughput' },
            ].map(s => (
              <div className="hero-stat" key={s.label}>
                <div className="hero-stat-value">{s.value}</div>
                <div className="hero-stat-label">{s.label}</div>
              </div>
            ))}
          </motion.div>
        </div>
      </div>

      {/* Feature pills */}
      <div className="container">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 36 }}>
          {[
            { icon: Shield, label: 'Idempotent retries' },
            { icon: Clock, label: '10-min seat hold' },
            { icon: Zap, label: 'Surge pricing live' },
            { icon: Users, label: 'Waitlist queue' },
          ].map(({ icon: Icon, label }) => (
            <div key={label} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '5px 12px',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-full)',
              fontSize: '0.78rem',
              color: 'var(--text-secondary)',
            }}>
              <Icon size={12} style={{ color: 'var(--accent-light)' }} />
              {label}
            </div>
          ))}
        </div>

        <div className="section-header">
          <h2 className="section-title">Upcoming Events</h2>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            {loading ? '—' : `${events.length} available`}
          </span>
        </div>

        <motion.div className="events-grid" variants={STAGGER} initial="initial" animate="animate">
          {loading
            ? Array.from({ length: 3 }, (_, i) => <EventCardSkeleton key={i} />)
            : events.map(event => (
                <EventCard key={event.id} event={event} />
              ))
          }
        </motion.div>

        {!loading && !events.length && (
          <div className="page-center" style={{ minHeight: 280 }}>
            <div className="empty-state-icon"><Calendar size={28} /></div>
            <p className="empty-state-title">No events yet</p>
            <p className="empty-state-sub">Check back soon or log in as admin to create one.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function EventCard({ event }: { event: Event }) {
  const isSoldOut = event.available_seats === 0;
  const soldPct = event.total_seats > 0
    ? Math.round(((event.total_seats - event.available_seats) / event.total_seats) * 100)
    : 0;
  const isLow = soldPct > 70 && !isSoldOut;
  const barColor = isSoldOut ? 'var(--error)' : isLow ? 'var(--warning)' : 'var(--accent)';

  return (
    <motion.div variants={FADE_UP} className="card card-hover event-card">
      <div className="event-card-top">
        <div />
        {isSoldOut ? (
          <span className="badge badge-error">Sold Out</span>
        ) : isLow ? (
          <span className="badge badge-urgent">
            <Zap size={9} /> {event.available_seats} left
          </span>
        ) : (
          <span className="badge badge-accent">{event.available_seats} seats</span>
        )}
      </div>

      <h2 className="event-card-title">{event.name}</h2>
      <p className="event-card-desc">{event.description}</p>

      <div className="event-card-meta">
        <div className="event-meta-item">
          <MapPin size={13} style={{ color: 'var(--accent-light)', flexShrink: 0 }} />
          {event.venue}
        </div>
        <div className="event-meta-item">
          <Calendar size={13} style={{ color: 'var(--accent-light)', flexShrink: 0 }} />
          {format(new Date(event.starts_at), 'EEE, MMM d · h:mm a')}
        </div>
        <div className="event-meta-item">
          <Users size={13} style={{ color: 'var(--accent-light)', flexShrink: 0 }} />
          {event.total_seats.toLocaleString()} total seats
        </div>
      </div>

      <div className="event-card-footer">
        <SurgeBadge basePrice={event.base_price} currentPrice={event.current_price ?? event.base_price} />
        <Link
          to={`/events/${event.id}`}
          className={`btn btn-sm ${isSoldOut ? 'btn-secondary' : 'btn-primary'}`}
        >
          {isSoldOut ? 'Join Waitlist' : 'Select Seats'}
        </Link>
      </div>

      <div className="demand-track" style={{ marginTop: 14 }}>
        <div
          className="demand-fill"
          style={{ width: `${soldPct}%`, background: barColor }}
        />
      </div>
    </motion.div>
  );
}
