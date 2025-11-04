import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { authRouter } from './auth-server.js';
import { proxyRouter } from './playwright-live-proxy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const app = express();

// Create HTTP server for WebSocket support
const server = createServer(app);

// Mount routers
app.use('/auth', authRouter);
app.use('/proxy', proxyRouter);

// Serve frontend static files
app.use('/', express.static(path.join(__dirname, 'frontend', 'build')));

// Fallback for SPA routing - serve index.html for any unmatched routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'build', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`╔════════════════════════════════════════════════════════╗`);
  console.log(`║ 🚀 ArenaGen - Unified Server                          ║`);
  console.log(`╠════════════════════════════════════════════════════════╣`);
  console.log(`║ Server running on port ${PORT}                            ║`);
  console.log(`║ Frontend: http://localhost:${PORT}                        ║`);
  console.log(`║ Auth API: http://localhost:${PORT}/auth                   ║`);
  console.log(`║ Proxy API: http://localhost:${PORT}/proxy                 ║`);
  console.log(`╚════════════════════════════════════════════════════════╝`);
});
