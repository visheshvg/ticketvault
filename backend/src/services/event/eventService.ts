import { v4 as uuidv4 } from 'uuid';
import { query, withTransaction } from '../../db';
import { redis, KEYS } from '../../redis/client';
import { config } from '../../config';
import { Event, PriceTier } from '../../types';
import { logger } from '../../utils/logger';
import { seatInventoryGauge } from '../../utils/metrics';

interface CreateEventInput {
  name: string;
  description?: string;
  venue: string;
  total_seats: number;
  base_price: number;
  starts_at: string;
  ends_at: string;
}

export class EventService {
  async getEvents(): Promise<Event[]> {
    // available_seats is always computed live from seats table — not stored on events
    return query<Event>(`
      SELECT e.*,
        COUNT(s.id) FILTER (WHERE s.status = 'available') AS available_seats
      FROM events e
      LEFT JOIN seats s ON s.event_id = e.id
      WHERE e.status = 'published'
      GROUP BY e.id
      ORDER BY e.starts_at ASC
    `);
  }

  async getEventById(eventId: string): Promise<Event | null> {
    const rows = await query<Event>(`
      SELECT e.*,
        COUNT(s.id) FILTER (WHERE s.status = 'available') AS available_seats
      FROM events e
      LEFT JOIN seats s ON s.event_id = e.id
      WHERE e.id = $1
      GROUP BY e.id
    `, [eventId]);

    if (!rows.length) return null;
    const event = rows[0];

    // Redis overrides the DB count for the hot path (fresher under high load)
    const redisCount = await redis.get(KEYS.seatInventory(eventId));
    if (redisCount !== null) {
      event.available_seats = parseInt(redisCount, 10);
    }

    event.current_price = this.calculatePrice(event.base_price, event.available_seats, event.total_seats);
    return event;
  }

  calculatePrice(basePrice: number, availableSeats: number, totalSeats: number): number {
    const ratio = availableSeats / totalSeats;
    const tiers: readonly PriceTier[] = config.pricing.tiers;
    for (const tier of tiers) {
      if (ratio >= tier.threshold) {
        return Math.round(basePrice * tier.multiplier * 100) / 100;
      }
    }
    return Math.round(basePrice * 2.0 * 100) / 100;
  }

  async createEvent(data: CreateEventInput): Promise<Event> {
    return withTransaction(async (client) => {
      const eventRows = await client.query<Event>(`
        INSERT INTO events (name, description, venue, total_seats, base_price, starts_at, ends_at, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'published')
        RETURNING *
      `, [data.name, data.description ?? null, data.venue, data.total_seats, data.base_price, data.starts_at, data.ends_at]);

      const event = eventRows.rows[0];
      event.available_seats = data.total_seats;

      const sections = ['Floor', 'Lower', 'Upper'];
      const seatsPerSection = Math.ceil(data.total_seats / sections.length);
      const seatsPerRow = 20;
      let seatNum = 1;

      for (const section of sections) {
        let sectionSeatsCreated = 0;
        let rowIndex = 0;

        while (sectionSeatsCreated < seatsPerSection && seatNum <= data.total_seats) {
          const rowLabel = String.fromCharCode(65 + rowIndex);
          const seatsInThisRow = Math.min(
            seatsPerRow,
            seatsPerSection - sectionSeatsCreated,
            data.total_seats - seatNum + 1
          );
          for (let s = 0; s < seatsInThisRow; s++) {
            await client.query(
              `INSERT INTO seats (id, event_id, seat_number, section, row_label) VALUES ($1, $2, $3, $4, $5)`,
              [uuidv4(), event.id, `${seatNum}`, section, rowLabel]
            );
            seatNum++;
            sectionSeatsCreated++;
          }
          rowIndex++;
        }
      }

      await redis.set(KEYS.seatInventory(event.id), data.total_seats.toString());
      seatInventoryGauge.labels(event.id).set(data.total_seats);

      logger.info('Event created', { event_id: event.id, seats: data.total_seats });
      return event;
    });
  }

  async getSeatsForEvent(eventId: string) {
    return query(`
      SELECT id, seat_number, section, row_label, status, reserved_until
      FROM seats
      WHERE event_id = $1
      ORDER BY section, row_label, CAST(seat_number AS INTEGER)
    `, [eventId]);
  }

  async initRedisInventory(eventId: string): Promise<void> {
    const rows = await query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM seats WHERE event_id = $1 AND status = 'available'`,
      [eventId]
    );
    const count = parseInt(rows[0].count, 10);
    await redis.set(KEYS.seatInventory(eventId), count.toString());
    seatInventoryGauge.labels(eventId).set(count);
    logger.info('Redis inventory initialized', { event_id: eventId, count });
  }
}

export const eventService = new EventService();
