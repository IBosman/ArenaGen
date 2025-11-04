# Quick Setup Guide - New Authentication System

## What Changed

✅ **User login** now uses custom accounts from `users.json` (not HeyGen accounts)
✅ **HeyGen session** managed automatically via `.env` credentials
✅ **Auto-refresh** when cookies expire (24-hour expiry)
✅ Users don't need HeyGen accounts anymore

## Setup Steps

### 1. Install Dependencies

```bash
npm install
```

This installs `dotenv` for environment variable support.

### 2. Configure Environment

Your `.env` file should contain:

```
HEYGEN_EMAIL=your_heygen_email@example.com
HEYGEN_PASSWORD=your_heygen_password
```

These credentials are used by the backend to maintain the HeyGen session.

### 3. Verify Users Database

Check `users.json` exists with at least one user:

```json
{
  "users": [
    {
      "id": "1",
      "username": "admin",
      "email": "admin@arenagen.com",
      "password": "admin123",
      "createdAt": "2024-11-03T10:00:00.000Z",
      "role": "admin"
    }
  ]
}
```

### 4. Start the Server

```bash
npm run auth
```

Or:

```bash
node auth-server.js
```

### 5. Test Login

Navigate to `http://localhost:3002` and login with:

- **Email**: `admin@arenagen.com`
- **Password**: `admin123`

## How It Works

### Login Flow

1. User enters ArenaGen credentials
2. System validates against `users.json`
3. System checks HeyGen session:
   - ✅ Valid → User logged in
   - ❌ Expired → Auto-refresh using `.env` credentials
4. User redirected to `/home`

### Auto-Refresh

When HeyGen cookies expire (after 24 hours):

1. System detects expired cookies
2. Reads `HEYGEN_EMAIL` and `HEYGEN_PASSWORD` from `.env`
3. Opens Playwright browser (visible)
4. Logs into HeyGen automatically
5. Saves new cookies
6. Continues user's request

This happens automatically - users never see it!

## Adding New Users

Edit `users.json`:

```json
{
  "users": [
    {
      "id": "1",
      "username": "admin",
      "email": "admin@arenagen.com",
      "password": "admin123",
      "createdAt": "2024-11-03T10:00:00.000Z",
      "role": "admin"
    },
    {
      "id": "2",
      "username": "john",
      "email": "john@example.com",
      "password": "secure_password",
      "createdAt": "2024-11-03T12:00:00.000Z",
      "role": "user"
    }
  ]
}
```

No server restart needed - changes take effect immediately!

## Files Modified

- ✅ `auth-server.js` - New authentication logic
- ✅ `package.json` - Added `dotenv` dependency
- ✅ `.env.example` - Environment template
- ✅ `users.json` - User database
- ✅ `users.json.example` - User database template
- ✅ `.gitignore` - Added `users.json` to prevent committing credentials

## Console Output

When server starts, you'll see:

```
╔════════════════════════════════════════════════════════╗
║  🔐 ArenaGen - Authentication Server                  ║
╠════════════════════════════════════════════════════════╣
║  Login URL:    http://localhost:3002                   ║
║  Status:       ✅ Authenticated                         ║
╠════════════════════════════════════════════════════════╣
║  Flow:                                                 ║
║  1. Login here (custom UI)                            ║
║  2. Playwright authenticates                          ║
║  3. Redirect to proxy (port 3000)                     ║
╚════════════════════════════════════════════════════════╝
```

When user logs in:

```
🔑 Attempting login for: admin@arenagen.com
✅ User validated: admin
✅ HeyGen session is valid
```

When cookies expire:

```
🔑 Attempting login for: admin@arenagen.com
✅ User validated: admin
⚠️  HeyGen session expired or missing, refreshing...
🔄 Refreshing HeyGen session with credentials from .env
📱 Navigating to HeyGen login...
📧 Entering email...
🔒 Entering password...
⏳ Waiting for login to complete...
✅ HeyGen session refreshed successfully!
```

## Troubleshooting

### "HeyGen credentials not found in .env file"

- Check `.env` file exists
- Verify `HEYGEN_EMAIL` and `HEYGEN_PASSWORD` are set
- Restart server after editing `.env`

### "Invalid email or password"

- Check credentials match `users.json`
- Verify `users.json` is valid JSON
- Check for typos

### "Failed to establish HeyGen session"

- Verify HeyGen credentials in `.env` are correct
- Check Playwright browser window for errors
- Ensure HeyGen account is active

## Security Notes

⚠️ **Current implementation is for development only**

For production:
- Hash passwords with bcrypt
- Use JWT tokens for sessions
- Move to proper database (PostgreSQL/MongoDB)
- Add rate limiting
- Use HTTPS
- Implement proper error handling

See `AUTH_SYSTEM.md` for detailed security recommendations.

## Next Steps

1. Run `npm install`
2. Verify `.env` has HeyGen credentials
3. Start server: `npm run auth`
4. Test login at `http://localhost:3002`
5. Add more users to `users.json` as needed

Done! 🎉
