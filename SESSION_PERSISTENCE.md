# Session Persistence Implementation

## Problem Solved
1. ✅ Messages now poll for agent responses automatically every 3 seconds
2. ✅ Messages sent from `/generate` page go to the same session as messages from `/home`

## How It Works

### Session Storage
- When a prompt is submitted from `/home`, the session info is saved to `sessionStorage`:
  ```javascript
  {
    sessionPath: "/agent/<session-id>",
    sessionUrl: "https://app.heygen.com/agent/<session-id>",
    timestamp: 1234567890
  }
  ```

### Session Restoration
- When `GenerationPage` loads, it:
  1. Checks `sessionStorage` for existing session
  2. If found, navigates Playwright browser to that session
  3. Starts polling immediately for messages
  4. Displays all messages from the session

### Message Sending

#### First Message (No Session)
- Calls `/api/submit-prompt` endpoint
- Creates new HeyGen session
- Saves session to `sessionStorage`
- Navigates Playwright browser to session

#### Subsequent Messages (Session Exists)
- Uses `send_message` WebSocket action
- Types message directly into Playwright browser
- Clicks submit button
- Polls immediately for response
- **No new session created** - uses existing one

## Implementation Details

### Backend (`playwright-live-proxy.js`)
Added `send_message` action:
```javascript
case 'send_message':
  // Find input field
  await activePage.waitForSelector('div[role="textbox"][contenteditable="true"]');
  await activePage.click(inputSelector);
  await activePage.fill(inputSelector, message);
  
  // Click submit
  await activePage.click('button[data-loading="false"].tw-bg-brand');
```

### Frontend (`HomePage.jsx`)
Saves session after successful submission:
```javascript
if (data.success && data.sessionPath) {
  sessionStorage.setItem('currentSession', JSON.stringify({
    sessionPath: data.sessionPath,
    sessionUrl: data.sessionUrl,
    timestamp: Date.now()
  }));
}
```

### Frontend (`GenerationPage.jsx`)
1. **On mount**: Loads session from `sessionStorage` and navigates to it
2. **On message send**: 
   - If session exists → use `send_message` action
   - If no session → create new one via `/api/submit-prompt`
3. **Polling**: Runs every 3 seconds when session is active
4. **Auto-poll**: Triggers immediately after sending a message

## Benefits

1. **Continuous conversation**: All messages in one session
2. **No duplicate sessions**: Reuses existing HeyGen session
3. **Faster responses**: Direct browser interaction vs API calls
4. **Real-time updates**: Automatic polling shows agent responses as they arrive
5. **Persistent across navigation**: Session survives `/home` → `/generate` navigation

## Testing

1. Start from `/home`, enter "Make a demo video"
2. Navigate to `/generate` (automatic)
3. See first message and agent response
4. Enter "an ad for a car" in `/generate`
5. Message goes to **same session**
6. Agent response appears automatically
7. Continue conversation in same session

## Session Lifecycle

```
User visits /home
    ↓
Enters first message
    ↓
Session created → saved to sessionStorage
    ↓
Redirected to /generate
    ↓
Session loaded from sessionStorage
    ↓
Playwright navigates to session
    ↓
Polling starts (every 3s)
    ↓
User enters more messages
    ↓
Messages sent via send_message action
    ↓
All messages in same session
    ↓
Tab closed → sessionStorage cleared
```

## Configuration

- **Polling interval**: `3000ms` (3 seconds) - adjust in `GenerationPage.jsx` line 92
- **Storage type**: `sessionStorage` (cleared on tab close) - can change to `localStorage` for persistence
- **Message timeout**: `5000ms` for input field wait - adjust in `playwright-live-proxy.js` line 797
