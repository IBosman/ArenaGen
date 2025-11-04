# Architecture Overview

## 🏗️ System Architecture

### Reverse Proxy Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER'S BROWSER                          │
│                     http://localhost:3000                       │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ HTTP Request
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      PROXY SERVER (Express)                     │
│                         Port 3000                               │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────┐  │
│  │           http-proxy-middleware                          │  │
│  │                                                          │  │
│  │  1. Receive request                                     │  │
│  │  2. Forward to HeyGen ──────────────────────┐           │  │
│  │  3. Receive response                        │           │  │
│  │  4. Modify content (inject CSS/JS)          │           │  │
│  │  5. Replace text (HeyGen → VideoAI Pro)     │           │  │
│  │  6. Remove security headers                 │           │  │
│  │  7. Send modified response                  │           │  │
│  └──────────────────────────────────────────────┼───────────┘  │
└─────────────────────────────────────────────────┼───────────────┘
                                                  │
                                                  │ HTTPS Request
                                                  ▼
                                    ┌──────────────────────────┐
                                    │    app.heygen.com        │
                                    │   (Original Site)        │
                                    └──────────────────────────┘
```

### Puppeteer Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER'S BROWSER                          │
│                     http://localhost:3001                       │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ HTTP Request
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   PUPPETEER SERVER (Express)                    │
│                         Port 3001                               │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              Cached Content                              │  │
│  │  (Serves pre-rendered HTML)                             │  │
│  └──────────────────────────────────────────────────────────┘  │
│                             ▲                                   │
│                             │                                   │
│  ┌──────────────────────────┼───────────────────────────────┐  │
│  │         Puppeteer Process │                              │  │
│  │                           │                              │  │
│  │  ┌────────────────────────┴──────────────────────────┐  │  │
│  │  │         Headless Chrome Browser                   │  │  │
│  │  │                                                    │  │  │
│  │  │  1. Navigate to HeyGen ────────────────┐          │  │  │
│  │  │  2. Wait for page load                 │          │  │  │
│  │  │  3. Execute rebranding JS              │          │  │  │
│  │  │  4. Extract modified HTML              │          │  │  │
│  │  │  5. Cache content                      │          │  │  │
│  │  └────────────────────────────────────────┼──────────┘  │  │
│  └───────────────────────────────────────────┼──────────────┘  │
└────────────────────────────────────────────────┼────────────────┘
                                                 │
                                                 │ HTTPS Request
                                                 ▼
                                   ┌──────────────────────────┐
                                   │    app.heygen.com        │
                                   │   (Original Site)        │
                                   └──────────────────────────┘
```

## 🔄 Request/Response Cycle

### Reverse Proxy Detailed Flow

```
1. Browser Request
   ├─ GET http://localhost:3000/
   └─ Headers: User-Agent, Accept, etc.

2. Proxy Middleware
   ├─ Intercept request
   ├─ Modify headers
   │  ├─ Add: referer: https://app.heygen.com
   │  └─ Add: origin: https://app.heygen.com
   └─ Forward to target

3. HeyGen Server
   ├─ Process request
   └─ Return response
      ├─ HTML content
      ├─ CSS files
      └─ JavaScript files

4. Response Interceptor
   ├─ Check content-type
   ├─ If HTML:
   │  ├─ Parse HTML
   │  ├─ Replace text: "HeyGen" → "VideoAI Pro"
   │  ├─ Inject custom CSS
   │  ├─ Inject custom JavaScript
   │  └─ Remove security headers
   └─ Return modified content

5. Browser Receives
   ├─ Modified HTML
   ├─ Custom CSS applied
   ├─ Custom JS executed
   └─ Rebranded page rendered
```

### Puppeteer Detailed Flow

```
1. Server Startup
   ├─ Launch Puppeteer
   ├─ Create browser instance
   └─ Create new page

2. Content Fetch (on first request)
   ├─ Navigate to HeyGen
   ├─ Wait for networkidle
   ├─ Execute rebranding script
   │  ├─ Replace text in DOM
   │  ├─ Modify styles
   │  ├─ Hide original logos
   │  └─ Apply custom branding
   ├─ Extract final HTML
   └─ Cache content

3. Serve Content
   ├─ Receive user request
   ├─ Check cache
   ├─ Serve cached HTML
   └─ Browser renders static page

4. Refresh Endpoint
   ├─ Clear cache
   ├─ Re-fetch from HeyGen
   ├─ Re-apply rebranding
   └─ Update cache
```

## 📦 Component Breakdown

### Proxy Server Components

```javascript
proxy-server.js
├─ Express App
│  ├─ Static file server (/custom-assets)
│  └─ Proxy middleware (/)
│
├─ Branding Configuration
│  ├─ Brand names
│  ├─ Colors
│  └─ Logo URLs
│
├─ Proxy Middleware
│  ├─ onProxyReq (modify request)
│  └─ onProxyRes (modify response)
│
└─ Custom Code Generator
   ├─ CSS injection
   ├─ JavaScript injection
   └─ Text replacement
```

### Puppeteer Server Components

