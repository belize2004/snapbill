import type { APIRoute } from 'astro';
import { getCloudflareBindings } from '../../lib/db';

export const POST: APIRoute = async ({ request }) => {
  try {
    const { monthly_limit, current_spent } = await request.json();
    const env = await getCloudflareBindings();
    const db = env?.DB;
    if (db) {
      await db.prepare(
        "UPDATE budget_settings SET monthly_limit = ?, current_spent = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1"
      ).bind(monthly_limit, current_spent).run();
    }
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
