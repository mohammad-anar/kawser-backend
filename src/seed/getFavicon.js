const fs = require('fs');
const path = require('path');

async function downloadLogoAndFavicon() {
  const logoUrl = 'https://personalcarebd.com/wp-content/uploads/2026/08/White-Blue-Health-Care-Innovation-Presentation-4.png';
  console.log('Downloading site logo / icon from:', logoUrl);

  const res = await fetch(logoUrl);
  if (res.ok) {
    const buffer = Buffer.from(await res.arrayBuffer());
    console.log(`Downloaded image size: ${buffer.length} bytes`);

    const appDir = path.resolve(__dirname, '../../../frontend/app');
    const publicDir = path.resolve(__dirname, '../../../frontend/public');

    // Next.js App router standard icon files:
    // icon.png, apple-icon.png, favicon.ico in app/ directory
    fs.writeFileSync(path.join(appDir, 'icon.png'), buffer);
    fs.writeFileSync(path.join(appDir, 'apple-icon.png'), buffer);
    fs.writeFileSync(path.join(appDir, 'favicon.ico'), buffer);
    fs.writeFileSync(path.join(publicDir, 'favicon.ico'), buffer);
    fs.writeFileSync(path.join(publicDir, 'logo.png'), buffer);

    console.log('✅ Successfully updated favicon and icon in frontend/app and frontend/public!');
  } else {
    console.error('Failed to download logo:', res.status);
  }
}

downloadLogoAndFavicon();