```javascript
puppeteer-rebrand.js
├─ PuppeteerRebrander Class
│  ├─ initialize() - Launch browser
│  ├─ fetchAndRebrand() - Get content
│  ├─ rebrandHTML() - Modify HTML
│  ├─ takeScreenshot() - Capture page
│  └─ close() - Cleanup
│
├─ Express Server
│  ├─ GET / - Serve rebranded content
│  ├─ GET /refresh - Update cache
│  └─ GET /screenshot - Take screenshot
│
└─ Content Cache
   ├─ HTML
   └─ Resources (scripts, styles, images)
```

## 🎨 Rebranding Pipeline

### Text Replacement Pipeline

```
Original HTML
      │
      ▼
┌─────────────────┐
│ Server-side     │
│ Replacement     │  "HeyGen" → "VideoAI Pro"
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Inject JS       │
│ (MutationObserver)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Client-side     │
│ Replacement     │  Dynamic content
└────────┬────────┘
         │
         ▼
   Final Output
```

### Style Injection Pipeline

```
Original Styles
      │
      ▼
┌─────────────────┐
│ Remove CSP      │  Allow custom styles
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Inject <style>  │  Custom CSS
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Override vars   │  :root { --primary: ... }
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Hide elements   │  img[src*="heygen"]
└────────┬────────┘
         │
         ▼
   Rebranded UI
```

## 🔐 Security Considerations

### Headers Modified

```
Removed Headers:
├─ content-security-policy
├─ content-security-policy-report-only
└─ x-frame-options

Added Headers:
├─ referer: https://app.heygen.com
├─ origin: https://app.heygen.com
└─ X-Rebranded-By: VideoAI-Pro
```

### Why Remove CSP?

```
Original CSP:
  script-src 'self' https://app.heygen.com

Problem:
  Our injected scripts are inline → Blocked!

Solution:
  Remove CSP header → Scripts execute

Risk:
  XSS vulnerabilities exposed
  (Acceptable for POC, NOT for production)
```

## 🚀 Deployment Options

### Local Development

```
┌──────────────┐
│  Developer   │
│   Machine    │
│              │
│ localhost:   │
│   3000/3001  │
└──────────────┘
```

### Network Deployment

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Client 1   │────▶│              │     │              │
└──────────────┘     │  Proxy/Pup   │────▶│   HeyGen     │
┌──────────────┐     │   Server     │     │              │
│   Client 2   │────▶│              │     │              │
└──────────────┘     │ 192.168.x.x  │     └──────────────┘
┌──────────────┐     │              │
│   Client 3   │────▶│              │
└──────────────┘     └──────────────┘
```

### Cloud Deployment (Not Recommended)

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Internet   │────▶│   Cloud VM   │────▶│   HeyGen     │
│    Users     │     │              │     │              │
└──────────────┘     │  Proxy/Pup   │     └──────────────┘
                     │              │
                     │ https://your │
                     │  domain.com  │
                     └──────────────┘

⚠️ Legal issues!
⚠️ ToS violations!
⚠️ Not recommended!
```

## 📊 Data Flow

### Static Assets

```
Browser Request: /assets/logo.png
         │
         ▼
    Proxy Server
         │
         ├─ Match: /custom-assets/* ?
         │  ├─ Yes → Serve local file
         │  └─ No → Forward to HeyGen
         │
         ▼
    Response
```

### API Calls

```
Browser: fetch('/api/user')
         │
         ▼
    Proxy Server
         │
         ├─ Forward to HeyGen API
         │
         ▼
    HeyGen API
         │
         ├─ Process request
         │
         ▼
    JSON Response
         │
         ├─ Proxy passes through
         │  (No modification needed)
         │
         ▼
    Browser receives data
```

### WebSocket Connections

```
Browser: new WebSocket('ws://localhost:3000')
         │
         ▼
    Proxy Server (ws: true)
         │
         ├─ Upgrade connection
         │
         ▼
    HeyGen WebSocket
         │
         ├─ Bidirectional communication
         │
         ▼
    Real-time updates
```

## 🎯 Performance Optimization

### Caching Strategy

```
┌─────────────────┐
│  First Request  │
│   (Slow)        │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Fetch & Cache  │
│   3-5 seconds   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Subsequent Req  │
│   (Fast)        │
│   <100ms        │
└─────────────────┘
```

### Resource Loading

```
Parallel Loading:
├─ HTML (modified)
├─ CSS (original + custom)
├─ JavaScript (original + custom)
├─ Images (original or replaced)
└─ Fonts (original)

Sequential Loading:
1. HTML document
2. Critical CSS
3. JavaScript
4. Images (lazy)
```

## 🔧 Configuration Flow

```
config.js
    │
    ├─ Read by proxy-server.js
    │  └─ Apply branding settings
    │
    └─ Read by puppeteer-rebrand.js
       └─ Apply branding settings

Centralized configuration ensures consistency!
```

## 📝 Summary

### Reverse Proxy = Real-time Modification
- Intercepts traffic
- Modifies on-the-fly
- Maintains functionality

### Puppeteer = Snapshot & Serve
- Scrapes content
- Modifies in browser
- Serves static version

Both achieve the same goal through different means!

---

**Choose based on your requirements** 🎯
