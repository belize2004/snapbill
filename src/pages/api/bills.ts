import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const data = await request.json();
    const { merchant, amount, category, due_date, status = 'reserved' } = data;

    // @ts-ignore
    const db = locals?.runtime?.env?.DB;

    if (db) {
      const id = 'bill-' + Date.now();
      await db.prepare(
        `INSERT INTO bills (id, merchant, amount, category, due_date, status, is_recurring)
         VALUES (?, ?, ?, ?, ?, ?, 1)`
      ).bind(id, merchant, amount, category, due_date, status).run();

      return new Response(JSON.stringify({ success: true, id }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ success: true, simulated: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
