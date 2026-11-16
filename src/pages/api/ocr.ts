import type { APIRoute } from 'astro';
import { getCloudflareBindings } from '../../lib/db';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const base64Image = body.image || '';

    const env = await getCloudflareBindings();
    let merchant = "";
    let amount: number | null = null;
    let category = "General";
    let dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 14);
    let dueDateStr = dueDate.toISOString().split('T')[0];
    let ocrError: string | null = null;

    if (env?.AI && base64Image) {
      const rawBase64 = base64Image.replace(/^data:image\/\w+;base64,/, '');
      const binary = Uint8Array.from(atob(rawBase64), c => c.charCodeAt(0));

      let aiResponse: any = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          aiResponse = await env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
            image: [...binary],
            max_tokens: 300,
            prompt: `You are an invoice and receipt parser. Look at the image and extract:
1. Vendor / Merchant name
2. Total amount due or paid (as a single number, e.g. 230.00)
3. Category (one of: Utilities, Subscriptions, Telecom, Food & Groceries, Insurance, General)
4. Due date (YYYY-MM-DD)

Output strictly valid JSON with no markdown wrapping:
{"merchant": "...", "amount": 0.00, "category": "...", "due_date": "YYYY-MM-DD"}`
          });
          if (aiResponse) break;
        } catch (err: any) {
          console.warn(`Vision attempt ${attempt} error:`, err?.message || err);
          ocrError = err?.message || 'Vision model error';
        }
      }

      if (aiResponse?.response) {
        let text = aiResponse.response.replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.merchant) merchant = String(parsed.merchant).trim();
            if (parsed.amount !== undefined && !isNaN(Number(parsed.amount))) amount = Number(parsed.amount);
            if (parsed.category) category = parsed.category;
            if (parsed.due_date) dueDateStr = parsed.due_date;
            ocrError = null;
          } catch (jsonErr) {
            console.warn('JSON parse error:', jsonErr);
          }
        }
      }
    }

    return new Response(JSON.stringify({
      merchant,
      amount,
      category,
      due_date: dueDateStr,
      error: ocrError
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({
      merchant: "",
      amount: null,
      category: "General",
      due_date: new Date().toISOString().split('T')[0],
      error: error?.message || 'Server error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
