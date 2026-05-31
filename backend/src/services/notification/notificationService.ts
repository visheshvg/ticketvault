import nodemailer from 'nodemailer';
import { query } from '../../db';
import { logger } from '../../utils/logger';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'localhost',
  port: parseInt(process.env.SMTP_PORT || '1025', 10),
  secure: false,
});

interface NotificationPayload {
  type: string;
  userId: string;
  bookingId?: string;
  [key: string]: unknown;
}

const templates: Record<string, (payload: NotificationPayload) => { subject: string; text: string }> = {
  RESERVATION_CREATED: (p) => ({
    subject: '🎟 Your seat is reserved — act fast!',
    text: `Your seat has been reserved. Complete payment within 10 minutes to secure your ticket.\nBooking ID: ${p.bookingId}`,
  }),
  PAYMENT_CONFIRMED: (p) => ({
    subject: '✅ Booking confirmed!',
    text: `Your booking (${p.bookingId}) is confirmed. Amount charged: $${p.amount}. See you at the show!`,
  }),
  BOOKING_COMPENSATED: (p) => ({
    subject: '❌ Booking could not be completed',
    text: `Your payment failed for booking ${p.bookingId}. Your seat has been released. Reason: ${p.reason}`,
  }),
  SEAT_AVAILABLE: () => ({
    subject: '🔔 A seat just opened up!',
    text: `Good news! A seat is now available for the event you were waiting for. Log in to book it — it won\'t last!`,
  }),
  RESERVATION_EXPIRING: (p) => ({
    subject: '⚠️ Your reservation expires in 2 minutes!',
    text: `Your seat reservation for booking ${p.bookingId} is about to expire. Complete payment now to avoid losing your spot.`,
  }),
};

export class NotificationService {
  async send(payload: NotificationPayload): Promise<void> {
    const { type, userId } = payload;

    const users = await query<{ email: string; name: string }>(
      `SELECT email, name FROM users WHERE id = $1`,
      [userId]
    );

    if (!users.length) {
      logger.warn('Notification skipped — user not found', { user_id: userId, type });
      return;
    }

    const { email, name } = users[0];
    const buildTemplate = templates[type];

    if (!buildTemplate) {
      logger.warn('Unknown notification type', { type });
      return;
    }

    const { subject, text } = buildTemplate(payload);

    try {
      await transporter.sendMail({
        from: '"TicketVault" <noreply@ticketvault.com>',
        to: `${name} <${email}>`,
        subject,
        text,
      });
      logger.info('Email sent', { type, to: email });
    } catch (err) {
      logger.error('Failed to send email', { type, to: email, error: (err as Error).message });
    }
  }
}

export const notificationService = new NotificationService();
