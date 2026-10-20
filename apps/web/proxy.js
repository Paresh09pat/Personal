import { NextResponse } from 'next/server';

const SESSION_COOKIE = 'olw_sid';
const PROTECTED = ['/dashboard', '/r/', '/onboarding', '/account'];
const GUEST_ONLY = ['/login', '/register'];

/**
 * Optimistic redirects only (cookie present or not). Real authorization always happens on the
 * server for every API call and socket event — this just avoids flashing the wrong page.
 */
export function proxy(request) {
  const { pathname, search } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  if (!hasSession && PROTECTED.some((p) => pathname === p.replace(/\/$/, '') || pathname.startsWith(p))) {
    const url = new URL('/login', request.url);
    url.searchParams.set('next', pathname + search);
    return NextResponse.redirect(url);
  }
  if (hasSession && (pathname === '/' || GUEST_ONLY.includes(pathname)) && !request.nextUrl.searchParams.get('next')) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/login', '/register', '/dashboard', '/onboarding', '/account', '/r/:path*'],
};
