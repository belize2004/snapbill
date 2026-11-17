import type { APIRoute } from 'astro';
import { getCloudflareBindings } from '../../lib/db';

interface ParsedBill {
  merchant: string;
  amount: number | null;
  category: string;
  due_date: string;
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

function normalizeCategory(rawCat: string | undefined | null): string {
  if (!rawCat) return 'General';
  const clean = rawCat.trim().toLowerCase();
  for (const cat of CATEGORIES) {
    if (cat.toLowerCase() === clean) return cat;
  }
  if (/util|water|power|electric|gas|sewer|trash/i.test(clean)) return 'Utilities';
  if (/sub|netflix|spotify|apple|cloud|software|membership|prime/i.test(clean)) return 'Subscriptions';
  if (/phone|mobile|telecom|internet|verizon|at&t|t-mobile|comcast|spectrum/i.test(clean)) return 'Telecom';
  if (/insur|state farm|geico|allstate|progressive|health/i.test(clean)) return 'Insurance';
  if (/food|groc|market|trader|kroger|safeway|costco|whole foods|dining|restaurant/i.test(clean)) return 'Food & Groceries';
  return 'General';
}

function extractJsonBill(text: string): ParsedBill | null {
  if (!text) return null;
  // Strip code fences if present
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) return null;

  try {
    const obj = JSON.parse(jsonMatch[0]);
    let merchant = typeof obj.merchant === 'string' ? obj.merchant.trim() : '';
    let amount: number | null = null;
    if (obj.amount !== undefined && obj.amount !== null) {
      const parsedNum = typeof obj.amount === 'number' ? obj.amount : parseFloat(String(obj.amount).replace(/[^0-9.]/g, ''));
      if (!isNaN(parsedNum) && parsedNum > 0) {
        amount = Math.round(parsedNum * 100) / 100;
      }
    }

    let dueDate = getDefaultDueDate(14);
    if (obj.due_date && /^\d{4}-\d{2}-\d{2}$/.test(String(obj.due_date).trim())) {
      dueDate = String(obj.due_date).trim();
    }

    const category = normalizeCategory(obj.category);

    return {
      merchant,
      amount,
      category,
      due_date: dueDate
    };
  } catch {
    return null;
  }
}

