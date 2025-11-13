import React, { useState, useEffect, useRef } from 'react';
import Header from './Header';
import { Play, Pause, Download, X } from 'lucide-react';

const GalleryPage = () => {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef(null);

  useEffect(() => {
    fetchVideos();
  }, []);

  const fetchVideos = async () => {
    try {
      setLoading(true);
      setError(null);
      const baseUrl = window.location.origin;
      const response = await fetch(`${baseUrl}/proxy/api/videos`, {
        method: 'GET',
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      if (data.success && Array.isArray(data.videos)) {
        setVideos(data.videos);
      } else {
        throw new Error(data.error || 'Failed to load videos');
      }
    } catch (err) {
      console.error('Error fetching videos:', err);
      setError(err.message || 'Failed to load videos. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handlePlayPause = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleVideoEnded = () => {
    setIsPlaying(false);
  };

  const handleDownload = (videoUrl) => {
    const link = document.createElement('a');
    link.href = videoUrl;
    link.download = videoUrl.split('/').pop() || 'video.mp4';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return 'Unknown';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Header />
      
      <div className="flex-1 p-4 sm:p-6 md:p-8">
        <div className="max-w-7xl mx-auto">
          <div className="mb-6 sm:mb-8">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">My Videos</h1>
            <p className="text-gray-600 mt-1 sm:mt-2">
              {loading ? 'Loading...' : `${videos.length} video${videos.length !== 1 ? 's' : ''}`}
            </p>
          </div>

          {error ? (
            <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-6">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-red-500" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <p className="text-sm text-red-700">
                    {error}
                    <button 
                      onClick={fetchVideos}
                      className="ml-2 text-sm font-medium text-red-700 hover:text-red-600 underline"
                    >
                      Try again
                    </button>
                  </p>
                </div>
              </div>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-gray-300 border-t-blue-500 mx-auto mb-4"></div>
                <p className="text-gray-600">Loading your videos...</p>
              </div>
            </div>
          ) : videos.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-lg shadow-sm border border-gray-200">
              <svg className="mx-auto h-16 w-16 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
              </svg>
              <h3 className="mt-2 text-lg font-medium text-gray-900">No videos yet</h3>
              <p className="mt-1 text-gray-500">Create your first video to get started!</p>
              <div className="mt-6">
                <a
                  href="/generate"
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  Create Video
                </a>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
              {videos.map((video, index) => (
                <div
                  key={video.id || index}
                  className="group bg-white rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow border border-gray-200"
                >
                  <div className="relative aspect-video bg-gray-100">
                    {/* Fallback placeholder always present */}
                    <div className="absolute inset-0 w-full h-full bg-gradient-to-br from-blue-100 to-blue-200 flex items-center justify-center">
                      <svg className="h-12 w-12 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
                      </svg>
                    </div>
                    {/* If thumbnail exists and loads, overlay it; hide it on error */}
                    {video.thumbnail && (
                      <img
                        src={video.thumbnail}
                        alt={video.title}
                        loading="lazy"
                        className="absolute inset-0 w-full h-full object-cover group-hover:opacity-90 transition-opacity"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    )}
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity space-x-2">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedVideo(video);
                        }}
                        className="bg-black bg-opacity-70 text-white rounded-full p-2 hover:bg-opacity-90 transition-all"
                        aria-label="Play video"
                      >
                        <Play className="w-5 h-5" />
                      </button>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownload(video.url);
                        }}
                        className="bg-black bg-opacity-70 text-white rounded-full p-2 hover:bg-opacity-90 transition-all"
                        aria-label="Download video"
                      >
                        <Download className="w-5 h-5" />
                      </button>
                    </div>
                    
                    {/* Video duration badge */}
                    {video.duration > 0 && (
                      <div className="absolute bottom-2 right-2 bg-black bg-opacity-70 text-white text-xs px-1.5 py-0.5 rounded">
                        {formatDuration(video.duration)}
                      </div>
                    )}
                  </div>
                  <div className="p-3 sm:p-4">
                    <h3 className="font-medium text-gray-900 text-sm sm:text-base truncate" title={video.title}>
                      {video.title}
                    </h3>
                    <div className="flex justify-between items-center mt-1">
                      <p className="text-xs text-gray-500">
                        {new Date(video.createdAt).toLocaleDateString()}
                      </p>
                      <span className="text-xs text-gray-500">
                        {video.size ? formatFileSize(video.size) : ''}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {selectedVideo && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedVideo(null)}
        >
          <div 
            className="relative w-full max-w-4xl bg-black rounded-lg overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="relative pt-[56.25%] bg-black">
              <video
                ref={videoRef}
                src={selectedVideo.url}
                controls={false}
                className="absolute inset-0 w-full h-full"
                onClick={handlePlayPause}
                onEnded={handleVideoEnded}
              >
                Your browser does not support the video tag.
              </video>
              
              {/* Custom controls overlay */}
              <div 
                className={`absolute inset-0 flex items-center justify-center transition-opacity ${isPlaying ? 'opacity-0 hover:opacity-100' : 'opacity-100'}`}
                onClick={handlePlayPause}
              >
                {!isPlaying && (
                  <button 
                    className="bg-black bg-opacity-60 text-white rounded-full p-4 hover:bg-opacity-80 transition-all"
                    aria-label="Play"
                  >
                    <Play className="w-12 h-12" />
                  </button>
                )}
              </div>
              
              {/* Top bar with title and close */}
              <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/70 to-transparent p-4 flex justify-between items-center">
                <h3 className="text-white font-medium text-lg truncate max-w-[80%]" title={selectedVideo.title}>
                  {selectedVideo.title}
                </h3>
                <button
                  onClick={() => {
                    if (videoRef.current) {
                      videoRef.current.pause();
                      setIsPlaying(false);
                    }
                    setSelectedVideo(null);
                  }}
                  className="text-white hover:text-gray-300 focus:outline-none"
                  aria-label="Close"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
              
              {/* Bottom controls */}
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-4">
                <div className="flex items-center justify-center space-x-4">
                  <button 
                    onClick={handlePlayPause}
                    className="text-white hover:text-blue-400 transition-colors"
                    aria-label={isPlaying ? 'Pause' : 'Play'}
                  >
                    {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
                  </button>
                  <div className="flex-1 h-1 bg-gray-600 rounded-full mx-2">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: '0%' }}></div>
                  </div>
                  <button 
                    onClick={() => handleDownload(selectedVideo.url)}
                    className="text-white hover:text-blue-400 transition-colors"
                    aria-label="Download"
                  >
                    <Download className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
            
            {/* Video info */}
            <div className="p-4 bg-gray-900 text-gray-300">
              <div className="flex justify-between items-center text-sm">
                <span>Created: {new Date(selectedVideo.createdAt).toLocaleString()}</span>
                {selectedVideo.size && (
                  <span>{formatFileSize(selectedVideo.size)}</span>
                )}
              </div>
              <div className="mt-2">
                <a
                  href={selectedVideo.url}
                  download
                  className="inline-flex items-center text-blue-400 hover:text-blue-300 text-sm"
                >
                  <Download className="w-4 h-4 mr-1" />
                  Download video
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GalleryPage;