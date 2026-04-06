import { NextRequest, NextResponse } from 'next/server';
import { deactivateSession } from '@/lib/auth';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const sessionId = request.cookies.get('session_id')?.value;

  if (sessionId) {
    deactivateSession(sessionId);
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set('session_id', '', { maxAge: 0, path: '/' });
  response.cookies.set('user_id', '', { maxAge: 0, path: '/' });

  return response;
}
