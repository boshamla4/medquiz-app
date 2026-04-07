// lib/sessionHelper.ts — FULL REPLACEMENT
import { NextRequest, NextResponse } from 'next/server';
import { validateSession, updateSessionLastSeen } from './auth';

export async function requireSession(
  request: NextRequest
): Promise<{ userId: number; sessionId: string } | NextResponse> {
  const sessionId = request.cookies.get('session_id')?.value;

  if (!sessionId) {
    return NextResponse.json(
      { error: 'Session cookie missing', code: 'SESSION_MISSING' },
      { status: 401 }
    );
  }

  const result = await validateSession(sessionId);

  if (!result.valid) {
    const code = result.reason === 'SESSION_HIJACKED' ? 'SESSION_HIJACKED' : 'SESSION_EXPIRED';
    return NextResponse.json(
      { error: result.reason ?? 'Session invalid', code },
      { status: 401 }
    );
  }

  await updateSessionLastSeen(sessionId);
  return { userId: result.userId, sessionId };
}
