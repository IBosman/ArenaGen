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
import axios from 'axios';
import { createHash, createHmac } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const COOKIES_FILE = path.join(__dirname, 'heygen-cookies.json');
const TARGET = 'https://app.heygen.com';
const AUTH_SECRET = process.env.AUTH_SECRET || 'dev-secret-change-me';

// Ensure uploads directory exists
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Helper function to verify JWT token and extract user email (HS256)
function verifyToken(token) {
  try {
    const [headerB64, bodyB64, sig] = token.split('.');
    if (!headerB64 || !bodyB64 || !sig) return null;
    const data = `${headerB64}.${bodyB64}`;
    const hmac = createHmac('sha256', AUTH_SECRET)
      .update(data)
      .digest('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    if (hmac !== sig) return null;
    const bodyJson = Buffer.from(bodyB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const body = JSON.parse(bodyJson);
    if (body.exp && Math.floor(Date.now() / 1000) > body.exp) return null;
    return body;
  } catch (_) {
    return null;
  }
}

const proxyRouter = express.Router();
const app = express();
let server = null; // For HTTP server instance
let wss = null;    // For WebSocket server instance
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

// Convenience route: /generate/:sessionId will navigate to the same agent session
proxyRouter.get('/generate/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  if (!sessionId) {
    return res.status(400).json({ success: false, error: 'sessionId is required' });
  }
  if (!browser) {
    return res.status(503).json({ success: false, error: 'Browser not initialized' });
  }
  
  // Extract user email from JWT token in cookie (HTTP endpoint)
  let userEmail = 'anonymous';
  try {
    const cookieHeader = req.headers.cookie || '';
    const cookieMap = {};
    cookieHeader.split(';').forEach(c => {
      const [k, v] = c.split('=');
      if (k && v) cookieMap[k.trim()] = decodeURIComponent(v.trim());
    });
    const arenaToken = cookieMap['arena_token'];
    if (arenaToken) {
      const tokenData = verifyToken(arenaToken);
      if (tokenData && tokenData.email) {
        userEmail = tokenData.email;
      }
    }
  } catch (_) {}
  
  const relativeUrl = `/agent/${sessionId}`;
  const targetUrl = TARGET + relativeUrl;
  console.log(`🌐 [HTTP] Navigating (via /generate) to agent session: ${targetUrl} for user: ${userEmail}`);
  try {
    // If user is authenticated and we have an anonymous session, migrate it
    if (userEmail !== 'anonymous' && userSessions.has('anonymous')) {
      const anonSession = userSessions.get('anonymous');
      console.log(`🔄 Migrating anonymous session to: ${userEmail}`);
      userSessions.set(userEmail, anonSession);
      anonSession.userEmail = userEmail;
      userSessions.delete('anonymous');
    }
    
    // Check if session already exists (from WebSocket)
    let session = userSessions.get(userEmail);
    if (!session) {
      // Only create new session if one doesn't exist
      session = await getUserSession(userEmail);
    } else {
      console.log(`♻️  Reusing existing session for: ${userEmail}`);
    }
    const { page } = session;
    const current = page.url();
    if (current !== targetUrl) {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 300000 });
    } else {
      console.log('➡️  Already on target session URL');
    }
    // Optionally extract messages as in /agent handler
    let messages = null;
    try {
      await page.waitForSelector('.tw-bg-fill-block, div.tw-flex.tw-justify-start', { timeout: 5000 });
      messages = await page.evaluate(() => {
        const allElements = Array.from(
          document.querySelectorAll('div.tw-flex.tw-justify-end, div.tw-flex.tw-justify-start, div.tw-border-brand.tw-bg-more-brandLighter')
        );
        const allMessages = allElements.map(row => {
          if (row.classList.contains('tw-border-brand') && row.classList.contains('tw-bg-more-brandLighter')) {
            const videoElement = row.querySelector('video');
            if (videoElement) {
              const videoPoster = videoElement.poster;
              const titleElement = row.querySelector('.tw-text-base.tw-font-bold.tw-tracking-tight');
              const subtitleElement = row.querySelector('.tw-text-sm.tw-font-medium.tw-text-textBody span');
              const title = titleElement ? titleElement.innerText.trim() : 'Your video is ready!';
              return {
                role: 'agent',
                text: subtitleElement ? subtitleElement.innerText.trim() : '',
                video: { thumbnail: videoPoster, videoUrl: null, poster: videoPoster, title }
              };
            }
            return null;
          }
          const isUser = row.classList.contains('tw-justify-end');
          if (isUser) {
            const userBubble = row.querySelector('.tw-bg-fill-block');
            const text = userBubble ? (userBubble.innerText || '').trim() : '';
            return text ? { role: 'user', text } : null;
          }
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
            const inReasoning = el && el.closest('div.tw-border-l-2.tw-border-line');
            if (el && !inReasoning && el.innerText && el.innerText.trim().length > 0) { replyEl = el; break; }
          }
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
              text = textCandidates.sort((a,b) => b.length - a.length)[0];
            }
          }
          const videoElement = row.querySelector('video');
          let video = null;
          if (videoElement) {
            const videoSrc = videoElement.src || videoElement.querySelector('source')?.src;
            const videoPoster = videoElement.poster;
            const thumbnailImg = row.querySelector('img[alt="draft thumbnail"]') || row.querySelector('img[class*="thumbnail"]') || row.querySelector('img');
            const thumbnail = thumbnailImg ? thumbnailImg.src : videoPoster;
            const titleElement = row.querySelector('div.tw-text-textTitle, div.tw-font-medium, h3, h2');
            const title = titleElement ? titleElement.innerText.trim() : 'Your video is ready!';
            video = { thumbnail: thumbnail || videoPoster, videoUrl: videoSrc, poster: videoPoster || thumbnail, title };
          }
          return text || video ? { role: 'agent', text, video } : null;
        }).filter(Boolean);
        return { messages: allMessages };
      });
    } catch (_) {}
    return res.json({ success: true, url: targetUrl, ...(messages ? { messages } : {}) });
  } catch (error) {
    console.error('❌ [HTTP] Navigation error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

proxyRouter.use(fileUpload({
  useTempFiles: true,
  tempFileDir: '/tmp/',
  createParentPath: true
}));

// Save video file endpoint with duplicate prevention
proxyRouter.post('/save-video', async (req, res) => {
  try {
    const { username, userEmail, videoUrl, title } = req.body;

    if (!videoUrl) {
      return res.status(400).json({ error: 'Missing required fields: videoUrl' });
    }

    // Determine user directory from email (preferred), else from JWT cookie, else fallback to username
    let emailFromCookie = null;
    try {
      const cookieHeader = req.headers.cookie || '';
      const cookieMap = {};
      cookieHeader.split(';').forEach(c => {
        const [k, v] = c.split('=');
        if (k && v) cookieMap[k.trim()] = decodeURIComponent(v.trim());
      });
      const arenaToken = cookieMap['arena_token'];
      if (arenaToken) {
        const t = verifyToken(arenaToken);
        if (t && t.email) emailFromCookie = t.email;
      }
    } catch (_) {}

    const rawUserId = userEmail || emailFromCookie || username || 'unknown_user';
    const userDirName = rawUserId.replace(/[@.]/g, '_');

    // Extract video hash from both formats: /transcode/HASH/ or caption_HASH.mp4
    let videoHash = null;
    const transcodeMatch = videoUrl.match(/\/transcode\/([a-f0-9]{32})\//i);
    if (transcodeMatch) {
      videoHash = transcodeMatch[1];
    } else {
      const captionMatch = videoUrl.match(/caption_([a-f0-9]{32})\.mp4/i);
      if (captionMatch) videoHash = captionMatch[1];
    }

    if (!videoHash) {
      return res.status(400).json({ error: 'Invalid video URL format - missing video hash' });
    }

    // Create user directory if it doesn't exist
    const userDir = path.join(UPLOADS_DIR, userDirName);
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }

    // Create a safe filename
    // 1) Start with provided title or 'video'
    // 2) Remove file extension if present
    // 3) Strip trailing -<hash> to avoid double-hash patterns
    let baseTitle = (title || 'video').replace(/\.[^.]+$/, '');
    baseTitle = baseTitle.replace(/-([a-f0-9]{32})$/i, '');
    const safeBaseName = baseTitle
      .replace(/[^a-z0-9\- _]/gi, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/_{2,}/g, '_')
      .replace(/^_+|_+$/g, '');

    const filename = `${safeBaseName}-${videoHash}.mp4`;
    const filePath = path.join(userDir, filename);

    // Check if any file with this hash already exists (dedupe by hash regardless of title)
    const existingByHash = fs.readdirSync(userDir).find(f => f.endsWith(`-${videoHash}.mp4`));
    if (existingByHash) {
      const existingPath = path.join(userDir, existingByHash);
      console.log(`⏭️ Video already exists by hash, skipping download: ${existingPath}`);
      return res.json({ 
        success: true, 
        message: 'Video already exists', 
        path: existingPath,
        filename: existingByHash,
        isDuplicate: true
      });
    }

    // Download the video if it doesn't exist
    console.log(`⬇️ Downloading video to: ${filePath}`);
    const response = await axios({
      method: 'GET',
      url: videoUrl,
      responseType: 'stream',
    });

    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        console.log(`✅ Video saved: ${filePath}`);
        res.json({ 
          success: true, 
          message: 'Video saved successfully', 
          path: filePath,
          filename,
          isDuplicate: false
        });
      });
      writer.on('error', (err) => {
        console.error('❌ Error writing file:', err);
        res.status(500).json({ success: false, error: 'Failed to save video' });
        reject(err);
      });
    });
  } catch (error) {
    console.error('Error in save-video:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

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
  
  wss.on('connection', (ws, req) => {
    console.log('🔌 Client connected via WebSocket');
    
    // Initialize user info
    ws.user = { email: 'anonymous' };
    ws.sessionId = null;
    ws.isAlive = true;
    
    // Extract user email from arena_token cookie
    const cookies = {};
    if (req.headers.cookie) {
      req.headers.cookie.split(';').forEach(cookie => {
        const parts = cookie.split('=');
        if (parts.length === 2) {
          cookies[parts[0].trim()] = decodeURIComponent(parts[1].trim());
        }
      });
    }
    
    const arenaToken = cookies['arena_token'];
    if (arenaToken) {
      const tokenData = verifyToken(arenaToken);
      if (tokenData && tokenData.email) {
        ws.user = { email: tokenData.email };
        console.log('👤 User authenticated via token:', tokenData.email);
      }
    }
    
    // Message queue for this connection
    const messageQueue = [];
    let isProcessing = false;
    let userSession = null;
    
    // Process messages one at a time
    const processQueue = async () => {
      if (isProcessing || messageQueue.length === 0) return;
      
      isProcessing = true;
      const { message, session } = messageQueue.shift();
      
      try {
        const data = JSON.parse(message);
        console.log(`📨 [${ws.user?.email || 'anonymous'}] Processing:`, data.action);
        
        // Ensure we have a valid session for authenticated users
        if (ws.user?.email && !session) {
          userSession = await getUserSession(ws.user.email);
          console.log(`🔄 Created new session for: ${ws.user.email}`);
        }
        
        // Pass the WebSocket, data, and session to the handler
        await handleWebSocketMessage(ws, data, userSession || session);
        
      } catch (error) {
        console.error('❌ Error processing message:', error);
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ 
            success: false, 
            action: 'error',
            error: error.message 
          }));
        }
      } finally {
        isProcessing = false;
        // Process next message in queue
        setImmediate(processQueue);
      }
    };
    
    // Handle incoming messages
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        
        // For authenticated users, ensure we have a session
        if (ws.user?.email) {
          // If we don't have a session yet, try to get or create one
          if (!userSession) {
            // Check if session already exists (from HTTP endpoint)
            const existingSession = userSessions.get(ws.user.email);
            if (existingSession) {
              userSession = existingSession;
              console.log(`🔄 Reusing existing session from HTTP endpoint for: ${ws.user.email}`);
              // Add to queue with the existing session
              messageQueue.push({ message, session: userSession });
              if (!isProcessing) processQueue();
              return;
            }
            
            // No existing session, create a new one
            getUserSession(ws.user.email).then(session => {
              userSession = session;
              console.log(`🔄 Created new session for: ${ws.user.email}`);
              // Add to queue with the new session
              messageQueue.push({ message, session: userSession });
              if (!isProcessing) processQueue();
            }).catch(error => {
              console.error(`❌ Failed to create session for ${ws.user.email}:`, error);
              if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({
                  success: false,
                  action: 'error',
                  error: 'Failed to create browser session'
                }));
              }
            });
            return;
          }
        }
        
        // Add to queue with current session (or null for anonymous)
        messageQueue.push({ message, session: userSession });
        if (!isProcessing) processQueue();
      } catch (error) {
        console.error('❌ Error parsing message:', error);
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ 
            success: false, 
            action: 'error',
            error: 'Invalid message format' 
          }));
        }
      }
    });
    
    // Heartbeat to keep connection alive
    const heartbeatInterval = setInterval(() => {
      if (ws.isAlive === false) {
        console.log(`💔 No heartbeat from ${ws.user.email}, terminating connection`);
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    }, 30000);
    
    ws.on('pong', () => {
      ws.isAlive = true;
    });
    
    ws.on('close', async () => {
      console.log('🔌 Client disconnected:', ws.user?.email || 'unknown');
      clearInterval(heartbeatInterval);
      
      // Cleanup session if no other connections for this user
      if (ws.user?.email) {
        const userConnections = Array.from(wss.clients).filter(
          client => client.user?.email === ws.user.email
        );
        
        if (userConnections.length === 0) {
          console.log(`👋 No more connections for ${ws.user.email}, cleaning up session`);
          // Cleanup handled by the session timeout in getUserSession
        }
      }
    });
    
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      ws.terminate();
    });
  });
}

