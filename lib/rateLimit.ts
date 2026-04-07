import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(5, '15 m'),
  prefix: 'medquiz:login',
});

export async function checkAndRecordAttempt(
  ip: string
): Promise<{ allowed: boolean; remaining: number }> {
  const { success, remaining } = await ratelimit.limit(ip);
  return { allowed: success, remaining };
}
