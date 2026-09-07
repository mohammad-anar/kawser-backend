const cron = require('node-cron');

/**
 * Initializes a 14-minute cron job to keep the server alive on platforms like Render.
 * Free tier instances on Render sleep after 15 minutes of inactivity.
 * Pinging every 14 minutes ensures 24/7 uptime.
 *
 * @param {number|string} port - Local server port fallback
 */
function initKeepAlive(port = 5000) {
  // Determine backend base URL
  const getBaseUrl = () => {
    if (process.env.RENDER_EXTERNAL_URL) {
      return process.env.RENDER_EXTERNAL_URL;
    }
    if (process.env.BACKEND_URL) {
      return process.env.BACKEND_URL;
    }
    return `http://localhost:${port}`;
  };

  const pingServer = async () => {
    const baseUrl = getBaseUrl();
    const healthUrl = `${baseUrl.replace(/\/$/, '')}/api/health`;

    try {
      const response = await fetch(healthUrl, {
        method: 'GET',
        headers: { 'User-Agent': 'PersonalCareBD-KeepAliveCron/1.0' },
      });

      if (response.ok) {
        const data = await response.json();
        console.log(`[Keep-Alive Cron] [${new Date().toLocaleTimeString('en-GB')}] Ping Successful -> ${healthUrl} (${data.status})`);
      } else {
        console.warn(`[Keep-Alive Cron] [${new Date().toLocaleTimeString('en-GB')}] Ping returned HTTP ${response.status}`);
      }
    } catch (err) {
      console.error(`[Keep-Alive Cron] Ping Error:`, err.message);
    }
  };

  // Schedule cron for every 14 minutes: */14 * * * *
  const job = cron.schedule('*/14 * * * *', () => {
    pingServer();
  });

  console.log(`[Keep-Alive Cron] Initialized: Running every 14 minutes for Render continuous uptime`);

  return { job, pingServer };
}

module.exports = { initKeepAlive };
