import type { APIRoute } from 'astro';
import { getCloudflareBindings } from '../../lib/db';

export const POST: APIRoute = async () => {
  try {
    const env = await getCloudflareBindings();
    const db = env?.DB;
    if (db) {
      await db.prepare("DELETE FROM bills").run();
      await db.prepare("UPDATE budget_settings SET monthly_income = 0, monthly_limit = 0, current_spent = 0 WHERE id = 1").run();
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
