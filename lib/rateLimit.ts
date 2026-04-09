import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

interface MemoryRateLimitEntry {
  count: number;
  firstAttempt: number;
}

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const memoryStore = new Map<string, MemoryRateLimitEntry>();

const hasUpstashEnv = Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
);

const ratelimit = hasUpstashEnv
  ? new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(5, '15 m'),
      prefix: 'medquiz:login',
    })
  : null;

function memoryLimit(ip: string): { allowed: boolean; remaining: number; retryAfterSeconds?: number } {
  const now = Date.now();
  const existing = memoryStore.get(ip);

  if (!existing || now - existing.firstAttempt > WINDOW_MS) {
    const fresh = { count: 1, firstAttempt: now };
    memoryStore.set(ip, fresh);
    return { allowed: true, remaining: MAX_ATTEMPTS - fresh.count };
  }

  existing.count += 1;
  memoryStore.set(ip, existing);
  const allowed = existing.count <= MAX_ATTEMPTS;
  const remaining = Math.max(0, MAX_ATTEMPTS - existing.count);

  if (allowed) {
    return { allowed, remaining };
  }

  const retryAfterMs = Math.max(1, WINDOW_MS - (now - existing.firstAttempt));
  return {
    allowed,
    remaining,
    retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
  };
}

export async function checkAndRecordAttempt(
  ip: string
): Promise<{ allowed: boolean; remaining: number; retryAfterSeconds?: number }> {
  if (!ratelimit) {
    return memoryLimit(ip);
  }

  const result = await ratelimit.limit(ip);
  const allowed = result.success;
  const retryAfterSeconds = !allowed && typeof result.reset === 'number'
    ? Math.max(1, Math.ceil((result.reset - Date.now()) / 1000))
    : undefined;

  return { allowed, remaining: result.remaining, retryAfterSeconds };
}
