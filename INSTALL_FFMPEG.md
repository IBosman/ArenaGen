# Installing FFmpeg for Thumbnail Generation

## Quick Install

After updating the code, you need to install the new npm package:

```bash
npm install
```

This will install `fluent-ffmpeg` which is the Node.js wrapper for ffmpeg.

## System Requirements

You also need the **ffmpeg binary** installed on your system:

### Ubuntu/Debian (including Render.com)
```bash
sudo apt update && sudo apt install -y ffmpeg
```

### macOS
```bash
brew install ffmpeg
```

### Windows
1. Download from: https://ffmpeg.org/download.html
2. Extract and add to PATH

## Verify Installation

```bash
ffmpeg -version
```

You should see output like:
```
ffmpeg version 4.x.x
```

## For Render.com Deployment

Add this to your build command in Render dashboard:

```bash
apt-get update && apt-get install -y ffmpeg && npm install && npx playwright install chromium chromium-headless-shell
```

Or create a `render-build.sh` script:

```bash
#!/bin/bash
apt-get update
apt-get install -y ffmpeg
npm install
npx playwright install chromium chromium-headless-shell
```

Then set build command to: `bash render-build.sh`

## Testing

After installation, save a video and check:
1. Video saves successfully
2. Thumbnail is generated in the same directory
3. Gallery page displays the thumbnail
4. Console shows: `✅ Thumbnail generated: [path]`

## Troubleshooting

**Error: "Cannot find ffmpeg"**
- Make sure ffmpeg is installed: `which ffmpeg`
- If not in PATH, set it in code:
  ```javascript
  import ffmpeg from 'fluent-ffmpeg';
  ffmpeg.setFfmpegPath('/usr/bin/ffmpeg');
  ```

**Thumbnail not generating but video saves**
- Check server logs for ffmpeg errors
- Verify video file is valid and not corrupted
- Try manually: `ffmpeg -i video.mp4 -ss 0.1 -vframes 1 thumb.jpg`
