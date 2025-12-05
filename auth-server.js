// Authentication server with custom login UI
// Handles user authentication and session management

import express from 'express';
import { chromium, request as pwRequest } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const authRouter = express.Router();
const app = express();
const PORT = process.env.PORT || 3000;
const STORAGE_FILE = path.join(__dirname, 'heygen-storage.json');
const COOKIES_FILE = path.join(__dirname, 'heygen-cookies.json');
const USERS_FILE = path.join(__dirname, 'users.json');
const AUTH_SECRET = process.env.AUTH_SECRET || 'dev-secret-change-me';

// Middleware
authRouter.use(express.json());
authRouter.use(express.urlencoded({ extended: true }));
authRouter.use(express.static(path.join(__dirname, 'public')));

// Middleware to set baseUrl dynamically from request
authRouter.use((req, res, next) => {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  req.baseUrl = `${protocol}://${host}`;
  next();
});

// Allow proxy and frontend origins to call this server with credentials
const allowedOrigins = [
  'http://localhost:3000', 
  'http://localhost:3001',
  'http://localhost:3002',
  process.env.FRONTEND_URL,
  process.env.PROXY_URL
].filter(Boolean); // Remove undefined values

authRouter.use(cors({ 
  origin: allowedOrigins,
  credentials: true
}));

// Session storage
let sessionCookies = null;
let cookieExpiry = null;

// Load saved HeyGen session if exists
function loadSession() {
  if (fs.existsSync(COOKIES_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
      sessionCookies = data.cookies || data;
      cookieExpiry = data.expiry || null;
      
      // Check if cookies are expired
      if (cookieExpiry && Date.now() > cookieExpiry) {
        console.log('⚠️  Cookies expired, will refresh on next request');
        return false;
      }
      
      console.log('✅ Loaded saved session');
      return true;
    } catch (err) {
      console.error('❌ Error loading session:', err);
    }
  }
  return false;
}

// Save HeyGen session with expiry
function saveSession(cookies, expiryHours = 24) {
  try {
    const expiry = Date.now() + (expiryHours * 60 * 60 * 1000);
    const data = {
      cookies: cookies,
      expiry: expiry,
      savedAt: new Date().toISOString()
    };
    fs.writeFileSync(COOKIES_FILE, JSON.stringify(data, null, 2));
    sessionCookies = cookies;
    cookieExpiry = expiry;
    console.log('✅ Session saved (expires in', expiryHours, 'hours)');
  } catch (err) {
    console.error('❌ Error saving session:', err);
  }
}

// Check if HeyGen session is authenticated and valid
function isAuthenticated() {
  if (!sessionCookies || sessionCookies.length === 0) {
    return false;
  }
  
  // Check if cookies are expired
  if (cookieExpiry && Date.now() > cookieExpiry) {
    console.log('⚠️  Session expired');
    return false;
  }
  
  return true;
}

// Load existing session on startup
loadSession();

