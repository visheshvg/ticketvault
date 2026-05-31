import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { eventsApi } from '../services/api';
import { useEventWebSocket } from '../hooks/useWebSocket';
import { useBookingStore } from '../store/bookingStore';
import { SeatMap } from '../components/booking/SeatMap';
import { BookingPanel } from '../components/booking/BookingPanel';
import { SurgeBadge } from '../components/common/SurgeBadge';
import { Skeleton } from '../components/common/Skeleton';
import { Calendar, MapPin, Users } from 'lucide-react';
import { format } from 'date-fns';

interface EventDetail {
  id: string;
  name: string;
  description: string;
  venue: string;
  total_seats: number;
  available_seats: number;
  base_price: number;
  current_price: number;
  starts_at: string;
  status: string;
}

interface SeatDetail {
  id: string;
  seat_number: string;
  section: string;
  row_label: string;
  status: 'available' | 'reserved' | 'booked';
}

export function EventPage() {
  const { id } = useParams<{ id: string }>();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [seats, setSeats] = useState<SeatDetail[]>([]);
  const [selectedSeat, setSelectedSeat] = useState<SeatDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const { selectSeat, setSeatStatuses, inventoryRemaining, currentPrice } = useBookingStore();

  useEventWebSocket(id ?? null);

  useEffect(() => {
    if (!id) return;
    Promise.all([eventsApi.getById(id), eventsApi.getSeats(id)])
      .then(([e, s]) => {
        setEvent(e as EventDetail);
        setSeats(s as SeatDetail[]);
        const statuses: Record<string, 'available' | 'reserved' | 'booked'> = {};
        (s as SeatDetail[]).forEach(seat => { statuses[seat.id] = seat.status; });
        setSeatStatuses(statuses);
      })
      .finally(() => setLoading(false));
  }, [id]);

  const liveInventory = inventoryRemaining ?? event?.available_seats ?? 0;
  const livePrice = currentPrice ?? event?.current_price ?? event?.base_price ?? 0;
  const isCriticallyLow = event && liveInventory < event.total_seats * 0.1;
  const isLow = event && liveInventory < event.total_seats * 0.2;

  return (
    <div className="page-content">
      <div className="container event-page">
        {/* Header */}
        <div className="event-page-header">
          {loading ? (
            <>
              <Skeleton height={36} width="55%" style={{ marginBottom: 14 }} />
              <Skeleton height={14} width="40%" style={{ marginBottom: 8 }} />
              <Skeleton height={14} width="30%" />
            </>
          ) : event ? (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
              <h1 className="event-page-title">{event.name}</h1>

              <div className="event-page-meta">
                <div className="event-page-meta-item">
                  <MapPin size={14} style={{ color: 'var(--accent-light)' }} />
                  {event.venue}
                </div>
                <div className="event-page-meta-item">
                  <Calendar size={14} style={{ color: 'var(--accent-light)' }} />
                  {format(new Date(event.starts_at), 'EEEE, MMMM d, yyyy · h:mm a')}
                </div>
                <div className="event-page-meta-item">
                  <Users size={14} style={{ color: 'var(--accent-light)' }} />
                  {event.total_seats.toLocaleString()} total seats
                </div>
              </div>

              <div className="event-live-row">
                <div className="inventory-pill">
                  <div className={`inventory-dot ${liveInventory === 0 ? 'out' : isLow ? 'low' : ''}`} />
                  {liveInventory === 0 ? 'Sold out' : `${liveInventory.toLocaleString()} seats available`}
                </div>
                <SurgeBadge basePrice={event.base_price} currentPrice={livePrice} />
                {isCriticallyLow && liveInventory > 0 && (
                  <span className="badge badge-urgent">Almost gone!</span>
                )}
              </div>
            </motion.div>
          ) : (
            <p style={{ color: 'var(--text-secondary)' }}>Event not found.</p>
          )}
        </div>

        {/* Main layout */}
        {event && (
          <div className="event-layout">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
              <SeatMap
                seats={seats}
                onSeatSelect={seat => {
                  setSelectedSeat(seat as SeatDetail);
                  selectSeat(seat.id);
                }}
              />
            </motion.div>

            <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 }}>
              <BookingPanel
                eventId={id!}
                seat={selectedSeat}
                basePrice={event.base_price}
                currentPrice={livePrice}
                onDeselect={() => {
                  setSelectedSeat(null);
                  selectSeat(null);
                }}
              />
            </motion.div>
          </div>
        )}
      </div>
    </div>
  );
}
