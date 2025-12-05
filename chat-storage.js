import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Directory where chat files will be stored
const CHATS_DIR = path.join(__dirname, 'data', 'chats');

/**
 * Generates a smart title from messages
 * Priority: 1) Last video title, 2) Last/First user message, 3) Default
 * @param {Array} messages - Array of message objects
 * @param {boolean} useLastUserMessage - If true, use last user message instead of first
 * @returns {string} - Generated title
 */
function generateChatTitle(messages, useLastUserMessage = false) {
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return `Chat ${new Date().toLocaleString()}`;
  }
  
  // Try to find the last video with a title
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.video && msg.video.title) {
      return msg.video.title;
    }
  }
  
  // Find user message (last or first based on parameter)
  let userMsg;
  if (useLastUserMessage) {
    // Find the last user message (for updating existing chats)
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'user' && msg.text && msg.text.trim()) {
        userMsg = msg;
        break;
      }
    }
  } else {
    // Find the first user message (for new chats)
    userMsg = messages.find(m => m.role === 'user' && m.text && m.text.trim());
  }
  
  if (userMsg) {
    const text = userMsg.text.trim();
    // Truncate if too long
    return text.length > 60 ? text.substring(0, 60) + '...' : text;
  }
  
  // Default fallback
  return `Chat ${new Date().toLocaleString()}`;
}

/**
 * Ensures the chats directory exists
 */
async function ensureChatsDirectory() {
  try {
    await fs.mkdir(CHATS_DIR, { recursive: true });
  } catch (error) {
    console.error('Error creating chats directory:', error);
    throw error;
  }
}

/**
 * Saves a chat to a file
 * @param {string} sessionId - The session ID of the chat
 * @param {Array} messages - The messages in the chat
 * @param {string} userEmail - The email of the user who owns the chat
 * @param {string} title - Optional title for the chat
 * @returns {Promise<string>} - The path to the saved chat file
 */
async function saveChat(sessionId, messages, userEmail, title = null) {
  await ensureChatsDirectory();
  
  // Create user-specific directory
  // For backward compatibility, if userEmail is provided, create a user-specific directory
  // Otherwise, save directly to the chats directory
  const userDir = userEmail ? path.join(CHATS_DIR, userEmail.replace(/[@.]/g, '_')) : CHATS_DIR;
  await fs.mkdir(userDir, { recursive: true });
  
  // Generate filename based on session ID
  const filename = `${sessionId}.json`;
  const filePath = path.join(userDir, filename);
  
  // Prepare chat data
  const chatData = {
    id: sessionId,
    title: title || generateChatTitle(messages),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: messages,
    userEmail: userEmail
  };
  
  // Write to file
  try {
    await fs.writeFile(filePath, JSON.stringify(chatData, null, 2), 'utf8');
    console.log(`✅ Chat saved to ${filePath}`);
    return filePath;
  } catch (error) {
    console.error(`❌ Error saving chat to ${filePath}:`, error);
    throw error;
  }
}

/**
 * Updates an existing chat file
 * @param {string} sessionId - The session ID of the chat
 * @param {Array} messages - The messages in the chat
 * @param {string} userEmail - The email of the user who owns the chat
 * @param {string} title - Optional new title for the chat
 * @returns {Promise<string>} - The path to the updated chat file
 */
