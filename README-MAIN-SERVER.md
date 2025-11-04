# ArenaGen - Unified Server Setup

This project now has a simplified setup that starts all services with one command.

## 🚀 Quick Start

### Development
```bash
npm start
```

### Development with Frontend Logs
```bash
npm run dev
```

This single command will start:
- 🔐 **Auth Server** (port 3002) - Handles login and authentication
- 🎭 **Proxy Server** (port 3000) - Playwright browser automation
- ⚛️ **Frontend App** (port 3001) - React application

## 📖 How It Works

The `main-server.js` file orchestrates all services:

1. **Auth Server Module** (`auth-server.js`)
   - Exports `createAuthServer(port)` function
   - Handles user authentication and HeyGen session management
   - Serves login page and API endpoints

2. **Proxy Server Module** (`playwright-live-proxy.js`)
   - Exports `createProxyServer(port)` function
   - Manages Playwright browser automation
   - Provides WebSocket and HTTP endpoints for frontend

3. **Frontend Integration**
   - Automatically starts React development server
   - Sets environment variables for service URLs
   - Handles graceful shutdown

## 🔧 Environment Variables

The main server automatically sets up environment variables for development:

```bash
# Automatically set by main-server.js
REACT_APP_API_BASE=http://localhost:3002
REACT_APP_PROXY_HTTP_BASE=http://localhost:3000  
REACT_APP_PROXY_WS_URL=ws://localhost:3000
```

For production, create `.env` files as described in the deployment guides.

## 🛑 Stopping Services

Press `Ctrl+C` to gracefully stop all services. The main server will:
- Close the Playwright browser
- Stop all HTTP servers
- Terminate the frontend process
- Clean up resources

## 🔧 Individual Services

You can still run services individually if needed:

```bash
npm run auth    # Auth server only
npm run proxy   # Proxy server only
```

## 📁 File Structure

```
├── main-server.js           # Main orchestrator
├── auth-server.js          # Auth module (exportable)
├── playwright-live-proxy.js # Proxy module (exportable)
├── frontend/               # React app
└── package.json           # Updated scripts
```

## 🚀 Production Deployment

For production on Render or similar platforms:

1. Each service can be deployed separately using the individual modules
2. Or deploy the main server and set appropriate PORT environment variables
3. Update CORS origins and environment variables as needed

The modular design makes it easy to scale services independently while keeping development simple with the unified server.
