// Playwright Live Proxy - User interacts with a live Playwright browser
// Uses WebSocket to stream browser view and handle user interactions

import express from 'express';
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import fileUpload from 'express-fileupload';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const COOKIES_FILE = path.join(__dirname, 'heygen-cookies.json');
const TARGET = 'https://app.heygen.com';

const proxyRouter = express.Router();
const app = express();
proxyRouter.use(express.json());

// Add CORS middleware
proxyRouter.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

proxyRouter.use(fileUpload({
  useTempFiles: true,
  tempFileDir: '/tmp/',
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
}));

let server = createServer(app);
let wss = null; // Will be initialized with the server instance

// Function to set up WebSocket server
function setupWebSocketServer(httpServer) {
  server = httpServer;
  wss = new WebSocketServer({ server });
  console.log('✅ WebSocket server attached to HTTP server');
  
  // Set up WebSocket connection handler
  setupWebSocketHandler();
}

// WebSocket handler setup (called after server is ready)
function setupWebSocketHandler() {
  if (!wss) {
    console.error('❌ WebSocket server not initialized');
    return;
  }
  
  wss.on('connection', (ws) => {
    console.log('🔌 Client connected via WebSocket');
    
    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message);
        console.log('📨 Received command:', data);
        
        if (!activePage) {
          ws.send(JSON.stringify({ error: 'No active page' }));
          return;
        }
        
        handleWebSocketMessage(ws, data);
      } catch (error) {
        console.error('❌ Error handling message:', error);
        ws.send(JSON.stringify({ error: error.message }));
      }
    });
    
    ws.on('close', () => {
      console.log('🔌 Client disconnected');
    });
  });
}

let browser = null;
let context = null;
let activePage = null;

