import type { APIRoute } from 'astro';
import { getCloudflareBindings } from '../../lib/db';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const base64Image = body.image || '';

    const env = await getCloudflareBindings();

    if (env?.AI && base64Image) {
      try {
        const rawBase64 = base64Image.replace(/^data:image\/\w+;base64,/, '');
        const binary = Uint8Array.from(atob(rawBase64), c => c.charCodeAt(0));

        const aiResponse = await env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
          image: [...binary],
          prompt: `You are an expert document OCR model. Look closely at this bill, receipt, or invoice photo.
Extract and return ONLY a valid raw JSON object with these exact keys:
- "merchant": name of the company, service, or vendor (e.g. "Duke Energy", "Netflix", "Whole Foods")
- "amount": total amount due or paid as a numeric float (e.g. 84.50)
- "category": choose the closest from ["Utilities", "Subscriptions", "Telecom", "Insurance", "Rent/Mortgage", "Health", "Food", "General"]
- "due_date": due date in YYYY-MM-DD format (if no due date is found, use the statement date or today)
- "is_bill": true if recurring bill, false if one-off receipt
- "notes": short 1-sentence description

Return ONLY JSON. Do not wrap in markdown or backticks.`
        });

        let text = aiResponse?.response || '';
        // Strip markdown backticks if AI included them
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();

        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return new Response(JSON.stringify(parsed), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
      } catch (aiErr) {
        console.warn('Workers AI vision parsing error, falling back:', aiErr);
      }
    }

    // Fallback if image was unclear
    const fallback = {
      merchant: "Scanned Receipt",
      amount: 0.00,
      category: "General",
      due_date: new Date().toISOString().split('T')[0],
      is_bill: true,
      notes: "Photo processed. Review vendor and amount."
    };

    return new Response(JSON.stringify(fallback), {
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