let browser = null;
// Per-user browser contexts: Map<userEmail, {context, page, userEmail, lastActivity}>
const userSessions = new Map();
// Track sessions being created to prevent race conditions
const pendingSessions = new Map();

// Helper function to load user cookies (for now, uses shared cookies)
async function loadUserCookies(userEmail) {
  let cookies = [];
  if (fs.existsSync(COOKIES_FILE)) {
    try {
      const cookieData = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
      cookies = Array.isArray(cookieData) ? cookieData : (cookieData.cookies || []);
      console.log(`✅ Loaded cookies for user: ${userEmail}`);
    } catch (err) {
      console.warn(`⚠️  Could not parse cookies for ${userEmail}:`, err.message);
    }
  }
  return cookies;
}

// Get or create user session with isolated context
async function getUserSession(userEmail) {
  if (!userEmail) {
    userEmail = 'anonymous';
  }

  // Return existing session if available
  if (userSessions.has(userEmail)) {
    const session = userSessions.get(userEmail);
    session.lastActivity = Date.now();
    console.log(`♻️  Reusing existing session for: ${userEmail}`);
    return session;
  }

  // If session is being created, wait for it to complete
  if (pendingSessions.has(userEmail)) {
    console.log(`⏳ Waiting for pending session creation for: ${userEmail}`);
    return pendingSessions.get(userEmail);
  }

  // Create new context for this user
  console.log(`🆕 Creating new browser context for: ${userEmail}`);
  
  // Create a promise for this session creation
  const sessionPromise = (async () => {
  
  if (!browser) {
    throw new Error('Browser not initialized');
  }

  const cookies = await loadUserCookies(userEmail);
  
  const context = await browser.newContext({
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

  const page = await context.newPage();
  
  // Navigate to HeyGen home to initialize
  try {
    await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log(`✅ Initialized page for: ${userEmail}`);
  } catch (navError) {
    console.warn(`⚠️  Could not navigate to HeyGen home for ${userEmail}:`, navError.message);
  }

  const session = {
    context,
    page,
    userEmail,
    lastActivity: Date.now()
  };

    userSessions.set(userEmail, session);
    console.log(`✅ Created new session for: ${userEmail} (Total sessions: ${userSessions.size})`);
    
    return session;
  })();
  
  // Store the promise so other requests can wait for it
  pendingSessions.set(userEmail, sessionPromise);
  
  try {
    const session = await sessionPromise;
    // Remove from pending and return the session
    pendingSessions.delete(userEmail);
    return session;
  } catch (error) {
    // Remove from pending on error
    pendingSessions.delete(userEmail);
    throw error;
  }
}

// Cleanup inactive sessions (optional - can be called periodically)
async function cleanupInactiveSessions(maxAgeMs = 30 * 60 * 1000) {
  const now = Date.now();
  const toDelete = [];
  
  for (const [email, session] of userSessions) {
    if (now - session.lastActivity > maxAgeMs) {
      toDelete.push(email);
    }
  }
  
  for (const email of toDelete) {
    const session = userSessions.get(email);
    try {
      await session.page.close();
      await session.context.close();
      userSessions.delete(email);
      console.log(`🧹 Cleaned up inactive session for: ${email}`);
    } catch (err) {
      console.error(`❌ Error cleaning up session for ${email}:`, err);
    }
  }
}

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

// In the initBrowser function, replace the WebSocket setup section:

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
  
  // Check if cookies exist
  let hasExistingCookies = false;
  if (fs.existsSync(COOKIES_FILE)) {
    try {
      const cookieData = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
      const cookies = Array.isArray(cookieData) ? cookieData : (cookieData.cookies || []);
      hasExistingCookies = cookies.length > 0;
      console.log('✅ Found existing session cookies');
    } catch (err) {
      console.warn('⚠️  Could not parse existing cookies:', err.message);
    }
  } else {
    console.log('ℹ️  No authentication cookies found yet');
    console.log('   👉 Please login at: http://localhost:3000/auth to create cookies');
  }
  
  // Launch browser (shared across all users)
  browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox'
    ]
  });

  if (hasExistingCookies) {
    console.log('✅ Playwright browser initialized with authentication');
  } else {
    console.log('✅ Playwright browser initialized (unauthenticated)');
  }
  console.log('🎭 Browser ready - contexts will be created per-user!');
  console.log('📊 Per-user isolation enabled - each user gets their own browser context');
}

// IMPORTANT: Remove the duplicate ws.onopen and ws.onmessage handlers that appear after this function
// Keep only the setupWebSocketHandler function for message handling

