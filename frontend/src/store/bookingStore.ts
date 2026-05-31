import { create } from 'zustand';

interface SeatStatuses {
  [seatId: string]: 'available' | 'reserved' | 'booked';
}

interface BookingStore {
  selectedSeatId: string | null;
  seatStatuses: SeatStatuses;
  inventoryRemaining: number | null;
  currentPrice: number | null;
  activeBookingId: string | null;
  reservationExpiresAt: Date | null;
  selectSeat: (seatId: string | null) => void;
  updateSeatStatus: (seatId: string, status: 'available' | 'reserved' | 'booked') => void;
  updateInventory: (remaining: number, price: number) => void;
  setActiveBooking: (bookingId: string, expiresAt: Date) => void;
  clearActiveBooking: () => void;
  setSeatStatuses: (statuses: SeatStatuses) => void;
}

export const useBookingStore = create<BookingStore>((set) => ({
  selectedSeatId: null,
  seatStatuses: {},
  inventoryRemaining: null,
  currentPrice: null,
  activeBookingId: null,
  reservationExpiresAt: null,

  selectSeat: (seatId) => set({ selectedSeatId: seatId }),

  updateSeatStatus: (seatId, status) =>
    set((state) => ({ seatStatuses: { ...state.seatStatuses, [seatId]: status } })),

  updateInventory: (remaining, price) =>
    set({ inventoryRemaining: remaining, currentPrice: price }),

  setActiveBooking: (bookingId, expiresAt) =>
    set({ activeBookingId: bookingId, reservationExpiresAt: expiresAt }),

  clearActiveBooking: () =>
    set({ activeBookingId: null, reservationExpiresAt: null }),

  setSeatStatuses: (statuses) => set({ seatStatuses: statuses }),
}));
