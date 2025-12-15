# Video Thumbnail Generation

## Overview

The system automatically generates thumbnails from saved videos using the `fluent-ffmpeg` npm package. When a video is saved via the `/save-video` endpoint, a thumbnail is extracted from the first frame and saved alongside the video.

## How It Works

### 1. Video Save Process

When a video is saved:
1. Video is downloaded to: `uploads/[user_email]/[title]-[hash].mp4`
2. Thumbnail is generated using fluent-ffmpeg: `uploads/[user_email]/[title]-[hash]-thumbnail.jpg`
3. The thumbnail is extracted at 0.1 seconds to avoid black frames
4. Size is set to maintain aspect ratio with max height of 1080px

### 2. Fluent-FFmpeg Implementation

```javascript
ffmpeg(filePath)
  .screenshots({
    timestamps: ['0.1'],
    filename: path.basename(thumbnailPath),
    folder: path.dirname(thumbnailPath),
    size: '?x1080' // Maintain aspect ratio, max height 1080px
  })
  .on('end', () => console.log('Thumbnail generated'))
  .on('error', (err) => console.error('Error:', err));
```

**Parameters:**
- `timestamps: ['0.1']` - Extract frame at 0.1 seconds (avoids black intro frames)
- `filename` - Output filename
- `folder` - Output directory
- `size: '?x1080'` - Maintain aspect ratio, max height 1080px

### 3. API Response

The `/save-video` endpoint returns:

```json
{
  "success": true,
  "message": "Video and thumbnail saved successfully",
  "path": "/path/to/video.mp4",
  "filename": "video-hash.mp4",
  "thumbnailPath": "/path/to/video-hash-thumbnail.jpg",
  "thumbnailFilename": "video-hash-thumbnail.jpg",
  "isDuplicate": false
}
```

### 4. Gallery Display

The `/api/videos` endpoint automatically includes thumbnails:

```json
{
  "success": true,
  "videos": [
    {
      "id": "video-hash.mp4",
      "title": "Video Title",
      "url": "/proxy/uploads/user_email/video-hash.mp4",
      "thumbnail": "/proxy/uploads/user_email/video-hash-thumbnail.jpg",
      "duration": 0,
      "createdAt": "2025-01-01T00:00:00.000Z",
      "size": 1234567
    }
  ]
}
```

### 5. Deletion

When a video is deleted via `/api/videos/:videoId`, both the video and its thumbnail are removed.

## Installation

### 1. Install npm package

The `fluent-ffmpeg` package is already included in `package.json`:

```bash
npm install
```

### 2. Install FFmpeg binary

**FFmpeg must be installed on the system:**

#### Ubuntu/Debian
```bash
sudo apt update
sudo apt install ffmpeg
```

#### macOS
```bash
brew install ffmpeg
```

#### Windows
Download from: https://ffmpeg.org/download.html

#### Verify Installation
```bash
ffmpeg -version
```

### 3. Optional: Set FFmpeg path

If ffmpeg is not in your PATH, you can set it programmatically:

```javascript
import ffmpeg from 'fluent-ffmpeg';
ffmpeg.setFfmpegPath('/path/to/ffmpeg');
```

## Error Handling

If ffmpeg fails to generate a thumbnail:
- The video is still saved successfully
- The API returns a success response with a `thumbnailError` field
- The gallery will display the video without a thumbnail (falls back to placeholder)

## File Structure

```
uploads/
└── user_email_com/
    ├── video-title-abc123.mp4
    ├── video-title-abc123-thumbnail.jpg
    ├── another-video-def456.mp4
    └── another-video-def456-thumbnail.jpg
```

## Frontend Usage

The `GalleryPage.jsx` component automatically uses thumbnails when available:

```jsx
{video.thumbnail && (
  <img
    src={video.thumbnail}
    alt={video.title}
    className="w-full h-full object-cover"
  />
)}
```

If no thumbnail exists, it falls back to a placeholder SVG icon.
