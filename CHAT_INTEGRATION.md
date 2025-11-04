# Chat Integration - Real-time Message Display

## Overview
The frontend now displays HeyGen agent chat messages in real-time when users submit prompts.

## Architecture

### Backend Changes

#### 1. Playwright Proxy (`playwright-live-proxy.js`)
- **Navigate action enhanced**: When navigating to `/agent/<session-id>`, extracts both user and agent messages
- **New `get_messages` action**: Polls current page for latest messages
- **Message format**: Returns `{ role: 'user' | 'agent', text: string }[]` in chronological order
- **Selectors used**:
  - User messages: `div.tw-flex.tw-justify-end > .tw-bg-fill-block`
  - Agent messages: `div.tw-flex.tw-justify-start > div > div.tw-prose` (or `.tw-bg-fill-block`)
  - Reasoning sections are excluded

#### 2. Auth Server (`auth-server.js`)
- **Enhanced `/api/submit-prompt`**: Now returns `sessionUrl` and `sessionPath` after successful submission
- Frontend uses this to navigate the Playwright browser to the agent session

### Frontend Changes

#### GenerationPage Component (`frontend/src/components/GenerationPage.jsx`)
- **WebSocket connection**: Connects to Playwright proxy on `ws://localhost:3000`
- **Message polling**: Polls every 3 seconds for new messages using `get_messages` action
- **Real-time display**: Shows user and agent messages in a chat interface
- **Auto-scroll**: Automatically scrolls to latest message
- **Loading states**: Shows typing indicator while waiting for agent response

## Flow

### First Message (from HomePage or GenerationPage)
1. User enters message in `HomePage` or `GenerationPage`
2. Message sent to `/api/submit-prompt` (auth-server)
3. Auth-server submits to HeyGen, waits for session URL
4. Returns `sessionPath` to frontend
5. Frontend saves session to `sessionStorage`
6. Frontend sends `navigate` action to Playwright proxy with `sessionPath`
7. Playwright proxy navigates and extracts messages
8. Frontend starts polling every 3s with `get_messages`
9. Messages displayed in real-time as agent responds

### Subsequent Messages (in same session)
1. User enters message in `GenerationPage`
2. Frontend checks if `sessionPath` exists in state
3. If yes, sends `send_message` action to Playwright proxy
4. Playwright proxy types message and clicks submit in the browser
5. Frontend immediately polls with `get_messages`
6. New messages appear in real-time

### Session Persistence
- Session info stored in `sessionStorage` with `sessionPath`, `sessionUrl`, and `timestamp`
- When navigating to `/generate`, session is loaded from storage
- Playwright browser navigates to the saved session
- All subsequent messages use the same session

## WebSocket API

### Actions

#### `navigate`
```json
{
  "action": "navigate",
  "url": "/agent/<session-id>"
}
```
Response includes `messages` array if navigating to agent session.

#### `get_messages`
```json
{
  "action": "get_messages"
}
```
Response:
```json
{
  "success": true,
  "action": "get_messages",
  "messages": [
    { "role": "user", "text": "Make a demo video" },
    { "role": "agent", "text": "Hello! I'm Video Agent..." }
  ]
}
```

#### `send_message`
```json
{
  "action": "send_message",
  "message": "an ad for a car"
}
```
Response:
```json
{
  "success": true,
  "action": "send_message"
}
```
Sends a message to the currently active agent session by typing into the input field and clicking submit.

## UI Design

- **User messages**: Black bubbles, right-aligned
- **Agent messages**: White bubbles with border, left-aligned
- **Loading indicator**: Animated dots while waiting
- **Auto-scroll**: Smooth scroll to bottom on new messages
- **Fixed input**: Bottom-centered input box with send button

## Testing

1. Start servers:
   ```bash
   # Terminal 1: Auth server
   node auth-server.js
   
   # Terminal 2: Playwright proxy
   node playwright-live-proxy.js
   
   # Terminal 3: Frontend
   cd frontend && npm start
   ```

2. Navigate to `http://localhost:3001/home`
3. Enter a prompt (e.g., "Make a demo video")
4. Click send or press Enter
5. You'll be redirected to `/generate`
6. Messages appear in real-time as HeyGen agent responds

## Notes

- **Polling interval**: 3 seconds (adjustable in `GenerationPage.jsx`)
- **Selector stability**: Tailwind classes may change; update selectors if needed
- **Reasoning exclusion**: Agent "Reasoning" sections are not displayed (by design)
- **Browser visibility**: Playwright browser runs in headed mode for debugging
- **Session persistence**: Uses `sessionStorage` so sessions are cleared when tab closes
- **Same session**: Messages from `/home` and `/generate` go to the same HeyGen session
- **Automatic polling**: Starts immediately when session is detected or loaded from storage
