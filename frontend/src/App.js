import React, { useEffect, useState } from 'react';
import HomePage from './components/HomePage';
import GenerationPage from './components/GenerationPage';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';

function ProtectedRoute({ children }) {
  const [allowed, setAllowed] = useState(null);
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const baseUrl = window.location.origin;
        const API_BASE = process.env.REACT_APP_API_BASE || `${baseUrl}/auth`;
        const res = await fetch(`${API_BASE}/api/status`, {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        const data = await res.json();
        if (!cancelled) {
          if (data && data.userAuthenticated) {
            console.log('✅ User authenticated, allowing access');
            setAllowed(true);
          } else {
            console.log('❌ User not authenticated, redirecting to login');
            setAllowed(false);
            const redirect = encodeURIComponent(window.location.origin + location.pathname + location.search);
            window.location.href = `${API_BASE}/login?redirect=${redirect}`;
          }
        }
      } catch (e) {
        if (!cancelled) {
          console.error('❌ Auth check failed:', e.message);
          setAllowed(false);
          const baseUrl = window.location.origin;
          const API_BASE = process.env.REACT_APP_API_BASE || `${baseUrl}/auth`;
          const redirect = encodeURIComponent(window.location.origin + location.pathname + location.search);
          window.location.href = `${API_BASE}/login?redirect=${redirect}`;
        }
      }
    })();
    return () => { cancelled = true; };
  }, [location.pathname, location.search]);

  if (allowed === null) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p className="text-gray-600">Checking authentication...</p>
        </div>
      </div>
    );
  }
  if (!allowed) return null; // We already redirected
  return children;
}

function App() {
  return (
    <Routes>
      <Route path="/home" element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
      <Route path="/generate" element={<ProtectedRoute><GenerationPage /></ProtectedRoute>} />
      <Route path="/" element={<Navigate to="/home" replace />} />
    </Routes>
  );
}

export default App;
