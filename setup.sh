#!/bin/bash

# HeyGen Rebranding POC - Setup Script

echo "╔════════════════════════════════════════════════════════╗"
echo "║  🎨 HeyGen Rebranding POC - Setup                     ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if Node.js is installed
echo "📦 Checking dependencies..."
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js is not installed${NC}"
    echo "Please install Node.js from https://nodejs.org/"
    exit 1
fi

echo -e "${GREEN}✅ Node.js $(node --version)${NC}"

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm is not installed${NC}"
    exit 1
fi

echo -e "${GREEN}✅ npm $(npm --version)${NC}"
echo ""

# Install dependencies
echo "📥 Installing dependencies..."
npm install

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Dependencies installed successfully${NC}"
else
    echo -e "${RED}❌ Failed to install dependencies${NC}"
    exit 1
fi
echo ""

# Create custom assets directory if it doesn't exist
if [ ! -d "custom-assets" ]; then
    echo "📁 Creating custom-assets directory..."
    mkdir -p custom-assets
    echo -e "${GREEN}✅ Directory created${NC}"
fi
echo ""

# Check for logo
if [ ! -f "custom-assets/logo.png" ] && [ ! -f "custom-assets/logo.svg" ]; then
    echo -e "${YELLOW}⚠️  No logo found in custom-assets/${NC}"
    echo "   Using default SVG logo"
    echo "   You can replace it with your own logo.png or logo.svg"
fi
echo ""

# Create .env file if it doesn't exist
if [ ! -f ".env" ]; then
    echo "📝 Creating .env file..."
    cat > .env << EOF
# HeyGen Credentials (optional)
# HEYGEN_EMAIL=your@email.com
# HEYGEN_PASSWORD=yourpassword

# Server Configuration
PROXY_PORT=3000
PUPPETEER_PORT=3001

# Feature Flags
ENABLE_VERBOSE_LOGGING=false
ENABLE_CACHING=true
EOF
    echo -e "${GREEN}✅ .env file created${NC}"
else
    echo -e "${GREEN}✅ .env file already exists${NC}"
fi
echo ""

# Test if ports are available
echo "🔍 Checking if ports are available..."

if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Port 3000 is already in use${NC}"
    echo "   You may need to stop the existing process or change the port"
else
    echo -e "${GREEN}✅ Port 3000 is available${NC}"
fi

if lsof -Pi :3001 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Port 3001 is already in use${NC}"
    echo "   You may need to stop the existing process or change the port"
else
    echo -e "${GREEN}✅ Port 3001 is available${NC}"
fi
echo ""

# Setup complete
echo "╔════════════════════════════════════════════════════════╗"
echo "║  ✅ Setup Complete!                                    ║"
echo "╠════════════════════════════════════════════════════════╣"
echo "║  Next Steps:                                           ║"
echo "║                                                        ║"
echo "║  1. Start the reverse proxy:                          ║"
echo "║     npm run proxy                                      ║"
echo "║                                                        ║"
echo "║  2. Or start Puppeteer server:                        ║"
echo "║     npm run puppeteer                                  ║"
echo "║                                                        ║"
echo "║  3. Open in browser:                                  ║"
echo "║     http://localhost:3000 (proxy)                      ║"
echo "║     http://localhost:3001 (puppeteer)                  ║"
echo "║                                                        ║"
echo "║  4. Customize branding in config.js                   ║"
echo "║                                                        ║"
echo "║  📚 Read USAGE.md for detailed instructions           ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""

echo -e "${YELLOW}⚠️  IMPORTANT: This is for educational purposes only${NC}"
echo -e "${YELLOW}   Using this may violate HeyGen's Terms of Service${NC}"
echo ""