// Helper function to determine MIME type from filename
function getFileType(filename) {
  const ext = filename.toLowerCase().split('.').pop();
  const mimeTypes = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'mp4': 'video/mp4',
    'mov': 'video/quicktime',
    'avi': 'video/x-msvideo',
    'webm': 'video/webm',
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'txt': 'text/plain'
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

// Initialize Playwright browser with authentication
async function initBrowser(httpServer = null) {
  // If an HTTP server is provided, use it for WebSocket
  if (httpServer) {
    setupWebSocketServer(httpServer);
  } else {
    // Fallback: create our own server (for legacy standalone mode)
    if (!wss) {
      wss = new WebSocketServer({ server });
    }
  }
  let cookies = [];
  let hasExistingCookies = false;

  // Try to load existing cookies if available
  if (fs.existsSync(COOKIES_FILE)) {
    try {
      const cookieData = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
      // Handle both old format (array) and new format (object with cookies, expiry, savedAt)
      cookies = Array.isArray(cookieData) ? cookieData : (cookieData.cookies || []);
      hasExistingCookies = cookies.length > 0;
      console.log('✅ Loaded existing session cookies');
    } catch (err) {
      console.warn('⚠️  Could not parse existing cookies:', err.message);
      console.log('   Will start with fresh browser context');
    }
  } else {
    console.log('ℹ️  No authentication cookies found yet');
    console.log('   Browser will start unauthenticated');
    console.log('   👉 Please login at: http://localhost:3000/auth to create cookies');
  }
  
  browser = await chromium.launch({
    headless: true, // Run headless for server environments
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox'
    ]
  });

  context = await browser.newContext({
    storageState: {
      cookies: cookies,
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

  // Create the main page
  activePage = await context.newPage();

  if (hasExistingCookies) {
    console.log('✅ Playwright browser initialized with authentication');
  } else {
    console.log('✅ Playwright browser initialized (unauthenticated)');
  }
  console.log('🎭 Browser window opened - ready for interaction!');
}

// Reload browser context with fresh cookies (called after login)
async function reloadBrowserContext() {
  console.log('🔄 Reloading browser context with fresh cookies...');
  
  let cookies = [];
  let hasExistingCookies = false;

  // Load fresh cookies from file
  if (fs.existsSync(COOKIES_FILE)) {
    try {
      const cookieData = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
      cookies = Array.isArray(cookieData) ? cookieData : (cookieData.cookies || []);
      hasExistingCookies = cookies.length > 0;
      console.log('✅ Loaded fresh session cookies:', cookies.length, 'cookies');
    } catch (err) {
      console.warn('⚠️  Could not parse cookies:', err.message);
      return false;
    }
  } else {
    console.log('⚠️  No cookies file found');
    return false;
  }

  if (!hasExistingCookies) {
    console.log('⚠️  No cookies to reload');
    return false;
  }

  try {
    // Close existing page and context
    if (activePage) {
      await activePage.close();
      console.log('✅ Closed old page');
    }
    if (context) {
      await context.close();
      console.log('✅ Closed old context');
    }

    // Create new context with fresh cookies
    context = await browser.newContext({
      storageState: {
        cookies: cookies,
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

    // Create new page
    activePage = await context.newPage();
    
    console.log('✅ Browser context reloaded with fresh authentication');
    return true;
  } catch (error) {
    console.error('❌ Error reloading browser context:', error);
    return false;
  }
}

// Endpoint to reload browser context (called by auth-server after login)
proxyRouter.post('/reload-context', async (req, res) => {
  console.log('📥 Received request to reload browser context');
  
  try {
    const success = await reloadBrowserContext();
    
    if (success) {
      res.json({ 
        success: true, 
        message: 'Browser context reloaded with fresh cookies' 
      });
    } else {
      res.json({ 
        success: false, 
        error: 'Failed to reload context - no valid cookies found' 
      });
    }
  } catch (error) {
    console.error('❌ Error in reload-context endpoint:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Serve the control interface
proxyRouter.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>VideoAI Pro - Live Session</title>
      <style>
        body {
          margin: 0;
          padding: 20px;
          font-family: system-ui, -apple-system, sans-serif;
          background: #0f172a;
          color: white;
        }
        .container {
          max-width: 1200px;
          margin: 0 auto;
        }
        h1 {
          color: #6366f1;
          margin-bottom: 10px;
        }
        .info {
          background: #1e293b;
          padding: 20px;
          border-radius: 8px;
          margin-bottom: 20px;
        }
        .status {
          display: inline-block;
          padding: 4px 12px;
          background: #10b981;
          border-radius: 4px;
          font-size: 14px;
          margin-left: 10px;
        }
        .controls {
          display: flex;
          gap: 10px;
          margin-bottom: 20px;
        }
        button {
          padding: 10px 20px;
          background: #6366f1;
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
        }
        button:hover {
          background: #4f46e5;
        }
        input {
          flex: 1;
          padding: 10px;
          background: #1e293b;
          border: 1px solid #334155;
          border-radius: 6px;
          color: white;
          font-size: 14px;
        }
        .instructions {
          background: #1e293b;
          padding: 15px;
          border-radius: 8px;
          border-left: 4px solid #6366f1;
        }
        .instructions h3 {
          margin-top: 0;
        }
        .instructions ul {
          margin: 10px 0;
          padding-left: 20px;
        }
        .instructions li {
          margin: 5px 0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🎭 VideoAI Pro - Live Playwright Session <span class="status">● ACTIVE</span></h1>
        
        <div class="info">
          <p><strong>Session Type:</strong> Live Playwright Browser</p>
          <p><strong>Authentication:</strong> ✅ Authenticated via saved cookies</p>
          <p><strong>Target:</strong> ${TARGET}</p>
        </div>

        <div class="controls">
          <input type="text" id="urlInput" placeholder="Enter path (e.g., /home, /agent/abc123)" value="/home">
          <button onclick="navigate()">Navigate</button>
          <button onclick="goBack()">Back</button>
        </div>

        <div class="instructions">
          <h3>📋 How to Use</h3>
          <ul>
            <li>A <strong>live Playwright browser window</strong> has opened on your desktop</li>
            <li>All interactions happen in that window - it's fully authenticated</li>
            <li>Use the controls above to navigate programmatically</li>
            <li>Or interact directly with the browser window</li>
            <li>All requests automatically include your authentication</li>
            <li>No CSP issues, no worker problems - everything just works!</li>
          </ul>
          
          <h3>🎨 Branding</h3>
          <ul>
            <li>Custom JavaScript is injected for branding</li>
            <li>Custom colors applied via CSS injection</li>
            <li>All modifications happen in the Playwright context</li>
          </ul>
        </div>
      </div>

      <script>
        const ws = new WebSocket('ws://localhost:${PORT}');
        
        ws.onopen = () => {
          console.log('Connected to Playwright proxy');
        };
        
        ws.onmessage = (event) => {
          const data = JSON.parse(event.data);
          console.log('Message from proxy:', data);
        };
        
        function navigate() {
          const url = document.getElementById('urlInput').value;
          ws.send(JSON.stringify({ action: 'navigate', url }));
        }
        
        // Reload disabled to avoid interrupting agent responses
        
        function goBack() {
          ws.send(JSON.stringify({ action: 'back' }));
        }
        
        // Navigate to home on load
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            navigate();
          }
        }, 500);
      </script>
    </body>
    </html>
  `);
});

// HTTP endpoint to submit initial prompt (called by auth server)
proxyRouter.post('/submit-prompt', async (req, res) => {
  const { prompt } = req.body;
  
  if (!prompt) {
    return res.json({ success: false, error: 'Prompt is required' });
  }
  
  console.log('📝 Received submit-prompt request:', prompt);
  
  try {
    if (!activePage) {
      return res.json({ success: false, error: 'Browser not initialized' });
    }
    
    // Navigate to home page only if not already there
    const currentUrl = activePage.url();
    if (!currentUrl.includes('app.heygen.com/home')) {
      console.log('🌐 Navigating to home...');
      try {
        await activePage.goto('https://app.heygen.com/home', { 
          waitUntil: 'domcontentloaded',
          timeout: 30000 
        });
        // Wait a bit for React to render
        await activePage.waitForTimeout(2000);
      } catch (navError) {
        console.warn('⚠️  Navigation error (likely not authenticated):', navError.message);
        return res.json({ 
          success: false, 
          error: 'Not authenticated. Please login first at http://localhost:3000/auth to create session cookies.' 
        });
      }
    } else {
      console.log('✅ Already on home page');
    }
    
    
    // Wait for input field to be ready
    console.log('⏳ Waiting for input field...');
    const inputSelector = 'div[role="textbox"][contenteditable="true"]';
    await activePage.waitForSelector(inputSelector, { state: 'visible', timeout: 60000 });
    

    await activePage.waitForTimeout(60000);
    await activePage.screenshot({ path: '/tmp/step1.png' });
    console.log('📸 Screenshot saved: /tmp/step1.png');
    
    // Type and submit
    console.log('⌨️  Typing prompt...');
    // await activePage.click(inputSelector);
    await activePage.locator(inputSelector).click({ force: true });
    await activePage.fill(inputSelector, prompt);

    await activePage.screenshot({ path: '/tmp/step2.png' });
    console.log('📸 Screenshot saved: /tmp/step2.png');
    
    // Wait for submit button to be enabled
    console.log('⏳ Waiting for submit button...');
    const buttonSelector = 'button[data-loading="false"].tw-bg-brand';
    await activePage.waitForSelector(buttonSelector, { state: 'visible', timeout: 5000 });

    await activePage.screenshot({ path: '/tmp/step3.png' });
    console.log('📸 Screenshot saved: /tmp/step3.png');
    
    await activePage.waitForTimeout(60000);
    console.log('🖱️  Clicking submit button...');
    await activePage.locator(buttonSelector).click({ force: true });
    await activePage.screenshot({ path: '/tmp/step4.png' });
    console.log('📸 Screenshot saved: /tmp/step4.png');    

    // Wait for navigation to agent session
    console.log('⏳ Waiting for session page...');
    await activePage.waitForURL(/\/agent\/.*/, { timeout: 300000 });
    
    const sessionUrl = activePage.url();
    const sessionPath = sessionUrl.replace('https://app.heygen.com', '');
    console.log('📍 Session URL:', sessionUrl);
    
    
    res.json({
      success: true,
      sessionPath: sessionPath,
      sessionUrl: sessionUrl
    });
  } catch (error) {
    console.error('❌ Error submitting prompt:', error);
    res.json({ success: false, error: error.message });
  }
});

// HTTP endpoint to upload files
proxyRouter.post('/upload-files', async (req, res) => {
  const files = req.files;
  
  if (!files || Object.keys(files).length === 0) {
    return res.json({ success: false, error: 'No files provided' });
  }
  
  console.log('📁 Received file upload request with', Object.keys(files).length, 'files');
  
  try {
    if (!activePage) {
      return res.json({ success: false, error: 'Browser not initialized' });
    }
    
    // Get file data with original names and paths
    const fileData = Object.values(files).map(file => {
      console.log('📄 File:', file.name, '(temp path:', file.tempFilePath, ')');
      return {
        name: file.name,
        tempPath: file.tempFilePath || file.path
      };
    }).filter(f => f.tempPath);
    
    if (fileData.length === 0) {
      return res.json({ success: false, error: 'No valid file paths found' });
    }
    
    // Navigate to home first
    console.log('🌐 Navigating to home...');
    await activePage.goto('https://app.heygen.com/home', { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    console.log('✅ Navigated to home');
    
    // Wait for the chat input to be ready
    console.log('⏳ Waiting for page to be ready...');
    await activePage.waitForSelector('div[role="textbox"][contenteditable="true"]', { state: 'visible', timeout: 10000 });
    
    // Use DataTransfer API to set files on the hidden file input
    console.log('📤 Setting files via DataTransfer API...');
    console.log('📄 File data:', fileData);
    
    // Read actual file content and create proper File objects
    const fs = await import('fs');
    const uploadSuccess = await activePage.evaluate(async (filesWithContent) => {
      console.log('📤 [Browser] Received', filesWithContent.length, 'files to upload');
      console.log('📤 [Browser] File details:', filesWithContent.map(f => ({ name: f.name, type: f.type, size: f.content.length })));
      
      // Find the hidden file input
      await new Promise(resolve => setTimeout(resolve, 1000));
      const fileInput = document.querySelector('input[type="file"]');
      if (!fileInput) {
        console.error('❌ [Browser] File input not found');
        return false;
      }
      console.log('✅ [Browser] File input found');
      
      try {
        // Create DataTransfer object and add files
        const dataTransfer = new DataTransfer();
        
        // For each file, create a proper File object with actual content
        for (const fileData of filesWithContent) {
          // Convert the content object back to Uint8Array if needed
          const contentArray = fileData.content.buffer ? new Uint8Array(fileData.content.buffer) : new Uint8Array(Object.values(fileData.content));
          console.log(`📄 [Browser] Adding file: ${fileData.name} (type: ${fileData.type}, size: ${contentArray.length} bytes)`);
          const blob = new Blob([contentArray], { type: fileData.type });
          const file = new File([blob], fileData.name, { type: fileData.type });
          console.log(`📄 [Browser] Created File object: size=${file.size}, type=${file.type}`);
          dataTransfer.items.add(file);
          console.log(`✅ [Browser] File added to DataTransfer: ${fileData.name}`);
        }
        
        console.log(`📤 [Browser] DataTransfer has ${dataTransfer.items.length} files`);
        
        // Set the files on the input
        fileInput.files = dataTransfer.files;
        console.log(`✅ [Browser] Set ${fileInput.files.length} files on input element`);
        
        // Trigger change event so the site processes it
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        fileInput.dispatchEvent(new Event('input', { bubbles: true }));
        console.log('✅ [Browser] Events triggered (change, input)');
        
        return true;
      } catch (error) {
        console.error('❌ [Browser] Error setting files:', error.message);
        return false;
      }
    }, 
    // Map file data to include actual content and correct MIME type
    fileData.map(f => {
      const content = fs.readFileSync(f.tempPath);
      const type = getFileType(f.name);
      console.log(`📄 Read file: ${f.name} (${content.length} bytes, type: ${type})`);
      // Convert Buffer to Uint8Array so it can be serialized properly
      const contentArray = new Uint8Array(content);
      return { name: f.name, content: contentArray, type };
    }));
    
    if (!uploadSuccess) {
      return res.json({ success: false, error: 'Failed to set files on input element' });
    }
    
    // Wait for HeyGen to process and display the uploaded image
    console.log('⏳ Waiting for HeyGen to process uploaded files...');
    try {
      // Wait for the attachment preview area to show up
      const attachmentSelector = '.tw-flex.tw-items-stretch.tw-justify-start img.tw-object-cover';
      await activePage.waitForSelector(attachmentSelector, { timeout: 15000 });
      
      const attachedImages = await activePage.$$eval(attachmentSelector, imgs => imgs.map(i => i.src));
      console.log('🖼️  Attached images:', attachedImages);
      
      const attachedHeygenImages = attachedImages.filter(src => src.includes('heygen.ai'));
      if (attachedHeygenImages.length === 0) {
        throw new Error('No HeyGen-uploaded images found!');
      }
      
      console.log('✅ Confirmed attached image:', attachedHeygenImages[0]);
      console.log('✅ Total HeyGen images attached:', attachedHeygenImages.length);
    } catch (waitError) {
      console.warn('⚠️  Could not verify image attachment:', waitError.message);
      console.log('⏳ Waiting additional time for processing...');
      await activePage.waitForTimeout(3000);
    }
    
    console.log('✅ Files uploaded successfully');
    res.json({
      success: true,
      message: 'Files uploaded successfully',
      filesCount: fileData.length
    });
  } catch (error) {
    console.error('❌ Error uploading files:', error);
    res.json({ success: false, error: error.message });
  }
});

// Serve screenshots from /tmp directory
proxyRouter.get('/screenshots/:filename', (req, res) => {
  const filename = req.params.filename;
  const filepath = path.join('/tmp', filename);
  
  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'Screenshot not found' });
  }
  
  res.sendFile(filepath);
});

// List all screenshots in /tmp
proxyRouter.get('/screenshots', (req, res) => {
  try {
    const files = fs.readdirSync('/tmp')
      .filter(file => file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg'))
      .map(file => ({
        name: file,
        url: `/proxy/screenshots/${file}`,
        path: path.join('/tmp', file),
        size: fs.statSync(path.join('/tmp', file)).size,
        modified: fs.statSync(path.join('/tmp', file)).mtime
      }));
    
    res.json({ screenshots: files });
  } catch (error) {
    console.error('❌ Error listing screenshots:', error);
    res.status(500).json({ error: error.message });
  }
});

// Message handling logic
async function handleWebSocketMessage(ws, data) {
  switch (data.action) {
        case 'navigate':
          const targetUrl = TARGET + data.url;
          console.log(`🌐 Navigating to: ${targetUrl}`);
          try {
            const current = activePage.url();
            if (current === targetUrl) {
              console.log('➡️  Already on target URL, skipping navigation to avoid reload');
            } else {
              await activePage.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 300000 });
            }
          } catch (navErr) {
            console.warn('Navigation check failed, proceeding with goto:', navErr?.message || navErr);
            await activePage.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 300000 });
          }
          // If navigating to an agent session, attempt to extract chat messages
          let messages = null;
          try {
            if (typeof data.url === 'string' && data.url.startsWith('/agent/')) {
              try {
                await activePage.waitForSelector('.tw-bg-fill-block, div.tw-flex.tw-justify-start', { timeout: 5000 });
              } catch (_) {}
              messages = await activePage.evaluate(() => {
                // Get all chat rows AND video cards in order
                const allElements = Array.from(
                  document.querySelectorAll('div.tw-flex.tw-justify-end, div.tw-flex.tw-justify-start, div.tw-border-brand.tw-bg-more-brandLighter')
                );
                
                const allMessages = allElements.map(row => {
                  // Check if this is a video card (not a chat row)
                  if (row.classList.contains('tw-border-brand') && row.classList.contains('tw-bg-more-brandLighter')) {
                    const thumbnailImg = row.querySelector('img[alt="draft thumbnail"]');
                    const titleElement = row.querySelector('.tw-text-base.tw-font-bold.tw-tracking-tight');
                    const subtitleElement = row.querySelector('.tw-text-sm.tw-font-medium.tw-text-textBody span');
                    
                    if (thumbnailImg) {
                      const thumbnail = thumbnailImg.src;
                      const title = titleElement ? titleElement.innerText.trim() : 'Your video is ready!';
                      
                      return {
                        role: 'agent',
                        text: subtitleElement ? subtitleElement.innerText.trim() : '',
                        video: {
                          thumbnail: thumbnail,
                          videoUrl: null,
                          poster: thumbnail,
                          title: title
                        }
                      };
                    }
                    return null;
                  }
                  
                  // Regular chat row logic
                  const isUser = row.classList.contains('tw-justify-end');

                  if (isUser) {
                    const userBubble = row.querySelector('.tw-bg-fill-block');
                    const text = userBubble ? userBubble.innerText.trim() : '';
                    return text ? { role: 'user', text } : null;
                  }

                  // agent - get main reply, skip reasoning. Use robust selector set and fallbacks.
                  const replySelectors = [
                    'div.tw-prose',
                    'div[role="region"] .tw-prose',
                    'div.tw-text-textTitle ~ div.tw-prose',
                    'div[class*="prose"]',
                    'div.tw-bg-fill-block:not(:has(textarea))',
                    'div[dir="auto"]'
                  ];
                  let replyEl = null;
                  for (const sel of replySelectors) {
                    const el = row.querySelector(sel);
                    // Skip elements inside the Reasoning section wrapper
                    const inReasoning = el && el.closest('div.tw-border-l-2.tw-border-line');
                    if (el && !inReasoning && el.innerText && el.innerText.trim().length > 0) { replyEl = el; break; }
                  }
                  // Fallback: pick the longest text node in the row excluding buttons/inputs
                  let text = '';
                  if (replyEl) {
                    text = replyEl.innerText.trim();
                  } else {
                    const blacklist = ['BUTTON', 'TEXTAREA', 'INPUT', 'SELECT'];
                    const textCandidates = [];
                    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT, null);
                    while (walker.nextNode()) {
                      const node = walker.currentNode;
                      const parentTag = node.parentElement?.tagName || '';
                      if (blacklist.includes(parentTag)) continue;
                      const val = node.nodeValue?.trim() || '';
                      if (val.length > 0) textCandidates.push(val);
                    }
                    if (textCandidates.length > 0) {
                      // choose the longest chunk assuming it's the reply body
                      text = textCandidates.sort((a,b) => b.length - a.length)[0];
                    }
                  }
                  
                  // Check for video completion card - navigate action
                  let video = null;
                  
                  // Try to find video element first
                  const videoElement = row.querySelector('video');
                  if (videoElement) {
                    const videoSrc = videoElement.src || videoElement.querySelector('source')?.src;
                    const videoPoster = videoElement.poster;
                    
                    // Try to find thumbnail image
                    const thumbnailImg = row.querySelector('img[alt="draft thumbnail"]') || 
                                        row.querySelector('img[class*="thumbnail"]') ||
                                        row.querySelector('img');
                    const thumbnail = thumbnailImg ? thumbnailImg.src : videoPoster;
                    
                    // Extract title from nearby text
                    const titleElement = row.querySelector('div.tw-text-textTitle, div.tw-font-medium, h3, h2');
                    const title = titleElement ? titleElement.innerText.trim() : 'Your video is ready!';
                    
                    video = {
                      thumbnail: thumbnail || videoPoster,
                      videoUrl: videoSrc,
                      poster: videoPoster || thumbnail,
                      title: title
                    };
                  }
                  // Fallback: check for thumbnail image without video element
                  else {
                    const thumbnailImg = row.querySelector('img[alt="draft thumbnail"]') || 
                                        row.querySelector('img[src*="heygen"]');
                    if (thumbnailImg) {
                      const thumbnail = thumbnailImg.src;
                      const titleElement = row.querySelector('div.tw-text-textTitle, div.tw-font-medium, h3, h2');
                      const title = titleElement ? titleElement.innerText.trim() : 'Your video is ready!';
                      
                      video = {
                        thumbnail: thumbnail,
                        videoUrl: null,
                        poster: thumbnail,
                        title: title
                      };
                    }
                  }
                  
                  return text || video ? { role: 'agent', text, video } : null;
                }).filter(Boolean);

                return { messages: allMessages };
              });
            }
          } catch (err) {
            messages = { error: 'message_extraction_failed', details: String(err && err.message ? err.message : err) };
          }
          ws.send(JSON.stringify(Object.assign({ success: true, url: targetUrl }, messages ? { messages } : {})));
          break;
          
        // 'reload' action disabled to avoid interrupting agent responses
          
        case 'back':
          console.log('⬅️ Going back');
          await activePage.goBack();
          ws.send(JSON.stringify({ success: true }));
          break;
          
        case 'get_messages':
          console.log('📬 Fetching messages from current page');
          let fetchedMessages = null;
          try {
            const currentUrl = activePage.url();
            if (currentUrl.includes('/agent/')) {
              try {
                await activePage.waitForSelector('.tw-bg-fill-block, div.tw-flex.tw-justify-start', { timeout: 2000 });
              } catch (_) {}
              // Give the DOM a brief moment to render streamed content
              try { await activePage.waitForTimeout(300); } catch (_) {}
              // Wait a bit for video elements to load if they exist
              try {
                await activePage.waitForSelector('video, img[alt="draft thumbnail"]', { timeout: 3000 });
              } catch (_) {}
              fetchedMessages = await activePage.evaluate(() => {
                // Get all chat rows AND video cards in order (exclude hidden placeholders)
                const allElements = Array.from(
                  document.querySelectorAll('div.tw-flex.tw-justify-end, div.tw-flex.tw-justify-start, div.tw-border-brand.tw-bg-more-brandLighter')
                ).filter(el => !el.classList.contains('tw-hidden'));
                console.log('Found', allElements.length, 'message rows');
                
                const messages = allElements.map((row, idx) => {
                  console.log(`Processing row ${idx}:`, row.className);
                  
                  // Check if this is a video card (not a chat row)
                  if (row.classList.contains('tw-border-brand') && row.classList.contains('tw-bg-more-brandLighter')) {
                    const thumbnailImg = row.querySelector('img[alt="draft thumbnail"]');
                    const titleElement = row.querySelector('.tw-text-base.tw-font-bold.tw-tracking-tight');
                    const subtitleElement = row.querySelector('.tw-text-sm.tw-font-medium.tw-text-textBody span');
                    
                    if (thumbnailImg) {
                      const thumbnail = thumbnailImg.src;
                      const title = titleElement ? titleElement.innerText.trim() : 'Your video is ready!';
                      
                      // Video URL might be in a video element or we need to construct it
                      // For now, we'll mark it as needing to be clicked to get the URL
                      return {
                        role: 'agent',
                        text: subtitleElement ? subtitleElement.innerText.trim() : '',
                        video: {
                          thumbnail: thumbnail,
                          videoUrl: null, // Will be populated when card is clicked
                          poster: thumbnail,
                          title: title
                        }
                      };
                    }
                    return null;
                  }
                  
                  // Regular chat row logic
                  const isUser = row.classList.contains('tw-justify-end');

                  if (isUser) {
                    const userBubble = row.querySelector('.tw-bg-fill-block');
                    const text = userBubble ? userBubble.innerText.trim() : '';
                    return text ? { role: 'user', text } : null;
                  }

                  // agent - get main reply, skip reasoning
                  // Try multiple selectors to find the agent message text
                  let reply = null;
                  const replySelectors = [
                    'div.tw-prose',
                    'div.tw-text-textTitle div.tw-prose',
                    'div > div.tw-text-textTitle > div.tw-prose',
                    'div > div.tw-bg-fill-block'
                  ];
                  for (const sel of replySelectors) {
                    const el = row.querySelector(sel);
                    // Skip elements inside the Reasoning section wrapper
                    const inReasoning = el && el.closest('div.tw-border-l-2.tw-border-line');
                    if (el && !inReasoning) {
                      const txt = el.innerText?.trim() || el.textContent?.trim();
                      if (txt && txt.length > 0) {
                        reply = el;
                        console.log('Found agent text with selector:', sel, 'text:', txt.substring(0, 50));
                        break;
                      }
                    }
                  }

                  let text = '';
                  if (reply) {
                    // Try innerText first, fallback to textContent
                    text = reply.innerText?.trim() || reply.textContent?.trim() || '';
                    console.log('Agent message text length:', text.length);
                  } else {
                    console.log('No reply element found for agent row');
                  }
                  
                  // Check for video completion card - get_messages action
                  let video = null;
                  
                  // Try to find video element first
                  const videoElement = row.querySelector('video');
                  if (videoElement) {
                    const videoSrc = videoElement.src || videoElement.querySelector('source')?.src;
                    const videoPoster = videoElement.poster;
                    
                    // Try to find thumbnail image
                    const thumbnailImg = row.querySelector('img[alt="draft thumbnail"]') || 
                                        row.querySelector('img[class*="thumbnail"]') ||
                                        row.querySelector('img');
                    const thumbnail = thumbnailImg ? thumbnailImg.src : videoPoster;
                    
                    // Extract title from nearby text
                    const titleElement = row.querySelector('div.tw-text-textTitle, div.tw-font-medium, h3, h2');
                    const title = titleElement ? titleElement.innerText.trim() : 'Your video is ready!';
                    
                    video = {
                      thumbnail: thumbnail || videoPoster,
                      videoUrl: videoSrc,
                      poster: videoPoster || thumbnail,
                      title: title
                    };
                  }
                  // Fallback: check for thumbnail image without video element
                  else {
                    const thumbnailImg = row.querySelector('img[alt="draft thumbnail"]') || 
                                        row.querySelector('img[src*="heygen"]');
                    if (thumbnailImg) {
                      const thumbnail = thumbnailImg.src;
                      const titleElement = row.querySelector('div.tw-text-textTitle, div.tw-font-medium, h3, h2');
                      const title = titleElement ? titleElement.innerText.trim() : 'Your video is ready!';
                      
                      video = {
                        thumbnail: thumbnail,
                        videoUrl: null,
                        poster: thumbnail,
                        title: title
                      };
                    }
                  }
                  
                  // Only return if we have text or video
                  if (text || video) {
                    return { role: 'agent', text, video };
                  }
                  return null;
                }).filter(Boolean);

                return { messages };
              });
            }
          } catch (err) {
            fetchedMessages = { error: 'message_fetch_failed', details: String(err && err.message ? err.message : err) };
          }
          ws.send(JSON.stringify(Object.assign({ success: true, action: 'get_messages' }, fetchedMessages || {})));
          break;
          
        case 'debug_dom':
          console.log('🔍 Debugging DOM structure');
          try {
            const domInfo = await activePage.evaluate(() => {
              // Try multiple selectors to find message rows
              const selectors = [
                'div.tw-flex.tw-justify-start',
                'div.tw-flex.tw-justify-end, div.tw-flex.tw-justify-start',
                'div[class*="tw-flex"][class*="tw-justify"]',
                'div[role="region"] > div',
                'div.tw-flex',
                '[class*="message"]'
              ];
              
              let rows = [];
              for (const sel of selectors) {
                const found = document.querySelectorAll(sel);
                if (found.length > 0) {
                  rows = Array.from(found).filter(el => {
                    const text = el.innerText?.trim();
                    return text && text.length > 0 && !el.querySelector('button');
                  });
                  if (rows.length > 0) break;
                }
              }
              
              // Get all divs with text to see structure
              const allDivs = Array.from(document.querySelectorAll('div')).filter(d => {
                const text = d.innerText?.trim();
                return text && text.length > 20 && text.length < 500;
              }).slice(0, 10);
              
              const rowDetails = rows.map((row, idx) => ({
                index: idx,
                classes: row.className,
                text: row.innerText?.substring(0, 100) || '',
                hasVideo: !!row.querySelector('video'),
                hasImg: !!row.querySelector('img')
              }));
              
              const lastRow = rows[rows.length - 1];
              
              if (!lastRow) return { 
                error: 'No rows found', 
                totalRows: 0,
                allDivsCount: allDivs.length,
                allDivs: allDivs.map(d => ({ classes: d.className, text: d.innerText?.substring(0, 50) }))
              };
              
              // Check if last row is user or agent
              const isLastRowUser = lastRow.classList.contains('tw-justify-end');
              
              // Get text from last row
              let lastRowText = '';
              const proseEl = lastRow.querySelector('div.tw-prose');
              if (proseEl) {
                lastRowText = proseEl.innerText?.substring(0, 200) || '';
              } else {
                const textNodes = [];
                const walker = document.createTreeWalker(lastRow, NodeFilter.SHOW_TEXT, null);
                while (walker.nextNode()) {
                  const text = walker.currentNode.nodeValue?.trim();
                  if (text && text.length > 0) textNodes.push(text);
                }
                lastRowText = textNodes.join(' ').substring(0, 200);
              }
              
              const hasVideo = !!lastRow.querySelector('video');
              const hasImg = !!lastRow.querySelector('img');
              const imgAlt = lastRow.querySelector('img')?.alt;
              const imgSrc = lastRow.querySelector('img')?.src;
              const videoSrc = lastRow.querySelector('video')?.src;
              const allImgs = Array.from(document.querySelectorAll('img')).map(img => ({
                alt: img.alt,
                src: img.src.substring(0, 100)
              }));
              const allVideos = Array.from(document.querySelectorAll('video')).map(v => ({
                src: v.src.substring(0, 100),
                poster: v.poster?.substring(0, 100)
              }));
              
              return {
                totalRows: rows.length,
                rowDetails: rowDetails,
                lastRowIsUser: isLastRowUser,
                lastRowText: lastRowText,
                lastRowHasVideo: hasVideo,
                lastRowHasImg: hasImg,
                lastRowImgAlt: imgAlt,
                lastRowImgSrc: imgSrc?.substring(0, 100),
                lastRowVideoSrc: videoSrc?.substring(0, 100),
                allImagesCount: allImgs.length,
                allVideosCount: allVideos.length,
                allImages: allImgs,
                allVideos: allVideos
              };
            });
            console.log('🔍 Debug info:', JSON.stringify(domInfo, null, 2));
            ws.send(JSON.stringify({ success: true, action: 'debug_dom', data: domInfo }));
          } catch (err) {
            console.error('Debug error:', err);
            ws.send(JSON.stringify({ success: false, action: 'debug_dom', error: err.message }));
          }
          break;
          
        case 'get_video_url':
          console.log('🎬 Getting video URL from card');
          try {
            // Click the video card to open the player
            const videoCard = await activePage.$('div.tw-border-brand.tw-bg-more-brandLighter');
            if (!videoCard) {
              ws.send(JSON.stringify({ success: false, error: 'Video card not found' }));
              break;
            }
            
            await videoCard.click();
            
            // Wait for video element to appear
            await activePage.waitForSelector('video', { timeout: 5000 });
            
            // Extract video URL
            const videoData = await activePage.evaluate(() => {
              const video = document.querySelector('video');
              if (!video) return null;
              
              return {
                videoUrl: video.src || video.querySelector('source')?.src,
                poster: video.poster,
                duration: video.duration
              };
            });
            
            // Close the modal/player if there's a close button
            try {
              const closeButton = await activePage.$('button[aria-label="Close"], button:has-text("Close"), [class*="close"]');
              if (closeButton) await closeButton.click();
            } catch (_) {}
            
            ws.send(JSON.stringify({ success: true, action: 'get_video_url', data: videoData }));
          } catch (err) {
            ws.send(JSON.stringify({ success: false, action: 'get_video_url', error: err.message }));
          }
          break;
          
        case 'send_message':
          console.log('💬 Sending message to agent session');
          try {
            const currentUrl = activePage.url();
            if (!currentUrl.includes('/agent/')) {
              ws.send(JSON.stringify({ success: false, error: 'Not on agent session page' }));
              break;
            }
            
            const message = data.message;
            if (!message || !message.trim()) {
              ws.send(JSON.stringify({ success: false, error: 'Message is required' }));
              break;
            }
            
            // Find and fill the input field
            const inputSelector = 'div[role="textbox"][contenteditable="true"]';
            await activePage.waitForSelector(inputSelector, { timeout: 5000 });
            await activePage.click(inputSelector);
            await activePage.fill(inputSelector, message);
            
            // Wait a moment for the text to be entered
            await activePage.waitForTimeout(500);
            
            // Click the submit button
            const buttonSelector = 'button[data-loading="false"].tw-bg-brand';
            await activePage.click(buttonSelector);
            
            console.log('✅ Message sent successfully');
            ws.send(JSON.stringify({ success: true, action: 'send_message' }));
          } catch (err) {
            console.error('❌ Error sending message:', err);
            ws.send(JSON.stringify({ success: false, action: 'send_message', error: err.message }));
          }
          break;
          
        case 'get_generation_progress':
          console.log('📊 Getting video generation progress');
            try {
              const progressData = await activePage.evaluate(() => {
              // First, check if percentage exists anywhere on the page
              const percentageText = [...document.querySelectorAll('span.tw-font-semibold.tw-text-textTitleRev')]
                .map(el => el.innerText)
                .find(text => text.includes('%'));
              const percentage = percentageText ? parseInt(percentageText.replace('%', '')) : 0;
              
              console.log('🔍 Percentage search result:', percentageText, '→', percentage);
              
              // Look for the progress card - it has specific classes and structure
              const progressCard = document.querySelector('div.tw-flex.tw-flex-col.tw-items-stretch.tw-gap-4.tw-rounded-2xl.tw-border.tw-border-line.tw-bg-fill-general.tw-p-4.tw-relative.tw-cursor-pointer.tw-group');
              
              console.log('🔍 Progress card found:', !!progressCard);
              
              if (!progressCard && !percentageText) {
                return { isGenerating: false };
              }
              
              // If we have percentage but no card, still return progress data
              if (!progressCard && percentageText) {
                return {
                  isGenerating: true,
                  percentage,
                  currentStatus: 'Processing',
                  currentStep: '',
                  message: 'Our Video Agent is working on your video',
                  steps: []
                };
              }
              
              // Extract status text (Understanding, Planning, Creating)
              // These are in the left column of the progress section
              const statusElements = progressCard.querySelectorAll('.tw-flex.tw-flex-col.tw-gap-2 > div.tw-text-sm');
              let currentStatus = 'Processing';
              statusElements.forEach(el => {
                if (el.classList.contains('tw-font-bold') && el.classList.contains('tw-text-textTitle')) {
                  currentStatus = el.textContent.trim();
                }
              });
              
              // Extract current step with orange spinner (ongoing step)
              const currentStepEl = progressCard.querySelector('iconpark-icon[name="onboarding-ongoing"][theme="filled"] + span.tw-text-sm.tw-text-textTitle.tw-font-bold');
              const currentStep = currentStepEl ? currentStepEl.textContent.trim() : '';
              
              // Extract all steps
              const allSteps = Array.from(progressCard.querySelectorAll('.tw-flex.tw-items-center.tw-gap-3')).map(stepEl => {
                const icon = stepEl.querySelector('iconpark-icon');
                const text = stepEl.querySelector('span.tw-text-sm.tw-text-textTitle');
                let status = 'pending';
                
                if (icon) {
                  if (icon.getAttribute('name') === 'check-one-fill') {
                    status = 'completed';
                  } else if (icon.getAttribute('name') === 'onboarding-ongoing') {
                    status = 'current';
                  }
                }
                
                return {
                  text: text ? text.textContent.trim() : '',
                  status
                };
              });
              
              // Extract main message
              const messageEl = progressCard.querySelector('.tw-text-sm.tw-font-medium.tw-text-textBody span');
              const message = messageEl ? messageEl.textContent.trim() : 'Our Video Agent is working on your video';
              
              return {
                isGenerating: true,
                percentage,
                currentStatus,
                currentStep,
                message,
                steps: allSteps
              };
            });
            
            console.log('📊 Progress data:', progressData);
            if (progressData && progressData.isGenerating && Number.isFinite(progressData.percentage)) {
              console.log(`📈 Detected generation percentage: ${progressData.percentage}%`);
            } else {
              console.log('🔍 No percentage found in progress card');
            }
            ws.send(JSON.stringify({ success: true, action: 'get_generation_progress', data: progressData }));
          } catch (err) {
            console.error('❌ Error getting progress:', err);
            ws.send(JSON.stringify({ success: false, action: 'get_generation_progress', error: err.message }));
          }
          break;
          
        default:
          ws.send(JSON.stringify({ error: 'Unknown action' }));
      }
}

export { proxyRouter, initBrowser, setupWebSocketServer };

// If run directly, start the browser and server (legacy mode)
if (import.meta.url === `file://${process.argv[1]}`) {
  initBrowser().then(() => {
    const server = createServer(app);
    server.listen(PORT, () => {
      console.log(`Proxy server running on port ${PORT}`);
    });
  });
}

// Cleanup on exit
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  if (activePage) await activePage.close();
  if (context) await context.close();
  if (browser) await browser.close();
  process.exit(0);
});

