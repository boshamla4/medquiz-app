import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const LOGIN_PATH = '/api/auth/login';
const LOGOUT_PATH = '/api/auth/logout';

export function proxy(request: NextRequest): NextResponse | undefined {
  const { pathname } = request.nextUrl;

  if (pathname === LOGIN_PATH || pathname === LOGOUT_PATH) {
    return undefined;
  }

  const sessionId = request.cookies.get('session_id')?.value;
  if (!sessionId) {
    return NextResponse.json(
      { error: 'Session cookie missing', code: 'SESSION_MISSING' },
      { status: 401 }
    );
  }

  const token = request.cookies.get('user_id')?.value;
  if (!token) {
    return NextResponse.json(
      { error: 'Token cookie missing', code: 'TOKEN_MISSING' },
      { status: 401 }
    );
  }

  return undefined;
}

export const config = {
  matcher: ['/api/:path*'],
};
