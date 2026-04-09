import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { requireSession } from '@/lib/sessionHelper';

const DEFAULT_ACTIVE_WINDOW_MINUTES = 5;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;

  const windowMinutesRaw = Number(process.env.ACTIVE_USERS_WINDOW_MINUTES ?? DEFAULT_ACTIVE_WINDOW_MINUTES);
  const windowMinutes = Number.isFinite(windowMinutesRaw) && windowMinutesRaw > 0
    ? Math.floor(windowMinutesRaw)
    : DEFAULT_ACTIVE_WINDOW_MINUTES;
  const windowStartIso = new Date(Date.now() - windowMinutes * 60_000).toISOString();

  const { count, error } = await db
    .from('sessions')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true)
    .gte('last_seen', windowStartIso);

  if (error) {
    return NextResponse.json(
      { error: 'Failed to load active user count', code: 'ACTIVE_USERS_FETCH_FAILED' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    activeUsers: count ?? 0,
    windowMinutes,
    asOf: new Date().toISOString(),
  });
}