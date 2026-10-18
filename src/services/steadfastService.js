/**
 * Steadfast Courier API Integration Service
 * Documentation: https://portal.steadfast.com.bd/api/v1
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

const getBaseUrl = () => {
  return (process.env.STEADFAST_BASE_URL || 'https://portal.steadfast.com.bd/api/v1').replace(/\/+$/, '');
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

  const payload = {
    invoice: order.orderId,
    recipient_name: order.customerName,
    recipient_phone: order.phoneNumber.replace(/\s+/g, ''),
    recipient_address: order.address,
    cod_amount: Number(order.totalPrice) || 0,
    note: order.orderNotes || `Size: ${order.size || 'Standard'}, Qty: ${order.quantity || 1}`,
  };

  try {
    const res = await fetch(`${getBaseUrl()}/create_order`, {
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

  const dataArray = orders.map((order) => ({
    invoice: order.orderId,
    recipient_name: order.customerName,
    recipient_phone: order.phoneNumber.replace(/\s+/g, ''),
    recipient_address: order.address,
    cod_amount: Number(order.totalPrice) || 0,
    note: order.orderNotes || `Size: ${order.size || 'Standard'}, Qty: ${order.quantity || 1}`,
  }));

  try {
    const res = await fetch(`${getBaseUrl()}/create_order/bulk-order`, {
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
    const res = await fetch(`${getBaseUrl()}/status_by_cid/${cid}`, {
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
    const res = await fetch(`${getBaseUrl()}/status_by_invoice/${encodeURIComponent(invoice)}`, {
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
 * @param {string} phone - Customer mobile number (11 digits)
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

  const cleanPhone = String(phone).replace(/\s+/g, '').replace(/^(\+?88)/, '');

  try {
    // Try primary fraud_check/score/:phone first as per guide
    let res = await fetch(`${getBaseUrl()}/fraud_check/score/${cleanPhone}`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(12000),
    });

    // If 404, fallback to /fraud_check/:phone
    if (res.status === 404) {
      res = await fetch(`${getBaseUrl()}/fraud_check/${cleanPhone}`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(12000),
      });
    }

    const data = await res.json().catch(() => null);

    if (res.ok && data) {
      const totalParcels = Number(data.Total_parcels ?? data.total_parcels ?? data.total ?? 0);
      const delivered = Number(data.total_delivered ?? data.delivered ?? data.success ?? 0);
      const cancelled = Number(data.total_cancelled ?? data.cancelled ?? data.cancel ?? 0);

      const deliveryRate = totalParcels > 0 ? Math.round((delivered / totalParcels) * 100) : null;
      let riskLevel = 'unknown';
      if (totalParcels > 0) {
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
        fraudReports: data.total_fraud_reports || data.fraud_reports || [],
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
