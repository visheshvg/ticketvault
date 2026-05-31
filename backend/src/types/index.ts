export interface User {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  created_at: Date;
}

export interface Event {
  id: string;
  name: string;
  description: string;
  venue: string;
  total_seats: number;
  // available_seats is NOT a stored column — always derived from seats.status or Redis cache
  available_seats: number;
  base_price: number;
  current_price: number;
  starts_at: Date;
  ends_at: Date;
  status: 'draft' | 'published' | 'cancelled' | 'completed';
  version: number;
  created_at: Date;
}

export interface Seat {
  id: string;
  event_id: string;
  seat_number: string;
  section: string;
  row_label: string;
  status: 'available' | 'reserved' | 'booked';
  reserved_until: Date | null;
  version: number;
}

export interface Booking {
  id: string;
  user_id: string;
  seat_id: string;
  event_id: string;
  status: 'pending' | 'confirmed' | 'cancelled' | 'expired' | 'compensated';
  idempotency_key: string;
  amount_paid: number;
  stripe_payment_intent_id: string | null;
  created_at: Date;
  expires_at: Date;
  confirmed_at: Date | null;
}

export interface BookingAuditLog {
  id: number;
  booking_id: string;
  old_status: string | null;
  new_status: string;
  changed_at: Date;
  reason: string;
  metadata: Record<string, unknown>;
}

export interface PriceTier {
  threshold: number;
  multiplier: number;
}

export interface CreateBookingRequest {
  event_id: string;
  seat_id: string;
}

export interface BookingResponse {
  booking_id: string;
  status: 'pending' | 'queued';
  seat: Pick<Seat, 'id' | 'seat_number' | 'section' | 'row_label'>;
  expires_at?: Date;
  amount: number;
  queue_position?: number;
  message: string;
}

export interface AuthPayload {
  user_id: string;
  email: string;
  role: 'user' | 'admin';
}

export interface SeatStatusUpdate {
  event_id: string;
  seat_id: string;
  status: Seat['status'];
  seat_number: string;
  section: string;
}

export interface MetricLabels {
  [key: string]: string | number;
}

export interface OutboxEvent {
  id: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  published: boolean;
  published_at: Date | null;
  created_at: Date;
}

export interface DeadLetterEvent {
  id: string;
  source: string;
  event_type: string;
  payload: Record<string, unknown>;
  error: string | null;
  attempts: number;
  created_at: Date;
  last_failed: Date;
}

export interface ReconciliationIssue {
  id: string;
  issue_type: string;
  entity_id: string | null;
  description: string;
  resolved: boolean;
  detected_at: Date;
  resolved_at: Date | null;
}

export interface EventAnalyticsSnapshot {
  event_id: string;
  event_name: string;
  venue: string;
  total_seats: number;
  booked_count: number;
  reserved_count: number;
  available_count: number;
  confirmed_revenue: number;
  last_updated: Date;
}
