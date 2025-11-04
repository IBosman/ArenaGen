// Puppeteer-based approach: Load HeyGen and rebrand it
// This creates a local server that serves the rebranded version

import puppeteer from 'puppeteer';
import express from 'express';
import { load } from 'cheerio';

const TARGET_URL = 'https://app.heygen.com/home';
const PORT = 3001;

const BRANDING = {
  oldName: 'HeyGen',
  newName: 'VideoAI Pro',
  primaryColor: '#6366f1',
  secondaryColor: '#8b5cf6'
};

class PuppeteerRebrander {
  constructor() {
    this.browser = null;
    this.page = null;
    this.cachedContent = null;
  }

  async initialize() {
    console.log('🚀 Launching browser...');
    this.browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process'
      ]
    });
    
    this.page = await this.browser.newPage();
    
    // Set viewport
    await this.page.setViewport({ width: 1920, height: 1080 });
    
    // Set user agent
    await this.page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
  }

  async fetchAndRebrand() {
    console.log('📥 Fetching content from:', TARGET_URL);
    
    try {
      // Navigate to the page
      await this.page.goto(TARGET_URL, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      
      // Wait for main content to load
      await this.page.waitForSelector('body', { timeout: 10000 });
      
      // Inject rebranding script
      await this.page.evaluate((branding) => {
        // Replace all text
        function replaceText(element) {
          const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
            null,
            false
          );
          
          let node;
          while (node = walker.nextNode()) {
            if (node.textContent.includes(branding.oldName)) {
              node.textContent = node.textContent.replace(
                new RegExp(branding.oldName, 'gi'),
                branding.newName
              );
            }
          }
        }
        
        // Apply branding
        replaceText(document.body);
        
        // Change colors
        const style = document.createElement('style');
        style.textContent = `
          :root {
            --primary-color: ${branding.primaryColor} !important;
            --secondary-color: ${branding.secondaryColor} !important;
          }
          button[class*="primary"],
          .btn-primary {
            background-color: ${branding.primaryColor} !important;
          }
        `;
        document.head.appendChild(style);
        
        // Hide original logos
        document.querySelectorAll('img').forEach(img => {
          if (img.src.toLowerCase().includes('heygen') || 
              img.alt.toLowerCase().includes('heygen')) {
            img.style.display = 'none';
          }
        });
      }, BRANDING);
      
      // Get the modified HTML
      const html = await this.page.content();
      
      // Get all resources (CSS, JS, images)
      const resources = await this.page.evaluate(() => {
        const res = {
          scripts: [],
          styles: [],
          images: []
        };
        
        document.querySelectorAll('script[src]').forEach(s => {
          res.scripts.push(s.src);
        });
        
        document.querySelectorAll('link[rel="stylesheet"]').forEach(l => {
          res.styles.push(l.href);
        });
        
        document.querySelectorAll('img[src]').forEach(i => {
          res.images.push(i.src);
        });
        
        return res;
      });
      
      this.cachedContent = {
        html: this.rebrandHTML(html),
        resources
      };
      
      console.log('✅ Content fetched and rebranded');
      return this.cachedContent;
      
    } catch (error) {
      console.error('❌ Error fetching content:', error.message);
      throw error;
    }
  }

  rebrandHTML(html) {
    // Use cheerio for server-side HTML manipulation
    const $ = load(html);
    
    // Replace text content
    $('*').each((i, elem) => {
      $(elem).contents().filter(function() {
        return this.type === 'text';
      }).each(function() {
        const text = $(this).text();
        if (text.includes(BRANDING.oldName)) {
          $(this).replaceWith(
            text.replace(new RegExp(BRANDING.oldName, 'gi'), BRANDING.newName)
          );
        }
      });
    });
    
    // Update title
    $('title').text($('title').text().replace(
      new RegExp(BRANDING.oldName, 'gi'),
      BRANDING.newName
    ));
    
    // Inject custom styles
    $('head').append(`
      <style>
        :root {
          --primary-color: ${BRANDING.primaryColor} !important;
          --secondary-color: ${BRANDING.secondaryColor} !important;
        }
        img[src*="heygen"],
        img[alt*="heygen" i] {
          display: none !important;
        }
        button[class*="primary"],
        .btn-primary {
          background-color: ${BRANDING.primaryColor} !important;
        }
      </style>
    `);
    
    return $.html();
  }

  async takeScreenshot(outputPath = 'screenshot.png') {
    console.log('📸 Taking screenshot...');
    await this.page.screenshot({
      path: outputPath,
      fullPage: true
    });
    console.log('✅ Screenshot saved to:', outputPath);
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      console.log('🔒 Browser closed');
    }
  }
}

// Create Express server to serve rebranded content
async function startServer() {
  const app = express();
  const rebrander = new PuppeteerRebrander();
  
  await rebrander.initialize();
  
  app.get('/', async (req, res) => {
    try {
      if (!rebrander.cachedContent) {
        await rebrander.fetchAndRebrand();
      }
      
      res.send(rebrander.cachedContent.html);
    } catch (error) {
      res.status(500).send(`
        <h1>Error loading content</h1>
        <p>${error.message}</p>
        <p>This might be due to authentication requirements or rate limiting.</p>
      `);
    }
  });
  
  app.get('/refresh', async (req, res) => {
    try {
      await rebrander.fetchAndRebrand();
      res.send('Content refreshed! <a href="/">View</a>');
    } catch (error) {
      res.status(500).send('Error: ' + error.message);
    }
  });
  
  app.get('/screenshot', async (req, res) => {
    try {
      await rebrander.takeScreenshot('public/screenshot.png');
      res.send('Screenshot taken! Check public/screenshot.png');
    } catch (error) {
      res.status(500).send('Error: ' + error.message);
    }
  });
  
  app.listen(PORT, () => {
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║  🎭 Puppeteer Rebranding Server                       ║');
    console.log('╠════════════════════════════════════════════════════════╣');
    console.log(`║  Local URL:    http://localhost:${PORT}                   ║`);
    console.log(`║  Target:       ${TARGET_URL}      ║`);
    console.log(`║  Refresh:      http://localhost:${PORT}/refresh           ║`);
    console.log(`║  Screenshot:   http://localhost:${PORT}/screenshot        ║`);
    console.log('╠════════════════════════════════════════════════════════╣');
    console.log('║  ⚠️  Educational purposes only                         ║');
    console.log('╚════════════════════════════════════════════════════════╝');
  });
  
  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down...');
    await rebrander.close();
    process.exit(0);
  });
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer().catch(console.error);
}

export { PuppeteerRebrander };