// ============ Browser token helpers ============
function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signToken(payload, expiresInSeconds = 7 * 24 * 60 * 60) { // 7 days
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expiresInSeconds };
  const headerB64 = base64url(JSON.stringify(header));
  const bodyB64 = base64url(JSON.stringify(body));
  const data = `${headerB64}.${bodyB64}`;
  const signature = crypto
    .createHmac('sha256', AUTH_SECRET)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${data}.${signature}`;
}

function verifyToken(token) {
  try {
    const [headerB64, bodyB64, sig] = token.split('.');
    if (!headerB64 || !bodyB64 || !sig) return null;
    const data = `${headerB64}.${bodyB64}`;
    const expected = crypto
      .createHmac('sha256', AUTH_SECRET)
      .update(data)
      .digest('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    if (expected !== sig) return null;
    const body = JSON.parse(Buffer.from(bodyB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    if (body.exp && Math.floor(Date.now() / 1000) > body.exp) return null;
    return body;
  } catch (_) {
    return null;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return header.split(';').reduce((acc, part) => {
    const [k, ...rest] = part.trim().split('=');
    if (!k) return acc;
    acc[k] = decodeURIComponent(rest.join('='));
    return acc;
  }, {});
}

function getUserFromRequest(req) {
  const cookies = parseCookies(req);
  const token = cookies['arena_token'];
  if (!token) return null;
  return verifyToken(token);
}

// Load users from JSON file
function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const data = fs.readFileSync(USERS_FILE, 'utf8');
      return JSON.parse(data);
    }
    return { users: [] };
  } catch (err) {
    console.error('❌ Error loading users:', err);
    return { users: [] };
  }
}

// Validate user credentials
function validateUser(email, password) {
  const usersData = loadUsers();
  const user = usersData.users.find(u => u.email === email && u.password === password);
  return user || null;
}


// Refresh session using env credentials
async function refreshSession() {
  const email = process.env.HEYGEN_EMAIL;
  const password = process.env.HEYGEN_PASSWORD;
  
  if (!email || !password) {
    throw new Error('HeyGen credentials not found in .env file');
  }
  
  // Check if we already have valid cookies - if so, skip refresh
  if (isAuthenticated()) {
    const timeUntilExpiry = Math.floor((cookieExpiry - Date.now()) / (60 * 60 * 1000));
    console.log(`✅ Valid session already exists (expires in ~${timeUntilExpiry} hours) - skipping refresh`);
    return true;
  }
  
  console.log('🔄 Refreshing HeyGen session with credentials from .env');
  
  let browser;
  try {
    browser = await chromium.launch({ 
      headless: false,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--disable-extensions',
        '--blink-settings=imagesEnabled=false'
      ]
    });
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.5993.90 Safari/537.36',
    });
    
    const page = await context.newPage();
    
    // Block video and media requests on login page to save CPU/memory
    let isOnLoginPage = false;
    await page.on('framenavigated', frame => {
      if (frame === page.mainFrame()) {
        isOnLoginPage = page.url().includes('/login');
        if (isOnLoginPage) {
          console.log('📱 On login page - blocking videos');
        }
      }
    });
    
    await page.route('**/*', route => {
      const requestUrl = route.request().url();
      const resourceType = route.request().resourceType();
      
      // Block video/media on login page
      if (isOnLoginPage && (
        resourceType === 'media' || 
        resourceType === 'video' ||
        requestUrl.endsWith('.mp4') || 
        requestUrl.endsWith('.webm') ||
        requestUrl.endsWith('.m3u8') ||
        requestUrl.includes('video') ||
        requestUrl.includes('media')
      )) {
        console.log('🚫 Blocking:', resourceType, requestUrl);
        route.abort();
      } else {
        route.continue();
      }
    });
    
    console.log('📱 Navigating to HeyGen login...');
    await page.goto('https://app.heygen.com/login', { 
      waitUntil: 'domcontentloaded',
      timeout: 30000 
    });
    
    console.log('✅ Login page loaded (videos blocked)');
    isOnLoginPage = true;
    
    // Step 1: Enter email + Continue
    console.log('📧 Entering email...');
    await page.waitForSelector('input[placeholder="Enter email"]', { state: 'visible', timeout: 120000 });
    await page.getByPlaceholder('Enter email').fill(email);
    await page.getByRole('button', { name: 'Continue' }).click();
    
    // Wait for password field to appear
    console.log('⏳ Waiting for password field...');
    await page.waitForSelector('input[type="password"]', { state: 'visible', timeout: 100000 });
    
    // Still on login page, keep blocking
    
    // Step 2: Enter password + Log in
    console.log('🔒 Entering password...');
    await page.getByPlaceholder('Enter password').fill(password);
    
    // Wait a moment for the button to be ready
    await page.waitForTimeout(1000);
    
    console.log('🖱️  Clicking login button...');
    await page.getByRole('button', { name: 'Log in' }).click();
    
    // Stop blocking videos after login
    isOnLoginPage = false;
    
    // Wait for page load after login
    console.log('⏳ Waiting for page to load...');
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });

    // Give React time to redirect and render the home page
    await page.waitForTimeout(9000); // 3–5 seconds is usually enough
    
    // Wait a bit for any redirects to complete (like in the working POC)
    console.log('⏳ Waiting for redirect...');
    await page.waitForTimeout(5000);
    
    // Poll for the URL to change to /home (handles headless mode better)
    console.log('⏳ Waiting for app.heygen.com/home...');
    let currentUrl = page.url();
    let attempts = 0;
    const maxAttempts = 12; // 12 * 5 seconds = 60 seconds total
    
    while (!currentUrl.includes('/home') && attempts < maxAttempts) {
      console.log(`  Current URL: ${currentUrl}`);
      await page.waitForTimeout(5000);
      currentUrl = page.url();
      attempts++;
    }
    
    console.log('Current URL after login:', currentUrl);
    
    // Check if login was successful
    if (currentUrl.includes('/login')) {
      // Take a screenshot for debugging
      await page.screenshot({ path: 'login-failed.png' });
      throw new Error('Login failed - still on login page. Check credentials or see login-failed.png');
    }
    
    // Wait for the main chat interface to be ready
    console.log('⏳ Waiting for chat interface...');
    try {
      await page.waitForSelector('div[role="textbox"][contenteditable="true"]', { 
        state: 'visible', 
        timeout: 30000 
      });
      console.log('✅ Login complete and page fully loaded!');
    } catch (selectorError) {
      console.warn('⚠️  Chat interface selector not found, but login may have succeeded. URL:', currentUrl);
    }
    
    // Get cookies from the logged-in session
    const cookies = await context.cookies();
    
    // Save session
    await context.storageState({ path: STORAGE_FILE });
    saveSession(cookies, 24); // 24 hour expiry
    
    console.log('✅ HeyGen session refreshed successfully!');
    
    await browser.close();
    
    // Reload the Playwright proxy browser context with fresh cookies
    console.log('🔄 Reloading Playwright proxy browser context...');
    try {
      const requestContext = await pwRequest.newContext();
      // On Render, use the public URL. Locally, use 127.0.0.1
      const port = process.env.PORT || 3000;
      const baseUrl = process.env.RENDER_EXTERNAL_URL || `http://127.0.0.1:${port}`;
      console.log(`🔗 Connecting to: ${baseUrl}/proxy/reload-context`);
      const reloadResponse = await requestContext.post(`${baseUrl}/proxy/reload-context`, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      });
      
      const reloadData = await reloadResponse.json();
      await requestContext.dispose();
      
      if (reloadData.success) {
        console.log('✅ Playwright proxy browser context reloaded with fresh cookies');
      } else {
        console.warn('⚠️  Failed to reload browser context:', reloadData.error);
      }
    } catch (reloadError) {
      console.warn('⚠️  Could not reload browser context:', reloadError.message);
      console.log('   Browser will reload cookies on next restart');
    }
    
    return true;
  } catch (error) {
    console.error('❌ Failed to refresh HeyGen session:', error.message);
    if (browser) {
      await browser.close();
    }
    throw error;
  }
}

