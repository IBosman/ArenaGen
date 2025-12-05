import { useParams, useLocation, useSearchParams } from 'react-router-dom';

const GenerationPage = () => {
  // ... your existing state ...
  const [searchParams] = useSearchParams();
  const location = useLocation();
  
  // Add a function to load chat from history
  const loadChatFromHistory = useCallback(async (chatId) => {
    console.log('📂 Loading chat from history:', chatId);
    setIsLoading(true);
    
    try {
      const baseUrl = window.location.origin;
      const response = await fetch(`${baseUrl}/proxy/api/chats/${chatId}`, {
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error('Failed to load chat');
      }
      
      const data = await response.json();
      
      if (data.success && data.chat && data.chat.messages) {
        console.log(`✅ Loaded ${data.chat.messages.length} messages from history`);
        
        // Process messages same way as WebSocket get_messages
        const sanitizedMessages = data.chat.messages.map(msg => {
          let processedMsg = msg;
          if (msg.role === 'agent' && msg.text) {
            let text = msg.text;
            text = text.replace(/heygen/gi, 'ArenaGen');
            processedMsg = { ...msg, text };
          }
          return processedMsg;
        });
        
        // Set messages and update refs
        setMessages(sanitizedMessages);
        previousMessagesRef.current = sanitizedMessages;
        
        // Seed video URLs and hashes
        for (const m of sanitizedMessages) {
          if (m && m.video && m.video.videoUrl) {
            assignedUrlsRef.current.add(m.video.videoUrl);
            const hash = extractVideoHash(m.video.videoUrl);
            if (hash) videoHashesRef.current.add(hash);
          }
        }
        
        // Cache in sessionStorage
        if (chatId) {
          sessionStorage.setItem(`messages:${chatId}`, JSON.stringify(sanitizedMessages));
        }
        
        // Extract sessionId from chatId if needed
        const sessionIdFromChat = data.chat.sessionId || chatId.replace('chat_', '');
        setSessionId(sessionIdFromChat);
        setSessionPath(`/agent/${sessionIdFromChat}`);
        
        // Navigate the Playwright browser to this session
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          console.log('🌐 Navigating Playwright to historical session:', sessionIdFromChat);
          wsRef.current.send(JSON.stringify({
            action: 'navigate',
            url: `/agent/${sessionIdFromChat}`
          }));
        }
        
        setIsLoading(false);
      } else {
        throw new Error('Invalid chat data');
      }
    } catch (error) {
      console.error('❌ Error loading chat from history:', error);
      setMessages([{ 
        role: 'agent', 
        text: `Failed to load chat: ${error.message}` 
      }]);
      setIsLoading(false);
    }
  }, [extractVideoHash]);

  // Add effect to detect history loading
  useEffect(() => {
    const loadFromHistory = searchParams.get('loadFromHistory');
    const chatIdParam = urlSessionId; // This is from useParams
    
    if (loadFromHistory === 'true' && chatIdParam) {
      console.log('🔍 Detected history load request for chat:', chatIdParam);
      loadChatFromHistory(chatIdParam);
    }
  }, [searchParams, urlSessionId, loadChatFromHistory]);

  // ... rest of your component code ...