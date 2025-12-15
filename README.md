# ArenaGen

A video generation platform with automatic thumbnail generation and dark mode support.

## Features

- 🎥 Video generation and management
- 🖼️ Automatic thumbnail generation using FFmpeg
- 🌙 System-based dark mode
- 💾 User-specific video storage
- 📜 Chat history with sidebar
- 🎨 Modern, responsive UI

## Quick Start

### Local Development

```bash
# Install dependencies
npm install
cd frontend && npm install && cd ..

# Start the server
npm start
```

### Docker Deployment (Recommended for Production)

```bash
# Build
docker build -t arenagen .

# Run
docker run -p 3000:3000 \
  -e AUTH_SECRET=your-secret-key \
  -v $(pwd)/uploads:/app/uploads \
  arenagen
```

## Deployment

### Render.com (Docker)

1. Push your code to GitHub/GitLab
2. Connect repository to Render
3. Render will detect `render.yaml` automatically
4. Click "Create Web Service"

See [DOCKER_DEPLOYMENT.md](./DOCKER_DEPLOYMENT.md) for detailed instructions.

### Environment Variables

```env
PORT=3000
NODE_ENV=production
AUTH_SECRET=your-secret-key-here
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
```

## Documentation

- [Docker Deployment Guide](./DOCKER_DEPLOYMENT.md) - Complete Docker setup and Render deployment
- [Thumbnail Generation](./THUMBNAIL_GENERATION.md) - How video thumbnails work
- [FFmpeg Installation](./INSTALL_FFMPEG.md) - Installing FFmpeg for local development
- [Authentication System](./README_AUTH.md) - User authentication details
- [Main Server](./README-MAIN-SERVER.md) - Server architecture

## Requirements

### For Docker Deployment (Recommended)
- Docker installed locally (for testing)
- Render.com account (or any Docker-compatible host)

### For Local Development
- Node.js 18+ 
- FFmpeg installed on system
- Chromium/Chrome browser

## Project Structure

```
ArenaGen/
├── frontend/              # React frontend
│   ├── src/
│   │   ├── components/   # React components
│   │   └── App.js        # Main app
│   └── package.json
├── uploads/              # User video storage
├── Dockerfile            # Docker configuration
├── render.yaml           # Render deployment config
├── unified-server.js     # Main server entry
├── auth-server.js        # Authentication
├── playwright-live-proxy.js  # Browser automation
└── package.json
```

## Key Features

### Automatic Thumbnail Generation

When videos are saved, thumbnails are automatically generated using FFmpeg:
- Extracts first frame at 0.1 seconds
- Maintains aspect ratio
- High quality JPEG output
- Stored alongside video files

### Dark Mode

System-based dark mode that automatically adapts to user's OS preferences:
- No toggle needed
- Smooth transitions
- Comprehensive coverage across all components

### Video Management

- Upload and generate videos
- View video gallery with thumbnails
- Download videos
- Delete videos (with thumbnail cleanup)
- User-specific storage

## Development

```bash
# Install dependencies
npm install
cd frontend && npm install && cd ..

# Start development server
npm run dev

# Build frontend
cd frontend && npm run build
```

## Testing

```bash
# Test Docker build
docker build -t arenagen .

# Test Docker run
docker run -p 3000:3000 -e AUTH_SECRET=test arenagen

# Verify FFmpeg
docker run arenagen ffmpeg -version

# Verify Chromium
docker run arenagen chromium --version
```

## Troubleshooting

### Videos not saving thumbnails
- Check FFmpeg is installed: `ffmpeg -version`
- Check server logs for FFmpeg errors
- Verify video file is valid

### Dark mode not working
- Clear browser cache
- Check system dark mode is enabled
- Verify Tailwind config has `darkMode: 'media'`

### Docker build fails
- Check Dockerfile syntax
- Ensure all dependencies are listed
- Verify base image is accessible

## License

MIT

## Support

For issues and questions:
1. Check documentation in `/docs` folder
2. Review troubleshooting guides
3. Check server logs for errors
