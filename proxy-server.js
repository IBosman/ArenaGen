// Enhanced Reverse Proxy for HeyGen Rebranding
// This intercepts all traffic and modifies it on-the-fly

import express from 'express';
import { createProxyMiddleware, responseInterceptor } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TARGET = 'https://app.heygen.com';
const PORT = 3000;

const app = express();

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
  logoUrl: '/custom-assets/logo.png'
};

// Main proxy middleware
app.use(
  '/',
  createProxyMiddleware({
    target: TARGET,
    changeOrigin: true,
    selfHandleResponse: true,
    ws: true, // Enable WebSocket proxying
    
    onProxyReq: (proxyReq, req, res) => {
      // Modify request headers to avoid detection
      proxyReq.setHeader('referer', TARGET);
      proxyReq.setHeader('origin', TARGET);
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
      
      // Text replacements
      body = body.replace(new RegExp(BRANDING.oldName, 'gi'), BRANDING.newName);
      body = body.replace(new RegExp(BRANDING.oldDomain, 'gi'), BRANDING.newDomain);
      
      // Inject custom code for HTML pages
      if (contentType.includes('text/html')) {
        const customCode = generateCustomCode();
        
        // Try to inject before </head>, fallback to before </body>
        if (body.includes('</head>')) {
          body = body.replace('</head>', customCode + '</head>');
        } else if (body.includes('</body>')) {
          body = body.replace('</body>', customCode + '</body>');
        }
      }
      
      return body;
    })
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
        
        // Replace all logos
        function replaceAllLogos() {
          document.querySelectorAll('img').forEach(replaceLogo);
        }
        
        // Replace all text
        function replaceAllText() {
          replaceText(document.body);
        }
        
        // Initial replacement
        function initialize() {
          replaceAllText();
          replaceAllLogos();
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
        
        // Intercept fetch requests (optional - for API rebranding)
        const originalFetch = window.fetch;
        window.fetch = function(...args) {
          console.log('Fetch intercepted:', args[0]);
          return originalFetch.apply(this, args);
        };
        
      })();
    </script>
  `;
}

app.listen(PORT, () => {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║  🎨 HeyGen Rebranding Proxy Server                    ║');
  console.log('╠════════════════════════════════════════════════════════╣');
  console.log(`║  Local URL:    http://localhost:${PORT}                   ║`);
  console.log(`║  Target:       ${TARGET}                  ║`);
  console.log(`║  New Brand:    ${BRANDING.newName}                      ║`);
  console.log('╠════════════════════════════════════════════════════════╣');
  console.log('║  ⚠️  Educational purposes only                         ║');
  console.log('║  May violate Terms of Service                         ║');
  console.log('╚════════════════════════════════════════════════════════╝');
});
