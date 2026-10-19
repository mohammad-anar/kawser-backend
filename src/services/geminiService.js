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
  const client = getClient();
  if (!client) {
    return {
      success: false,
      isConfigMissing: true,
      message: 'GEMINI_API_KEY is not configured in backend .env',
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

  try {
    const model = client.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContent(prompt);
    const responseText = result.response.text().trim();

    // Strip markdown code fences if present
    const cleaned = responseText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

    const parsed = JSON.parse(cleaned);

    return {
      success: true,
      data: {
        customerName: parsed.customerName || '',
        phoneNumber: String(parsed.phoneNumber || '').replace(/\D/g, '').replace(/^880/, '').replace(/^88/, ''),
        address: parsed.address || '',
        amount: Number(parsed.amount) || 0,
        orderNotes: parsed.orderNotes || '',
      },
    };
  } catch (err) {
    return {
      success: false,
      message: `Gemini parse error: ${err.message}`,
    };
  }
};

module.exports = { parseOrderText };
