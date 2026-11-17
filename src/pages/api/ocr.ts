import type { APIRoute } from 'astro';
import { getCloudflareBindings } from '../../lib/db';

export const prerender = false;

interface ParsedBill {
  merchant: string;
  amount: number | null;
  category: string;
  due_date: string;
  ocr_raw?: string;
}

const CATEGORIES = [
  'Utilities',
  'Subscriptions',
  'Telecom',
  'Insurance',
  'Food & Groceries',
  'General'
] as const;

function getDefaultDueDate(daysAhead: number = 14): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().split('T')[0];
}

function normalizeCategory(rawCat?: any): string {
  if (!rawCat || typeof rawCat !== 'string') return 'General';
  const clean = rawCat.trim().toLowerCase();
  for (const cat of CATEGORIES) {
    if (cat.toLowerCase() === clean) return cat;
  }
  if (/util|power|electric|gas|water|fpl|duke|energy|sewer|trash/i.test(clean)) return 'Utilities';
  if (/sub|netflix|spotify|apple|cloud|software|membership|prime/i.test(clean)) return 'Subscriptions';
  if (/phone|mobile|telecom|internet|verizon|at&t|t-mobile|comcast|spectrum/i.test(clean)) return 'Telecom';
  if (/insur|state farm|geico|allstate|progressive|health/i.test(clean)) return 'Insurance';
  if (/food|groc|market|trader|kroger|safeway|costco|whole foods|dining|restaurant/i.test(clean)) return 'Food & Groceries';
  return 'General';
}

