# Video Card Feature

## Overview
When HeyGen completes a video, the frontend now displays a rich video card with thumbnail preview and playable video modal, matching HeyGen's native UI.

## Implementation

### Backend (`playwright-live-proxy.js`)

#### Video Detection
Both `navigate` and `get_messages` actions now detect video completion cards in **separate divs**:

```javascript
// Get all chat rows AND video cards in order
const allElements = Array.from(
  document.querySelectorAll('div.tw-flex.tw-justify-end, div.tw-flex.tw-justify-start, div.tw-border-brand.tw-bg-more-brandLighter')
);

const messages = allElements.map(row => {
  // Check if this is a video card (not a chat row)
  if (row.classList.contains('tw-border-brand') && row.classList.contains('tw-bg-more-brandLighter')) {
    const thumbnailImg = row.querySelector('img[alt="draft thumbnail"]');
    const titleElement = row.querySelector('.tw-text-base.tw-font-bold.tw-tracking-tight');
    const subtitleElement = row.querySelector('.tw-text-sm.tw-font-medium.tw-text-textBody span');
    
    if (thumbnailImg) {
      const thumbnail = thumbnailImg.src;
      const title = titleElement ? titleElement.innerText.trim() : 'Your video is ready!';
      
      return {
        role: 'agent',
        text: subtitleElement ? subtitleElement.innerText.trim() : '',
        video: {
          thumbnail: thumbnail,
          videoUrl: null, // Fetched separately by clicking card
          poster: thumbnail,
          title: title
        }
      };
    }
  }
  // ... regular chat row logic
});
```

#### Video URL Extraction
New `get_video_url` action clicks the card and extracts the video URL:

```javascript
case 'get_video_url':
  const videoCard = await activePage.$('div.tw-border-brand.tw-bg-more-brandLighter');
  await videoCard.click();
  await activePage.waitForSelector('video', { timeout: 5000 });
  
  const videoData = await activePage.evaluate(() => {
    const video = document.querySelector('video');
    return {
      videoUrl: video.src || video.querySelector('source')?.src,
      poster: video.poster,
      duration: video.duration
    };
  });
```

#### Message Format
Messages with videos now include a `video` object:

```javascript
{
  role: 'agent',
  text: 'I have successfully generated the video...',
  video: {
    thumbnail: 'https://dynamic.heygen.ai/.../thumbnail.jpeg',
    videoUrl: 'https://resource2.heygen.ai/.../720x1280.mp4',
    poster: 'https://files2.heygen.ai/.../poster.jpeg',
    title: 'Xenomorph Awakening'
  }
}
```

### Frontend (`GenerationPage.jsx`)

#### Video Card Display
When a message contains a `video` object, it renders a clickable card:

- **Design**: Teal-to-blue gradient background with teal border (matching HeyGen)
- **Thumbnail**: 80x80px rounded image with play button overlay
- **Title**: Video title extracted from HeyGen
- **Subtitle**: "Your video is ready!"
- **Hover effect**: Play button opacity increases on hover

#### Video Modal
Clicking the card opens a full-screen modal:

- **Backdrop**: Semi-transparent black overlay
- **Header**: Gradient bar with video title
- **Close button**: Top-right X button
- **Video player**: Native HTML5 video with controls
- **Autoplay**: Video starts playing automatically
- **Poster**: Shows thumbnail while loading
- **Fallback**: If no video URL, shows large thumbnail

## UI Components

### Video Card (in chat)
```jsx
<div className="relative cursor-pointer group overflow-hidden rounded-xl border-2 border-teal-500 bg-gradient-to-r from-teal-900 to-blue-900 p-4">
  <div className="flex items-center gap-4">
    <div className="relative flex-shrink-0">
      <img src={thumbnail} className="w-20 h-20 object-cover rounded-lg" />
      <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-30">
        <PlayIcon />
      </div>
    </div>
    <div className="flex-1">
      <h3 className="text-white font-medium">{title}</h3>
      <p className="text-teal-200 text-sm">Your video is ready!</p>
    </div>
  </div>
</div>
```

### Video Modal
```jsx
<div className="fixed inset-0 bg-black bg-opacity-75 z-50">
  <div className="max-w-4xl bg-gray-900 rounded-2xl">
    <div className="bg-gradient-to-r from-teal-900 to-blue-900 px-6 py-4">
      <h2>{title}</h2>
    </div>
    <video src={videoUrl} poster={poster} controls autoPlay />
  </div>
</div>
```

## Selectors Used

### HeyGen DOM Structure

**Video cards are in SEPARATE divs, not inside chat rows!**

- **Video card container**: `div.tw-border-brand.tw-bg-more-brandLighter`
- **Thumbnail**: `img[alt="draft thumbnail"]` (inside card)
- **Title**: `.tw-text-base.tw-font-bold.tw-tracking-tight`
- **Subtitle**: `.tw-text-sm.tw-font-medium.tw-text-textBody span`
- **Video element**: Appears in modal/player after clicking card

### Example HeyGen HTML
```html
<!-- Video card (separate from chat rows) -->
<div class="tw-flex tw-flex-col tw-items-stretch tw-rounded-2xl tw-border tw-p-4 tw-gap-0 tw-relative tw-border-brand tw-bg-more-brandLighter tw-cursor-pointer tw-group">
  <div class="tw-flex tw-size-full tw-items-center tw-justify-between">
    <div class="tw-flex tw-size-full tw-items-center tw-gap-4">
      <div class="tw-relative tw-w-1/4 tw-max-w-32 tw-shrink-0">
        <img class="tw-relative tw-size-full tw-object-cover" 
             alt="draft thumbnail" 
             src="https://dynamic.heygen.ai/.../thumbnail.jpeg">
      </div>
      <div class="tw-flex tw-flex-col tw-items-start tw-gap-2">
        <span class="tw-text-base tw-font-bold tw-tracking-tight tw-text-textTitle">Better Worlds</span>
        <span class="tw-text-sm tw-font-medium tw-text-textBody">Your video is ready!</span>
      </div>
    </div>
  </div>
</div>
```

## Features

✅ **Automatic detection**: Videos detected via `img[alt="draft thumbnail"]`
✅ **Rich preview**: Thumbnail with play button overlay
✅ **Full playback**: Modal with native video controls
✅ **Autoplay**: Video starts immediately when modal opens
✅ **Responsive**: Works on mobile and desktop
✅ **Accessible**: Keyboard navigation (ESC to close)
✅ **Fallback**: Shows thumbnail if video URL missing

## Testing

1. Start a video generation session
2. Wait for HeyGen to complete the video
3. Video card appears in chat with thumbnail
4. Click card to open modal
5. Video plays automatically with controls
6. Click X or backdrop to close modal

## Styling

- **Card colors**: Teal (#14b8a6) and blue (#1e40af)
- **Border**: 2px solid teal-500
- **Gradient**: `from-teal-900 to-blue-900`
- **Thumbnail size**: 80x80px in card, 256x256px in fallback
- **Play button**: White with semi-transparent black background
- **Modal backdrop**: Black with 75% opacity

## Future Enhancements

- Download button in modal
- Share functionality
- Video duration display
- Progress indicator during generation
- Multiple video formats support
- Thumbnail generation if missing
