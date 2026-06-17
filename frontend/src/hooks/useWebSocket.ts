import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../store/authStore';
import { useBookingStore } from '../store/bookingStore';

export function useEventWebSocket(eventId: string | null) {
  const socketRef = useRef<Socket | null>(null);
  const { token } = useAuthStore();
  const updateSeatStatus = useBookingStore((s) => s.updateSeatStatus);
  const updateInventory = useBookingStore((s) => s.updateInventory);

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

    socket.on('connect_error', (err) => {
      console.warn('WebSocket connection error:', err.message);
    });

    return () => {
      socket.emit('unsubscribe:event', eventId);
      socket.disconnect();
    };
  }, [eventId, token, updateSeatStatus, updateInventory]);

  return socketRef.current;
}
