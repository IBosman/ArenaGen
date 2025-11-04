# 🔐 Authentication Flow Documentation

## System Architecture

This system uses a **two-server architecture** with Playwright-based authentication and reverse proxy rebranding.

```
┌─────────────────────────────────────────────────────────────┐
│                    USER WORKFLOW                            │
└─────────────────────────────────────────────────────────────┘

Step 1: User visits http://localhost:3002
        ↓
Step 2: Custom login UI displayed
        ↓
Step 3: User enters credentials
        ↓
Step 4: Playwright authenticates with HeyGen
        ↓
Step 5: Session cookies saved
        ↓
Step 6: Redirect to http://localhost:3000
        ↓
Step 7: Proxy uses saved cookies
        ↓
Step 8: User sees rebranded HeyGen with full access
```

---

## Server Components

### 🔐 Authentication Server (Port 3002)

**File:** `auth-server.js`

**Purpose:**
- Displays custom branded login UI
- Handles authentication via Playwright
- Saves session cookies
- Redirects to proxy after successful login

**Endpoints:**
- `GET /` - Custom login page
- `POST /api/login` - Login via Playwright
- `GET /api/status` - Check auth status
- `POST /api/logout` - Clear session
- `GET /api/cookies` - Get saved cookies

**Flow:**
```javascript
1. User submits login form
2. POST to /api/login with credentials
3. Launch Playwright browser
4. Navigate to app.heygen.com/login
5. Fill email → Click Continue
6. Fill password → Click Login
7. Wait for successful login
8. Extract cookies from browser
9. Save to heygen-cookies.json
10. Return success to client
11. Client redirects to proxy
```

---

### 🎨 Proxy Server (Port 3000)

**File:** `proxy-with-auth.js`

**Purpose:**
- Proxies all requests to HeyGen
- Injects authentication cookies
- Applies rebranding (text, colors, logos)
- Maintains full functionality

**Flow:**
```javascript
1. Load cookies from heygen-cookies.json
2. Check if authenticated
3. If not → redirect to port 3002
4. If yes → proxy request to HeyGen
5. Inject auth cookies in request
6. Receive response from HeyGen
7. Modify response (rebrand)
8. Send to user
```

---

## Authentication Process

### Initial Login

```
User Browser                Auth Server              Playwright              HeyGen
     │                           │                        │                    │
     │──── GET / ───────────────>│                        │                    │
     │<─── Login UI ─────────────│                        │                    │
     │                           │                        │                    │
     │──── POST /api/login ─────>│                        │                    │
     │     {email, password}     │                        │                    │
     │                           │                        │                    │
     │                           │──── Launch ──────────>│                    │
     │                           │                        │                    │
     │                           │                        │──── Navigate ────>│
     │                           │                        │  /login            │
     │                           │                        │                    │
     │                           │                        │<─── Page ─────────│
     │                           │                        │                    │
     │                           │                        │──── Fill form ───>│
     │                           │                        │  email, password   │
     │                           │                        │                    │
     │                           │                        │<─── Redirect ─────│
     │                           │                        │  /dashboard        │
     │                           │                        │                    │
     │                           │<─── Cookies ──────────│                    │
     │                           │                        │                    │
     │<─── Success ──────────────│                        │                    │
     │     {cookies saved}       │                        │                    │
     │                           │                        │                    │
     │──── Redirect to :3000 ───>│                        │                    │
```

### Authenticated Requests

```
User Browser              Proxy Server                HeyGen
     │                         │                        │
     │──── GET /dashboard ────>│                        │
     │                         │                        │
     │                         │──── Load cookies ─────>│
     │                         │  from file             │
     │                         │                        │
     │                         │──── GET /dashboard ───>│
     │                         │  Cookie: session=...   │
     │                         │                        │
     │                         │<─── Response ──────────│
     │                         │  (authenticated)       │
     │                         │                        │
     │                         │──── Rebrand ──────────>│
     │                         │  (modify HTML/CSS/JS)  │
     │                         │                        │
     │<─── Rebranded page ─────│                        │
```

---

## File Structure

```
heygen-storage.json       # Playwright storage state (full context)
heygen-cookies.json       # Extracted cookies (used by proxy)
.pids                     # Process IDs for running servers
logs/
  ├── auth-server.log     # Auth server logs
  └── proxy-server.log    # Proxy server logs
```

---

## Cookie Management

### Cookie Format

```json
[
  {
    "name": "session_token",
    "value": "abc123...",
    "domain": ".heygen.com",
    "path": "/",
    "expires": 1234567890,
    "httpOnly": true,
    "secure": true,
    "sameSite": "Lax"
  }
]
```

### Cookie Injection

**In proxy-with-auth.js:**
```javascript
// Convert cookies to header string
function cookiesToHeader(cookies) {
  return cookies
    .map(cookie => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

// Inject in proxy request
onProxyReq: (proxyReq, req, res) => {
  const cookieStr = cookiesToHeader(authCookies);
  proxyReq.setHeader('cookie', cookieStr);
}
```

---

## Security Considerations

### ✅ What's Secure

- Credentials only sent to HeyGen (via Playwright)
- Cookies stored locally (not transmitted to third parties)
- HTTPS used for HeyGen communication
- Session isolated per user

### ⚠️ What's Not Secure (POC Limitations)

