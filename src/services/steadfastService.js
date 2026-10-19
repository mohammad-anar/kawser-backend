/**
 * Steadfast Courier API Integration Service
 * Base URLs supported: https://portal.packzy.com/api/v1 (primary live) and https://portal.steadfast.com.bd/api/v1
 */

const getHeaders = () => {
  const apiKey = process.env.STEADFAST_API_KEY;
  const secretKey = process.env.STEADFAST_SECRET_KEY;

  if (!apiKey || !secretKey) {
    return null;
  }

  return {
    'Api-Key': apiKey.trim(),
    'Secret-Key': secretKey.trim(),
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
};

const getBaseUrls = () => {
  const configured = (process.env.STEADFAST_BASE_URL || '').trim().replace(/\/+$/, '');
  const urls = [];

  // If user configured portal.packzy.com, put it first
  if (configured && !configured.includes('portal.steadfast.com.bd')) {
    urls.push(configured);
  }

  // Always include portal.packzy.com as the working live server
  if (!urls.includes('https://portal.packzy.com/api/v1')) {
    urls.push('https://portal.packzy.com/api/v1');
  }

  // Also include portal.steadfast.com.bd if anyone needs it
  if (configured && !urls.includes(configured)) {
    urls.push(configured);
  }

  return urls;
};

const getBaseUrl = () => {
  return getBaseUrls()[0];
};

/**
 * Robust fetch that tries primary base URL and automatically falls back to portal.packzy.com
 */
const sfFetch = async (endpoint, options = {}) => {
  const baseUrls = getBaseUrls();
  let lastError = null;

  for (const base of baseUrls) {
    try {
      const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
      const url = `${base}${cleanEndpoint}`;
      const res = await fetch(url, options);
      return res;
    } catch (err) {
      lastError = err;
      // Try next base URL
    }
  }

  throw lastError || new Error('Failed to connect to Steadfast Courier API.');
};

/**
 * Create a single order in Steadfast Courier
 * @param {Object} order - Order object from database
 */
const createOrder = async (order) => {
  const headers = getHeaders();
  if (!headers) {
    return {
      success: false,
      isConfigMissing: true,
      message: 'Steadfast API Key or Secret Key is not configured in backend .env',
    };
  }

  const cleanPhone = String(order.phoneNumber).replace(/\s+/g, '').replace(/^(\+?88)/, '');

  const payload = {
    invoice: order.orderId,
    recipient_name: order.customerName,
    recipient_phone: cleanPhone,
    recipient_address: order.address,
    cod_amount: Number(order.totalPrice) || 0,
    note: order.orderNotes || '',
  };

  try {
    const res = await sfFetch('/create_order', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });

    const data = await res.json().catch(() => null);

    if (res.ok && data && (data.status === 200 || data.consignment)) {
      return {
        success: true,
        consignment: data.consignment,
        message: data.message || 'Consignment created successfully.',
        invoiceSent: order.orderId,
        raw: data,
      };
    }

    return {
      success: false,
      status: res.status,
      message: data?.message || data?.errors || `Steadfast API error (HTTP ${res.status})`,
      raw: data,
    };
  } catch (err) {
    return {
      success: false,
      message: `Steadfast connection error: ${err.message}`,
    };
  }
};

/**
 * Bulk create orders in Steadfast Courier (up to 500 orders per request)
 * @param {Array<Object>} orders - Array of order objects from database
 */
const createBulkOrders = async (orders) => {
  const headers = getHeaders();
  if (!headers) {
    return {
      success: false,
      isConfigMissing: true,
      message: 'Steadfast API Key or Secret Key is not configured in backend .env',
    };
  }

  if (!Array.isArray(orders) || orders.length === 0) {
    return {
      success: false,
      message: 'No orders provided for Steadfast bulk submission.',
    };
  }

  const dataArray = orders.map((order) => {
    const cleanPhone = String(order.phoneNumber).replace(/\s+/g, '').replace(/^(\+?88)/, '');
    return {
      invoice: order.orderId,
      recipient_name: order.customerName,
      recipient_phone: cleanPhone,
      recipient_address: order.address,
      cod_amount: Number(order.totalPrice) || 0,
      note: order.orderNotes || '',
    };
  });

  try {
    const res = await sfFetch('/create_order/bulk-order', {
      method: 'POST',
      headers,
      body: JSON.stringify({ data: dataArray }),
      signal: AbortSignal.timeout(25000),
    });

    const data = await res.json().catch(() => null);

    if (res.ok && data && (data.status === 200 || data.data)) {
      return {
        success: true,
        consignments: data.data || data.consignments || [],
        message: data.message || `${orders.length} orders submitted to Steadfast successfully.`,
        raw: data,
      };
    }

    return {
      success: false,
      status: res.status,
      message: data?.message || data?.errors || `Steadfast bulk error (HTTP ${res.status})`,
      raw: data,
    };
  } catch (err) {
    return {
      success: false,
      message: `Steadfast bulk connection error: ${err.message}`,
    };
  }
};