function extractRegexBill(text: string): ParsedBill {
  let merchant = '';
  let amount: number | null = null;
  let category = 'General';
  let dueDate = getDefaultDueDate(14);

  if (!text) {
    return { merchant, amount, category, due_date: dueDate };
  }

  // 1. Amount heuristic (look for Total, Balance, Amount Due, $, or highest reasonable price)
  const totalMatches = [
    /(?:total|balance due|amount due|amount|total due|pay this amount)\s*[:$]?\s*([0-9]+(?:\.[0-9]{2})?)/i,
    /\$\s*([0-9]+\.[0-9]{2})/,
    /([0-9]+\.[0-9]{2})\s*USD/i
  ];

  for (const regex of totalMatches) {
    const m = text.match(regex);
    if (m && m[1]) {
      const val = parseFloat(m[1]);
      if (!isNaN(val) && val > 0 && val < 100000) {
        amount = Math.round(val * 100) / 100;
        break;
      }
    }
  }

  // 2. Date heuristic (YYYY-MM-DD or MM/DD/YYYY or DD-Mon-YYYY)
  const dateIsoMatch = text.match(/(?:due(?:\s+date)?|date)?\s*[:]?\s*(\b20\d{2}[-/](?:0[1-9]|1[0-2])[-/](?:0[1-9]|[12]\d|3[01])\b)/i);
  if (dateIsoMatch && dateIsoMatch[1]) {
    dueDate = dateIsoMatch[1].replace(/\//g, '-');
  } else {
    const dateUsMatch = text.match(/(?:due(?:\s+date)?|date)?\s*[:]?\s*(\b(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/(20\d{2})\b)/i);
    if (dateUsMatch && dateUsMatch[4]) {
      dueDate = `${dateUsMatch[4]}-${dateUsMatch[2].padStart(2, '0')}-${dateUsMatch[3].padStart(2, '0')}`;
    }
  }

  // 3. Merchant heuristic
  const merchantMatch = text.match(/(?:merchant|vendor|company|store|biller)\s*[:]\s*([A-Za-z0-9\s&.',-]+?)(?:\n|$)/i);
  if (merchantMatch && merchantMatch[1]) {
    merchant = merchantMatch[1].trim();
  } else {
    // Take first non-empty line of text that doesn't look like an amount or date
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 2 && !/^\d+$/.test(l) && !l.startsWith('{'));
    if (lines.length > 0) {
      merchant = lines[0].slice(0, 40).replace(/["'{}]/g, '').trim();
    }
  }

  category = normalizeCategory(text);

  return { merchant, amount, category, due_date: dueDate };
}

export const POST: APIRoute = async ({ request }) => {
  const startTime = Date.now();
  let merchant = '';
  let amount: number | null = null;
  let category = 'General';
  let dueDateStr = getDefaultDueDate(14);
  let ocrError: string | null = null;
  let modelUsed: string | null = null;

  try {
    const body = await request.json().catch(() => ({}));
    const rawImageInput = body.image || '';

    if (!rawImageInput) {
      return new Response(
        JSON.stringify({
          merchant: '',
          amount: null,
          category: 'General',
          due_date: dueDateStr,
          error: 'No image provided'
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Strip Data URL prefix if present (works for JPEG, PNG, WEBP, etc.)
    const cleanBase64 = String(rawImageInput).replace(/^data:image\/[a-zA-Z+]+;base64,/, '').trim();
    
    // Convert base64 to binary buffer/array
    let binaryArray: number[];
    try {
      const binaryString = atob(cleanBase64);
      binaryArray = new Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        binaryArray[i] = binaryString.charCodeAt(i);
      }
    } catch (b64Err: any) {
      return new Response(
        JSON.stringify({
          merchant: '',
          amount: null,
          category: 'General',
          due_date: dueDateStr,
          error: `Invalid base64 payload: ${b64Err?.message || b64Err}`
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    const env = await getCloudflareBindings();

    if (!env?.AI) {
      // Local dev or missing AI binding: fallback gracefully with default values
      return new Response(
        JSON.stringify({
          merchant: 'Receipt Scan (AI Dev Mock)',
          amount: 45.50,
          category: 'Utilities',
          due_date: dueDateStr,
          error: 'Cloudflare Workers AI binding not available in local dev environment'
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    const promptText = `Extract invoice/receipt details. Return ONLY a single raw JSON object with keys: "merchant" (string), "amount" (number, e.g. 54.20), "category" (one of: Utilities, Subscriptions, Telecom, Insurance, Food & Groceries, General), "due_date" (YYYY-MM-DD). Strictly no markdown, no explanation:
{"merchant":"...","amount":0.00,"category":"...","due_date":"YYYY-MM-DD"}`;

    let parsedResult: ParsedBill | null = null;

    // --- STRATEGY 1: Primary Model: @cf/meta/llama-3.2-11b-vision-instruct ---
    try {
      const aiResponse: any = await env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
        image: binaryArray,
        prompt: promptText,
        max_tokens: 180,
        temperature: 0.1
      });

      if (aiResponse?.response) {
        modelUsed = '@cf/meta/llama-3.2-11b-vision-instruct';
        parsedResult = extractJsonBill(aiResponse.response);
        if (!parsedResult) {
          parsedResult = extractRegexBill(aiResponse.response);
        }
      }
    } catch (err: any) {
      console.warn('Primary vision model (@cf/meta/llama-3.2-11b-vision-instruct) failed:', err?.message || err);
      ocrError = `Primary model error: ${err?.message || 'Inference error'}`;
    }

    // --- STRATEGY 2: Fallback Model: @cf/llava-hf/llava-1.5-7b-hf ---
    // Triggered if primary threw an error (e.g. 3043) or produced no merchant/amount
    if (!parsedResult || (!parsedResult.merchant && parsedResult.amount === null)) {
      try {
        const llavaPrompt = `Extract invoice details: merchant name, total amount, category, and due date YYYY-MM-DD. Format: {"merchant": "...", "amount": 0.00, "category": "...", "due_date": "YYYY-MM-DD"}`;
        const llavaRes: any = await env.AI.run('@cf/llava-hf/llava-1.5-7b-hf', {
          image: binaryArray,
          prompt: llavaPrompt,
          max_tokens: 200,
          temperature: 0.1
        });

        const outputText = llavaRes?.description || llavaRes?.response || '';
        if (outputText) {
          modelUsed = '@cf/llava-hf/llava-1.5-7b-hf';
          const llavaParsed = extractJsonBill(outputText);
          if (llavaParsed && (llavaParsed.merchant || llavaParsed.amount !== null)) {
            parsedResult = llavaParsed;
            ocrError = null;
          } else {
            const regexParsed = extractRegexBill(outputText);
            if (regexParsed.merchant || regexParsed.amount !== null) {
              parsedResult = regexParsed;
              ocrError = null;
            }
          }
        }
      } catch (fallbackErr: any) {
        console.warn('Fallback vision model (@cf/llava-hf/llava-1.5-7b-hf) failed:', fallbackErr?.message || fallbackErr);
        if (!ocrError) {
          ocrError = `Fallback model error: ${fallbackErr?.message || 'Inference error'}`;
        }
      }
    }

    if (parsedResult) {
      if (parsedResult.merchant) merchant = parsedResult.merchant;
      if (parsedResult.amount !== null) amount = parsedResult.amount;
      if (parsedResult.category) category = parsedResult.category;
      if (parsedResult.due_date) dueDateStr = parsedResult.due_date;
      if (merchant || amount !== null) {
        ocrError = null; // Successfully extracted
      }
    }

    const durationMs = Date.now() - startTime;

    return new Response(
      JSON.stringify({
        merchant,
        amount,
        category,
        due_date: dueDateStr,
        error: ocrError,
        model: modelUsed,
        processing_time_ms: durationMs
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Server-Timing': `ocr;dur=${durationMs}`
        }
      }
    );
  } catch (fatalError: any) {
    return new Response(
      JSON.stringify({
        merchant: '',
        amount: null,
        category: 'General',
        due_date: dueDateStr,
        error: fatalError?.message || 'Server error'
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
};
