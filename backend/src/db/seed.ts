import { pool } from './index';
import { redis, KEYS } from '../redis/client';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

async function seed() {
  logger.info('Seeding database...');

  const adminHash = await bcrypt.hash('admin123', 10);
  const userHash  = await bcrypt.hash('user123',  10);

  await pool.query(`
    INSERT INTO users (id, email, password_hash, name, role) VALUES
    ($1, 'admin@ticketvault.com', $2, 'Admin User', 'admin'),
    ($3, 'user@ticketvault.com',  $4, 'Test User',  'user')
    ON CONFLICT (email) DO NOTHING
  `, [uuidv4(), adminHash, uuidv4(), userHash]);

  // No available_seats column — it is always derived from seats.status
  const eventId = uuidv4();
  await pool.query(`
    INSERT INTO events (id, name, description, venue, total_seats, base_price, starts_at, ends_at, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'published')
    ON CONFLICT DO NOTHING
  `, [
    eventId,
    'Coldplay World Tour 2025',
    'Music of the Spheres World Tour — an unmissable live experience.',
    'Madison Square Garden, New York',
    500,
    149.99,
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000).toISOString(),
  ]);

  const sections: Array<{ name: string; rows: string[] }> = [
    { name: 'Floor',  rows: ['A','B','C','D','E','F','G','H','I','J'] },
    { name: 'Lower',  rows: ['A','B','C','D','E'] },
    { name: 'Upper',  rows: ['A','B','C','D','E'] },
  ];

  const seatsPerRow = 20;
  let seatNum = 1;
  let insertedCount = 0;

  for (const section of sections) {
    for (const rowLabel of section.rows) {
      for (let s = 0; s < seatsPerRow && seatNum <= 500; s++) {
        await pool.query(
          `INSERT INTO seats (id, event_id, seat_number, section, row_label)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
          [uuidv4(), eventId, `${seatNum}`, section.name, rowLabel]
        );
        seatNum++;
        insertedCount++;
      }
    }
  }

  await redis.set(KEYS.seatInventory(eventId), insertedCount.toString());

  logger.info(`Seeded: event ${eventId} with ${insertedCount} seats, Redis inventory initialized.`);

  await redis.quit();
  await pool.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
