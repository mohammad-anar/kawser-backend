/**
 * Gemini AI Service
 * Used for smart text parsing (e.g. manual order quick-fill)
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

let genAI = null;

const getClient = () => {
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_gemini_api_key_here') {
    return null;
  }
  if (!genAI) {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return genAI;
};

/**
 * Parse unstructured order text using Gemini AI.
 * Returns: { customerName, phoneNumber, address, amount, orderNotes }
 */
const parseOrderText = async (rawText) => {
  // Helper for fast local regex / line-based parsing
  const localFallbackParse = (text) => {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const result = {
      customerName: '',
      phoneNumber: '',
      address: '',
      amount: 0,
      orderNotes: '',
    };

    const noteLine = lines.find((l) => /^(note|নোট)\s*:/i.test(l));
    if (noteLine) {
      result.orderNotes = noteLine.replace(/^(note|নোট)\s*:\s*/i, '').trim();
    }

    const mainLines = lines.filter((l) => !/^(note|নোট)\s*:/i.test(l));
    if (mainLines[0]) result.customerName = mainLines[0];
    if (mainLines[1]) {
      const normalizedDigits = mainLines[1].replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6));
      result.phoneNumber = normalizedDigits.replace(/\D/g, '').replace(/^880/, '0').replace(/^88/, '');
    }
    if (mainLines[2]) result.address = mainLines[2];
    if (mainLines[3]) {
      const normalizedDigits = mainLines[3].replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6));
      const amountNum = parseFloat(normalizedDigits.replace(/[^\d.]/g, ''));
      if (!isNaN(amountNum) && amountNum > 0) result.amount = amountNum;
    }

    return result;
  };

  const client = getClient();

  if (!client) {
    const fallbackData = localFallbackParse(rawText);
    return {
      success: true,
      data: fallbackData,
      isFallback: true,
      message: 'GEMINI_API_KEY is not configured or placeholder in .env. Parsed with local parser.',
    };
  }

  const prompt = `
You are a Bangladeshi e-commerce order parser. Extract the following fields from the given raw text (which may be in Bengali or English, or mixed):

- customerName: The customer's full name
- phoneNumber: Bangladeshi mobile number (11 digits starting with 01, remove spaces/dashes/country code)
- address: Full delivery address
- amount: The price/amount as a plain number (no currency symbols, no commas)
- orderNotes: Any additional note or instruction (if present after "Note:" or "নোট:" prefix, or if it's clearly a note/instruction that doesn't fit the other fields). Leave empty string if none.

Return ONLY a valid JSON object like:
{
  "customerName": "...",
  "phoneNumber": "...",
  "address": "...",
  "amount": 950,
  "orderNotes": ""
}

Do NOT include any explanation, markdown, or extra text. Only output the JSON.

Raw text:
"""
${rawText}
"""
`.trim();

  // Model priority: try newest and pro models first
  const MODEL_CANDIDATES = [
    'gemini-2.0-flash',
    'gemini-1.5-pro',
    'gemini-1.5-flash-latest',
    'gemini-1.5-pro-latest',
    'gemini-pro',
  ];

  let lastErr = null;

  for (const modelName of MODEL_CANDIDATES) {
    try {
      const model = client.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      const responseText = result.response.text().trim();
      const cleaned = responseText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(cleaned);

      return {
        success: true,
        data: {
          customerName: parsed.customerName || '',
          phoneNumber: String(parsed.phoneNumber || '').replace(/\D/g, '').replace(/^880/, '0').replace(/^88/, ''),
          address: parsed.address || '',
          amount: Number(parsed.amount) || 0,
          orderNotes: parsed.orderNotes || '',
        },
      };
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || '');
      // If model not found or invalid or 404, try next candidate
      if (msg.includes('404') || msg.includes('not found') || msg.includes('not supported') || msg.includes('400')) {
        continue;
      }
      break;
    }
  }

  // If all Gemini models failed (e.g. invalid key / quota / 404), fall back to local parser so user is NEVER blocked!
  const fallbackData = localFallbackParse(rawText);
  return {
    success: true,
    data: fallbackData,
    isFallback: true,
    message: `Gemini parsing unavailable (${lastErr?.message}). Parsed with local parser.`,
  };
};

module.exports = { parseOrderText };
