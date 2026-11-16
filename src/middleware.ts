import { defineMiddleware } from 'astro:middleware';

const AUTH_COOKIE = 'sb_auth';
const VALID_PASS = '1992';

export const onRequest = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url);

  // Allow login route, auth submission, and static assets
  if (
    url.pathname === '/login' ||
    url.pathname === '/api/login' ||
    url.pathname.startsWith('/_astro/') ||
    url.pathname.startsWith('/favicon')
  ) {
    return next();
  }

  // Check auth cookie
  const cookie = context.cookies.get(AUTH_COOKIE);
  if (cookie?.value === VALID_PASS) {
    return next();
  }

  // Not authenticated, redirect to /login
  return context.redirect('/login');
});
