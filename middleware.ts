import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const OPEN_ROUTES = new Set(['/api/auth/login', '/api/auth/logout']);

export function middleware(request: NextRequest): NextResponse | undefined {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith('/api/') || OPEN_ROUTES.has(pathname)) {
    return undefined;
  }

  if (!request.cookies.get('session_id')?.value) {
    return NextResponse.json(
      { error: 'Session cookie missing', code: 'SESSION_MISSING' },
      { status: 401 }
    );
  }

  return undefined;
}

export const config = { matcher: ['/api/:path*'] };
