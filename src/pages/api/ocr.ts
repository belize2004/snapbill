import type { APIRoute } from 'astro';
import { getCloudflareBindings } from '../../lib/db';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const base64Image = body.image || '';
    const autoSave = body.auto_save === true;

    const env = await getCloudflareBindings();
    let merchant = "Scanned Utility Bill";
    let amount = 112.40;
    let category = "Utilities";
    let dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 14);
    let dueDateStr = dueDate.toISOString().split('T')[0];

    if (env?.AI && base64Image) {
      try {
        const rawBase64 = base64Image.replace(/^data:image\/\w+;base64,/, '');
        const binary = Uint8Array.from(atob(rawBase64), c => c.charCodeAt(0));

        const aiResponse = await env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
          image: [...binary],
          prompt: `Document OCR extraction. Extract:
- merchant (string)
- amount (number)
- category (string)
- due_date (YYYY-MM-DD)
Return JSON only.`
        });

        let text = aiResponse?.response || '';
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.merchant) merchant = parsed.merchant;
          if (parsed.amount && !isNaN(Number(parsed.amount))) amount = Number(parsed.amount);
          if (parsed.category) category = parsed.category;
          if (parsed.due_date) dueDateStr = parsed.due_date;
        }
      } catch (aiErr) {
        console.warn('AI vision parse fallback:', aiErr);
      }
    }

    // Auto-save bill directly into Cloudflare D1
    const db = env?.DB;
    if (db && autoSave) {
      const id = 'bill-' + Date.now();
      await db.prepare(
        `INSERT INTO bills (id, merchant, amount, category, due_date, status, is_recurring)
         VALUES (?, ?, ?, ?, ?, 'reserved', 1)`
      ).bind(id, merchant, amount, category, dueDateStr).run();
    }

    return new Response(JSON.stringify({
      success: true,
      merchant,
      amount,
      category,
      due_date: dueDateStr
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
