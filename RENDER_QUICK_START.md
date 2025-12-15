# Render.com Quick Start Guide

## 🚀 Deploy in 5 Minutes

### Step 1: Prepare Your Repository

Make sure these files are in your repo:
- ✅ `Dockerfile`
- ✅ `render.yaml`
- ✅ `.dockerignore`
- ✅ `package.json`

### Step 2: Push to GitHub/GitLab

```bash
git add .
git commit -m "Add Docker deployment"
git push origin main
```

### Step 3: Create Render Service

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Click **"New +"** → **"Web Service"**
3. Connect your repository
4. Render will auto-detect `render.yaml`
5. Click **"Create Web Service"**

### Step 4: Configure (if not using render.yaml)

If manually configuring:

**Environment:**
- Select: `Docker`

**Settings:**
- **Name**: `arenagen`
- **Region**: Choose closest to you
- **Branch**: `main`
- **Dockerfile Path**: `./Dockerfile`

**Environment Variables:**
```
AUTH_SECRET=<click-generate>
NODE_ENV=production
PORT=3000
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
```

**Persistent Disk** (Important for video storage):
- **Name**: `uploads`
- **Mount Path**: `/app/uploads`
- **Size**: 1 GB (or more)

### Step 5: Deploy!

Click **"Create Web Service"** and wait ~5-10 minutes for build.

## ✅ Verify Deployment

Once deployed, test these endpoints:

```bash
# Health check
curl https://your-app.onrender.com

# Check if FFmpeg works (after saving a video)
# Thumbnails should appear in gallery
```

## 🔧 Common Issues

### Build Timeout
- Increase build timeout in Render settings
- First build takes longer (~10 min)
- Subsequent builds are faster (~3-5 min)

### Out of Memory
- Upgrade to Starter plan ($7/mo)
- Free tier has limited memory

### Videos Not Persisting
- Add persistent disk in Render dashboard
- Mount to `/app/uploads`

### FFmpeg Not Found
- Check Dockerfile has `apt-get install ffmpeg`
- Verify build logs show ffmpeg installation

## 📊 Monitoring

**Check Logs:**
1. Go to your service in Render dashboard
2. Click "Logs" tab
3. Look for:
   - `✅ Video saved: ...`
   - `✅ Thumbnail generated: ...`
   - Any error messages

**Check Metrics:**
- CPU usage
- Memory usage
- Disk usage (if persistent disk added)

## 💰 Pricing

| Plan | Price | Features |
|------|-------|----------|
| Free | $0 | 750 hrs/mo, sleeps after 15min inactivity |
| Starter | $7/mo | Always on, better performance |
| Disk | $0.25/GB/mo | Persistent storage |

**Recommended for Production:**
- Starter plan: $7/mo
- 1-5GB disk: $0.25-$1.25/mo
- **Total: ~$8-9/mo**

## 🔄 Updating Your App

```bash
# Make changes locally
git add .
git commit -m "Update feature"
git push origin main

# Render auto-deploys on push
# Or manually trigger from dashboard
```

## 🆘 Need Help?

1. Check [DOCKER_DEPLOYMENT.md](./DOCKER_DEPLOYMENT.md) for detailed guide
2. Review Render logs for errors
3. Test Docker build locally first:
   ```bash
   docker build -t arenagen .
   docker run -p 3000:3000 arenagen
   ```

## 🎉 Success Checklist

- [ ] App is accessible at your Render URL
- [ ] Can login and authenticate
- [ ] Can generate videos
- [ ] Thumbnails appear in gallery
- [ ] Videos persist after restart (if disk added)
- [ ] Dark mode works
- [ ] No errors in logs

## 🔗 Useful Links

- [Render Dashboard](https://dashboard.render.com/)
- [Render Docker Docs](https://render.com/docs/docker)
- [Render Persistent Disks](https://render.com/docs/disks)
