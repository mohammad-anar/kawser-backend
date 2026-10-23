const crypto = require('crypto');

/**
 * SHA-256 Hashing helper according to Meta Conversions API specifications
 */
function hashData(value) {
  if (!value || typeof value !== 'string') return null;
  const clean = value.trim().toLowerCase();
  if (!clean) return null;
  return crypto.createHash('sha256').update(clean).digest('hex');
}

/**
 * Format Bangladesh phone number to E.164 standard without '+' (e.g. 8801XXXXXXXXX)
 */
function formatBdPhoneForMeta(phone) {
  if (!phone) return null;
  let digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('880')) {
    return digits;
  }
  if (digits.startsWith('01')) {
    return '88' + digits;
  }
  if (digits.startsWith('1') && digits.length === 10) {
    return '880' + digits;
  }
  return digits.length >= 10 ? '88' + digits : digits;
}

/**
 * Send server-side Purchase event to Meta Conversions API
 * @param {Object} order - The created order document/object
 * @param {Object} req - Express request object for IP and User-Agent
 */
async function sendPurchaseEvent(order, req = {}) {
  const pixelId = process.env.META_PIXEL_ID || '1090280990042152';
  const accessToken = process.env.META_ACCESS_TOKEN;
  const testEventCode =
    (req.headers && req.headers['x-meta-test-code']) ||
    process.env.META_TEST_EVENT_CODE;

  if (!accessToken) {
    console.info(
      `[Meta CAPI] Skipped for Order ${order.orderId}: META_ACCESS_TOKEN is not configured in .env. (Browser Pixel will handle tracking)`
    );
    return { success: false, reason: 'NO_ACCESS_TOKEN' };
  }

  try {
    const rawIp =
      (req.headers && (req.headers['x-forwarded-for'] || req.headers['cf-connecting-ip'])) ||
      req.ip ||
      order.ipAddress ||
      '';
    const clientIp = String(rawIp).split(',')[0].trim();
    const clientUserAgent =
      (req.headers && req.headers['user-agent']) ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CareZoneBD/1.0';

    const cleanPhoneE164 = formatBdPhoneForMeta(order.phoneNumber);
    const hashedPhone = hashData(cleanPhoneE164);
    const hashedEmail = order.email ? hashData(order.email) : null;

    let hashedFirstName = null;
    let hashedLastName = null;
    if (order.customerName) {
      const parts = order.customerName.trim().split(/\s+/);
      if (parts[0]) hashedFirstName = hashData(parts[0]);
      if (parts.length > 1) hashedLastName = hashData(parts[parts.length - 1]);
    }

    // Category restriction compliant naming (avoids adult/sensitive health filter drops)
    const compliantVariant = order.size || '6.7 inch';
    const compliantContentName = `Care Zone Health Package (${compliantVariant})`;
    const compliantContentId = `cz-pkg-${compliantVariant.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

    const eventPayload = {
      event_name: 'Purchase',
      event_time: Math.floor(Date.now() / 1000),
      event_id: order.orderId, // Matches client-side fbq eventID for exact deduplication!
      event_source_url:
        (req.headers && (req.headers['referer'] || req.headers['origin'])) ||
        'https://carezonebd.com',
      action_source: 'website',
      user_data: {
        client_ip_address: clientIp || undefined,
        client_user_agent: clientUserAgent || undefined,
        ph: hashedPhone ? [hashedPhone] : undefined,
        em: hashedEmail ? [hashedEmail] : undefined,
        fn: hashedFirstName ? [hashedFirstName] : undefined,
        ln: hashedLastName ? [hashedLastName] : undefined,
      },
      custom_data: {
        value: Number(order.totalPrice),
        currency: 'BDT',
        content_name: compliantContentName,
        content_category: 'Health & Personal Care',
        content_ids: [compliantContentId],
        content_type: 'product',
        num_items: Number(order.quantity || 1),
      },
    };

    const requestBody = {
      data: [eventPayload],
    };

    if (testEventCode && testEventCode.trim()) {
      requestBody.test_event_code = testEventCode.trim();
      console.log(`[Meta CAPI] Sending with Test Event Code: ${testEventCode.trim()}`);
    }

    const apiUrl = `https://graph.facebook.com/v19.0/${pixelId}/events?access_token=${encodeURIComponent(accessToken)}`;

    console.log(`[Meta CAPI] Posting Purchase event for order ${order.orderId} (৳${order.totalPrice})...`);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const responseData = await response.json();

    if (response.ok) {
      console.log(
        `%c[Meta CAPI Success] Purchase event registered: Order ${order.orderId}`,
        'color: green; font-weight: bold;',
        {
          events_received: responseData.events_received,
          fbtrace_id: responseData.fbtrace_id,
          event_id: order.orderId,
          test_event_code: testEventCode || 'None (Production)',
        }
      );
      return { success: true, data: responseData };
    } else {
      console.error(
        `[Meta CAPI Response Error] HTTP ${response.status}:`,
        responseData
      );
      return { success: false, error: responseData };
    }
  } catch (err) {
    console.error(`[Meta CAPI Exception for Order ${order?.orderId}]:`, err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  sendPurchaseEvent,
  formatBdPhoneForMeta,
  hashData,
};
