import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import VideoGenerationPreloader from './VideoGenerationPreloader';
import Header from './Header';

// Helper function to get WebSocket state name
const getWebSocketStateName = (state) => {
  switch(state) {
    case WebSocket.CONNECTING: return 'CONNECTING';
    case WebSocket.OPEN: return 'OPEN';
    case WebSocket.CLOSING: return 'CLOSING';
    case WebSocket.CLOSED: return 'CLOSED';
    default: return `UNKNOWN (${state})`;
  }
};

// Helper function to get cookie by name
const getCookie = (name) => {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
  return null;
};

const GenerationPage = () => {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(() => {
    // Check if we're loading from a new session (coming from HomePage)
    const savedSession = sessionStorage.getItem('currentSession');
    if (savedSession) {
      try {
        const session = JSON.parse(savedSession);
        // If session was just created (within last 5 seconds), start in loading state
        const isRecent = session.timestamp && (Date.now() - session.timestamp) < 5000;
        return isRecent;
      } catch (err) {
        return false;
      }
    }
    return false;
  });
  const { sessionId: urlSessionId } = useParams();
  const [sessionId, setSessionId] = useState(urlSessionId || null);
  const [sessionPath, setSessionPath] = useState(null);
  const [videoModal, setVideoModal] = useState(null);
  
  // Handle URL parameter changes
  useEffect(() => {
    if (urlSessionId && urlSessionId !== sessionId) {
      setSessionId(urlSessionId);
      
      // If WebSocket is connected, navigate to the new session
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        console.log('URL changed, navigating to session:', urlSessionId);
        wsRef.current.send(JSON.stringify({
          action: 'navigate',
          url: `/agent/${urlSessionId}`
        }));
      }
    }
  }, [urlSessionId, sessionId]);
  const [generationProgress, setGenerationProgress] = useState(null);
  const [isGeneratingLocal, setIsGeneratingLocal] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState([]);
  const [newAgentMessageAdded, setNewAgentMessageAdded] = useState(false);
  const messagesEndRef = useRef(null);
  const wsRef = useRef(null);
  const pollIntervalRef = useRef(null);
  const progressPollIntervalRef = useRef(null);
  const videoUrlPollIntervalRef = useRef(null);
  const getVideoUrlPollIntervalRef = useRef(null);
  const makeChangesPollIntervalRef = useRef(null);
  const continueUnlimitedPollIntervalRef = useRef(null);
  const previousMessagesRef = useRef([]);
  const videoUrlsRef = useRef(new Map()); // Track video URLs by message ID
  const assignedUrlsRef = useRef(new Set()); // Track URLs already assigned to any message
  const videoHashesRef = useRef(new Set()); // Track video hashes to prevent duplicate videos
  const fileInputRef = useRef(null);
  const initialLoadCompleteRef = useRef(false); // Track if initial load is done

  // Manual extraction trigger function (stable reference)
  const extractVideoUrls = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      console.log('🎬 Manually triggering video URL extraction');
      wsRef.current.send(JSON.stringify({ action: 'extract_all_video_urls' }));
    } else {
      console.error('❌ WebSocket not connected');
    }
  }, []);

  // Expose extraction to window for debugging
  useEffect(() => {
    window.extractVideoUrls = extractVideoUrls;
    return () => {
      delete window.extractVideoUrls;
    };
  }, [extractVideoUrls]);

  // Extract video hash from HeyGen URLs to deduplicate by video, not URL
  const extractVideoHash = (url) => {
    if (!url) return null;
    // Extract the video hash from HeyGen URLs
    // Matches patterns like: /caption_HASH.mp4 or /transcode/HASH/
    const captionMatch = url.match(/caption_([a-f0-9]{32})/);
    if (captionMatch) return captionMatch[1];
    
    const transcodeMatch = url.match(/transcode\/([a-f0-9]{32})\//);
    if (transcodeMatch) return transcodeMatch[1];
    
    return null;
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Sanitize message text (no-op for now, kept for future use)
  const sanitizeMessage = (text) => {
    if (!text) return text;
    return text;
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Replace the WebSocket connection useEffect in GenerationPage.jsx
  // This version properly handles direct URL navigation to /generate/:sessionId

  useEffect(() => {
    // Get auth token from cookie
    const authToken = getCookie('arena_token');
    
    // Initialize WebSocket connection - use the same protocol as the page
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Use the same host as the current page for the WebSocket connection
    const wsHost = window.location.host;
    // Remove any existing WebSocket protocol if present in the host
    const cleanHost = wsHost.replace(/^wss?:\/\//, '');
    const wsUrl = process.env.REACT_APP_PROXY_WS_URL || `${protocol}//${cleanHost}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    
    ws.onopen = () => {
      console.log('✅ Connected to Playwright proxy');
      
      // SEND AUTH TOKEN FIRST, BEFORE ANY OTHER ACTION
      if (authToken) {
        console.log('🔐 Sending auth token to WebSocket');
        ws.send(JSON.stringify({
          action: 'authenticate',
          token: authToken
        }));
      } else {
        console.log('⚠️ No auth token found, proceeding as anonymous');
      }
      
      console.log('🔍 Debug commands available:');
      console.log('  - debugDom() - Show DOM structure');
      console.log('  - getMessages() - Fetch messages');
      
      // Start progress polling immediately and keep it running
      console.log('🔄 Starting continuous progress polling');
      startProgressPolling();
      
      // Start get_video_url polling for all page loads
      console.log('🎥 Starting get_video_url polling');
      startGetVideoUrlPolling();
      
      // Start polling for 'Make changes' button
      console.log('🔍 Starting Make changes button polling');
      startMakeChangesPolling();
      
      // Start polling for 'Continue with Unlimited' button
      console.log('🔍 Starting Continue with Unlimited button polling');
      startContinueUnlimitedPolling();
      
      // Determine which session to load
      const savedSession = sessionStorage.getItem('currentSession');
      const targetSessionId = urlSessionId; // From URL params
      
      if (targetSessionId) {
        // Direct URL navigation (e.g., /generate/2c6149a9-9ee4-41c8-9df5-f3d7be5bea2e)
        console.log('🎯 Direct URL navigation detected, sessionId:', targetSessionId);
        const sessionPath = `/agent/${targetSessionId}`;
        
        setSessionPath(sessionPath);
        setSessionId(targetSessionId);
        
        // Try to restore cached messages for this session if present
        const cached = sessionStorage.getItem(`messages:${targetSessionId}`);
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed) && parsed.length > 0) {
              console.log('📦 Restored', parsed.length, 'cached messages');
              setMessages(parsed);
              previousMessagesRef.current = parsed;
              // Seed assigned URL set from cached messages
              for (const m of parsed) {
                if (m && m.video && m.video.videoUrl) {
                  assignedUrlsRef.current.add(m.video.videoUrl);
                }
              }
            }
          } catch (err) {
            console.warn('Failed to parse cached messages:', err);
          }
        }
        
        // Wait for authentication to complete before initial load
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            // First navigate to the session
            console.log('🌐 Navigating to session:', sessionPath);
            ws.send(JSON.stringify({ 
              action: 'navigate', 
              url: sessionPath 
            }));
            
            // Then trigger initial_load after a short delay
            setTimeout(() => {
              if (ws.readyState === WebSocket.OPEN && !initialLoadCompleteRef.current) {
                console.log('🚀 Triggering initial_load for direct URL navigation');
                ws.send(JSON.stringify({ action: 'initial_load' }));
              }
            }, 1000);
          }
        }, 500);
        
      } else if (savedSession) {
        // Restored session from sessionStorage (e.g., after creating new session)
        try {
          const session = JSON.parse(savedSession);
          if (session.sessionPath) {
            console.log('📂 Restoring saved session:', session.sessionPath);
            setSessionPath(session.sessionPath);
            const match = session.sessionPath.match(/\/agent\/([^/?]+)/);
            if (match) {
              const restoredSessionId = match[1];
              setSessionId(restoredSessionId);
              
              // Restore cached messages
              const cached = sessionStorage.getItem(`messages:${restoredSessionId}`);
              if (cached) {
                try {
                  const parsed = JSON.parse(cached);
                  if (Array.isArray(parsed) && parsed.length > 0) {
                    console.log('📦 Restored', parsed.length, 'cached messages');
                    setMessages(parsed);
                    previousMessagesRef.current = parsed;
                    for (const m of parsed) {
                      if (m && m.video && m.video.videoUrl) {
                        assignedUrlsRef.current.add(m.video.videoUrl);
                      }
                    }
                  }
                } catch (err) {
                  console.warn('Failed to parse cached messages:', err);
                }
              }
            }
            
            // Wait for authentication before navigation
            setTimeout(() => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ 
                  action: 'navigate', 
                  url: session.sessionPath 
                }));
                
                // Check if this is a recent session (within last 5 seconds)
                const isRecent = session.timestamp && (Date.now() - session.timestamp) < 5000;
                
                if (isRecent) {
                  // New session - just use normal polling
                  console.log('🆕 Recent session detected, starting normal polling');
                  setTimeout(() => startPolling(), 1000);
                } else {
                  // Older session - trigger initial_load
                  setTimeout(() => {
                    if (ws.readyState === WebSocket.OPEN && !initialLoadCompleteRef.current) {
                      console.log('🚀 Triggering initial_load for saved session');
                      ws.send(JSON.stringify({ action: 'initial_load' }));
                    }
                  }, 1000);
                }
              }
            }, 500);
          }
        } catch (err) {
          console.error('Failed to load session:', err);
        }
      } else {
        // No session at all - this is the home page
        console.log('🏠 No session detected - waiting for user to create one');
      }
    };

    // Expose debug functions
    window.debugDom = () => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ action: 'debug_dom' }));
      } else {
        console.error('❌ WebSocket not connected');
      }
    };

    window.getMessages = () => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ action: 'get_messages' }));
      } else {
        console.error('❌ WebSocket not connected');
      }
    };

    // ... rest of your ws.onmessage, ws.onerror, ws.onclose handlers stay the same ...



    console.log('🔗 Connecting to WebSocket:', process.env.REACT_APP_PROXY_WS_URL);

   // ws.onopen = () => {
    //   console.log('✅ Connected to Playwright proxy');
    //   console.log('📍 Debug commands available:');
    //   console.log('  - debugDom() - Show DOM structure');
    //   console.log('  - getMessages() - Fetch messages');
      
    //   // Start progress polling immediately and keep it running
    //   console.log('🔄 Starting continuous progress polling');
    //   startProgressPolling();
      
    //   // Start message polling immediately
    //   console.log('🔄 Starting continuous message polling');
    //   startPolling();
      
    //   // Load existing session from sessionStorage
    //   const savedSession = sessionStorage.getItem('currentSession');
    //   if (savedSession) {
    //     try {
    //       const session = JSON.parse(savedSession);
    //       if (session.sessionPath) {
    //         setSessionPath(session.sessionPath);
    //         const match = session.sessionPath.match(/\/agent\/([^/?]+)/);
    //         if (match) {
    //           setSessionId(match[1]);
    //           // Restore cached messages for this session if present
    //           const cached = sessionStorage.getItem(`messages:${match[1]}`);
    //           if (cached) {
    //             try {
    //               const parsed = JSON.parse(cached);
    //               if (Array.isArray(parsed) && parsed.length > 0) {
    //                 setMessages(parsed);
    //                 previousMessagesRef.current = parsed;
    //                 // Seed assigned URL set from cached messages
    //                 try {
    //                   for (const m of parsed) {
    //                     if (m && m.video && m.video.videoUrl) {
    //                       assignedUrlsRef.current.add(m.video.videoUrl);
    //                     }
    //                   }
    //                 } catch (_) {}
    //               }
    //             } catch (_) {}
    //           }
    //         }
            
    //         // Navigate to the session
    //         ws.send(JSON.stringify({ 
    //           action: 'navigate', 
    //           url: session.sessionPath 
    //         }));
    //       }
    //     } catch (err) {
    //       console.error('Failed to load session:', err);
    //     }
    //   }
    // };

// Replace your ws.onmessage handler in GenerationPage.jsx with this fixed version

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      // Handle authentication response
      if (data.action === 'authenticated') {
        console.log('✅ WebSocket authentication successful, user:', data.email);
        return;
      }
      
      if (data.action === 'authentication_failed') {
        console.warn('⚠️ WebSocket authentication failed:', data.error);
        return;
      }
      
      // Handle debug_dom response
      if (data.action === 'debug_dom') {
        console.log('🔍 DOM Debug Info:', data.data);
        return;
      }
      
      console.log('📬 Message from proxy:', data);
      
      // Handle initial_load response
      if (data.action === 'initial_load') {
        if (data.success && data.messages) {
          console.log('✅ Initial load complete, received', data.messages.length, 'messages');
          
          // Process messages same way as get_messages
          const sanitizedMessages = data.messages.map(msg => {
            let processedMsg = msg;
            if (msg.role === 'agent' && msg.text) {
              let text = msg.text;
              text = text.replace(/heygen/gi, 'ArenaGen');
              processedMsg = { ...msg, text: sanitizeMessage(text) };
            }
            return processedMsg;
          });
          
          // Set messages directly (no merging needed for initial load)
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
          
          // Persist to sessionStorage
          try {
            if (sessionId) {
              sessionStorage.setItem(`messages:${sessionId}`, JSON.stringify(sanitizedMessages));
            }
          } catch (_) {}
          
          // Mark initial load as complete
          initialLoadCompleteRef.current = true;
          
          // Now start normal polling
          console.log('🔄 Initial load complete, starting normal message polling');
          startPolling();
          startVideoUrlPolling();
          startGetVideoUrlPolling();
          
          // Do not force-stop loading here; let subsequent handlers decide when to stop
        } else {
          console.error('❌ Initial load failed:', data.error);
          // Fall back to normal polling
          startPolling();
          startVideoUrlPolling();
          startGetVideoUrlPolling();
        }
        return;
      }
      
      // Handle get_messages response
      if (data.action === 'get_messages') {
        const messagesArray = Array.isArray(data.messages) 
          ? data.messages 
          : (data.messages && Array.isArray(data.messages.messages) 
            ? data.messages.messages 
            : []);
        
        if (messagesArray.length === 0) {
          return;
        }
        
        // // Count agent messages
        // const previousAgentCount = previousMessagesRef.current.filter(m => m.role === 'agent').length;
        // const currentAgentCount = messagesArray.filter(m => m.role === 'agent').length;
        
        // // If we got a new agent message, stop loading
        // if (currentAgentCount > previousAgentCount) {
        //   console.log('✅ New agent message detected, stopping preloader');
        //   setIsLoading(false);
        //   setIsGeneratingLocal(false);
        // }


        // Check if we have any real agent messages (not just video cards)
        const hasRealAgentMessage = messagesArray.some(m => 
          m.role === 'agent' && (m.text || m.video?.videoUrl)
        );

        // Count current agent text messages
        const currentAgentTextCount = messagesArray.filter(m => 
          m.role === 'agent' && m.text && m.text.length > 0
        ).length;

        const previousAgentTextCount = previousMessagesRef.current.filter(m => 
          m.role === 'agent' && m.text && m.text.length > 0
        ).length;

        // Stop loading if we got a new agent text message
        if (currentAgentTextCount > previousAgentTextCount) {
          console.log('✅ New agent message detected, stopping preloader');
          setIsLoading(false);
          setIsGeneratingLocal(false);
        }
        
        // Continue with your existing message processing code...
        const sanitizedMessages = messagesArray.map(msg => {
          let processedMsg = msg;
          
          // Sanitize agent messages and replace HeyGen with ArenaGen
          if (msg.role === 'agent' && msg.text) {
            let text = msg.text;
            text = text.replace(/heygen/gi, 'ArenaGen');
            processedMsg = { ...msg, text: sanitizeMessage(text) };
          }
          
          // Restore video URL if we have one stored for this message
          if (processedMsg.video && !processedMsg.video.videoUrl) {
            const messageId = processedMsg.id || `${processedMsg.video.title || 'video'}_${processedMsg.timestamp || messagesArray.indexOf(msg)}`;
            const storedUrl = videoUrlsRef.current.get(messageId);
            if (storedUrl) {
              processedMsg = {
                ...processedMsg,
                video: {
                  ...processedMsg.video,
                  videoUrl: storedUrl.videoUrl,
                  poster: storedUrl.poster || processedMsg.video.poster
                }
              };
            }
          }
          
          return processedMsg;
        });
        
        // ... rest of your existing get_messages logic for merging and updating messages ...
        const merged = [];
        for (let i = 0; i < sanitizedMessages.length; i++) {
          const m = sanitizedMessages[i];
          if (m && m.role === 'user' && !m.text && Array.isArray(m.images) && m.images.length > 0) {
            const next = sanitizedMessages[i + 1];
            if (next && next.role === 'user' && next.text) {
              const combinedImages = [...(next.images || [])];
              const existing = new Set(combinedImages.map(img => img && img.url).filter(Boolean));
              for (const img of m.images) {
                if (img && img.url && !existing.has(img.url)) {
                  combinedImages.push(img);
                  existing.add(img.url);
                }
              }
              merged.push({ ...next, images: combinedImages });
              i++;
              continue;
            }
            continue;
          }
          merged.push(m);
        }
        const finalMessages = merged;
        
        // Update state with merged messages
        setMessages(prev => {
          const prevArr = Array.isArray(prev) ? prev : [];
          const result = [...prevArr];
          
          // Helper to detect if a message is a partial/incomplete version of the previous one
          const isPartialOfPrevious = (prevMsg, newMsg) => {
            if (!prevMsg || !newMsg) return false;
            if (prevMsg.role !== newMsg.role) return false;
            if (prevMsg.video || newMsg.video) return false; // Don't merge video messages
            
            const prevText = (prevMsg.text || '').trim();
            const newText = (newMsg.text || '').trim();
            
            if (!prevText || !newText) return false;
            
            // If new message is shorter and is a prefix of previous, it's likely partial
            if (newText.length < prevText.length && prevText.startsWith(newText)) {
              console.log('🔄 [merge] Detected partial message - skipping to avoid duplication');
              return true;
            }
            
            // If new message is longer and starts with previous text, merge them
            if (newText.length > prevText.length && newText.startsWith(prevText)) {
              console.log('🔄 [merge] Detected message continuation - merging');
              return true;
            }
            
            return false;
          };
          
          const upsertMessage = (msg) => {
            // ... your existing upsertMessage logic ...
            if (msg && msg.video) {
              const msgHasUrl = !!(msg.video && msg.video.videoUrl);
              const msgTitle = (msg.video.title || '').trim();
              
              if (msgHasUrl) {
                const existingVideoIndex = result.findIndex(r => r && r.video && r.video.videoUrl === msg.video.videoUrl);
                if (existingVideoIndex >= 0) {
                  const existing = result[existingVideoIndex];
                  result[existingVideoIndex] = {
                    ...existing,
                    ...msg,
                    video: { ...(existing.video || {}), ...(msg.video || {}) }
                  };
                  assignedUrlsRef.current.add(msg.video.videoUrl);
                  return;
                }
              }
              
              if (!msgHasUrl && msgTitle) {
                const existingCompletedIndex = result.findIndex(r => 
                  r && r.video && r.video.videoUrl && 
                  (r.video.title || '').trim() === msgTitle
                );
                if (existingCompletedIndex >= 0) {
                  return;
                }
                
                const existingPendingIndex = result.findIndex(r => r && r.video && !r.video.videoUrl && (r.video.title || '').trim() === msgTitle);
                if (existingPendingIndex >= 0) {
                  const existing = result[existingPendingIndex];
                  result[existingPendingIndex] = {
                    ...existing,
                    ...msg,
                    video: { ...(existing.video || {}), ...(msg.video || {}) }
                  };
                  return;
                }
              }
              
              result.push(msg);
              if (msgHasUrl && msg.video.videoUrl) {
                assignedUrlsRef.current.add(msg.video.videoUrl);
              }
              return;
            }
            
            const keyText = (msg && msg.text ? msg.text : '').trim();
            const keyImgs = (msg && msg.images ? msg.images : [])
              .map(i => i && i.url).filter(Boolean).sort().join('|');
            
            // Check if this is a partial message of the last message
            const lastMsg = result[result.length - 1];
            if (isPartialOfPrevious(lastMsg, msg)) {
              // If new message is shorter (partial), skip it
              if ((msg.text || '').length < (lastMsg.text || '').length) {
                return;
              }
              // If new message is longer (continuation), update the last message
              result[result.length - 1] = { ...lastMsg, ...msg };
              return;
            }
            
            const existingIndex = result.findIndex(m => m && !m.video && (m.role || '') === (msg.role || '') && (m.text || '').trim() === keyText && (m.images || []).map(i => i && i.url).filter(Boolean).sort().join('|') === keyImgs);
            if (existingIndex >= 0) {
              result[existingIndex] = { ...result[existingIndex], ...msg };
            } else {
              result.push(msg);
            }
          };
          
          for (const m of finalMessages) upsertMessage(m);
          
          const capped = result.slice(-200);
          previousMessagesRef.current = capped;
          try {
            if (sessionId) {
              sessionStorage.setItem(`messages:${sessionId}`, JSON.stringify(capped));
            }
          } catch (_) {}
          return capped;
        });
        
        // Stop loading if a new agent message was added
        if (newAgentMessageAdded && isLoading) {
          console.log('🎉 New agent message detected, stopping preloader');
          setIsLoading(false);
        }
        
        return;
      }
      
      // Handle get_generation_progress response
      if (data.action === 'get_generation_progress' && data.success && data.data) {
        console.log('📊 Generation progress received:', data.data);
        if (data.data.isGenerating) {
          setGenerationProgress(data.data);
          console.log('🎥 Video generation detected with', data.data.percentage + '%');
          setIsGeneratingLocal(true);
        } else {
          const wasGenerating = generationProgress && generationProgress.isGenerating;
          // Keep the progress data but mark as not generating
          setGenerationProgress(prev => ({
            ...(prev || {}),
            ...data.data,
            isGenerating: false
          }));
          // Do not force-stop loading on progress completion; wait for video URL or final agent message
          
          // Only trigger extraction ONCE when generation actually completes (not on every poll)
          if (wasGenerating && !data.data.isGenerating && initialLoadCompleteRef.current) {
            console.log('🎉 Generation just completed, starting get_video_url polling...');
            startGetVideoUrlPolling();
          }
        }
        return;
      }
      
      // Handle extract_all_video_urls response
      if (data.action === 'extract_all_video_urls' && data.success && data.data) {
        console.log('🎬 Received extracted video URLs:', data.data.videos.length);
        
        setMessages(prev => {
          const updated = [...prev];
          
          data.data.videos.forEach(videoData => {
            // Try to match by poster first, then by videoUrl hash
            let matchIndex = -1;
            
            if (videoData.poster) {
              matchIndex = updated.findIndex(msg => 
                msg && msg.video && 
                !msg.video.videoUrl &&
                (msg.video.poster === videoData.poster || msg.video.thumbnail === videoData.poster)
              );
            }
            
            // If no match by poster, try to match by URL hash to avoid duplicates
            if (matchIndex < 0) {
              const incomingHash = extractVideoHash(videoData.videoUrl);
              if (incomingHash && videoHashesRef.current.has(incomingHash)) {
                console.log(`⏭️  Video already processed (hash match): ${incomingHash}`);
                return;
              }
            }
            
            // If still no match, find first pending video without URL
            if (matchIndex < 0) {
              matchIndex = updated.findIndex(msg => 
                msg && msg.video && !msg.video.videoUrl
              );
            }
            
            if (matchIndex >= 0) {
              const messageId = updated[matchIndex].id || 
                `${videoData.title}_${updated[matchIndex].timestamp || matchIndex}`;
              
              videoUrlsRef.current.set(messageId, {
                videoUrl: videoData.videoUrl,
                poster: videoData.poster
              });
              
              updated[matchIndex] = {
                ...updated[matchIndex],
                video: {
                  ...updated[matchIndex].video,
                  videoUrl: videoData.videoUrl,
                  poster: videoData.poster || updated[matchIndex].video.poster
                }
              };
              
              assignedUrlsRef.current.add(videoData.videoUrl);
              const videoHash = extractVideoHash(videoData.videoUrl);
              if (videoHash) videoHashesRef.current.add(videoHash);
              
              console.log(`✅ Updated message ${matchIndex} with video URL`);
            } else {
              console.log(`⚠️  No matching message found for video: ${videoData.title}`);
            }
          });
          
          try {
            if (sessionId) {
              sessionStorage.setItem(`messages:${sessionId}`, JSON.stringify(updated.slice(-200)));
            }
          } catch (_) {}
          
          return updated;
        });
        
        // Do not stop loading here; wait for a confirmed complete response or final URL
        return;
      }
      
      // Handle get_video_url response
      if (data.action === 'get_video_url' && data.success && data.data) {
        const payload = data.data || {};
        const newUrl = payload.videoUrl || '';
        const poster = (payload.poster || '').trim();
        const title = (payload.title || '').trim() || 'Your video is ready!';
        const originalUrl = payload.originalUrl || newUrl;
        const videoHash = extractVideoHash(originalUrl);

        if (!newUrl) {
          return;
        }

        setMessages(prev => {
          const updated = Array.isArray(prev) ? [...prev] : [];

          // If this URL already assigned, no-op
          if (assignedUrlsRef.current.has(newUrl)) {
            return updated;
          }

          // Find the last video message without a videoUrl assigned
          let targetIndex = -1;
          for (let i = updated.length - 1; i >= 0; i--) {
            const msg = updated[i];
            if (msg && msg.video && !msg.video.videoUrl) {
              targetIndex = i;
              break;
            }
          }

          if (poster) {
            for (let i = updated.length - 1; i >= 0; i--) {
              const m = updated[i];
              if (m && m.video && !m.video.videoUrl) {
                const p = (m.video.poster || m.video.thumbnail || '').trim();
                if (p && p === poster) {
                  targetIndex = i;
                  break;
                }
              }
            }
          }

          // if (targetIndex < 0 && title) {
          //   for (let i = updated.length - 1; i >= 0; i--) {
          //     const m = updated[i];
          //     if (m && m.video && !m.video.videoUrl) {
          //       const t = (m.video.title || '').trim();
          //       if (t && t === title) {
          //         targetIndex = i;
          //         break;
          //       }
          //     }
          //   }
          // }

          // if (targetIndex < 0) {
          //   // Fallback: create a new video message
          //   updated.push({
          //     role: 'agent',
          //     text: '',
          //     video: {
          //       thumbnail: poster || '',
          //       videoUrl: newUrl,
          //       poster: poster || '',
          //       title
          //     }
          //   });
          // } else {
            // Update the pending card with the URL
            const existing = updated[targetIndex];
            if (existing && existing.video) {
              updated[targetIndex] = {
                ...existing,
                video: {
                  ...existing.video,
                  videoUrl: newUrl || existing.video.videoUrl,
                  poster: poster || existing.video.poster,
                  title: title || existing.video.title
                }
              };
            }

          // Track URL/hash to prevent duplicates and persist
          assignedUrlsRef.current.add(newUrl);
          if (videoHash) {
            videoHashesRef.current.add(videoHash);
          }
          try {
            if (sessionId) {
              sessionStorage.setItem(`messages:${sessionId}`, JSON.stringify(updated.slice(-200)));
            }
          } catch (_) {}

          return updated;
        });
        setIsLoading(false);
        setIsGeneratingLocal(false);
        return;
      }
      
      // Handle send_message response
      if (data.action === 'send_message') {
        // ... your existing send_message handler ...
      }
      
      // Handle navigate response
      if (data.action === 'navigate' || (data.messages && !data.action)) {
        // ... your existing navigate handler ...
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.onclose = () => {
      console.log('Disconnected from Playwright proxy');
    };

 return () => {
    ws.close();
    stopPolling();
    stopProgressPolling();
    stopVideoUrlPolling();
    stopGetVideoUrlPolling();
    stopMakeChangesPolling();
    delete window.debugDom;
    delete window.getMessages;
  };
}, [urlSessionId]); // 

  // HTTP fallback: explicitly ask backend to navigate to this session
  useEffect(() => {
    const currentSessionId = sessionId || urlSessionId;
    if (!currentSessionId) return;
    const baseUrl = window.location.origin;
    fetch(`${baseUrl}/proxy/generate/${currentSessionId}`, {
      method: 'GET',
      credentials: 'include'
    }).catch(err => console.warn('HTTP navigate fallback failed:', err?.message || err));
  }, [sessionId, urlSessionId]);

  const startPolling = () => {
    stopPolling(); // Clear any existing interval
    pollIntervalRef.current = setInterval(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ action: 'get_messages' }));
      }
    }, 5000); // Poll every 5 seconds
  };
  
  const startProgressPolling = () => {
    stopProgressPolling(); // Clear any existing interval
    console.log('🔄 Starting progress polling (continuous)');
    progressPollIntervalRef.current = setInterval(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ action: 'get_generation_progress' }));
      }
    }, 2000); // Poll every 2 seconds for progress updates
  };
  
  const startVideoUrlPolling = () => {
    stopVideoUrlPolling(); // Clear any existing interval
    console.log('🎬 Starting video URL extraction polling');
    videoUrlPollIntervalRef.current = setInterval(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ action: 'extract_all_video_urls' }));
      }
    }, 3000); // Poll every 3 seconds for video URLs
  };
  
  const stopVideoUrlPolling = () => {
    if (videoUrlPollIntervalRef.current) {
      clearInterval(videoUrlPollIntervalRef.current);
      videoUrlPollIntervalRef.current = null;
    }
  };
  
  const startGetVideoUrlPolling = () => {
    stopGetVideoUrlPolling(); // Clear any existing interval
    console.log('🎥 Starting get_video_url polling');
    getVideoUrlPollIntervalRef.current = setInterval(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ action: 'get_video_url' }));
      }
    }, 1000); // Poll every 1 second for video URLs
  };
  
  const stopGetVideoUrlPolling = () => {
    if (getVideoUrlPollIntervalRef.current) {
      clearInterval(getVideoUrlPollIntervalRef.current);
      getVideoUrlPollIntervalRef.current = null;
    }
  };
  
  const stopProgressPolling = () => {
    if (progressPollIntervalRef.current) {
      clearInterval(progressPollIntervalRef.current);
      progressPollIntervalRef.current = null;
    }
  };

  // Poll for 'Make changes' button and click it when found
  const startMakeChangesPolling = () => {
    console.log('🔍 [MakeChanges] 1. Entering startMakeChangesPolling');
    debugger; // This will pause execution if dev tools are open
    
    stopMakeChangesPolling(); // Clear any existing interval
    console.log('🔍 [MakeChanges] 2. Starting Make changes button polling');
    
    // Log WebSocket state
    console.log(`🔍 [MakeChanges] 3. WebSocket state:`, {
      wsRefExists: !!wsRef.current,
      wsReadyState: wsRef.current ? wsRef.current.readyState : 'no wsRef',
      location: window.location.href
    });
    
    makeChangesPollIntervalRef.current = setInterval(() => {
      const timestamp = new Date().toISOString();
      console.log(`🔍 [MakeChanges] [${timestamp}] 4. Polling iteration`);
      
      if (!wsRef.current) {
        console.log('🔍 [MakeChanges] 5. WebSocket not initialized, stopping polling');
        stopMakeChangesPolling();
        return;
      }
      
      const wsState = wsRef.current.readyState;
      console.log(`🔍 [MakeChanges] 6. WebSocket state: ${wsState} (${getWebSocketStateName(wsState)})`);
      
      if (wsState === WebSocket.OPEN) {
        console.log('🔍 [MakeChanges] 7. Sending find_and_click request');
        try {
          wsRef.current.send(JSON.stringify({ 
            action: 'find_and_click',
            selector: 'button:has-text("Make changes")',
            timeout: 2000,
            timestamp: Date.now()
          }));
          console.log('🔍 [MakeChanges] 8. Successfully sent find_and_click request');
        } catch (error) {
          console.error('❌ [MakeChanges] Error sending find_and_click:', error);
        }
      } else {
        console.log(`🔍 [MakeChanges] 9. WebSocket not ready, state: ${wsState} (${getWebSocketStateName(wsState)})`);
      }
    }, 2000); // Check every 2 seconds
  };

  const stopMakeChangesPolling = () => {
    if (makeChangesPollIntervalRef.current) {
      clearInterval(makeChangesPollIntervalRef.current);
      makeChangesPollIntervalRef.current = null;
    }
  };

  // Poll for 'Continue with Unlimited' button and click it when found
  const startContinueUnlimitedPolling = () => {
    console.log('🔍 [ContinueUnlimited] 1. Starting Continue with Unlimited button polling');
    
    stopContinueUnlimitedPolling(); // Clear any existing interval
    
    // Create a ref to store the interval ID
    if (!continueUnlimitedPollIntervalRef.current) {
      continueUnlimitedPollIntervalRef.current = setInterval(() => {
        const timestamp = new Date().toISOString();
        console.log(`🔍 [ContinueUnlimited] [${timestamp}] 2. Polling iteration`);
        
        if (!wsRef.current) {
          console.log('🔍 [ContinueUnlimited] 3. WebSocket not initialized, stopping polling');
          stopContinueUnlimitedPolling();
          return;
        }
        
        const wsState = wsRef.current.readyState;
        console.log(`🔍 [ContinueUnlimited] 4. WebSocket state: ${wsState} (${getWebSocketStateName(wsState)})`);
        
        if (wsState === WebSocket.OPEN) {
          console.log('🔍 [ContinueUnlimited] 5. Sending find_and_click request for Continue with Unlimited');
          try {
            wsRef.current.send(JSON.stringify({ 
              action: 'find_and_click',
              selector: 'button:has-text("Continue with Unlimited")',
              timeout: 2000,
              timestamp: Date.now()
            }));
            console.log('🔍 [ContinueUnlimited] 6. Successfully sent find_and_click request');
          } catch (error) {
            console.error('❌ [ContinueUnlimited] Error sending find_and_click:', error);
          }
        } else {
          console.log(`🔍 [ContinueUnlimited] 7. WebSocket not ready, state: ${wsState} (${getWebSocketStateName(wsState)})`);
        }
      }, 2000); // Check every 2 seconds
    }
  };

  const stopContinueUnlimitedPolling = () => {
    if (continueUnlimitedPollIntervalRef.current) {
      clearInterval(continueUnlimitedPollIntervalRef.current);
      continueUnlimitedPollIntervalRef.current = null;
    }
  };

  const stopPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  const handleSendMessage = async () => {
    if ((!inputValue.trim() && attachedFiles.length === 0) || isLoading) return;

    const userMessage = inputValue.trim();
    setInputValue('');
    
    // Reset all loading states
    setIsLoading(true);
    setIsGeneratingLocal(false);
    setGenerationProgress(null);
    
    // Clear any previous agent messages to ensure we're starting fresh
    setMessages(prev => {
      const newMessages = prev.filter(msg => msg.role !== 'agent' || !msg.text.includes('Thinking...'));
      return [...newMessages, { role: 'user', text: userMessage }];
    });
    
    // Update previous messages ref
    previousMessagesRef.current = [...previousMessagesRef.current, { role: 'user', text: userMessage }];

    // // Add user message immediately
    // setMessages(prev => {
    //   const updated = [...prev, { role: 'user', text: userMessage }];
    //   previousMessagesRef.current = updated;
    //   return updated;
    // });

    try {
      // If we have an active session, upload files first if any
      if (sessionPath && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        // Upload files if attached
        if (attachedFiles.length > 0) {
          console.log('📤 Uploading', attachedFiles.length, 'files...');
          for (const file of attachedFiles) {
            const reader = new FileReader();
            reader.onload = (e) => {
              const base64Content = e.target.result;
              wsRef.current.send(JSON.stringify({
                action: 'upload_files',
                files: [{
                  name: file.name,
                  content: base64Content,
                  type: file.type
                }]
              }));
              console.log('📤 Uploaded file:', file.name);
            };
            reader.readAsDataURL(file);
          }
          // Clear attached files after upload
          setAttachedFiles([]);
          // Wait a bit for files to be processed
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
        console.log('Sending message to existing session', window.location.pathname);
        wsRef.current.send(JSON.stringify({ 
          action: 'send_message', 
          message: userMessage,
          currentPath: window.location.pathname
        }));
      } else {
        // No session yet, upload files first if any
        if (attachedFiles.length > 0) {
          console.log('📤 Uploading', attachedFiles.length, 'files to home page...');
          const fileFormData = new FormData();
          attachedFiles.forEach((file, index) => {
            fileFormData.append(`file_${index}`, file);
          });
          
          const baseUrl = window.location.origin;
          const PROXY_HTTP_BASE = process.env.REACT_APP_PROXY_HTTP_BASE || `${baseUrl}/proxy`;
          const uploadResponse = await fetch(`${PROXY_HTTP_BASE}/upload-files`, {
            method: 'POST',
            body: fileFormData
          });
          
          const uploadData = await uploadResponse.json();
          if (!uploadData.success) {
            console.error('File upload failed:', uploadData.error);
            setMessages(prev => [...prev, { 
              role: 'agent', 
              text: `File upload failed: ${uploadData.error}` 
            }]);
            setIsLoading(false);
            return;
          }
          console.log('✅ Files uploaded successfully');
          setAttachedFiles([]);
          
          // Wait for HeyGen to process the uploaded file
          console.log('⏳ Waiting for HeyGen to process file...');
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
        
        // Create a new session via backend
        console.log('Creating new session');
        const baseUrl = window.location.origin;
        const response = await fetch(`${baseUrl}/auth/api/submit-prompt`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ prompt: userMessage })
        });

        const data = await response.json();

        if (data.success) {
          console.log('Prompt submitted successfully');
          
          // Save session info
          if (data.sessionPath) {
            setSessionPath(data.sessionPath);
            sessionStorage.setItem('currentSession', JSON.stringify({
              sessionPath: data.sessionPath,
              sessionUrl: data.sessionUrl,
              timestamp: Date.now()
            }));
            
            // Navigate Playwright browser to the session
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ 
                action: 'navigate', 
                url: data.sessionPath 
              }));
            }
          }
          
          // Messages will be updated via WebSocket
        } else {
          console.error('Failed to submit prompt:', data.error);
          setMessages(prev => [...prev, { 
            role: 'agent', 
            text: `Error: ${data.error}` 
          }]);
          setIsLoading(false);
        }
      }
    } catch (error) {
      console.error('Error submitting prompt:', error);
      setMessages(prev => [...prev, { 
        role: 'agent', 
        text: `Error: ${error.message}` 
      }]);
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      setAttachedFiles(prev => [...prev, ...files]);
      console.log('Files attached:', files.map(f => f.name));
    }
  };

  const removeFile = (index) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header with Logo */}
      <Header />
      
      {/* Chat Messages Area */}
      <div className="flex-1 overflow-y-auto p-8 pb-32">
        <div className="max-w-3xl mx-auto space-y-6">
          {messages.map((message, index) => (
            <div
              key={index}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
                <div
                  className={`max-w-[80%] rounded-2xl px-5 py-3 ${
                    message.role === 'user'
                      ? 'bg-black text-white rounded-br-none'
                      : 'bg-white text-gray-900 shadow-sm border border-gray-200 rounded-bl-none'
                  }`}
                >
                  {message.text && (
                    <div className="text-sm sm:text-base whitespace-pre-wrap break-words">
                      {message.text}
                    </div>
                  )}
                  
                  {message.images && message.images.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {message.images.map(({ url, alt }, imgIndex) => (
                        <div key={imgIndex} className="relative">
                          <img
                            src={url}
                            alt={alt}
                            width={150}
                            height={150}
                            referrerPolicy="no-referrer"
                            crossOrigin="anonymous"
                            onError={(e) => {
                              console.warn('Image failed to load, showing link instead:', url);
                              const container = e.currentTarget.parentElement;
                              if (container) {
                                container.innerHTML = `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-blue-600 underline break-all">Open image</a>`;
                              }
                            }}
                            className="w-[150px] h-[150px] rounded-lg object-cover border border-gray-300"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {/* {message.video && (
                    // Video messages are rendered in the unified progress/video card below
                    null
                  )} */}
                  {/* Unified Progress/Video Card - now inline with message */}
                  {message.video && (() => {
                    // Show unified card if we have generation progress or a video message
                    if (isGeneratingLocal || generationProgress?.isGenerating || message.video) {
                      // If we have a video URL, show the video card
                      if (message.video.videoUrl) {
                        return (
                          <div className="mt-3">
                            <div
                              onClick={() => setVideoModal(message.video)}
                              className="cursor-pointer group relative rounded-2xl overflow-hidden border border-gray-200 hover:border-teal-500 transition-all hover:shadow-lg w-full max-w-sm"
                            >
                              <div className="relative w-full aspect-video bg-gray-900">
                                <div className="w-full h-full flex items-center justify-center bg-gray-900">
                                  <img
                                    src={message.video.poster || message.video.thumbnail}
                                    alt={message.video.title || 'Video thumbnail'}
                                    className="w-full h-full object-contain"
                                    onError={(e) => {
                                      if (message.video.poster && message.video.poster !== e.target.src) {
                                        e.target.src = message.video.poster;
                                      } else if (message.video.thumbnail && message.video.thumbnail !== e.target.src) {
                                        e.target.src = message.video.thumbnail;
                                      } else {
                                        e.target.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2ZmZiI+PHBhdGggZD0iTTE5IDV2MTRINVY1aDhtMC0ySDVjLTEuMSAwLTIgLjktMiAydjE0YzAgMS4xLjkgMiAyIDJoMTRjMS4xIDAgMi0uOSAyLTJWNWMwLTEuMS0uOS0yLTItMnoiLz48cGF0aCBkPSJNMTAgMTVsNS0zLTUtM3Y2eiIvPjwvc3ZnPg==';
                                      }
                                    }}
                                  />
                                </div>
                                <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-all flex items-center justify-center">
                                  <div className="w-12 h-12 rounded-full bg-white bg-opacity-0 group-hover:bg-opacity-100 transition-all flex items-center justify-center">
                                    <svg className="w-6 h-6 text-gray-900 ml-1" fill="currentColor" viewBox="0 0 24 24">
                                      <path d="M8 5v14l11-7z" />
                                    </svg>
                                  </div>
                                </div>
                              </div>
                              <div className="p-3 bg-white">
                                <p className="text-sm font-medium text-gray-900 truncate">
                                  {message.video.title || 'Your video is ready!'}
                                </p>
                              </div>
                            </div>
                          </div>
                        );
                      }
                      
                      // Otherwise show the progress indicator
                      return (
                        <div className="mt-3">
                          <VideoGenerationPreloader
                            percentage={generationProgress?.percentage || 0}
                            message={generationProgress?.message || 'Our Video Agent is working on your video'}
                            currentStep={generationProgress?.currentStep || ''}
                          />
                        </div>
                      );
                    }
                    
                    return null;
                  })()}

                </div>
              </div>
          ))}

          {/* Standard preloader - KEEP THIS OUTSIDE, after the messages loop */}
          {/* {isLoading && !messages.some(m => m.video) && ( */}
          {isLoading && !messages.some(m => m.video) && !isGeneratingLocal && !generationProgress?.isGenerating && (
            <div className="flex justify-start">
              <div className="bg-white text-gray-900 shadow-sm border border-gray-200 rounded-2xl rounded-bl-none px-5 py-3">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                </div>
              </div>
            </div>
          )}

          {/* Video generation preloader - shows when video is being generated */}
          {/* {(isGeneratingLocal || generationProgress?.isGenerating) && (
            <div className="flex justify-start">
              <VideoGenerationPreloader
                percentage={generationProgress?.percentage || 0}
                message={generationProgress?.message || 'Our Video Agent is working on your video'}
                currentStep={generationProgress?.currentStep || ''}
              />
            </div>
          )} */}
          
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Bottom Input - Fixed */}
      <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 w-full max-w-2xl px-4">
        <div className="bg-white border border-gray-300 rounded-2xl shadow-lg hover:shadow-xl transition-shadow duration-200">
          <div className="p-4 relative">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
              className="w-full pr-10 resize-none border-none outline-none text-gray-900 placeholder-gray-400 text-sm bg-transparent"
              placeholder="Share a topic, idea, or instructions with Video Agent to produce a full trailer video"
            />
            
            {/* Send Button */}
            <button
              onClick={handleSendMessage}
              disabled={isLoading || (!inputValue.trim() && attachedFiles.length === 0)}
              className="absolute right-6 top-1/2 transform -translate-y-1/2 w-8 h-8 rounded-full bg-black text-white hover:bg-gray-800 transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5" />
                <path d="M5 12l7-7 7 7" />
              </svg>
            </button>
          </div>

          {/* Attached Files Display */}
          {attachedFiles.length > 0 && (
            <div className="px-4 pb-4 border-t border-gray-200">
              <div className="flex flex-wrap gap-4 pt-4">
                {attachedFiles.map((file, index) => {
                  const isImage = file.type.startsWith('image/');
                  const preview = isImage ? URL.createObjectURL(file) : null;
                  
                  return (
                    <div key={index} className="relative group">
                      <div className="relative w-24 h-24 rounded-lg overflow-hidden border border-gray-300 bg-gray-100">
                        {preview ? (
                          <img 
                            src={preview} 
                            alt={file.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-gray-200">
                            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => removeFile(index)}
                        className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
                        title="Remove file"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                      <p className="text-xs text-gray-600 mt-1 truncate w-24 text-center">{file.name}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Toolbar */}
          <div className="px-4 pb-4 flex items-center gap-3">
            {/* Plus Button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Attach files"
              className="p-2 rounded-lg transition-colors hover:bg-gray-100 bg-transparent border border-gray-200 text-gray-600 hover:text-gray-900"
           >
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />
      
      {/* Video Modal */}
      {videoModal && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4"
          onClick={() => setVideoModal(null)}
        >
          <div 
            className="relative max-w-4xl w-full bg-gray-900 rounded-2xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => setVideoModal(null)}
              className="absolute top-4 right-4 z-10 w-10 h-10 bg-black bg-opacity-50 hover:bg-opacity-75 rounded-full flex items-center justify-center text-white transition-all"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            
            {/* Video title */}
            <div className="bg-gradient-to-r from-teal-900 to-blue-900 px-6 py-4">
              <h2 className="text-white text-xl font-semibold">{videoModal.title}</h2>
            </div>
            
            {/* Video player */}
            <div className="relative bg-black">
              {videoModal.videoUrl ? (
                <video
                  className="w-full h-auto max-h-[70vh]"
                  src={videoModal.videoUrl}
                  poster={videoModal.poster}
                  controls
                  autoPlay
                >
                  Your browser does not support the video tag.
                </video>
              ) : (
                <div className="flex flex-col items-center justify-center p-12 text-gray-400">
                  <img 
                    src={videoModal.thumbnail} 
                    alt="Video thumbnail"
                    className="w-64 h-64 object-cover rounded-lg mb-4"
                  />
                  <p>Video URL not available</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GenerationPage;
