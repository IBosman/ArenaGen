// Enhanced Reverse Proxy with Authentication Support
// Uses cookies from auth-server for authenticated requests

import express from 'express';
import { createProxyMiddleware, responseInterceptor } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TARGET = 'https://app.heygen.com';
const PORT = 3000;
const COOKIES_FILE = path.join(__dirname, 'heygen-cookies.json');

const app = express();

// Proxy for api2.heygen.com to ensure Origin and Referer are set correctly
// Route: http://localhost:3000/__api2/... -> https://api2.heygen.com/...
app.use(
  '/__api2',
  createProxyMiddleware({
    target: 'https://api2.heygen.com',
    changeOrigin: true,
    pathRewrite: { '^/__api2': '' },
    selfHandleResponse: false,
    ws: true,
    onProxyReq: (proxyReq, req, res) => {
      proxyReq.setHeader('origin', 'https://app.heygen.com');
      proxyReq.setHeader('referer', 'https://app.heygen.com/');
      proxyReq.setHeader('host', 'api2.heygen.com');
      if (authCookies && authCookies.length > 0) {
        const cookieStr = cookiesToHeader(authCookies);
        proxyReq.setHeader('cookie', cookieStr);
      }
    }
  })
);

// Also proxy api.heygen.com through /__api
app.use(
  '/__api',
  createProxyMiddleware({
    target: 'https://api.heygen.com',
    changeOrigin: true,
    pathRewrite: { '^/__api': '' },
    selfHandleResponse: false,
    ws: true,
    onProxyReq: (proxyReq, req, res) => {
      proxyReq.setHeader('origin', 'https://app.heygen.com');
      proxyReq.setHeader('referer', 'https://app.heygen.com/');
      proxyReq.setHeader('host', 'api.heygen.com');
      if (authCookies && authCookies.length > 0) {
        const cookieStr = cookiesToHeader(authCookies);
        proxyReq.setHeader('cookie', cookieStr);
      }
    }
  })
);

// Bridge to auth-server so frontend can call Playwright-backed endpoints same-origin
// Route: http://localhost:3000/__bridge/* -> http://localhost:3002/api/*
app.use(
  '/__bridge',
  createProxyMiddleware({
    target: 'http://localhost:3002',
    changeOrigin: true,
    pathRewrite: { '^/__bridge': '/api/bridge' },
    selfHandleResponse: false
  })
);

// Load cookies from auth server
function loadCookies() {
  if (fs.existsSync(COOKIES_FILE)) {
    try {
      const cookies = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
      console.log('✅ Loaded authentication cookies');
      return cookies;
    } catch (err) {
      console.error('❌ Error loading cookies:', err);
    }
  }
  return null;
}

