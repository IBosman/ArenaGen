# Docker Deployment Guide

## Overview

This application is containerized using Docker to ensure ffmpeg and all system dependencies are available, especially for platforms like Render.com that don't allow system-level package installation in standard builds.

## What's Included in the Docker Image

- **Node.js 20 (LTS)**: Runtime environment
- **FFmpeg**: For video thumbnail generation
- **Chromium**: System browser for Playwright
- **All required libraries**: For headless browser operation

## Local Development with Docker

### Build the image:
```bash
docker build -t arenagen .
```

### Run the container:
```bash
docker run -p 3000:3000 \
  -e AUTH_SECRET=your-secret-key \
  -v $(pwd)/uploads:/app/uploads \
  arenagen
```

### With environment file:
```bash
docker run -p 3000:3000 \
  --env-file .env \
  -v $(pwd)/uploads:/app/uploads \
  arenagen
```

## Render.com Deployment

### Option 1: Using render.yaml (Recommended)

1. Push your code to GitHub/GitLab
2. Connect your repository to Render
3. Render will automatically detect `render.yaml` and configure everything
4. Click "Create Web Service"

### Option 2: Manual Setup

1. **Create New Web Service** on Render dashboard
2. **Connect your repository**
3. **Configure settings:**
   - **Environment**: `Docker`
   - **Dockerfile Path**: `./Dockerfile`
   - **Docker Build Context**: `.` (root)
   - **Region**: Choose your preferred region
   - **Plan**: Starter or Free

4. **Add Environment Variables:**
   ```
   NODE_ENV=production
   PORT=3000
   AUTH_SECRET=<generate-random-secret>
   PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
   PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
   ```

5. **Add Persistent Disk** (for video uploads):
   - **Name**: `uploads`
   - **Mount Path**: `/app/uploads`
   - **Size**: 1GB (or more as needed)

6. **Deploy!**

## Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `PORT` | Server port | No | 3000 |
| `NODE_ENV` | Environment mode | No | development |
| `AUTH_SECRET` | JWT secret key | Yes | - |
| `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` | Use system chromium | No | 1 |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` | Chromium path | No | /usr/bin/chromium |

## Dockerfile Explanation

```dockerfile
# Base image with Node.js
FROM node:20-slim

# Install ffmpeg and chromium with dependencies
RUN apt-get update && apt-get install -y ffmpeg chromium ...

# Install backend dependencies
WORKDIR /app
RUN npm install

# Build frontend
WORKDIR /app/frontend
RUN npm install && npm run build

# Copy application code
COPY . .

# Use system chromium
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

# Start server
CMD ["node", "unified-server.js"]
```

## Build Process

The Docker build follows these steps:

1. ✅ Install system packages (ffmpeg, chromium, libraries)
2. ✅ Install backend npm dependencies
3. ✅ Install frontend npm dependencies
4. ✅ Build frontend (creates `frontend/dist`)
5. ✅ Copy application code
6. ✅ Configure Playwright to use system chromium
7. ✅ Start the server

## Persistent Storage

Videos and thumbnails are stored in `/app/uploads` inside the container. On Render:

- **Without persistent disk**: Files are lost on restart
- **With persistent disk**: Files persist across deployments

**Recommended**: Add a persistent disk on Render for production use.

## Troubleshooting

### Build fails with "Cannot find ffmpeg"
- Check that ffmpeg is installed in Dockerfile
- Verify: `RUN apt-get install -y ffmpeg`

### Chromium crashes or won't start
- Ensure all chromium dependencies are installed
- Check PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH is set correctly
- Verify chromium is installed: `RUN apt-get install -y chromium`

### Port binding issues
- Render sets PORT environment variable automatically
- Make sure your app uses `process.env.PORT`

### Frontend not building
- Check frontend/package.json has `build` script
- Verify Vite configuration is correct
- Check build logs for specific errors

### Videos not persisting
- Add persistent disk in Render dashboard
- Mount to `/app/uploads`
- Check disk is attached and mounted

## Testing Locally

```bash
# Build
docker build -t arenagen .

# Run
docker run -p 3000:3000 -e AUTH_SECRET=test-secret arenagen

# Test
curl http://localhost:3000

# Check ffmpeg
docker run arenagen ffmpeg -version

# Check chromium
docker run arenagen chromium --version
```

## Image Size Optimization

Current image size: ~1.5GB (includes chromium and dependencies)

To reduce size:
- Use `node:20-alpine` (smaller base)
- Install only required chromium dependencies
- Multi-stage build (separate build and runtime)

## Security Notes

- Never commit `.env` files with secrets
- Use Render's environment variable management
- Rotate AUTH_SECRET regularly
- Keep dependencies updated
- Use specific version tags for base images

## Updating Deployment

1. Push changes to your repository
2. Render automatically rebuilds and deploys
3. Or manually trigger deploy from Render dashboard

## Monitoring

- Check Render logs for errors
- Monitor disk usage for uploads
- Set up alerts for service health
- Track memory and CPU usage

## Cost Considerations

**Render Pricing:**
- **Free tier**: Limited hours, sleeps after inactivity
- **Starter ($7/mo)**: Always on, better performance
- **Persistent disk**: $0.25/GB/month

**Recommendations:**
- Start with Free tier for testing
- Upgrade to Starter for production
- Add 1-5GB disk for video storage
