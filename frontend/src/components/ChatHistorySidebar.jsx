import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

const ChatHistorySidebar = ({ isOpen, onClose }) => {
  const [chats, setChats] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [chatToDelete, setChatToDelete] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();

  // Extract current session ID from URL
  const currentSessionId = location.pathname.match(/\/generate\/([^/?]+)/)?.[1];

  // Fetch chat history
  useEffect(() => {
    const fetchChats = async () => {
      try {
        setIsLoading(true);
        const baseUrl = window.location.origin;
        const response = await fetch(`${baseUrl}/proxy/api/chats`, {
          credentials: 'include'
        });
        
        if (!response.ok) {
          throw new Error('Failed to fetch chats');
        }
        
        const data = await response.json();
        
        if (data.success && Array.isArray(data.chats)) {
          // Sort by most recent first
          const sortedChats = data.chats.sort((a, b) => 
            new Date(b.updatedAt) - new Date(a.updatedAt)
          );
          setChats(sortedChats);
        } else {
          setChats([]);
        }
      } catch (err) {
        console.error('Error fetching chats:', err);
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };

    if (isOpen) {
      fetchChats();
    }
  }, [isOpen]);

  // Handle chat deletion
  const handleDeleteChat = async (chat) => {
    if (!chat || !chat.id) {
      console.error('Invalid chat object for delete:', chat);
      return;
    }

    try {
      const baseUrl = window.location.origin;
      const response = await fetch(`${baseUrl}/proxy/api/chats/${chat.id}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (!response.ok) {
        console.error('Failed to delete chat:', await response.text());
        return;
      }

      const data = await response.json();
      if (!data.success) {
        console.error('Delete chat response not successful:', data);
        return;
      }

      // Remove chat from local state
      setChats(prev => prev.filter(c => c.id !== chat.id));

      // If the deleted chat is the current one, navigate home
      if (currentSessionId && chat.id.includes(currentSessionId)) {
        navigate('/home');
      }

      // Clear pending delete state
      setChatToDelete(null);
    } catch (err) {
      console.error('Error deleting chat:', err);
    }
  };

  // Handle chat selection
  const handleChatClick = (chat) => {
    console.log('Chat clicked:', chat);
    if (!chat || !chat.id) {
      console.error('Invalid chat object:', chat);
      return;
    }
    
    // Navigate to a special route that indicates we're loading from history
    navigate(`/generate/${chat.id}?loadFromHistory=true`);
    
    // Close sidebar on mobile
    if (window.innerWidth < 768) {
      onClose();
    }
  };

  // Get chat preview text (first user message)
  const getChatPreview = (chat) => {
    if (chat.messages && chat.messages.length > 0) {
      const firstUserMsg = chat.messages.find(m => m.role === 'user' && m.text);
      if (firstUserMsg) {
        return firstUserMsg.text.slice(0, 60) + (firstUserMsg.text.length > 60 ? '...' : '');
      }
    }
    return 'New conversation';
  };

  // Format date
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <>
      {/* Overlay for mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed top-0 left-0 h-full bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 shadow-lg z-50 transform transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        } w-80`}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Chat History</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <svg
              className="w-5 h-5 text-gray-600 dark:text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Chat List */}
        <div className="overflow-y-auto h-[calc(100vh-73px)] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-gray-100 dark:[&::-webkit-scrollbar-track]:bg-gray-800 [&::-webkit-scrollbar-thumb]:bg-gray-300 dark:[&::-webkit-scrollbar-thumb]:bg-gray-600 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:hover:bg-gray-400 dark:[&::-webkit-scrollbar-thumb]:hover:bg-gray-500">
          {isLoading ? (
            <div className="flex items-center justify-center p-8">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-gray-400 dark:bg-gray-600 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                <div className="w-2 h-2 bg-gray-400 dark:bg-gray-600 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                <div className="w-2 h-2 bg-gray-400 dark:bg-gray-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
              </div>
            </div>
          ) : error ? (
            <div className="p-4 text-center text-red-600 dark:text-red-400 text-sm">
              <p>Failed to load chats</p>
              <p className="text-xs mt-1">{error}</p>
            </div>
          ) : chats.length === 0 ? (
            <div className="p-8 text-center text-gray-500 dark:text-gray-400">
              <svg
                className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
              <p className="text-sm">No conversations yet</p>
              <p className="text-xs mt-1">Start a new chat to get started</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {chats.map((chat) => (
                <button
                  key={chat.id}
                  onClick={() => handleChatClick(chat)}
                  className={`w-full text-left p-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${
                    currentSessionId && chat.id.includes(currentSessionId)
                      ? 'bg-blue-50 dark:bg-blue-900/30 border-l-4 border-blue-500'
                      : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {chat.title || chat.name || 'Untitled Chat'}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {formatDate(chat.updatedAt)}
                        </span>
                        {chat.messageCount > 0 && (
                          <>
                            <span className="text-xs text-gray-400 dark:text-gray-600">•</span>
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {chat.messageCount} {chat.messageCount === 1 ? 'message' : 'messages'}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex-shrink-0 flex items-center gap-2">
                      {/* Video indicator */}
                      {chat.hasVideo && (
                        <div>
                          <svg
                            className="w-4 h-4 text-blue-500"
                            fill="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        </div>
                      )}

                      {/* Delete (trash) button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          setChatToDelete(chat);
                        }}
                        className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                        title="Delete chat"
                      >
                        <svg
                          className="w-4 h-4 text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5-3h4m-4 0a1 1 0 00-1 1v2h6V5a1 1 0 00-1-1m-4 0h4M9 10v8m6-8v8"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* New Chat Button */}
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={() => {
              navigate('/home');
              onClose();
            }}
            className="w-full py-2.5 px-4 bg-black dark:bg-gray-700 text-white rounded-lg hover:bg-gray-800 dark:hover:bg-gray-600 transition-colors flex items-center justify-center gap-2 font-medium"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            New Chat
          </button>
        </div>
      </div>

      {chatToDelete && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
          onClick={() => setChatToDelete(null)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Delete chat</h2>
            <p className="text-sm text-gray-700 dark:text-gray-300 mb-6">
              Are you sure you want to delete{' '}
              <span className="font-medium">{chatToDelete.title || chatToDelete.name || 'this chat'}</span>?
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                className="px-4 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                onClick={() => setChatToDelete(null)}
              >
                No
              </button>
              <button
                type="button"
                className="px-4 py-2 text-sm rounded-md bg-red-600 dark:bg-red-700 text-white hover:bg-red-700 dark:hover:bg-red-800"
                onClick={() => handleDeleteChat(chatToDelete)}
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ChatHistorySidebar;