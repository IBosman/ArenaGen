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
import * as chatStorage from './chat-storage.js';
import ffmpeg from 'fluent-ffmpeg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const COOKIES_FILE = path.join(__dirname, 'heygen-cookies.json');
const TARGET = 'https://app.heygen.com';
const AUTH_SECRET = process.env.AUTH_SECRET || 'dev-secret-change-me';



// Helper function to extract video title from HeyGen video URL
function extractVideoTitle(videoUrl) {
  try {
    const urlObj = new URL(videoUrl);
    const disposition = urlObj.searchParams.get('response-content-disposition');
    if (disposition) {
      // Parse filename from: attachment; filename*=UTF-8''HeyGen%3A%20Video.mp4;
      const filenameMatch = disposition.match(/filename\*?=(?:UTF-8'')?([^;]+)/i);
      if (filenameMatch) {
        let filename = filenameMatch[1];
        try { filename = decodeURIComponent(filename); } catch (_) {}
        return filename.replace(/\.mp4$/i, '').trim();
      }
    }
  } catch (_) {}
  return null;
}

// Helper function to merge video URLs into messages
function mergeVideoUrls(messages, videoUrls) {
  if (!videoUrls || videoUrls.length === 0) return messages;
  if (!messages || !Array.isArray(messages)) return [];
  
  // Make a copy of videoUrls to avoid modifying the original
  const availableVideos = [...videoUrls];
  
  // First, attach videos to messages that already have video placeholders
  const result = messages.map(msg => {
    if (msg.video && !msg.video.videoUrl) {
      // Try to find a matching video by poster or title
      const matchIndex = availableVideos.findIndex(v => 
        v.poster === msg.video.poster || 
        v.poster === msg.video.thumbnail ||
        v.title === msg.video.title
      );
      
      if (matchIndex !== -1) {
        const matchedVideo = availableVideos[matchIndex];
        availableVideos.splice(matchIndex, 1); // Remove used video
        
        return {
          ...msg,
          video: {
            ...msg.video,
            videoUrl: matchedVideo.videoUrl,
            poster: matchedVideo.poster || msg.video.poster
          }
        };
      }
    }
    return msg;
  });
  
  // If we have any videos left, add them as separate messages
  if (availableVideos.length > 0) {
    console.log(`➕ Adding ${availableVideos.length} video-only messages`);
    availableVideos.forEach(video => {
      result.push({
        role: 'assistant',
        text: video.title || 'Your video is ready!',
        timestamp: new Date().toISOString(),
        video: {
          videoUrl: video.videoUrl,
          poster: video.poster,
          title: video.title || 'Your video is ready!'
        }
      });
    });
  }
  
  return result;
}

// WebSocket message handler with chat saving functionality
const originalHandleWebSocketMessage = handleWebSocketMessage;
handleWebSocketMessage = async (ws, data, session = null) => {
  try {
    await originalHandleWebSocketMessage(ws, data, session);
    
    // Save after get_video_url to attach video URLs to messages
    if (data.action === 'get_video_url' && session?.page) {
      const extractedMessages = session.page._extractedMessages;
      const videoUrls = session.page._videoUrls || [];
      
      console.log('🎬 [handleWebSocketMessage] Processing get_video_url response', {
        hasSession: !!session,
        hasPage: !!session?.page,
        hasExtractedMessages: !!extractedMessages,
        messageCount: extractedMessages?.length || 0,
        videoUrlCount: videoUrls.length
      });
      
      if (extractedMessages && Array.isArray(extractedMessages) && extractedMessages.length > 0 && videoUrls.length > 0) {
        // Find the most recent video URL
        const latestVideo = videoUrls[videoUrls.length - 1];
        console.log('🎥 Latest video:', latestVideo);
        
        // ONLY update messages that already have a video placeholder (from get_messages)
        // Do NOT attach videos to random assistant messages
        let updated = false;
        for (let i = extractedMessages.length - 1; i >= 0; i--) {
          const msg = extractedMessages[i];
          // Only update if message already has a video object but no videoUrl
          if (msg.role === 'agent' && msg.video && !msg.video.videoUrl) {
            // Update the existing video placeholder with the URL
            extractedMessages[i] = {
              ...msg,
              video: {
                ...msg.video, // Keep existing thumbnail/poster/title from get_messages
                videoUrl: latestVideo.videoUrl,
                poster: latestVideo.poster || msg.video.poster || latestVideo.thumbnail || '',
                title: latestVideo.title || msg.video.title || 'Your video is ready!'
              }
            };
            console.log(`✅ Updated video URL for message ${i}: "${msg.text?.substring(0, 50)}..."`);
            updated = true;
            break;
          }
        }
        
        if (updated) {
          const chatId = session.page._chatId || `chat_${Date.now()}`;
          const userEmail = ws.user?.email || 'anonymous';
          console.log(`💾 [handleWebSocketMessage] Updating chat ${chatId} with video URL for user ${userEmail}`);
          
          try {
            await chatStorage.updateChat(chatId, extractedMessages, userEmail);
            console.log(`✅ [handleWebSocketMessage] Successfully updated chat with video URL`);
            
            if (session?.page) {
              session.page._chatId = chatId;
              // Update the stored messages
              session.page._extractedMessages = extractedMessages;
            }
          } catch (error) {
            console.error('❌ [handleWebSocketMessage] Error updating chat with video:', error.message);
          }
        } else {
          console.log('⚠️ No agent message with video placeholder found to update');
        }
      }
    }
    
    // Note: We don't auto-save after get_messages anymore
    // The frontend handles saving via explicit save_chat actions
    // This prevents overwriting chat history when loading old chats
    
  } catch (error) {
    console.error('❌ [handleWebSocketMessage] Error in message handler:', error.message);
    // Don't rethrow - let the WebSocket continue working
  }
};

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

