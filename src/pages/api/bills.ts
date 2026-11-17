import type { APIRoute } from 'astro';
import { getCloudflareBindings } from '../../lib/db';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const data = await request.json();
    const { merchant, amount, category, due_date, status = 'reserved' } = data;

    const env = await getCloudflareBindings();
    const db = env?.DB;

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

export const PUT: APIRoute = async ({ request }) => {
  try {
    const data = await request.json();
    const { id, merchant, amount, category, due_date, status = 'reserved' } = data;

    if (!id || !merchant || amount === undefined || isNaN(amount) || !due_date) {
      return new Response(JSON.stringify({ error: 'Missing required bill fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const env = await getCloudflareBindings();
    const db = env?.DB;

    if (db) {
      await db.prepare(
        `UPDATE bills 
         SET merchant = ?, amount = ?, category = ?, due_date = ?, status = ?
         WHERE id = ?`
      ).bind(merchant, amount, category, due_date, status, id).run();

      return new Response(JSON.stringify({ success: true, id }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ success: true, simulated: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    let id = url.searchParams.get('id');

    if (!id) {
      try {
        const body = await request.json();
        id = body.id;
      } catch {}
    }

    if (!id) {
      return new Response(JSON.stringify({ error: 'Missing bill id' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const env = await getCloudflareBindings();
    const db = env?.DB;

    if (db) {
      await db.prepare("DELETE FROM bills WHERE id = ?").bind(id).run();
      return new Response(JSON.stringify({ success: true, id }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ success: true, simulated: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
