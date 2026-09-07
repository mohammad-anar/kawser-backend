const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const targetDir = 'e:/Anar/PR/ks/frontend/public/images/products';
const logoDir = 'e:/Anar/PR/ks/frontend/public/images';

fs.mkdirSync(targetDir, { recursive: true });
fs.mkdirSync(logoDir, { recursive: true });

const download = (url, dest) => {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    client
      .get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          file.close();
          fs.unlink(dest, () => {});
          download(res.headers.location, dest).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlink(dest, () => {});
          reject(new Error(`HTTP status ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      })
      .on('error', (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
  });
};

const getPageContent = (url) => {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data));
      })
      .on('error', reject);
  });
};

(async () => {
  console.log('Fetching competitor webpage HTML...');
  const html = await getPageContent('https://personalcarebd.com/');

  // Extract all image URLs from HTML
  const imgRegex = /https:\/\/personalcarebd\.com\/wp-content\/uploads\/[^\s"'>)]+\.(?:jpg|jpeg|png|webp|gif)/gi;
  const matches = html.match(imgRegex) || [];
  const uniqueUrls = Array.from(new Set(matches));

  console.log(`Found ${uniqueUrls.length} image URLs on personalcarebd.com`);

  // Explicit known product images mapping
  const knownImages = [
    {
      url: 'https://personalcarebd.com/wp-content/uploads/2026/01/top-notch-condom-300x300.jpg',
      filename: 'product-main.jpg',
    },
    {
      url: 'https://personalcarebd.com/wp-content/uploads/2026/08/Top-Notch-1-768x1029-1-224x300.webp',
      filename: 'product-1.webp',
    },
    {
      url: 'https://personalcarebd.com/wp-content/uploads/2026/08/TN-2-1-234x300.webp',
      filename: 'product-2.webp',
    },
    {
      url: 'https://personalcarebd.com/wp-content/uploads/2026/08/tn-32-1-768x765-1-300x300.webp',
      filename: 'product-3.webp',
    },
    {
      url: 'https://personalcarebd.com/wp-content/uploads/2026/08/WhatsApp-Image-2025-10-12-at-01.19.03_eb7080ea-300x300.jpg',
      filename: 'product-4.jpg',
    },
    {
      url: 'https://personalcarebd.com/wp-content/uploads/2026/08/123-1-1-1.jpeg',
      filename: 'product-5.jpeg',
    },
  ];

  for (const img of knownImages) {
    const dest = path.join(targetDir, img.filename);
    try {
      await download(img.url, dest);
      console.log(`[Downloaded] Known product asset: ${img.filename}`);
    } catch (err) {
      console.error(`[Error] ${img.filename}: ${err.message}`);
    }
  }

  // Also download any additional images discovered on page
  let count = 0;
  for (const url of uniqueUrls) {
    const ext = path.extname(url.split('?')[0]);
    const baseName = path.basename(url.split('?')[0]);
    const dest = path.join(targetDir, baseName);

    if (!fs.existsSync(dest)) {
      try {
        await download(url, dest);
        count++;
        console.log(`[Downloaded] Page asset: ${baseName}`);
      } catch (err) {
        // ignore individual failed formats
      }
    }
  }

  console.log(`Finished downloading all images into: ${targetDir}`);
})();
