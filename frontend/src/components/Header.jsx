import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const Header = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [displayName, setDisplayName] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const baseUrl = window.location.origin;
        const API_BASE = process.env.REACT_APP_API_BASE || `${baseUrl}/auth`;
        const res = await fetch(`${API_BASE}/api/status`, {
          method: 'GET',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        });
        const data = await res.json();
        if (!cancelled && data && data.user) {
          const name = data.user.username || data.user.email || 'User';
          setDisplayName(name);
        }
      } catch (_) {}
    })();
    return () => { cancelled = true; };
  }, [location.pathname]);

  return (
    <header className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-8 py-4 flex items-center gap-2 z-50">
      <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-cyan-400 rounded-lg flex items-center justify-center">
        <a href="/home" className="text-white font-bold text-sm">A</a>
      </div>
      <a href="/home" className="text-xl font-bold text-gray-900 dark:text-gray-100">ArenaGen</a>
      <div className="ml-auto relative flex items-center gap-2">
        <button
          type="button"
          className="px-3 py-2 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 ml-auto"
          aria-label="User menu"
          aria-haspopup="true"
          aria-expanded={menuOpen}
          onClick={() => navigate('/gallery')}
        >
        History
        </button>
        <button
          type="button"
          className="px-3 py-2 rounded-md bg-blue-500 dark:bg-blue-600 text-white hover:bg-blue-600 dark:hover:bg-blue-700"
          aria-label="User menu"
          aria-haspopup="true"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(v => !v)}
        >
          <span className="text-white">{displayName || 'User'}</span>
        </button>
        {menuOpen && (
          <div className="origin-top-right absolute right-0 mt-2 w-48 rounded-md shadow-lg bg-white dark:bg-gray-800 ring-1 ring-black dark:ring-gray-700 ring-opacity-5" role="menu" aria-orientation="vertical" aria-labelledby="user-menu">
            <button
              className="w-full text-left block px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              role="menuitem"
              onClick={async () => {
                try {
                  const baseUrl = window.location.origin;
                  const API_BASE = process.env.REACT_APP_API_BASE || `${baseUrl}/auth`;
                  await fetch(`${API_BASE}/api/logout`, { method: 'POST', credentials: 'include' });
                } finally {
                  const baseUrl = window.location.origin;
                  const API_BASE = process.env.REACT_APP_API_BASE || `${baseUrl}/auth`;
                  window.location.href = `${API_BASE}/login`;
                }
              }}
            >
              Sign out
            </button>
          </div>
        )}
      </div>

    </header>
  );
};

export default Header;