/**
 * Get delivery status by Consignment ID (CID)
 * @param {string|number} cid
 */
const getStatusByCid = async (cid) => {
  const headers = getHeaders();
  if (!headers) {
    return { success: false, isConfigMissing: true, message: 'Steadfast credentials missing.' };
  }

  try {
    const res = await sfFetch(`/status_by_cid/${cid}`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10000),
    });

    const data = await res.json().catch(() => null);
    if (res.ok && data) {
      return {
        success: true,
        delivery_status: data.delivery_status || data.status,
        raw: data,
      };
    }

    return {
      success: false,
      status: res.status,
      message: data?.message || `Status check failed (HTTP ${res.status})`,
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
};

/**
 * Get delivery status by Invoice / Order ID
 * @param {string} invoice
 */
const getStatusByInvoice = async (invoice) => {
  const headers = getHeaders();
  if (!headers) {
    return { success: false, isConfigMissing: true, message: 'Steadfast credentials missing.' };
  }

  try {
    const res = await sfFetch(`/status_by_invoice/${encodeURIComponent(invoice)}`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10000),
    });

    const data = await res.json().catch(() => null);
    if (res.ok && data) {
      return {
        success: true,
        delivery_status: data.delivery_status || data.status,
        raw: data,
      };
    }

    return {
      success: false,
      status: res.status,
      message: data?.message || `Invoice status check failed (HTTP ${res.status})`,
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
};

/**
 * Check customer fraud score & delivery success history by phone number
 * Handles both the modern /fraud_check/score/:phone and fallback /fraud_check/:phone
 * @param {string} phone - Customer mobile number (11 digits, e.g. 017...)
 */
const checkFraudScore = async (phone) => {
  const headers = getHeaders();
  if (!headers) {
    return {
      success: false,
      isConfigMissing: true,
      message: 'Steadfast credentials missing in backend .env',
    };
  }

  // Sanitize phone: keep only digits and remove leading +88 / 88 if present
  let cleanPhone = String(phone).replace(/\D+/g, '');
  if (cleanPhone.startsWith('880')) {
    cleanPhone = cleanPhone.slice(2);
  } else if (cleanPhone.startsWith('88')) {
    cleanPhone = cleanPhone.slice(2);
  }

  try {
    // 1. Try modern /fraud_check/score/:phone endpoint (Active since Sep 2026)
    let res = await sfFetch(`/fraud_check/score/${cleanPhone}`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(12000),
    });

    // 2. If 404, fallback to /fraud_check/:phone
    if (res.status === 404) {
      res = await sfFetch(`/fraud_check/${cleanPhone}`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(12000),
      });
    }

    const data = await res.json().catch(() => null);

    if (res.ok && data) {
      // Parse modern score fields (delivered_count, cancelled_count, delivery_ratio)
      // and legacy fields (Total_parcels, total_delivered, total_cancelled)
      const delivered = Number(data.delivered_count ?? data.total_delivered ?? data.delivered ?? data.success ?? 0);
      const cancelled = Number(data.cancelled_count ?? data.total_cancelled ?? data.cancelled ?? data.cancel ?? 0);
      const totalFromCounts = delivered + cancelled;

      const totalParcels = totalFromCounts > 0
        ? totalFromCounts
        : Number(data.Total_parcels ?? data.total_parcels ?? data.total ?? 0);

      let deliveryRate = null;
      if (data.delivery_ratio != null) {
        deliveryRate = Number(data.delivery_ratio);
      } else if (totalParcels > 0) {
        deliveryRate = Math.round((delivered / totalParcels) * 100);
      }

      // Calculate risk level
      let riskLevel = 'unknown';
      if (data.level) {
        riskLevel = String(data.level).toLowerCase();
      } else if (totalParcels > 0 && deliveryRate !== null) {
        if (deliveryRate >= 80) riskLevel = 'low';
        else if (deliveryRate >= 50) riskLevel = 'medium';
        else riskLevel = 'high';
      }

      return {
        success: true,
        phone: cleanPhone,
        totalParcels,
        delivered,
        cancelled,
        deliveryRate,
        riskLevel,
        volumeRange: data.volume_range || null,
        volumeBand: data.volume_band || null,
        totalReports: Number(data.total_reports ?? (Array.isArray(data.total_fraud_reports) ? data.total_fraud_reports.length : 0)),
        cancellationRatio: data.cancellation_ratio ?? null,
        returnRatio: data.return_ratio ?? null,
        raw: data,
      };
    }

    return {
      success: false,
      status: res.status,
      message: data?.message || `Fraud check failed (HTTP ${res.status})`,
      raw: data,
    };
  } catch (err) {
    return {
      success: false,
      message: `Fraud check connection error: ${err.message}`,
    };
  }
};

module.exports = {
  getHeaders,
  getBaseUrl,
  createOrder,
  createBulkOrders,
  getStatusByCid,
  getStatusByInvoice,
  checkFraudScore,
};
