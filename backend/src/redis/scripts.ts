import { randomUUID } from 'crypto';
import { redis } from './client';

const DECR_IF_POSITIVE = `
local current = redis.call('GET', KEYS[1])
if current == false then
  return -2
end
local n = tonumber(current)
if n <= 0 then
  return -1
end
return redis.call('DECR', KEYS[1])
`;

const RELEASE_AND_NOTIFY = `
local popped = redis.call('ZPOPMIN', KEYS[2])
if #popped == 0 then
  redis.call('INCR', KEYS[1])
  return nil
end
return popped
`;

const JOIN_WAITLIST = `
redis.call('ZADD', KEYS[1], 'NX', ARGV[1], ARGV[2])
return redis.call('ZRANK', KEYS[1], ARGV[2]) + 1
`;

const CLAIM_IDEMPOTENCY = `
local set = redis.call('SET', KEYS[1], ARGV[1], 'NX', 'EX', ARGV[2])
if set == false then
  return 0
end
return 1
`;

const ACQUIRE_LOCK = `
return redis.call('SET', KEYS[1], ARGV[1], 'NX', 'EX', ARGV[2])
`;

const RELEASE_LOCK = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export async function atomicDecrement(inventoryKey: string): Promise<number> {
  return redis.eval(DECR_IF_POSITIVE, 1, inventoryKey) as Promise<number>;
}

// Pops the longest-waiting user, or puts the seat back on sale if nobody is waiting
export async function releaseAndNotify(
  inventoryKey: string,
  queueKey: string
): Promise<{ userId: string; joinedAt: number } | null> {
  const popped = await redis.eval(RELEASE_AND_NOTIFY, 2, inventoryKey, queueKey) as [string, string] | null;
  return popped ? { userId: popped[0], joinedAt: Number(popped[1]) } : null;
}

// Adds the user once (joining again keeps their original place) and returns their position
export async function joinWaitlist(queueKey: string, userId: string): Promise<number> {
  return redis.eval(JOIN_WAITLIST, 1, queueKey, Date.now().toString(), userId) as Promise<number>;
}

export async function claimIdempotencyKey(
  key: string,
  processingTtlSeconds: number
): Promise<boolean> {
  const result = await redis.eval(CLAIM_IDEMPOTENCY, 1, key, 'PROCESSING', processingTtlSeconds.toString()) as number;
  return result === 1;
}

export async function acquireLock(lockKey: string, value: string, ttlSeconds: number): Promise<boolean> {
  const result = await redis.eval(ACQUIRE_LOCK, 1, lockKey, value, ttlSeconds.toString()) as string | null;
  return result === 'OK';
}

export async function releaseLock(lockKey: string, value: string): Promise<void> {
  await redis.eval(RELEASE_LOCK, 1, lockKey, value);
}

// Runs fn only if this instance gets the lock. Returns false if another instance holds it.
export async function withLock(lockKey: string, ttlSeconds: number, fn: () => Promise<void>): Promise<boolean> {
  const owner = randomUUID();
  if (!(await acquireLock(lockKey, owner, ttlSeconds))) return false;
  try {
    await fn();
  } finally {
    await releaseLock(lockKey, owner);
  }
  return true;
}
