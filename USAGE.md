# Usage Guide

## 🚀 Getting Started

### Step 1: Install Dependencies

```bash
npm install
```

This will install:
- `express` - Web server
- `http-proxy-middleware` - Reverse proxy
- `puppeteer` - Headless browser
- `cheerio` - HTML parsing

### Step 2: Choose Your Method

#### Option A: Reverse Proxy (Recommended)

**Best for:**
- Real-time interaction
- Maintaining all functionality
- Production-like experience

**Start the server:**
```bash
npm run proxy
```

**Access:**
```
http://localhost:3000
```

#### Option B: Puppeteer Scraping

**Best for:**
- Static content
- Screenshots
- Offline viewing

**Start the server:**
```bash
npm run puppeteer
```

**Access:**
```
http://localhost:3001
http://localhost:3001/refresh    # Refresh content
http://localhost:3001/screenshot # Take screenshot
```

## 🎨 Customization Guide

### 1. Basic Branding

Edit `config.js`:

```javascript
branding: {
  name: 'Your Brand Name',
  colors: {
    primary: '#YOUR_COLOR',
    secondary: '#YOUR_COLOR'
  }
}
```

### 2. Custom Logo

1. Create your logo (PNG, 200x50px recommended)
2. Save as `custom-assets/logo.png`
3. Update config if using different filename

### 3. Advanced CSS

Create `custom-assets/custom.css`:

```css
/* Your custom styles */
.custom-class {
  background: linear-gradient(to right, #6366f1, #8b5cf6);
}
```

### 4. Text Replacements

Add to `config.js`:

```javascript
replacements: [
  {
    pattern: /Original Text/gi,
    replacement: 'New Text'
  }
]
```

## 🔧 Advanced Configuration

### Modify Proxy Behavior

Edit `proxy-server.js`:

```javascript
// Add custom middleware
app.use((req, res, next) => {
  console.log('Request:', req.url);
  next();
});

// Modify specific routes
app.get('/api/*', (req, res) => {
  // Custom API handling
});
```

### Puppeteer Options

Edit `puppeteer-rebrand.js`:

```javascript
const browser = await puppeteer.launch({
  headless: false,  // Show browser
  slowMo: 100,      // Slow down by 100ms
  devtools: true    // Open DevTools
});
```

## 🐛 Troubleshooting

### Issue: "Cannot connect to proxy"

**Solution:**
```bash
# Check if port 3000 is in use
lsof -i :3000

# Kill the process if needed
kill -9 <PID>

# Restart proxy
npm run proxy
```

### Issue: "Authentication required"

**Solution:**
HeyGen requires login. You have two options:

1. **Manual cookies:**
   - Login to HeyGen in your browser
   - Copy cookies from DevTools
   - Add to proxy headers

2. **Automated login:**
   - Add credentials to `.env` file
   - Implement login automation in Puppeteer

Example `.env`:
```
HEYGEN_EMAIL=your@email.com
HEYGEN_PASSWORD=yourpassword
```

### Issue: "Content not loading"

**Solution:**
```bash
# Check if target is accessible
curl -I https://app.heygen.com

# Test proxy
node test-proxy.js

# Enable verbose logging
# In proxy-server.js, set:
features.verboseLogging = true
```

### Issue: "Styles not applying"

**Solution:**
1. Check browser console for CSP errors
2. Verify custom CSS is loaded
3. Use `!important` in CSS rules
4. Clear browser cache

### Issue: "Puppeteer crashes"

**Solution:**
```bash
# Install dependencies (Linux)
sudo apt-get install -y \
  chromium-browser \
  libx11-xcb1 \
  libxcomposite1 \
  libxcursor1 \
  libxdamage1 \
  libxi6 \
  libxtst6 \
  libnss3 \
  libcups2 \
  libxss1 \
  libxrandr2 \
  libasound2 \
  libatk1.0-0 \
  libgtk-3-0

# Or use system Chrome
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
export PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
```

## 📊 Testing

### Test Proxy Server

```bash
node test-proxy.js
```

Expected output:
```
✅ Status Code: 200
✅ Contains "VideoAI Pro"
✅ Custom script injected
✅ Proxy is working correctly!
```

### Manual Testing

1. **Text replacement:**
   - Search page for "HeyGen"
   - Should find "VideoAI Pro" instead

2. **Color changes:**
   - Inspect primary buttons
   - Should have your custom color

3. **Logo replacement:**
   - Check header logo
   - Should show your logo

## 🔐 Authentication Setup

### Method 1: Cookie Forwarding

```javascript
// In proxy-server.js
onProxyReq: (proxyReq, req, res) => {
  // Forward cookies from your browser
  proxyReq.setHeader('cookie', 'YOUR_COOKIES_HERE');
}
```

### Method 2: Automated Login

```javascript
// In puppeteer-rebrand.js
async login() {
  await this.page.goto('https://app.heygen.com/login');
  await this.page.type('#email', process.env.HEYGEN_EMAIL);
  await this.page.type('#password', process.env.HEYGEN_PASSWORD);
  await this.page.click('button[type="submit"]');
  await this.page.waitForNavigation();
}
```

## 📈 Performance Optimization

### Enable Caching

```javascript
// In proxy-server.js
const cache = new Map();

app.use((req, res, next) => {
  const cached = cache.get(req.url);
  if (cached) {
    return res.send(cached);
  }
  next();
});
```

### Compress Responses

```bash
npm install compression
```

```javascript
import compression from 'compression';
app.use(compression());
```

### Limit Resource Loading

```javascript
// In puppeteer-rebrand.js
await this.page.setRequestInterception(true);
this.page.on('request', (req) => {
  if (req.resourceType() === 'image') {
    req.abort();  // Skip images
  } else {
    req.continue();
  }
});
```

## 🎯 Use Cases

### 1. White-label Demo
Show clients how their branding would look

### 2. A/B Testing
Test different color schemes and layouts

### 3. Learning
Understand how modern web apps work

### 4. Accessibility Testing
Add accessibility features to existing sites

## ⚠️ Important Notes

1. **Legal:** This is for educational purposes only
2. **Ethics:** Don't use for commercial purposes
3. **Security:** Don't expose proxy publicly
4. **Performance:** Proxy adds latency
5. **Maintenance:** Site updates will break rebranding

## 🆘 Getting Help

If you encounter issues:

1. Check the console for errors
2. Review browser DevTools Network tab
3. Test with `curl` or `test-proxy.js`
4. Check if target site is accessible
5. Verify all dependencies are installed

## 📚 Further Reading

- [Reverse Proxy Patterns](https://www.nginx.com/blog/introduction-to-microservices/)
- [Puppeteer Best Practices](https://pptr.dev/guides/best-practices)
- [Web Scraping Ethics](https://www.scrapehero.com/web-scraping-legal/)
- [HTTP Proxy Middleware](https://github.com/chimurai/http-proxy-middleware)

---

**Happy rebranding! 🎨**
