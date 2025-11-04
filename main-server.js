#!/usr/bin/env node

import { createAuthServer } from './auth-server.js';
import { createProxyServer } from './playwright-live-proxy.js';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const AUTH_PORT = process.env.AUTH_PORT || 3002;
const PROXY_PORT = process.env.PROXY_PORT || 3000;
const FRONTEND_PORT = process.env.FRONTEND_PORT || 3001;

let frontendProcess = null;

async function startMainServer() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║                🚀 ArenaGen - Main Server               ║');
  console.log('╠════════════════════════════════════════════════════════╣');
  console.log('║  Starting all services...                              ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  
  try {
    // Start Auth Server
    console.log('\n🔐 Starting Authentication Server...');
    const authServer = createAuthServer(AUTH_PORT);
    
    // Start Proxy Server
    console.log('\n🎭 Starting Playwright Proxy Server...');
    const proxyServer = await createProxyServer(PROXY_PORT);
    
    // Start Frontend (React App)
    console.log('\n⚛️  Starting Frontend React App...');
    await startFrontend();
    
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║                    🎉 ALL SERVICES READY               ║');
    console.log('╠════════════════════════════════════════════════════════╣');
    console.log(`║  🔐 Auth Server:    http://localhost:${AUTH_PORT}                ║`);
    console.log(`║  🎭 Proxy Server:   http://localhost:${PROXY_PORT}                ║`);
    console.log(`║  ⚛️  Frontend App:   http://localhost:${FRONTEND_PORT}                ║`);
    console.log('╠════════════════════════════════════════════════════════╣');
    console.log('║  📖 Quick Start:                                       ║');
    console.log(`║  1. Open http://localhost:${FRONTEND_PORT} in your browser        ║`);
    console.log('║  2. You will be redirected to login if not authenticated ║');
    console.log('║  3. After login, you can start generating videos!     ║');
    console.log('╚════════════════════════════════════════════════════════╝');
    
    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down all services...');
      
      if (frontendProcess) {
        console.log('   Stopping frontend...');
        frontendProcess.kill('SIGTERM');
      }
      
      if (proxyServer.browser) {
        console.log('   Closing browser...');
        await proxyServer.browser.close();
      }
      
      if (authServer.server) {
        console.log('   Stopping auth server...');
        authServer.server.close();
      }
      
      if (proxyServer.server) {
        console.log('   Stopping proxy server...');
        proxyServer.server.close();
      }
      
      console.log('✅ All services stopped gracefully');
      process.exit(0);
    });
    
  } catch (error) {
    console.error('❌ Failed to start services:', error);
    process.exit(1);
  }
}

async function startFrontend() {
  return new Promise((resolve, reject) => {
    const frontendDir = path.join(__dirname, 'frontend');
    
    // Start the React development server
    frontendProcess = spawn('npm', ['start'], {
      cwd: frontendDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PORT: FRONTEND_PORT,
        BROWSER: 'none', // Don't auto-open browser
        REACT_APP_API_BASE: `http://localhost:${AUTH_PORT}`,
        REACT_APP_PROXY_HTTP_BASE: `http://localhost:${PROXY_PORT}`,
        REACT_APP_PROXY_WS_URL: `ws://localhost:${PROXY_PORT}`
      }
    });
    
    let startupComplete = false;
    
    frontendProcess.stdout.on('data', (data) => {
      const output = data.toString();
      
      // Look for the "compiled successfully" or "webpack compiled" message
      if (!startupComplete && (
        output.includes('webpack compiled') || 
        output.includes('compiled successfully') ||
        output.includes('Local:')
      )) {
        startupComplete = true;
        console.log('   ✅ Frontend server ready');
        resolve();
      }
      
      // Log frontend output with prefix
      if (process.env.DEBUG_FRONTEND) {
        console.log('   [Frontend]', output.trim());
      }
    });
    
    frontendProcess.stderr.on('data', (data) => {
      const output = data.toString();
      if (process.env.DEBUG_FRONTEND) {
        console.error('   [Frontend Error]', output.trim());
      }
    });
    
    frontendProcess.on('error', (error) => {
      console.error('❌ Failed to start frontend:', error);
      reject(error);
    });
    
    frontendProcess.on('exit', (code) => {
      if (code !== 0 && !startupComplete) {
        reject(new Error(`Frontend process exited with code ${code}`));
      }
    });
    
    // Timeout after 30 seconds
    setTimeout(() => {
      if (!startupComplete) {
        reject(new Error('Frontend startup timeout'));
      }
    }, 30000);
  });
}

// Start the main server
startMainServer().catch(console.error);