// Reload browser context with fresh cookies (called after login)
async function reloadBrowserContext() {
  console.log('🔄 Reloading all user sessions with fresh cookies...');
  
  // Check if cookies exist
  if (!fs.existsSync(COOKIES_FILE)) {
    console.log('⚠️  No cookies file found');
    return false;
  }

  try {
    const cookieData = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
    const cookies = Array.isArray(cookieData) ? cookieData : (cookieData.cookies || []);
    
    if (cookies.length === 0) {
      console.log('⚠️  No cookies to reload');
      return false;
    }
    
    console.log(`✅ Loaded fresh session cookies: ${cookies.length} cookies`);
  } catch (err) {
    console.warn('⚠️  Could not parse cookies:', err.message);
    return false;
  }

  try {
    // Close all existing user sessions
    console.log(`🧹 Closing ${userSessions.size} existing user sessions...`);
    for (const [email, session] of userSessions) {
      try {
        await session.page.close();
        await session.context.close();
        console.log(`  ✅ Closed session for: ${email}`);
      } catch (err) {
        console.error(`  ❌ Error closing session for ${email}:`, err.message);
      }
    }
    
    // Clear the sessions map
    userSessions.clear();
    console.log('✅ All user sessions cleared - fresh contexts will be created on next access');
    
    return true;
  } catch (error) {
    console.error('❌ Error reloading browser contexts:', error);
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

// Navigate Playwright to a specific HeyGen agent session by sessionId (HTTP GET)
proxyRouter.get('/agent/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  if (!sessionId) {
    return res.status(400).json({ success: false, error: 'sessionId is required' });
  }
  if (!browser) {
    return res.status(503).json({ success: false, error: 'Browser not initialized' });
  }
  
  // Extract user email from JWT token in cookie
  let userEmail = 'anonymous';
  try {
    const cookieHeader = req.headers.cookie || '';
    const cookieMap = {};
    cookieHeader.split(';').forEach(c => {
      const [k, v] = c.split('=');
      if (k && v) cookieMap[k.trim()] = decodeURIComponent(v.trim());
    });
    const arenaToken = cookieMap['arena_token'];
    if (arenaToken) {
      const tokenData = verifyToken(arenaToken);
      if (tokenData && tokenData.email) {
        userEmail = tokenData.email;
      }
    }
  } catch (_) {}
  
  const relativeUrl = `/agent/${sessionId}`;
  const targetUrl = TARGET + relativeUrl;
  console.log(`🌐 [HTTP] Navigating to agent session: ${targetUrl} for user: ${userEmail}`);
  try {
    // Check if session already exists (from WebSocket)
    let session = userSessions.get(userEmail);
    if (!session) {
      // Only create new session if one doesn't exist
      session = await getUserSession(userEmail);
    } else {
      console.log(`♻️  Reusing existing session for: ${userEmail}`);
    }
    const { page: agentPage } = session;
    const current = agentPage.url();
    if (current !== targetUrl) {
      await agentPage.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 300000 });
    } else {
      console.log('➡️  Already on target session URL');
    }
    // Try to extract messages similarly to the WebSocket navigate handler
    let messages = null;
    try {
      await agentPage.waitForSelector('.tw-bg-fill-block, div.tw-flex.tw-justify-start', { timeout: 5000 });
      messages = await agentPage.evaluate(() => {
        const allElements = Array.from(
          document.querySelectorAll('div.tw-flex.tw-justify-end, div.tw-flex.tw-justify-start, div.tw-border-brand.tw-bg-more-brandLighter')
        );
        const allMessages = allElements.map(row => {
          // Video card
          if (row.classList.contains('tw-border-brand') && row.classList.contains('tw-bg-more-brandLighter')) {
            const videoElement = row.querySelector('video');
            if (videoElement) {
              const videoPoster = videoElement.poster;
              const titleElement = row.querySelector('.tw-text-base.tw-font-bold.tw-tracking-tight');
              const subtitleElement = row.querySelector('.tw-text-sm.tw-font-medium.tw-text-textBody span');
              const title = titleElement ? titleElement.innerText.trim() : 'Your video is ready!';
              return {
                role: 'agent',
                text: subtitleElement ? subtitleElement.innerText.trim() : '',
                video: { thumbnail: videoPoster, videoUrl: null, poster: videoPoster, title }
              };
            }
            return null;
          }
          // User message
          const isUser = row.classList.contains('tw-justify-end');
          if (isUser) {
            const userBubble = row.querySelector('.tw-bg-fill-block');
            const text = userBubble ? (userBubble.innerText || '').trim() : '';
            return text ? { role: 'user', text } : null;
          }
          // Agent text
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
            const inReasoning = el && el.closest('div.tw-border-l-2.tw-border-line');
            if (el && !inReasoning && el.innerText && el.innerText.trim().length > 0) { replyEl = el; break; }
          }
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
              text = textCandidates.sort((a,b) => b.length - a.length)[0];
            }
          }
          // Optional: inline video element within chat row
          const videoElement = row.querySelector('video');
          let video = null;
          if (videoElement) {
            const videoSrc = videoElement.src || videoElement.querySelector('source')?.src;
            const videoPoster = videoElement.poster;
            const thumbnailImg = row.querySelector('img[alt="draft thumbnail"]') || row.querySelector('img[class*="thumbnail"]') || row.querySelector('img');
            const thumbnail = thumbnailImg ? thumbnailImg.src : videoPoster;
            const titleElement = row.querySelector('div.tw-text-textTitle, div.tw-font-medium, h3, h2');
            const title = titleElement ? titleElement.innerText.trim() : 'Your video is ready!';
            video = { thumbnail: thumbnail || videoPoster, videoUrl: videoSrc, poster: videoPoster || thumbnail, title };
          }
          return text || video ? { role: 'agent', text, video } : null;
        }).filter(Boolean);
        return { messages: allMessages };
      });
    } catch (_) {}
    return res.json({ success: true, url: targetUrl, ...(messages ? { messages } : {}) });
  } catch (error) {
    console.error('❌ [HTTP] Navigation error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Navigate Playwright to a specific HeyGen agent session by sessionId (HTTP POST)
proxyRouter.post('/navigate-agent', async (req, res) => {
  const sessionId = (req.body && (req.body.sessionId || req.body.id)) || null;
  if (!sessionId) {
    return res.status(400).json({ success: false, error: 'sessionId is required' });
  }
  req.params = { sessionId };
  return proxyRouter.handle({ ...req, method: 'GET', url: `/agent/${sessionId}` }, res);
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
    if (!browser) {
      return res.json({ success: false, error: 'Browser not initialized' });
    }
    
    // Extract user email from JWT token in cookie
    let userEmail = 'anonymous';
    try {
      const cookieHeader = req.headers.cookie || '';
      const cookieMap = {};
      cookieHeader.split(';').forEach(c => {
        const [k, v] = c.split('=');
        if (k && v) cookieMap[k.trim()] = decodeURIComponent(v.trim());
      });
      const arenaToken = cookieMap['arena_token'];
      if (arenaToken) {
        const tokenData = verifyToken(arenaToken);
        if (tokenData && tokenData.email) {
          userEmail = tokenData.email;
        }
      }
    } catch (_) {}
    
    console.log(`👤 Submitting prompt for user: ${userEmail}`);
    
    // If user is authenticated and we have an anonymous session, migrate it
    if (userEmail !== 'anonymous' && userSessions.has('anonymous')) {
      const anonSession = userSessions.get('anonymous');
      console.log(`🔄 Migrating anonymous session to: ${userEmail}`);
      userSessions.set(userEmail, anonSession);
      anonSession.userEmail = userEmail;
      userSessions.delete('anonymous');
    }
    
    // Check if session already exists (from WebSocket)
    let session = userSessions.get(userEmail);
    if (!session) {
      // Only create new session if one doesn't exist
      session = await getUserSession(userEmail);
    } else {
      console.log(`♻️  Reusing existing session for: ${userEmail}`);
    }
    const { page: submitPage } = session;
    
    // Navigate to home page only if not already there
    const currentUrl = submitPage.url();
    if (!currentUrl.includes('app.heygen.com/home')) {
      console.log('🌐 Navigating to home...');
      try {
        await submitPage.goto('https://app.heygen.com/home', { 
          waitUntil: 'domcontentloaded',
          timeout: 30000 
        });
        // Wait a bit for React to render
        await submitPage.waitForTimeout(2000);
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
    await submitPage.waitForSelector(inputSelector, { state: 'visible', timeout: 60000 });
    
    // Small delay to ensure page is fully interactive
    await submitPage.waitForTimeout(1000);
    await submitPage.screenshot({ path: '/tmp/step1.png' });
    console.log('📸 Screenshot saved: /tmp/step1.png');
    
    // Type and submit
    console.log('⌨️  Typing prompt...');
    await submitPage.locator(inputSelector).click({ force: true });
    await submitPage.fill(inputSelector, prompt);
    await submitPage.waitForTimeout(500);

    await submitPage.screenshot({ path: '/tmp/step2.png' });
    console.log('📸 Screenshot saved: /tmp/step2.png');
    
    // Wait for submit button to be enabled
    console.log('⏳ Waiting for submit button...');
    const buttonSelector = 'button[data-loading="false"].tw-bg-brand:not([disabled])';
    await submitPage.waitForSelector(buttonSelector, { state: 'visible', timeout: 5000 });

    await submitPage.screenshot({ path: '/tmp/step3.png' });
    console.log('📸 Screenshot saved: /tmp/step3.png');
    
    console.log('🖱️  Clicking submit button...');
    await submitPage.locator(buttonSelector).first().click({ force: true });
    await submitPage.waitForTimeout(500);
    await submitPage.screenshot({ path: '/tmp/step4.png' });
    console.log('📸 Screenshot saved: /tmp/step4.png');    

    // Wait for navigation to agent session
    console.log('⏳ Waiting for session page...');
    await submitPage.waitForURL(/\/agent\/.*/, { timeout: 300000 });
    
    const sessionUrl = submitPage.url();
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
    if (!browser) {
      return res.json({ success: false, error: 'Browser not initialized' });
    }
    
    // Extract user email from JWT token in cookie
    let userEmail = 'anonymous';
    try {
      const cookieHeader = req.headers.cookie || '';
      const cookieMap = {};
      cookieHeader.split(';').forEach(c => {
        const [k, v] = c.split('=');
        if (k && v) cookieMap[k.trim()] = decodeURIComponent(v.trim());
      });
      const arenaToken = cookieMap['arena_token'];
      if (arenaToken) {
        const tokenData = verifyToken(arenaToken);
        if (tokenData && tokenData.email) {
          userEmail = tokenData.email;
        }
      }
    } catch (_) {}
    
    console.log(`👤 Uploading files for user: ${userEmail}`);
    // Check if session already exists (from WebSocket)
    let session = userSessions.get(userEmail);
    if (!session) {
      // Only create new session if one doesn't exist
      session = await getUserSession(userEmail);
    } else {
      console.log(`♻️  Reusing existing session for: ${userEmail}`);
    }
    const { page: uploadFilesPage } = session;
    
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
    
    await uploadFilesPage.screenshot({ path: '/tmp/step0.png' });
    console.log('📸 Screenshot saved: /tmp/step0.png');
    
    // Navigate to home first
    console.log('🌐 Navigating to home...');
    await uploadFilesPage.goto('https://app.heygen.com/home', { 
      waitUntil: 'domcontentloaded',
      timeout: 30000 
    });
    console.log('✅ Navigated to home');
    
    // Wait for the chat input to be ready
    console.log('⏳ Waiting for page to be ready...');
    await uploadFilesPage.waitForSelector('div[role="textbox"][contenteditable="true"]', { state: 'visible', timeout: 10000 });
    
    // Use DataTransfer API to set files on the hidden file input
    console.log('📤 Setting files via DataTransfer API...');
    
    // Read actual file content and create proper File objects
    const fs = await import('fs');
    const uploadSuccess = await uploadFilesPage.evaluate(async (filesWithContent) => {
      console.log('📤 [Browser] Received', filesWithContent.length, 'files to upload');
      console.log('📤 [Browser] File details:', filesWithContent.map(f => ({ name: f.name, type: f.type, size: f.content.length })));
      
      // Find the hidden file input (image files only)
      await new Promise(resolve => setTimeout(resolve, 1000));
      const fileInput = document.querySelector('input[type="file"][accept*="image"]') || 
                        document.querySelector('input[type="file"][accept*="jpg"]') ||
                        document.querySelector('input[type="file"][accept*="png"]') ||
                        document.querySelector('input[type="file"]');
      if (!fileInput) {
        console.error('❌ [Browser] File input not found');
        return false;
      }
      console.log('✅ [Browser] File input found');
      
      // Restrict file picker to images only
      const originalAccept = fileInput.accept;
      fileInput.accept = '.jpg,.jpeg,.png,.gif,.webp,.svg,.heic';
      console.log('📄 [Browser] Restricted accept attribute to images only (was: ' + originalAccept + ')');
      
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
      await uploadFilesPage.waitForSelector(attachmentSelector, { timeout: 15000 });
      
      const attachedImages = await uploadFilesPage.$$eval(attachmentSelector, imgs => imgs.map(i => i.src));
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
      await page.waitForTimeout(3000);
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

// HTTP endpoint to upload files on /generate (agent session) page
proxyRouter.post('/upload-files-generate', async (req, res) => {
  const files = req.files;
  
  if (!files || Object.keys(files).length === 0) {
    return res.json({ success: false, error: 'No files provided' });
  }
  
  console.log('📁 Received file upload request for /generate with', Object.keys(files).length, 'files');
  
  try {
    if (!browser) {
      return res.json({ success: false, error: 'Browser not initialized' });
    }
    
    // Extract user email from JWT token in cookie
    let userEmail = 'anonymous';
    try {
      const cookieHeader = req.headers.cookie || '';
      const cookieMap = {};
      cookieHeader.split(';').forEach(c => {
        const [k, v] = c.split('=');
        if (k && v) cookieMap[k.trim()] = decodeURIComponent(v.trim());
      });
      const arenaToken = cookieMap['arena_token'];
      if (arenaToken) {
        const tokenData = verifyToken(arenaToken);
        if (tokenData && tokenData.email) {
          userEmail = tokenData.email;
        }
      }
    } catch (_) {}
    
    console.log(`👤 Uploading files to /generate for user: ${userEmail}`);
    // Check if session already exists (from WebSocket)
    let session = userSessions.get(userEmail);
    if (!session) {
      // Only create new session if one doesn't exist
      session = await getUserSession(userEmail);
    } else {
      console.log(`♻️  Reusing existing session for: ${userEmail}`);
    }
    const { page: uploadGenPage } = session;
    
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
    
    // Check if we're on an agent session page
    const currentUrl = uploadGenPage.url();
    if (!currentUrl.includes('/agent/')) {
      return res.json({ success: false, error: 'Not on an agent session page. Current URL: ' + currentUrl });
    }
    
    console.log('✅ On agent session page:', currentUrl);
    
    // Wait for the chat input to be ready
    console.log('⏳ Waiting for page to be ready...');
    await uploadGenPage.waitForSelector('div[role="textbox"][contenteditable="true"]', { state: 'visible', timeout: 10000 });
    
    // Use DataTransfer API to set files on the hidden file input
    console.log('📤 Setting files via DataTransfer API...');
    
    // Read actual file content and create proper File objects
    const fs = await import('fs');
    const uploadSuccess = await uploadGenPage.evaluate(async (filesWithContent) => {
      console.log('📤 [Browser] Received', filesWithContent.length, 'files to upload');
      console.log('📤 [Browser] File details:', filesWithContent.map(f => ({ name: f.name, type: f.type, size: f.content.length })));
      
      // Find the hidden file input
      await new Promise(resolve => setTimeout(resolve, 1000));
      const fileInput = document.querySelector('input[type="file"][accept*=".mp4"]');
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
    
    // Wait for HeyGen to process and display the uploaded file
    console.log('⏳ Waiting for HeyGen to process uploaded files...');
    try {
      // Wait a bit for processing
      await page.waitForTimeout(2000);
      console.log('✅ Files should be attached');
    } catch (waitError) {
      console.warn('⚠️  Could not verify file attachment:', waitError.message);
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
async function handleWebSocketMessage(ws, data, session = null) {
  switch (data.action) {
    case 'authenticate':
      console.log('🔑 Received authentication request');
      if (data.token) {
        const tokenData = verifyToken(data.token);
        if (tokenData && tokenData.email) {
          ws.user = { email: tokenData.email };
          console.log(`✅ Authenticated user: ${tokenData.email}`);
          ws.send(JSON.stringify({ 
            action: 'authenticated',
            email: tokenData.email 
          }));
          return;
        } else {
          console.warn('⚠️ Invalid or expired token');
        }
      } else {
        console.warn('⚠️ No token provided for authentication');
      }
      // If we get here, authentication failed
      ws.send(JSON.stringify({ 
        action: 'authentication_failed',
        error: 'Invalid or expired token' 
      }));
      return;
      
    case 'navigate':
      const targetUrl = TARGET + data.url;
      console.log(`🌐 Navigating to: ${targetUrl}`);
      try {
        // Use passed session instead of creating new one
        if (!session?.page) {
          throw new Error('No active browser session');
        }
        const page = session.page;
        
        const current = page.url();
        if (current === targetUrl) {
          console.log('➡️  Already on target URL, skipping navigation to avoid reload');
        } else {
          await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 300000 });
        }
      } catch (navErr) {
        console.warn('Navigation check failed, proceeding with goto:', navErr?.message || navErr);
        if (!session?.page) {
          throw new Error('No active browser session');
        }
        await session.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 300000 });
      }
          // If navigating to an agent session, attempt to extract chat messages
      let messages = null;
      try {
        if (typeof data.url === 'string' && data.url.startsWith('/agent/')) {
          if (!session?.page) {
            throw new Error('No active browser session');
          }
          const page = session.page;
          try {
            await page.waitForSelector('.tw-bg-fill-block, div.tw-flex.tw-justify-start', { timeout: 5000 });
          } catch (_) {}
          messages = await page.evaluate(() => {
            // Get all chat rows AND video cards in order
            const allElements = Array.from(
              document.querySelectorAll('div.tw-flex.tw-justify-end, div.tw-flex.tw-justify-start, div.tw-border-brand.tw-bg-more-brandLighter')
            );
            
            const allMessages = allElements.map(row => {
              // Check if this is a video card (not a chat row)
              if (row.classList.contains('tw-border-brand') && row.classList.contains('tw-bg-more-brandLighter')) {
                // Only return video messages if the <video> element exists (video is ready)
                // Ignore thumbnail-only placeholders (avatar_tmp) that appear during generation
                const videoElement = row.querySelector('video');
                if (videoElement) {
                  const videoPoster = videoElement.poster;
                  const titleElement = row.querySelector('.tw-text-base.tw-font-bold.tw-tracking-tight');
                  const subtitleElement = row.querySelector('.tw-text-sm.tw-font-medium.tw-text-textBody span');
                  const title = titleElement ? titleElement.innerText.trim() : 'Your video is ready!';
                  
                  return {
                    role: 'agent',
                    text: subtitleElement ? subtitleElement.innerText.trim() : '',
                    video: {
                      thumbnail: videoPoster,
                      videoUrl: null,
                      poster: videoPoster,
                      title: title
                    }
                  };
                }
                // Ignore thumbnail-only cards without video element - they're just placeholders
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
                if (el && !inReasoning && el.innerText && el.innerText.trim().length > 0) { 
                  replyEl = el; 
                  break; 
                }
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
              try {
                const total = (fetchedMessages?.messages || []).length;
                const withVideos = (fetchedMessages?.messages || []).filter(m => m?.video?.videoUrl).length;
                console.log(`📊 [get_messages] Messages: ${total}, with video urls: ${withVideos}`);
              } catch (_) {}
            }
            // Use fetchedMessages as the outgoing messages payload
            try { if (fetchedMessages && fetchedMessages.messages) { messages = fetchedMessages; } } catch (_) {}
          } catch (err) {
            messages = { error: 'message_extraction_failed', details: String(err && err.message ? err.message : err) };
          }
          ws.send(JSON.stringify(Object.assign({ action: 'get_messages', success: true, url: targetUrl }, messages ? { messages } : {})));
          break;
          
        // 'reload' action disabled to avoid interrupting agent responses
          
        case 'back':
          console.log('⬅️ Going back');
          if (!session?.page) {
            throw new Error('No active browser session');
          }
          await session.page.goBack();
          ws.send(JSON.stringify({ success: true }));
          break;
          
         // Replace the 'initial_load' case in handleWebSocketMessage function in playwright-live-proxy.js

// Replace the 'initial_load' case in handleWebSocketMessage function in playwright-live-proxy.js


      case 'initial_load':
        console.log('🚀 [initial_load] Starting initial page load with video extraction');
        let initialMessages = [];
        try {
          // Use passed session instead of creating new one
          if (!session?.page) {
            throw new Error('No active browser session');
          }
          const initialPage = session.page;
          const currentUrl = initialPage.url();
          console.log('🌐 [initial_load] Current URL:', currentUrl);
          if (currentUrl.includes('/agent/')) {
            // Wait for page to be ready
            try {
              await initialPage.waitForSelector('.tw-bg-fill-block, div.tw-flex.tw-justify-start', { timeout: 3000 });
            } catch (_) {}
            await initialPage.waitForTimeout(500);
            
            // Get all video cards first
            const cardSelector = 'div.tw-flex.tw-flex-col.tw-items-stretch.tw-rounded-2xl.tw-border.tw-border-line.tw-bg-fill-general.tw-cursor-pointer:not(.tw-hidden)';
            const videoCards = await initialPage.$$(cardSelector);
            console.log(`📦 [initial_load] Found ${videoCards.length} video cards to process`);
            
            // Process each video card sequentially
            const extractedVideos = [];
            for (let i = 0; i < videoCards.length; i++) {
              console.log(`🎬 [initial_load] Processing video card ${i + 1}/${videoCards.length}`);
              try {
                const card = videoCards[i];
                
                // Extract thumbnail and title BEFORE clicking
                const cardData = await card.evaluate(card => {
                  const thumbnailImg = card.querySelector('img[alt="draft thumbnail"]');
                  const titleElement = card.querySelector('.tw-text-base.tw-font-bold.tw-tracking-tight');
                  const subtitleElement = card.querySelector('.tw-text-sm.tw-font-medium.tw-text-textBody span');
                  
                  return {
                    thumbnail: thumbnailImg ? thumbnailImg.src : null,
                    title: titleElement ? titleElement.innerText.trim() : 'Your video is ready!',
                    subtitle: subtitleElement ? subtitleElement.innerText.trim() : ''
                  };
                });
                
                if (!cardData.thumbnail) {
                  console.log(`⏭️  Skipping card ${i + 1} - no thumbnail found`);
                  continue;
                }
                
                // Click the card
                try {
                  await card.click({ timeout: 3000 });
                  console.log(`✅ [initial_load] Card ${i + 1} clicked`);
                } catch (clickErr) {
                  console.log(`⚠️ [initial_load] Card ${i + 1} click failed, trying icon:`, clickErr.message);
                  const icon = await card.$('iconpark-icon[name="fill-the-canva"]');
                  if (icon) {
                    try {
                      await icon.click({ timeout: 3000 });
                      console.log(`✅ [initial_load] Card ${i + 1} icon clicked`);
                    } catch (_) {}
                  }
                }
                
                // Wait for video to appear with multiple retries
                let videoData = null;
                for (let attempt = 0; attempt < 3; attempt++) {
                  try {
                    await initialPage.waitForSelector('video', { timeout: 2000 });
                    await initialPage.waitForTimeout(1000); // Give it time to load src
                    
                    // Extract video data from sidebar
                    videoData = await initialPage.evaluate(() => {
                      const allVideos = document.querySelectorAll('video');
                      console.log(`[Browser] Found ${allVideos.length} video elements`);
                      
                      let v = null;
                      for (const vid of allVideos) {
                        const src = vid.src || vid.querySelector('source')?.src || vid.querySelector('source')?.getAttribute('src') || '';
                        console.log(`[Browser] Video src: ${src.substring(0, 80)}...`);
                        
                        if (src && src.includes('resource2.heygen.ai') && !src.includes('liteSharePreviewAnimation')) {
                          v = vid;
                          console.log(`[Browser] ✅ Found valid video`);
                          break;
                        }
                      }
                      
                      if (!v) {
                        console.log(`[Browser] ❌ No valid video found`);
                        return null;
                      }
                      
                      const src = v.src || v.querySelector('source')?.src || v.querySelector('source')?.getAttribute('src') || '';
                      const poster = v.poster || '';
                      const titleEl = document.querySelector('.tw-text-base.tw-font-bold.tw-tracking-tight') ||
                                      document.querySelector('h2, h3');
                      const title = (titleEl?.innerText || titleEl?.textContent || '').trim();
                      
                      return { videoUrl: src, poster, title };
                    });
                    
                    if (videoData && videoData.videoUrl) {
                      console.log(`✅ [initial_load] Video extracted on attempt ${attempt + 1}`);
                      break;
                    } else {
                      console.log(`⚠️ [initial_load] No valid video on attempt ${attempt + 1}, retrying...`);
                    }
                  } catch (waitErr) {
                    console.log(`⚠️ [initial_load] Video wait timeout on attempt ${attempt + 1}`);
                  }
                }
                
                if (videoData && videoData.videoUrl) {
                  extractedVideos.push({
                    ...cardData,
                    videoUrl: videoData.videoUrl,
                    poster: videoData.poster || cardData.thumbnail
                  });
                  console.log(`💾 [initial_load] Extracted video ${i + 1}: ${videoData.title || cardData.title}`);
                } else {
                  console.log(`⚠️ [initial_load] No video found for card ${i + 1}`);
                }
                
                // Close the sidebar/modal
                try {
                  await initialPage.keyboard.press('Escape');
                  await initialPage.waitForTimeout(300);
                } catch (_) {
                  try {
                    const closeBtn = await initialPage.$('button[aria-label="Close"]');
                    if (closeBtn) {
                      await closeBtn.click();
                      await initialPage.waitForTimeout(300);
                    }
                  } catch (_) {}
                }
                
              } catch (cardErr) {
                console.log(`❌ [initial_load] Error processing card ${i + 1}:`, cardErr.message);
              }
            }
            
            console.log(`🎬 [initial_load] Extracted ${extractedVideos.length} videos total`);
            
            // Now extract ALL messages in DOM order (text messages AND video card placeholders)
            const allMessagesWithPositions = await initialPage.evaluate(() => {
              // Select both chat messages AND video cards, in DOM order
              const allElements = Array.from(
                document.querySelectorAll('div.tw-flex.tw-justify-end, div.tw-flex.tw-justify-start, div.tw-flex.tw-flex-col.tw-items-stretch.tw-rounded-2xl.tw-border.tw-border-line.tw-bg-fill-general.tw-cursor-pointer')
              ).filter(el => !el.classList.contains('tw-hidden'));
              
              return allElements.map((row, index) => {
                // Check if this is a video card
                const isVideoCard = row.classList.contains('tw-flex-col') && 
                                    row.classList.contains('tw-rounded-2xl') && 
                                    row.classList.contains('tw-bg-fill-general');
                
                if (isVideoCard) {
                  const thumbnailImg = row.querySelector('img[alt="draft thumbnail"]');
                  const titleElement = row.querySelector('.tw-text-base.tw-font-bold.tw-tracking-tight');
                  const thumbnail = thumbnailImg ? thumbnailImg.src : null;
                  const title = titleElement ? titleElement.innerText.trim() : 'Your video is ready!';
                  
                  return {
                    type: 'video_placeholder',
                    position: index,
                    thumbnail: thumbnail,
                    title: title
                  };
                }
                
                // Regular chat message
                const isUser = row.classList.contains('tw-justify-end');
                
                if (isUser) {
                  const userBubble = row.querySelector('.tw-bg-fill-block');
                  const text = userBubble ? userBubble.innerText.trim() : '';
                  const attachedImages = [];
                  const imageElements = row.querySelectorAll('img[src*="heygen"]');
                  imageElements.forEach(img => {
                    if (img.src) {
                      attachedImages.push({
                        url: img.src,
                        alt: img.alt || 'User attached image'
                      });
                    }
                  });
                  
                  if (text || attachedImages.length > 0) {
                    const message = { 
                      type: 'message',
                      position: index,
                      role: 'user' 
                    };
                    if (text) message.text = text;
                    if (attachedImages.length > 0) message.images = attachedImages;
                    return message;
                  }
                  return null;
                }
                
                // Agent text message
                let reply = null;
                const replySelectors = [
                  'div.tw-prose',
                  'div.tw-text-textTitle div.tw-prose',
                  'div > div.tw-text-textTitle > div.tw-prose',
                  'div > div.tw-bg-fill-block'
                ];
                for (const sel of replySelectors) {
                  const el = row.querySelector(sel);
                  const inReasoning = el && el.closest('div.tw-border-l-2.tw-border-line');
                  if (el && !inReasoning) {
                    const txt = el.innerText?.trim() || el.textContent?.trim();
                    if (txt && txt.length > 0) {
                      reply = el;
                      break;
                    }
                  }
                }
                
                const text = reply ? (reply.innerText?.trim() || reply.textContent?.trim() || '') : '';
                return text ? { 
                  type: 'message',
                  position: index,
                  role: 'agent', 
                  text, 
                  video: null 
                } : null;
              }).filter(Boolean);
            });
            
            console.log(`💬 [initial_load] Extracted ${allMessagesWithPositions.length} elements in DOM order`);
            
            // Debug: log all extracted videos with their thumbnails
            console.log(`🔍 [initial_load] Extracted videos:`);
            extractedVideos.forEach((v, idx) => {
              console.log(`  ${idx + 1}. "${v.title}" - thumbnail: ${v.thumbnail?.substring(0, 60)}...`);
            });
            
            // Debug: log all video placeholders
            console.log(`🔍 [initial_load] Video placeholders in DOM:`);
            allMessagesWithPositions.filter(m => m.type === 'video_placeholder').forEach((p, idx) => {
              console.log(`  ${idx + 1}. Pos ${p.position}: "${p.title}" - thumbnail: ${p.thumbnail?.substring(0, 60)}...`);
            });
            
            // Build final message array in correct order
            initialMessages = allMessagesWithPositions.map(item => {
              if (item.type === 'video_placeholder') {
                // Find matching extracted video by thumbnail (normalize URLs for comparison)
                const normalizeThumbnail = (url) => {
                  if (!url) return '';
                  // Remove query parameters for comparison
                  return url.split('?')[0];
                };
                
                const normalizedPlaceholderThumb = normalizeThumbnail(item.thumbnail);
                const matchingVideo = extractedVideos.find(v => 
                  normalizeThumbnail(v.thumbnail) === normalizedPlaceholderThumb
                );
                
                if (matchingVideo) {
                  console.log(`🔗 [initial_load] Matched video at position ${item.position}: ${matchingVideo.title}`);
                  return {
                    role: 'agent',
                    text: matchingVideo.subtitle || '',
                    video: {
                      thumbnail: matchingVideo.thumbnail || matchingVideo.poster,
                      videoUrl: matchingVideo.videoUrl,
                      poster: matchingVideo.poster || matchingVideo.thumbnail,
                      title: matchingVideo.title || 'Your video is ready!'
                    }
                  };
                } else {
                  console.log(`⚠️ [initial_load] No extracted video found for placeholder at position ${item.position}`);
                  console.log(`   Looking for: ${normalizedPlaceholderThumb.substring(0, 60)}...`);
                  // Return a placeholder video message without URL
                  return {
                    role: 'agent',
                    text: '',
                    video: {
                      thumbnail: item.thumbnail || '',
                      videoUrl: null,
                      poster: item.thumbnail || '',
                      title: item.title || 'Your video is ready!'
                    }
                  };
                }
              } else {
                // Regular text message
                return {
                  role: item.role,
                  text: item.text,
                  ...(item.images ? { images: item.images } : {})
                };
              }
            });
            
            console.log(`✅ [initial_load] Total messages: ${initialMessages.length} (${extractedVideos.length} videos)`);
          }
        } catch (err) {
          console.log('❌ [initial_load] Error:', err.message);
          ws.send(JSON.stringify({ success: false, action: 'initial_load', error: err.message }));
          break;
        }
        
        ws.send(JSON.stringify({ 
          success: true, 
          action: 'initial_load', 
          messages: initialMessages,
          complete: true
        }));
        break;        

        case 'get_messages':
          console.log('📬 [get_messages] Fetching messages from current page');
          let fetchedMessages = null;
          try {
            // Use passed session instead of creating new one
            if (!session?.page) {
              throw new Error('No active browser session');
            }
            const page = session.page;
            const currentUrl = page.url();
            console.log('🌐 [get_messages] Current URL:', currentUrl);
            if (currentUrl.includes('/agent/')) {
              try {
                await page.waitForSelector('.tw-bg-fill-block, div.tw-flex.tw-justify-start', { timeout: 2000 });
              } catch (_) {}
              // Give the DOM a brief moment to render streamed content
              try { await page.waitForTimeout(300); } catch (_) {}
              // Simple: click the first visible video card to load its video, then extract URL
              try {
                const cardSelector = 'div.tw-flex.tw-flex-col.tw-items-stretch.tw-rounded-2xl.tw-border.tw-border-line.tw-bg-fill-general.tw-cursor-pointer:not(.tw-hidden)';
                const card = await page.$(cardSelector);
                if (card) {
                  console.log('🎬 [get_messages] Found video card, clicking to load video');
                  try {
                    await card.click({ timeout: 3000 });
                    console.log('✅ [get_messages] Card clicked');
                  } catch (clickErr) {
                    console.log('⚠️ [get_messages] Click failed, trying icon:', clickErr.message);
                    const icon = await card.$('iconpark-icon[name="fill-the-canva"]');
                    if (icon) {
                      try {
                        await icon.click({ timeout: 3000 });
                        console.log('✅ [get_messages] Icon clicked');
                      } catch (_) {}
                    }
                  }
                  // Wait for video element to appear anywhere on the page
                  try {
                    await page.waitForSelector('video', { timeout: 2000 });
                  } catch (_) {}
                  try { await page.waitForTimeout(500); } catch (_) {}
                  // Extract sidebar video URL/poster/title and cache onto the card element's dataset
                  try {
                    const videoData = await page.evaluate(() => {
                      // Find ANY video element on the page with resource2.heygen.ai src
                      const allVideos = document.querySelectorAll('video');
                      let v = null;
                      for (const vid of allVideos) {
                        const src = vid.src || vid.querySelector('source')?.src || vid.querySelector('source')?.getAttribute('src') || '';
                        if (src && src.includes('resource2.heygen.ai') && !src.includes('liteSharePreviewAnimation')) {
                          v = vid;
                          break;
                        }
                      }
                      let src = '';
                      let poster = '';
                      if (v) {
                        src = v.src || v.querySelector('source')?.src || v.querySelector('source')?.getAttribute('src') || '';
                        poster = v.poster || '';
                      }
                      // Title from sidebar header if present
                      const titleEl = document.querySelector('.tw-text-base.tw-font-bold.tw-tracking-tight') ||
                                       document.querySelector('h2, h3');
                      const title = (titleEl?.innerText || titleEl?.textContent || '').trim();
                      return { videoUrl: src, poster, title };
                    });
                    if (videoData && videoData.videoUrl && videoData.videoUrl.startsWith('https://resource2.heygen.ai/') && !videoData.videoUrl.includes('liteSharePreviewAnimation')) {
                      // Store on page object so we can create a video message
                      page._extractedVideo = videoData;
                      console.log('💾 [get_messages] Found video after card click:', videoData.title || 'untitled');
                    } else {
                      console.log('⚠️ [get_messages] Sidebar video not found or invalid');
                    }
                  } catch (cacheErr) {
                    console.log('❌ [get_messages] Error caching video data:', cacheErr.message);
                  }
                }
              } catch (err) {
                console.log('⚠️ [get_messages] Card click attempt failed:', err.message);
              }
              // Wait a bit for video elements or cached dataset to be ready
              try { await page.waitForTimeout(150); } catch (_) {}
              fetchedMessages = await page.evaluate(() => {
                // Get all chat rows AND video cards in order (exclude hidden placeholders)
                const allElements = Array.from(
                  document.querySelectorAll('div.tw-flex.tw-justify-end, div.tw-flex.tw-justify-start, div.tw-flex.tw-flex-col.tw-items-stretch.tw-rounded-2xl.tw-border.tw-border-line.tw-bg-fill-general.tw-cursor-pointer')
                ).filter(el => !el.classList.contains('tw-hidden'));
                console.log('[get_messages] Found', allElements.length, 'message rows');
                
                // Helper to detect if an agent message is still being streamed (incomplete)
                const isIncompleteMessage = (row) => {
                  // Check for typing indicator or streaming animation
                  const typingIndicator = row.querySelector('[data-testid="typing-indicator"]');
                  if (typingIndicator && typingIndicator.offsetParent !== null) {
                    return true;
                  }
                  
                  // Check for blinking cursor or streaming animation
                  const cursor = row.querySelector('.tw-animate-pulse, .tw-animate-bounce, [class*="animate"]');
                  if (cursor && cursor.offsetParent !== null) {
                    return true;
                  }
                  
                  // Check if message ends with incomplete punctuation or has streaming markers
                  const textEl = row.querySelector('div.tw-prose, div.tw-text-textTitle div.tw-prose');
                  if (textEl) {
                    const text = (textEl.innerText || textEl.textContent || '').trim();
                    // If text is very short (< 20 chars) and doesn't end with punctuation, likely incomplete
                    if (text.length < 20 && text.length > 0 && !/[.!?:;,)]$/.test(text)) {
                      return true;
                    }
                  }
                  
                  return false;
                };
                
                const messages = allElements.map((row, idx) => {
                  console.log(`[get_messages] Processing row ${idx}:`, row.className);
                  
                  // Check if this is a video card (not a chat row)
                  // Video cards have these specific classes and contain a thumbnail image
                  if (row.classList.contains('tw-flex-col') && row.classList.contains('tw-rounded-2xl') && row.classList.contains('tw-bg-fill-general')) {
                    const thumbnailImg = row.querySelector('img[alt="draft thumbnail"]');
                    const videoElement = row.querySelector('video');
                    const titleElement = row.querySelector('.tw-text-base.tw-font-bold.tw-tracking-tight');
                    const subtitleElement = row.querySelector('.tw-text-sm.tw-font-medium.tw-text-textBody span');
                    // Prefer cached dataset from earlier sidebar extraction
                    const cachedUrl = row.dataset?.videoUrl || null;
                    const cachedPoster = row.dataset?.videoPoster || null;
                    const cachedTitle = row.dataset?.videoTitle || null;
                    // Build thumbnail/poster fallback
                    let thumbnail = cachedPoster || (videoElement?.poster || thumbnailImg?.src || '');
                    const title = cachedTitle || (titleElement ? titleElement.innerText.trim() : 'Your video is ready!');
                    // If we have either a cached URL or an inline video element, create the message
                    if (cachedUrl || videoElement) {
                      let videoUrl = cachedUrl;
                      if (!videoUrl && videoElement) {
                        videoUrl = videoElement.src || videoElement.querySelector('source')?.src || videoElement.querySelector('source')?.getAttribute('src') || '';
                      }
                      if (videoUrl && videoUrl.startsWith('https://resource2.heygen.ai/') && !videoUrl.includes('liteSharePreviewAnimation')) {
                        return {
                          role: 'agent',
                          text: subtitleElement ? subtitleElement.innerText.trim() : '',
                          video: {
                            thumbnail: thumbnail || undefined,
                            videoUrl: videoUrl,
                            poster: thumbnail || undefined,
                            title: title
                          }
                        };
                      }
                    }
                    // As a fallback, create a pending video message so the frontend can show a card and later fill the URL
                    if (thumbnail || title) {
                      return {
                        role: 'agent',
                        text: subtitleElement ? subtitleElement.innerText.trim() : '',
                        video: {
                          thumbnail: thumbnail || '',
                          videoUrl: null,
                          poster: thumbnail || '',
                          title: title || 'Your video is ready!'
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
                    
                    // Check for attached images in user message
                    const attachedImages = [];
                    // Be permissive: match any HeyGen-hosted image (e.g., resource2.heygen.ai, cdn variants)
                    const imageElements = row.querySelectorAll('img[src*="heygen"]');
                    imageElements.forEach(img => {
                      if (img.src) {
                        attachedImages.push({
                          url: img.src,
                          alt: img.alt || 'User attached image'
                        });
                      }
                    });
                    
                    // Return user message with text and/or images
                    if (text || attachedImages.length > 0) {
                      const message = { role: 'user' };
                      if (text) message.text = text;
                      if (attachedImages.length > 0) message.images = attachedImages;
                      return message;
                    }
                    return null;
                  }

                  // agent - get main reply, skip reasoning
                  // First check if this message is still being streamed (incomplete)
                  if (isIncompleteMessage(row)) {
                    console.log(`[get_messages] Skipping incomplete/streaming message at row ${idx}`);
                    return null; // Skip incomplete messages
                  }
                  
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
                  
                  // First, check if there's a video element in the sidebar/modal (after clicking card)
                  let sidebarVideo = null;
                  const sidebarVideoSelectors = ['aside video', '[role="dialog"] video'];
                  for (const sel of sidebarVideoSelectors) {
                    const v = document.querySelector(sel);
                    if (v && (v.src || v.querySelector('source')?.src)) {
                      sidebarVideo = v;
                      break;
                    }
                  }
                  
                  // If sidebar has video, use it; otherwise check the card itself
                  const videoElement = sidebarVideo || row.querySelector('video');
                  if (videoElement) {
                    // Get video source from multiple possible locations
                    let videoSrc = videoElement.src || '';
                    if (!videoSrc) {
                      const sourceElement = videoElement.querySelector('source');
                      if (sourceElement) {
                        videoSrc = sourceElement.src || sourceElement.getAttribute('src') || '';
                      }
                    }
                    const videoPoster = videoElement.poster;

                    // Ignore loading animation and non-resource2 sources
                    const isLoadingAnimation = videoSrc && (videoSrc.includes('static.heygen.ai/heygen/asset/liteSharePreviewAnimation.mp4') || videoSrc.includes('liteSharePreviewAnimation'));
                    const isValidResource2 = videoSrc && videoSrc.startsWith('https://resource2.heygen.ai/');

                    if (!isLoadingAnimation && isValidResource2) {
                      // Extract title from nearby text
                      const titleElement = row.querySelector('div.tw-text-textTitle, div.tw-font-medium, h3, h2');
                      const title = titleElement ? titleElement.innerText.trim() : 'Your video is ready!';

                      video = {
                        thumbnail: videoPoster,
                        videoUrl: videoSrc,
                        poster: videoPoster,
                        title: title
                      };
                    }
                  }
                  // Ignore thumbnail-only cards without video element - they're just placeholders
                  
                  // Only return if we have text or video
                  if (text || video) {
                    return { role: 'agent', text, video };
                  }
                  return null;
                }).filter(Boolean);

                // Merge a preceding image-only user message with the immediately following user text message
                const merged = [];
                for (let i = 0; i < messages.length; i++) {
                  const m = messages[i];
                  if (
                    m && m.role === 'user' && !m.text && Array.isArray(m.images) && m.images.length > 0
                  ) {
                    const next = messages[i + 1];
                    if (next && next.role === 'user' && next.text) {
                      const combinedImages = [...(next.images || [])];
                      const existingUrls = new Set(combinedImages.map(img => img && img.url).filter(Boolean));
                      for (const img of m.images) {
                        if (img && img.url && !existingUrls.has(img.url)) {
                          combinedImages.push(img);
                          existingUrls.add(img.url);
                        }
                      }
                      merged.push({ ...next, images: combinedImages });
                      i++; // Skip the next item since it's merged
                      continue;
                    }
                  }
                  merged.push(m);
                }

                // Dedupe any remaining identical image-only user messages by URL set
                const seenImageOnly = new Set();
                const deduped = [];
                for (const m of merged) {
                  if (m && m.role === 'user' && !m.text && Array.isArray(m.images) && m.images.length > 0) {
                    const key = 'user-images:' + m.images.map(img => img && img.url).filter(Boolean).sort().join('|');
                    if (seenImageOnly.has(key)) {
                      continue;
                    }
                    seenImageOnly.add(key);
                  }
                  deduped.push(m);
                }

                return { messages: deduped };
              });
              
              // If we extracted a video from clicking the card, add it as a standalone video message
              if (page._extractedVideo && fetchedMessages && fetchedMessages.messages) {
                const videoData = page._extractedVideo;
                const videoMessage = {
                  role: 'agent',
                  text: '',
                  video: {
                    thumbnail: videoData.poster || '',
                    videoUrl: videoData.videoUrl,
                    poster: videoData.poster || '',
                    title: videoData.title || 'Your video is ready!'
                  }
                };
                // Add to the end of messages
                fetchedMessages.messages.push(videoMessage);
                console.log('➕ [get_messages] Added video message to messages array');
                // Clear the extracted video
                delete page._extractedVideo;
              }
            }
          } catch (err) {
            fetchedMessages = { error: 'message_fetch_failed', details: String(err && err.message ? err.message : err) };
          }
          ws.send(JSON.stringify(Object.assign({ success: true, action: 'get_messages' }, fetchedMessages || {})));
          break;
          
        case 'debug_dom':
          console.log('🔍 Debugging DOM structure');
          try {
            if (!session?.page) {
              throw new Error('No active browser session');
            }
            const debugPage = session.page;
            const domInfo = await debugPage.evaluate(() => {
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
            if (!session?.page) {
              throw new Error('No active browser session');
            }
            const videoPage = session.page;
            
            // First, try to find and extract video directly from the page
            console.log('🔍 Searching for video element on page...');
            let videoData = await videoPage.evaluate(() => {
              // Look for any video element on the page
              const videos = document.querySelectorAll('video');
              console.log('Found', videos.length, 'video elements');
              
              for (const video of videos) {
                const src = video.src || video.querySelector('source')?.src;
                if (src && src.includes('resource2.heygen.ai')) {
                  return {
                    videoUrl: src,
                    poster: video.poster,
                    duration: video.duration
                  };
                }
              }
              return null;
            });
            
            // If no video found, report that no video found
            if (!videoData) {
              console.log('⚠️ No video found directly or by clicking video card');
            }
            
            // If still no video data, send error
            if (!videoData) {
              console.log('❌ No video data found');
              ws.send(JSON.stringify({ 
                success: false, 
                action: 'get_video_url', 
                error: 'No video found on page' 
              }));
              break;
            }
            
            // Validate the URL: ignore known loading animation and only accept resource2.heygen.ai URLs
            const resolvedUrl = videoData && videoData.videoUrl ? String(videoData.videoUrl) : '';
            const isLoadingAnimation = resolvedUrl.includes('static.heygen.ai/heygen/asset/liteSharePreviewAnimation.mp4') || 
                                    resolvedUrl.includes('loading-animation');
            const isValidResource2 = resolvedUrl.startsWith('https://resource2.heygen.ai/');
            
            if (!resolvedUrl) {
              ws.send(JSON.stringify({ 
                success: false, 
                action: 'get_video_url', 
                error: 'No video URL found' 
              }));
              break;
            }
            
            if (isLoadingAnimation) {
              console.log('🔍 Found loading animation, waiting...');
              ws.send(JSON.stringify({ 
                success: false, 
                action: 'get_video_url', 
                error: 'Loading animation detected, please wait...' 
              }));
              break;
            }
            
            if (!isValidResource2) {
              console.log('⚠️ Invalid video URL format:', resolvedUrl);
              ws.send(JSON.stringify({ 
                success: false, 
                action: 'get_video_url', 
                error: 'Invalid video URL format' 
              }));
              break;
            }
            
            // Close the modal/player if there's a close button
            try {
              const closeButton = await videoPage.$('button[aria-label="Close"], button:has-text("Close"), [class*="close"]');
              if (closeButton) await closeButton.click();
            } catch (_) {}
            
            // Get the current URL to extract the username from the session
            const currentUrl = videoPage.url();
            const sessionMatch = currentUrl.match(/\/agent\/([^/]+)/);
            const sessionId = sessionMatch ? sessionMatch[1] : 'anonymous';
            
            try {
              // Skip loading animation and only process valid video URLs
              if (videoData && videoData.videoUrl && 
                  videoData.videoUrl.startsWith('https://resource2.heygen.ai/') &&
                  !videoData.videoUrl.includes('static.heygen.ai/heygen/asset/liteSharePreviewAnimation.mp4')) {
                // Extract caption hash from URL
                // Extract video hash and original filename from URL
                let videoHash = null;
                let originalName = 'video';
                
                // Try to match the new URL format first: /video/transcode/HASH/.../resolution.mp4
                const transcodeMatch = videoData.videoUrl.match(/\/transcode\/([a-f0-9]+)\//i);
                if (transcodeMatch) {
                  videoHash = transcodeMatch[1];
                } else {
                  // Fall back to the old caption_ format
                  const captionMatch = videoData.videoUrl.match(/caption_([a-f0-9]+)\.mp4/i);
                  videoHash = captionMatch ? captionMatch[1] : null;
                }
                
                // Extract original filename from URL parameters (handle double-encoding)
                const filenameMatch = videoData.videoUrl.match(/filename[^=]*=([^&;]+)/);
                if (filenameMatch) {
                  let nameParam = filenameMatch[1].replace(/\+/g, ' ');
                  try { nameParam = decodeURIComponent(nameParam); } catch (_) {}
                  try { nameParam = decodeURIComponent(nameParam); } catch (_) {}
                  originalName = nameParam
                    .replace(/\.mp4.*$/, '')
                    .trim();
                }

                if (!videoHash) {
                  console.error('❌ Could not extract video hash from URL:', videoData.videoUrl);
                  ws.send(JSON.stringify({ 
                    success: false, 
                    action: 'get_video_url', 
                    error: 'Invalid video URL format' 
                  }));
                  break;
                }

                // Use clean title; save endpoint will append -<hash>.mp4
                const safeTitle = originalName;
                
                // Get user email from WebSocket user object
                const userEmail = ws.user?.email || 'unknown_user';
                console.log('📧 Using user email for directory:', userEmail);
                
                // Create safe directory name from email (replace @ and . with _)
                const userDirName = userEmail.replace(/[@.]/g, '_');
                const userDir = path.join(UPLOADS_DIR, userDirName);
                
                // Create directory if it doesn't exist
                if (!fs.existsSync(userDir)) {
                  fs.mkdirSync(userDir, { recursive: true });
                  console.log(`📁 Created user directory: ${userDir}`);
                } else {
                  console.log(`📁 Using existing user directory: ${userDir}`);
                }
                
                // Dedupe by hash regardless of title
                const existingByHash = fs.existsSync(userDir)
                  ? fs.readdirSync(userDir).find(f => f.endsWith(`-${videoHash}.mp4`))
                  : null;
                
                let savedVideoPath = null;
                if (existingByHash) {
                  console.log('⏭️ Video already exists by hash, skipping download:', path.join(userDir, existingByHash));
                  savedVideoPath = `/uploads/${userDirName}/${existingByHash}`;
                } else {
                  const baseUrl = process.env.RENDER_EXTERNAL_URL || `http://127.0.0.1:${PORT}`;
                  const response = await axios.post(`${baseUrl}/proxy/save-video`, {
                    userEmail: ws.user?.email || 'unknown_user',
                    videoUrl: videoData.videoUrl,
                    title: safeTitle
                  });
                  console.log('✅ Video saved successfully');
                  // Extract the saved filename from the response or construct it
                  if (response.data && response.data.filename) {
                    savedVideoPath = `/uploads/${userDirName}/${response.data.filename}`;
                  } else {
                    // Fallback: construct filename as title-hash.mp4
                    const filename = `video-${videoHash}.mp4`;
                    savedVideoPath = `/uploads/${userDirName}/${filename}`;
                  }
                }
                
                // Return the local server URL to the frontend
                ws.send(JSON.stringify({ 
                  success: true, 
                  action: 'get_video_url', 
                  data: {
                    videoUrl: videoData.videoUrl,
                    poster: videoData.poster,
                    title: safeTitle,
                    originalUrl: videoData.videoUrl
                  }
                }));
                return;
              }
            } catch (saveError) {
              console.error('❌ Error in video processing:', saveError.message);
              // Still send back the original HeyGen URL as fallback
              ws.send(JSON.stringify({ 
                success: true, 
                action: 'get_video_url', 
                data: {
                  videoUrl: videoData.videoUrl,
                  poster: videoData.poster,
                  title: safeTitle
                }
              }));
              return;
            }
            
            ws.send(JSON.stringify({ success: true, action: 'get_video_url', data: videoData }));
          } catch (err) {
            console.error('❌ get_video_url error:', err);
            if (err.message.includes('closed') || err.message.includes('detached')) {
              console.log('🔄 Attempting to recover session...');
              try {
                // Try to reinitialize the session
                const userEmail = session?.userEmail || 'anonymous';
                const newSession = await getUserSession(userEmail);
                if (newSession) {
                  Object.assign(session, newSession);
                  // Retry the operation after a short delay
                  await new Promise(resolve => setTimeout(resolve, 1000));
                  // Forward the message to the handler again with the new session
                  return handleWebSocketMessage(ws, data, session);
                }
              } catch (recoveryError) {
                console.error('❌ Failed to recover session:', recoveryError);
              }
            }
            ws.send(JSON.stringify({ 
              success: false, 
              action: 'get_video_url', 
              error: `Error getting video: ${err.message}` 
            }));
          }
          break;
          
        case 'upload_files':
          console.log('📁 Uploading files to agent session');
          try {
            if (!session?.page) {
              throw new Error('No active browser session');
            }
            const uploadPage = session.page;
            const currentUrl = uploadPage.url();
            if (!currentUrl.includes('/agent/')) {
              ws.send(JSON.stringify({ success: false, action: 'upload_files', error: 'Not on agent session page' }));
              break;
            }
            
            const files = data.files; // Array of {name, content (base64), type}
            if (!files || files.length === 0) {
              ws.send(JSON.stringify({ success: false, action: 'upload_files', error: 'No files provided' }));
              break;
            }
            
            console.log(`📤 Uploading ${files.length} files via WebSocket`);
            
            // Wait for the chat input to be ready
            await uploadPage.waitForSelector('div[role="textbox"][contenteditable="true"]', { state: 'visible', timeout: 10000 });
            
            // Use DataTransfer API to set files on the hidden file input
            const uploadSuccess = await uploadPage.evaluate(async (filesData) => {
              console.log('📤 [Browser] Received', filesData.length, 'files to upload');
              
              // Find the hidden file input (image files only)
              await new Promise(resolve => setTimeout(resolve, 1000));
              const fileInput = document.querySelector('input[type="file"][accept*="image"]') || 
                                document.querySelector('input[type="file"][accept*="jpg"]') ||
                                document.querySelector('input[type="file"][accept*="png"]') ||
                                document.querySelector('input[type="file"]');
              if (!fileInput) {
                console.error('❌ [Browser] File input not found');
                return false;
              }
              console.log('✅ [Browser] File input found');
              
              // Restrict file picker to images only
              const originalAccept = fileInput.accept;
              fileInput.accept = '.jpg,.jpeg,.png,.gif,.webp,.svg,.heic';
              console.log('📄 [Browser] Restricted accept attribute to images only (was: ' + originalAccept + ')');
              
              try {
                // Create DataTransfer object and add files
                const dataTransfer = new DataTransfer();
                
                // For each file, create a proper File object
                for (const fileData of filesData) {
                  // Decode base64 content
                  const base64Data = fileData.content.split(',')[1] || fileData.content;
                  const binaryString = atob(base64Data);
                  const bytes = new Uint8Array(binaryString.length);
                  for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                  }
                  
                  console.log(`📄 [Browser] Adding file: ${fileData.name} (type: ${fileData.type}, size: ${bytes.length} bytes)`);
                  const blob = new Blob([bytes], { type: fileData.type });
                  const file = new File([blob], fileData.name, { type: fileData.type });
                  dataTransfer.items.add(file);
                  console.log(`✅ [Browser] File added: ${fileData.name}`);
                }
                
                // Set the files on the input
                fileInput.files = dataTransfer.files;
                console.log(`✅ [Browser] Set ${fileInput.files.length} files on input element`);
                
                // Trigger change event
                fileInput.dispatchEvent(new Event('change', { bubbles: true }));
                fileInput.dispatchEvent(new Event('input', { bubbles: true }));
                console.log('✅ [Browser] Events triggered');
                
                return true;
              } catch (error) {
                console.error('❌ [Browser] Error setting files:', error.message);
                return false;
              }
            }, files);
            
            if (!uploadSuccess) {
              ws.send(JSON.stringify({ success: false, action: 'upload_files', error: 'Failed to set files on input element' }));
              break;
            }
            
            // Wait for processing
            await uploadPage.waitForTimeout(2000);
            
            console.log('✅ Files uploaded successfully via WebSocket');
            ws.send(JSON.stringify({ success: true, action: 'upload_files', filesCount: files.length }));
          } catch (err) {
            console.error('❌ Error uploading files:', err);
            ws.send(JSON.stringify({ success: false, action: 'upload_files', error: err.message }));
          }
          break;
          
        case 'send_message':
          console.log('💬 Sending message to agent session');
          try {
            if (!session?.page) {
              throw new Error('No active browser session');
            }
            const sendPage = session.page;
            const currentUrl = sendPage.url();
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
            await sendPage.waitForSelector(inputSelector, { timeout: 5000 });
            await sendPage.click(inputSelector);
            await sendPage.fill(inputSelector, message);
            
            // Wait a moment for the text to be entered
            await sendPage.waitForTimeout(500);
            
            // Click the submit button
            const buttonSelector = 'button[data-loading="false"].tw-bg-brand';
            await sendPage.click(buttonSelector);
            
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
              if (!session?.page) {
                throw new Error('No active browser session');
              }
              const progressPage = session.page;
              const progressData = await progressPage.evaluate(() => {
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
          
        case 'save_video':
          try {
            const { videoUrl, videoName, user } = data;
            const userFolder = `videos/${user}`;
            const videoPath = `${userFolder}/${videoName}`;
            
            // Create the user folder if it doesn't exist
            await fs.promises.mkdir(userFolder, { recursive: true });
            
            // Download the video
            const response = await fetch(videoUrl);
            const buffer = await response.arrayBuffer();
            const videoBuffer = Buffer.from(buffer);
            
            // Save the video to disk
            await fs.promises.writeFile(videoPath, videoBuffer);
            
            console.log(`📥 Saved video to ${videoPath}`);
            ws.send(JSON.stringify({ success: true, action: 'save_video', data: { videoPath } }));
          } catch (err) {
            console.error('❌ Error saving video:', err);
            ws.send(JSON.stringify({ success: false, action: 'save_video', error: err.message }));
          }
          break;
          // Add this new handler to proxy-server.js in the handleWebSocketMessage function

          case 'extract_all_video_urls':
            console.log('🎜 [extract_all_video_urls] Extracting video URLs from sidebar');
            try {
              if (!session?.page) {
                throw new Error('No active browser session');
              }
              const extractPage = session.page;
              const currentUrl = extractPage.url();
              if (!currentUrl.includes('/agent/')) {
                ws.send(JSON.stringify({ 
                  success: false, 
                  action: 'extract_all_video_urls',
                  error: 'Not on agent session page' 
                }));
                break;
              }

              // Wait for video elements to appear (sidebar might be opening)
              try {
                await extractPage.waitForSelector('video', { timeout: 3000 });
                await extractPage.waitForTimeout(3000); // Give it time to load src
              } catch (_) {
                console.log('⚠️ [extract_all_video_urls] No video elements found, sidebar might not be open');
              }

              // Extract video data from sidebar (same logic as initial_load)
              const extractedVideos = await extractPage.evaluate(() => {
                // Try specific selector first, then fall back to all videos
                let allVideos = document.querySelectorAll('video.css-uwwqev');
                if (allVideos.length === 0) {
                  console.log('[Browser] Specific selector found no videos, trying all video elements');
                  allVideos = document.querySelectorAll('video');
                }
                console.log(`[Browser] Found ${allVideos.length} video elements`);
                
                const validVideos = [];
                
                for (const vid of allVideos) {
                  const src = vid.src || vid.querySelector('source')?.src || vid.querySelector('source')?.getAttribute('src') || '';
                  console.log(`[Browser] Video src: ${src.substring(0, 80)}...`);
                  
                  // Only include valid resource2.heygen.ai URLs, skip loading animations
                  if (src && src.includes('resource2.heygen.ai') && !src.includes('liteSharePreviewAnimation')) {
                    const poster = vid.poster || '';
                    const titleEl = document.querySelector('.tw-text-base.tw-font-bold.tw-tracking-tight') ||
                                    document.querySelector('h2, h3');
                    const title = (titleEl?.innerText || titleEl?.textContent || '').trim() || 'Your video is ready!';
                    
                    validVideos.push({
                      videoUrl: src,
                      poster: poster,
                      title: title
                    });
                    console.log(`[Browser] ✅ Found valid video: ${title}`);
                  }
                }
                
                return validVideos;
              });

              console.log(`✅ [extract_all_video_urls] Successfully extracted ${extractedVideos.length} video URLs`);
              ws.send(JSON.stringify({ 
                success: true, 
                action: 'extract_all_video_urls',
                data: { videos: extractedVideos, totalFound: extractedVideos.length }
              }));

            } catch (err) {
              console.error('❌ [extract_all_video_urls] Error extracting video URLs:', err);
              ws.send(JSON.stringify({ 
                success: false, 
                action: 'extract_all_video_urls',
                error: err.message 
              }));
            }
            break;

          // Enhanced get_video_url handler (replaces existing one)
          case 'get_video_url':
            console.log('🎬 Getting video URL from most recent card');
            try {
              if (!session?.page) {
                throw new Error('No active browser session');
              }
              const videoPage = session.page;
              // Find all video cards
              const videoCards = await videoPage.$$('div.tw-border-brand.tw-bg-more-brandLighter');
              
              if (videoCards.length === 0) {
                ws.send(JSON.stringify({ 
                  success: false, 
                  action: 'get_video_url',
                  error: 'No video cards found' 
                }));
                break;
              }

              // Get the most recent video card (last one)
              const latestCard = videoCards[videoCards.length - 1];
              
              // Extract metadata before clicking
              const cardData = await latestCard.evaluate(card => {
                const thumbnailImg = card.querySelector('img[alt="draft thumbnail"]');
                const titleElement = card.querySelector('.tw-text-base.tw-font-bold.tw-tracking-tight');
                const subtitleElement = card.querySelector('.tw-text-sm.tw-font-medium.tw-text-textBody span');
                
                return {
                  thumbnail: thumbnailImg ? thumbnailImg.src : null,
                  title: titleElement ? titleElement.innerText.trim() : 'Your video is ready!',
                  subtitle: subtitleElement ? subtitleElement.innerText.trim() : ''
                };
              });

              // Click to open sidebar
              await latestCard.click();
              console.log('✅ Clicked latest video card');

              // Wait for video element
              await videoPage.waitForSelector('video', { timeout: 5000 });
              await videoPage.waitForTimeout(500);

              // Extract video data
              const videoData = await videoPage.evaluate(() => {
                const video = document.querySelector('video');
                if (!video) return null;

                return {
                  videoUrl: video.src || video.querySelector('source')?.src,
                  poster: video.poster
                };
              });

              // Close sidebar
              try {
                await videoPage.keyboard.press('Escape');
              } catch (_) {
                const closeButton = await videoPage.$('button[aria-label="Close"]');
                if (closeButton) await closeButton.click();
              }

              if (videoData && videoData.videoUrl) {
                // Persist the video on server under the authenticated user's directory
                try {
                  const baseUrl = process.env.RENDER_EXTERNAL_URL || `http://127.0.0.1:${PORT}`;
                  await axios.post(`${baseUrl}/proxy/save-video`, {
                    userEmail: ws.user?.email || 'unknown_user',
                    videoUrl: videoData.videoUrl,
                    title: cardData.title
                  });
                  console.log('✅ Video saved successfully');
                } catch (saveErr) {
                  console.error('❌ Error saving video from enhanced handler:', saveErr?.message || saveErr);
                }

                ws.send(JSON.stringify({ 
                  success: true, 
                  action: 'get_video_url',
                  data: {
                    ...cardData,
                    videoUrl: videoData.videoUrl,
                    poster: videoData.poster || cardData.thumbnail
                  }
                }));
              } else {
                ws.send(JSON.stringify({ 
                  success: false, 
                  action: 'get_video_url',
                  error: 'Video URL not found in sidebar' 
                }));
              }

            } catch (err) {
              console.error('❌ Error getting video URL:', err);
              ws.send(JSON.stringify({ 
                success: false, 
                action: 'get_video_url',
                error: err.message 
              }));
            }
            break;
        default:
          ws.send(JSON.stringify({ error: 'Unknown action' }));
      }
}

export { proxyRouter, initBrowser, setupWebSocketServer };

// API to list user's videos
proxyRouter.get('/api/videos', async (req, res) => {
  try {
    // Get user email from JWT token in cookie
    let userEmail = 'unknown_user';
    try {
      const cookieHeader = req.headers.cookie || '';
      const cookieMap = {};
      cookieHeader.split(';').forEach(c => {
        const [k, v] = c.split('=');
        if (k && v) cookieMap[k.trim()] = decodeURIComponent(v.trim());
      });
      const arenaToken = cookieMap['arena_token'];
      if (arenaToken) {
        const tokenData = verifyToken(arenaToken);
        if (tokenData && tokenData.email) {
          userEmail = tokenData.email;
        }
      }
    } catch (_) {}

    // Sanitize email for directory name
    const userDirName = userEmail.replace(/[@.]/g, '_');
    const userDir = path.join(UPLOADS_DIR, userDirName);

    // Check if directory exists
    if (!fs.existsSync(userDir)) {
      return res.json({ success: true, videos: [] });
    }

    // Read directory and get video files
    const files = fs.readdirSync(userDir);
    const videos = [];

    for (const file of files) {
      if (file.endsWith('.mp4')) {
        const filePath = path.join(userDir, file);
        const stats = fs.statSync(filePath);

        // Extract title from filename (remove hash and .mp4)
        const title = file
          .replace(/_[a-f0-9]{32}\.mp4$/i, '') // Remove hash and .mp4
          .replace(/[-_]+/g, ' ') // Replace underscores/hyphens with spaces
          .replace(/^\s+|\s+$/g, '') // Trim
          .replace(/\b\w/g, l => l.toUpperCase()); // Title case

        // Only include thumbnail if the file exists to avoid many 404s
        const thumbFile = file.replace(/\.mp4$/, '.jpg');
        const thumbPath = path.join(userDir, thumbFile);
        const hasThumb = fs.existsSync(thumbPath);

        videos.push({
          id: file,
          title: title || 'Untitled Video',
          url: `/proxy/uploads/${userDirName}/${file}`,
          thumbnail: hasThumb ? `/proxy/uploads/${userDirName}/${thumbFile}` : null,
          duration: 0,
          createdAt: stats.birthtime,
          size: stats.size
        });
      }
    }

    // Sort by creation date (newest first)
    videos.sort((a, b) => b.createdAt - a.createdAt);

    res.json({ success: true, videos });
  } catch (error) {
    console.error('Error listing videos:', error);
    res.status(500).json({ success: false, error: 'Failed to list videos' });
  }
});

// Add static file serving for uploads directory
proxyRouter.use('/uploads', express.static(UPLOADS_DIR));

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
  
  // Close all user sessions
  console.log(`🧹 Closing ${userSessions.size} user sessions...`);
  for (const [email, session] of userSessions) {
    try {
      await session.page.close();
      await session.context.close();
      console.log(`  ✅ Closed session for: ${email}`);
    } catch (err) {
      console.error(`  ❌ Error closing session for ${email}:`, err.message);
    }
  }
  userSessions.clear();
  
  // Close browser
  if (browser) await browser.close();
  console.log('✅ Browser closed');
  process.exit(0);
});