// Custom login page (root will check browser token, not HeyGen cookies)
authRouter.get('/', (req, res) => {
  const user = getUserFromRequest(req);
  if (user) {
    // Redirect to frontend home if browser token is valid
    res.redirect('/home');
  } else {
    res.redirect('/auth/login');
  }
});

// Dedicated login route
authRouter.get('/login', (req, res) => {
  const user = getUserFromRequest(req);
  if (user) {
    return res.redirect('/home');
  }
  // Show custom login page
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ArenaGen - Welcome back</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: #ffffff;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    
    .login-container {
      background: white;
      width: 100%;
      max-width: 500px;
      padding: 48px 32px;
      animation: fadeIn 0.4s ease-out;
    }
    
    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: translateY(10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
    
    .logo {
      text-align: center;
      margin-bottom: 24px;
    }
    
    .logo-svg {
      width: 120px;
      height: auto;
      margin-bottom: 32px;
    }
    
    .logo h1 {
      font-size: 28px;
      font-weight: 600;
      color: #1a1a1a;
      margin-bottom: 16px;
      letter-spacing: -0.5px;
    }
    
    .logo p {
      color: #666666;
      font-size: 15px;
      font-weight: 400;
    }
    
    .logo p a {
      color: #1a1a1a;
      text-decoration: none;
      font-weight: 500;
    }
    
    .logo p a:hover {
      text-decoration: underline;
    }
    
    .divider {
      text-align: center;
      margin: 32px 0;
      position: relative;
    }
    
    .divider::before {
      content: '';
      position: absolute;
      top: 50%;
      left: 0;
      right: 0;
      height: 1px;
      background: #e5e7eb;
    }
    
    .divider span {
      background: white;
      padding: 0 16px;
      position: relative;
      color: #999999;
      font-size: 14px;
      font-weight: 400;
    }
    
    .form-group {
      margin-bottom: 16px;
    }
    
    .input-wrapper {
      position: relative;
    }
    
    .input-icon {
      position: absolute;
      left: 16px;
      top: 50%;
      transform: translateY(-50%);
      color: #999999;
      pointer-events: none;
    }
    
    input {
      width: 100%;
      padding: 14px 16px 14px 44px;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      font-size: 15px;
      transition: all 0.2s ease;
      outline: none;
      background: #ffffff;
      color: #1a1a1a;
    }
    
    input::placeholder {
      color: #999999;
    }
    
    input:hover {
      border-color: #d1d5db;
    }
    
    input:focus {
      border-color: #1a1a1a;
      box-shadow: 0 0 0 1px #1a1a1a;
    }
    
    .btn {
      width: 100%;
      padding: 14px;
      background: #f5f5f5;
      color: #cccccc;
      border: none;
      border-radius: 8px;
      font-size: 15px;
      font-weight: 500;
      cursor: not-allowed;
      transition: all 0.2s ease;
      margin-top: 8px;
    }
    
    .btn.active {
      background: #1a1a1a;
      color: white;
      cursor: pointer;
    }
    
    .btn.active:hover {
      background: #333333;
    }
    
    .btn:disabled {
      opacity: 1;
      cursor: not-allowed;
    }
    
    .status {
      margin-top: 16px;
      padding: 12px;
      border-radius: 8px;
      font-size: 14px;
      display: none;
    }
    
    .status.success {
      background: #d1fae5;
      color: #065f46;
      display: block;
    }
    
    .status.error {
      background: #fee2e2;
      color: #991b1b;
      display: block;
    }
    
    .status.loading {
      background: #dbeafe;
      color: #1e40af;
      display: block;
    }
    
    .footer-links {
      text-align: center;
      margin-top: 40px;
      padding-top: 24px;
      border-top: 1px solid #f0f0f0;
    }
    
    .footer-links a {
      color: #666666;
      text-decoration: none;
      font-size: 13px;
      margin: 0 12px;
      transition: color 0.2s ease;
    }
    
    .footer-links a:hover {
      color: #1a1a1a;
    }
    
    .password-step {
      display: none;
    }
    
    .password-step.active {
      display: block;
    }
    
    .email-step.hidden {
      display: none;
    }
    
    .forgot-password {
      position: absolute;
      right: 16px;
      top: 50%;
      transform: translateY(-50%);
      color: #00D4AA;
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
      pointer-events: all;
      z-index: 10;
    }
    
    .forgot-password:hover {
      text-decoration: underline;
    }
    
    .back-button {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: #666666;
      text-decoration: none;
      font-size: 14px;
      margin-bottom: 24px;
      transition: color 0.2s ease;
    }
    
    .back-button:hover {
      color: #1a1a1a;
    }
    
    .back-button svg {
      width: 16px;
      height: 16px;
    }
    
    .spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-right: 8px;
      vertical-align: middle;
    }
    
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="login-container">
    <div class="logo">
      <svg class="logo-svg" viewBox="0 0 120 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M20 8L28 20L20 32L12 20L20 8Z" fill="url(#gradient1)"/>
        <path d="M28 20L36 32L28 44L20 32L28 20Z" fill="url(#gradient2)" opacity="0.8"/>
        <defs>
          <linearGradient id="gradient1" x1="12" y1="8" x2="28" y2="32" gradientUnits="userSpaceOnUse">
            <stop stop-color="#00D4AA"/>
            <stop offset="1" stop-color="#00A3FF"/>
          </linearGradient>
          <linearGradient id="gradient2" x1="20" y1="20" x2="36" y2="44" gradientUnits="userSpaceOnUse">
            <stop stop-color="#A855F7"/>
            <stop offset="1" stop-color="#EC4899"/>
          </linearGradient>
        </defs>
        <text x="48" y="28" font-family="Arial, sans-serif" font-size="20" font-weight="bold" fill="#1a1a1a">ArenaGen</text>
      </svg>
      <h1>Welcome back</h1>
      <p>Don't have an account? <a  target="_blank">Sign up</a></p>
    </div>
    
    <div class="divider">
      <span>Or</span>
    </div>
    
    <form id="loginForm">
      <!-- Email Step -->
      <div class="email-step" id="emailStep">
        <div class="form-group">
          <div class="input-wrapper">
            <svg class="input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
              <polyline points="22,6 12,13 2,6"/>
            </svg>
            <input 
              type="email" 
              id="email" 
              name="email" 
              placeholder="Enter email"
              required
            >
          </div>
        </div>
        
        <button type="button" class="btn" id="emailBtn">
          Continue
        </button>
      </div>
      
      <!-- Password Step -->
      <div class="password-step" id="passwordStep">
        <a href="#" class="back-button" id="backBtn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          Back
        </a>
        
        <div class="form-group">
          <div class="input-wrapper">
            <svg class="input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0110 0v4"/>
            </svg>
            <input 
              type="password" 
              id="password" 
              name="password" 
              placeholder="Enter password"
              required
            >
            <a href="#" class="forgot-password" style="pointer-events: none; opacity: 0.5;">Forgot password?</a>
          </div>
        </div>
        
        <button type="submit" class="btn" id="loginBtn">
          Continue
        </button>
      </div>
    </form>
    
    <div id="status" class="status"></div>
    
    <div class="footer-links">
      <a href="#" onclick="return false;">Support</a>
      <a href="#" onclick="return false;">Terms of Service</a>
      <a href="#" onclick="return false;">Privacy Policy</a>
      <a href="#" onclick="return false;">Biometric Privacy Notice</a>
    </div>
  </div>
  
  <script>
    const form = document.getElementById('loginForm');
    const status = document.getElementById('status');
    const emailBtn = document.getElementById('emailBtn');
    const loginBtn = document.getElementById('loginBtn');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const emailStep = document.getElementById('emailStep');
    const passwordStep = document.getElementById('passwordStep');
    const backBtn = document.getElementById('backBtn');
    
    // Enable/disable email button based on email input
    emailInput.addEventListener('input', () => {
      if (emailInput.value.trim() && emailInput.validity.valid) {
        emailBtn.classList.add('active');
        emailBtn.disabled = false;
      } else {
        emailBtn.classList.remove('active');
        emailBtn.disabled = true;
      }
    });
    
    // Enable/disable login button based on password input
    passwordInput.addEventListener('input', () => {
      if (passwordInput.value.trim()) {
        loginBtn.classList.add('active');
        loginBtn.disabled = false;
      } else {
        loginBtn.classList.remove('active');
        loginBtn.disabled = true;
      }
    });
    
    // Email step: move to password
    emailBtn.addEventListener('click', () => {
      emailStep.classList.add('hidden');
      passwordStep.classList.add('active');
      passwordInput.focus();
    });
    
    // Back button: return to email
    backBtn.addEventListener('click', (e) => {
      e.preventDefault();
      passwordStep.classList.remove('active');
      emailStep.classList.remove('hidden');
      passwordInput.value = '';
      loginBtn.classList.remove('active');
      loginBtn.disabled = true;
    });
    
    // Form submit: actual login
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const email = emailInput.value;
      const password = passwordInput.value;
      
      // Update UI
      loginBtn.disabled = true;
      loginBtn.classList.remove('active');
      loginBtn.innerHTML = '<span class="spinner"></span>Signing in...';
      status.className = 'status loading';
      status.textContent = '🔐 Authentication...';
      
      try {
        const response = await fetch('/auth/api/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ email, password })
        });
        
        const data = await response.json();
        
        if (data.success) {
          status.className = 'status success';
          status.textContent = '✅ Login successful! Redirecting...';
          
          // Redirect to the requested page or default to home
          setTimeout(() => {
            const params = new URLSearchParams(window.location.search);
            const redirect = params.get('redirect');
            const baseUrl = window.location.origin;
            const defaultUrl = baseUrl + '/home';
            const targetUrl = redirect ? decodeURIComponent(redirect) : defaultUrl;
            window.location.href = targetUrl;
          }, 1000);
        } else {
          throw new Error(data.error || 'Login failed');
        }
      } catch (error) {
        status.className = 'status error';
        status.textContent = '❌ ' + error.message;
        loginBtn.disabled = false;
        loginBtn.classList.add('active');
        loginBtn.innerHTML = 'Continue';
      }
    });
  </script>
