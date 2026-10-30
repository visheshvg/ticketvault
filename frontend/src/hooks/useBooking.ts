import { useState, useCallback, useRef } from 'react';
import { bookingsApi, generateIdempotencyKey } from '../services/api';
import { useBookingStore } from '../store/bookingStore';

export function useBooking() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { setActiveBooking } = useBookingStore();
  // One key per seat attempt, reused on retry so the server never books twice
  const attempt = useRef<{ seat: string; key: string } | null>(null);

  const createBooking = useCallback(async (eventId: string, seatId: string) => {
    const seat = `${eventId}:${seatId}`;
    if (attempt.current?.seat !== seat) {
      attempt.current = { seat, key: generateIdempotencyKey() };
    }

    setLoading(true);
    setError(null);
    try {
      const result = await bookingsApi.create(eventId, seatId, attempt.current.key);
      attempt.current = null;
      if (result.status === 'pending' && result.expires_at) {
        setActiveBooking(result.booking_id, new Date(result.expires_at));
      }
      return result;
    } catch (err: unknown) {
      const res = (err as { response?: { status: number; data?: { error?: string } } })?.response;
      // Keep the key only for retryable failures (network error or 5xx)
      if (res && res.status < 500) attempt.current = null;
      setError(res?.data?.error ?? 'Booking failed. Please try again.');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [setActiveBooking]);

  return { createBooking, loading, error };
}
