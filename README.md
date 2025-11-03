# HeyGen Rebranding POC

**⚠️ EDUCATIONAL PURPOSES ONLY**

This is a proof-of-concept demonstrating how to rebrand a third-party website using reverse proxy and Puppeteer techniques. This likely violates HeyGen's Terms of Service and should not be used in production.

## 🎯 What This Does

This POC demonstrates two approaches to rebrand `https://app.heygen.com`:

1. **Reverse Proxy Method** - Intercepts HTTP traffic and modifies responses in real-time
2. **Puppeteer Method** - Scrapes and re-renders the site with custom branding

## 🚀 Quick Start

### Installation

```bash
npm install
```

### Method 1: Reverse Proxy (Recommended)

```bash
npm run proxy
```

Then open: `http://localhost:3000`

**Features:**
- ✅ Real-time traffic interception
- ✅ Maintains all functionality
- ✅ WebSocket support
- ✅ Dynamic content rebranding
- ✅ Custom CSS/JS injection

### Method 2: Puppeteer Scraping

```bash
npm run puppeteer
```

Then open: `http://localhost:3001`

**Features:**
- ✅ Full page scraping
- ✅ Screenshot capability
- ✅ Server-side rendering
- ⚠️ May break with authentication

## 🎨 Customization

Edit the `BRANDING` object in either file:

```javascript
const BRANDING = {
  oldName: 'HeyGen',
  newName: 'VideoAI Pro',      // Your brand name
  primaryColor: '#6366f1',      // Your primary color
  secondaryColor: '#8b5cf6',    // Your secondary color
  logoUrl: '/custom-assets/logo.png'  // Your logo
};
```

## 📁 Project Structure

```
ai_video_agent/
├── proxy-server.js          # Reverse proxy implementation
├── puppeteer-rebrand.js     # Puppeteer scraping implementation
├── proxy-rebrand.js         # Original simple proxy
├── package.json             # Dependencies
├── custom-assets/           # Your custom branding assets
│   └── logo.png            # Your logo (create this)
└── README.md               # This file
```

## 🛠️ How It Works

### Reverse Proxy Approach

1. **Intercepts** all requests to HeyGen
2. **Modifies** HTML/JS responses on-the-fly
3. **Injects** custom CSS and JavaScript
4. **Replaces** text, logos, and colors
5. **Proxies** WebSocket connections for real-time features

```
User Browser → Proxy Server → HeyGen
                    ↓
              [Modification]
                    ↓
User Browser ← Modified Content
```

### Puppeteer Approach

1. **Launches** headless Chrome
2. **Navigates** to HeyGen
3. **Executes** JavaScript to rebrand DOM
4. **Extracts** modified HTML
5. **Serves** via Express server

```
Puppeteer → HeyGen → Scrape → Modify → Serve
```

## 🔧 Technical Details

### What Gets Modified

- ✅ Text content (brand names)
- ✅ Page titles
- ✅ Colors (CSS variables)
- ✅ Logos and images
- ✅ Button styles
- ✅ Dynamic content (via MutationObserver)

### Security Headers Removed

The proxy removes these headers to allow modifications:
- `Content-Security-Policy`
- `X-Frame-Options`

### Challenges

1. **Authentication** - Login sessions may not work properly
2. **CORS** - Cross-origin requests may fail
3. **WebSockets** - Real-time features need special handling
4. **API Calls** - Backend calls may fail due to origin checks
5. **Updates** - Site changes will break the rebranding

## 📸 Screenshots

Take screenshots with Puppeteer:

```bash
# Start the Puppeteer server
npm run puppeteer

# Then visit:
http://localhost:3001/screenshot
```

## 🔍 Debugging

### Enable verbose logging:

```javascript
// In proxy-server.js
onProxyReq: (proxyReq, req, res) => {
  console.log('→', req.method, req.url);
},
```

### Check browser console:

The injected script logs: `🎨 Rebranding active: VideoAI Pro`

## ⚖️ Legal Considerations

**This POC demonstrates techniques that likely violate:**

- ✗ HeyGen's Terms of Service
- ✗ Copyright laws (UI/UX design)
- ✗ Trademark laws
- ✗ Computer Fraud and Abuse Act (depending on jurisdiction)

**Legitimate alternatives:**
- Use HeyGen's official API
- Request white-label partnership
- Build similar functionality from scratch
- Use open-source alternatives

## 🎓 Educational Use Cases

This POC is useful for learning:
- Reverse proxy architecture
- HTTP request/response manipulation
- DOM manipulation with JavaScript
- Puppeteer web scraping
- Express.js middleware
- MutationObserver API

## 🚫 What NOT to Do

- ❌ Use in production
- ❌ Commercialize rebranded version
- ❌ Bypass authentication
- ❌ Scrape user data
- ❌ Violate rate limits

## 🔐 Authentication Notes

HeyGen likely requires authentication. To handle this:

1. **Manual approach**: Login in a real browser, copy cookies
2. **Puppeteer approach**: Automate login (requires credentials)
3. **Proxy approach**: Forward authentication headers

Example cookie forwarding:

```javascript
onProxyReq: (proxyReq, req, res) => {
  if (req.headers.cookie) {
    proxyReq.setHeader('cookie', req.headers.cookie);
  }
}
```

## 📚 Resources

- [http-proxy-middleware docs](https://github.com/chimurai/http-proxy-middleware)
- [Puppeteer docs](https://pptr.dev/)
- [Express.js docs](https://expressjs.com/)
- [MutationObserver MDN](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver)

## 🤝 Contributing

This is a POC for educational purposes. Feel free to experiment and learn!

## 📄 License

MIT License - Educational purposes only

---

**Remember: With great power comes great responsibility. Use this knowledge ethically.**
