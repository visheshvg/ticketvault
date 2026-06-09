import axios from 'axios';
import { useAuthStore } from '../store/authStore';
import { v4 as uuidv4 } from 'uuid';

export const api = axios.create({
  baseURL: '/api',
  timeout: 10_000,
});

api.interceptors.request.use(config => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) useAuthStore.getState().logout();
    return Promise.reject(err);
  }
);

export function generateIdempotencyKey(): string {
  return `${Date.now()}-${uuidv4()}`;
}

export const authApi = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }).then(r => r.data),
  register: (email: string, password: string, name: string) =>
    api.post('/auth/register', { email, password, name }).then(r => r.data),
  refresh: (refreshToken: string) =>
    api.post('/auth/refresh', { refreshToken }).then(r => r.data),
  logout: () => api.post('/auth/logout').then(r => r.data),
};

export const eventsApi = {
  list: ()           => api.get('/events').then(r => r.data.events),
  getById: (id: string) => api.get(`/events/${id}`).then(r => r.data.event),
  getSeats: (id: string) => api.get(`/events/${id}/seats`).then(r => r.data.seats),
};

export const bookingsApi = {
  create: (eventId: string, seatId: string, idempotencyKey: string) =>
    api.post('/bookings', { event_id: eventId, seat_id: seatId }, {
      headers: { 'Idempotency-Key': idempotencyKey },
    }).then(r => r.data),
  list: () => api.get('/bookings').then(r => r.data.bookings),
  cancel: (id: string) => api.delete(`/bookings/${id}`).then(r => r.data),
};

export const paymentsApi = {
  initiate: (bookingId: string) =>
    api.post(`/payments/initiate/${bookingId}`).then(r => r.data),
  simulate: (bookingId: string, success: boolean) =>
    api.post(`/payments/simulate/${bookingId}`, { success }).then(r => r.data),
};

export const adminApi = {
  dashboard: ()                   => api.get('/admin/dashboard').then(r => r.data),
  audit: (bookingId: string)      => api.get(`/admin/audit/${bookingId}`).then(r => r.data),
  queue: (eventId: string)        => api.get(`/admin/queue/${eventId}`).then(r => r.data),
  compensations: ()               => api.get('/admin/compensations').then(r => r.data),
  reconciliationIssues: ()        => api.get('/admin/reconciliation/issues').then(r => r.data),
  resolveIssue: (id: string)      => api.post(`/admin/reconciliation/resolve/${id}`).then(r => r.data),
  triggerReconciliation: ()       => api.post('/admin/reconciliation/run').then(r => r.data),
  dlq: ()                         => api.get('/admin/dlq').then(r => r.data),
  replayDLQ: (id: string)         => api.post(`/admin/dlq/replay/${id}`).then(r => r.data),
  deleteDLQ: (id: string)         => api.delete(`/admin/dlq/${id}`).then(r => r.data),
  outboxLag: ()                   => api.get('/admin/outbox/lag').then(r => r.data),
};
