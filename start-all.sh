#!/bin/bash

# Start all servers for the authenticated rebranding system

echo "╔════════════════════════════════════════════════════════╗"
echo "║  🚀 Starting VideoAI Pro - Complete System            ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}📦 Installing dependencies...${NC}"
    npm install
    echo ""
fi

# Kill any existing processes on our ports
echo "🧹 Cleaning up existing processes..."
lsof -ti:3000 | xargs kill -9 2>/dev/null
lsof -ti:3002 | xargs kill -9 2>/dev/null
echo ""

# Start auth server in background
echo -e "${GREEN}🔐 Starting Authentication Server (port 3002)...${NC}"
node auth-server.js > logs/auth-server.log 2>&1 &
AUTH_PID=$!
echo "   PID: $AUTH_PID"
sleep 2

# Start Playwright live proxy server in background
echo -e "${GREEN}🎭 Starting Playwright Live Proxy (port 3000)...${NC}"
node playwright-live-proxy.js > logs/proxy-server.log 2>&1 &
PROXY_PID=$!
echo "   PID: $PROXY_PID"
sleep 3

echo ""
echo "╔════════════════════════════════════════════════════════╗"
echo "║  ✅ All Servers Running!                               ║"
echo "╠════════════════════════════════════════════════════════╣"
echo "║                                                        ║"
echo "║  🔐 Login:  http://localhost:3002                      ║"
echo "║  🎨 App:    http://localhost:3000                      ║"
echo "║                                                        ║"
echo "║  Process IDs:                                         ║"
echo "║  - Auth Server:  $AUTH_PID                                  ║"
echo "║  - Proxy Server: $PROXY_PID                                  ║"
echo "║                                                        ║"
echo "║  Logs:                                                ║"
echo "║  - tail -f logs/auth-server.log                       ║"
echo "║  - tail -f logs/proxy-server.log                      ║"
echo "║                                                        ║"
echo "║  To stop all servers:                                 ║"
echo "║  - ./stop-all.sh                                      ║"
echo "║  - Or: kill $AUTH_PID $PROXY_PID                              ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""

# Save PIDs to file for easy cleanup
echo "$AUTH_PID" > .pids
echo "$PROXY_PID" >> .pids

echo -e "${GREEN}🎉 System ready! Open http://localhost:3002 to login${NC}"
echo ""

# Keep script running and show logs
echo "📋 Showing combined logs (Ctrl+C to exit):"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
tail -f logs/auth-server.log logs/proxy-server.log
