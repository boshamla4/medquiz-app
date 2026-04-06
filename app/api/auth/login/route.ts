import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import db from '@/lib/db';
import { createSession } from '@/lib/auth';
import { checkRateLimit, recordAttempt } from '@/lib/rateLimit';

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 604800,
};

const LoginSchema = z.object({
  token: z.string().min(1),
});

interface UserRow {
  id: number;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    request.headers.get('x-real-ip') ??
    'unknown';

  const { allowed } = checkRateLimit(ip);
  recordAttempt(ip);

  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many login attempts', code: 'RATE_LIMITED' },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body', code: 'INVALID_BODY' },
      { status: 400 }
    );
  }

  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', code: 'VALIDATION_ERROR' },
      { status: 400 }
    );
  }

  const { token } = parsed.data;

  const user = db
    .prepare('SELECT id FROM users WHERE token = ?')
    .get(token) as UserRow | undefined;

  if (!user) {
    return NextResponse.json(
      { error: 'Invalid token', code: 'INVALID_TOKEN' },
      { status: 401 }
    );
  }

  const deviceInfo = {
    userAgent: request.headers.get('user-agent') ?? '',
    ip,
  };

  const sessionId = createSession(user.id, deviceInfo);

  const response = NextResponse.json({ success: true, userId: user.id });
  response.cookies.set('session_id', sessionId, COOKIE_OPTIONS);
  response.cookies.set('user_id', String(user.id), COOKIE_OPTIONS);

  return response;
}
