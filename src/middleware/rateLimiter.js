/**
 * Sliding Window Log Rate Limiter for Order Placement
 * Rules: Max 2 orders per 1 minute (60,000 ms) per IP address
 */

const getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ip = forwarded.split(',')[0].trim();
    if (ip) return ip;
  }
  return req.socket?.remoteAddress || req.ip || 'unknown';
};

// In-memory map to store request timestamps: Map<ip, number[]>
const requestLog = new Map();

const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS = 2; // 2 orders per minute

const orderRateLimiter = (req, res, next) => {
  const ip = getClientIp(req);
  const now = Date.now();

  const timestamps = requestLog.get(ip) || [];
  
  // Remove timestamps that fall outside the sliding window
  const validTimestamps = timestamps.filter((time) => now - time < WINDOW_MS);

  if (validTimestamps.length >= MAX_REQUESTS) {
    const oldestTimestamp = validTimestamps[0];
    const waitSeconds = Math.ceil((WINDOW_MS - (now - oldestTimestamp)) / 1000);
    return res.status(429).json({
      success: false,
      message: `আপনি ১ মিনিটে ২ টির বেশি অর্ডার করতে পারবেন না। অনুগ্রহ করে ${waitSeconds} সেকেন্ড পর চেষ্টা করুন।`,
      retryAfter: waitSeconds,
    });
  }

  // Record this request
  validTimestamps.push(now);
  requestLog.set(ip, validTimestamps);

  next();
};

// Clean up memory every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of requestLog.entries()) {
    const activeTimestamps = timestamps.filter((time) => now - time < WINDOW_MS);
    if (activeTimestamps.length === 0) {
      requestLog.delete(ip);
    } else {
      requestLog.set(ip, activeTimestamps);
    }
  }
}, 5 * 60 * 1000);

module.exports = {
  getClientIp,
  orderRateLimiter,
};
