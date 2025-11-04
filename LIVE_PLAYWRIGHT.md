# Live Playwright Session Architecture

## Concept

Instead of proxying requests, we open a **live Playwright browser window** that the user interacts with directly. This is the cleanest approach for authenticated rebranding.

## How It Works

```
User → Control Panel (localhost:3000) → WebSocket → Playwright Browser Window
                                                      ↓
                                                  HeyGen (authenticated)
```

### Components

1. **Control Panel** (`http://localhost:3000`)
   - Web UI for navigation controls
   - WebSocket connection to Playwright
   - Send commands: navigate, reload, back

2. **Playwright Browser** (headed mode)
   - Real Chrome/Chromium window
   - Authenticated via saved cookies
   - Custom branding via `addInitScript()`
   - User interacts directly (click, type, scroll)

3. **WebSocket Server**
   - Receives commands from control panel
   - Controls the Playwright browser
   - Real-time bidirectional communication

## Advantages

| Aspect | Traditional Proxy | Live Playwright |
|--------|-------------------|-----------------|
| **User Experience** | Proxied through localhost | Real browser interaction |
| **CSP/CORS** | ❌ Constant battles | ✅ No issues - it's a real browser |
| **Workers/iframes** | ❌ Need special handling | ✅ Work automatically |
| **Authentication** | ❌ Cookie forwarding | ✅ Built into browser context |
| **Debugging** | ❌ Hard to debug | ✅ DevTools available |
| **Performance** | ❌ Proxy overhead | ✅ Direct browser performance |
| **Complexity** | ❌ High (injection, rewriting) | ✅ Low (just control browser) |

## Custom Branding

Branding is injected via `page.addInitScript()` which runs before any page scripts:

```javascript
await activePage.addInitScript(() => {
  // Text replacement
  const observer = new MutationObserver(() => {
    document.body.innerHTML = document.body.innerHTML
      .replace(/HeyGen/gi, 'VideoAI Pro')
      .replace(/heygen\.com/gi, 'localhost:3000');
  });
  observer.observe(document.body, { childList: true, subtree: true });
  
  // Custom styles
  const style = document.createElement('style');
  style.textContent = `
    :root {
      --primary-color: #6366f1 !important;
    }
  `;
  document.head.appendChild(style);
});
```

## Usage

### Start the System

```bash
# Install dependencies
npm install

# Start auth + live proxy
npm start

# Or individually
npm run auth    # Auth server on :3002
npm run proxy   # Live Playwright on :3000
```

### Workflow

1. **Login**: `http://localhost:3002`
   - Enter HeyGen credentials
   - Playwright authenticates
   - Cookies saved

2. **Open Control Panel**: `http://localhost:3000`
   - Playwright browser window opens
   - Already authenticated
   - Custom branding active

3. **Interact**:
   - Use control panel to navigate
   - Or interact directly with browser window
   - Everything just works!

## WebSocket Commands

The control panel sends JSON commands via WebSocket:

```javascript
// Navigate to a path
ws.send(JSON.stringify({ 
  action: 'navigate', 
  url: '/agent/abc123' 
}));

// Reload page
ws.send(JSON.stringify({ 
  action: 'reload' 
}));

// Go back
ws.send(JSON.stringify({ 
  action: 'back' 
}));
```

## Architecture Diagram

```
┌─────────────────────────────────────────────┐
│  User's Browser                             │
│  http://localhost:3000                      │
│  ┌───────────────────────────────────────┐  │
│  │  Control Panel UI                     │  │
│  │  - Navigation input                   │  │
│  │  - Reload/Back buttons                │  │
│  │  - Instructions                       │  │
│  └───────────────┬───────────────────────┘  │
│                  │ WebSocket                │
└──────────────────┼──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│  Node.js Server (playwright-live-proxy.js)  │
│  - Express HTTP server                      │
│  - WebSocket server                         │
│  - Playwright browser controller            │
└───────────────────┬─────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│  Playwright Browser Window (headed)         │
│  ┌───────────────────────────────────────┐  │
│  │  Chrome/Chromium                      │  │
│  │  - Authenticated context              │  │
│  │  - Custom branding injected           │  │
│  │  - User interacts directly            │  │
│  │  - DevTools available                 │  │
│  └───────────────────────────────────────┘  │
│                    │                         │
└────────────────────┼─────────────────────────┘
                     │
                     ▼
          ┌──────────────────┐
          │  app.heygen.com  │
          │  api2.heygen.com │
          └──────────────────┘
```

## Comparison with Other Approaches

### 1. Reverse Proxy (proxy-with-auth.js)
- ❌ CSP issues
- ❌ Worker/iframe problems
- ❌ Complex URL rewriting
- ✅ User stays in their browser

### 2. Fetch-based Playwright Proxy (playwright-proxy.js)
- ❌ Timeout issues (networkidle)
- ❌ MIME type problems
- ❌ Still proxying requests
- ✅ Authenticated context

### 3. Live Playwright (playwright-live-proxy.js) ⭐
- ✅ No CSP/CORS issues
- ✅ No worker/iframe problems
- ✅ No URL rewriting needed
- ✅ Real browser interaction
- ✅ Easy debugging
- ⚠️ User sees separate browser window

## Customization

Edit `playwright-live-proxy.js`:

```javascript
// Branding in addInitScript()
await activePage.addInitScript(() => {
  // Your custom branding logic
});

// Browser launch options
browser = await chromium.launch({
  headless: false,  // Set to true for headless
  args: [/* custom args */]
});

// Context options
context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  // ... other options
});
```

## Troubleshooting

### Browser doesn't open
- Check if Playwright browsers are installed: `npx playwright install`
- Check display server (X11/Wayland) is available

### Authentication fails
- Verify `heygen-cookies.json` exists
- Re-login at `http://localhost:3002`
- Check cookies haven't expired

### WebSocket connection fails
- Check port 3000 is not blocked by firewall
- Verify server is running: `tail -f logs/proxy-server.log`

## Future Enhancements

1. **Screen Sharing**: Stream browser view to control panel
2. **Remote Control**: Full mouse/keyboard control via WebSocket
3. **Multi-session**: Multiple browser windows for different users
4. **Recording**: Record sessions for playback
5. **Automation**: Scheduled tasks, testing, monitoring

## Conclusion

The live Playwright approach is the **cleanest solution** for authenticated rebranding:
- No proxy complexity
- No CSP battles
- No injection hacks
- Just a controlled browser that works!