// Convert Playwright cookies to Cookie header string
function cookiesToHeader(cookies) {
  if (!cookies || !Array.isArray(cookies)) return '';
  return cookies
    .map(cookie => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

let authCookies = loadCookies();
const cookieHeader = cookiesToHeader(authCookies);

// Serve custom assets (logos, CSS, etc.)
app.use('/custom-assets', express.static(path.join(__dirname, 'custom-assets')));

// Branding configuration
const BRANDING = {
  oldName: 'HeyGen',
  newName: 'VideoAI Pro',
  oldDomain: 'heygen.com',
  newDomain: 'localhost:3000',
  primaryColor: '#6366f1', // Indigo
  secondaryColor: '#8b5cf6', // Purple
  logoUrl: '/custom-assets/logo.svg'
};

// Check authentication middleware
app.use((req, res, next) => {
  // Skip auth check for custom assets
  if (req.path.startsWith('/custom-assets')) {
    return next();
  }
  
  // Reload cookies on each request (in case auth-server updated them)
  const freshCookies = loadCookies();
  if (freshCookies) {
    authCookies = freshCookies;
  }
  
  // If no auth cookies, redirect to login
  if (!authCookies || authCookies.length === 0) {
    console.log('⚠️  No authentication found, redirecting to login...');
    return res.redirect('http://localhost:3002');
  }
  
  next();
});

// Main proxy middleware
app.use(
  '/',
  createProxyMiddleware({
    target: TARGET,
    changeOrigin: true,
    selfHandleResponse: true,
    ws: true, // Enable WebSocket proxying
    
    onProxyReq: (proxyReq, req, res) => {
      // Inject authentication cookies
      if (authCookies && authCookies.length > 0) {
        const cookieStr = cookiesToHeader(authCookies);
        proxyReq.setHeader('cookie', cookieStr);
        console.log('🍪 Injected auth cookies');
      }
      
      // Modify request headers to avoid detection
      proxyReq.setHeader('referer', TARGET);
      proxyReq.setHeader('origin', TARGET);
      
      // Log request
      console.log(`→ ${req.method} ${req.url}`);
    },
    
    onProxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
      const contentType = proxyRes.headers['content-type'] || '';
      
      // Remove security headers that block our modifications
      delete proxyRes.headers['content-security-policy'];
      delete proxyRes.headers['content-security-policy-report-only'];
      delete proxyRes.headers['x-frame-options'];
      
      // Only modify HTML and JavaScript responses
      if (!contentType.includes('text/html') && !contentType.includes('application/javascript')) {
        return responseBuffer;
      }
      
      let body = responseBuffer.toString('utf8');
      
      // Inject modifications ONLY for HTML pages to avoid breaking JS bundles
      if (contentType.includes('text/html')) {
        // ULTRA-EARLY injection: prototype-level interceptor (runs before any app code)
        try {
          const ultraEarlyScript = '\n<script>(function(){\n  console.log("[PROXY-ULTRA-EARLY] Ultra-early interceptor starting");\n  var HOST_MAP = [{host:"api2.heygen.com",prefix:"/__api2"},{host:"api.heygen.com",prefix:"/__api"}];\n  function mapUrl(u){try{var x=new URL(u, location.href);if(x.hostname==="api2.heygen.com"||x.hostname==="api.heygen.com"){if(x.pathname==="/v2/video_agent/sessions") return "/__bridge/sessions";var p=x.hostname==="api2.heygen.com"?"/__api2":"/__api";return p+x.pathname+x.search;}}catch(e){}return null;}\n  var origFetch=window.fetch;window.fetch=function(i,init){var m=typeof i==="string"?mapUrl(i):i instanceof URL?mapUrl(i.href):i instanceof Request?mapUrl(i.url):null;if(m){console.log("[PROXY-ULTRA-EARLY-FETCH] Intercepted:", i, "->", m);if(i instanceof Request){return origFetch(new Request(m,i));}return origFetch(m,init);}return origFetch(i,init);}\n  var origXHROpen=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u,a,user,pw){var mu=mapUrl(u);if(mu){console.log("[PROXY-ULTRA-EARLY-XHR] Intercepted:", m, u, "->", mu);}return origXHROpen.call(this,m,mu||u,a!==false,user,pw)};\n  console.log("[PROXY-ULTRA-EARLY] Interceptor ready");\n})();</script>';
          body = body.replace(/<head(\b[^>]*)>/i, (m) => m + ultraEarlyScript);
        } catch(_) {}

        // EARLY injection: minimal API rewriter (inserted immediately after <head>)
        try {
          const earlyScript = `\n<script>(function(){\n  console.log('[PROXY-EARLY] Early rewriter injected and active');\n  function mapUrl(u){\n    try{\n      var x=new URL(u, location.href);\n      if(x.hostname==='api2.heygen.com'||x.hostname==='api.heygen.com'){\n        if(x.pathname==='/v2/video_agent/sessions') return '/__bridge/sessions';\n        var prefix = x.hostname==='api2.heygen.com' ? '/__api2' : '/__api';\n        return prefix + x.pathname + x.search;\n      }\n    }catch(e){}\n    return null;\n  }\n  var ofetch=window.fetch; window.fetch=function(i,init){try{if(i instanceof Request){var m=mapUrl(i.url); if(m){console.log('[PROXY-EARLY-FETCH] Rewriting Request:', i.url, '->', m); return ofetch(new Request(m,i));}}else if(typeof i==='string'||i instanceof URL){var m2=mapUrl(i); if(m2){console.log('[PROXY-EARLY-FETCH] Rewriting URL:', i, '->', m2); return ofetch(m2,init);}}}catch(e){console.error('[PROXY-EARLY-FETCH-ERROR]', e)} return ofetch(i,init);};\n  var oopen=XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open=function(m,u,a,user,pw){var mu=mapUrl(u); if(mu){console.log('[PROXY-EARLY-XHR] Rewriting XHR:', m, u, '->', mu);} return oopen.call(this,m,mu||u,a!==false,user,pw)};\n  if(navigator.sendBeacon){var sb=navigator.sendBeacon.bind(navigator); navigator.sendBeacon=function(u,d){var mu=mapUrl(u); if(mu){console.log('[PROXY-EARLY-BEACON] Rewriting beacon:', u, '->', mu);} return sb(mu||u,d);};\n  if('WebSocket' in window){var _WS=window.WebSocket; window.WebSocket=function(url,protocols){try{var mu=mapUrl(url); if(mu){console.log('[PROXY-EARLY-WS] Rewriting WebSocket:', url, '->', mu); return new _WS(mu,protocols);}}catch(e){} return new _WS(url,protocols)}; window.WebSocket.prototype=_WS.prototype;}\n  if('EventSource' in window){var _ES=window.EventSource; window.EventSource=function(url,config){try{var mu=mapUrl(url); if(mu){console.log('[PROXY-EARLY-ES] Rewriting EventSource:', url, '->', mu); return new _ES(mu,config);}}catch(e){} return new _ES(url,config)}; window.EventSource.prototype=_ES.prototype;}\n  if('serviceWorker' in navigator){try{navigator.serviceWorker.getRegistrations().then(r=>r.forEach(x=>x.unregister())).catch(()=>{}); if(navigator.serviceWorker.register){navigator.serviceWorker.register=function(){return Promise.resolve({unregister(){return Promise.resolve(true)}});};}}catch(e){}}}\n})();</script>`;
          body = body.replace(/<head(\b[^>]*)>/i, (m) => m + earlyScript);
        } catch(_) {}

        // Text/domain replacements (safe for HTML only)
        body = body.replace(new RegExp(BRANDING.oldName, 'gi'), BRANDING.newName);
        body = body.replace(new RegExp(BRANDING.oldDomain, 'gi'), BRANDING.newDomain);
        
        const customCode = generateCustomCode();
        
        // Try to inject before </head>, fallback to before </body>
        if (body.includes('</head>')) {
          body = body.replace('</head>', customCode + '</head>');
        } else if (body.includes('</body>')) {
          body = body.replace('</body>', customCode + '</body>');
        }
      }
      
      // Set CSP to allow api2/api.heygen.com (rewriter will intercept), disable workers
      if (contentType.includes('text/html')) {
        const csp = [
          "default-src 'self'",
          "connect-src 'self' https://api2.heygen.com https://api.heygen.com",
          "img-src 'self' https://app.heygen.com data: blob:",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data:",
          "style-src 'self' 'unsafe-inline'",
          "font-src 'self' data:",
          "media-src 'self' blob:",
          "frame-src 'self' https://app.heygen.com",
          "worker-src 'none'",
          "child-src 'self'",
          "base-uri 'self'",
          "frame-ancestors 'self'"
        ].join('; ');
        res.setHeader('Content-Security-Policy', csp);
      }

      return body;
    }),
    
    onError: (err, req, res) => {
      console.error('❌ Proxy error:', err.message);
      
      // If authentication error, redirect to login
      if (err.message.includes('401') || err.message.includes('403')) {
        console.log('🔒 Authentication error, redirecting to login...');
        res.redirect('http://localhost:3002');
      } else {
        res.status(500).send(`
          <h1>Proxy Error</h1>
          <p>${err.message}</p>
          <p><a href="http://localhost:3002">Return to login</a></p>
        `);
      }
    }
  })
);

