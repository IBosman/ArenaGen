# Custom Assets

Place your custom branding assets here:

## Required Files

- **logo.png** - Your company logo (recommended: 200x50px, transparent background)
- **favicon.ico** - Your favicon (16x16 or 32x32)
- **custom.css** - Additional custom styles (optional)

## Example Logo

You can create a simple text-based logo using ImageMagick:

```bash
convert -size 200x50 xc:transparent \
  -font Arial -pointsize 24 -fill '#6366f1' \
  -gravity center -annotate +0+0 'VideoAI Pro' \
  logo.png
```

Or use an online tool like:
- https://www.canva.com
- https://www.figma.com
- https://logo.com

## SVG Logo Example

Create `logo.svg`:

```svg
<svg width="200" height="50" xmlns="http://www.w3.org/2000/svg">
  <text x="10" y="35" font-family="Arial" font-size="24" fill="#6366f1" font-weight="bold">
    VideoAI Pro
  </text>
</svg>
```
