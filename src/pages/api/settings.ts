import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const { monthly_limit, current_spent } = await request.json();
    // @ts-ignore
    const db = locals?.runtime?.env?.DB;
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
