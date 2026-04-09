import db from './db';

interface ApiMetricInput {
  route: string;
  statusCode: number;
  totalMs: number;
  userId?: number | null;
  itemCount?: number | null;
  stages?: Record<string, number>;
  meta?: Record<string, unknown>;
}

export function formatServerTiming(stages: Record<string, number>, totalMs: number): string {
  const parts = Object.entries(stages).map(([name, duration]) => `${name};dur=${Math.max(0, Math.round(duration))}`);
  parts.push(`total;dur=${Math.max(0, Math.round(totalMs))}`);
  return parts.join(', ');
}

export async function recordApiMetric(input: ApiMetricInput): Promise<void> {
  try {
    await db.from('api_performance_metrics').insert({
      route: input.route,
      status_code: input.statusCode,
      user_id: input.userId ?? null,
      total_ms: Math.max(0, Math.round(input.totalMs)),
      item_count: input.itemCount ?? null,
      stages: input.stages ?? {},
      meta: input.meta ?? {},
    });
  } catch {
    // Telemetry must never break request handling.
  }
}
