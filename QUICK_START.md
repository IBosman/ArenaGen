# 🚀 Quick Start Guide

## ⚡ 30-Second Setup

```bash
# 1. Install dependencies
npm install

# 2. Start the proxy
npm run proxy

# 3. Open browser
# http://localhost:3000
```

That's it! 🎉

---

## 📋 Command Reference

| Command | Description | Port |
|---------|-------------|------|
| `npm run proxy` | Start reverse proxy | 3000 |
| `npm run puppeteer` | Start Puppeteer server | 3001 |
| `node test-proxy.js` | Test proxy functionality | - |
| `./setup.sh` | Run setup wizard | - |

---

## 🎨 Quick Customization

### Change Brand Name

Edit `config.js`:
```javascript
branding: {
  name: 'Your Brand Name'  // ← Change this
}
```

### Change Colors

Edit `config.js`:
```javascript
colors: {
  primary: '#YOUR_COLOR'  // ← Change this
}
```

### Add Your Logo

1. Save logo as `custom-assets/logo.png`
2. Restart server
3. Done!

---

## 🔍 Testing

### Quick Test
```bash
node test-proxy.js
```

### Manual Test
1. Open http://localhost:3000
2. Look for your brand name
3. Check if colors changed
4. Verify logo is replaced

---

## 🐛 Troubleshooting

### Port Already in Use
```bash
# Kill process on port 3000
lsof -ti:3000 | xargs kill -9

# Or change port in config.js
```

### Dependencies Missing
```bash
npm install
```

### Proxy Not Working
```bash
# Check if HeyGen is accessible
curl -I https://app.heygen.com

# Run test
node test-proxy.js
```

---

## 📚 Documentation

| File | Purpose |
|------|---------|
| `README.md` | Overview and introduction |
| `USAGE.md` | Detailed usage instructions |
| `COMPARISON.md` | Proxy vs Puppeteer comparison |
| `ARCHITECTURE.md` | Technical architecture |
| `QUICK_START.md` | This file |

---

## ⚙️ Configuration Files

| File | Purpose |
|------|---------|
| `config.js` | Centralized configuration |
| `package.json` | Dependencies and scripts |
| `.env` | Environment variables (optional) |
| `.gitignore` | Git ignore rules |

---

## 🎯 Common Tasks

### Take a Screenshot
```bash
# Start Puppeteer server
npm run puppeteer

# Visit in browser
http://localhost:3001/screenshot
```

### Refresh Content
```bash
# Visit in browser
http://localhost:3001/refresh
```

### Change Target URL
Edit `config.js`:
```javascript
target: {
  url: 'https://your-target-site.com'
}
```

---

## 🔐 Authentication

If HeyGen requires login:

1. **Option 1:** Login in your browser first
2. **Option 2:** Add credentials to `.env`:
   ```
   HEYGEN_EMAIL=your@email.com
   HEYGEN_PASSWORD=yourpassword
   ```

---

## 📊 Project Structure

```
ai_video_agent/
├── proxy-server.js       ← Main proxy server
├── puppeteer-rebrand.js  ← Puppeteer server
├── config.js             ← Configuration
├── package.json          ← Dependencies
├── custom-assets/        ← Your branding assets
│   └── logo.png         ← Your logo
└── README.md            ← Documentation
```

---

## 💡 Tips

1. **Start with proxy** - Easier to debug
2. **Use Puppeteer for screenshots** - Better quality
3. **Check browser console** - For errors
4. **Read USAGE.md** - For detailed info
5. **Customize config.js** - Centralized settings

---

## ⚠️ Important Notes

- ✅ Educational purposes only
- ❌ Don't use in production
- ❌ May violate Terms of Service
- ✅ Great for learning!

---

## 🆘 Need Help?

1. Check `USAGE.md` for detailed instructions
2. Read `COMPARISON.md` to understand differences
3. Review `ARCHITECTURE.md` for technical details
4. Run `node test-proxy.js` to diagnose issues

---

## 🎓 Learning Path

1. **Start here** → Quick Start (you are here!)
2. **Understand** → README.md
3. **Deep dive** → USAGE.md
4. **Compare** → COMPARISON.md
5. **Master** → ARCHITECTURE.md

---

## 🚀 Next Steps

1. ✅ Run `npm install`
2. ✅ Run `npm run proxy`
3. ✅ Open http://localhost:3000
4. ✅ Customize `config.js`
5. ✅ Add your logo
6. ✅ Experiment and learn!

---

**Happy coding! 🎉**
