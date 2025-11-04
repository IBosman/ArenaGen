# 🔐 HeyGen Rebranding with Authentication

Complete solution for rebranding HeyGen with **custom login UI** and **Playwright authentication**.

---

## 🎯 What This Does

1. **Custom Login Page** - Beautiful branded login UI (not HeyGen's)
2. **Playwright Authentication** - Automated login to HeyGen in background
3. **Session Persistence** - Saves cookies for reuse
4. **Reverse Proxy** - Proxies all requests with authentication
5. **Complete Rebranding** - Changes text, colors, logos everywhere

---

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

This installs:
- `express` - Web servers
- `http-proxy-middleware` - Reverse proxy
- `playwright` - Browser automation for login

### 2. Start Everything

```bash
npm start
```

This starts:
- **Auth Server** on port 3002 (login page)
- **Proxy Server** on port 3000 (rebranded app)

### 3. Login

1. Open browser: `http://localhost:3002`
2. Enter your HeyGen credentials
3. Click "Sign In"
4. Wait for Playwright to authenticate
5. Automatically redirected to `http://localhost:3000`

### 4. Use the App

You're now using HeyGen with:
- ✅ Your custom branding
- ✅ Full functionality
- ✅ Authenticated session
- ✅ All features working

---

## 📊 System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    COMPLETE FLOW                        │
└─────────────────────────────────────────────────────────┘

1. User → http://localhost:3002
   └─ Custom branded login page

2. User enters credentials
   └─ POST to /api/login

3. Playwright launches headless Chrome
   └─ Navigates to app.heygen.com/login
   └─ Fills email → Continue
   └─ Fills password → Login
   └─ Waits for successful login

4. Cookies extracted and saved
   └─ heygen-cookies.json

5. User redirected → http://localhost:3000

6. Proxy loads saved cookies
   └─ Injects cookies in all requests
   └─ Proxies to HeyGen
   └─ Applies rebranding
   └─ Returns to user

7. User sees rebranded HeyGen
   └─ Fully authenticated
   └─ All features work
```

---

## 🎨 Features

### Custom Login UI

- **Beautiful design** - Modern gradient background
- **Branded** - Shows "VideoAI Pro" not "HeyGen"
- **Responsive** - Works on all devices
- **Loading states** - Shows progress during login
- **Error handling** - Clear error messages

### Playwright Authentication

- **Automated** - No manual browser interaction
- **Headless** - Runs in background
- **Session saving** - Cookies persisted to file
- **Error handling** - Graceful failure messages

### Reverse Proxy Rebranding

- **Text replacement** - "HeyGen" → "VideoAI Pro"
- **Logo replacement** - Your logo instead of theirs
- **Color override** - Your brand colors
- **Dynamic updates** - Works with SPAs
- **Logout button** - Custom logout functionality

---

## 📁 Project Structure

```
ai_video_agent/
├── auth-server.js           # Authentication server (port 3002)
├── proxy-with-auth.js       # Authenticated proxy (port 3000)
├── start-all.sh             # Start both servers
├── stop-all.sh              # Stop all servers
├── AUTH_FLOW.md             # Detailed flow documentation
├── package.json             # Dependencies
├── custom-assets/           # Your branding assets
│   └── logo.svg            # Your logo
├── logs/                    # Server logs
│   ├── auth-server.log
│   └── proxy-server.log
└── heygen-cookies.json      # Saved session (gitignored)
```

---

## 🔧 Configuration

### Branding

Edit `proxy-with-auth.js`:

```javascript
const BRANDING = {
  oldName: 'HeyGen',
  newName: 'VideoAI Pro',      // Your brand
  primaryColor: '#6366f1',      // Your color
  secondaryColor: '#8b5cf6',    // Your color
  logoUrl: '/custom-assets/logo.svg'
};
```

### Credentials (Optional)

You can pre-fill credentials by editing `auth-server.js`:

```javascript
// In the login form HTML
<input 
  type="email" 
  id="email" 
  value="your@email.com"  // Pre-fill
>
```

Or create `.env` file:
```bash
HEYGEN_EMAIL=your@email.com
HEYGEN_PASSWORD=yourpassword
```

---

## 🎬 Usage Examples

### Start System

```bash
# Start both servers
npm start

# Or manually:
npm run auth    # Auth server only
npm run proxy   # Proxy server only
```

### Stop System

```bash
npm stop

# Or manually:
./stop-all.sh
```

### Check Status

```bash
# Check if authenticated
curl http://localhost:3002/api/status

# Response:
# {"authenticated":true,"cookies":5}
```

### Logout

```bash
# Via API
curl -X POST http://localhost:3002/api/logout

# Or click logout button in app (bottom right)
```

### View Logs

```bash
# Auth server logs
tail -f logs/auth-server.log

# Proxy server logs
tail -f logs/proxy-server.log

# Both
tail -f logs/*.log
```

---

## 🐛 Troubleshooting

### Login Fails

**Symptoms:** "Login failed" error message

**Solutions:**
1. Check credentials are correct
2. Verify HeyGen site is accessible
3. Check if HeyGen changed their login flow
4. Enable headless: false to see browser
5. Check auth-server.log for details

```javascript
// In auth-server.js, change:
headless: false  // See what's happening
```

### Not Authenticated Error

**Symptoms:** Redirected back to login page

**Solutions:**
1. Check if `heygen-cookies.json` exists
2. Cookies might be expired - login again
3. Check file permissions
4. Restart proxy server

```bash
# Check cookies file
ls -la heygen-cookies.json

# Re-login
rm heygen-cookies.json
# Then login again at localhost:3002
```

### Rebranding Not Working

**Symptoms:** Still shows "HeyGen" branding

**Solutions:**
1. Clear browser cache
2. Hard refresh (Ctrl+Shift+R)
3. Check browser console for errors
4. Verify injection code in page source

```bash
# Check if code is injected
curl http://localhost:3000 | grep "custom-rebrand"
```

### Port Already in Use

**Symptoms:** "EADDRINUSE" error

**Solutions:**
```bash
# Kill processes on ports
lsof -ti:3000 | xargs kill -9
lsof -ti:3002 | xargs kill -9

# Or use stop script
npm stop
```

---

## 🔐 Security Notes

### ⚠️ Important

This is a **proof-of-concept** for educational purposes:

- ✅ Learn about authentication flows
- ✅ Understand reverse proxies
- ✅ Study browser automation
- ❌ **DO NOT** use in production
- ❌ **DO NOT** expose publicly
- ❌ **DO NOT** violate Terms of Service

### What's Stored

- `heygen-cookies.json` - Session cookies (sensitive!)
- `heygen-storage.json` - Full browser state (sensitive!)
- Both files are gitignored by default

### Best Practices

1. **Never commit** authentication files
2. **Don't share** cookie files
3. **Use HTTPS** in production (this uses HTTP)
4. **Encrypt cookies** in production
5. **Implement expiration** handling

---

## 📚 How It Works

### Authentication Flow

```javascript
// 1. User submits login form
const response = await fetch('/api/login', {
  method: 'POST',
  body: JSON.stringify({ email, password })
});

// 2. Server launches Playwright
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

// 3. Navigate and login
await page.goto('https://app.heygen.com/login');
await page.fill('input[type="email"]', email);
await page.click('button:has-text("Continue")');
await page.fill('input[type="password"]', password);
await page.click('button:has-text("Log in")');

// 4. Extract cookies
const cookies = await context.cookies();

// 5. Save cookies
fs.writeFileSync('heygen-cookies.json', JSON.stringify(cookies));

// 6. Return success
res.json({ success: true });
```

### Proxy Flow

```javascript
// 1. Load saved cookies
const cookies = JSON.parse(fs.readFileSync('heygen-cookies.json'));

// 2. Convert to header format
const cookieHeader = cookies
  .map(c => `${c.name}=${c.value}`)
  .join('; ');

// 3. Inject in proxy request
onProxyReq: (proxyReq, req, res) => {
  proxyReq.setHeader('cookie', cookieHeader);
}

// 4. Proxy to HeyGen (authenticated)
// 5. Rebrand response
// 6. Return to user
```

---

## 🎓 Advanced Usage

### Custom Login Selectors

If HeyGen changes their login page:

```javascript
// In auth-server.js, update selectors:
await page.getByPlaceholder('Enter email').fill(email);
// Change to:
await page.locator('input[name="email"]').fill(email);
```

### Add More Rebranding

```javascript
// In proxy-with-auth.js, add to generateCustomCode():
body = body.replace(/Create Video/gi, 'Generate Content');
body = body.replace(/Dashboard/gi, 'Control Panel');
```

### Enable Debug Mode

```javascript
// In auth-server.js:
const browser = await chromium.launch({ 
  headless: false,  // See browser
  slowMo: 100       // Slow down actions
});
```

### Add Request Logging

```javascript
// In proxy-with-auth.js:
onProxyReq: (proxyReq, req, res) => {
  console.log(`→ ${req.method} ${req.url}`);
  console.log('  Headers:', req.headers);
  console.log('  Cookies:', cookieHeader);
}
```

---

## 🔄 Session Management

### How Long Do Sessions Last?

HeyGen sessions typically last:
- **Active use:** Several hours
- **Idle:** May expire after 1-2 hours
- **Depends on:** HeyGen's server settings

### Re-authentication

When session expires:
1. Proxy detects 401/403 error
2. Redirects to login page
3. User logs in again
4. New cookies saved
5. Continue using app

### Manual Session Refresh

```bash
# Clear old session
rm heygen-cookies.json heygen-storage.json

# Login again
# Visit http://localhost:3002
```

---

## 📊 Monitoring

### Check Server Status

```bash
# Check if servers are running
lsof -i :3000  # Proxy
lsof -i :3002  # Auth

# Check process IDs
cat .pids
```

### Monitor Requests

```bash
# Watch proxy logs in real-time
tail -f logs/proxy-server.log | grep "→"
```

### Test Authentication

```bash
# Check auth status
curl http://localhost:3002/api/status

# Get cookies
curl http://localhost:3002/api/cookies
```

---

## 🎉 Success Indicators

You know it's working when:

✅ Login page shows "VideoAI Pro" branding  
✅ Login succeeds without errors  
✅ Redirected to localhost:3000  
✅ HeyGen content loads  
✅ All text shows "VideoAI Pro"  
✅ Your colors are applied  
✅ Your logo is visible  
✅ All features work normally  
✅ Logout button appears (bottom right)  

---

## 📞 Support

### Check Documentation

- `AUTH_FLOW.md` - Detailed authentication flow
- `USAGE.md` - General usage guide
- `COMPARISON.md` - Technical comparisons
- `ARCHITECTURE.md` - System architecture

### Debug Checklist

- [ ] Dependencies installed (`npm install`)
- [ ] Ports 3000 and 3002 available
- [ ] HeyGen credentials correct
- [ ] HeyGen site accessible
- [ ] Cookies file created after login
- [ ] Browser console shows no errors
- [ ] Server logs show no errors

---

## ⚖️ Legal Disclaimer

**Educational purposes only!**

This POC demonstrates:
- Web authentication techniques
- Reverse proxy architecture
- Browser automation
- DOM manipulation

**Do not:**
- Use in production
- Violate Terms of Service
- Commercialize without permission
- Expose publicly

**Legitimate alternatives:**
- HeyGen's official API
- White-label partnership
- Build from scratch

---

## 🎯 Summary

This is a **complete authentication + rebranding system** that:

1. ✅ Shows custom login UI
2. ✅ Authenticates via Playwright
3. ✅ Saves session cookies
4. ✅ Proxies authenticated requests
5. ✅ Applies complete rebranding
6. ✅ Maintains full functionality
7. ✅ Handles logout properly

**Ready to use!** Just run `npm start` and login at `http://localhost:3002`

---

**Built with ❤️ for educational purposes**