async function updateChat(sessionId, messages, userEmail, title = null) {
  await ensureChatsDirectory();
  
  // Get user-specific directory
  // For backward compatibility, if userEmail is provided, use a user-specific directory
  // Otherwise, use the chats directory directly
  const userDir = userEmail ? path.join(CHATS_DIR, userEmail.replace(/[@.]/g, '_')) : CHATS_DIR;
  const filePath = path.join(userDir, `${sessionId}.json`);
  
  try {
    // Check if file exists
    let existingData = {};
    try {
      const fileContent = await fs.readFile(filePath, 'utf8');
      existingData = JSON.parse(fileContent);
    } catch (error) {
      // File doesn't exist, create new
      return saveChat(sessionId, messages, userEmail, title);
    }
    
    // Update chat data
    const updatedData = {
      ...existingData,
      messages: messages,
      updatedAt: new Date().toISOString()
    };
    
    // Update title if provided, or regenerate from messages
    if (title) {
      updatedData.title = title;
    } else if (!existingData.title || existingData.title.startsWith('Chat ')) {
      // Regenerate title if it's the default format - use last user message for updates
      updatedData.title = generateChatTitle(messages, true);
    } else {
      // For existing chats with a title, update to the last user message
      updatedData.title = generateChatTitle(messages, true);
    }
    
    // Write updated data
    await fs.writeFile(filePath, JSON.stringify(updatedData, null, 2), 'utf8');
    console.log(`✅ Chat updated at ${filePath}`);
    return filePath;
  } catch (error) {
    console.error(`❌ Error updating chat at ${filePath}:`, error);
    throw error;
  }
}

/**
 * Gets all chats for a user
 * @param {string} userEmail - The email of the user
 * @returns {Promise<Array>} - Array of chat metadata
 */
async function getUserChats(userEmail) {
  await ensureChatsDirectory();
  
  // If userEmail is provided, use user-specific directory, otherwise use main chats directory
  const userDir = userEmail ? path.join(CHATS_DIR, userEmail.replace(/[@.]/g, '_')) : CHATS_DIR;
  
  try {
    // Create directory if it doesn't exist
    await fs.mkdir(userDir, { recursive: true });
    
    // Get all files in user directory
    const files = await fs.readdir(userDir);
    const chatFiles = files.filter(file => file.endsWith('.json'));
    
    // Read and parse each file
    const chats = await Promise.all(
      chatFiles.map(async (file) => {
        try {
          const filePath = path.join(userDir, file);
          const content = await fs.readFile(filePath, 'utf8');
          const chatData = JSON.parse(content);
          
          // Return metadata only, not full messages
          return {
            id: chatData.id,
            title: chatData.title,
            createdAt: chatData.createdAt,
            updatedAt: chatData.updatedAt,
            messageCount: chatData.messages ? chatData.messages.length : 0
          };
        } catch (error) {
          console.error(`Error reading chat file ${file}:`, error);
          return null;
        }
      })
    );
    
    // Filter out nulls and sort by updatedAt (newest first)
    return chats
      .filter(chat => chat !== null)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  } catch (error) {
    console.error(`Error getting chats for user ${userEmail}:`, error);
    return [];
  }
}

/**
 * Gets a specific chat by ID
 * @param {string} sessionId - The session ID of the chat
 * @param {string} userEmail - The email of the user who owns the chat
 * @returns {Promise<Object|null>} - The chat data or null if not found
 */
async function getChatById(sessionId, userEmail) {
  await ensureChatsDirectory();
  
  // If userEmail is provided, use user-specific directory, otherwise use main chats directory
  const userDir = userEmail ? path.join(CHATS_DIR, userEmail.replace(/[@.]/g, '_')) : CHATS_DIR;
  const filePath = path.join(userDir, `${sessionId}.json`);
  
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Error reading chat ${sessionId} for user ${userEmail}:`, error);
    return null;
  }
}

/**
 * Deletes a chat by ID
 * @param {string} sessionId - The session ID of the chat
 * @param {string} userEmail - The email of the user who owns the chat
 * @returns {Promise<boolean>} - True if deleted, false otherwise
 */
async function deleteChat(sessionId, userEmail) {
  await ensureChatsDirectory();
  
  // If userEmail is provided, use user-specific directory, otherwise use main chats directory
  const userDir = userEmail ? path.join(CHATS_DIR, userEmail.replace(/[@.]/g, '_')) : CHATS_DIR;
  const filePath = path.join(userDir, `${sessionId}.json`);
  
  try {
    await fs.unlink(filePath);
    console.log(`✅ Chat ${sessionId} deleted for user ${userEmail}`);
    return true;
  } catch (error) {
    console.error(`Error deleting chat ${sessionId} for user ${userEmail}:`, error);
    return false;
  }
}

export {
  saveChat,
  updateChat,
  getUserChats,
  getChatById,
  deleteChat
};
