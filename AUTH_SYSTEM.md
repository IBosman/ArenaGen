# Authentication System

## Overview

ArenaGen uses a two-tier authentication system:

1. **User Authentication**: Custom user accounts stored in `users.json`
2. **HeyGen Session**: Backend HeyGen session managed automatically via `.env` credentials

## How It Works

### User Login Flow

1. User enters their ArenaGen credentials (email/password)
2. System validates against `users.json`
3. If valid, system checks HeyGen session status
4. If HeyGen cookies expired, auto-refresh using `.env` credentials
5. User is logged in and can use the platform

### HeyGen Session Management

- HeyGen cookies are stored in `heygen-cookies.json` with 24-hour expiry
- When cookies expire, system automatically:
  - Reads HeyGen credentials from `.env`
  - Opens Playwright browser
  - Logs into HeyGen
  - Saves new cookies
  - Continues user's request

## Setup

### 1. Environment Variables

Create `.env` file in project root:

```bash
cp .env.example .env
```

Edit `.env` and add your HeyGen credentials:

```
HEYGEN_EMAIL=your_heygen_email@example.com
HEYGEN_PASSWORD=your_heygen_password
```

**Important**: These are the HeyGen account credentials used by the backend to maintain the session. Users will NOT need HeyGen accounts.

### 2. User Database

Users are stored in `users.json`:

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

#### Adding Users

Edit `users.json` and add new user objects:

```json
{
  "id": "2",
  "username": "john",
  "email": "john@example.com",
  "password": "secure_password",
  "createdAt": "2024-11-03T12:00:00.000Z",
  "role": "user"
}
```

**Note**: In production, passwords should be hashed using bcrypt or similar.

### 3. Install Dependencies

```bash
npm install
```

This will install `dotenv` for environment variable support.

## API Endpoints

### POST `/api/login`

Login with user credentials.

**Request:**
```json
{
  "email": "admin@arenagen.com",
  "password": "admin123"
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Login successful",
  "user": {
    "id": "1",
    "username": "admin",
    "email": "admin@arenagen.com",
    "role": "admin"
  }
}
```

**Response (Invalid Credentials):**
```json
{
  "success": false,
  "error": "Invalid email or password"
}
```

**Response (HeyGen Session Failed):**
```json
{
  "success": false,
  "error": "Failed to establish HeyGen session. Please check .env credentials."
}
```

### GET `/api/status`

Check authentication status.

**Response:**
```json
{
  "authenticated": true,
  "cookies": 15
}
```

### POST `/api/logout`

Logout and clear session.

**Response:**
```json
{
  "success": true
}
```

## Cookie Management

### Cookie Structure

Cookies are stored in `heygen-cookies.json`:

```json
{
  "cookies": [...],
  "expiry": 1699012800000,
  "savedAt": "2024-11-03T10:00:00.000Z"
}
```

- **cookies**: Array of HeyGen session cookies
- **expiry**: Timestamp when cookies expire (24 hours from save)
- **savedAt**: ISO timestamp of when cookies were saved

### Auto-Refresh

The system automatically refreshes HeyGen cookies when:

1. User logs in and cookies are expired
2. User submits a prompt and cookies are expired
3. Any API call detects expired cookies

The refresh process:
1. Reads `HEYGEN_EMAIL` and `HEYGEN_PASSWORD` from `.env`
2. Opens Playwright browser (visible)
3. Navigates to HeyGen login
4. Enters credentials automatically
5. Waits for successful login
6. Saves new cookies with 24-hour expiry
7. Closes browser
8. Continues with user's request

## Security Considerations

### Current Implementation

⚠️ **For Development Only**

- Passwords stored in plain text in `users.json`
- No session tokens or JWT
- No rate limiting
- No password complexity requirements

### Production Recommendations

1. **Hash Passwords**: Use bcrypt to hash passwords
   ```javascript
   import bcrypt from 'bcrypt';
   const hashedPassword = await bcrypt.hash(password, 10);
   ```

2. **Session Tokens**: Implement JWT or session tokens
   ```javascript
   import jwt from 'jsonwebtoken';
   const token = jwt.sign({ userId: user.id }, SECRET_KEY, { expiresIn: '7d' });
   ```

3. **Database**: Move from JSON file to proper database (PostgreSQL, MongoDB)

4. **Environment Security**: 
   - Never commit `.env` to git (already in `.gitignore`)
   - Use secrets manager in production (AWS Secrets Manager, etc.)
   - Rotate HeyGen credentials regularly

5. **Rate Limiting**: Add rate limiting to prevent brute force
   ```javascript
   import rateLimit from 'express-rate-limit';
   const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5 });
   app.use('/api/login', limiter);
   ```

6. **HTTPS**: Use HTTPS in production
7. **CORS**: Restrict CORS to specific domains
8. **Input Validation**: Add robust input validation and sanitization

## Troubleshooting

### "HeyGen credentials not found in .env file"

- Ensure `.env` file exists in project root
- Check that `HEYGEN_EMAIL` and `HEYGEN_PASSWORD` are set
- Restart the server after editing `.env`

### "Failed to refresh HeyGen session"

- Verify HeyGen credentials in `.env` are correct
- Check if HeyGen changed their login flow
- Look at Playwright browser window for errors
- Check console logs for detailed error messages

### "Invalid email or password"

- User credentials don't match any entry in `users.json`
- Check for typos in email/password
- Verify `users.json` is properly formatted JSON

### Cookies Keep Expiring

- Check system time is correct
- Verify `cookieExpiry` in `heygen-cookies.json`
- Increase expiry hours in `saveSession()` function

## File Structure

```
.
├── .env                      # Environment variables (gitignored)
├── .env.example              # Example environment file
├── users.json                # User database
├── heygen-cookies.json       # HeyGen session cookies (gitignored)
├── heygen-storage.json       # HeyGen storage state (gitignored)
└── auth-server.js            # Authentication server
```

## Default Credentials

**Admin Account:**
- Email: `admin@arenagen.com`
- Password: `admin123`

**⚠️ Change these credentials in production!**
