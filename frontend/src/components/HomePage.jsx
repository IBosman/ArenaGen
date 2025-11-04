import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const HomePage = () => {
  const [prompt, setPrompt] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState([]);
  const fileInputRef = React.useRef(null);
  const navigate = useNavigate();

  const handleSubmit = async () => {
    if ((!prompt.trim() && attachedFiles.length === 0) || isSubmitting) return;

    setIsSubmitting(true);
    
    try {
      const PROXY_HTTP_BASE = process.env.REACT_APP_PROXY_HTTP_BASE || 'http://localhost:3000/proxy';
      const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:3000/auth';
      
      // Upload files first if any
      if (attachedFiles.length > 0) {
        console.log('📤 Uploading files...');
        const fileFormData = new FormData();
        attachedFiles.forEach((file, index) => {
          fileFormData.append(`file_${index}`, file);
        });
        
        const uploadResponse = await fetch(`${PROXY_HTTP_BASE}/upload-files`, {
          method: 'POST',
          body: fileFormData
        });
        
        const uploadData = await uploadResponse.json();
        if (!uploadData.success) {
          console.error('File upload failed:', uploadData.error);
          alert('File upload failed: ' + uploadData.error);
          setIsSubmitting(false);
          return;
        }
        console.log('✅ Files uploaded successfully');
        
        // Wait for HeyGen to process the uploaded file
        console.log('⏳ Waiting for HeyGen to process file...');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      
      // Then submit the prompt
      const response = await fetch(`${API_BASE}/api/submit-prompt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ prompt: prompt.trim() })
      });

      const data = await response.json();

      if (data.success) {
        // Clear files after successful submission
        setAttachedFiles([]);
        
        // Save session info to sessionStorage
        if (data.sessionPath) {
          sessionStorage.setItem('currentSession', JSON.stringify({
            sessionPath: data.sessionPath,
            sessionUrl: data.sessionUrl,
            timestamp: Date.now()
          }));
        }
        // Navigate to generation page
        navigate('/generate');
      } else {
        console.error('Failed to submit prompt:', data.error);
        alert('Failed to submit prompt: ' + data.error);
      }
    } catch (error) {
      console.error('Error submitting prompt:', error);
      alert('Error submitting prompt: ' + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleFileClick = () => {
    fileInputRef.current?.click();
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
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="absolute top-0 right-0 p-6 flex items-center gap-4">
        <button className="flex items-center gap-2 text-gray-700 hover:text-gray-900 text-sm">
          <span>EN</span>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <button className="px-4 py-2 text-sm text-gray-700 hover:text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
          Community
        </button>
      </header>

      {/* Main Content */}
      <main className="flex flex-col items-center justify-center min-h-screen px-4">
        <div className="w-full max-w-3xl space-y-8">
          {/* Hero Text */}
          <div className="text-center space-y-4">
            <h1 className="text-4xl md:text-5xl font-semibold text-gray-900">
              Bring any idea to life with Video Agent
            </h1>
            <p className="text-gray-600 text-base md:text-lg max-w-2xl mx-auto">
              Now you can generate professional videos from simple prompts. Browse community creations for inspiration, or start fresh with your own vision
            </p>
          </div>

          {/* Input Box */}
          <div className="relative">
            <div className="bg-white border-2 border-gray-200 rounded-2xl shadow-lg hover:shadow-xl transition-shadow duration-200 overflow-hidden"
                 style={{
                   background: 'linear-gradient(to right, rgba(147, 197, 253, 0.1), rgba(167, 243, 208, 0.1), rgba(253, 224, 71, 0.1))'
                 }}>
              <div className="bg-white/90 backdrop-blur-sm">
                {/* Input Area */}
                <div className="p-6">
                  <textarea
                    className="w-full resize-none border-none outline-none text-gray-900 placeholder-gray-400 text-base bg-transparent"
                    rows="3"
                    placeholder="Share a topic, idea, or instructions with Video Agent to generate a full trailer video"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={isSubmitting}
                  />
                </div>

                {/* Attached Files Display */}
                {attachedFiles.length > 0 && (
                  <div className="px-6 pb-4 border-t border-gray-200">
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
                <div className="px-6 pb-6 flex items-center gap-3">
                  {/* Hidden File Input */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*,video/*,.pdf,.doc,.docx,.txt"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  
                  {/* Attach File Button */}
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
            {/* Send Button inside chatbox */}
            <button
              aria-label="Send"
              onClick={handleSubmit}
              disabled={isSubmitting || (!prompt.trim() && attachedFiles.length === 0)}
              className="absolute bottom-5 right-6 z-10 w-8 h-8 rounded-full bg-black text-white shadow-md hover:shadow-lg hover:scale-105 transition-transform flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
            >
              {isSubmitting ? (
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" />
                </svg>
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19V5" />
                  <path d="M5 12l7-7 7 7" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </main>

      {/* Floating Action Button */}
      <button className="fixed bottom-8 right-8 w-12 h-12 bg-black text-white rounded-full shadow-lg hover:shadow-xl transition-all hover:scale-105 flex items-center justify-center">
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </button>

      {/* Bottom Text */}
      <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 text-xs text-gray-500">
        <span>search</span>
      </div>
    </div>
  );
};

export default HomePage;
