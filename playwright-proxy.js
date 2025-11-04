// Playwright-based Proxy Server
// Uses Playwright's authenticated browser context as a proxy
// No client-side injection needed - all requests go through Playwright

import express from 'express';
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const COOKIES_FILE = path.join(__dirname, 'heygen-cookies.json');
const TARGET = 'https://app.heygen.com';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Branding configuration
const BRANDING = {
  oldName: 'HeyGen',
  newName: 'VideoAI Pro',
  oldDomain: 'heygen.com',
  newDomain: 'localhost:3000',
  primaryColor: '#6366f1',
  secondaryColor: '#8b5cf6',
  logoUrl: '/custom-assets/logo.svg'
};

let browser = null;
let context = null;

// Page pool for better performance
const pagePool = [];
const MAX_POOL_SIZE = 5;

async function getPage() {
  if (pagePool.length > 0) {
    return pagePool.pop();
  }
  return await context.newPage();
}

function releasePage(page) {
  if (pagePool.length < MAX_POOL_SIZE) {
    // Clear page state before returning to pool
    page.removeAllListeners();
    pagePool.push(page);
  } else {
    page.close().catch(() => {});
  }
}

// Initialize Playwright browser with authentication
async function initBrowser() {
  if (!fs.existsSync(COOKIES_FILE)) {
    console.error('❌ No authentication cookies found!');
    console.log('👉 Please login first at: http://localhost:3002\n');
    process.exit(1);
  }

  const storageState = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
  
  browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox'
    ]
  });

  context = await browser.newContext({
    storageState: {
      cookies: storageState,
      origins: []
    },
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
    permissions: ['clipboard-read', 'clipboard-write'],
    bypassCSP: true,
    ignoreHTTPSErrors: true
  });

  // Pre-warm the page pool
  for (let i = 0; i < 3; i++) {
    const page = await context.newPage();
    pagePool.push(page);
  }

  console.log('✅ Playwright browser initialized with authentication');
  console.log(`📄 Page pool initialized with ${pagePool.length} pages`);
}

// Serve custom assets
app.use('/custom-assets', express.static(path.join(__dirname, 'custom-assets')));

// Check auth middleware
app.use((req, res, next) => {
  // Skip for custom assets
  if (req.path.startsWith('/custom-assets')) {
    return next();
  }
  
  // Reload cookies if updated
  if (fs.existsSync(COOKIES_FILE)) {
    const freshCookies = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
    if (freshCookies && freshCookies.length > 0) {
      // Cookies are fresh, continue
      next();
    } else {
      return res.redirect('http://localhost:3002');
    }
  } else {
    return res.redirect('http://localhost:3002');
  }
});

// Main proxy endpoint - uses Playwright to fetch and modify content
app.all('*', async (req, res) => {
  const page = await getPage();
  
  try {
    const targetUrl = TARGET + req.path + (req.url.includes('?') ? '?' + req.url.split('?')[1] : '');
    
    console.log(`→ ${req.method} ${req.path}`);

    // For non-HTML requests (JS, CSS, images, API calls), use context.request directly
    const isStaticAsset = /\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|ico|map)$/i.test(req.path);
    const isApiCall = req.method === 'POST' || req.path.startsWith('/__api') || req.path.includes('/api/');
    
    if (isStaticAsset || isApiCall) {
      const response = await context.request.fetch(targetUrl, {
        method: req.method,
        data: req.body,
        headers: {
          'content-type': req.headers['content-type'] || 'application/json',
          'origin': TARGET,
          'referer': TARGET + '/',
          'accept': req.headers['accept'] || '*/*'
        }
      });

      const body = await response.body();
      res.status(response.status());
      
      // Preserve original content-type
      const contentType = response.headers()['content-type'];
      if (contentType) {
        res.set('Content-Type', contentType);
      }
      
      return res.send(body);
    }

    // Navigate to the target URL (no route interception - let Playwright handle it)
    const response = await page.goto(targetUrl, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    // Get the final content after page loads
    let content = await page.content();
    const status = response.status();
    
    // Modify HTML content for rebranding
    content = content.replace(new RegExp(BRANDING.oldName, 'gi'), BRANDING.newName);
    content = content.replace(new RegExp(BRANDING.oldDomain, 'gi'), BRANDING.newDomain);
    
    // Inject custom branding
    const customCode = generateCustomCode();
    if (content.includes('</head>')) {
      content = content.replace('</head>', customCode + '</head>');
    } else if (content.includes('</body>')) {
      content = content.replace('</body>', customCode + '</body>');
    }
    
    // Set response headers
    res.status(status);
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(content);
    
  } catch (error) {
    console.error('❌ Proxy error:', error.message);
    res.status(500).send(`
      <h1>Proxy Error</h1>
      <p>${error.message}</p>
      <p><a href="http://localhost:3002">Return to login</a></p>
    `);
  } finally {
    // Return page to pool
    releasePage(page);
  }
});

function generateCustomCode() {
  return `
    <!-- Custom Rebranding Injection -->
    <style id="custom-rebrand-styles">
      :root {
        --primary-color: ${BRANDING.primaryColor} !important;
        --secondary-color: ${BRANDING.secondaryColor} !important;
      }
      
      img[src*="heygen"],
      img[alt*="heygen" i],
      img[alt*="HeyGen"] {
        display: none !important;
      }
      
      button[class*="primary"],
      .btn-primary {
        background-color: ${BRANDING.primaryColor} !important;
        border-color: ${BRANDING.primaryColor} !important;
      }
      
      button[class*="primary"]:hover,
      .btn-primary:hover {
        background-color: ${BRANDING.secondaryColor} !important;
      }
      
      .custom-logout {
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: ${BRANDING.primaryColor};
        color: white;
        padding: 10px 20px;
        border-radius: 8px;
        cursor: pointer;
        z-index: 9999;
      }
    </style>
    
    <script id="custom-rebrand-script">
      (function() {
        console.log('🎨 Rebranding active: ${BRANDING.newName}');
        
        // Add logout button
        const logoutBtn = document.createElement('div');
        logoutBtn.className = 'custom-logout';
        logoutBtn.innerHTML = '🚪 Logout';
        logoutBtn.onclick = () => {
          if (confirm('Logout?')) {
            window.location.href = 'http://localhost:3002/api/logout';
          }
        };
        document.body.appendChild(logoutBtn);
      })();
    </script>
  `;
}

// Start server
async function start() {
  await initBrowser();
  
  app.listen(PORT, () => {
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║  🎨 VideoAI Pro - Playwright Proxy Server             ║');
    console.log('╠════════════════════════════════════════════════════════╣');
    console.log(`║  Proxy URL:    http://localhost:${PORT}                   ║`);
    console.log(`║  Target:       ${TARGET}                  ║`);
    console.log('║  Auth Status:  ✅ Authenticated (Playwright)           ║');
    console.log('╠════════════════════════════════════════════════════════╣');
    console.log('║  All requests go through Playwright browser context    ║');
    console.log('║  No client-side injection needed!                      ║');
    console.log('╚════════════════════════════════════════════════════════╝');
  });
}

// Cleanup on exit
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  if (context) await context.close();
  if (browser) await browser.close();
  process.exit(0);
});

start().catch(console.error);
