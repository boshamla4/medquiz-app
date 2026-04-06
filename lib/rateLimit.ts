interface RateLimitEntry {
  count: number;
  firstAttempt: number;
}

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;

const store = new Map<string, RateLimitEntry>();

function getEntry(ip: string): RateLimitEntry {
  const now = Date.now();
  const entry = store.get(ip);

  if (!entry || now - entry.firstAttempt > WINDOW_MS) {
    const fresh: RateLimitEntry = { count: 0, firstAttempt: now };
    store.set(ip, fresh);
    return fresh;
  }

  return entry;
}

export function checkRateLimit(ip: string): { allowed: boolean; remaining: number } {
  const entry = getEntry(ip);
  const remaining = Math.max(0, MAX_ATTEMPTS - entry.count);
  return { allowed: entry.count < MAX_ATTEMPTS, remaining };
}

export function recordAttempt(ip: string): void {
  const entry = getEntry(ip);
  entry.count += 1;
  store.set(ip, entry);
}
