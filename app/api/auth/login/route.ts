import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import db from '@/lib/db';
import { createSession } from '@/lib/auth';
import { checkAndRecordAttempt } from '@/lib/rateLimit';

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

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    request.headers.get('x-real-ip') ??
    'unknown';

  const { allowed, retryAfterSeconds } = await checkAndRecordAttempt(ip);

  if (!allowed) {
    const response = NextResponse.json(
      { error: 'Too many login attempts', code: 'RATE_LIMITED' },
      { status: 429 }
    );
    if (retryAfterSeconds) {
      response.headers.set('Retry-After', String(retryAfterSeconds));
      response.headers.set('X-RateLimit-Retry-After', String(retryAfterSeconds));
      return NextResponse.json(
        { error: 'Too many login attempts', code: 'RATE_LIMITED', retryAfterSeconds },
        { status: 429, headers: response.headers }
      );
    }

    return response;
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
      {
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  const { token } = parsed.data;

  const { data: user, error: userError } = await db
    .from('users')
    .select('id')
    .eq('token', token)
    .maybeSingle();

  if (userError) {
    return NextResponse.json(
      { error: 'Failed to validate token', code: 'TOKEN_LOOKUP_FAILED' },
      { status: 500 }
    );
  }

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

  const sessionId = await createSession(user.id, deviceInfo);

  const response = NextResponse.json({ success: true, userId: user.id });
  response.cookies.set('session_id', sessionId, COOKIE_OPTIONS);
  response.cookies.set('user_id', String(user.id), COOKIE_OPTIONS);

  return response;
}
