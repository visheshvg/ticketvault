import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import { toast } from '../components/common/Toast';
import { useAuthStore } from '../store/authStore';
import { useBookingStore } from '../store/bookingStore';

export function useEventWebSocket(eventId: string | null) {
  const socketRef = useRef<Socket | null>(null);
  const { token } = useAuthStore();
  const updateSeatStatus = useBookingStore((s) => s.updateSeatStatus);
  const updateInventory = useBookingStore((s) => s.updateInventory);
  const setActiveBooking = useBookingStore((s) => s.setActiveBooking);
  const navigate = useNavigate();

  useEffect(() => {
    if (!eventId || !token) return;

    const socket = io(import.meta.env.VITE_API_URL || '/', {
      auth: { token },
      transports: ['websocket'],
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('subscribe:event', eventId);
    });

    socket.on('seat:updated', (data: { seat_id: string; status: 'available' | 'reserved' | 'booked' }) => {
      updateSeatStatus(data.seat_id, data.status);
    });

    socket.on('inventory:updated', (data: { remaining: number; currentPrice: number }) => {
      updateInventory(data.remaining, data.currentPrice);
    });

    // Sent only to this user when a seat from the waitlist is held for them
    socket.on('waitlist:offered', (offer: { booking_id: string; seat_number: string; section: string; expires_at: string }) => {
      const expiresAt = new Date(offer.expires_at);
      const minutes = Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / 60_000));
      setActiveBooking(offer.booking_id, expiresAt);
      toast.success('A seat opened up for you!', {
        description: `${offer.section} · Seat ${offer.seat_number} is held for you. Pay within ${minutes} min or it goes to the next person.`,
        duration: Infinity,
        action: { label: 'Pay now', onClick: () => navigate(`/checkout/${offer.booking_id}`) },
      });
    });

    // Nobody on the waitlist took the seat in time, so it's open to everyone again
    socket.on('waitlist:seat_available', (seat: { seat_number: string; section: string }) => {
      toast.info('A seat is available', {
        description: `${seat.section} · Seat ${seat.seat_number} is back on sale. First to book gets it.`,
      });
    });

    socket.on('connect_error', (err) => {
      console.warn('WebSocket connection error:', err.message);
    });

    return () => {
      socket.emit('unsubscribe:event', eventId);
      socket.disconnect();
    };
  }, [eventId, token, updateSeatStatus, updateInventory, setActiveBooking, navigate]);

  return socketRef.current;
}
