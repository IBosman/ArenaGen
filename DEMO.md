# 🎬 Demo Script

## Live Demo Walkthrough

### 🎯 What You'll See

This POC demonstrates how to rebrand HeyGen's interface in real-time using two different approaches.

---

## 🚀 Demo 1: Reverse Proxy (Live Rebranding)

### Step 1: Start the Proxy
```bash
npm run proxy
```

**Expected Output:**
```
╔════════════════════════════════════════════════════════╗
║  🎨 HeyGen Rebranding Proxy Server                    ║
╠════════════════════════════════════════════════════════╣
║  Local URL:    http://localhost:3000                   ║
║  Target:       https://app.heygen.com                  ║
║  New Brand:    VideoAI Pro                             ║
╠════════════════════════════════════════════════════════╣
║  ⚠️  Educational purposes only                         ║
║  May violate Terms of Service                         ║
╚════════════════════════════════════════════════════════╝
```

### Step 2: Open Browser
Navigate to: `http://localhost:3000`

### Step 3: Observe Changes

**Before (Original HeyGen):**
- Logo: HeyGen logo
- Text: "HeyGen" everywhere
- Colors: HeyGen's brand colors
- Domain: heygen.com

**After (Rebranded):**
- Logo: Your custom logo (or hidden)
- Text: "VideoAI Pro" everywhere
- Colors: Your custom colors (#6366f1)
- Domain: localhost:3000

### Step 4: Test Interactivity

1. **Click buttons** → Still works!
2. **Navigate pages** → Rebranding persists!
3. **Open DevTools** → See injected code!
4. **Check console** → See: `🎨 Rebranding active: VideoAI Pro`

### Step 5: Inspect the Code

**Open DevTools → Elements:**
```html
<head>
  <!-- Original HeyGen code -->
  
  <!-- Our injected code -->
  <style id="custom-rebrand-styles">
    :root {
      --primary-color: #6366f1 !important;
    }
    img[src*="heygen"] {
      display: none !important;
    }
  </style>
  
  <script id="custom-rebrand-script">
    console.log('🎨 Rebranding active: VideoAI Pro');
    // ... rebranding code ...
  </script>
</head>
```

---

## 🎭 Demo 2: Puppeteer (Screenshot & Serve)

### Step 1: Start Puppeteer Server
```bash
npm run puppeteer
```

**Expected Output:**
```
╔════════════════════════════════════════════════════════╗
║  🎭 Puppeteer Rebranding Server                       ║
╠════════════════════════════════════════════════════════╣
║  Local URL:    http://localhost:3001                   ║
║  Target:       https://app.heygen.com/home             ║
║  Refresh:      http://localhost:3001/refresh           ║
║  Screenshot:   http://localhost:3001/screenshot        ║
╠════════════════════════════════════════════════════════╣
║  ⚠️  Educational purposes only                         ║
╚════════════════════════════════════════════════════════╝
🚀 Launching browser...
📥 Fetching content from: https://app.heygen.com/home
✅ Content fetched and rebranded
```

### Step 2: View Rebranded Page
Navigate to: `http://localhost:3001`

### Step 3: Take a Screenshot
Navigate to: `http://localhost:3001/screenshot`

**Result:** Screenshot saved to `public/screenshot.png`

### Step 4: Refresh Content
Navigate to: `http://localhost:3001/refresh`

**Result:** Content re-fetched and rebranded

---

## 🔍 Side-by-Side Comparison

### Open Both Versions

**Terminal 1:**
```bash
npm run proxy
```

**Terminal 2:**
```bash
npm run puppeteer
```

**Browser:**
- Tab 1: `http://localhost:3000` (Proxy)
- Tab 2: `http://localhost:3001` (Puppeteer)
- Tab 3: `https://app.heygen.com` (Original)

### Compare Them:

| Feature | Original | Proxy | Puppeteer |
|---------|----------|-------|-----------|
| **Interactivity** | ✅ Full | ✅ Full | ❌ Static |
| **Real-time** | ✅ Yes | ✅ Yes | ❌ Cached |
| **Speed** | ⚡ Fast | ⚡ Fast | 🐌 Slow |
| **Rebranding** | ❌ No | ✅ Yes | ✅ Yes |

---

## 🎨 Customization Demo

### Change Brand Name

**Edit `config.js`:**
```javascript
branding: {
  name: 'MyAwesome AI',  // Changed!
  // ...
}
```

**Restart server:**
```bash
# Ctrl+C to stop
npm run proxy
```

**Result:** All "HeyGen" text now shows "MyAwesome AI"

### Change Colors

**Edit `config.js`:**
```javascript
colors: {
  primary: '#ff0000',    // Red!
  secondary: '#00ff00',  // Green!
}
```

**Restart and refresh browser**

**Result:** All buttons and links now use your colors

### Add Custom Logo

**Create logo:**
```bash
# Place your logo.png in custom-assets/
cp ~/my-logo.png custom-assets/logo.png
```

**Restart server**

**Result:** Your logo replaces HeyGen's logo

---

## 🧪 Testing Demo

### Run Automated Test

```bash
node test-proxy.js
```

**Expected Output:**
```
🧪 Testing Proxy Server...

✅ Status Code: 200
📋 Headers: { ... }

📊 Response length: 45678 bytes

🔍 Rebranding Check:
  - Contains "HeyGen": ✅
  - Contains "VideoAI Pro": ✅

💉 Injection Check:
  - Custom script injected: ✅
  - Custom styles injected: ✅

✅ Proxy is working correctly!
```

---

## 🎯 Real-World Use Cases Demo

### Use Case 1: White-Label Demo

**Scenario:** Show client how their brand would look

**Steps:**
1. Update `config.js` with client's branding
2. Start proxy
3. Share screen in meeting
4. Client sees their brand on HeyGen's platform

### Use Case 2: A/B Testing

**Scenario:** Test different color schemes

**Steps:**
1. Version A: Blue theme
2. Version B: Red theme
3. Compare user reactions
4. Choose winning design

### Use Case 3: Screenshots for Marketing

**Scenario:** Need branded screenshots

**Steps:**
1. Start Puppeteer server
2. Visit `/screenshot` endpoint
3. Get high-quality screenshot
4. Use in marketing materials

---

## 📊 Performance Demo

### Measure Load Times

**Original HeyGen:**
```bash
curl -o /dev/null -s -w "Time: %{time_total}s\n" https://app.heygen.com
```

**Proxy:**
```bash
curl -o /dev/null -s -w "Time: %{time_total}s\n" http://localhost:3000
```

**Puppeteer:**
```bash
curl -o /dev/null -s -w "Time: %{time_total}s\n" http://localhost:3001
```

**Expected Results:**
- Original: ~1.2s
- Proxy: ~1.5s (+0.3s overhead)
- Puppeteer: ~2.0s (first load), ~0.1s (cached)

---

## 🐛 Debugging Demo

### Enable Verbose Logging

**Edit `proxy-server.js`:**
```javascript
onProxyReq: (proxyReq, req, res) => {
  console.log('→ Request:', req.method, req.url);
  // ...
},
onProxyRes: (proxyRes, req, res) => {
  console.log('← Response:', proxyRes.statusCode, req.url);
  // ...
}
```

**Restart and watch console:**
```
→ Request: GET /
← Response: 200 /
→ Request: GET /assets/main.css
← Response: 200 /assets/main.css
→ Request: GET /assets/app.js
← Response: 200 /assets/app.js
```

### Browser DevTools

**Network Tab:**
- See all requests going through proxy
- Check response headers
- Verify content modification

**Console Tab:**
- See injected script logs
- Check for errors
- Monitor rebranding activity

**Elements Tab:**
- Inspect injected styles
- See modified DOM
- Verify text replacements

---

## 🎬 Full Demo Script

### 5-Minute Demo

**Minute 1: Introduction**
- "Today I'll show you how to rebrand any website"
- "We'll use HeyGen as an example"
- "Two approaches: Proxy and Puppeteer"

**Minute 2: Reverse Proxy Demo**
- Start proxy: `npm run proxy`
- Open browser: `http://localhost:3000`
- Show rebranding in action
- Demonstrate interactivity

**Minute 3: Puppeteer Demo**
- Start Puppeteer: `npm run puppeteer`
- Open browser: `http://localhost:3001`
- Take screenshot: `/screenshot`
- Show cached content

**Minute 4: Customization**
- Edit `config.js`
- Change brand name
- Change colors
- Restart and show changes

**Minute 5: Technical Deep Dive**
- Show injected code in DevTools
- Explain how it works
- Discuss use cases
- Mention legal considerations

---

## 📸 Screenshot Checklist

Before/After screenshots to capture:

- ✅ Homepage with logo
- ✅ Navigation menu
- ✅ Primary buttons
- ✅ Text content
- ✅ Color scheme
- ✅ Footer

---

## 🎓 Educational Talking Points

### Key Concepts to Explain:

1. **Reverse Proxy**
   - "Sits between user and server"
   - "Modifies traffic in real-time"
   - "Like a translator"

2. **DOM Manipulation**
   - "JavaScript changes page structure"
   - "MutationObserver watches for changes"
   - "Rebranding persists on dynamic updates"

3. **Web Scraping**
   - "Puppeteer controls headless browser"
   - "Extracts and modifies content"
   - "Serves static snapshot"

4. **Security Headers**
   - "CSP prevents unauthorized scripts"
   - "We remove it for POC"
   - "Never do this in production!"

---

## ⚠️ Important Disclaimers

**Always mention:**
- ✅ Educational purposes only
- ✅ May violate Terms of Service
- ✅ Not for production use
- ✅ Legal alternatives exist
- ✅ Use responsibly

---

## 🎉 Demo Conclusion

**Recap:**
- ✅ Built reverse proxy
- ✅ Built Puppeteer scraper
- ✅ Demonstrated rebranding
- ✅ Showed customization
- ✅ Explained architecture

**Key Takeaways:**
- Reverse proxy = Real-time
- Puppeteer = Static snapshots
- Both achieve same goal
- Choose based on needs
- Use ethically!

---

**Questions?** 🙋

Check the documentation:
- `README.md` - Overview
- `USAGE.md` - Detailed guide
- `COMPARISON.md` - Technical comparison
- `ARCHITECTURE.md` - System design

---

**End of Demo** 🎬
