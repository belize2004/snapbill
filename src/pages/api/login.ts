import type { APIRoute } from 'astro';

const AUTH_COOKIE = 'sb_auth';
const VALID_PASS = '1992';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  try {
    let passcode = '';
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      passcode = (formData.get('passcode') as string) || '';
    } else {
      const json = await request.json();
      passcode = json.passcode || '';
    }

    if (passcode.trim() === VALID_PASS) {
      // Set secure auth cookie for 90 days
      cookies.set(AUTH_COOKIE, VALID_PASS, {
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 90
      });

      return redirect('/', 302);
    }

    return redirect('/login?error=1', 302);
  } catch (e) {
    return redirect('/login?error=1', 302);
  }
};
