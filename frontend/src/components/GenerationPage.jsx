import React, { useState, useEffect, useRef } from 'react';
import VideoGenerationPreloader from './VideoGenerationPreloader';

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
  const [sessionId, setSessionId] = useState(null);
  const [sessionPath, setSessionPath] = useState(null);
  const [videoModal, setVideoModal] = useState(null);
  const [generationProgress, setGenerationProgress] = useState(null);
  const [attachedFiles, setAttachedFiles] = useState([]);
  const messagesEndRef = useRef(null);
  const wsRef = useRef(null);
  const pollIntervalRef = useRef(null);
  const progressPollIntervalRef = useRef(null);
  const previousMessagesRef = useRef([]);
  const videoUrlsRef = useRef(new Map()); // Track video URLs by message ID
  const fileInputRef = useRef(null);

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

  // Connect to Playwright proxy WebSocket
  useEffect(() => {
    const PROXY_WS_URL = process.env.REACT_APP_PROXY_WS_URL || 'ws://localhost:3000/proxy';
    const ws = new WebSocket(PROXY_WS_URL);
    wsRef.current = ws;
    
    // Expose debug function to window for console access
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

    console.log('🔗 Connecting to WebSocket:', PROXY_WS_URL);

    ws.onopen = () => {
      console.log('✅ Connected to Playwright proxy');
      console.log('📍 Debug commands available:');
      console.log('  - debugDom() - Show DOM structure');
      console.log('  - getMessages() - Fetch messages');
      
      // Start progress polling immediately and keep it running
      console.log('🔄 Starting continuous progress polling');
      startProgressPolling();
      
      // Load existing session from sessionStorage
      const savedSession = sessionStorage.getItem('currentSession');
      if (savedSession) {
        try {
          const session = JSON.parse(savedSession);
          if (session.sessionPath) {
            setSessionPath(session.sessionPath);
            const match = session.sessionPath.match(/\/agent\/([^/?]+)/);
            if (match) {
              setSessionId(match[1]);
            }
            
            // Navigate to the session
            ws.send(JSON.stringify({ 
              action: 'navigate', 
              url: session.sessionPath 
            }));
          }
        } catch (err) {
          console.error('Failed to load session:', err);
        }
      }
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      // Handle debug_dom response
      if (data.action === 'debug_dom') {
        console.log('🔍 DOM Debug Info:', data.data);
        return;
      }
      
      console.log('📬 Message from proxy:', data);
      
      // Handle get_messages response with new format
      if (data.action === 'get_messages' && data.messages) {
        // Check if a NEW agent message was added
        const previousAgentCount = previousMessagesRef.current.filter(msg => msg.role === 'agent').length;
        const newAgentCount = data.messages.filter(msg => msg.role === 'agent').length;
        const newAgentMessageAdded = newAgentCount > previousAgentCount;
        
        // Process agent messages and restore video URLs
        const sanitizedMessages = data.messages.map(msg => {
          let processedMsg = msg;
          
          // Sanitize agent messages
          if (msg.role === 'agent' && msg.text) {
            processedMsg = { ...msg, text: sanitizeMessage(msg.text) };
          }
          
          // Restore video URL if we have one stored for this message
          if (processedMsg.video && !processedMsg.video.videoUrl) {
            const messageId = processedMsg.id || `${processedMsg.video.title || 'video'}_${processedMsg.timestamp || data.messages.indexOf(msg)}`;
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
        
        // Update messages
        setMessages(sanitizedMessages);
        previousMessagesRef.current = sanitizedMessages;
        
        // Stop loading if a new agent message was added
        if (newAgentMessageAdded && isLoading) {
          console.log('🎉 New agent message detected, stopping preloader');
          setIsLoading(false);
        }
        
        // Check if any message has a video without URL - fetch it
        const videoWithoutUrl = sanitizedMessages.find(msg => msg.video && !msg.video.videoUrl);
        if (videoWithoutUrl && videoWithoutUrl.video) {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            console.log('🎬 Requesting video URL');
            wsRef.current.send(JSON.stringify({ action: 'get_video_url' }));
          }
        }
      }
      
      // Handle get_generation_progress response
      if (data.action === 'get_generation_progress' && data.success && data.data) {
        console.log('📊 Generation progress received:', data.data);
        if (data.data.isGenerating) {
          setGenerationProgress(data.data);
          console.log('🎥 Video generation detected with', data.data.percentage + '%');
        } else {
          setGenerationProgress(null);
          // Don't stop progress polling - keep it running continuously
        }
      }
      
      // Handle get_video_url response
      if (data.action === 'get_video_url' && data.success && data.data) {
        const newUrl = data.data.videoUrl;
        console.log('Video URL received:', newUrl);
        
        // Only process actual video URLs, not loading animations
        if (newUrl && newUrl.startsWith('https://resource2.')) {
          // Find the message without video URL and store the URL
          setMessages(prev => {
            const updated = [...prev];
            
            for (let i = updated.length - 1; i >= 0; i--) {
              if (updated[i].video && !updated[i].video.videoUrl) {
                const messageId = updated[i].id || `${updated[i].video.title || 'video'}_${updated[i].timestamp || i}`;
                const existingUrl = videoUrlsRef.current.get(messageId);
                
                // Only update if this is a different URL
                if (!existingUrl || existingUrl.videoUrl !== newUrl) {
                  // Store the URL
                  videoUrlsRef.current.set(messageId, {
                    videoUrl: newUrl,
                    poster: data.data.poster
                  });
                  
                  // Update the message
                  updated[i] = {
                    ...updated[i],
                    video: {
                      ...updated[i].video,
                      videoUrl: newUrl,
                      poster: data.data.poster || updated[i].video.poster
                    }
                  };
                  console.log('✅ Updated message with actual video URL:', messageId);
                } else {
                  console.log('⏭️ Same URL already stored for message:', messageId);
                }
                break;
              }
            }
            
            return updated;
          });
        } else {
          console.log('⏭️ Ignoring loading animation URL:', newUrl);
        }
      }
      // Handle navigate response
      if (data.action === 'navigate' || (data.messages && !data.action && data.action !== 'get_messages')) {
        if (data.messages) {
          // New format: array of message objects
          if (Array.isArray(data.messages)) {
            // Sanitize all agent messages
            const sanitizedNavigateMessages = data.messages.map(msg => {
              if (msg.role === 'agent' && msg.text) {
                return { ...msg, text: sanitizeMessage(msg.text) };
              }
              return msg;
            });
            setMessages(sanitizedNavigateMessages);
            previousMessagesRef.current = sanitizedNavigateMessages;
            console.log('Loaded messages from navigate:', data.messages.length);
            // Keep loading state active - let progress polling control it
            // Don't stop loading here as the agent might still be generating
          }
        }
        
        // Extract session ID from URL and start polling
        if (data.url && data.url.includes('/agent/')) {
          const match = data.url.match(/\/agent\/([^/?]+)/);
          if (match) {
            setSessionId(match[1]);
            setSessionPath(data.url.replace(/https:\/\/[^/]+/, ''));
            console.log('Session loaded, starting polling...');
            
            // Poll immediately with multiple attempts to catch agent response
            const pollAttempts = [500, 1500, 2500, 3500];
            pollAttempts.forEach(delay => {
              setTimeout(() => {
                if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                  console.log('Polling for messages at', delay, 'ms...');
                  wsRef.current.send(JSON.stringify({ action: 'get_messages' }));
                }
              }, delay);
            });
            
            // Start polling for new messages
            startPolling();
            // Progress polling is already running continuously
          }
        }
      }
      
      // Handle send_message response
      if (data.action === 'send_message') {
        if (data.success) {
          console.log('Message sent, waiting for agent response...');
          // Keep loading indicator visible, poll aggressively to catch agent response
          const pollAttempts = [100, 500, 1000, 1500, 2000, 2500, 3000];
          pollAttempts.forEach(delay => {
            setTimeout(() => {
              if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                console.log('Polling after send at', delay, 'ms...');
                wsRef.current.send(JSON.stringify({ action: 'get_messages' }));
              }
            }, delay);
          });
          // Progress polling is already running continuously
          // Loading indicator stays on until generation is complete
        } else {
          console.error('Failed to send message:', data.error);
          setMessages(prev => [...prev, { 
            role: 'agent', 
            text: `Error: ${data.error}` 
          }]);
          setIsLoading(false);
        }
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
      stopProgressPolling(); // Stop when component unmounts
      delete window.debugDom;
      delete window.getMessages;
    };
  }, []);

  const startPolling = () => {
    stopPolling(); // Clear any existing interval
    pollIntervalRef.current = setInterval(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ action: 'get_messages' }));
      }
    }, 1000); // Poll every 1 second for faster response detection
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
  
  const stopProgressPolling = () => {
    if (progressPollIntervalRef.current) {
      clearInterval(progressPollIntervalRef.current);
      progressPollIntervalRef.current = null;
    }
  };

  const stopPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage = inputValue.trim();
    setInputValue('');
    setIsLoading(true);

    // Add user message immediately
    setMessages(prev => {
      const updated = [...prev, { role: 'user', text: userMessage }];
      previousMessagesRef.current = updated;
      return updated;
    });

    try {
      // If we have an active session, use send_message action
      if (sessionPath && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        console.log('Sending message to existing session');
        wsRef.current.send(JSON.stringify({ 
          action: 'send_message', 
          message: userMessage 
        }));
      } else {
        // No session yet, create a new one via backend
        console.log('Creating new session');
        const response = await fetch('http://localhost:3000/auth/api/submit-prompt', {
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
      {/* Chat Messages Area */}
      <div className="flex-1 overflow-y-auto p-8 pb-32">
        <div className="max-w-3xl mx-auto space-y-6">
          {messages.map((message, index) => {
            // Hide video cards while generation is in progress
            const isGenerating = generationProgress && generationProgress.isGenerating && generationProgress.percentage > 0;
            const shouldHideVideo = message.video && isGenerating;
            
            // Only show video if it has a URL and generation is not in progress
            const shouldShowVideo = message.video && message.video.videoUrl && !isGenerating;
            
            if (shouldHideVideo) {
              return null; // Don't render video card while generating
            }
            
            return (
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
                  
                  {shouldShowVideo && (
                    <div className="mt-3">
                      <div 
                        onClick={() => setVideoModal(message.video)}
                        className="relative cursor-pointer group overflow-hidden rounded-xl border-2 border-teal-500 bg-gradient-to-r from-teal-900 to-blue-900 p-4"
                      >
                        <div className="flex items-center gap-4">
                          <div className="relative flex-shrink-0">
                            <img 
                              src={message.video.thumbnail} 
                              alt="Video thumbnail"
                              className="w-20 h-20 object-cover rounded-lg"
                            />
                            <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-30 rounded-lg group-hover:bg-opacity-50 transition-all">
                              <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                              </svg>
                            </div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="text-white font-medium text-base truncate">
                              {message.video.title}
                            </h3>
                            <p className="text-teal-200 text-sm mt-1">
                              Your video is ready!
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          
          {/* Show video generation progress when available, otherwise show standard preloader */}
          {generationProgress && generationProgress.isGenerating && generationProgress.percentage > 0 ? (
            <VideoGenerationPreloader
              percentage={generationProgress.percentage || 0}
              message={generationProgress.message || 'Our Video Agent is working on your video'}
              currentStep={generationProgress.currentStep || ''}
            />
          ) : (
            /* Show standard preloader only when loading and no percentage preloader */
            isLoading && (
              <div className="flex justify-start">
                <div className="bg-white text-gray-900 shadow-sm border border-gray-200 rounded-2xl rounded-bl-none px-5 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                  </div>
                </div>
              </div>
            )
          )}
          
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
              disabled={isLoading || !inputValue.trim()}
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
        accept="image/*,video/*,.pdf,.doc,.docx,.txt"
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
