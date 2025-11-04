// Centralized configuration for rebranding

export const config = {
  // Target website
  target: {
    url: 'https://app.heygen.com',
    domain: 'heygen.com',
    name: 'HeyGen'
  },
  
  // Your branding
  branding: {
    name: 'VideoAI Pro',
    domain: 'localhost:3000',
    tagline: 'AI-Powered Video Generation',
    
    // Colors (use hex codes)
    colors: {
      primary: '#6366f1',      // Indigo
      secondary: '#8b5cf6',    // Purple
      accent: '#ec4899',       // Pink
      success: '#10b981',      // Green
      warning: '#f59e0b',      // Amber
      danger: '#ef4444',       // Red
      background: '#ffffff',   // White
      text: '#1f2937'          // Dark gray
    },
    
    // Assets
    assets: {
      logo: '/custom-assets/logo.png',
      favicon: '/custom-assets/favicon.ico',
      customCSS: '/custom-assets/custom.css'
    }
  },
  
  // Server configuration
  server: {
    proxyPort: 3000,
    puppeteerPort: 3001,
    host: 'localhost'
  },
  
  // Feature flags
  features: {
    enableWebSocket: true,
    enableCaching: true,
    enableScreenshots: true,
    enableAPIInterception: false,
    verboseLogging: false
  },
  
  // Text replacements
  replacements: [
    {
      pattern: /HeyGen/gi,
      replacement: 'VideoAI Pro'
    },
    {
      pattern: /heygen\.com/gi,
      replacement: 'localhost:3000'
    },
    // Add more custom replacements here
    {
      pattern: /Create your avatar/gi,
      replacement: 'Create your AI avatar'
    }
  ],
  
  // CSS selectors to hide
  hideSelectors: [
    'img[src*="heygen"]',
    'img[alt*="heygen" i]',
    '[data-brand="heygen"]',
    // Add more selectors to hide
  ],
  
  // Elements to modify
  modifySelectors: {
    buttons: {
      selector: 'button[class*="primary"], .btn-primary',
      styles: {
        backgroundColor: '#6366f1',
        borderColor: '#6366f1'
      }
    },
    links: {
      selector: 'a[class*="primary"]',
      styles: {
        color: '#6366f1'
      }
    }
  },
  
  // Puppeteer options
  puppeteer: {
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process'
    ],
    viewport: {
      width: 1920,
      height: 1080
    },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  },
  
  // Proxy options
  proxy: {
    changeOrigin: true,
    followRedirects: true,
    timeout: 30000,
    
    // Headers to remove
    removeHeaders: [
      'content-security-policy',
      'content-security-policy-report-only',
      'x-frame-options'
    ],
    
    // Headers to add
    addHeaders: {
      'X-Rebranded-By': 'VideoAI-Pro'
    }
  }
};

export default config;