</body>
</html>
  `;
  res.send(html);
});

// Bridge: create session via Playwright-authenticated context
authRouter.post('/api/bridge/sessions', async (req, res) => {
  let browser;
  try {
    if (!fs.existsSync(STORAGE_FILE)) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Launch a lightweight browser context with stored auth
    browser = await chromium.launch({ 
      headless: false, 
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ] 
    });
    const context = await browser.newContext({ storageState: STORAGE_FILE });

    // Use context.request to leverage the authenticated browser context
    const upstream = await context.request.post('https://api2.heygen.com/v2/video_agent/sessions', {
      data: req.body || {},
      headers: {
        'origin': 'https://app.heygen.com',
        'referer': 'https://app.heygen.com/home',
        'accept': 'application/json, text/plain, */*',
        'content-type': 'application/json'
      }
    });

    const status = upstream.status();
    let json;
    try {
      json = await upstream.json();
    } catch {
      json = { ok: upstream.ok(), status };
    }

    await context.close();
    await browser.close();
    return res.status(status).json(json);
  } catch (err) {
    console.error('Bridge error:', err);
    if (browser) { try { await browser.close(); } catch (_) {} }
    return res.status(500).json({ error: 'Bridge request failed', detail: String(err) });
  }
});

// Login API endpoint - validates user and ensures HeyGen session
authRouter.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.json({ success: false, error: 'Email and password required' });
  }
  
  console.log('🔑 Attempting login for:', email);
  
  try {
    // Step 1: Validate user credentials against users.json
    const user = validateUser(email, password);
    
    if (!user) {
      console.log('❌ Invalid credentials for:', email);
      return res.json({ 
        success: false, 
        error: 'Invalid email or password' 
      });
    }
    
    console.log('✅ User validated:', user.username);
    
    // Step 2: Check if HeyGen cookies need refresh (only if expiring within 2 hours)
    const TWO_HOURS = 2 * 60 * 60 * 1000; // 2 hours in milliseconds
    const needsRefresh = !cookieExpiry || (Date.now() + TWO_HOURS) >= cookieExpiry;
    
    if (needsRefresh) {
      console.log('🔄 Session expiring soon or missing, refreshing...');
      try {
        await refreshSession();
      } catch (refreshError) {
        console.error('❌ Failed to refresh session:', refreshError.message);
        return res.json({ 
          success: false, 
          error: 'Failed to establish session. Please check .env credentials.' 
        });
      }
    } else {
      const timeUntilExpiry = Math.floor((cookieExpiry - Date.now()) / (60 * 60 * 1000));
      console.log(`✅ Session still valid (expires in ~${timeUntilExpiry} hours)`);
    }
    
    // Step 3: Issue browser token cookie with unique session ID
    const sessionId = crypto.randomUUID(); // Generate unique session ID for this login
    console.log(`🔑 Generated session ID for ${user.email}: ${sessionId}`);
    const token = signToken({ 
      id: user.id, 
      email: user.email, 
      username: user.username, 
      role: user.role,
      sessionId: sessionId // Add unique session ID to allow concurrent logins
    });
    const isProduction = process.env.NODE_ENV === 'production';
    const cookie = [
      `arena_token=${token}`,
      'HttpOnly',
      'Path=/',
      isProduction ? 'SameSite=None' : 'SameSite=Lax',
      isProduction ? 'Secure' : '',
      // 7 days
      'Max-Age=604800'
    ].filter(Boolean).join('; ');
    res.setHeader('Set-Cookie', cookie);

    // Return success
    res.json({ 
      success: true, 
      message: 'Login successful',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    });
    
  } catch (error) {
    console.error('❌ Login error:', error.message);
    
    res.json({ 
      success: false, 
      error: error.message || 'Login failed' 
    });
  }
});

// Check session status
authRouter.get('/api/status', (req, res) => {
  const user = getUserFromRequest(req);
  res.json({ 
    userAuthenticated: !!user,
    user: user ? { id: user.id, email: user.email, username: user.username, role: user.role } : null,
    sessionAuthenticated: isAuthenticated(),
    cookies: sessionCookies ? sessionCookies.length : 0
  });
});

// Logout endpoint
authRouter.post('/api/logout', (req, res) => {
  if (fs.existsSync(STORAGE_FILE)) {
    fs.unlinkSync(STORAGE_FILE);
  }
  if (fs.existsSync(COOKIES_FILE)) {
    fs.unlinkSync(COOKIES_FILE);
  }
  sessionCookies = null;
  // Clear browser token cookie
  res.setHeader('Set-Cookie', 'arena_token=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
  console.log('🚪 Logged out');
  res.json({ success: true });
});

// Get cookies for proxy
authRouter.get('/api/cookies', (req, res) => {
  if (isAuthenticated()) {
    res.json({ cookies: sessionCookies });
  } else {
    res.status(401).json({ error: 'Not authenticated' });
  }
});

// Submit prompt via Playwright
authRouter.post('/api/submit-prompt', async (req, res) => {
  const { prompt } = req.body;
  
  if (!prompt) {
    return res.json({ success: false, error: 'Prompt is required' });
  }
  
  // Check and refresh HeyGen session if needed
  if (!isAuthenticated()) {
    console.log('⚠️  Session expired, refreshing...');
    try {
      await refreshSession();
    } catch (refreshError) {
      console.error('❌ Failed to refresh session:', refreshError.message);
      return res.json({ 
        success: false, 
        error: 'Session expired. Please check .env credentials.' 
      });
    }
  }
  
  console.log('📝 Submitting prompt:', prompt);
  
  // Send request to proxy server - the proxy has the single browser instance
  try {
    const requestContext = await pwRequest.newContext();
    const baseUrl = req.baseUrl || 'http://localhost:3000';
    const headers = { 'Content-Type': 'application/json' };
    if (req.headers.referer) {
      headers['Referer'] = req.headers.referer;
    }
    
    // CRITICAL: Forward authentication cookie to proxy server
    if (req.headers.cookie) {
      headers['Cookie'] = req.headers.cookie;
    }
    
    const proxyResponse = await requestContext.post(`${baseUrl}/proxy/submit-prompt`, {
      data: { prompt },
      headers: headers
    });
    
    const proxyData = await proxyResponse.json();
    await requestContext.dispose();
    
    if (proxyData.success) {
      return res.json({
        success: true,
        sessionPath: proxyData.sessionPath,
        sessionUrl: proxyData.sessionUrl
      });
    } else {
      throw new Error(proxyData.error || 'Proxy request failed');
    }
  } catch (proxyError) {
    console.error('❌ Proxy server error:', proxyError.message);
    return res.json({ 
      success: false, 
      error: 'Proxy server not available. Please ensure the unified server is running.' 
    });
  }
});

// Export the auth server module
export { authRouter, isAuthenticated, sessionCookies };
