import { useState, useCallback } from 'react';
import { bookingsApi, generateIdempotencyKey } from '../services/api';
import { useBookingStore } from '../store/bookingStore';

export function useBooking() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { setActiveBooking } = useBookingStore();

  const createBooking = useCallback(async (eventId: string, seatId: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await bookingsApi.create(eventId, seatId, generateIdempotencyKey());
      if (result.status === 'pending' && result.expires_at) {
        setActiveBooking(result.booking_id, new Date(result.expires_at));
      }
      return result;
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? 'Booking failed. Please try again.';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [setActiveBooking]);

  return { createBooking, loading, error };
}
