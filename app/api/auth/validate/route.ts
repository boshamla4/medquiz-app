import { NextRequest, NextResponse } from 'next/server';
import { validateSession, updateSessionLastSeen } from '@/lib/auth';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const sessionId = request.cookies.get('session_id')?.value;

  if (!sessionId) {
    return NextResponse.json(
      { error: 'Session cookie missing', code: 'SESSION_MISSING' },
      { status: 401 }
    );
  }

  const result = validateSession(sessionId);

  if (!result.valid) {
    const response = NextResponse.json(
      { error: result.reason ?? 'Session invalid', code: result.reason ?? 'SESSION_INVALID' },
      { status: 401 }
    );
    response.cookies.set('session_id', '', { maxAge: 0, path: '/' });
    response.cookies.set('user_id', '', { maxAge: 0, path: '/' });
    return response;
  }

  updateSessionLastSeen(sessionId);

  return NextResponse.json({ valid: true, userId: result.userId });
}
