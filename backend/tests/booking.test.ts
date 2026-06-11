import { pool } from '../src/db';
import { redis, KEYS } from '../src/redis/client';
import { atomicDecrement, releaseAndNotify, claimIdempotencyKey } from '../src/redis/scripts';

afterAll(async () => {
  await pool.end();
  await redis.quit();
});

const k = (label: string) => `test:${label}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

describe('atomicDecrement', () => {
  it('decrements and returns remaining count', async () => {
    const key = k('decr');
    await redis.set(key, '5');
    expect(await atomicDecrement(key)).toBe(4);
    await redis.del(key);
  });

  it('returns -1 when inventory is already 0', async () => {
    const key = k('zero');
    await redis.set(key, '0');
    expect(await atomicDecrement(key)).toBe(-1);
    await redis.del(key);
  });

  it('does not go negative', async () => {
    const key = k('no-negative');
    await redis.set(key, '0');
    await atomicDecrement(key);
    expect(await redis.get(key)).toBe('0');
    await redis.del(key);
  });

  it('returns -2 when key does not exist', async () => {
    expect(await atomicDecrement(k('missing'))).toBe(-2);
  });

  it('prevents double-booking under 10 concurrent decrements on 1 seat', async () => {
    const key = k('concurrent');
    await redis.set(key, '1');

    const results = await Promise.all(
      Array.from({ length: 10 }, () => atomicDecrement(key))
    );

    const successes = results.filter((r) => r >= 0);
    const soldOuts  = results.filter((r) => r === -1);

    expect(successes.length).toBe(1);
    expect(soldOuts.length).toBe(9);
    await redis.del(key);
  });
});

describe('releaseAndNotify', () => {
  it('pops the next waiter without incrementing inventory (seat stays taken)', async () => {
    const invKey   = k('inv');
    const queueKey = k('queue');
    await redis.set(invKey, '0');
    await redis.lpush(queueKey, JSON.stringify({ userId: 'user-abc', timestamp: Date.now() }));

    const popped = await releaseAndNotify(invKey, queueKey);

    expect(await redis.get(invKey)).toBe('0');
    expect(popped).not.toBeNull();
    expect(JSON.parse(popped!).userId).toBe('user-abc');

    await redis.del(invKey, queueKey);
  });

  it('returns null and increments when queue is empty', async () => {
    const invKey   = k('inv-empty');
    const queueKey = k('queue-empty');
    await redis.set(invKey, '0');

    const popped = await releaseAndNotify(invKey, queueKey);

    expect(popped).toBeNull();
    expect(await redis.get(invKey)).toBe('1');
    await redis.del(invKey);
  });
});

describe('claimIdempotencyKey', () => {
  it('returns true for the first caller', async () => {
    const key = k('idem');
    expect(await claimIdempotencyKey(key, 5)).toBe(true);
    await redis.del(key);
  });

  it('returns false for a second concurrent caller', async () => {
    const key = k('idem-race');
    const [first, second] = await Promise.all([
      claimIdempotencyKey(key, 30),
      claimIdempotencyKey(key, 30),
    ]);
    expect([first, second].filter(Boolean).length).toBe(1);
    await redis.del(key);
  });

  it('sets value to PROCESSING during the claim window', async () => {
    const key = k('idem-processing');
    await claimIdempotencyKey(key, 30);
    expect(await redis.get(key)).toBe('PROCESSING');
    await redis.del(key);
  });

  it('allows reclaim after TTL expires', async () => {
    const key = k('idem-ttl');
    await claimIdempotencyKey(key, 1);
    await new Promise((r) => setTimeout(r, 1200));
    expect(await claimIdempotencyKey(key, 30)).toBe(true);
    await redis.del(key);
  });
});

describe('KEYS prefix format', () => {
  it('produces correctly prefixed keys', () => {
    expect(KEYS.seatInventory('evt-1')).toBe('tv:seat_inventory:evt-1');
    expect(KEYS.waitingQueue('evt-1')).toBe('tv:waiting_queue:evt-1');
    expect(KEYS.idempotency('abc')).toBe('tv:idempotency:abc');
    expect(KEYS.reservation('bk-1')).toBe('tv:reservation:bk-1');
  });
});