function parseModelOutput(raw: any): ParsedBill {
  let text = '';
  if (typeof raw === 'string') {
    text = raw;
  } else if (raw && typeof raw.response === 'string') {
    text = raw.response;
  } else {
    text = JSON.stringify(raw || '');
  }

  let merchant = '';
  let amount: number | null = null;
  let category = 'General';
  let dueDate = getDefaultDueDate(14);

  // Strategy A: JSON Extraction
  const cleanedJsonStr = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const jsonMatch = cleanedJsonStr.match(/\{[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0]);
      if (obj.merchant && typeof obj.merchant === 'string') {
        merchant = obj.merchant.trim();
      }
      if (obj.amount !== undefined && obj.amount !== null) {
        const num = typeof obj.amount === 'number' ? obj.amount : parseFloat(String(obj.amount).replace(/[^0-9.]/g, ''));
        if (!isNaN(num) && num > 0) amount = Math.round(num * 100) / 100;
      }
      if (obj.due_date && /^\d{4}-\d{2}-\d{2}$/.test(String(obj.due_date).trim())) {
        dueDate = String(obj.due_date).trim();
      }
      if (obj.category) {
        category = normalizeCategory(obj.category);
      }
    } catch (e) {}
  }

  // Strategy B: Robust Regex Recovery for amount
  if (amount === null || isNaN(amount)) {
    // Look for explicit total / amount keywords or dollar sign
    const amountRegexes = [
      /(?:total\s+amount|amount\s+due|total\s+due|balance\s+due|total)\s*[:$]?\s*\$?([0-9]+(?:\.[0-9]{2})?)/i,
      /\$\s*([0-9]+\.[0-9]{2})/,
      /([0-9]+\.[0-9]{2})\s*USD/i
    ];
    for (const r of amountRegexes) {
      const m = text.match(r);
      if (m && m[1]) {
        const val = parseFloat(m[1]);
        if (!isNaN(val) && val > 0 && val < 50000) {
          amount = Math.round(val * 100) / 100;
          break;
        }
      }
    }
  }

  // Strategy C: Regex Recovery for merchant
  if (!merchant) {
    const knownVendors = [
      'Florida Power & Light', 'FPL', 'Duke Energy', 'Con Edison', 'Pacific Gas & Electric', 'PG&E',
      'AT&T', 'Verizon', 'T-Mobile', 'Comcast', 'Xfinity', 'Spectrum', 'Netflix', 'Spotify', 'Amazon'
    ];
    for (const v of knownVendors) {
      if (new RegExp('\\b' + v + '\\b', 'i').test(text)) {
        merchant = v;
        break;
      }
    }
    if (!merchant) {
      const mMatch = text.match(/(?:from|merchant|vendor|company|biller|store)\s*[:]?\s*([A-Za-z0-9\s&.',-]{3,35})(?:\n|,|\.|$)/i);
      if (mMatch && mMatch[1]) {
        merchant = mMatch[1].trim();
      }
    }
  }

  // Strategy D: Due Date regex recovery
  const dateMatch = text.match(/(\b20\d{2}[-/](?:0[1-9]|1[0-2])[-/](?:0[1-9]|[12]\d|3[01])\b)/);
  if (dateMatch) {
    dueDate = dateMatch[1].replace(/\//g, '-');
  }

  if (category === 'General') {
    category = normalizeCategory(text + ' ' + merchant);
  }

  return {
    merchant,
    amount,
    category,
    due_date: dueDate,
    ocr_raw: text.slice(0, 500)
  };
}

export const POST: APIRoute = async ({ request }) => {
  const startTime = Date.now();
  try {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Request body must be valid JSON' }), { status: 400 });
    }

    const rawImageInput = body.image || '';
    if (!rawImageInput) {
      return new Response(JSON.stringify({ error: 'Missing image payload' }), { status: 400 });
    }

    const cleanBase64 = String(rawImageInput).replace(/^data:image\/[a-zA-Z+]+;base64,/, '').trim();
    const binaryString = atob(cleanBase64);
    const binaryArray = new Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      binaryArray[i] = binaryString.charCodeAt(i);
    }

    const env = await getCloudflareBindings();
    if (!env?.AI) {
      return new Response(JSON.stringify({
        merchant: 'Mock Vendor',
        amount: 50.00,
        category: 'General',
        due_date: getDefaultDueDate(14),
        error: 'No AI binding'
      }));
    }

    let parsedResult: ParsedBill | null = null;
    let modelUsed = '@cf/meta/llama-3.2-11b-vision-instruct';
    let ocrError: string | null = null;

    try {
      const prompt = `Extract receipt details:
1. Vendor / Merchant name
2. Total amount due/paid
3. Due date (YYYY-MM-DD)
4. Category (Utilities, Subscriptions, Telecom, Insurance, Food & Groceries, General)

Output valid JSON only:
{"merchant":"...", "amount":0.00, "category":"...", "due_date":"YYYY-MM-DD"}`;

      const aiResponse: any = await env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
        image: binaryArray,
        prompt: prompt,
        max_tokens: 220,
        temperature: 0.1
      });

      if (aiResponse) {
        parsedResult = parseModelOutput(aiResponse);
      }
    } catch (primaryErr: any) {
      console.warn('Primary vision model failed:', primaryErr?.message || primaryErr);
      ocrError = primaryErr?.message || 'Primary model inference error';
    }

    if (!parsedResult || (!parsedResult.merchant && parsedResult.amount === null)) {
      try {
        const llavaRes: any = await env.AI.run('@cf/llava-hf/llava-1.5-7b-hf', {
          image: binaryArray,
          prompt: 'What is the merchant name and total dollar amount in this image? Output JSON: {"merchant":"...","amount":0.00}',
          max_tokens: 150,
          temperature: 0.1
        });
        if (llavaRes) {
          modelUsed = '@cf/llava-hf/llava-1.5-7b-hf';
          const fallbackParsed = parseModelOutput(llavaRes);
          if (fallbackParsed.merchant || fallbackParsed.amount !== null) {
            parsedResult = fallbackParsed;
            ocrError = null;
          }
        }
      } catch (fallbackErr: any) {
        console.warn('Fallback model failed:', fallbackErr?.message || fallbackErr);
      }
    }

    const finalBill: ParsedBill = parsedResult || {
      merchant: '',
      amount: null,
      category: 'General',
      due_date: getDefaultDueDate(14)
    };

    return new Response(JSON.stringify({
      merchant: finalBill.merchant,
      amount: finalBill.amount,
      category: finalBill.category,
      due_date: finalBill.due_date,
      ocr_raw: finalBill.ocr_raw,
      model: modelUsed,
      processing_time_ms: Date.now() - startTime,
      error: ocrError
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err: any) {
    console.error('Fatal OCR error:', err);
    return new Response(JSON.stringify({
      merchant: '',
      amount: null,
      category: 'General',
      due_date: getDefaultDueDate(14),
      error: err?.message || 'Internal server error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
