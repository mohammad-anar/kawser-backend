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
  // Helper for fast local regex / line-based parsing (optimized for WhatsApp chat forwards)
  const localFallbackParse = (rawInput) => {
    // 1. Clean WhatsApp headers and timestamps
    const rawLines = rawInput
      .split('\n')
      .map((l) => l.replace(/^\[\d{1,2}:\d{2}\s*(?:am|pm|AM|PM)[^\]]*\]\s*(?:[^:]*:\s*)?/i, '').trim())
      .filter(Boolean);

    const lines = rawLines.filter((l) => {
      if (/^(whatsapp|facebook|messenger)$/i.test(l)) return false;
      if (/^[📌🔴⚠️]/.test(l)) return false;
      if (/তারিখ পিকাপ/i.test(l)) return false;
      return true;
    });

    const fullCleanText = lines.join('\n');

    const result = {
      customerName: '',
      phoneNumber: '',
      address: '',
      size: '5.7 inch',
      amount: 0,
      orderNotes: '',
    };

    // 2. Detect Size:
    // Rule: p2 thakle size 6.7 inch, and p1 thakle ba p2 na thakle size 5.7 inch
    if (/\b(?:p2|p-2)\b/i.test(fullCleanText) || /(?:৬\.৭|6\.7)/.test(fullCleanText)) {
      result.size = '6.7 inch';
    } else {
      result.size = '5.7 inch';
    }

    const usedIndices = new Set();

    // 3. Extract Notes
    const noteIdx = lines.findIndex((l) => /^(?:note|notes|নোট|মন্তব্য)\s*[:ঃ-]?/i.test(l));
    if (noteIdx !== -1) {
      result.orderNotes = lines[noteIdx].replace(/^(?:note|notes|নোট|মন্তব্য)\s*[:ঃ-]?\s*/i, '').trim();
      usedIndices.add(noteIdx);
    }

    // 4. Extract Phone Number FIRST (11 digits or more starting with 01)
    const phoneIdx = lines.findIndex((l) => {
      if (/^(?:phone|mobile|cell|contact|ফোন|মোবাইল|নম্বর)\s*[:ঃ-]?/i.test(l)) return true;
      const norm = l.replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6)).replace(/\D/g, '');
      return /^(?:88)?01[3-9]\d{8,}$/.test(norm);
    });
    if (phoneIdx !== -1) {
      const rawPhone = lines[phoneIdx].replace(/^(?:phone|mobile|cell|contact|ফোন|মোবাইল|নম্বর)\s*[:ঃ-]?\s*/i, '');
      result.phoneNumber = rawPhone
        .replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6))
        .replace(/\D/g, '')
        .replace(/^880/, '0')
        .replace(/^88/, '');
      usedIndices.add(phoneIdx);
    }

    // 5. Extract Price / Amount (Product price is 3 digits or under 1500)
    const priceIdx = lines.findIndex((l, i) => {
      if (usedIndices.has(i)) return false;
      if (/^(?:price|amount|প্রাইজ|দাম|মূল্য)\s*[:ঃ-]?/i.test(l)) return true;
      const norm = l.replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6)).trim();
      if (/^\d+\s*(?:taka|টাকা|tk)?$/i.test(norm)) {
        const val = parseFloat(norm.replace(/[^\d.]/g, ''));
        return !isNaN(val) && val >= 50 && val <= 1500;
      }
      return false;
    });
    if (priceIdx !== -1) {
      const rawPrice = lines[priceIdx].replace(/^(?:price|amount|প্রাইজ|দাম|মূল্য)\s*[:ঃ-]?\s*/i, '');
      const norm = rawPrice.replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6));
      const num = parseFloat(norm.replace(/[^\d.]/g, ''));
      if (!isNaN(num) && num > 0) {
        result.amount = num;
        usedIndices.add(priceIdx);
      }
    }

    // 6. Extract Address components (district, thana, gram, division, etc. combine into single string)
    const addrParts = [];
    lines.forEach((l, i) => {
      if (usedIndices.has(i)) return;
      if (/^(?:গ্রাম|মহল্লা|রোড|পাড়া|পাড়া|বাড়ি|বাড়ি)\s*[:ঃ-]/i.test(l)) {
        addrParts.push(l);
        usedIndices.add(i);
      } else if (/^(?:থানা|উপজেলা)\s*[:ঃ-]/i.test(l)) {
        addrParts.push(l);
        usedIndices.add(i);
      } else if (/^(?:জেলা)\s*[:ঃ-]/i.test(l)) {
        addrParts.push(l);
        usedIndices.add(i);
      } else if (/^(?:বিভাগ)\s*[:ঃ-]/i.test(l)) {
        addrParts.push(l);
        usedIndices.add(i);
      } else if (/^(?:ঠিকানা|address)\s*[:ঃ,-]/i.test(l)) {
        addrParts.push(l.replace(/^(?:ঠিকানা|address)\s*[:ঃ,-]\s*/i, '').trim());
        usedIndices.add(i);
      }
    });

    if (addrParts.length > 0) {
      result.address = addrParts.join(', ');
    }

    // 7. Extract Name
    const nameIdx = lines.findIndex((l, i) => !usedIndices.has(i) && /^(?:name|নাম|গ্রাহকের\s*নাম)\s*[:ঃ-]/i.test(l));
    if (nameIdx !== -1) {
      result.customerName = lines[nameIdx].replace(/^(?:name|নাম|গ্রাহকের\s*নাম)\s*[:ঃ-]\s*/i, '').trim();
      usedIndices.add(nameIdx);
    }

    // 8. Remaining lines for positional fallback
    const remaining = [];
    lines.forEach((l, i) => {
      if (usedIndices.has(i)) return;
      if (/\b(?:p1|p2|p-1|p-2)\b/i.test(l)) return;
      if (/^(?:size|সাইজ)\s*[:ঃ-]?/i.test(l)) return;
      remaining.push(l);
    });

    if (!result.customerName && remaining.length > 0) {
      result.customerName = remaining.shift();
    }

    if (!result.address && remaining.length > 0) {
      result.address = remaining.join(', ');
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
You are an expert e-commerce order parser for a Bangladeshi online store (Care Zone BD).
The input text is usually copied from WhatsApp chats or customer forwarded messages.

TRAINING RULES & FIELD GUIDELINES:
1. Product Size:
   - If "p2" or "6.7" or "৬.৭" is present in text -> size MUST be "6.7 inch"
   - If "p1" is present, OR if "p2" is NOT present in text -> size MUST be "5.7 inch" (Default size is 5.7 inch)
2. Product Amount / Price:
   - Product price is typically 3 digits or under 1500 BDT (e.g. 899, 950, 900, 1000, 1200, 850).
   - Look for "প্রাইজ: ৮৯৯", "প্রাইজ: ৯৫০", "প্রাইজ:৯০০ টাকা", "price:899", "899 taka", "৮৯৯ টাকা", "900", "৮৯৯".
   - CRITICAL: Never mistake an 11-digit mobile number for price!
3. Mobile Number:
   - 11 digits or more (starting with 01, e.g. 01710087271 or ০১৯২৭০২৮৬৭৪).
   - Preceded by "মোবাইল:", "মোবাইল নাম্বার:", "ফোন:", or plain 11-digit number.
   - Always output as clean 11 English digits (e.g. "01927028674").
4. Customer Address:
   - If "জেলা", "থানা", "গ্রাম", "বিভাগ", "রোড", "পাড়া" are separate lines, COMBINE all of them into a single complete address string (e.g., "জেলা: ফরিদপুর, থানা: ফরিদপুর, গ্রাম: মিয়াপাড়া").
   - If given as a single location line (e.g. "লক্ষীপুর, চনদ্রগন্জ, বটতলীর উত্তরে, পদ্দপুকুর পুকুড়"), use it as address.
5. Customer Name:
   - Can be labeled ("নাম: ...", "Name: ...") or can simply be the first line without label (e.g., "সামসুল আলম", "গোলাম রসুল", "Rana", "আহসান", "রুহুল আমীন", "নির").
6. Order Notes:
   - Look for "নোট: ..." or "Note: ...". If not present, return empty string "".
7. WhatsApp Noise:
   - Strip out timestamps like "[8:14 pm, 14/10/2026] Name:" and ignore words like "Whatsapp" or "📌নতুন অর্ডার".

TRAINING EXAMPLES BASED ON REAL WHATSAPP CHATS:

Example 1 (No p2 -> default 5.7 inch, plain lines):
Input:
[8:14 pm, 14/10/2026] Rifat Final Fr: সামসুল আলম
লক্ষীপুর, চনদ্রগন্জ, বটতলীর উত্তরে, পদ্দপুকুর পুকুড় 
01710087271
950 taka

Output:
{"customerName":"সামসুল আলম","phoneNumber":"01710087271","address":"লক্ষীপুর, চনদ্রগন্জ, বটতলীর উত্তরে, পদ্দপুকুর পুকুড়","size":"5.7 inch","amount":950,"orderNotes":""}

Example 2 (Combined district, thana, village into single address):
Input:
[10:12 pm, 14/10/2026] Rifat Final Fr: নাম:গোলাম রসুল
মোবাইল নাম্বার:০১৯২৭০২৮৬৭৪
জেলা:ফরিদপুর 
থানা:ফরিদপুর 
গ্রাম: মিয়াপাড়া 
প্রাইজ:৯৫০

Output:
{"customerName":"গোলাম রসুল","phoneNumber":"01927028674","address":"জেলা:ফরিদপুর, থানা:ফরিদপুর, গ্রাম: মিয়াপাড়া","size":"5.7 inch","amount":950,"orderNotes":""}

Example 3 (p2 specified -> size 6.7 inch):
Input:
[1:15 am, 15/10/2026] Care Zone BD: Rana
ঠিকানা,  জুরাইন,  পোস্তগোলা, বিক্রমপুর প্লাজা মার্কেটের সামনে
ফোন:-01740495690
price:900
p2

Output:
{"customerName":"Rana","phoneNumber":"01740495690","address":"জুরাইন,  পোস্তগোলা, বিক্রমপুর প্লাজা মার্কেটের সামনে","size":"6.7 inch","amount":900,"orderNotes":""}

Example 4 (Special delivery note):
Input:
[12:04 pm, 15/10/2026] Rifat Final Fr: আতিকুর রহমান
সিলেট,গোলাপগঞ্জ, কদম গাছের তলা
01817935343
প্রাইজ:৯০০ টাকা

নোট: সন্ধা ৬ টার পর ডেলিভারি করতে হবে।

Output:
{"customerName":"আতিকুর রহমান","phoneNumber":"01817935343","address":"সিলেট,গোলাপগঞ্জ, কদম গাছের তলা","size":"5.7 inch","amount":900,"orderNotes":"সন্ধা ৬ টার পর ডেলিভারি করতে হবে।"}

Output ONLY valid raw JSON with keys: customerName, phoneNumber, address, size, amount, orderNotes. Do not wrap in markdown or backticks.

Raw text to parse:
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

      let detectedSize = '5.7 inch';
      const rawSizeStr = String(parsed.size || '');
      if (rawSizeStr.includes('6.7') || rawSizeStr.includes('৬.৭') || /\b(?:p2|p-2)\b/i.test(rawText) || /(?:৬\.৭|6\.7)/.test(rawText)) {
        detectedSize = '6.7 inch';
      } else {
        detectedSize = '5.7 inch';
      }

      return {
        success: true,
        data: {
          customerName: parsed.customerName || '',
          phoneNumber: String(parsed.phoneNumber || '').replace(/\D/g, '').replace(/^880/, '0').replace(/^88/, ''),
          address: parsed.address || '',
          size: detectedSize,
          amount: Number(parsed.amount) || 0,
          orderNotes: parsed.orderNotes || '',
        },
      };
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || '');
      if (msg.includes('404') || msg.includes('not found') || msg.includes('not supported') || msg.includes('400')) {
        continue;
      }
      break;
    }
  }

  // If all Gemini models failed, fallback to local parser
  const fallbackData = localFallbackParse(rawText);
  return {
    success: true,
    data: fallbackData,
    isFallback: true,
    message: `Gemini parsing unavailable (${lastErr?.message}). Parsed with local parser.`,
  };
};

module.exports = { parseOrderText };
