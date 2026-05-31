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
redis.call('INCR', KEYS[1])
local next_user = redis.call('RPOP', KEYS[2])
return next_user
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

export async function releaseAndNotify(inventoryKey: string, queueKey: string): Promise<string | null> {
  return redis.eval(RELEASE_AND_NOTIFY, 2, inventoryKey, queueKey) as Promise<string | null>;
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