function generateCustomCode() {
  return `
    <!-- Custom Rebranding Injection -->
    <style id="custom-rebrand-styles">
      /* Override primary colors */
      :root {
        --primary-color: ${BRANDING.primaryColor} !important;
        --secondary-color: ${BRANDING.secondaryColor} !important;
      }
      
      /* Hide original logos */
      img[src*="heygen"],
      img[alt*="heygen" i],
      img[alt*="HeyGen"] {
        display: none !important;
      }
      
      /* Custom branding styles */
      .custom-logo {
        content: url('${BRANDING.logoUrl}');
        max-height: 40px;
      }
      
      /* Override button colors */
      button[class*="primary"],
      .btn-primary,
      [class*="Button_primary"] {
        background-color: ${BRANDING.primaryColor} !important;
        border-color: ${BRANDING.primaryColor} !important;
      }
      
      button[class*="primary"]:hover,
      .btn-primary:hover {
        background-color: ${BRANDING.secondaryColor} !important;
        border-color: ${BRANDING.secondaryColor} !important;
      }
      
      /* Override link colors */
      a[class*="primary"],
      .text-primary {
        color: ${BRANDING.primaryColor} !important;
      }

      /* Hide HeyGen sidebar (attribute selectors for robustness) */
      /* Matches: <div class="tw-flex tw-flex-col ... tw-w-[264px] ... tw-border-r ..."> */
      div[class*="tw-flex"][class*="tw-flex-col"][class*="tw-w-[264px]"][class*="tw-border-r"] {
        display: none !important;
      }
      

      div[class*="tw-flex"][class*="tw-w-full"][class*="tw-max-w-full"][class*="tw-flex-col"][class*="tw-gap-4"][class*="tw-px-2"][class*="tw-pb-10"][class*="tw-pt-4"][class*="sm:tw-px-7"] {
        display: none !important;
      }

      /* Hide top banner on /home (black strip with promo) */
      /* Example element:
         <div class="tw-w-full tw-bg-black tw-px-7 tw-py-4 tw-font-solar tw-flex tw-cursor-pointer tw-items-center tw-justify-between tw-transform tw-gap-4 tw-transition-all tw-duration-500 tw-ease-out tw-translate-y-0 tw-opacity-100"> */
      div[class*="tw-w-full"][class*="tw-bg-black"][class*="tw-px-7"][class*="tw-py-4"][class*="tw-font-solar"][class*="tw-flex"][class*="tw-cursor-pointer"][class*="tw-items-center"][class*="tw-justify-between"][class*="tw-transform"][class*="tw-gap-4"][class*="tw-transition-all"][class*="tw-ease-out"][class*="tw-translate-y-0"][class*="tw-opacity-100"] {
        display: none !important;
      }

      /* Add logout button */
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
        font-size: 14px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        transition: all 0.3s ease;
      }
      
      .custom-logout:hover {
        background: ${BRANDING.secondaryColor};
        transform: translateY(-2px);
        box-shadow: 0 6px 12px rgba(0, 0, 0, 0.15);
      }
    </style>
    
    <script id="custom-rebrand-script">
      (function() {
        'use strict';
        
        console.log('🎨 Rebranding active: ${BRANDING.newName}');
        
        // Configuration
        const config = {
          oldName: '${BRANDING.oldName}',
          newName: '${BRANDING.newName}',
          logoUrl: '${BRANDING.logoUrl}'
        };
        
        // Text replacement function
        function replaceText(node) {
          if (node.nodeType === Node.TEXT_NODE) {
            if (node.textContent.includes(config.oldName)) {
              node.textContent = node.textContent.replace(
                new RegExp(config.oldName, 'gi'),
                config.newName
              );
            }
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            // Skip script and style tags
            if (node.tagName !== 'SCRIPT' && node.tagName !== 'STYLE') {
              for (let child of node.childNodes) {
                replaceText(child);
              }
            }
          }
        }
        
        // Logo replacement function
        function replaceLogo(img) {
          const src = img.src || '';
          const alt = img.alt || '';
          
          if (src.toLowerCase().includes('heygen') || 
              alt.toLowerCase().includes('heygen')) {
            img.src = config.logoUrl;
            img.alt = config.newName;
            img.classList.add('custom-logo');
          }
        }
        
        // --- Security hardening helpers ---
        function blockServiceWorkerRegistration() {
          try {
            if ('serviceWorker' in navigator) {
              const noop = () => Promise.resolve({ unregister(){return Promise.resolve(true)} });
              if (navigator.serviceWorker.register) {
                navigator.serviceWorker.register = noop;
              }
            }
          } catch (_) {}
        }

        function installCSP() { /* no-op: avoid restricting required agent connections */ }

        // Worker patch removed for stability; rely on CSP + main-thread rewriter

        // Rewrite API requests to use local proxy so Origin/Referer are correct
        (function setupApiRewriter(){
          const HOST_MAP = [
            { host: 'api2.heygen.com', prefix: '/__api2' },
            { host: 'api.heygen.com',  prefix: '/__api'  }
          ];

          function toProxiedUrl(input) {
            try {
              const urlObj = typeof input === 'string' ? new URL(input, window.location.href)
                            : input instanceof URL ? input
                            : null;
              if (!urlObj) return input;
              for (const {host, prefix} of HOST_MAP) {
                if (urlObj.hostname === host) {
                  // Special-case: sessions endpoint -> Playwright bridge
                  if (urlObj.pathname === '/v2/video_agent/sessions') {
                    console.log('[PROXY-MAIN] Sessions POST detected, routing to bridge:', input);
                    return '/__bridge/sessions';
                  }
                  const proxied = prefix + urlObj.pathname + urlObj.search;
                  console.log('[PROXY-MAIN] Rewriting', host, 'request:', input, '->', proxied);
                  return proxied;
                }
              }
              // Handle raw string that starts with any host
              if (typeof input === 'string') {
                for (const {host, prefix} of HOST_MAP) {
                  if (input.includes(host)) {
                    const u = new URL(input);
                    if (u.pathname === '/v2/video_agent/sessions') {
                      console.log('[PROXY-MAIN] Sessions POST detected (string), routing to bridge:', input);
                      return '/__bridge/sessions';
                    }
                    const proxied = prefix + u.pathname + u.search;
                    console.log('[PROXY-MAIN] Rewriting', host, 'request (string):', input, '->', proxied);
                    return proxied;
                  }
                }
              }
            } catch (_) {}
            return input;
          }

          // Patch fetch
          const _fetch = window.fetch;
          window.fetch = function(input, init) {
            try {
              if (input instanceof Request) {
                const proxiedUrl = toProxiedUrl(input.url);
                if (proxiedUrl !== input.url) {
                  console.log('[PROXY-MAIN-FETCH] Intercepted Request, rewriting:', input.url, '->', proxiedUrl);
                  const cloned = new Request(proxiedUrl, input);
                  return _fetch(cloned);
                }
              } else if (typeof input === 'string' || input instanceof URL) {
                const proxied = toProxiedUrl(input);
                if (proxied !== input) {
                  console.log('[PROXY-MAIN-FETCH] Intercepted URL/string, rewriting:', input, '->', proxied);
                }
                return _fetch(proxied, init);
              }
            } catch (e) {
              console.error('[PROXY-MAIN-FETCH-ERROR]', e);
            }
            return _fetch(input, init);
          };

          // Patch XMLHttpRequest
          const _open = XMLHttpRequest.prototype.open;
          XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
            const proxied = toProxiedUrl(url);
            if (proxied !== url) {
              console.log('[PROXY-MAIN-XHR] Intercepted XHR:', method, url, '->', proxied);
            }
            return _open.call(this, method, proxied, async !== false, user, password);
          };

          // Patch navigator.sendBeacon
          if (navigator.sendBeacon) {
            const _sendBeacon = navigator.sendBeacon.bind(navigator);
            navigator.sendBeacon = function(url, data) {
              const proxied = toProxiedUrl(url);
              if (proxied !== url) {
                console.log('[PROXY-MAIN-BEACON] Intercepted beacon:', url, '->', proxied);
              }
              return _sendBeacon(proxied, data);
            };
          }

          // Patch WebSocket
          if (window.WebSocket) {
            const _WS = window.WebSocket;
            window.WebSocket = function(url, protocols) {
              const proxied = toProxiedUrl(url);
              if (proxied !== url) {
                console.log('[PROXY-MAIN-WS] Intercepted WebSocket:', url, '->', proxied);
              }
              return new _WS(proxied, protocols);
            };
            window.WebSocket.prototype = _WS.prototype;
          }

          // Patch EventSource (SSE)
          if (window.EventSource) {
            const _ES = window.EventSource;
            window.EventSource = function(url, config) {
              const proxied = toProxiedUrl(url);
              if (proxied !== url) {
                console.log('[PROXY-MAIN-ES] Intercepted EventSource:', url, '->', proxied);
              }
              return new _ES(proxied, config);
            };
            window.EventSource.prototype = _ES.prototype;
          }

          // Unregister existing SW and block re-registration
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(regs => {
              regs.forEach(reg => reg.unregister());
            }).catch(() => {});
          }
          blockServiceWorkerRegistration();
          installCSP();

        })();
        
        // Replace all logos
        function replaceAllLogos() {
          document.querySelectorAll('img').forEach(replaceLogo);
        }
        
        // Logo replacement function
        function replaceLogo(img) {
          const src = img.src || '';
          const alt = img.alt || '';
          
          if (src.toLowerCase().includes('heygen') || 
              alt.toLowerCase().includes('heygen')) {
            img.src = config.logoUrl;
            img.alt = config.newName;
            img.classList.add('custom-logo');
          }
        }
        
        // Replace all text
        function replaceAllText() {
          replaceText(document.body);
        }

        // Hide sidebar helper (works even if classes change order)
        function hideSidebar() {
          try {
            const selector = 'div[class*="tw-flex"][class*="tw-flex-col"][class*="tw-w\\[264px\\]"][class*="tw-border-r"]';
            const el = document.querySelector(selector);
            if (el) {
              el.style.setProperty('display', 'none', 'important');
            }
          } catch (e) {
            console.warn('Sidebar hide error:', e);
          }
        }

        // Hide top banner on /home page
        function hideHomeBanner() {
          const bannerSelector = 'div[class*="tw-w-full"][class*="tw-bg-black"][class*="tw-px-7"][class*="tw-py-4"][class*="tw-font-solar"][class*="tw-flex"][class*="tw-cursor-pointer"][class*="tw-items-center"][class*="tw-justify-between"][class*="tw-transform"][class*="tw-gap-4"][class*="tw-transition-all"][class*="tw-ease-out"][class*="tw-translate-y-0"][class*="tw-opacity-100"]';
          try {
            document.querySelectorAll(bannerSelector).forEach(el => {
              el.style.setProperty('display', 'none', 'important');
              el.setAttribute('data-hidden-by-proxy', 'banner');
            });
          } catch (e) {
            console.warn('Banner hide error:', e);
          }
        }
        
        // Add logout button
        function addLogoutButton() {
          // Check if already exists
          if (document.querySelector('.custom-logout')) return;
          
          const logoutBtn = document.createElement('div');
          logoutBtn.className = 'custom-logout';
          logoutBtn.innerHTML = '🚪 Logout';
          logoutBtn.onclick = async () => {
            if (confirm('Are you sure you want to logout?')) {
              try {
                await fetch('http://localhost:3002/api/logout', { method: 'POST' });
                window.location.href = 'http://localhost:3002';
              } catch (err) {
                console.error('Logout error:', err);
                window.location.href = 'http://localhost:3002';
              }
            }
          };
          document.body.appendChild(logoutBtn);
        }
        
        // Initial replacement
        function initialize() {
          replaceAllText();
          replaceAllLogos();
          addLogoutButton();
          hideSidebar();
          hideHomeBanner();
        }
        
        // Watch for dynamic changes (SPA support)
        const observer = new MutationObserver((mutations) => {
          mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
              if (node.nodeType === Node.ELEMENT_NODE) {
                replaceText(node);
                if (node.tagName === 'IMG') {
                  replaceLogo(node);
                } else {
                  node.querySelectorAll('img').forEach(replaceLogo);
                }
                // Re-apply sidebar hiding on dynamic updates
                hideSidebar();
                hideHomeBanner();
              }
            });
          });
        });
        
        // Start observing
        if (document.body) {
          initialize();
          observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
          });
        } else {
          document.addEventListener('DOMContentLoaded', () => {
            initialize();
            observer.observe(document.body, {
              childList: true,
              subtree: true,
              characterData: true
            });
          });
        }
        
        // Override document.title
        Object.defineProperty(document, 'title', {
          get: function() {
            return this._title || '';
          },
          set: function(value) {
            this._title = value.replace(
              new RegExp(config.oldName, 'gi'),
              config.newName
            );
            document.querySelector('title').textContent = this._title;
          }
        });
        
      })();
    </script>
  `;
}

app.listen(PORT, () => {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║  🎨 VideoAI Pro - Authenticated Proxy Server          ║');
  console.log('╠════════════════════════════════════════════════════════╣');
  console.log(`║  Proxy URL:    http://localhost:${PORT}                   ║`);
  console.log(`║  Target:       ${TARGET}                  ║`);
  console.log(`║  Auth Status:  ${authCookies ? '✅ Authenticated' : '❌ Not authenticated'}              ║`);
  console.log('╠════════════════════════════════════════════════════════╣');
  console.log('║  Flow:                                                 ║');
  console.log('║  1. User logs in at port 3002                         ║');
  console.log('║  2. Playwright authenticates with HeyGen              ║');
  console.log('║  3. Cookies saved and loaded here                     ║');
  console.log('║  4. All requests use authenticated session            ║');
  console.log('╠════════════════════════════════════════════════════════╣');
  console.log('║  ⚠️  Educational purposes only                         ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  
  if (!authCookies) {
    console.log('\n⚠️  No authentication found!');
    console.log('👉 Please login first at: http://localhost:3002\n');
  }
});
