import React from 'react';

const VideoGenerationPreloader = ({ percentage = 0, message = 'Our Video Agent is working on your video', currentStep = '' }) => {
  // Calculate circle progress
  const radius = 23;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <div className="flex justify-start">
      <div className="max-w-[80%] bg-white text-gray-900 shadow-sm border border-gray-200 rounded-2xl rounded-bl-none px-5 py-4">
        <div className="flex items-center gap-4">
          {/* Circular Progress Indicator */}
          <div className="relative flex-shrink-0">
            <svg width="48" height="48" className="transform -rotate-90">
              {/* Background circle */}
              <circle
                cx="24"
                cy="24"
                r={radius}
                fill="none"
                stroke="#e5e7eb"
                strokeWidth="3"
              />
              {/* Progress circle */}
              <circle
                cx="24"
                cy="24"
                r={radius}
                fill="none"
                stroke="#6366f1"
                strokeWidth="3"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                style={{
                  transition: 'stroke-dashoffset 0.5s ease'
                }}
              />
            </svg>
            {/* Percentage text */}
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-sm font-semibold text-gray-900">
              {percentage}%
            </span>
          </div>

          {/* Message */}
          <div className="flex flex-col gap-1">
            <div className="text-sm font-medium text-gray-700">
              {message}
              <span className="inline-block min-w-[1.5ch] text-left animate-pulse">.</span>
            </div>
            {currentStep && (
              <div className="text-xs text-gray-500 flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-pulse"></div>
                {currentStep}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoGenerationPreloader;
