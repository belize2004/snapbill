import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ locals }) => {
  try {
    // @ts-ignore
    const db = locals?.runtime?.env?.DB;
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