// Helper function to extract sessionKey from request cookies
function getSessionKeyFromRequest(req) {
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
        // Create unique session key using email:sessionId format
        const sessionKey = tokenData.sessionId 
          ? `${tokenData.email}:${tokenData.sessionId}`
          : tokenData.email; // Fallback for old tokens without sessionId
        return { sessionKey, email: tokenData.email, sessionId: tokenData.sessionId };
      }
    }
  } catch (_) {}
  return { sessionKey: 'anonymous', email: 'anonymous', sessionId: null };
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
  const loadFromHistory = req.query.loadFromHistory === 'true';
  
  if (!sessionId) {
    return res.status(400).json({ success: false, error: 'sessionId is required' });
  }
  if (!browser) {
    return res.status(503).json({ success: false, error: 'Browser not initialized' });
  }
  
  // Extract sessionKey from JWT token in cookie (HTTP endpoint)
  const { sessionKey, email: userEmail } = getSessionKeyFromRequest(req);
  
  const relativeUrl = `/agent/${sessionId}`;
  const targetUrl = TARGET + relativeUrl;
  
  if (loadFromHistory) {
    console.log(`📚 [HTTP] Loading chat from history (no navigation): ${sessionId} for user: ${userEmail} (session: ${sessionKey})`);
  } else {
    console.log(`🌐 [HTTP] /generate endpoint called for session: ${sessionId} for user: ${userEmail}`);
  }
  
  try {
    // If user is authenticated and we have an anonymous session, migrate it
    if (sessionKey !== 'anonymous' && userSessions.has('anonymous') && !userSessions.has(sessionKey)) {
      const anonSession = userSessions.get('anonymous');
      console.log(`🔄 Migrating anonymous session to: ${sessionKey}`);
      userSessions.set(sessionKey, anonSession);
      anonSession.userEmail = sessionKey;
      userSessions.delete('anonymous');
    }
    
    // Check if session already exists
    let session = userSessions.get(sessionKey);
    const sessionExists = !!session;
    
    if (!session) {
      // Only create new session if one doesn't exist
      console.log(`🆕 Creating new session for user: ${userEmail} (session: ${sessionKey})`);
      session = await getUserSession(sessionKey);
    } else {
      console.log(`♻️  Session already exists for: ${sessionKey}`);
    }
    
    const { page } = session;
    const current = page.url();
    
    // CRITICAL FIX: Only navigate if session was just created OR if on wrong page
    // Don't navigate if session already existed (likely from /submit-prompt)
    if (!sessionExists && !loadFromHistory) {
      // New session - navigate to the target URL
      if (current !== targetUrl) {
        console.log(`🌐 Navigating new session to: ${targetUrl}`);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 300000 });
      } else {
        console.log('➡️  Already on target session URL');
      }
    } else if (sessionExists) {
      console.log(`✅ Session exists, skipping navigation (current: ${current})`);
    } else {
      console.log(`📝 Loading from history, no navigation needed (current: ${current})`);
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
      writer.on('finish', async () => {
        console.log(`✅ Video saved: ${filePath}`);
        
        // Generate thumbnail using fluent-ffmpeg
        const thumbnailPath = filePath.replace('.mp4', '-thumbnail.jpg');
        try {
          console.log(`🖼️ Generating thumbnail: ${thumbnailPath}`);
          
          // Use fluent-ffmpeg to extract first frame at 0.1 seconds
          await new Promise((resolve, reject) => {
            ffmpeg(filePath)
              .screenshots({
                timestamps: ['0.1'],
                filename: path.basename(thumbnailPath),
                folder: path.dirname(thumbnailPath),
                size: '?x1080' // Maintain aspect ratio, max height 1080px
              })
              .on('end', () => {
                console.log(`✅ Thumbnail generated: ${thumbnailPath}`);
                resolve();
              })
              .on('error', (err) => {
                console.error('⚠️ FFmpeg error:', err.message);
                reject(err);
              });
          });
          
          res.json({ 
            success: true, 
            message: 'Video and thumbnail saved successfully', 
            path: filePath,
            filename,
            thumbnailPath,
            thumbnailFilename: path.basename(thumbnailPath),
            isDuplicate: false
          });
        } catch (ffmpegError) {
          console.error('⚠️ Failed to generate thumbnail:', ffmpegError.message);
          // Still return success for video, just note thumbnail failed
          res.json({ 
            success: true, 
            message: 'Video saved successfully (thumbnail generation failed)', 
            path: filePath,
            filename,
            thumbnailError: ffmpegError.message,
            isDuplicate: false
          });
        }
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
    ws.user = { email: 'anonymous', sessionKey: 'anonymous' };
    ws.sessionId = null;
    ws.isAlive = true;
    
    // Extract user email and sessionId from arena_token cookie
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
        // Create unique session key using email:sessionId format
        const sessionKey = tokenData.sessionId 
          ? `${tokenData.email}:${tokenData.sessionId}`
          : tokenData.email; // Fallback for old tokens without sessionId
        ws.user = { 
          email: tokenData.email, 
          sessionKey: sessionKey,
          sessionId: tokenData.sessionId || null
        };
        console.log('👤 User authenticated via token:', tokenData.email);
        console.log('🔑 Session key:', sessionKey);
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
        if (ws.user?.sessionKey && ws.user.sessionKey !== 'anonymous' && !session) {
          userSession = await getUserSession(ws.user.sessionKey);
          console.log(`🔄 Created new session for: ${ws.user.sessionKey}`);
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
        if (ws.user?.sessionKey && ws.user.sessionKey !== 'anonymous') {
          // If we don't have a session yet, try to get or create one
          if (!userSession) {
            // Check if session already exists (from HTTP endpoint)
            console.log(`🔍 Checking for existing session for: ${ws.user.sessionKey}`);
            console.log(`   Available sessions:`, Array.from(userSessions.keys()));
            
            // CRITICAL: Check if we need to migrate anonymous session to authenticated user
            if (ws.user.sessionKey !== 'anonymous' && userSessions.has('anonymous') && !userSessions.has(ws.user.sessionKey)) {
              const anonSession = userSessions.get('anonymous');
              console.log(`🔄 Migrating anonymous session to authenticated user: ${ws.user.sessionKey}`);
              console.log(`   Anonymous session HeyGen ID: ${anonSession.heygenSessionId || 'none'}`);
              userSessions.set(ws.user.sessionKey, anonSession);
              anonSession.userEmail = ws.user.sessionKey;
              userSessions.delete('anonymous');
              userSession = anonSession;
              console.log(`✅ Migration complete. Available sessions:`, Array.from(userSessions.keys()));
              // Add to queue with the migrated session
              messageQueue.push({ message, session: userSession });
              if (!isProcessing) processQueue();
              return;
            }
            
            const existingSession = userSessions.get(ws.user.sessionKey);
            if (existingSession) {
              userSession = existingSession;
              console.log(`🔄 Reusing existing session from HTTP endpoint for: ${ws.user.sessionKey}`);
              console.log(`   Current HeyGen session: ${existingSession.heygenSessionId || 'none'}`);
              // Add to queue with the existing session
              messageQueue.push({ message, session: userSession });
              if (!isProcessing) processQueue();
              return;
            } else {
              console.log(`❌ No existing session found for: ${ws.user.sessionKey}`);
            }
            
            // No existing session - check if we really need to create one
            // Parse the message to see if it's a navigation request
            try {
              const parsedData = JSON.parse(message.toString());
              if (parsedData.action === 'navigate' && parsedData.url) {
                console.log(`⚠️  WebSocket wants to navigate but no session exists yet for: ${ws.user.sessionKey}`);
                console.log(`   This might be a race condition - session may be created by HTTP endpoint`);
                // Wait a bit and check again
                setTimeout(() => {
                  const retrySession = userSessions.get(ws.user.sessionKey);
                  if (retrySession) {
                    console.log(`✅ Found session after retry for: ${ws.user.sessionKey}`);
                    messageQueue.push({ message, session: retrySession });
                    if (!isProcessing) processQueue();
                  } else {
                    console.log(`⚠️  Still no session after retry, creating new one`);
                    getUserSession(ws.user.sessionKey).then(session => {
                      userSession = session;
                      console.log(`🔄 Created new session for: ${ws.user.sessionKey}`);
                      messageQueue.push({ message, session: userSession });
                      if (!isProcessing) processQueue();
                    }).catch(error => {
                      console.error(`❌ Failed to create session for ${ws.user.sessionKey}:`, error);
                      if (ws.readyState === ws.OPEN) {
                        ws.send(JSON.stringify({
                          success: false,
                          action: 'error',
                          error: 'Failed to create browser session'
                        }));
                      }
                    });
                  }
                }, 1000);
                return;
              }
            } catch (e) {
              // Not JSON or parsing failed, proceed with normal flow
            }
            
            // No existing session, create a new one
            getUserSession(ws.user.sessionKey).then(session => {
              userSession = session;
              console.log(`🔄 Created new session for: ${ws.user.sessionKey}`);
              // Add to queue with the new session
              messageQueue.push({ message, session: userSession });
              if (!isProcessing) processQueue();
            }).catch(error => {
              console.error(`❌ Failed to create session for ${ws.user.sessionKey}:`, error);
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
// Per-user browser contexts: Map<sessionKey, {context, page, userEmail, lastActivity}>
// sessionKey format: "email:sessionId" for authenticated users, "anonymous" for unauthenticated
const userSessions = new Map();
// Track sessions being created to prevent race conditions
const pendingSessions = new Map();

// Helper function to load user cookies (for now, uses shared cookies)
async function loadUserCookies(sessionKey) {
  let cookies = [];
  if (fs.existsSync(COOKIES_FILE)) {
    try {
      const cookieData = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
      cookies = Array.isArray(cookieData) ? cookieData : (cookieData.cookies || []);
      console.log(`✅ Loaded cookies for session: ${sessionKey}`);
    } catch (err) {
      console.warn(`⚠️  Could not parse cookies for ${sessionKey}:`, err.message);
    }
  }
  return cookies;
}

// Browser context options (shared across all contexts)
const BROWSER_CONTEXT_OPTIONS = {
  viewport: { width: 1920, height: 1080 },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.5993.90 Safari/537.36',
  locale: 'en-US',
  timezoneId: 'America/New_York',
  permissions: ['clipboard-read', 'clipboard-write'],
  bypassCSP: true,
  ignoreHTTPSErrors: true
};

// Get or create user session with isolated context
// sessionKey format: "email:sessionId" for authenticated users, "anonymous" for unauthenticated
async function getUserSession(sessionKey) {
  if (!sessionKey) {
    sessionKey = 'anonymous';
  }

  // Return existing session if available
  if (userSessions.has(sessionKey)) {
    const session = userSessions.get(sessionKey);
    session.lastActivity = Date.now();
    console.log(`♻️  Reusing existing session for: ${sessionKey}`);
    console.log(`   Session created at: ${session.createdAt}`);
    console.log(`   Current HeyGen session: ${session.heygenSessionId || 'none'}`);
    console.log(`   Called from: ${new Error().stack.split('\n')[2].trim()}`);
    return session;
  }

  // If session is being created, wait for it to complete
  if (pendingSessions.has(sessionKey)) {
    console.log(`⏳ Waiting for pending session creation for: ${sessionKey}`);
    return pendingSessions.get(sessionKey);
  }

  // Create new context for this user
  console.log(`🆕 Creating new browser context for: ${sessionKey}`);
  
  // Create a promise for this session creation
  const sessionPromise = (async () => {
  
  if (!browser) {
    throw new Error('Browser not initialized');
  }

  const cookies = await loadUserCookies(sessionKey);
  
  const context = await browser.newContext({
    ...BROWSER_CONTEXT_OPTIONS,
    storageState: {
      cookies: cookies,
      origins: []
    }
  });

  const page = await context.newPage();
  
  // Navigate to HeyGen home to initialize
  try {
    await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log(`✅ Initialized page for: ${sessionKey}`);
  } catch (navError) {
    console.warn(`⚠️  Could not navigate to HeyGen home for ${sessionKey}:`, navError.message);
  }

  const session = {
    context,
    page,
    userEmail: sessionKey, // Store sessionKey as userEmail for backward compatibility
    heygenSessionId: null, // Track which HeyGen session this context is viewing
    lastActivity: Date.now(),
    createdAt: new Date().toISOString(),
    createdBy: (new Error().stack?.split('\n')[2] || 'unknown').trim(), // Track where session was created
    avatarBoxPollingInterval: null // Store polling interval for avatar box removal
  };

    userSessions.set(sessionKey, session);
    console.log(`✅ Created new session for: ${sessionKey} (Total sessions: ${userSessions.size})`);
    console.log(`   Created by: ${session.createdBy}`);
    console.log(`   All sessions:`, Array.from(userSessions.keys()));
    
    return session;
  })();
  
  // Store the promise so other requests can wait for it
  pendingSessions.set(sessionKey, sessionPromise);
  
  try {
    const session = await sessionPromise;
    // Remove from pending and return the session
    pendingSessions.delete(sessionKey);
    return session;
  } catch (error) {
    // Remove from pending on error
    pendingSessions.delete(sessionKey);
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
      stopAvatarBoxPolling(session);
      await session.page.close();
      await session.context.close();
      userSessions.delete(email);
      console.log(`🧹 Cleaned up inactive session for: ${email}`);
    } catch (err) {
      console.error(`❌ Error cleaning up session for ${email}:`, err);
    }
  }
}

// Helper function to poll for and remove avatar selection box on HeyGen homepage
async function startAvatarBoxPolling(session) {
  if (!session || !session.page) {
    console.warn('⚠️  Cannot start avatar box polling: no session or page');
    return;
  }
  
  // Stop existing polling if any
  if (session.avatarBoxPollingInterval) {
    clearInterval(session.avatarBoxPollingInterval);
    session.avatarBoxPollingInterval = null;
  }
  
  console.log('🔄 Starting avatar box polling for:', session.userEmail);
  
  session.avatarBoxPollingInterval = setInterval(async () => {
    try {
      const page = session.page;
      if (!page || page.isClosed()) {
        stopAvatarBoxPolling(session);
        return;
      }
      
      // Check if we're on the homepage
      const currentUrl = page.url();
      if (!currentUrl.includes('app.heygen.com/home')) {
        // Not on homepage, stop polling
        stopAvatarBoxPolling(session);
        return;
      }
      
      // Look for the close button on the avatar selection box
      // The button contains an iconpark-icon with name="close" and has specific positioning classes
      // IMPORTANT: Must also check for "Avatar" text to avoid closing attached images
      const closeButtonClicked = await page.evaluate(() => {
        // Find all buttons with the close icon
        const closeIcons = document.querySelectorAll('iconpark-icon[name="close"][theme="filled"]');
        
        for (const icon of closeIcons) {
          const button = icon.closest('button');
          if (button) {
            // Check if this button has the avatar box positioning classes
            const classes = button.className;
            if (classes.includes('tw-absolute') && 
                classes.includes('-tw-right-2') && 
                classes.includes('-tw-top-2') &&
                classes.includes('tw-h-[24px]') &&
                classes.includes('tw-w-[24px]')) {
              
              // Check if the parent container has "Avatar" text
              const container = button.closest('.tw-group');
              if (container) {
                const avatarLabel = container.querySelector('.tw-text-xs.tw-text-textSupport');
                if (avatarLabel && avatarLabel.textContent.trim() === 'Avatar') {
                  // This is the avatar box close button
                  button.click();
                  return true;
                }
              }
            }
          }
        }
        return false;
      });
      
      if (closeButtonClicked) {
        console.log('✅ Avatar box close button clicked');
      }
    } catch (error) {
      // Silently ignore errors - page might be navigating or closed
      if (!error.message.includes('closed') && !error.message.includes('detached')) {
        console.warn('⚠️  Avatar box polling error:', error.message);
      }
    }
  }, 500); // Poll every 0.5 seconds
}

// Helper function to stop avatar box polling
function stopAvatarBoxPolling(session) {
  if (session && session.avatarBoxPollingInterval) {
    clearInterval(session.avatarBoxPollingInterval);
    session.avatarBoxPollingInterval = null;
    console.log('🛑 Stopped avatar box polling for:', session.userEmail);
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
    headless: false,
    args: [
      // '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage'
      // '--disable-gpu',
      // '--disable-software-rasterizer',
      // '--disable-background-timer-throttling',
      // '--disable-renderer-backgrounding',
      // '--disable-backgrounding-occluded-windows',
      // '--disable-extensions',
      // '--blink-settings=imagesEnabled=false',
      // '--disable-web-security',
      // '--disable-features=IsolateOrigins,site-per-process',
      // '--disable-site-isolation-trials',
      // '--disable-features=BlockInsecurePrivateNetworkRequests',
      // '--disable-features=SameSiteByDefaultCookies,CookiesWithoutSameSiteMustBeSecure',
      // '--disable-blink-features=AutomationControlled',
      // '--disable-features=AutomationControlled',
      // '--disable-blink-features=AutomationControlled',
      // '--disable-blink-features=AutomationControlled'  // Duplicated on purpose
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
        stopAvatarBoxPolling(session);
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

// Old endpoint removed - using new chatStorage-based endpoint below


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
  
  // Extract sessionKey from JWT token in cookie
  const { sessionKey, email: userEmail } = getSessionKeyFromRequest(req);
  
  const relativeUrl = `/agent/${sessionId}`;
  const targetUrl = TARGET + relativeUrl;
  console.log(`🌐 [HTTP] Navigating to agent session: ${targetUrl} for user: ${userEmail} (session: ${sessionKey})`);
  try {
    // Check if session already exists (from WebSocket)
    let session = userSessions.get(sessionKey);
    if (!session) {
      // Only create new session if one doesn't exist
      session = await getUserSession(sessionKey);
    } else {
      console.log(`♻️  Reusing existing session for: ${sessionKey}`);
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
  const referer = req.headers.referer || '';
  const isFromHomePage = referer.includes('/home');
  
  if (!prompt) {
    return res.json({ success: false, error: 'Prompt is required' });
  }
  
  console.log(`📝 Received submit-prompt request: ${prompt}${isFromHomePage ? ' (from home page)' : ''}`);
  
  try {
    if (!browser) {
      return res.json({ success: false, error: 'Browser not initialized' });
    }
    
    // Extract sessionKey from JWT token in cookie
    const { sessionKey, email: userEmail } = getSessionKeyFromRequest(req);
    console.log(`🔑 Authenticated user: ${userEmail} (session: ${sessionKey})`);
    
    console.log(`👤 Submitting prompt for user: ${userEmail} (session: ${sessionKey})`);
    
    // Check if session already exists (from file upload or WebSocket)
    let session = userSessions.get(sessionKey);
    if (session) {
      console.log(`♻️  Reusing existing session for: ${sessionKey}`);
    } else {
      // If user is authenticated and we have an anonymous session, migrate it
      if (sessionKey !== 'anonymous' && userSessions.has('anonymous') && !userSessions.has(sessionKey)) {
        const anonSession = userSessions.get('anonymous');
        console.log(`🔄 Migrating anonymous session to: ${sessionKey}`);
        userSessions.set(sessionKey, anonSession);
        anonSession.userEmail = sessionKey;
        userSessions.delete('anonymous');
        session = anonSession;
      } else {
        // Only create new session if one doesn't exist
        session = await getUserSession(sessionKey);
      }
    }
    const { page: submitPage } = session;
    
    // Navigate to home page if needed
    const currentUrl = submitPage.url();
    const isOnHome = currentUrl.includes('app.heygen.com/home');
    const isOnAgent = currentUrl.includes('app.heygen.com/agent/');
    
    // CRITICAL FIX: If user is on /home in frontend, ALWAYS navigate to HeyGen home
    // This ensures "New Chat" works correctly even if Playwright is on an agent page
    const shouldNavigateToHome = isFromHomePage || (!isOnHome && !isOnAgent);
    
    if (shouldNavigateToHome && !isOnHome) {
      console.log(`🌐 Navigating to home...${isFromHomePage ? ' (user clicked New Chat)' : ''}`);
      try {
        await submitPage.goto('https://app.heygen.com/home', { 
          waitUntil: 'domcontentloaded',
          timeout: 30000 
        });
        // Wait for the textarea to be visible (ensures page is fully loaded)
        console.log('⏳ Waiting for page to be fully loaded...');
        await submitPage.waitForSelector('textarea.tw-resize-none', { state: 'visible', timeout: 30000 });
        console.log('✅ Page fully loaded');
        // Start avatar box polling after page is ready
        startAvatarBoxPolling(session);
      } catch (navError) {
        console.warn('⚠️  Navigation error (likely not authenticated):', navError.message);
        return res.json({ 
          success: false, 
          error: 'Not authenticated. Please login first at http://localhost:3000/auth to create session cookies.' 
        });
      }
    } else if (isOnHome) {
      console.log('✅ Already on home page - keeping attached files');
      // Start avatar box polling since we're on home
      startAvatarBoxPolling(session);
    } else if (isOnAgent && !isFromHomePage) {
      console.log('✅ Already on agent page - submitting prompt here');
    }
    
    
    // Wait for input field to be ready (should already be visible from navigation check)
    console.log('⏳ Waiting for input field...');
    // HeyGen changed to textarea element
    const inputSelector = 'textarea.tw-resize-none';
    await submitPage.waitForSelector(inputSelector, { state: 'visible', timeout: 10000 });
    
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

    // Stop avatar box polling before navigation
    stopAvatarBoxPolling(session);
    console.log('🛑 Stopped avatar box polling before navigation');

    // Wait for navigation to agent session
    console.log('⏳ Waiting for session page...');
    await submitPage.waitForURL(/\/agent\/.*/, { timeout: 300000 });
    
    const sessionUrl = submitPage.url();
    const sessionPath = sessionUrl.replace('https://app.heygen.com', '');
    console.log('📍 Session URL:', sessionUrl);
    
    // Extract and store HeyGen session ID
    const heygenSessionMatch = sessionUrl.match(/\/agent\/([^/?]+)/);
    if (heygenSessionMatch) {
      session.heygenSessionId = heygenSessionMatch[1];
      console.log(`🔖 Stored HeyGen session ID: ${session.heygenSessionId} for user: ${userEmail}`);
    }
    
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
    
    // Extract sessionKey from JWT token in cookie
    const { sessionKey, email: userEmail } = getSessionKeyFromRequest(req);
    
    console.log(`📤 [HTTP] Upload files for user: ${userEmail} (session: ${sessionKey})`);
    
    // Check if session already exists
    let session = userSessions.get(sessionKey);
    if (!session) {
      session = await getUserSession(sessionKey);
    } else {
      console.log(`♻️  Reusing existing session for: ${sessionKey}`);
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
    
    // Start avatar box polling
    startAvatarBoxPolling(session);
    
    // Wait for the chat input to be ready
    console.log('⏳ Waiting for page to be ready...');
    await uploadFilesPage.waitForSelector('textarea.tw-resize-none', { state: 'visible', timeout: 10000 });
    
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
        
        // Trigger multiple events to ensure HeyGen's handlers are called
        fileInput.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        fileInput.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        fileInput.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
        
        // Also try dispatching a custom event that some frameworks use
        const customEvent = new CustomEvent('fileInputChange', { detail: { files: fileInput.files }, bubbles: true });
        fileInput.dispatchEvent(customEvent);
        
        console.log('✅ [Browser] Events triggered (change, input, click, custom)');
        
        // Wait a bit for handlers to process
        await new Promise(resolve => setTimeout(resolve, 500));
        
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
      // Wait for any file processing to complete
      await uploadFilesPage.waitForTimeout(3000); // Give it some time to process
      
      // Check if there's an upload error
      const hasError = await uploadFilesPage.evaluate(() => {
        return Array.from(document.querySelectorAll('*')).some(el => {
          const text = el.textContent || '';
          return text.includes('error') || text.includes('failed') || text.includes('invalid');
        });
      });
      
      if (hasError) {
        console.warn('⚠️  Possible upload error detected, checking for error messages...');
        const errorText = await uploadFilesPage.evaluate(() => {
          return Array.from(document.querySelectorAll('*'))
            .map(el => el.textContent?.trim())
            .filter(t => t && (t.includes('error') || t.includes('failed') || t.includes('invalid')))
            .join('\n');
        });
        console.log('⚠️  Error details:', errorText || 'No specific error message found');
      }
      
      // Check for successful upload by looking for the file name in the DOM
      const fileName = fileData[0].name.split('.')[0]; // Get filename without extension
      const fileNameFound = await uploadFilesPage.evaluate((name) => {
        return Array.from(document.querySelectorAll('*')).some(el => {
          const text = el.textContent || '';
          return text.includes(name);
        });
      }, fileName);
      
      if (!fileNameFound) {
        console.warn(`⚠️  Could not find file name '${fileName}' in the page, but continuing anyway`);
      } else {
        console.log(`✅ Found file name '${fileName}' in the page`);
      }
      
      // Check for any image elements that might be our upload
      const uploadedImage = await uploadFilesPage.evaluate(() => {
        const images = Array.from(document.querySelectorAll('img'));
        return images.map(img => ({
          src: img.src || img.getAttribute('src') || 'no-src',
          alt: img.alt || 'no-alt',
          className: img.className || 'no-class',
          parentHtml: img.parentElement ? img.parentElement.outerHTML.substring(0, 200) : 'no-parent'
        }));
      });
      
      console.log('ℹ️  Found images on page:', JSON.stringify(uploadedImage, null, 2));
      
      // If we get here, assume the upload was successful even if we couldn't verify the image
      console.log('✅ Assuming file upload was successful based on browser console logs');
      
    } catch (waitError) {
      console.warn('⚠️  Could not verify image attachment:', waitError.message);
      console.log('⏳ Waiting additional time for processing...');
      await uploadFilesPage.waitForTimeout(5000); // Increased from 3000 to 5000
      
      // Take a screenshot to help with debugging
      try {
        const screenshotPath = `/tmp/upload-error-${Date.now()}.png`;
        await uploadFilesPage.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`ℹ️  Error screenshot saved to: ${screenshotPath}`);
      } catch (screenshotError) {
        console.warn('⚠️  Could not take screenshot:', screenshotError.message);
      }
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
    
    // Extract sessionKey from JWT token in cookie
    const { sessionKey, email: userEmail } = getSessionKeyFromRequest(req);
    
    console.log(`📤 [HTTP] Upload files and generate for user: ${userEmail} (session: ${sessionKey})`);
    
    // Check if session already exists
    let session = userSessions.get(sessionKey);
    if (!session) {
      session = await getUserSession(sessionKey);
    } else {
      console.log(`♻️  Reusing existing session for: ${sessionKey}`);
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
    await uploadGenPage.waitForSelector('textarea.tw-resize-none', { state: 'visible', timeout: 10000 });
    
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
      // Block all navigations to agent URLs, regardless of source
      if (data.url && (data.url.includes('/agent/') || data.url.includes('heygen.com/agent'))) {
        console.log('⏩ BLOCKED navigation to agent URL:', data.url);
        console.log('   - loadFromHistory flag:', data.loadFromHistory || 'not set');
        console.log('   - Navigation source:', new Error().stack.split('\n')[2].trim());
        
        // Send a success response without actually navigating
        ws.send(JSON.stringify({ 
          action: 'navigate', 
          status: 'success',
          url: data.url,
          blocked: true,
          message: 'Navigation to agent URL blocked',
          timestamp: new Date().toISOString()
        }));
        return;
      }
      
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
              document.querySelectorAll('div.tw-flex.tw-justify-end, div.tw-flex.tw-justify-start, div.tw-border-brand.tw-bg-more-brandLighter, textarea, [contenteditable="true"]')
            );
            
            const allMessages = [];
            
            for (const row of allElements) {
              try {
                // Handle video cards
                if (row.classList.contains('tw-border-brand') && row.classList.contains('tw-bg-more-brandLighter')) {
                  const videoElement = row.querySelector('video');
                  if (videoElement) {
                    const videoPoster = videoElement.poster;
                    const titleElement = row.querySelector('.tw-text-base.tw-font-bold.tw-tracking-tight');
                    const subtitleElement = row.querySelector('.tw-text-sm.tw-font-medium.tw-text-textBody span');
                    const title = titleElement ? titleElement.innerText.trim() : 'Your video is ready!';
                    
                    allMessages.push({
                      role: 'agent',
                      text: subtitleElement ? subtitleElement.innerText.trim() : '',
                      video: {
                        thumbnail: videoPoster,
                        videoUrl: null,
                        poster: videoPoster,
                        title: title
                      },
                      timestamp: new Date().toISOString()
                    });
                  }
                  continue;
                }
                
                // Handle user input (textareas and contenteditables)
                if (row.tagName === 'TEXTAREA' || row.getAttribute('contenteditable') === 'true') {
                  const text = row.value || row.textContent || '';
                  if (text.trim()) {
                    allMessages.push({
                      role: 'user',
                      text: text.trim(),
                      timestamp: new Date().toISOString()
                    });
                  }
                  continue;
                }
                
                // Regular chat messages
                const isUser = row.classList.contains('tw-justify-end');
                
                if (isUser) {
                  // Check for user input in various possible locations
                  const userInput = row.querySelector('textarea, [contenteditable="true"], .tw-bg-fill-block, .tw-prose');
                  let text = '';
                  
                  if (userInput) {
                    text = userInput.value || userInput.textContent || '';
                    text = text.trim();
                  }
                  
                  if (text) {
                    allMessages.push({
                      role: 'user',
                      text: text,
                      timestamp: new Date().toISOString()
                    });
                  }
                }

                  // agent - get main reply, skip reasoning. Use robust selector set and fallbacks.
                if (!isUser) {
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
                  
                  if (text) {
                    allMessages.push({
                      role: 'agent',
                      text: text,
                      timestamp: new Date().toISOString()
                    });
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
                  
              } catch (err) {
                console.error('Error processing message row:', err);
              }
            }
            
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
          
          
        case 'back':
          console.log('⬅️ Going back');
          if (!session?.page) {
            throw new Error('No active browser session');
          }
          await session.page.goBack();
          ws.send(JSON.stringify({ success: true }));
          break;
          
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
          console.log('👤 [get_messages] Session user:', session?.userEmail || 'unknown');
          console.log('🔑 [get_messages] WebSocket user:', ws.user?.email || 'unknown');
          let fetchedMessages = null;
          try {
            if (!session?.page) {
              throw new Error('No active browser session');
            }
            const page = session.page;
            const currentUrl = page.url();
            console.log('🌐 [get_messages] Current URL:', currentUrl);
            
            // First, get the latest video URL from the page (similar to get_video_url)
            let videoData = null;
            try {
              // Look for any video element on the page
              videoData = await page.evaluate(() => {
                const video = document.querySelector('video');
                if (!video) return null;
                
                const src = video.src || video.querySelector('source')?.src || '';
                if (!src || !src.includes('resource2.heygen.ai') || src.includes('liteSharePreviewAnimation')) {
                  return null;
                }
                
                // Try to get title from nearby elements
                const titleEl = document.querySelector('.tw-text-base.tw-font-bold.tw-tracking-tight, h3, h4') ||
                              video.closest('[data-testid="message"]')?.querySelector('h3, h4, .tw-font-bold');
                
                return {
                  videoUrl: src,
                  poster: video.poster || '',
                  title: titleEl?.textContent?.trim() || 'Your video is ready!'
                };
              });
              
              if (videoData) {
                console.log('🎥 [get_messages] Found video on page:', videoData.videoUrl);
              } else {
                console.log('🔍 [get_messages] No video found on page');
              }
            } catch (videoErr) {
              console.error('❌ [get_messages] Error checking for video:', videoErr);
            }
            
            // Get all messages
            fetchedMessages = await page.evaluate(() => {
              const messages = [];
              const messageElements = document.querySelectorAll('div.tw-flex.tw-justify-end, div.tw-flex.tw-justify-start, div.tw-border-brand.tw-bg-more-brandLighter');
              
              messageElements.forEach(el => {
                const isUser = el.classList.contains('tw-justify-end');
                const textEl = el.querySelector('div.tw-prose, div.tw-text-textTitle div.tw-prose, [data-testid="message-text"]');
                let text = textEl ? (textEl.textContent || '').trim() : '';
                
                // For user messages, also check input fields
                if (isUser && !text) {
                  const inputEl = el.querySelector('textarea, input[type="text"], [contenteditable="true"]');
                  if (inputEl) {
                    text = (inputEl.value || inputEl.textContent || '').trim();
                  }
                }
                
                // Skip empty messages that aren't from the user
                if (!text && !isUser) return;
                
                // Skip messages containing the limit reached text (case insensitive and handles different service names)
                if (!isUser) {
                  const limitPatterns = [
                    // /reached.*video agent/i,
                    /reached/i,
                    /unlimited mode/i,
                    /generative credits/i
                  ];
                  
                  const shouldSkip = limitPatterns.some(pattern => pattern.test(text));
                  if (shouldSkip) {
                    console.log('⏭️ [get_messages] Skipping limit message:', text.substring(0, 50) + '...');
                    return;
                  }
                }
                
                messages.push({
                  role: isUser ? 'user' : 'assistant',
                  text: text || '',
                  timestamp: new Date().toISOString()
                });
              });
              
              return messages;
            });
            
            // Merge with previously stored messages to preserve video data
            const previousMessages = page._extractedMessages || [];
            if (previousMessages.length > 0 && fetchedMessages.length > 0) {
              // For each new message, check if it matches a previous message and preserve video data
              fetchedMessages = fetchedMessages.map((newMsg, index) => {
                // Try to find matching message in previous messages by index and text
                if (index < previousMessages.length) {
                  const prevMsg = previousMessages[index];
                  // If text matches and previous message had video, preserve it
                  if (prevMsg.text === newMsg.text && prevMsg.video) {
                    return {
                      ...newMsg,
                      video: prevMsg.video
                    };
                  }
                }
                return newMsg;
              });
            }
            
            // If we found a video, attach it to the last assistant message that doesn't already have a video
            if (videoData && fetchedMessages && fetchedMessages.length > 0) {
              // Find the last assistant message without a video
              for (let i = fetchedMessages.length - 1; i >= 0; i--) {
                if (fetchedMessages[i].role === 'assistant' && !fetchedMessages[i].video) {
                  fetchedMessages[i].video = videoData;
                  console.log('✅ [get_messages] Attached video to last assistant message without video');
                  break;
                }
              }
            }
            
            // Transform 'assistant' role to 'agent' for frontend compatibility
            if (Array.isArray(fetchedMessages)) {
              fetchedMessages = fetchedMessages.map(msg => ({
                ...msg,
                role: msg.role === 'assistant' ? 'agent' : msg.role
              }));
            }
            
            // Store messages and video data for chat history
            if (Array.isArray(fetchedMessages) && fetchedMessages.length > 0) {
              page._extractedMessages = fetchedMessages;
              // Store the video data if available
              if (videoData) {
                page._videoData = videoData;
                console.log(`💾 [get_messages] Stored ${fetchedMessages.length} messages with video data`);
              } else {
                console.log(`💾 [get_messages] Stored ${fetchedMessages.length} messages (no video data)`);
              }
              
              // Log how many messages have videos
              const messagesWithVideos = fetchedMessages.filter(m => m.video?.videoUrl);
              console.log(`🎥 [get_messages] ${messagesWithVideos.length} messages have video URLs attached`);
            }
            
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
                ).filter(el => {
                  // Skip hidden elements
                  if (el.classList.contains('tw-hidden')) return false;
                  
                  // Skip elements that match the preloader pattern
                  // Preloader has these exact classes: tw-flex tw-cursor-pointer tw-items-center tw-gap-x-1 tw-text-sm tw-text-textSupport
                  const isPreloader = el.matches('.tw-flex.tw-cursor-pointer.tw-items-center.tw-gap-x-1.tw-text-sm.tw-text-textSupport');
                  if (isPreloader) {
                    console.log('[get_messages] Skipping preloader element');
                    return false;
                  }
                  
                  return true;
                });
                console.log('[get_messages] Found', allElements.length, 'message rows after filtering');
                
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
                  if (row.classList.contains('tw-flex-col') && row.classList.contains('tw-rounded-2xl') && row.classList.contains('tw-bg-fill-general')) {
                    // Skip preloader cards - they have brand colors and a progress indicator
                    const isPreloader = row.classList.contains('tw-border-brand') && row.classList.contains('tw-bg-more-brandLighter');
                    if (isPreloader) {
                      console.log('[get_messages] Skipping preloader card (brand colors detected)');
                      return null;
                    }
                    
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
                    
                    // Skip composite messages that contain chat history context
                    if (text && text.includes('This is the context of our previous chat:')) {
                      console.log('[get_messages] Skipping composite message with chat history');
                      return null;
                    }
                    
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


                  // ✅ ADD THE CHECK HERE - after text is extracted
                  if (text) {
                    // Skip HeyGen preloader messages (Thinking..., Reasoning, etc.)
                    const normalizedText = text.toLowerCase().trim();
                    const isPreloaderText = normalizedText === 'thinking...' ||
                                           normalizedText === 'thinking' ||
                                           normalizedText === 'reasoning' ||
                                           normalizedText === 'reasoning...' ||
                                           (normalizedText.length < 15 && normalizedText.includes('...'));
                    if (isPreloaderText) {
                      console.log('⏭️ [get_messages] Skipping preloader message:', text);
                      return null;
                    }
                    
                    const limitPatterns = [
                      /reached.*limit/i,
                      /add generative credits/i,
                      /switch to unlimited mode/i,
                      /video agent.*limit/i
                    ];
                    
                    const shouldSkip = limitPatterns.some(pattern => pattern.test(text));
                    if (shouldSkip) {
                      console.log('⏭️ [get_messages] Skipping limit message:', text.substring(0, 50) + '...');
                      return null; // Return null instead of nothing
                    }
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
              
              // Clear any extracted video data (no longer needed - DOM evaluation handles video cards)
              if (page._extractedVideo) {
                delete page._extractedVideo;
              }
              
              // Check for HeyGen error messages
              const errorElement = await page.evaluate(() => {
                const errorDiv = document.querySelector('.tw-bg-more-redLighter');
                if (errorDiv) {
                  const errorText = errorDiv.querySelector('.tw-text-textTitle');
                  return errorText ? errorText.innerText.trim() : 'Something went wrong';
                }
                return null;
              });
              
              if (errorElement) {
                console.log('⚠️ [get_messages] HeyGen error detected:', errorElement);
                fetchedMessages.error = errorElement;
                fetchedMessages.hasError = true;
              }
            }
            // Near line 1545, after: fetchedMessages = await page.evaluate(() => { ... });
            // Store the properly filtered messages for chat history
            if (fetchedMessages && fetchedMessages.messages && Array.isArray(fetchedMessages.messages)) {
              page._extractedMessages = fetchedMessages.messages;
              console.log(`💾 [get_messages] Stored ${fetchedMessages.messages.length} filtered messages in _extractedMessages`);
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
              if (closeButton) {
                await closeButton.click();
                await videoPage.waitForTimeout(500); // Small delay after closing
              }
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
                // Extract video hash from URL
                let videoHash = null;
                
                // Try to match the new URL format first: /video/transcode/HASH/.../resolution.mp4
                const transcodeMatch = videoData.videoUrl.match(/\/transcode\/([a-f0-9]+)\//i);
                if (transcodeMatch) {
                  videoHash = transcodeMatch[1];
                } else {
                  // Fall back to the old caption_ format
                  const captionMatch = videoData.videoUrl.match(/caption_([a-f0-9]+)\.mp4/i);
                  videoHash = captionMatch ? captionMatch[1] : null;
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

                // Extract title from video URL filename parameter
                const safeTitle = extractVideoTitle(videoData.videoUrl) || 'Your video is ready!';
                console.log('📝 [get_video_url] Extracted title:', safeTitle);
                
                // Add title to videoData so it's available everywhere
                videoData.title = safeTitle;
                
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


                  // Store video data for chat history merging
                if (!session.page._videoUrls) {
                  session.page._videoUrls = [];
                }
                session.page._videoUrls.push({
                  videoUrl: videoData.videoUrl,
                  poster: videoData.poster,
                  title: safeTitle
                });
                console.log('💾 Stored video data in _videoUrls for chat history');
                
                
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
              
     // Store video data even if save failed
              if (!session.page._videoUrls) {
                session.page._videoUrls = [];
              }
              session.page._videoUrls.push({
                videoUrl: videoData.videoUrl,
                poster: videoData.poster,
                title: safeTitle
              });
              console.log('💾 Stored video data in _videoUrls for chat history');
              

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

             // Store video data for chat history merging (fallback case)
            const extractedTitle = extractVideoTitle(videoData.videoUrl) || 'Your video is ready!';
            
            const videoDataWithTitle = {
              ...videoData,
              title: extractedTitle
            };
            
            if (!session.page._videoUrls) {
              session.page._videoUrls = [];
            }
            session.page._videoUrls.push(videoDataWithTitle);
            console.log('💾 Stored video data in _videoUrls for chat history');
            
            ws.send(JSON.stringify({ success: true, action: 'get_video_url', data: videoDataWithTitle }));
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
          console.log('📁 Uploading files via WebSocket');
          try {
            if (!session?.page) {
              throw new Error('No active browser session');
            }
            const uploadPage = session.page;
            if (!uploadPage) {
              ws.send(JSON.stringify({ success: false, action: 'upload_files', error: 'No active page in session' }));
              return;
            }
            
            const files = data.files; // Array of {name, content (base64), type}
            if (!files || files.length === 0) {
              ws.send(JSON.stringify({ success: false, action: 'upload_files', error: 'No files provided' }));
              break;
            }
            
            console.log(`📤 Uploading ${files.length} files via WebSocket`);
            
            // Check if we need to navigate to home first
            // This happens when uploading from chat history before sending the composite message
            const currentUrl = uploadPage.url();
            const needsHomeNavigation = data.navigateToHome || !currentUrl.includes('app.heygen.com/home');
            
            if (needsHomeNavigation && currentUrl.includes('/agent/')) {
              console.log('🌐 Navigating to home page for file upload (from agent session)...');
              await uploadPage.goto('https://app.heygen.com/home', { 
                waitUntil: 'domcontentloaded',
                timeout: 30000 
              });
              await uploadPage.waitForTimeout(2000);
              // Start avatar box polling
              startAvatarBoxPolling(session);
            }
            
            // Wait for the chat input to be ready
            await uploadPage.waitForSelector('textarea.tw-resize-none', { state: 'visible', timeout: 10000 });
            
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
            
            const message = data.message;
            if (!message || !message.trim()) {
              ws.send(JSON.stringify({ success: false, error: 'Message is required' }));
              break;
            }
            
            // Check if message contains chat history context (indicates we need to navigate to home)
            const isFromChatHistory = message.includes('This is the context of our previous chat:');
            
            // If user is on the home page in the frontend OR sending from chat history, navigate to HeyGen home
            if (data.currentPath === '/home' || isFromChatHistory) {
              console.log('🌐 Navigating to HeyGen home to start new chat...');
              if (isFromChatHistory) {
                console.log('   📚 Detected chat history context - will dump history on home page');
              }
              await sendPage.goto('https://app.heygen.com/home', { 
                waitUntil: 'domcontentloaded',
                timeout: 30000
              });
              await sendPage.waitForTimeout(2000);
              // Start avatar box polling
              startAvatarBoxPolling(session);
            }
            
            // Find and fill the input field
            const inputSelector = 'textarea.tw-resize-none';
            await sendPage.waitForSelector(inputSelector, { state: 'visible', timeout: 10000 });
            await sendPage.click(inputSelector);
            await sendPage.fill(inputSelector, message);
            
            // Wait a moment for the text to be entered
            await sendPage.waitForTimeout(500);
            
            // Click the submit button - use a more specific selector
            const buttonSelector = 'button[data-loading="false"].tw-bg-brand:not([disabled])';
            await sendPage.waitForSelector(buttonSelector, { state: 'visible', timeout: 20000 });
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

        case 'save_chat':
          try {
            console.log('💬 Saving chat...');
            const { sessionId, messages, title, composedPrompt } = data;
            const userEmail = ws.user?.email || 'anonymous';
            
            if (!sessionId) {
              throw new Error('Session ID is required');
            }
            
            if (!messages || !Array.isArray(messages)) {
              throw new Error('Messages must be an array');
            }
            
            console.log(`💾 Saving chat for session ${sessionId} with ${messages.length} messages`);
            
            // Filter out composite messages and empty messages
            const normalizeForCompare = (s) => (s || '').replace(/\s+/g, ' ').trim();
            const messagesToSave = messages.filter(msg => {
              // Skip empty messages
              if (!msg) return false;
              
              // Skip messages with no content
              const hasText = msg.text && msg.text.trim().length > 0;
              const hasVideo = msg.video && msg.video.videoUrl;
              const hasImages = msg.images && msg.images.length > 0;
              if (!hasText && !hasVideo && !hasImages) return false;
              
              // Skip composite messages
              if (msg.role === 'user' && msg.text) {
                const t = normalizeForCompare(msg.text);
                if (t.includes('This is the context of our previous chat:')) {
                  return false;
                }
              }
              
              return true;
            });
            
            console.log(`💾 Filtered ${messages.length - messagesToSave.length} invalid messages on backend`);

            // Extract titles from video URLs before saving
            const messagesWithTitles = messagesToSave.map(msg => {
              if (msg.video && msg.video.videoUrl) {
                const extractedTitle = extractVideoTitle(msg.video.videoUrl) || msg.video.title || 'Your video is ready!';
                console.log(`📝 [save_chat] Video title: "${extractedTitle}"`);
                return {
                  ...msg,
                  video: {
                    ...msg.video,
                    title: extractedTitle
                  }
                };
              }
              return msg;
            });

            // Save chat using our new chat storage module
            const result = await chatStorage.updateChat(sessionId, messagesWithTitles, userEmail, title);
            
            if (result) {
              console.log(`✅ Chat saved successfully: ${result}`);
              ws.send(JSON.stringify({ 
                success: true, 
                action: 'save_chat', 
                data: { 
                  sessionId,
                  savedAt: new Date().toISOString(),
                  messageCount: messagesToSave.length,
                  composedIncluded: !!(typeof composedPrompt === 'string' && composedPrompt.trim().length > 0)
                } 
              }));
            } else {
              throw new Error('Failed to save chat');
            }
          } catch (err) {
            console.error('❌ Error saving chat:', err);
            ws.send(JSON.stringify({ success: false, action: 'save_chat', error: err.message }));
          }
          break;

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

          case 'find_and_click':
            try {
              if (!session?.page) {
                throw new Error('No active browser session or page');
              }
              
              const { page } = session;
              // Using a more specific selector that matches the button text
              const selector = data.selector || 'button:has-text("Make changes")';
              const cssSelector = 'button:contains("Make changes")'; // For jQuery-like :contains
              
              // Check if we're using a Playwright-specific selector
              const isPlaywrightSelector = selector.includes(':has-text(');
              const finalSelector = isPlaywrightSelector 
                ? 'button' // Fallback to generic button selector and we'll filter by text
                : selector;
              const timeout = data.timeout || 5000;
              
              
              // Find all buttons and filter by text and visibility
              const buttons = await page.$$('button');
              
              // Log first few buttons for debugging
              for (let i = 0; i < Math.min(buttons.length, 10); i++) {
                const text = await buttons[i].innerText();
              }
              
              // Find the target button
              let targetButton = null;
              for (const btn of buttons) {
                const text = (await btn.innerText()).trim();
                const isVisible = await btn.isVisible();
                
                // Check if this button matches the requested selector text
                const targetText = selector.includes(':has-text(') 
                  ? selector.split('"')[1] // Extract text from selector like 'button:has-text("Continue with Unlimited")'
                  : '';
                
                if (isVisible && (text.includes('Make changes') || (targetText && text.includes(targetText)))) {
                  targetButton = btn;
                  break;
                }
              }
              
              if (targetButton) {
                console.log('✅ [find_and_click] Found target button, attempting to click...');
                
                try {
                  // Scroll into view and wait
                  await targetButton.scrollIntoViewIfNeeded();
                  await page.waitForTimeout(500);
                  
                  // Try direct click first
                  try {
                    await targetButton.click({ timeout: 5000 });
                    console.log('✅ [find_and_click] Successfully clicked the button');
                  } catch (clickError) {
                    console.warn('❌ [find_and_click] Direct click failed, trying JavaScript click:', clickError.message);
                    
                    // Fallback to JavaScript click
                    await page.evaluate(btn => {
                      btn.dispatchEvent(new MouseEvent('click', {
                        view: window,
                        bubbles: true,
                        cancelable: true
                      }));
                    }, targetButton);
                  }
                  
                  return ws.send(JSON.stringify({ 
                    success: true, 
                    action: 'find_and_click',
                    message: 'Element found and clicked successfully'
                  }));
                } catch (error) {
                  console.error('❌ [find_and_click] Error during button interaction:', error);
                  throw error; // Let the outer catch handle it
                }
              } else {
                const targetText = selector.includes(':has-text(') 
                  ? selector.split('"')[1]
                  : selector;
                console.log(`⏳ [find_and_click] Button with text "${targetText}" not found or not visible`);
                // Take a screenshot for debugging
                try {
                  const screenshot = await page.screenshot({ type: 'jpeg', quality: 30, fullPage: true });
                  console.log(`📸 [find_and_click] Took screenshot of current page (${screenshot.length} bytes)`);
                } catch (screenshotError) {
                  console.error('❌ [find_and_click] Failed to take screenshot:', screenshotError);
                }
                
                ws.send(JSON.stringify({ 
                  success: false, 
                  action: 'find_and_click',
                  message: 'Element not found or not visible',
                  selector,
                  url: page.url()
                }));
              }
            } catch (error) {
              console.error('❌ Error in find_and_click:', error);
              ws.send(JSON.stringify({ 
                success: false, 
                action: 'find_and_click',
                error: error.message,
                stack: error.stack
              }));
            }
            break;

          default:
            console.log(`❌ Unknown action: ${action}`);
            ws.send(JSON.stringify({ success: false, error: `Unknown action: ${action}` }));
        }
}

// Helper function to get messages using the get_messages action
async function getChatMessages(page) {
  try {
    const messages = await page.evaluate(() => {
      return new Promise((resolve) => {
        const handleMessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.action === 'get_messages' && data.messages) {
              window.removeEventListener('message', handleMessage);
              resolve(data.messages);
            }
          } catch (e) {
            console.error('Error parsing message:', e);
          }
        };
        
        window.addEventListener('message', handleMessage);
        
        // Send get_messages request
        window.postMessage({ 
          type: 'ws-message', 
          data: JSON.stringify({ action: 'get_messages' }) 
        }, '*');
        
        // Fallback in case we don't get a response
        setTimeout(() => resolve([]), 1000);
      });
    });
    
    return Array.isArray(messages) ? messages : [];
  } catch (error) {
    console.error('Error getting messages:', error);
    return [];
  }
}


// ...
export { proxyRouter, initBrowser, setupWebSocketServer };

// API to list user's chats
proxyRouter.get('/api/chats', async (req, res) => {
  try {
    // Get sessionKey from JWT token in cookie
    const { sessionKey, email: userEmail } = getSessionKeyFromRequest(req);
    
    console.log(`📚 [GET /api/chats] Fetching chats for user: ${userEmail} (session: ${sessionKey})`);
    
    // Get chats for this user
    const chats = await chatStorage.getUserChats(userEmail);
    res.json({ success: true, chats });
  } catch (error) {
    console.error('Error listing chats:', error);
    res.status(500).json({ success: false, error: 'Failed to list chats' });
  }
});

// API to get a specific chat
proxyRouter.get('/api/chats/:chatId', async (req, res) => {
  try {
    const { chatId } = req.params;
    
    // Get sessionKey from JWT token in cookie
    const { sessionKey, email: userEmail } = getSessionKeyFromRequest(req);
    
    console.log(`📚 [GET /api/chats/:chatId] Fetching chat ${chatId} for user: ${userEmail} (session: ${sessionKey})`);
    
    // Get the chat
    const chat = await chatStorage.getChatById(chatId, userEmail);
    
    if (!chat) {
      console.error(`❌ Chat not found: ${chatId} for user ${userEmail}`);
      return res.status(404).json({ success: false, error: 'Chat not found' });
    }
    
    console.log(`✅ Successfully retrieved chat ${chatId}`);
    res.json({ success: true, chat });
  } catch (error) {
    console.error('Error getting chat:', error);
    res.status(500).json({ success: false, error: 'Failed to get chat' });
  }
});

// API to delete a specific chat
proxyRouter.delete('/api/chats/:chatId', async (req, res) => {
  try {
    const { chatId } = req.params;

    // Get sessionKey from JWT token in cookie
    const { sessionKey, email: userEmail } = getSessionKeyFromRequest(req);
    console.log(`✅ Authenticated user: ${userEmail} (session: ${sessionKey})`);
    
    console.log(`🗑️ Deleting chat ${chatId} for user ${userEmail}`);

    const deleted = await chatStorage.deleteChat(chatId, userEmail);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Chat not found or could not be deleted' });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Error deleting chat:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete chat' });
  }
});

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
        const thumbFile = file.replace(/\.mp4$/, '-thumbnail.jpg');
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

// API to delete a specific video
proxyRouter.delete('/api/videos/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;

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

    const userDirName = userEmail.replace(/[@.]/g, '_');
    const userDir = path.join(UPLOADS_DIR, userDirName);

    // Resolve video and thumbnail paths
    const videoPath = path.join(userDir, videoId);
    const thumbPath = videoId.endsWith('.mp4')
      ? path.join(userDir, videoId.replace(/\.mp4$/, '-thumbnail.jpg'))
      : path.join(userDir, `${videoId}-thumbnail.jpg`);

    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ success: false, error: 'Video not found' });
    }

    try {
      fs.unlinkSync(videoPath);
      if (fs.existsSync(thumbPath)) {
        try {
          fs.unlinkSync(thumbPath);
        } catch (thumbErr) {
          console.warn('Error deleting thumbnail:', thumbErr.message);
        }
      }
      return res.json({ success: true });
    } catch (err) {
      console.error('Error deleting video file:', err);
      return res.status(500).json({ success: false, error: 'Failed to delete video' });
    }
  } catch (error) {
    console.error('Error in delete video handler:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete video' });
  }
});

// Add static file serving for uploads directory
proxyRouter.use('/uploads', express.static(UPLOADS_DIR));

// If run directly, start the browser and server (legacy mode)
if (import.meta.url === `file://${process.argv[1]}`) {
  initBrowser().then(() => {
    const server = createServer(app);
    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🌐 WebSocket server running on ws://localhost:${PORT}`);
      console.log(`📁 Using data directory: ${__dirname}/data`);
      console.log(`🔒 JWT secret: ${process.env.AUTH_SECRET ? 'Set' : 'Not set'}`);
      
      // Test chatStorage functions
      (async () => {
        try {
          console.log('🧪 Testing chat storage functions...');
          const testChatId = 'test_chat_' + Date.now();
          const testMessages = [
            { role: 'user', text: 'Hello, world!', timestamp: new Date().toISOString() },
            { role: 'assistant', text: 'Hi there!', timestamp: new Date().toISOString() }
          ];
          const testUserEmail = 'test@example.com';
          
          console.log('💾 Saving test chat to user directory...');
          const result = await chatStorage.updateChat(testChatId, testMessages, testUserEmail);
          if (result) {
            console.log('✅ Test chat saved successfully:', result);
            
            // Try to load it back
            const loaded = await chatStorage.getChatById(testChatId, testUserEmail);
            console.log('📝 Loaded test chat:', JSON.stringify(loaded, null, 2));
          } else {
            console.error('❌ Failed to save test chat');
          }
        } catch (error) {
          console.error('❌ Error testing chat storage:', error);
        }
      })();
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
      stopAvatarBoxPolling(session);
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