- Cookies stored in plain JSON file
- No encryption at rest
- No session expiration handling
- Single-user system (no multi-user support)
- HTTP used for local servers (not HTTPS)

### 🔒 Production Recommendations

**DO NOT use this in production!** If you were to build a real system:

1. **Encrypt cookies** - Use encryption for storage
2. **Use database** - Store sessions in Redis/PostgreSQL
3. **HTTPS everywhere** - Use SSL certificates
4. **Session management** - Implement proper expiration
5. **Multi-user support** - Separate sessions per user
6. **Rate limiting** - Prevent abuse
7. **Legal compliance** - Get proper authorization

---

## Rebranding Features

### Text Replacement

**Server-side (in proxy):**
```javascript
body = body.replace(/HeyGen/gi, 'VideoAI Pro');
```

**Client-side (injected JS):**
```javascript
function replaceText(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    node.textContent = node.textContent.replace(/HeyGen/gi, 'VideoAI Pro');
  }
}
```

### Logo Replacement

```javascript
function replaceLogo(img) {
  if (img.src.includes('heygen')) {
    img.src = '/custom-assets/logo.svg';
  }
}
```

### Color Override

```css
:root {
  --primary-color: #6366f1 !important;
  --secondary-color: #8b5cf6 !important;
}

button[class*="primary"] {
  background-color: #6366f1 !important;
}
```

### Dynamic Updates (SPA Support)

```javascript
const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach((node) => {
      replaceText(node);
      replaceLogo(node);
    });
  });
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});
```

---

## Troubleshooting

### Issue: "Not authenticated" error

**Solution:**
1. Check if `heygen-cookies.json` exists
2. Verify cookies are valid (not expired)
3. Try logging in again at port 3002
4. Check auth server logs: `tail -f logs/auth-server.log`

### Issue: Login fails

**Solution:**
1. Verify credentials are correct
2. Check if HeyGen site structure changed
3. Increase timeout in auth-server.js
4. Run with `headless: false` to see browser
5. Check Playwright selectors still match

### Issue: Proxy shows login page

**Solution:**
1. Cookies might be expired
2. HeyGen session invalidated
3. Re-login at port 3002
4. Check cookie file permissions

### Issue: Rebranding not working

**Solution:**
1. Check if CSP headers are removed
2. Verify injection code is present (view source)
3. Check browser console for errors
4. Clear browser cache

---

## Development Tips

### Debug Mode

**Enable headless: false in auth-server.js:**
```javascript
const browser = await chromium.launch({ 
  headless: false  // See browser during login
});
```

**Enable verbose logging in proxy-with-auth.js:**
```javascript
onProxyReq: (proxyReq, req, res) => {
  console.log(`→ ${req.method} ${req.url}`);
  console.log('Headers:', req.headers);
}
```

### Test Authentication

```bash
# Check if authenticated
curl http://localhost:3002/api/status

# Response:
# {"authenticated":true,"cookies":5}
```

### Manual Cookie Inspection

```bash
# View saved cookies
cat heygen-cookies.json | jq
```

### Watch Logs

```bash
# Terminal 1: Auth server
tail -f logs/auth-server.log

# Terminal 2: Proxy server
tail -f logs/proxy-server.log
```

---

## API Reference

### Auth Server API

#### POST /api/login
```javascript
// Request
{
  "email": "user@example.com",
  "password": "password123"
}

// Response (success)
{
  "success": true,
  "message": "Login successful",
  "cookies": 5
}

// Response (error)
{
  "success": false,
  "error": "Login failed - still on login page"
}
```

#### GET /api/status
```javascript
// Response
{
  "authenticated": true,
  "cookies": 5
}
```

#### POST /api/logout
```javascript
// Response
{
  "success": true
}
```

#### GET /api/cookies
```javascript
// Response (authenticated)
{
  "cookies": [
    { "name": "session", "value": "..." }
  ]
}

// Response (not authenticated)
{
  "error": "Not authenticated"
}
```

---

## Complete Startup Sequence

```bash
# 1. Install dependencies
npm install

# 2. Start all servers
npm start

# Or manually:
# Terminal 1:
node auth-server.js

# Terminal 2:
node proxy-with-auth.js

# 3. Open browser
# http://localhost:3002 (login)
# http://localhost:3000 (app)

# 4. Stop all servers
npm stop
```

---

## Environment Variables

Create `.env` file:

```bash
# HeyGen Credentials (optional - can enter in UI)
HEYGEN_EMAIL=your@email.com
HEYGEN_PASSWORD=yourpassword

# Server Ports
AUTH_PORT=3002
PROXY_PORT=3000

# Playwright Options
PLAYWRIGHT_HEADLESS=true
PLAYWRIGHT_TIMEOUT=30000

# Branding
BRAND_NAME=VideoAI Pro
BRAND_PRIMARY_COLOR=#6366f1
BRAND_SECONDARY_COLOR=#8b5cf6
```

---

## Summary

✅ **Custom login UI** - Beautiful branded login page  
✅ **Playwright authentication** - Automated login to HeyGen  
✅ **Session persistence** - Cookies saved and reused  
✅ **Seamless proxy** - Full functionality maintained  
✅ **Complete rebranding** - Text, colors, logos replaced  
✅ **SPA support** - Dynamic content handled  
✅ **Logout functionality** - Clean session termination  

**This is a complete, working authentication + rebranding system!** 🎉
