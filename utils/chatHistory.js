import { fileURLToPath } from 'url';
import path, { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CHATS_DIR = join(__dirname, '../data/chats');

// Ensure chats directory exists and is writable
const ensureChatsDirectory = () => {
  try {
    if (!fs.existsSync(CHATS_DIR)) {
      console.log(`📂 Creating chats directory: ${CHATS_DIR}`);
      fs.mkdirSync(CHATS_DIR, { recursive: true });
      console.log(`✅ Created directory: ${CHATS_DIR}`);
    } else {
      console.log(`📂 Using existing chats directory: ${CHATS_DIR}`);
    }

    // Test if directory is writable
    const testFile = join(CHATS_DIR, `write-test-${Date.now()}.txt`);
    try {
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      console.log('✅ Directory is writable');
    } catch (error) {
      console.error(`❌ Cannot write to ${CHATS_DIR}:`, error);
      console.error('Current working directory:', process.cwd());
      try {
        const stats = fs.statSync(CHATS_DIR, { throwIfNoEntry: false });
        console.error('Directory stats:', stats);
        console.error('Directory permissions:', (stats.mode & 0o777).toString(8));
      } catch (statError) {
        console.error('Could not get directory stats:', statError);
      }
      throw error;
    }
  } catch (error) {
    console.error(`❌ Failed to initialize chats directory ${CHATS_DIR}:`, error);
    throw error;
  }
};

// Initialize chats directory when module loads
ensureChatsDirectory();

// Generate a unique chat ID
const generateChatId = () => `chat_${Date.now()}`;

// Get path to chat file
const getChatPath = (chatId) => path.join(CHATS_DIR, `${chatId}.json`);

/**
 * Saves chat messages to a JSON file if they differ from the saved version
 * @param {string} chatId - Unique identifier for the chat
 * @param {Array} newMessages - Array of message objects to save
 * @returns {Promise<Object|null>} Returns the saved chat data or null if no changes
 */
export const saveChat = async (chatId, newMessages = []) => {
  console.log('🔍 [saveChat] Starting saveChat with:', { 
    chatId, 
    messageCount: newMessages?.length || 0,
    firstMessage: newMessages?.[0] ? {
      role: newMessages[0].role,
      text: newMessages[0].text?.substring(0, 50) + (newMessages[0].text?.length > 50 ? '...' : '')
    } : 'none'
  });
  
  // Input validation
  if (!newMessages || !Array.isArray(newMessages)) {
    console.error('❌ [saveChat] Invalid messages format, expected array');
    return null;
  }
  
  if (!newMessages.length) {
    console.log('💬 [saveChat] No messages to save');
    return null;
  }

  try {
    // Ensure chat directory exists and is writable
    ensureChatsDirectory();
    
    console.log('🔍 [saveChat] Called with chatId:', chatId);
    console.log('📝 [saveChat] Messages to save:', JSON.stringify(newMessages, null, 2));
    
    // Test directory writability
    const testFile = join(CHATS_DIR, `test-${Date.now()}.txt`);
    try {
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      console.log('✅ [saveChat] Directory is writable');
    } catch (err) {
      console.error(`❌ [saveChat] Directory is not writable: ${CHATS_DIR}`, err);
      console.error('Current working directory:', process.cwd());
      try {
        const stats = fs.statSync(CHATS_DIR);
        console.error('Directory stats:', stats);
        console.error('Directory permissions:', (stats.mode & 0o777).toString(8));
      } catch (statError) {
        console.error('Could not get directory stats:', statError);
      }
      return null;
    }
  } catch (error) {
    console.error(`❌ [saveChat] Error with directory ${CHATS_DIR}:`, error);
    return null;
  }

  const chatPath = getChatPath(chatId);
  let existingChat = null;

  // Try to read existing chat if it exists
  try {
    if (fs.existsSync(chatPath)) {
      existingChat = JSON.parse(fs.readFileSync(chatPath, 'utf-8'));
    }
  } catch (error) {
    console.error(`❌ [saveChat] Error reading existing chat:`, error);
  }

  // Process messages to ensure they have required fields
  const processedMessages = newMessages
    .map(msg => ({
      ...msg,
      // Ensure text is a string and trim it
      text: (msg.text || '').toString().trim(),
      // Add timestamp if missing
      timestamp: msg.timestamp || new Date().toISOString()
    }))
    // Filter out empty user messages (unless they have other data like video)
    .filter(msg => {
      const hasContent = msg.text || msg.video || Object.keys(msg).some(k => k !== 'role' && k !== 'text' && k !== 'timestamp');
      return msg.role !== 'user' || hasContent;
    });

  // Check if messages have changed
  if (existingChat && JSON.stringify(existingChat.messages) === JSON.stringify(processedMessages)) {
    console.log('🔄 [saveChat] No changes detected, skipping save');
    return null;
  }

  // Create chat data object
  const chatData = {
    id: chatId,
    updatedAt: new Date().toISOString(),
    messages: processedMessages
  };

  // Set creation time and name
  if (existingChat) {
    chatData.createdAt = existingChat.createdAt || new Date().toISOString();
    chatData.name = existingChat.name || getChatNameFromMessages(processedMessages);
  } else {
    chatData.createdAt = new Date().toISOString();
    chatData.name = getChatNameFromMessages(processedMessages);
  }

  // Write to file
  try {
    await fs.promises.writeFile(chatPath, JSON.stringify(chatData, null, 2));
    console.log(`✅ [saveChat] Saved chat to ${chatPath}`);
    return { ...chatData, path: chatPath };
  } catch (error) {
    console.error(`❌ [saveChat] Error saving to ${chatPath}:`, error);
    return null;
  }
};

/**
 * Generates a chat name from messages
 * @private
 */
function getChatNameFromMessages(messages) {
  const firstUserMessage = messages.find(m => m.role === 'user' && m.text?.trim());
  if (firstUserMessage) {
    return firstUserMessage.text.substring(0, 50) + 
           (firstUserMessage.text.length > 50 ? '...' : '');
  }
  
  const firstVideo = messages.find(m => m.video?.title);
  if (firstVideo) {
    return firstVideo.video.title;
  }
  
  return 'Untitled Chat';
}

// Load chat from file
export const loadChat = (chatId) => {
  try {
    const chatPath = getChatPath(chatId);
    if (!fs.existsSync(chatPath)) {
      return null;
    }
    const data = fs.readFileSync(chatPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading chat:', error);
    return null;
  }
};

// List all chats
export const listChats = () => {
  try {
    if (!fs.existsSync(CHATS_DIR)) {
      return [];
    }
    
    const files = fs.readdirSync(CHATS_DIR);
    return files
      .filter(file => file.endsWith('.json'))
      .map(file => {
        try {
          const chatId = path.basename(file, '.json');
          const chatPath = path.join(CHATS_DIR, file);
          const data = fs.readFileSync(chatPath, 'utf8');
          const { name, updatedAt } = JSON.parse(data);
          return { id: chatId, name, updatedAt };
        } catch (e) {
          console.warn('Error reading chat file:', file, e);
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  } catch (error) {
    console.error('Error listing chats:', error);
    return [];
  }
};
